import { describe, expect, it } from 'vitest';
import { RaceRoom } from '../server/raceRoom';
import { RACE_TIMING, type RaceCourse } from '../src/race/course';
import type { WorldPlayer } from '../src/multiplayer/protocol';

const course: RaceCourse = {
  id: 'line', name: 'line', start: { position: [0, 100, 0], yawDegrees: 0 },
  rings: [{ position: [0, 100, -100], radius: 12 }, { position: [0, 100, -200], radius: 12 }],
};
const player = (id: string): WorldPlayer => ({ id, name: id, position: [0, 100, 0], quaternion: [0, 0, 0, 1], perched: false });

describe('server race room', () => {
  it('runs lobby → countdown → racing → results with server-scored rings', () => {
    let now = 0;
    const room = new RaceRoom(course, now);
    const players = [player('a'), player('b')];
    expect(room.tick(players, now).changed).toBe(false);

    now = 4_000;
    const countdown = room.tick(players, now);
    expect(room.phase).toBe('countdown');
    expect(countdown.teleported.size).toBe(2);
    expect(room.isHeld('a')).toBe(true);

    now += RACE_TIMING.countdownMs;
    room.tick(players, now);
    expect(room.phase).toBe('racing');
    const startA = room.startOf('a')!;
    room.observe('a', [startA[0], 100, -150], now + 5_000);
    room.observe('a', [startA[0], 100, -230], now + 9_000);
    const standings = room.state(now + 9_000).standings;
    expect(standings[0]).toMatchObject({ id: 'a', rings: 2, finishMs: 9_000 });
    expect(standings[1]).toMatchObject({ id: 'b', rings: 0, finishMs: null });

    room.tick(players, now + 9_000 + RACE_TIMING.finishGraceMs);
    expect(room.phase).toBe('results');
  });

  it('ignores ring passes before the race starts', () => {
    const room = new RaceRoom(course, 0);
    room.tick([player('a')], 4_000);
    expect(room.observe('a', [0, 100, -250], 5_000)).toEqual([]);
  });

  it('returns to the lobby when everyone leaves', () => {
    const room = new RaceRoom(course, 0);
    room.tick([player('a')], 4_000);
    expect(room.tick([], 5_000).changed).toBe(true);
    expect(room.phase).toBe('lobby');
  });
});
