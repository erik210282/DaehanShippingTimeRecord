import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase/client";
import Modal from "react-modal";
import Papa from "papaparse";
import { useTranslation } from "react-i18next";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import "../App.css";

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

export default function Catalogos() {
  const { t } = useTranslation();

  const [tab, setTab] = useState("productos");
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState("");
  const [edit, setEdit] = useState(null);
  const [isNew, setIsNew] = useState(false);
  const [loading, setLoading] = useState(false);

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
    activo: true,
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
      console.error(error);
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
    setLoading(true);
    try {
      let query = supabase.from(tableName).select("*");
      if (tab === "productos") query = query.order("nombre", { ascending: true });
      else if (tab === "pos") query = query.order("id", { ascending: true });
      else if (tab === "shipper") query = query.order("id", { ascending: true });
      else query = query.order("nombre", { ascending: true });

      const { data, error } = await query;
      if (error) throw error;
      setRows(data || []);
    } catch (e) {
      toast.error(e.message || t("error_loading") || "Error al cargar.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [tab]);

  const openNew = () => {
    setIsNew(true);
    if (tab === "productos") setEdit({ ...productDefaults });
    else if (tab === "pos") { setEdit({ ...poDefaults }); setBillTo({ ...billToDefaults }); }
    else if (tab === "shipper") setEdit({ ...shipperDefaults });
    else setEdit({ ...simpleDefaults });
  };

  // 🔧 Helper para filtrar solo las columnas válidas de cada tabla
const pick = (obj, keys) =>
  keys.reduce((acc, k) => (k in obj ? { ...acc, [k]: obj[k] } : acc), {});

async function save() {
  try {
    if (!edit) return;

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
    toast.error(e.message || t("error_saving") || "Error al guardar.");
  }
}


  async function remove(row) {
    try {
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
        .select("id, actividad, producto, operadores");
      if (errAR) throw errAR;

      const usados = (ar || []).some((d) =>
        d.actividad === row.id || d.producto === row.id ||
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
      toast.error(e.message || t("error_deleting") || "Error al eliminar.");
    }
  }

  const exportCSV = () => {
    const data = (rows || []).map((r) => {
      if (tab === "productos") {
        return {
          [t("name")]: r.nombre || "",
          PartNumber: r.part_number || "",
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

    const csv = Papa.unparse(data);
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
    if (!q) return rows;
    return rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
  }, [rows, filter]);

  return (
    <div className="page-container page-container--fluid">
      <div className="card">
        <h2>{t("catalogs")}</h2>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <button className="primary" onClick={() => setTab("productos")}>{t("products")}</button>
          <button className="primary" onClick={() => setTab("pos")}>{t("po")}</button>
          <button className="primary" onClick={() => setTab("shipper")}>{t("shipper")}</button>
          <button className="primary" onClick={() => setTab("actividades")}>{t("activities")}</button>
          <button className="primary" onClick={() => setTab("operadores")}>{t("operators")}</button>

          <input
            placeholder={t("search")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ minWidth: 220 }}
          />
          <button onClick={() => setFilter("")}>{t("clear_filters")}</button>
          <button onClick={openNew}>➕ {t("add")}</button>
          <button onClick={exportCSV}>{t("export_csv")}</button>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {tab === "productos" && (
                  <>
                    <th>{t("name")}</th>
                    <th>{t("part_number")}</th>
                    <th>{t("description")}</th>
                    <th>{t("weight_piece")}</th>
                    <th>{t("bin_type")}</th>
                    <th>{t("returnable")}</th>
                    <th>{t("expendable")}</th>
                    <th>{t("units_returnable")}</th>
                    <th>{t("units_expendable")}</th>
                    <th>{t("status")}</th>
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
                filtered.map((r) => (
                  <tr key={r.id}>
                    {tab === "productos" && (
                      <>
                        <td>{r.nombre}</td>
                        <td>{r.part_number}</td>
                        <td>{r.descripcion}</td>
                        <td>{r.peso_por_pieza}</td>
                        <td>{r.bin_type}</td>
                        <td>{r.tipo_empaque_retornable}</td>
                        <td>{r.tipo_empaque_expendable}</td>
                        <td>{r.cantidad_por_caja_retornable}</td>
                        <td>{r.cantidad_por_caja_expendable}</td>
                        <td>{r.activo ? t("active") : t("inactive")}</td>
                        <td>
                          <button onClick={() => { setEdit(r); setIsNew(false); }}>{t("edit")}</button>
                          <button className="delete-btn" onClick={() => remove(r)}>{t("delete")}</button>
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
                          <button
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
                          </button>
                          <button className="delete-btn" onClick={() => remove(r)}>{t("delete")}</button>
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
                          <button
                            onClick={() => {
                              setEdit({
                                ...r,
                                shipper_contact_email: emailsToInput(r.shipper_contact_email),
                              });
                              setIsNew(false);
                            }}
                          >
                            {t("edit")}
                          </button>
                          <button className="delete-btn" onClick={() => remove(r)}>{t("delete")}</button>
                        </td>
                      </>
                    )}
                    {isSimple && (
                      <>
                        <td>{r.nombre}</td>
                        <td>{r.activo ? t("active") : t("inactive")}</td>
                        <td>
                          <button onClick={() => { setEdit(r); setIsNew(false); }}>{t("edit")}</button>
                          <button className="delete-btn" onClick={() => remove(r)}>{t("delete")}</button>
                        </td>
                      </>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Modal
          isOpen={!!edit}
          onRequestClose={() => { setEdit(null); setIsNew(false); setBillTo({ ...billToDefaults }); }}
        >
          <div className="card">
            <h3>{isNew ? t("add") : t("edit")}</h3>

            {tab === "productos" && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(240px, 1fr))", gap: 8 }}>
                <input placeholder={t("name")} value={edit?.nombre || ""} onChange={e => setEdit({ ...edit, nombre: e.target.value })} />
                <input placeholder={t("part_number")} value={edit?.part_number || ""} onChange={e => setEdit({ ...edit, part_number: e.target.value })} />
                <input placeholder={t("description")} value={edit?.descripcion || ""} onChange={e => setEdit({ ...edit, descripcion: e.target.value })} />
                <input type="number" placeholder={t("weight_piece")} value={edit?.peso_por_pieza ?? ""} onChange={e => setEdit({ ...edit, peso_por_pieza: e.target.value })} />
                <input placeholder={t("bin_type")} value={edit?.bin_type || ""} onChange={e => setEdit({ ...edit, bin_type: e.target.value })} />
                <input placeholder={t("returnablebox")} value={edit?.tipo_empaque_retornable || ""} onChange={e => setEdit({ ...edit, tipo_empaque_retornable: e.target.value })} />
                <input placeholder={t("expendablebox")} value={edit?.tipo_empaque_expendable || ""} onChange={e => setEdit({ ...edit, tipo_empaque_expendable: e.target.value })} />
                <input type="number" placeholder={t("returnablebw")} value={edit?.peso_caja_retornable ?? ""} onChange={e => setEdit({ ...edit, peso_caja_retornable: e.target.value })} />
                <input type="number" placeholder={t("expendablebw")} value={edit?.peso_caja_expendable ?? ""} onChange={e => setEdit({ ...edit, peso_caja_expendable: e.target.value })} />
                <input type="number" placeholder={t("units_returnable")} value={edit?.cantidad_por_caja_retornable ?? ""} onChange={e => setEdit({ ...edit, cantidad_por_caja_retornable: e.target.value })} />
                <input type="number" placeholder={t("units_expendable")} value={edit?.cantidad_por_caja_expendable ?? ""} onChange={e => setEdit({ ...edit, cantidad_por_caja_expendable: e.target.value })} />
                <label style={{ gridColumn: "1 / -1" }}>
                  <input type="checkbox" checked={!!edit?.activo} onChange={() => setEdit({ ...edit, activo: !edit?.activo })} /> {t("active")}
                </label>
              </div>
            )}

            {tab === "pos" && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(240px, 1fr))",
                  gap: 8,
                }}
              >
                <input
                  placeholder={t("po", "PO")}
                  value={edit?.po || ""}
                  onChange={(e) => setEdit({ ...edit, po: e.target.value })}
                />
                <input
                  placeholder={t("consignee", "Consignee")}
                  value={edit?.consignee_name || ""}
                  onChange={(e) => setEdit({ ...edit, consignee_name: e.target.value })}
                />
                <input
                  placeholder={`${t("address", "Address")} 1`}
                  value={edit?.consignee_address1 || ""}
                  onChange={(e) =>
                    setEdit({ ...edit, consignee_address1: e.target.value })
                  }
                />
                <input
                  placeholder={`${t("address", "Address")} 2`}
                  value={edit?.consignee_address2 || ""}
                  onChange={(e) =>
                    setEdit({ ...edit, consignee_address2: e.target.value })
                  }
                />
                <input
                  placeholder={t("city", "City")}
                  value={edit?.consignee_city || ""}
                  onChange={(e) => setEdit({ ...edit, consignee_city: e.target.value })}
                />
                <input
                  placeholder={t("state", "State")}
                  value={edit?.consignee_state || ""}
                  onChange={(e) => setEdit({ ...edit, consignee_state: e.target.value })}
                />
                <input
                  placeholder={t("zip", "ZIP")}
                  value={edit?.consignee_zip || ""}
                  onChange={(e) => setEdit({ ...edit, consignee_zip: e.target.value })}
                />
                <input
                  placeholder={t("country", "Country")}
                  value={edit?.consignee_country || ""}
                  onChange={(e) =>
                    setEdit({ ...edit, consignee_country: e.target.value })
                  }
                />
                <input
                  placeholder={t("contact_name", "Contact Name")}
                  value={edit?.consignee_contact_name || ""}
                  onChange={(e) => setEdit({ ...edit, consignee_contact_name: e.target.value })}
                />
                <input
                  placeholder={t("contact_email", "Contact Email")}
                  value={edit?.consignee_contact_email || ""}
                  onChange={(e) =>
                    setEdit((prev) => ({ ...prev, consignee_contact_email: e.target.value }))
                  }
                />
                <input
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
                <input
                  placeholder={t("freight_class", "Freight Class")}
                  value={edit?.freight_class || ""}
                  onChange={(e) => setEdit({ ...edit, freight_class: e.target.value })}
                />
                <input
                  placeholder={t("freight_charges", "Freight Charges")}
                  value={edit?.freight_charges || ""}
                  onChange={(e) => setEdit({ ...edit, freight_charges: e.target.value })}
                />
                <input
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
                <strong style={{ gridColumn: "1 / -1" }}>Bill Charges To</strong>
                <input
                  placeholder="Name"
                  value={billTo.bill_to_name || ""}
                  onChange={(e) => setBillTo({ ...billTo, bill_to_name: e.target.value })}
                />
                <input
                  placeholder="Address 1"
                  value={billTo.bill_to_address1 || ""}
                  onChange={(e) => setBillTo({ ...billTo, bill_to_address1: e.target.value })}
                />
                <input
                  placeholder="Address 2"
                  value={billTo.bill_to_address2 || ""}
                  onChange={(e) => setBillTo({ ...billTo, bill_to_address2: e.target.value })}
                />
                <input
                  placeholder="City"
                  value={billTo.bill_to_city || ""}
                  onChange={(e) => setBillTo({ ...billTo, bill_to_city: e.target.value })}
                />
                <input
                  placeholder="State"
                  value={billTo.bill_to_state || ""}
                  onChange={(e) => setBillTo({ ...billTo, bill_to_state: e.target.value })}
                />
                <input
                  placeholder="ZIP"
                  value={billTo.bill_to_zip || ""}
                  onChange={(e) => setBillTo({ ...billTo, bill_to_zip: e.target.value })}
                />
                <input
                  placeholder="Country"
                  value={billTo.bill_to_country || ""}
                  onChange={(e) => setBillTo({ ...billTo, bill_to_country: e.target.value })}
                />
              </div>
            )}

             {tab === "shipper" && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(240px, 1fr))",
                  gap: 8,
                }}
              >
                <input
                  placeholder={t("shipper", "Shipper")}
                  value={edit?.shipper_name || ""}
                  onChange={(e) => setEdit({ ...edit, shipper_name: e.target.value })}
                />
                <input
                  placeholder={`${t("address", "Address")} 1`}
                  value={edit?.shipper_address1 || ""}
                  onChange={(e) =>
                    setEdit({ ...edit, shipper_address1: e.target.value })
                  }
                />
                <input
                  placeholder={`${t("address", "Address")} 2`}
                  value={edit?.shipper_address2 || ""}
                  onChange={(e) =>
                    setEdit({ ...edit, shipper_address2: e.target.value })
                  }
                />
                <input
                  placeholder={t("city", "City")}
                  value={edit?.shipper_city || ""}
                  onChange={(e) => setEdit({ ...edit, shipper_city: e.target.value })}
                />
                <input
                  placeholder={t("state", "State")}
                  value={edit?.shipper_state || ""}
                  onChange={(e) => setEdit({ ...edit, shipper_state: e.target.value })}
                />
                <input
                  placeholder={t("zip", "ZIP")}
                  value={edit?.shipper_zip || ""}
                  onChange={(e) => setEdit({ ...edit, shipper_zip: e.target.value })}
                />
                <input
                  placeholder={t("country", "Country")}
                  value={edit?.shipper_country || ""}
                  onChange={(e) =>
                    setEdit({ ...edit, shipper_country: e.target.value })
                  }
                />
                <input
                  placeholder={t("contact_name", "Contact Name")}
                  value={edit?.shipper_contact_name || ""}
                  onChange={(e) => setEdit({ ...edit, shipper_contact_name: e.target.value })}
                />
                <input
                  placeholder={t("contact_email", "Contact Email")}
                  value={edit?.shipper_contact_email || ""}
                  onChange={(e) =>
                    setEdit((prev) => ({ ...prev, shipper_contact_email: e.target.value }))
                  }
                />
                <input
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
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(240px, 1fr))", gap: 8 }}>
                <input placeholder={t("name")} value={edit?.nombre || ""} onChange={e => setEdit({ ...edit, nombre: e.target.value })} />
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={!!edit?.activo} onChange={() => setEdit({ ...edit, activo: !edit?.activo })} /> {t("active")}
                </label>
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button className="primary" onClick={save}>{t("save")}</button>
              <button className="secondary" onClick={() => { setEdit(null); setIsNew(false); }}>{t("cancel")}</button>
            </div>
          </div>
        </Modal>

        <ToastContainer position="top-center" autoClose={1800} />
      </div>
    </div>
  );
}
