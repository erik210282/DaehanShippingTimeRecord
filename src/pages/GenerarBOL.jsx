import React from "react";
import { supabase } from "../supabase/client";
import { useTranslation } from "react-i18next";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { jsPDF } from "jspdf";
import "../App.css";

/**
 * Ayudas de string
 */
const s = (v) => (v ?? "").toString().trim();
const lower = (v) => s(v).toLowerCase();

/**
 * Detecta si un registro en actividades_realizadas es LOAD finalizado
 * Tolera distintos nombres de columnas y estados.
 */
function esLoadFinalizado(r) {
  const act = lower(r?.nombre_actividad || r?.actividad);
  const est = lower(r?.estado || r?.estatus || r?.status);
  const esLoad = act === "load";
  const esFinal = est === "finalizada" || est === "finalizado" || est === "finished";
  return esLoad && esFinal;
}

/**
 * Mapea productos por id => objeto producto
 */
function mapById(arr) {
  const out = {};
  (arr || []).forEach((x) => {
    if (x?.id != null) out[x.id] = x;
  });
  return out;
}

export default function GenerarBOL() {
  const { t } = useTranslation();

  // --- estado UI ---
  const [idxOptions, setIdxOptions] = React.useState([]);
  const [selectedIdx, setSelectedIdx] = React.useState("");

  const [poOptions, setPoOptions] = React.useState([]);
  const [selectedPoId, setSelectedPoId] = React.useState("");

  const [shipper, setShipper] = React.useState("Daehan Nevada");
  const [shipmentNo, setShipmentNo] = React.useState("");
  const [trailerNo, setTrailerNo] = React.useState("");
  const [sealNo, setSealNo] = React.useState("");
  const [packingSlip, setPackingSlip] = React.useState("");

  // "returnable" | "expendable"
  const [packType, setPackType] = React.useState("expendable");

  // --- datos cargados para el BOL seleccionado ---
  const [lineasIdx, setLineasIdx] = React.useState([]); // actividades del idx
  const [productosById, setProductosById] = React.useState({}); // mapa id->producto
  const [poData, setPoData] = React.useState(null);

  // ---------------------- CARGA CATÁLOGOS ----------------------

  // IDXs (LOAD finalizado)
  const cargarIdxOptions = React.useCallback(async () => {
    const { data, error } = await supabase
      .from("actividades_realizadas")
      .select("idx, actividad, nombre_actividad, estado, createdAt")
      .order("createdAt", { ascending: false })
      .limit(5000);

    if (error) {
      console.warn("Error cargando actividades_realizadas:", error.message);
      setIdxOptions([]);
      return;
    }

    const loads = (data || []).filter(esLoadFinalizado).filter((r) => !!r.idx);
    const uniq = Array.from(new Set(loads.map((r) => r.idx)));
    setIdxOptions(uniq);
  }, []);

  // POs
  const cargarPoOptions = React.useCallback(async () => {
    const { data, error } = await supabase
      .from("catalogo_pos")
      .select("*")
      .order("id", { ascending: true });

    if (error) {
      console.warn("Error cargando catalogo_pos:", error.message);
      setPoOptions([]);
      return;
    }
    setPoOptions(data || []);
  }, []);

  React.useEffect(() => {
    cargarIdxOptions();
    cargarPoOptions();

    // Suscripción tiempo real para IDX
    const ch = supabase
      .channel("genbol_idx_loads")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "actividades_realizadas" },
        () => cargarIdxOptions()
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(ch);
      } catch {}
    };
  }, [cargarIdxOptions, cargarPoOptions]);

  // ---------------------- CARGA DETALLE DEL IDX ----------------------

  // Cuando cambia el IDX o el PO seleccionado, cargamos detalle necesario
  React.useEffect(() => {
    async function cargarDetalleIdx() {
      setLineasIdx([]);
      setProductosById({});
      if (!selectedIdx) return;

      // 1) Trae todas las actividades del IDX (limitado)
      const { data: acts, error: errActs } = await supabase
        .from("actividades_realizadas")
        .select("id, idx, producto, cantidad, nombre_actividad, actividad, createdAt")
        .eq("idx", selectedIdx)
        .order("createdAt", { ascending: true })
        .limit(5000);

      if (errActs) {
        toast.error(errActs.message);
        return;
      }

      setLineasIdx(acts || []);

      // 2) Junta los ids de producto (si existen) y carga productos
      const ids = Array.from(
        new Set((acts || []).map((a) => a?.producto).filter((v) => v != null))
      );
      if (ids.length) {
        const { data: prods, error: errProds } = await supabase
          .from("productos")
          .select("*")
          .in("id", ids);

        if (errProds) {
          console.warn("Error productos:", errProds.message);
        } else {
          setProductosById(mapById(prods || []));
        }
      }
    }

    async function cargarPo() {
      setPoData(null);
      if (!selectedPoId) return;
      const { data, error } = await supabase
        .from("catalogo_pos")
        .select("*")
        .eq("id", selectedPoId)
        .maybeSingle();
      if (error) {
        console.warn("Error PO:", error.message);
      } else {
        setPoData(data || null);
      }
    }

    cargarDetalleIdx();
    cargarPo();
  }, [selectedIdx, selectedPoId]);

  // ---------------------- GENERADOR DE PDF ----------------------

  function drawHeader(doc, title, y = 12) {
    doc.setFontSize(16);
    doc.text(title, 12, y);
    doc.setLineWidth(0.5);
    doc.line(12, y + 2, 200, y + 2);
  }

  function drawKVP(doc, label, value, x, y) {
    doc.setFontSize(10);
    doc.text(`${label}:`, x, y);
    doc.setFontSize(11);
    doc.text(s(value) || "—", x + 42, y);
  }

  function generarPDF() {
    try {
      if (!selectedIdx) return toast.error(t("select_idx_first") || "Selecciona un IDX");
      if (!selectedPoId) return toast.error(t("select_po_first") || "Selecciona un PO");

      const po = poData || {};
      const doc = new jsPDF({ unit: "mm", format: "letter" }); // 216 x 279mm aprox

      // ----------------- PÁGINA 1: BOL -----------------
      drawHeader(doc, "Bill of Lading (BOL)");

      // Bloque superior – Datos generales
      drawKVP(doc, t("shipper") || "Shipper", shipper, 12, 26);
      drawKVP(doc, "Consignee", po?.consignee_name, 12, 34);
      drawKVP(doc, "Address", [po?.consignee_address1, po?.consignee_address2].filter(Boolean).join(" "), 12, 42);
      drawKVP(doc, "City/State/ZIP", [po?.consignee_city, po?.consignee_state, po?.consignee_zip].filter(Boolean).join(", "), 12, 50);
      drawKVP(doc, "Country", po?.consignee_country, 12, 58);

      drawKVP(doc, "Shipment #", shipmentNo, 120, 26);
      drawKVP(doc, "Trailer/Container", trailerNo, 120, 34);
      drawKVP(doc, "Seal #", sealNo, 120, 42);
      drawKVP(doc, "Packing Slip #", packingSlip, 120, 50);
      drawKVP(doc, "PO", po?.po, 120, 58);
      drawKVP(doc, "IDX", selectedIdx, 120, 66);

      // Tabla de ítems (muy simple / tolerante)
      doc.setFontSize(12);
      doc.text("Items", 12, 78);
      doc.setFontSize(10);

      const headerY = 82;
      const cols = [
        { w: 24, label: "Part#", key: "part" },
        { w: 82, label: "Description", key: "desc" },
        { w: 22, label: "Qty", key: "qty", align: "right" },
        { w: 30, label: "Pack Type", key: "pack" },
        { w: 22, label: "Weight", key: "weight", align: "right" },
      ];

      // headers
      let x = 12;
      cols.forEach((c) => {
        doc.text(c.label, x + (c.align === "right" ? c.w - 1 : 1), headerY, { align: c.align || "left" });
        x += c.w;
      });
      doc.line(12, headerY + 2, 200, headerY + 2);

      // Crea filas a partir de actividades + productos (si existen)
      let y = headerY + 8;
      const filas = [];

      // Agrupa por producto (cantidad total si tu tabla trae "cantidad")
      const porProducto = {};
      (lineasIdx || []).forEach((a) => {
        const pid = a?.producto;
        if (pid == null) return;
        const qty = Number(a?.cantidad ?? 0);
        porProducto[pid] = (porProducto[pid] || 0) + (isNaN(qty) ? 0 : qty);
      });

      Object.keys(porProducto).forEach((pid) => {
        const prod = productosById[pid] || {};
        const part = s(prod.part_number);
        const desc = s(prod.nombre || prod.descripcion);
        const qty = porProducto[pid];

        const weightPer = Number(prod?.peso_por_pieza ?? 0);
        const weight = weightPer > 0 && qty > 0 ? (qty * weightPer).toFixed(2) : "—";

        // packType determina qué texto mostrar (no recalcula qty)
        const packTxt = packType === "returnable" ? "Returnable" : "Expendable";

        filas.push({
          part: part || "—",
          desc: desc || "—",
          qty: qty || "—",
          pack: packTxt,
          weight,
        });
      });

      // Si no hay productos ligados, agrega una fila informativa
      if (!filas.length) {
        filas.push({
          part: "—",
          desc: "No product lines found for this IDX",
          qty: "—",
          pack: packType === "returnable" ? "Returnable" : "Expendable",
          weight: "—",
        });
      }

      // pinta filas
      filas.forEach((row) => {
        let cx = 12;
        cols.forEach((c) => {
          const val = s(row[c.key]);
          doc.text(val || "—", cx + (c.align === "right" ? c.w - 1 : 1), y, { align: c.align || "left" });
          cx += c.w;
        });
        y += 6;
        if (y > 260) {
          doc.addPage();
          y = 20;
        }
      });

      // ----------------- PÁGINA 2: COVER SHEET -----------------
      doc.addPage();
      drawHeader(doc, "Cover Sheet");

      drawKVP(doc, t("shipper") || "Shipper", shipper, 12, 26);
      drawKVP(doc, "PO", po?.po, 12, 34);
      drawKVP(doc, "Consignee", po?.consignee_name, 12, 42);
      drawKVP(doc, "Address", [po?.consignee_address1, po?.consignee_address2].filter(Boolean).join(" "), 12, 50);
      drawKVP(doc, "City/State/ZIP", [po?.consignee_city, po?.consignee_state, po?.consignee_zip].filter(Boolean).join(", "), 12, 58);
      drawKVP(doc, "Country", po?.consignee_country, 12, 66);

      drawKVP(doc, "IDX", selectedIdx, 120, 26);
      drawKVP(doc, "Shipment #", shipmentNo, 120, 34);
      drawKVP(doc, "Trailer/Container", trailerNo, 120, 42);
      drawKVP(doc, "Seal #", sealNo, 120, 50);
      drawKVP(doc, "Packing Slip #", packingSlip, 120, 58);
      drawKVP(doc, "Packaging", packType === "returnable" ? "Returnable" : "Expendable", 120, 66);

      doc.setFontSize(10);
      doc.text("Notes:", 12, 84);
      doc.rect(12, 86, 188, 100); // caja para notas

      // Descarga
      const fileName = `BOL_${selectedIdx}_${po?.po || "PO"}.pdf`;
      doc.save(fileName);

      toast.success(t("generated_ok") || "BOL generado correctamente");
    } catch (e) {
      console.error(e);
      toast.error(t("error_generating") || "Error al generar el BOL");
    }
  }

  // ---------------------- RENDER ----------------------
  return (
    <div className="page-container page-container--fluid">
      <div className="card">
        <h2>{t("generate_bol_coversheet") || "Generar BOL y Cover Sheet"}</h2>

        {/* Fila de filtros / entrada */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(200px, 1fr))", gap: 8, marginBottom: 10 }}>
          {/* IDX */}
          <select value={selectedIdx} onChange={(e) => setSelectedIdx(e.target.value)}>
            <option value="">{t("select_idx") || "Seleccionar IDX"}</option>
            {idxOptions.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>

          {/* Shipper (origen) */}
          <select value={shipper} onChange={(e) => setShipper(e.target.value)}>
            <option value="Daehan Nevada">Daehan Nevada</option>
            <option value="Daehan California">Daehan California</option>
            <option value="Daehan Georgia">Daehan Georgia</option>
          </select>

          {/* Shipment # */}
          <input
            placeholder={t("shipment_number") || "No. de envío (Shipment #)"}
            value={shipmentNo}
            onChange={(e) => setShipmentNo(e.target.value)}
          />

          {/* Trailer/Contenedor */}
          <input
            placeholder={t("trailer_number") || "No. de Trailer/Contenedor"}
            value={trailerNo}
            onChange={(e) => setTrailerNo(e.target.value)}
          />

          {/* PO */}
          <select value={selectedPoId} onChange={(e) => setSelectedPoId(e.target.value)}>
            <option value="">{t("select_po") || "Seleccionar PO"}</option>
            {poOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.po ? `${p.po} — ${p.consignee_name || ""}` : `ID ${p.id}`}
              </option>
            ))}
          </select>

          {/* Seal */}
          <input
            placeholder={t("seal_number") || "No. de Sello"}
            value={sealNo}
            onChange={(e) => setSealNo(e.target.value)}
          />

          {/* Packing Slip */}
          <input
            placeholder={t("packing_slip") || "Packing Slip # (opcional)"}
            value={packingSlip}
            onChange={(e) => setPackingSlip(e.target.value)}
          />

          {/* Tipo de empaque (DROPDOWN) */}
          <select value={packType} onChange={(e) => setPackType(e.target.value)}>
            <option value="expendable">{t("expendable") || "Expendable"}</option>
            <option value="returnable">{t("returnable") || "Retornable"}</option>
          </select>

          {/* Botón GENERAR BOL (después del tipo de empaque) */}
          <button className="primary" onClick={generarPDF} style={{ alignSelf: "center" }}>
            {t("generate_bol") || "Generar BOL"}
          </button>
        </div>

        <div className="card" style={{ padding: 12 }}>
          <strong>{t("preview_hint") || "Vista previa"}</strong>
          <p style={{ marginTop: 6 }}>
            {!selectedIdx || !selectedPoId
              ? (t("select_idx_po") || "Seleccionar IDX & PO")
              : `${t("ready_to_generate") || "Listo para generar PDF…"}`}
          </p>
        </div>

        <ToastContainer position="top-center" autoClose={1400} />
      </div>
    </div>
  );
}
