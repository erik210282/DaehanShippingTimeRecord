import React, { useEffect, useState } from "react";
import { supabase } from "../../supabase/client";
import { useTranslation } from "react-i18next";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

export default function CatalogoEnvio() {
  const { t } = useTranslation();
  const [tab, setTab] = useState("productos");
  const [rows, setRows] = useState([]);
  const [edit, setEdit] = useState(null);
  const [isNew, setIsNew] = useState(false);
  const [f, setF] = useState("");

  const load = async () => {
    const table = tab === "productos" ? "catalogo_productos" : "catalogo_pos";
    const { data, error } = await supabase.from(table).select("*").order("id", { ascending: true });
    if (error) { toast.error(error.message); return; }
    setRows(data || []);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tab]);

  const openNew = () => {
    setIsNew(true);
    setEdit(tab === "productos"
      ? { part_number:"", descripcion:"", peso_por_pieza:0, piezas_por_caja:0, tipo_empaque_retornable:"", tipo_empaque_expendable:"", peso_caja_retornable:0, peso_caja_expendable:0, cantidad_por_caja_retornable:0, cantidad_por_caja_expendable:0, activo:true }
      : { po:"", consignee_name:"", consignee_address1:"", consignee_address2:"", consignee_city:"", consignee_state:"", consignee_zip:"", consignee_country:"", contact_name:"", contact_email:"", contact_phone:"", freight_class:"", freight_charges:"", carrier_name:"", booking_tracking:"", activo:true }
    );
  };

  const save = async () => {
    const table = tab === "productos" ? "catalogo_productos" : "catalogo_pos";
    const payload = { ...edit };
    if (!payload || (tab==="productos" ? !payload.part_number || !payload.descripcion : !payload.po)) {
      toast.error(t("fill_all_fields")); return;
    }
    let res;
    if (isNew) {
      res = await supabase.from(table).insert(payload).select();
    } else {
      res = await supabase.from(table).update(payload).eq("id", payload.id).select();
    }
    if (res.error) { toast.error(res.error.message); return; }
    toast.success(t("save_success"));
    setEdit(null); setIsNew(false);
    load();
  };

  const remove = async (row) => {
    const table = tab === "productos" ? "catalogo_productos" : "catalogo_pos";
    const { error } = await supabase.from(table).delete().eq("id", row.id);
    if (error) { toast.error(error.message); return; }
    toast.success(t("delete_success"));
    load();
  };

  const filtered = rows.filter(r => JSON.stringify(r).toLowerCase().includes((f||"").toLowerCase()));

  return (
    <div className="page-container page-container--fluid">
      <div className="card">
        <h2>{t("catalogs")} — {tab === "productos" ? t("products") : "POs"}</h2>
        <div style={{ display:"flex", gap: "8px", flexWrap:"wrap", marginBottom: 8 }}>
          <button className="primary" onClick={()=>setTab("productos")}>{t("products")}</button>
          <button className="primary" onClick={()=>setTab("pos")}>POs</button>
          <input placeholder={t("search")} value={f} onChange={e=>setF(e.target.value)} />
          <button onClick={openNew}>➕ {t("add")}</button>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {tab==="productos" ? (
                  <>
                    <th>Part Number</th><th>{t("description")}</th><th>Weight/Piece</th><th>Units/Box</th><th>Returnable</th><th>Expendable</th><th>{t("actions")}</th>
                  </>
                ) : (
                  <>
                    <th>PO</th><th>Consignee</th><th>Address</th><th>City</th><th>State</th><th>ZIP</th><th>Carrier</th><th>Freight</th><th>{t("actions")}</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r)=>(
                <tr key={r.id}>
                  {tab==="productos" ? (
                    <>
                      <td>{r.part_number}</td>
                      <td>{r.descripcion}</td>
                      <td>{r.peso_por_pieza}</td>
                      <td>{r.piezas_por_caja}</td>
                      <td>{r.tipo_empaque_retornable}</td>
                      <td>{r.tipo_empaque_expendable}</td>
                      <td>
                        <button onClick={()=>{setEdit(r); setIsNew(false);}}>{t("edit")}</button>
                        <button className="delete-btn" onClick={()=>remove(r)}>{t("delete")}</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{r.po}</td>
                      <td>{r.consignee_name}</td>
                      <td>{r.consignee_address1}</td>
                      <td>{r.consignee_city}</td>
                      <td>{r.consignee_state}</td>
                      <td>{r.consignee_zip}</td>
                      <td>{r.carrier_name}</td>
                      <td>{r.freight_class} / {r.freight_charges}</td>
                      <td>
                        <button onClick={()=>{setEdit(r); setIsNew(false);}}>{t("edit")}</button>
                        <button className="delete-btn" onClick={()=>remove(r)}>{t("delete")}</button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {edit && (
          <div className="card" style={{ marginTop: 10 }}>
            <h3>{isNew ? t("add") : t("edit")}</h3>
            {tab==="productos" ? (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(2,minmax(240px,1fr))", gap: 8 }}>
                <input placeholder="Part Number" value={edit.part_number} onChange={e=>setEdit({...edit, part_number:e.target.value})}/>
                <input placeholder={t("description")} value={edit.descripcion} onChange={e=>setEdit({...edit, descripcion:e.target.value})}/>
                <input type="number" placeholder="Weight/Piece" value={edit.peso_por_pieza} onChange={e=>setEdit({...edit, peso_por_pieza:e.target.value})}/>
                <input type="number" placeholder="Units/Box" value={edit.piezas_por_caja} onChange={e=>setEdit({...edit, piezas_por_caja:e.target.value})}/>
                <input placeholder="Returnable Type" value={edit.tipo_empaque_retornable||""} onChange={e=>setEdit({...edit, tipo_empaque_retornable:e.target.value})}/>
                <input placeholder="Expendable Type" value={edit.tipo_empaque_expendable||""} onChange={e=>setEdit({...edit, tipo_empaque_expendable:e.target.value})}/>
                <input type="number" placeholder="Returnable Box Weight" value={edit.peso_caja_retornable} onChange={e=>setEdit({...edit, peso_caja_retornable:e.target.value})}/>
                <input type="number" placeholder="Expendable Box Weight" value={edit.peso_caja_expendable} onChange={e=>setEdit({...edit, peso_caja_expendable:e.target.value})}/>
                <input type="number" placeholder="Units/Returnable Box" value={edit.cantidad_por_caja_retornable} onChange={e=>setEdit({...edit, cantidad_por_caja_retornable:e.target.value})}/>
                <input type="number" placeholder="Units/Expendable Box" value={edit.cantidad_por_caja_expendable} onChange={e=>setEdit({...edit, cantidad_por_caja_expendable:e.target.value})}/>
                <label><input type="checkbox" checked={!!edit.activo} onChange={()=>setEdit({...edit, activo:!edit.activo})}/> {t("active")}</label>
              </div>
            ) : (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(2,minmax(240px,1fr))", gap: 8 }}>
                <input placeholder="PO" value={edit.po} onChange={e=>setEdit({...edit, po:e.target.value})}/>
                <input placeholder="Consignee Name" value={edit.consignee_name||""} onChange={e=>setEdit({...edit, consignee_name:e.target.value})}/>
                <input placeholder="Address 1" value={edit.consignee_address1||""} onChange={e=>setEdit({...edit, consignee_address1:e.target.value})}/>
                <input placeholder="Address 2" value={edit.consignee_address2||""} onChange={e=>setEdit({...edit, consignee_address2:e.target.value})}/>
                <input placeholder="City" value={edit.consignee_city||""} onChange={e=>setEdit({...edit, consignee_city:e.target.value})}/>
                <input placeholder="State" value={edit.consignee_state||""} onChange={e=>setEdit({...edit, consignee_state:e.target.value})}/>
                <input placeholder="ZIP" value={edit.consignee_zip||""} onChange={e=>setEdit({...edit, consignee_zip:e.target.value})}/>
                <input placeholder="Country" value={edit.consignee_country||""} onChange={e=>setEdit({...edit, consignee_country:e.target.value})}/>
                <input placeholder="Contact Name" value={edit.contact_name||""} onChange={e=>setEdit({...edit, contact_name:e.target.value})}/>
                <input placeholder="Contact Email" value={edit.contact_email||""} onChange={e=>setEdit({...edit, contact_email:e.target.value})}/>
                <input placeholder="Contact Phone" value={edit.contact_phone||""} onChange={e=>setEdit({...edit, contact_phone:e.target.value})}/>
                <input placeholder="Freight Class" value={edit.freight_class||""} onChange={e=>setEdit({...edit, freight_class:e.target.value})}/>
                <input placeholder="Freight Charges" value={edit.freight_charges||""} onChange={e=>setEdit({...edit, freight_charges:e.target.value})}/>
                <input placeholder="Carrier Name" value={edit.carrier_name||""} onChange={e=>setEdit({...edit, carrier_name:e.target.value})}/>
                <input placeholder="Booking/Tracking" value={edit.booking_tracking||""} onChange={e=>setEdit({...edit, booking_tracking:e.target.value})}/>
                <label><input type="checkbox" checked={!!edit.activo} onChange={()=>setEdit({...edit, activo:!edit.activo})}/> {t("active")}</label>
              </div>
            )}
            <div style={{ display:"flex", gap: 8, marginTop: 10 }}>
              <button className="primary" onClick={save}>{t("save")}</button>
              <button className="secondary" onClick={()=>{setEdit(null); setIsNew(false);}}>{t("cancel")}</button>
            </div>
          </div>
        )}

        <ToastContainer position="top-center" autoClose={1500}/>
      </div>
    </div>
  );
}