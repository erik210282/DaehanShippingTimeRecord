import React, { useState } from "react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

export default function ConfiguracionTareas() {
  const [ordenTareas, setOrdenTareas] = useState(["Stage", "Label", "Scan", "Load"]);

  const cambiarOrden = (nuevoOrden) => {
    setOrdenTareas(nuevoOrden);
    toast.success("Orden de tareas actualizado");
  };

  return (
    <div className="card">
      <h2>{toast("configure_task_order")}</h2>
      <ul>
        {ordenTareas.map((tarea, index) => (
          <li key={index}>{tarea}</li>
        ))}
      </ul>
      <button onClick={() => cambiarOrden(["Label", "Stage", "Scan", "Load"])}>
        Cambiar Orden
      </button>
      <ToastContainer position="top-center" autoClose={2000} />
    </div>
  );
} 
