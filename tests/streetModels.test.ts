import type { VectorTile } from '@mapbox/vector-tile';
import { describe, expect, it } from 'vitest';
import { tierFor } from '../src/game/deviceTier';
import { extractPlaceNames } from '../src/game/PlaceNames';
import { pedestrianGeometry, VEHICLE_FOOTPRINT, VEHICLE_KINDS, vehicleGeometry } from '../src/game/streetModels';

describe('street models', () => {
  it('builds every vehicle at about its real size, standing on the ground', () => {
    for (const kind of VEHICLE_KINDS) {
      const geometry = vehicleGeometry(kind);
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      const [width, length] = VEHICLE_FOOTPRINT[kind];
      expect(box.max.z - box.min.z, kind).toBeGreaterThan(length - 0.3);
      expect(box.max.z - box.min.z, kind).toBeLessThan(length + 0.3);
      expect(box.max.x - box.min.x, kind).toBeLessThan(width + 0.5);
      expect(box.min.y, kind).toBeGreaterThan(-0.02);
      expect(box.min.y, kind).toBeLessThan(0.05);
      expect(geometry.getAttribute('color').count).toBe(geometry.getAttribute('position').count);
    }
  });

  it('gives people limbs that swing about the hips and shoulders, and a body that does not', () => {
    const geometry = pedestrianGeometry();
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.max.y).toBeGreaterThan(1.6);
    expect(geometry.boundingBox!.max.y).toBeLessThan(1.8);
    const limb = geometry.getAttribute('limb');
    const directions = new Set<number>();
    const joints = new Set<number>();
    for (let index = 0; index < limb.count; index += 1) {
      directions.add(limb.getX(index));
      if (limb.getX(index) !== 0) joints.add(Math.round(limb.getY(index) * 100) / 100);
    }
    expect([...directions].sort()).toEqual([-1, 0, 1]);
    expect([...joints].sort()).toEqual([0.88, 1.38]);
  });
});

describe('lighter world on phones', () => {
  it('draws fewer pixels, people and tiles on a touch-first device', () => {
    const phone = tierFor(true, 3);
    const computer = tierFor(false, 2);
    expect(phone.maxPixelRatio).toBeLessThanOrEqual(1.25);
    expect(phone.antialias).toBe(false);
    expect(phone.bloom).toBe(false);
    expect(phone.streetDensity).toBeLessThan(computer.streetDensity);
    expect(phone.tileCacheBytes).toBeLessThan(computer.tileCacheBytes);
    expect(phone.photoMeshError).toBeGreaterThan(computer.photoMeshError);
    expect(computer.maxPixelRatio).toBe(1.5);
  });
});

describe('named buildings', () => {
  it('announces schools, malls and bus stations, but not every shop or bus stop', () => {
    const features = [
      { properties: { class: 'school', name: '大埔舊墟公立學校' }, point: [100, 100] },
      { properties: { class: 'shop', subclass: 'mall', name: '大埔超級城' }, point: [200, 200] },
      { properties: { class: 'shop', subclass: 'convenience', name: '便利店' }, point: [300, 300] },
      { properties: { class: 'bus', subclass: 'bus_stop', name: '廣福邨' }, point: [400, 400] },
      { properties: { class: 'bus', subclass: 'bus_station', name: '大埔中心總站' }, point: [500, 500] },
      { properties: { class: 'hospital', name: '那打素醫院' }, point: [600, 600] },
    ];
    const tile = {
      layers: {
        poi: {
          length: features.length,
          extent: 4096,
          feature: (index: number) => ({
            type: 1,
            properties: features[index].properties,
            loadGeometry: () => [[{ x: features[index].point[0], y: features[index].point[1] }]],
          }),
        },
      },
    } as unknown as VectorTile;
    const places = extractPlaceNames(tile, { tileX: 0, tileY: 0, center: { x: 0, y: 0 }, tileWidthMetres: 1_000 });
    expect(places.map(place => `${place.category}:${place.title}`)).toEqual([
      '學校:大埔舊墟公立學校', '商場:大埔超級城', '巴士總站:大埔中心總站', '醫院:那打素醫院',
    ]);
  });
});
