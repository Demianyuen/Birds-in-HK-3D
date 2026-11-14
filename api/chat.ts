import type { ServerResponse } from 'node:http';
import { checkChat, checkName, rejectReasonText } from '../src/openWorld/contentRules.js';
import { readQuiet } from './_lib/quiet.js';
import {
  ApiError,
  countRows,
  isoSecondsAgo,
  readJson,
  rest,
  senderHash,
  sendError,
  sendJson,
  supabaseConfig,
  type ApiRequest,
} from './_lib/openWorld.js';

/** One line every 3 seconds and 20 lines in 10 minutes per visitor. */
const BURST_SECONDS = 3;
const WINDOW_SECONDS = 600;
const WINDOW_LIMIT = 20;

/**
 * POST /api/chat { name, body, x, z } → filtered, rate-limited, then stored (refused while the quiet switch is on);
 * other players receive it live through Supabase Realtime. Lines are kept for
 * one day so moderators can review and hide them.
 */
export default async function handler(req: ApiRequest, res: ServerResponse): Promise<void> {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      throw new ApiError(405, 'Method not allowed.');
    }
    const config = supabaseConfig();
    const body = await readJson(req);
    const name = checkName(body.name);
    if (!name.ok) throw new ApiError(422, `名字：${rejectReasonText(name.reason)}`);
    const line = checkChat(body.body);
    if (!line.ok) throw new ApiError(422, rejectReasonText(line.reason));
    if (await readQuiet(config)) throw new ApiError(423, '這段時間，大家安靜地留下花朵。');
    const x = typeof body.x === 'number' && Number.isFinite(body.x) ? Math.max(-5_000, Math.min(5_000, body.x)) : 0;
    const z = typeof body.z === 'number' && Number.isFinite(body.z) ? Math.max(-5_000, Math.min(5_000, body.z)) : 0;
    // Which bird said it, so others can show the line over that bird. Not an identity.
    const speaker = typeof body.speaker === 'string' && /^[A-Za-z0-9-]{8,40}$/.test(body.speaker) ? body.speaker : '';

    const sender = senderHash(req);
    const [burst, windowCount] = await Promise.all([
      countRows(config, 'memorial_chat', `sender_hash=eq.${sender}&created_at=gte.${encodeURIComponent(isoSecondsAgo(BURST_SECONDS))}`),
      countRows(config, 'memorial_chat', `sender_hash=eq.${sender}&created_at=gte.${encodeURIComponent(isoSecondsAgo(WINDOW_SECONDS))}`),
    ]);
    if (burst > 0) throw new ApiError(429, '請慢慢說，稍等一會再發送。');
    if (windowCount >= WINDOW_LIMIT) throw new ApiError(429, '你已經說了很多，請休息一下再發送。');

    const row = { name: name.text || '訪客', body: line.text, x, z, sender_hash: sender };
    try {
      await rest(config, 'memorial_chat', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: speaker ? { ...row, speaker } : row });
    } catch (error) {
      // A database without the speaker column (migration 0002 not run yet) still takes the line.
      if (!speaker) throw error;
      await rest(config, 'memorial_chat', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: row });
    }
    await tellTheSky(body.zone, body.room, { speaker, name: name.text || '訪客', body: line.text, x, z });
    sendJson(res, 201, { ok: true });
  } catch (error) {
    sendError(res, error);
  }
}

/**
 * With our own sky relay (relay/), the filtered line is shown over the speaker's bird
 * to everyone in their zone room. Best effort: the line is already stored either way.
 */
async function tellTheSky(zone: unknown, room: unknown, line: { speaker: string; name: string; body: string; x: number; z: number }): Promise<void> {
  const base = process.env.SKY_RELAY_HTTP_URL;
  const secret = process.env.SKY_RELAY_SECRET;
  if (!base || !secret || !line.speaker) return;
  if (typeof zone !== 'string' || !/^(court|c-?\d{1,2}_-?\d{1,2})$/.test(zone)) return;
  if (typeof room !== 'number' || !Number.isInteger(room) || room < 1 || room > 12) return;
  try {
    await fetch(`${base.replace(/\/+$/, '')}/say/${zone}/${room}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-relay-secret': secret },
      body: JSON.stringify(line),
      signal: AbortSignal.timeout(2_000),
    });
  } catch {
    // the relay is down or slow: the line is still stored
  }
}
