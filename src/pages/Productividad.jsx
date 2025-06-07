import React, { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/config";
import { useTranslation } from "react-i18next";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { Bar, Pie } from "react-chartjs-2";
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  ArcElement,
  Tooltip,
  Legend,
} from "chart.js";
import Papa from "papaparse";
import {  trackedAddDoc, trackedUpdateDoc, trackedDeleteDoc, trackedOnSnapshot, trackedGetDocs, trackedGetDoc } from "../utils/firestoreLogger";


ChartJS.register(
  BarElement,
  CategoryScale,
  LinearScale,
  ArcElement,
  Tooltip,
  
  Legend
);

export default function Productividad() {
  const { t } = useTranslation();
  const [registros, setRegistros] = useState([]);
  const [agrupadoPor, setAgrupadoPor] = useState("actividad");
  const [agrupadoPor2, setAgrupadoPor2] = useState(""); // Segunda selección para tabla cruzada
  const [tipoGrafica, setTipoGrafica] = useState("bar");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [errorFecha, setErrorFecha] = useState(""); // Estado para manejar los errores de fecha
  const [operadores, setOperadores] = useState({});
  const [actividades, setActividades] = useState({});
  const [productos, setProductos] = useState({});

  useEffect(() => {
    const cargarDatos = async () => {
      const [regSnap, opSnap, actSnap, prodSnap] = await Promise.all([
        trackedGetDocs(collection(db, "actividades_realizadas"), {
        pagina: "Registros",
        seccion: "Obtiene Actividades Realizadas 1",
      }),
        trackedGetDocs(collection(db, "operadores"), {
        pagina: "Registros",
        seccion: "Obtiene operadores 2",
      }),
        trackedGetDocs(collection(db, "actividades"), {
        pagina: "Registros",
        seccion: "Obtiene Actividades 3",
      }),
        trackedGetDocs(collection(db, "productos"), {
        pagina: "Registros",
        seccion: "Obtiene Productos 4",
      }),
      ]);

      const operadoresMap = {};
      const actividadesMap = {};
      const productosMap = {};

      opSnap.docs.forEach((doc) => (operadoresMap[doc.id] = doc.data().nombre));
      actSnap.docs.forEach((doc) => (actividadesMap[doc.id] = doc.data().nombre));
      prodSnap.docs.forEach((doc) => (productosMap[doc.id] = doc.data().nombre));

      setOperadores(operadoresMap);
      setActividades(actividadesMap);
      setProductos(productosMap);

      const registros = regSnap.docs
      .map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }))
      .filter((r) => r.estado === "completed");
      setRegistros(registros);
    };

    cargarDatos();
  }, []);

  const validarFechas = () => {
    if (desde && hasta) {
      if (new Date(desde) > new Date(hasta)) {
        if (errorFecha !== t("invalid_date_range")) { 
          setErrorFecha(t("invalid_date_range"));
        }
        return false;
      } else {
        if (errorFecha !== "") { 
          setErrorFecha("");
        }
        return true;
      }
    }
    return true;
  };

  const filtrarRegistros = () => {
    if (!validarFechas()) return [];

    const registrosFiltrados = registros.filter((r) => {
      const inicio = r.hora_inicio?.toDate?.();
      if (!inicio) return false;
      if (desde && new Date(inicio) < new Date(desde)) return false;
      if (hasta && new Date(inicio) > new Date(hasta)) return false;
      return true;
    });
    return registrosFiltrados;
  };

  const calcularPromedioTiempo = () => {
    const promedios = {};
    filtrarRegistros().forEach((r) => {
      let claves = [];
      if (agrupadoPor === "operador") claves = r.operadores || [];
      else if (agrupadoPor === "actividad") claves = [r.actividad];
      else if (agrupadoPor === "producto") {
        claves = Array.isArray(r.productos)
          ? r.productos.map((p) => p.producto)
          : [r.producto];
      }

      claves.forEach((clave) => {
        const horaInicio = r.hora_inicio?.toDate?.() ?? new Date(r.hora_inicio);
        const horaFinRaw = r.hora_fin?.toDate?.() ?? new Date(r.hora_fin);
        const horaFinValidada = isNaN(horaFinRaw?.getTime?.()) ? null : horaFinRaw;
        if (!horaInicio || !horaFinValidada) return;

        const duracionMinutos = (horaFinValidada - horaInicio) / 60000;
        if (!promedios[clave]) promedios[clave] = { totalTiempo: 0, count: 0 };
        promedios[clave].totalTiempo += duracionMinutos;
        promedios[clave].count += 1;
      });
    });

    const promediosFinales = {};
    Object.keys(promedios).forEach((clave) => {
      promediosFinales[clave] = Math.round(promedios[clave].totalTiempo / promedios[clave].count);
    });
    return promediosFinales;
  };

  const calcularPromedioCruzado = () => {
    const promediosCruzados = {};
    filtrarRegistros().forEach((r) => {
      let claves = [];
      let claves2 = [];

      if (agrupadoPor === "operador") claves = r.operadores || [];
      else if (agrupadoPor === "actividad") claves = [r.actividad];
      else if (agrupadoPor === "producto") {
        claves = Array.isArray(r.productos)
          ? r.productos.map((p) => p.producto)
          : [r.producto];
      }

      if (agrupadoPor2 === "operador") claves2 = r.operadores || [];
      else if (agrupadoPor2 === "actividad") claves2 = [r.actividad];
      else if (agrupadoPor2 === "producto") {
        claves2 = Array.isArray(r.productos)
          ? r.productos.map((p) => p.producto)
          : [r.producto];
      }

      claves.forEach((clave) => {
        claves2.forEach((clave2) => {
          const horaInicio = r.hora_inicio?.toDate?.() ?? new Date(r.hora_inicio);
          const horaFinRaw = r.hora_fin?.toDate?.() ?? new Date(r.hora_fin);
          const horaFinValidada = isNaN(horaFinRaw?.getTime?.()) ? null : horaFinRaw;
          if (!horaInicio || !horaFinValidada) return;

          const duracionMinutos = (horaFinValidada - horaInicio) / 60000;
          const key = `${clave} - ${clave2}`;
          if (!promediosCruzados[key])
            promediosCruzados[key] = { totalTiempo: 0, count: 0 };
          promediosCruzados[key].totalTiempo += duracionMinutos;
          promediosCruzados[key].count += 1;
        });
      });
    });

    const promediosFinalesCruzados = {};
    Object.keys(promediosCruzados).forEach((clave) => {
      const { totalTiempo, count } = promediosCruzados[clave];
      promediosFinalesCruzados[clave] = count > 0 ? Math.round(totalTiempo / count) : 0;
    });
    return promediosFinalesCruzados;
  };

  const datosPromedio = calcularPromedioTiempo();
  const datosPromedioCruzado = calcularPromedioCruzado();
  
  const etiquetasOrdenadas = Object.keys(datosPromedio)
  .sort((a, b) => {
    const nombreA = agrupadoPor === "operador" ? operadores[a] : agrupadoPor === "actividad" ? actividades[a] : productos[a];
    const nombreB = agrupadoPor === "operador" ? operadores[b] : agrupadoPor === "actividad" ? actividades[b] : productos[b];
    return (nombreA || a).localeCompare(nombreB || b);
  });

