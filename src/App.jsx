import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from "react-router-dom";
import Registros from "./pages/Registros";
import Productividad from "./pages/Productividad";
import Catalogos from "./pages/Catalogos";
import Usuarios from "./pages/Usuarios";
import Login from "./pages/Login";
import Resumen from "./pages/Resumen";
import GenerarBOL from "./pages/GenerarBOL";
import Comunicaciones from "./pages/Comunicaciones";
import TareasPendientes from "./pages/TareasPendientes";
import ConfiguracionTareas from "./pages/ConfiguracionTareas";
import { useTranslation } from "react-i18next";
import "./App.css";
import ProtectedRoute from "./components/ProtectedRoute";
import React, { useEffect, useState, useRef } from "react";
import { supabase } from "./supabase/client";
import RequireSupervisor from "./components/RequireSupervisor";
import LanguageBar from "./components/LanguageBar";
// IMPORTANTE: El ToastContainer y CSS SOLO deben estar aquí en App.jsx
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

// --- GLOBAL CHAT LISTENER (VERSIÓN SIMPLIFICADA Y ROBUSTA) ---
const GlobalChatListener = () => {
  const { t } = useTranslation();
  const currentUserIdRef = useRef(null);

  // 1. Mantener ID de usuario actualizado
  useEffect(() => {
    const obtenerSesion = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      currentUserIdRef.current = session?.user?.id || null;
    };
    obtenerSesion();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        currentUserIdRef.current = session?.user?.id || null;
      }
    );
    return () => { authListener?.subscription?.unsubscribe?.(); };
  }, []);

  // 2. Suscripción ÚNICA y persistente
  useEffect(() => {
    const recalcularUnread = async () => {
      try {
        const { data, error } = await supabase.rpc(
          "count_unread_messages_for_user"
        );
        if (!error && typeof data === "number") {
          window.dispatchEvent(
            new CustomEvent("unread-chat-updated", { detail: data })
          );
        }
      } catch (err) {
      }
    };

    const canal = supabase
      .channel("global_chat_alerts") // Nombre fijo
      // A) CUALQUIER cambio en chat_messages
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_messages" },
        async (payload) => {
          const nuevo = payload.new;
          const myId = currentUserIdRef.current;

          // Siempre recalculamos badge (INSERT/UPDATE/DELETE)
          await recalcularUnread();

          // Solo mostramos toast en INSERT
          if (payload.eventType !== "INSERT") return;
          if (!nuevo) return;

          // Si yo lo envié, no hago nada
          if (nuevo.sender_id === myId) return;

          // B) MOSTRAR TOAST (solo si es urgente y soy participante)
          try {
            // Verificar que soy parte del hilo
            const { data: participacion } = await supabase
              .from("chat_thread_participants")
              .select("id")
              .eq("thread_id", nuevo.thread_id)
              .eq("user_id", myId)
              .maybeSingle();

            if (!participacion) return;

            // Verificar urgencia del hilo
            const { data: thread } = await supabase
              .from("chat_threads")
              .select("es_urgente")
              .eq("id", nuevo.thread_id)
              .single();

            if (!thread?.es_urgente) return;

            // Nombre del remitente
            const { data: remitente } = await supabase
              .from("operadores")
              .select("nombre")
              .eq("uid", nuevo.sender_id)
              .single();

            const nombre = remitente?.nombre || "Sistema";

            toast.error(`🔥 ${t("urgent_message_arrived_from", { name: nombre })}`, {
              position: "top-center",
              theme: "colored",
              autoClose: 1500,
            });
          } catch (err) {
          }
        }
      )
      // B) Cualquier cambio en chat_message_read_status → recalcular badge
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_message_read_status" },
        async () => {
          await recalcularUnread();
        }
      )
      // C) Cualquier cambio en chat_threads (incluye DELETE) → recalcular badge
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_threads" },
        async () => {
          await recalcularUnread();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
    };
  }, []); // Solo una vez al entrar a la App

  return null;
};
// --- NAVBAR ---
const Navbar = () => {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [user, setUser] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const obtenerSesion = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user || null);
    };
    obtenerSesion();
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });
    return () => authListener?.subscription?.unsubscribe?.();
  }, []);

  // Cargar valor inicial del badge
  useEffect(() => {
    const cargarUnreadInicial = async () => {
      try {
        const { data, error } = await supabase.rpc("count_unread_messages_for_user");
        if (error) {
          return;
        }
        const valor = Number(data) || 0;
        setUnreadCount(valor);
      } catch (err) { 
      }
    };
    cargarUnreadInicial();
  }, []);

  // Escuchar cambios desde cualquier parte de la app
  useEffect(() => {
    const handler = (ev) => {
      const valor = Number(ev.detail) || 0;
      setUnreadCount(valor);
    };
    window.addEventListener("unread-chat-updated", handler);
    return () => window.removeEventListener("unread-chat-updated", handler);
  }, []);

  if (!user) return null;

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  return (
    <div className="navbar">
      <div className="navbar-center">
        <button onClick={() => navigate("/tareas-pendientes")}>{t("pending_tasks")}</button>
        <button onClick={() => navigate("/resumen")}>{t("summary")}</button>
        <button onClick={() => navigate("/registros")}>{t("records")}</button>
        <button onClick={() => navigate("/generarbol")}>{t("generate_bol")}</button>
        
        <button onClick={() => navigate("/comunicaciones")} style={{position: 'relative'}}>
          {t("communications")}
          {unreadCount > 0 && (
            <span style={{
              position: 'absolute',
              top: -5,
              right: -5,
              background: "#ff0000",
              color: "#fff",
              borderRadius: "50%",
              padding: "2px 6px",
              fontSize: "10px",
              fontWeight: "bold"
            }}> 
              {unreadCount}
            </span>
          )}
        </button>

        <button onClick={() => navigate("/productividad")}>{t("productivity")}</button>
        <button onClick={() => navigate("/catalogos")}>{t("catalogs")}</button>
        <button onClick={() => navigate("/usuarios")}>{t("users")}</button>
        <button onClick={handleLogout}>{t("logout")}</button>
      </div>
      <LanguageBar />
    </div>
  );
};

