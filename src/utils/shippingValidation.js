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
  if (!capture || activity.estado !== "finalizada" ||
      !capture.etiqueta_inicio || !capture.etiqueta_fin) return false;
  if (activityName?.toLowerCase().trim() !== "load") return true;
  return Boolean(capture.trailer?.trim() && capture.puerta?.trim() &&
    capture.trailer === capture.trailer_fin && capture.puerta === capture.puerta_fin);
}
