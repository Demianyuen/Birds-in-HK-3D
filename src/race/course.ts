import type { Position } from '../multiplayer/protocol';

export interface RaceRing {
  position: Position;
  radius: number;
}

export interface RaceCourse {
  id: string;
  name: string;
  start: { position: Position; yawDegrees: number };
  rings: readonly RaceRing[];
}

/**
 * Tai Po loop. Local frame: metres, +x east, +y up, +z south, origin at Wang Fuk Court.
 * Ring heights keep clear of the CSDI towers; low rings sit over Tolo Harbour
 * and the Lam Tsuen River where there is nothing to hit.
 */
export const TAI_PO_LOOP: RaceCourse = Object.freeze({
  id: 'tai-po-loop',
  name: '大埔環線',
  start: { position: [0, 175, 760] as Position, yawDegrees: 0 },
  rings: Object.freeze([
    { position: [0, 165, 320], radius: 20 },
    { position: [260, 155, -180], radius: 20 },
    { position: [720, 115, -480], radius: 20 },
    { position: [1120, 45, -300], radius: 22 },
    { position: [1420, 32, 180], radius: 22 },
    { position: [1040, 60, 700], radius: 22 },
    { position: [520, 140, 1020], radius: 20 },
    { position: [-200, 165, 920], radius: 20 },
    { position: [-620, 150, 420], radius: 20 },
    { position: [-320, 165, -20], radius: 20 },
  ] as RaceRing[]),
}) as RaceCourse;

export const RACE_COURSES: Readonly<Record<string, RaceCourse>> = Object.freeze({
  [TAI_PO_LOOP.id]: TAI_PO_LOOP,
});

/** True when the swept segment a→b passes within the ring's radius of its centre. */
export function segmentHitsRing(a: Position, b: Position, ring: RaceRing): boolean {
  const [cx, cy, cz] = ring.position;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  let t = 0;
  if (lengthSquared > 1e-9) {
    t = ((cx - a[0]) * dx + (cy - a[1]) * dy + (cz - a[2]) * dz) / lengthSquared;
    t = Math.min(1, Math.max(0, t));
  }
  const px = a[0] + dx * t - cx;
  const py = a[1] + dy * t - cy;
  const pz = a[2] + dz * t - cz;
  return px * px + py * py + pz * pz <= ring.radius * ring.radius;
}

/** Ordered ring progress for one racer. Pure and shared by server and solo mode. */
export class RaceProgress {
  public nextRing = 0;
  public finishedMs: number | null = null;
  private last: Position | null = null;

  public constructor(private readonly course: RaceCourse, private readonly startedAt: number) {}

  public get ringsPassed(): number {
    return this.nextRing;
  }

  public get finished(): boolean {
    return this.finishedMs !== null;
  }

  /** Feed a new position; returns the ring indices passed by this movement. */
  public advance(position: Position, time: number): number[] {
    const passed: number[] = [];
    const previous = this.last;
    this.last = [...position] as Position;
    if (!previous || this.finished) return passed;
    // Allow several rings in one long step (low update rate), but strictly in order.
    while (this.nextRing < this.course.rings.length
      && segmentHitsRing(previous, position, this.course.rings[this.nextRing])) {
      passed.push(this.nextRing);
      this.nextRing++;
    }
    if (this.nextRing >= this.course.rings.length && this.finishedMs === null) {
      this.finishedMs = Math.max(0, Math.round(time - this.startedAt));
    }
    return passed;
  }

  public reset(position: Position): void {
    this.last = [...position] as Position;
  }
}

export type RacePhase = 'lobby' | 'countdown' | 'racing' | 'results';

export interface RaceStanding {
  id: string;
  name: string;
  rings: number;
  finishMs: number | null;
  /** Server-assigned start slot for this round. */
  start?: Position;
}

export interface RaceState {
  type: 'race';
  round: number;
  phase: RacePhase;
  courseId: string;
  serverTime: number;
  phaseEndsAt: number;
  standings: RaceStanding[];
}

export const RACE_TIMING = Object.freeze({
  countdownMs: 8_000,
  raceMs: 180_000,
  resultsMs: 12_000,
  finishGraceMs: 15_000,
});

/** Rank: finishers by time, then by rings passed, then by name for stability. */
export function rankStandings(standings: RaceStanding[]): RaceStanding[] {
  return [...standings].sort((left, right) => {
    if (left.finishMs !== null && right.finishMs !== null) return left.finishMs - right.finishMs;
    if (left.finishMs !== null) return -1;
    if (right.finishMs !== null) return 1;
    if (right.rings !== left.rings) return right.rings - left.rings;
    return left.name.localeCompare(right.name);
  });
}

export function formatRaceTime(milliseconds: number): string {
  const total = Math.max(0, Math.round(milliseconds / 10));
  const minutes = Math.floor(total / 6_000);
  const seconds = Math.floor((total % 6_000) / 100);
  const hundredths = total % 100;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}
