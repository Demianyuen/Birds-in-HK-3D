import { afterEach, expect, it } from 'vitest';
import { WebSocket as NodeSocket } from 'ws';
import { startWorldServer } from '../server/worldServer';
import { WorldClient } from '../src/multiplayer/WorldClient';
import type { ServerMessage } from '../src/multiplayer/protocol';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

it('connects real clients, excludes self from peers and sends chat only when joined', async () => {
  const server = await startWorldServer({ port: 0, host: '127.0.0.1', origins: ['http://localhost:5173'] });
  cleanups.push(server.close);
  const inbox: ServerMessage[] = [];
  const factory = (url: string) => new NodeSocket(url, { origin: 'http://localhost:5173' }) as unknown as WebSocket;
  const a = new WorldClient(() => undefined, () => undefined, factory);
  const b = new WorldClient(message => inbox.push(message), () => undefined, factory);
  cleanups.push(() => a.disconnect(), () => b.disconnect());
  expect(a.chat('hello', 'room')).toBe(false);
  a.connect(server.url, '甲', 'tai-po');
  b.connect(server.url, '乙', 'tai-po');
  await expect.poll(() => a.joined && b.joined).toBe(true);
  expect(a.id).not.toBe(b.id);
  await expect.poll(() => b.peers.length).toBe(1);
  expect(b.peers[0].id).toBe(a.id);
  expect(a.chat('<b>純文字</b>', 'room')).toBe(true);
  await expect.poll(() => inbox.some(message => message.type === 'chat' && message.text === '<b>純文字</b>')).toBe(true);
  a.disconnect();
  await expect.poll(() => b.peers.length).toBe(0);
  expect(a.joined).toBe(false);
});

it('automatically resumes a dropped transport with the same guest identity and pose', async () => {
  const server = await startWorldServer({ port: 0, host: '127.0.0.1', origins: ['http://localhost:5173'] });
  cleanups.push(server.close);
  const transports: NodeSocket[] = [];
  const welcomes: Extract<ServerMessage, { type: 'welcome' }>[] = [];
  const client = new WorldClient(message => { if (message.type === 'welcome') welcomes.push(message); }, () => undefined, url => {
    const socket = new NodeSocket(url, { origin: 'http://localhost:5173' });
    transports.push(socket);
    return socket as unknown as WebSocket;
  });
  cleanups.push(() => client.disconnect());
  client.connect(server.url, '甲', 'tai-po');
  await expect.poll(() => client.joined).toBe(true);
  const id = client.id;
  client.pose([1, 220, 320], [0, 0, 0, 1], false);
  await new Promise(resolve => setTimeout(resolve, 150));
  transports[0].terminate();
  await expect.poll(() => welcomes.length, { timeout: 5000 }).toBe(2);
  expect(client.id === id).toBe(true);
  expect(welcomes[1].resumed).toBe(true);
  expect(welcomes[1].player?.position).toEqual([1, 220, 320]);
  // Resume credential must stay internal, never enter UI/event callbacks.
  expect('resumeToken' in welcomes[1]).toBe(false);
  client.disconnect();
  const connectionCount = transports.length;
  await new Promise(resolve => setTimeout(resolve, 1200));
  expect(transports.length).toBe(connectionCount);
}, 10000);
