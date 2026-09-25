import React, { useEffect, useState } from "react";
import Modal from "react-modal";
import Papa from "papaparse";
import { useTranslation } from "react-i18next";
import { isAfter, isBefore, format } from "date-fns";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { supabase } from "../supabase/client";
import { fetchShippingCaptures, isShippingVerified, legacyShippingCapture } from "../utils/shippingValidation";
import {
  DSInput,
  DSSelect,
  BtnPrimary,
  BtnSecondary,
  BtnEditDark,
  BtnTinyRound,
  BtnDanger,
  DSDate,
  TextAreaStyle,
  TablePagination,
} from "../components/controls";

Modal.setAppElement("#root");

const roundMinutes = (value) => Math.round(value * 100) / 100;
const elapsedMinutes = (start, end) => {
  const minutes = (new Date(end).getTime() - new Date(start).getTime()) / 60000;
  return Number.isFinite(minutes) && minutes >= 0 ? roundMinutes(minutes) : null;
};
const formatRecordDate = (date, language) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ["—", "—"];
  return [
    date.toLocaleDateString(language),
    date.toLocaleTimeString(language, { hour: "numeric", minute: "2-digit", second: "2-digit" }),
  ];
};

export default function Registros() {
  const { t, i18n } = useTranslation();

  const [registros, setRegistros] = useState([]);
  const [filtrados, setFiltrados] = useState([]);

  const [actividadFiltro, setActividadFiltro] = useState([]);
  const [productoFiltro, setProductoFiltro] = useState([]);
  const [operadorFiltro, setOperadorFiltro] = useState([]);
  const [busquedaTexto, setBusquedaTexto] = useState("");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [errorFecha, setErrorFecha] = useState("");
  const [errorBusqueda, setErrorBusqueda] = useState("");

  const [modalAbierto, setModalAbierto] = useState(false);
  const [registroActual, setRegistroActual] = useState(null);
  const [esNuevo, setEsNuevo] = useState(false);
  const [saving, setSaving] = useState(false);

  const [mapaActividades, setMapaActividades] = useState({});
  const [mapaProductos, setMapaProductos] = useState({});
  const [mapaOperadores, setMapaOperadores] = useState({});

  const [selectActividades, setSelectActividades] = useState([]);
  const [selectProductos, setSelectProductos] = useState([]);
  const [selectOperadores, setSelectOperadores] = useState([]);
  const [operadoresCatalogo, setOperadoresCatalogo] = useState([]);

  const [registroAEliminar, setRegistroAEliminar] = useState(null);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const parseFecha = (fecha) => {
    if (!fecha) return null;
    if (typeof fecha === "string" || typeof fecha === "number") {
      const parsed = new Date(fecha);
      return isNaN(parsed) ? null : parsed;
    }
    return new Date(fecha); // Supabase ya devuelve ISO strings o Date
  };

const cargarCatalogos = async () => {
  try {
    const [{ data: actData, error: actErr }, { data: prodData, error: prodErr }, { data: opData, error: opErr }] =
      await Promise.all([
        supabase.from("actividades").select("id, nombre"),
        supabase.from("productos").select("id, nombre"),
        supabase.from("operadores").select("id, nombre, activo, inactive_since"),
      ]);

    if (actErr) console.error("[Registros] Error Actividades", actErr);
    if (prodErr) console.error("[Registros] Error Productos", prodErr);
    if (opErr) console.error("[Registros] Error Operadores", opErr);

    const actividades = {};
    const productos = {};
    const operadores = {};

    actData?.forEach((doc) => (actividades[doc.id] = doc.nombre));
    prodData?.forEach((doc) => (productos[doc.id] = doc.nombre));
    opData?.forEach((doc) => (operadores[doc.id] = doc.nombre));

    setMapaActividades(actividades);
    setMapaProductos(productos);
    setMapaOperadores(operadores);
    setOperadoresCatalogo(opData || []);

    setSelectActividades(
      actData
        ?.filter((doc) => doc.activo !== false)
        .map((doc) => ({ value: doc.id, label: doc.nombre }))
        .sort((a, b) => a.label.localeCompare(b.label)) || []
    );

    setSelectProductos(
      prodData
        ?.filter((doc) => doc.activo !== false)
        .map((doc) => ({ value: doc.id, label: doc.nombre }))
        .sort((a, b) => a.label.localeCompare(b.label)) || []
    );

    setSelectOperadores(
      opData
        ?.filter((doc) => doc.activo === true)
        .map((doc) => ({ value: doc.id, label: doc.nombre }))
        .sort((a, b) => a.label.localeCompare(b.label)) || []
    );
  } catch (e) {
  }
};

const actualizarRegistros = async () => {
  const PAGE = 1000;
  let from = 0;
  let acumulado = [];

  while (true) {
    const { data: chunk, error } = await supabase
      .from("actividades_realizadas")
      .select("*")
      .order("hora_inicio", { ascending: false }) // puedes usar "createdAt" si prefieres
      .range(from, from + PAGE - 1);

    if (error) {
      return;
    }
    if (!chunk || chunk.length === 0) break;

    acumulado = acumulado.concat(chunk);
    if (chunk.length < PAGE) break;
    from += PAGE;
  }

  let capturas;
  try {
    capturas = await fetchShippingCaptures();
  } catch (error) {
    toast.error(error.message || t("shipping_captures_error"));
    return;
  }

  const nuevos = (acumulado || []).map((doc) => ({
    id: doc.id,
    idx: doc.idx || "",
    ...doc,
    shipping_capture: capturas[doc.id] || legacyShippingCapture(doc),
    operadores: Array.isArray(doc.operadores)
      ? doc.operadores
      : typeof doc.operador === "string" && doc.operador.trim()
      ? [doc.operador]
      : [],
    horaInicio: parseFecha(doc.hora_inicio),
    horaFin: parseFecha(doc.hora_fin),
    duracion: doc.duracion ?? "",
  }));

  // orden descendente por horaInicio como ya lo tenías
  nuevos.sort((a, b) => new Date(b.horaInicio) - new Date(a.horaInicio));
  setRegistros(nuevos);
  setFiltrados(nuevos);
};

  useEffect(() => {
  cargarCatalogos();
  actualizarRegistros(); // carga inicial

  const refreshOperators = () => {
    if (document.visibilityState === "visible") cargarCatalogos();
  };
  window.addEventListener("focus", refreshOperators);
  document.addEventListener("visibilitychange", refreshOperators);

  const canal = supabase
    .channel("Registros - onSnapshot Actualizar registros 4")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "actividades_realizadas",
      },
      () => {
        actualizarRegistros(); // recarga en tiempo real
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(canal);
    window.removeEventListener("focus", refreshOperators);
    document.removeEventListener("visibilitychange", refreshOperators);
  };
}, []);

  useEffect(() => {
  if (errorFecha) {
    setErrorFecha(t("invalid_date_range")); // Vuelve a traducir el error al cambiar idioma
  }
}, [i18n.language]);

