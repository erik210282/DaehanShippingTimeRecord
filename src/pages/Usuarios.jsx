import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import "../App.css";

const API_URL = "https://daehanshippingbackend.onrender.com";
const API_KEY = "clave-super-secreta-$hipping*2025*";

export default function Usuarios() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [usuarios, setUsuarios] = useState([]);
  const [mostrarUsuarios, setMostrarUsuarios] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [nuevosPasswords, setNuevosPasswords] = useState({});
  const [cargando, setCargando] = useState(false);

  const usuarioLogueado = JSON.parse(localStorage.getItem("usuario"));

  const crearUsuario = async () => {
    if (!email || !password) {
      setMensaje(t("error_user_creation"));
      return;
    }

    try {
      const res = await fetch(`${API_URL}/create-user`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": API_KEY,
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setMensaje(t("success_user_created"));
      setEmail("");
      setPassword("");
      if (mostrarUsuarios) cargarUsuarios();
    } catch (error) {
      setMensaje(`${t("error_user_creation")}: ${error.message}`);
    }
  };

  const cargarUsuarios = async () => {
    setCargando(true);
    try {
      const res = await fetch(`${API_URL}/list-users`, {
        headers: { "x-api-key": API_KEY },
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const lista = (data.users || []).filter(
        (u) => u.email !== usuarioLogueado?.email
      );

      setUsuarios(lista);
    } catch (error) {
      setMensaje(t("network_error"));
    } finally {
      setCargando(false);
    }
  };

  const actualizarPassword = async (uid) => {
    const nuevoPassword = nuevosPasswords[uid] || "";
    if (!nuevoPassword) {
      setMensaje(t("enter_new_password"));
      return;
    }

    try {
      const res = await fetch(`${API_URL}/update-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": API_KEY,
        },
        body: JSON.stringify({ uid, password: nuevoPassword }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setMensaje(t("success_password_updated"));
      setNuevosPasswords((prev) => ({ ...prev, [uid]: "" }));
    } catch (error) {
      setMensaje(t("error_password_update"));
    }
  };

  const eliminarUsuario = async (uid) => {
    if (!window.confirm(t("confirm_delete_user"))) return;

    try {
      const res = await fetch(`${API_URL}/delete-user`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": API_KEY,
        },
        body: JSON.stringify({ uid }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setMensaje(t("user_deleted"));
      cargarUsuarios();
    } catch (error) {
      setMensaje(t("error_deleting_user"));
    }
  };

  const alternarMostrarUsuarios = () => {
    if (!mostrarUsuarios) cargarUsuarios();
    setMostrarUsuarios(!mostrarUsuarios);
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
        <button className="secondary" onClick={alternarMostrarUsuarios}>
          {mostrarUsuarios ? t("hide_users") : t("show_users")}
        </button>
      </div>

      {mensaje && <p style={{ marginTop: "1rem", color: "#007bff" }}>{mensaje}</p>}
      {cargando && <p>{t("loading")}...</p>}

      {mostrarUsuarios && usuarios.length > 0 && (
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
