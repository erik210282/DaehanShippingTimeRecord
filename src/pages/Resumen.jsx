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

    const agrupado = {};
    (actividades || []).forEach((a) => {
      if (!agrupado[a.idx]) {
        agrupado[a.idx] = {
          idx: a.idx,
          productos: a.productos || [],
          notas: a.notas || "",
          cantidad: a.productos?.[0]?.cantidad || "-",
          etapas: {
            stage: null,
            label: null,
            scan: null,
            load: null,
          },
        };
      }
      const tipo = a.nombre_actividad?.toLowerCase();
      if (agrupado[a.idx].etapas[tipo] === null) {
        agrupado[a.idx].etapas[tipo] = {
          operador: a.operadores?.[0] || a.operador_stage || a.operador_label || a.operador_scan || a.operador_load || null,
          fecha: a.fecha_stage || a.fecha_label || a.fecha_scan || a.fecha_load || a.fecha || null,
        };
      }
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

  const celda = (etapa, tipo) => (
    <td style={{ backgroundColor: colorActividad(tipo), padding: "4px" }}>
      <div>{usuarios[etapa?.operador] || "-"}</div>
      <div style={{ fontSize: "0.8em" }}>{etapa?.fecha ? new Date(etapa.fecha).toLocaleString() : "-"}</div>
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
              {celda(r.etapas.stage, "stage")}
              {celda(r.etapas.label, "label")}
              {celda(r.etapas.scan, "scan")}
              {celda(r.etapas.load, "load")}
              <td>{r.notas}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
