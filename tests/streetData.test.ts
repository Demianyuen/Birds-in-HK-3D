import type { VectorTile } from '@mapbox/vector-tile';
import { describe, expect, it } from 'vitest';
import { clearWaterLine, extractStreetData, insideWater, type WaterArea } from '../src/game/streetData';

function layer(extent: number, features: Array<{ type: number; properties: Record<string, unknown>; geometry: Array<Array<[number, number]>> }>) {
  return {
    length: features.length,
    extent,
    feature: (index: number) => ({
      type: features[index].type,
      properties: features[index].properties,
      loadGeometry: () => features[index].geometry.map(ring => ring.map(([x, y]) => ({ x, y }))),
    }),
  };
}

const frame = { tileX: 0, tileY: 0, center: { x: 0, y: 0 }, tileWidthMetres: 4096 };

describe('street data from map tiles', () => {
  it('keeps drivable roads, footpaths and pavements, and skips tunnels', () => {
    const tile = {
      layers: {
        transportation: layer(4096, [
          { type: 2, properties: { class: 'primary', oneway: 1 }, geometry: [[[0, 0], [100, 0]]] },
          { type: 2, properties: { class: 'minor' }, geometry: [[[0, 10], [50, 10]]] },
          { type: 2, properties: { class: 'path', subclass: 'footway' }, geometry: [[[0, 20], [30, 20]]] },
          { type: 2, properties: { class: 'motorway', brunnel: 'tunnel' }, geometry: [[[0, 30], [90, 30]]] },
          { type: 2, properties: { class: 'rail' }, geometry: [[[0, 40], [90, 40]]] },
        ]),
      },
    } as unknown as VectorTile;
    const data = extractStreetData(tile, frame);
    expect(data.roads.map(road => road.laneClass)).toEqual(['primary', 'minor']);
    expect(data.roads[0].oneway).toBe(1);
    expect(data.roads[0].points[1]).toEqual({ x: 100, z: 0 });
    // The footway, plus the pavement beside the minor street.
    expect(data.paths.map(path => path.laneClass).sort()).toEqual(['minor', 'path']);
  });

  it('keeps open water large enough for boats', () => {
    const tile = {
      layers: {
        water: layer(4096, [
          { type: 3, properties: { class: 'ocean' }, geometry: [[[0, 0], [1000, 0], [1000, 1000], [0, 1000]]] },
          { type: 3, properties: { class: 'pond' }, geometry: [[[0, 0], [500, 0], [500, 500], [0, 500]]] },
          { type: 3, properties: { class: 'lake' }, geometry: [[[0, 0], [50, 0], [50, 50], [0, 50]]] },
        ]),
      },
    } as unknown as VectorTile;
    expect(extractStreetData(tile, frame).water).toHaveLength(1);
  });
});

describe('water tests', () => {
  const bay: WaterArea = {
    rings: [
      [{ x: 0, z: 0 }, { x: 1000, z: 0 }, { x: 1000, z: 1000 }, { x: 0, z: 1000 }],
      // An island in the middle.
      [{ x: 400, z: 400 }, { x: 600, z: 400 }, { x: 600, z: 600 }, { x: 400, z: 600 }],
    ],
    minX: 0, minZ: 0, maxX: 1000, maxZ: 1000,
  };
  it('knows water from land and islands', () => {
    expect(insideWater(bay, 100, 100)).toBe(true);
    expect(insideWater(bay, 500, 500)).toBe(false);
    expect(insideWater(bay, 1500, 100)).toBe(false);
  });
  it('only plots a boat course through open water', () => {
    expect(clearWaterLine([bay], 100, 100, 900, 100)).toBe(true);
    expect(clearWaterLine([bay], 100, 500, 900, 500)).toBe(false);
    expect(clearWaterLine([bay], 100, 100, 1400, 100)).toBe(false);
  });
});
