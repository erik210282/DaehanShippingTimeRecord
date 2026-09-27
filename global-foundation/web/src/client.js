import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Never silently fall back to the production Shipping database.
export const configured = Boolean(url && key);
export const supabase = configured ? createClient(url, key) : null;
