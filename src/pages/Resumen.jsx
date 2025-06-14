import React, { useEffect, useState } from "react";
import { supabase } from "../supabase/client";
import { useTranslation } from "react-i18next";
import "react-toastify/dist/ReactToastify.css";


export default function Resumen() {
  const { t } = useTranslation();
  const [actividades, setActividades] = useState([]);
  const [productos, setProductos] = useState({});
  const [usuarios, setUsuarios] = useState({});

  useEffect(() => {
    cargarDatos();
  }, []); 

  const cargarDatos = async () => {
    const { data: actividadesData } = await supabase
      .from("actividades_realizadas")
      .select("*")
      .order("fecha_stage", { ascending: true });

    const { data: productosData } = await supabase.from("productos").select("id, nombre");
    const { data: usuariosData } = await supabase.from("usuarios").select("id, nombre");

    const mapaProductos = {};
    productosData?.forEach((p) => {
      mapaProductos[p.id] = p.nombre;
    });

    const mapaUsuarios = {};
    usuariosData?.forEach((u) => {
      mapaUsuarios[u.id] = u.nombre;
    });

    setProductos(mapaProductos);
    setUsuarios(mapaUsuarios);
    setActividades(actividadesData || []);
  };

  const formatearFecha = (fecha) => {
    if (!fecha) return "-";
    const d = new Date(fecha);
    return d.toLocaleString();
  };

  const colorActividad = (nombreActividad) => {
    switch (nombreActividad?.toLowerCase()) {
      case "load":
        return "#B2FBA5"; // verde
      case "unload":
        return "#AEC6CF"; // Azulado
      case "stage":
        return "#f580ff"; // Morado
      case "label":
        return "#F1BA8B"; // Naranja
      case "scan":
        return "#FFF44F"; // Amarillo
      default:
        return "#F0F0F0"; // Grisazul
    }
  };

  const celdaPaso = (operadorId, fecha, tipo) => (
    <td style={{ backgroundColor: colorActividad(tipo), padding: "5px" }}>
      <div>{usuarios[operadorId] || "-"}</div>
      <div style={{ fontSize: "0.8em" }}>{formatearFecha(fecha)}</div>
    </td>
  );

  return (
    <div style={{ padding: 20 }}>
      <h2>{t("summary")}</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th>{t("idx")}</th>
            <th>{t("product")}</th>
            <th>{t("amount")}</th>
            <th>Stage</th>
            <th>Label</th>
            <th>Scan</th>
            <th>Load</th>
            <th>Unload</th>
            <th>{t("notes")}</th>
          </tr>
        </thead>
        <tbody>
          {actividades.map((a) => (
            <tr key={a.id}>
              <td>{a.idx}</td>
              <td>
                {(Array.isArray(a.productos) ? a.productos : []).map((p, i) => (
                  <div key={i}>{productos[p.producto] || p.producto}</div>
                ))}
              </td>
              <td>
                {(Array.isArray(a.productos) ? a.productos : []).map((p, i) => (
                  <div key={i}>{p.cantidad}</div>
                ))}
              </td>
              {celdaPaso(a.operador_stage, a.fecha_stage, "stage")}
              {celdaPaso(a.operador_label, a.fecha_label, "label")}
              {celdaPaso(a.operador_scan, a.fecha_scan, "scan")}
              {celdaPaso(a.operador_load, a.fecha_load, "load")}
              {celdaPaso(a.operador_unload, a.fecha_unload, "unload")}
              <td>{a.notas || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
