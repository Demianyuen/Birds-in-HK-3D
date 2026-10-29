import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type { OpenWorldConfig } from './config';
import { checkName, CHAT_MAX } from './contentRules';
import type { Position, Rotation, WorldPlayer } from '../multiplayer/protocol';
import { PoseBuffer } from './PoseBuffer';
import { channelName, MAX_ROOMS, pickRoom, poseIntervalMs, ROOM_CAP, ZoneWatch, zoneLabel } from './zones';

export interface ChatLine {
  id: number;
  name: string;
  body: string;
  x: number;
  z: number;
  /** Id of the bird that said it (empty on rows from before ids were stored). */
  speaker: string;
  createdAt: string;
}

export type LiveStatus = 'connecting' | 'online' | 'offline';

/** The slice of the Supabase client used here (so tests can supply a stand-in). */
export type LiveClient = Pick<SupabaseClient, 'channel' | 'removeChannel' | 'from'>;

interface ZoneChannel {
  zone: string;
  room: number;
  channel: RealtimeChannel;
  /** Ids present in this channel (including ourselves once tracked). */
  members: Set<string>;
  names: Map<string, string>;
  tracked: boolean;
}

interface Peer {
  id: string;
  buffer: PoseBuffer;
}

const PEER_TIMEOUT_MS = 15_000;
const PRESENCE_WAIT_MS = 2_000;

/**
 * Shared sky over Tai Po, without a game server of our own.
 *
 * - The sky is split into zones (see zones.ts). We announce ourselves and send
 *   our pose only in the zone we are over, and listen to the zones in sight.
 * - Each zone is split into rooms of {@link ROOM_CAP} birds. A full room sends the
 *   next arrival to the next room, so it never turns into a crowd.
 * - Poses arrive 2-4 times a second and are smoothed by {@link PoseBuffer}.
 * - Chat lines are written by the Vercel API (filtered, rate-limited) and arrive
 *   here as database inserts, so nobody can bypass the filter.
 */
export class LiveWorld {
  private readonly client: LiveClient;
  private readonly zoneChannels = new Map<string, ZoneChannel>();
  private chatChannel: RealtimeChannel | null = null;
  private readonly peers = new Map<string, Peer>();
  private readonly watch = new ZoneWatch();
  private room = 1;
  private home = '';
  private joining = false;
  /** After a failed join, wait before trying again (ms, performance.now). */
  private retryAt = 0;
  private lastPoseSent = 0;
  private lastPoseKey = '';
  private lastPosition: Position | null = null;
  private lastPositionTime = 0;
  private status: LiveStatus = 'offline';
  private disposed = false;

