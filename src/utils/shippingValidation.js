import { supabase } from "../supabase/client";

// Read the stored captures, including both ends of each verified activity.
export async function fetchShippingCaptures() {
  const captures = {};
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("shipping_activity_labels")
      .select("actividad_id, etiqueta_inicio, etiqueta_fin, trailer, puerta, trailer_fin, puerta_fin")
      .order("actividad_id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    (data || []).forEach((capture) => { captures[capture.actividad_id] = capture; });
    if (!data || data.length < pageSize) break;
  }
  return captures;
}

export function isShippingVerified(activity, capture, activityName) {
  if (!capture || capture.legacy || activity.estado !== "finalizada" ||
      !capture.etiqueta_inicio || !capture.etiqueta_fin) return false;
  if (activityName?.toLowerCase().trim() !== "load") return true;
  return Boolean(capture.trailer?.trim() && capture.puerta?.trim() &&
    capture.trailer === capture.trailer_fin && capture.puerta === capture.puerta_fin);
}

// A label written for an old task has no IDX range to check against.
// Surface it in the UI without counting it as a verified shipping capture.
export function legacyShippingCapture(activity) {
  if (!activity.trailer && !activity.puerta &&
      !activity.etiqueta_inicio_manual && !activity.etiqueta_fin_manual) return null;
  return {
    legacy: true,
    trailer: activity.trailer || null,
    puerta: activity.puerta || null,
    etiqueta_inicio: activity.etiqueta_inicio_manual || null,
    etiqueta_fin: activity.etiqueta_fin_manual || null,
  };
}
