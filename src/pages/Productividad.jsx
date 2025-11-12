// Productividad.jsx (reemplazo completo)
import React, { useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "../supabase/client";
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
import { DSDate, DSNativeSelect, PrimaryBtn, SecondaryBtn } from "../components/controls";

ChartJS.register(BarElement, CategoryScale, LinearScale, ArcElement, Tooltip, Legend);

export default function Productividad() {
  const { t } = useTranslation();

  const [registros, setRegistros] = useState([]);
  const [operadores, setOperadores] = useState({});
  const [productos, setProductos] = useState({});
  const [actividades, setActividades] = useState({});

  const [agrupadoPor, setAgrupadoPor] = useState("");
  const [agrupadoPor2, setAgrupadoPor2] = useState("");
  const [tipoGrafica, setTipoGrafica] = useState("bar");
  const [desde, setDesde] = useState(""); // string YYYY-MM-DD
  const [hasta, setHasta] = useState(""); // string YYYY-MM-DD
  const [errorFecha, setErrorFecha] = useState("");

  // --- Utilidades de fecha ---
  const buildDayRangeISO = useCallback((desdeStr, hastaStr) => {
    // Convierte YYYY-MM-DD a inicio/fin del día en LOCAL y a ISO.
    // Si no hay desde/hasta, retorna null en ese extremo (no filtra).
    const toStartOfDayISO = (s) => {
      const d = new Date(s + "T00:00:00");
      if (isNaN(d.getTime())) return null;
      return d.toISOString();
    };
    const toEndOfDayISO = (s) => {
      const d = new Date(s + "T23:59:59.999");
      if (isNaN(d.getTime())) return null;
      return d.toISOString();
    };
    const fromISO = desdeStr ? toStartOfDayISO(desdeStr) : null;
    const toISO = hastaStr ? toEndOfDayISO(hastaStr) : null;
    return { fromISO, toISO };
  }, []);

  const validarFechas = useCallback(() => {
    if (desde && hasta) {
      const d1 = new Date(desde + "T00:00:00");
      const d2 = new Date(hasta + "T00:00:00");
      if (isNaN(d1.getTime()) || isNaN(d2.getTime())) {
        setErrorFecha(t("invalid_date_range"));
        return false;
      }
      if (d1 > d2) {
        setErrorFecha(t("invalid_date_range"));
        return false;
      }
    }
    setErrorFecha("");
    return true;
  }, [desde, hasta, t]);

  // --- Cargar catálogos (operadores/productos/actividades) ---
  useEffect(() => {
    const cargarCatalogos = async () => {
      const [opSnap, prodSnap, actSnap] = await Promise.all([
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
    };
    cargarCatalogos();
  }, []);

  // --- Paginación y carga de registros (servidor) ---
  const actualizarRegistros = useCallback(
    async (opts = {}) => {
      // opts: { fromISO, toISO }
      if (!validarFechas()) return;

      const PAGE = 1000;
      let from = 0;
      let acumulado = [];
      let seguir = true;

      while (seguir) {
        // Construimos query base
        let q = supabase
          .from("actividades_realizadas")
          .select("*")
          .eq("estado", "finalizada")
          .order("hora_inicio", { ascending: false }); // <-- ajusta el nombre si tu columna de tiempo es distinta

        if (opts.fromISO) q = q.gte("hora_inicio", opts.fromISO);
        if (opts.toISO) q = q.lte("hora_inicio", opts.toISO);

        // Paginamos
        const chunk = await q.range(from, from + PAGE - 1);

        if (chunk.error) {
          console.error("Error al cargar registros:", chunk.error);
          toast.error(t("no_data"));
          break;
        }

        const rows = chunk.data || [];
        acumulado = acumulado.concat(rows);

        if (rows.length < PAGE) {
          seguir = false;
        } else {
          from += PAGE;
        }
      }

      setRegistros(acumulado);
    },
    [validarFechas, t]
  );

  // Cargar registros iniciales y suscribirse a realtime
  useEffect(() => {
    const { fromISO, toISO } = buildDayRangeISO(desde, hasta);
    actualizarRegistros({ fromISO, toISO });

    const canal = supabase
      .channel("realtime-productividad")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "actividades_realizadas" },
        () => {
          const rng = buildDayRangeISO(desde, hasta);
          actualizarRegistros(rng);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // suscripción y primera carga una sola vez

  // Cada vez que cambian los filtros de fecha, recarga desde el servidor
  useEffect(() => {
    const ok = validarFechas();
    if (!ok) return;
    const { fromISO, toISO } = buildDayRangeISO(desde, hasta);
    actualizarRegistros({ fromISO, toISO });
  }, [desde, hasta, validarFechas, buildDayRangeISO, actualizarRegistros]);

  // --- Filtro en cliente (seguridad extra y coherencia con UI) ---
  const filtrarRegistros = () => {
    if (!validarFechas()) return [];
    return registros.filter((r) => {
      // Asegurar que hora_inicio sea fecha válida
      const inicio = new Date(r.hora_inicio);
      if (isNaN(inicio.getTime())) return false;

      if (desde) {
        const d = new Date(desde + "T00:00:00");
        if (inicio < d) return false;
      }
      if (hasta) {
        const h = new Date(hasta + "T23:59:59.999");
        if (inicio > h) return false;
      }
      return true;
    });
  };

  // --- Cálculos de promedios (igual a tu lógica, con pequeñas defensas) ---
  const calcularPromedioTiempo = () => {
    const datos = {};
    filtrarRegistros().forEach((r) => {
      let claves = [];
      if (agrupadoPor === "operador") {
        claves = Array.isArray(r.operadores) ? r.operadores : [];
      } else if (agrupadoPor === "actividad") {
        claves = [r.actividad];
      } else if (agrupadoPor === "producto") {
        claves = Array.isArray(r.productos)
          ? r.productos.map((p) => p.producto)
          : [r.productos?.producto];
      }

      if (typeof r.duracion !== "number") return;
      const duracionMin = r.duracion;

      claves.forEach((clave) => {
        if (!clave && clave !== 0) return;
        if (!datos[clave]) datos[clave] = { total: 0, count: 0 };
        datos[clave].total += duracionMin;
        datos[clave].count += 1;
      });
    });

    const resultado = {};
    for (const clave in datos) {
      const { total, count } = datos[clave];
      resultado[clave] = count ? Math.round(total / count) : 0;
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
      else if (agrupadoPor === "producto")
        claves = Array.isArray(r.productos) ? r.productos.map((p) => p.producto) : [r.productos?.producto];

      if (agrupadoPor2 === "operador") claves2 = Array.isArray(r.operadores) ? r.operadores : [];
      else if (agrupadoPor2 === "actividad") claves2 = [r.actividad];
      else if (agrupadoPor2 === "producto")
        claves2 = Array.isArray(r.productos) ? r.productos.map((p) => p.producto) : [r.productos?.producto];

      if (typeof r.duracion !== "number") return;
      const duracionMin = r.duracion;

      claves.forEach((k1) => {
        claves2.forEach((k2) => {
          if ((k1 ?? "") === "" || (k2 ?? "") === "") return;
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
      resultado[key] = count ? Math.round(total / count) : 0;
    }
    return resultado;
  };

  const datosPromedio = useMemo(() => calcularPromedioTiempo(), [registros, agrupadoPor, desde, hasta]);
  const datosPromedioCruzado = useMemo(() => calcularPromedioCruzado(), [registros, agrupadoPor, agrupadoPor2, desde, hasta]);

  const etiquetasOrdenadas = Object.keys(datosPromedio).sort((a, b) => {
    const nombreA =
      agrupadoPor === "operador" ? operadores[a] : agrupadoPor === "actividad" ? actividades[a] : productos[a];
    const nombreB =
      agrupadoPor === "operador" ? operadores[b] : agrupadoPor === "actividad" ? actividades[b] : productos[b];
    return (nombreA || String(a)).localeCompare(nombreB || String(b));
  });

  const etiquetas = etiquetasOrdenadas.map((clave) => {
    if (agrupadoPor === "operador") return operadores?.[clave] || `ID: ${clave ?? "desconocido"}`;
    if (agrupadoPor === "actividad") return actividades?.[clave] || `ID: ${clave ?? "desconocido"}`;
    if (agrupadoPor === "producto") return productos?.[clave] || `ID: ${clave ?? "desconocido"}`;
    return String(clave ?? "desconocido");
  });

  const promedios = etiquetasOrdenadas.map((clave) => datosPromedio[clave]);

  const clavesCruzadasOrdenadas = Object.keys(datosPromedioCruzado).sort((a, b) => {
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
      [agrupadoPor2
        ? `${traducirAgrupacion(agrupadoPor)} - ${traducirAgrupacion(agrupadoPor2)}`
        : traducirAgrupacion(agrupadoPor)
      ]: etiqueta,
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
    setAgrupadoPor("");
    setAgrupadoPor2("");
    setErrorFecha("");
  };

  const traducirAgrupacion = (valor) => {
    switch (valor) {
      case "actividad":
        return t("activity");
      case "operador":
        return t("operator");
      case "producto":
        return t("product");
      default:
        return valor;
    }
  };

  return (
    <div className="page-container page-container--fluid">
      <div className="card">
        <h2>{t("productivity")}</h2>

        {/* Filtros de fecha */}
        <div
          style={{
            display: "flex",
            gap: "1rem",
            flexWrap: "wrap",
            marginBottom: "1rem",
            justifyContent: "flex-start",
          }}
        >
          <DSDate value={desde} onChange={(e) => setDesde(e.target.value)} />
          <DSDate value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>

        {errorFecha && <p style={{ color: "red" }}>{errorFecha}</p>}

        {/* Agrupaciones */}
        <div
          style={{
            display: "flex",
            gap: "1rem",
            flexWrap: "wrap",
            marginBottom: "1rem",
            justifyContent: "flex-start",
          }}
        >
          <DSNativeSelect value={agrupadoPor} onChange={(e) => setAgrupadoPor(e.target.value)}>
            <option value="">{t("select_first_group")}</option>
            <option value="actividad">{t("activity")}</option>
            <option value="operador">{t("operator")}</option>
            <option value="producto">{t("product")}</option>
          </DSNativeSelect>

          <DSNativeSelect value={agrupadoPor2} onChange={(e) => setAgrupadoPor2(e.target.value)}>
            <option value="">{t("select_second_group")}</option>
            <option value="actividad">{t("activity")}</option>
            <option value="operador">{t("operator")}</option>
            <option value="producto">{t("product")}</option>
          </DSNativeSelect>

          <DSNativeSelect value={tipoGrafica} onChange={(e) => setTipoGrafica(e.target.value)}>
            <option value="bar">{t("bar_chart")}</option>
            <option value="pie">{t("pie_chart")}</option>
          </DSNativeSelect>
        </div>

        {/* Botón limpiar */}
        <SecondaryBtn onClick={limpiarFiltros} style={{ marginBottom: "1rem" }}>
          {t("clear_filters")}
        </SecondaryBtn>

        {/* Tabla */}
        <div style={{ marginTop: "2rem", overflowX: "auto" }}>
          <div className="table-wrap">
            <table className="table">
                <thead>
                  <tr>
                    <th>
                      {agrupadoPor2
                        ? `${traducirAgrupacion(agrupadoPor)} - ${traducirAgrupacion(agrupadoPor2)}`
                        : traducirAgrupacion(agrupadoPor)}
                    </th>
                    <th>{t("average_time_minutes")}</th>
                  </tr>
                </thead>
                <tbody>
                  {agrupadoPor2 && etiquetasCruzadas.length
                    ? etiquetasCruzadas.map((etiqueta, index) => (
                        <tr key={index}>
                          <td>{etiqueta}</td>
                          <td>{promediosCruzados[index]}</td>
                        </tr>
                      ))
                    : etiquetas.map((etiqueta, index) => (
                        <tr key={index}>
                          <td>{etiqueta}</td>
                          <td>{promedios[index]}</td>
                        </tr>
                      ))}
                </tbody>
              </table>
          </div>
        </div>

        {/* Exportar */}
        <PrimaryBtn onClick={exportarCSV} style={{ marginTop: "1rem" }}>
          {t("export_csv")}
        </PrimaryBtn>

        {/* Gráfico */}
        {etiquetas.length > 0 ? (
          <div style={{ maxWidth: "100%", height: "400px", marginTop: "2rem" }}>
            {tipoGrafica === "bar" ? <Bar data={datosGrafica} options={{ responsive: true }} /> : <Pie data={datosGrafica} options={{ responsive: true }} />}
          </div>
        ) : (
          <p>{t("no_data")}</p>
        )}

        <ToastContainer position="top-center" autoClose={1000} />
      </div>
    </div>
  );
}
