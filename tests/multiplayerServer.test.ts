import { once } from 'node:events';
import WebSocket from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { startWorldServer } from '../server/worldServer';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const server = await startWorldServer({ port: 0, host: '127.0.0.1', origins: ['http://localhost:5173'] });
  cleanups.push(server.close);
  async function client(room = 'tai-po') {
    const ws = new WebSocket(server.url, { origin: 'http://localhost:5173' });
    const queue: Record<string, any>[] = [];
    ws.on('message', data => queue.push(JSON.parse(data.toString())));
    await once(ws, 'open');
    cleanups.push(async () => { ws.terminate(); });
    ws.send(JSON.stringify({ type: 'join', room, name: '白鴿' }));
    async function next(type: string, predicate = (_: Record<string, any>) => true) {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const index = queue.findIndex(message => message.type === type && predicate(message));
        if (index >= 0) return queue.splice(index, 1)[0];
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error(`Missing message: ${type}`);
    }
    return { ws, next, queue };
  }
  return { server, client };
}

describe('real multiplayer connections', () => {
  it('revokes a guest resume credential on explicit leave', async () => {
    const { server, client } = await setup();
    const a = await client();
    const welcome = await a.next('welcome');
    a.ws.send(JSON.stringify({ type: 'leave' }));
    await once(a.ws, 'close');
    const socket = new WebSocket(server.url, { origin: 'http://localhost:5173' });
    cleanups.push(async () => { socket.terminate(); });
    await once(socket, 'open');
    const reply = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'join', room: 'tai-po', name: '甲', resumeToken: welcome.resumeToken }));
    const [data] = await reply;
    expect(JSON.parse(data.toString()).code).toBe('session_expired');
  });
  it('assigns distinct identities, synchronizes movement, delivers chat and removes disconnected players', async () => {
    const { client } = await setup();
    const a = await client();
    const first = await a.next('welcome');
    const b = await client();
    const second = await b.next('welcome');
    expect(first.id).not.toBe(second.id);
    const joined = await b.next('snapshot', event => event.players.length === 2);
    expect(joined.players.map((player: { id: string }) => player.id)).toContain(first.id);
    a.ws.send(JSON.stringify({ type: 'pose', sequence: 1, position: [1, 220, 320], quaternion: [0, 0, 0, 1], perched: false }));
    const moved = await b.next('snapshot', event => event.players.some((player: any) => player.id === first.id && player.position[0] === 1));
    expect(moved.players.find((player: any) => player.id === first.id).position).toEqual([1, 220, 320]);
    a.ws.send(JSON.stringify({ type: 'chat', text: '你好香港', scope: 'room', id: second.id }));
    const chat = await b.next('chat');
    expect(chat.senderId).toBe(first.id);
    expect(chat.text).toBe('你好香港');
    a.ws.close();
    const left = await b.next('snapshot', event => event.players.length === 1);
    expect(left.players[0].id).toBe(second.id);
  });

  it('rejects teleportation, malformed packets, and repeated chat without disconnecting healthy peers', async () => {
    const { client } = await setup();
    const a = await client();
    await a.next('welcome');
    a.ws.send('{');
    expect((await a.next('error')).code).toBe('invalid_message');
    a.ws.send(JSON.stringify({ type: 'pose', sequence: 1, position: [3000, 220, 320], quaternion: [0, 0, 0, 1], perched: false }));
    expect((await a.next('error')).code).toBe('invalid_pose');
    a.ws.send(JSON.stringify({ type: 'chat', text: 'hello', scope: 'room' }));
    await a.next('chat');
    a.ws.send(JSON.stringify({ type: 'chat', text: 'spam', scope: 'room' }));
    expect((await a.next('error')).code).toBe('chat_rate_limited');
    a.ws.send(JSON.stringify({ type: 'join', room: 'tai-po', name: 'replacement' }));
    expect((await a.next('error')).code).toBe('already_joined');
  });

  it('serves health without exposing chat or credentials and rejects unapproved browser origins', async () => {
    const { server } = await setup();
    const health = await fetch(server.url.replace('ws:', 'http:').replace('/world', '/health'));
    expect(await health.json()).toEqual({ status: 'ok', players: 0, rooms: 0, protocol: 2 });
    const ws = new WebSocket(server.url, { origin: 'https://unapproved.example' });
    const [, response] = await once(ws, 'unexpected-response');
    expect(response.statusCode).toBe(403);
    ws.on('error', () => undefined);
    ws.terminate();
  });

  it('isolates rooms and permits a disconnected guest to join a fresh session', async () => {
    const { client } = await setup();
    const a = await client('tai-po');
    const old = await a.next('welcome');
    const b = await client('tai-po-private');
    await b.next('welcome');
    a.ws.send(JSON.stringify({ type: 'chat', text: 'room only', scope: 'room' }));
    await a.next('chat');
    const otherRoom = await b.next('snapshot');
    expect(otherRoom.players).toHaveLength(1);
    expect(otherRoom.players[0].id).not.toBe(old.id);
    expect(b.queue.some(event => event.type === 'chat')).toBe(false);
    a.ws.close();
    await once(a.ws, 'close');
    const reconnected = await client('tai-po');
    const fresh = await reconnected.next('welcome');
    expect(fresh.id).not.toBe(old.id);
    const snapshot = await reconnected.next('snapshot');
    expect(snapshot.players).toHaveLength(1);
    expect(snapshot.players[0].id).toBe(fresh.id);
  });
});
