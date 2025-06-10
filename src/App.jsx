import React from "react";
import { BrowserRouter as Router, Routes, Route, useNavigate } from "react-router-dom";
import Registros from "./pages/Registros";
import Productividad from "./pages/Productividad";
import Catalogos from "./pages/Catalogos";
import Usuarios from "./pages/Usuarios";
import Login from "./pages/Login";
import TareasPendientes from "./pages/TareasPendientes";
import ConfiguracionTareas from "./pages/ConfiguracionTareas";
import { useTranslation } from "react-i18next";
import "./App.css";
import ProtectedRoute from "./components/ProtectedRoute";
import { useEffect, useState } from "react";
import supabase from "./supabase/client";

const Navbar = () => {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [user, setUser] = useState(null);

  useEffect(() => {
    const session = supabase.auth.session();  // Usar la sesión activa
    setUser(session?.user);

    // Suscribirse a cambios de estado de sesión en Supabase
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user);
    });

    // Limpiar el listener al desmontar
    return () => {
      authListener?.unsubscribe();
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
        <button onClick={() => navigate("/registros")}>{t("records")}</button>
        <button onClick={() => navigate("/productividad")}>{t("productivity")}</button>
        <button onClick={() => navigate("/catalogos")}>{t("catalogs")}</button>
        <button onClick={() => navigate("/usuarios")}>{t("users")}</button>
        <button onClick={handleLogout}>{t("logout")}</button>
      </div>

      <div className="navbar-right">
        <select onChange={handleLanguageChange} value={i18n.language}>
          <option value="es">🇲🇽 Español</option>
          <option value="en">🇺🇸 English</option>
        </select>
      </div>
    </div>
  );
};

const AppContent = () => (
  <div className="app-container">
    <Navbar />
    <div className="content">
      <Routes>
        <Route path="/" element={<Login />} />

        <Route path="/tareas-pendientes" element={
          <ProtectedRoute><TareasPendientes /></ProtectedRoute>
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
);

const App = () => (
  <Router>
    <AppContent />
  </Router>
);

export default App;
