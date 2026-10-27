import type { VectorTile } from '@mapbox/vector-tile';
import type { TileFrame } from './PlaceNames';

/**
 * Where life moves: drivable roads, footpaths and open water, read from the
 * OpenStreetMap vector tiles the ground already loads, in local metres.
 */

export type LaneClass = 'motorway' | 'trunk' | 'primary' | 'secondary' | 'tertiary' | 'minor' | 'service' | 'path';

export interface StreetLine {
  points: Array<{ x: number; z: number }>;
  laneClass: LaneClass;
  /** 1: only along the points, -1: only against them, 0: both ways. */
  oneway: 0 | 1 | -1;
  bridge: boolean;
}

export interface WaterArea {
  /** Outer ring then holes, each closed implicitly. */
  rings: Array<Array<{ x: number; z: number }>>;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface StreetData {
  roads: StreetLine[];
  paths: StreetLine[];
  water: WaterArea[];
}

const DRIVABLE = new Set<LaneClass>(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor']);
const WALKABLE_PATHS = new Set(['footway', 'pedestrian', 'path', 'steps', 'living_street']);
const OPEN_WATER = new Set(['ocean', 'sea', 'lake', 'bay', 'river']);

export function emptyStreetData(): StreetData {
  return { roads: [], paths: [], water: [] };
}

export function extractStreetData(tile: VectorTile, frame: TileFrame, into: StreetData = emptyStreetData()): StreetData {
  const toWorld = (extent: number) => (point: { x: number; y: number }) => ({
    x: (frame.tileX + point.x / extent - frame.center.x) * frame.tileWidthMetres,
    z: (frame.tileY + point.y / extent - frame.center.y) * frame.tileWidthMetres,
  });

  const transportation = tile.layers.transportation;
  if (transportation) {
    const convert = toWorld(transportation.extent);
    for (let index = 0; index < transportation.length; index += 1) {
      const feature = transportation.feature(index);
      if (feature.type !== 2) continue;
      const properties = feature.properties as Record<string, string | number | boolean>;
      if (properties.brunnel === 'tunnel') continue;
      const roadClass = String(properties.class ?? '');
      const subclass = String(properties.subclass ?? '');
      const bridge = properties.brunnel === 'bridge';
      const oneway = properties.oneway === 1 ? 1 : properties.oneway === -1 ? -1 : 0;
      let laneClass: LaneClass | null = null;
      if (DRIVABLE.has(roadClass as LaneClass)) laneClass = roadClass as LaneClass;
      else if (roadClass === 'path' && WALKABLE_PATHS.has(subclass)) laneClass = 'path';
      else if (roadClass === 'path' && !subclass) laneClass = 'path';
      if (!laneClass) continue;
      for (const line of feature.loadGeometry()) {
        if (line.length < 2) continue;
        const points = line.map(convert);
        const street: StreetLine = { points, laneClass, oneway, bridge };
        if (laneClass === 'path') into.paths.push(street);
        else into.roads.push(street);
        // Pavements run beside ordinary streets: people walk there too.
        if (laneClass === 'minor' || laneClass === 'tertiary') into.paths.push({ points, laneClass, oneway: 0, bridge });
      }
    }
  }

  const water = tile.layers.water;
  if (water) {
    const convert = toWorld(water.extent);
    for (let index = 0; index < water.length; index += 1) {
      const feature = water.feature(index);
      if (feature.type !== 3) continue;
      const waterClass = String((feature.properties as Record<string, unknown>).class ?? '');
      if (waterClass && !OPEN_WATER.has(waterClass)) continue;
      const rings = feature.loadGeometry().map(ring => ring.map(convert));
      if (rings.length === 0 || rings[0].length < 3) continue;
      let minX = Infinity; let minZ = Infinity; let maxX = -Infinity; let maxZ = -Infinity;
      for (const point of rings[0]) {
        minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
        minZ = Math.min(minZ, point.z); maxZ = Math.max(maxZ, point.z);
      }
      // Ignore ponds too small for a boat.
      if ((maxX - minX) < 120 || (maxZ - minZ) < 120) continue;
      into.water.push({ rings, minX, minZ, maxX, maxZ });
    }
  }
  return into;
}

/** Even-odd point-in-polygon over all rings (holes included). */
export function insideWater(area: WaterArea, x: number, z: number): boolean {
  if (x < area.minX || x > area.maxX || z < area.minZ || z > area.maxZ) return false;
  let inside = false;
  for (const ring of area.rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const a = ring[i];
      const b = ring[j];
      if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    }
  }
  return inside;
}

export function inAnyWater(areas: readonly WaterArea[], x: number, z: number): boolean {
  return areas.some(area => insideWater(area, x, z));
}

/** Clear water the whole way between two points (sampled every ~15 m, with a margin from the shore). */
export function clearWaterLine(areas: readonly WaterArea[], ax: number, az: number, bx: number, bz: number, margin = 25): boolean {
  const length = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(2, Math.ceil(length / 15));
  const nx = length > 0 ? -(bz - az) / length : 0;
  const nz = length > 0 ? (bx - ax) / length : 0;
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    if (!inAnyWater(areas, x, z) || !inAnyWater(areas, x + nx * margin, z + nz * margin) || !inAnyWater(areas, x - nx * margin, z - nz * margin)) return false;
  }
  return true;
}
