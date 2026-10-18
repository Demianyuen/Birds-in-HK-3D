import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { encodeMotion } from '../src/multiplayer/motionCodec';
import { WORLD_PLAYER_LIMIT, cleanText, finiteTuple, isRecord, type Position, type Rotation, type ServerMessage, type WorldPlayer } from '../src/multiplayer/protocol';

interface Peer {
  socket: WebSocket;
  player: WorldPlayer | null;
  room: string;
  lastPose: number;
  sequence: number;
  lastChat: number;
  windowStart: number;
  messages: number;
  alive: boolean;
  sessionToken?: string;
}

export async function startWorldServer(options: { port: number; host: string; origins: string[] }) {
  const peers = new Map<WebSocket, Peer>();
  const rooms = new Map<string, Set<Peer>>();
  const sessions = new Map<string, { player: WorldPlayer; room: string; active: boolean; expires: number; lastChat: number }>();
  const broadcasts = new Map<string, { signature: string; revision: number; lastFull: number }>();
  let nextRevision = 0;
  const http = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method === 'GET' && request.url === '/health') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ status: 'ok', players: [...rooms.values()].reduce((sum, room) => sum + room.size, 0), rooms: rooms.size, protocol: 2 }));
    } else {
      response.statusCode = 404;
      response.end();
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  http.on('upgrade', (request, socket, head) => {
    if (request.url !== '/world' || !options.origins.includes(request.headers.origin ?? '') || peers.size >= 128) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
  });
  const send = (peer: Peer, message: ServerMessage | string) => {
    if (peer.socket.readyState !== WebSocket.OPEN) return;
    if (peer.socket.bufferedAmount > 64 * 1024) {
      peer.socket.terminate();
      return;
    }
    peer.socket.send(typeof message === 'string' ? message : JSON.stringify(message));
  };
  const error = (peer: Peer, code: string) => send(peer, { type: 'error', code });
  wss.on('connection', socket => {
    const peer: Peer = { socket, player: null, room: '', lastPose: Date.now(), sequence: -1, lastChat: 0, windowStart: Date.now(), messages: 0, alive: true };
    peers.set(socket, peer);
    const joinDeadline = setTimeout(() => { if (!peer.player) socket.close(1008, 'Join required'); }, 10_000);
    socket.on('pong', () => { peer.alive = true; });
    socket.on('error', () => socket.terminate());
    socket.on('close', () => {
      clearTimeout(joinDeadline);
      peers.delete(socket);
      const session = peer.sessionToken ? sessions.get(peer.sessionToken) : undefined;
      if (session) { session.active = false; session.expires = Date.now() + 120_000; }
      const room = rooms.get(peer.room);
      room?.delete(peer);
      if (room?.size === 0) { rooms.delete(peer.room); broadcasts.delete(peer.room); }
    });
    socket.on('message', (data, binary) => {
      const now = Date.now();
      if (now - peer.windowStart >= 1000) { peer.windowStart = now; peer.messages = 0; }
      if (++peer.messages > 50) { socket.close(1008, 'Rate limit'); return; }
      let message: unknown;
      try { message = binary ? null : JSON.parse(data.toString()); } catch { message = null; }
      if (!isRecord(message)) return error(peer, 'invalid_message');
      if (message.type === 'join') {
        if (peer.player) return error(peer, 'already_joined');
        const name = cleanText(message.name, 24);
        // Region rooms share the same Tai Po coordinate frame; arbitrary private room IDs are bounded.
        if (!name || typeof message.room !== 'string' || !/^tai-po(?:-[a-z0-9]{1,16})?$/.test(message.room)) return error(peer, 'invalid_join');
        const room = rooms.get(message.room) ?? new Set<Peer>();
        if (room.size >= WORLD_PLAYER_LIMIT) return error(peer, 'room_full');
        const resumeToken = typeof message.resumeToken === 'string' ? message.resumeToken : '';
        const saved = resumeToken ? sessions.get(resumeToken) : undefined;
        if (resumeToken && (!saved || saved.room !== message.room || saved.expires < now)) return error(peer, 'session_expired');
        if (saved?.active) return error(peer, 'session_busy');
        for (const [token, session] of sessions) {
          if (!session.active && session.expires < now) sessions.delete(token);
        }
        if (!saved && sessions.size >= 512) return error(peer, 'session_capacity');
        peer.room = message.room;
        peer.player = saved?.player ?? { id: randomUUID(), name, position: [0, 220, 320], quaternion: [0, 0, 0, 1], perched: false };
        peer.sessionToken = resumeToken || randomBytes(32).toString('hex');
        peer.lastChat = saved?.lastChat ?? 0;
        sessions.set(peer.sessionToken, { player: peer.player, room: peer.room, active: true, expires: Infinity, lastChat: peer.lastChat });
        peer.lastPose = now;
        room.add(peer);
        rooms.set(peer.room, room);
        clearTimeout(joinDeadline);
        return send(peer, { type: 'welcome', id: peer.player.id, room: peer.room, protocol: 2, resumeToken: peer.sessionToken, resumed: !!saved, player: peer.player });
      }
      if (!peer.player) return error(peer, 'join_required');
      if (message.type === 'leave') {
        if (peer.sessionToken) sessions.delete(peer.sessionToken);
        socket.close(1000, 'Left world');
        return;
      }
      if (message.type === 'pose') {
        const { position, quaternion, sequence, perched } = message;
        if (!finiteTuple(position, 3) || !finiteTuple(quaternion, 4)
          || typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence <= peer.sequence
          || typeof perched !== 'boolean' || position[1] < 0 || position[1] > 2000
          || Math.hypot(position[0], position[2]) > 3080
          || Math.abs(Math.hypot(...quaternion) - 1) > 0.02) return error(peer, 'invalid_pose');
        const distance = Math.hypot(...position.map((value, i) => value - peer.player!.position[i]));
        const allowance = Math.min(2, (now - peer.lastPose) / 1000) * 100 + 5;
        if (distance > allowance) return error(peer, 'invalid_pose');
        peer.player.position = [...position] as Position;
        peer.player.quaternion = [...quaternion] as Rotation;
        peer.player.perched = perched;
        peer.sequence = sequence;
        peer.lastPose = now;
        return;
      }
      if (message.type === 'chat') {
        const text = cleanText(message.text, 280);
        if (!text || (message.scope !== 'room' && message.scope !== 'nearby')) return error(peer, 'invalid_chat');
        if (now - peer.lastChat < 1000) return error(peer, 'chat_rate_limited');
        peer.lastChat = now;
        const session = peer.sessionToken ? sessions.get(peer.sessionToken) : undefined;
        if (session) session.lastChat = now;
        const packet: ServerMessage = { type: 'chat', senderId: peer.player.id, name: peer.player.name, text, scope: message.scope, time: now };
        for (const recipient of rooms.get(peer.room) ?? []) {
          if (message.scope === 'nearby' && recipient.player
            && Math.hypot(...recipient.player.position.map((value, i) => value - peer.player!.position[i])) > 150) continue;
          send(recipient, packet);
        }
        return;
      }
      error(peer, 'invalid_message');
    });
  });
  const snapshots = setInterval(() => {
    for (const [roomId, room] of rooms) {
      const players = [...room].flatMap(peer => peer.player ? [peer.player] : []);
      const signature = players.map(player => player.id).join(',');
      let broadcast = broadcasts.get(roomId);
      const time = Date.now();
      let message: ServerMessage;
      if (!broadcast || broadcast.signature !== signature) {
        broadcast = { signature, revision: ++nextRevision, lastFull: time };
        broadcasts.set(roomId, broadcast);
        message = { type: 'snapshot', players, time, revision: broadcast.revision };
      } else if (time - broadcast.lastFull >= 1000) {
        broadcast.lastFull = time;
        message = { type: 'snapshot', players, time, revision: broadcast.revision };
      } else {
        message = encodeMotion(players, broadcast.revision, time);
      }
      const packet = JSON.stringify(message);
      for (const peer of room) send(peer, packet);
    }
  }, 100);
  const heartbeat = setInterval(() => {
    for (const [token, session] of sessions) {
      if (!session.active && session.expires < Date.now()) sessions.delete(token);
    }
    for (const peer of peers.values()) {
      if (!peer.alive) peer.socket.terminate();
      else { peer.alive = false; peer.socket.ping(); }
    }
  }, 15_000);
  try {
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject);
      http.listen(options.port, options.host, resolve);
    });
  } catch (error) {
    clearInterval(snapshots);
    clearInterval(heartbeat);
    wss.close();
    throw error;
  }
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('World server did not bind a TCP port.');
  return {
    url: `ws://${options.host}:${address.port}/world`,
    close: async () => {
      clearInterval(snapshots);
      clearInterval(heartbeat);
      for (const peer of peers.values()) peer.socket.terminate();
      await new Promise<void>(resolve => wss.close(() => resolve()));
      await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
    },
  };
}
