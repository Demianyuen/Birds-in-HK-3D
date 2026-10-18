import { describe, expect, it } from 'vitest';
import { RaceProgress, TAI_PO_LOOP, formatRaceTime, rankStandings, segmentHitsRing, type RaceCourse } from '../src/race/course';

const course: RaceCourse = {
  id: 'test', name: 'test', start: { position: [0, 0, 0], yawDegrees: 0 },
  rings: [{ position: [0, 0, -100], radius: 10 }, { position: [0, 0, -200], radius: 10 }],
};

describe('race course', () => {
  it('detects a swept pass through a ring even when both samples are outside it', () => {
    expect(segmentHitsRing([0, 0, -80], [0, 0, -120], course.rings[0])).toBe(true);
    expect(segmentHitsRing([30, 0, -80], [30, 0, -120], course.rings[0])).toBe(false);
  });

  it('requires rings in order and records the finish time', () => {
    const progress = new RaceProgress(course, 1_000);
    progress.advance([0, 0, 0], 1_000);
    expect(progress.advance([0, 0, -205], 5_000)).toEqual([0, 1]);
    expect(progress.finishedMs).toBe(4_000);
  });

  it('does not count a later ring before the earlier one', () => {
    const progress = new RaceProgress(course, 0);
    progress.advance([50, 0, -200], 0);
    progress.advance([-50, 0, -200], 1_000);
    expect(progress.ringsPassed).toBe(0);
  });

  it('ranks finishers first, then by rings', () => {
    const ranked = rankStandings([
      { id: 'a', name: 'A', rings: 3, finishMs: null },
      { id: 'b', name: 'B', rings: 10, finishMs: 90_000 },
      { id: 'c', name: 'C', rings: 10, finishMs: 80_000 },
      { id: 'd', name: 'D', rings: 5, finishMs: null },
    ]);
    expect(ranked.map(entry => entry.id)).toEqual(['c', 'b', 'd', 'a']);
  });

  it('keeps the Tai Po loop inside the playable radius', () => {
    for (const ring of TAI_PO_LOOP.rings) {
      expect(Math.hypot(ring.position[0], ring.position[2])).toBeLessThan(3_000);
      expect(ring.position[1]).toBeGreaterThan(20);
    }
    expect(formatRaceTime(83_456)).toBe('1:23.46');
  });
});
