import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import supabase from "../supabase/client";

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
    const cargarCatalogos = async () => {
      const { data: productos } = await supabase.from("productos").select("id, nombre");
      const { data: operadores } = await supabase.from("operadores").select("id, nombre");

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
    const fetchResumen = async () => {
      if (!Object.keys(productosDict).length || !Object.keys(operadoresDict).length) {
        return; // Espera a que se carguen los catálogos
      }

      const { data, error } = await supabase.from("actividades_realizadas").select("*");
      if (error) return;

      const agrupadas = {};

      data.forEach((act) => {
        if (!act.estado || act.estado !== "finalizada") return;
        if (!act.idx) return;

        const fecha = new Date(act.hora_inicio);
        if (
          (fechaInicio && new Date(fecha) < new Date(fechaInicio)) ||
          (fechaFin && new Date(fecha) > new Date(fechaFin))
        ) {
          return;
        }

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
          };
        }

        const nombreActividad = act.actividad?.toLowerCase();
        const operador = Array.isArray(act.operadores)
          ? act.operadores.map(id => operadoresDict[id] || id).join(", ")
          : "-";
        const hora = act.hora_inicio ? format(new Date(act.hora_inicio), "Pp") : "-";

        if (["stage", "label", "scan", "load"].includes(nombreActividad)) {
          agrupadas[key][nombreActividad] = `${operador} (${hora})`;
        }

        agrupadas[key].notas = act.notas || agrupadas[key].notas;
      });

      let resultado = Object.values(agrupadas);

      if (modoAgrupacion === "idx") {
        resultado = resultado.sort((a, b) => b.idx.localeCompare(a.idx));
      }

      if (filtroIdx) {
        resultado = resultado.filter((r) => r.idx?.toLowerCase().includes(filtroIdx.toLowerCase()));
      }

      setResumenData(resultado);
    };

    fetchResumen();
  }, [productosDict, operadoresDict, filtroIdx, fechaInicio, fechaFin, modoAgrupacion]);

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