const etiquetas = etiquetasOrdenadas.map((clave) => {
  if (agrupadoPor === "operador") return operadores[clave] || `ID: ${clave}`;
  if (agrupadoPor === "actividad") return actividades[clave] || `ID: ${clave}`;
  if (agrupadoPor === "producto") return productos[clave] || `ID: ${clave}`;
  return clave;
});

const promedios = etiquetasOrdenadas.map((clave) => datosPromedio[clave]);

const clavesCruzadasOrdenadas = Object.keys(datosPromedioCruzado)
  .sort((a, b) => {
    const [a1, a2] = a.split(" - ");
    const [b1, b2] = b.split(" - ");
    const n1 = operadores[a1] || actividades[a1] || productos[a1] || a1;
    const n2 = operadores[a2] || actividades[a2] || productos[a2] || a2;
    const m1 = operadores[b1] || actividades[b1] || productos[b1] || b1;
    const m2 = operadores[b2] || actividades[b2] || productos[b2] || b2;
    return `${n1} - ${n2}`.localeCompare(`${m1} - ${m2}`);
  });

const etiquetasCruzadas = clavesCruzadasOrdenadas.map((clave) => {
  const [clave1, clave2] = clave.split(" - ");
  const nombre1 = operadores[clave1] || actividades[clave1] || productos[clave1] || `ID: ${clave1}`;
  const nombre2 = operadores[clave2] || actividades[clave2] || productos[clave2] || `ID: ${clave2}`;
  return `${nombre1} - ${nombre2}`;
});

const promediosCruzados = clavesCruzadasOrdenadas.map((clave) => datosPromedioCruzado[clave]);

 const colores = [
  "rgba(255, 99, 132, 0.5)",
  "rgba(54, 162, 235, 0.5)",
  "rgba(255, 206, 86, 0.5)",
  "rgba(75, 192, 192, 0.5)",
  "rgba(153, 102, 255, 0.5)",
  "rgba(255, 159, 64, 0.5)",
  "rgba(199, 199, 199, 0.5)",
  "rgba(83, 102, 255, 0.5)",
  "rgba(255, 99, 255, 0.5)",
  "rgba(0, 191, 255, 0.5)"
];

