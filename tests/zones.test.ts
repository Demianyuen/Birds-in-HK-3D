import { describe, expect, it } from 'vitest';
import { MEMORIAL_CENTRE } from '../src/openWorld/contentRules';
import { COURT_ZONE, JOIN_RADIUS, LEAVE_RADIUS, MAX_ROOMS, ROOM_CAP, ZONE_CELL, ZoneWatch, channelName, pickRoom, poseIntervalMs, zoneOf, zonesNear } from '../src/openWorld/zones';

describe('zones', () => {
  it('puts everything around Wang Fuk Court in one zone and the rest in grid cells', () => {
    expect(zoneOf(MEMORIAL_CENTRE.x, MEMORIAL_CENTRE.z)).toBe(COURT_ZONE);
    expect(zoneOf(MEMORIAL_CENTRE.x + 300, MEMORIAL_CENTRE.z)).toBe(COURT_ZONE);
    expect(zoneOf(1560, -640)).toBe(`c${Math.floor(1560 / ZONE_CELL)}_${Math.floor(-640 / ZONE_CELL)}`);
    expect(zoneOf(-2000, -2000)).toBe('c-3_-3');
  });

  it('lists the zones within sight of a point, including its own', () => {
    expect(zonesNear(1560, -640, 10)).toEqual([zoneOf(1560, -640)]);
    const nearBorder = zonesNear(ZONE_CELL - 20, 1500, JOIN_RADIUS);
    expect(nearBorder).toContain(zoneOf(ZONE_CELL - 20, 1500));
    expect(nearBorder).toContain(zoneOf(ZONE_CELL + 100, 1500));
  });

  it('joins a zone before reaching it and leaves it only well after, so border flights do not flap', () => {
    const watch = new ZoneWatch();
    const start = watch.update(1560, -640);
    expect(start.join).toContain(start.home);
    expect(watch.update(1560, -640)).toMatchObject({ join: [], leave: [] });

    const border = ZONE_CELL * 2; // x = 1600 is a cell edge
    const near = new ZoneWatch();
    near.update(border - (JOIN_RADIUS - 50), 100);
    expect(near.zones).toContain(zoneOf(border + 10, 100));
    // Just across the border: nothing joined or left, the old zone is still within LEAVE_RADIUS.
    const across = near.update(border + 40, 100);
    expect(across.leave).toEqual([]);
    expect(across.home).toBe(zoneOf(border + 40, 100));
    // Far enough away, the old zone is let go.
    const away = near.update(border + LEAVE_RADIUS + 60, 100);
    expect(away.leave).toContain(zoneOf(border - 50, 100));
  });

  it('sends a bird to the next room once a room is full', () => {
    expect(pickRoom([])).toBe(1);
    expect(pickRoom([3])).toBe(1);
    expect(pickRoom([ROOM_CAP])).toBe(2);
    expect(pickRoom([ROOM_CAP, 5])).toBe(2);
    expect(pickRoom([ROOM_CAP, ROOM_CAP])).toBe(3);
    expect(pickRoom(Array.from({ length: MAX_ROOMS }, () => ROOM_CAP))).toBe(MAX_ROOMS);
  });

  it('names channels by zone and room, and keeps pose rates between 2 and 4 a second while moving', () => {
    expect(channelName('court', 2)).toBe('birds-in-hk:z:court:r2');
    expect(1000 / poseIntervalMs(26)).toBe(4);
    expect(1000 / poseIntervalMs(1.4)).toBe(2);
    expect(poseIntervalMs(0)).toBeGreaterThanOrEqual(4_000);
  });
});
