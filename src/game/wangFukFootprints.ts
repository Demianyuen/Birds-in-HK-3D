import { WANG_FUK_ADDRESS_POINTS } from './wangFukLocations';

// Exact identifiers returned by ALS GeoAddress and LandsD BuildingCSUID.
const CSUIDS = [
  '3606934204T20050430', '3607934169T20050430', '3610734143T20050430', '3614434142T20050430',
  '3616834118T20050430', '3620734120T20050430', '3620534159T20050430', '3619734202T20050430',
];

export interface WangFukFootprint {
  block: string;
  name: string;
  buildingId: number;
  csuid: string;
  baseHeight: number;
  topHeight: number;
  rings: [number, number][][];
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function extractWangFukFootprints(input: unknown): WangFukFootprint[] {
  if (!record(input) || input.type !== 'FeatureCollection' || !Array.isArray(input.features)) throw new Error('Expected building FeatureCollection.');
  const features = input.features;
  return WANG_FUK_ADDRESS_POINTS.map((point, index) => {
    const matches = features.filter(feature => record(feature) && record(feature.properties)
      && feature.properties.BuildingCSUID === CSUIDS[index]);
    if (matches.length !== 1) throw new Error(`Block ${point.block}: missing or duplicate identity.`);
    const feature = matches[0] as Record<string, unknown>;
    const properties = feature.properties as Record<string, unknown>;
    const name = properties.BuildingNameTC;
    if (typeof name !== 'string' || name.replace(/\([A-H]座\)$/, '') !== point.name) throw new Error(`Block ${point.block}: name mismatch.`);
    const { BaseHeight: base, TopHeight: top, BuildingID: id } = properties;
    if (typeof base !== 'number' || typeof top !== 'number' || !Number.isFinite(base) || !Number.isFinite(top)
      || top <= base || top - base > 300) throw new Error(`Block ${point.block}: invalid height.`);
    if (typeof id !== 'number' || !Number.isSafeInteger(id)) throw new Error(`Block ${point.block}: invalid building ID.`);
    const geometry = feature.geometry;
    if (!record(geometry) || geometry.type !== 'Polygon' || !Array.isArray(geometry.coordinates) || !geometry.coordinates.length) {
      throw new Error(`Block ${point.block}: expected polygon.`);
    }
    const rings = geometry.coordinates.map(ring => {
      if (!Array.isArray(ring) || ring.length < 4) throw new Error('Invalid ring.');
      const coordinates = ring.map(vertex => {
        if (!Array.isArray(vertex) || vertex.length < 2 || !Number.isFinite(vertex[0]) || !Number.isFinite(vertex[1])
          || vertex[0] < 114.17 || vertex[0] > 114.18 || vertex[1] < 22.44 || vertex[1] > 22.45) throw new Error('Invalid coordinate.');
        return [vertex[0], vertex[1]] as [number, number];
      });
      const first = coordinates[0];
      const last = coordinates[coordinates.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) throw new Error('Unclosed polygon.');
      return coordinates;
    });
    return { block: point.block, name: point.name, buildingId: id, csuid: CSUIDS[index], baseHeight: base, topHeight: top, rings };
  });
}
