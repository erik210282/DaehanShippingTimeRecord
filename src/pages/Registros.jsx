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
  const [registroEditando, setRegistroEditando] = useState(null);

  const [actividadFiltro, setActividadFiltro] = useState([]);
  const [productoFiltro, setProductoFiltro] = useState([]);
  const [operadorFiltro, setOperadorFiltro] = useState([]);
  const [busquedaTexto, setBusquedaTexto] = useState("");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [errorFecha, setErrorFecha] = useState("");
  const [errorBusqueda, setErrorBusqueda] = useState("");

  const [modalAbierto, setModalAbierto] = useState(false);
  const [registroActual, setRegistroActual] = useState(null);
  const [esNuevo, setEsNuevo] = useState(false);

  const [mapaActividades, setMapaActividades] = useState({});
  const [mapaProductos, setMapaProductos] = useState({});
  const [mapaOperadores, setMapaOperadores] = useState({});

  const [selectActividades, setSelectActividades] = useState([]);
  const [selectProductos, setSelectProductos] = useState([]);
  const [selectOperadores, setSelectOperadores] = useState([]);

  const [pestañaActiva, setPestañaActiva] = useState("paginado");
  const [modoAgrupacion, setModoAgrupacion] = useState("operador");

  const [registroAEliminar, setRegistroAEliminar] = useState(null);

  const parseFirebaseDate = (fecha) => {
    if (!fecha) return null;
    if (typeof fecha === "string" || typeof fecha === "number") {
      const parsed = new Date(fecha);
      return isNaN(parsed) ? null : parsed;
    }
    if (fecha.toDate) return fecha.toDate();
    return new Date(fecha);
  };

