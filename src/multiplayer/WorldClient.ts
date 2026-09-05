import { WORLD_PLAYER_LIMIT, cleanText, finiteTuple, isRecord, type Position, type Rotation, type ServerMessage, type WorldPlayer } from './protocol';
import { decodeMotion } from './motionCodec';

export type ConnectionState = 'offline' | 'connecting' | 'reconnecting' | 'online';
export class WorldClient {
  private socket: WebSocket | null = null;
  private sequence = 0;
  private lastPoseTime = 0;
  private roster: WorldPlayer[] = [];
  private revision = -1;
  private handshake: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private resumeToken: string | null = null;
  private retryAttempts = 0;
  private connection: { url: string; name: string; room: string } | null = null;
  public id: string | null = null;
  public peers: WorldPlayer[] = [];
  public get joined(): boolean { return this.id !== null && this.socket?.readyState === 1; }

  constructor(
    private readonly onMessage: (message: ServerMessage) => void,
    private readonly onState: (state: ConnectionState) => void,
    private readonly createSocket: (url: string) => WebSocket = url => new WebSocket(url),
  ) {}

  connect(url: string, name: string, room: string): void {
    this.disconnect();
    if (!cleanText(name, 24) || !/^tai-po(?:-[a-z0-9]{1,16})?$/.test(room)) throw new Error('請填寫暱稱及有效房間名稱。');
    const endpoint = new URL(url);
    if (!['ws:', 'wss:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error('多人主機設定無效。');
    this.connection = { url, name, room };
    this.openTransport();
  }

  private openTransport(): void {
    if (!this.connection) return;
    const { url, name, room } = this.connection;
    this.onState('connecting');
    const socket = this.createSocket(url);
    this.socket = socket;
    this.sequence = 0;
    this.lastPoseTime = 0;
    this.handshake = setTimeout(() => {
      if (this.socket === socket && !this.joined) this.lostTransport(socket);
    }, 12_000);
    socket.addEventListener('open', () => {
      if (this.socket === socket) socket.send(JSON.stringify({ type: 'join', name, room, ...(this.resumeToken ? { resumeToken: this.resumeToken } : {}) }));
    });
    socket.addEventListener('message', event => {
      if (this.socket !== socket) return;
      let data: unknown;
      try { data = JSON.parse(String(event.data)); } catch { return; }
      if (!isRecord(data)) return;
      if (data.type === 'welcome' && typeof data.id === 'string' && typeof data.room === 'string' && data.protocol === 2) {
        this.id = data.id;
        if (typeof data.resumeToken === 'string' && /^[a-f0-9]{64}$/.test(data.resumeToken)) this.resumeToken = data.resumeToken;
        this.retryAttempts = 0;
        if (this.handshake) clearTimeout(this.handshake);
        this.handshake = null;
        this.onState('online');
        const player = isRecord(data.player) && finiteTuple(data.player.position, 3)
          && finiteTuple(data.player.quaternion, 4) && typeof data.player.perched === 'boolean'
          && data.player.id === data.id && typeof data.player.name === 'string' ? data.player as unknown as WorldPlayer : undefined;
        this.onMessage({ type: 'welcome', id: data.id, room: data.room, protocol: 2, resumed: data.resumed === true, player });
      } else if (data.type === 'snapshot' && Array.isArray(data.players) && data.players.length <= WORLD_PLAYER_LIMIT && typeof data.time === 'number'
        && typeof data.revision === 'number' && Number.isSafeInteger(data.revision) && data.revision >= this.revision) {
        const players = data.players.filter((player): player is WorldPlayer =>
          isRecord(player) && typeof player.id === 'string' && cleanText(player.name, 24) !== null
          && finiteTuple(player.position, 3) && finiteTuple(player.quaternion, 4) && typeof player.perched === 'boolean');
        if (players.length !== data.players.length || new Set(players.map(player => player.id)).size !== players.length) return;
        this.roster = players;
        this.revision = data.revision;
        this.peers = players.filter(player => player.id !== this.id);
        this.onMessage({ type: 'snapshot', players, time: data.time, revision: this.revision });
      } else if (data.type === 'motion') {
        const players = decodeMotion(data, this.roster, this.revision);
        if (!players) return;
        this.roster = players;
        this.peers = players.filter(player => player.id !== this.id);
        this.onMessage({ type: 'snapshot', players, time: data.time as number, revision: this.revision });
      } else if (data.type === 'chat' && typeof data.senderId === 'string' && typeof data.name === 'string'
        && typeof data.text === 'string' && typeof data.time === 'number' && (data.scope === 'room' || data.scope === 'nearby')) {
        this.onMessage({ type: 'chat', senderId: data.senderId, name: data.name, text: data.text, scope: data.scope, time: data.time });
      } else if (data.type === 'error' && typeof data.code === 'string') {
        this.onMessage({ type: 'error', code: data.code });
        if (!this.joined) this.disconnect();
      }
    });
    socket.addEventListener('close', () => this.lostTransport(socket));
    socket.addEventListener('error', () => this.lostTransport(socket));
  }

  private lostTransport(socket: WebSocket): void {
    if (this.socket !== socket) return;
    this.socket = null;
    this.id = null;
    this.peers = [];
    this.roster = [];
    this.revision = -1;
    if (this.handshake) clearTimeout(this.handshake);
    this.handshake = null;
    if (socket.readyState < 2) socket.close();
    if (!this.connection || this.retryAttempts >= 5) { this.disconnect(); return; }
    const delay = Math.min(8000, 1000 * 2 ** this.retryAttempts++);
    this.onState('reconnecting');
    this.retryTimer = setTimeout(() => { this.retryTimer = null; this.openTransport(); }, delay);
  }

  pose(position: Position, quaternion: Rotation, perched: boolean): void {
    const now = performance.now();
    if (!this.joined || now - this.lastPoseTime < 100) return;
    this.lastPoseTime = now;
    this.send({ type: 'pose', sequence: ++this.sequence, position, quaternion, perched });
  }

  chat(text: string, scope: 'room' | 'nearby'): boolean {
    const cleaned = cleanText(text, 280);
    return this.joined && cleaned !== null && this.send({ type: 'chat', text: cleaned, scope });
  }

  disconnect(): void {
    this.connection = null;
    this.resumeToken = null;
    this.retryAttempts = 0;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.handshake) clearTimeout(this.handshake);
    this.handshake = null;
    const old = this.socket;
    this.socket = null;
    this.id = null;
    this.peers = [];
    this.roster = [];
    this.revision = -1;
    if (old?.readyState === 1) old.send(JSON.stringify({ type: 'leave' }));
    if (old && old.readyState < 2) old.close();
    this.onState('offline');
  }

  private send(message: object): boolean {
    if (!this.socket || this.socket.readyState !== 1 || this.socket.bufferedAmount > 16_384) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }
}
