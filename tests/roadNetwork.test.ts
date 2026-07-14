import { describe, expect, it } from 'vitest';
import {
  classifyRoad,
  roadStyle,
  roadTileCount,
  vectorTilePointToWorld,
} from '../src/game/RoadNetwork';
import { getFlightRegion } from '../src/game/regions';

describe('regional real-road network', () => {
  it('keeps driveable OpenStreetMap road classes and rejects non-road geometry', () => {
    expect(classifyRoad({ class: 'primary' }, 2)).toBe('primary');
    expect(classifyRoad({ class: 'service' }, 2)).toBe('service');
    expect(classifyRoad({ class: 'path' }, 2)).toBeNull();
    expect(classifyRoad({ class: 'rail' }, 2)).toBeNull();
    expect(classifyRoad({ class: 'primary', brunnel: 'tunnel' }, 2)).toBeNull();
    expect(classifyRoad({ class: 'primary' }, 3)).toBeNull();
  });

  it('renders major roads wider than local streets', () => {
    expect(roadStyle('motorway').widthMetres).toBeGreaterThan(roadStyle('primary').widthMetres);
    expect(roadStyle('primary').widthMetres).toBeGreaterThan(roadStyle('minor').widthMetres);
    expect(roadStyle('minor').widthMetres).toBeGreaterThan(roadStyle('service').widthMetres);
    expect(roadStyle('motorway').markings).toBe(true);
    expect(roadStyle('service').markings).toBe(false);
  });

  it('maps vector-tile coordinates into the local east-south game frame', () => {
    const centre = { x: 100.5, y: 200.5 };
    const origin = vectorTilePointToWorld(100, 200, 2_048, 2_048, 4_096, centre, 2_000);
    expect(origin.x).toBeCloseTo(0);
    expect(origin.z).toBeCloseTo(0);

    const southEast = vectorTilePointToWorld(100, 200, 3_072, 3_072, 4_096, centre, 2_000);
    expect(southEast.x).toBeCloseTo(500);
    expect(southEast.z).toBeCloseTo(500);
  });

  it('limits road downloads to the Tai Po flight district', () => {
    const count = roadTileCount(getFlightRegion('tai-po'));
    expect(count).toBeGreaterThanOrEqual(9);
    expect(count).toBeLessThanOrEqual(25);
  });
});
