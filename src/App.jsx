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
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

// --- GLOBAL CHAT LISTENER (VERSIÓN DEFINITIVA Y REACTIVA) ---
const GlobalChatListener = () => {
  const { t } = useTranslation();
  const location = useLocation(); // Hook para detectar cambios de ruta
  
  // 🔑 CAMBIO CLAVE 1: Usar useState para que el ID sea reactivo
  const [currentUserId, setCurrentUserId] = useState(null); 
  
  const channelRef = useRef(null); // Para la limpieza segura

  // 1. MÓDULO DE AUTENTICACIÓN (Se ejecuta solo una vez al montar)
  // Este useEffect se encarga de cargar y mantener el currentUserId
  useEffect(() => {
    // Helper para actualizar el estado
    const updateUserId = (session) => {
        setCurrentUserId(session?.user?.id || null);
    };

    // a) Obtener sesión inicial de forma asíncrona
    const fetchSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      updateUserId(session);
    };
    fetchSession();

    // b) Escuchar cambios de sesión futuros (ej. login/logout)
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        updateUserId(session);
      }
    );
    return () => { authListener?.subscription?.unsubscribe?.(); };
  }, []); // Array vacío: Se ejecuta solo una vez al montar

  // 2. MÓDULO DE SUSCRIPCIÓN REALTIME 
  // Se ejecuta si cambia el ID de usuario o la ruta (resiliencia)
  useEffect(() => {
    console.log("🟢 Evaluando suscripción. ID:", currentUserId, "Ruta:", location.pathname);

    // 🔑 CLAVE 2: Guard Clause usando el estado (EVITA EL ERROR WebSocket is closed)
    if (!currentUserId) {
      console.log("🚫 Listener Global: ID no disponible, previniendo conexión WebSocket.");
      // Limpiamos cualquier canal residual (del intento anónimo fallido)
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      return; 
    }
    
    // Si llegamos aquí, currentUserId es válido. Iniciamos la conexión:
    const canal = supabase
      .channel("global_chat_alerts") 
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        async (payload) => {
          const nuevo = payload.new;
          const myId = currentUserId; // Usamos el estado reactivo

          // Si el mensaje lo envié yo, no hago nada (ni badge, ni toast)
          if (nuevo.sender_id === myId) return;

          // A) ACTUALIZAR BADGE:
          const { data, error } = await supabase.rpc("count_unread_messages_for_user");
          if (!error && typeof data === "number") {
            window.dispatchEvent(new CustomEvent("unread-chat-updated", { detail: data }));
          }

          // B) MOSTRAR TOAST (Si es urgente):
         /* try {
            const { data: toastData } = await supabase.rpc("get_toast_data_for_message", {
              p_message_id: nuevo.id, // O nuevo.thread_id si es más fácil
              p_user_id: myId,
            });

            if (toastData?.is_urgent) {
              const nombre = toastData.sender_name || "Sistema";
              toast.error(`🔥 ${t("urgent_message_arrived_from", { name: nombre })}`, {
                position: "top-center",
                theme: "colored",
                autoClose: 1500,
              });
            }
          } catch (err) {
            console.error("Error en alerta global unificada:", err);
          }
            */
        }
      )
      .subscribe((status) => {
         console.log(`📶 Estado Global (ID: ${currentUserId}):`, status);
      });

    channelRef.current = canal;

    return () => {
      console.log("🔴 Limpieza Global Listener: Removiendo canal...");
      // Esto limpia la suscripción ANTES de que se cree la nueva (al cambiar de ruta)
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
    
  // 🔑 CLAVE 3: Dependencia Reactiva (se re-ejecuta al cambiar ID o Ruta)
  }, [currentUserId, location.pathname]); 

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