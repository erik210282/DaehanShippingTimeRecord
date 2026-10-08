import './Catalogos.css';
import { catalogIdentifier, duplicateCatalogRow, hasDuplicateIdentifier } from '../catalog/duplication';
import ProductionCatalog from '../components/ProductionCatalog';
import { usePageSection } from '../usePageSection';
import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabase/client";
import Modal from "react-modal";
import Papa from "papaparse";
import { useTranslation } from "react-i18next";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import "../App.css";
import {
  DSInput,
  BtnPrimary,
  BtnSecondary,
  BtnEditDark,
  BtnDanger,
  TablePagination,
} from "../components/controls";

import { subscribeUpdates, catalogTables } from '../realtime';
import { catalogKinds, catalogDefaults, addressFields, SharedCatalogFields, CatalogSelect, materialLabel, CatalogInput, ProductCatalogFields, supplierAddress } from '../components/SharedCatalogFields';
import { unwrap, quantity } from '../receiving/api';
import { registerReceiving, receivingError } from '../receiving/translations';
import i18n from '../i18n/i18n';
registerReceiving(i18n);
// === Helpers email/phone ===
const onlyDigits = (v) => (v ?? "").replace(/\D+/g, "");
const formatPhoneUS = (v) => {
  const d = onlyDigits(v).slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0,3)}-${d.slice(3)}`;
  return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
};

const parseEmails = (v) => {
  const parts = String(v ?? "")
    .split(/[,\s;]+/)            // separa por coma, espacio o ;
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  // desduplicar y validación básica
  const seen = new Set();
  const basic = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return parts.filter(x => {
    if (!basic.test(x)) return false;
    if (seen.has(x)) return false;
    seen.add(x);
    return true;
  });
};

const emailsToInput = (val) =>
  Array.isArray(val) ? val.join(", ") : (val ?? "");

Modal.setAppElement("#root");

export default function Catalogos({ access }) {
  const { t } = useTranslation();

  const [tab, setTab] = usePageSection('catalog', 'productos', ['productos', ...Object.keys(catalogKinds), 'pos', 'shipper', 'actividades', 'bom', 'stations']);
  const [snapshot, setSnapshot] = useState({ tab: null, rows: [] });
  const rows = snapshot.tab === tab ? snapshot.rows : [];
  const request = useRef(0), currentTab = useRef(tab);
  currentTab.current = tab;
  const setRows = next => setSnapshot({ tab, rows: next });
  const [locations,setLocations]=useState([]),[materials,setMaterials]=useState([]),[suppliers,setSuppliers]=useState([]);
  const [typeFilter,setTypeFilter]=useState(''),[hideInactive,setHideInactive]=useState(true);
  const canManage=access?.admin || access?.memberships?.some(m=>['supervisor','lider'].includes(m.role));
  const kind=catalogKinds[tab];
  const [filter, setFilter] = useState("");
  const [edit, setEdit] = useState(null);
  const [isNew, setIsNew] = useState(false);
  const [saving,setSaving]=useState(false),[duplicating,setDuplicating]=useState(false);
  const [loading, setLoading] = useState(false);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const isSimple = useMemo(() => tab === "actividades" || tab === "operadores", [tab]);
  const tableName = useMemo(() => {
    if (tab === "productos") return "productos";
    if (tab === "pos") return "catalogo_pos";
    if (tab === "shipper") return "catalogo_shipper";
    return tab;
  }, [tab]);

  const productDefaults = {
    nombre: "",
    part_number: "",
    descripcion: "",
    peso_por_pieza: "",
    bin_type: "",
    tipo_empaque_retornable: "",
    tipo_empaque_expendable: "",
    peso_caja_retornable: "",
    peso_caja_expendable: "",
    cantidad_por_caja_retornable: "",
    cantidad_por_caja_expendable: "",
    activo: true, category:'FG', material_type:'FG',uom:'EA',minimum_quantity:'0',responsible_department:'shipping',default_location:'',locations:[],supplier_id:'',lead_time_days:'',
  };

  const poDefaults = {
    po: "",
    consignee_name: "",
    consignee_address1: "",
    consignee_address2: "",
    consignee_city: "",
    consignee_state: "",
    consignee_zip: "",
    consignee_country: "",
    consignee_contact_name: "",
    consignee_contact_email: "",
    consignee_contact_phone: "",
    freight_class: "",
    freight_charges: "",
    carrier_name: "",
    activo: true,
  };

  // --- Bill Charges To (ligado por PO) ---
  const billToDefaults = {
    bill_to_name: "",
    bill_to_address1: "",
    bill_to_address2: "",
    bill_to_city: "",
    bill_to_state: "",
    bill_to_zip: "",
    bill_to_country: "",
  };

  const [billTo, setBillTo] = useState(billToDefaults);

  async function loadBillToForPO(poNumber) {
    if (!poNumber) { setBillTo({ ...billToDefaults }); return; }
    const { data, error } = await supabase
      .from("bill_charges_to")
      .select("*")
      .eq("po", poNumber)
      .maybeSingle();
    if (error) {
      setBillTo({ ...billToDefaults });
      return;
    }
    setBillTo({
      bill_to_name: data?.bill_to_name || "",
      bill_to_address1: data?.bill_to_address1 || "",
      bill_to_address2: data?.bill_to_address2 || "",
      bill_to_city: data?.bill_to_city || "",
      bill_to_state: data?.bill_to_state || "",
      bill_to_zip: data?.bill_to_zip || "",
      bill_to_country: data?.bill_to_country || "",
    });
  }

  const shipperDefaults = {
    shipper_name: "",
    shipper_address1: "",
    shipper_address2: "",
    shipper_city: "",
    shipper_state: "",
    shipper_zip: "",
    shipper_country: "",
    shipper_contact_name: "",
    shipper_contact_email: "",
    shipper_contact_phone: "",
    activo: true,
  };

  const simpleDefaults = { nombre: "", activo: true };

  async function load() {
    if (tab==='bom' || tab==='stations') { setLoading(false); return; }
    const version = ++request.current;
    const current = () => version === request.current && currentTab.current === tab;
    setLoading(true);
    try {
      const [stock,products,locs,types,assignments,itemTypes,supplierRows] = await Promise.all([
        unwrap(supabase.from('inventory_items').select('id,producto_id,part_number,description,category,uom,minimum_quantity,responsible_department,default_location,active,part_name,supplier_id,lead_time_days').order('part_number')),
        unwrap(supabase.from('productos').select('*').order('nombre')),
        unwrap(supabase.from('receiving_locations').select('*').order('code')),
        unwrap(supabase.from('receiving_material_types').select('*').order('code')),
        unwrap(supabase.from('receiving_item_locations').select('*')),
        unwrap(supabase.from('receiving_item_types').select('*')),
        unwrap(supabase.from('receiving_suppliers').select('*').order('name')),
      ]);
      if (!current()) return;
      setLocations(locs.filter(r=>!r.archived));setMaterials(types.filter(r=>!r.archived));setSuppliers(supplierRows.filter(r=>!r.archived));
      if(tab==='productos') {
        const metadata=i=>({inventory_id:i?.id,producto_id:i?.producto_id,supplier_id:i?.supplier_id||'',lead_time_days:i?.lead_time_days??'',category:i?.category||'FG',material_type:itemTypes.find(m=>m.item_id===i?.id)?.material_type||i?.category||'FG',uom:i?.uom||'EA',minimum_quantity:i?.minimum_quantity??0,responsible_department:i?.responsible_department||'inventory',default_location:i?.default_location||'',locations:assignments.filter(a=>a.item_id===i?.id).map(a=>a.location_id)});
        setRows([...products.map(p=>({...p,...metadata(stock.find(i=>i.producto_id===p.id))})),...stock.filter(i=>!i.producto_id).map(i=>({id:i.id,nombre:i.part_name||i.description,descripcion:i.description,part_number:i.part_number,activo:i.active,...metadata(i)}))]);
      } else {
        const table=kind==='supplier'?'receiving_suppliers':kind==='location'?'receiving_locations':kind==='material'?'receiving_material_types':tableName;
        const data=await unwrap(supabase.from(table).select('*').order(kind?'code':tab==='pos'||tab==='shipper'?'id':'nombre'));
        if (!current()) return;
        setRows(kind ? data.filter(r=>!r.archived && (kind!=='location'||!r.is_system_stage)) : data);
      }
    } catch (e) {
      if (!current()) return;
      toast.error(e.message || t("error_loading") || "Error al cargar.");
    } finally {
      if (current()) setLoading(false);
    }
  }

  useEffect(() => {
    load();
    setPage(1);
    const unsubscribe=subscribeUpdates(supabase,'shared-catalog',catalogTables,load);
    return () => { ++request.current; unsubscribe(); };
  }, [tab]);

  const openNew = () => {
    setIsNew(true);
    if(kind) setEdit(catalogDefaults(kind));
    else if (tab === "productos") setEdit({ ...productDefaults });
    else if (tab === "pos") { setEdit({ ...poDefaults }); setBillTo({ ...billToDefaults }); }
    else if (tab === "shipper") setEdit({ ...shipperDefaults });
    else setEdit({ ...simpleDefaults });
  };

  async function duplicate(row) {
    if(!canManage || saving || duplicating)return;
    setDuplicating(true);
    const sourceTab=tab;
    try {
      const copy=duplicateCatalogRow(row,catalogIdentifier(tab,kind));
      copy.duplicated=true;
      if(tab==='productos' && row.category==='FG') {
        const recipes=await unwrap(supabase.from('inventory_boms').select('id,inventory_bom_lines(id)').eq('product_part_number',row.part_number).eq('active',true).eq('archived',false));
        copy.sourcePart=row.part_number;
        copy.sourceHasRecipe=recipes.some(r=>r.inventory_bom_lines?.length);
        copy.copyRecipe=false;
      }
      if(tab==='pos') {
        const bill=await unwrap(supabase.from('bill_charges_to').select('*').eq('po',row.po).maybeSingle());
        if(currentTab.current!==sourceTab)return;
        setBillTo(Object.fromEntries(Object.keys(billToDefaults).map(k=>[k,bill?.[k]||''])));
        copy.consignee_contact_email=emailsToInput(row.consignee_contact_email);
      }
      if(tab==='shipper')copy.shipper_contact_email=emailsToInput(row.shipper_contact_email);
      if(currentTab.current!==sourceTab)return;
      setIsNew(true);setEdit(copy);
    } catch(e){toast.error(e.message || t('error_loading'));}
    finally{setDuplicating(false);}
  }

  // 🔧 Helper para filtrar solo las columnas válidas de cada tabla
const pick = (obj, keys) =>
  keys.reduce((acc, k) => (k in obj ? { ...acc, [k]: obj[k] } : acc), {});

async function save() {
  if (!edit || !canManage || saving) return;
  try {
    setSaving(true);
    const identifier=catalogIdentifier(tab,kind);
    if(!String(edit[identifier]??'').trim())throw Error(t('catalog_identifier_required'));
    if(isNew && hasDuplicateIdentifier(rows,identifier,edit[identifier]))throw Error(t('catalog_duplicate_identifier'));
    if(kind || tab==='productos') {
      let data=edit;
      if(tab==='productos') {
        if(!edit.part_number?.trim())throw Error(t('fill_all_fields'));
        const shipping={...edit};
        for(const key of ['peso_por_pieza','peso_caja_retornable','peso_caja_expendable','cantidad_por_caja_retornable','cantidad_por_caja_expendable'])shipping[key]=shipping[key]===''?null:shipping[key];
        data={id:edit.inventory_id,producto_id:edit.producto_id || (edit.category==='FG' && !isNew?edit.id:undefined),part_number:edit.part_number,description:edit.descripcion||edit.nombre,part_name:edit.nombre,supplier_id:edit.supplier_id||null,lead_time_days:edit.lead_time_days===''?null:Number(edit.lead_time_days),material_type:edit.material_type,uom:edit.uom,minimum_quantity:quantity(edit.minimum_quantity,true),responsible_department:edit.category==='FG'?'shipping':'receiving',default_location:edit.default_location,active:edit.activo,locations:edit.locations||[],shipping};
      } else if(kind==='material')data={...edit,id:undefined};
      data={...data,is_new:isNew,...(tab==='productos'&&edit.category==='FG'&&edit.copyRecipe?{copy_recipe_from_part:edit.sourcePart}:{})};
      await unwrap(supabase.rpc('shared_catalog',{p_kind:kind||'item',p_data:data}));
      toast.success(t('save_success'));setEdit(null);setIsNew(false);await load();return;
    }
    if (tab === "operadores" && isNew) {
      return toast.error(t("users"));
    }

    // Validaciones básicas por tipo de tabla
    if (isSimple) {
      if (!edit.nombre) return toast.error(t("fill_all_fields"));
    } else if (tab === "productos") {
      if (!edit.nombre && !edit.descripcion && !edit.part_number) {
        return toast.error(t("fill_all_fields"));
      }
      if (!edit.nombre)
        edit.nombre = edit.descripcion || edit.part_number || "";
    } else if (tab === "pos") {
      if (!edit.po) return toast.error(t("fill_all_fields"));
    } else if (tab === "shipper") {
      if (!edit.shipper_name) return toast.error(t("fill_all_fields"));
    }

    // ✅ Filtramos solo las columnas existentes por tabla
    let payload = { ...edit };
    if (tab === "productos") {
      payload = pick(edit, [
        "nombre",
        "part_number",
        "descripcion",
        "peso_por_pieza",
        "bin_type",
        "tipo_empaque_retornable",
        "tipo_empaque_expendable",
        "peso_caja_retornable",
        "peso_caja_expendable",
        "cantidad_por_caja_retornable",
        "cantidad_por_caja_expendable",
        "activo",
        "id",
      ]);
    } else if (tab === "pos") {
      payload = pick(edit, [
        "po",
        "consignee_name",
        "consignee_address1",
        "consignee_address2",
        "consignee_city",
        "consignee_state",
        "consignee_zip",
        "consignee_country",
        "consignee_contact_name",
        "consignee_contact_email",
        "consignee_contact_phone",
        "freight_class",
        "freight_charges",
        "carrier_name",
        "activo",
        "id",
      ]);
    } else if (tab === "shipper") {
      payload = pick(edit, [
        "shipper_name",
        "shipper_address1",
        "shipper_address2",
        "shipper_city",
        "shipper_state",
        "shipper_zip",
        "shipper_country",
        "shipper_contact_name",
        "shipper_contact_email",
        "shipper_contact_phone",
        "activo",
        "id",
      ]);
    } else if (tab === "operadores") {
      // Account status is managed in Users so Supabase Auth stays in sync.
      payload = pick(edit, ["nombre", "id"]);
    } else if (isSimple) {
      payload = pick(edit, ["nombre", "activo", "id"]);
    }

    // 2) Normaliza contactos (texto plano) y formatea telefonos a ddd-ddd-dddd
    if (tab === "shipper") {
    // emails: convertir string "a, b; c" -> ["a","b","c"]
    if (payload.shipper_contact_email != null) {
      const arr = parseEmails(payload.shipper_contact_email);
      payload.shipper_contact_email = arr.length ? arr : null; // <-- ARRAY para Postgres text[]
    }
    // phone: texto formateado
    if (payload.shipper_contact_phone != null) {
      payload.shipper_contact_phone = formatPhoneUS(payload.shipper_contact_phone) || null;
    }
  }

  if (tab === "pos") {
    if (payload.consignee_contact_email != null) {
      const arr = parseEmails(payload.consignee_contact_email);
      payload.consignee_contact_email = arr.length ? arr : null; // <-- ARRAY
    }
    if (payload.consignee_contact_phone != null) {
      payload.consignee_contact_phone = formatPhoneUS(payload.consignee_contact_phone) || null;
    }
  }

    // ✅ Insertar o actualizar según sea nuevo o existente
    const op = isNew
      ? supabase.from(tableName).insert(payload).select()
      : supabase.from(tableName).update(payload).eq("id", payload.id).select();

    const { data: saved, error } = await op;
    if (error) throw error;

    // ⬇️ Upsert a bill_charges_to cuando estamos en la pestaña de PO
    if (tab === "pos") {
      const poNumber = (saved && saved[0]?.po) || payload.po;

      // normaliza: "" -> null
      const billPayload = {
        po: poNumber,
        ...billTo,
        updated_at: new Date().toISOString(),
      };
      Object.keys(billPayload).forEach((k) => {
        if (billPayload[k] === "") billPayload[k] = null;
      });

      const { error: billErr } = await supabase
        .from("bill_charges_to")
        .upsert(billPayload, { onConflict: "po" });
      if (billErr) throw billErr;
    }

    if (error) throw error;

    toast.success(t("save_success"));
    setEdit(null);
    setIsNew(false);
    await load();
    if (tab === "pos") setBillTo({ ...billToDefaults });
  } catch (e) {
    toast.error(e.message?.startsWith('receiving_') || e.message?.startsWith('catalog_') ? receivingError(e,t) : e.message || t("error_saving"));
  } finally {setSaving(false);}
}


  async function remove(row) {
    try {
      if(!canManage)return;
      if(!window.confirm(t('cat_confirm_delete')))return;
      if(kind) { await unwrap(supabase.rpc('catalog_remove',{p_kind:kind,p_key:kind==='material'?row.code:row.id})); toast.success(t('delete_success')); await load(); return; }
      if(tab==='productos') {
        await unwrap(supabase.rpc('shared_catalog',{p_kind:'item',p_data:{id:row.inventory_id,producto_id:row.producto_id||(!row.inventory_id?row.id:undefined),part_number:row.part_number,description:row.descripcion||row.nombre,material_type:row.material_type,uom:row.uom,minimum_quantity:row.minimum_quantity,responsible_department:row.responsible_department,default_location:row.default_location,locations:row.locations,part_name:row.nombre,shipping:{nombre:row.nombre,descripcion:row.descripcion},active:false}}));
        toast.info(t('item_in_use'));await load();return;
      }
      if (tab === "operadores") {
        toast.info(t("users"));
        return;
      }
      if (tab === "pos") {
        const { error } = await supabase.from(tableName).delete().eq("id", row.id);
        if (error) throw error;
        toast.success(t("delete_success"));
        return load();
      }

      if (tab === "shipper") {
        const { error } = await supabase.from(tableName).delete().eq("id", row.id);
        if (error) throw error;
        toast.success(t("delete_success"));
        return load();
      }

      const { data: ar, error: errAR } = await supabase
        .from("actividades_realizadas")
        .select("id, actividad, productos, operadores");
      if (errAR) throw errAR;

      const usados = (ar || []).some((d) =>
        d.actividad === row.id ||
        d.productos === row.id ||               // caso columna simple
        (Array.isArray(d.productos) && d.productos.includes(row.id)) || // caso array
        (Array.isArray(d.operadores) && d.operadores.includes(row.id))
      );

      if (usados) {
        const { error } = await supabase.from(tableName).update({ activo: false }).eq("id", row.id);
        if (error) throw error;
        toast.info(t("item_in_use"));
      } else {
        const { error } = await supabase.from(tableName).delete().eq("id", row.id);
        if (error) throw error;
        toast.success(t("delete_success"));
      }
      load();
    } catch (e) {
      toast.error(t(e.message,{defaultValue:e.message || t("error_deleting")}));
    }
  }

  const exportCSV = () => {
    const data = (filtered || []).map((r) => {
      if(kind)return {Code:r.code,Name:kind==='material'?materialLabel(r,t):r.name,...(kind==='supplier'?Object.fromEntries(addressFields.map(k=>[k,r[k]||''])):{Type:kind==='material'?r.category:r.material_type}),Status:t(r.active?'active':'inactive')};
      if (tab === "productos") {
        return {
          [t("name")]: r.nombre || "",
          PartNumber: r.part_number || "",Type:r.material_type,Minimum:r.minimum_quantity,Unit:r.uom,Locations:(r.locations || []).map(id=>locations.find(l=>l.id===id)?.code).join(', '),
          [t("description")]: r.descripcion || "",
          "Weight/Piece": r.peso_por_pieza ?? "",
          "bin_type": r.bin_type?? "",
          "Returnable Type": r.tipo_empaque_retornable || "",
          "Expendable Type": r.tipo_empaque_expendable || "",
          "Returnable Box W.": r.peso_caja_retornable ?? "",
          "Expendable Box W.": r.peso_caja_expendable ?? "",
          "Units/Returnable Box": r.cantidad_por_caja_retornable ?? "",
          "Units/Expendable Box": r.cantidad_por_caja_expendable ?? "",
          [t("status")]: r.activo ? t("active") : t("inactive"),
        };
      }
      if (tab === "pos") {
        return {
          PO: r.po || "",
          Consignee: r.consignee_name || "",
          Address: [r.consignee_address1, r.consignee_address2].filter(Boolean).join(" ") || "",
          City: r.consignee_city || "",
          State: r.consignee_state || "",
          ZIP: r.consignee_zip || "",
          Country: r.consignee_country || "",
          Contact: [r.consignee_contact_name, r.consignee_contact_phone, r.consignee_contact_email].filter(Boolean).join(" / "),
          Carrier: r.carrier_name || "",
          Freight: [r.freight_class, r.freight_charges].filter(Boolean).join(" / "),
          [t("status")]: r.activo ? t("active") : t("inactive"),
        };
      }
      if (tab === "shipper") {
        return {
          shipper: r.shipper_name || "",
          Address: [r.shipper_address1, r.shipper_address2].filter(Boolean).join(" ") || "",
          City: r.shipper_city || "",
          State: r.shipper_state || "",
          ZIP: r.shipper_zip || "",
          Country: r.shipper_country || "",
          Contact: [r.shipper_contact_name, r.shipper_contact_phone, r.shipper_contact_email].filter(Boolean).join(" / "),
          [t("status")]: r.activo ? t("active") : t("inactive"),
        };
      }
      return {
        [t("name")]: r.nombre || `ID: ${r.id}`,
        [t("status")]: r.activo ? t("active") : t("inactive"),
      };
    });

    const csv = Papa.unparse(data,{escapeFormulae:true});
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${tableName}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success(t("export_success") || "CSV exportado correctamente");
  };

  const filtered = useMemo(() => {
    const q = (filter || "").toLowerCase();
    return rows.filter(r=>(!hideInactive || (r.active ?? r.activo)) && (tab!=='productos'||!typeFilter||r.category===typeFilter) && (!q || JSON.stringify(r).toLowerCase().includes(q)));
  }, [rows, filter, hideInactive, typeFilter, tab]);

  // ==========================
  // Paginado: cálculo de filas
  // ==========================
  const totalRows = filtered.length;
  const totalPages = Math.max(1, Math.ceil((totalRows || 0) / pageSize));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const filasPagina = filtered.slice(startIndex, endIndex);

  if(tab==='bom'||tab==='stations') return <div className="page-container page-container--fluid catalog-page"><div className="card">
    <div className="catalog-toolbar"><h2 className="module-title">{t('catalogs')}</h2><div className="catalog-actions">
    {[['productos','products'],['suppliers','rc_suppliers'],['locations','rc_locations'],['materials','rc_material_types'],['pos','po'],['shipper','shipper'],['actividades','activities'],['bom','inv_bom'],['stations','inv_workstations']].map(([key,label])=><BtnSecondary key={key} onClick={()=>setTab(key)}>{t(label)}</BtnSecondary>)}
    </div></div><ProductionCatalog key={tab} mode={tab} access={access}/></div></div>;
  return (
    <div className="page-container page-container--fluid catalog-page">
      <div className="card">
        <div className="catalog-toolbar"><h2 className="module-title">{t("catalogs")}</h2>
        <div className="catalog-actions">
          <DSInput placeholder={t("search")} value={filter} onChange={(e) => setFilter(e.target.value)} style={{ marginTop: 12 }}/>
          <BtnSecondary onClick={() => setTab("productos")}>{t("products")}</BtnSecondary>
          {Object.entries(catalogKinds).map(([key,value])=><BtnSecondary key={key} onClick={()=>setTab(key)}>{t(value==='material'?'rc_material_types':value==='supplier'?'rc_suppliers':'rc_locations')}</BtnSecondary>)}
          <BtnSecondary onClick={() => setTab("pos")}>{t("po")}</BtnSecondary>
          <BtnSecondary onClick={() => setTab("shipper")}>{t("shipper")}</BtnSecondary>
          <BtnSecondary onClick={() => setTab("actividades")}>{t("activities")}</BtnSecondary>
          <BtnSecondary onClick={()=>setTab("bom")}>{t("inv_bom")}</BtnSecondary>
          <BtnSecondary onClick={()=>setTab("stations")}>{t("inv_workstations")}</BtnSecondary>
          <BtnSecondary onClick={() => {setFilter('');setTypeFilter('');setHideInactive(true);setPage(1);}}>{t("clear_filters")}</BtnSecondary>
          <BtnSecondary onClick={exportCSV}>{t("export_csv")}</BtnSecondary>
          <BtnPrimary disabled={!canManage} onClick={openNew}>➕ {t("add")}</BtnPrimary>
        </div>
        <div className="catalog-filters">
         {tab==='productos'&&<CatalogSelect label={t('rc_type')} value={typeFilter} onChange={value=>{setTypeFilter(value);setPage(1);}} options={[{value:'',label:t('rc_all')},...['RAW','FG','PACKAGING'].map(value=>({value,label:t('rc_'+value)}))]}/>}
         <label className="catalog-checkbox"><input type="checkbox" checked={hideInactive} onChange={e=>{setHideInactive(e.target.checked);setPage(1);}}/>{t('rc_hide_inactive')}</label>
        </div></div><div className="table-wrap catalog-table-scroll">
          <table className="table">
            <thead>
              <tr>
                {tab === "productos" && (
                  <>
                    <th>{t("name")}</th>
                    <th>{t("part_number")}</th>
                    <th>{t("description")}</th>
                    <th>{t('rc_type')}</th><th>{t('inv_min_stock')}</th><th>{t('rc_uom')}</th><th>{t('rc_allowed')}</th>
                    {typeFilter!=='FG'&&typeFilter!=='PACKAGING'&&<><th>{t('rc_supplier')}</th><th>{t('rc_supplier_location')}</th><th>{t('rc_lead_time')}</th></>}{(!typeFilter||typeFilter==='FG')&&<><th>{t("weight_piece")}</th>
                    <th>{t("bin_type")}</th>
                    <th>{t("returnablebox")}</th>
                    <th>{t("expendablebox")}</th>
                    <th>{t("units_returnable")}</th>
                    <th>{t("units_expendable")}</th>
                    </>}<th>{t("status")}</th>
                    <th>{t("actions")}</th>
                  </>
                )}
                {tab === "pos" && (
                  <>
                    <th>{t("po")}</th>
                    <th>{t("consignee")}</th>
                    <th>{t("address")}</th>
                    <th>{t("city")}</th>
                    <th>{t("state")}</th>
                    <th>{t("zip")}</th>
                    <th>{t("carrier")}</th>
                    <th>{t("freight")}</th>
                    <th>{t("status")}</th>
                    <th>{t("actions")}</th>
                  </>
                )}
                {tab === "shipper" && (
                  <>
                    <th>{t("shipper")}</th>
                    <th>{t("address")}</th>
                    <th>{t("city")}</th>
                    <th>{t("state")}</th>
                    <th>{t("zip")}</th>
                    <th>{t("status")}</th>
                    <th>{t("actions")}</th>
                  </>
                )}
                {kind && <><th>{t('rc_code')}</th><th>{t('rc_name')}</th>{kind==='supplier'?<><th>{t('rc_address')}</th><th>{t('rc_phone')}</th></>:<th>{t('rc_type')}</th>}<th>{t('rc_active')}</th><th>{t('actions')}</th></>}
                {isSimple && (
                  <>
                    <th>{t("name")}</th>
                    <th>{t("status")}</th>
                    <th>{t("actions")}</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={12}>{t("loading") || "Cargando..."}</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={12}>{t("no_results_found")}</td></tr>
              ) : (
                filasPagina.map((r) => (
                  <tr key={r.id || r.code}>
                    {tab === "productos" && (
                      <>
                        <td>{r.nombre}</td>
                        <td>{r.part_number}</td>
                        <td>{r.descripcion}</td>
                        <td>{materialLabel(materials.find(m=>m.code===r.material_type),t)}</td><td>{r.minimum_quantity}</td><td>{r.uom}</td><td>{(r.locations || []).map(id=>locations.find(l=>l.id===id)?.code).join(', ')||t('rc_all')}</td>
                        {typeFilter!=='FG'&&typeFilter!=='PACKAGING'&&<><td>{suppliers.find(s=>s.id===r.supplier_id)?.name||'—'}</td><td>{supplierAddress(suppliers.find(s=>s.id===r.supplier_id))||'—'}</td><td>{r.lead_time_days??'—'}</td></>}{(!typeFilter||typeFilter==='FG')&&<><td>{r.peso_por_pieza}</td>
                        <td>{r.bin_type}</td>
                        <td>{r.tipo_empaque_retornable}</td>
                        <td>{r.tipo_empaque_expendable}</td>
                        <td>{r.cantidad_por_caja_retornable}</td>
                        <td>{r.cantidad_por_caja_expendable}</td>
                        </>}<td>{r.activo ? t("active") : t("inactive")}</td>
                        <td>
                          <BtnEditDark disabled={!canManage} onClick={() => { setEdit(r); setIsNew(false); }}>
                            {t("edit")}
                          </BtnEditDark>
                          <BtnSecondary disabled={!canManage||saving||duplicating} onClick={()=>duplicate(r)}>{t("cat_duplicate")}</BtnSecondary>
                          <BtnDanger disabled={!canManage} onClick={() => remove(r)}>
                            {t("delete")}
                          </BtnDanger>
                        </td>
                      </>
                    )}
                    {tab === "pos" && (
                      <>
                        <td>{r.po}</td>
                        <td>{r.consignee_name}</td>
                        <td>{[r.consignee_address1, r.consignee_address2].filter(Boolean).join(" ")}</td>
                        <td>{r.consignee_city}</td>
                        <td>{r.consignee_state}</td>
                        <td>{r.consignee_zip}</td>
                        <td>{r.carrier_name}</td>
                        <td>{[r.freight_class, r.freight_charges].filter(Boolean).join(" / ")}</td>
                        <td>{r.activo ? t("active") : t("inactive")}</td>
                        <td>
                          <BtnEditDark
                            onClick={() => {
                              setEdit({
                                ...r,
                                consignee_contact_email: emailsToInput(r.consignee_contact_email),
                              });
                              setIsNew(false);
                              loadBillToForPO(r.po);
                            }}
                          >
                            {t("edit")}
                          </BtnEditDark>
                          <BtnSecondary disabled={!canManage||saving||duplicating} onClick={()=>duplicate(r)}>{t("cat_duplicate")}</BtnSecondary>
                          <BtnDanger disabled={!canManage} onClick={() => remove(r)}>{t("delete")}</BtnDanger>
                        </td>
                      </>
                    )}
                    {tab === "shipper" && (
                      <>
                        <td>{r.shipper_name}</td>
                        <td>{[r.shipper_address1, r.shipper_address2].filter(Boolean).join(" ")}</td>
                        <td>{r.shipper_city}</td>
                        <td>{r.shipper_state}</td>
                        <td>{r.shipper_zip}</td>
                        <td>{r.activo ? t("active") : t("inactive")}</td>
                        <td>
                          <BtnEditDark
                            onClick={() => {
                              setEdit({
                                ...r,
                                shipper_contact_email: emailsToInput(r.shipper_contact_email),
                              });
                              setIsNew(false);
                            }}
                          >
                            {t("edit")}
                          </BtnEditDark>
                          <BtnSecondary disabled={!canManage||saving||duplicating} onClick={()=>duplicate(r)}>{t("cat_duplicate")}</BtnSecondary>
                          <BtnDanger disabled={!canManage} onClick={() => remove(r)}>{t("delete")}</BtnDanger>
                        </td>
                      </>
                    )}
                    {kind && <><td>{r.code}</td><td>{kind==='material'?materialLabel(r,t):r.name}</td>{kind==='supplier'?<><td>{addressFields.filter(k=>k!=='phone').map(k=>r[k]).filter(Boolean).join(', ')}</td><td>{r.phone}</td></>:<td>{kind==='material'?t(`rc_${r.category}`):materialLabel(materials.find(m=>m.code===r.material_type),t)}</td>}<td>{t(r.active?'rc_active':'rc_inactive')}</td><td><BtnEditDark disabled={!canManage} onClick={()=>{setEdit({...r,id:kind==='material'?r.code:r.id});setIsNew(false);}}>{t('edit')}</BtnEditDark> <BtnSecondary disabled={!canManage||saving||duplicating} onClick={()=>duplicate(r)}>{t("cat_duplicate")}</BtnSecondary> <BtnDanger disabled={!canManage} onClick={()=>remove(r)}>{t('delete')}</BtnDanger></td></>}
                    {isSimple && (
                      <>
                        <td>{r.nombre}</td>
                        <td>{r.activo ? t("active") : t("inactive")}</td>
                        <td>
                          <BtnEditDark disabled={!canManage} onClick={() => { setEdit(r); setIsNew(false); }}>
                            {t("edit")}
                          </BtnEditDark>
                          <BtnSecondary disabled={!canManage||saving||duplicating} onClick={()=>duplicate(r)}>{t("cat_duplicate")}</BtnSecondary>
                          <BtnDanger disabled={!canManage} onClick={() => remove(r)}>{t("delete")}</BtnDanger>
                        </td>
                      </>
                    )}
                  </tr>
                ))
              )}
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

        <Modal
          isOpen={!!edit}
          onRequestClose={() => { if(saving)return;setEdit(null); setIsNew(false); setBillTo({ ...billToDefaults }); }}
          style={{
            overlay:{zIndex:10000,backgroundColor:'#0008'},
            content: {
              width: "min(960px, calc(100vw - 32px))", maxHeight:"88vh", inset:"50% auto auto 50%", transform:"translate(-50%, -50%)", margin:0, padding:20, boxSizing:'border-box', overflow:'auto',
            }
          }}
        >
          <div className="catalog-dialog">
            {edit?.duplicated&&<p>{t('cat_duplicate_help')}</p>}
            {edit?.duplicated&&tab==='productos'&&edit.category==='FG'&&(
              edit.sourceHasRecipe?<label className="catalog-checkbox"><input type="checkbox" disabled={saving} checked={!!edit.copyRecipe} onChange={e=>setEdit({...edit,copyRecipe:e.target.checked})}/>{t('cat_copy_recipe')}</label>:<p>{t('cat_source_no_recipe')}</p>
            )}
            <h3>{isNew ? t('add') : t('edit')} · {t(kind?`rc_${kind==='material'?'material_types':kind}`:tab==='productos'?'products':tab==='pos'?'po':tab==='shipper'?'shipper':'activities')}</h3>
            {kind && edit && <SharedCatalogFields kind={kind} edit={edit} setEdit={setEdit} materials={materials}/>}

            {tab === 'productos' && edit && <ProductCatalogFields edit={edit} setEdit={setEdit} materials={materials} locations={locations} suppliers={suppliers}/>}

            {tab === "pos" && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(min(240px,100%), 1fr))",
                  gap: 8,
                }}
              >
                <CatalogInput
                  placeholder={t("po", "PO")}
                  value={edit?.po || ""}
                  onChange={(e) => setEdit({ ...edit, po: e.target.value })}
                />
                <CatalogInput
                  placeholder={t("consignee", "Consignee")}
                  value={edit?.consignee_name || ""}
                  onChange={(e) => setEdit({ ...edit, consignee_name: e.target.value })}
                />
                <CatalogInput
                  placeholder={`${t("address", "Address")} 1`}
                  value={edit?.consignee_address1 || ""}
                  onChange={(e) =>
                    setEdit({ ...edit, consignee_address1: e.target.value })
                  }
                />
                <CatalogInput
                  placeholder={`${t("address", "Address")} 2`}
                  value={edit?.consignee_address2 || ""}
                  onChange={(e) =>
                    setEdit({ ...edit, consignee_address2: e.target.value })
                  }
                />
                <CatalogInput
                  placeholder={t("city", "City")}
                  value={edit?.consignee_city || ""}
                  onChange={(e) => setEdit({ ...edit, consignee_city: e.target.value })}
                />
                <CatalogInput
                  placeholder={t("state", "State")}
                  value={edit?.consignee_state || ""}
                  onChange={(e) => setEdit({ ...edit, consignee_state: e.target.value })}
                />
                <CatalogInput
                  placeholder={t("zip", "ZIP")}
                  value={edit?.consignee_zip || ""}
                  onChange={(e) => setEdit({ ...edit, consignee_zip: e.target.value })}
                />
                <CatalogInput
                  placeholder={t("country", "Country")}
                  value={edit?.consignee_country || ""}
                  onChange={(e) =>
                    setEdit({ ...edit, consignee_country: e.target.value })
                  }
                />
                <CatalogInput
                  placeholder={t("contact_name", "Contact Name")}
                  value={edit?.consignee_contact_name || ""}
                  onChange={(e) => setEdit({ ...edit, consignee_contact_name: e.target.value })}
                />
                <CatalogInput
                  placeholder={t("contact_email", "Contact Email")}
                  value={edit?.consignee_contact_email || ""}
                  onChange={(e) =>
                    setEdit((prev) => ({ ...prev, consignee_contact_email: e.target.value }))
                  }
                />
                <CatalogInput
                  placeholder={t("contact_phone", "Contact Phone")}
                  value={edit?.consignee_contact_phone || ""}
                  onChange={(e) =>
                    setEdit((prev) => ({ ...prev, consignee_contact_phone: e.target.value }))
                  }
                  onBlur={(e) =>
                    setEdit((prev) => ({
                      ...prev,
                      consignee_contact_phone: formatPhoneUS(e.target.value),
                    }))
                  }
                />
                <CatalogInput
                  placeholder={t("freight_class", "Freight Class")}
                  value={edit?.freight_class || ""}
                  onChange={(e) => setEdit({ ...edit, freight_class: e.target.value })}
                />
                <CatalogInput
                  placeholder={t("freight_charges", "Freight Charges")}
                  value={edit?.freight_charges || ""}
                  onChange={(e) => setEdit({ ...edit, freight_charges: e.target.value })}
                />
                <CatalogInput
                  placeholder={t("carrier", "Carrier")}
                  value={edit?.carrier_name || ""}
                  onChange={(e) => setEdit({ ...edit, carrier_name: e.target.value })}
                />
                <label style={{ gridColumn: "1 / -1" }}>
                  <input
                    type="checkbox"
                    checked={!!edit?.activo}
                    onChange={() => setEdit({ ...edit, activo: !edit?.activo })}
                  />{" "}
                  {t("active", "Activo")}
                </label>
                <hr style={{ gridColumn: "1 / -1", margin: "8px 0" }} />
                <strong style={{ gridColumn: "1 / -1" }}>{t('rc_bill_to')}</strong>
                <CatalogInput
                  placeholder={t('name')}
                  value={billTo.bill_to_name || ""}
                  onChange={(e) => setBillTo({ ...billTo, bill_to_name: e.target.value })}
                />
                <CatalogInput
                  placeholder={`${t('address')} 1`}
                  value={billTo.bill_to_address1 || ""}
                  onChange={(e) => setBillTo({ ...billTo, bill_to_address1: e.target.value })}
                />
                <CatalogInput
                  placeholder={`${t('address')} 2`}
                  value={billTo.bill_to_address2 || ""}
                  onChange={(e) => setBillTo({ ...billTo, bill_to_address2: e.target.value })}
                />
                <CatalogInput
                  placeholder={t('city')}
                  value={billTo.bill_to_city || ""}
                  onChange={(e) => setBillTo({ ...billTo, bill_to_city: e.target.value })}
                />
                <CatalogInput
                  placeholder={t('state')}
                  value={billTo.bill_to_state || ""}
                  onChange={(e) => setBillTo({ ...billTo, bill_to_state: e.target.value })}
                />
                <CatalogInput
                  placeholder={t('zip')}
                  value={billTo.bill_to_zip || ""}
                  onChange={(e) => setBillTo({ ...billTo, bill_to_zip: e.target.value })}
                />
                <CatalogInput
                  placeholder={t('country')}
                  value={billTo.bill_to_country || ""}
                  onChange={(e) => setBillTo({ ...billTo, bill_to_country: e.target.value })}
                />
              </div>
            )}

             {tab === "shipper" && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(min(240px,100%), 1fr))",
                  gap: 8,
                }}
              >
                <CatalogInput
                  placeholder={t("shipper", "Shipper")}
                  value={edit?.shipper_name || ""}
                  onChange={(e) => setEdit({ ...edit, shipper_name: e.target.value })}
                />
                <CatalogInput
                  placeholder={`${t("address", "Address")} 1`}
                  value={edit?.shipper_address1 || ""}
                  onChange={(e) =>
                    setEdit({ ...edit, shipper_address1: e.target.value })
                  }
                />
                <CatalogInput
                  placeholder={`${t("address", "Address")} 2`}
                  value={edit?.shipper_address2 || ""}
                  onChange={(e) =>
                    setEdit({ ...edit, shipper_address2: e.target.value })
                  }
                />
                <CatalogInput
                  placeholder={t("city", "City")}
                  value={edit?.shipper_city || ""}
                  onChange={(e) => setEdit({ ...edit, shipper_city: e.target.value })}
                />
                <CatalogInput
                  placeholder={t("state", "State")}
                  value={edit?.shipper_state || ""}
                  onChange={(e) => setEdit({ ...edit, shipper_state: e.target.value })}
                />
                <CatalogInput
                  placeholder={t("zip", "ZIP")}
                  value={edit?.shipper_zip || ""}
                  onChange={(e) => setEdit({ ...edit, shipper_zip: e.target.value })}
                />
<CatalogInput
                  placeholder={t("country", "Country")}
                  value={edit?.shipper_country || ""}
                  onChange={(e) =>
                    setEdit({ ...edit, shipper_country: e.target.value })
                  }
                />
                <CatalogInput
                  placeholder={t("contact_name", "Contact Name")}
                  value={edit?.shipper_contact_name || ""}
                  onChange={(e) => setEdit({ ...edit, shipper_contact_name: e.target.value })}
                />
                <CatalogInput
                  placeholder={t("contact_email", "Contact Email")}
                  value={edit?.shipper_contact_email || ""}
                  onChange={(e) =>
                    setEdit((prev) => ({ ...prev, shipper_contact_email: e.target.value }))
                  }
                />
                <CatalogInput
                  placeholder={t("contact_phone", "Contact Phone")}
                  value={edit?.shipper_contact_phone || ""}
                  onChange={(e) =>
                    setEdit((prev) => ({ ...prev, shipper_contact_phone: e.target.value }))
                  }
                  onBlur={(e) =>
                    setEdit((prev) => ({
                      ...prev,
                      shipper_contact_phone: formatPhoneUS(e.target.value),
                    }))
                  }
                />
                <label style={{ gridColumn: "1 / -1" }}>
                  <input
                    type="checkbox"
                    checked={!!edit?.activo}
                    onChange={() => setEdit({ ...edit, activo: !edit?.activo })}
                  />{" "}
                  {t("active", "Activo")}
                </label>
              </div>
            )}

            {isSimple && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px,100%), 1fr))", gap: 8 }}>
                <CatalogInput placeholder={t("name")} value={edit?.nombre || ""} onChange={e => setEdit({ ...edit, nombre: e.target.value })} />
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={!!edit?.activo} disabled={tab === "operadores"}
                    onChange={() => setEdit({ ...edit, activo: !edit?.activo })} /> {t("active")}
                  {tab === "operadores" && <small>{t("users")}</small>}
                </label>
              </div>
            )}

            {isNew&&String(edit?.[catalogIdentifier(tab,kind)]??'').trim()&&hasDuplicateIdentifier(rows,catalogIdentifier(tab,kind),edit?.[catalogIdentifier(tab,kind)])&&<p role="alert" className="inv-message">{t('catalog_duplicate_identifier')}</p>}
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <BtnPrimary disabled={!canManage||saving||duplicating||!String(edit?.[catalogIdentifier(tab,kind)]??'').trim()||(isNew&&hasDuplicateIdentifier(rows,catalogIdentifier(tab,kind),edit?.[catalogIdentifier(tab,kind)]))} onClick={save}>{t("save")}</BtnPrimary>
              <BtnSecondary disabled={saving} onClick={() => { setEdit(null); setIsNew(false); }}>
                {t("cancel")}
              </BtnSecondary>
            </div>
          </div>
        </Modal>

        <ToastContainer position="top-center" autoClose={1800} />
      </div>
    </div>
  );
}