  public constructor(
    config: OpenWorldConfig,
    private readonly self: { id: string; name: string },
    private readonly events: {
      onStatus: (status: LiveStatus) => void;
      onChat: (line: ChatLine) => void;
    },
    client?: LiveClient,
  ) {
    this.client = client ?? createClient(config.supabaseUrl, config.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 10 } },
    });
  }

  public connect(): void {
    this.setStatus('connecting');
    this.chatChannel = this.client
      .channel('birds-in-hk:chat')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'memorial_chat' }, ({ new: row }) => {
        const line = parseChat(row);
        if (line) this.events.onChat(line);
      })
      .subscribe();
  }

  /** Send our pose (throttled, and only to the zone we are over). Also moves our listening zones. */
  public sendPose(position: Position, quaternion: Rotation, perched: boolean): void {
    if (this.disposed) return;
    const now = performance.now();
    const change = this.watch.update(position[0], position[2]);
    if (!this.joining && now >= this.retryAt && (change.join.length > 0 || change.leave.length > 0 || change.home !== this.home)) {
      void this.applyZones(change.home, change.join, change.leave);
    }
    const home = this.zoneChannels.get(this.home);
    if (!home || this.status !== 'online') return;

    const speed = this.lastPosition
      ? Math.hypot(position[0] - this.lastPosition[0], position[2] - this.lastPosition[2]) / Math.max(0.001, (now - this.lastPositionTime) / 1_000)
      : 10;
    if (now - this.lastPositionTime >= 200) {
      this.lastPosition = position;
      this.lastPositionTime = now;
    }
    const rounded = position.map(value => Math.round(value * 10) / 10) as Position;
    const rotation = quaternion.map(value => Math.round(value * 1000) / 1000) as Rotation;
    const key = `${rounded.join(',')}|${rotation.join(',')}|${perched}`;
    // Turning on the spot still counts as moving; a bird that is truly still sends only a heartbeat.
    const interval = key === this.lastPoseKey ? poseIntervalMs(speed) : Math.min(poseIntervalMs(speed), 500);
    if (now - this.lastPoseSent < interval) return;
    this.lastPoseSent = now;
    this.lastPoseKey = key;
    void home.channel.send({ type: 'broadcast', event: 'pose', payload: { id: this.self.id, p: rounded, q: rotation, g: perched } });
  }

  /** The other birds, smoothed to this moment. */
  public snapshot(now = performance.now()): WorldPlayer[] {
    const players: WorldPlayer[] = [];
    for (const peer of this.peers.values()) {
      const pose = peer.buffer.sample(now);
      if (!pose) continue;
      players.push({ id: peer.id, name: this.nameOf(peer.id), position: pose.position, quaternion: pose.quaternion, perched: pose.perched });
    }
    return players;
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
  public prune(now = performance.now()): void {
    for (const [id, peer] of this.peers) {
      if (now - peer.buffer.lastSeen > PEER_TIMEOUT_MS) this.peers.delete(id);
    }
  }

  /** Birds in the zone and room we are in, including ourselves. */
  public get nearbyCount(): number {
    const members = this.zoneChannels.get(this.home)?.members;
    return Math.max(1, members?.size ?? 1);
  }

  public get homeZone(): string {
    return this.home;
  }

  public get homeLabel(): string {
    return zoneLabel(this.home);
  }

  public get currentRoom(): number {
    return this.room;
  }

  /** Zones currently listened to (for checking and tests). */
  public get listening(): string[] {
    return [...this.zoneChannels.keys()];
  }

  public dispose(): void {
    this.disposed = true;
    for (const entry of this.zoneChannels.values()) this.closeChannel(entry);
    this.zoneChannels.clear();
    if (this.chatChannel) void this.client.removeChannel(this.chatChannel);
    this.chatChannel = null;
    this.peers.clear();
    this.setStatus('offline');
  }

  /** Moves between zones. The first call decides the room, trying the next one while a room is full. */
  private async applyZones(home: string, join: string[], leave: string[]): Promise<void> {
    this.joining = true;
    try {
      for (const zone of leave) this.closeZone(zone);
      if (!this.zoneChannels.has(home) || join.includes(home)) {
        const entry = await this.enterHome(home);
        if (!entry || this.disposed) {
          // Start over (including the neighbouring zones) a few seconds from now.
          this.watch.reset();
          this.retryAt = performance.now() + 5_000;
          return;
        }
      }
      for (const zone of join) {
        if (zone !== home && !this.zoneChannels.has(zone)) await this.listenTo(zone);
      }
      this.moveHome(home);
    } finally {
      this.joining = false;
    }
  }

  /** Join the zone we are over, in the first room that has space. */
  private async enterHome(zone: string): Promise<ZoneChannel | null> {
    const counts: number[] = [];
    for (let attempt = 0; attempt < MAX_ROOMS; attempt += 1) {
      const room = counts.length === 0 ? this.room : pickRoom(counts);
      const existing = this.zoneChannels.get(zone);
      if (existing && existing.room === room) return existing;
      if (existing) this.closeZone(zone);
      const entry = await this.openChannel(zone, room);
      if (!entry || this.disposed) return null;
      const others = [...entry.members].filter(id => id !== this.self.id).length;
      counts[room - 1] = others;
      if (others < ROOM_CAP || room >= MAX_ROOMS) {
        if (room !== this.room) this.switchRoom(room, zone);
        return entry;
      }
      this.closeZone(zone);
    }
    return null;
  }

  /** A new room number means the zones we only listen to must move with it. */
  private switchRoom(room: number, keepZone: string): void {
    this.room = room;
    for (const zone of [...this.zoneChannels.keys()]) if (zone !== keepZone) this.closeZone(zone);
  }

  private async listenTo(zone: string): Promise<void> {
    await this.openChannel(zone, this.room);
  }

  private moveHome(home: string): void {
    if (this.home === home) {
      const current = this.zoneChannels.get(home);
      if (current && !current.tracked) void this.track(current);
      return;
    }
    const previous = this.zoneChannels.get(this.home);
    if (previous?.tracked) {
      previous.tracked = false;
      void previous.channel.untrack();
    }
    this.home = home;
    this.lastPoseKey = '';
    const entry = this.zoneChannels.get(home);
    if (entry) void this.track(entry);
  }

  private async track(entry: ZoneChannel): Promise<void> {
    if (entry.tracked) return;
    entry.tracked = true;
    await entry.channel.track({ name: this.self.name || '訪客' });
  }

  private openChannel(zone: string, room: number): Promise<ZoneChannel | null> {
    return new Promise(resolve => {
      const channel = this.client.channel(channelName(zone, room), {
        config: { presence: { key: this.self.id }, broadcast: { self: false, ack: false } },
      });
      const entry: ZoneChannel = { zone, room, channel, members: new Set(), names: new Map(), tracked: false };
      let settled = false;
      const settle = (value: ZoneChannel | null): void => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      channel.on('presence', { event: 'sync' }, () => {
        entry.members = new Set(Object.keys(channel.presenceState()));
        entry.names.clear();
        for (const [id, metas] of Object.entries(channel.presenceState<{ name?: string }>())) {
          const checked = checkName(metas[0]?.name);
          entry.names.set(id, checked.ok && checked.text ? checked.text : '訪客');
        }
        for (const [id] of this.peers) if (!this.isPresent(id)) this.peers.delete(id);
        settle(entry);
      });
      channel.on('broadcast', { event: 'pose' }, ({ payload }) => this.receivePose(payload));
      channel.subscribe(status => {
        if (status === 'SUBSCRIBED') {
          this.zoneChannels.set(zone, entry);
          this.setStatus('online');
          // A quiet zone may never send a presence sync; do not wait for it forever.
          setTimeout(() => settle(entry), PRESENCE_WAIT_MS);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          if (this.zoneChannels.get(zone) === entry) this.zoneChannels.delete(zone);
          if (this.zoneChannels.size === 0) this.setStatus('offline');
          settle(null);
        }
      });
    });
  }

  private closeZone(zone: string): void {
    const entry = this.zoneChannels.get(zone);
    if (!entry) return;
    this.zoneChannels.delete(zone);
    this.closeChannel(entry);
    for (const [id] of this.peers) if (!this.isPresent(id)) this.peers.delete(id);
  }

  private closeChannel(entry: ZoneChannel): void {
    if (entry.tracked) void entry.channel.untrack();
    entry.tracked = false;
    void this.client.removeChannel(entry.channel);
  }

  private isPresent(id: string): boolean {
    for (const entry of this.zoneChannels.values()) if (entry.members.has(id)) return true;
    return false;
  }

  private nameOf(id: string): string {
    for (const entry of this.zoneChannels.values()) {
      const name = entry.names.get(id);
      if (name) return name;
    }
    return '訪客';
  }

  private receivePose(payload: unknown): void {
    if (!payload || typeof payload !== 'object') return;
    const data = payload as Record<string, unknown>;
    if (typeof data.id !== 'string' || data.id === this.self.id || !this.isPresent(data.id)) return;
    if (!isTuple(data.p, 3) || !isTuple(data.q, 4)) return;
    const [x, y, z] = data.p;
    if (Math.abs(x) > 6_000 || Math.abs(z) > 6_000 || y < -50 || y > 3_000) return;
    let peer = this.peers.get(data.id);
    if (!peer) {
      peer = { id: data.id, buffer: new PoseBuffer() };
      this.peers.set(data.id, peer);
    }
    peer.buffer.push(data.p, data.q, data.g === true, performance.now());
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
    speaker: typeof data.speaker === 'string' ? data.speaker : '',
    createdAt: typeof data.created_at === 'string' ? data.created_at : '',
  };
}