const datosGrafica = {
  labels: etiquetas,
  datasets: [
    {
      label: t("average_time_minutes"),
      data: promedios,
      backgroundColor: etiquetas.map((_, index) => colores[index % colores.length])
    }
  ]
};

  const exportarCSV = () => {
    let datosCSV = [];

    if (agrupadoPor2 && etiquetasCruzadas.length) {
      // Exportar datos cruzados
      datosCSV = etiquetasCruzadas.map((etiqueta, index) => ({
        [agrupadoPor2 ? `${t(agrupadoPor)} - ${t(agrupadoPor2)}` : t(agrupadoPor)]: etiqueta,
        [t("average_time_minutes")]: promediosCruzados[index],
      }));
    } else {
      // Exportar datos simples
      datosCSV = etiquetas.map((etiqueta, index) => ({
        [agrupadoPor2 ? `${t(agrupadoPor)} - ${t(agrupadoPor2)}` : t(agrupadoPor)]: etiqueta,
        [t("average_time_minutes")]: promedios[index],
      }));
    }

    const csv = Papa.unparse(datosCSV);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "promedios_productividad.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(t("export_success") || "CSV exportado correctamente");
  };

  // Función para limpiar filtros
  const limpiarFiltros = () => {
    setDesde("");
    setHasta("");
    setAgrupadoPor("actividad");
    setAgrupadoPor2("");
    setErrorFecha("");
  };

  return (
    <div className="card">
      <h2>{t("productivity")}</h2>
        {/* Filtros de fecha y agrupación */}
        <div
          style={{
            display: "flex",
            gap: "1rem",
            flexWrap: "wrap",
            marginBottom: "1rem",
            justifyContent: "flex-start",
          }}
        >
          <input
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            style={{ padding: "0.5rem" }}
          />
          <input
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
            style={{ padding: "0.5rem" }}
          />
        </div>
        
        {/* Mostrar error si las fechas no son válidas */}
        {errorFecha && <p style={{ color: "red" }}>{errorFecha}</p>}

        {/* Mostrar botones para seleccionar agrupaciones */}
        <div
          style={{
            display: "flex",
            gap: "1rem",
            flexWrap: "wrap",
            marginBottom: "1rem",
            justifyContent: "flex-start",
          }}
          
        >
          <select
            value={agrupadoPor}
            onChange={(e) => setAgrupadoPor(e.target.value)}
            style={{ padding: "0.5rem" }}
          >
            <option value="actividad">{t("activity")}</option>
            <option value="operador">{t("operator")}</option>
            <option value="producto">{t("product")}</option>
          </select>

          <select
            value={agrupadoPor2}
            onChange={(e) => setAgrupadoPor2(e.target.value)}
            style={{ padding: "0.5rem" }}
          >
            <option value="">{t("select_second_group")}</option>
            <option value="actividad">{t("activity")}</option>            
            <option value="operador">{t("operator")}</option>
            <option value="producto">{t("product")}</option>
          </select>

          <select
            value={tipoGrafica}
            onChange={(e) => setTipoGrafica(e.target.value)}
            style={{ padding: "0.5rem" }}
          >
            <option value="bar">{t("bar_chart")}</option>
            <option value="pie">{t("pie_chart")}</option>
          </select>
          
        </div>

        {/* Botón para limpiar filtros */}
        <button
          onClick={limpiarFiltros}
          style={{
            padding: "0.5rem 1rem",
            backgroundColor: "#000",
            color: "white",
            border: "none",
            borderRadius: "0.5rem",
            cursor: "pointer",
            marginBottom: "1rem",
          }}
        >
          {t("clear_filters")}
        </button>

        {/* Mostrar tabla cruzada si se seleccionan dos elementos */}
        <div style={{ marginTop: "2rem", overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>{agrupadoPor2 ? `${t(agrupadoPor)} - ${t(agrupadoPor2)}` : t(agrupadoPor)}</th>
                <th>{t("average_time_minutes")}</th>
              </tr>
            </thead>
            <tbody>
              {agrupadoPor2 && etiquetasCruzadas.length ? (
                etiquetasCruzadas.map((etiqueta, index) => (
                  <tr key={index}>
                    <td>{etiqueta}</td>
                    <td>{promediosCruzados[index]}</td>
                  </tr>
                ))
              ) : (
                etiquetas.map((etiqueta, index) => (
                  <tr key={index}>
                    <td>{etiqueta}</td>
                    <td>{promedios[index]}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Botón de exportación */}
        <button
          className="primary"
          onClick={exportarCSV}
          style={{ marginTop: "1rem", padding: "0.5rem 1rem" }}
        >
          {t("export_csv")}
        </button>

        {/* Gráfico de barras o pastel */}
        {etiquetas.length > 0 ? (
          <div style={{ maxWidth: "100%", height: "400px", marginTop: "2rem" }}>
            {tipoGrafica === "bar" ? (
              <Bar data={datosGrafica} options={{ responsive: true }} />
            ) : (
              <Pie data={datosGrafica} options={{ responsive: true }} />
            )}
          </div>
        ) : (
          <p>{t("no_data")}</p>
        )}
        <ToastContainer position="top-center" autoClose={1000} />    
    </div>
    )
  }

