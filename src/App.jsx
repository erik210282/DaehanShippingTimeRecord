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
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

// Escucha global de chat para toda la app
const GlobalChatListener = () => {
  const { t } = useTranslation();
  const currentUserIdRef = useRef(null);

  // Mantener actualizado el uid del usuario actual
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

  useEffect(() => {
    let canal = null;

    const iniciarCanal = () => {
      // Evitamos duplicados limpiando antes si existe
      if (canal) supabase.removeChannel(canal);

      canal = supabase
        .channel("chat_global_app_listener") // Nombre único para no chocar con Comunicaciones
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "chat_messages" },
          async (payload) => {
            const nuevo = payload.new;
            const esMio = nuevo?.sender_id === currentUserIdRef.current;

            // 1) Actualizar badge (contador)
            const { data, error } = await supabase.rpc("count_unread_messages_for_user");
            if (!error && typeof data === "number") {
              window.dispatchEvent(new CustomEvent("unread-chat-updated", { detail: data }));
            }

            // 2) Toast urgente (Solo si NO es mi mensaje y es urgente)
            if (!esMio) {
              const { data: thread } = await supabase
                .from("chat_threads")
                .select("es_urgente")
                .eq("id", nuevo.thread_id)
                .single();

              if (thread?.es_urgente) {
                const { data: remitente } = await supabase
                  .from("operadores")
                  .select("nombre")
                  .eq("uid", nuevo.sender_id)
                  .single();
                
                const nombre = remitente?.nombre || "Usuario";
                
                // Disparamos el toast (ahora funcionará porque agregaremos el Container global)
                toast.error(`🔥 ${t("urgent_message_arrived_from", { name: nombre })}`, {
                  autoClose: 4000,
                  position: "top-center",
                });
              }
            }
          }
        )
        .subscribe();
    };

    iniciarCanal();

    // Cleanup: Solo al cerrar la app completa
    return () => {
      if (canal) supabase.removeChannel(canal);
    };
  }, []); // <--- ARRAY VACÍO: Esto evita el bucle infinito. Se ejecuta 1 sola vez.

  return null;
};

const Navbar = () => {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [user, setUser] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);

  // 🔹 2) Sesión / usuario actual: mantiene currentUserIdRef actualizado
  useEffect(() => {
    const obtenerSesion = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      setUser(session?.user || null);
    };

    obtenerSesion();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user || null);
      }
    );

    return () => {
      authListener?.subscription?.unsubscribe?.();
    };
  }, []);

  // 🔹 3) Cargar conteo inicial de mensajes no leídos
  useEffect(() => {
    const cargarUnreadInicial = async () => {
      try {
        const { data, error } = await supabase.rpc(
          "count_unread_messages_for_user"
        );
        if (!error && typeof data === "number") {
          setUnreadCount(data);
        } else if (error) {
          console.error("Error cargando unread inicial:", error.message);
        }
      } catch (err) {
        console.error("Error inesperado en unread inicial:", err);
      }
    };

    cargarUnreadInicial();
  }, []);

  // 🔹 4) Escuchar evento global desde Comunicaciones
  useEffect(() => {
    const handler = (ev) => {
      if (typeof ev.detail === "number") {
        setUnreadCount(ev.detail);
      }
    };

    window.addEventListener("unread-chat-updated", handler);
    return () => {
      window.removeEventListener("unread-chat-updated", handler);
    };
  }, []);

  if (!user) return null;

  const handleLanguageChange = (e) => {
    i18n.changeLanguage(e.target.value);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  return (
    <div className="navbar">
      <div className="navbar-center">
        <button onClick={() => navigate("/tareas-pendientes")}>
          {t("pending_tasks")}
        </button>
        <button onClick={() => navigate("/resumen")}>
          {t("summary")}
        </button>
        <button onClick={() => navigate("/registros")}>
          {t("records")}
        </button>
        <button onClick={() => navigate("/generarbol")}>
          {t("generate_bol")}
        </button>
        <button onClick={() => navigate("/comunicaciones")}>
          {t("communications")}
          {unreadCount > 0 && (
            <span
              style={{
                marginLeft: 6,
                background: "#e53935",
                color: "#fff",
                borderRadius: 999,
                padding: "0 6px",
                fontSize: 11,
                minWidth: 16,
                textAlign: "center",
                display: "inline-block",
              }}
            > 
              {unreadCount}
            </span>
          )}
        </button>
        <button onClick={() => navigate("/productividad")}>
          {t("productivity")}
        </button>
        <button onClick={() => navigate("/catalogos")}>
          {t("catalogs")}
        </button>
        <button onClick={() => navigate("/usuarios")}>
          {t("users")}
        </button>
        <button onClick={handleLogout}>{t("logout")}</button>
      </div>
      <LanguageBar />
    </div>
  );
};

const PrivateArea = () => (
  <RequireSupervisor>
    <div className="app-container">
      <Navbar />
      <div className="content">
        <Routes>
          <Route path="/tareas-pendientes" element={
            <ProtectedRoute><TareasPendientes /></ProtectedRoute>
          } />
          <Route path="/resumen" element={
            <ProtectedRoute><Resumen /></ProtectedRoute>
          } />
          <Route path="/registros" element={
            <ProtectedRoute><Registros /></ProtectedRoute>
          } />
          <Route path="/generarbol" element={
            <ProtectedRoute><GenerarBOL /></ProtectedRoute>
          } />
          <Route path="/comunicaciones" element={
            <ProtectedRoute><Comunicaciones /></ProtectedRoute>
          } />
          <Route path="/productividad" element={
            <ProtectedRoute><Productividad /></ProtectedRoute>
          } />
          <Route path="/catalogos" element={
            <ProtectedRoute><Catalogos /></ProtectedRoute>
          } />
          <Route path="/usuarios" element={
            <ProtectedRoute><Usuarios /></ProtectedRoute>
          } />
          <Route path="/configuracion-tareas" element={
            <ProtectedRoute><ConfiguracionTareas /></ProtectedRoute>
          } />
        </Routes>
      </div>
    </div>
  </RequireSupervisor>
);

const AppContent = () => (
  <div className="app-root">
    <GlobalChatListener />
    <ToastContainer position="top-center" autoClose={2000} limit={3} />
    <Routes>
      {/* Login público */}
      <Route path="/" element={<Login />} />
      {/* Área privada */}
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
