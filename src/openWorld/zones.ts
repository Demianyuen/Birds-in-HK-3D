import { MEMORIAL_CENTRE } from './contentRules';

/**
 * Shared sky, divided into zones so nobody has to hear about the whole world.
 * A bird only talks in the zone it is flying over, and only listens to the
 * zones within sight. Each zone is split into rooms of a few birds, so the
 * sky above Wang Fuk Court never turns into a crowd.
 *
 * Zones (local frame, metres; +x east, +z south):
 * - "court": the circle around Wang Fuk Court, where flowers are laid.
 * - everything else: square cells of ZONE_CELL metres.
 */
export const COURT_ZONE = 'court';
export const COURT_ZONE_RADIUS = 420;
export const ZONE_CELL = 800;
/** A zone is listened to once the bird is this close to it, and let go beyond LEAVE_RADIUS (so border flights do not flap). */
export const JOIN_RADIUS = 350;
export const LEAVE_RADIUS = 500;
/** Birds drawn per room; a full room sends the next arrival to the next room. */
export const ROOM_CAP = 24;
export const MAX_ROOMS = 6;

export function zoneOf(x: number, z: number): string {
  if (Math.hypot(x - MEMORIAL_CENTRE.x, z - MEMORIAL_CENTRE.z) <= COURT_ZONE_RADIUS) return COURT_ZONE;
  return `c${Math.floor(x / ZONE_CELL)}_${Math.floor(z / ZONE_CELL)}`;
}

/** Every zone with some ground within `radius` of the point (sampled around a circle). */
export function zonesNear(x: number, z: number, radius: number): string[] {
  const found = new Set<string>([zoneOf(x, z)]);
  for (let step = 0; step < 16; step += 1) {
    const angle = (step / 16) * Math.PI * 2;
    found.add(zoneOf(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius));
  }
  return [...found];
}

export interface ZoneChange {
  /** The zone the bird is over now: where it talks. */
  home: string;
  join: string[];
  leave: string[];
}

/** Which zones to listen to as the bird moves. Joins early, leaves late. */
export class ZoneWatch {
  private readonly watching = new Set<string>();

  public update(x: number, z: number): ZoneChange {
    const home = zoneOf(x, z);
    const wanted = new Set([home, ...zonesNear(x, z, JOIN_RADIUS)]);
    const keep = new Set([home, ...zonesNear(x, z, LEAVE_RADIUS)]);
    const join = [...wanted].filter(zone => !this.watching.has(zone));
    const leave = [...this.watching].filter(zone => !keep.has(zone));
    for (const zone of join) this.watching.add(zone);
    for (const zone of leave) this.watching.delete(zone);
    return { home, join, leave };
  }

  public get zones(): readonly string[] {
    return [...this.watching];
  }

  public reset(): void {
    this.watching.clear();
  }
}

/** First room with space, given how many birds are in each room tried so far. */
export function pickRoom(counts: readonly number[], cap = ROOM_CAP): number {
  const free = counts.findIndex(count => count < cap);
  if (free >= 0) return free + 1;
  return Math.min(counts.length + 1, MAX_ROOMS);
}

export function channelName(zone: string, room: number): string {
  return `birds-in-hk:z:${zone}:r${room}`;
}

/**
 * Pose messages per second are kept low: flying birds send about 4 a second,
 * slow walkers 2, and a bird standing still only a heartbeat now and then.
 */
export function poseIntervalMs(metresPerSecond: number): number {
  if (metresPerSecond > 6) return 250;
  if (metresPerSecond > 0.3) return 500;
  return 4_000;
}

export function zoneLabel(zone: string): string {
  return zone === COURT_ZONE ? '宏福苑一帶' : '大埔上空';
}
