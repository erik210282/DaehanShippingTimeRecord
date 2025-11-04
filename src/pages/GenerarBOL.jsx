import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase/client"; // ajusta si tu client vive en otra ruta
import { useTranslation } from "react-i18next";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { PDFDownloadLink, pdf } from "@react-pdf/renderer"; // <- pdf() para blob
import BOLAndCoverPdf from "./BOLPdf";

export default function GenerarBOL() {
  const { t } = useTranslation();

  const [idxList, setIdxList] = useState([]);
  const [pos, setPos] = useState([]);
  const [shippers, setShippers] = useState([]);

  const [form, setForm] = useState({
    idx: "",
    shipment_number: "",
    trailer_number: "",
    seal_number: "",
    po: "",
    packaging_tipo: "expendable",
    packing_slip_number: "",
    shipper_id: null
  });

  const [preview, setPreview] = useState(null);
  const [loadingPrev, setLoadingPrev] = useState(false);
  const [loadingPO, setLoadingPO] = useState(false);
  const [missingPNs, setMissingPNs] = useState([]); // part numbers faltantes

  useEffect(() => {
    (async () => {
      const [{ data: idxs }, { data: posData }, { data: shipData }] = await Promise.all([
        supabase.from("idx_listos_para_bol").select("*"),
        supabase.from("catalogo_pos").select("*").eq("activo", true),
        supabase.from("catalogo_origenes").select("*").eq("activo", true).order("is_default", { ascending: false })
      ]);
      setIdxList(idxs || []);
      setPos(posData || []);
      setShippers(shipData || []);
      // Preselecciona shipper default
      const def = (shipData || []).find(s => s.is_default);
      if (def) setForm(f => ({ ...f, shipper_id: def.id }));
    })();
  }, []);

  const poRow = useMemo(() => pos.find((p) => p.po === form.po) || null, [pos, form.po]);
  const shipperRow = useMemo(() => shippers.find(s => s.id === form.shipper_id) || null, [shippers, form.shipper_id]);

  useEffect(() => {
    (async () => {
      if (!form.idx || !form.po) { setPreview(null); setMissingPNs([]); return; }
      setLoadingPrev(true);
      try {
        const result = await buildPreview({ idx: form.idx, po: form.po, packaging_tipo: form.packaging_tipo, shipperRow });
        setPreview(result.data);
        setMissingPNs(result.missingPNs || []);
        if (result.missingPNs?.length) {
          toast.warn(`${t("missing_parts_title")}: ${result.missingPNs.join(", ")}`);
        }
      } catch (e) {
        console.error(e);
        toast.error(t("error_loading"));
        setPreview(null);
        setMissingPNs([]);
      } finally {
        setLoadingPrev(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.idx, form.po, form.packaging_tipo, form.shipper_id]);

  const onSaveHeader = async () => {
    if (!form.idx || !form.shipment_number || !form.trailer_number || !form.po || !form.shipper_id) {
      toast.error(t("fill_all_fields"));
      return null;
    }
    const { data, error } = await supabase
      .from("bol_headers")
      .insert({
        idx: form.idx,
        shipment_number: form.shipment_number,
        trailer_number: form.trailer_number,
        seal_number: form.seal_number || null,
        po: form.po,
        packaging_tipo: form.packaging_tipo,
        ship_date: new Date().toISOString().slice(0, 10),
        packing_slip_number: form.packing_slip_number || null,
        carrier_name: poRow?.carrier_name || null,
        shipper_id: form.shipper_id
      })
      .select()
      .single();
    if (error) {
      toast.error(error.message);
      return null;
    }
    toast.success(t("save_success"));
    return data; // header row
  };

  // PO recomendado
  const useRecommendedPO = async () => {
    if (!form.idx) return;
    setLoadingPO(true);
    try {
      const rec = await sugerirPO(form.idx);
      if (!rec) toast.info(t("no_po_found_for_idx"));
      else {
        setForm((f) => ({ ...f, po: rec }));
        toast.success(t("po_applied"));
      }
    } catch (e) {
      console.error(e);
      toast.error(t("error_loading"));
    } finally {
      setLoadingPO(false);
    }
  };

  // Genera el PDF y lo sube a Storage; guarda pdf_url en bol_headers
  const generateAndUpload = async () => {
    // 1) Asegura header en DB
    const header = await onSaveHeader();
    if (!header) return;

    // 2) Render a Blob
    const docData = {
      ...preview,
      trailer_number: form.trailer_number,
      seal_number: form.seal_number,
      shipment_number: form.shipment_number,
      packing_slip_number: form.packing_slip_number
    };
    const blob = await pdf(<BOLAndCoverPdf data={docData} />).toBlob();

    // 3) Subir a Storage
    const filename = `BOL_${form.idx}_${form.shipment_number}_${Date.now()}.pdf`;
    const path = `${form.idx}/${filename}`;

    const { data: up, error: upErr } = await supabase
      .storage
      .from("bol")
      .upload(path, blob, { contentType: "application/pdf", upsert: false });

    if (upErr) {
      console.error(upErr);
      toast.error(upErr.message?.includes("not found") ? t("bucket_missing") : t("storage_error"));
      return;
    }

    // 4) Obtener public URL y actualizar header
    const { data: pub } = supabase.storage.from("bol").getPublicUrl(up?.path);
    const pdf_url = pub?.publicUrl || null;

    const { error: updErr } = await supabase
      .from("bol_headers")
      .update({ pdf_url })
      .eq("id", header.id);

    if (updErr) {
      console.error(updErr);
      toast.error(t("storage_error"));
      return;
    }

    toast.success(t("pdf_saved"));
  };

  return (
    <div className="page-container page-container--fluid">
      <div className="card">
        <h2>{t("generate_bol")}</h2>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
          {/* IDX */}
          <select value={form.idx} onChange={(e) => setForm({ ...form, idx: e.target.value })} aria-label={t("idx")}>
            <option value="">{t("select")} {t("idx")}</option>
            {idxList?.map((r, i) => <option key={i} value={r.idx}>{r.idx}</option>)}
          </select>

          {/* Shipper */}
          <select
            value={form.shipper_id || ""}
            onChange={(e)=>setForm({...form, shipper_id: Number(e.target.value || 0) || null})}
            aria-label={t("select_shipper")}
          >
            <option value="">{t("select_shipper")}</option>
            {shippers?.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>

          {/* Shipment/Trailer/Seal/Packing Slip */}
          <input type="text" placeholder={t("shipment_number")} value={form.shipment_number} onChange={(e)=>setForm({...form, shipment_number:e.target.value})}/>
          <input type="text" placeholder={t("trailer_number")} value={form.trailer_number} onChange={(e)=>setForm({...form, trailer_number:e.target.value})}/>
          <input type="text" placeholder={t("seal_number")} value={form.seal_number} onChange={(e)=>setForm({...form, seal_number:e.target.value})}/>
          <input type="text" placeholder={t("packing_slip_number")} value={form.packing_slip_number} onChange={(e)=>setForm({...form, packing_slip_number:e.target.value})}/>

          {/* PO + recomendado */}
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <select value={form.po} onChange={(e)=>setForm({...form, po:e.target.value})} aria-label={t("select_po")}>
              <option value="">{t("select_po")}</option>
              {pos?.map(p => <option key={p.id} value={p.po}>{p.po} — {p.consignee_name || "-"}</option>)}
            </select>
            <button className="secondary" onClick={useRecommendedPO} disabled={!form.idx || loadingPO} title={t("use_recommended_po")}>
              {loadingPO ? (t("loading") + "...") : t("use_recommended_po")}
            </button>
          </div>

          {/* Packaging tipo */}
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span>{t("packaging_type")}:</span>
            <label><input type="radio" name="pack" checked={form.packaging_tipo==="expendable"} onChange={()=>setForm({...form, packaging_tipo:"expendable"})}/> {t("expendable")}</label>
            <label><input type="radio" name="pack" checked={form.packaging_tipo==="retornable"} onChange={()=>setForm({...form, packaging_tipo:"retornable"})}/> {t("returnable")}</label>
          </div>
        </div>

        {/* Vista previa */}
        <div className="card" style={{ marginTop: 12 }}>
          <h3>{t("preview")}</h3>
          {!form.idx || !form.po ? (
            <p>{t("select")} {t("idx")} & PO</p>
          ) : loadingPrev ? (
            <p>{t("loading")}…</p>
          ) : preview ? (
            <>
              <div style={{ display:"flex", flexWrap:"wrap", gap:"1rem" }}>
                <div>
                  <h4>{t("shipper")}</h4>
                  <div>{preview.shipper?.name}</div>
                  <div>{preview.shipper?.address1}</div>
                  <div>{preview.shipper?.city}, {preview.shipper?.state} {preview.shipper?.zip}, {preview.shipper?.country}</div>
                </div>
                <div>
                  <h4>{t("consignee")}</h4>
                  <div>{preview.consignee?.name || "-"}</div>
                  <div>{preview.consignee?.address1}{preview.consignee?.address2 ? `, ${preview.consignee.address2}` : ""}</div>
                  <div>{preview.consignee?.city}, {preview.consignee?.state} {preview.consignee?.zip}, {preview.consignee?.country}</div>
                </div>
                <div>
                  <h4>{t("freight")}</h4>
                  <div>{t("freight_class")}: {preview.freight_class || "-"}</div>
                  <div>{t("freight_charges")}: {preview.freight_charges || "-"}</div>
                  <div>{t("carrier")}: {preview.carrier_name || "-"}</div>
                  <div>{t("booking_tracking")}: {preview.booking_tracking || "-"}</div>
                </div>
              </div>

              {/* Warning por PNs faltantes */}
              {!!missingPNs.length && (
                <div className="card" style={{ marginTop: 10, background:"#fff6e6" }}>
                  <strong>{t("missing_parts_title")}:</strong> {missingPNs.join(", ")}<br/>
                  <small>{t("missing_parts_hint")}</small>
                </div>
              )}

              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t("qty")}</th>
                      <th>{t("type")}</th>
                      <th>{t("description")}</th>
                      <th>{t("dimension")}</th>
                      <th>{t("weight_per_package")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.paquetes?.map((p, i) => (
                      <tr key={i}>
                        <td>{p.package_quantity}</td>
                        <td>{p.package_type}</td>
                        <td>{p.description}</td>
                        <td>{p.dimension || "-"}</td>
                        <td>{p.weight_per_package?.toFixed?.(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 8 }}>
                <strong>{t("total_shipment_weight")}:</strong> {preview.totalWeight} LB &nbsp;|&nbsp;
                <strong>{t("total_shipping_units")}:</strong> {preview.totalUnits}
              </div>

              <div style={{ display:"flex", gap:8, marginTop:16, flexWrap:"wrap" }}>
                {/* Descarga local (opcional) */}
                <PDFDownloadLink
                  document={<BOLAndCoverPdf data={{
                    ...preview,
                    trailer_number: form.trailer_number,
                    seal_number: form.seal_number,
                    shipment_number: form.shipment_number,
                    packing_slip_number: form.packing_slip_number
                  }}/>}
                  fileName={`BOL_Cover_${form.idx}_${form.shipment_number || "pending"}.pdf`}
                >
                  {({ loading }) => (
                    <button disabled={loading}>
                      {loading ? t("loading") + "..." : t("download_bol")}
                    </button>
                  )}
                </PDFDownloadLink>

                {/* Generar + subir + guardar url */}
                <button className="primary" onClick={generateAndUpload}>
                  {t("generate_and_save_pdf")}
                </button>
              </div>
            </>
          ) : (
            <p>{t("no_results_found")}</p>
          )}
        </div>

        <ToastContainer position="top-center" autoClose={1500} />
      </div>
    </div>
  );
}

/** Sugerir PO priorizando: último BOL del IDX > actividades_realizadas (po/meta.po) */
async function sugerirPO(idx) {
  const { data: bolPrev } = await supabase
    .from("bol_headers")
    .select("po, created_at")
    .eq("idx", idx)
    .order("created_at", { ascending: false })
    .limit(1);
  if (bolPrev?.length && bolPrev[0]?.po) return bolPrev[0].po;

  const { data: acts } = await supabase
    .from("actividades_realizadas")
    .select("po, meta, createdAt")
    .eq("idx", idx)
    .order("createdAt", { ascending: false });
  const poDeActs = (acts || [])
    .map(a => a?.po || a?.meta?.po || a?.meta?.PO || a?.meta?.orden_compra || null)
    .find(Boolean);
  if (poDeActs) return poDeActs;

  return null;
}

/** Construye preview desde LOAD finalizado; valida PNs contra catalogo_productos; inyecta shipper de catálogo */
async function buildPreview({ idx, po, packaging_tipo, shipperRow }) {
  // 1) Actividades del IDX
  const { data: acts } = await supabase.from("actividades_realizadas").select("*").eq("idx", idx);
  const loadLines = (acts || []).filter(a => String(a?.actividad).toLowerCase().includes("load") && String(a?.estado).toLowerCase() === "finalizada");

  const qtyByProductId = {};
  loadLines.forEach(a => {
    const arr = Array.isArray(a.productos) ? a.productos : (a.producto ? [{ producto:a.producto, cantidad:a.cantidad }] : []);
    arr.forEach(p => {
      if (!p?.producto || !p?.cantidad) return;
      qtyByProductId[p.producto] = (qtyByProductId[p.producto] || 0) + Number(p.cantidad || 0);
    });
  });
  const productoIds = Object.keys(qtyByProductId);
  if (!productoIds.length) return { data: null, missingPNs: [] };

  // 2) Productos -> part_number
  const { data: productos } = await supabase.from("productos").select("id, nombre, part_number");
  const byId = {}; (productos || []).forEach(p => byId[p.id] = p);
  const partNumbers = productoIds.map(id => byId[id]?.part_number).filter(Boolean);

  // 3) Catálogo maestro por PN
  const { data: cat } = await supabase.from("catalogo_productos").select("*").in("part_number", partNumbers);
  const foundPNs = new Set((cat || []).map(c => c.part_number));
  const missingPNs = partNumbers.filter(pn => !foundPNs.has(pn));

  // 4) PO (consignee/freight/carrier)
  const { data: poRow } = await supabase.from("catalogo_pos").select("*").eq("po", po).single();

  // 5) Paquetes y pesos
  const paquetes = [];
  for (const prodId of productoIds) {
    const qty = qtyByProductId[prodId];
    const meta = byId[prodId] || {};
    const pn = meta.part_number;

    const catRow = (cat || []).find(c => c.part_number === pn);
    const isRet = packaging_tipo === "retornable";
    const piezasPorCaja = isRet ? (catRow?.cantidad_por_caja_retornable || 0) : (catRow?.cantidad_por_caja_expendable || 0);
    const pesoCaja = isRet ? Number(catRow?.peso_caja_retornable || 0) : Number(catRow?.peso_caja_expendable || 0);
    const tipoCaja = isRet ? (catRow?.tipo_empaque_retornable || "Returnable") : (catRow?.tipo_empaque_expendable || "Expendable");
    const pesoPorPieza = Number(catRow?.peso_por_pieza || 0);

    const cajas = Math.max(1, Math.ceil(qty / Math.max(1, piezasPorCaja || 1)));
    const piezasUltima = qty - (cajas - 1) * (piezasPorCaja || qty);

    for (let i = 0; i < cajas; i++) {
      const piezasEnEsta = (i === cajas - 1) ? piezasUltima : (piezasPorCaja || piezasUltima);
      const pesoContenido = piezasEnEsta * pesoPorPieza;
      const pesoTotalCaja = pesoContenido + pesoCaja;

      paquetes.push({
        package_quantity: 1,
        package_type: "Box",
        description: catRow?.descripcion || meta.nombre || pn || "Item",
        dimension: null,
        weight_per_package: Number((Number.isFinite(pesoTotalCaja) ? pesoTotalCaja : 0).toFixed(3)),
        part_number: pn || "-",
        piezas: piezasEnEsta,
        tipo_caja: tipoCaja
      });
    }
  }

  const totalWeight = paquetes.reduce((acc, r) => acc + (Number(r.weight_per_package) || 0), 0);
  const totalUnits  = paquetes.reduce((acc, r) => acc + (Number(r.package_quantity) || 0), 0);

  // 6) Shipper desde catálogo (fallback al fijo si no hay)
  const shipper = shipperRow ? {
    name: shipperRow.nombre,
    address1: shipperRow.address1,
    city: shipperRow.city, state: shipperRow.state, zip: shipperRow.zip, country: shipperRow.country,
    contact_name: shipperRow.contact_name,
    emails: [shipperRow.contact_email].filter(Boolean),
    phone: shipperRow.contact_phone
  } : {
    name: "Daehan Nevada",
    address1: "1600 E Newlands Rd",
    city: "Fernley", state: "Nevada", zip: "89408", country: "United States of America",
    contact_name: "Kyun Young Park, BK",
    emails: ["ihjeon@dhsc.co.kr"],
    phone: "334-399-3491"
  };

  const consignee = {
    name: poRow?.consignee_name,
    address1: poRow?.consignee_address1,
    address2: poRow?.consignee_address2,
    city: poRow?.consignee_city,
    state: poRow?.consignee_state,
    zip: poRow?.consignee_zip,
    country: poRow?.consignee_country,
    contact_name: poRow?.contact_name,
    email: poRow?.contact_email,
    phone: poRow?.contact_phone
  };

  return {
    data: {
      idx, po: poRow?.po,
      freight_class: poRow?.freight_class,
      freight_charges: poRow?.freight_charges,
      carrier_name: poRow?.carrier_name,
      booking_tracking: poRow?.booking_tracking,
      shipper, consignee,
      paquetes,
      totalWeight: Number(totalWeight.toFixed(2)),
      totalUnits
    },
    missingPNs
  };
}
