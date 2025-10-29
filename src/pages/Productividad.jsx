import React, { useEffect, useState, useMemo } from "react";
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
    const mapById = (arr) =>
      arr?.data?.reduce((acc, cur) => {
        acc[cur.id] = cur.nombre;
        return acc;
      }, {}) || {};

    // 🧩 Función principal para cargar todos los datos
    const cargarDatos = async () => {
      const [regSnap, opSnap, prodSnap, actSnap] = await Promise.all([
        supabase.from("actividades_realizadas").select("*"),
        supabase.from("operadores").select("id, nombre"),
        supabase.from("productos").select("id, nombre"),
        supabase.from("actividades").select("id, nombre"),
      ]);

      setOperadores(mapById(opSnap));
      setProductos(mapById(prodSnap));
      setActividades(mapById(actSnap));

      // Esperar un breve momento para asegurar que React actualice los estados
      setTimeout(() => {
        const registrosFiltrados = regSnap?.data?.filter((r) => r.estado === "finalizada") || [];
        setRegistros(registrosFiltrados);
      }, 150);
    };

    // 🟢 Cargar los datos al iniciar
    cargarDatos();

    // 🛰️ Configurar canal Realtime para todas las tablas
    const canal = supabase.channel("realtime-productividad-mejorado");

    // ✅ Actividades realizadas → refresca todo
    canal.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "actividades_realizadas" },
      () => cargarDatos()
    );

    // ✅ Operadores → actualiza solo el catálogo de operadores
    canal.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "operadores" },
      async () => {
        const { data: nuevos } = await supabase.from("operadores").select("id, nombre");
        setOperadores(mapById({ data: nuevos }));
      }
    );

    // ✅ Productos → actualiza solo el catálogo de productos
    canal.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "productos" },
      async () => {
        const { data: nuevos } = await supabase.from("productos").select("id, nombre");
        setProductos(mapById({ data: nuevos }));
      }
    );

    // ✅ Actividades → actualiza solo el catálogo de actividades
    canal.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "actividades" },
      async () => {
        const { data: nuevos } = await supabase.from("actividades").select("id, nombre");
        setActividades(mapById({ data: nuevos }));
      }
    );

    canal.subscribe();
    const intervalo = setInterval(async () => {
        const { data: nuevosOps } = await supabase.from("operadores").select("id, nombre");
        setOperadores(mapById({ data: nuevosOps }));

        const { data: nuevosProd } = await supabase.from("productos").select("id, nombre");
        setProductos(mapById({ data: nuevosProd }));

        const { data: nuevasActs } = await supabase.from("actividades").select("id, nombre");
        setActividades(mapById({ data: nuevasActs }));
      }, 10000);

      // 🧹 Limpiar canal al desmontar
      return () => {
        clearInterval(intervalo);
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
    const start = desde ? new Date(`${desde}T00:00:00.000`) : null;
    const end   = hasta ? new Date(`${hasta}T23:59:59.999`) : null;

    return registros.filter((r) => {
      const stamp = r.hora_inicio || r.createdAt;
      const inicio = stamp ? new Date(stamp) : null;
      if (!inicio) return false;
      if (start && inicio < start) return false;
      if (end && inicio > end) return false;
      return true;
    });
  };

  // --- Helpers para parseo robusto ---
  const safeParseJSON = (s) => {
    if (typeof s !== "string") return null;
    const trimmed = s.trim();
    if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return null;
    try { return JSON.parse(trimmed); } catch { return null; }
  };

  const splitLoose = (s) => {
    // quita corchetes/comillas sueltas y separa por coma ; | o tab
    return String(s)
      .replace(/[\[\]"']/g, " ")
      .split(/[;,|\t]/)
      .map(x => x.trim())
      .filter(Boolean);
  };

  const norm = (s = "") =>
  s
    .toString()
    .normalize("NFD")                     // separa acentos
    .replace(/[\u0300-\u036f]/g, "")      // quita acentos
    .replace(/\u00A0/g, " ")              // NBSP -> espacio normal
    .replace(/\s+/g, " ")                 // colapsa múltiples espacios
    .trim()
    .toLowerCase();

  const operadoresNombreToId = useMemo(() => {
    const out = {};
    Object.entries(operadores || {}).forEach(([id, nombre]) => {
      const k = norm(nombre);
      if (k) out[k] = id;
    });
    return out;
  }, [operadores]);

  const productosNombreToId = useMemo(() => {
    const out = {};
    Object.entries(productos || {}).forEach(([id, nombre]) => {
      const k = norm(nombre);
      if (k) out[k] = id;
    });
    return out;
  }, [productos]);

  const actividadesNombreToId = useMemo(() => {
    const out = {};
    Object.entries(actividades || {}).forEach(([id, nombre]) => {
      const k = norm(nombre);
      if (k) out[k] = id;
    });
    return out;
  }, [actividades]);

  const getDuracionMin = (r) => {
    // 1) número directo
    if (typeof r.duracion === "number" && Number.isFinite(r.duracion)) return r.duracion;

    // 2) string tipo "16" o "16 min"
    if (typeof r.duracion === "string") {
      const match = r.duracion.match(/-?\d+(\.\d+)?/);
      if (match) {
        const n = Number(match[0]);
        if (Number.isFinite(n)) return n;
      }
    }

    // 3) fallback: calcula por timestamps (sin descontar pausas)
    if (r.hora_inicio && r.hora_fin) {
      const ini = new Date(r.hora_inicio).getTime();
      const fin = new Date(r.hora_fin).getTime();
      if (Number.isFinite(ini) && Number.isFinite(fin) && fin > ini) {
        return Math.round((fin - ini) / 60000);
      }
    }

    // 4) último intento: createdAt / updatedAt
    if (r.createdAt && r.updatedAt) {
      const ini = new Date(r.createdAt).getTime();
      const fin = new Date(r.updatedAt).getTime();
      if (Number.isFinite(ini) && Number.isFinite(fin) && fin > ini) {
        return Math.round((fin - ini) / 60000);
      }
    }

    return null;
  };

  // Normaliza r.operadores a un array de IDs válidos (acepta array, string, objeto)
  const normalizarOperadores = (op) => {
    const ids = [];
    const push = (raw) => {
      const k = norm(raw);
      if (!k) return;
      const id = operadoresNombreToId[k] || String(raw).trim();
      ids.push(id);
    };

    if (Array.isArray(op)) {
      op.forEach((item) => {
        if (typeof item === "string") {
          // si viene como '["Carlos","Jeannine"]' se maneja arriba en safeParseJSON
          splitLoose(item).forEach(push);
        } else if (item && typeof item === "object") {
          const raw =
            item.id || item.value || item.uid || item.operador ||
            (item.nombre ? operadoresNombreToId[norm(item.nombre)] : null);
          if (raw) push(raw);
        }
      });
    } else if (typeof op === "string") {
      const parsed = safeParseJSON(op);
      if (parsed) return normalizarOperadores(parsed);
      splitLoose(op).forEach(push);
    } else if (op && typeof op === "object") {
      const raw =
        op.id || op.value || op.uid || op.operador ||
        (op.nombre ? operadoresNombreToId[norm(op.nombre)] : null);
      if (raw) push(raw);
    }

    return [...new Set(ids.filter(Boolean))];
  };

  // normaliza productos a un array de IDs válidos
  const normalizarProductos = (prod) => {
    const out = [];
    const push = (raw) => {
      const k = norm(String(raw));              // "ms headliner"
      if (!k) return;
      const id = productosNombreToId[k] || String(raw).trim();  // id por nombre o el raw
      out.push(id);
    };

    if (Array.isArray(prod)) {
      prod.forEach((p) => {
        if (p && typeof p === "object") {
          // casos { producto, id, nombre, value }
          if (p.producto) push(p.producto);
          else if (p.id) push(p.id);
          else if (p.nombre) push(p.nombre);
          else if (p.value) push(p.value);
        } else if (typeof p === "string") {
          p.split(/[;|]/).forEach(push); // soporta "A|B"
        }
      });
    } else if (prod && typeof prod === "object") {
      if (prod.producto) push(prod.producto);
      else if (prod.id) push(prod.id);
      else if (prod.nombre) push(prod.nombre);
      else if (prod.value) push(prod.value);
    } else if (typeof prod === "string" && prod.trim()) {
      prod.split(/[;|]/).forEach(push);
    }

    return [...new Set(out.filter(Boolean))];
  };

  const normalizarActividad = (act) => {
    const out = [];
    const push = (raw) => {
      const s = String(raw).trim();
      if (!s) return;
      const k = norm(s);
      out.push(actividadesNombreToId[k] || s);
    };

    const pushFromObj = (a) => {
      if (!a) return;
      if (a.id) return push(a.id);
      if (a.value) return push(a.value.id ?? a.value.nombre ?? a.value);
      if (a.actividad) return push(a.actividad.id ?? a.actividad.nombre ?? a.actividad);
      if (a.nombre) return push(a.nombre);
      if (a.meta?.activity) return push(a.meta.activity.id ?? a.meta.activity.nombre);
    };

    if (!act) return out;
    if (Array.isArray(act)) {
      act.forEach((a) => {
        if (typeof a === "object") pushFromObj(a);
        else splitLoose(a).forEach(push);
      });
    } else if (typeof act === "string") {
      const parsed = safeParseJSON(act);
      if (parsed) return normalizarActividad(parsed);
      splitLoose(act).forEach(push);
    } else if (typeof act === "object") {
      pushFromObj(act);
    } else if (typeof act === "number") {
      push(act);
    }

    // una sola actividad por registro
    return [...new Set(out.filter(Boolean))].slice(0, 1);
  };

  const calcularPromedioTiempo = () => {
    const datos = {};

    filtrarRegistros().forEach((r) => {
      let claves = [];

      if (agrupadoPor === "operador") {
        claves = normalizarOperadores(
          r.operadores ?? r.operador ?? r.operator ??
          r.operador_id ?? r.operadores_id ?? r.operadores_ids ?? r.operator_id ??
          r.meta?.operador ?? r.meta?.operator ?? null
        );
      } else if (agrupadoPor === "actividad") {
        const act = r.actividad ?? r.actividad_id ?? r.activity ?? r.activity_id ?? r.act ?? r.meta?.actividad ?? r.meta?.activity ?? null;
        claves = act ? [String(act)] : [];
      } else if (agrupadoPor === "producto") {
        claves = normalizarProductos(
          r.productos ?? r.producto ?? r.product ??
          r.producto_id ?? r.productos_id ?? r.productos_ids ?? r.product_id ??
          r.meta?.producto ?? r.meta?.product ?? null
        );
      }

      // 🔍 Log de depuración temporal para productos
      if (agrupadoPor === "producto") {
        if (!claves.length) {
          console.debug("SIN PRODUCTO normalizado", {
            raw: r.productos ?? r.producto ?? r.product ?? r.producto_id ?? r.meta?.producto,
            registro: r
          });
        } else {
          claves.forEach((k) => {
            if (!productos[k]) console.debug("Producto fuera de catálogo (clave libre):", k, r);
          });
        }
      }

      // duración robusta
      const duracionMin = getDuracionMin(r);
      if (!Number.isFinite(duracionMin) || !claves.length) return;

      claves.forEach((k) => {
        if (!datos[k]) datos[k] = { total: 0, count: 0 };
        datos[k].total += duracionMin;
        datos[k].count += 1;
      });
    });

    const resultado = {};
    for (const k in datos) {
      const { total, count } = datos[k];
      resultado[k] = Math.round(total / count);
    }
    return resultado;
  };

  const calcularPromedioCruzado = () => {
    const datos = {};

    filtrarRegistros().forEach((r) => {
      // Grupo 1
      let g1 = [];
      if (agrupadoPor === "operador") {
        g1 = normalizarOperadores(
          r.operadores ?? r.operador ?? r.operator ??
          r.operador_id ?? r.operadores_id ?? r.operadores_ids ?? r.operator_id ??
          r.meta?.operador ?? r.meta?.operator ?? null
        );
      } else if (agrupadoPor === "actividad") {
        const act = r.actividad ?? r.actividad_id ?? r.activity ?? r.activity_id ?? r.act ?? r.meta?.actividad ?? r.meta?.activity ?? null;
        g1 = act ? [String(act)] : [];
      } else if (agrupadoPor === "producto") {
        g1 = normalizarProductos(
          r.productos ?? r.producto ?? r.product ??
          r.producto_id ?? r.productos_id ?? r.productos_ids ?? r.product_id ??
          r.meta?.producto ?? r.meta?.product ?? null
        );
      }

      // Grupo 2
      let g2 = [];
      if (agrupadoPor2 === "operador") {
        g2 = normalizarOperadores(
          r.operadores ?? r.operador ?? r.operator ??
          r.operador_id ?? r.operadores_id ?? r.operadores_ids ?? r.operator_id ??
          r.meta?.operador ?? r.meta?.operator ?? null
        );
      } else if (agrupadoPor2 === "actividad") {
        const act2 = r.actividad ?? r.actividad_id ?? r.activity ?? r.activity_id ?? r.act ?? r.meta?.actividad ?? r.meta?.activity ?? null;
        g2 = act2 ? [String(act2)] : [];
      } else if (agrupadoPor2 === "producto") {
        g2 = normalizarProductos(
          r.productos ?? r.producto ?? r.product ??
          r.producto_id ?? r.productos_id ?? r.productos_ids ?? r.product_id ??
          r.meta?.producto ?? r.meta?.product ?? null
        );
      }

      const duracionMin = getDuracionMin(r);
      if (!Number.isFinite(duracionMin) || !g1.length || !g2.length) return;

      g1.forEach((k1) => {
        g2.forEach((k2) => {
          if (!k1 || !k2) return;
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


 const datosPromedio = useMemo(() => {
    const base = calcularPromedioTiempo();

    if (agrupadoPor === "operador") {
      Object.keys(operadores || {}).forEach((id) => {
        if (base[id] == null) base[id] = 0;
      });
    } else if (agrupadoPor === "actividad") {
      Object.keys(actividades || {}).forEach((id) => {
        if (base[id] == null) base[id] = 0;
      });
    } else if (agrupadoPor === "producto") {
      Object.keys(productos || {}).forEach((id) => {
        if (base[id] == null) base[id] = 0;
      });
    }

    return base;
  }, [registros, agrupadoPor, desde, hasta, operadores, actividades, productos]);

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

