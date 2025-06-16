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
  const [actividadesDict, setActividadesDict] = useState({});

  const colorActividad = (nombreActividad) => {
    switch (nombreActividad?.toLowerCase()) {
      case "load":
        return "#B2FBA5"; // verde
      case "unload":
        return "#AEC6CF"; // Azulado
      case "stage":
        return "#f580ff"; // Morado
      case "label":
        return "#F1BA8B"; // Naranja
      case "scan":
        return "#FFF44F"; // Amarillo
      default:
        return "#F0F0F0"; // Grisazul
    }
  };

  useEffect(() => {
    const cargarCatalogosYActividades = async () => {
      // 1. Cargar actividades
      const { data: actividades, error: errorActividades } = await supabase
        .from("actividades")
        .select("id, nombre");

      if (errorActividades) {
        console.error("❌ Error cargando actividades:", errorActividades);
        return;
      }

      const actDict = {};
      actividades?.forEach((a) => {
        actDict[a.id] = a.nombre?.toLowerCase().trim();
      });
      console.log("🔁 Actividades cargadas:", actDict);
      setActividadesDict(actDict);

      // 2. Cargar productos y operadores
      const [{ data: productos, error: errorProductos }, { data: operadores, error: errorOperadores }] =
        await Promise.all([
          supabase.from("productos").select("id, nombre"),
          supabase.from("operadores").select("id, nombre"),
        ]);

      if (errorProductos || errorOperadores) {
        console.error("❌ Error cargando catálogos", { errorProductos, errorOperadores });
        return;
      }

      const prodDict = {};
      productos?.forEach((p) => {
        prodDict[p.id] = p.nombre;
      });

      const opDict = {};
      operadores?.forEach((op) => {
        opDict[op.id] = op.nombre;
      });

      console.log("📦 Productos cargados:", prodDict);
      console.log("👤 Operadores cargados:", opDict);

      setProductosDict(prodDict);
      setOperadoresDict(opDict);
    };

    cargarCatalogosYActividades();
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

        const nombreActividad = actividadesDict[act.actividad]?.toLowerCase().trim() || "";
        console.log("🔍 Actividad detectada:", act.actividad, "→", nombreActividad);

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

      <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #ccc" }}>
        <thead>
          <tr>
            <th>{t("Código IDX")}</th>
            <th>{t("product")}</th>
            <th>{t("quantity")}</th>
            <th>{t("Stage")}</th>
            <th>{t("Label")}</th>
            <th>{t("Scan")}</th>
            <th>{t("Load")}</th>
            <th>{t("notes")}</th>
          </tr>
        </thead>
        <tbody>
          {resumenData.map((fila, i) => (
            <tr key={i}>
              <td style={{ border: "1px solid #ccc" }}>{fila.idx}</td>
              <td style={{ border: "1px solid #ccc" }}>{fila.producto}</td>
              <td style={{ border: "1px solid #ccc" }}>{fila.cantidad}</td>
              <td style={{ backgroundColor: colorActividad("stage"), border: "1px solid #ccc" }}>{fila.stage || "-"}</td>
              <td style={{ backgroundColor: colorActividad("label"), border: "1px solid #ccc" }}>{fila.label || "-"}</td>
              <td style={{ backgroundColor: colorActividad("scan"), border: "1px solid #ccc" }}>{fila.scan || "-"}</td>
              <td style={{ backgroundColor: colorActividad("load"), border: "1px solid #ccc" }}>{fila.load || "-"}</td>
              <td style={{ border: "1px solid #ccc" }}>{fila.notas}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
