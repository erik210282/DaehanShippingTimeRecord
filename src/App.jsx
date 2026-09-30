import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from "react-router-dom";
import Registros from "./pages/Registros";
import Productividad from "./pages/Productividad";
import Catalogos from "./pages/Catalogos";
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
import LanguageBar from "./components/LanguageBar";
import DepartmentNav from "./components/DepartmentNav";
import logo from "./assets/Daehan.png";
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
const Navbar = () => {
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

  const shipping = !['/inicio', '/global-settings', '/announcements', '/inventarios', '/catalogos', '/usuarios'].includes(location.pathname) && !location.pathname.startsWith('/departamento/');

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  const shippingItems = [['/tareas-pendientes','pending_tasks'],['/resumen','summary'],['/registros','records'],['/generarbol','generate_bol'],['/comunicaciones','communications'],['/productividad','productivity'],['/catalogos','catalogs']].map(([key,label])=>({key,label:t(label),badge:key==='/comunicaciones'?unreadCount:0}));
  return <>
    <header className="navbar app-header">
      <div className="app-header-left">{location.pathname !== '/inicio' && <button className="app-header-button" onClick={() => navigate('/inicio')}>{t('global_back')}</button>}
        <div className="app-brand"><img src={logo} alt="Daehan"/><strong>DAEHAN APP</strong></div>
      </div>
      <div className="app-header-right"><button className="app-header-button" onClick={handleLogout}>{t('logout')}</button><LanguageBar /></div>
    </header>
    {shipping && <div className="app-department-nav"><DepartmentNav items={shippingItems} value={location.pathname} onChange={navigate} label={t('global_shipping')}/></div>}
  </>;
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
  const returnPath = useRef(location.pathname === '/announcements' ? (()=>{try{return sessionStorage.getItem('announcement-return') || '/inicio';}catch{return '/inicio';}})() : location.pathname + location.search);
  if (access.loading) return <div className="global-loading">Cargando…</div>;
  if (access.error) return <div className="global-loading" role="alert">{access.error}</div>;
  if (!announcements.ready) return <div className="global-loading">{t('loading')}…</div>;
  if (announcements.error && !announcements.items.length) return <div className="global-loading" role="alert">{announcements.error}<button onClick={announcements.load}>{t('global_retry')}</button></div>;
  if (announcements.gate && location.pathname !== '/announcements') {
    returnPath.current = location.pathname + location.search;
    try { sessionStorage.setItem('announcement-return', returnPath.current); } catch {}
    return <Navigate to="/announcements" replace />;
  }
  const canManageSettings = access.admin || access.supervisor;
  const isGlobalRoute = ['/inicio', '/global-settings', '/announcements', '/inventarios', '/catalogos', '/usuarios'].includes(location.pathname) || location.pathname.startsWith('/departamento/');
  if (!isGlobalRoute && !access.admin && !access.memberships.some(m => m.department === 'shipping')) return <Navigate to="/inicio" replace />;
  const portal = <>
    <div className="app-container">
      <Navbar />
      <div className="content">
        <Routes>
          <Route path="/inicio" element={<GlobalHome access={access} />} />
          <Route path="/global-settings" element={canManageSettings ? <GlobalSettings access={access} /> : <Navigate to="/inicio" replace />} />
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
          <Route path="/catalogos" element={access.admin || access.memberships.length ? <Catalogos access={access}/> : <Navigate to="/inicio" replace/>} />
          <Route path="/usuarios" element={<Navigate to="/global-settings" replace />} />
          <Route path="/configuracion-tareas" element={<ProtectedRoute><ConfiguracionTareas /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/inicio" replace />} />
        </Routes>
      </div>
    </div>
    {announcements.notice && !announcements.gate && <AnnouncementNotice onOpen={() => { returnPath.current = location.pathname + location.search;
    try { sessionStorage.setItem('announcement-return', returnPath.current); } catch {} announcements.open(); navigate('/announcements'); }} />}
  </>;
  return portal;
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
