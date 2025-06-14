import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import supabase from "../supabase/client";
import { format } from "date-fns";

export default function Resumen() {
  const { t } = useTranslation();
  const [resumenData, setResumenData] = useState([]);
  const [productoDict, setProductoDict] = useState({});
  const [operadorDict, setOperadorDict] = useState({});
  const [filtroIdx, setFiltroIdx] = useState("");
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");
  const [modoAgrupacion, setModoAgrupacion] = useState("idx");

  useEffect(() => {
    const fetchResumen = async () => {
      const { data: actividades, error } = await supabase
        .from("actividades_realizadas")
        .select("*");

      if (error) return console.error("Error cargando actividades:", error);

      const resumenMap = {};

      for (const act of actividades) {
        if (act.estado !== "finalizada") continue;

        const clave = act.idx || "Sin IDX";

        if (!resumenMap[clave]) {
          resumenMap[clave] = {
            idx: clave,
            cantidad: act.cantidad || 0,
            producto: (act.productos && act.productos[0]?.producto) || "",
            notas: act.notas || "",
            stage: null,
            label: null,
            scan: null,
            load: null,
          };
        }

        const tipo = (act.actividad_nombre || act.actividad || "").toLowerCase();

        if (["stage", "label", "scan", "load"].includes(tipo)) {
          resumenMap[clave][tipo] = {
            operador: act.operadores?.[0] || null,
            fecha: act.hora_inicio,
          };
        }

        // Última nota sobrescribe
        resumenMap[clave].notas = act.notas || resumenMap[clave].notas;
      }

      const lista = Object.values(resumenMap).sort((a, b) => b.idx.localeCompare(a.idx));
      setResumenData(lista);
    };

    const fetchCatalogos = async () => {
      const [{ data: productos }, { data: operadores }] = await Promise.all([
        supabase.from("productos").select("id,nombre"),
        supabase.from("operadores").select("id,nombre"),
      ]);

      const dictProd = {};
      productos?.forEach((p) => (dictProd[p.id] = p.nombre));
      setProductoDict(dictProd);

      const dictOp = {};
      operadores?.forEach((op) => (dictOp[op.id] = op.nombre));
      setOperadorDict(dictOp);
    };

    fetchCatalogos();
    fetchResumen();
  }, []);

  const limpiarFiltros = () => {
    setFiltroIdx("");
    setFechaInicio("");
    setFechaFin("");
  };

  const aplicarFiltros = (item) => {
    if (filtroIdx && !item.idx.toLowerCase().includes(filtroIdx.toLowerCase())) return false;
    if (fechaInicio && new Date(item.fecha) < new Date(fechaInicio)) return false;
    if (fechaFin && new Date(item.fecha) > new Date(fechaFin)) return false;
    return true;
  };

  const renderCelda = (actividad) => {
    if (!actividad || !actividad.operador) return "-";
    const nombre = operadorDict[actividad.operador] || actividad.operador;
    const hora = actividad.fecha ? format(new Date(actividad.fecha), "Pp") : "";
    return `${nombre} (${hora})`;
  };

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">{t("Resumen de Actividades por IDX")}</h2>

      <div className="flex gap-4 mb-4">
        <input
          type="text"
          placeholder={t("Buscar por IDX")}
          value={filtroIdx}
          onChange={(e) => setFiltroIdx(e.target.value)}
          className="border p-2 rounded"
        />
        <input
          type="date"
          value={fechaInicio}
          onChange={(e) => setFechaInicio(e.target.value)}
          className="border p-2 rounded"
        />
        <input
          type="date"
          value={fechaFin}
          onChange={(e) => setFechaFin(e.target.value)}
          className="border p-2 rounded"
        />
        <button
          className="bg-gray-300 px-4 py-2 rounded"
          onClick={limpiarFiltros}
        >
          {t("Limpiar filtros")}
        </button>
        <select
          value={modoAgrupacion}
          onChange={(e) => setModoAgrupacion(e.target.value)}
          className="border p-2 rounded"
        >
          <option value="idx">{t("Agrupar por IDX")}</option>
          <option value="fecha">{t("Agrupar por Fecha")}</option>
        </select>
      </div>

      <table className="w-full table-auto border-collapse">
        <thead>
          <tr className="bg-black text-white">
            <th className="border p-2">IDX</th>
            <th className="border p-2">{t("Producto")}</th>
            <th className="border p-2">{t("Cantidad")}</th>
            <th className="border p-2 bg-pink-200">Stage</th>
            <th className="border p-2 bg-orange-200">Label</th>
            <th className="border p-2 bg-yellow-200">Scan</th>
            <th className="border p-2 bg-green-200">Load</th>
            <th className="border p-2">{t("Notas")}</th>
          </tr>
        </thead>
        <tbody>
          {resumenData.filter(aplicarFiltros).map((item, index) => (
            <tr key={index}>
              <td className="border p-2">{item.idx}</td>
              <td className="border p-2">{productoDict[item.producto] || item.producto}</td>
              <td className="border p-2">{item.cantidad}</td>
              <td className="border p-2">{renderCelda(item.stage)}</td>
              <td className="border p-2">{renderCelda(item.label)}</td>
              <td className="border p-2">{renderCelda(item.scan)}</td>
              <td className="border p-2">{renderCelda(item.load)}</td>
              <td className="border p-2">{item.notas}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
