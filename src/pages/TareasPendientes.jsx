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
} from "../components/controls";

Modal.setAppElement("#root");

let canalTareas = null;

export default function TareasPendientes() {
  const location = useLocation();
  const [tareas, setTareas] = useState([]);
  const [actividades, setActividades] = useState({});
  const [productos, setProductos] = useState({});
  const [modalAbierto, setModalAbierto] = useState(false);
  const [tareaActual, setTareaActual] = useState(null);
  const { t, i18n } = useTranslation();
  const [tareaAEliminar, setTareaAEliminar] = useState(null);
  const [operadores, setOperadores] = useState({});

  // Drag & Drop state
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);

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
      console.error("Error cargando tareas:", error);
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
      .select("id, nombre, activo");

    if (!error && data) {
      const prod = {};
      data.forEach((doc) => {
        if (doc.activo !== false) prod[doc.id] = doc.nombre;
      });
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
        if (doc.activo !== false) ops[doc.id] = doc.nombre;
      });
      const ordenadas = Object.fromEntries(
        Object.entries(ops).sort(([, a], [, b]) => a.localeCompare(b))
      );
      setOperadores(ordenadas);
    }
  };

  useEffect(() => {
    if (location.pathname !== "/tareas-pendientes") return;

    console.log("✅ Montando canales de Supabase para /tareas-pendientes");

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        console.log("👁️ Volvió a la pestaña: actualizando tareas...");
        fetchTareas();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    fetchActividades();
    fetchProductos();
    fetchOperadores();
    fetchTareas();

    const socket = supabase.getChannels()[0]?.socket;
    if (socket?.conn?.readyState === 3) {
      console.warn("🔌 WebSocket estaba cerrado. Reconectando...");
      socket.disconnect(() => {
        socket.connect();
      });
    }

    if (!canalTareas) {
      setTimeout(() => {
        canalTareas = supabase
          .channel("canal_tareas")
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "tareas_pendientes" },
            fetchTareas
          )
          .subscribe((status) => {
            console.log("📶 Estado del canal tareas_pendientes:", status);
          });
      }, 100);
    } else {
      console.log("♻️ Reutilizando canal tareas_pendientes");
    }

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
      console.log("🧹 Limpiando canales al salir de tareas-pendientes");
      document.removeEventListener("visibilitychange", handleVisibilityChange);

      supabase.removeChannel(canalTareas);
      supabase.removeChannel(canalActividades);
      supabase.removeChannel(canalProductos);
      supabase.removeChannel(canalOperadores);
      canalTareas = null;

      const socket = supabase.getChannels()[0]?.socket;
      if (socket?.conn?.readyState === 3) {
        console.warn("🔌 WebSocket estaba cerrado. Reconectando...");
        socket.disconnect(() => {
          socket.connect();
        });
      }
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
      toast.error("Error cargando tarea actualizada");
      return;
    }

    setTareaActual({
      ...data,
      productos: data.productos || [{ producto: "", cantidad: "" }],
      operadores: data.operadores || [],
      notas: data.notas || "",
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
    const { idx, actividad, productos: listaProductos, notas } = tareaActual;

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

    const datos = {
      idx: idx || "",
      actividad,
      productos: listaProductos.map((p) => ({
        producto: p.producto,
        cantidad: Number(p.cantidad),
      })),
      notas: notas || "",
      estado: tareaActual.estado || "pendiente",
      operadores: tareaActual.operadores || [],
      prioridad: tareaActual.prioridad ?? getNextPriority(),
    };

    try {
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
      console.error("Error guardando tarea:", error);
      toast.error(t("error_saving"));
    }
  };

  const mostrarNombre = (id, mapa) => mapa[id] || `ID: ${id}`;

  const obtenerEstadoVisual = (estado) => {
    switch (estado) {
      case "iniciada":
        return { color: "green", icono: "🟢", texto: t("started") };
      case "pausada":
        return { color: "red", icono: "🔴", texto: t("paused") };
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
      console.error("Error actualizando prioridades:", err);
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
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 110 }}>{t("prioridad")}</th>
                <th style={{ width: 40 }}></th>
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
              {tareas.map((tarea, i) => (
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
                  <td style={{ whiteSpace: "nowrap", textAlign: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, height: "34px" }}>
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
                      />

                      <BtnTinyRound
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
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                          <path d="M7 14l5-5 5 5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </BtnTinyRound>

                      <BtnTinyRound
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
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                          <path d="M7 10l5 5 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </BtnTinyRound>
                    </div>
                  </td>

                  {/* Handle visual para arrastrar */}
                  <td style={{ textAlign: "center" }} title={t("edit_priority")}>
                    <span className="drag-handle">☰</span>
                  </td>

                  <td>{tarea.idx || "-"}</td>
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
                  <td style={{ fontWeight: "bold" }}>
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
                    <div style={{ display: "flex", gap: "10px", marginBottom: "10px" }}>
                      <BtnEditDark onClick={() => abrirModal(tarea)}>
                        {t("edit")}
                      </BtnEditDark>
                      <BtnDanger onClick={() => setTareaAEliminar(tarea)}>
                        {t("delete")}
                      </BtnDanger>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
                <div key={index} style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
                  <DSSelect
                    options={Object.entries(productos).map(([id, nombre]) => ({ value: id, label: nombre }))}
                    value={
                      p.producto && productos[p.producto] ? { value: p.producto, label: productos[p.producto] } : null
                    }
                    onChange={(e) => {
                      const nuevos = [...tareaActual.productos];
                      nuevos[index].producto = e.value;
                      setTareaActual({ ...tareaActual, productos: nuevos });
                    }}
                    placeholder={t("select_product")}
                    styles={{ container: (base) => ({ ...base, flex: 1 }) }}
                  />
                  <PillInput
                    type="number"
                    placeholder={t("amount")}
                    value={p.cantidad ?? ""}
                    onChange={(e) => {
                      const nuevos = [...tareaActual.productos];
                      nuevos[index].cantidad = e.target.value;
                      setTareaActual({ ...tareaActual, productos: nuevos });
                    }}
                    style={{ width: "220px" }}
                  />
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
                    tareaActual?.operadores?.map((opId) => ({
                      value: opId,
                      label: operadores[opId] || opId,
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

              <TextAreaStyle
                placeholder={t("notes")}
                value={tareaActual.notas}
                onChange={(e) =>
                  setTareaActual({ ...tareaActual, notas: e.target.value })
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

                    console.log("[Tareas Pendientes] Eliminar Tareas Pendientes 7", tareaAEliminar.id);

                    if (error) throw error;
                    toast.success(t("task_deleted"));
                  } catch (error) {
                    console.error("Error eliminando:", error);
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
