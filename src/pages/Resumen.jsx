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
      let query = supabase
        .from("actividades_realizadas")
        .select("*")
        .eq("estado", "finalizada")
        .order("createdAt", { ascending: true });

      if (fechaInicio) query = query.gte("createdAt", fechaInicio);
      if (fechaFin) query = query.lte("createdAt", fechaFin);

      const { data, error } = await query;

      if (error) {
        console.error("❌ Error al cargar actividades:", error);
        return;
      }

      const resumenPorIdx = {};

      data.forEach((actividad) => {
        const { idx, actividad: tipo, operadores, hora_inicio, notas, createdAt, productos } = actividad;
        if (!idx || (filtroIdx && !idx.includes(filtroIdx))) return;

        if (!resumenPorIdx[idx]) {
          resumenPorIdx[idx] = {
            idx,
            producto: productos?.[0]?.producto ? productosDict[productos[0].producto] || productos[0].producto : "",
            cantidad: productos?.[0]?.cantidad || "",
            stage: null,
            label: null,
            scan: null,
            load: null,
            notas: "",
            fechaNotas: null,
          };
        }

        const operadorNombre = Array.isArray(operadores)
          ? operadores.map((id) => operadoresDict[id] || id).join(", ")
          : operadores;

        const registro = `${operadorNombre} (${new Date(hora_inicio).toLocaleString()})`;

        if (tipo && typeof tipo === "string") {
          const key = tipo.toLowerCase();
          if (["stage", "label", "scan", "load"].includes(key)) {
            resumenPorIdx[idx][key] = registro;
          }
        }

        if (!resumenPorIdx[idx].fechaNotas || new Date(createdAt) > new Date(resumenPorIdx[idx].fechaNotas)) {
          resumenPorIdx[idx].notas = notas || "";
          resumenPorIdx[idx].fechaNotas = createdAt;
        }
      });

      const resumenArray = Object.values(resumenPorIdx).sort((a, b) => b.idx.localeCompare(a.idx));
      setResumenData(resumenArray);
    };

    if (Object.keys(productosDict).length && Object.keys(operadoresDict).length) {
      fetchResumen();
    }
  }, [filtroIdx, fechaInicio, fechaFin, productosDict, operadoresDict]);

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