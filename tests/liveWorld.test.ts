import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveWorld, type LiveClient } from '../src/openWorld/LiveWorld';
import { MEMORIAL_CENTRE } from '../src/openWorld/contentRules';
import { COURT_ZONE, ROOM_CAP, ZONE_CELL, channelName } from '../src/openWorld/zones';

type Handler = (payload: unknown) => void;

/** A stand-in for a Supabase Realtime channel: subscribes at once and reports whoever the test says is present. */
class FakeChannel {
  public handlers = new Map<string, Handler>();
  public sent: unknown[] = [];
  public tracked: unknown = null;
  public present: string[] = [];
  public constructor(public readonly name: string, private readonly selfId: string) {}
  public on(type: string, filter: { event: string }, handler: Handler): this {
    this.handlers.set(`${type}:${filter.event}`, handler);
    return this;
  }
  public subscribe(callback?: (status: string) => void): this {
    queueMicrotask(() => {
      callback?.('SUBSCRIBED');
      this.handlers.get('presence:sync')?.(undefined);
    });
    return this;
  }
  public presenceState(): Record<string, Array<{ name: string }>> {
    return Object.fromEntries([...this.present, ...(this.tracked ? [this.selfId] : [])].map(id => [id, [{ name: `bird-${id}` }]]));
  }
  public async track(meta: unknown): Promise<void> {
    this.tracked = meta;
    this.handlers.get('presence:sync')?.(undefined); // Realtime syncs presence after our own join
  }
  public async untrack(): Promise<void> {
    this.tracked = null;
    this.handlers.get('presence:sync')?.(undefined);
  }
  public async send(message: unknown): Promise<void> { this.sent.push(message); }
  public receive(payload: unknown): void { this.handlers.get('broadcast:pose')?.({ payload }); }
}

class FakeClient {
  public readonly channels: FakeChannel[] = [];
  public removed: string[] = [];
  public crowded = new Map<string, string[]>();
  public constructor(private readonly selfId: string) {}
  public channel(name: string): FakeChannel {
    const channel = new FakeChannel(name, this.selfId);
    channel.present = this.crowded.get(name) ?? [];
    this.channels.push(channel);
    return channel;
  }
  public removeChannel(channel: FakeChannel): Promise<string> { this.removed.push(channel.name); return Promise.resolve('ok'); }
  public from(): never { throw new Error('not used'); }
  public byName(name: string): FakeChannel | undefined { return [...this.channels].reverse().find(channel => channel.name === name); }
}

const flush = async (): Promise<void> => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); };
const config = { supabaseUrl: 'https://example.invalid', anonKey: 'x' };
const identity: [number, number, number, number] = [0, 0, 0, 1];

describe('LiveWorld zones and rooms', () => {
  let client: FakeClient;
  let world: LiveWorld;

  beforeEach(() => {
    vi.useFakeTimers();
    client = new FakeClient('me');
  });
  afterEach(() => {
    world.dispose();
    vi.useRealTimers();
  });

  function join(): LiveWorld {
    world = new LiveWorld(config, { id: 'me', name: '訪客甲' }, { onStatus: () => {}, onChat: () => {} }, client as unknown as LiveClient);
    return world;
  }

  it('announces itself and sends poses only in the zone it flies over', async () => {
    join().connect();
    world.sendPose([MEMORIAL_CENTRE.x + 50, 200, MEMORIAL_CENTRE.z], identity, false);
    await flush();
    expect(world.homeZone).toBe(COURT_ZONE);
    const home = client.byName(channelName(COURT_ZONE, 1))!;
    expect(home.tracked).toEqual({ name: '訪客甲' });
    vi.setSystemTime(Date.now() + 1_000);
    world.sendPose([MEMORIAL_CENTRE.x + 60, 200, MEMORIAL_CENTRE.z], identity, false);
    expect(home.sent).toHaveLength(1);
    // Neighbouring zones are only listened to, never announced in.
    for (const channel of client.channels.filter(item => item !== home && item.name.startsWith('birds-in-hk:z:'))) {
      expect(channel.tracked).toBeNull();
      expect(channel.sent).toHaveLength(0);
    }
  });

  it('opens a new room when the first is full', async () => {
    client.crowded.set(channelName(COURT_ZONE, 1), Array.from({ length: ROOM_CAP }, (_, index) => `b${index}`));
    join().connect();
    world.sendPose([MEMORIAL_CENTRE.x, 200, MEMORIAL_CENTRE.z], identity, false);
    await flush();
    expect(world.currentRoom).toBe(2);
    expect(client.byName(channelName(COURT_ZONE, 2))?.tracked).not.toBeNull();
    expect(client.byName(channelName(COURT_ZONE, 1))?.tracked ?? null).toBeNull();
    expect(client.removed).toContain(channelName(COURT_ZONE, 1));
  });

  it('shows another bird smoothly once it is present and sending', async () => {
    client.crowded.set(channelName(COURT_ZONE, 1), ['you']);
    join().connect();
    world.sendPose([MEMORIAL_CENTRE.x, 200, MEMORIAL_CENTRE.z], identity, false);
    await flush();
    const home = client.byName(channelName(COURT_ZONE, 1))!;
    expect(world.nearbyCount).toBe(2);
    home.receive({ id: 'you', p: [10, 100, 10], q: identity, g: false });
    expect(world.snapshot()).toHaveLength(1);
    expect(world.snapshot()[0].name).toBe('bird-you');
    // Someone who is not in the presence list is ignored.
    home.receive({ id: 'stranger', p: [10, 100, 10], q: identity, g: false });
    expect(world.snapshot()).toHaveLength(1);
  });

  it('moves its voice to the next zone and lets go of zones left far behind', async () => {
    join().connect();
    world.sendPose([2_000, 200, 2_000], identity, false); // far from the court
    await flush();
    const first = world.homeZone;
    expect(first).not.toBe(COURT_ZONE);
    vi.setSystemTime(Date.now() + 2_000);
    world.sendPose([2_000 + ZONE_CELL * 3, 200, 2_000], identity, false);
    await flush();
    expect(world.homeZone).not.toBe(first);
    expect(world.listening).not.toContain(first);
    expect(client.byName(channelName(first, 1))?.tracked ?? null).toBeNull();
  });
});
