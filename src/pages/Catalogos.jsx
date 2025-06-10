import React, { useEffect, useState } from "react";
import supabase from "../supabase/client";
import Modal from "react-modal";
import Papa from "papaparse";
import { useTranslation } from "react-i18next";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import "../App.css";

Modal.setAppElement("#root");

export default function Catalogos() {
  const { t } = useTranslation();

  const [catalogoActivo, setCatalogoActivo] = useState("actividades");
  const [items, setItems] = useState([]);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [itemActual, setItemActual] = useState(null);
  const [esNuevo, setEsNuevo] = useState(false);
  const [filtroTexto, setFiltroTexto] = useState("");
  const [mostrarMensajeError, setMostrarMensajeError] = useState(false);

  useEffect(() => {
    const cargarDatos = async () => {
      const { data, error } = await supabase
        .from(catalogoActivo)
        .select("id, nombre, activo");

      if (!error) {
        setItems(data.map((i) => ({
          id: i.id,
          nombre: i.nombre,
          activo: i.activo ?? true,
        })));
      }
    };
    cargarDatos();
  }, [catalogoActivo]);

  const abrirModal = (item = null) => {
    if (item) {
      setItemActual({ ...item });
      setEsNuevo(false);
    } else {
      setItemActual({ nombre: "", activo: true });
      setEsNuevo(true);
    }
    setModalAbierto(true);
  };

  const guardarItem = async () => {
    const { nombre, activo } = itemActual;
    if (!nombre) {
      toast.error(t("fill_all_fields"));
      return;
    }

    try {
      if (esNuevo) {
        const { data, error } = await supabase
          .from(catalogoActivo)
          .insert([{ nombre, activo }])
          .select();

        if (!error && data?.[0]) {
          setItems([...items, { id: data[0].id, nombre, activo }]);
        }
      } else {
        const { error } = await supabase
          .from(catalogoActivo)
          .update({ nombre, activo })
          .eq("id", itemActual.id);

        if (!error) {
          setItems(items.map((i) =>
            i.id === itemActual.id ? { id: itemActual.id, nombre, activo } : i
          ));
        }
      }
      toast.success(t("save_success"));
      setModalAbierto(false);
    } catch {
      toast.error(t("error_saving"));
    }
  };

  const eliminarItem = async (id) => {
    try {
      const { data, error } = await supabase
        .from("actividades_realizadas")
        .select("*");

      if (error) throw error;

      const usados = data.some((d) =>
        d.actividad === id ||
        d.producto === id ||
        (Array.isArray(d.operadores) && d.operadores.includes(id))
      );

      if (usados) {
        await supabase
          .from(catalogoActivo)
          .update({ activo: false })
          .eq("id", id);

        setItems(items.map((i) =>
          i.id === id ? { ...i, activo: false } : i
        ));
        toast.info(t("item_in_use"));
      } else {
        await supabase
          .from(catalogoActivo)
          .delete()
          .eq("id", id);

        setItems(items.filter((i) => i.id !== id));
        toast.success(t("delete_success"));
      }
    } catch {
      toast.error(t("error_deleting"));
    }
  };

  const exportarCSV = () => {
    const datosCSV = [...items]
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map((d) => ({
        [t("name")]: d.nombre || `ID: ${d.id}`,
        [t("status")]: d.activo ? t("active") : t("inactive"),
      }));

    const csv = Papa.unparse(datosCSV);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `${catalogoActivo}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const itemsFiltrados = items
    .filter((item) =>
      item.nombre && filtroTexto
        ? item.nombre.toLowerCase().includes(filtroTexto.toLowerCase())
        : true
    )
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  useEffect(() => {
    const timer = setTimeout(() => {
      setMostrarMensajeError(filtroTexto && itemsFiltrados.length === 0);
    }, 500);
    return () => clearTimeout(timer);
  }, [filtroTexto, itemsFiltrados]);

  return (
    <div className="card">
      <h2>{t("catalogs")}</h2>

      <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "center" }}>
        <button className="primary" onClick={() => setCatalogoActivo("actividades")}>{t("activities")}</button>
        <button className="primary" onClick={() => setCatalogoActivo("productos")}>{t("products")}</button>
        <button className="primary" onClick={() => setCatalogoActivo("operadores")}>{t("operators")}</button>
        <button className="primary" onClick={exportarCSV}>{t("export_csv")}</button>
      </div>

      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <input
          type="text"
          placeholder={t("search")}
          value={filtroTexto}
          onChange={(e) => setFiltroTexto(e.target.value)}
        />
        <button onClick={() => { setFiltroTexto(""); setMostrarMensajeError(false); }} style={{ marginBottom: 20 }}>
          {t("clear_filters")}
        </button>
        <button onClick={() => abrirModal()} style={{ marginBottom: 20 }}>
          ➕ {t("add_catalog")}
        </button>
      </div>

      {mostrarMensajeError && <p style={{ color: "red" }}>{t("no_results_found")}</p>}

      <div style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>{t("name")}</th>
              <th>{t("status")}</th>
              <th>{t("actions")}</th>
            </tr>
          </thead>
          <tbody>
            {itemsFiltrados.map((item) => (
              <tr key={item.id}>
                <td>{item.nombre}</td>
                <td>{item.activo ? t("active") : t("inactive")}</td>
                <td>
                  <button className="edit-btn" onClick={() => abrirModal(item)}>{t("edit")}</button>
                  <button className="delete-btn" onClick={() => eliminarItem(item.id)}>{t("delete")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal isOpen={modalAbierto} onRequestClose={() => setModalAbierto(false)}>
        <div className="card">
          <h3>{esNuevo ? t("add") : t("edit")}</h3>
          <input
            type="text"
            value={itemActual?.nombre}
            onChange={(e) => setItemActual({ ...itemActual, nombre: e.target.value })}
          />
          <label style={{ margin: "1rem 0", display: "block" }}>
            <input
              type="checkbox"
              checked={itemActual?.activo}
              onChange={() => setItemActual({ ...itemActual, activo: !itemActual?.activo })}
            /> {t("active")}
          </label>
          <button className="primary" onClick={guardarItem}>{t("save")}</button>
          <button className="secondary" onClick={() => setModalAbierto(false)}>{t("cancel")}</button>
        </div>
      </Modal>

      <ToastContainer position="top-center" autoClose={2000} />
    </div>
  );
}
