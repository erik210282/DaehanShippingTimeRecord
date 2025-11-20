import React, { useEffect, useState } from 'react';
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { supabase } from "../supabase/client";
import logo from "../assets/Daehan.png";
import LanguageBar from "../components/LanguageBar";
import { DSInput, BtnPrimary } from "../components/controls";

export default function Login() {
  const { t, i18n } = useTranslation();

  useEffect(() => {
    try {
      const saved = localStorage.getItem('lang');
      const lang = saved || i18n.language || 'es';
      if (lang && i18n.language !== lang) {
        i18n.changeLanguage(lang);
      }
    } catch {
    }
  }, [i18n]);

  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error(t("missingFields") || "Faltan campos");
      return;
    }

    try {
      setBusy(true);
      const normalizedEmail = email.trim().toLowerCase();

      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (error || !data?.user) {
        toast.error(t("invalidCredentials") || "Correo o contraseña inválidos");
        return;
      }

      // Validación de perfil como en móvil (opcional)
      const { data: profile, error: pErr } = await supabase
        .from("operadores")
        .select("role, activo, nombre")
        .eq("uid", data.user.id)   // uid en operadores = id en auth.users
        .maybeSingle();

      if (pErr) {
        toast.error(t("error") || "Ocurrió un error");
        return;
      }

      if (profile && profile.activo === false) {
        toast.error(t("notActive") || "Tu usuario no está activo");
        await supabase.auth.signOut();
        return;
      }

      // Si existe registro y está inactivo, bloquear
      if (profile && profile.activo === false) {
        toast.error(t("notActive") || "Tu usuario no está activo");
        await supabase.auth.signOut();
        return;
      }
      const allowedRoles = ["operador", "supervisor"];
      if (profile && !allowedRoles.includes(profile.role)) {
        toast.error(t("wrongRole") || "No tienes permisos para entrar");
        await supabase.auth.signOut();
        return;
      }

      localStorage.setItem("usuario", JSON.stringify(data.user));
      toast.success(t("welcome_user", { name: profile?.nombre ?? "" }) || "¡Bienvenido!");
      navigate("/tareas-pendientes");
    } catch (err) {
      toast.error(t("error") || "Ocurrió un error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <LanguageBar fixedTopRight />

      <img className="login-logo" src={logo} alt="DAEHAN" />

      <div className="login-card">
        <h2 className="login-title">{t("title") || "Sign In"}</h2>
        <form onSubmit={handleLogin} autoComplete="on">
          <label className="login-label">{t("email") || "Email"}</label>
          <DSInput
            type="email"
            name="email"
            autoComplete="email"
            placeholder={t("email_placeholder") || "Email"}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <label className="login-label">{t("password") || "Password"}</label>
          <DSInput
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder={t("password_placeholder") || "Password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <BtnPrimary type="submit" disabled={busy} style={{ width: "100%", marginTop: 12 }}>
            {busy ? (t("loading") || "Cargando...") : (t("signIn") || "Sign In")}
          </BtnPrimary>
        </form>
      </div>
      <ToastContainer position="top-center" autoClose={1200} />
    </div>
  );
}
