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
import { GlobalHome, DepartmentLanding, useGlobalAccess } from './GlobalPortal';
import GlobalSettings from './GlobalSettings';
import SetPassword from './SetPassword';
import { AnnouncementNotice, GlobalAnnouncements, useAnnouncementGate } from './GlobalAnnouncements';
import { useParams, Navigate } from 'react-router-dom';
import Inventarios from './pages/Inventarios';
import Receiving from './pages/Receiving';
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
const Navbar = ({ access, onAnnouncements }) => {
  const navigate = useNavigate();
  const location = useLocation();
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

  const shipping = !['/inicio', '/global-settings', '/announcements', '/inventarios'].includes(location.pathname) && !location.pathname.startsWith('/departamento/');

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  return (
    <div className="navbar">
      <div className="navbar-center">
        {access.admin || access.supervisor ? (location.pathname !== '/inicio' && location.pathname !== '/inventarios' && <button onClick={() => navigate('/inicio')}>{t('global_back')}</button>) : null}
        {shipping && <>
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
        </>}
        {location.pathname !== '/inicio' && location.pathname !== '/announcements' && <button onClick={onAnnouncements}>{t('global_announcements')}</button>}
        <button onClick={handleLogout}>{t("logout")}</button>
      </div>
      <LanguageBar />
    </div>
  );
};

// --- CONFIGURACIÓN DE RUTAS ---
function DepartmentRoute({ access }) {
  const { name } = useParams();
  if (name === 'receiving') return <Receiving access={access} />;
  return <DepartmentLanding name={name} access={access} />;
}

const PrivateArea = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const access = useGlobalAccess();
  const location = useLocation();
  const announcements = useAnnouncementGate(access.userId);
  const returnPath = useRef(location.pathname);
  if (access.loading) return <div className="global-loading">Cargando…</div>;
  if (access.error) return <div className="global-loading" role="alert">{access.error}</div>;
  if (!announcements.ready) return <div className="global-loading">{t('loading')}…</div>;
  if (announcements.error && !announcements.items.length) return <div className="global-loading" role="alert">{announcements.error}<button onClick={announcements.load}>{t('global_retry')}</button></div>;
  if (announcements.gate && location.pathname !== '/announcements') {
    returnPath.current = location.pathname;
    return <Navigate to="/announcements" replace />;
  }
  const canSeeHome = access.admin || access.supervisor;
  const firstDepartment = access.memberships.find(m => m.department === 'shipping')?.department || access.memberships[0]?.department;
  if (!canSeeHome && location.pathname === '/inicio') {
    if (!firstDepartment) return <div className="global-loading">{t('global_no_access')}</div>;
    return <Navigate to={firstDepartment === 'shipping' ? '/tareas-pendientes' : `/departamento/${firstDepartment}`} replace />;
  }
  const isGlobalRoute = ['/inicio', '/global-settings', '/announcements', '/inventarios'].includes(location.pathname) || location.pathname.startsWith('/departamento/');
  if (!isGlobalRoute && !access.admin && !access.memberships.some(m => m.department === 'shipping')) return <Navigate to="/inicio" replace />;
  const portal = <>
    <div className="app-container">
      <Navbar access={access} onAnnouncements={() => { if (announcements.pending.length) { returnPath.current = location.pathname; announcements.open(); } navigate('/announcements'); }} />
      <div className="content">
        <Routes>
          <Route path="/inicio" element={<GlobalHome access={access} />} />
          <Route path="/global-settings" element={canSeeHome ? <GlobalSettings access={access} /> : <Navigate to="/inicio" replace />} />
          <Route path="/announcements" element={<GlobalAnnouncements access={access} announcements={announcements} onContinue={announcements.acknowledge} onBack={() => navigate(returnPath.current === '/announcements' ? '/inicio' : returnPath.current || '/inicio', { replace: true })} />} />
          <Route path="/departamento/:name" element={<DepartmentRoute access={access} />} />
          <Route path="/inventarios" element={access.admin || access.memberships.some(m => ['inventory', 'shipping', 'production', 'receiving', 'quality'].includes(m.department))
            ? <Inventarios access={access} /> : <Navigate to="/inicio" replace />} />
          <Route path="/tareas-pendientes" element={<ProtectedRoute><TareasPendientes /></ProtectedRoute>} />
          <Route path="/resumen" element={<ProtectedRoute><Resumen /></ProtectedRoute>} />
          <Route path="/registros" element={<ProtectedRoute><Registros /></ProtectedRoute>} />
          <Route path="/generarbol" element={<ProtectedRoute><GenerarBOL /></ProtectedRoute>} />
          <Route path="/comunicaciones" element={<ProtectedRoute><Comunicaciones /></ProtectedRoute>} />
          <Route path="/productividad" element={<ProtectedRoute><Productividad /></ProtectedRoute>} />
          <Route path="/catalogos" element={<ProtectedRoute><Catalogos /></ProtectedRoute>} />
          <Route path="/usuarios" element={<ProtectedRoute><Usuarios /></ProtectedRoute>} />
          <Route path="/configuracion-tareas" element={<ProtectedRoute><ConfiguracionTareas /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/inicio" replace />} />
        </Routes>
      </div>
    </div>
    {announcements.notice && !announcements.gate && <AnnouncementNotice onOpen={() => { returnPath.current = location.pathname; announcements.open(); navigate('/announcements'); }} />}
  </>;
  return isGlobalRoute || canSeeHome ? portal : <RequireSupervisor>{portal}</RequireSupervisor>;
};

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
      <Route path="/set-password" element={<SetPassword />} />
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
