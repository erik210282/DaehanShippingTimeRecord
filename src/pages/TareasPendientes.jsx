import React, { useEffect, useState, useMemo } from "react";
import { supabase } from "../supabase/client";
import Modal from "react-modal";
import { useLocation } from "react-router-dom";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { useTranslation } from "react-i18next";
import {
  DSSelect,
  BtnPrimary,
  BtnSecondary,
  BtnEditDark,
  BtnTinyRound,
  BtnDanger,
  PillInput,
  PillInputNumber,
  TextAreaStyle,
  TablePagination,
} from "../components/controls";

Modal.setAppElement("#root");

let canalTareas = null;
const SHIPPING_PHASES = ["stage", "label", "scan", "load"];
const EMPTY_CONTAINER_PRODUCTS = new Set(["delivery", "empty crates", "empty"]);

export default function TareasPendientes() {
  const location = useLocation();
  const [tareas, setTareas] = useState([]);
  const [actividades, setActividades] = useState({});
  const [productos, setProductos] = useState({});
  const [partes, setPartes] = useState({});
  const [modalAbierto, setModalAbierto] = useState(false);
  const [tareaActual, setTareaActual] = useState(null);
  const { t, i18n } = useTranslation();
  const [tareaAEliminar, setTareaAEliminar] = useState(null);
  const [operadores, setOperadores] = useState({});
  const [esSupervisor, setEsSupervisor] = useState(false);
  const [controlTarea, setControlTarea] = useState(null);
  const [controlOperadores, setControlOperadores] = useState([]);
  const [controlDock, setControlDock] = useState("");
  const [controlTrailer, setControlTrailer] = useState("");
  const [controlEtiqueta, setControlEtiqueta] = useState("");
  const [guardandoControl, setGuardandoControl] = useState(false);
  const [etiquetasTarea, setEtiquetasTarea] = useState(null);
  const [lineasEtiqueta, setLineasEtiqueta] = useState([]);
  const [editandoLinea, setEditandoLinea] = useState(null);
  const [nuevaEtiqueta, setNuevaEtiqueta] = useState("");
  const [guardandoEtiqueta, setGuardandoEtiqueta] = useState(false);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Drag & Drop state
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);

  const isShippingActivity = (id) => SHIPPING_PHASES.includes(
    (actividades[id] || "").toLowerCase().trim()
  );
  const isEmptyContainer = (id) => EMPTY_CONTAINER_PRODUCTS.has(
    (productos[id] || "").toLowerCase().trim()
  );
  const isLoad = (id) => (actividades[id] || "").toLowerCase().trim() === "load";
  const requiereEtiqueta = (tarea) => isLoad(tarea.actividad) &&
    tarea.productos?.some((p) => !isEmptyContainer(p.producto));
  const productLabel = (id, nombre) => {
    const part = partes[id]?.trim();
    return part && part.toUpperCase() !== "NA" ? `${nombre} (${part})` : nombre;
  };

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

  // Función para obtener tareas pendientes
  const fetchTareas = async () => {
    const { data, error } = await supabase
      .from("tareas_pendientes")
      .select("*")
      .not("estado", "eq", "finalizada")
      .order("prioridad", { ascending: true })
      .order("createdAt", { ascending: true });

    if (error) {
      return;
    }
    if (data) setTareas(data);
  };

  // Función para obtener actividades
  const fetchActividades = async () => {
    const { data, error } = await supabase
      .from("actividades")
      .select("id, nombre, activo");

    if (!error && data) {
      const act = {};
      data.forEach((doc) => {
        if (doc.activo !== false) act[doc.id] = doc.nombre;
      });
      const ordenadas = Object.fromEntries(
        Object.entries(act).sort(([, a], [, b]) => a.localeCompare(b))
      );
      setActividades(ordenadas);
    }
  };

  // Función para obtener productos
  const fetchProductos = async () => {
    const { data, error } = await supabase
      .from("productos")
      .select("id, nombre, part_number, activo");

    if (!error && data) {
      const prod = {};
      data.forEach((doc) => {
        if (doc.activo !== false) prod[doc.id] = doc.nombre;
      });
      setPartes(Object.fromEntries(data.map((doc) => [doc.id, doc.part_number || ""])));
      const ordenadas = Object.fromEntries(
        Object.entries(prod).sort(([, a], [, b]) => a.localeCompare(b))
      );
      setProductos(ordenadas);
    }
  };

  const fetchOperadores = async () => {
    const { data, error } = await supabase
      .from("operadores")
      .select("id, nombre, activo");

    if (!error && data) {
      const ops = {};
      data.forEach((doc) => {
        if (doc.activo === true) ops[doc.id] = doc.nombre;
      });
      const ordenadas = Object.fromEntries(
        Object.entries(ops).sort(([, a], [, b]) => a.localeCompare(b))
      );
      setOperadores(ordenadas);
    }
  };

  useEffect(() => {
    if (location.pathname !== "/tareas-pendientes") return;
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchTareas();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    fetchActividades();
    fetchProductos();
    fetchOperadores();
    fetchTareas();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { setEsSupervisor(false); return; }
      const { data } = await supabase.from("operadores")
        .select("role, activo").eq("uid", user.id).maybeSingle();
      setEsSupervisor(data?.activo === true && data?.role === "supervisor");
    });

    // Canal principal para tareas_pendientes (se reutiliza si ya existe)
    if (!canalTareas) {
      canalTareas = supabase
        .channel("canal_tareas")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "tareas_pendientes" },
          fetchTareas
        )
        .subscribe((status) => {
        });
    } else {
    }

    // Canales locales para catálogos
    const canalActividades = supabase
      .channel("canal_actividades")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "actividades" },
        fetchActividades
      )
      .subscribe();

    const canalProductos = supabase
      .channel("canal_productos")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "productos" },
        fetchProductos
      )
      .subscribe();

    const canalOperadores = supabase
      .channel("canal_operadores")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "operadores" },
        fetchOperadores
      )
      .subscribe();

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);

      if (canalTareas) {
        supabase.removeChannel(canalTareas);
        canalTareas = null;
      }

      supabase.removeChannel(canalActividades);
      supabase.removeChannel(canalProductos);
      supabase.removeChannel(canalOperadores);
    };
  }, [location.pathname]);

  const abrirModal = async (tarea = null) => {
    if (!tarea) {
      setTareaActual({
        idx: "",
        actividad: "",
        productos: [{ producto: "", cantidad: "" }],
        operadores: [],
        notas: "",
        instrucciones_supervisor: "",
        es_urgente: false,
        mismo_dia: false,
        estado: "pendiente",
        prioridad: getNextPriority(),
      });
      setModalAbierto(true);
      return;
    }

    // Forzar lectura desde Supabase para asegurar la versión actualizada
    const { data, error } = await supabase
      .from("tareas_pendientes")
      .select("*")
      .eq("id", tarea.id)
      .single();

    if (error || !data) {
      toast.error(t("error_loading_task"));
      return;
    }

    setTareaActual({
      ...data,
      productos: data.productos || [{ producto: "", cantidad: "" }],
      operadores: data.operadores || [],
      notas: data.notas || "",
      instrucciones_supervisor: data.instrucciones_supervisor ?? data.notas ?? "",
      es_urgente: data.es_urgente === true,
      mismo_dia: data.mismo_dia === true,
      _idxOriginal: data.idx,
      _seriesOriginal: JSON.stringify((data.productos || []).filter((p) => !isEmptyContainer(p.producto)).map((p) => ({
        idx_line: p.idx_line || "", primera_etiqueta: p.primera_etiqueta || "",
        producto: p.producto, cantidad: Number(p.cantidad),
      }))),
      estado: data.estado || "pendiente",
    });

    setModalAbierto(true);
  };

  const getNextPriority = () => {
    if (!tareas?.length) return 1;
    const vivas = tareas.filter((t) => t.estado !== "finalizada");
    if (!vivas.length) return 1;
    return Math.max(...vivas.map((t) => t.prioridad ?? 0)) + 1;
  };

  const guardarTarea = async () => {
    const { idx, actividad, productos: listaProductos } = tareaActual;
    const instrucciones = tareaActual.instrucciones_supervisor ?? tareaActual.notas ?? "";

    if (!actividad || !idx || listaProductos.some((p) => !p.producto || !p.cantidad)) {
      toast.error(t("fill_all_fields"));
      return;
    }

    const productosDuplicados = listaProductos
      .map((p) => p.producto)
      .filter((v, i, a) => a.indexOf(v) !== i);
    if (productosDuplicados.length > 0) {
      toast.error(t("no_duplicate_products"));
      return;
    }

    const shipping = isShippingActivity(actividad);
    const productosConEtiqueta = shipping
      ? listaProductos.filter((p) => !isEmptyContainer(p.producto)) : [];
    const tieneEtiquetas = productosConEtiqueta.length > 0 && (!tareaActual.id ||
      productosConEtiqueta.some((p) => p.idx_line || p.primera_etiqueta));
    if (tareaActual.id && tieneEtiquetas && idx.trim() !== tareaActual._idxOriginal) {
       toast.error(t("task_idx_locked_error"));
      return;
    }
    if (tieneEtiquetas && productosConEtiqueta.some((p) =>
      !/^\d{2,3}$/.test(p.idx_line || "") ||
      !/^(6J|5J|1J).*\d{4,}$/i.test((p.primera_etiqueta || "").replace(/\s+/g, "")) ||
      !Number.isInteger(Number(p.cantidad)) || Number(p.cantidad) < 1
    )) {
       toast.error(t("task_product_plan_error"));
      return;
    }
    if (tieneEtiquetas && new Set(productosConEtiqueta.map((p) => p.idx_line)).size !== productosConEtiqueta.length) {
       toast.error(t("task_unique_suffix_error"));
      return;
    }

    const datos = {
      idx: idx.trim(),
      actividad,
      productos: listaProductos.map((p) => ({
        producto: p.producto,
        cantidad: Number(p.cantidad),
        ...(tieneEtiquetas && !isEmptyContainer(p.producto) ? {
          idx_line: p.idx_line,
          primera_etiqueta: p.primera_etiqueta.trim().toUpperCase().replace(/\s+/g, ""),
        } : {}),
      })),
      notas: instrucciones,
      instrucciones_supervisor: instrucciones,
      estado: tareaActual.estado || "pendiente",
      operadores: (tareaActual.operadores || []).filter((id) => operadores[id]),
      prioridad: tareaActual.prioridad ?? getNextPriority(),
      es_urgente: Boolean(tareaActual.es_urgente),
      mismo_dia: Boolean(tareaActual.mismo_dia),
    };

    try {
      const seriesActual = JSON.stringify(datos.productos.filter((p) => !isEmptyContainer(p.producto)).map((p) => ({
        idx_line: p.idx_line || "", primera_etiqueta: p.primera_etiqueta || "",
        producto: p.producto, cantidad: p.cantidad,
      })));
      if (tieneEtiquetas && (!tareaActual.id || seriesActual !== tareaActual._seriesOriginal)) {
        const { error: planError } = await supabase.rpc("shipping_register_plan", {
          p_idx: idx.trim(),
          p_lines: datos.productos.filter((p) => !isEmptyContainer(p.producto)).map((p) => ({
            idx_line: p.idx_line,
            producto: p.producto,
            cantidad: p.cantidad,
            primera_etiqueta: p.primera_etiqueta,
          })),
        });
        if (planError) throw planError;
      }
      if (tareaActual.id) {
        const { error } = await supabase
          .from("tareas_pendientes")
          .update(datos)
          .eq("id", tareaActual.id);

        if (error) throw error;
        toast.success(t("task_updated"));
        await fetchTareas();
      } else {
        const { error } = await supabase.from("tareas_pendientes").insert([datos]);
        if (error) throw error;
        toast.success(t("task_added"));
      }

      setModalAbierto(false);
      fetchTareas();
    } catch (error) {
      console.error("Error al guardar la tarea:", error);
      toast.error(error?.message || t("error_saving"));
    }
  };

  const mostrarNombre = (id, mapa) => mapa[id] || `ID: ${id}`;

  const obtenerEstadoVisual = (estado) => {
    switch (estado) {
      case "iniciada":
        return { color: "green", icono: "🟢", texto: t("started") };
      case "pausada":
        return { color: "#b91c1c", icono: "🔴", texto: t("paused") };
      default:
        return { color: "goldenrod", icono: "🟡", texto: t("pending") };
    }
  };

  const operadorOpciones = useMemo(
    () =>
      Object.entries(operadores)
        .map(([id, nombre]) => ({ value: id, label: nombre }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [operadores]
  );

  const abrirControl = (tarea) => {
    setControlTarea(tarea);
    setControlOperadores([]);
    setControlDock("");
    setControlTrailer("");
    setControlEtiqueta("");
  };

  const guardarControl = async () => {
    if (!controlTarea || guardandoControl) return;
    const iniciar = controlTarea.estado === "pendiente";
    const carga = isLoad(controlTarea.actividad);
    if (iniciar && controlOperadores.length === 0) {
      toast.error(t("supervisor_select_operator"));
      return;
    }
    if (carga && (!controlDock.trim() || !controlTrailer.trim() ||
      (requiereEtiqueta(controlTarea) && !/^\d{4}$/.test(controlEtiqueta)))) {
      toast.error(t("supervisor_load_required"));
      return;
    }
    setGuardandoControl(true);
    try {
      const { error } = await supabase.rpc(
        iniciar ? "shipping_supervisor_start_task" : "shipping_supervisor_finish_task",
        {
          p_tarea: controlTarea.id,
          ...(iniciar ? { p_operadores: controlOperadores } : {}),
          p_etiqueta: controlEtiqueta || null,
          p_trailer: carga ? controlTrailer.trim().toUpperCase() : null,
          p_puerta: carga ? `DOCK ${controlDock.replace(/\D/g, "")}` : null,
        }
      );
      if (error) throw error;
      toast.success(t(iniciar ? "task_started" : "task_completed"));
      setControlTarea(null);
      await fetchTareas();
    } catch (error) {
      toast.error(error.message || t("error_saving"));
      await fetchTareas();
    } finally {
      setGuardandoControl(false);
    }
  };

  const abrirEtiquetas = async (tarea) => {
    setEtiquetasTarea(tarea);
    setEditandoLinea(null);
    const { data, error } = await supabase.from("shipping_lines")
      .select("id, idx_line, producto, cantidad_cajas, primera_etiqueta")
      .eq("idx", tarea.idx).order("idx_line");
    if (error) {
      toast.error(error.message);
      setEtiquetasTarea(null);
      return;
    }
    setLineasEtiqueta(data || []);
  };

  const guardarPrimeraEtiqueta = async (linea) => {
    if (guardandoEtiqueta) return;
    const etiqueta = nuevaEtiqueta.trim().toUpperCase().replace(/\s+/g, "");
    if (!/^(6J|5J|1J).*\d{4,}$/.test(etiqueta)) {
      toast.error(t("task_product_plan_error"));
      return;
    }
    setGuardandoEtiqueta(true);
    try {
      const { error } = await supabase.rpc("shipping_supervisor_change_first_label", {
        p_line: linea.id, p_first: etiqueta,
      });
      if (error) throw error;
      setLineasEtiqueta((prev) => prev.map((item) => item.id === linea.id
        ? { ...item, primera_etiqueta: etiqueta } : item));
      setEditandoLinea(null);
      await fetchTareas();
      toast.success(t("task_label_updated"));
    } catch (error) {
      toast.error(error.message || t("error_saving"));
    } finally {
      setGuardandoEtiqueta(false);
    }
  };

  // ---------- Drag & Drop helpers ----------
  const onDragStart = (idx) => setDragIndex(idx);

  const onDragOver = (e, idx) => {
    e.preventDefault();
    setOverIndex(idx);
  };

  const onDrop = async (e, dropIndex) => {
    e.preventDefault();
    setOverIndex(null);

    if (dragIndex === null || dragIndex === dropIndex) {
      setDragIndex(null);
      return;
    }

    // Reordenar localmente
    const nuevas = [...tareas];
    const [moved] = nuevas.splice(dragIndex, 1);
    nuevas.splice(dropIndex, 0, moved);
    setTareas(nuevas);
    setDragIndex(null);

    // Persistir prioridades 1..n
    try {
      await persistirPrioridadesSecuenciales(nuevas);
      toast.success(t("priority_updated"));
    } catch (err) {
      toast.error(t("error_updating_priority"));
      fetchTareas(); // fallback
    }
  };

  const persistirPrioridadesSecuenciales = async (lista) => {
    // Solo si cambió algo
    const updates = [];
    for (let i = 0; i < lista.length; i++) {
      const tRow = lista[i];
      const nueva = i + 1;
      if ((tRow.prioridad ?? 0) !== nueva) {
        updates.push({ id: tRow.id, prioridad: nueva });
      }
    }
    // Ejecuta en serie para asegurar orden
    for (const u of updates) {
      const { error } = await supabase
        .from("tareas_pendientes")
        .update({ prioridad: u.prioridad })
        .eq("id", u.id);
      if (error) throw error;
    }
  };

  // ==========================
  // Paginado: cálculo de filas
  // ==========================
  const totalRows = tareas.length;
  const totalPages = Math.max(1, Math.ceil((totalRows || 0) / pageSize));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const filasPagina = tareas.slice(startIndex, endIndex);

  return (
    <div className="page-container page-container--fluid">
      <style>{`
        .drag-handle {
          cursor: grab;
          font-size: 18px;
          opacity: .8;
          user-select: none;
        }
        tr.dragging {
          opacity: 0.6;
        }
        tr.drag-over {
          outline: 2px dashed #3b82f6;
          outline-offset: -4px;
        }
      `}</style>

      <div className="card">
        <h2>{t("pending_tasks")}</h2>

        <BtnPrimary onClick={() => abrirModal()} style={{ marginBottom: 10 }}>
          ➕ {t("add_task")}
        </BtnPrimary>

        <div className="table-wrap">
          <table className="table pending-table">
            <colgroup>
              {[7, 2, 8, 8, 16, 7, 11, 14, 10, 17].map((width, i) =>
                <col key={i} style={{ width: `${width}%` }} />)}
            </colgroup>
            <thead>
              <tr>
                <th>{t("prioridad")}</th>
                <th></th>
                <th>{t("idx")}</th>
                <th>{t("activity")}</th>
                <th>{t("product")}</th>
                <th>{t("amount")}</th>
                <th>{t("operator")}</th>
                <th>{t("notes")}</th>
                <th>{t("status")}</th>
                <th>{t("actions")}</th>
              </tr>
            </thead>
            <tbody key={i18n.language}>
              {filasPagina.map((tarea, i) => {
                const globalIndex = startIndex + i;
                return (
                <tr
                  key={tarea.id}
                  draggable
                  onDragStart={() => onDragStart(i)}
                  onDragOver={(e) => onDragOver(e, i)}
                  onDrop={(e) => onDrop(e, i)}
                  className={`${dragIndex === i ? "dragging" : ""} ${overIndex === i ? "drag-over" : ""}`}
                  style={{
                    backgroundColor: colorActividad(
                      actividades[tarea.actividad] || tarea.nombre_actividad || tarea.actividad
                    ),
                  }}
                >
                  {/* Prioridad editable + botones estéticos */}
                  <td className="pending-priority-cell">
                    <div className="pending-priority-controls">
                      <PillInputNumber
                        type="number"
                        min={1}
                        value={tarea.prioridad ?? ""}
                        onChange={async (e) => {
                          const nueva = Math.max(1, parseInt(e.target.value || "1", 10));
                          const { error } = await supabase
                            .from("tareas_pendientes")
                            .update({ prioridad: nueva })
                            .eq("id", tarea.id);
                          if (error) toast.error(t("error_updating_priority"));
                          else toast.success(t("priority_updated"));
                        }}
                        title={t("edit_priority")}
                        style={{ width: 46, height: 22, fontSize: 13, padding: "1px 3px" }}
                      />
                      <div className="pending-priority-arrows">
                      <BtnTinyRound
                        style={{ width: 21, height: 21 }}
                        title={t("move_up")}
                        onClick={async () => {
                          const idx = tareas.findIndex((t) => t.id === tarea.id);
                          if (idx <= 0) return;
                          const arriba = tareas[idx - 1];
                          await supabase.from("tareas_pendientes").update({ prioridad: arriba.prioridad }).eq("id", tarea.id);
                          await supabase.from("tareas_pendientes").update({ prioridad: tarea.prioridad }).eq("id", arriba.id);
                        }}
                        aria-label={t("move_up")}
                      >
                        {/* Ícono chevron up blanco */}
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                          <path d="M7 14l5-5 5 5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </BtnTinyRound>

                      <BtnTinyRound
                        style={{ width: 21, height: 21 }}
                        title={t("move_down")}
                        onClick={async () => {
                          const idx = tareas.findIndex((t) => t.id === tarea.id);
                          if (idx < 0 || idx >= tareas.length - 1) return;
                          const abajo = tareas[idx + 1];
                          await supabase.from("tareas_pendientes").update({ prioridad: abajo.prioridad }).eq("id", tarea.id);
                          await supabase.from("tareas_pendientes").update({ prioridad: tarea.prioridad }).eq("id", abajo.id);
                        }}
                        aria-label={t("move_down")}
                      >
                        {/* Ícono chevron down blanco */}
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                          <path d="M7 10l5 5 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </BtnTinyRound>
                      </div>
                    </div>
                    {(tarea.es_urgente || tarea.mismo_dia) && (
                      <div className="pending-badges">
                        {tarea.es_urgente && <span title={t("task_urgent")} style={{ background: "#991b1b" }}>{t("task_urgent")}</span>}
                        {tarea.mismo_dia && <span title={t("task_same_day")} style={{ background: "#1d4ed8" }}>{t("task_same_day")}</span>}
                      </div>
                    )}
                  </td>

                  {/* Handle visual para arrastrar */}
                  <td style={{ textAlign: "center" }} title={t("edit_priority")}>
                    <span className="drag-handle">☰</span>
                  </td>

                  <td className="pending-nowrap" title={tarea.idx}>{tarea.idx || "-"}</td>
                  <td>{mostrarNombre(tarea.actividad, actividades)}</td>
                  <td>
                    {Array.isArray(tarea.productos)
                      ? tarea.productos.map((p, idx) => <div key={idx}>{mostrarNombre(p.producto, productos)}</div>)
                      : mostrarNombre(tarea.producto, productos)}
                  </td>
                  <td>
                    {Array.isArray(tarea.productos)
                      ? tarea.productos.map((p, idx) => <div key={idx}>{p.cantidad}</div>)
                      : tarea.cantidad}
                  </td>
                  <td>
                    {Array.isArray(tarea.operadores) && tarea.operadores.length > 0
                      ? tarea.operadores.map((opId, idx) => <div key={idx}>{mostrarNombre(opId, operadores)}</div>)
                      : "-"}
                  </td>
                  <td>{tarea.notas || "-"}</td>
                  <td className="pending-nowrap" style={{ fontWeight: "bold" }}>
                    {(() => {
                      const estadoVisual = obtenerEstadoVisual(tarea.estado);
                      return (
                        <span
                          style={{
                            color: estadoVisual.color,
                            fontSize: "16px",
                            fontWeight: "bold",
                            textShadow:
                              "-1px -1px 0 white, 1px -1px 0 white, -1px 1px 0 white, 1px 1px 0 white",
                          }}
                        >
                          {estadoVisual.icono} {estadoVisual.texto}
                        </span>
                      );
                    })()}
                  </td>
                  <td>
                    <div className="pending-actions">
                      <BtnEditDark onClick={() => abrirModal(tarea)}>
                        {t("edit")}
                      </BtnEditDark>
                      <BtnDanger onClick={() => setTareaAEliminar(tarea)}>
                        {t("delete")}
                      </BtnDanger>
                      {esSupervisor && (
                        <BtnPrimary onClick={() => abrirControl(tarea)}>
                          {t(tarea.estado === "pendiente" ? "start" : "finish")}
                        </BtnPrimary>
                      )}
                      {esSupervisor && isLoad(tarea.actividad) && (
                        <BtnSecondary onClick={() => abrirEtiquetas(tarea)}>
                          {t("task_label_button")}
                        </BtnSecondary>
                      )}
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

        <Modal
          isOpen={modalAbierto}
          onRequestClose={() => setModalAbierto(false)}
          style={{
            content: {
              width: "70%",         
              maxWidth: "100%",    
              margin: "0 auto",
            }
          }}
        >
          <h3>{tareaActual?.id ? t("edit_task") : t("new_task")}</h3>

          {tareaActual && (
            <>
              <PillInput
                type="text"
                placeholder={t("idx")}
                value={tareaActual?.idx || ""}
                onChange={(e) => tareaActual && setTareaActual({ ...tareaActual, idx: e.target.value })}
                style={{ marginTop: 10, marginBottom: 10 }}
              />

              <DSSelect
                options={Object.entries(actividades).map(([id, nombre]) => ({ value: id, label: nombre }))}
                value={
                  tareaActual.actividad
                    ? { value: tareaActual.actividad, label: actividades[tareaActual.actividad] }
                    : null
                }
                onChange={(e) => setTareaActual({ ...tareaActual, actividad: e.value })}
                placeholder={t("select_activity")}
              />

              {tareaActual.productos.map((p, index) => (
                <div key={index} style={{ display: "flex", gap: "10px", marginTop: "10px", flexWrap: "wrap" }}>
                  <DSSelect
                    options={Object.entries(productos).map(([id, nombre]) => ({ value: id, label: productLabel(id, nombre) }))}
                    value={
                      p.producto && productos[p.producto] ? { value: p.producto, label: productLabel(p.producto, productos[p.producto]) } : null
                    }
                    onChange={(e) => {
                      const nuevos = [...tareaActual.productos];
                       nuevos[index] = { ...p, producto: e.value, idx_line: "",
                         primera_etiqueta: isShippingActivity(tareaActual.actividad) && !isEmptyContainer(e.value)
                           ? "6J" : "" };
                      setTareaActual({ ...tareaActual, productos: nuevos });
                    }}
                    placeholder={t("select_product")}
                    styles={{ container: (base) => ({ ...base, flex: 1 }) }}
                  />
                  <PillInput
                    type="number"
                     placeholder={t("task_boxes_placeholder")}
                    value={p.cantidad ?? ""}
                    onChange={(e) => {
                      const nuevos = [...tareaActual.productos];
                      nuevos[index].cantidad = e.target.value;
                      setTareaActual({ ...tareaActual, productos: nuevos });
                    }}
                    style={{ width: "220px" }}
                  />
                  {isShippingActivity(tareaActual.actividad) && !isEmptyContainer(p.producto) && (
                    <>
                      <PillInput
                        type="text"
                         placeholder={t("task_idx_suffix_placeholder")}
                        value={p.idx_line || ""}
                        onChange={(e) => {
                          const nuevos = [...tareaActual.productos];
                          nuevos[index] = { ...p, idx_line: e.target.value.trim() };
                          setTareaActual({ ...tareaActual, productos: nuevos });
                        }}
                        style={{ width: "150px" }}
                      />
                      <PillInput
                        type="text"
                         placeholder={t("task_first_label_placeholder")}
                         value={p.primera_etiqueta || ""}
                         onFocus={() => {
                           if (p.primera_etiqueta) return;
                           const nuevos = [...tareaActual.productos];
                           nuevos[index] = { ...p, primera_etiqueta: "6J" };
                           setTareaActual({ ...tareaActual, productos: nuevos });
                         }}
                         onChange={(e) => {
                           const nuevos = [...tareaActual.productos];
                           nuevos[index] = { ...p, primera_etiqueta: e.target.value.toUpperCase().replace(/\s+/g, "") };
                          setTareaActual({ ...tareaActual, productos: nuevos });
                        }}
                        style={{ width: "240px" }}
                      />
                    </>
                  )}
                  {index > 0 && (
                    <BtnDanger
                      onClick={() => {
                        const nuevos = tareaActual.productos.filter((_, i) => i !== index);
                        setTareaActual({ ...tareaActual, productos: nuevos });
                      }}
                    >
                      ✖
                    </BtnDanger>
                  )}
                </div>
              ))}

              <BtnSecondary
                onClick={() =>
                  setTareaActual({
                    ...tareaActual,
                    productos: [...tareaActual.productos, { producto: "", cantidad: "" }],
                  })
                }
                style={{ marginTop: "10px" }}
              >
                ➕ {t("add_product")}
              </BtnSecondary>

              <div style={{ marginTop: 10 }}>
                <DSSelect
                  isMulti
                  options={operadorOpciones}
                  value={
                    tareaActual?.operadores?.filter((opId) => operadores[opId]).map((opId) => ({
                      value: opId,
                      label: operadores[opId],
                    })) || []
                  }
                  onChange={(e) =>
                    setTareaActual({
                      ...tareaActual,
                      operadores: e.map((i) => i.value),
                    })
                  }
                  placeholder={t("select_operator")}
                />
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "18px", marginTop: "16px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={Boolean(tareaActual.es_urgente)} onChange={(e) => setTareaActual({ ...tareaActual, es_urgente: e.target.checked })} />
                  {t("task_urgent")}
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={Boolean(tareaActual.mismo_dia)} onChange={(e) => setTareaActual({ ...tareaActual, mismo_dia: e.target.checked })} />
                  {t("task_same_day")}
                </label>
              </div>

              <TextAreaStyle
                 placeholder={t("task_supervisor_instructions_placeholder")}
                value={tareaActual.instrucciones_supervisor ?? tareaActual.notas ?? ""}
                onChange={(e) =>
                  setTareaActual({ ...tareaActual, instrucciones_supervisor: e.target.value })
                }
                style={{
                  marginTop: "10px",
                  minHeight: "90px",  
                  resize: "vertical",
                  width: "85%", 
                }}
              />

              <div style={{ display: "flex", gap: "10px", marginTop: "14px", marginBottom: "10px" }}>
                <BtnPrimary onClick={guardarTarea}>
                  {t("save")}
                </BtnPrimary>
                <BtnSecondary onClick={() => setModalAbierto(false)}>
                  {t("cancel")}
                </BtnSecondary>
              </div>
            </>
          )}
        </Modal>

        <Modal
          isOpen={Boolean(controlTarea)}
          onRequestClose={() => !guardandoControl && setControlTarea(null)}
          className="modal"
          overlayClassName="modal-overlay"
        >
          {controlTarea && (
            <>
              <h3>{t(controlTarea.estado === "pendiente" ? "start_activity" : "finish_activity")}: {controlTarea.idx}</h3>
              <p>{mostrarNombre(controlTarea.actividad, actividades)}</p>
              {controlTarea.estado === "pendiente" && (
                <label className="supervisor-field">
                  {t("select_operators")}
                  <DSSelect isMulti options={operadorOpciones}
                    value={operadorOpciones.filter((op) => controlOperadores.includes(op.value))}
                    onChange={(selected) => setControlOperadores((selected || []).map((op) => op.value))}
                    placeholder={t("select_operators")} />
                </label>
              )}
              {isLoad(controlTarea.actividad) && (
                <div className="supervisor-fields">
                  <label className="supervisor-field">
                    {t("shipping_door")}
                    <div className="supervisor-dock">
                      <span>DOCK</span>
                      <PillInput inputMode="numeric" value={controlDock}
                        onChange={(e) => setControlDock(e.target.value.replace(/\D/g, ""))}
                        placeholder="#" />
                    </div>
                  </label>
                  <label className="supervisor-field">
                    {t("shipping_trailer")}
                    <PillInput value={controlTrailer} onChange={(e) => setControlTrailer(e.target.value.toUpperCase())}
                      style={{ width: "100%" }} />
                  </label>
                  {requiereEtiqueta(controlTarea) && (
                    <label className="supervisor-field">
                      {t(controlTarea.estado === "pendiente" ? "shipping_start_label" : "shipping_end_label")}
                      <PillInput inputMode="numeric" maxLength={4} value={controlEtiqueta}
                        onChange={(e) => setControlEtiqueta(e.target.value.replace(/\D/g, "").slice(0, 4))}
                        placeholder={t("supervisor_label_last_four")} style={{ width: "100%" }} />
                    </label>
                  )}
                </div>
              )}
              <div className="supervisor-modal-actions">
                <BtnSecondary disabled={guardandoControl} onClick={() => setControlTarea(null)}>{t("cancel")}</BtnSecondary>
                <BtnPrimary disabled={guardandoControl} onClick={guardarControl}>
                  {guardandoControl ? "…" : t(controlTarea.estado === "pendiente" ? "start" : "finish")}
                </BtnPrimary>
              </div>
            </>
          )}
        </Modal>

        <Modal
          isOpen={Boolean(etiquetasTarea)}
          onRequestClose={() => !guardandoEtiqueta && setEtiquetasTarea(null)}
          className="modal"
          overlayClassName="modal-overlay"
        >
          {etiquetasTarea && (
            <>
              <h3>{t("task_label_button")}: {etiquetasTarea.idx}</h3>
              {lineasEtiqueta.length === 0 && <p>{t("supervisor_no_label_plan")}</p>}
              {lineasEtiqueta.map((linea) => (
                <div key={linea.id} className="supervisor-label-line">
                  <strong>{mostrarNombre(linea.producto, productos)} ({linea.idx_line})</strong>
                  <span>{linea.primera_etiqueta}</span>
                  {editandoLinea === linea.id ? (
                    <div className="supervisor-label-editor">
                      <PillInput value={nuevaEtiqueta}
                        onChange={(e) => setNuevaEtiqueta(e.target.value.toUpperCase().replace(/\s+/g, ""))}
                        style={{ width: "100%" }} />
                      <BtnPrimary disabled={guardandoEtiqueta} onClick={() => guardarPrimeraEtiqueta(linea)}>
                        {t("save")}
                      </BtnPrimary>
                      <BtnSecondary disabled={guardandoEtiqueta} onClick={() => setEditandoLinea(null)}>
                        {t("cancel")}
                      </BtnSecondary>
                    </div>
                  ) : (
                    <BtnEditDark onClick={() => { setEditandoLinea(linea.id); setNuevaEtiqueta(linea.primera_etiqueta); }}>
                      {t("edit")}
                    </BtnEditDark>
                  )}
                </div>
              ))}
              <p>{t("supervisor_label_lock_notice")}</p>
              <BtnSecondary onClick={() => setEtiquetasTarea(null)}>{t("close")}</BtnSecondary>
            </>
          )}
        </Modal>

        {tareaAEliminar && (
          <Modal
            isOpen={true}
            onRequestClose={() => setTareaAEliminar(null)}
            className="modal"
            overlayClassName="modal-overlay"
          >
            <h2>{t("confirm_delete_title")}</h2>
            <p>{t("confirm_delete_text")}</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "1rem" }}>
              <BtnSecondary onClick={() => setTareaAEliminar(null)}>
                {t("cancel")}
              </BtnSecondary>
              <BtnDanger
                onClick={async () => {
                  try {
                    if (!tareaAEliminar?.id) throw new Error("ID inválido");

                    const { error } = await supabase
                      .from("tareas_pendientes")
                      .delete()
                      .eq("id", tareaAEliminar.id);
                    if (error) throw error;
                    toast.success(t("task_deleted"));
                  } catch (error) {
                    toast.error(t("error_deleting"));
                  }
                  setTareaAEliminar(null);
                }}
              >
                {t("confirm")}
              </BtnDanger>
            </div>
          </Modal>
        )}
        <ToastContainer position="top-center" autoClose={1000} />
      </div>
    </div>
  );
}
