import { BrowserRouter as Router, Routes, Route, useNavigate } from "react-router-dom";
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

// --- GLOBAL CHAT LISTENER (VERSIÓN ESTABLE) ---
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

  // 2. Conexión al socket
  useEffect(() => {
    // Definimos el canal fuera para poder limpiarlo
    const canal = supabase
      .channel("global_alerts_system") // Nombre único
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        async (payload) => {
          // Lógica de recepción
          const nuevo = payload.new;
          const esMio = nuevo?.sender_id === currentUserIdRef.current;

          // A) Actualizar Badge
          const { data, error } = await supabase.rpc("count_unread_messages_for_user");
          if (!error && typeof data === "number") {
            window.dispatchEvent(new CustomEvent("unread-chat-updated", { detail: data }));
          }

          // B) Mostrar Toast Urgente (Si no es mío)
          if (!esMio) {
            // Verificamos si el hilo es urgente
            const { data: thread } = await supabase
              .from("chat_threads")
              .select("es_urgente")
              .eq("id", nuevo.thread_id)
              .single();

            if (thread?.es_urgente) {
              // Obtenemos nombre del remitente
              const { data: remitente } = await supabase
                .from("operadores")
                .select("nombre")
                .eq("uid", nuevo.sender_id)
                .single();
              
              const nombre = remitente?.nombre || "Sistema";
              
              // Disparamos el toast GLOBAL
              toast.error(`🔥 ${t("urgent_message_arrived_from", { name: nombre })} - ${nuevo.contenido.substring(0, 30)}...`, {
                position: "top-center",
                autoClose: 2000,
                hideProgressBar: false,
                closeOnClick: true,
                pauseOnHover: true,
                draggable: true,
                theme: "colored",
              });
            }
          }
        }
      )
      .subscribe((status) => {
        // Log para depuración
        console.log(`📡 Estado del Chat Global: ${status}`);
      });

    // Cleanup: Solo se ejecuta al cerrar la app o recargar totalmente la página
    return () => {
      supabase.removeChannel(canal);
    };
  }, []); // ARRAY VACÍO: Se conecta una vez y se mantiene vivo siempre.

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

  useEffect(() => {
    const cargarUnreadInicial = async () => {
      try {
        const { data } = await supabase.rpc("count_unread_messages_for_user");
        if (typeof data === "number") setUnreadCount(data);
      } catch (err) { console.error(err); }
    };
    cargarUnreadInicial();
  }, []);

  useEffect(() => {
    const handler = (ev) => {
      if (typeof ev.detail === "number") setUnreadCount(ev.detail);
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