useEffect(() => {
  if (fechaDesde && fechaHasta) {
    const desde = new Date(fechaDesde);
    const hasta = new Date(fechaHasta);
    hasta.setHours(23, 59, 59, 999);

    if (desde > hasta) {
      setErrorFecha(t("invalid_date_range"));
    } else {
      setErrorFecha("");
    }
  }
}, [fechaDesde, fechaHasta, t]);

 useEffect(() => {
  const texto = busquedaTexto.toLowerCase();

  const resultados = registros.filter((r) => {
    if (!r.horaFin) return false;

    const cumpleActividad =
      actividadFiltro.length === 0 ||
      actividadFiltro.some((a) => a.value === r.actividad);

    const cumpleProducto =
      productoFiltro.length === 0 ||
      (Array.isArray(r.productos) &&
        productoFiltro.some((o) => 
          r.productos.some((p) => mapaProductos[p.producto]?.toLowerCase().includes(o.label.toLowerCase()))
        ));

    const cumpleOperador =
      operadorFiltro.length === 0 ||
      (Array.isArray(r.operadores) &&
        operadorFiltro.some((o) => r.operadores.includes(o.value)));

    const cumpleTexto =
      !texto ||
      mapaActividades[r.actividad]?.toLowerCase().includes(texto) ||
      r.productos?.some(
        (p) => mapaProductos[p.producto]?.toLowerCase().includes(texto)
      ) ||
      r.operadores?.some(
        (id) => mapaOperadores[id]?.toLowerCase().includes(texto)
      ) ||
      (r.idx && r.idx.toLowerCase().includes(texto)) ||
      [r.shipping_capture?.trailer, r.shipping_capture?.puerta,
        r.shipping_capture?.etiqueta_inicio, r.shipping_capture?.etiqueta_fin]
        .some((valor) => valor?.toLowerCase().includes(texto));

    const fechaInicio =
      r.horaInicio instanceof Date ? r.horaInicio : new Date(r.horaInicio);

    const limiteDesde = fechaDesde ? new Date(`${fechaDesde}T00:00:00`) : null;
    const limiteHasta = fechaHasta ? new Date(`${fechaHasta}T23:59:59.999`) : null;
    const cumpleDesde = !limiteDesde || fechaInicio >= limiteDesde;
    const cumpleHasta = !limiteHasta || fechaInicio <= limiteHasta; 

    return (
      cumpleActividad &&
      cumpleProducto &&
      cumpleOperador &&
      cumpleTexto &&
      cumpleDesde &&
      cumpleHasta
    );
  });

  resultados.sort((a, b) => new Date(b.horaInicio) - new Date(a.horaInicio));

  setFiltrados(resultados);
  setErrorBusqueda(texto && resultados.length === 0 ? t("no_results_found") : "");
  setPage(1);
}, [
  actividadFiltro,
  productoFiltro,
  operadorFiltro,
  busquedaTexto,
  fechaDesde,
  fechaHasta,
  registros,
  t,
]);

 const abrirModal = (registro) => {
  if (registro) {
    const formatFecha = (fecha) => {
      if (!fecha) return "";
      const d = new Date(fecha);
      const pad = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };

    setRegistroActual({
      ...registro,
      notas: registro.comentario_actividad ?? registro.notas ?? "",
      productos: Array.isArray(registro.productos)
        ? registro.productos
        : [{ producto: registro.producto, cantidad: registro.cantidad }],
      horaInicio: formatFecha(registro.horaInicio),
      horaFin: formatFecha(registro.horaFin),
      pausa_total: registro.pausa_total ?? 0,
      shipping_edit: {
        etiqueta_inicio: registro.shipping_capture?.etiqueta_inicio || "",
        etiqueta_fin: registro.shipping_capture?.etiqueta_fin || "",
        puerta: registro.shipping_capture?.puerta || "",
        puerta_fin: registro.shipping_capture?.puerta_fin || "",
        trailer: registro.shipping_capture?.trailer || "",
        trailer_fin: registro.shipping_capture?.trailer_fin || "",
      },
    });
    setEsNuevo(false);
  } else {
    setRegistroActual({
      idx: "",
      actividad: "",
      productos: [{ producto: "", cantidad: "" }],
      operadores: [],
      cantidad: "",
      horaInicio: "",
      horaFin: "",
      duracion: "", 
      pausa_total: 0,
      notas: "",
    });
    setEsNuevo(true);
  }
  setModalAbierto(true);
};

 const cambiarFechaRegistro = (campo, value) => {
   setRegistroActual((actual) => {
     const nuevo = { ...actual, [campo]: value };
     const elapsed = elapsedMinutes(nuevo.horaInicio, nuevo.horaFin);
     if (elapsed !== null) {
       const paused = Math.min(elapsed, Math.max(0, Number(nuevo.pausa_total) || 0));
       nuevo.pausa_total = roundMinutes(paused);
       nuevo.duracion = roundMinutes(elapsed - paused);
     }
     return nuevo;
   });
 };

 const cambiarMinutosRegistro = (campo, value) => {
   setRegistroActual((actual) => {
     const elapsed = elapsedMinutes(actual.horaInicio, actual.horaFin);
     const numeric = value === "" ? "" : Math.max(0, Number(value));
     const nuevo = { ...actual, [campo]: numeric };
     if (elapsed !== null && numeric !== "") {
       if (campo === "duracion") nuevo.pausa_total = roundMinutes(Math.max(0, elapsed - numeric));
       else nuevo.duracion = roundMinutes(Math.max(0, elapsed - numeric));
     }
     return nuevo;
   });
 };

 const cambiarCaptura = (campo, value) => setRegistroActual((actual) => ({
   ...actual,
   shipping_edit: { ...actual.shipping_edit, [campo]: value.toUpperCase() },
 }));

 const operadoresEditables = [...selectOperadores];
 if (!esNuevo && registroActual?.estado === "finalizada") {
   const fin = new Date(registroActual.horaFin);
   operadoresCatalogo.forEach((op) => {
     if (op.activo === true || operadoresEditables.some((option) => option.value === op.id)) return;
     const yaRegistrado = registroActual.operadores?.includes(op.id);
     const activoEntonces = op.inactive_since && !Number.isNaN(fin.getTime()) &&
       fin < new Date(op.inactive_since);
     if (yaRegistrado || activoEntonces) {
       operadoresEditables.push({ value: op.id, label: op.nombre });
     }
   });
 }

  const eliminarRegistro = async (id) => {
  try {
    const { error } = await supabase
      .from("actividades_realizadas")
      .delete()
      .eq("id", id);

    // Reemplazo de trackedDeleteDoc (puedes adaptarlo a tu sistema si lo tienes en Supabase)
    if (error) throw error;

    setRegistros(registros.filter((r) => r.id !== id));
    toast.success(t("delete_success"));
  } catch (e) {
    toast.error(t("error_deleting"));
  }
};

 const guardarRegistro = async () => {
   if (saving) return;
   const {
    idx,
    actividad,
    productos,
    operadores,
    notas,
    horaInicio,
    horaFin,
     duracion,
     pausa_total,
  } = registroActual;

  if (
    !idx ||
    !actividad ||
    !productos.length ||
    !operadores.length ||
    !horaInicio ||
    !horaFin ||
     duracion === "" || duracion === null
  ) {
    toast.error(t("fill_all_fields"));
    return;
  }

  const productosLimpios = productos.map((p) => ({
    producto: p.producto,
    cantidad: Number(p.cantidad),
  }));

  if (
    productosLimpios.some(
      (p) => !p.producto || isNaN(p.cantidad) || p.cantidad <= 0
    )
  ) {
    toast.error(t("fill_all_fields"));
    return;
  }

  const productosDuplicados = productosLimpios
    .map((p) => p.producto)
    .filter((v, i, a) => a.indexOf(v) !== i);

  if (productosDuplicados.length > 0) {
    toast.error(t("no_duplicate_products"));
    return;
  }

  if (!esNuevo) {
    const duplicado = registros.some(
      (r) =>
        r.id !== registroActual.id &&
        r.actividad === actividad &&
        JSON.stringify((r.operadores || []).sort()) ===
          JSON.stringify([...operadores].sort()) &&
        new Date(r.hora_inicio).getTime() === new Date(horaInicio).getTime() &&
        new Date(r.hora_fin).getTime() === new Date(horaFin).getTime()
    );

    if (duplicado) {
      toast.error(t("no_duplicate_activity"));
      return;
    }
  }

  if (new Date(horaInicio).getTime() > new Date(horaFin).getTime()) {
    toast.error(t("invalid_time_range"));
    return;
  }
  const elapsed = elapsedMinutes(horaInicio, horaFin);
  if (elapsed === null || !Number.isFinite(Number(duracion)) ||
      !Number.isFinite(Number(pausa_total)) || Number(duracion) < 0 ||
      Number(pausa_total) < 0 || Number(duracion) > elapsed + 0.01 ||
      Number(pausa_total) > elapsed + 0.01) {
    toast.error(t("invalid_duration_pause"));
    return;
  }

  const data = {
    idx,
    actividad,
    productos: productosLimpios,
    operadores,
    notas: notas || "",
    hora_inicio: new Date(horaInicio),
    hora_fin: new Date(horaFin),
    duracion: Number(duracion),
    pausa_total: Number(pausa_total),
    ...(!esNuevo && registroActual.comentario_actividad !== null &&
      registroActual.comentario_actividad !== undefined
      ? { comentario_actividad: notas || "" }
      : {}),
  };

  setSaving(true);
  try {
    if (esNuevo) {
      const { error } = await supabase
        .from("actividades_realizadas")
        .insert([data]);
      if (error) throw error;
    } else {
      const { error } = await supabase.rpc("shipping_supervisor_edit_record", {
        p_actividad: registroActual.id,
        p_record: data,
        p_capture: registroActual.shipping_edit,
      });
      if (error) throw error;
    }

    await actualizarRegistros();
    toast.success(t("save_success"));
    setModalAbierto(false);
  } catch (error) {
    toast.error(error.message || t("error_saving"));
  } finally {
    setSaving(false);
  }
};

  const exportarCSV = () => {
  const datosCSV = filtrados.flatMap((d) => {
    const inicio = new Date(d.horaInicio);
    const fin = new Date(d.horaFin);

    return (Array.isArray(d.productos) ? d.productos : [{ producto: d.producto, cantidad: d.cantidad }]).map((p) => ({
      [t("idx")]: d.idx || "N/A",
      [t("activity")]: mapaActividades[d.actividad] || `ID: ${d.actividad}`,
      [t("product")]: mapaProductos[p.producto] || `ID: ${p.producto}`,
      [t("operator")]: Array.isArray(d.operadores)
        ? d.operadores.map((id) => mapaOperadores[id] || `ID: ${id}`).join(", ")
        : "",
      [t("amount")]: p.cantidad,
      [t("start_time")]: inicio.toLocaleString(),
      [t("end_time")]: fin.toLocaleString(),
      [t("duration_min")]: d.duracion ? Math.round(d.duracion) : "-",
      [t("pausas")]: typeof d.pausa_total === "number" ? Math.round(d.pausa_total) : "-",
      [t("notes")]: d.comentario_actividad ?? d.notas ?? "N/A",
      ["Supervisor instructions"]: d.instrucciones_supervisor || "",
      [t("shipping_start_label")]: d.shipping_capture?.etiqueta_inicio || "",
      [t("shipping_end_label")]: d.shipping_capture?.etiqueta_fin || "",
      [t("shipping_trailer_start")]: d.shipping_capture?.trailer || "",
      [t("shipping_trailer_end")]: d.shipping_capture?.trailer_fin || "",
      [t("shipping_door_start")]: d.shipping_capture?.puerta || "",
      [t("shipping_door_end")]: d.shipping_capture?.puerta_fin || "",
      [t("shipping_validation")]: d.shipping_capture
        ? (isShippingVerified(d, d.shipping_capture, mapaActividades[d.actividad])
          ? t("shipping_verified") : t("shipping_pending_verification"))
        : "",
    }));
  });

  const csv = Papa.unparse(datosCSV);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", "registros.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  toast.success(t("export_success") || "CSV exportado correctamente");
};

  // ==========================
  // Paginado: cálculo de filas
  // ==========================
  const totalRows = filtrados.length;
  const totalPages = Math.max(1, Math.ceil((totalRows || 0) / pageSize));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const filasPagina = filtrados.slice(startIndex, endIndex);

  return (
    <div className="page-container page-container--fluid">
      <div className="card">
      <h2>{t("records")}</h2>

      <div>
          <div style={{ display: "flex", gap: "10px", marginBottom: "10px" }}>
            <DSInput placeholder={t("search")} value={busquedaTexto} onChange={(e) => setBusquedaTexto(e.target.value)} />
            {errorBusqueda && <p style={{ color: "red" }}>{errorBusqueda}</p>}
            <DSDate value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} />
            <DSDate value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} />
            {errorFecha && <p style={{ color: "red" }}>{errorFecha}</p>}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(150px, 1fr))", gap: "10px", marginBottom: "10px"}}>
            <DSSelect isMulti options={selectActividades} value={actividadFiltro} onChange={setActividadFiltro} placeholder={t("select_activity")} />
            <DSSelect isMulti options={selectProductos} value={productoFiltro} onChange={setProductoFiltro} placeholder={t("select_product")} />
            <DSSelect isMulti options={selectOperadores} value={operadorFiltro} onChange={setOperadorFiltro} placeholder={t("select_operators")} />
          </div>

          <div style={{ display: "flex", gap: "10px", marginBottom: "10px" }}>
            <BtnSecondary onClick={() => {
              setActividadFiltro([]); setProductoFiltro([]); setOperadorFiltro([]);
              setBusquedaTexto(""); setFechaDesde(""); setFechaHasta("");
            }}>{t("clear_filters")}</BtnSecondary>
            <BtnSecondary onClick={exportarCSV}>{t("export_csv")}</BtnSecondary>
            <BtnPrimary  onClick={() => abrirModal()}>
              ➕ {t("add_record")}
            </BtnPrimary>        
          </div>  

          <div className="table-wrap">
            <table className="table records-table">
              <colgroup>
                {[6, 5, 8, 4, 9, 8, 8, 6, 9, 7, 8, 6, 11, 5].map((width, i) =>
                  <col key={i} style={{ width: `${width}%` }} />)}
              </colgroup>
              <thead>
                <tr>
                  <th>{t("idx")}</th>
                  <th>{t("activity")}</th>
                  <th>{t("product")}</th>
                  <th>{t("amount")}</th>
                  <th>{t("operator")}</th>
                  <th>{t("start_time")}</th>
                  <th>{t("end_time")}</th>
                   <th>{t("duration_pause_short")}</th>
                   <th>{t("shipping_labels")}</th>
                   <th>{t("shipping_door")}</th>
                   <th>{t("shipping_trailer")}</th>
                  <th>{t("shipping_validation")}</th>
                  <th>{t("notes")}</th>
                  <th>{t("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filasPagina.map((r) => {
                  const inicio = new Date(r.horaInicio);
                  const fin = new Date(r.horaFin);
                   const captura = r.shipping_capture;
                   const validado = captura && isShippingVerified(r, captura, mapaActividades[r.actividad]);
                   const startParts = formatRecordDate(inicio, i18n.language);
                   const endParts = formatRecordDate(fin, i18n.language);
                   return (
                     <tr key={r.id}>
                       <td className="records-nowrap" title={r.idx}>{r.idx || "N/A"}</td>
                      <td>{mapaActividades[r.actividad] || `ID: ${r.actividad}`}</td>
                     <td>
                      {Array.isArray(r.productos)
                        ? r.productos.map((p, i) => (
                            <div key={i}>{mapaProductos[p.producto] || `ID: ${p.producto}`}</div>
                          ))
                        : mapaProductos[r.producto]}
                    </td>
                    <td className="records-amount">
                      {Array.isArray(r.productos)
                        ? r.productos.map((p, i) => (
                            <div key={i}>{p.cantidad}</div>
                          ))
                        : r.cantidad}
                    </td>
                      <td>{r.operadores && Array.isArray(r.operadores) ? r.operadores.map((id) => mapaOperadores[id] || `ID: ${id}`).join(", ") : "N/A"}</td>
                       <td className="records-date"><div>{startParts[0]}</div><div>{startParts[1]}</div></td>
                       <td className="records-date"><div>{endParts[0]}</div><div>{endParts[1]}</div></td>
                       <td className="records-nowrap" title={`${r.duracion ?? "—"} / ${r.pausa_total ?? "—"} min`}>
                         {r.duracion === null || r.duracion === undefined ? "—" : Math.round(r.duracion)}
                         m ({r.pausa_total === null || r.pausa_total === undefined
                           ? "—" : Math.round(r.pausa_total)}m)
                       </td>
                       <td className="records-labels">
                         {captura?.etiqueta_inicio || captura?.etiqueta_fin ? (
                           <>
                             <div>{t("shipping_start_label")}: {captura.etiqueta_inicio || "—"}</div>
                             <div>{t("shipping_end_label")}: {captura.etiqueta_fin || "—"}</div>
                           </>
                         ) : "—"}
                       </td>
                       <td className="records-nowrap" title={[captura?.puerta, captura?.puerta_fin].filter(Boolean).join(" → ")}>{captura?.puerta || captura?.puerta_fin
                         ? captura.puerta_fin && captura.puerta && captura.puerta_fin !== captura.puerta
                           ? `${captura.puerta} → ${captura.puerta_fin}` : captura.puerta
                             || captura.puerta_fin
                         : "—"}</td>
                       <td className="records-nowrap" title={[captura?.trailer, captura?.trailer_fin].filter(Boolean).join(" → ")}>{captura?.trailer || captura?.trailer_fin
                         ? captura.trailer_fin && captura.trailer && captura.trailer_fin !== captura.trailer
                           ? `${captura.trailer} → ${captura.trailer_fin}` : captura.trailer
                             || captura.trailer_fin
                         : "—"}</td>
                      <td>{captura ? (
                        <strong style={{ color: validado ? "#166534" : "#b45309" }}>
                          {validado ? `✓ ${t("shipping_verified")}` : t("shipping_pending_verification")}
                        </strong>
                      ) : "—"}</td>
                       <td title={[r.instrucciones_supervisor, r.comentario_actividad ?? r.notas].filter(Boolean).join(" | ")}>
                         <div className="records-note">
                         {r.instrucciones_supervisor && (
                           <div><strong>Supervisor:</strong> {r.instrucciones_supervisor}</div>
                         )}
                         <div>{r.comentario_actividad ?? r.notas ?? "-"}</div>
                         </div>
                       </td>
                       <td>
                         <div className="records-actions">
                           <BtnEditDark style={{ width: "100%", padding: "4px 2px" }} onClick={() => abrirModal(r)}>{t("edit")}</BtnEditDark>
                           <BtnDanger style={{ width: "100%", padding: "4px 2px" }}
                            onClick={() => setRegistroAEliminar(r)}
                          >
                            {t("delete")}
                          </BtnDanger >
                        </div>
                      </td>
                    </tr>
                  );
                })}
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
              pageSizeOptions={[25, 50, 100, 200]}
            />
          </div>
        </div>
    
        <Modal isOpen={modalAbierto} onRequestClose={() => setModalAbierto(false)}
          style={{
            content: {
              width: "70%",         
              maxWidth: "100%",    
              margin: "0 auto",
            }
          }}
          >
          <h3>{esNuevo ? t("add") : t("edit")}</h3>

          <DSInput
            type="text"
            placeholder={t("idx")}
            value={registroActual?.idx}
            onChange={(e) => setRegistroActual({ ...registroActual, idx: e.target.value })}
          />

          <DSSelect options={selectActividades} value={selectActividades.find((i) => i.value === registroActual?.actividad)} onChange={(e) => setRegistroActual({ ...registroActual, actividad: e.value })} placeholder={t("select_activity")} />

          {registroActual?.productos?.map((p, index) => (
            <div key={index} style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
              <DSSelect
                options={selectProductos}
                value={selectProductos.find((opt) => opt.value === p.producto) || null}
                onChange={(e) => {
                  const nuevos = [...registroActual.productos];
                  nuevos[index].producto = e.value;
                  setRegistroActual({ ...registroActual, productos: nuevos });
                }}
                placeholder={t("select_product")}
                styles={{ container: (base) => ({ ...base, flex: 1 }) }}
              />
              <DSInput
                type="number"
                placeholder={t("amount")}
                value={p.cantidad}
                onChange={(e) => {
                  const nuevos = [...registroActual.productos];
                  nuevos[index].cantidad = e.target.value;
                  setRegistroActual({ ...registroActual, productos: nuevos });
                }}
                style={{ maxWidth: 160 }}
              />
              {index > 0 && (
                <BtnTinyRound type="button" onClick={() => {
                  const nuevos = registroActual.productos.filter((_, i) => i !== index);
                  setRegistroActual({ ...registroActual, productos: nuevos });
                }}
                >✖</BtnTinyRound>
              )}
            </div>
          ))}
          <BtnSecondary type="button"
            onClick={() => setRegistroActual({
              ...registroActual,
              productos: [...registroActual.productos, { producto: "", cantidad: "" }],
            })}
            style={{ marginTop: "10px" }}
          >
            ➕ {t("add_product")}
          </BtnSecondary>
          <div style={{ marginTop: 12 }}></div>
          <DSSelect isMulti options={operadoresEditables} value={operadoresEditables.filter((i) => registroActual?.operadores?.includes(i.value))} onChange={(e) => setRegistroActual({ ...registroActual, operadores: e.map((i) => i.value) })} placeholder={t("select_operator")} />
          <TextAreaStyle value={registroActual?.notas} onChange={(e) => setRegistroActual({ ...registroActual, notas: e.target.value })} placeholder={t("notes")} rows={3} style={{ marginTop: 10, minHeight: 90, width: "85%", }} />
           <div className="records-edit-grid">
             <label>{t("start_time")}
               <DSDate type="datetime-local" step="1" value={registroActual?.horaInicio || ""}
                 onChange={(e) => cambiarFechaRegistro("horaInicio", e.target.value)} />
             </label>
             <label>{t("end_time")}
               <DSDate type="datetime-local" step="1" value={registroActual?.horaFin || ""}
                 onChange={(e) => cambiarFechaRegistro("horaFin", e.target.value)} />
             </label>
             <label>{t("duration_min")}
               <DSInput type="number" min="0" step="0.01"
                 value={registroActual?.duracion ?? ""}
                 onChange={(e) => cambiarMinutosRegistro("duracion", e.target.value)} />
             </label>
             <label>{t("pausas")}
               <DSInput type="number" min="0" step="0.01"
                 value={registroActual?.pausa_total ?? ""}
                 onChange={(e) => cambiarMinutosRegistro("pausa_total", e.target.value)} />
             </label>
           </div>
           {!esNuevo && (
             <div className="records-shipping-editor">
               <h4>{t("shipping_capture_details")}</h4>
               <div className="records-edit-grid">
                 {[
                   ["etiqueta_inicio", "shipping_start_label"],
                   ["etiqueta_fin", "shipping_end_label"],
                   ["puerta", "shipping_door_start"],
                   ["puerta_fin", "shipping_door_end"],
                   ["trailer", "shipping_trailer_start"],
                   ["trailer_fin", "shipping_trailer_end"],
                 ].map(([campo, translation]) => (
                   <label key={campo}>{t(translation)}
                     <DSInput type="text" value={registroActual?.shipping_edit?.[campo] || ""}
                       onChange={(e) => cambiarCaptura(campo, e.target.value)} />
                   </label>
                 ))}
               </div>
             </div>
           )}
          <div style={{ display: "flex", gap: "10px", marginTop: "12px" }}>
             <BtnPrimary type="button" onClick={guardarRegistro} disabled={saving}>{t("save")}</BtnPrimary>
            <BtnSecondary type="button" onClick={() => setModalAbierto(false)}>{t("cancel")}</BtnSecondary>
          </div>
        </Modal>  

        {registroAEliminar && registroAEliminar.id && (
          <Modal
            isOpen={true}
            onRequestClose={() => setRegistroAEliminar(null)}
            className="modal"
            overlayClassName="modal-overlay"
          >
            <h2>{t("confirm_delete_title")}</h2>
            <p>{t("confirm_delete_text")}</p>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "1rem" }}>
              <BtnSecondary
                onClick={() => setRegistroAEliminar(null)}
              >
                {t("cancel")}
              </BtnSecondary>

              <BtnDanger
                onClick={async () => {
                  try {
                    const { error } = await supabase
                      .from("actividades_realizadas")
                      .delete()
                      .eq("id", registroAEliminar.id);

                    if (error) throw error;

                    setRegistros((prev) =>
                      prev.filter((r) => r.id !== registroAEliminar.id)
                    );
                    toast.success(t("delete_success"));
                  } catch (error) {
                    toast.error(t("delete_error"));
                  } finally {
                    setRegistroAEliminar(null);
                  }
                }}
              >
                {t("confirm")}
              </BtnDanger>
            </div>
          </Modal>
        )}
        <ToastContainer
          position="top-center"
          autoClose={1500}
          style={{ zIndex: 9999, top: "80px" }}
        />
      </div>
    </div>
  );
}
