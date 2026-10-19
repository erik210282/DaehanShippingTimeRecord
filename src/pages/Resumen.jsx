import NativeShippingTableHint from "../components/NativeShippingTableHint";
import {useLiveVersion} from '../useLiveVersion';
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../supabase/client";
import { format } from "date-fns";
import { DSInput, DSDate, BtnSecondary, TablePagination } from "../components/controls";
import { isShippingVerified, legacyShippingCapture } from "../utils/shippingValidation";

const keepEqual = (previous, next) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next;

const SHIPPING_PHASES = ["stage", "label", "scan", "load"];
const labelLastFour = (value) => String(value || "").match(/\d{4}$/)?.[0] || "—";

export default function Resumen() {
 const liveVersion=useLiveVersion('Resumen');

  const { t } = useTranslation();
  const [result, setResult] = useState({ activities: [], captures: {}, total: 0 });
  const [loading, setLoading] = useState(true);
  const previousQuery = useRef(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [search, setSearch] = useState("");
  const [filtroIdx, setFiltroIdx] = useState("");
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");
  const [productosDict, setProductosDict] = useState({});
  const [partesDict, setPartesDict] = useState({});
  const [operadoresDict, setOperadoresDict] = useState({});
  const [actividadesDict, setActividadesDict] = useState({});
  const [shippingError, setShippingError] = useState("");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

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

  // Catalogs load concurrently; an empty catalog must not block the table.
  useEffect(() => {
    let active = true;
    Promise.all([
      supabase.from("actividades").select("id, nombre"),
      supabase.from("productos").select("id, nombre, part_number"),
      supabase.from("operadores").select("id, nombre"),
    ]).then(([activities, products, operators]) => {
      if (!active) return;
      const error = activities.error || products.error || operators.error;
      if (error) { setCatalogError(error.message); return; }
      setCatalogError("");
      setActividadesDict(previous => keepEqual(previous, Object.fromEntries((activities.data || []).map(a => [a.id, a.nombre?.toLowerCase().trim()]))));
      setProductosDict(previous => keepEqual(previous, Object.fromEntries((products.data || []).map(p => [p.id, p.nombre]))));
      setPartesDict(previous => keepEqual(previous, Object.fromEntries((products.data || []).map(p => [p.id, p.part_number || ""]))));
      setOperadoresDict(previous => keepEqual(previous, Object.fromEntries((operators.data || []).map(o => [o.id, o.nombre]))));
    }).catch(error => { if (active) setCatalogError(error.message); })
      .finally(() => { if (active) setCatalogLoading(false); });
    return () => { active = false; };
  }, [liveVersion]);

  // Wait for typing to pause before querying. Language changes only rerender.
  useEffect(() => {
    const timer = setTimeout(() => { setSearch(filtroIdx); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [filtroIdx]);

  useEffect(() => {
    let active = true;
    const query = JSON.stringify([page, pageSize, search, fechaInicio, fechaFin]);
    if (previousQuery.current !== query) setLoading(true);
    previousQuery.current = query;
    supabase.rpc("shipping_summary_page", {
      p_page: page, p_page_size: pageSize, p_idx: search,
      p_from: fechaInicio ? new Date(`${fechaInicio}T00:00:00`).toISOString() : null,
      p_to: fechaFin ? new Date(`${fechaFin}T23:59:59.999`).toISOString() : null,
    }).then(({ data, error }) => {
      if (!active) return;
      if (error) throw error;
      const next = { activities: data?.activities || [], captures: data?.captures || {}, total: data?.total || 0 };
      setResult(previous => keepEqual(previous, next));
      setShippingError("");
      if (data?.page && data.page !== page) setPage(data.page);
    }).catch(error => { if (active) setShippingError(error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, pageSize, search, fechaInicio, fechaFin, liveVersion]);

  const filasPagina = useMemo(() => {
    const data = result.activities;
    const capturas = result.captures;
      const agrupadas = {};

      data.forEach((act) => {
        if (act.estado !== "finalizada" || !act.idx) return;

        const key = act.idx;
        if (!agrupadas[key]) {
          agrupadas[key] = {
            idx: key,
            productos: [],
            cantidades: [],
            stage: null,
            label: null,
            scan: null,
            load: null,
            capturaLoad: null,
            notas: "",
            fechaNotas: null,
          };
        }

        if (Array.isArray(act.productos)) {
          act.productos.forEach((item) => {
            const nombreProducto = productosDict?.[item.producto];
            if (nombreProducto && !agrupadas[key].productos.some((p) => p.id === item.producto)) {
              agrupadas[key].productos.push({ id: item.producto, nombre: nombreProducto });
              agrupadas[key].cantidades.push(item.cantidad);
            }
          });
        }
        const nombreActividad = actividadesDict[act.actividad]?.toLowerCase().trim() || "";
         let operadorNombres = ["-"];
         if (Array.isArray(act.operadores)) {
           operadorNombres = act.operadores.map((id) => operadoresDict[id] || `ID:${id}`);
         } else if (typeof act.operadores === "string" && act.operadores.trim()) {
           operadorNombres = [operadoresDict[act.operadores] || act.operadores];
         }

        const fechaCorta = act.hora_inicio ? format(new Date(act.hora_inicio), "P") : "-";
        const hora = act.hora_inicio ? format(new Date(act.hora_inicio), "p") : "-";
        // Older IDX tasks can have a Load capture without a configured label plan.
        const captura = capturas[act.id] || legacyShippingCapture(act);
        const verificada = captura && isShippingVerified(act, captura, nombreActividad);
        const registro = (
          <>
             {operadorNombres.map((nombre, i) =>
               <span key={i} className="summary-operator">{nombre}</span>)}
             <span className="summary-date">{fechaCorta}</span>
             <span className="summary-time"><span>{hora}</span>
               {act.duracion !== null && act.duracion !== undefined && (
                 <span className="summary-duration">{Math.round(act.duracion)}m ({act.pausa_total === null ||
                   act.pausa_total === undefined ? "—" : Math.round(act.pausa_total)}m)</span>
               )}
             </span>
            {nombreActividad === "load" && captura && (
              <div className="summary-capture">
                <div>{t("shipping_start_label")}: {labelLastFour(captura.etiqueta_inicio)}</div>
                <div className="summary-capture-end">
                  <span>{t("shipping_end_label")}: {labelLastFour(captura.etiqueta_fin)}</span>
                  <strong style={{ color: verificada ? "#166534" : "#b45309" }}>
                    {verificada ? `✓ ${t("shipping_verified")}` : t("shipping_pending_verification")}
                  </strong>
                </div>
              </div>
            )}
          </>
        );

        if (nombreActividad) {
          if (SHIPPING_PHASES.includes(nombreActividad)) {
            agrupadas[key][nombreActividad] = registro;
            if (nombreActividad === "load") agrupadas[key].capturaLoad = captura || null;
          } else {
          }
        } else {
          // Muestra igual aunque el nombre aún no esté en actividadesDict
          agrupadas[key]["actividad_desconocida"] = registro;
        }

        if (!agrupadas[key].fechaNotas || new Date(act.createdAt) > new Date(agrupadas[key].fechaNotas)) {
          agrupadas[key].notas = act.comentario_actividad ?? act.notas ?? "";
          agrupadas[key].fechaNotas = act.createdAt;
        }
      });

      const resultado = Object.values(agrupadas).sort((a, b) => {
        const aNum = Number(a.idx);
        const bNum = Number(b.idx);

        // Si ambos idx son numéricos, ordena como números (descendente)
        if (!isNaN(aNum) && !isNaN(bNum)) {
          return bNum - aNum;
        }

        // Si alguno es alfanumérico, usa orden natural de texto (también descendente)
        return b.idx.localeCompare(a.idx, undefined, { numeric: true, sensitivity: "base" });
      });

      return resultado;
  }, [result, productosDict, partesDict, operadoresDict, actividadesDict, t]);
  const totalRows = result.total;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(Math.max(page, 1), totalPages);

  return (
    <div className="page-container page-container--fluid shipping-page shipping-summary">
      <div className="card">
        <h2>{t("summary")}</h2>
        {(shippingError || catalogError) && <p role="alert" style={{ color: "#b91c1c" }}>{t("shipping_captures_error")}: {shippingError || catalogError}</p>}
        {(loading || catalogLoading) && <p role="status">{t("loading")}</p>}
        <div className="shipping-filters" style={{ marginBottom: 12 }}>
          <DSInput
            type="text"
            placeholder={t("buscaridx")}
            value={filtroIdx}
            onChange={(e) => setFiltroIdx(e.target.value)}
            style={{ marginRight: 10, padding: 4 }}
          />
          <DSDate
            type="date"
            value={fechaInicio}
            onChange={(e) => { setFechaInicio(e.target.value); setPage(1); }}
            style={{ marginRight: 10, padding: 4 }}
          />
          <DSDate
            type="date"
            value={fechaFin}
            onChange={(e) => { setFechaFin(e.target.value); setPage(1); }}
            style={{ padding: 4 }}
          />
          <BtnSecondary type="button" style={{ marginLeft: 10 }} onClick={() => {
            setFiltroIdx("");
            setSearch("");
            setFechaInicio("");
            setFechaFin("");
            setPage(1);
          }}>{t("clear_filters")}</BtnSecondary>
        </div>

        <NativeShippingTableHint/>
        <div className="table-wrap shipping-table-scroll" aria-busy={loading || catalogLoading}>
          <table className="table summary-table">
            <colgroup>
              {[7, 10, 6, 13, 13, 13, 15, 7, 7, 9].map((width, i) =>
                <col key={i} style={{ width: `${width}%` }} />)}
            </colgroup>
            <thead>
              <tr>
                <th>{t("idxcode")}</th>
                <th>{t("product")}</th>
                <th>{t("quantity")}</th>
                <th>{t("stage")}</th>
                <th>{t("label")}</th>
                <th>{t("scan")}</th>
                <th>{t("load")}</th>
                <th>{t("shipping_door")}</th>
                <th>{t("shipping_trailer")}</th>
                <th>{t("notes")}</th>
              </tr>
            </thead>
            <tbody>
              {filasPagina.map((fila) => (
                <tr key={fila.idx}>
                  <td className="summary-nowrap" title={fila.idx}>{fila.idx}</td>
                  <td>
                    {fila.productos?.length
                      ? fila.productos.map((p) => <div key={p.id}>
                          {p.nombre}
                          {partesDict[p.id] && partesDict[p.id].toUpperCase() !== "NA" &&
                            <span className="summary-part">({partesDict[p.id]})</span>}
                        </div>)
                      : "-"}
                  </td>
                  <td>
                    {fila.cantidades?.length
                      ? fila.cantidades.map((c, i) => <div key={i}>{c}</div>)
                      : "-"}
                  </td>
                  <td style={{ backgroundColor: colorActividad("stage")}}>{fila.stage || "-"}</td>
                  <td style={{ backgroundColor: colorActividad("label")}}>{fila.label || "-"}</td>
                  <td style={{ backgroundColor: colorActividad("scan")}}>{fila.scan || "-"}</td>
                  <td style={{ backgroundColor: colorActividad("load")}}>{fila.load || "-"}</td>
                  <td className="summary-nowrap">{fila.capturaLoad?.puerta_fin || fila.capturaLoad?.puerta || "—"}</td>
                  <td className="summary-nowrap">{fila.capturaLoad?.trailer_fin || fila.capturaLoad?.trailer || "—"}</td>
                  <td>{fila.notas || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <TablePagination
              totalRows={totalRows}
              page={currentPage}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1); 
              }}
            />
        </div>
      </div>
    </div>
  );
}
