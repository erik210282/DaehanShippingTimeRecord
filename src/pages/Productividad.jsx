import React, { useEffect, useState, useMemo } from "react";
import supabase from "../supabase/client";
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
  const [operadores, setOperadores] = useState({});
  const [productos, setProductos] = useState({});
  const [actividades, setActividades] = useState({});

  const [agrupadoPor, setAgrupadoPor] = useState("actividad");
  const [agrupadoPor2, setAgrupadoPor2] = useState(""); 
  const [tipoGrafica, setTipoGrafica] = useState("bar");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [errorFecha, setErrorFecha] = useState(""); 

  useEffect(() => {
    const cargarDatos = async () => {
      const [regSnap, opSnap, prodSnap, actSnap] = await Promise.all([
              supabase.from("actividades_realizadas").select("*"),
              supabase.from("operadores").select("id, nombre"),
              supabase.from("productos").select("id, nombre"),
              supabase.from("actividades").select("id, nombre"),
        ]);

      const mapById = (arr) =>
        arr?.data?.reduce((acc, cur) => {
          acc[cur.id] = cur.nombre;
          return acc;
        }, {}) || {};

      setOperadores(mapById(opSnap));
      setProductos(mapById(prodSnap));
      setActividades(mapById(actSnap));

      const registrosFiltrados = regSnap?.data?.filter((r) => r.estado === "finalizada") || [];
      setRegistros(registrosFiltrados);
    };

   cargarDatos();

    const canal = supabase
      .channel("realtime-productividad")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "actividades_realizadas" },
        () => cargarDatos()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "operadores" },
        () => cargarDatos()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "productos" },
        () => cargarDatos()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "actividades" },
        () => cargarDatos()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
    };
  }, []);
          
 const validarFechas = () => {
    if (desde && hasta && new Date(desde) > new Date(hasta)) {
      setErrorFecha(t("invalid_date_range"));
      return false;
    }
    setErrorFecha("");
    return true;
  };

  const filtrarRegistros = () => {
    if (!validarFechas()) return [];
    return registros.filter((r) => {
      const inicio = new Date(r.hora_inicio);
      if (!inicio) return false;
      if (desde && inicio < new Date(desde)) return false;
      if (hasta && inicio > new Date(hasta)) return false;
      return true;
    });
  };

  const calcularPromedioTiempo = () => {
    const datos = {};
    filtrarRegistros().forEach((r) => {
      let claves = [];
      if (agrupadoPor === "operador") claves = Array.isArray(r.operadores) ? r.operadores : [];
      else if (agrupadoPor === "actividad") claves = [r.actividad];
      else if (agrupadoPor === "producto") claves = Array.isArray(r.productos) ? r.productos : [r.productos];

      const horaInicio = new Date(r.hora_inicio);
      const horaFin = new Date(r.hora_fin);
      if (!horaInicio || !horaFin || isNaN(horaInicio) || isNaN(horaFin)) return;
      const duracionMin = (horaFin - horaInicio) / 60000;

      claves.forEach((clave) => {
        if (!datos[clave]) datos[clave] = { total: 0, count: 0 };
        datos[clave].total += duracionMin;
        datos[clave].count += 1;
      });
    });

    const resultado = {};
    for (const clave in datos) {
      const { total, count } = datos[clave];
      resultado[clave] = Math.round(total / count);
    }
    return resultado;
  };

  const calcularPromedioCruzado = () => {
    const datos = {};
    filtrarRegistros().forEach((r) => {
      let claves = [];
      let claves2 = [];

      if (agrupadoPor === "operador") claves = Array.isArray(r.operadores) ? r.operadores : [];
      else if (agrupadoPor === "actividad") claves = [r.actividad];
      else if (agrupadoPor === "producto") claves = Array.isArray(r.productos) ? r.productos : [r.productos];

      if (agrupadoPor2 === "operador") claves2 = Array.isArray(r.operadores) ? r.operadores : [];
      else if (agrupadoPor2 === "actividad") claves2 = [r.actividad];
      else if (agrupadoPor2 === "producto") claves2 = Array.isArray(r.productos) ? r.productos : [r.productos];

      const horaInicio = new Date(r.hora_inicio);
      const horaFin = new Date(r.hora_fin);
      if (!horaInicio || !horaFin || isNaN(horaInicio) || isNaN(horaFin)) return;
      const duracionMin = (horaFin - horaInicio) / 60000;

      claves.forEach((k1) => {
        claves2.forEach((k2) => {
          const key = `${k1} - ${k2}`;
          if (!datos[key]) datos[key] = { total: 0, count: 0 };
          datos[key].total += duracionMin;
          datos[key].count += 1;
        });
      });
    });

    const resultado = {};
    for (const key in datos) {
      const { total, count } = datos[key];
      resultado[key] = Math.round(total / count);
    }
    return resultado;
  };

  const datosPromedio = useMemo(() => calcularPromedioTiempo(), [registros, agrupadoPor, desde, hasta]);
  const datosPromedioCruzado = useMemo(() => calcularPromedioCruzado(), [registros, agrupadoPor, agrupadoPor2, desde, hasta]);

  const etiquetasOrdenadas = Object.keys(datosPromedio)
  .sort((a, b) => {
    const nombreA = agrupadoPor === "operador" ? operadores[a] : agrupadoPor === "actividad" ? actividades[a] : productos[a];
    const nombreB = agrupadoPor === "operador" ? operadores[b] : agrupadoPor === "actividad" ? actividades[b] : productos[b];
    return (nombreA || a).localeCompare(nombreB || b);
  });

const etiquetas = etiquetasOrdenadas.map((clave) => {
  if (agrupadoPor === "operador") return operadores?.[clave] || `ID: ${clave || "desconocido"}`;
  if (agrupadoPor === "actividad") return actividades?.[clave] || `ID: ${clave || "desconocido"}`;
  if (agrupadoPor === "producto") return productos?.[clave] || `ID: ${clave || "desconocido"}`;
  return clave || "desconocido";
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

const promediosCruzados = clavesCruzadasOrdenadas.map((k) => datosPromedioCruzado[k]);

  const datosGrafica = {
    labels: agrupadoPor2 ? etiquetasCruzadas : etiquetas,
    datasets: [
      {
        label: t("average_time_minutes"),
        data: agrupadoPor2 ? promediosCruzados : promedios,
        backgroundColor: (agrupadoPor2 ? etiquetasCruzadas : etiquetas).map(
          (_, i) =>
            [
              "rgba(255, 99, 132, 0.5)",
              "rgba(54, 162, 235, 0.5)",
              "rgba(255, 206, 86, 0.5)",
              "rgba(75, 192, 192, 0.5)",
              "rgba(153, 102, 255, 0.5)",
              "rgba(255, 159, 64, 0.5)",
              "rgba(199, 199, 199, 0.5)",
              "rgba(83, 102, 255, 0.5)",
              "rgba(255, 99, 255, 0.5)",
              "rgba(0, 191, 255, 0.5)",
            ][i % 10]
        ),
      },
    ],
  };

  const exportarCSV = () => {
    const datosCSV = (agrupadoPor2 ? etiquetasCruzadas : etiquetas).map((etiqueta, i) => ({
      [agrupadoPor2 ? `${t(agrupadoPor)} - ${t(agrupadoPor2)}` : t(agrupadoPor)]: etiqueta,
      [t("average_time_minutes")]: agrupadoPor2 ? promediosCruzados[i] : promedios[i],
    }));

    const csv = Papa.unparse(datosCSV);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "productividad.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(t("export_success"));
  };

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

