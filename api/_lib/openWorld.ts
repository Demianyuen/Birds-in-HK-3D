import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Server-only helpers for the open-world memorial API. Files under api/_lib
 * are not routes. The service-role key never leaves the server.
 */

export interface ApiRequest extends IncomingMessage {
  body?: unknown;
}

export class ApiError extends Error {
  public constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export interface SupabaseConfig {
  url: string;
  serviceKey: string;
}

export function supabaseConfig(): SupabaseConfig {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new ApiError(503, '共享紀念服務暫未開放，請稍後再試。');
  return { url: url.replace(/\/+$/, ''), serviceKey };
}

/** PostgREST call with the service role. `path` is relative to /rest/v1/. */
export async function rest(
  config: SupabaseConfig,
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> {
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    method: init.method ?? 'GET',
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!response.ok && response.status !== 206) {
    throw new ApiError(502, `Memorial storage returned HTTP ${response.status}.`);
  }
  return response;
}

/** Number of rows matching a PostgREST filter (uses the Content-Range total). */
export async function countRows(config: SupabaseConfig, table: string, filter: string): Promise<number> {
  const response = await rest(config, `${table}?select=id&${filter}`, {
    headers: { Prefer: 'count=exact', Range: '0-0' },
  });
  const range = response.headers.get('content-range') ?? '';
  const total = Number(range.split('/')[1]);
  return Number.isFinite(total) ? total : 0;
}

/** Salted hash of the caller's IP: enough to rate-limit, not enough to identify. */
export function senderHash(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  const ip = first || req.socket?.remoteAddress || 'unknown';
  const salt = process.env.RATE_LIMIT_SALT ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'birds-in-hk';
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}

export async function readJson(req: ApiRequest): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === 'object') return req.body as Record<string, unknown>;
  if (typeof req.body === 'string') return parseObject(req.body);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 4_096) throw new ApiError(413, 'Request too large.');
    chunks.push(chunk as Buffer);
  }
  return parseObject(Buffer.concat(chunks).toString('utf8'));
}

function parseObject(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text || '{}');
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new ApiError(400, 'Expected a JSON object.');
}

export function sendJson(res: ServerResponse, status: number, body: unknown, cacheSeconds = 0): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cacheSeconds > 0
    ? `public, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 4}`
    : 'no-store');
  res.end(JSON.stringify(body));
}

export function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof ApiError) {
    sendJson(res, error.status, { error: error.message });
    return;
  }
  sendJson(res, 500, { error: 'Something went wrong. Please try again later.' });
}

/** Moderator check: Authorization: Bearer <MODERATOR_TOKEN>, compared in constant time. */
export function requireModerator(req: IncomingMessage): void {
  const expected = process.env.MODERATOR_TOKEN;
  if (!expected || expected.length < 16) throw new ApiError(503, '審核功能尚未設定。');
  const header = req.headers.authorization ?? '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ApiError(401, 'Not authorised.');
}

export function isoSecondsAgo(seconds: number): string {
  return new Date(Date.now() - seconds * 1_000).toISOString();
}
