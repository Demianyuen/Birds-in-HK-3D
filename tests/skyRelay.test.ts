import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onClose, onMessage, onOpen, say, MAX_POSES_PER_SECOND, type Peer, type PeerState } from '../relay/src/roomLogic';
import { SkyRelay } from '../src/openWorld/SkyRelay';
import { MEMORIAL_CENTRE } from '../src/openWorld/contentRules';
import { COURT_ZONE, ROOM_CAP } from '../src/openWorld/zones';

/** The relay's rooms, in memory: url → the peers in that zone room. */
class FakeRelay {
  public readonly rooms = new Map<string, FakeSocketPeer[]>();
  public peersIn(zone: string, room: number): FakeSocketPeer[] {
    return this.rooms.get(`${zone}:${room}`) ?? [];
  }
}

/** One side of a socket pair: the relay's peer, wired to a browser-like socket. */
class FakeSocketPeer implements Peer {
  private attachment: PeerState | null = null;
  public constructor(public readonly client: FakeClientSocket) {}
  public send(data: string): void {
    this.client.deliver(data);
  }
  public close(): void {
    this.client.serverClosed();
  }
  public state(): PeerState | null {
    return this.attachment;
  }
  public setState(state: PeerState | null): void {
    this.attachment = state;
  }
}

class FakeClientSocket {
  public readyState = 0;
  public peer: FakeSocketPeer;
  public sent: string[] = [];
  private readonly listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();
  public constructor(private readonly relay: FakeRelay, private readonly key: string) {
    this.peer = new FakeSocketPeer(this);
    queueMicrotask(() => {
      const room = this.relay.rooms.get(key) ?? [];
      room.push(this.peer);
      this.relay.rooms.set(key, room);
      this.readyState = 1;
      this.emit('open', {});
      onOpen(this.peer, room);
    });
  }
  public addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  public send(data: string): void {
    this.sent.push(data);
    onMessage(this.peer, data, this.relay.rooms.get(this.key) ?? [], Date.now());
  }
  public close(): void {
    this.leave();
  }
  public deliver(data: string): void {
    this.emit('message', { data });
  }
  public serverClosed(): void {
    this.leave();
  }
  private leave(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    const room = (this.relay.rooms.get(this.key) ?? []).filter(peer => peer !== this.peer);
    this.relay.rooms.set(this.key, room);
    onClose(this.peer, room);
    this.emit('close', {});
  }
  private emit(type: string, event: { data?: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function bird(relay: FakeRelay, id: string, onChat = vi.fn()): SkyRelay {
  return new SkyRelay('wss://sky.test', { id, name: `鳥${id.slice(0, 4)}`, plumage: 'white' }, { onStatus: () => {}, onChat }, url => {
    const [, zone, room] = /\/sky\/([^/]+)\/(\d+)$/.exec(url)!;
    return new FakeClientSocket(relay, `${decodeURIComponent(zone)}:${room}`) as unknown as WebSocket;
  });
}

const flush = async (): Promise<void> => { for (let index = 0; index < 10; index += 1) await Promise.resolve(); };
const identity: [number, number, number, number] = [0, 0, 0, 1];
const court: [number, number, number] = [MEMORIAL_CENTRE.x, 200, MEMORIAL_CENTRE.z];

describe('relay rooms', () => {
  it('lets at most ROOM_CAP birds be members and turns the next one away', () => {
    const relay = new FakeRelay();
    const peers: FakeSocketPeer[] = [];
    const replies: string[] = [];
    for (let index = 0; index <= ROOM_CAP; index += 1) {
      const peer = new FakeSocketPeer({ deliver: (data: string) => replies.push(data), serverClosed: () => replies.push('closed') } as unknown as FakeClientSocket);
      peers.push(peer);
      onMessage(peer, JSON.stringify({ t: 'hello', id: `bird-${String(index).padStart(4, '0')}`, name: '甲' }), peers, 0);
    }
    expect(peers.filter(peer => peer.state()).length).toBe(ROOM_CAP);
    expect(replies.slice(-2)).toEqual([JSON.stringify({ t: 'full' }), 'closed']);
    void relay;
  });

  it('drops poses beyond the per-second limit and ignores poses from listeners', () => {
    const got: string[] = [];
    const listener = new FakeSocketPeer({ deliver: (data: string) => got.push(data) } as unknown as FakeClientSocket);
    const sender = new FakeSocketPeer({ deliver: () => {} } as unknown as FakeClientSocket);
    const peers = [listener, sender];
    onMessage(sender, JSON.stringify({ t: 'hello', id: 'sender-0001' }), peers, 0);
    got.length = 0;
    for (let index = 0; index < 20; index += 1) onMessage(sender, JSON.stringify({ t: 'pose', p: [1, 2, 3], q: identity }), peers, 1_500);
    expect(got).toHaveLength(MAX_POSES_PER_SECOND);
    onMessage(listener, JSON.stringify({ t: 'pose', p: [1, 2, 3], q: identity }), peers, 1_500);
    expect(got).toHaveLength(MAX_POSES_PER_SECOND);
  });

  it('cleans names and refuses malformed lines from the API', () => {
    const got: string[] = [];
    const peer = new FakeSocketPeer({ deliver: (data: string) => got.push(data) } as unknown as FakeClientSocket);
    expect(say({ speaker: 'abcd-1234', name: '阿明', body: '大家好', x: 1, z: 2 }, [peer])).toBe(true);
    expect(JSON.parse(got[0])).toMatchObject({ t: 'say', id: 'abcd-1234', name: '阿明', body: '大家好' });
    expect(say({ speaker: '<x>', name: '甲', body: '你好', x: 0, z: 0 }, [peer])).toBe(false);
    expect(say({ speaker: 'abcd-1234', name: '甲', body: '', x: 0, z: 0 }, [peer])).toBe(false);
  });
});

describe('SkyRelay in the browser, against the relay rooms', () => {
  let relay: FakeRelay;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
    relay = new FakeRelay();
  });
  afterEach(() => vi.useRealTimers());

  it('two birds over the court see each other, smoothly', async () => {
    const a = bird(relay, 'aaaa-0001');
    const b = bird(relay, 'bbbb-0002');
    a.sendPose(court, identity, false);
    b.sendPose(court, identity, false);
    await flush();
    vi.advanceTimersByTime(1_000);
    a.sendPose([court[0] + 5, 200, court[2]], identity, false);
    b.sendPose([court[0] + 5, 200, court[2]], identity, false);
    expect(a.homeZone).toBe(COURT_ZONE);
    expect(a.nearbyCount).toBe(2);
    const seen = a.snapshot(performance.now() + 2_000);
    expect(seen.map(player => player.id)).toEqual(['bbbb-0002']);
    expect(seen[0]).toMatchObject({ plumage: 'white' });
  });

  it('moves to the next room when the court room is full, and every zone moves with it', async () => {
    const crowd = Array.from({ length: ROOM_CAP }, (_, index) => bird(relay, `crowd-${String(index).padStart(4, '0')}`));
    for (const member of crowd) member.sendPose(court, identity, false);
    await flush();
    const late = bird(relay, 'late-0001');
    late.sendPose(court, identity, false);
    await flush();
    expect(late.currentRoom).toBe(2);
    late.sendPose(court, identity, false);
    await flush();
    expect(relay.peersIn(COURT_ZONE, 2).some(peer => peer.state()?.id === 'late-0001')).toBe(true);
    expect(relay.peersIn(COURT_ZONE, 1).filter(peer => peer.state()).length).toBe(ROOM_CAP);
  });

  it('shows a filtered line over the speaker for everyone in the room', async () => {
    const heard = vi.fn();
    const a = bird(relay, 'aaaa-0001', heard);
    const b = bird(relay, 'bbbb-0002');
    a.sendPose(court, identity, false);
    b.sendPose(court, identity, false);
    await flush();
    say({ speaker: 'bbbb-0002', name: '乙', body: '願你們安息', x: court[0], z: court[2] }, relay.peersIn(COURT_ZONE, 1));
    expect(heard).toHaveBeenCalledWith(expect.objectContaining({ speaker: 'bbbb-0002', body: '願你們安息' }));
  });

  it('flying on to another zone says bye in the old one and hello in the new', async () => {
    const a = bird(relay, 'aaaa-0001');
    a.sendPose(court, identity, false);
    await flush();
    vi.advanceTimersByTime(1_000);
    a.sendPose([2_400, 200, 2_400], identity, false);
    await flush();
    a.sendPose([2_400, 200, 2_400], identity, false);
    await flush();
    expect(a.homeZone).not.toBe(COURT_ZONE);
    expect(relay.peersIn(COURT_ZONE, 1).some(peer => peer.state()?.id === 'aaaa-0001')).toBe(false);
    expect(relay.peersIn(a.homeZone, 1).some(peer => peer.state()?.id === 'aaaa-0001')).toBe(true);
  });
});
