import React from "react";
import { supabase } from "../supabase/client";
import { useTranslation } from "react-i18next";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { jsPDF } from "jspdf";
import "../App.css";
import Select from "react-select";
import DA_LOGO from "../assets/Daehan.png"; 

const DAEHAN_LOGO_SRC = "/assets/Daehan.png";

// Envuelve texto al ancho indicado usando jsPDF
function wrapText(doc, txt, maxWidth, fontSize = 9) {
  if (!txt) return [];
  doc.setFontSize(fontSize);
  return doc.splitTextToSize(String(txt), maxWidth);
}

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
  const [billToData, setBillToData] = React.useState(null);
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

  // Cargar Bill Charges To del primer PO seleccionado
  React.useEffect(() => {
    const firstPO = Array.isArray(poData) && poData[0]?.po ? poData[0].po : null;
    if (!firstPO) {
      setBillToData(null);
      return;
    }
    (async () => {
      const { data, error } = await supabase
        .from("bill_charges_to")
        .select("*")
        .eq("po", firstPO)
        .maybeSingle();
      if (!error) setBillToData(data || null);
    })();
  }, [poData]);

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

  function drawRightFit(doc, text, xRight, y, maxWidth, baseSize = 9) {
    doc.setFontSize(baseSize);
    const dims = doc.getTextDimensions(String(text ?? ""));
    if (dims.w <= maxWidth) {
      doc.text(String(text ?? ""), xRight, y, { align: "right" });
    } else {
      const ratio = maxWidth / Math.max(1, dims.w);
      const newSize = Math.max(7, Math.floor(baseSize * ratio * 100) / 100);
      doc.setFontSize(newSize);
      doc.text(String(text ?? ""), xRight, y, { align: "right" });
      doc.setFontSize(baseSize);
    }
  }

  // === Helpers de tabla auto-ajustable ===
  const CELL_PAD_X = 2;      // padding horizontal
  const CELL_PAD_Y = 3;      // padding vertical
  const LINE_H = 4.3;        // alto de línea de texto
  const MIN_ROW_H = 8;       // alto mínimo por fila

  function splitFit(doc, txt, width, fontSize = 9) {
    doc.setFontSize(fontSize);
    const w = Math.max(2, width - 2 * CELL_PAD_X);
    return doc.splitTextToSize(String(txt ?? ""), w);
  }

  function measureRowHeight(doc, row, COLS, fontSize = 9) {
    let maxLines = 1;
    for (let i = 0; i < COLS.length; i++) {
      const c = COLS[i];
      const lines = splitFit(doc, row[c.k], c.w, fontSize).length;
      if (lines > maxLines) maxLines = lines;
    }
    const h = Math.max(MIN_ROW_H, 2 * CELL_PAD_Y + maxLines * LINE_H);
    return h;
  }

  function measureHeaderHeight(doc, COLS, headerFont = 8) {
    let maxLines = 1;
    for (let i = 0; i < COLS.length; i++) {
      const c = COLS[i];
      const lines = splitFit(doc, c.t, c.w, headerFont).length;
      if (lines > maxLines) maxLines = lines;
    }
    return Math.max(7, 2 * CELL_PAD_Y + maxLines * (LINE_H - 0.4)); // un poquito más compacto
  }

  // Normaliza el shipper desde catalogo_shipper (soporta varios nombres de columna)
  function normalizeShipper(s = {}) {
    const pick = (...vals) => vals.find(v => (v ?? "").toString().trim() !== "") || "";

    const name     = pick(s.shipper_name, s.shipper, s.name);
    const address1 = pick(s.address1, s.shipper_address1, s.shipper_address, s.address, s.direccion, s.address_line1, s.street);
    const address2 = pick(s.address2, s.shipper_address2, s.address_line2);
    const city     = pick(s.city, s.shipper_city, s.ciudad);
    const state    = pick(s.state, s.shipper_state, s.estado);
    const zip      = pick(s.zip, s.zip_code, s.cp, s.postal, s.codigo_postal, s.postcode);
    const country  = pick(s.country, s.shipper_country, s.pais);

    return { name, address1, address2, city, state, zip, country };
  }

  function resolveBillTo(primaryPO, billToData) {
    const pick = (...vals) => vals.find(v => (v ?? "").toString().trim() !== "") || "";
    return {
      name:     pick(billToData?.bill_to_name,     primaryPO?.bill_to_name,     primaryPO?.bill_to),
      address1: pick(billToData?.bill_to_address1, primaryPO?.bill_to_address1),
      address2: pick(billToData?.bill_to_address2, primaryPO?.bill_to_address2),
      city:     pick(billToData?.bill_to_city,     primaryPO?.bill_to_city),
      state:    pick(billToData?.bill_to_state,    primaryPO?.bill_to_state),
      zip:      pick(billToData?.bill_to_zip,      primaryPO?.bill_to_zip),
      country:  pick(billToData?.bill_to_country,  primaryPO?.bill_to_country),
    };
  }

  async function generarPDF() {
    try {
      setIsGenerating(true);

      // Validaciones básicas
      if (!selectedIdx) return toast.error(t("select_idx_first", "Selecciona un IDX"));
      if (!selectedPoIds || selectedPoIds.length === 0) {
        return toast.error(t("select_po_first", "Selecciona al menos un PO"));
      }
      if (!selectedShipperId) return toast.error(t("select_shipper_first", "Selecciona un Remitente"));
      
      const selPOs = Array.isArray(poData) ? poData : [];
      const primaryPO = selPOs[0] || {};
      const poNumbers = selPOs.map((p) => p.po).filter(Boolean);
      const SH = normalizeShipper(shipperData || {});
      const BT = resolveBillTo(primaryPO, billToData);

      const join = (...a) => a.filter(Boolean).join(" ");
      const bolDate = new Date().toLocaleDateString();

      // --------- 1) Normaliza items (cajas por producto) ---------
      const cajasPorProducto = {};
      (lineasIdx || []).forEach((it) => {
        const pid = it?.producto_id;
        if (pid == null) return;
        const cajas = Number(it?.cantidad ?? 0);
        cajasPorProducto[pid] = (cajasPorProducto[pid] || 0) + (isNaN(cajas) ? 0 : cajas);
      });

      // --------- 2) Arma las filas de la tabla + cálculos de peso ---------
      const rows = [];
      let totalUnits = 0;
      let totalWeight = 0;

      Object.keys(cajasPorProducto).forEach((pid) => {
        const p = productosById[pid] || {};
        const cajas = Number(cajasPorProducto[pid] ?? 0) || 0;
        if (cajas <= 0) return;

        // piezas por caja
        const piezasPorCaja = (packType === "returnable")
          ? Number(p?.cantidad_por_caja_retornable ?? p?.cant_por_caja_retornable ?? 1)
          : Number(p?.cantidad_por_caja_expendable ?? p?.cant_por_caja_expendable ?? 1);

        // pesos
        const pesoPieza = Number(p?.peso_por_pieza ?? p?.peso_unitario ?? 0);       // LB
        const pesoCaja  = (packType === "returnable")
          ? Number(p?.peso_caja_retornable ?? p?.peso_por_caja_retornable ?? 0)
          : Number(p?.peso_caja_expendable ?? p?.peso_por_caja_expendable ?? 0);

        // dimensiones (opcional)
        const L = p?.dim_l ?? p?.length_in ?? p?.largo ?? "";
        const W = p?.dim_w ?? p?.width_in  ?? p?.ancho ?? "";
        const H = p?.dim_h ?? p?.height_in ?? p?.alto  ?? "";
        const dimText = (L && W && H) ? `${L} X ${W} X ${H} IN` : "";

        // --- Reglas de peso ---
        // Peso por paquete (1 caja): (piezasPorCaja * pesoPieza) + pesoCaja
        const pesoPorPaquete = ( (isNaN(piezasPorCaja)?0:piezasPorCaja) * (isNaN(pesoPieza)?0:pesoPieza) ) + (isNaN(pesoCaja)?0:pesoCaja);
        // Peso por producto (todas sus cajas): cajas * pesoPorPaquete
        const pesoLinea = cajas * pesoPorPaquete;

        totalUnits  += cajas;
        totalWeight += pesoLinea;

        rows.push({
          pkgQty: String(cajas),
          pkgType: "Box",
          desc: (p?.nombre ?? p?.descripcion ?? "").toString(),
          dim: dimText,
          wPer: pesoPorPaquete.toFixed(2),
          wTot: pesoLinea.toFixed(2),
          uom: "LB",
        });
      });

      // --------- 3) Medimos el alto que necesitamos (versión compacta) ---------
      const W = 215.9;   // carta mm
      const M = 10;      // margen lateral (antes 12 -> +espacio útil)

      const headerH = 10;  // "Bill of Lading" + línea
      const grid1H  = 10;  // fila Freight/Charges/Carrier (3 cajas)
      const grid2H  = 22;  // BOL Date + Bill Charges To (sin Secondary)
      const grid3H  = 10;  // Container/Seal/Shipment/Booking
      const poShipH = 25;  // Po# + Shipper
      const consigH = 25;  // Consignee
      const gap     = 2;   // separación mínima entre bloques

      // Tabla
      const TAB_X = M;
      const TAB_W = W - 2 * M;
      const COLS = [
        { k: "pkgQty",  t: "Package\nQuantity",        w: 22, align: "left"  },
        { k: "pkgType", t: "Package\nType",            w: 22, align: "left"  },
        { k: "desc",    t: "Description",              w: 60, align: "left"  }, 
        { k: "dim",     t: "Dimension Per\nPackage",   w: 36, align: "left"  },
        { k: "wPer",    t: "Weight Per\nPackage",      w: 18, align: "right" }, 
        { k: "wTot",    t: "Total\nWeight",            w: 18, align: "right" }, 
        { k: "uom",     t: "UOM",                      w: 12,  align: "left"  }, 
      ];

      // Función de medición local
      const measureRowH = (doc, row) => {
        const wrap = (txt, w) => doc.splitTextToSize(String(txt||""), Math.max(2, w - 2*CELL_PAD_X));
        const lines = [
          wrap(row.pkgQty, COLS[0].w).length,
          wrap(row.pkgType, COLS[1].w).length,
          wrap(row.desc,   COLS[2].w).length,
          wrap(row.dim,    COLS[3].w).length,
          wrap(row.wPer,   COLS[4].w).length,
          wrap(row.wTot,   COLS[5].w).length,
          wrap(row.uom,    COLS[6].w).length,
        ];
        const count = Math.max(...lines);
        // Usa el padding vertical que ya tienes definido
        return Math.max(MIN_ROW_H, (2 * CELL_PAD_Y) + (count * LINE_H));
      };

      const TMP = new jsPDF({unit:"mm", format:"letter"}); // solo para medir
      TMP.setFont("helvetica","normal").setFontSize(9);

      const preHeaderTableH = measureHeaderHeight(TMP, COLS, 8); // mídelo de verdad
      const preBodyTableH   = rows.reduce((acc,r)=> acc + measureRowH(TMP, r), 0) + 1;

      const totalsH = 8;
      const firmasH = 40;
      const legalH  = 10;

      const contentH =
        headerH + gap +
        grid1H + gap +
        grid2H + gap +
        grid3H + gap +
        poShipH + gap +
        consigH + gap +
        preHeaderTableH + preBodyTableH + gap +
        totalsH + gap +
        firmasH + gap +
        legalH + gap + 8;


      const pageH = Math.max(279.4, contentH); // al menos carta; crece si hace falta

      // --------- 4) Crear documento con alto dinámico y dibujar ---------
      const doc = new jsPDF({ unit: "mm", format: [W, pageH] });

      // Logo
      try {
        const logo = await loadImg(DA_LOGO);
        doc.addImage(logo, "PNG", M, 10, 30, 12);
      } catch {}

      // helpers
      const text = (label, value, x, y, opts = {}) => {
        const { size = 10, bold = false, align = "left", gap = 2 } = opts;
        doc.setFont("helvetica", bold ? "bold" : "normal");
        doc.setFontSize(size);
        const lbl = label ? `${label}: ` : "";
        doc.text(`${lbl}${value ?? ""}`, x + gap, y, { align });
      };
      const box = (x, y, w, h, lw = 0.25) => { doc.setLineWidth(lw); doc.rect(x, y, w, h); };
      const line = (x1, y1, x2, y2, lw = 0.25) => { doc.setLineWidth(lw); doc.line(x1, y1, x2, y2); };

      // Título
      doc.setFont("helvetica", "bold"); doc.setFontSize(20);
      doc.text("BILL OF LANDING", W/2, 22, { align: "center" });
      line(M, 24, W-M, 24);
      let y = 24 + gap;

      // ===== Fila 1: 3 cajas (Freight/Charges/Carrier/Bol Date) =====
      {
        const cW = (TAB_W / 4);
        const cH = 10; // súper compacto
        const items = [
          ["Freight Class",   primaryPO?.freight_class ?? ""],
          ["Freight Charges", primaryPO?.freight_charges ?? primaryPO?.freight_charge ?? ""],
          ["Carrier Name",    primaryPO?.carrier_name ?? ""],
          ["BOL Date",        bolDate ?? ""],
        ];
        items.forEach((h, i) => {
          const x = M + i * cW;
          box(x, y, cW, cH);
          text(h[0], "", x, y + 3.5, { size: 8, bold: true });
          text("", h[1], x, y + 8.5, { size: 9 });
        });
        y += cH + gap;
      }

      // ===== Fila 2: Container / Seal / Shipment / Booking / Bill Charges To / PO# =====
      {
        const cW = TAB_W / 6; // 6 columnas
        const rH = 12;

        // PO's seleccionados (envuelve si son muchos)
        const poList = (Array.isArray(poData) && poData.length > 0)
          ? poData.map(p => p.po || "").filter(Boolean).join(", ")
          : (primaryPO?.po ?? "");
        const poDisplay = doc.splitTextToSize(poList, cW - 4);

        // Bill-To en líneas (nombre, dir1+dir2, ciudad/estado/zip, país, cuenta/teléfono/email)
        const btLines = [
          BT.name,
          [BT.address1, BT.address2].filter(Boolean).join(" "),
          [BT.city, BT.state, BT.zip].filter(Boolean).join(", "),
          BT.country,
          BT.account ? `Acct: ${BT.account}` : "",
          BT.phone   ? `Tel: ${BT.phone}`   : "",
          BT.email   ? `Email: ${BT.email}` : "",
        ].filter(Boolean);

        const items = [
          ["Bill Charges To:", btLines], // ← array de líneas
          ["Shipment Number",  shipmentNo || primaryPO?.shipment_number || ""],
          ["Container Number", trailerNo  || primaryPO?.trailer_number  || ""],
          ["Seal Number",      sealNo     || primaryPO?.seal_number     || ""],
          ["Booking Number", primaryPO?.booking_number ?? primaryPO?.tracking_number ?? ""],
          ["PO #’s", poDisplay],
        ];

        items.forEach((pair, i) => {
          const x = M + i * cW;
          box(x, y, cW, rH);
          text(pair[0], "", x, y + 3.5, { size: 7, bold: true });

          // valor: string, array simple o array de líneas envueltas
          let yy = y + 8.5;
          if (typeof pair[1] === "string") {
            doc.text(String(pair[1] || ""), x + 2, yy, { maxWidth: cW - 4 });
          } else if (Array.isArray(pair[1])) {
            pair[1].forEach(line => {
              const wrapped = doc.splitTextToSize(String(line || ""), cW - 4);
              wrapped.forEach(ln => { doc.text(ln, x + 2, yy); yy += 4; });
            });
          }
        });

        y += rH + gap;
      }

      // ===== Fila 3: Shipper (izquierda) + Consignee (derecha) =====
      {
        const rowH = 18;
        const shW = TAB_W / 2 - 1;
        const coX = M + shW + 2;
        const coW = TAB_W / 2 - 1;

        // --- Shipper ---
        box(M, y, shW, rowH);
        text("Shipper Address", "", M, y + 3.5, { size: 8, bold: true });
        let sy = y + 8.5;
        doc.setFontSize(8);
        [
          SH.name,
          [SH.address1, SH.address2].filter(Boolean).join(" "),
          [SH.city, SH.state, SH.zip].filter(Boolean).join(" "),
          SH.country
        ].filter(Boolean).forEach((str) => {
          doc.text(String(str), M + 2, sy);
          sy += 4.2;
        });

        // --- Consignee (sin cambios) ---
        box(coX, y, coW, rowH);
        text("Consignee Address", "", coX, y + 3.5, { size: 8, bold: true });
        let cy = y + 8.5;
        doc.setFontSize(8);
        [
          primaryPO?.consignee_name ?? "",
          [primaryPO?.consignee_address1, primaryPO?.consignee_address2].filter(Boolean).join(" "),
          [primaryPO?.consignee_city, primaryPO?.consignee_state, primaryPO?.consignee_zip].filter(Boolean).join(" "),
          primaryPO?.consignee_country ?? ""
        ].forEach((str) => {
          if (String(str || "").trim() !== "") {
            doc.text(String(str), coX + 2, cy);
            cy += 4.2;
          }
        });

        y += rowH + gap;
      }

      // ===== Tabla: encabezado y filas auto-ajustables =====
      // posiciones X acumuladas
      const COLX = [TAB_X];
      for (let i = 0; i < COLS.length; i++) COLX.push(COLX[i] + COLS[i].w);

      // usar las medidas ya calculadas
      const headerTableH = preHeaderTableH;
      let bodyTableH = preBodyTableH;
      doc.setFont("helvetica", "normal").setFontSize(9); // deja la fuente lista para el cuerpo

      // marco total
      const TAB_Y = y;
      const TAB_H = headerTableH + bodyTableH;
      doc.setLineWidth(0.25);
      doc.rect(TAB_X, TAB_Y, TAB_W, TAB_H);

      // header
      doc.setFont("helvetica", "bold").setFontSize(8);
      for (let i = 0; i < COLS.length; i++) {
        const c = COLS[i];
        const hx = COLX[i];
        const lines = splitFit(doc, c.t, c.w, 8);

        // alto del bloque de texto y centrado vertical sin extra
        const blockH = lines.length * (LINE_H - 0.2);
        let hy = TAB_Y + CELL_PAD_Y + (headerTableH - 2 * CELL_PAD_Y - blockH) / 2;

        lines.forEach(ln => {
          doc.text(ln, hx + CELL_PAD_X, hy);
          hy += (LINE_H - 0.2);
        });

        // separador vertical
        doc.line(COLX[i + 1], TAB_Y, COLX[i + 1], TAB_Y + TAB_H);
      }
      // línea bajo el header
      doc.line(TAB_X, TAB_Y + headerTableH, TAB_X + TAB_W, TAB_Y + headerTableH);


      // body
      let ry = TAB_Y + headerTableH;
      doc.setFont("helvetica", "normal").setFontSize(9);

      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        const rowH = measureRowHeight(doc, row, COLS, 9);

        for (let i = 0; i < COLS.length; i++) {
          const c = COLS[i];
          const cx = COLX[i];
          const content = splitFit(doc, row[c.k], c.w, 9);

          // alto del bloque de texto y centrado vertical
          const blockH = content.length * LINE_H;
          let ty = ry + CELL_PAD_Y + Math.max(0, (rowH - 2 * CELL_PAD_Y - blockH) / 2) + 3.5;

          content.forEach(ln => {
            if (c.align === "right") {
              doc.text(ln, cx + c.w - CELL_PAD_X, ty, { align: "right" });
            } else {
              doc.text(ln, cx + CELL_PAD_X, ty);
            }
            ty += LINE_H;
          });

          // línea vertical de la celda
          doc.line(cx + c.w, ry, cx + c.w, ry + rowH);
        }

        // línea inferior de la fila
        doc.line(TAB_X, ry + rowH, TAB_X + TAB_W, ry + rowH);
        ry += rowH;
      }

      // cursor global debajo de la tabla
      y = TAB_Y + TAB_H + gap;

      // Totales
      doc.setFont("helvetica","bold").setFontSize(10);
      doc.text(`Total Shipment Weight: ${totalWeight.toFixed(2)} LB`, M, y);
      doc.text(`Total Shipping Units: ${String(totalUnits)}`, M+108, y);
      y += 8;

      // Firmas
      const signY = y;
      doc.setFont("helvetica","normal");
      doc.rect(M, signY, 84, 38);
      doc.text("Pickup", M+2, signY+6); 
      doc.text("Shipper Printed Name", M+2, signY+14);
      doc.text("Sign", M+2, signY+20);
      doc.text("In Time", M+2, signY+26);
      doc.text("Date (MM/DD/YYYY)", M+2, signY+32);

      doc.rect(M+92, signY, 84, 38);
      doc.text("Drop off", M+94, signY+6);
      doc.text("Receiver Printed Name", M+94, signY+14);
      doc.text("Sign", M+94, signY+20);
      doc.text("In Time", M+94, signY+26);
      doc.text("Date (MM/DD/YYYY)", M+94, signY+32);
      y += 38 + 6;

      // === LEGAL FOOTER ===
      {
        const legalText = `
        Received and mutually agreed by the shipper and his assigns and any additional party with an interest to any said property hereto and each carrier of all or any of said property over all or any portion of said route to destination, that every service to be performed hereunder shall be subject to the National Motor Freight classifications (NMF 100 Series) Including the Rules, packaging and the Uniform Bill of Lading Terms and Conditions, the applicable regulations of the US Department of Transportation (DOT), the ATA Hazardous Materials Rules Guide Book and the Household Goods Mileage Guides and to the Carriers tariffs, the Carriers pricing schedules, terms, conditions and rules maintained at Carriers general offices all of which are in effect as of the date of issue of this Bill of Lading. Shipper certifies that the consigned merchandise is properly weighed, classified, described, packaged, marked, labeled, destined as indicated, in apparent good order expect as noted (contents and conditions of contents of packages unknown), and in proper condition for transportation according to the DOT and the NMF 100 Series. Carrier (Carrier being understood throughout this contract as meaning in any person or corporation in possession of the property under this contact) agrees to carry to said destination if on its route, otherwise to deliver to another carrier on the route to said destination. Carrier shall in no event be liable for loss of profit, Income, Interest, attorney fees, or any special, incidental or consequential damages. Subject to section 7 of the conditions, if this shipment is to be delivered to the consignee without recourse on the consignor shall sign the following statement: The carrier shall not make the delivery of this shipment without payment of freight and all other lawful charges.`;

        // Configura fuente y color
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6);
        doc.setTextColor(150); // gris medio (puedes probar 180, 200, etc.)

        // Posición Y = parte baja del documento
        const footerY = doc.internal.pageSize.height - 20; // 18 mm desde el borde inferior
        const footerX = M;           // margen izquierdo ya definido arriba
        const footerW = TAB_W;       // ancho total de tabla principal

        // Justificar texto
        const lines = doc.splitTextToSize(legalText.trim(), footerW);
        const totalWidth = footerW;
        let currY = footerY;

        // Función para justificar manualmente
        lines.forEach((line, idx) => {
          const words = line.trim().split(/\s+/);
          if (idx === lines.length - 1 || words.length === 1) {
            // última línea: normal
            doc.text(line, footerX, currY);
          } else {
            // justificado
            const textWidth = doc.getTextWidth(line.replace(/\s+/g, " "));
            const spaceCount = words.length - 1;
            const extraSpace = (totalWidth - textWidth) / spaceCount;
            let cursorX = footerX;
            words.forEach((word, i) => {
              doc.text(word, cursorX, currY);
              cursorX += doc.getTextWidth(word) + extraSpace;
            });
          }
          currY += 3; // separación entre líneas
        });

        doc.setTextColor(0); // regresa a negro
      }     

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
