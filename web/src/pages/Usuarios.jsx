import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import "../App.css";

const apiBase = "https://daehanshippingbackend.onrender.com";

export default function Usuarios() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [usuarios, setUsuarios] = useState([]);
  const [mensaje, setMensaje] = useState("");
  const [nuevosPasswords, setNuevosPasswords] = useState({});

  useEffect(() => {
    cargarUsuarios();
  }, []);

  const crearUsuario = async () => {
    if (!email || !password) {
      setMensaje(t("error_user_creation"));
      return;
    }

    try {
      const response = await fetch(`${apiBase}/create-user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (response.ok) {
        setMensaje(t("success_user_created"));
        setEmail("");
        setPassword("");
        cargarUsuarios();
      } else {
        const data = await response.json();
        setMensaje(`${t("error_user_creation")}: ${data.error}`);
      }
    } catch (e) {
      setMensaje(t("network_error"));
    }
  };

  const cargarUsuarios = async () => {
    try {
      const response = await fetch(`${apiBase}/list-users`);
      const data = await response.json();
      setUsuarios(data.users || []);
    } catch {
      setMensaje(t("network_error"));
    }
  };

  const actualizarPassword = async (uid) => {
    const nuevoPassword = nuevosPasswords[uid] || "";
    if (!nuevoPassword) {
      setMensaje(t("enter_new_password"));
      return;
    }

    try {
      const response = await fetch(`${apiBase}/update-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid, password: nuevoPassword }),
      });

      if (response.ok) {
        setMensaje(t("success_password_updated"));
        setNuevosPasswords((prev) => ({ ...prev, [uid]: "" }));
      } else {
        setMensaje(t("error_password_update"));
      }
    } catch {
      setMensaje(t("network_error"));
    }
  };

  const eliminarUsuario = async (uid) => {
    if (!window.confirm(t("confirm_delete_user"))) return;

    try {
      await fetch(`${apiBase}/delete-user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid }),
      });
      cargarUsuarios();
      setMensaje(t("user_deleted"));
    } catch {
      setMensaje(t("network_error"));
    }
  };

  return (
    <div className="card">
      <h2>{t("user_management")}</h2>

      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        <input
          type="email"
          placeholder={t("email")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password"
          placeholder={t("password")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button className="primary" onClick={crearUsuario}>
          {t("create_user")}
        </button>
        <button className="secondary" onClick={cargarUsuarios}>
          {t("show_users")}
        </button>
      </div>

      {mensaje && <p style={{ marginTop: "1rem", color: "#007bff" }}>{mensaje}</p>}

      {usuarios.length > 0 && (
        <div style={{ marginTop: "1.5rem", overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>{t("email")}</th>
                <th>{t("user_id")}</th>
                <th>{t("new_password")}</th>
                <th>{t("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => (
                <tr key={u.uid}>
                  <td>{u.email}</td>
                  <td>{u.uid}</td>
                  <td>
                    <input
                      type="password"
                      value={nuevosPasswords[u.uid] || ""}
                      onChange={(e) =>
                        setNuevosPasswords((prev) => ({
                          ...prev,
                          [u.uid]: e.target.value,
                        }))
                      }
                      placeholder={t("new_password")}
                    />
                  </td>
                  <td>
                    <button className="edit-btn" onClick={() => actualizarPassword(u.uid)}>
                      {t("update_password")}
                    </button>
                    <button className="delete-btn" onClick={() => eliminarUsuario(u.uid)}>
                      {t("delete_user")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
