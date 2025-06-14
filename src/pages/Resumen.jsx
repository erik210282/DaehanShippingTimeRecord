import React, { useEffect, useState } from "react";
import supabase from "../supabase/client";
import { useTranslation } from "react-i18next";
import "react-toastify/dist/ReactToastify.css";

export default function Resumen() {
  const { t } = useTranslation();
  const [resumen, setResumen] = useState([]);
  const [productos, setProductos] = useState({});
  const [usuarios, setUsuarios] = useState({});

  useEffect(() => {
    cargarDatos();
  }, []);

  const cargarDatos = async () => {
    const { data: actividades } = await supabase
      .from("actividades_realizadas")
      .select("*");

    const { data: productosData } = await supabase.from("productos").select("id, nombre");
    const { data: usuariosData } = await supabase.from("operadores").select("id, nombre");

    const mapaProductos = {};
    productosData?.forEach((p) => {
      mapaProductos[p.id] = p.nombre;
    });
    setProductos(mapaProductos);

    const mapaUsuarios = {};
    usuariosData?.forEach((u) => {
      mapaUsuarios[u.id] = u.nombre;
    });
    setUsuarios(mapaUsuarios);

    // Agrupar por IDX
    const agrupado = {};
    (actividades || []).forEach((a) => {
      if (!agrupado[a.idx]) {
        agrupado[a.idx] = {
          idx: a.idx,
          productos: a.productos || [],
          notas: a.notas || "",
          cantidad: a.productos?.[0]?.cantidad || "-",
          stage: {},
          label: {},
          scan: {},
          load: {},
        };
      }
      if (a.nombre_actividad?.toLowerCase() === "stage") agrupado[a.idx].stage = a;
      if (a.nombre_actividad?.toLowerCase() === "label") agrupado[a.idx].label = a;
      if (a.nombre_actividad?.toLowerCase() === "scan") agrupado[a.idx].scan = a;
      if (a.nombre_actividad?.toLowerCase() === "load") agrupado[a.idx].load = a;
    });

    const lista = Object.values(agrupado).sort((a, b) => `${b.idx}`.localeCompare(`${a.idx}`));
    setResumen(lista);
  };

  const colorActividad = (nombreActividad) => {
    switch (nombreActividad?.toLowerCase()) {
      case "load": return "#B2FBA5";
      case "unload": return "#AEC6CF";
      case "stage": return "#f580ff";
      case "label": return "#F1BA8B";
      case "scan": return "#FFF44F";
      default: return "#F0F0F0";
    }
  };

  const celda = (actividad, tipo) => (
    <td style={{ backgroundColor: colorActividad(tipo), padding: "4px" }}>
      <div>{usuarios[actividad?.operador_stage || actividad?.operador_label || actividad?.operador_scan || actividad?.operador_load] || "-"}</div>
      <div style={{ fontSize: "0.8em" }}>{actividad?.fecha_stage || actividad?.fecha_label || actividad?.fecha_scan || actividad?.fecha_load || "-"}</div>
    </td>
  );

  return (
    <div style={{ padding: 20 }}>
      <h2>{t("Resumen de Actividades")}</h2>
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
            <th>{t("notes")}</th>
          </tr>
        </thead>
        <tbody>
          {resumen.map((r, i) => (
            <tr key={i}>
              <td>{r.idx}</td>
              <td>
                {(r.productos || []).map((p, j) => (
                  <div key={j}>{productos[p.producto] || p.producto}</div>
                ))}
              </td>
              <td>
                {(r.productos || []).map((p, j) => (
                  <div key={j}>{p.cantidad}</div>
                ))}
              </td>
              {celda(r.stage, "stage")}
              {celda(r.label, "label")}
              {celda(r.scan, "scan")}
              {celda(r.load, "load")}
              <td>{r.notas}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
