// [NO SE CAMBIÓ NADA DE LA CABECERA]
import React, { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  deleteDoc,
  updateDoc,
  addDoc,
  doc,
} from "firebase/firestore";
import { db } from "../firebase/config";
import Select from "react-select";
import Modal from "react-modal";
import Papa from "papaparse";
import { useTranslation } from "react-i18next";
import { isAfter, isBefore, format } from "date-fns";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { onSnapshot } from "firebase/firestore";

Modal.setAppElement("#root");

export default function Registros() {
  const { t, i18n } = useTranslation();

  const [registros, setRegistros] = useState([]);
  const [filtrados, setFiltrados] = useState([]);
  const [actividadFiltro, setActividadFiltro] = useState([]);
  const [productoFiltro, setProductoFiltro] = useState([]);
  const [operadorFiltro, setOperadorFiltro] = useState([]);
  const [busquedaTexto, setBusquedaTexto] = useState("");
  const [modalAbierto, setModalAbierto] = useState(false);
  const [registroEditado, setRegistroEditado] = useState(null);
  const [actividades, setActividades] = useState([]);
  const [productos, setProductos] = useState([]);
  const [operadores, setOperadores] = useState([]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "registros"), (snapshot) => {
      const datos = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setRegistros(datos);
    });

    getDocs(collection(db, "actividades")).then((snapshot) => {
      setActividades(
        snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      );
    });

    getDocs(collection(db, "productos")).then((snapshot) => {
      setProductos(
        snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      );
    });

    getDocs(collection(db, "operadores")).then((snapshot) => {
      setOperadores(
        snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      );
    });

    return () => unsub();
  }, []);

  const obtenerNombre = (id, lista) => {
    const item = lista.find((i) => i.id === id);
    return item ? item.nombre : id;
  };

  const eliminarRegistro = async (id) => {
    await deleteDoc(doc(db, "registros", id));
    toast.success(t("registro_eliminado"));
  };

  const abrirModalEdicion = (registro) => {
    setRegistroEditado(registro);
    setModalAbierto(true);
  };

  const guardarCambios = async () => {
    if (registroEditado.id) {
      await updateDoc(doc(db, "registros", registroEditado.id), registroEditado);
      toast.success(t("registro_actualizado"));
    } else {
      await addDoc(collection(db, "registros"), registroEditado);
      toast.success(t("registro_agregado"));
    }
    setModalAbierto(false);
    setRegistroEditado(null);
  };

  useEffect(() => {
    let nuevos = [...registros];

    if (actividadFiltro.length > 0) {
      nuevos = nuevos.filter((r) => actividadFiltro.includes(r.actividad));
    }

    if (productoFiltro.length > 0) {
      nuevos = nuevos.filter((r) =>
        (r.productos || []).some((p) => productoFiltro.includes(p.nombre))
      );
    }

    if (operadorFiltro.length > 0) {
      nuevos = nuevos.filter((r) =>
        (r.operadores || []).some((o) => operadorFiltro.includes(o))
      );
    }

    if (busquedaTexto.trim()) {
      nuevos = nuevos.filter((r) =>
        r.notas?.toLowerCase().includes(busquedaTexto.toLowerCase())
      );
    }

    setFiltrados(nuevos);
  }, [actividadFiltro, productoFiltro, operadorFiltro, busquedaTexto, registros]);

  const exportarCSV = () => {
    const datos = filtrados.flatMap((r) =>
      (r.productos || []).map((p) => ({
        id: r.id,
        actividad: obtenerNombre(r.actividad, actividades),
        operador: (r.operadores || []).map((o) => obtenerNombre(o, operadores)).join(", "),
        producto: p.nombre,
        cantidad: p.cantidad,
        duracion: r.duracion,
        notas: r.notas || "",
        fecha: r.hora_inicio ? format(new Date(r.hora_inicio), "yyyy-MM-dd HH:mm") : "",
      }))
    );

    const csv = Papa.unparse(datos);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "registros.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="contenedor">
      <ToastContainer />
      <h1>{t("registros")}</h1>
      <button onClick={exportarCSV}>{t("exportar_csv")}</button>
      <table>
        <thead>
          <tr>
            <th>{t("actividad")}</th>
            <th>{t("operadores")}</th>
            <th>{t("productos")}</th>
            <th>{t("cantidad")}</th>
            <th>{t("duracion")}</th>
            <th>{t("notas")}</th>
            <th>{t("acciones")}</th>
          </tr>
        </thead>
        <tbody>
          {filtrados.map((r) => (
            <tr key={r.id}>
              <td>{obtenerNombre(r.actividad, actividades)}</td>
              <td>{(r.operadores || []).map((o) => obtenerNombre(o, operadores)).join(", ")}</td>
              <td>{(r.productos || []).map((p) => p.nombre).join(", ")}</td>
              <td>{(r.productos || []).map((p) => p.cantidad).join(", ")}</td>
              <td>{r.duracion}</td>
              <td>{r.notas}</td>
              <td>
                <button onClick={() => abrirModalEdicion(r)}>{t("editar")}</button>
                <button onClick={() => eliminarRegistro(r.id)}>{t("eliminar")}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Modal isOpen={modalAbierto} onRequestClose={() => setModalAbierto(false)}>
        <h2>{registroEditado?.id ? t("editar_registro") : t("nuevo_registro")}</h2>
        <label>{t("actividad")}</label>
        <Select
          options={actividades.map((a) => ({ value: a.id, label: a.nombre }))}
          value={{
            value: registroEditado?.actividad,
            label: obtenerNombre(registroEditado?.actividad, actividades),
          }}
          onChange={(op) =>
            setRegistroEditado({ ...registroEditado, actividad: op.value })
          }
        />
        <label>{t("productos")}</label>
        <Select
          isMulti
          options={productos.map((p) => ({ value: p.nombre, label: p.nombre }))}
          value={(registroEditado?.productos || []).map((p) => ({
            value: p.nombre,
            label: p.nombre,
          }))}
          onChange={(values) => {
            const productos = values.map((v) => ({
              nombre: v.value,
              cantidad: 1,
            }));
            setRegistroEditado({ ...registroEditado, productos });
          }}
        />
        <label>{t("notas")}</label>
        <input
          type="text"
          value={registroEditado?.notas || ""}
          onChange={(e) =>
            setRegistroEditado({ ...registroEditado, notas: e.target.value })
          }
        />
        <button onClick={guardarCambios}>{t("guardar")}</button>
        <button onClick={() => setModalAbierto(false)}>{t("cancelar")}</button>
      </Modal>
    </div>
  );
}
