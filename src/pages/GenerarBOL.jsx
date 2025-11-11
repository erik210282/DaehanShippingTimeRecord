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
    setDockNo("");
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
  const [dockNo, setDockNo] = React.useState("");
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
      const onlyIdx = uniq.filter(v => /idx/i.test(v));
      setIdxOptions(onlyIdx);
      setSelectedIdx(prev => (prev && !onlyIdx.includes(prev) ? "" : prev));
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
    doc.setFontSize(20);
    doc.text(title, 12, y);

    if (rightText) {
      doc.setFontSize(11);
      doc.text(String(rightText), 200, y, { align: "right" });
    }
  }


  function drawKVP(doc, label, value, x, y) {
    doc.setFontSize(10);
    doc.text(`${label}:`, x, y);
    doc.setFontSize(11);
    doc.text(s(value) || "—", x + 42, y);
  }

  function drawRightFit(doc, text, xRight, y, maxWidth, baseSize = 8.5) {
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
  const CELL_PAD_Y = 2.2;      // padding vertical
  const LINE_H = 3.0;        // alto de línea de texto
  const MIN_ROW_H = 6;       // alto mínimo por fila

  const fmt = (n, d = 2) =>
  Number(n || 0).toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });

  function splitFit(doc, txt, width, fontSize = 9) {
    doc.setFontSize(fontSize);
    const w = Math.max(2, width - 2 * CELL_PAD_X);
    return doc.splitTextToSize(String(txt ?? ""), w);
  }

  function measureRowHeight(doc, row, COLS, fontSize = 8.5) {
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

  // Normaliza el shipper desde catalogo_shipper (soporta alias de columnas)
  function normalizeShipper(s = {}) {
    const pick = (...vals) => vals.find(v => (v ?? "").toString().trim() !== "") || "";

    const name     = pick(s.shipper_name, s.shipper, s.name);
    const address1 = pick(s.address1, s.shipper_address1, s.shipper_address, s.address, s.direccion, s.address_line1, s.street);
    const address2 = pick(s.address2, s.shipper_address2, s.address_line2);
    const city     = pick(s.city, s.shipper_city, s.ciudad);
    const state    = pick(s.state, s.shipper_state, s.estado);
    const zip      = pick(s.zip, s.zip_code, s.cp, s.postal, s.codigo_postal, s.postcode);
    const country  = pick(s.country, s.shipper_country, s.pais);
    const contact_name  = pick(s.shipper_contact_name, s.contact_name, s.nombre_contacto);
    const contact_email = pick(s.shipper_contact_email, s.contact_email, s.email);
    const contact_phone = pick(s.shipper_contact_phone, s.contact_phone, s.telefono);

    return { name, address1, address2, city, state, zip, country, contact_name, contact_email, contact_phone };
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

  // ======================= Cover Sheet (Hoja 2) =======================
  async function drawCoverSheet(doc, data) {
    // Formato carta en mm
    const W = 215.9, H = 279.4, M = 12;

    const {
      SH, PO, poNumbers,
      shipmentNo, trailerNo, packingSlip, dockNo,
      bolDate, rows
    } = data;

    const C = PO || {};

    // --- Página nueva (Hoja 2) ---
    doc.addPage([W, H]);

    // --- Logo Daehan ---
    const LOGO_X = M, LOGO_Y = 10, LOGO_W = 28, LOGO_H = 12;
    try {
      doc.addImage(DA_LOGO, "PNG", LOGO_X, LOGO_Y, LOGO_W, LOGO_H);
    } catch {}

    // ===== Encabezado: Consignee (título) + Dirección completa =====
    const centerX = W / 2;
    doc.setFont("helvetica", "bold").setFontSize(24);
    const consigneeName = String(C.consignee_name || "—");

    // Calcular desplazamiento para no invadir el área del logo
    const SAFE_LEFT = LOGO_X + LOGO_W + 4; // “zona segura” a la derecha del logo
    const titleWidth = doc.getTextWidth(consigneeName); // en mm con font actual
    let titleX = centerX;
    const leftEdge = titleX - (titleWidth / 2);

    if (leftEdge < SAFE_LEFT) {
      // desplaza lo necesario para que el borde izq. quede fuera del logo
      titleX += (SAFE_LEFT - leftEdge);
    }

    const TITLE_Y = 26; // ya va debajo del logo (logo llega hasta y=22)
    doc.text(consigneeName, titleX, TITLE_Y, { align: "center" });

    // Dirección multilinea (centrada)
    doc.setFont("helvetica", "normal").setFontSize(14);
    const addrBlock = [
      [C.consignee_address1, C.consignee_address2].filter(Boolean).join(" "),
      [C.consignee_city, C.consignee_state, C.consignee_zip].filter(Boolean).join(", "),
      C.consignee_country
    ].filter(Boolean).join("\n");

    const addrLines = doc.splitTextToSize(addrBlock || "—", Math.min(140, W - 2 * M));
    let y = 34; // se mantiene por debajo del título
    const ADDR_LEADING = 5.4;
    addrLines.forEach(ln => { doc.text(ln, centerX, y, { align: "center" }); y += ADDR_LEADING; });

    // Línea separadora y continuar...
    doc.setLineWidth(0.95);
    doc.line(M, y + 3, W - M, y + 3);
    y += 10;

    // ===== 2 columnas con líneas: etiqueta (izq) + valor (izq) =====
    // Datos
    const partNumbers = (rows || [])
      .map(r => (String(r.desc || "").trim().split(/\s+/)[0] || ""))
      .filter(Boolean)
      .slice(0, 15)
      .join(", ");

    const carrierName  = C.carrier_name || "";
    const supplierName = SH?.name || "";

    // Part numbers como líneas (uno por renglón)
    const pnLines = (rows || [])
      .map(r => (String(r.desc || "").trim().split(/\s+/)[0] || ""))
      .filter(Boolean)
      .slice(0, 15); 

    const fields = [
      ["Ship Date: ",           bolDate],
      ["Shipment Number: ",     shipmentNo],
      ["Packing Slip Number: ", packingSlip],
      ["Trailer Number: ",      trailerNo],
      ["Part Number(s): ",      pnLines.length ? pnLines.join("\n") : "—"],
      ["Supplier: " ,            supplierName],
      ["Carrier: ",             carrierName],
      ["Dock Number: ",         dockNo],
    ];

    // Layout de una sola lista (título izq, valor der)
    const LABEL_COL_W  = 60;        // ancho reservado para el título
    const LABEL_X      = M;         // X del título
    const VALUE_X      = M + LABEL_COL_W + 6; // X donde inicia el valor (izquierda)
    const VALUE_W      = W - M - VALUE_X;     // ancho disponible para el valor
    const LABEL_SIZE   = 15;
    const VALUE_SIZE   = 17;

    const ROW_MIN_H    = 12;        // alto mínimo de cada fila
    const LINE_Y_OFF   = 8.0;       // posición de la línea dentro de la fila
    const VALUE_STEP   = 7.0;       // salto entre líneas del valor (wrapping)

    const drawPair = (label, value) => {
      // --- Configurables ---
      const LINE_MARGIN_RIGHT = 45; // línea termina 30 mm antes del borde derecho
      const LABEL_RIGHT_PAD   = 5;  // separación entre el final del label y el inicio del valor
      const VALUE_PADDING_TOP = 2.0; // aire superior respecto a la fila
      const GAP_AFTER_LINE    = 15.0; // ↑ espacio ENTRE FILAS (ajusta a gusto)

      // --- Valor (2ª columna) ---
      doc.setFont("helvetica", "normal").setFontSize(VALUE_SIZE);
      const txt = String(value ?? "—");
      const wrapped = doc.splitTextToSize(txt, Math.max(2, VALUE_W - 5));

      // Altura del bloque de valor y punto de arranque centrado vertical
      const valueBlockH = Math.max(ROW_MIN_H, wrapped.length * VALUE_STEP);
      const startVy = y + VALUE_PADDING_TOP
        + Math.max(0, (valueBlockH - (wrapped.length * VALUE_STEP)) / 2);

      // --- Label (1ª columna) alineado con el inicio del valor ---
      // Lo alineamos a la DERECHA exactamente donde empieza la 2ª columna (menos un acolchado)
      // y centramos verticalmente el label respecto al bloque del valor.
      doc.setFont("helvetica", "bold").setFontSize(LABEL_SIZE);
      const labelBaseline = startVy + ((wrapped.length - 1) * VALUE_STEP) / 2; // centro del bloque
      const labelX = VALUE_X - LABEL_RIGHT_PAD;
      doc.text(String(label || ""), labelX, labelBaseline, { align: "right" });

      // --- Dibuja el valor (izquierda) ---
      doc.setFont("helvetica", "normal").setFontSize(VALUE_SIZE);
      let vy = startVy;
      wrapped.forEach(ln => { doc.text(ln, VALUE_X, vy); vy += VALUE_STEP; });

      // --- Línea justo debajo del texto (pegada) ---
      const lastBaseline = vy - VALUE_STEP;   // baseline de la última línea
      const lineY = lastBaseline + 1.6;       // a ~1.6 mm por debajo

      doc.setLineWidth(0.25);
      const lineStartX = VALUE_X;                   // inicia donde arranca la 2ª columna
      const lineEndX   = W - LINE_MARGIN_RIGHT;     // termina antes del borde
      doc.line(lineStartX, lineY, lineEndX, lineY);

      // --- Avanza Y al siguiente renglón (controla el espaciado entre filas) ---
      y = lineY + GAP_AFTER_LINE;
    };


    // Pinta todos los pares en una sola lista
    fields.forEach(([lbl, val]) => drawPair(lbl, val));
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

      // --- Helpers para dimensiones por paquete ---
      // Convierte "24x18x12", "24 x 18 x 12", "24*18*12" a {L,W,H}
      function parseDimsFromText(s) {
        if (!s) return null;
        const str = String(s).trim();
        const m = str.replace(/,/g, 'x').match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/i);
        if (!m) return null;
        return { L: m[1], W: m[2], H: m[3] };
      }
      // Toma el primer valor no vacío entre varias claves del producto
      function pick(p, ...keys) {
        for (const k of keys) {
          const v = p?.[k];
          if (v !== undefined && v !== null && String(v).trim() !== "") return v;
        }
        return "";
      }
      // Resuelve la dimensión por paquete del producto según packType
      function getPackageDimensions(p, packType) {
        if (!p) return "—";

        if (packType === "returnable") {
          // 1) Texto del tipo de empaque (ej. "24x18x12")
          const text = pick(
            p,
            "tipo_empaque_retornable", "empaque_retornable",
            "returnable_pack_type", "packaging_returnable", "pack_type_returnable"
          );
          const tDims = parseDimsFromText(text);
          if (tDims) return `${tDims.L} x ${tDims.W} x ${tDims.H} IN`;

          // 2) Campos numéricos por eje (retornable)
          const L = pick(p, "ret_l", "ret_length_in", "length_in_ret", "dim_ret_l",
                            "returnable_l", "largo_ret", "largo_ret_in", "dim_l_ret");
          const W = pick(p, "ret_w", "ret_width_in", "width_in_ret", "dim_ret_w",
                            "returnable_w", "ancho_ret", "ancho_ret_in", "dim_w_ret");
          const H = pick(p, "ret_h", "ret_height_in", "height_in_ret", "dim_ret_h",
                            "returnable_h", "alto_ret", "alto_ret_in", "dim_h_ret");
          if (L && W && H) return `${L} x ${W} x ${H} IN`;
        } else {
          // expendable
          const text = pick(
            p,
            "tipo_empaque_expendable", "empaque_expendable",
            "expendable_pack_type", "packaging_expendable", "pack_type_expendable"
          );
          const tDims = parseDimsFromText(text);
          if (tDims) return `${tDims.L} x ${tDims.W} x ${tDims.H} IN`;

          const L = pick(p, "exp_l", "exp_length_in", "length_in_exp", "dim_exp_l",
                            "expendable_l", "largo_exp", "largo_exp_in", "dim_l_exp");
          const W = pick(p, "exp_w", "exp_width_in", "width_in_exp", "dim_exp_w",
                            "expendable_w", "ancho_exp", "ancho_exp_in", "dim_w_exp");
          const H = pick(p, "exp_h", "exp_height_in", "height_in_exp", "dim_exp_h",
                            "expendable_h", "alto_exp", "alto_exp_in", "dim_h_exp");
          if (L && W && H) return `${L} x ${W} x ${H} IN`;
        }

        // 3) Fallback genérico si no hay campos específicos de empaque
        const Lg = pick(p, "dim_l", "length_in", "largo_in", "largo");
        const Wg = pick(p, "dim_w", "width_in",  "ancho_in", "ancho");
        const Hg = pick(p, "dim_h", "height_in", "alto_in",  "alto");
        if (Lg && Wg && Hg) return `${Lg} x ${Wg} x ${Hg} IN`;

        return "—";
      }

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

        // dimensiones 
        const L = p?.dim_l ?? p?.length_in ?? p?.largo_in ?? p?.largo ?? "";
        const W = p?.dim_w ?? p?.width_in  ?? p?.ancho_in ?? p?.ancho ?? "";
        const H = p?.dim_h ?? p?.height_in ?? p?.alto_in  ?? p?.alto ?? "";
        const dimText = (L && W && H) ? `${L} x ${W} x ${H} IN` : "—";


        // --- Reglas de peso ---
        // Peso por paquete (1 caja): (piezasPorCaja * pesoPieza) + pesoCaja
        const pesoPorPaquete = ( (isNaN(piezasPorCaja)?0:piezasPorCaja) * (isNaN(pesoPieza)?0:pesoPieza) ) + (isNaN(pesoCaja)?0:pesoCaja);
        // Peso por producto (todas sus cajas): cajas * pesoPorPaquete
        const pesoLinea = cajas * pesoPorPaquete;

        totalUnits  += cajas;
        totalWeight += pesoLinea;

        rows.push({
          pkgQty: String(cajas),
          pkgType: p?.bin_type,
          desc: `${p?.part_number || p?.codigo || ""} ${p?.descripcion || ""}`.trim(),
          dim: getPackageDimensions(p, packType),
          wPer: fmt(pesoPorPaquete),
          wTot: fmt(pesoLinea),
          uom: "LB",
        });
      });

      // --------- 3) Medimos el alto que necesitamos (versión compacta) ---------
      const W = 215.9;   // carta mm
      const M = 10;      // margen lateral (antes 12 -> +espacio útil)

      const headerH = 10;  // "Bill of Lading" + línea
      const grid1H  = 10;  // fila Freight/Charges/Carrier (3 cajas)
      const grid2H  = 22;  // BOL Date + Bill Charges To (sin Secondary)
      const grid3H  = 10;  // Container/Seal/Shipment/Packing Slip
      const poShipH = 25;  // Po# + Shipper
      const consigH = 25;  // Consignee
      const gap     = 2;   // separación mínima entre bloques

      // Tabla
      const TAB_X = M;
      const TAB_W = W - 2 * M;
      const COLS = [
        { k: "pkgQty",  t: "Package\nQuantity",         w: 22,   align: "left"  },
        { k: "pkgType", t: "Package\nType",             w: 22,   align: "left"  },
        { k: "desc",    t: "Part Number / Description", w: 64,   align: "left"  },  // +4
        { k: "dim",     t: "Dimension Per\nPackage",    w: 38.5, align: "left"  },  // +2.5
        { k: "wPer",    t: "Weight Per\nPackage",       w: 18.7, align: "right" },  // +0.7
        { k: "wTot",    t: "Total\nWeight",             w: 18.7, align: "right" },  // +0.7
        { k: "uom",     t: "UoM",                       w: 12,   align: "left"  },
      ]; // 22+22+64+38.5+18.7+18.7+12 = 195.9 = TAB_W


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

      const TMP = new jsPDF({ unit: "mm", format: "letter" });
      TMP.setFont("helvetica", "normal").setFontSize(8.5);

      const preHeaderTableH = measureHeaderHeight(TMP, COLS, 8);
      const rowHeights = rows.map(r => measureRowH(TMP, r, COLS, 8.5));

      // alto uniforme = el mayor alto necesario (redondeado a 0.1 mm)
      const round01 = v => Math.round(v * 10) / 10;
      const uniformRowH = round01(Math.max(MIN_ROW_H, ...rowHeights)) - 0.5;

      // alto total del cuerpo = uniforme * número de filas
      const preBodyTableH = uniformRowH * rows.length;

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


      const pageH = Number.isFinite(contentH) ? Math.max(279.4, contentH) : 279.4;

      // --------- 4) Crear documento con alto dinámico y dibujar ---------
      const doc = new jsPDF({ unit: "mm", format: [W, pageH] });

      // Logo
      try { doc.addImage(DA_LOGO, "PNG", M, 10, 30, 12); } catch {}

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
        const cW = (TAB_W / 5);
        const cH = 10; // súper compacto
        const items = [
          ["Freight Class",   primaryPO?.freight_class ?? ""],
          ["Freight Charges", primaryPO?.freight_charges ?? primaryPO?.freight_charge ?? ""],
          ["Carrier Name",    primaryPO?.carrier_name ?? ""],
          ["BOL Date",        bolDate ?? ""],
          ["Dock/Door Number",     dockNo ?? ""],
        ];
        items.forEach((h, i) => {
          const x = M + i * cW;
          box(x, y, cW, cH);
          text(h[0], "", x, y + 3.5, { size: 8, bold: true });
          text("", h[1], x, y + 8.5, { size: 9 });
        });
        y += cH + gap;
      }

      // ===== Fila 2: Bill Charges / Shipment / Container / Seal / Packing Slip / PO =====
      {
        // --- Anchos personalizados (deben sumar TAB_W) ---
        const widths = [
          TAB_W * 0.23, // 0 Bill Charges To
          TAB_W * 0.17, // 1 Shipment Number
          TAB_W * 0.15, // 2 Container Number
          TAB_W * 0.12, // 3 Seal Number
          TAB_W * 0.15, // 4 Packing Slip Number
          TAB_W * 0.18, // 5 PO #'s (más pequeño)
        ];

        // util: X inicial por columna (acumulado)
        const startX = widths.map((_, i) => M + widths.slice(0, i).reduce((a, b) => a + b, 0));

        // PO's seleccionados (envuelve si son muchos) usando el ancho REAL de la 6a columna
        const poList = (Array.isArray(poData) && poData.length > 0)
          ? poData.map(p => p.po || "").filter(Boolean).join(", ")
          : (primaryPO?.po ?? "");
        const poDisplay = doc.splitTextToSize(poList, Math.max(2, widths[5] - 4));

        // Bill-To en líneas (nombre, dir1+dir2, ciudad/estado/zip, país)
        const btLines = [
          BT.name,
          [BT.address1, BT.address2].filter(Boolean).join(" "),
          [BT.city, BT.state, BT.zip].filter(Boolean).join(", "),
          BT.country,
        ].filter(Boolean);

        const items = [
          ["Bill Charges To:", btLines],                                              // 0
          ["Shipment Number",  shipmentNo || primaryPO?.shipment_number || ""],      // 1
          ["Container Number", trailerNo  || primaryPO?.trailer_number  || ""],      // 2
          ["Seal Number",      sealNo     || primaryPO?.seal_number     || ""],      // 3
          ["Packing Slip",   packingSlip || ""],                                      // 4
          ["PO #’s",           poDisplay],                                            // 5
        ];

        // offsets de texto (ajusta si quieres más/menos espacio vertical)
        const labelY = 4.0;
        const valueY = 8.5;
        const lineSpacing = 3.8;

        // 👉 medir cuántas líneas ocupa el contenido en cada columna
        const wrapCount = (pair, w) => {
          const avail = Math.max(2, w - 4);
          if (typeof pair[1] === "string") {
            return doc.splitTextToSize(String(pair[1] || ""), avail).length;
          }
          if (Array.isArray(pair[1])) {
            return pair[1].reduce(
              (sum, line) => sum + doc.splitTextToSize(String(line || ""), avail).length,
              0
            );
          }
          return 1;
        };

        // Altura mínima + pads muy pequeños
        const MIN_RH       = 18;
        const PAD_BOTTOM   = 1.6; // ↓ reduce el espacio bajo el último renglón
        const LABEL_LINE_H = 3.0; // aprox alto visual del label (size 8)

        // Para cada columna, calcula hasta dónde llega realmente el contenido
        const requiredHeights = items.map((pair, i) => {
          const nLines = wrapCount(pair, widths[i]);          // 1,2,3...
          const valueBottom = valueY + ((nLines - 1) * lineSpacing) + PAD_BOTTOM;
          const labelBottom = labelY + LABEL_LINE_H;
          return Math.max(valueBottom, labelBottom);
        });

        // ✅ altura final de la fila = máximo entre columnas
        const rH = Math.max(MIN_RH, ...requiredHeights);

        items.forEach((pair, i) => {
          const x = startX[i];
          const w = widths[i];

          box(x, y, w, rH);
          text(pair[0], "", x, y + labelY, { size: 8, bold: true });
          doc.setFont("helvetica", "normal").setFontSize(8); 

          let yy = y + valueY;

          if (typeof pair[1] === "string") {
            const wrapped = doc.splitTextToSize(String(pair[1] || ""), Math.max(2, w - 4));
            wrapped.forEach(ln => { doc.text(ln, x + 2, yy); yy += lineSpacing; });
          } else if (Array.isArray(pair[1])) {
            pair[1].forEach(line => {
              const wrapped = doc.splitTextToSize(String(line || ""), Math.max(2, w - 4));
              wrapped.forEach(ln => { doc.text(ln, x + 2, yy); yy += lineSpacing; });
            });
          }
        });

        y += rH + gap;
      }

      // ===== Fila 3: Shipper (izquierda) + Consignee (derecha) =====
      {
        const rowH = 33;
        const shW = TAB_W / 2 - 1;
        const coX = M + shW + 2;
        const coW = TAB_W / 2 - 1;

        // --- Shipper ---
        box(M, y, shW, rowH);
        text("Shipper Address", "", M, y + 3.5, { size: 8, bold: true });
        let sy = y + 8.5;
        doc.setFont("helvetica", "normal").setFontSize(8);
        [
          SH.name,
          [SH.address1, SH.address2].filter(Boolean).join(" "),
          [SH.city, SH.state, SH.zip].filter(Boolean).join(", "),
          SH.country,
          SH.contact_name,
          SH.contact_phone,
          SH.contact_email,
        ].filter(Boolean).forEach((str) => { doc.text(String(str), M + 2, sy); sy += 3.8; });

        // --- Consignee ---
        const CP = primaryPO || {};
        box(coX, y, coW, rowH);
        text("Consignee Address", "", coX, y + 3.5, { size: 8, bold: true });
        let cy = y + 8.5;
        doc.setFont("helvetica", "normal").setFontSize(8);
        [
          CP.consignee_name,
          [CP.consignee_address1, CP.consignee_address2].filter(Boolean).join(" "),
          [CP.consignee_city, CP.consignee_state, CP.consignee_zip].filter(Boolean).join(", "),
          CP.consignee_country,
          CP.consignee_contact_name,
          CP.consignee_contact_phone,
          CP.consignee_contact_email,
        ].filter(Boolean).forEach((str) => { doc.text(String(str), coX + 2, cy); cy += 3.8; });

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
        const blockH = lines.length * LINE_H;
        const TOP_OFFSET = 0.4;
        let hy = TAB_Y + CELL_PAD_Y + TOP_OFFSET;            // ← Y inicial del header (ARRIBA)
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
      doc.setFont("helvetica", "normal").setFontSize(8.5);

      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        const rowH = uniformRowH;

        for (let i = 0; i < COLS.length; i++) {
          const c = COLS[i];
          const cx = COLX[i];
          const content = splitFit(doc, row[c.k], c.w, 8.5);

          const TOP_TEXT_PAD = 0.8;  // ↑ separa el texto de la línea superior (ajusta 0.6–1.0)
          let ty = ry + CELL_PAD_Y + TOP_TEXT_PAD;
          
          content.forEach(ln => {
            if (c.align === "right") {
              doc.text(ln, cx + c.w - CELL_PAD_X, ty, { align: "right" });
            } else {
              doc.text(ln, cx + CELL_PAD_X, ty);
            }
            ty += LINE_H;
          });
        }

        // ✅ Línea inferior del renglón: solo si NO es la última fila
        if (r < rows.length - 1) {
          doc.line(TAB_X, ry + rowH, TAB_X + TAB_W, ry + rowH);
        }

        ry += rowH;
      }
      
      // cursor global debajo de la tabla
      y = TAB_Y + TAB_H + gap + 8;

      // Totales
      doc.setFont("helvetica","bold").setFontSize(9);
      doc.text(`Total Shipment Weight: ${fmt(totalWeight)} LB`, M, y);
      doc.text(`Total Shipping Units: ${String(totalUnits)}`, M+108, y);
      y += 8;

      // =================== FIRMAS (Pickup / Dropoff) ===================
      {
        // Debe coincidir con tu bloque legal (abajo)
        const LEGAL_RESERVED = 30;   // alto del legal
        const GAP_BEFORE_LEGAL = 3;  // espacio entre firmas y legal

        const boxX = M;
        const boxW = TAB_W;
        const boxH = 18;             // alto por caja (compacto)
        const dividerH = 0.8;        // separador entre Pickup y Dropoff
        const PAD = 3;               // padding interno

        // Posición fija para que siempre quede encima del legal
        const pageHnow = doc.internal.pageSize.height;
        const totalSigH = (boxH * 2) + dividerH;
        const sigStartY = pageHnow - (LEGAL_RESERVED + GAP_BEFORE_LEGAL + totalSigH);

        // Helpers básicos
        const lbl = (txt, x, y, sz = 7.0, bold = false) => {
          doc.setFont("helvetica", bold ? "bold" : "normal");
          doc.setFontSize(sz);
          doc.text(String(txt), x, y);
        };

        // LÍMITE DERECHO del bloque de firmas (para evitar que algo se salga)
        const RIGHT_LIMIT_SIG = boxX + boxW - PAD - 1.5;

        // Línea segura (recorta si se acercara al borde)
        const safeUline = (x, y, w) => {
          if (w <= 0) return;
          const maxW = Math.max(0, RIGHT_LIMIT_SIG - x);
          doc.line(x, y, x + Math.min(w, maxW), y);
        };

        // Cajita AM/PM
        const checkbox = (x, y, s = 3.0) => {
          doc.rect(x, y - s + 0.6, s, s);
        };

        // Versión con ajuste vertical fino
        const checkboxAt = (x, y, s = 3.0, dy = 0) => {
          // dy negativo = sube el cuadrito | dy positivo = baja
          doc.rect(x, (y - s + 0.6) + dy, s, s);
        };

        // Layout 4 columnas (col4 es más ancha para AM/PM + Date)
        const innerX = boxX + PAD;
        const innerW = boxW - (PAD * 2);

        const col1W = innerW * 0.39; // Printed Name
        const col2W = innerW * 0.15; // Sign
        const col3W = innerW * 0.15; // In/Out Time
        const col4W = innerW * 0.31; // AM/PM + Date

        const col1X = innerX;
        const SHIFT234 = 2; 
        const COL4_SHIFT = 3; 
        const col2X = col1X + col1W + SHIFT234;
        const col3X = col2X + col2W;
        const col4X = col3X + col3W + COL4_SHIFT;

        // FIN SEGURO de cada columna (para que las líneas no traspasen)
        const COL_END1 = col1X + col1W - 2.5;
        const COL_END2 = col3X + 8;
        const COL_END3 = col3X + col3W - 1.5;
        const COL_END4 = col4X + col4W;

        // Dibuja una línea que “tope” al borde interno de la columna
        const lineToEnd = (startX, y, colEnd) => {
          const w = Math.max(8, colEnd - startX);
          safeUline(startX, y, w);
        };

        // Métricas verticales (compactas)
        const headerH  = 5.2;
        const rowGap   = 4.2;
        const lineYOff = 1.5;

        function drawSignatureBox(title, startY, who1Left, who1Mid, time1Label, who2Left, who2Mid, time2Label) {
          // Marco
          doc.rect(boxX, startY, boxW, boxH);

          // Título
          lbl(title, innerX, startY + 3.8, 9.5, true); 

          // Línea bajo título
          doc.setLineWidth(0.25);
          doc.line(boxX, startY + headerH, boxX + boxW, startY + headerH);

          // ----- Fila 1 -----
          const r1Y = startY + headerH + 4.2;

          // Col1: Printed Name
          lbl(`${who1Left}:`, col1X, r1Y);
          lineToEnd(col1X + 28, r1Y + lineYOff, COL_END1);

          // Col2: Sign
          lbl(`${who1Mid}:`, col2X, r1Y);
          lineToEnd(col2X + 16, r1Y + lineYOff, COL_END2);

          // Col3: In Time  (tope antes de col4)
          lbl(`${time1Label}:`, col3X + 10, r1Y);
          lineToEnd(col3X + 28, r1Y + lineYOff, Math.min(COL_END3, col4X - 4));

          // Col4 Fila 1: AM / PM (alineados y más a la derecha)
          {
            const amX = col4X + 6;   // mueve AM a la derecha
            const pmX = col4X + 16;  // PM queda a la MISMA X en ambas filas

            lbl('AM', amX, r1Y);
            checkbox(amX + 6.0, r1Y);

            lbl('PM', pmX, r1Y);
            checkbox(pmX + 6.0, r1Y);
          }

          // ----- Fila 2 -----
          const r2Y = r1Y + rowGap + 3.0;

          // Col1: Driver/Receiver Printed Name
          lbl(`${who2Left}:`, col1X, r2Y);
          lineToEnd(col1X + 28, r2Y + lineYOff -1.5, COL_END1);

          // Col2: Driver/Receiver Sign
          lbl(`${who2Mid}:`, col2X, r2Y);
          lineToEnd(col2X + 16, r2Y + lineYOff -1.5, COL_END2);

          // Col3: Out Time  (tope antes de col4)
          lbl(`${time2Label}:`, col3X + 10, r2Y);
          lineToEnd(col3X + 28, r2Y + lineYOff -1.5, Math.min(COL_END3, col4X - 4));

          // Col4: AM/PM + ÚNICA fecha del bloque (texto arriba, línea debajo)
          {
            const amX = col4X + 6;   // misma X que arriba
            const pmX = col4X + 16;  // misma X que arriba (PM alineado en ambas filas)

            lbl('AM', amX, r2Y);
            checkbox(amX + 6.0, r2Y, 3.0, -0.6);

            lbl('PM', pmX, r2Y);
            checkbox(pmX + 6.0, r2Y, 3.0, -0.6);
          }

          // Col4 Fila 2: ÚNICA fecha — mismo Y que PM, más a la derecha y línea al nivel de Out Time
          {
            const dateText     = 'Date (MM/DD/YYYY)';
            const dateTextSize = 6.2;
            doc.setFontSize(dateTextSize);

            // Usa la X de PM como base y empuja a la derecha
            const amX = col4X + 8;
            const pmX = amX + 18;
            const dateBaseX = pmX + 22;                  // más a la derecha; ajusta +/− si hace falta

            const tW = doc.getTextWidth(dateText);
            const tx = Math.max(col4X, Math.min(dateBaseX, COL_END4 - (tW + 12)));

            // Texto DATE a la MISMA ALTURA que PM
            const dateLabelY = r1Y;                      // mismo Y que 'PM'
            lbl(dateText, tx, dateLabelY, dateTextSize);

            // Línea DATE al MISMO Y que la línea de Out Time
            const lineX     = tx + 0.5;
            const lineW     = Math.min(20, COL_END4 - lineX);   // un poco más larga
            const dateLineY = r2Y + lineYOff - 1.5;             // igual que Out Time (usa -1.5)
            safeUline(lineX, dateLineY, lineW);
          }
          return startY + boxH;
        }

        // ==== PINTAR PICKUP ====
        let nextY = sigStartY;
        nextY = drawSignatureBox(
          "Pickup",
          nextY,
          "Shipper Printed Name",
          "Shipper Sign",
          "In Time",
          "Driver Printed Name",
          "Driver Sign",
          "Out Time"
        );

        // Separador entre bloques
        doc.line(boxX, nextY, boxX + boxW, nextY);

        // ==== PINTAR DROPOFF ====
        nextY = drawSignatureBox(
          "Dropoff",
          nextY,
          "Receiver Printed Name",
          "Receiver Sign",
          "In Time",
          "Driver Printed Name",
          "Driver Sign",
          "Out Time"
        );
      }

      // === LEGAL FOOTER ===
      {
        const legalText = `
        Received and mutually agreed by the shipper and his assigns and any additional party with an interest to any said property hereto and each carrier of all or any of said property over all or any portion of said route to destination, that every service to be performed hereunder shall be subject to the National Motor Freight classifications (NMF 100 Series) Including the Rules, packaging and the Uniform Bill of Lading Terms and Conditions, the applicable regulations of the US Department of Transportation (DOT), the ATA Hazardous Materials Rules Guide Book and the Household Goods Mileage Guides and to the Carriers tariffs, the Carriers pricing schedules, terms, conditions and rules maintained at Carriers general offices all of which are in effect as of the date of issue of this Bill of Lading. Shipper certifies that the consigned merchandise is properly weighed, classified, described, packaged, marked, labeled, destined as indicated, in apparent good order expect as noted (contents and conditions of contents of packages unknown), and in proper condition for transportation according to the DOT and the NMF 100 Series. Carrier (Carrier being understood throughout this contract as meaning in any person or corporation in possession of the property under this contact) agrees to carry to said destination if on its route, otherwise to deliver to another carrier on the route to said destination. Carrier shall in no event be liable for loss of profit, Income, Interest, attorney fees, or any special, incidental or consequential damages. Subject to section 7 of the conditions, if this shipment is to be delivered to the consignee without recourse on the consignor shall sign the following statement: The carrier shall not make the delivery of this shipment without payment of freight and all other lawful charges.`;

        // Configura fuente y color
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6);
        doc.setTextColor(150); // gris medio (puedes probar 180, 200, etc.)

        // Posición Y = parte baja del documento
        const footerY = doc.internal.pageSize.height - 30; // 18 mm desde el borde inferior
        const footerX = M;           // margen izquierdo ya definido arriba
        const footerW = TAB_W;       // ancho total de tabla principal

        // Justificar texto
        const lines = doc.splitTextToSize(legalText.trim(), footerW);
        let yLine = footerY;

        // Función para justificar manualmente
        lines.forEach((line, idx) => {
          const words = line.trim().split(/\s+/);
          const isLast = idx === lines.length - 1;

          if (isLast || words.length === 1) {
            // última línea (o una sola palabra): alineación normal
            doc.text(line, footerX, yLine);
          } else {
            // justificar: distribuimos espacios hasta cubrir el ancho
            const plain = line.replace(/\s+/g, " ");                 // texto con un solo espacio
            const currentWidth = doc.getTextWidth(plain);            // ancho actual
            const targetWidth  = footerW;

            // si la línea es muy corta, no conviene justificar (evita “huecos” enormes)
            if (currentWidth < targetWidth * 0.6) {
              doc.text(line, footerX, yLine);
            } else {
              const gaps = words.length - 1;
              const extra = (targetWidth - currentWidth) / gaps;     // espacio extra por gap
              let x = footerX;

              words.forEach((w, i) => {
                doc.text(w, x, yLine);
                if (i < words.length - 1) {
                  x += doc.getTextWidth(w + " ") + extra;            // palabra + un espacio + extra
                }
              });
            }
          }
          yLine += 3.6; // interlineado
        });

        doc.setTextColor(0); // vuelve a negro
      }  

      // ========= HOJA 2: COVER SHEET =========
      await drawCoverSheet(doc, {
        SH,
        PO: primaryPO,
        poNumbers,
        shipmentNo, trailerNo, packingSlip, dockNo, sealNo,
        bolDate,
        rows
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
          {/* IDX (searchable) */}
          <Select
            isClearable
            // por defecto react-select es searchable
            placeholder={t("select_idx", "Seleccionar IDX")}
            options={idxOptions
              .filter(v => /idx/i.test(String(v))) // redundante pero garantiza el filtro
              .map(v => ({ value: String(v), label: String(v) }))
            }
            value={selectedIdx ? { value: selectedIdx, label: selectedIdx } : null}
            onChange={(opt) => setSelectedIdx(opt?.value || "")}
            styles={{
              control: (base, state) => ({
                ...base,
                backgroundColor: "#333",
                borderColor: state.isFocused ? "#007BFF" : "#333",
                boxShadow: "none",
                color: "#fff",
                minHeight: "38px",
                fontSize: "14px",
                "&:hover": { borderColor: "#007BFF" },
              }),
              singleValue: (base) => ({ ...base, color: "#fff" }),
              input: (base) => ({ ...base, color: "#fff" }),
              placeholder: (base) => ({ ...base, color: "#bbb" }),
              menu: (base) => ({ ...base, backgroundColor: "#333", zIndex: 9999 }),
              option: (base, state) => ({
                ...base,
                backgroundColor: state.isSelected ? "#007BFF" : state.isFocused ? "#555" : "#333",
                color: "#fff",
                cursor: "pointer",
              }),
              dropdownIndicator: (base) => ({ ...base, color: "#fff", ":hover": { color: "#007BFF" } }),
              clearIndicator: (base) => ({ ...base, color: "#fff", ":hover": { color: "#ff5555" } }),
              valueContainer: (base) => ({ ...base, color: "#fff" }),
            }}
            // filtro adicional: solo deja pasar opciones que tengan "idx" y que hagan match con lo que escribes
            filterOption={(option, input) => {
              const label = option.label.toLowerCase();
              const typed = (input || "").toLowerCase();
              if (!label.includes("idx")) return false;         // exige que contenga “idx”
              if (!typed) return true;                          // sin texto, muestra todos los “idx”
              return label.includes(typed);                     // match por lo que escribas
            }}
          />

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
          
          {/* Dock Number */}
          <input placeholder={t("dock_number", "Dock Number")} value={dockNo} onChange={(e) => setDockNo(e.target.value)} />

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
