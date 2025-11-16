// src/pages/Comunicaciones.jsx
import React, { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../supabase/client";
import {
  DSInput,
  DSSelect,
  BtnPrimary,
  BtnSecondary,
  TextAreaStyle,
  BtnDanger,
} from "../components/controls";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

export default function Comunicaciones() {
  const { t, i18n } = useTranslation();

  const [currentUserId, setCurrentUserId] = useState(null);

  // Operadores (destinatarios)
  const [operadores, setOperadores] = useState([]);
  const [operadoresOptions, setOperadoresOptions] = useState([]);

  // Creación de nuevo thread
  const [tituloNuevo, setTituloNuevo] = useState("");
  const [contenidoNuevo, setContenidoNuevo] = useState("");
  const [urgencia, setUrgencia] = useState("normal"); // "normal" | "urgent"
  const [sendToAll, setSendToAll] = useState(true);
  const [destinatariosSeleccionados, setDestinatariosSeleccionados] = useState(
    []
  );

  // Hilos y mensajes
  const [threads, setThreads] = useState([]);
  const [selectedThread, setSelectedThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const [replyText, setReplyText] = useState("");
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // =========================
  // Helpers
  // =========================

  const formatDateTime = (isoString) => {
    if (!isoString) return "";
    return new Date(isoString).toLocaleString();
  };

  const getUserName = (userId) => {
    if (!userId) return "";
    if (userId === currentUserId) return t("you");
    const u = operadores.find((op) => op.uid === userId);
    if (u) {
      return u.nombre || u.email || userId.slice(0, 8);
    }

    return userId.slice(0, 8);
  };
  
  // =========================
  // Cargar usuario actual
  // =========================
  useEffect(() => {
    const cargarUsuario = async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error) {
        console.warn("Error obteniendo usuario actual:", error.message);
        return;
      }
      setCurrentUserId(data?.user?.id ?? null);
    };
    cargarUsuario();
  }, []);

    // =========================
    // Cargar usuarios (destinatarios) desde Supabase
    // =========================
    const cargarOperadores = useCallback(async () => {
      try {
        // Cargar directamente desde la tabla operadores
        const { data: ops, error } = await supabase
          .from("operadores")
          .select("uid, nombre, email, role, activo")
          .eq("activo", true)
          .order("nombre", { ascending: true });

        if (error) throw error;

        const lista = (ops || []).map((op) => ({
          uid: op.uid,
          nombre: op.nombre,
          email: op.email || "",
          role: op.role,
          is_active: op.activo,
        }));

        // Guardamos lista completa para getUserName, replies, etc.
        setOperadores(lista);

        // Opciones para el DSSelect (value = uid, label = nombre/email/uid)
        const opts = lista.map((u) => ({
          value: u.uid,
          label: u.nombre || u.email || u.uid.slice(0, 8),
        }));
        setOperadoresOptions(opts);
      } catch (error) {
        console.error("Error cargando usuarios para comunicaciones:", error);
        toast.error(
          error.message || t("error_loading") || "Error cargando usuarios"
        );
      }
    }, [t]);

    // =========================
    // Cargar threads
    // =========================
    const cargarThreads = useCallback(async () => {
      try {
        setLoadingThreads(true);
        // RLS hará que solo veas los threads donde eres participante
        const { data, error } = await supabase
          .from("chat_threads")
          .select("id, tipo, titulo, es_urgente, created_at")
          .order("created_at", { ascending: false });

        if (error) throw error;

        setThreads(data || []);

        if (!selectedThread && data && data.length > 0) {
          setSelectedThread(data[0]);
        }
      } catch (err) {
        console.error("Error cargando threads:", err);
        toast.error((t("error_loading") || "Error cargando hilos") + ": " + (err.message || ""));
      } finally {
        setLoadingThreads(false);
      }
    }, [selectedThread, t]);

    // =========================
    // Cargar mensajes de un thread
    // =========================
    const cargarMensajesThread = useCallback(
      async (threadId) => {
        if (!threadId) return;
        try {
          setLoadingMessages(true);
          const { data, error } = await supabase
            .from("chat_messages")
            .select("id, thread_id, sender_id, contenido, tipo, created_at")
            .eq("thread_id", threadId)
            .order("created_at", { ascending: true });

          if (error) throw error;

          setMessages(data || []);

          // Marcar como leído usando RPC
          const { error: readError } = await supabase.rpc(
            "mark_thread_as_read",
            { p_thread_id: threadId }
          );
          if (readError) {
            console.warn("mark_thread_as_read error:", readError.message);
          }
        } catch (err) {
          console.error("Error cargando mensajes:", err);
          toast.error((t("error_loading") || "Error cargando mensajes") + ": " + (err.message || ""));
        } finally {
          setLoadingMessages(false);
        }
      },
      [t]
    );

  // =========================
  // Inicialización: operadores + threads
  // =========================
  useEffect(() => {
    cargarOperadores();
    cargarThreads();
  }, [cargarOperadores, cargarThreads]);

  // Cargar mensajes cuando cambie el thread seleccionado
  useEffect(() => {
    if (selectedThread?.id) {
      cargarMensajesThread(selectedThread.id);
    } else {
      setMessages([]);
    }
  }, [selectedThread, cargarMensajesThread]);

      // =========================
      // Realtime: mensajes nuevos
      // =========================
      useEffect(() => {
        const canalMensajes = supabase
          .channel("canal_chat_mensajes_web")
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "chat_messages" },
            async (payload) => {
              const nuevo = payload.new;

              // 1) Siempre refrescamos lista de conversaciones
              await cargarThreads();

              // 2) Si estoy viendo ese hilo, recargar mensajes completos
              if (selectedThread?.id === nuevo.thread_id) {
                await cargarMensajesThread(nuevo.thread_id);
              }

              // 3) Si el mensaje viene de otro usuario y es URGENTE, toast invasivo
              if (nuevo.sender_id === currentUserId) return;

              const { data: thread, error } = await supabase
                .from("chat_threads")
                .select("id, titulo, es_urgente")
                .eq("id", nuevo.thread_id)
                .single();

              if (error || !thread || !thread.es_urgente) return;

              toast.error(
                t("urgent_message_arrived", {
                  title: thread.titulo || "",
                }) || "Nuevo mensaje URGENTE",
                {
                  position: "top-center",
                  autoClose: false,
                  closeOnClick: true,
                  onClick: () => {
                    setSelectedThread(thread);
                    cargarMensajesThread(thread.id);
                  },
                }
              );
            }
          )
          .subscribe((status) => {
            console.log("📶 Estado canal chat_mensajes_web:", status);
          });

        const canalThreads = supabase
          .channel("canal_chat_threads_web")
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "chat_threads" },
            () => {
              // Nuevo hilo creado desde otro cliente
              cargarThreads();
            }
          )
          .subscribe((status) => {
            console.log("📶 Estado canal chat_threads_web:", status);
          });

        return () => {
          supabase.removeChannel(canalMensajes);
          supabase.removeChannel(canalThreads);
        };
      }, [
        selectedThread?.id,
        currentUserId,
        cargarMensajesThread,
        cargarThreads,
        t,
      ]);

  // =========================
  // Crear nuevo thread + primer mensaje
  // =========================
  const handleCreateThread = async () => {
    if (!contenidoNuevo.trim()) {
      toast.error(t("fill_all_fields"));
      return;
    }
    if (!currentUserId) {
      toast.error("Usuario no autenticado");
      return;
    }

    try {
      // Destinatarios
      let destinatariosIds = destinatariosSeleccionados.map(
        (opt) => opt.value
      );

      if (sendToAll) {
        destinatariosIds = operadores.map((u) => u.uid);
      }

      // Limpieza: quitar duplicados y eliminar tu propio id (lo agregamos aparte)
      destinatariosIds = Array.from(new Set(destinatariosIds)).filter(
        (id) => !!id
      );

      if (destinatariosIds.length === 0) {
        toast.error(t("recipients") + ": " + t("fill_all_fields"));
        return;
      }

      // Tipo de thread: direct si solo hay 1 destinatario, si no broadcast
      const tipo =
        destinatariosIds.length === 1 ? "direct" : "broadcast";

      // 1) Crear thread
      const { data: thread, error: threadError } = await supabase
        .from("chat_threads")
        .insert({
          tipo,
          titulo: tituloNuevo?.trim() || null,
          es_urgente: urgencia === "urgent",
          creado_por: currentUserId,
        })
        .select()
        .single();

      if (threadError) throw threadError;

      // 2) Insertar participantes (destinatarios + remitente)
      const participantes = Array.from(
        new Set([...destinatariosIds, currentUserId])
      ).map((uid) => ({
        thread_id: thread.id,
        user_id: uid,
      }));

      const { error: partError } = await supabase
        .from("chat_thread_participants")
        .insert(participantes);

      if (partError) throw partError;

      // 3) Crear primer mensaje
      const { data: mensaje, error: msgError } = await supabase
        .from("chat_messages")
        .insert({
          thread_id: thread.id,
          sender_id: currentUserId,
          contenido: contenidoNuevo.trim(),
          tipo: "texto",
        })
        .select()
        .single();

      if (msgError) throw msgError;

      // Actualizar UI
      setThreads((prev) => [thread, ...prev]);
      setSelectedThread(thread);
      setMessages([mensaje]);

      // Limpiar formulario
      setTituloNuevo("");
      setContenidoNuevo("");
      setUrgencia("normal");
      setSendToAll(true);
      setDestinatariosSeleccionados([]);

      toast.success(t("send"));
    } catch (err) {
      console.error("Error creando conversación:", err);
      toast.error(err.message || "Error creando conversación");
    }
  };

    // =========================
    // Eliminar conversación completa
    // =========================
    const handleDeleteThread = async () => {
      if (!selectedThread?.id) return;
      const ok = window.confirm(t("confirm_delete_thread") || "¿Eliminar la conversación completa y todos sus mensajes?");
      if (!ok) return;

      const threadId = selectedThread.id;

      try {
        // 1) Obtener ids de mensajes del hilo
        const { data: mensajes, error: msgSelError } = await supabase
          .from("chat_messages")
          .select("id")
          .eq("thread_id", threadId);

        if (msgSelError) throw msgSelError;

        const messageIds = (mensajes || []).map((m) => m.id);

        // 2) Eliminar estados de lectura
        if (messageIds.length > 0) {
          const { error: rsError } = await supabase
            .from("chat_message_read_status")
            .delete()
            .in("message_id", messageIds);
          if (rsError) throw rsError;
        }

        // 3) Eliminar mensajes
        const { error: delMsgError } = await supabase
          .from("chat_messages")
          .delete()
          .eq("thread_id", threadId);
        if (delMsgError) throw delMsgError;

        // 4) Eliminar participantes
        const { error: partError } = await supabase
          .from("chat_thread_participants")
          .delete()
          .eq("thread_id", threadId);
        if (partError) throw partError;

        // 5) Eliminar hilo
        const { error: threadError } = await supabase
          .from("chat_threads")
          .delete()
          .eq("id", threadId);
        if (threadError) throw threadError;

        // Actualizar UI
        setThreads((prev) => prev.filter((th) => th.id !== threadId));
        setSelectedThread(null);
        setMessages([]);

        toast.success(
          t("thread_deleted") || "Conversación eliminada correctamente"
        );
      } catch (err) {
        console.error("Error eliminando conversación:", err);
        toast.error(
          err.message || "Error eliminando la conversación"
        );
      }
    };

  // =========================
  // Enviar respuesta en thread actual
  // =========================
  const handleSendReply = async () => {
    if (!selectedThread?.id) return;
    if (!replyText.trim()) return;
    if (!currentUserId) {
      toast.error("Usuario no autenticado");
      return;
    }

    try {
      const { data, error } = await supabase
        .from("chat_messages")
        .insert({
          thread_id: selectedThread.id,
          sender_id: currentUserId,
          contenido: replyText.trim(),
          tipo: "texto",
        })
        .select()
        .single();

      if (error) throw error;

      setMessages((prev) => [...prev, data]);
      setReplyText("");

            // Marcamos como leído de nuevo (para este mensaje también)
            const { error: readError2 } = await supabase.rpc(
              "mark_thread_as_read",
              { p_thread_id: selectedThread.id }
            );
            if (readError2) {
              console.warn("mark_thread_as_read error:", readError2.message);
            }
          } catch (err) {
            console.error("Error enviando mensaje:", err);
            toast.error(err.message || "Error enviando mensaje");
          }
  };

  // =========================
  // Render
  // =========================

  const handleThreadClick = (thread) => {
    setSelectedThread(thread);
  };

  return (
    <div className="page-container page-container--fluid">
      <div className="card" style={{ maxWidth: 1200, margin: "0 auto" }}>
        <h2>{t("communications")}</h2>

                {/* ================= NUEVO MENSAJE ================= */}
                <div
                  style={{
                    border: "1px solid #ddd",
                    borderRadius: 12,
                    padding: 12,
                    marginBottom: 16,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <h3 style={{ marginTop: 0, marginBottom: 4 }}>
                    {t("new_message")}
                  </h3>

                  {/* Título */}
                  <DSInput
                    placeholder={t("message_title")}
                    value={tituloNuevo}
                    onChange={(e) => setTituloNuevo(e.target.value)}
                    style={{ marginBottom: 4 }}
                  />

                  {/* Contenido */}
                  <TextAreaStyle
                    placeholder={t("message_body")}
                    value={contenidoNuevo}
                    onChange={(e) => setContenidoNuevo(e.target.value)}
                    rows={4}
                    style={{
                      minHeight: 90,
                      marginBottom: 4,
                    }}
                  />

                  {/* Fila inferior: destinatarios + urgencia + botón */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1.4fr) auto",
                      columnGap: 12,
                      rowGap: 8,
                      alignItems: "flex-end",
                    }}
                  >
                    {/* Destinatarios */}
                    <div>
                      <label
                        style={{
                          fontSize: 18,
                          fontWeight: 600,
                          display: "block",
                          marginBottom: 4,
                        }}
                      >
                        {t("recipients")}
                      </label>

                      <div style={{ marginBottom: 4 }}>
                        <label
                          style={{
                            fontSize: 14,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            whiteSpace: "nowrap",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={sendToAll}
                            onChange={(e) => setSendToAll(e.target.checked)}
                          />
                          {t("all_users")}
                        </label>
                      </div>

                      {!sendToAll && (
                        <DSSelect
                          isMulti
                          options={operadoresOptions}
                          value={destinatariosSeleccionados}
                          onChange={(vals) =>
                            setDestinatariosSeleccionados(vals || [])
                          }
                          placeholder={t("recipients")}
                          styles={{
                            container: (base) => ({
                              ...base,
                              width: "100%",
                            }),
                          }}
                        />
                      )}
                    </div>

                    {/* Urgencia */}
                    <div>
                      <label
                        style={{
                          fontStyle: "bold",
                          fontSize: 18,
                          fontWeight: 600,
                          display: "block",
                          marginBottom: 4,
                        }}
                      >
                        {t("urgent_level")}
                      </label>
                      <div style={{ display: "flex", gap: 8 }}>
                        <BtnSecondary
                          type="button"
                          onClick={() => setUrgencia("normal")}
                          style={{
                            flex: 1,
                            borderWidth: urgencia === "normal" ? 2 : 1,
                            borderColor:
                              urgencia === "normal" ? "#099414ff" : "#ccc",
                          }}
                        >
                          {t("normal")}
                        </BtnSecondary>
                        <BtnSecondary
                          type="button"
                          onClick={() => setUrgencia("urgent")}
                          style={{
                            flex: 1,
                            borderWidth: urgencia === "urgent" ? 2 : 1,
                            borderColor:
                              urgencia === "urgent" ? "#c00000ff" : "#ccc",
                          }}
                        >
                          {t("urgent")}
                        </BtnSecondary>
                      </div>
                    </div>

                    {/* Botón enviar */}
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <BtnPrimary
                        onClick={handleCreateThread}
                        style={{
                          minWidth: 170,
                          justifyContent: "center",
                        }}
                      >
                        {t("send")}
                      </BtnPrimary>
                    </div>
                  </div>
                </div>

        {/* ================= LISTA DE THREADS + CHAT ================= */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 2fr)",
            gap: 12,
            minHeight: 360,
          }}
        >
          {/* Lista de conversaciones */}
          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 8,
              overflowY: "auto",
              maxHeight: "70vh",
            }}
          >
            <h3 style={{ marginTop: 0 }}>{t("threads")}</h3>
            {loadingThreads && (
              <p style={{ fontSize: 13 }}>{t("loading")}...</p>
            )}
            {!loadingThreads && threads.length === 0 && (
              <p style={{ fontSize: 13, color: "#666" }}>
                {t("no_threads")}
              </p>
            )}

            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
              }}
            >
              {threads.map((th) => {
                const selected = selectedThread?.id === th.id;
                return (
                  <li
                    key={th.id}
                    onClick={() => handleThreadClick(th)}
                    style={{
                      padding: 8,
                      marginBottom: 4,
                      borderRadius: 8,
                      border: selected
                        ? "2px solid #111"
                        : "1px solid #eee",
                      cursor: "pointer",
                      backgroundColor: th.es_urgente
                        ? "#ffebee"
                        : "#fafafa",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        marginBottom: 2,
                      }}
                    >
                      {th.titulo || "(sin título)"}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "#777",
                      }}
                    >
                      {th.tipo} · {formatDateTime(th.created_at)}
                    </div>
                    {th.es_urgente && (
                      <div
                        style={{
                          fontSize: 10,
                          color: "#b71c1c",
                          fontWeight: 600,
                          marginTop: 2,
                        }}
                      >
                        {t("urgent")}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Chat del thread seleccionado */}
          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 8,
              display: "flex",
              flexDirection: "column",
              maxHeight: "70vh",
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 8 }}>
              {t("messages")}{" "}
              {selectedThread?.titulo
                ? `- ${selectedThread.titulo}`
                : ""}
            </h3>

            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: 6,
                borderRadius: 8,
                backgroundColor: "#fafafa",
              }}
            >
              {loadingMessages && (
                <p style={{ fontSize: 13 }}>{t("loading")}...</p>
              )}

              {!loadingMessages &&
                messages.map((m) => {
                  const isMine = m.sender_id === currentUserId;
                  return (
                    <div
                      key={m.id}
                      style={{
                        marginBottom: 8,
                        display: "flex",
                        justifyContent: isMine
                          ? "flex-end"
                          : "flex-start",
                      }}
                    >
                      <div
                        style={{
                          maxWidth: "70%",
                          borderRadius: 10,
                          padding: 8,
                          fontSize: 13,
                          backgroundColor: isMine ? "#000" : "#fff",
                          color: isMine ? "#fff" : "#000",
                          border: "1px solid #ddd",
                          boxShadow:
                            "0 1px 3px rgba(0,0,0,0.1)",
                        }}
                      >
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            marginBottom: 2,
                            opacity: 0.8,
                          }}
                        >
                          {getUserName(m.sender_id)}
                        </div>
                        <div
                          style={{
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {m.contenido}
                        </div>
                        <div
                          style={{
                            fontSize: 10,
                            marginTop: 4,
                            textAlign: "right",
                            opacity: 0.7,
                          }}
                        >
                          {formatDateTime(m.created_at)}
                        </div>
                      </div>
                    </div>
                  );
                })}

              {!loadingMessages && !messages.length && (
                <p
                  style={{
                    fontSize: 13,
                    color: "#777",
                    marginTop: 8,
                  }}
                >
                  {selectedThread
                    ? t("no_data")
                    : t("no_threads")}
                </p>
              )}
            </div>

            {/* Caja de respuesta */}
            {selectedThread && (
              <div
                style={{
                  marginTop: 8,
                  borderTop: "1px solid #eee",
                  paddingTop: 6,
                }}
              >
                <TextAreaStyle
                  placeholder={t("type_message")}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  rows={2}
                  style={{
                    minHeight: 60,
                    marginBottom: 6,
                  }}
                />
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  {/* Botón eliminar conversación */}
                  <BtnDanger
                    type="button"
                    onClick={handleDeleteThread}
                     style={{
                      minWidth: 170,
                      justifyContent: "center",
                    }}
                  >
                    {t("delete_conversation") || "Eliminar conversación"}
                  </BtnDanger>

                  {/* Botón responder */}
                  <BtnPrimary
                    onClick={handleSendReply}
                    style={{
                      minWidth: 170,
                      justifyContent: "center",
                    }}
                  >
                    {t("send_to_all_in_thread")}
                  </BtnPrimary>
                </div>
              </div>
            )}
          </div>
        </div>
        <ToastContainer position="top-center" autoClose={1500} />
      </div>
    </div>
  );
}
