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
      const { data: productos, error: errorProductos } = await supabase.from("productos").select("id, nombre");
      const { data: operadores, error: errorOperadores } = await supabase.from("operadores").select("id, nombre");

      if (errorProductos || errorOperadores) {
        console.error("❌ Error cargando catálogos", { errorProductos, errorOperadores });
        return;
      }

      const p = {};
      productos?.forEach((prod) => (p[prod.id] = prod.nombre));
      const o = {};
      operadores?.forEach((op) => (o[op.id] = op.nombre));

      console.log("📦 Productos cargados:", p);
      console.log("👤 Operadores cargados:", o);

      setProductosDict(p);
      setOperadoresDict(o);
    };

    cargarCatalogos();
  }, []);

  useEffect(() => {
    const fetchResumen = async () => {
      if (!Object.keys(productosDict).length || !Object.keys(operadoresDict).length) return;

      const { data, error } = await supabase.from("actividades_realizadas").select("*");
      if (error || !data) {
        console.error("❌ Error cargando actividades:", error);
        return;
      }

      console.log("🧾 Actividades obtenidas:", data);

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
            idx: key,
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
        } else if (typeof act.operadores === "string" && act.operadores.trim()) {
          operadorNombre = operadoresDict[act.operadores] || act.operadores;
        }

        const hora = act.hora_inicio ? format(new Date(act.hora_inicio), "Pp") : "-";
        const registro = `${operadorNombre} (${hora})`;

        if (["stage", "label", "scan", "load"].includes(nombreActividad)) {
          agrupadas[key][nombreActividad] = registro;
        }

        if (!agrupadas[key].fechaNotas || new Date(act.createdAt) > new Date(agrupadas[key].fechaNotas)) {
          agrupadas[key].notas = act.notas || "";
          agrupadas[key].fechaNotas = act.createdAt;
        }
      });

      const resultado = Object.values(agrupadas).sort((a, b) => b.idx.localeCompare(a.idx));
      const filtrado = filtroIdx
        ? resultado.filter((r) => r.idx?.toLowerCase().includes(filtroIdx.toLowerCase()))
        : resultado;

      console.log("📊 Resumen final:", filtrado);

      setResumenData(filtrado);
    };

    fetchResumen();
  }, [productosDict, operadoresDict, filtroIdx, fechaInicio, fechaFin]);

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
            <th>{t("Código IDX")}</th>
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
          {resumenData.map((fila, i) => (
            <tr key={i}>
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
