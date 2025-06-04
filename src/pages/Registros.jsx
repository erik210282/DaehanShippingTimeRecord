import React, { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  deleteDoc,
  updateDoc,
  addDoc,
  doc,
  onSnapshot,
} from "firebase/firestore";
import { db } from "../firebase/config";
import Select from "react-select";
import Modal from "react-modal";
import Papa from "papaparse";
import { useTranslation } from "react-i18next";
import { isAfter, isBefore, format } from "date-fns";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

Modal.setAppElement("#root");

export default function Registros() {
  const { t, i18n } = useTranslation();

  const [registros, setRegistros] = useState([]);
  const [filtrados, setFiltrados] = useState([]);

  const [actividadFiltro, setActividadFiltro] = useState([]);
  const [productoFiltro, setProductoFiltro] = useState([]);
  const [operadorFiltro, setOperadorFiltro] = useState([]);

  const [mapaProductos, setMapaProductos] = useState({});

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "registros"), (snapshot) => {
      const nuevos = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setRegistros(nuevos);
      setFiltrados(nuevos);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const obtenerProductos = async () => {
      const productosSnapshot = await getDocs(collection(db, "productos"));
      const mapa = {};
      productosSnapshot.forEach((doc) => {
        mapa[doc.id] = doc.data().nombre;
      });
      setMapaProductos(mapa);
    };
    obtenerProductos();
  }, []);

  const mostrarProductos = (registro) => {
    if (!registro || !Array.isArray(registro.productos)) return "-";

    return registro.productos
      .map((prod) => `${mapaProductos[prod.producto] || prod.producto} (${prod.cantidad})`)
      .join(", ");
  };

  const exportarCSV = () => {
    const datos = filtrados.flatMap((r) => {
      const productos = Array.isArray(r.productos) ? r.productos : [];
      return productos.map((p) => ({
        fecha: r.fecha,
        actividad: r.actividad,
        operador: r.operador,
        producto: mapaProductos[p.producto] || p.producto,
        cantidad: p.cantidad,
      }));
    });
    const csv = Papa.unparse(datos);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "registros.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div>
      <h2>{t("records")}</h2>
      <button onClick={exportarCSV}>{t("export_csv")}</button>
      <table>
        <thead>
          <tr>
            <th>{t("date")}</th>
            <th>{t("activity")}</th>
            <th>{t("operator")}</th>
            <th>{t("products")}</th>
          </tr>
        </thead>
        <tbody>
          {filtrados.map((r) => (
            <tr key={r.id}>
              <td>{r.fecha}</td>
              <td>{r.actividad}</td>
              <td>{r.operador}</td>
              <td>{mostrarProductos(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ToastContainer position="top-center" />
    </div>
  );
}
