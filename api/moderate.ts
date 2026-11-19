import { readKind } from './_lib/flowerKinds.js';
import { NOT_SHARED_SUFFIX, SWITCH_SENDERS, readQuiet, readSpeechLive, writeQuiet, writeSpeechLive } from './_lib/quiet.js';
import { flowersToGather, type FlowerSpot } from '../src/openWorld/gatherFlowers.js';
import { MEMORIAL_CENTRE } from '../src/openWorld/contentRules.js';
import { checkTotp, issueSession } from './_lib/totp.js';
import { DONE_SUFFIX, FEEDBACK_PREFIX, joinFeedback, onlyChatFilter, REPORT_KINDS, REPORT_PREFIX, type StoredRow } from './_lib/monitor.js';
import type { ServerResponse } from 'node:http';
import {
  ApiError,
  checkModeratorPassword,
  countRows,
  isoSecondsAgo,
  readJson,
  requireModerator,
  rest,
  sendError,
  sendJson,
  supabaseConfig,
  type ApiRequest,
} from './_lib/openWorld.js';

type Action = 'approve' | 'reject' | 'hide-flower' | 'hide-chat' | 'share-chat' | 'speech' | 'quiet' | 'gather-flowers' | 'feedback-done';
const ACTIONS: readonly Action[] = ['approve', 'reject', 'hide-flower', 'hide-chat', 'share-chat', 'speech', 'quiet', 'gather-flowers', 'feedback-done'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Sign in: POST /api/moderate?login=1 (Bearer password, body { code } when two-step sign-in is on) → { session }.
 * Everything else is moderator-only (Authorization: Bearer password, or the session with two-step sign-in).
 * GET  /api/moderate?view=pending → messages waiting for approval
 * GET  /api/moderate?view=chat    → the last day of live chat
 * GET  /api/moderate?view=shared  → words already shared (to take one back)
 * POST /api/moderate { action, id } → approve / reject a message, hide a flower or a chat line
 * POST /api/moderate { action: 'gather-flowers', move } → flowers left on a former square: how many (move: false) or move them to the present one
 * POST /api/moderate { action: 'share-chat', id } → share a held line · { action: 'speech', live } → hold lines (default) or show them at once
 * POST /api/moderate { action: 'quiet', on } → the quiet switch (every quiet:on/off reply carries { quiet })
 */
export default async function handler(req: ApiRequest, res: ServerResponse): Promise<void> {
  try {
    if (req.method === 'POST' && (req.url ?? '').includes('login=1')) {
      // Signing in: the password, plus a code from the authenticator app when two-step sign-in is on.
      const password = checkModeratorPassword(req);
      const secret = process.env.MODERATOR_TOTP_SECRET?.trim();
      if (!secret) {
        sendJson(res, 200, { ok: true, twoStep: false });
        return;
      }
      const body = await readJson(req);
      const code = typeof body.code === 'string' ? body.code.replace(/\s/g, '') : '';
      if (!code) {
        sendJson(res, 200, { ok: true, twoStep: true, needCode: true });
        return;
      }
      if (!checkTotp(secret, code)) throw new ApiError(401, '驗證碼不正確或已過期。');
      sendJson(res, 200, { ok: true, twoStep: true, session: issueSession(password, secret) });
      return;
    }
    requireModerator(req);
    const config = supabaseConfig();
    if (req.method === 'GET') {
      const view = new URL(req.url ?? '/', 'http://vercel.local').searchParams.get('view');
      const quiet = await readQuiet(config);
      const speechLive = await readSpeechLive(config);
      if (view === 'status') {
        sendJson(res, 200, { status: await readStatus(config), quiet, speechLive });
        return;
      }
      if (view === 'feedback') {
        const response = await rest(config, `memorial_chat?select=id,created_at,name,body,sender_hash&sender_hash=like.${FEEDBACK_PREFIX}*&order=created_at.desc&limit=400`);
        sendJson(res, 200, { feedback: joinFeedback((await response.json()) as StoredRow[]), quiet, speechLive });
        return;
      }
      if (view === 'chat') {
        const response = await rest(config, `memorial_chat?select=id,created_at,name,body,hidden,sender_hash&${onlyChatFilter(SWITCH_SENDERS)}&order=created_at.desc&limit=200`);
        const rows = (await response.json()) as Array<{ hidden: boolean; sender_hash: string } & Record<string, unknown>>;
        // waiting: held, not yet read · shown: others can see it · hidden: a moderator kept it back
        const chat = rows.map(({ sender_hash: hash, ...row }) => ({
          ...row,
          state: !row.hidden ? 'shown' : hash.endsWith(NOT_SHARED_SUFFIX) ? 'hidden' : 'waiting',
        }));
        sendJson(res, 200, { chat, quiet, speechLive });
        return;
      }
      if (view === 'shared') {
        const response = await rest(
          config,
          'memorial_flowers?select=id,created_at,name,message,kind,sender_hash&message_status=eq.approved&hidden=eq.false&order=created_at.desc&limit=200',
        );
        const rows = (await response.json()) as Array<Record<string, unknown>>;
        sendJson(res, 200, { shared: rows.map(({ sender_hash: _hash, ...row }) => ({ ...row, kind: readKind({ kind: row.kind, sender_hash: _hash }) })), quiet, speechLive });
        return;
      }
      const response = await rest(
        config,
        'memorial_flowers?select=id,created_at,name,message,kind,hidden,sender_hash&message_status=eq.pending&order=created_at.asc&limit=200',
      );
      const rows = (await response.json()) as Array<Record<string, unknown>>;
      sendJson(res, 200, { pending: rows.map(({ sender_hash: _hash, ...row }) => ({ ...row, kind: readKind({ kind: row.kind, sender_hash: _hash }) })), quiet, speechLive });
      return;
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      throw new ApiError(405, 'Method not allowed.');
    }
    const body = await readJson(req);
    const action = body.action as Action;
    if (!ACTIONS.includes(action)) throw new ApiError(422, 'Unknown action.');
    if (action === 'quiet') {
      if (typeof body.on !== 'boolean') throw new ApiError(422, 'Say on: true or false.');
      await writeQuiet(config, body.on);
      sendJson(res, 200, { ok: true, quiet: body.on });
      return;
    }
    if (action === 'gather-flowers') {
      const response = await rest(config, 'memorial_flowers?select=id,x,z&order=created_at.desc&limit=5000');
      const moves = flowersToGather((await response.json()) as FlowerSpot[]);
      if (body.move === true) {
        for (let start = 0; start < moves.length; start += 20) {
          await Promise.all(moves.slice(start, start + 20).map(move => rest(
            config,
            `memorial_flowers?id=eq.${move.id}`,
            { method: 'PATCH', body: { x: move.x, z: move.z, y: move.y }, headers: { Prefer: 'return=minimal' } },
          )));
        }
      }
      sendJson(res, 200, { ok: true, count: moves.length, moved: body.move === true });
      return;
    }
    if (action === 'feedback-done') {
      // Mark every part of one message as dealt with.
      if (typeof body.id !== 'string' || !/^[A-Za-z0-9-]{6,40}$/.test(body.id)) throw new ApiError(422, 'Invalid feedback id.');
      const found = await rest(config, `memorial_chat?select=id,sender_hash&sender_hash=like.${FEEDBACK_PREFIX}${body.id}:*`);
      const rows = (await found.json()) as Array<{ id: number; sender_hash: string }>;
      for (const row of rows) {
        if (row.sender_hash.endsWith(DONE_SUFFIX)) continue;
        await rest(config, `memorial_chat?id=eq.${row.id}`, { method: 'PATCH', body: { sender_hash: `${row.sender_hash}${DONE_SUFFIX}` }, headers: { Prefer: 'return=minimal' } });
      }
      sendJson(res, 200, { ok: true });
      return;
    }
    if (action === 'speech') {
      if (typeof body.live !== 'boolean') throw new ApiError(422, 'Invalid speech switch.');
      await writeSpeechLive(config, body.live);
      sendJson(res, 200, { ok: true, speechLive: body.live });
      return;
    }
    if (action === 'share-chat') {
      // A held line becomes a fresh visible line, so visitors who are there now receive it;
      // marked as shared words (no bird to show it over any more).
      if (!Number.isSafeInteger(body.id)) throw new ApiError(422, 'Invalid chat id.');
      const found = await rest(config, `memorial_chat?select=name,body,x,z,sender_hash,hidden&id=eq.${body.id}&limit=1`);
      const [held] = (await found.json()) as Array<{ name: string; body: string; x: number; z: number; sender_hash: string; hidden: boolean }>;
      if (!held || !held.hidden || SWITCH_SENDERS.includes(held.sender_hash)) throw new ApiError(404, '找不到這句話。');
      const speaker = `shared-${body.id}`.slice(0, 40).padEnd(8, '0');
      const fresh = { name: held.name, body: held.body, x: held.x, z: held.z, sender_hash: held.sender_hash.replace(NOT_SHARED_SUFFIX, ''), speaker };
      await rest(config, 'memorial_chat', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: fresh });
      await rest(config, `memorial_chat?id=eq.${body.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      // With the sky relay, visitors do not listen to the table: send the shared line to every room of its zone.
      await shareThroughRelay({ speaker, name: held.name, body: held.body, x: held.x, z: held.z });
      sendJson(res, 200, { ok: true });
      return;
    }
    if (action === 'hide-chat') {
      if (!Number.isSafeInteger(body.id)) throw new ApiError(422, 'Invalid chat id.');
      const found = await rest(config, `memorial_chat?select=sender_hash&id=eq.${body.id}&limit=1`);
      const [line] = (await found.json()) as Array<{ sender_hash: string }>;
      if (!line || SWITCH_SENDERS.includes(line.sender_hash)) throw new ApiError(404, '找不到這句話。');
      const kept = line.sender_hash.endsWith(NOT_SHARED_SUFFIX) ? line.sender_hash : `${line.sender_hash}${NOT_SHARED_SUFFIX}`;
      await rest(config, `memorial_chat?id=eq.${body.id}`, { method: 'PATCH', body: { hidden: true, sender_hash: kept }, headers: { Prefer: 'return=minimal' } });
    } else {
      if (typeof body.id !== 'string' || !UUID.test(body.id)) throw new ApiError(422, 'Invalid flower id.');
      const patch = action === 'approve' ? { message_status: 'approved' }
        : action === 'reject' ? { message_status: 'rejected' }
          : { hidden: true };
      await rest(config, `memorial_flowers?id=eq.${body.id}`, { method: 'PATCH', body: patch, headers: { Prefer: 'return=minimal' } });
    }
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendError(res, error);
  }
}

const ZONE_CELL = 800;
const COURT_ZONE_RADIUS = 420;
const MAX_ROOMS = 12;

/** Same zones as src/openWorld/zones.ts. */
function zoneAt(x: number, z: number): string {
  if (Math.hypot(x - MEMORIAL_CENTRE.x, z - MEMORIAL_CENTRE.z) <= COURT_ZONE_RADIUS) return 'court';
  return `c${Math.floor(x / ZONE_CELL)}_${Math.floor(z / ZONE_CELL)}`;
}

async function shareThroughRelay(line: { speaker: string; name: string; body: string; x: number; z: number }): Promise<void> {
  const base = process.env.SKY_RELAY_HTTP_URL;
  // A line break or space picked up when the secret was pasted must not make it differ.
  const secret = process.env.SKY_RELAY_SECRET?.trim();
  if (!base || !secret) return;
  const zone = zoneAt(line.x, line.z);
  await Promise.all(Array.from({ length: MAX_ROOMS }, (_, index) => fetch(`${base.replace(/\/+$/, '')}/say/${zone}/${index + 1}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-relay-secret': secret },
    body: JSON.stringify(line),
    signal: AbortSignal.timeout(2_000),
  }).catch(() => undefined)));
}

