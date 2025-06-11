import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export default supabase;


// ⚠️ Temporalmente, expón supabase globalmente para depuración:
window.supabase = supabase;
