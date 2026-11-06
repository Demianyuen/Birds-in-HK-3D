import { checkName, CHAT_MAX } from './contentRules';
import type { Position, Rotation, WorldPlayer } from '../multiplayer/protocol';
import { PoseBuffer } from './PoseBuffer';
import type { LiveStatus, SkyEvents, SkyLink } from './skyLink';
import { MAX_ROOMS, poseIntervalMs, ZoneWatch, zoneLabel } from './zones';

interface ZoneSocket {
  zone: string;
  socket: WebSocket;
  /** Birds who said hello in this zone room (not counting us). */
  members: Map<string, { name: string; plumage: string }>;
  /** We said hello here (this is the zone we are over). */
  member: boolean;
  open: boolean;
}

const PEER_TIMEOUT_MS = 15_000;
/** When every room over the court is full, try again after this long. */
const FULL_RETRY_MS = 60_000;

/**
 * The shared sky through our own relay (relay/: one Cloudflare Durable Object per
 * zone room), so many birds can fly together without the per-second message
 * limits of Supabase Realtime. Same zones, rooms and smoothing as before.
 *
 * - One socket per zone in sight; we say hello only in the zone we are over.
 * - A full room answers "full": we try the next room number, for every zone.
 * - Lines said nearby arrive from the relay after the website's API has filtered them.
 */
export class SkyRelay implements SkyLink {
  private readonly sockets = new Map<string, ZoneSocket>();
  private readonly peers = new Map<string, PoseBuffer>();
  private readonly watch = new ZoneWatch();
  private room = 1;
  private home = '';
  private status: LiveStatus = 'offline';
  private lastPoseSent = 0;
  private lastPoseKey = '';
  private lastPosition: Position | null = null;
  private lastPositionTime = 0;
  private retryAt = 0;
  private retryDelay = 2_000;
  private disposed = false;

  public constructor(
    private readonly baseUrl: string,
    private readonly self: { id: string; name: string; plumage?: string },
    private readonly events: SkyEvents,
    private readonly createSocket: (url: string) => WebSocket = url => new WebSocket(url),
  ) {}

  public connect(): void {
    this.setStatus('connecting');
  }

  public sendPose(position: Position, quaternion: Rotation, perched: boolean): void {
    if (this.disposed) return;
    const now = performance.now();
    if (now >= this.retryAt) {
      const change = this.watch.update(position[0], position[2]);
      const wanted = new Set(this.watch.zones);
      for (const zone of [...this.sockets.keys()]) if (!wanted.has(zone) && zone !== change.home) this.closeZone(zone);
      for (const zone of change.join) if (!this.sockets.has(zone)) this.openZone(zone);
      if (change.home !== this.home) this.moveHome(change.home);
    }
    const home = this.sockets.get(this.home);
    if (!home?.open || !home.member) return;

    const speed = this.lastPosition
      ? Math.hypot(position[0] - this.lastPosition[0], position[2] - this.lastPosition[2]) / Math.max(0.001, (now - this.lastPositionTime) / 1_000)
      : 10;
    if (now - this.lastPositionTime >= 200) {
      this.lastPosition = position;
      this.lastPositionTime = now;
    }
    const p = position.map(value => Math.round(value * 10) / 10);
    const q = quaternion.map(value => Math.round(value * 1000) / 1000);
    const key = `${p.join(',')}|${q.join(',')}|${perched}`;
    const interval = key === this.lastPoseKey ? poseIntervalMs(speed) : Math.min(poseIntervalMs(speed), 500);
    if (now - this.lastPoseSent < interval) return;
    this.lastPoseSent = now;
    this.lastPoseKey = key;
    send(home.socket, { t: 'pose', p, q, g: perched });
  }

  public snapshot(now = performance.now()): WorldPlayer[] {
    const players: WorldPlayer[] = [];
    for (const [id, buffer] of this.peers) {
      const known = this.memberInfo(id);
      if (!known) continue;
      const pose = buffer.sample(now);
      if (!pose) continue;
      players.push({ id, name: known.name, position: pose.position, quaternion: pose.quaternion, perched: pose.perched, plumage: known.plumage });
    }
    return players;
  }

  public prune(now = performance.now()): void {
    for (const [id, buffer] of this.peers) if (now - buffer.lastSeen > PEER_TIMEOUT_MS || !this.memberInfo(id)) this.peers.delete(id);
  }

  public get nearbyCount(): number {
    return 1 + (this.sockets.get(this.home)?.members.size ?? 0);
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
    return [...this.sockets.keys()];
  }

  public dispose(): void {
    this.disposed = true;
    for (const zone of [...this.sockets.keys()]) this.closeZone(zone);
    this.peers.clear();
    this.setStatus('offline');
  }

