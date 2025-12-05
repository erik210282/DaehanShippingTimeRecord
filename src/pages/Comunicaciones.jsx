// src/pages/Comunicaciones.jsx
import React, { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../supabase/client";
import {
  DSInput,
  DSSelect,
  BtnPrimary,
  BtnSecondary,
  TextAreaStyle,
  BtnDanger,
  BtnToggleUrgent,
} from "../components/controls";
import { toast } from "react-toastify";
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
  const [sendToAll, setSendToAll] = useState(false);
  const [destinatariosSeleccionados, setDestinatariosSeleccionados] = useState([]);

  // Hilos y mensajes
  const [threads, setThreads] = useState([]);
  const [selectedThread, setSelectedThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const selectedThreadIdRef = useRef(null);
  const [replyText, setReplyText] = useState("");
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // Hilos que tienen mensajes nuevos sin leer (solo para indicador visual)
  // { [threadId]: true/false }
  const [threadUnread, setThreadUnread] = useState({});
  // Referencias a canales y timers de reconexión
  const canalMensajesRef = useRef(null);
  const canalThreadsRef = useRef(null);

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
  
  // Notificar al Navbar que cambió el número de mensajes no leídos
  const notificarUnreadNavbar = useCallback(async () => {
    const { data, error } = await supabase.rpc(
      "count_unread_messages_for_user"
    );
    if (!error && typeof data === "number") {
      window.dispatchEvent(
        new CustomEvent("unread-chat-updated", { detail: data })
      );
    }
  }, []);

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

    // Cargar threads SOLO del usuario actual (con TODOS los participantes)
    // =========================
    const cargarThreads = useCallback(
      async (userId) => {
        if (!userId) return; // aún no tenemos el usuario

        try {
          setLoadingThreads(true);

          // 1) Obtener los hilos donde participa el usuario actual
          const { data: misParticipaciones, error: partError } = await supabase
            .from("chat_thread_participants")
            .select("thread_id")
            .eq("user_id", userId);

          if (partError) throw partError;

          const threadIds = Array.from(
            new Set((misParticipaciones || []).map((p) => p.thread_id))
          );

          if (!threadIds.length) {
            setThreads([]);
            return;
          }

          // 2) Traer los hilos con TODOS sus participantes
          const { data, error } = await supabase
            .from("chat_threads")
            .select(
              `
                id,
                tipo,
                titulo,
                es_urgente,
                created_at,
                creado_por,
                chat_thread_participants(user_id)
              `
            )
            .in("id", threadIds)
            .order("created_at", { ascending: false });

          if (error) throw error;

          const threadsFiltrados = (data || []).map(
            ({ chat_thread_participants, ...rest }) => ({
              ...rest,
              participantes: (chat_thread_participants || []).map(
                (p) => p.user_id
              ),
            })
          );

          setThreads(threadsFiltrados);
        } catch (err) {
          console.error("Error cargando threads:", err);
          toast.error(
            (t("error_loading") || "Error cargando hilos") +
              ": " +
              (err.message || "")
          );
        } finally {
          setLoadingThreads(false);
        }
      },
      [t]
    );

    // =========================
    // NUEVO: Cargar estado de "No leídos" desde la BD
    // =========================
    useEffect(() => {
      const verificarNoLeidosIniciales = async () => {
        // Si no hay hilos cargados o no hay usuario, no hacemos nada
        if (!threads.length || !currentUserId) return;

        try {
          // 1. Obtener IDs de los hilos que se están mostrando
          const threadIds = threads.map((t) => t.id);

          // 2. Traer todos los mensajes de esos hilos que NO fueron enviados por mí
          // (Esto es necesario porque la lógica de "no leído" es: existe mensaje ajeno y no está en mi tabla de leídos)
          const { data: mensajesEntrantes, error: errorMsg } = await supabase
            .from("chat_messages")
            .select("id, thread_id")
            .in("thread_id", threadIds)
            .neq("sender_id", currentUserId);

          if (errorMsg) throw errorMsg;
          if (!mensajesEntrantes || mensajesEntrantes.length === 0) return;

          // 3. Obtener la lista de mensajes que YA he leído (de la tabla chat_message_read_status)
          const messageIds = mensajesEntrantes.map((m) => m.id);
          const { data: leidos, error: errorLeidos } = await supabase
            .from("chat_message_read_status")
            .select("message_id")
            .eq("user_id", currentUserId)
            .in("message_id", messageIds);

          if (errorLeidos) throw errorLeidos;

          // Crear un Set para búsqueda rápida de mensajes leídos
          const leidosSet = new Set(leidos?.map((l) => l.message_id));

          // 4. Calcular qué hilos tienen al menos un mensaje que NO está en el set de leídos
          const hilosConNoLeidos = {};
          mensajesEntrantes.forEach((m) => {
            if (!leidosSet.has(m.id)) {
              // Si el mensaje no está en mis leídos, marco el hilo con punto rojo
              hilosConNoLeidos[m.thread_id] = true;
            }
          });

          // 5. Actualizar el estado visual
          setThreadUnread((prev) => ({ ...prev, ...hilosConNoLeidos }));
          
        } catch (err) {
          console.error("Error verificando no leídos:", err);
        }
      };

      verificarNoLeidosIniciales();
      // Se ejecuta cada vez que 'threads' cambia (ej. carga inicial o llega mensaje nuevo y recarga la lista)
    }, [threads, currentUserId]);

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

          // Marcar como leído en BD
          const { error: readError } = await supabase.rpc(
            "mark_thread_as_read",
            { p_thread_id: threadId }
          );
          if (readError) {
            console.warn("mark_thread_as_read error:", readError.message);
          } else {
            // ✅ Quitar indicador de "nuevo" en este hilo
            setThreadUnread((prev) => ({
              ...prev,
              [threadId]: false,
            }));

            // ✅ Actualizar badge del navbar sin F5
            await notificarUnreadNavbar();
          }
        } catch (err) {
          console.error("Error cargando mensajes:", err);
          toast.error(
            (t("error_loading") || "Error cargando mensajes") +
              ": " +
              (err.message || "")
          );
        } finally {
          setLoadingMessages(false);
        }
      },
      [t, notificarUnreadNavbar]
    );

    // =========================
    // Inicialización: operadores + threads
    // =========================
    useEffect(() => {
      if (!currentUserId) return;
      cargarOperadores();
      cargarThreads(currentUserId);
    }, [currentUserId, cargarOperadores, cargarThreads]);

    // Cargar mensajes cuando cambie el thread seleccionado
    useEffect(() => {
      if (selectedThread?.id) {
        cargarMensajesThread(selectedThread.id);
      } else {
        setMessages([]);
      }
    }, [selectedThread, cargarMensajesThread]);

    useEffect(() => {
      selectedThreadIdRef.current = selectedThread?.id || null;
    }, [selectedThread]);

    // =========================
    // Realtime: mensajes nuevos / nuevos hilos (con reconexión)
    // =========================
    useEffect(() => {
      if (!currentUserId) return;
      console.log("🔗 Realtime Comunicaciones — creando canales...");

      const crearCanalMensajes = () => {
        // Si ya había un canal, lo removemos antes de crear otro
        if (canalMensajesRef.current) {
          supabase.removeChannel(canalMensajesRef.current);
          canalMensajesRef.current = null;
        }

        const canal = supabase
          .channel("comms_chat_mensajes")
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "chat_messages" },
            async (payload) => {
              const nuevo = payload.new;
              // 1. Determinar si el mensaje es relevante para mostrar punto rojo
              // Si no lo envié yo Y no tengo ese hilo abierto ahora mismo:
              const esMio = nuevo.sender_id === currentUserId;
              const estoyViendoEsteHilo = selectedThreadIdRef.current === nuevo.thread_id;

              if (!esMio && !estoyViendoEsteHilo) {
                // ACTIVAR EL PUNTO ROJO para este hilo
                setThreadUnread((prev) => ({
                  ...prev,
                  [nuevo.thread_id]: true,
                }));
              }

              // 2. Si tengo el hilo abierto, agrego el mensaje en vivo y marco leído
              if (estoyViendoEsteHilo) {
                setMessages((prev) => [...prev, nuevo]);
                
                // Marcar como leído inmediatamente en BD para que no quede pendiente
                await supabase.rpc("mark_thread_as_read", { p_thread_id: nuevo.thread_id });
              }

              // 3. Recargar la lista de threads para actualizar el orden (último mensaje arriba)
              // Nota: Esto también ayuda a que si es un hilo nuevo, aparezca en la lista.
              cargarThreads(currentUserId);
              
              // 4. Actualizar el contador global del Navbar (opcional, por seguridad)
              notificarUnreadNavbar();
            }
          )
          .subscribe((status) => {
            console.log("📶 Estado canal comms_chat_mensajes:", status);
            // Sin reintentos manuales; Supabase se encarga de reconectar
          });
        canalMensajesRef.current = canal;
      };

      const crearCanalThreads = () => {
        if (canalThreadsRef.current) {
          supabase.removeChannel(canalThreadsRef.current);
          canalThreadsRef.current = null;
        }

        const canal = supabase
          .channel("comms_chat_threads")
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "chat_threads" },
            () => {
              cargarThreads(currentUserId);
            }
          )
          .subscribe((status) => {
            console.log("📶 Estado canal comms_chat_threads:", status);
            // Sin reintentos manuales
          });
        canalThreadsRef.current = canal;
      };

      // Crear canales al montar
      crearCanalMensajes();
      crearCanalThreads();

      // Cleanup SOLO al salir de la página
      return () => {
        console.log("🧹 Cleanup Comunicaciones: removiendo canales");
        if (canalMensajesRef.current) {
          supabase.removeChannel(canalMensajesRef.current);
          canalMensajesRef.current = null;
        }
        if (canalThreadsRef.current) {
          supabase.removeChannel(canalThreadsRef.current);
          canalThreadsRef.current = null;
        }
      };
    }, [currentUserId, cargarThreads, cargarMensajesThread, setThreadUnread]);

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
        setSelectedThread(thread);
        await cargarThreads(currentUserId);

        // Limpiar formulario
        setTituloNuevo("");
        setContenidoNuevo("");
        setUrgencia("normal");
        setSendToAll(false);
        setDestinatariosSeleccionados([]);

        toast.success(t("sent"));
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
      <div className="card">
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
                      width: "100%",
                      maxWidth: "100%",
                      boxSizing: "border-box", 
                    }}
                  />

                  {/* Fila inferior: destinatarios + prioridad + botón */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 2fr)",
                      columnGap: 12,
                      rowGap: 8,
                      alignItems: "flex-start",
                    }}
                  >
                    {/* Destinatarios */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          
                      {/* Fila: label + checkbox */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 20,
                        }}
                      >
                        {/* Label Recipients */}
                        <label
                          style={{
                            fontSize: 18,
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {t("recipients")}
                        </label>

                        {/* Checkbox All users */}
                        <label
                          style={{
                            fontSize: 15,
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

                      {/* Select debajo */}
                      {!sendToAll && (
                        <DSSelect
                          isMulti
                          options={operadoresOptions}
                          value={destinatariosSeleccionados}
                          onChange={(vals) => setDestinatariosSeleccionados(vals || [])}
                          placeholder={t("recipients")}
                        />
                      )}
                    </div>
                    
                    {/* Prioridad / Urgencia */}
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      <label
                        style={{
                          fontSize: 18,
                          fontWeight: 600,
                          display: "block",
                          marginBottom: 4,
                        }}
                      >
                        {t("priority")}
                      </label>

                      <div
                        style={{
                          display: "flex",
                          gap: 10,
                          alignItems: "center",
                        }}
                      >
                        <BtnToggleUrgent
                          type="button"
                          onClick={() =>
                            setUrgencia((prev) =>
                              prev === "urgent" ? "normal" : "urgent"
                            )
                          }
                          style={{
                            width: 170,
                            height: 38,
                            lineHeight: "38px",
                            borderStyle: "solid",
                            borderWidth: 2,
                            borderColor:
                              urgencia === "urgent" ? "#c00000ff" : "#ffffff",
                            boxShadow:
                              urgencia === "urgent"
                                ? "0 0 0 4px rgba(253, 0, 0, 0.9)"
                                : "none",
                          }}
                        >
                          {t("urgent")}
                        </BtnToggleUrgent>

                        <BtnPrimary
                          onClick={handleCreateThread}
                          style={{
                            width: 170,
                            height: 38,
                            justifyContent: "center",
                          }}
                        >
                          {t("send")}
                        </BtnPrimary>
                      </div>
                    </div>
                  </div>
                </div>

        {/* ================= LISTA DE THREADS + CHAT ================= */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "20% 80%",
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
                const hasNew = threadUnread[th.id];
                const destinatarios = (th.participantes || []).filter(
                  (uid) => uid !== th.creado_por
                );
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
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          marginBottom: 2,
                        }}
                      >
                        {th.titulo || t("notitle")}
                      </div>

                      {hasNew && (
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            backgroundColor: "#d32f2f",
                          }}
                        />
                      )}
                    </div>

                    {/* Remitente y destinatarios */}
                    <div style={{ fontSize: 12, color: "#444", marginBottom: 2 }}>
                      <span style={{ fontWeight: "bold" }}>De: </span>
                      {getUserName(th.creado_por)}
                    </div>

                    <div style={{ fontSize: 12, color: "#444", marginBottom: 2 }}>
                      <span style={{ fontWeight: "bold" }}>Para: </span>
                      {destinatarios.length
                        ? destinatarios.map((uid) => getUserName(uid)).join(", ")
                        : "—"}
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
              backgroundColor: !selectedThread ? "#f9f9f9" : "transparent"
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
      </div>
    </div>
  );
}
