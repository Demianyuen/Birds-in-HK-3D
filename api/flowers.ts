import type { ServerResponse } from 'node:http';
import {
  checkMessage,
  checkName,
  insideMemorialGround,
  isFlowerKind,
  rejectReasonText,
} from '../src/openWorld/contentRules.js';
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

/** Per visitor: at most 3 flowers in 10 minutes. Whole site: 300 in 10 minutes. */
const PER_SENDER_LIMIT = 3;
const SITE_LIMIT = 300;
const WINDOW_SECONDS = 600;

/**
 * GET  /api/flowers → every visible flower (approved messages only).
 * POST /api/flowers { name, message, kind, x, y, z } → lays a flower at once;
 *      a written message is held for moderation before anyone else sees it.
 */
export default async function handler(req: ApiRequest, res: ServerResponse): Promise<void> {
  try {
    const config = supabaseConfig();
    if (req.method === 'GET') {
      const response = await rest(
        config,
        'memorial_flowers_public?select=id,created_at,name,message,kind,x,y,z&order=created_at.desc&limit=3000',
      );
      sendJson(res, 200, { flowers: await response.json() }, 10);
      return;
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      throw new ApiError(405, 'Method not allowed.');
    }

    const body = await readJson(req);
    const name = checkName(body.name);
    if (!name.ok) throw new ApiError(422, `名字：${rejectReasonText(name.reason)}`);
    const message = checkMessage(body.message);
    if (!message.ok) throw new ApiError(422, `留言：${rejectReasonText(message.reason)}`);
    if (!isFlowerKind(body.kind)) throw new ApiError(422, '請選擇一種花。');
    if (!insideMemorialGround(body.x, body.z)) throw new ApiError(422, '花只可以放在宏福苑一帶的地面。');
    if (typeof body.y !== 'number' || !Number.isFinite(body.y) || body.y < -20 || body.y > 300) {
      throw new ApiError(422, '未能確定放花的位置。');
    }

    const sender = senderHash(req);
    const since = encodeURIComponent(isoSecondsAgo(WINDOW_SECONDS));
    const [mine, everyone] = await Promise.all([
      countRows(config, 'memorial_flowers', `sender_hash=eq.${sender}&created_at=gte.${since}`),
      countRows(config, 'memorial_flowers', `created_at=gte.${since}`),
    ]);
    if (mine >= PER_SENDER_LIMIT) throw new ApiError(429, '你剛剛已經放了幾朵花，請稍後再放。');
    if (everyone >= SITE_LIMIT) throw new ApiError(429, '這一刻有很多人在放花，請稍後再試。');

    const messageStatus = message.text ? 'pending' : 'none';
    const response = await rest(config, 'memorial_flowers?select=id,created_at,kind,x,y,z', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: {
        name: name.text,
        message: message.text,
        message_status: messageStatus,
        kind: body.kind,
        x: Math.round((body.x as number) * 100) / 100,
        z: Math.round((body.z as number) * 100) / 100,
        y: Math.round((body.y as number) * 100) / 100,
        sender_hash: sender,
      },
    });
    const [row] = (await response.json()) as Array<Record<string, unknown>>;
    sendJson(res, 201, { flower: { ...row, name: name.text, message: '' }, messageStatus });
  } catch (error) {
    sendError(res, error);
  }
}
