import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { extractWangFukFootprints } from '../src/game/wangFukFootprints';

const input = () => JSON.parse(readFileSync('assets/reference/wang-fuk-building-footprints.geojson', 'utf8'));

it('joins the eight named estate blocks and excludes neighbouring schools/carpark', () => {
  const footprints = extractWangFukFootprints(input());
  expect(footprints.map(item => item.block)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  expect(footprints[0].buildingId).toBe(1910243688);
  expect(footprints[0].topHeight - footprints[0].baseHeight).toBeCloseTo(84.9);
  expect(footprints.every(item => item.rings[0].length >= 30)).toBe(true);
});

it('rejects missing or duplicate block identities instead of guessing their geometry', () => {
  const missing = input();
  missing.features = missing.features.filter((feature: any) => feature.properties.BuildingCSUID !== '3606934204T20050430');
  expect(() => extractWangFukFootprints(missing)).toThrow(/A/);
  const duplicate = input();
  duplicate.features.push(duplicate.features.find((feature: any) => feature.properties.BuildingCSUID === '3606934204T20050430'));
  expect(() => extractWangFukFootprints(duplicate)).toThrow(/A/);
});

it('rejects missing heights and swapped coordinates rather than inventing a massing', () => {
  const data = input();
  const feature = data.features.find((entry: any) => entry.properties.BuildingCSUID === '3606934204T20050430');
  feature.properties.TopHeight = null;
  expect(() => extractWangFukFootprints(data)).toThrow(/height/i);
  feature.properties.TopHeight = 90.5;
  feature.geometry.coordinates = feature.geometry.coordinates.map((ring: number[][]) => ring.map(([x, y]) => [y, x]));
  expect(() => extractWangFukFootprints(data)).toThrow(/coordinate/i);
});
