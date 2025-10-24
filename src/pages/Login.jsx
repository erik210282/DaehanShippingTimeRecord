import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import "../App.css";
import logo from "../assets/Daehan.png";
import { supabase } from "../supabase/client";


export default function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");

    try {
        const { data, error: loginError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (loginError) {
          throw loginError;
        }

        localStorage.setItem("usuario", JSON.stringify(data.user));

        navigate("/tareas-pendientes");
      } catch (err) {
        console.error("Login error:", err.message);
        setError(t("login_error")); // Muestra el mensaje de error traducido
      }
    };

  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100vw",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        overflow: "hidden",
        backgroundColor: "#f9f9f9",
      }}
    >
      <div
        style={{
          maxWidth: "400px",
          width: "100%",
          backgroundColor: "white",
          padding: "2rem",
          borderRadius: "8px",
          boxShadow: "0 4px 8px rgba(0, 0, 0, 0.1)",
        }}
      >
        {/* Logotipo */}
        <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
          <img src={logo} alt="Logo" style={{ width: "150px" }} />
        </div>

        <h2 style={{ textAlign: "center", marginBottom: "1.5rem" }}>{t("login")}</h2>

        <form onSubmit={handleLogin} autoComplete="on">
          <label>{t("email")}</label>
            <input
              type="email"
              name="email"
              autoComplete="new-email"
              placeholder={t("email")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "10px",
                marginBottom: "1rem",
                borderRadius: "4px",
                border: "1px solid #ccc",
              }}
            />


          <label>{t("password")}</label>
            <input
              type="password"
              name="password"
              autoComplete="new-password"
              placeholder={t("password")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "10px",
                marginBottom: "1rem",
                borderRadius: "4px",
                border: "1px solid #ccc",
              }}
            />

          <button
              type="submit"
              className="primary"
              style={{
                width: "100%",
                padding: "12px",
                backgroundColor: "#007bff",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                marginTop: "1rem",
              }}
            >
              {t("submit")}
            </button>

          {error && (
            <p
              style={{
                color: "red",
                marginTop: "1rem",
                textAlign: "center",
              }}
            >
              {error}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