const cargarCatalogos = async () => {
  const [actSnap, prodSnap, opSnap] = await Promise.all([
    getDocs(collection(db, "actividades")),
    getDocs(collection(db, "productos")),
    getDocs(collection(db, "operadores")),
  ]);

  const actividades = {};
  const productos = {};
  const operadores = {};

  actSnap.docs.forEach((doc) => (actividades[doc.id] = doc.data().nombre));
  prodSnap.docs.forEach((doc) => (productos[doc.id] = doc.data().nombre));
  opSnap.docs.forEach((doc) => (operadores[doc.id] = doc.data().nombre));

  setMapaActividades(actividades);
  setMapaProductos(productos);
  setMapaOperadores(operadores);

  setSelectActividades(
    actSnap.docs
      .filter((doc) => doc.data().activo !== false)
      .map((doc) => ({
        value: doc.id,
        label: doc.data().nombre,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  );

  setSelectProductos(
    prodSnap.docs
      .filter((doc) => doc.data().activo !== false)
      .map((doc) => ({
        value: doc.id,
        label: doc.data().nombre,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  );

  setSelectOperadores(
    opSnap.docs
      .filter((doc) => doc.data().activo !== false)
      .map((doc) => ({
        value: doc.id,
        label: doc.data().nombre,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  );
};

  const actualizarRegistros = (snapshot) => {
    const nuevos = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        idx: data.idx || "",
        ...data,
        operadores: Array.isArray(data.operadores)
          ? data.operadores
          : typeof data.operador === "string" && data.operador.trim()
          ? [data.operador]
          : [],
        horaInicio: parseFirebaseDate(data.hora_inicio),
        horaFin: parseFirebaseDate(data.hora_fin),
        duracion: data.duracion ?? "",
      };
    });
    nuevos.sort((a, b) => new Date(a.horaInicio) - new Date(b.horaInicio));
    setRegistros(nuevos);
    setFiltrados(nuevos);
  };

  useEffect(() => {
    cargarCatalogos();

    const unsub = onSnapshot(collection(db, "actividades_realizadas"), actualizarRegistros);
    return () => unsub();
  }, []);

  useEffect(() => {
    if (errorFecha) {
      setErrorFecha(t("invalid_date_range"));
    }
  }, [i18n.language]);

  useEffect(() => {
    if (fechaDesde && fechaHasta && new Date(fechaDesde) > new Date(fechaHasta)) {
      setErrorFecha(t("invalid_date_range"));
      return;
    } else {
      setErrorFecha("");
    }

    const texto = busquedaTexto.toLowerCase();

    const resultados = registros.filter((r) => {
      if (!r.horaFin) return false;
      const cumpleActividad =
        actividadFiltro.length === 0 ||
        actividadFiltro.some((a) => a.value === r.actividad);

      const cumpleProducto =
        productoFiltro.length === 0 ||
        productoFiltro.some((p) => p.value === r.producto);

      const cumpleOperador =
        operadorFiltro.length === 0 ||
        (Array.isArray(r.operadores) &&
          operadorFiltro.some((o) => r.operadores.includes(o.value)));

      const cumpleTexto =
        !texto ||
        mapaActividades[r.actividad]?.toLowerCase().includes(texto) ||
        mapaProductos[r.producto]?.toLowerCase().includes(texto) ||
        (Array.isArray(r.operadores) &&
          r.operadores.some(
            (id) => mapaOperadores[id]?.toLowerCase().includes(texto)
          ));

      const fechaInicio = r.horaInicio instanceof Date ? r.horaInicio : new Date(r.horaInicio);
      const cumpleDesde = !fechaDesde || isAfter(fechaInicio, new Date(fechaDesde));
      const cumpleHasta = !fechaHasta || isBefore(fechaInicio, new Date(fechaHasta));

      return (
        cumpleActividad &&
        cumpleProducto &&
        cumpleOperador &&
        cumpleTexto &&
        cumpleDesde &&
        cumpleHasta
      );
    });

    resultados.sort((a, b) => new Date(a.horaInicio) - new Date(b.horaInicio));
    setFiltrados(resultados);
    setErrorBusqueda(texto && resultados.length === 0 ? t("no_results_found") : "");
  }, [
    actividadFiltro,
    productoFiltro,
    operadorFiltro,
    busquedaTexto,
    fechaDesde,
    fechaHasta,
    registros,
  ]);

  const abrirModal = (registro) => {
  if (registro) {
    const formatFecha = (fecha) => {
      if (!fecha) return "";
      const d = new Date(fecha);
      const pad = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    setRegistroActual({
      ...registro,
      productos: Array.isArray(registro.productos) ? registro.productos : [{ producto: registro.producto, cantidad: registro.cantidad }],
      horaInicio: formatFecha(registro.horaInicio),
      horaFin: formatFecha(registro.horaFin),
    });
    setEsNuevo(false);
  } else {
    setRegistroActual({
      idx: "",
      actividad: "",
      productos: [{ producto: "", cantidad: "" }],
      operadores: [],
      cantidad: "",
      horaInicio: "",
      horaFin: "",
      duaacion: "",
      notas: "",
    });
    setEsNuevo(true);
  }
  setModalAbierto(true);
};

  const eliminarRegistro = async (id) => {
    try {
      await deleteDoc(doc(db, "actividades_realizadas", id));
      setRegistros(registros.filter((r) => r.id !== id));
      toast.success(t("delete_success"));
    } catch {
      toast.error(t("error_deleting"));
    }
  };

 const guardarRegistro = async () => {
  const { idx, actividad, productos, operadores, notas, horaInicio, horaFin, duracion } = registroActual;

  if (!idx || !actividad || !productos.length || !operadores.length || !horaInicio || !horaFin || !duracion) {
    toast.error(t("fill_all_fields"));
    return;
  }

  const productosLimpios = productos.map(p => ({
    producto: p.producto,
    cantidad: Number(p.cantidad),
  }));

  if (productosLimpios.some(p => !p.producto || isNaN(p.cantidad) || p.cantidad <= 0)) {
    toast.error(t("fill_all_fields"));
    return;
  }

  const productosDuplicados = productosLimpios.map(p => p.producto).filter((v, i, a) => a.indexOf(v) !== i);
  if (productosDuplicados.length > 0) {
    toast.error(t("no_duplicate_products"));
    return;
  }

    if (!esNuevo) {
    const duplicado = registros.some(r =>
      r.id !== registroActual.id &&
      r.actividad === actividad &&
      JSON.stringify(r.operadores.sort()) === JSON.stringify(operadores.sort()) &&
      new Date(r.hora_inicio).getTime() === new Date(horaInicio).getTime() &&
      new Date(r.hora_fin).getTime() === new Date(horaFin).getTime()
    );

    if (duplicado) {
      toast.error(t("no_duplicate_activity"));
      return;
    }
  }

  if (new Date(horaInicio).getTime() > new Date(horaFin).getTime()) {
    toast.error(t("invalid_time_range"));
    return;
  }

  const data = {
    idx,
    actividad,
    productos: productosLimpios,
    operadores,
    notas,
    hora_inicio: new Date(horaInicio),
    hora_fin: new Date(horaFin),
    duracion,
  };

  try {
    if (esNuevo) {
      await addDoc(collection(db, "actividades_realizadas"), data);
    } else {
      const ref = doc(db, "actividades_realizadas", registroActual.id);
      await updateDoc(ref, data);
    }
    toast.success(t("save_success"));
    setModalAbierto(false);
  } catch {
    toast.error(t("error_saving"));
  }
};

  const exportarCSV = () => {
    const datosCSV = filtrados.flatMap((d) => {
      const inicio = new Date(d.horaInicio);
      const fin = new Date(d.horaFin);
    
      return (Array.isArray(d.productos) ? d.productos : [{ producto: d.producto, cantidad: d.cantidad }]).map((p) => ({
        [t("idx")]: registroActual?.idx || "N/A",
        [t("activity")]: mapaActividades[d.actividad] || `ID: ${d.actividad}`,
        [t("product")]: mapaProductos[p.producto] || `ID: ${p.producto}`,
        [t("operator")]: Array.isArray(d.operadores)
          ? d.operadores.map((id) => mapaOperadores[id] || `ID: ${id}`).join(", ")
          : "",
        [t("amount")]: p.cantidad,
        [t("start_time")]: inicio.toLocaleString(),
        [t("end_time")]: fin.toLocaleString(),
        [t("duration_min")]: d.duracion ? Math.round(d.duracion / 60) : "-",
        [t("notes")]: d.notas || "N/A",
      }));
    });

    const csv = Papa.unparse(datosCSV);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "registros.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(t("export_success") || "CSV exportado correctamente");
  };

  const registrosAgrupados = () => {
    const grupos = {};
    filtrados.forEach((r) => {
      let key = "";
      if (modoAgrupacion === "operador") {
        key = Array.isArray(r.operadores) ? r.operadores.map(id => mapaOperadores[id]).join(", ") : `ID: ${r.operadores}`;
      } else if (modoAgrupacion === "producto") {
        key = r.producto && mapaProductos[r.producto]
          ? mapaProductos[r.producto]
          : r.producto
          ? `ID: ${r.producto}`
          : t("multi_product");
      } else if (modoAgrupacion === "actividad") {
        key = mapaActividades[r.actividad] || `ID: ${r.actividad}`;
      } else if (modoAgrupacion === "fecha") {
        key = format(new Date(r.horaInicio), "yyyy-MM-dd");
      }
      if (!grupos[key]) grupos[key] = [];
      grupos[key].push(r);
    });

    const gruposOrdenados = {};
      Object.keys(grupos).sort((a, b) => a.localeCompare(b)).forEach((key) => {
        gruposOrdenados[key] = grupos[key];
      });

    return gruposOrdenados;
  };

  return (
    <div className="card">
      <h2>{t("records")}</h2>
      <div style={{ display: "flex", gap: "10px", marginBottom: "10px" }}>
        <button onClick={() => setPestañaActiva("paginado")} disabled={pestañaActiva === "paginado"}>
          📄 {t("records_title")}
        </button>
        <button onClick={() => setPestañaActiva("agrupado")} disabled={pestañaActiva === "agrupado"}>
          📊 {t("grouped_records")}
        </button>
      </div>

      <button
        style={{
          position: "fixed",
          bottom: "20px",
          right: "20px",
          backgroundColor: "#007bff",
          color: "white",
          padding: "10px 20px",
          border: "none",
          borderRadius: "50%",
          fontSize: "24px",
          cursor: "pointer",
        }}
        onClick={() => abrirModal(null)}
      >
        +
      </button>

      {pestañaActiva === "paginado" ? (
        <div>
          <input placeholder={t("search")} value={busquedaTexto} onChange={(e) => setBusquedaTexto(e.target.value)} />
          {errorBusqueda && <p style={{ color: "red" }}>{errorBusqueda}</p>}

          <input type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} />
          <input type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} />
          {errorFecha && <p style={{ color: "red" }}>{errorFecha}</p>}

          <Select isMulti options={selectActividades} value={actividadFiltro} onChange={setActividadFiltro} placeholder={t("select_activity")} />
          <Select isMulti options={selectProductos} value={productoFiltro} onChange={setProductoFiltro} placeholder={t("select_product")} />
          <Select isMulti options={selectOperadores} value={operadorFiltro} onChange={setOperadorFiltro} placeholder={t("select_operators")} />

          <button onClick={() => {
            setActividadFiltro([]); setProductoFiltro([]); setOperadorFiltro([]);
            setBusquedaTexto(""); setFechaDesde(""); setFechaHasta("");
          }}>{t("clear_filters")}</button>

          <table className="table">
            <thead>
              <tr>
                <th>{t("idx")}</th>
                <th>{t("activity")}</th>
                <th>{t("product")}</th>
                <th>{t("amount")}</th>
                <th>{t("operator")}</th>
                <th>{t("start_time")}</th>
                <th>{t("end_time")}</th>
                <th>⏱ {t("duration_min")}</th>
                <th>{t("notes")}</th>
                <th>{t("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((r) => {
                const inicio = new Date(r.horaInicio);
                const fin = new Date(r.horaFin);
                return (
                  <tr key={r.id}>
                    <td>{r.idx || "N/A"}</td>
                    <td>{mapaActividades[r.actividad]}</td>
                   <td>
                    {Array.isArray(r.productos)
                      ? r.productos.map((p, i) => (
                          <div key={i}>{mapaProductos[p.producto] || `ID: ${p.producto}`}</div>
                        ))
                      : mapaProductos[r.producto]}
                  </td>
                  <td>
                    {Array.isArray(r.productos)
                      ? r.productos.map((p, i) => (
                          <div key={i}>{p.cantidad}</div>
                        ))
                      : r.cantidad}
                  </td>
                    <td>{r.operadores && Array.isArray(r.operadores) ? r.operadores.map((id) => mapaOperadores[id] || `ID: ${id}`).join(", ") : "N/A"}</td>
                    <td>{inicio.toLocaleString()}</td>
                    <td>{fin.toLocaleString()}</td>
                    <td>{r.duracion ? `${Math.round(r.duracion)} min` : "-"}</td>
                    <td>{r.notas || "N/A"}</td>
                    <td>
                      <button onClick={() => abrirModal(r)}>{t("edit")}</button>
                      <button
                        onClick={() => setRegistroAEliminar(r)}
                        className="btn btn-danger"
                      >
                        {t("delete")}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <button onClick={exportarCSV}>{t("export_csv")}</button>
        </div>
      ) : (
        <div>
          <label>{t("group_by")}: </label>
          <select value={modoAgrupacion} onChange={(e) => setModoAgrupacion(e.target.value)}>
            <option value="operador">{t("operator")}</option>
            <option value="producto">{t("product")}</option>
            <option value="actividad">{t("activity")}</option>
            <option value="starttime">{t("fecha")}</option>
          </select>

          {Object.entries(registrosAgrupados()).map(([grupo, lista]) => (
            <div key={grupo} style={{ marginBottom: "20px" }}>
              <h4>{grupo}</h4>
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("idx")}</th>
                    <th>{t("activity")}</th>
                    <th>{t("operator")}</th>
                    <th>{t("product")}</th>
                    <th>{t("amount")}</th>
                    <th>{t("start_time")}</th>
                    <th>{t("end_time")}</th>
                    <th>⏱ {t("duration_min")}</th>
                    <th>{t("notes")}</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((r) => {
                    return (
                      <tr key={r.id}>
                        <td>{r.idx || "N/A"}</td>
                        <td>{mapaActividades[r.actividad]}</td>
                        <td>{r.operadores && Array.isArray(r.operadores) ? r.operadores.map((id) => mapaOperadores[id] || `ID: ${id}`).join(", ") : "N/A"}</td>
                        <td>
                          {Array.isArray(r.productos)
                            ? r.productos.map((p, i) => (
                                <div key={i}>{mapaProductos[p.producto] || `ID: ${p.producto}`}</div>
                              ))
                            : mapaProductos[r.producto]}
                        </td>
                        <td>
                          {Array.isArray(r.productos)
                            ? r.productos.map((p, i) => (
                                <div key={i}>{p.cantidad}</div>
                              ))
                            : r.cantidad}
                        </td>
                        <td>{new Date(r.horaInicio).toLocaleString()}</td>
                        <td>{new Date(r.horaFin).toLocaleString()}</td>
                        <td>{r.duracion ? `${Math.round(r.duracion)} min` : "-"}</td>
                        <td>{r.notas || "N/A"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
      
        <Modal isOpen={modalAbierto} onRequestClose={() => setModalAbierto(false)}>
          <h3>{esNuevo ? t("add") : t("edit")}</h3>

          <input
            type="text"
            placeholder={t("idx")}
            value={registroActual?.idx}
            onChange={(e) => setRegistroActual({ ...registroActual, idx: e.target.value })}
            style={{ width: "400px" }}
          />

          <Select options={selectActividades} value={selectActividades.find((i) => i.value === registroActual?.actividad)} onChange={(e) => setRegistroActual({ ...registroActual, actividad: e.value })} placeholder={t("select_activity")} />

          {registroActual?.productos?.map((p, index) => (
            <div key={index} style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
              <Select
                options={selectProductos}
                value={selectProductos.find((opt) => opt.value === p.producto)}
                onChange={(e) => {
                  const nuevos = [...registroActual.productos];
                  nuevos[index].producto = e.value;
                  setRegistroActual({ ...registroActual, productos: nuevos });
                }}
                placeholder={t("select_product")}
                styles={{ container: (base) => ({ ...base, flex: 1 }) }}
              />
              <input
                type="number"
                placeholder={t("amount")}
                value={p.cantidad}
                onChange={(e) => {
                  const nuevos = [...registroActual.productos];
                  nuevos[index].cantidad = e.target.value;
                  setRegistroActual({ ...registroActual, productos: nuevos });
                }}
                style={{ width: "400px" }}
              />
              {index > 0 && (
                <button onClick={() => {
                  const nuevos = registroActual.productos.filter((_, i) => i !== index);
                  setRegistroActual({ ...registroActual, productos: nuevos });
                }}>✖</button>
              )}
            </div>
          ))}
          <button
            onClick={() => setRegistroActual({
              ...registroActual,
              productos: [...registroActual.productos, { producto: "", cantidad: "" }],
            })}
            style={{ marginTop: "10px" }}
          >
            ➕ {t("add_product")}
          </button>
          <Select isMulti options={selectOperadores} value={selectOperadores.filter((i) => registroActual?.operadores?.includes(i.value))} onChange={(e) => setRegistroActual({ ...registroActual, operadores: e.map((i) => i.value) })} placeholder={t("select_operator")} />
          <textarea value={registroActual?.notas} onChange={(e) => setRegistroActual({ ...registroActual, notas: e.target.value })} placeholder={t("notes")} rows={2} style={{ width: "100%", marginTop: 10 }} />
          <input type="datetime-local" value={registroActual?.horaInicio} onChange={(e) => setRegistroActual({ ...registroActual, horaInicio: e.target.value })} />
          <input type="datetime-local" value={registroActual?.horaFin} onChange={(e) => setRegistroActual({ ...registroActual, horaFin: e.target.value })} />

          <label>{t("duration_min")}</label>
            <input
              type="number"
              className="form-control"
              value={registroActual?.duracion || ""}
              onChange={(e) =>
                setRegistroActual({ ...registroActual, duracion: Number(e.target.value) })
              }
            />
          <button onClick={guardarRegistro}>{t("save")}</button>
          <button onClick={() => setModalAbierto(false)}>{t("cancel")}</button>
        </Modal>  

        {registroAEliminar && registroAEliminar.id && (
          <Modal
            isOpen={true}
            onRequestClose={() => setRegistroAEliminar(null)}
            className="modal"
            overlayClassName="modal-overlay"
          >
            <h2>{t("confirm_delete_title")}</h2>
            <p>{t("confirm_delete_text")}</p>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "1rem" }}>
              <button
                className="btn btn-secondary"
                onClick={() => setRegistroAEliminar(null)}
              >
                {t("cancel")}
              </button>

              <button
                className="btn btn-danger"
                onClick={async () => {
                  try {
                    console.log("Eliminando ID:", registroAEliminar.id);
                    const ref = doc(db, "actividades_realizadas", registroAEliminar.id);
                    await deleteDoc(ref);
                    setRegistros((prev) =>
                      prev.filter((r) => r.id !== registroAEliminar.id)
                    );
                    toast.success(t("delete_success"));
                  } catch (error) {
                    console.error("Error eliminando:", error);
                    toast.error(t("delete_error"));
                  } finally {
                    setRegistroAEliminar(null);
                  }
                }}
              >
                {t("confirm")}
              </button>
            </div>
          </Modal>
        )}
        <ToastContainer
          position="top-center"
          autoClose={1500}
          style={{ zIndex: 9999, top: "80px" }}
        />  
    </div>
  );
}
