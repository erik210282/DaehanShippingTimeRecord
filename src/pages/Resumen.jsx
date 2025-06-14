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
    const cargarDatos = async () => {
      const { data: actividades } = await supabase.from("actividades_realizadas").select("*");
      const { data: productosData } = await supabase.from("productos").select("id, nombre");
      const { data: usuariosData } = await supabase.from("operadores").select("id, nombre");

      const mapaProductos = {};
      productosData?.forEach((p) => {
        mapaProductos[p.id] = p.nombre;
      });

      const mapaUsuarios = {};
      usuariosData?.forEach((u) => {
        mapaUsuarios[u.id] = u.nombre;
      });

      const agrupado = {};
      actividades?.forEach((act) => {
        if (!agrupado[act.idx]) agrupado[act.idx] = { productos: [], cantidades: [], etapas: {}, notas: [] };

        (Array.isArray(act.productos) ? act.productos : []).forEach((p) => {
          agrupado[act.idx].productos.push(p.producto);
          agrupado[act.idx].cantidades.push(p.cantidad);
        });

        ["stage", "label", "scan", "load"].forEach((etapa) => {
          if (act[`operador_${etapa}`] || act[`fecha_${etapa}`]) {
            agrupado[act.idx].etapas[etapa] = {
              operador: act[`operador_${etapa}`],
              fecha: act[`fecha_${etapa}`],
            };
          }
        });

        if (act.notas) agrupado[act.idx].notas.push(act.notas);
      });

      const resultado = Object.entries(agrupado)
        .map(([idx, info]) => ({
          idx,
          productos: info.productos.map((id) => mapaProductos[id] || id),
          cantidades: info.cantidades,
          etapas: info.etapas,
          notas: info.notas,
        }))
        .sort((a, b) => b.idx.localeCompare(a.idx));

      setResumen(resultado);
      setProductos(mapaProductos);
      setUsuarios(mapaUsuarios);
    };

    cargarDatos();
  }, []);

  const formatearFecha = (fecha) => {
    if (!fecha) return "-";
    const d = new Date(fecha);
    return d.toLocaleString();
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

  const renderPaso = (etapas, tipo) => {
    const paso = etapas[tipo];
    return (
      <td style={{ backgroundColor: colorActividad(tipo), padding: "5px" }}>
        <div>{usuarios[paso?.operador] || "-"}</div>
        <div style={{ fontSize: "0.8em" }}>{formatearFecha(paso?.fecha)}</div>
      </td>
    );
  };

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
            <th>{t("notes")}</th>
          </tr>
        </thead>
        <tbody>
          {resumen.map((r, i) => (
            <tr key={i}>
              <td>{r.idx}</td>
              <td>{r.productos.map((p, i) => <div key={i}>{p}</div>)}</td>
              <td>{r.cantidades.map((c, i) => <div key={i}>{c}</div>)}</td>
              {renderPaso(r.etapas, "stage")}
              {renderPaso(r.etapas, "label")}
              {renderPaso(r.etapas, "scan")}
              {renderPaso(r.etapas, "load")}
              <td>{r.notas.join(" | ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
