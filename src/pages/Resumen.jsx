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
  const [modoAgrupacion, setModoAgrupacion] = useState("idx");

  useEffect(() => {
    const cargarDatos = async () => {
      // 1. Cargar catálogos
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

      // 2. Cargar actividades
      const { data, error } = await supabase.from("actividades_realizadas").select("*");
      if (error || !data) return;

      const agrupadas = {};

      data.forEach((act) => {
        if (act.estado !== "finalizada" || !act.idx) return;

        const fecha = new Date(act.hora_inicio);
        if (
          (fechaInicio && new Date(fecha) < new Date(fechaInicio)) ||
          (fechaFin && new Date(fecha) > new Date(fechaFin))
        ) return;

        const key = act.idx;
        if (!agrupadas[key]) {
          agrupadas[key] = {
            idx: act.idx,
            producto: prodDict?.[act.productos?.[0]?.producto] || "-",
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
          operadorNombre = act.operadores.map((id) => opDict[id] || id).join(", ");
        } else if (typeof act.operadores === "string" && act.operadores.trim()) {
          operadorNombre = opDict[act.operadores] || act.operadores;
        }
        const hora = act.hora_inicio ? format(new Date(act.hora_inicio), "Pp") : "-";

        if (["stage", "label", "scan", "load"].includes(nombreActividad)) {
          agrupadas[key][nombreActividad] = `${operadorNombre} (${hora})`;
        }

        if (
          !agrupadas[key].fechaNotas ||
          new Date(act.createdAt) > new Date(agrupadas[key].fechaNotas)
        ) {
          agrupadas[key].notas = act.notas || "";
          agrupadas[key].fechaNotas = act.createdAt;
        }
      });

      let resultado = Object.values(agrupadas);

      if (modoAgrupacion === "idx") {
        resultado = resultado.sort((a, b) => b.idx.localeCompare(a.idx));
      }

      if (filtroIdx) {
        resultado = resultado.filter((r) =>
          r.idx?.toLowerCase().includes(filtroIdx.toLowerCase())
        );
      }

      setResumenData(resultado);
    };

    cargarDatos();
  }, [filtroIdx, fechaInicio, fechaFin, modoAgrupacion]);



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
            <th style={{ background: "#f580ff" }}>{t("Stage")}</th>
            <th style={{ background: "#F1BA8B" }}>{t("Label")}</th>
            <th style={{ background: "#FFF44F" }}>{t("Scan")}</th>
            <th style={{ background: "#B2FBA5" }}>{t("Load")}</th>
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