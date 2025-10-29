import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import { supabase } from "../supabase/client";
import logo from "../assets/Daehan.png"; // usa el que ya tienes en web

export default function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error(t("login.missingFields") || "Faltan campos");
      return;
    }

    try {
      setBusy(true);

      const normalizedEmail = email.trim().toLowerCase();
      const { data: signData, error: signError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (signError || !signData?.user) {
        toast.error(t("login.invalidCredentials") || "Correo o contraseña inválidos");
        return;
      }

      const user = signData.user;

      // Validaciones como en móvil: role / is_active
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role, is_active, display_name")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError) {
        toast.error(t("error") || "Ocurrió un error");
        return;
      }

      if (!profile?.is_active) {
        toast.error(t("login.notActive") || "Tu usuario no está activo");
        await supabase.auth.signOut();
        return;
      }

      const allowedRoles = ["operador", "supervisor"];
      if (!allowedRoles.includes(profile.role)) {
        toast.error(t("login.wrongRole") || "No tienes permisos para entrar");
        await supabase.auth.signOut();
        return;
      }

      // Guarda algo si lo necesitas; la navegación va al home de la app
      localStorage.setItem("usuario", JSON.stringify(user));
      toast.success(
        t("welcome_user", { name: profile?.display_name ?? "" }) || "¡Bienvenido!"
      );

      navigate("/tareas-pendientes");
    } catch (err) {
      console.error(err);
      toast.error(t("error") || "Ocurrió un error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100vw",
        backgroundColor: "#0B0F1A", // igual que móvil
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      {/* Logo grande, centrado */}
      <img
        src={logo}
        alt="DAEHAN"
        style={{
          width: "40vw",
          maxWidth: "420px",
          minWidth: "240px",
          marginBottom: "24px",
          filter: "drop-shadow(0 2px 2px rgba(0,0,0,0.4))",
        }}
      />

      {/* Tarjeta translúcida como en móvil */}
      <div
        style={{
          backgroundColor: "rgba(0,0,0,0.7)",
          width: "min(900px, 90vw)",
          borderRadius: "16px",
          padding: "24px",
          boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
        }}
      >
        <h2
          style={{
            color: "white",
            fontSize: "28px",
            fontWeight: 700,
            marginBottom: "24px",
            textAlign: "center",
          }}
        >
          {t("login.title") || t("login") || "Sign In"}
        </h2>

        <form onSubmit={handleLogin} autoComplete="on">
          <label style={{ color: "#A0AEC0", marginBottom: 8, display: "block" }}>
            {t("login.email") || t("email") || "Email"}
          </label>
          <input
            type="email"
            name="email"
            autoComplete="email"
            placeholder={t("login.email_placeholder") || t("email") || "Email"}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{
              color: "white",
              width: "100%",
              borderWidth: 1,
              borderColor: "#2D3748",
              borderStyle: "solid",
              borderRadius: 12,
              padding: "12px 14px",
              marginBottom: 16,
              backgroundColor: "rgba(0,0,0,0.4)",
              outline: "none",
            }}
          />

          <label style={{ color: "#A0AEC0", marginBottom: 8, display: "block" }}>
            {t("login.password") || t("password") || "Password"}
          </label>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder={t("login.password_placeholder") || t("password") || "Password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{
              color: "white",
              width: "100%",
              borderWidth: 1,
              borderColor: "#2D3748",
              borderStyle: "solid",
              borderRadius: 12,
              padding: "12px 14px",
              marginBottom: 24,
              backgroundColor: "rgba(0,0,0,0.4)",
              outline: "none",
            }}
          />

          <button
            type="submit"
            disabled={busy}
            style={{
              backgroundColor: "#2563EB",
              padding: "14px 16px",
              borderRadius: 12,
              width: "100%",
              color: "white",
              fontSize: 16,
              fontWeight: 600,
              border: "none",
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? (t("loading") || "Cargando...") : (t("login.signIn") || t("submit") || "Sign In")}
          </button>
        </form>
      </div>

      <ToastContainer position="top-center" autoClose={1200} />
    </div>
  );
}
