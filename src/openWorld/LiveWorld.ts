import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type { OpenWorldConfig } from './config';
import { checkName, CHAT_MAX } from './contentRules';
import type { Position, Rotation, WorldPlayer } from '../multiplayer/protocol';

export interface ChatLine {
  id: number;
  name: string;
  body: string;
  x: number;
  z: number;
  createdAt: string;
}

export type LiveStatus = 'connecting' | 'online' | 'offline';

interface Peer extends WorldPlayer {
  lastSeen: number;
}

const POSE_INTERVAL_MS = 250;
const PEER_TIMEOUT_MS = 15_000;
const CHANNEL = 'birds-in-hk:tai-po';

/**
 * Shared sky over Tai Po, without a game server of our own:
 * - Supabase Realtime presence says who is here (name, bird).
 * - Each bird broadcasts its pose four times a second while it moves.
 * - Chat lines are written by the Vercel API (filtered, rate-limited) and
 *   arrive here as database inserts, so nobody can bypass the filter.
 */
export class LiveWorld {
  private readonly client: SupabaseClient;
  private channel: RealtimeChannel | null = null;
  private chatChannel: RealtimeChannel | null = null;
  private readonly peers = new Map<string, Peer>();
  private readonly names = new Map<string, string>();
  private lastPoseSent = 0;
  private lastPoseKey = '';
  private status: LiveStatus = 'offline';

  public constructor(
    config: OpenWorldConfig,
    private readonly self: { id: string; name: string },
    private readonly events: {
      onStatus: (status: LiveStatus) => void;
      onPeers: (peers: readonly WorldPlayer[]) => void;
      onChat: (line: ChatLine) => void;
    },
  ) {
    this.client = createClient(config.supabaseUrl, config.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 10 } },
    });
  }

  public connect(): void {
    this.setStatus('connecting');
    const channel = this.client.channel(CHANNEL, {
      config: { presence: { key: this.self.id }, broadcast: { self: false, ack: false } },
    });
    channel.on('presence', { event: 'sync' }, () => {
      this.names.clear();
      const state = channel.presenceState<{ name?: string }>();
      for (const [id, metas] of Object.entries(state)) {
        const checked = checkName(metas[0]?.name);
        this.names.set(id, checked.ok && checked.text ? checked.text : '訪客');
      }
      for (const id of [...this.peers.keys()]) if (!this.names.has(id)) this.peers.delete(id);
      this.emitPeers();
    });
    channel.on('broadcast', { event: 'pose' }, ({ payload }) => this.receivePose(payload));
    channel.subscribe(async status => {
      if (status === 'SUBSCRIBED') {
        this.setStatus('online');
        await channel.track({ name: this.self.name || '訪客' });
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        this.setStatus('offline');
      }
    });
    this.channel = channel;

    this.chatChannel = this.client
      .channel('birds-in-hk:chat')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'memorial_chat' }, ({ new: row }) => {
        const line = parseChat(row);
        if (line) this.events.onChat(line);
      })
      .subscribe();
  }

  /** Send our pose (throttled; skipped when standing still). */
  public sendPose(position: Position, quaternion: Rotation, perched: boolean): void {
    if (!this.channel || this.status !== 'online') return;
    const now = performance.now();
    if (now - this.lastPoseSent < POSE_INTERVAL_MS) return;
    const rounded = position.map(value => Math.round(value * 10) / 10) as Position;
    const rotation = quaternion.map(value => Math.round(value * 1000) / 1000) as Rotation;
    const key = `${rounded.join(',')}|${rotation.join(',')}|${perched}`;
    // Still send now and then while idle so late joiners see us.
    if (key === this.lastPoseKey && now - this.lastPoseSent < 4_000) return;
    this.lastPoseSent = now;
    this.lastPoseKey = key;
    void this.channel.send({ type: 'broadcast', event: 'pose', payload: { id: this.self.id, p: rounded, q: rotation, g: perched } });
  }

  /** Recent chat (the last hour) for players who just arrived. */
  public async recentChat(): Promise<ChatLine[]> {
    const since = new Date(Date.now() - 3_600_000).toISOString();
    const { data } = await this.client
      .from('memorial_chat')
      .select('id,created_at,name,body,x,z')
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(60);
    return (data ?? []).map(parseChat).filter((line): line is ChatLine => line !== null);
  }

  /** Drop birds that stopped sending (closed tab without leaving). */
  public prune(): void {
    const now = performance.now();
    let changed = false;
    for (const [id, peer] of this.peers) {
      if (now - peer.lastSeen > PEER_TIMEOUT_MS) {
        this.peers.delete(id);
        changed = true;
      }
    }
    if (changed) this.emitPeers();
  }

  public get onlineCount(): number {
    return Math.max(1, this.names.size);
  }

  public dispose(): void {
    void this.channel?.untrack();
    if (this.channel) void this.client.removeChannel(this.channel);
    if (this.chatChannel) void this.client.removeChannel(this.chatChannel);
    this.channel = null;
    this.chatChannel = null;
    this.peers.clear();
    this.setStatus('offline');
  }

  private receivePose(payload: unknown): void {
    if (!payload || typeof payload !== 'object') return;
    const data = payload as Record<string, unknown>;
    if (typeof data.id !== 'string' || data.id === this.self.id || !this.names.has(data.id)) return;
    if (!isTuple(data.p, 3) || !isTuple(data.q, 4)) return;
    const [x, y, z] = data.p;
    if (Math.abs(x) > 6_000 || Math.abs(z) > 6_000 || y < -50 || y > 3_000) return;
    this.peers.set(data.id, {
      id: data.id,
      name: this.names.get(data.id) ?? '訪客',
      position: [x, y, z],
      quaternion: data.q as Rotation,
      perched: data.g === true,
      lastSeen: performance.now(),
    });
    this.emitPeers();
  }

  private emitPeers(): void {
    this.events.onPeers([...this.peers.values()].map(peer => ({ ...peer, name: this.names.get(peer.id) ?? peer.name })));
  }

  private setStatus(status: LiveStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.events.onStatus(status);
  }
}

function isTuple(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every(item => typeof item === 'number' && Number.isFinite(item));
}

function parseChat(row: unknown): ChatLine | null {
  if (!row || typeof row !== 'object') return null;
  const data = row as Record<string, unknown>;
  if (typeof data.body !== 'string' || !data.body || data.body.length > CHAT_MAX) return null;
  return {
    id: Number(data.id) || 0,
    name: typeof data.name === 'string' && data.name ? data.name : '訪客',
    body: data.body,
    x: Number(data.x) || 0,
    z: Number(data.z) || 0,
    createdAt: typeof data.created_at === 'string' ? data.created_at : '',
  };
}