interface Check { ok: boolean; note: string }

async function timed<T>(work: () => Promise<T>): Promise<{ value?: T; ms: number; error?: string }> {
  const start = Date.now();
  try {
    return { value: await work(), ms: Date.now() - start };
  } catch (error) {
    return { ms: Date.now() - start, error: (error as Error).message };
  }
}

/** Everything the moderator needs at a glance: is each part working, how busy, what went wrong lately. */
async function readStatus(config: ReturnType<typeof supabaseConfig>) {
  const day = isoSecondsAgo(86_400);
  const hour = isoSecondsAgo(3_600);
  const database = await timed(() => countRows(config, 'memorial_flowers', 'hidden=eq.false'));
  const [flowersToday, waiting, chatHour, reportRows, feedbackRows] = await Promise.all([
    countRows(config, 'memorial_flowers', `created_at=gte.${day}`).catch(() => -1),
    countRows(config, 'memorial_flowers', 'message_status=eq.pending&hidden=eq.false').catch(() => -1),
    countRows(config, 'memorial_chat', `${onlyChatFilter(SWITCH_SENDERS)}&created_at=gte.${hour}`).catch(() => -1),
    rest(config, `memorial_chat?select=created_at,body,sender_hash&sender_hash=like.${REPORT_PREFIX}*&created_at=gte.${day}&order=created_at.desc&limit=1000`)
      .then(response => response.json() as Promise<Array<{ created_at: string; body: string; sender_hash: string }>>).catch(() => []),
    rest(config, `memorial_chat?select=id,created_at,name,body,sender_hash&sender_hash=like.${FEEDBACK_PREFIX}*&order=created_at.desc&limit=400`)
      .then(response => response.json() as Promise<StoredRow[]>).catch(() => []),
  ]);
  const problems = Object.entries(REPORT_KINDS).map(([kind, label]) => {
    const rows = reportRows.filter(row => row.sender_hash === `${REPORT_PREFIX}${kind}`);
    return {
      kind, label, day: rows.length,
      hour: rows.filter(row => row.created_at >= hour).length,
      latest: rows.slice(0, 3).map(row => ({ at: row.created_at, detail: row.body })),
    };
  });
  const relay = await readRelay();
  const databaseCheck: Check = database.error
    ? { ok: false, note: `未能連上資料庫：${database.error}` }
    : { ok: true, note: `正常（${database.ms} 毫秒）` };
  return {
    checkedAt: new Date().toISOString(),
    version: (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || '本機',
    database: databaseCheck,
    relay,
    counts: {
      flowers: database.value ?? -1,
      flowersToday,
      waiting,
      chatHour,
      feedbackNew: joinFeedback(feedbackRows).filter(item => !item.done).length,
    },
    problems,
  };
}

async function readRelay(): Promise<Check & { birds: number | null }> {
  const base = process.env.SKY_RELAY_HTTP_URL?.replace(/\/+$/, '');
  // A line break or space picked up when the secret was pasted must not make it differ.
  const secret = process.env.SKY_RELAY_SECRET?.trim();
  if (!base || !base.startsWith('https://')) return { ok: true, birds: null, note: '未設定，使用 Supabase 連線（約五、六隻鳥同時可見）' };
  const root = await timed(() => fetch(`${base}/`, { signal: AbortSignal.timeout(4_000) }).then(response => response.text()));
  if (root.error || !root.value?.includes('sky relay')) return { ok: false, birds: null, note: `連不上中繼伺服器${root.error ? `：${root.error}` : ''}` };
  if (!secret) return { ok: false, birds: null, note: '網站未設定 SKY_RELAY_SECRET' };
  const counts = await Promise.all(Array.from({ length: 12 }, (_, index) => fetch(`${base}/count/court/${index + 1}`, {
    headers: { 'x-relay-secret': secret }, signal: AbortSignal.timeout(4_000),
  }).then(async response => ({ status: response.status, birds: response.ok ? Number(((await response.json()) as { birds?: number }).birds ?? 0) : 0 }))
    .catch(() => ({ status: 0, birds: 0 }))));
  if (counts.some(count => count.status === 403)) return { ok: false, birds: null, note: '密語不一致：Cloudflare 的 RELAY_SECRET 和 Vercel 的 SKY_RELAY_SECRET 要完全相同' };
  if (counts.every(count => count.status === 404)) return { ok: true, birds: null, note: `正常（${root.ms} 毫秒）；中繼伺服器版本較舊，未能數鳥` };
  return { ok: true, birds: counts.reduce((sum, count) => sum + count.birds, 0), note: `正常（${root.ms} 毫秒）` };
}
