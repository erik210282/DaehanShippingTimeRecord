import React from "react";
import { BrowserRouter as Router, Routes, Route, useNavigate } from "react-router-dom";
import Registros from "./pages/Registros";
import Productividad from "./pages/Productividad";
import Catalogos from "./pages/Catalogos";
import Usuarios from "./pages/Usuarios";
import Login from "./pages/Login";
import TareasPendientes from "./pages/TareasPendientes"; // Nueva página de tareas pendientes
import TareasOperario from "./pages/TareasOperario"; // Nueva página de tareas para el operario
import ConfiguracionTareas from "./pages/ConfiguracionTareas"; // Página de configuración de tareas
import { useTranslation } from "react-i18next";
import "./App.css";

const Navbar = () => {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  const handleLanguageChange = (e) => {
    i18n.changeLanguage(e.target.value);
  };

  const handleLogout = () => {
    localStorage.removeItem("usuario");
    navigate("/");
  };

  return (
    <div className="navbar">
      <div className="navbar-left">
        <button onClick={() => navigate("/tareas-pendientes")}>{t("pending_tasks")}</button> {/* Nueva opción de navegación */}
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
        <Route path="/tareas-pendientes" element={<TareasPendientes />} /> {/* Ruta de tareas pendientes */}
        <Route path="/registros" element={<Registros />} />
        <Route path="/productividad" element={<Productividad />} />
        <Route path="/catalogos" element={<Catalogos />} />
        <Route path="/usuarios" element={<Usuarios />} />
        <Route path="/tareas-operario" element={<TareasOperario />} /> {/* Ruta para tareas operarios */}
        <Route path="/configuracion-tareas" element={<ConfiguracionTareas />} /> {/* Ruta de configuración de tareas */}
        <Route path="/" element={<Login />} />
      </Routes>
    </div>
  </div>
);

const App = () => {
  return (
    <Router>
      <AppContent />
    </Router>
  );
};

export default App;
