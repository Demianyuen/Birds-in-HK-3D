import { describe, expect, it } from 'vitest';
import { QualityLadder } from '../src/game/QualityLadder';

function feed(ladder: QualityLadder, fps: number, seconds: number, start: number): { now: number; changes: number[] } {
  const changes: number[] = [];
  let now = start;
  for (let frame = 0; frame < fps * seconds; frame += 1) {
    now += 1_000 / fps;
    const level = ladder.update(now);
    if (level !== null) changes.push(level);
  }
  return { now, changes };
}

describe('quality ladder', () => {
  it('steps all the way down within seconds on a computer drawing two frames a second', () => {
    const ladder = new QualityLadder();
    const { changes } = feed(ladder, 2, 30, 0);
    expect(changes).toEqual([1, 2, 3]);
  });

  it('leaves a smooth computer alone, and climbs back slowly when there is headroom', () => {
    const ladder = new QualityLadder();
    expect(feed(ladder, 60, 20, 0).changes).toEqual([]);
    const slow = feed(ladder, 15, 10, 20_000);
    expect(slow.changes[0]).toBe(1);
    const fast = feed(ladder, 60, 30, slow.now);
    expect(fast.changes).toContain(0);
  });

  it('ignores a long stall such as a hidden tab', () => {
    const ladder = new QualityLadder();
    ladder.update(0);
    expect(ladder.update(30_000)).toBeNull();
    expect(ladder.level).toBe(0);
  });
});
