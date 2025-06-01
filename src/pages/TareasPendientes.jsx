// TareasPendientes.jsx
import React, { useEffect, useState } from "react";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  onSnapshot,
} from "firebase/firestore";
import { db } from "../firebase/config";
import Select from "react-select";
import Modal from "react-modal";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { useTranslation } from "react-i18next";

Modal.setAppElement("#root");

export default function TareasPendientes() {
  const [tareas, setTareas] = useState([]);
  const [actividades, setActividades] = useState({});
  const [productos, setProductos] = useState({});
  const [modalAbierto, setModalAbierto] = useState(false);
  const [tareaActual, setTareaActual] = useState(null);
  const { t, i18n } = useTranslation();

  useEffect(() => {
    const unsubAct = onSnapshot(collection(db, "actividades"), (snapshot) => {
      const act = {};
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.activo !== false) {
          act[doc.id] = data.nombre;
        }
      });
      const ordenadas = Object.fromEntries(
        Object.entries(act).sort(([, a], [, b]) => a.localeCompare(b))
      );
      setActividades(ordenadas);
    });

    const unsubProd = onSnapshot(collection(db, "productos"), (snapshot) => {
      const prod = {};
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.activo !== false) {
          prod[doc.id] = data.nombre;
        }
      });
      const ordenadas = Object.fromEntries(
        Object.entries(prod).sort(([, a], [, b]) => a.localeCompare(b))
      );
      setProductos(ordenadas);
    });

    const unsubTareas = onSnapshot(collection(db, "tareas_pendientes"), (snapshot) => {
      const tareasList = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      tareasList.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
      setTareas(tareasList.filter((t) => t.estado !== "finalizada"));
    });

    return () => {
      unsubAct();
      unsubProd();
      unsubTareas();
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

    const productosDuplicados = listaProductos.map(p => p.producto).filter((v, i, a) => a.indexOf(v) !== i);
    if (productosDuplicados.length > 0) {
      toast.error(t("no_duplicate_products"));
      return;
    }

    const datos = {
      idx: idx || "",
      actividad,
      productos: listaProductos.map(p => ({ producto: p.producto, cantidad: Number(p.cantidad) })),
      notas: notas || "",      
      estado: tareaActual.estado || "pendiente",
    };

    try {
      if (tareaActual.id) {
        await updateDoc(doc(db, "tareas_pendientes", tareaActual.id), datos);
        toast.success(t("task_updated"));
      } else {
        await addDoc(collection(db, "tareas_pendientes"), {
          ...datos,
          createdAt: serverTimestamp(),
        });
        toast.success(t("task_added"));
      }
      setModalAbierto(false);
    } catch (error) {
      toast.error(t("error_saving"));
    }
  };

  const eliminarTarea = async (id) => {
    try {
      await deleteDoc(doc(db, "tareas_pendientes", id));
      toast.success(t("task_deleted"));
    } catch {
      toast.error(t("error_deleting"));
    }
  };

  const mostrarNombre = (id, mapa) => mapa[id] || `ID: ${id}`;

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
            <th>{t("notes")}</th>            
            <th>{t("status")}</th>
            <th>{t("actions")}</th>
          </tr>
        </thead>
        <tbody key={i18n.language}>
          {tareas.map((tarea) => (
            <tr key={tarea.id}>
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
              <td>{tarea.notas || "-"}</td>              
              <td>{tarea.estado === "started" ? t("started") : t("pending")}</td>
              <td>
                <button onClick={() => abrirModal(tarea)}>{t("edit")}</button>
                <button onClick={() => eliminarTarea(tarea.id)}>{t("delete")}</button>
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
                  value={p.producto ? { value: p.producto, label: productos[p.producto] } : null}
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
                  value={p.cantidad}
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

      <ToastContainer position="top-center" autoClose={1000} />
    </div>
  );
}
