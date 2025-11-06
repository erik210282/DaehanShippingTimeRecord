import React from "react";
import { supabase } from "../supabase/client";
import { useTranslation } from "react-i18next";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { jsPDF } from "jspdf";
import "../App.css";
import Select from "react-select";

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
      const doc = new jsPDF({ unit: "mm", format: "letter" });

      // ---- Agrega logo Daehan (sin QR y sin el título grande del sample) ----
      try {
        const logo = await loadImg(DAEHAN_LOGO_SRC);
        // x, y, w, h (ajusta si quieres más grande/chico)
        doc.addImage(logo, "PNG", 12, 10, 26, 10);
      } catch (_) {
        // si no carga, seguimos sin logo
      }

      const text = (label, value, x, y, alignLeft = true, size = 10, bold = false) => {
        doc.setFontSize(size);
        doc.setFont("helvetica", bold ? "bold" : "normal");
        doc.text(`${label}${label ? ": " : ""}${(value ?? "").toString()}`, x, y, { align: alignLeft ? "left" : "right" });
      };

      const box = (x, y, w, h, lw = 0.2) => {
        doc.setLineWidth(lw);
        doc.rect(x, y, w, h);
      };

      const joinSp = (...arr) => arr.filter(Boolean).join(" ");

      /* -----------------------------------------------------
      * 1) PORTADA BOL (igual a tu ejemplo, sin QR y sin título SHP...)
      * ----------------------------------------------------- */

      // Encabezado principal “Bill of Lading”
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text("Bill of Lading", 105, 22, { align: "center" });

      // Cajitas superiores (Freight Class, Freight Charges, Carrier Name, Commercial Invoice)
      // (si no tienes estos campos en tu PO, queda en blanco)
      const freightClass   = primaryPO?.freight_class ?? "";
      const freightCharge  = primaryPO?.freight_charges ?? primaryPO?.freight_charge ?? "";
      const carrierName    = primaryPO?.carrier_name ?? "";
      const commercialInv  = primaryPO?.commercial_invoice ?? "";

      // 4 celdas en línea
      const topY = 28;
      const cw   = 48; // ancho de cada caja
      ["Freight Class", "Freight Charges", "Carrier Name", "Commercial Invoice"].forEach((lbl, i) => {
        const x = 12 + i * cw;
        box(x, topY, cw, 14);
        text(lbl, "", x + 2, topY + 5, true, 9, true);
        const val =
          i === 0 ? freightClass :
          i === 1 ? freightCharge :
          i === 2 ? carrierName : commercialInv;
        text("", val, x + 2, topY + 11, true, 10, false);
      });

      // Segunda fila de datos clave (BOL Date, Bill Charges To, Secondary Carrier Name)
      const bolDate = new Date().toLocaleDateString();
      // “Bill Charges To” lo mapeamos desde el primaryPO si existe; si no, vacío
      const billToName = primaryPO?.bill_to_name ?? "";
      const billToAddr = joinSp(primaryPO?.bill_to_address1, primaryPO?.bill_to_address2);
      const billToCity = joinSp(primaryPO?.bill_to_city, primaryPO?.bill_to_state, primaryPO?.bill_to_zip);
      const billToCountry = primaryPO?.bill_to_country ?? "";

      // BOL Date
      box(12, 46, 48, 14);
      text("BOL Date", "", 14, 51, true, 9, true);
      text("", bolDate, 14, 58, true, 10);

      // Bill Charges To (caja más grande a la derecha)
      box(62, 46, 98, 28);
      text("Bill Charges To", "", 64, 51, true, 9, true);
      const bcY = 56;
      text("", billToName, 64, bcY, true, 10);
      text("", billToAddr, 64, bcY + 5, true, 10);
      text("", billToCity, 64, bcY + 10, true, 10);
      text("", billToCountry, 64, bcY + 15, true, 10);

      // Secondary Carrier Name
      box(162, 46, 26, 14);
      text("Secondary Carrier", "", 164, 51, true, 9, true);
      text("", primaryPO?.secondary_carrier_name ?? "", 164, 58, true, 10);

      // Línea: Container, Seal, Shipment Number, Booking/Tracking
      const contY = 76;
      const fieldH = 14;
      const colW = 48;

      // Container Number
      box(12, contY, colW, fieldH);
      text("Container Number", "", 14, contY + 5, true, 9, true);
      text("", trailerNo || primaryPO?.trailer_number || "", 14, contY + 11, true, 10);

      // Seal Number
      box(12 + colW, contY, colW, fieldH);
      text("Seal Number", "", 14 + colW, contY + 5, true, 9, true);
      text("", sealNo || primaryPO?.seal_number || "", 14 + colW, contY + 11, true, 10);

      // Shipment Number
      box(12 + colW * 2, contY, colW, fieldH);
      text("Shipment Number", "", 14 + colW * 2, contY + 5, true, 9, true);
      text("", shipmentNo || primaryPO?.shipment_number || "", 14 + colW * 2, contY + 11, true, 10);

      // Booking/Tracking Number
      box(12 + colW * 3, contY, colW + 14, fieldH);
      text("Booking/Tracking Number", "", 14 + colW * 3, contY + 5, true, 9, true);
      text("", primaryPO?.booking_number ?? primaryPO?.tracking_number ?? "", 14 + colW * 3, contY + 11, true, 10);

      // PO#
      box(12, contY + fieldH + 4, 60, fieldH);
      text("Po#", "", 14, contY + fieldH + 9, true, 9, true);
      // Multi-PO soportado
      const poText = formatPO(poNumbers);
      const poLines = poText.split("\n");
      text("", poLines[0] ?? "", 14, contY + fieldH + 15, true, 10);
      if (poLines[1]) text("", poLines[1], 14, contY + fieldH + 20, true, 10);

      // Shipper Address (de tu catálogo)
      box(74, contY + fieldH + 4, 114, fieldH + 10);
      text("Shipper Address", "", 76, contY + fieldH + 9, true, 9, true);
      let saY = contY + fieldH + 14;
      const shipperName = shipper?.shipper_name ?? shipper?.shipper ?? "";
      const saddr1 = shipper?.address1 ?? "";
      const saddr2 = shipper?.address2 ?? "";
      const scity  = joinSp(shipper?.city, shipper?.state, shipper?.zip);
      const scountry = shipper?.country ?? "";
      text("", shipperName, 76, saY, true, 10); saY += 5;
      text("", joinSp(saddr1, saddr2), 76, saY, true, 10); saY += 5;
      text("", scity, 76, saY, true, 10); saY += 5;
      text("", scountry, 76, saY, true, 10);

      // Consignee Address (del PO)
      const consTop = contY + fieldH + 4 + fieldH + 12;
      box(12, consTop, 176, 28);
      text("Consignee Address", "", 14, consTop + 5, true, 9, true);
      let caY = consTop + 10;
      const consigneeLine1 = primaryPO?.consignee_name ?? "";
      const consigneeAddr  = joinSp(primaryPO?.consignee_address1, primaryPO?.consignee_address2);
      const consigneeCSZ   = joinSp(primaryPO?.consignee_city, primaryPO?.consignee_state, primaryPO?.consignee_zip);
      const consigneeCountry = primaryPO?.consignee_country ?? "";
      text("", consigneeLine1, 14, caY, true, 10); caY += 5;
      text("", consigneeAddr, 14, caY, true, 10); caY += 5;
      text("", consigneeCSZ, 14, caY, true, 10); caY += 5;
      text("", consigneeCountry, 14, caY, true, 10);

      /* -----------------------------------------------------
      * 2) Packaging & Dimension TABLE (layout como el sample)
      * ----------------------------------------------------- */

      // Unifica cajas por producto desde lineasIdx
      const porProducto = {};
      (lineasIdx || []).forEach((it) => {
        const pid = it?.producto_id;
        if (pid == null) return;
        const qty = Number(it?.cantidad ?? 0); // "cajas" por producto
        porProducto[pid] = (porProducto[pid] || 0) + (isNaN(qty) ? 0 : qty);
      });

      // Columnas
      const tabY0 = consTop + 30 + 6;
      const tabH  = 110;
      box(12, tabY0, 176, tabH);

      const headers = [
        { label: "Package Quantity", w: 20, key: "pkgQty" },
        { label: "Package Type",    w: 24, key: "pkgType" },
        { label: "Description",     w: 55, key: "desc" },
        { label: "Dimension Per Package", w: 35, key: "dim" },
        { label: "Weight Per Package",    w: 24, key: "wPer", align: "right" },
        { label: "Total Weight",          w: 14, key: "wTot", align: "right" },
        { label: "Weight UoM",            w: 4,  key: "uom" },
      ];

      // Encabezados
      let colX = 12;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      headers.forEach((c) => {
        doc.text(c.label, colX + 2, tabY0 + 5);
        colX += c.w;
        // separadores verticales
        doc.line(colX, tabY0, colX, tabY0 + tabH);
      });
      // separador horizontal bajo headers
      doc.line(12, tabY0 + 7, 188, tabY0 + 7);

      // Construye filas y totales
      let y = tabY0 + 13;
      let totalUnits = 0;     // total shipping units (cajas)
      let totalWeight = 0;    // total peso (LB)

      Object.keys(porProducto).forEach((pid) => {
        const prod = productosById[pid] || {};
        const boxes = Number(porProducto[pid] ?? 0) || 0;
        if (boxes <= 0) return;

        // piezas/caja según packType
        const unitsPerBox =
          packType === "returnable"
            ? Number(prod?.cantidad_por_caja_retornable ?? prod?.cant_por_caja_retornable ?? 1)
            : Number(prod?.cantidad_por_caja_expendable ?? prod?.cant_por_caja_expendable ?? 1);

        // peso por pieza (LB)
        const weightPerUnit = Number(prod?.peso_por_pieza ?? prod?.peso_unitario ?? 0);

        // peso caja (LB)
        const boxWeight =
          packType === "returnable"
            ? Number(prod?.peso_caja_retornable ?? prod?.peso_por_caja_retornable ?? 0)
            : Number(prod?.peso_caja_expendable ?? prod?.peso_por_caja_expendable ?? 0);

        // dimensiones por paquete (IN); toma campos típicos
        const L = prod?.dim_l ?? prod?.largo ?? prod?.length_in ?? prod?.length ?? "";
        const W = prod?.dim_w ?? prod?.ancho ?? prod?.width_in ?? prod?.width ?? "";
        const H = prod?.dim_h ?? prod?.alto  ?? prod?.height_in ?? prod?.height ?? "";
        const dimText = (L && W && H) ? `${L} X ${W} X ${H} IN` : "";

        // descripción
        const desc = (prod?.nombre ?? prod?.descripcion ?? prod?.desc ?? "").toString();

        // tipo empaque
        const packTxt = packType === "returnable" ? "Box" : "Box"; // el sample muestra “Box”; si quieres mostrar Returnable/Expendable, cambia aquí

        // PESOS (LB): por paquete y total
        const piecesPerBox  = isNaN(unitsPerBox) ? 1 : unitsPerBox;
        const weightPerPack = (piecesPerBox * (isNaN(weightPerUnit) ? 0 : weightPerUnit)) + (isNaN(boxWeight) ? 0 : boxWeight);
        const lineTotal     = weightPerPack * boxes;

        totalUnits  += boxes;
        totalWeight += lineTotal;

        // Render fila
        let cx = 12;
        const row = {
          pkgQty: String(boxes),
          pkgType: packTxt,
          desc: desc,
          dim: dimText,
          wPer: weightPerPack.toFixed(2),
          wTot: lineTotal.toFixed(2),
          uom: "LB",
        };

        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        headers.forEach((c) => {
          const val = (row[c.key] ?? "").toString();
          if (c.align === "right") {
            doc.text(val, cx + c.w - 1, y, { align: "right" });
          } else {
            doc.text(val, cx + 2, y);
          }
          cx += c.w;
        });

        y += 6;
        if (y > tabY0 + tabH - 8) {
          // página nueva si se llena
          doc.addPage();
          y = 20;
        }
      });

      // Totales bajo la tabla (como en el sample)
      const totY = tabY0 + tabH + 6;
      text("Total Shipment Weight", `${totalWeight.toFixed(2)} LB`, 12, totY, true, 10, true);
      text("Total Shipping Units", `${totalUnits}`, 120, totY, true, 10, true);

      // Bloques de firma Pickup/Dropoff (simples, sin QR)
      const signY = totY + 10;
      box(12, signY, 84, 38);
      text("Pickup", "", 14, signY + 6, true, 10, true);
      text("Shipper Printed Name", "", 14, signY + 14, true, 9);
      text("Sign", "", 14, signY + 20, true, 9);
      text("In Time", "", 14, signY + 26, true, 9);
      text("Date (MM/DD/YYYY)", "", 14, signY + 32, true, 9);

      box(104, signY, 84, 38);
      text("Drop off", "", 106, signY + 6, true, 10, true);
      text("Receiver Printed Name", "", 106, signY + 14, true, 9);
      text("Sign", "", 106, signY + 20, true, 9);
      text("In Time", "", 106, signY + 26, true, 9);
      text("Date (MM/DD/YYYY)", "", 106, signY + 32, true, 9);

      // Pie de página legal (resumen)
      const footY = signY + 44;
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "normal");
      const legal =
        "Received and mutually agreed... (Uniform Bill of Lading terms and conditions). Carrier not liable for incidental or consequential damages.";
      doc.text(legal, 12, footY, { maxWidth: 176 });

      /* -----------------------------------------------------
      * 3) COVER SHEET (misma estética del sample, sin QR ni título SHP…)
      * ----------------------------------------------------- */
      doc.addPage();

      try {
        const logo = await loadImg(DAEHAN_LOGO_SRC);
        doc.addImage(logo, "PNG", 12, 10, 26, 10);
      } catch (_) {}

      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text("Cover Sheet", 105, 22, { align: "center" });

      // Address grande a la izquierda (del Consignee)
      const addressTitleY = 32;
      text("NA-US-CA-Lathrop-701 D'Arcy Pkwy", "", 12, addressTitleY, true, 11, true);
      text("", primaryPO?.consignee_name ?? "", 12, addressTitleY + 6, true, 10);
      text("", joinSp(primaryPO?.consignee_address1, primaryPO?.consignee_address2), 12, addressTitleY + 12, true, 10);
      text("", joinSp(primaryPO?.consignee_city, primaryPO?.consignee_state, primaryPO?.consignee_zip), 12, addressTitleY + 18, true, 10);
      text("", primaryPO?.consignee_country ?? "", 12, addressTitleY + 24, true, 10);

      // Grid de campos a la derecha/abajo (Ship Date, Shipment Number, Packing Slip Number, Trailer Number)
      const gridY = 32;
      const gridX = 110;
      const rowH = 12;
      const colWLeft = 40;
      const colWRight = 48;

      const shipDate = primaryPO?.ship_date
        ? new Date(primaryPO.ship_date).toLocaleString()
        : new Date().toLocaleString();

      const rows = [
        ["Ship Date", shipDate],
        ["Shipment Number", shipmentNo || primaryPO?.shipment_number || ""],
        ["Packing Slip Number", packingSlip || primaryPO?.packing_slip_number || ""],
        ["Trailer Number", trailerNo || primaryPO?.trailer_number || ""],
        ["Carrier", primaryPO?.carrier_name ?? ""],
      ];

      rows.forEach((r, idx) => {
        const y0 = gridY + idx * rowH;
        box(gridX, y0, colWLeft, rowH);
        box(gridX + colWLeft, y0, colWRight, rowH);
        text(r[0], "", gridX + 2, y0 + 8, true, 10, true);
        text("", r[1], gridX + colWLeft + 2, y0 + 8, true, 10, false);
      });

      // Mini tabla Part/Supplier (si quieres mostrar PN/proveedor)
      const miniY = gridY + rows.length * rowH + 10;
      const miniCols = [
        ["Part Number", primaryPO?.part_number ?? ""],
        ["Supplier", shipper?.shipper_name ?? shipper?.shipper ?? ""],
        ["SHP Number", shipmentNo || primaryPO?.shipment_number || ""],
        ["Trailer Number", trailerNo || primaryPO?.trailer_number || ""],
      ];
      miniCols.forEach((r, idx) => {
        const y0 = miniY + idx * rowH;
        box(12, y0, 40, rowH);
        box(52, y0, 136, rowH);
        text(r[0], "", 14, y0 + 8, true, 10, true);
        text("", r[1], 54, y0 + 8, true, 10, false);
      });

      // Nombre archivo y guardar
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
