import type { ServerResponse } from 'node:http';
import { checkChat, checkName, rejectReasonText } from '../src/openWorld/contentRules';
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
} from './_lib/openWorld';

/** One line every 3 seconds and 20 lines in 10 minutes per visitor. */
const BURST_SECONDS = 3;
const WINDOW_SECONDS = 600;
const WINDOW_LIMIT = 20;

/**
 * POST /api/chat { name, body, x, z } → filtered, rate-limited, then stored;
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
    const x = typeof body.x === 'number' && Number.isFinite(body.x) ? Math.max(-5_000, Math.min(5_000, body.x)) : 0;
    const z = typeof body.z === 'number' && Number.isFinite(body.z) ? Math.max(-5_000, Math.min(5_000, body.z)) : 0;

    const sender = senderHash(req);
    const [burst, windowCount] = await Promise.all([
      countRows(config, 'memorial_chat', `sender_hash=eq.${sender}&created_at=gte.${encodeURIComponent(isoSecondsAgo(BURST_SECONDS))}`),
      countRows(config, 'memorial_chat', `sender_hash=eq.${sender}&created_at=gte.${encodeURIComponent(isoSecondsAgo(WINDOW_SECONDS))}`),
    ]);
    if (burst > 0) throw new ApiError(429, '請慢慢說，稍等一會再發送。');
    if (windowCount >= WINDOW_LIMIT) throw new ApiError(429, '你已經說了很多，請休息一下再發送。');

    await rest(config, 'memorial_chat', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: { name: name.text || '訪客', body: line.text, x, z, sender_hash: sender },
    });
    sendJson(res, 201, { ok: true });
  } catch (error) {
    sendError(res, error);
  }
}
