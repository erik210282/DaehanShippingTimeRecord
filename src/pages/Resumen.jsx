import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import supabase from "../supabase/client";
import { format } from "date-fns";

export default function Resumen() {
  const { t } = useTranslation();
  const [resumenData, setResumenData] = useState([]);
  const [filtroIdx, setFiltroIdx] = useState("");
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");
  const [productosDict, setProductosDict] = useState({});
  const [operadoresDict, setOperadoresDict] = useState({});

  useEffect(() => {
    const cargarCatalogos = async () => {
      const [{ data: productos }, { data: operadores }] = await Promise.all([
        supabase.from("productos").select("id, nombre"),
        supabase.from("operadores").select("id, nombre"),
      ]);

      const prodDict = {};
      productos?.forEach((p) => {
        prodDict[p.id] = p.nombre;
      });

      const opDict = {};
      operadores?.forEach((op) => {
        opDict[op.id] = op.nombre;
      });

      setProductosDict(prodDict);
      setOperadoresDict(opDict);
    };

    cargarCatalogos();
  }, []);

  useEffect(() => {
    const cargarActividades = async () => {
      if (!Object.keys(productosDict).length || !Object.keys(operadoresDict).length) return;

      const { data, error } = await supabase.from("actividades_realizadas").select("*");
      if (error || !data) return;

      const agrupadas = {};

      data.forEach((act) => {
        if (act.estado !== "finalizada" || !act.idx) return;

        const fecha = new Date(act.hora_inicio);
        if (
          (fechaInicio && fecha < new Date(fechaInicio)) ||
          (fechaFin && fecha > new Date(fechaFin))
        ) return;

        const key = act.idx;
        if (!agrupadas[key]) {
          agrupadas[key] = {
            idx: act.idx,
            producto: productosDict?.[act.productos?.[0]?.producto] || "-",
            cantidad: act.productos?.[0]?.cantidad || "-",
            stage: null,
            label: null,
            scan: null,
            load: null,
            notas: "",
            fechaNotas: null,
          };
        }

        const nombreActividad = act.actividad?.toLowerCase();
        let operadorNombre = "-";
        if (Array.isArray(act.operadores)) {
          operadorNombre = act.operadores.map((id) => operadoresDict[id] || `ID:${id}`).join(", ");
        } else if (typeof act.operadores === "string") {
          operadorNombre = operadoresDict[act.operadores] || act.operadores;
        }

        const hora = act.hora_inicio ? format(new Date(act.hora_inicio), "Pp") : "-";

        if (["stage", "label", "scan", "load"].includes(nombreActividad)) {
          agrupadas[key][nombreActividad] = `${operadorNombre} (${hora})`;
        }

        if (!agrupadas[key].fechaNotas || new Date(act.createdAt) > new Date(agrupadas[key].fechaNotas)) {
          agrupadas[key].notas = act.notas || "";
          agrupadas[key].fechaNotas = act.createdAt;
        }
      });

      let resultado = Object.values(agrupadas);

      resultado = resultado.sort((a, b) => b.idx.localeCompare(a.idx));

      if (filtroIdx) {
        resultado = resultado.filter((r) => r.idx?.toLowerCase().includes(filtroIdx.toLowerCase()));
      }

      setResumenData(resultado);
    };

    cargarActividades();
  }, [productosDict, operadoresDict, filtroIdx, fechaInicio, fechaFin]);

  const colorActividad = (nombre) => {
    switch (nombre) {
      case "stage": return "#f580ff";
      case "label": return "#F1BA8B";
      case "scan": return "#FFF44F";
      case "load": return "#B2FBA5";
      default: return "#eee";
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <h2>{t("Resumen de Actividades por IDX")}</h2>

      <div style={{ marginBottom: 12 }}>
        <input
          type="text"
          placeholder={t("Buscar por IDX")}
          value={filtroIdx}
          onChange={(e) => setFiltroIdx(e.target.value)}
          style={{ marginRight: 10, padding: 4 }}
        />
        <input
          type="date"
          value={fechaInicio}
          onChange={(e) => setFechaInicio(e.target.value)}
          style={{ marginRight: 10, padding: 4 }}
        />
        <input
          type="date"
          value={fechaFin}
          onChange={(e) => setFechaFin(e.target.value)}
          style={{ padding: 4 }}
        />
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th>IDX</th>
            <th>{t("product")}</th>
            <th>{t("quantity")}</th>
            <th style={{ background: colorActividad("stage") }}>{t("Stage")}</th>
            <th style={{ background: colorActividad("label") }}>{t("Label")}</th>
            <th style={{ background: colorActividad("scan") }}>{t("Scan")}</th>
            <th style={{ background: colorActividad("load") }}>{t("Load")}</th>
            <th>{t("notes")}</th>
          </tr>
        </thead>
        <tbody>
          {resumenData.map((fila) => (
            <tr key={fila.idx}>
              <td>{fila.idx}</td>
              <td>{fila.producto}</td>
              <td>{fila.cantidad}</td>
              <td>{fila.stage || "-"}</td>
              <td>{fila.label || "-"}</td>
              <td>{fila.scan || "-"}</td>
              <td>{fila.load || "-"}</td>
              <td>{fila.notas}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
