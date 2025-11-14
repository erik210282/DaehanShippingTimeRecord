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
    const op = operadores.find((o) => o.id === userId);
    if (op) return op.nombre;
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
  // Cargar operadores (destinatarios)
  // =========================
  const cargarOperadores = useCallback(async () => {
    const { data, error } = await supabase
      .from("operadores")
      .select("id, nombre, activo")
      .order("nombre", { ascending: true });

    if (error) {
      console.error("Error cargando operadores:", error);
      toast.error(t("error_loading") || "Error cargando operadores");
      return;
    }

    const activos =
      data?.filter((op) => op.activo !== false) ?? [];

    setOperadores(activos);

    const opts = activos.map((op) => ({
      value: op.id,
      label: op.nombre,
    }));
    setOperadoresOptions(opts);
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
        .select("id, tipo, titulo, es_urgente, creado_en")
        .order("creado_en", { ascending: false });

      if (error) throw error;

      setThreads(data || []);

      if (!selectedThread && data && data.length > 0) {
        setSelectedThread(data[0]);
      }
    } catch (err) {
      console.error("Error cargando threads:", err);
      toast.error(t("error_loading") || "Error cargando hilos");
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
          .select("id, thread_id, sender_id, contenido, tipo, creado_en")
          .eq("thread_id", threadId)
          .order("creado_en", { ascending: true });

        if (error) throw error;

        setMessages(data || []);

        // Marcar como leído usando RPC
        await supabase
          .rpc("mark_thread_as_read", { p_thread_id: threadId })
          .catch((err) =>
            console.warn("mark_thread_as_read error:", err.message)
          );
      } catch (err) {
        console.error("Error cargando mensajes:", err);
        toast.error(t("error_loading") || "Error cargando mensajes");
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
        (payload) => {
          const nuevo = payload.new;
          // Si es del thread seleccionado, lo agregamos
          setMessages((prev) => {
            if (!selectedThread || nuevo.thread_id !== selectedThread.id) {
              return prev;
            }
            // Evitar duplicados
            if (prev.some((m) => m.id === nuevo.id)) return prev;
            return [...prev, nuevo];
          });
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
        (payload) => {
          const nuevoThread = payload.new;
          setThreads((prev) => {
            if (prev.some((t) => t.id === nuevoThread.id)) return prev;
            return [nuevoThread, ...prev];
          });
        }
      )
      .subscribe((status) => {
        console.log("📶 Estado canal chat_threads_web:", status);
      });

    return () => {
      supabase.removeChannel(canalMensajes);
      supabase.removeChannel(canalThreads);
    };
  }, [selectedThread]);

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
        destinatariosIds = operadores.map((op) => op.id);
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
      await supabase
        .rpc("mark_thread_as_read", {
          p_thread_id: selectedThread.id,
        })
        .catch(() => {});
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
                          fontSize: 15,
                          fontWeight: 600,
                          display: "block",
                          marginBottom: 4,
                        }}
                      >
                        {t("recipients")}
                      </label>

                      <div style={{ marginBottom: 4 }}>
                        <text
                          style={{
                            fontSize: 12,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <text
                            type="checkbox"
                            checked={sendToAll}
                            onChange={(e) => setSendToAll(e.target.checked)}
                          />
                          {t("all_users")}
                        </text>
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
                          fontSize: 13,
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
                              urgencia === "normal" ? "#b71c1c" : "#ccc",
                            backgroundColor:
                              urgencia === "normal" ? "#415024ff" : undefined,
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
                              urgencia === "urgent" ? "#b71c1c" : "#ccc",
                            backgroundColor:
                              urgencia === "urgent" ? "#415024ff" : undefined,
                          }}
                        >
                          {t("urgent")}
                        </BtnSecondary>
                      </div>
                    </div>

                    {/* Botón enviar */}
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <BtnPrimary onClick={handleCreateThread}>
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
                      {th.tipo} · {formatDateTime(th.creado_en)}
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
                          {formatDateTime(m.creado_en)}
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
                  onChange={(e) =>
                    setReplyText(e.target.value)
                  }
                  rows={2}
                  style={{
                    minHeight: 60,
                    marginBottom: 6,
                  }}
                />
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                  }}
                >
                  <BtnPrimary onClick={handleSendReply}>
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
