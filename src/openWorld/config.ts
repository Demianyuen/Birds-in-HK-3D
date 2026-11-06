/**
 * Browser-side open-world configuration. The anon key is public by design
 * (Supabase row-level security decides what it can read); every write goes
 * through the Vercel API, which holds the service-role key.
 */
export interface OpenWorldConfig {
  supabaseUrl: string;
  anonKey: string;
}

/**
 * Our own shared-sky relay (relay/, a Cloudflare Worker), e.g. "wss://birds-in-hk-sky.<account>.workers.dev".
 * When set, poses, who is here and lines said nearby go through it instead of Supabase Realtime.
 */
export function skyRelayUrl(): string | null {
  const url = import.meta.env.VITE_SKY_RELAY_URL as string | undefined;
  return url && /^wss?:\/\//.test(url) ? url.replace(/\/+$/, '') : null;
}

export function openWorldConfig(): OpenWorldConfig | null {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supabaseUrl || !anonKey) return null;
  return { supabaseUrl: supabaseUrl.replace(/\/+$/, ''), anonKey };
}
