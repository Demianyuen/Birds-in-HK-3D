import { once } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';
import { startWorldServer } from './worldServer';
import type { ServerMessage } from '../src/multiplayer/protocol';
import type { WorldPlayer } from '../src/multiplayer/protocol';
import { decodeMotion } from '../src/multiplayer/motionCodec';

// Deliberately creates a loopback-only server; this script cannot target a public deployment.
const count = Number(process.env.WORLD_LOAD_PLAYERS ?? 30);
if (!Number.isInteger(count) || count < 2 || count > 100) throw new Error('WORLD_LOAD_PLAYERS must be between 2 and 100.');
const durationSeconds = Number(process.env.WORLD_LOAD_SECONDS ?? 30);
if (!Number.isInteger(durationSeconds) || durationSeconds < 10 || durationSeconds > 300) {
  throw new Error('WORLD_LOAD_SECONDS must be between 10 and 300.');
}
const server = await startWorldServer({ host: '127.0.0.1', port: 0, origins: ['http://load.local'] });
const sockets: WebSocket[] = [];
const snapshots = Array<number>(count).fill(0);
const chats = Array<number>(count).fill(0);
const finalPositions = new Map<string, number>();
const latencies: number[] = [];
const memorySamples: Array<{ elapsedSeconds: number; rssMiB: number; heapUsedMiB: number }> = [];
const errors: string[] = [];
const eventLoop = monitorEventLoopDelay({ resolution: 10 });
let disconnects = 0;
let bytesReceived = 0;
let posesSent = 0;
let chatSent = 0;
let measuring = false;
let sequence = 0;
let movement: ReturnType<typeof setInterval> | undefined;
let memoryTimer: ReturnType<typeof setInterval> | undefined;
let actualSeconds = 0;
const startedAt = new Date().toISOString();

function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

try {
  await Promise.all(Array.from({ length: count }, async (_, index) => {
    let roster: WorldPlayer[] = [];
    let revision = -1;
    const socket = new WebSocket(server.url, { origin: 'http://load.local' });
    sockets.push(socket);
    let welcomeResolve: () => void;
    let welcomeReject: (error: Error) => void;
    const welcome = new Promise<void>((resolve, reject) => { welcomeResolve = resolve; welcomeReject = reject; });
    const timeout = setTimeout(() => welcomeReject(new Error('Join timeout')), 5000);
    socket.on('error', () => { errors.push('socket_error'); welcomeReject(new Error('Socket error')); });
    socket.on('close', () => { if (measuring) disconnects++; });
    socket.on('message', data => {
      const text = Array.isArray(data) ? Buffer.concat(data).toString() : data.toString();
      const message = JSON.parse(text) as ServerMessage;
      if (message.type === 'welcome') { clearTimeout(timeout); welcomeResolve(); }
      if (message.type === 'error') { errors.push(message.code); welcomeReject(new Error(message.code)); }
      let frame = false;
      if (message.type === 'snapshot') {
        roster = message.players;
        revision = message.revision;
        frame = true;
      } else if (message.type === 'motion') {
        const decoded = decodeMotion(message, roster, revision);
        if (decoded) { roster = decoded; frame = true; }
        else errors.push('motion_decode_failed');
      }
      if (!measuring) return;
      bytesReceived += Buffer.byteLength(text);
      if (frame && roster.length === count && (message.type === 'snapshot' || message.type === 'motion')) {
        snapshots[index]++;
        latencies.push(Math.max(0, Date.now() - message.time));
        if (index === 0) for (const player of roster) finalPositions.set(player.id, player.position[0]);
      } else if (message.type === 'chat') chats[index]++;
    });
    try {
      await once(socket, 'open');
      socket.send(JSON.stringify({ type: 'join', room: 'tai-po', name: `Load ${index}` }));
      await welcome;
    } finally { clearTimeout(timeout); }
  }));
  eventLoop.enable();
  measuring = true;
  const start = performance.now();
  memoryTimer = setInterval(() => {
    const memory = process.memoryUsage();
    memorySamples.push({ elapsedSeconds: (performance.now() - start) / 1000, rssMiB: memory.rss / 1048576, heapUsedMiB: memory.heapUsed / 1048576 });
  }, 10000);
  movement = setInterval(() => {
    sequence++;
    for (const socket of sockets) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      socket.send(JSON.stringify({
        type: 'pose', sequence, position: [sequence * 0.5, 220, 320],
        quaternion: [0, 0, 0, 1], perched: false,
      }));
      posesSent++;
    }
    // Ten room messages per second distributed over all participants.
    const sender = sockets[(sequence - 1) % count];
    if (sender.readyState === WebSocket.OPEN) {
      sender.send(JSON.stringify({ type: 'chat', text: `load-${sequence}`, scope: 'room' }));
      chatSent++;
    }
  }, 100);
  console.log(`Running ${count} loopback guests for ${durationSeconds}s with 10Hz movement and room chat.`);
  await new Promise(resolve => setTimeout(resolve, durationSeconds * 1000));
  clearInterval(movement);
  movement = undefined;
  await new Promise(resolve => setTimeout(resolve, 300));
  actualSeconds = (performance.now() - start) / 1000;
  measuring = false;
  eventLoop.disable();
  const failures = [];
  if (errors.length || disconnects) failures.push('Connection/protocol errors');
  if (Math.min(...snapshots) < durationSeconds * 8) failures.push('Snapshot reception below 8Hz');
  if (Math.min(...chats) !== chatSent) failures.push('Room chat delivery incomplete');
  if (finalPositions.size !== count || [...finalPositions.values()].some(x => x < sequence * 0.5 - 1)) failures.push('Movement did not reach all participants');
  const p95 = percentile(latencies, 0.95);
  if (p95 === null || p95 > 250) failures.push('Loopback snapshot age above 250ms p95');
  const report = {
    startedAt, finishedAt: new Date().toISOString(), environment: 'loopback, clients and server share one Node process; not WAN or GPU testing',
    passed: failures.length === 0, failures, participants: count, durationSeconds: actualSeconds,
    posesSent, chatSent, minimumSnapshotsPerClient: Math.min(...snapshots),
    minimumChatsPerClient: Math.min(...chats), disconnects, protocolErrors: errors.length,
    snapshotAgeP95Ms: p95, eventLoopP95Ms: eventLoop.percentile(95) / 1e6,
    receivedMiB: bytesReceived / 1024 / 1024,
    aggregateReceiveMbitPerSecond: bytesReceived * 8 / actualSeconds / 1e6,
    combinedProcessRssMiB: process.memoryUsage().rss / 1024 / 1024,
    memorySamples,
  };
  mkdirSync('runtime-evidence', { recursive: true });
  const output = `runtime-evidence/world-load-${startedAt.replace(/[:.]/g, '-')}.json`;
  writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`Evidence: ${output}`);
  if (failures.length) process.exitCode = 1;
} finally {
  measuring = false;
  if (movement) clearInterval(movement);
  if (memoryTimer) clearInterval(memoryTimer);
  eventLoop.disable();
  for (const socket of sockets) socket.terminate();
  await server.close();
}
