import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export default supabase;

// Solo en desarrollo: exponer Supabase a la consola del navegador
if (process.env.NODE_ENV === "development") {
  window.supabase = supabase;
}