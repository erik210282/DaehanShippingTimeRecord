import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../supabase/client";
import { format } from "date-fns";
import { DSInput, DSDate, TablePagination } from "../components/controls";

export default function Resumen() {
  const { t } = useTranslation();
  const [resumenData, setResumenData] = useState([]);
  const [filtroIdx, setFiltroIdx] = useState("");
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");
  const [productosDict, setProductosDict] = useState({});
  const [operadoresDict, setOperadoresDict] = useState({});
  const [actividadesDict, setActividadesDict] = useState({});

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const colorActividad = (nombreActividad) => {
    switch (nombreActividad?.toLowerCase()) {
      case "load":
        return "#B2FBA5"; // verde
      case "unload":
        return "#AEC6CF"; // Azulado
      case "stage":
        return "#f580ff"; // Morado
      case "label":
        return "#F1BA8B"; // Naranja
      case "scan":
        return "#FFF44F"; // Amarillo
      default:
        return "#F0F0F0"; // Grisazul
    }
  };

  useEffect(() => {
    const cargarCatalogosYActividades = async () => {
      // 1. Cargar actividades
      const { data: actividades, error: errorActividades } = await supabase
        .from("actividades")
        .select("id, nombre");

      if (errorActividades) {
        return;
      }

      const actDict = {};
      actividades?.forEach((a) => {
        actDict[a.id] = a.nombre?.toLowerCase().trim();
      });
      setActividadesDict(actDict);

      // 2. Cargar productos y operadores
      const [{ data: productos, error: errorProductos }, { data: operadores, error: errorOperadores }] =
        await Promise.all([
          supabase.from("productos").select("id, nombre"),
          supabase.from("operadores").select("id, nombre"),
        ]);

      if (errorProductos || errorOperadores) {
        return;
      }

      const prodDict = {};
      productos?.forEach((p) => {
        prodDict[p.id] = p.nombre;
      });

      const opDict = {};
      operadores?.forEach((op) => {
        opDict[op.id] = op.nombre;
      });
      setProductosDict(prodDict);
      setOperadoresDict(opDict);
    };

    cargarCatalogosYActividades();
  }, []);

  useEffect(() => {
    const fetchResumen = async () => {
      if (!Object.keys(productosDict).length || !Object.keys(operadoresDict).length) return;

      const PAGE = 1000;
      let from = 0;
      let todo = [];

      while (true) {
        const { data: chunk, error } = await supabase
          .from("actividades_realizadas")
          .select("*")
          .order("createdAt", { ascending: true }) // o "hora_inicio" si prefieres
          .range(from, from + PAGE - 1);

        if (error) {
          return;
        }
        if (!chunk || chunk.length === 0) break;

        todo = todo.concat(chunk);

        // Si el tramo vino más chico que PAGE, ya no hay más páginas
        if (chunk.length < PAGE) break;

        from += PAGE;
      }

      // Trabajaremos con 'data' como antes
      const data = todo;
      if (!data.length) return;
      const agrupadas = {};

      data.forEach((act) => {
        if (act.estado !== "finalizada" || !act.idx) return;

        const fecha = new Date(act.hora_inicio);
        if (fechaInicio && fecha < new Date(`${fechaInicio}T00:00:00`)) return;
        if (fechaFin && fecha > new Date(`${fechaFin}T23:59:59.999`)) return;

        const key = act.idx;
        if (!agrupadas[key]) {
          agrupadas[key] = {
            idx: key,
            productos: [],
            cantidades: [],
            stage: null,
            label: null,
            scan: null,
            load: null,
            notas: "",
            fechaNotas: null,
          };
        }

        if (Array.isArray(act.productos)) {
          act.productos.forEach((item) => {
            const nombreProducto = productosDict?.[item.producto];
            if (nombreProducto && !agrupadas[key].productos.includes(nombreProducto)) {
              agrupadas[key].productos.push(nombreProducto);
              agrupadas[key].cantidades.push(item.cantidad);
            }
          });
        }
        const nombreActividad = actividadesDict[act.actividad]?.toLowerCase().trim() || "";
        let operadorNombre = "-";
        if (Array.isArray(act.operadores)) {
          operadorNombre = act.operadores.map((id) => operadoresDict[id] || `ID:${id}`).join(", ");
        } else if (typeof act.operadores === "string" && act.operadores.trim()) {
          operadorNombre = operadoresDict[act.operadores] || act.operadores;
        }

        const hora = act.hora_inicio ? format(new Date(act.hora_inicio), "Pp") : "-";
        const registro = (
          <>
            <strong>{operadorNombre}</strong>
            <br />
            <span style={{ opacity: 0.7 }}>{hora}</span>
          </>
        );

        if (nombreActividad) {
          if (["stage", "label", "scan", "load"].includes(nombreActividad)) {
            agrupadas[key][nombreActividad] = registro;
          } else {
          }
        } else {
          // Muestra igual aunque el nombre aún no esté en actividadesDict
          agrupadas[key]["actividad_desconocida"] = registro;
        }

        if (!agrupadas[key].fechaNotas || new Date(act.createdAt) > new Date(agrupadas[key].fechaNotas)) {
          agrupadas[key].notas = act.notas || "";
          agrupadas[key].fechaNotas = act.createdAt;
        }
      });

      const resultado = Object.values(agrupadas).sort((a, b) => {
        const aNum = Number(a.idx);
        const bNum = Number(b.idx);

        // Si ambos idx son numéricos, ordena como números (descendente)
        if (!isNaN(aNum) && !isNaN(bNum)) {
          return bNum - aNum;
        }

        // Si alguno es alfanumérico, usa orden natural de texto (también descendente)
        return b.idx.localeCompare(a.idx, undefined, { numeric: true, sensitivity: "base" });
      });

      // 🧹 Aplicar filtro de búsqueda por IDX si existe
      const filtrado = filtroIdx
        ? resultado.filter((r) => r.idx?.toLowerCase().includes(filtroIdx.toLowerCase()))
        : resultado;
      // 💾 Actualizar estado
      setResumenData(filtrado);
      setPage(1);
    };

    fetchResumen();
  }, [productosDict, operadoresDict, filtroIdx, fechaInicio, fechaFin]);

  // ==========================
  // Paginado: cálculo de filas
  // ==========================
  const totalRows = resumenData.length;
  const totalPages = Math.max(1, Math.ceil((totalRows || 0) / pageSize));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const filasPagina = resumenData.slice(startIndex, endIndex);

  return (
    <div className="page-container page-container--fluid">
      <div className="card">
        <h2>{t("summary")}</h2>
        <div style={{ marginBottom: 12 }}>
          <DSInput
            type="text"
            placeholder={t("buscaridx")}
            value={filtroIdx}
            onChange={(e) => setFiltroIdx(e.target.value)}
            style={{ marginRight: 10, padding: 4 }}
          />
          <DSDate
            type="date"
            value={fechaInicio}
            onChange={(e) => setFechaInicio(e.target.value)}
            style={{ marginRight: 10, padding: 4 }}
          />
          <DSDate
            type="date"
            value={fechaFin}
            onChange={(e) => setFechaFin(e.target.value)}
            style={{ padding: 4 }}
          />
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t("idxcode")}</th>
                <th>{t("product")}</th>
                <th>{t("quantity")}</th>
                <th>{t("stage")}</th>
                <th>{t("label")}</th>
                <th>{t("scan")}</th>
                <th>{t("load")}</th>
                <th>{t("notes")}</th>
              </tr>
            </thead>
            <tbody>
              {filasPagina.map((fila, i) => (
                <tr key={i}>
                  <td>{fila.idx}</td>
                  <td>
                    {fila.productos?.length
                      ? fila.productos.map((p, i) => <div key={i}>{p}</div>)
                      : "-"}
                  </td>
                  <td>
                    {fila.cantidades?.length
                      ? fila.cantidades.map((c, i) => <div key={i}>{c}</div>)
                      : "-"}
                  </td>
                  <td style={{ backgroundColor: colorActividad("stage")}}>{fila.stage || "-"}</td>
                  <td style={{ backgroundColor: colorActividad("label")}}>{fila.label || "-"}</td>
                  <td style={{ backgroundColor: colorActividad("scan")}}>{fila.scan || "-"}</td>
                  <td style={{ backgroundColor: colorActividad("load")}}>{fila.load || "-"}</td>
                  <td>{fila.notas}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <TablePagination
              totalRows={totalRows}
              page={currentPage}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1); 
              }}
            />
        </div>
      </div>
    </div>
  );
}
