// Reload snapshots after committed changes, coalescing bursts from atomic operations.
export const receivingTables = ['receiving_receipts','receiving_lines','receiving_tasks','inventory_quality_holds','catalog_updates','receiving_suppliers','receiving_locations','receiving_material_types','receiving_item_types','receiving_item_locations','global_department_memberships','operadores'];
export const inventoryTables = ['inventory_items','inventory_reference_rows','catalog_updates','inventory_movements','inventory_quality_holds','inventory_counts','inventory_count_lines','inventory_production_reports','inventory_boms','inventory_bom_lines','inventory_demand_imports','inventory_demand_lines','inventory_dispatches','actividades_realizadas','shipping_lines'];
export const catalogTables = ['inventory_workstations','inventory_boms','inventory_bom_lines','catalog_updates','productos','receiving_suppliers','receiving_locations','receiving_material_types','receiving_item_types','receiving_item_locations','catalogo_pos','catalogo_shipper','bill_charges_to','actividades'];
export function subscribeUpdates(db, name, tables, refresh) {
  let poll, timer, stopped=false, running=false, pending=false;
  const reload=async()=>{
    if(stopped)return;
    if(running){pending=true;return;}
    running=true;
    try{await refresh();}catch{}finally{running=false;if(pending){pending=false;schedule();}}
  };
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(reload,100);};
  let channel=db.channel(`${name}-${Math.random().toString(36).slice(2)}`);
  for(const table of tables)channel=channel.on('postgres_changes',{event:'*',schema:'public',table},schedule);
  channel.subscribe(status=>{if(status==='SUBSCRIBED')schedule();});
  poll=setInterval(()=>{if(document.visibilityState==='visible')schedule();},10000);
  const wake=()=>{if(document.visibilityState==='visible')schedule();};
  window.addEventListener('focus',wake);document.addEventListener('visibilitychange',wake);
  return ()=>{stopped=true;clearTimeout(timer);clearInterval(poll);window.removeEventListener('focus',wake);document.removeEventListener('visibilitychange',wake);db.removeChannel(channel);};
}
