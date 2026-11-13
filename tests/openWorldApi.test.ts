import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import flowers from '../api/flowers';
import chat from '../api/chat';
import moderate from '../api/moderate';
import settings from '../api/settings';
import { forgetQuiet } from '../api/_lib/quiet';

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
  forgetQuiet();
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
    await flowers(request('POST', '/api/flowers', { name: '陳太', message: '想念宏福苑的街坊', kind: 'lily', x: 10, y: 6.5, z: 20 }), res);
    const result = await done;
    expect(result.status).toBe(201);
    expect(result.body.messageStatus).toBe('pending');
    const insert = calls.find(call => call.init.method === 'POST')!;
    const sent = JSON.parse(String(insert.init.body));
    expect(sent).toMatchObject({ name: '陳太', message: '想念宏福苑的街坊', message_status: 'pending', kind: 'lily' });
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

  it('lists only visible flowers, hides words that are not approved, and never passes on the sender hash', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify([
        { id: 'a', created_at: 't', name: '甲', message: '想念你', message_status: 'pending', kind: 'lily', x: 1, y: 2, z: 3, sender_hash: 'abc' },
        { id: 'b', created_at: 't', name: '乙', message: '一路好走', message_status: 'approved', kind: 'white-chrysanthemum', x: 1, y: 2, z: 3, sender_hash: 'abc~white-rose' },
      ]), { status: 200 });
    }));
    const { res, done } = response();
    await flowers(request('GET', '/api/flowers'), res);
    const result = await done;
    expect(result.status).toBe(200);
    expect(calls[0].url).toContain('/memorial_flowers?');
    expect(calls[0].url).toContain('hidden=eq.false');
    expect(result.body.flowers).toEqual([
      { id: 'a', created_at: 't', name: '甲', message: '', kind: 'lily', x: 1, y: 2, z: 3 },
      { id: 'b', created_at: 't', name: '乙', message: '一路好走', kind: 'white-rose', x: 1, y: 2, z: 3 },
    ]);
  });

  it('stores a later white flower in a form the first table accepts, and still counts it for the sender', async () => {
    const { res, done } = response();
    await flowers(request('POST', '/api/flowers', { name: '甲', kind: 'white-rose', x: 10, y: 6, z: 20 }), res);
    const result = await done;
    expect(result.status).toBe(201);
    expect((result.body.flower as Record<string, unknown>).kind).toBe('white-rose');
    const insert = calls.find(call => call.init.method === 'POST')!;
    const sent = JSON.parse(insert.init.body as string) as Record<string, string>;
    expect(sent.kind).toBe('white-chrysanthemum');
    expect(sent.sender_hash).toMatch(/^[0-9a-f]{32}~white-rose$/);
    expect(calls[0].url).toContain('sender_hash=like.');
    // A first-table kind is stored as it is.
    calls.length = 0;
    const lily = response();
    await flowers(request('POST', '/api/flowers', { kind: 'lily', x: 10, y: 6, z: 20 }), lily.res);
    await lily.done;
    const plain = JSON.parse(calls.find(call => call.init.method === 'POST')!.init.body as string) as Record<string, string>;
    expect(plain.kind).toBe('lily');
    expect(plain.sender_hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('reports a clear error when storage is not configured', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { res, done } = response();
    await flowers(request('GET', '/api/flowers'), res);
    expect((await done).status).toBe(503);
  });
});

describe('one-tap words', () => {
  it('are shared at once, while words written freely wait to be read', async () => {
    const preset = response();
    await flowers(request('POST', '/api/flowers', { name: '甲', message: '我們會記得你們', kind: 'lily', x: 10, y: 6, z: 20 }), preset.res);
    const presetResult = await preset.done;
    expect(presetResult.status).toBe(201);
    expect(presetResult.body.messageStatus).toBe('approved');
    expect((presetResult.body.flower as Record<string, unknown>).message).toBe('我們會記得你們');
    expect(JSON.parse(String(calls.filter(call => call.init.method === 'POST').pop()?.init.body))).toMatchObject({ message_status: 'approved' });

    const free = response();
    await flowers(request('POST', '/api/flowers', { name: '甲', message: '想念你', kind: 'lily', x: 10, y: 6, z: 20 }), free.res);
    const freeResult = await free.done;
    expect(freeResult.body.messageStatus).toBe('pending');
    expect((freeResult.body.flower as Record<string, unknown>).message).toBe('');
  });

  it('turns a slogan away before anything is stored', async () => {
    const { res, done } = response();
    await chat(request('POST', '/api/chat', { name: '甲', body: '光復香港 時代革命' }), res);
    const result = await done;
    expect(result.status).toBe(422);
    expect(result.body.error).toBe('這裡是悼念的地方，請不要寫口號或政治訴求。');
    expect(calls.filter(call => call.init.method === 'POST')).toHaveLength(0);
  });
});

