import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import supabase from "../supabase/client";

export default function Resumen() {
  const { t } = useTranslation();
  const [resumenData, setResumenData] = useState([]);

  useEffect(() => {
    const fetchResumen = async () => {
      const { data, error } = await supabase
        .from("actividades_realizadas")
        .select("*")
        .eq("estado", "finalizada")
        .order("createdAt", { ascending: true });

      if (error) {
        console.error("❌ Error al cargar actividades:", error);
        return;
      }

      const resumenPorIdx = {};

      data.forEach((actividad) => {
        const { idx, actividad: tipo, operadores, hora_inicio, notas, createdAt, productos, cantidad } = actividad;
        if (!idx) return;

        if (!resumenPorIdx[idx]) {
          resumenPorIdx[idx] = {
            idx,
            producto: productos?.[0]?.producto || "",
            cantidad: cantidad || "",
            stage: null,
            label: null,
            scan: null,
            load: null,
            notas: "",
            fechaNotas: null,
          };
        }

        const operadorNombre = Array.isArray(operadores) ? operadores.join(", ") : operadores;
        const registro = `${operadorNombre} (${new Date(hora_inicio).toLocaleString()})`;

        if (tipo && typeof tipo === "string") {
          const key = tipo.toLowerCase();
          if (["stage", "label", "scan", "load"].includes(key)) {
            resumenPorIdx[idx][key] = registro;
          }
        }

        // Guardar la nota más reciente por idx
        if (!resumenPorIdx[idx].fechaNotas || new Date(createdAt) > new Date(resumenPorIdx[idx].fechaNotas)) {
          resumenPorIdx[idx].notas = notas || "";
          resumenPorIdx[idx].fechaNotas = createdAt;
        }
      });

      setResumenData(Object.values(resumenPorIdx));
    };

    fetchResumen();
  }, []);

  return (
    <div style={{ padding: 16 }}>
      <h2>{t("Resumen de Actividades por IDX")}</h2>
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
