import React, { useState, useEffect } from "react";
import { collection, getDocs, updateDoc, doc } from "firebase/firestore";
import { db } from "../firebase/config";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { useTranslation } from "react-i18next";

export default function TareasOperario() {
  const { t } = useTranslation();
  const [tareas, setTareas] = useState([]);
  const [tareaSeleccionada, setTareaSeleccionada] = useState(null);
  const [horaInicio, setHoraInicio] = useState("");
  const [horaFin, setHoraFin] = useState("");

  useEffect(() => {
    const cargarTareas = async () => {
      const tareasSnap = await getDocs(collection(db, "tareas_pendientes"));
      setTareas(tareasSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    };

    cargarTareas();
  }, []);

  const iniciarTarea = (tarea) => {
    setTareaSeleccionada(tarea);
    setHoraInicio(new Date().toISOString());
  };

  const finalizarTarea = async () => {
    if (!horaInicio || !horaFin) {
      toast.error(t("fill_time"));
      return;
    }

    const tareaActualizada = {
      ...tareaSeleccionada,
      horaFin,
      estado: "finalizada",
    };

    const ref = doc(db, "tareas_pendientes", tareaSeleccionada.id);
    await updateDoc(ref, tareaActualizada);

    toast.success(t("task_completed"));
  };

  return (
    <div className="card">
      <h3>{t("pending_tasks_for_operator")}</h3>

      {tareas.map((tarea) => (
        <div key={tarea.id}>
          <p>{tarea.actividad} - {tarea.producto}</p>
          {tarea.estado === "pendiente" && (
            <button onClick={() => iniciarTarea(tarea)}>{t("start_task")}</button>
          )}
          {tarea.estado === "en progreso" && (
            <div>
              <input
                type="datetime-local"
                value={horaFin}
                onChange={e => setHoraFin(e.target.value)}
              />
              <button onClick={finalizarTarea}>{t("finish_task")}</button>
            </div>
          )}
        </div>
      ))}

      <ToastContainer position="top-center" autoClose={2000} />
    </div>
  );
}
