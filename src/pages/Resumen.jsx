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
      const { data: actividadesData } = await supabase
        .from("actividades_realizadas")
        .select("*");

      const { data: productosData } = await supabase
        .from("productos")
        .select("id, nombre");

      const { data: usuariosData } = await supabase
        .from("operadores")
        .select("id, nombre");

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
      for (const act of actividadesData || []) {
        const idx = act.idx || "-";
        if (!agrupado[idx]) agrupado[idx] = [];
        agrupado[idx].push(act);
      }

      const resumenFormateado = Object.entries(agrupado)
        .map(([idx, grupo]) => {
          const productosLista = [];
          const cantidadesLista = [];
          const notasLista = [];
          const pasos = {
            stage: null,
            label: null,
            scan: null,
            load: null,
          };

          for (const act of grupo) {
            (act.productos || []).forEach((p) => {
              productosLista.push(productos[p.producto] || p.producto);
              cantidadesLista.push(p.cantidad);
            });
            if (act.notas) notasLista.push(act.notas);

            ["stage", "label", "scan", "load"].forEach((paso) => {
              const operador = act[`operador_${paso}`];
              const fecha = act[`fecha_${paso}`];
              if (operador && fecha && !pasos[paso]) {
                pasos[paso] = {
                  operador: usuarios[operador] || operador,
                  fecha,
                };
              }
            });
          }

          return {
            idx,
            productos: productosLista,
            cantidades: cantidadesLista,
            notas: notasLista.join(" | "),
            ...pasos,
          };
        })
        .sort((a, b) => (b.idx || "").localeCompare(a.idx || ""));

      setResumen(resumenFormateado);
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
      case "load":
        return "#B2FBA5";
      case "unload":
        return "#AEC6CF";
      case "stage":
        return "#f580ff";
      case "label":
        return "#F1BA8B";
      case "scan":
        return "#FFF44F";
      default:
        return "#F0F0F0";
    }
  };

  const renderPaso = (paso, tipo) => (
    <td style={{ backgroundColor: colorActividad(tipo), padding: "5px" }}>
      <div>{paso?.operador || "-"}</div>
      <div style={{ fontSize: "0.8em" }}>{formatearFecha(paso?.fecha)}</div>
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
            <th>{t("notes")}</th>
          </tr>
        </thead>
        <tbody>
          {resumen.map((r, i) => (
            <tr key={i}>
              <td>{r.idx}</td>
              <td>{r.productos.map((p, i) => <div key={i}>{p}</div>)}</td>
              <td>{r.cantidades.map((c, i) => <div key={i}>{c}</div>)}</td>
              {renderPaso(r.stage, "stage")}
              {renderPaso(r.label, "label")}
              {renderPaso(r.scan, "scan")}
              {renderPaso(r.load, "load")}
              <td>{r.notas}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
