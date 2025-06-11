import React, { useEffect, useState } from "react";
import supabase from "../supabase/client";
import Select from "react-select";
import Modal from "react-modal";
import { useLocation } from "react-router-dom";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { useTranslation } from "react-i18next";

Modal.setAppElement("#root");

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
      .select("*");

    if (!error && data) {
      const tareasList = data
        .map((doc) => ({
          id: doc.id,
          ...doc,
        }))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .filter((t) => ["pendiente", "iniciada", "pausada"].includes(t.estado));

      setTareas((prev) => {
        const tareaIds = prev.map((t) => t.id); // Extraemos los IDs de las tareas actuales
        const nuevasTareas = tareasList.filter((t) => !tareaIds.includes(t.id)); // Filtramos las nuevas tareas que no estén en el estado actual

        // Actualiza todas las tareas, no solo las nuevas
        const tareasActualizadas = prev.map((t) => {
          const tareaModificada = tareasList.find((nuevaTarea) => nuevaTarea.id === t.id);
          if (tareaModificada) {
            // Si la tarea existe en la base de datos, actualizamos los campos
            return {
              ...t,
              idx: tareaModificada.idx,
              actividad: tareaModificada.actividad,
              productos: tareaModificada.productos,
              cantidad: tareaModificada.cantidad,
              operador: tareaModificada.operador,
              notas: tareaModificada.notas,
              estado: tareaModificada.estado,
            };
          }
          return t;
        });

        // Si hay tareas nuevas, las agregamos
        return [...tareasActualizadas, ...nuevasTareas];
      });
    }
  };

  useEffect(() => {
  const fetchOperadores = async () => {
    const { data, error } = await supabase
      .from("operadores")
      .select("id, nombre");

    if (!error && data) {
      const datos = {};
      data.forEach((doc) => {
        datos[doc.id] = doc.nombre;
      });
      setOperadores(datos);
    }
  };

  fetchOperadores();

  const channel = supabase
    .channel("Tareas Pendientes - onSnapshot Operadores 1")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "operadores",
      },
      (payload) => {
        fetchOperadores();
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, []);

  useEffect(() => {
  // Función para obtener actividades
  const fetchActividades = async () => {
    const { data, error } = await supabase
      .from("actividades")
      .select("id, nombre, activo");

    if (!error && data) {
      const act = {};
      data.forEach((doc) => {
        if (doc.activo !== false) {
          act[doc.id] = doc.nombre;
        }
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
        if (doc.activo !== false) {
          prod[doc.id] = doc.nombre;
        }
      });
      const ordenadas = Object.fromEntries(
        Object.entries(prod).sort(([, a], [, b]) => a.localeCompare(b))
      );
      setProductos(ordenadas);
    }
  };

  fetchActividades();
  fetchProductos();
  fetchTareas();

  // Canales de tiempo real
  const canalActividades = supabase
    .channel("Tareas Pendientes - onSnapshot Actividades 2")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "actividades" },
      fetchActividades
    )
    .subscribe();

  const canalProductos = supabase
    .channel("Tareas Pendientes - onSnapshot Productos 3")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "productos" },
      fetchProductos
    )
    .subscribe();

  const canalTareas = supabase
    .channel("Tareas Pendientes - onSnapshot Lista de Tareas 4", { config: { broadcast: { self: true } } })
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "tareas_pendientes" },
      (payload) => {
        console.log("🔄 Tarea modificada:", payload);
        fetchTareas();
      }
    )
    .subscribe();

  // Limpieza de los canales al desmontar el componente
  return () => {
    supabase.removeChannel(canalActividades);
    supabase.removeChannel(canalProductos);
    supabase.removeChannel(canalTareas);
  };
}, []);

  const abrirModal = (tarea = null) => {
    setTareaActual(
      tarea || {
        idx: "",
        actividad: "",
        productos: [{ producto: "", cantidad: "" }],
        notas: "",        
      }
    );
    setModalAbierto(true);
  };

  const guardarTarea = async () => {
    const { idx, actividad, productos: listaProductos, notas } = tareaActual;

    if (!actividad || !idx || listaProductos.some(p => !p.producto || !p.cantidad)) {
      toast.error(t("fill_all_fields"));
      return;
    }

    const productosDuplicados = listaProductos
      .map(p => p.producto)
      .filter((v, i, a) => a.indexOf(v) !== i);
    if (productosDuplicados.length > 0) {
      toast.error(t("no_duplicate_products"));
      return;
    }

    const datos = {
      idx: idx || "",
      actividad,
      productos: listaProductos.map(p => ({
        producto: p.producto,
        cantidad: Number(p.cantidad),
      })),
      notas: notas || "",
      estado: tareaActual.estado || "pendiente",
      operadores: tareaActual.operadores || [],
    };

    try {
      if (tareaActual.id) {
        // UPDATE
        const { error } = await supabase
          .from("tareas_pendientes")
          .update(datos)
          .eq("id", tareaActual.id);

        if (error) throw error;
        toast.success(t("task_updated"));

        // Actualizamos la tarea localmente también
        setTareas((prev) =>
          prev.map((t) =>
            t.id === tareaActual.id
              ? { ...t, idx: datos.idx, actividad: datos.actividad, productos: datos.productos, operadores: datos.operadores, notas: datos.notas, estado: datos.estado }
              : t
          )
        );
      } else {
        // INSERT
        const { error } = await supabase
          .from("tareas_pendientes")
          .insert([{
            ...datos,
            createdAt: new Date().toISOString(),
          }]);

        if (error) throw error;
        toast.success(t("task_added"));
      }

      setModalAbierto(false);
      fetchTareas(); // También llamamos a fetchTareas si necesitas volver a cargar las tareas.
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

  const operadorOpciones = Object.entries(operadores)
    .map(([id, nombre]) => ({ value: id, label: nombre }))
    .sort((a, b) => a.label.localeCompare(b.label));

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        console.log("👀 Página visible, recargando tareas");
        fetchTareas();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (location.pathname === "/tareas-pendientes") {
      console.log("📍 Ruta activa: tareas-pendientes → recargando");
      fetchTareas();
    }
  }, [location.pathname]);

  useEffect(() => {
    console.log("🚀 Componente TareasPendientes montado: recargando tareas");
    fetchTareas();
  }, []);

  return (
    <div className="card">
      <h2>{t("pending_tasks")}</h2>
      <button onClick={() => abrirModal()} style={{ marginBottom: 10 }}>
        ➕ {t("add_task")}
      </button>

      <table className="table">
        <thead>
          <tr>
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
          {tareas.map((tarea) => (
            <tr
              key={tarea.id}
              style={{
                backgroundColor: colorActividad(actividades[tarea.actividad] || tarea.nombre_actividad || tarea.actividad)
              }}
            >
              <td>{tarea.idx || "-"}</td>
              <td>{mostrarNombre(tarea.actividad, actividades)}</td>
              <td>
                {Array.isArray(tarea.productos)
                  ? tarea.productos.map((p, i) => (
                      <div key={i}>{mostrarNombre(p.producto, productos)}</div>
                    ))
                  : mostrarNombre(tarea.producto, productos)}
              </td>
              <td>
                {Array.isArray(tarea.productos)
                  ? tarea.productos.map((p, i) => <div key={i}>{p.cantidad}</div>)
                  : tarea.cantidad}
              </td>
              <td>
                {Array.isArray(tarea.operadores) && tarea.operadores.length > 0
                  ? tarea.operadores.map((opId, i) => (
                      <div key={i}>{mostrarNombre(opId, operadores)}</div>
                    ))
                  : "-"}
              </td>
              <td>{tarea.notas || "-"}</td>              
              <td style={{ fontWeight: "bold" }}>
                {(() => {
                  const estadoVisual = obtenerEstadoVisual(tarea.estado);
                  return (
                    <span style={{ 
                        color: estadoVisual.color,
                        fontSize: "16px",
                        fontWeight: "bold",
                        textShadow: "-1px -1px 0 white, 1px -1px 0 white, -1px 1px 0 white, 1px 1px 0 white" 
                        }}>
                      {estadoVisual.icono} {estadoVisual.texto}
                    </span>
                  );
                })()}
              </td>
              <td>
                <button onClick={() => abrirModal(tarea)}>{t("edit")}</button>
                <button onClick={() => setTareaAEliminar(tarea)}>{t("delete")}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Modal isOpen={modalAbierto} onRequestClose={() => setModalAbierto(false)}>
        <h3>{tareaActual?.id ? t("edit_task") : t("new_task")}</h3>
             
        {tareaActual && (
          <>
          <input
            type="text"
            placeholder={t("idx")}
            value={tareaActual?.idx || ""}
            onChange={(e) => tareaActual && setTareaActual({ ...tareaActual, idx: e.target.value })}
            style={{ width: "100%", marginTop: "10px", marginBottom: "10px" }}
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
                    p.producto && productos[p.producto]
                      ? { value: p.producto, label: productos[p.producto] }
                      : null
                  }
                  onChange={(e) => {
                    const nuevos = [...tareaActual.productos];
                    nuevos[index].producto = e.value;
                    setTareaActual({ ...tareaActual, productos: nuevos });
                  }}
                  placeholder={t("select_product")}
                  styles={{ container: base => ({ ...base, flex: 1 }) }}
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
                  style={{ width: "400px" }}
                />
                {index > 0 && (
                  <button onClick={() => {
                    const nuevos = tareaActual.productos.filter((_, i) => i !== index);
                    setTareaActual({ ...tareaActual, productos: nuevos });
                  }}>✖</button>
                )}
              </div>
            ))}

            <button
              onClick={() => setTareaActual({
                ...tareaActual,
                productos: [...tareaActual.productos, { producto: "", cantidad: "" }]
              })}
              style={{ marginTop: "10px" }}
            >
              ➕ {t("add_product")}
            </button>
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
            <textarea
              placeholder={t("notes")}
              value={tareaActual.notas}
              onChange={(e) => setTareaActual({ ...tareaActual, notas: e.target.value })}
              rows={2}
              style={{ width: "100%", marginTop: "10px" }}
            />            

            <button onClick={guardarTarea}>{t("save")}</button>
            <button onClick={() => setModalAbierto(false)}>{t("cancel")}</button>
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
            <button className="btn btn-secondary" onClick={() => setTareaAEliminar(null)}>
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

                  // Tracking manual opcional
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
            </button>
          </div>
        </Modal>
      )}
      <ToastContainer position="top-center" autoClose={1000} />
    </div>
  );
}
