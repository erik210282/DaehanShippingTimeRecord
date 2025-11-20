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
import { toast } from "react-toastify";

const Navbar = () => {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [user, setUser] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const canalChatGlobalRef = useRef(null);
  const currentUserIdRef = useRef(null);
  const retryGlobalRef = useRef(null);

    // Canal global de chat: se crea UNA sola vez cuando hay usuario
    useEffect(() => {
      if (!user) {
        // Si no hay usuario (todavía o después de logout), limpiamos el canal si existiera
        console.log("🧹 Navbar: no hay usuario, limpiando canal global");
        if (canalChatGlobalRef.current) {
          supabase.removeChannel(canalChatGlobalRef.current);
          canalChatGlobalRef.current = null;
        }
        return;
      }

      // Si el canal ya existe, no lo volvemos a crear
      if (canalChatGlobalRef.current) {
        console.log("✅ Navbar: canal chat_global_web ya existe, no se crea otro");
        return;
      }

      console.log("🌐 Navbar: creando canal global chat_global_web...");

      const canal = supabase
        .channel("chat_global_web")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "chat_messages" },
          async (payload) => {
            try {
              console.log("Nuevo mensaje (global):", payload);

              const nuevo = payload.new;
              const senderId = nuevo?.sender_id || null;
              const esMio = senderId && senderId === currentUserIdRef.current;

              // 1) Recalcular mensajes no leídos para el badge del navbar
              const { data, error } = await supabase.rpc(
                "count_unread_messages_for_user"
              );
              if (!error && typeof data === "number") {
                setUnreadCount(data);
              } else if (error) {
                console.error("Error contando mensajes no leídos:", error);
              }

              // 2) Toast URGENTE solo si NO es mi mensaje
              const threadId = nuevo.thread_id;
              const { data: thread, error: threadError } = await supabase
                .from("chat_threads")
                .select("titulo, es_urgente")
                .eq("id", threadId)
                .single();

              if (!threadError && thread?.es_urgente && !esMio) {
                const { data: remitente, error: senderError } = await supabase
                  .from("operadores")
                  .select("nombre")
                  .eq("uid", nuevo.sender_id)
                  .single();

                const nombreRemitente = remitente?.nombre || "Unknown user";

                toast.error(
                  `🔥 ${t("urgent_message_arrived_from", {
                    name: nombreRemitente,
                  })}`,
                  {
                    autoClose: 3000,
                    closeOnClick: true,
                    pauseOnHover: true,
                    position: "top-center",
                  }
                );
              }
            } catch (err) {
              console.error("Error en listener global de chat:", err);
            }
          }
        )
        .subscribe((status) => {
          console.log("Estado canal chat_global_web:", status);
          // ❗ ya NO hacemos reconexión manual aquí
        });

      canalChatGlobalRef.current = canal;

      // Cleanup SOLO si se desmonta completamente el Navbar (raro en tu app)
      return () => {
        console.log("🧹 Cleanup Navbar: removiendo canal chat_global_web");
        if (canalChatGlobalRef.current) {
          supabase.removeChannel(canalChatGlobalRef.current);
          canalChatGlobalRef.current = null;
        }
      };
    }, [user, t]);
  // 2) Sesión / usuario actual
  useEffect(() => {
    const obtenerSesion = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      setUser(session?.user);
      currentUserIdRef.current = session?.user?.id || null; 
    };

    obtenerSesion();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user);
        currentUserIdRef.current = session?.user?.id || null; 
      }
    );
    return () => {
      authListener?.subscription?.unsubscribe?.();
    };
  }, []);

  // 3) Cargar conteo inicial de mensajes no leídos
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

   // 3) ESCUCHAR el evento global que mandamos desde Comunicaciones
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
    // Limpiar canal global y timers ANTES de salir
    if (retryGlobalRef.current) {
      clearTimeout(retryGlobalRef.current);
      retryGlobalRef.current = null;
    }
    if (canalChatGlobalRef.current) {
      supabase.removeChannel(canalChatGlobalRef.current);
      canalChatGlobalRef.current = null;
    }

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
        <button onClick={() => navigate("/productividad")}>{t("productivity")}</button>
        <button onClick={() => navigate("/catalogos")}>{t("catalogs")}</button>
        <button onClick={() => navigate("/usuarios")}>{t("users")}</button>
        <button onClick={handleLogout}>{t("logout")}</button>
      </div>
      <LanguageBar />
    </div>
  );
};

// 1) Área privada protegida por rol supervisor
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

// 2) Contenedor de rutas públicas/privadas
const AppContent = () => (
  <div className="app-root">
    <Routes>
      {/* Login público: NO va dentro de RequireSupervisor */}
      <Route path="/" element={<Login />} />

      {/* Todo lo demás cae en el área privada protegida */}
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
