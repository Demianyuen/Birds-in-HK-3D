import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import flowers from '../api/flowers';
import chat from '../api/chat';
import moderate from '../api/moderate';

interface Captured { status: number; body: Record<string, unknown>; headers: Record<string, string> }

function request(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as Readable & Record<string, unknown>;
  Object.assign(stream, { method, url, headers: { 'x-forwarded-for': '203.0.113.9', ...headers }, socket: {} });
  return stream as never;
}

function response(): { res: never; done: Promise<Captured> } {
  let resolve!: (value: Captured) => void;
  const done = new Promise<Captured>(r => { resolve = r; });
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    setHeader(name: string, value: string) { headers[name.toLowerCase()] = value; },
    end(text: string) { resolve({ status: res.statusCode, body: text ? JSON.parse(text) : {}, headers }); },
  };
  return { res: res as never, done };
}

const calls: Array<{ url: string; init: RequestInit }> = [];
let counts: number[] = [];

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  process.env.MODERATOR_TOKEN = 'moderator-token-0123456789';
  calls.length = 0;
  counts = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const headers = new Headers();
    if ((init.headers as Record<string, string>)?.Prefer === 'count=exact') {
      headers.set('content-range', `0-0/${counts.shift() ?? 0}`);
      return new Response('[]', { status: 206, headers });
    }
    if (init.method === 'POST') return new Response(JSON.stringify([{ id: 'f1', created_at: 'now', kind: 'lily', x: 1, z: 2 }]), { status: 201 });
    return new Response('[]', { status: 200 });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.MODERATOR_TOKEN;
});

describe('flowers API', () => {
  it('lays a flower at once and holds its message for moderation', async () => {
    const { res, done } = response();
    await flowers(request('POST', '/api/flowers', { name: '陳太', message: '願你們安息', kind: 'lily', x: 10, y: 6.5, z: 20 }), res);
    const result = await done;
    expect(result.status).toBe(201);
    expect(result.body.messageStatus).toBe('pending');
    const insert = calls.find(call => call.init.method === 'POST')!;
    const sent = JSON.parse(String(insert.init.body));
    expect(sent).toMatchObject({ name: '陳太', message: '願你們安息', message_status: 'pending', kind: 'lily' });
    // The salted IP hash is stored, never the IP itself.
    expect(sent.sender_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(sent)).not.toContain('203.0.113.9');
    // The response never echoes the unapproved message back as public content.
    expect((result.body.flower as Record<string, unknown>).message).toBe('');
    // The service key is only ever sent to Supabase.
    expect(calls.every(call => call.url.startsWith('https://example.supabase.co/rest/v1/'))).toBe(true);
  });

  it('needs no moderation for a flower without words', async () => {
    const { res, done } = response();
    await flowers(request('POST', '/api/flowers', { kind: 'white-chrysanthemum', x: 0, y: 5, z: 0 }), res);
    expect((await done).body.messageStatus).toBe('none');
  });

  it('refuses flowers away from Wang Fuk Court, unknown kinds and profanity', async () => {
    for (const body of [
      { kind: 'lily', x: 2_000, y: 5, z: 0 },
      { kind: 'rose', x: 0, y: 5, z: 0 },
      { kind: 'lily', x: 0, y: 5, z: 0, message: '仆街' },
      { kind: 'lily', x: 0, z: 0 },
    ]) {
      const { res, done } = response();
      await flowers(request('POST', '/api/flowers', body), res);
      expect((await done).status).toBe(422);
    }
    expect(calls.some(call => call.init.method === 'POST')).toBe(false);
  });

  it('rate-limits a visitor after three flowers in ten minutes', async () => {
    counts = [3, 3];
    const { res, done } = response();
    await flowers(request('POST', '/api/flowers', { kind: 'lily', x: 0, y: 5, z: 0 }), res);
    expect((await done).status).toBe(429);
  });

  it('lists flowers from the public view only', async () => {
    const { res, done } = response();
    await flowers(request('GET', '/api/flowers'), res);
    expect((await done).status).toBe(200);
    expect(calls[0].url).toContain('/memorial_flowers_public?');
  });

  it('reports a clear error when storage is not configured', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { res, done } = response();
    await flowers(request('GET', '/api/flowers'), res);
    expect((await done).status).toBe(503);
  });
});

describe('chat API', () => {
  it('stores a filtered line', async () => {
    const { res, done } = response();
    await chat(request('POST', '/api/chat', { name: '阿明', body: '大家好', x: 3, z: 4 }), res);
    expect((await done).status).toBe(201);
  });

  it('slows down rapid senders', async () => {
    counts = [1, 1];
    const { res, done } = response();
    await chat(request('POST', '/api/chat', { name: '阿明', body: '大家好' }), res);
    expect((await done).status).toBe(429);
  });
});

describe('moderation API', () => {
  it('rejects callers without the moderator token', async () => {
    const { res, done } = response();
    await moderate(request('GET', '/api/moderate?view=pending', undefined, { authorization: 'Bearer wrong-token-xxxxxxxx' }), res);
    expect((await done).status).toBe(401);
  });

  it('approves a pending message', async () => {
    const { res, done } = response();
    const id = '0b9f8a5e-1111-4222-8333-944455556666';
    await moderate(request('POST', '/api/moderate', { action: 'approve', id }, { authorization: 'Bearer moderator-token-0123456789' }), res);
    expect((await done).status).toBe(200);
    const patch = calls.find(call => call.init.method === 'PATCH')!;
    expect(patch.url).toContain(`memorial_flowers?id=eq.${id}`);
    expect(JSON.parse(String(patch.init.body))).toEqual({ message_status: 'approved' });
  });
});
