import React from "react";
import { supabase } from "../supabase/client";
import { useTranslation } from "react-i18next";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { jsPDF } from "jspdf";
import "../App.css";

/* ----------------------- Helpers ----------------------- */
const s = (v) => (v ?? "").toString().trim();
const lower = (v) => s(v).toLowerCase();
const isFinal = (r) => /(finalizada)/i.test((r?.estado ?? "").toString());
const isLoad = (r) => /load/i.test(s(r?.actividad));

/* ======================================================= */
export default function GenerarBOL() {
  // wrapper seguro: si t no es función (por cualquier motivo), usa fallback
  const { t: maybeT } = useTranslation();
  const t = (key, fallback) =>
    typeof maybeT === "function" ? maybeT(key) : (fallback || key);

  /* -------------------- Estados UI -------------------- */
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

  // datos para construir el PDF
  const [lineasIdx, setLineasIdx] = React.useState([]);
  const [productosById, setProductosById] = React.useState({});
  const [poData, setPoData] = React.useState(null);

  /* ------------------ Cargar IDX (AR) ----------------- */
  const cargarIdxOptions = React.useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("actividades_realizadas")
        .select("idx, actividad, estado, createdAt")
        .not("idx", "is", null)
        .order("createdAt", { ascending: false })
        .limit(8000);

      if (error) throw error;

      const setIdx = new Set(
        (data || [])
          .filter((r) => isLoad(r) && isFinal(r) && s(r.idx))
          .map((r) => s(r.idx))
      );

      const uniq = Array.from(setIdx).map(String).sort((a, b) => b.localeCompare(a));
      setIdxOptions(uniq);
      setSelectedIdx((prev) => (prev && !uniq.includes(prev) ? "" : prev));
    } catch (e) {
      console.warn("cargarIdxOptions:", e?.message || e);
      setIdxOptions([]);
      setSelectedIdx("");
    }
  }, []);

  /* ------------------ Cargar POs ------------------ */
  const cargarPoOptions = React.useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("catalogo_pos")
        .select("*")
        .order("id", { ascending: true });

      if (error) throw error;
      setPoOptions(data || []);
    } catch (e) {
      console.warn("cargarPoOptions:", e?.message || e);
      setPoOptions([]);
    }
  }, []);

  React.useEffect(() => {
    cargarIdxOptions();
    cargarPoOptions();

    // realtime (AR) para refrescar el combo de IDX
    const ch = supabase
      .channel("genbol_idx_ar")
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

  /* ------ Cargar detalle del IDX y datos del PO ------- */
  React.useEffect(() => {
    async function cargarDetalleIdx() {
      setLineasIdx([]);
      setProductosById({});
      if (!selectedIdx) return;

      const { data: acts, error: errActs } = await supabase
        .from("actividades_realizadas")
        .select("id, idx, producto, cantidad, actividad, createdAt")
        .eq("idx", selectedIdx)
        .order("createdAt", { ascending: true })
        .limit(5000);

      if (errActs) {
        toast.error(errActs.message);
        return;
      }
      setLineasIdx(acts || []);

      const ids = Array.from(
        new Set((acts || []).map((a) => a?.producto).filter((v) => v != null))
      );
      if (ids.length) {
        const { data: prods, error: errProds } = await supabase
          .from("productos")
          .select("*")
          .in("id", ids);

        if (!errProds) {
          const map = {};
          (prods || []).forEach((p) => {
            if (p?.id != null) map[p.id] = p;
          });
          setProductosById(map);
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

      if (!error) setPoData(data || null);
    }

    cargarDetalleIdx();
    cargarPo();
  }, [selectedIdx, selectedPoId]);

  /* ---------------- Generar PDF ---------------- */
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
      if (!selectedIdx) return toast.error(t("select_idx_first", "Selecciona un IDX"));
      if (!selectedPoId) return toast.error(t("select_po_first", "Selecciona un PO"));

      const po = poData || {};
      const doc = new jsPDF({ unit: "mm", format: "letter" });

      // -------- PÁGINA 1: BOL --------
      drawHeader(doc, "Bill of Lading (BOL)");

      drawKVP(doc, t("shipper", "Remitente"), shipper, 12, 26);
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

      // -------- TABLA DE ÍTEMS --------
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

      // ENCABEZADOS
      let hx = 12;
      cols.forEach((c) => {
        doc.text(String(c.label), hx + (c.align === "right" ? c.w - 1 : 1), headerY, { align: c.align || "left" });
        hx += c.w;
      });
      doc.line(12, headerY + 2, 200, headerY + 2);

      // CONSTRUIR FILAS AGREGADAS POR PRODUCTO
      let y = headerY + 8;
      const filas = [];

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
        const weight = weightPer > 0 && qty > 0 ? String((qty * weightPer).toFixed(2)) : "—";
        const packTxt = packType === "returnable" ? "Returnable" : "Expendable";

        filas.push({ part: part || "—", desc: desc || "—", qty: String(qty || "—"), pack: packTxt, weight });
      });

      // SI NO HAY FILAS, UNA FILA VACÍA
      if (!filas.length) {
        filas.push({
          part: "—",
          desc: "No product lines found for this IDX",
          qty: "—",
          pack: packType === "returnable" ? "Returnable" : "Expendable",
          weight: "—",
        });
      }

      // DIBUJAR FILAS (TODO EN STRING)
      filas.forEach((row) => {
        let cx = 12;
        cols.forEach((c) => {
          const raw = row[c.key];
          const val = raw === 0 ? "0" : s(raw) || "—";
          doc.text(String(val), cx + (c.align === "right" ? c.w - 1 : 1), y, { align: c.align || "left" });
          cx += c.w;
        });
        y += 6;
        if (y > 260) {
          doc.addPage();
          y = 20;
        }
      });


      // -------- PÁGINA 2: COVER SHEET --------
      doc.addPage();
      drawHeader(doc, "Cover Sheet");

      drawKVP(doc, t("shipper", "Remitente"), shipper, 12, 26);
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
      doc.rect(12, 86, 188, 100);

      const fileName = `BOL_${String(selectedIdx)}_${String(po?.po || "PO")}.pdf`;
      doc.save(fileName);
      toast.success(t("generated_ok", "BOL generado correctamente"));
    } catch (e) {
      console.error(e);
      toast.error(t("error_generating", "Error al generar el BOL"));
    }
  }

  /* ----------------------- UI ----------------------- */
  return (
    <div className="page-container page-container--fluid">
      <div className="card">
        <h2>{t("generate_bol_coversheet", "Generar BOL y Cover Sheet")}</h2>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(200px, 1fr))", gap: 8, marginBottom: 10 }}>
          {/* IDX */}
          <select value={selectedIdx} onChange={(e) => setSelectedIdx(e.target.value)} disabled={idxOptions.length === 0}>
            <option value="">{t("select_idx", "Seleccionar IDX")}</option>
            {idxOptions.map((v) => {
              const sv = String(v);
              return <option key={sv} value={sv}>{sv}</option>;
            })}
          </select>

          {/* Shipper */}
          <select value={shipper} onChange={(e) => setShipper(e.target.value)}>
            <option value="Daehan Nevada">Daehan Nevada</option>
          </select>

          {/* Shipment # */}
          <input placeholder={t("shipment_number", "No. de envío (Shipment #)")} value={shipmentNo} onChange={(e) => setShipmentNo(e.target.value)} />

          {/* Trailer/Container */}
          <input placeholder={t("trailer_number", "No. de Trailer/Contenedor")} value={trailerNo} onChange={(e) => setTrailerNo(e.target.value)} />

          {/* PO */}
          <select value={selectedPoId} onChange={(e) => setSelectedPoId(e.target.value)} disabled={poOptions.length === 0}>
            <option value="">{t("select_po", "Seleccionar PO")}</option>
            {poOptions.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.po ? `${p.po} — ${p.consignee_name || ""}` : `ID ${p.id}`}
              </option>
            ))}
          </select>

          {/* Seal */}
          <input placeholder={t("seal_number", "No. de Sello")} value={sealNo} onChange={(e) => setSealNo(e.target.value)} />

          {/* Packing Slip */}
          <input placeholder={t("packing_slip", "Packing Slip #")} value={packingSlip} onChange={(e) => setPackingSlip(e.target.value)} />

          {/* Packaging type */}
          <select value={packType} onChange={(e) => setPackType(e.target.value)}>
            <option value="expendable">{t("expendable", "Expendable")}</option>
            <option value="returnable">{t("returnable", "Retornable")}</option>
          </select>

          {/* Botón GENERAR BOL */}
          <button className="primary" onClick={generarPDF} style={{ alignSelf: "center" }}>
            {t("generate_bol", "Generar BOL")}
          </button>
        </div>

        <div className="card" style={{ padding: 12 }}>
          <strong>{t("preview_hint", "Vista previa")}</strong>
          <p style={{ marginTop: 6 }}>
            {!selectedIdx || !selectedPoId ? t("select_idx_po", "Seleccionar IDX & PO") : t("ready_to_generate", "Listo para generar PDF…")}
          </p>
        </div>

        <ToastContainer position="top-center" autoClose={1400} />
      </div>
    </div>
  );
}
