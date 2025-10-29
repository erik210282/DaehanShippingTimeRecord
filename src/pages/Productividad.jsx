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
      const id = operadoresNombreToId[k] || raw.toString().trim();
      ids.push(id);
    };

    if (Array.isArray(op)) {
      op.forEach((item) => {
        if (typeof item === "string") {
          item.split(/[;,|]/).forEach(push);             // soporta "A, B" o "A;B"
        } else if (item && typeof item === "object") {
          const raw =
            item.id || item.value || item.uid || item.operador ||
            (item.nombre ? operadoresNombreToId[norm(item.nombre)] : null);
          if (raw) push(raw);
        }
      });
    } else if (typeof op === "string") {
      op.split(/[;,|]/).forEach(push);
    }

    return [...new Set(ids.filter(Boolean))];
  };

  const normalizarProductos = (prod) => {
    const out = [];
    const push = (raw) => {
      const k = norm(String(raw));
      if (!k) return;
      const idByName = productosNombreToId[k];
      out.push(idByName || String(raw).trim());
    };

    const pushFromObj = (p) => {
      // variantes directas
      if (p.id) return push(p.id);
      if (p.value) {
        if (typeof p.value === "object") {
          if (p.value.id) return push(p.value.id);
          if (p.value.nombre) return push(p.value.nombre);
        }
        return push(p.value);
      }
      if (p.producto) {
        if (typeof p.producto === "object") {
          if (p.producto.id) return push(p.producto.id);
          if (p.producto.nombre) return push(p.producto.nombre);
        }
        return push(p.producto);
      }
      if (p.nombre) return push(p.nombre);

      // variantes anidadas comunes
      if (p.product && typeof p.product === "object") {
        if (p.product.id) return push(p.product.id);
        if (p.product.nombre) return push(p.product.nombre);
      }
      if (p.meta?.product?.id) return push(p.meta.product.id);
      if (p.meta?.product?.nombre) return push(p.meta.product.nombre);
    };

    if (Array.isArray(prod)) {
      prod.forEach((p) => {
        if (!p) return;
        if (typeof p === "object") pushFromObj(p);
        else if (typeof p === "string" || typeof p === "number") {
          String(p).split(/[;,|]/).forEach(push);
        }
      });
    } else if (prod && typeof prod === "object") {
      pushFromObj(prod);
    } else if (typeof prod === "string" || typeof prod === "number") {
      String(prod).split(/[;,|]/).forEach(push);
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
      if (a.id) return push(a.id);
      if (a.value) {
        if (typeof a.value === "object") {
          if (a.value.id) return push(a.value.id);
          if (a.value.nombre) return push(a.value.nombre);
        }
        return push(a.value);
      }
      if (a.actividad) {
        if (typeof a.actividad === "object") {
          if (a.actividad.id) return push(a.actividad.id);
          if (a.actividad.nombre) return push(a.actividad.nombre);
        }
        return push(a.actividad);
      }
      if (a.nombre) return push(a.nombre);

      // variantes anidadas
      if (a.meta?.activity?.id) return push(a.meta.activity.id);
      if (a.meta?.activity?.nombre) return push(a.meta.activity.nombre);
    };

    if (!act) return out;
    if (Array.isArray(act)) {
      act.forEach((a) => {
        if (!a) return;
        if (typeof a === "object") pushFromObj(a);
        else if (typeof a === "string" || typeof a === "number") {
          String(a).split(/[;,|]/).forEach(push);
        }
      });
    } else if (typeof act === "object") {
      pushFromObj(act);
    } else if (typeof act === "string" || typeof act === "number") {
      String(act).split(/[;,|]/).forEach(push);
    }

    // actividad es una sola clave; por seguridad, conservar 1
    return [...new Set(out.filter(Boolean))].slice(0, 1);
  };

  const calcularPromedioTiempo = () => {
    const datos = {};

    filtrarRegistros().forEach((r) => {
      let claves = [];

      if (agrupadoPor === "operador") {
        const rawOperador =
          r.operadores ?? r.operador ?? r.operator ??
          r.operador_id ?? r.operadores_id ?? r.operadores_ids ?? r.operator_id ??
          r.meta?.operador ?? r.meta?.operator ?? null;
        claves = normalizarOperadores(rawOperador);
      } else if (agrupadoPor === "actividad") {
        const rawActividad =
          r.actividad ?? r.actividad_id ?? r.activity ?? r.activity_id ?? r.act ??
          r.meta?.actividad ?? r.meta?.activity ?? null;
        const acts = normalizarActividad(rawActividad);
        claves = acts.length ? acts : [];
      } else if (agrupadoPor === "producto") {
        const rawProducto =
          r.productos ?? r.producto ?? r.product ??
          r.producto_id ?? r.productos_id ?? r.productos_ids ?? r.product_id ??
          r.meta?.producto ?? r.meta?.product ?? null;
        claves = normalizarProductos(rawProducto);
      }

      if (claves.length === 0) {
        console.debug("SIN CLAVES", {
          agrupadoPor,
          operRaw: r.operadores ?? r.operador ?? r.operador_id ?? r.meta?.operador,
          prodRaw: r.productos ?? r.producto ?? r.producto_id ?? r.meta?.producto,
          actRaw:  r.actividad ?? r.actividad_id ?? r.meta?.actividad,
          registro: r
        });
      }

      // ✅ aceptar "16", "16 min", o calcular desde timestamps
      const duracionMin = getDuracionMin(r);
      if (claves.length === 0) {
        console.log("DEBUG sin claves", { r });
      }
      if (!Number.isFinite(getDuracionMin(r))) {
        console.log("DEBUG duracion invalida", { r, dur: r.duracion });
      }
      if (agrupadoPor === "producto") {
        claves.forEach((k) => {
          if (!productos[k]) {
            console.debug("Producto fuera de catálogo (usando clave libre):", k);
          }
        });
      }
      if (agrupadoPor === "operador") {
        claves.forEach((k) => {
          if (!operadores[k]) {
            console.debug("Operador fuera de catálogo (usando clave libre):", k);
          }
        });
      }
      if (!Number.isFinite(duracionMin)) return;

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

      // Grupo 1
      if (agrupadoPor === "operador") {
        const rawOperador =
          r.operadores ?? r.operador ?? r.operator ??
          r.operador_id ?? r.operadores_id ?? r.operadores_ids ?? r.operator_id ??
          r.meta?.operador ?? r.meta?.operator ?? null;
        claves = normalizarOperadores(rawOperador);
      } else if (agrupadoPor === "producto") {
        const rawProducto =
          r.productos ?? r.producto ?? r.product ??
          r.producto_id ?? r.productos_id ?? r.productos_ids ?? r.product_id ??
          r.meta?.producto ?? r.meta?.product ?? null;
        claves = normalizarProductos(rawProducto);
      } else if (agrupadoPor === "actividad") {
        const rawActividad =
          r.actividad ?? r.actividad_id ?? r.activity ?? r.activity_id ?? r.act ??
          r.meta?.actividad ?? r.meta?.activity ?? null;
        const acts = normalizarActividad(rawActividad);
        claves = acts.length ? acts : [];
      }

      // Grupo 2
      if (agrupadoPor2 === "operador") {
        const rawOperador2 =
          r.operadores ?? r.operador ?? r.operator ??
          r.operador_id ?? r.operadores_id ?? r.operadores_ids ?? r.operator_id ??
          r.meta?.operador ?? r.meta?.operator ?? null;
        claves2 = normalizarOperadores(rawOperador2);
      } else if (agrupadoPor2 === "producto") {
        const rawProducto2 =
          r.productos ?? r.producto ?? r.product ??
          r.producto_id ?? r.productos_id ?? r.productos_ids ?? r.product_id ??
          r.meta?.producto ?? r.meta?.product ?? null;
        claves2 = normalizarProductos(rawProducto2);
      } else if (agrupadoPor2 === "actividad") {
        const rawActividad2 =
          r.actividad ?? r.actividad_id ?? r.activity ?? r.activity_id ?? r.act ??
          r.meta?.actividad ?? r.meta?.activity ?? null;
        const acts2 = normalizarActividad(rawActividad2);
        claves2 = acts2.length ? acts2 : [];
      } 


      // Duración robusta
      const duracionMin = getDuracionMin(r);
      if (!Number.isFinite(duracionMin)) return;

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