  private openZone(zone: string): void {
    const url = `${this.baseUrl.replace(/\/+$/, '')}/sky/${encodeURIComponent(zone)}/${this.room}`;
    let socket: WebSocket;
    try {
      socket = this.createSocket(url);
    } catch {
      this.scheduleRetry();
      return;
    }
    const entry: ZoneSocket = { zone, socket, members: new Map(), member: false, open: false };
    this.sockets.set(zone, entry);
    socket.addEventListener('open', () => {
      entry.open = true;
      this.retryDelay = 2_000;
      if (zone === this.home) this.sayHello(entry);
    });
    socket.addEventListener('message', event => this.receive(entry, event.data));
    socket.addEventListener('close', () => {
      if (this.sockets.get(zone) !== entry) return; // replaced or closed on purpose
      this.sockets.delete(zone);
      for (const id of entry.members.keys()) if (!this.memberInfo(id)) this.peers.delete(id);
      if (zone === this.home) this.setStatus('connecting');
      this.scheduleRetry();
    });
  }

  private closeZone(zone: string): void {
    const entry = this.sockets.get(zone);
    if (!entry) return;
    this.sockets.delete(zone);
    try {
      entry.socket.close(1000, 'left zone');
    } catch {
      // already closing
    }
    for (const id of entry.members.keys()) if (!this.memberInfo(id)) this.peers.delete(id);
  }

  private moveHome(zone: string): void {
    const previous = this.sockets.get(this.home);
    if (previous?.member && previous.open) {
      send(previous.socket, { t: 'bye' });
      previous.member = false;
    }
    this.home = zone;
    this.lastPoseKey = '';
    const entry = this.sockets.get(zone);
    if (entry?.open) this.sayHello(entry);
    else if (!entry) this.openZone(zone);
  }

  private sayHello(entry: ZoneSocket): void {
    if (entry.member) return;
    entry.member = true;
    send(entry.socket, { t: 'hello', id: this.self.id, name: this.self.name || '訪客', plumage: this.self.plumage ?? 'natural' });
    this.setStatus('online');
  }

  private receive(entry: ZoneSocket, raw: unknown): void {
    if (typeof raw !== 'string' || raw.length > 64_000) return;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    switch (data.t) {
      case 'welcome':
        if (Array.isArray(data.members)) for (const member of data.members) this.addMember(entry, member);
        break;
      case 'join':
        this.addMember(entry, data);
        break;
      case 'leave':
        if (typeof data.id === 'string') {
          entry.members.delete(data.id);
          if (!this.memberInfo(data.id)) this.peers.delete(data.id);
        }
        break;
      case 'pose':
        this.receivePose(data);
        break;
      case 'say':
        this.receiveSay(data);
        break;
      case 'full':
        this.roomFull();
        break;
    }
  }

  private addMember(entry: ZoneSocket, value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const data = value as Record<string, unknown>;
    if (typeof data.id !== 'string' || data.id === this.self.id) return;
    const name = checkName(data.name);
    entry.members.set(data.id, {
      name: name.ok && name.text ? name.text : '訪客',
      plumage: typeof data.plumage === 'string' && /^[a-z]{1,16}$/.test(data.plumage) ? data.plumage : 'natural',
    });
  }

  private receivePose(data: Record<string, unknown>): void {
    if (typeof data.id !== 'string' || data.id === this.self.id || !this.memberInfo(data.id)) return;
    if (!isTuple(data.p, 3) || !isTuple(data.q, 4)) return;
    let buffer = this.peers.get(data.id);
    if (!buffer) {
      buffer = new PoseBuffer();
      this.peers.set(data.id, buffer);
    }
    buffer.push(data.p, data.q, data.g === true, performance.now());
  }

  private receiveSay(data: Record<string, unknown>): void {
    if (typeof data.body !== 'string' || !data.body || data.body.length > CHAT_MAX || typeof data.id !== 'string') return;
    this.events.onChat({
      id: 0,
      name: typeof data.name === 'string' && data.name ? data.name : '訪客',
      body: data.body,
      x: Number(data.x) || 0,
      z: Number(data.z) || 0,
      speaker: data.id,
      createdAt: '',
    });
  }

  /** Our room is full: every zone moves to the next room number (or we wait, alone, when all are full). */
  private roomFull(): void {
    for (const zone of [...this.sockets.keys()]) this.closeZone(zone);
    this.peers.clear();
    this.watch.reset();
    this.home = '';
    if (this.room < MAX_ROOMS) {
      this.room += 1;
      this.retryAt = 0;
    } else {
      this.room = 1;
      this.retryAt = performance.now() + FULL_RETRY_MS;
      this.setStatus('offline');
    }
  }

  private scheduleRetry(): void {
    if (this.disposed) return;
    this.watch.reset();
    this.home = '';
    this.retryAt = performance.now() + this.retryDelay;
    this.retryDelay = Math.min(30_000, this.retryDelay * 2);
  }

  private memberInfo(id: string): { name: string; plumage: string } | null {
    for (const entry of this.sockets.values()) {
      const member = entry.members.get(id);
      if (member) return member;
    }
    return null;
  }

  private setStatus(status: LiveStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.events.onStatus(status);
  }
}

function send(socket: WebSocket, message: unknown): void {
  try {
    if (socket.readyState === 1) socket.send(JSON.stringify(message));
  } catch {
    // closing
  }
}

function isTuple(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every(item => typeof item === 'number' && Number.isFinite(item));
}
