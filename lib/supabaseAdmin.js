import { createClient } from "@supabase/supabase-js";

// SERVER-ONLY. Uses the service role key, which bypasses Row Level Security.
// Never import this file from a "use client" component or expose
// SUPABASE_SERVICE_ROLE_KEY with a NEXT_PUBLIC_ prefix — it must only ever
// run in API routes / server code.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
