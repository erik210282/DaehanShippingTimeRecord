export const number = value => Number(String(value ?? '').replace(',', '.'));
export function localDay(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function newId() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export function quantity(value, allowZero = false) {
  if (String(value ?? '').trim() === '') throw Error('receiving_quantity');
  const result = number(value);
  if (!Number.isFinite(result) || (allowZero ? result < 0 : result <= 0)) throw Error('receiving_quantity');
  return result;
}
export const itemLabel = item => `${item.part_number} · ${item.part_name || item.description} (${item.uom})`;
export const locationLabel = item => `${item.code} · ${item.name}`;
export const activeTask = task => ['running', 'paused'].includes(task.status);
export const statusColors = { pending: '#FFF44F', process: '#AEC6CF', completed: '#B2FBA5', paused: '#F1BA8B', cancelled: '#eeeeee' };
export function receiptState(receipt, lines, tasks) {
  if (receipt.status === 'cancelled') return 'cancelled';
  const ownTasks = tasks.filter(task => task.receipt_id === receipt.id && activeTask(task));
  if (ownTasks.length) return ownTasks.every(task => task.status === 'paused') ? 'paused' : 'process';
  const ownLines = lines.filter(line => line.receipt_id === receipt.id);
  if (receipt.status === 'received' && ownLines.every(line => number(line.stored) >= number(line.received))) return 'completed';
  if (ownLines.some(line => number(line.stored)>0)) return 'process';
  return 'pending';
}
export function allowedLocations(itemId, locations, assignments) {
  const assigned = assignments.filter(row => row.item_id === itemId);
  return locations.filter(row => row.active && !row.is_system_stage && (!assigned.length || assigned.some(a => a.location_id === row.id)));
}
export function effectiveSeconds(task) {
  if (!task.finished_at) return 0;
  return Math.max(0, (new Date(task.finished_at) - new Date(task.started_at)) / 1000 - number(task.pause_seconds));
}
export function productivity(tasks, lines) {
  const groups = new Map();
  for (const task of tasks.filter(row => row.status === 'finished').flatMap(task=>[task.operator_id,...(task.additional_operator_ids||[])].map(operator_id=>({...task,operator_id})))) {
    const taskLines = task.kind === 'unload' ? lines.filter(line => line.receipt_id === task.receipt_id) : lines.filter(line => line.id === task.line_id);
    // Do not divide the full unloading time between unlike products or units.
    const units = new Set(taskLines.map(line => line.uom));
    const uom = units.size === 1 ? [...units][0] : 'mixed';
    const key = `${task.operator_id}:${task.kind}:${uom}`;
    const group = groups.get(key) || { operator_id: task.operator_id, kind: task.kind, uom, activities: 0, seconds: 0, quantity: 0 };
    group.activities++; group.seconds += effectiveSeconds(task);
    if (uom !== 'mixed') group.quantity += task.kind === 'putaway' ? number(task.quantity) : taskLines.reduce((sum, line) => sum + number(line.received), 0);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => ({ ...group, uph: group.seconds > 0 && group.uom !== 'mixed' ? group.quantity * 3600 / group.seconds : null }));
}
export async function unwrap(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}
export function api(db) {
  const rpc = (name, params) => unwrap(db.rpc(name, params));
  return {
    async load() {
      const pageAll = async (table, order = 'id', filter, columns = '*') => {
        let rows = [], offset = 0;
        while (true) {
          let query = db.from(table).select(columns).order(order).range(offset, offset + 999);
          if(filter) query=filter(query);
          const page = await unwrap(query);
          rows = rows.concat(page); if (page.length < 1000) return rows; offset += 1000;
        }
      };
      const [suppliers, locations, assignments, items, receipts, lines, tasks, users, materialTypes, itemTypes] = await Promise.all([
        pageAll('receiving_suppliers', 'code'), pageAll('receiving_locations', 'code'),
        pageAll('receiving_item_locations', 'item_id'),
        pageAll('inventory_items', 'part_number', query=>query.in('category',['RAW','FG','PACKAGING']), 'id,part_number,description,category,uom,active,minimum_quantity,responsible_department,default_location,part_name,supplier_id,lead_time_days'),
        pageAll('receiving_receipts', 'code'), pageAll('receiving_line_status'), pageAll('receiving_tasks'), rpc('receiving_users', {}), pageAll('receiving_material_types','code'), pageAll('receiving_item_types','item_id'),
      ]);
      return { suppliers, locations, assignments, items:items.map(i=>({...i,material_type:itemTypes.find(m=>m.item_id===i.id)?.material_type || i.category})), receipts, lines, tasks, users, materialTypes };
    },
    start: (id, data) => rpc('receiving_start', { p_id: id, p_data: data }),
    putaway: (id, line, location, amount, operators=[]) => rpc('receiving_putaway_group', { p_id: id, p_line: line, p_location: location, p_quantity: quantity(amount),p_operators:operators }),
    task: (id, action, lines = []) => rpc('receiving_task', { p_id: id, p_action: action, p_lines: lines }),
    catalog: (kind, data) => rpc('receiving_catalog', { p_kind: kind, p_data: data }),
    hold: (line, reason) => rpc('receiving_hold', { p_line: line, p_reason: reason }),
  };
}
export function finishLines(lines, draft) {
  return lines.map(line => {
    const values = draft[line.id] || {};
    const received = quantity(values.received ?? line.expected, true);
    const damaged = quantity(values.damaged ?? 0, true);
    if (damaged > received) throw Error('receiving_quantity');
    if (damaged > 0 && !values.note?.trim()) throw Error('receiving_damage_note');
    return { id: line.id, received, damaged, note: values.note?.trim() || '' };
  });
}
export const emptyData = { suppliers: [], locations: [], assignments: [], items: [], receipts: [], lines: [], tasks: [], users: [], materialTypes: [] };
