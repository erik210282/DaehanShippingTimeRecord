// web/src/supabase/client.js
import { createClient } from '@supabase/supabase-js';


const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;      // config en Vercel
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// --- DEBUG: envolver removeChannel y removeAllChannels ---
const originalRemoveChannel = supabase.removeChannel.bind(supabase);
supabase.removeChannel = (channel) => {
  const topic = channel?.topic || "(sin topic)";
  console.log(
    "⚠️ removeChannel llamado para:",
    topic,
    "\nStack:",
    new Error().stack
  );
  return originalRemoveChannel(channel);
};

const originalRemoveAllChannels = supabase.removeAllChannels.bind(supabase);
supabase.removeAllChannels = () => {
  console.log(
    "⚠️ removeAllChannels llamado",
    "\nStack:",
    new Error().stack
  );
  return originalRemoveAllChannels();
};
