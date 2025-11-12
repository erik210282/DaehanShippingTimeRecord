import React, { useState } from "react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { useTranslation } from "react-i18next";
import { BtnPrimary } from "../components/controls";

export default function ConfiguracionTareas() {
  const [ordenTareas, setOrdenTareas] = useState(["Stage", "Label", "Scan", "Load"]);

  const cambiarOrden = (nuevoOrden) => {
    setOrdenTareas(nuevoOrden);
    toast.success(t("task_order_updated", "Orden de tareas actualizado"));
  };

  return (
    <div className="card">
      <h2>{t("configure_task_order")}</h2>
      <ul>
        {ordenTareas.map((tarea, index) => (
          <li key={index}>{tarea}</li>
        ))}
      </ul>
      <BtnPrimary onClick={() => cambiarOrden(["Label", "Stage", "Scan", "Load"])}>
        {t("change_order", "Cambiar Orden")}
      </BtnPrimary>
      <ToastContainer position="top-center" autoClose={2000} />
    </div>
  );
} 
