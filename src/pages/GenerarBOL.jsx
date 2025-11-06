import React from "react";
import { supabase } from "../supabase/client";
import { useTranslation } from "react-i18next";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { jsPDF } from "jspdf";
import "../App.css";
import Select from "react-select";
import DA_LOGO from "../assets/Daehan.png"; 
import BOL_BG from "../assets/bol_bg.png";          
import COVER_BG from "../assets/coversheet_bg.png";  
const DAEHAN_LOGO_SRC = "/assets/Daehan.png";

async function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/* ----------------------- Helpers ----------------------- */
const s = (v) => (v ?? "").toString().trim();
const lower = (v) => s(v).toLowerCase();
const isFinal = (r) => (r?.estado ?? "").trim().toLowerCase() === "finalizada";
const isLoad = (r) => /load/i.test(s(r?.actividad));

/* ======================================================= */
export default function GenerarBOL() {
  // wrapper seguro: si t no es función (por cualquier motivo), usa fallback
  const { t: maybeT } = useTranslation();
  const t = (key, fallback) =>
    typeof maybeT === "function" ? maybeT(key) : (fallback || key);

  /* -------------------- Estados UI -------------------- */
  // nuevo estado para evitar doble click opcional
  const [isGenerating, setIsGenerating] = React.useState(false);

  // resetea todos los campos del formulario
  const resetForm = React.useCallback(() => {
    setSelectedIdx("");
    setSelectedPoIds([]);
    setSelectedShipperId("");

    setShipmentNo("");
    setTrailerNo("");
    setSealNo("");
    setPackingSlip("");

    setPackType("returnable");

    // limpiar previews/datos auxiliares
    setLineasIdx([]);
    setProductosById({});
    setPoData([]);
    setShipperData(null);
  }, []);

  const [idxOptions, setIdxOptions] = React.useState([]);
  const [selectedIdx, setSelectedIdx] = React.useState("");

  const [poOptions, setPoOptions] = React.useState([]);
  const [selectedPoIds, setSelectedPoIds] = React.useState([]);

  const [shipperOptions, setShipperOptions] = React.useState([]);
  const [selectedShipperId, setSelectedShipperId] = React.useState("");

  const [shipmentNo, setShipmentNo] = React.useState("");
  const [trailerNo, setTrailerNo] = React.useState("");
  const [sealNo, setSealNo] = React.useState("");
  const [packingSlip, setPackingSlip] = React.useState("");

  // "returnable" | "expendable"
  const [packType, setPackType] = React.useState("returnable");

  // datos para construir el PDF
  const [lineasIdx, setLineasIdx] = React.useState([]);
  const [productosById, setProductosById] = React.useState({});
  const [poData, setPoData] = React.useState([]);
  const [shipperData, setShipperData] = React.useState(null);

  /* ------------------ Cargar IDX (AR) ----------------- */
  const cargarIdxOptions = React.useCallback(async () => {
    try {
      // 1) Lee AR con idx + actividad (id) + estado
      const { data: ar, error: errAr } = await supabase
        .from("actividades_realizadas")
        .select("idx, actividad, estado, createdAt")
        .not("idx", "is", null)
        .order("createdAt", { ascending: false })
        .limit(8000);
      if (errAr) throw errAr;

      // 2) Trae catálogo de actividades para traducir id -> nombre
      const actIds = Array.from(new Set((ar || []).map(r => r.actividad).filter(Boolean)));
      let actNameById = {};
      if (actIds.length) {
        const { data: acts, error: errActs } = await supabase
          .from("actividades")
          .select("id, nombre")
          .in("id", actIds);
        if (errActs) throw errActs;
        (acts || []).forEach(a => { actNameById[a.id] = (a.nombre ?? "").toString(); });
      }

      // 3) Filtra LOAD + finalizado
      const setIdx = new Set(
        (ar || [])
          .filter(r => {
            const nombre = actNameById[r.actividad] || "";
            const isLoad = /load/i.test(nombre);
            return isLoad && isFinal(r) && (r.idx ?? "").toString().trim();
          })
          .map(r => (r.idx ?? "").toString().trim())
      );

      // 4) Fallback: si no hubo nada, intenta desde tareas_pendientes
      if (setIdx.size === 0) {
        const { data: tp, error: errTp } = await supabase
          .from("tareas_pendientes")
          .select("idx, actividad, estado, createdAt")
          .not("idx", "is", null)
          .order("createdAt", { ascending: false })
          .limit(8000);
        if (!errTp) {
          (tp || []).forEach(r => {
            const isLoadTP = /load/i.test((r.actividad ?? "").toString());
            if (isLoadTP && isFinal(r)) setIdx.add((r.idx ?? "").toString().trim());
          });
        }
      }

      const uniq = Array.from(setIdx).map(String).sort((a, b) => b.localeCompare(a));
      setIdxOptions(uniq);
      setSelectedIdx(prev => (prev && !uniq.includes(prev) ? "" : prev));
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

  /* ------------------ Cargar Shippers ------------------ */
  const cargarShipperOptions = React.useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("catalogo_shipper")
        .select("*")
        .order("id", { ascending: true });

      if (error) throw error;
      setShipperOptions(data || []);
    } catch (e) {
      console.warn("cargarShipperOptions:", e?.message || e);
      setShipperOptions([]);
    }
  }, []);

  React.useEffect(() => {
    cargarIdxOptions();
    cargarPoOptions();
    cargarShipperOptions();

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
  }, [cargarIdxOptions, cargarPoOptions, cargarShipperOptions]);

  /* ------ Cargar detalle del IDX y datos del PO ------- */
  React.useEffect(() => {
    async function cargarDetalleIdx() {
      setLineasIdx([]);
      setProductosById({});
      if (!selectedIdx) return;

      // 1) Lee TODO para no fallar por columnas inexistentes
      const { data: acts, error: errActs } = await supabase
        .from("actividades_realizadas")
        .select("*")
        .eq("idx", selectedIdx)
        .order("createdAt", { ascending: true })
        .limit(5000);

      if (errActs) {
        toast.error(errActs.message);
        return;
      }
      setLineasIdx(acts || []);

      // 2) Extrae items normalizados { producto_id, cantidad }
      // 2.1) Obtiene los IDs de actividad presentes y trae sus nombres
        const actIds = Array.from(new Set((acts || []).map(a => a?.actividad).filter(Boolean)));
        let loadIds = new Set();
        if (actIds.length) {
          const { data: actsCat } = await supabase
          .from("actividades")
            .select("id, nombre")
            .in("id", actIds);
          (actsCat || []).forEach(x => { if (/(^|\s)load(\s|$)/i.test(String(x?.nombre||""))) loadIds.add(x.id); });
        }
        const items = [];
        (acts || [])
          // Solo actividad Load y estado finalizada
          .filter(a => loadIds.has(a?.actividad) && String(a?.estado||"").trim().toLowerCase()==="finalizada")
          .forEach((a) => {
        // caso 1: columnas simples
        const candKeys = ["producto", "producto_id", "product_id", "product", "prod_id"];
        let pid = null;
        for (const k of candKeys) {
          if (a && a[k] != null) { pid = a[k]; break; }
        }
        const qty = Number(a?.cantidad ?? 0);

        if (pid != null) {
          items.push({ producto_id: pid, cantidad: isNaN(qty) ? 0 : qty });
        }

        // caso 2: array JSON en `productos`
        if (Array.isArray(a?.productos)) {
          a.productos.forEach((it) => {
            const pid2 = it?.producto ?? it?.producto_id ?? it?.id ?? it?.product_id ?? null;
            const qty2 = Number(it?.cantidad ?? it?.qty ?? 0);
            if (pid2 != null) {
              items.push({ producto_id: pid2, cantidad: isNaN(qty2) ? 0 : qty2 });
            }
          });
        }
      });

      // 3) fetch de productos necesarios
      const ids = Array.from(new Set(items.map((x) => x.producto_id))).filter((v) => v != null);
      if (ids.length) {
        const { data: prods, error: errProds } = await supabase
          .from("productos")
          .select("*")
          .in("id", ids);

        if (!errProds) {
          const map = {};
          (prods || []).forEach((p) => { if (p?.id != null) map[p.id] = p; });
          setProductosById(map);
        }
      }

      // 4) guarda los items normalizados en el estado para dibujar tabla
      //    (si ya usas lineasIdx para otras cosas, puedes omitir)
      setLineasIdx(items);
    }


    async function cargarPo() {
      setPoData([]);
      if (!selectedPoIds || selectedPoIds.length === 0) return;
      const ids = selectedPoIds.map(String);
      const { data, error } = await supabase
        .from("catalogo_pos")
        .select("*")
        .in("id", ids);
      if (!error) setPoData(data || []);
    }

    async function cargarShipper() {
      setShipperData(null);
      if (!selectedShipperId) return;
      const { data, error } = await supabase
        .from("catalogo_shipper")
        .select("*")
        .eq("id", selectedShipperId)
        .maybeSingle();
      if (!error) setShipperData(data || null);
    }

    cargarDetalleIdx();
    cargarPo();
    cargarShipper();
  }, [selectedIdx, selectedPoIds, selectedShipperId]);

  /* ---------------- Generar PDF ---------------- */
  function drawHeader(doc, title, rightText = null, y = 12) {
    doc.setFontSize(16);
    doc.text(title, 12, y);

    if (rightText) {
      doc.setFontSize(11);
      doc.text(String(rightText), 200, y, { align: "right" });
    }

    doc.setLineWidth(0.5);
    doc.line(12, y + 2, 200, y + 2);
  }


  function drawKVP(doc, label, value, x, y) {
    doc.setFontSize(10);
    doc.text(`${label}:`, x, y);
    doc.setFontSize(11);
    doc.text(s(value) || "—", x + 42, y);
  }

  async function generarPDF() {
    try {
      setIsGenerating(true);

      if (!selectedIdx) return toast.error(t("select_idx_first", "Selecciona un IDX"));
      if (!selectedPoIds || selectedPoIds.length === 0) {
        return toast.error(t("select_po_first", "Selecciona al menos un PO"));
      }
      if (!selectedShipperId) return toast.error(t("select_shipper_first", "Selecciona un Remitente"));

      const selPOs = Array.isArray(poData) ? poData : [];
      const primaryPO = selPOs[0] || {};
      const poNumbers = selPOs.map((p) => p.po).filter(Boolean);

      const formatPO = (arr) => {
        if (arr.length <= 2) return arr.join(", ");
        const mid = Math.ceil(arr.length / 2);
        return arr.slice(0, mid).join(", ") + "\n" + arr.slice(mid).join(", ");
      };

      const shipper = shipperData || {};
      const doc = new jsPDF({ unit: "mm", format: "letter" }); // 215.9 x 279.4 mm aprox

      // ======= Página 1: BOL =======
      // (1) Fondo opcional (si pones una imagen de plantilla sin QR/SHP, quedará idéntico)
      try {
        if (BOL_BG) {
          const bg = await loadImg(BOL_BG);
          doc.addImage(bg, "PNG", 0, 0, 215.9, 279.4);
        }
      } catch {}

      // (2) Logo Daehan (arriba-izquierda). Usa coordenadas del ejemplo.
      try {
        const logo = await loadImg(DA_LOGO);
        // x=12,y=10, ancho=30mm aprox, alto se mantiene por aspecto
        doc.addImage(logo, "PNG", 12, 10, 30, 12);
      } catch {}

      // helpers de texto/recta
      const text = (label, value, x, y, opts = {}) => {
        const { size = 10, bold = false, align = "left", gap = 2 } = opts;
        doc.setFont("helvetica", bold ? "bold" : "normal");
        doc.setFontSize(size);
        const lbl = label ? `${label}: ` : "";
        doc.text(`${lbl}${value ?? ""}`, x + gap, y, { align });
      };
      const box = (x, y, w, h, lw = 0.25) => {
        doc.setLineWidth(lw);
        doc.rect(x, y, w, h);
      };
      const line = (x1, y1, x2, y2, lw = 0.25) => {
        doc.setLineWidth(lw);
        doc.line(x1, y1, x2, y2);
      };
      const join = (...a) => a.filter(Boolean).join(" ");

      // Título centrado (sin “SHP…”, sin QR)
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("Bill of Lading", 108, 22, { align: "center" });

      // ===== Encabezados (cuatro cajas) =====
      // medidas clavadas al sample: 4 cajas de 48mm de ancho, 14mm alto
      const topY = 28, cW = 48, cH = 14, mX = 12;
      const hdrs = [
        ["Freight Class", primaryPO?.freight_class ?? ""],
        ["Freight Charges", primaryPO?.freight_charges ?? primaryPO?.freight_charge ?? ""],
        ["Carrier Name", primaryPO?.carrier_name ?? ""],
        ["Commercial Invoice", primaryPO?.commercial_invoice ?? ""],
      ];
      hdrs.forEach((h, i) => {
        const x = mX + i * cW;
        box(x, topY, cW, cH);
        text(h[0], "", x, topY + 5, { size: 9, bold: true });
        text("", h[1], x, topY + 11, { size: 10 });
      });

      // ===== Fila BOL Date / Bill Charges To (ancha) / Secondary Carrier =====
      const bolDate = new Date().toLocaleDateString();
      box(12, 46, 48, 14);
      text("BOL Date", "", 12, 51, { size: 9, bold: true });
      text("", bolDate, 12, 58, { size: 10 });

      box(62, 46, 98, 28);
      text("Bill Charges To", "", 62, 51, { size: 9, bold: true });
      const billToName = primaryPO?.bill_to_name ?? "";
      const billToAddr = join(primaryPO?.bill_to_address1, primaryPO?.bill_to_address2);
      const billToCity = join(primaryPO?.bill_to_city, primaryPO?.bill_to_state, primaryPO?.bill_to_zip);
      const billToCountry = primaryPO?.bill_to_country ?? "";
      text("", billToName, 62, 56, { size: 10 });
      text("", billToAddr, 62, 61, { size: 10 });
      text("", billToCity, 62, 66, { size: 10 });
      text("", billToCountry, 62, 71, { size: 10 });

      box(162, 46, 26, 14);
      text("Secondary Carrier", "", 162, 51, { size: 9, bold: true });
      text("", primaryPO?.secondary_carrier_name ?? "", 162, 58, { size: 10 });

      // ===== Fila Container / Seal / Shipment / Booking =====
      const rowY = 76, rH = 14, rW = 48;
      box(12, rowY, rW, rH);
      text("Container Number", "", 12, rowY + 5, { size: 9, bold: true });
      text("", trailerNo || primaryPO?.trailer_number || "", 12, rowY + 11);

      box(12 + rW, rowY, rW, rH);
      text("Seal Number", "", 12 + rW, rowY + 5, { size: 9, bold: true });
      text("", sealNo || primaryPO?.seal_number || "", 12 + rW, rowY + 11);

      box(12 + rW * 2, rowY, rW, rH);
      text("Shipment Number", "", 12 + rW * 2, rowY + 5, { size: 9, bold: true });
      text("", shipmentNo || primaryPO?.shipment_number || "", 12 + rW * 2, rowY + 11);

      box(12 + rW * 3, rowY, rW + 14, rH);
      text("Booking/Tracking Number", "", 12 + rW * 3, rowY + 5, { size: 9, bold: true });
      text("", primaryPO?.booking_number ?? primaryPO?.tracking_number ?? "", 12 + rW * 3, rowY + 11);

      // ===== PO# + Shipper Address =====
      box(12, rowY + rH + 4, 60, rH);
      text("Po#", "", 12, rowY + rH + 9, { size: 9, bold: true });
      const poText = formatPO(poNumbers).split("\n");
      text("", poText[0] ?? "", 12, rowY + rH + 15);
      if (poText[1]) text("", poText[1], 12, rowY + rH + 20);

      box(74, rowY + rH + 4, 114, rH + 10);
      text("Shipper Address", "", 74, rowY + rH + 9, { size: 9, bold: true });
      let sy = rowY + rH + 14;
      text("", shipper?.shipper_name ?? shipper?.shipper ?? "", 74, sy); sy += 5;
      text("", join(shipper?.address1, shipper?.address2), 74, sy); sy += 5;
      text("", join(shipper?.city, shipper?.state, shipper?.zip), 74, sy); sy += 5;
      text("", shipper?.country ?? "", 74, sy);

      // ===== Consignee Address =====
      const consTop = rowY + rH + 4 + rH + 12;
      box(12, consTop, 176, 28);
      text("Consignee Address", "", 12, consTop + 5, { size: 9, bold: true });
      let cy = consTop + 10;
      text("", primaryPO?.consignee_name ?? "", 12, cy); cy += 5;
      text("", join(primaryPO?.consignee_address1, primaryPO?.consignee_address2), 12, cy); cy += 5;
      text("", join(primaryPO?.consignee_city, primaryPO?.consignee_state, primaryPO?.consignee_zip), 12, cy); cy += 5;
      text("", primaryPO?.consignee_country ?? "", 12, cy);

      // ===== Packaging & Dimension table =====
      // agrega pesos por paquete y totales como el sample
      const porProducto = {};
      (lineasIdx || []).forEach((it) => {
        const pid = it?.producto_id;
        if (pid == null) return;
        const cajas = Number(it?.cantidad ?? 0);
        porProducto[pid] = (porProducto[pid] || 0) + (isNaN(cajas) ? 0 : cajas);
      });

      const tabY = consTop + 36;
      const tabH = 110;
      box(12, tabY, 176, tabH);

      const cols = [
        { k: "pkgQty",  t: "Package Quantity", w: 20 },
        { k: "pkgType", t: "Package Type",     w: 24 },
        { k: "desc",    t: "Description",      w: 55 },
        { k: "dim",     t: "Dimension Per Package", w: 35 },
        { k: "wPer",    t: "Weight Per Package",    w: 24, right: true },
        { k: "wTot",    t: "Total Weight",          w: 14, right: true },
        { k: "uom",     t: "Weight UoM",            w: 4  },
      ];

      // header
      let cx = 12;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      cols.forEach(c => {
        doc.text(c.t, cx + 2, tabY + 5);
        cx += c.w;
        line(cx, tabY, cx, tabY + tabH);
      });
      line(12, tabY + 7, 188, tabY + 7);

      // filas
      let y = tabY + 13;
      let totalUnits = 0;
      let totalWeight = 0;

      Object.keys(porProducto).forEach(pid => {
        const p = productosById[pid] || {};
        const boxes = Number(porProducto[pid] ?? 0) || 0;
        if (boxes <= 0) return;

        const unitsPerBox = (packType === "returnable")
          ? Number(p?.cantidad_por_caja_retornable ?? p?.cant_por_caja_retornable ?? 1)
          : Number(p?.cantidad_por_caja_expendable ?? p?.cant_por_caja_expendable ?? 1);

        const wUnit = Number(p?.peso_por_pieza ?? p?.peso_unitario ?? 0); // LB
        const wBox  = (packType === "returnable")
          ? Number(p?.peso_caja_retornable ?? p?.peso_por_caja_retornable ?? 0)
          : Number(p?.peso_caja_expendable ?? p?.peso_por_caja_expendable ?? 0);

        const L = p?.dim_l ?? p?.length_in ?? p?.largo ?? "";
        const W = p?.dim_w ?? p?.width_in  ?? p?.ancho ?? "";
        const H = p?.dim_h ?? p?.height_in ?? p?.alto ?? "";
        const dimText = (L && W && H) ? `${L} X ${W} X ${H} IN` : "";

        const piecesPerBox  = isNaN(unitsPerBox) ? 1 : unitsPerBox;
        const weightPerPack = (piecesPerBox * (isNaN(wUnit) ? 0 : wUnit)) + (isNaN(wBox) ? 0 : wBox);
        const lineTotal     = weightPerPack * boxes;

        totalUnits  += boxes;
        totalWeight += lineTotal;

        const row = {
          pkgQty: String(boxes),
          pkgType: "Box",
          desc: (p?.nombre ?? p?.descripcion ?? "").toString(),
          dim: dimText,
          wPer: weightPerPack.toFixed(2),
          wTot: lineTotal.toFixed(2),
          uom: "LB",
        };

        let x = 12;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        cols.forEach(c => {
          const val = row[c.k] ?? "";
          if (c.right) doc.text(String(val), x + c.w - 1, y, { align: "right" });
          else doc.text(String(val), x + 2, y);
          x += c.w;
        });

        y += 6;
        if (y > tabY + tabH - 8) { doc.addPage(); y = 20; }
      });

      // Totales (mismo estilo que el sample)
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      text("Total Shipment Weight", `${totalWeight.toFixed(2)} LB`, 12, tabY + tabH + 6, { bold: true });
      text("Total Shipping Units", String(totalUnits), 120, tabY + tabH + 6, { bold: true });

      // Firmas (pickup/drop off)
      const signY = tabY + tabH + 12;
      box(12, signY, 84, 38);
      text("Pickup", "", 12, signY + 6, { bold: true });
      text("Shipper Printed Name", "", 12, signY + 14, { size: 9 });
      text("Sign", "", 12, signY + 20, { size: 9 });
      text("In Time", "", 12, signY + 26, { size: 9 });
      text("Date (MM/DD/YYYY)", "", 12, signY + 32, { size: 9 });

      box(104, signY, 84, 38);
      text("Drop off", "", 104, signY + 6, { bold: true });
      text("Receiver Printed Name", "", 104, signY + 14, { size: 9 });
      text("Sign", "", 104, signY + 20, { size: 9 });
      text("In Time", "", 104, signY + 26, { size: 9 });
      text("Date (MM/DD/YYYY)", "", 104, signY + 32, { size: 9 });

      // Pie (resumen legal)
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.text(
        "Received and mutually agreed... (Uniform Bill of Lading terms and conditions). Carrier not liable for incidental or consequential damages.",
        12, signY + 44, { maxWidth: 176 }
      );

      // ======= Página 2: Cover Sheet =======
      doc.addPage();

      // Fondo opcional
      try {
        if (COVER_BG) {
          const bg2 = await loadImg(COVER_BG);
          doc.addImage(bg2, "PNG", 0, 0, 215.9, 279.4);
        }
      } catch {}

      // Logo
      try {
        const logo2 = await loadImg(DA_LOGO);
        doc.addImage(logo2, "PNG", 12, 10, 30, 12);
      } catch {}

      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("Cover Sheet", 108, 22, { align: "center" });

      // Address (consignee)
      const addrY = 32;
      text("NA-US-CA-Lathrop-701 D'Arcy Pkwy", "", 12, addrY, { size: 11, bold: true });
      text("", primaryPO?.consignee_name ?? "", 12, addrY + 6);
      text("", join(primaryPO?.consignee_address1, primaryPO?.consignee_address2), 12, addrY + 12);
      text("", join(primaryPO?.consignee_city, primaryPO?.consignee_state, primaryPO?.consignee_zip), 12, addrY + 18);
      text("", primaryPO?.consignee_country ?? "", 12, addrY + 24);

      // Grid derecho
      const gY = 32, gX = 110, rowH = 12, Lw = 40, Rw = 48;
      const shipDate = primaryPO?.ship_date ? new Date(primaryPO.ship_date).toLocaleString() : new Date().toLocaleString();
      const rows = [
        ["Ship Date", shipDate],
        ["Shipment Number", shipmentNo || primaryPO?.shipment_number || ""],
        ["Packing Slip Number", packingSlip || primaryPO?.packing_slip_number || ""],
        ["Trailer Number", trailerNo || primaryPO?.trailer_number || ""],
        ["Carrier", primaryPO?.carrier_name ?? ""],
      ];
      rows.forEach((r, i) => {
        const y0 = gY + i * rowH;
        box(gX, y0, Lw, rowH);       box(gX + Lw, y0, Rw, rowH);
        text(r[0], "", gX, y0 + 8, { bold: true });
        text("", r[1], gX + Lw, y0 + 8);
      });

      // Mini tabla
      const miniY = gY + rows.length * rowH + 10;
      const mini = [
        ["Part Number", primaryPO?.part_number ?? ""],
        ["Supplier", shipper?.shipper_name ?? shipper?.shipper ?? ""],
        ["SHP Number", shipmentNo || primaryPO?.shipment_number || ""],
        ["Trailer Number", trailerNo || primaryPO?.trailer_number || ""],
      ];
      mini.forEach((r, i) => {
        const y0 = miniY + i * rowH;
        box(12, y0, 40, rowH); box(52, y0, 136, rowH);
        text(r[0], "", 12, y0 + 8, { bold: true });
        text("", r[1], 52, y0 + 8);
      });

      // Guardar
      const fileName = `BOL_${String(selectedIdx)}_${String(shipmentNo || "Shipment")}.pdf`;
      doc.save(fileName);

      toast.success(t("generated_ok", "BOL generado correctamente"));
      resetForm();
    } catch (e) {
      console.error(e);
      toast.error(t("error_generating", "Error al generar el BOL"));
    } finally {
      setIsGenerating(false);
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
          <select value={selectedShipperId} onChange={(e) => setSelectedShipperId(e.target.value)} disabled={shipperOptions.length === 0}>
            <option value="">{t("select_shipper", "Seleccionar Remitente")}</option>
            {shipperOptions.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.shipper_name
                  ? p.shipper_name
                  : p.shipper || `ID ${p.id}`}
              </option>
            ))}
          </select>

          {/* Shipment # */}
          <input placeholder={t("shipment_number", "No. de envío (Shipment #)")} value={shipmentNo} onChange={(e) => setShipmentNo(e.target.value)} />

          {/* Trailer/Container */}
          <input placeholder={t("trailer_number", "No. de Trailer/Contenedor")} value={trailerNo} onChange={(e) => setTrailerNo(e.target.value)} />

          {/* PO (multi-select estilo react-select) */}
          <Select
            isMulti
            options={poOptions.map((p) => ({
              value: p.id,
              label: p.po
                ? `${p.po} — ${p.consignee_name || ""}`
                : `ID ${p.id}`,
            }))}
            value={selectedPoIds.map((id) => {
              const po = poOptions.find((p) => String(p.id) === String(id));
              return po
                ? {
                    value: po.id,
                    label: po.po
                      ? `${po.po} — ${po.consignee_name || ""}`
                      : `ID ${po.id}`,
                  }
                : { value: id, label: id };
            })}
            onChange={(e) => setSelectedPoIds(e.map((i) => i.value))}
            placeholder={t("select_po", "Selecciona un PO")}
            styles={{
              control: (base, state) => ({
                ...base,
                backgroundColor: "#333", // fondo igual al input
                borderColor: state.isFocused ? "#007BFF" : "#333",
                boxShadow: "none",
                color: "#fff",
                fontFamily: "inherit",
                fontSize: "14px",
                minHeight: "38px",
                "&:hover": { borderColor: "#007BFF" },
              }),
              valueContainer: (base) => ({
                ...base,
                color: "#fff",
              }),
              singleValue: (base) => ({
                ...base,
                color: "#fff",
              }),
              input: (base) => ({
                ...base,
                color: "#fff",
              }),
              placeholder: (base) => ({
                ...base,
                color: "#bbb", // texto placeholder gris claro
              }),
              option: (base, state) => ({
                ...base,
                backgroundColor: state.isSelected
                  ? "#007BFF"
                  : state.isFocused
                  ? "#555"
                  : "#333",
                color: "#fff",
                cursor: "pointer",
              }),
              multiValue: (base) => ({
                ...base,
                backgroundColor: "#007BFF", // fondo de etiqueta seleccionada
                color: "#fff",
                borderRadius: 4,
              }),
              multiValueLabel: (base) => ({
                ...base,
                color: "#fff",
                fontWeight: "bold",
              }),
              multiValueRemove: (base) => ({
                ...base,
                color: "#fff",
                ":hover": { backgroundColor: "#0056b3", color: "#fff" },
              }),
              menu: (base) => ({
                ...base,
                backgroundColor: "#333",
                zIndex: 9999,
              }),
              dropdownIndicator: (base) => ({
                ...base,
                color: "#fff",
                ":hover": { color: "#007BFF" },
              }),
              clearIndicator: (base) => ({
                ...base,
                color: "#fff",
                ":hover": { color: "#ff5555" },
              }),
            }}
          />

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
          <button
            className="primary"
            onClick={generarPDF}
            style={{ alignSelf: "center" }}
            disabled={isGenerating}
          >
            {isGenerating
              ? t("loading", "Generando...")
              : t("generate_bol", "Generar BOL y Cover Sheet")}
          </button>
        </div>

        <div className="card" style={{ padding: 12 }}>
          <strong>{t("preview_hint", "Vista previa")}</strong>
          <p style={{ marginTop: 6 }}>
            {!selectedIdx || selectedPoIds.length === 0 ? t("select_idx_po", "Seleccionar IDX & PO") : t("ready_to_generate", "Listo para generar PDF…")}
          </p>
        </div>

        <ToastContainer position="top-center" autoClose={1400} />
      </div>
    </div>
  );
}
