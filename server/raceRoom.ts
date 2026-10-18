import {
  RACE_TIMING,
  RaceProgress,
  TAI_PO_LOOP,
  rankStandings,
  type RaceCourse,
  type RacePhase,
  type RaceState,
} from '../src/race/course';
import type { Position, WorldPlayer } from '../src/multiplayer/protocol';

interface Participant {
  name: string;
  start: Position;
  progress: RaceProgress;
}

export interface RaceTick {
  /** Phase changed this tick; broadcast immediately. */
  changed: boolean;
  /** Players the server moved to their start slot; their next poses get a grace window. */
  teleported: Map<string, Position>;
}

const LOBBY_WAIT_MS = 4_000;
const SLOT_SPACING_METRES = 9;

/**
 * Server-authoritative race rounds for one room. Ring passes are computed here
 * from the validated pose stream, never reported by clients.
 */
export class RaceRoom {
  public round = 0;
  public phase: RacePhase = 'lobby';
  public phaseEndsAt: number;
  private readonly participants = new Map<string, Participant>();
  private firstFinishAt: number | null = null;

  public constructor(public readonly course: RaceCourse = TAI_PO_LOOP, now = Date.now()) {
    this.phaseEndsAt = now + LOBBY_WAIT_MS;
  }

  public tick(players: readonly WorldPlayer[], now: number): RaceTick {
    const teleported = new Map<string, Position>();
    const present = new Set(players.map(player => player.id));
    for (const id of [...this.participants.keys()]) {
      if (!present.has(id) && this.phase !== 'results') this.participants.delete(id);
    }
    if (players.length === 0) {
      const changed = this.phase !== 'lobby';
      this.reset(now);
      return { changed, teleported };
    }
    if (now < this.phaseEndsAt && !this.shouldEndRaceEarly(now)) return { changed: false, teleported };

    switch (this.phase) {
      case 'lobby': {
        this.round++;
        this.phase = 'countdown';
        this.phaseEndsAt = now + RACE_TIMING.countdownMs;
        this.participants.clear();
        this.firstFinishAt = null;
        const ordered = [...players].sort((left, right) => left.id.localeCompare(right.id));
        ordered.forEach((player, index) => {
          const start = this.startSlot(index, ordered.length);
          this.participants.set(player.id, {
            name: player.name,
            start,
            progress: new RaceProgress(this.course, this.phaseEndsAt),
          });
          teleported.set(player.id, start);
        });
        break;
      }
      case 'countdown':
        this.phase = 'racing';
        this.phaseEndsAt = now + RACE_TIMING.raceMs;
        for (const participant of this.participants.values()) {
          participant.progress = new RaceProgress(this.course, now);
          participant.progress.reset(participant.start);
        }
        break;
      case 'racing':
        this.phase = 'results';
        this.phaseEndsAt = now + RACE_TIMING.resultsMs;
        break;
      case 'results':
        this.phase = 'lobby';
        this.phaseEndsAt = now + LOBBY_WAIT_MS;
        break;
    }
    return { changed: true, teleported };
  }

  /** True while a participant must stay on the start line. */
  public isHeld(playerId: string): boolean {
    return this.phase === 'countdown' && this.participants.has(playerId);
  }

  public startOf(playerId: string): Position | null {
    return this.participants.get(playerId)?.start ?? null;
  }

  /** Feed an accepted pose. Returns ring indices passed by this movement. */
  public observe(playerId: string, position: Position, now: number): number[] {
    if (this.phase !== 'racing') return [];
    const participant = this.participants.get(playerId);
    if (!participant) return [];
    const passed = participant.progress.advance(position, now);
    if (participant.progress.finished && this.firstFinishAt === null) this.firstFinishAt = now;
    return passed;
  }

  public state(now: number): RaceState {
    return {
      type: 'race',
      round: this.round,
      phase: this.phase,
      courseId: this.course.id,
      serverTime: now,
      phaseEndsAt: this.phaseEndsAt,
      standings: rankStandings([...this.participants.entries()].map(([id, participant]) => ({
        id,
        name: participant.name,
        rings: participant.progress.ringsPassed,
        finishMs: participant.progress.finishedMs,
        start: participant.start,
      }))),
    };
  }

  private shouldEndRaceEarly(now: number): boolean {
    if (this.phase !== 'racing' || this.participants.size === 0) return false;
    const everyone = [...this.participants.values()].every(participant => participant.progress.finished);
    if (everyone) return now >= (this.firstFinishAt ?? now) + 2_000;
    return this.firstFinishAt !== null && now >= this.firstFinishAt + RACE_TIMING.finishGraceMs;
  }

  private startSlot(index: number, count: number): Position {
    const [x, y, z] = this.course.start.position;
    const yaw = this.course.start.yawDegrees * Math.PI / 180;
    const offset = (index - (count - 1) / 2) * SLOT_SPACING_METRES;
    // Lateral axis for a heading of `yaw` (forward is -z at yaw 0).
    return [x + Math.cos(yaw) * offset, y + (index % 2) * 3, z - Math.sin(yaw) * offset];
  }

  private reset(now: number): void {
    this.phase = 'lobby';
    this.phaseEndsAt = now + LOBBY_WAIT_MS;
    this.participants.clear();
    this.firstFinishAt = null;
  }
}
