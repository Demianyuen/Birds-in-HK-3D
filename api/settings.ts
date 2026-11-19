import type { ServerResponse } from 'node:http';
import { readQuiet } from './_lib/quiet.js';
import { countRows, rest, sendError, sendJson, supabaseConfig, type ApiRequest, type SupabaseConfig } from './_lib/openWorld.js';

export interface PublicStats { people: number; flowers: number; words: number }

let cachedStats: { stats: PublicStats; at: number } | null = null;
const STATS_MS = 60_000;

/** How many have come: distinct visitors who laid a flower, flowers, and flowers that carry words. */
async function readStats(config: SupabaseConfig, now = Date.now()): Promise<PublicStats | null> {
  if (cachedStats && now - cachedStats.at < STATS_MS) return cachedStats.stats;
  try {
    const [rows, words] = await Promise.all([
      rest(config, 'memorial_flowers?select=sender_hash&hidden=eq.false&limit=20000').then(response => response.json() as Promise<Array<{ sender_hash?: string }>>),
      countRows(config, 'memorial_flowers', 'hidden=eq.false&message_status=in.(pending,approved)'),
    ]);
    // The sender hash may carry the flower kind after a colon (see flowerKinds.ts): count the visitor only.
    const people = new Set(rows.map(row => (row.sender_hash ?? '').split(':')[0]).filter(Boolean)).size;
    const stats = { people, flowers: rows.length, words };
    cachedStats = { stats, at: now };
    return stats;
  } catch {
    return cachedStats?.stats ?? null;
  }
}

/** GET /api/settings → { quiet, stats } — whether visitors' words are shown right now, and how many have come. */
export default async function handler(req: ApiRequest, res: ServerResponse): Promise<void> {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      sendJson(res, 405, { error: 'Method not allowed.' });
      return;
    }
    const config = supabaseConfig();
    const [quiet, stats] = await Promise.all([readQuiet(config), readStats(config)]);
    sendJson(res, 200, { quiet, stats }, 15);
  } catch (error) {
    sendError(res, error);
  }
}
