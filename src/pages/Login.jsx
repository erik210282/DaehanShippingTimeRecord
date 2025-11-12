import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { supabase } from "../supabase/client";
import logo from "../assets/Daehan.png";

export default function Login() {
  const { t } = useTranslation();
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
        .from("profiles")
        .select("role, is_active, display_name")
        .eq("id", data.user.id)
        .maybeSingle();

      if (pErr) {
        toast.error(t("error") || "Ocurrió un error");
        return;
      }
      if (profile && profile.is_active === false) {
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
      toast.success(t("welcome_user", { name: profile?.display_name ?? "" }) || "¡Bienvenido!");
      navigate("/tareas-pendientes");
    } catch (err) {
      console.error(err);
      toast.error(t("error") || "Ocurrió un error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <img className="login-logo" src={logo} alt="DAEHAN" />

      <div className="login-card">
        <h2 className="login-title">{t("title") || "Sign In"}</h2>

        <form onSubmit={handleLogin} autoComplete="on">
          <label className="login-label">
            {t("email") || "Email"}
          </label>
          <input
            className="login-input"
            type="email"
            name="email"
            autoComplete="email"
            placeholder={t("email_placeholder") || "Email"}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <label className="login-label">
            {t("password") || "Password"}
          </label>
          <input
            className="login-input"
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder={t("password_placeholder") || "Password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <button className="login-btn" type="submit" disabled={busy}>
            {busy ? (t("loading") || "Cargando...") : (t("signIn") || "Sign In")}
          </button>
        </form>
      </div>

      <ToastContainer position="top-center" autoClose={1200} />
    </div>
  );
}
