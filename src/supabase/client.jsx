// web/src/supabase/client.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://wqpceonfeyjfegawpzpv.supabase.co';
const supabaseAnonKey = '<eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndxcGNlb25mZXlqZmVnYXdwenB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk1NjI3MDcsImV4cCI6MjA2NTEzODcwN30.8rUaWkcJXmwKZvvw2npmYAp76rblTm0n-j2GjcevohQ>';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