// --- CONFIGURACIÓN DE RUTAS ---
const PrivateArea = () => (
  <RequireSupervisor>
    <div className="app-container">
      <Navbar />
      <div className="content">
        <Routes>
          <Route path="/tareas-pendientes" element={<ProtectedRoute><TareasPendientes /></ProtectedRoute>} />
          <Route path="/resumen" element={<ProtectedRoute><Resumen /></ProtectedRoute>} />
          <Route path="/registros" element={<ProtectedRoute><Registros /></ProtectedRoute>} />
          <Route path="/generarbol" element={<ProtectedRoute><GenerarBOL /></ProtectedRoute>} />
          <Route path="/comunicaciones" element={<ProtectedRoute><Comunicaciones /></ProtectedRoute>} />
          <Route path="/productividad" element={<ProtectedRoute><Productividad /></ProtectedRoute>} />
          <Route path="/catalogos" element={<ProtectedRoute><Catalogos /></ProtectedRoute>} />
          <Route path="/usuarios" element={<ProtectedRoute><Usuarios /></ProtectedRoute>} />
          <Route path="/configuracion-tareas" element={<ProtectedRoute><ConfiguracionTareas /></ProtectedRoute>} />
        </Routes>
      </div>
    </div>
  </RequireSupervisor>
);

const AppContent = () => (
  <div className="app-root">
    {/* Listener Global INVISIBLE pero siempre activo */}
    <GlobalChatListener />
    
    {/* ÚNICO ToastContainer de toda la app */}
    <ToastContainer 
      position="top-center" 
      autoClose={2000} 
      limit={3} 
      newestOnTop={true}
      style={{ zIndex: 99999 }} // Asegura que se vea sobre todo
    />
    
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/*" element={<PrivateArea />} />
    </Routes>
  </div>
);

const App = () => (
  <Router>
    <AppContent />
  </Router>
);

export default App;