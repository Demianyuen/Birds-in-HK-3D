/**
 * Birds in HK · shared-sky relay (Cloudflare Worker + one Durable Object per zone room).
 *
 *   GET  /sky/<zone>/<room>   WebSocket: poses, who is here, lines said nearby
 *   POST /say/<zone>/<room>   from the website's API only (RELAY_SECRET): a filtered line to show
 *
 * Messages that arrive are billed at 20 per request and messages sent out are free,
 * so one bird flying at 4 poses a second costs about 0.2 requests a second.
 */
import { DurableObject } from 'cloudflare:workers';
import { MAX_ROOMS } from '../../src/openWorld/zones';
import { onClose, onMessage, onOpen, say, type Peer, type PeerState } from './roomLogic';

interface Env {
  SKY_ROOM: DurableObjectNamespace<SkyRoom>;
  /** Comma-separated origins allowed to open sockets, e.g. "https://birds-in-hk-3d.vercel.app". */
  ALLOWED_ORIGINS: string;
  /** Shared with the website's API (a Worker secret, never in the page). */
  RELAY_SECRET?: string;
}

const ZONE_PATTERN = /^(court|c-?\d{1,2}_-?\d{1,2})$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = /^\/(sky|say)\/([^/]+)\/(\d{1,2})$/.exec(url.pathname);
    if (!match) return new Response('Birds in HK sky relay', { status: url.pathname === '/' ? 200 : 404 });
    const [, kind, zone, roomText] = match;
    const room = Number(roomText);
    if (!ZONE_PATTERN.test(zone) || room < 1 || room > MAX_ROOMS) return new Response('Unknown room', { status: 404 });
    const stub = env.SKY_ROOM.get(env.SKY_ROOM.idFromName(`${zone}:${room}`));

    if (kind === 'sky') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      const origin = request.headers.get('Origin') ?? '';
      const allowed = env.ALLOWED_ORIGINS.split(',').map(item => item.trim()).filter(Boolean);
      if (!allowed.includes(origin)) return new Response('Origin not allowed', { status: 403 });
      return stub.fetch(request);
    }

    if (request.method !== 'POST' || !env.RELAY_SECRET || request.headers.get('x-relay-secret') !== env.RELAY_SECRET) {
      return new Response('Not allowed', { status: 403 });
    }
    return stub.fetch(request);
  },
};

export class SkyRoom extends DurableObject<Env> {
  public async fetch(request: Request): Promise<Response> {
    if (request.method === 'POST') {
      const line = (await request.json().catch(() => null)) as Parameters<typeof say>[0] | null;
      const sent = line ? say(line, this.peers()) : false;
      return new Response(null, { status: sent ? 204 : 422 });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    // Hibernation: the room sleeps between messages and is not billed for waiting.
    this.ctx.acceptWebSocket(server);
    onOpen(peerOf(server), this.peers());
    return new Response(null, { status: 101, webSocket: client });
  }

  public async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    onMessage(peerOf(socket), message, this.peers(), Date.now());
  }

  public async webSocketClose(socket: WebSocket): Promise<void> {
    onClose(peerOf(socket), this.peers().filter(peer => peer.socket !== socket));
  }

  public async webSocketError(socket: WebSocket): Promise<void> {
    onClose(peerOf(socket), this.peers().filter(peer => peer.socket !== socket));
  }

  private peers(): Array<Peer & { socket: WebSocket }> {
    return this.ctx.getWebSockets().map(peerOf);
  }
}

function peerOf(socket: WebSocket): Peer & { socket: WebSocket } {
  return {
    socket,
    send: data => {
      try {
        socket.send(data);
      } catch {
        // closing: nothing to deliver
      }
    },
    close: (code, reason) => socket.close(code, reason),
    state: () => (socket.deserializeAttachment() as PeerState | null) ?? null,
    setState: state => socket.serializeAttachment(state),
  };
}
