import React, { useEffect, useState, useMemo } from "react";
import { supabase } from "../supabase/client";
import Select from "react-select";
import Modal from "react-modal";
import { useLocation } from "react-router-dom";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { useTranslation } from "react-i18next";

Modal.setAppElement("#root");

let canalTareas = null;

// ---------- Estilos rápidos reutilizables ----------
const pillInput = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: "10px",
  border: "1px solid #cfd4dc",
  outline: "none",
  boxShadow: "inset 0 1px 2px rgba(0,0,0,0.04)",
};
const pillInputNumber = {
  ...pillInput,
  width: "80px",
  textAlign: "center",
};
const textAreaStyle = {
  ...pillInput,
  resize: "vertical",
};
const primaryBtn = {
  padding: "8px 14px",
  borderRadius: "10px",
  border: "none",
  background: "linear-gradient(180deg,#3b82f6,#1d4ed8)",
  color: "#fff",
  cursor: "pointer",
  boxShadow: "0 4px 10px rgba(37,99,235,0.25)",
};
const secondaryBtn = {
  padding: "8px 14px",
  borderRadius: "10px",
  border: "1px solid #cfd4dc",
  background: "#fff",
  color: "#111",
  cursor: "pointer",
};
const dangerBtn = {
  padding: "8px 14px",
  borderRadius: "10px",
  border: "1px solid #ef4444",
  background: "#fff",
  color: "#ef4444",
  cursor: "pointer",
};
const tinyRoundBtn = {
  width: 34,
  height: 34,
  borderRadius: "9999px",
  border: "1px solid #cfd4dc",
  background: "#fff",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  userSelect: "none",
};

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

        <button onClick={() => abrirModal()} style={{ ...primaryBtn, marginBottom: 10 }}>
          ➕ {t("add_task")}
        </button>

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
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                      <input
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
                        style={pillInputNumber}
                        title={t("edit_priority")}
                      />

                      <button
                        title={t("move_up")}
                        onClick={async () => {
                          const idx = tareas.findIndex((t) => t.id === tarea.id);
                          if (idx <= 0) return;
                          const arriba = tareas[idx - 1];
                          await supabase.from("tareas_pendientes").update({ prioridad: arriba.prioridad }).eq("id", tarea.id);
                          await supabase.from("tareas_pendientes").update({ prioridad: tarea.prioridad }).eq("id", arriba.id);
                        }}
                        style={tinyRoundBtn}
                        aria-label={t("move_up")}
                      >
                        ▲
                      </button>

                      <button
                        title={t("move_down")}
                        onClick={async () => {
                          const idx = tareas.findIndex((t) => t.id === tarea.id);
                          if (idx < 0 || idx >= tareas.length - 1) return;
                          const abajo = tareas[idx + 1];
                          await supabase.from("tareas_pendientes").update({ prioridad: abajo.prioridad }).eq("id", tarea.id);
                          await supabase.from("tareas_pendientes").update({ prioridad: tarea.prioridad }).eq("id", abajo.id);
                        }}
                        style={tinyRoundBtn}
                        aria-label={t("move_down")}
                      >
                        ▼
                      </button>
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
                      <button onClick={() => abrirModal(tarea)} style={secondaryBtn}>
                        {t("edit")}
                      </button>
                      <button onClick={() => setTareaAEliminar(tarea)} style={dangerBtn}>
                        {t("delete")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Modal isOpen={modalAbierto} onRequestClose={() => setModalAbierto(false)}>
          <h3>{tareaActual?.id ? t("edit_task") : t("new_task")}</h3>

          {tareaActual && (
            <>
              <input
                type="text"
                placeholder={t("idx")}
                value={tareaActual?.idx || ""}
                onChange={(e) => tareaActual && setTareaActual({ ...tareaActual, idx: e.target.value })}
                style={{ ...pillInput, marginTop: 10, marginBottom: 10 }}
              />

              <Select
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
                  <Select
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
                  <input
                    type="number"
                    placeholder={t("amount")}
                    value={p.cantidad ?? ""}
                    onChange={(e) => {
                      const nuevos = [...tareaActual.productos];
                      nuevos[index].cantidad = e.target.value;
                      setTareaActual({ ...tareaActual, productos: nuevos });
                    }}
                    style={{ ...pillInput, width: "220px" }}
                  />
                  {index > 0 && (
                    <button
                      onClick={() => {
                        const nuevos = tareaActual.productos.filter((_, i) => i !== index);
                        setTareaActual({ ...tareaActual, productos: nuevos });
                      }}
                      style={dangerBtn}
                    >
                      ✖
                    </button>
                  )}
                </div>
              ))}

              <button
                onClick={() =>
                  setTareaActual({
                    ...tareaActual,
                    productos: [...tareaActual.productos, { producto: "", cantidad: "" }],
                  })
                }
                style={{ ...secondaryBtn, marginTop: "10px" }}
              >
                ➕ {t("add_product")}
              </button>

              <div style={{ marginTop: 10 }}>
                <Select
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

              <textarea
                placeholder={t("notes")}
                value={tareaActual.notas}
                onChange={(e) => setTareaActual({ ...tareaActual, notas: e.target.value })}
                rows={3}
                style={{ ...textAreaStyle, width: "100%", marginTop: "10px" }}
              />

              <div style={{ display: "flex", gap: "10px", marginTop: "14px", marginBottom: "10px" }}>
                <button onClick={guardarTarea} style={primaryBtn}>
                  {t("save")}
                </button>
                <button onClick={() => setModalAbierto(false)} style={secondaryBtn}>
                  {t("cancel")}
                </button>
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
              <button className="btn btn-secondary" onClick={() => setTareaAEliminar(null)} style={secondaryBtn}>
                {t("cancel")}
              </button>
              <button
                className="btn btn-danger"
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
                style={dangerBtn}
              >
                {t("confirm")}
              </button>
            </div>
          </Modal>
        )}
        <ToastContainer position="top-center" autoClose={1000} />
      </div>
    </div>
  );
}
