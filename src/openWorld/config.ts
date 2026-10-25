/**
 * Browser-side open-world configuration. The anon key is public by design
 * (Supabase row-level security decides what it can read); every write goes
 * through the Vercel API, which holds the service-role key.
 */
export interface OpenWorldConfig {
  supabaseUrl: string;
  anonKey: string;
}

export function openWorldConfig(): OpenWorldConfig | null {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supabaseUrl || !anonKey) return null;
  return { supabaseUrl: supabaseUrl.replace(/\/+$/, ''), anonKey };
}