describe('chat API', () => {
  it('stores a filtered line', async () => {
    const { res, done } = response();
    await chat(request('POST', '/api/chat', { name: '阿明', body: '願你們安息', x: 3, z: 4 }), res);
    expect((await done).status).toBe(201);
  });

  it('stores which bird said it, so the line can show over that bird', async () => {
    const { res, done } = response();
    await chat(request('POST', '/api/chat', { name: '阿明', body: '願你們安息', x: 3, z: 4, speaker: 'abcd1234-ef56' }), res);
    expect((await done).status).toBe(201);
    const insert = calls.find(call => call.init.method === 'POST');
    expect(JSON.parse(String(insert?.init.body))).toMatchObject({ speaker: 'abcd1234-ef56', body: '願你們安息' });
  });

  it('ignores a malformed speaker id and still takes the line without it when the column is missing', async () => {
    const { res, done } = response();
    await chat(request('POST', '/api/chat', { name: '阿明', body: '一路好走', speaker: '<script>' }), res);
    expect((await done).status).toBe(201);
    expect(JSON.parse(String(calls.find(call => call.init.method === 'POST')?.init.body))).not.toHaveProperty('speaker');

    calls.length = 0;
    let posts = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if ((init.headers as Record<string, string>)?.Prefer === 'count=exact') {
        return new Response('[]', { status: 206, headers: { 'content-range': '0-0/0' } });
      }
      if (init.method !== 'POST') return new Response('[]', { status: 200 });
      posts += 1;
      return posts === 1 ? new Response('{"code":"PGRST204"}', { status: 400 }) : new Response('', { status: 201 });
    }));
    const second = response();
    await chat(request('POST', '/api/chat', { name: '阿明', body: '願家人平安', speaker: 'abcd1234-ef56' }), second.res);
    expect((await second.done).status).toBe(201);
    const inserts = calls.filter(call => call.init.method === 'POST').map(call => JSON.parse(String(call.init.body)));
    expect(inserts).toHaveLength(2);
    expect(inserts[1]).not.toHaveProperty('speaker');
  });

  it('slows down rapid senders', async () => {
    counts = [1, 1];
    const { res, done } = response();
    await chat(request('POST', '/api/chat', { name: '阿明', body: '願你們安息' }), res);
    expect((await done).status).toBe(429);
  });
});

describe('ready-made lines and the quiet switch', () => {
  const moderator = { authorization: 'Bearer moderator-token-0123456789' };
  const quietOn = (on: boolean): void => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if ((init.headers as Record<string, string>)?.Prefer === 'count=exact') {
        return new Response('[]', { status: 206, headers: { 'content-range': '0-0/0' } });
      }
      if (url.includes('sender_hash=eq.moderator-quiet-switch')) return new Response(JSON.stringify([{ body: on ? 'quiet:on' : 'quiet:off' }]), { status: 200 });
      if (url.includes('memorial_flowers?')) {
        return new Response(JSON.stringify([{ id: 'a', created_at: 't', name: '甲', message: '想念你', message_status: 'approved', kind: 'lily', x: 1, y: 2, z: 3, sender_hash: 'abc' }]), { status: 200 });
      }
      return new Response('', { status: 201 });
    }));
  };

  it('says only the ready-made lines over the birds', async () => {
    const { res, done } = response();
    await chat(request('POST', '/api/chat', { name: '阿明', body: '大家好' }), res);
    const result = await done;
    expect(result.status).toBe(422);
    expect(calls.some(call => call.init.method === 'POST')).toBe(false);
  });

  it('when quiet, refuses lines and holds back every flower word, but keeps the flowers', async () => {
    quietOn(true);
    const said = response();
    await chat(request('POST', '/api/chat', { name: '阿明', body: '願你們安息' }), said.res);
    expect((await said.done).status).toBe(423);
    forgetQuiet();
    const listed = response();
    await flowers(request('GET', '/api/flowers'), listed.res);
    const result = await listed.done;
    expect(result.body.flowers).toEqual([{ id: 'a', created_at: 't', name: '甲', message: '', kind: 'lily', x: 1, y: 2, z: 3 }]);
  });

  it('the moderator turns the switch on and off; visitors can read its state', async () => {
    quietOn(false);
    const switched = response();
    await moderate(request('POST', '/api/moderate', { action: 'quiet', on: true }, moderator), switched.res);
    const result = await switched.done;
    expect(result.status).toBe(200);
    expect(result.body.quiet).toBe(true);
    const insert = JSON.parse(String(calls.find(call => call.init.method === 'POST')!.init.body)) as Record<string, unknown>;
    expect(insert).toMatchObject({ body: 'quiet:on', hidden: true, sender_hash: 'moderator-quiet-switch' });
    const read = response();
    await settings(request('GET', '/api/settings'), read.res);
    expect((await read.done).body).toEqual({ quiet: true });
    const refused = response();
    await moderate(request('POST', '/api/moderate', { action: 'quiet', on: 'yes' }, moderator), refused.res);
    expect((await refused.done).status).toBe(422);
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
