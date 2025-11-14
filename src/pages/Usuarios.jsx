import React, { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import "../App.css";
import { DSInput, DSNativeSelect, BtnPrimary, BtnSecondary, BtnEditDark, BtnDanger } from "../components/controls";

const API_URL = "https://daehanshippingbackend.onrender.com";
const API_KEY = "clave-super-secreta-$hipping*2025*";

export default function Usuarios() {
  const { t, i18n } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState(""); 
  const [isActive, setIsActive] = useState(true);
  const [usuarios, setUsuarios] = useState([]);
  const [mostrarUsuarios, setMostrarUsuarios] = useState(false);
  const [mensajeKey, setMensajeKey] = useState("");
  const [mensajeExtra, setMensajeExtra] = useState(""); // por si quieres mostrar detalles del error
  const [nuevosPasswords, setNuevosPasswords] = useState({});
  const [cargando, setCargando] = useState(false);

  const debugT = (key) => {
    const translated = t(key);
    console.log("[Usuarios.jsx] i18n lang:", i18n.language, "key:", key, "=>", translated);
    return translated;
  };

  const usuarioLogueado = JSON.parse(localStorage.getItem("usuario"));

  const ROLE_OPTIONS = useMemo(() => ([
    { value: 'operador',   label: t('role_operator') },
    { value: 'supervisor', label: t('role_supervisor') },
  ]), [t]);

  const crearUsuario = async () => {
    if (!email || !displayName || !password || !role) {
      setMensajeKey("error_user_creation");
      setMensajeExtra("");
      return;
    }

    try {
      const res = await fetch(`${API_URL}/create-user`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": API_KEY,
        },
        body: JSON.stringify({
          email,
          password,
          displayName,
          role,
          is_active: isActive,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setMensajeKey("success_user_created");
      setMensajeExtra("");
      setEmail("");
      setDisplayName("");
      setPassword("");
      if (mostrarUsuarios) cargarUsuarios();
    } catch (error) {
      setMensajeKey("error_user_creation");
      setMensajeExtra(`: ${error.message}`);
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

      const lista = data.users || [];

      setUsuarios(lista);
    } catch (error) {
      setMensajeKey("network_error");
      setMensajeExtra("");
    } finally {
      setCargando(false);
    }
  };

  const actualizarPassword = async (uid) => {
    const nuevoPassword = nuevosPasswords[uid] || "";
    if (!nuevoPassword) {
      setMensajeKey("enter_new_password");
      setMensajeExtra("");
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

      setMensajeKey("success_password_updated");
      setMensajeExtra("");
      setNuevosPasswords((prev) => ({ ...prev, [uid]: "" }));
    } catch (error) {
      setMensajeKey("error_password_update");
      setMensajeExtra("");
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

      setMensajeKey("user_deleted");
      setMensajeExtra("");
      cargarUsuarios();
    } catch (error) {
      setMensajeKey("error_deleting_user");
      setMensajeExtra("");
    }
  };

  const alternarMostrarUsuarios = () => {
    if (!mostrarUsuarios) cargarUsuarios();
    setMostrarUsuarios(!mostrarUsuarios);
  };

   return (
    <div className="page-container page-container--fluid">
      <div className="card">
        <h2>{t("user_management")}</h2>

        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          <DSInput
            type="email"
            name="email"
            placeholder={t("email_placeholder") || "Escribe correo"}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
          />
          <DSInput
            type="password"
            name="password"
            placeholder={t("password_placeholder") || "Escribe contraseña"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />

          <DSInput
            type="text"
            name="displayName"
            placeholder={t("display_name") || "Nombre para mostrar"}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoComplete="off"
          />

          <DSNativeSelect
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="">{t('select_role_placeholder')}</option>
            {ROLE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </DSNativeSelect>

          <label style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            {t('active')}
          </label>

          <div style={{ display: "flex", gap: "10px", marginBottom: "10px" }}>
            <BtnPrimary onClick={crearUsuario}>
              {t("create_user")}
            </BtnPrimary>
            <BtnSecondary onClick={alternarMostrarUsuarios}>
              {mostrarUsuarios ? t("hide_users") : t("show_users")}
            </BtnSecondary>
          </div>
        </div>

        {mensajeKey && (
          <p style={{ marginTop: "1rem", color: "#007bff" }}>
            {debugT(mensajeKey)}
            {mensajeExtra}
          </p>
        )}
        {cargando && <p>{t("loading")}...</p>}

        {mostrarUsuarios && usuarios.length > 0 && (
         <div className="table-wrap" style={{ marginTop: "1.5rem" }}>
            <table className="table">
                <thead>
                  <tr>
                    <th>{t("display_name")}</th>
                    <th>{t("email")}</th>
                    <th>{t("rol")}</th>                    
                    <th>{t("new_password")}</th>
                    <th>{t("actions")}</th>
                    <th>{t("activo")}</th>
                    <th>{t("user_id")}</th>
                  </tr>
                </thead>
                <tbody>
                  {usuarios.map((u) => (
                    <tr key={u.uid}>
                      <td>{u.displayName || u.display_name || ""}</td>
                      <td>{u.email}</td>
                      <td>
                        <DSNativeSelect
                          value={u.role}
                          onChange={async (e) => {
                            await fetch(`${API_URL}/update-user-role`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
                              body: JSON.stringify({ uid: u.uid, role: e.target.value }),
                            });
                            cargarUsuarios();
                          }}
                        >
                          <option value="" disabled>{t('select_role_placeholder')}</option>
                          {ROLE_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </DSNativeSelect>
                      </td>
                      <td>
                        <DSInput
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
                        <div style={{ display: "flex", gap: "10px", marginBottom: "10px" }}>
                          <BtnEditDark onClick={() => actualizarPassword(u.uid)}>
                            {t("update_password")}
                          </BtnEditDark>
                          <BtnDanger onClick={() => eliminarUsuario(u.uid)}>
                            {t("delete_user")}
                          </BtnDanger>
                        </div>
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={u.is_active ?? true}
                          onChange={async (e) => {
                            await fetch(`${API_URL}/update-user-role`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
                              body: JSON.stringify({ uid: u.uid, is_active: e.target.checked }),
                            });
                            cargarUsuarios();
                          }}
                        />
                      </td>
                    <td>{u.uid}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        )}
        </div>
      </div>
  );
}