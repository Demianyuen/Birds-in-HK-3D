/**
 * What one room of the shared sky does, apart from the Cloudflare plumbing
 * (so it can be tested with stand-in sockets).
 *
 * A room is one zone and one room number (see src/openWorld/zones.ts). Birds say
 * hello to become members (at most ROOM_CAP); anyone else connected only listens
 * (a neighbouring zone in sight). Poses from members go to everyone else in the
 * room. Lines said in the world arrive from the website's API, already filtered,
 * and go to everyone.
 */
import { checkName, CHAT_MAX } from '../../src/openWorld/contentRules';
import { ROOM_CAP } from '../../src/openWorld/zones';

export interface PeerState {
  id: string;
  name: string;
  plumage: string;
  /** Pose messages counted in the current one-second window. */
  window: number;
  count: number;
}

/** One connected socket, as the room sees it. */
export interface Peer {
  send(data: string): void;
  close(code: number, reason: string): void;
  state(): PeerState | null;
  setState(state: PeerState | null): void;
}

/** Poses a bird may send per second before the extras are dropped. */
export const MAX_POSES_PER_SECOND = 6;
const MAX_MESSAGE_BYTES = 600;
const ID_PATTERN = /^[A-Za-z0-9-]{8,40}$/;
const PLUMAGE_PATTERN = /^[a-z]{1,16}$/;

export function members(peers: readonly Peer[]): PeerState[] {
  return peers.map(peer => peer.state()).filter((state): state is PeerState => state !== null);
}

/** A socket has just joined the room: tell it who is here. */
export function onOpen(peer: Peer, peers: readonly Peer[]): void {
  peer.send(JSON.stringify({ t: 'welcome', members: members(peers.filter(other => other !== peer)).map(publicMember) }));
}

export function onMessage(peer: Peer, raw: string | ArrayBuffer, peers: readonly Peer[], now: number): void {
  if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_BYTES) return;
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    data = parsed as Record<string, unknown>;
  } catch {
    return;
  }
  if (data.t === 'hello') hello(peer, data, peers);
  else if (data.t === 'pose') pose(peer, data, peers, now);
  else if (data.t === 'bye') bye(peer, peers);
}

export function onClose(peer: Peer, peers: readonly Peer[]): void {
  const state = peer.state();
  if (!state) return;
  broadcast(peers, peer, JSON.stringify({ t: 'leave', id: state.id }));
}

/** A line already filtered by the website's API: everyone in the room sees it over the speaker's bird. */
export function say(line: { speaker: string; name: string; body: string; x: number; z: number }, peers: readonly Peer[]): boolean {
  if (!ID_PATTERN.test(line.speaker) || typeof line.body !== 'string' || !line.body || line.body.length > CHAT_MAX) return false;
  const name = checkName(line.name);
  const message = JSON.stringify({
    t: 'say',
    id: line.speaker,
    name: name.ok && name.text ? name.text : '訪客',
    body: line.body,
    x: finite(line.x),
    z: finite(line.z),
  });
  for (const other of peers) other.send(message);
  return true;
}

function hello(peer: Peer, data: Record<string, unknown>, peers: readonly Peer[]): void {
  if (peer.state()) return; // already a member
  if (typeof data.id !== 'string' || !ID_PATTERN.test(data.id)) return;
  const others = members(peers.filter(other => other !== peer));
  if (others.some(member => member.id === data.id)) return;
  if (others.length >= ROOM_CAP) {
    peer.send(JSON.stringify({ t: 'full' }));
    peer.close(4001, 'room full');
    return;
  }
  const name = checkName(data.name);
  const state: PeerState = {
    id: data.id,
    name: name.ok && name.text ? name.text : '訪客',
    plumage: typeof data.plumage === 'string' && PLUMAGE_PATTERN.test(data.plumage) ? data.plumage : 'natural',
    window: 0,
    count: 0,
  };
  peer.setState(state);
  broadcast(peers, peer, JSON.stringify({ t: 'join', ...publicMember(state) }));
}

/** The bird flew on to another zone: it stops being a member here but may keep listening. */
function bye(peer: Peer, peers: readonly Peer[]): void {
  const state = peer.state();
  if (!state) return;
  peer.setState(null);
  broadcast(peers, peer, JSON.stringify({ t: 'leave', id: state.id }));
}

function pose(peer: Peer, data: Record<string, unknown>, peers: readonly Peer[], now: number): void {
  const state = peer.state();
  if (!state) return; // listeners do not send poses
  const second = Math.floor(now / 1_000);
  if (second !== state.window) {
    state.window = second;
    state.count = 0;
  }
  state.count += 1;
  peer.setState(state);
  if (state.count > MAX_POSES_PER_SECOND) return;
  if (!isTuple(data.p, 3) || !isTuple(data.q, 4)) return;
  const [x, y, z] = data.p;
  if (Math.abs(x) > 6_000 || Math.abs(z) > 6_000 || y < -50 || y > 3_000) return;
  broadcast(peers, peer, JSON.stringify({ t: 'pose', id: state.id, p: data.p, q: data.q, g: data.g === true }));
}

function broadcast(peers: readonly Peer[], from: Peer, message: string): void {
  for (const other of peers) if (other !== from) other.send(message);
}

function publicMember(state: PeerState): { id: string; name: string; plumage: string } {
  return { id: state.id, name: state.name, plumage: state.plumage };
}

function isTuple(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every(item => typeof item === 'number' && Number.isFinite(item));
}

function finite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(-6_000, Math.min(6_000, value)) : 0;
}
