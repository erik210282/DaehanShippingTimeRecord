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
import React, { useEffect, useState } from "react";
import { supabase } from "./supabase/client";
import RequireSupervisor from "./components/RequireSupervisor";
import LanguageBar from "./components/LanguageBar";

const Navbar = () => {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [user, setUser] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const fetchUnread = async () => {
      const { data, error } = await supabase.rpc(
        "count_unread_messages_for_user"
      );
      if (!error && typeof data === "number") {
        setUnreadCount(data);
      } else if (error) {
        console.warn("Error contando mensajes no leídos:", error.message);
      }
    };

    fetchUnread();

    const channel = supabase
      .channel("navbar_unread_chat")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_messages" },
        () => fetchUnread()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_message_read_status",
        },
        () => fetchUnread()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);


  useEffect(() => {
    const obtenerSesion = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user);
    };

    obtenerSesion();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user);
    });

    return () => {
      authListener?.subscription?.unsubscribe?.(); // ✅ limpiar correctamente
    };
  }, []);

  if (!user) return null;

  const handleLanguageChange = (e) => {
    i18n.changeLanguage(e.target.value);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();  // Cerrar sesión con Supabase
    navigate("/");
  };

  return (
    <div className="navbar">
      <div className="navbar-center">
        <button onClick={() => navigate("/tareas-pendientes")}>{t("pending_tasks")}</button>
        <button onClick={() => navigate("/resumen")}>{t("summary")}</button>
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
        <button onClick={() => navigate("/registros")}>{t("records")}</button>
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
          <Route path="/generarbol" element={
            <ProtectedRoute><GenerarBOL /></ProtectedRoute>
          } />
          <Route path="/comunicaciones" element={
            <ProtectedRoute><Comunicaciones /></ProtectedRoute>
          } />
          <Route path="/registros" element={
            <ProtectedRoute><Registros /></ProtectedRoute>
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
