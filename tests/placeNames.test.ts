import type { VectorTile } from '@mapbox/vector-tile';
import { describe, expect, it } from 'vitest';
import {
  dedupePlaces,
  extractPlaceNames,
  memorialPlaces,
  placeLabels,
  PlaceTracker,
  type DiscoveryStore,
  type PlaceName,
} from '../src/game/PlaceNames';

function memoryStore(): DiscoveryStore {
  const seen = new Set<string>();
  return { has: id => seen.has(id), add: id => { seen.add(id); }, get size() { return seen.size; } };
}

function area(id: string, x: number, z: number, radius: number, extra: Partial<PlaceName> = {}): PlaceName {
  return { id, title: id, subtitle: '', category: '社區', tone: 'area', x, z, radius, maxAltitude: 500, ...extra };
}

function run(tracker: PlaceTracker, x: number, z: number, altitude: number, seconds: number) {
  const arrivals = [];
  for (let t = 0; t < seconds; t += 0.1) {
    const arrival = tracker.update(0.1, x, z, altitude);
    if (arrival) arrivals.push(arrival);
  }
  return arrivals;
}

describe('place labels', () => {
  it('takes the Chinese name with the English name underneath', () => {
    expect(placeLabels({ name: '大埔墟 Tai Po Market', 'name:zh': '大埔墟', name_en: 'Tai Po Market' }))
      .toEqual({ title: '大埔墟', subtitle: 'Tai Po Market' });
    expect(placeLabels({ name: '大埔墟 Tai Po Market' })).toEqual({ title: '大埔墟', subtitle: '' });
    expect(placeLabels({ name: 'Western Garden' })).toEqual({ title: 'Western Garden', subtitle: '' });
    expect(placeLabels({ name: 'x', 'name:zh': '大鹏湾 - 大鵬灣', 'name:en': 'Mirs Bay' }))
      .toEqual({ title: '大鵬灣', subtitle: 'Mirs Bay' });
    expect(placeLabels({ class: 'park' })).toBeNull();
  });
});

describe('reading names from a map tile', () => {
  it('keeps named points from the place, peak and landmark layers in the local metre frame', () => {
    const layer = (features: Array<{ type: number; properties: Record<string, string>; point: [number, number] }>) => ({
      length: features.length,
      extent: 4096,
      feature: (index: number) => ({
        type: features[index].type,
        properties: features[index].properties,
        loadGeometry: () => [[{ x: features[index].point[0], y: features[index].point[1] }]],
      }),
    });
    const tile = {
      layers: {
        place: layer([
          { type: 1, properties: { class: 'quarter', name: '大埔墟 Tai Po Market', 'name:zh': '大埔墟', name_en: 'Tai Po Market' }, point: [2048, 2048] },
          { type: 1, properties: { class: 'continent', name: 'Asia' }, point: [10, 10] },
          { type: 1, properties: { class: 'village', name: '鳳園' }, point: [-20, 10] },
        ]),
        poi: layer([
          { type: 1, properties: { class: 'park', subclass: 'park', name: '廣福公園 Kwong Fuk Park', 'name:zh': '廣福公園' }, point: [0, 0] },
          { type: 1, properties: { class: 'restaurant', name: '茶餐廳' }, point: [5, 5] },
          { type: 1, properties: { class: 'railway', subclass: 'subway', name: '大埔墟', 'name:zh': '大埔墟' }, point: [100, 100] },
        ]),
        mountain_peak: layer([{ type: 1, properties: { class: 'peak', name: '八仙嶺' }, point: [4000, 50] }]),
      },
    } as unknown as VectorTile;
    const places = extractPlaceNames(tile, { tileX: 10, tileY: 20, center: { x: 10, y: 20 }, tileWidthMetres: 2_000 });
    const titles = places.map(place => `${place.category}:${place.title}`);
    expect(titles).toEqual(['社區:大埔墟', '山嶺:八仙嶺', '公園:廣福公園', '港鐵站:大埔墟']);
    const market = places[0];
    expect(market.x).toBeCloseTo(1_000);
    expect(market.z).toBeCloseTo(1_000);
    expect(market.subtitle).toBe('Tai Po Market');
    expect(places.find(place => place.title === '廣福公園')?.tone).toBe('landmark');
  });

  it('merges the same name repeated across tiles but keeps far-apart namesakes', () => {
    const merged = dedupePlaces([
      area('poi:觀景臺', 0, 0, 45), area('poi:觀景臺', 3, 0, 45), area('poi:觀景臺', 900, 0, 45),
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe('arriving somewhere', () => {
  it('announces an area after a short dwell, once, and the most specific one wins', () => {
    const tracker = new PlaceTracker(memoryStore());
    tracker.setPlaces([area('大埔', 0, 0, 2_600), area('大埔墟', 700, 0, 340)]);
    const first = run(tracker, 0, 0, 100, 3);
    expect(first.map(arrival => arrival.place.title)).toEqual(['大埔']);
    expect(first[0].firstVisit).toBe(true);
    // Flying into the market: the smaller area is announced.
    const second = run(tracker, 680, 0, 100, 3);
    expect(second.map(arrival => arrival.place.title)).toEqual(['大埔墟']);
    // Staying put announces nothing more.
    expect(run(tracker, 690, 0, 100, 5)).toEqual([]);
  });

  it('does not flicker at a border or repeat a place right away', () => {
    const tracker = new PlaceTracker(memoryStore());
    tracker.setPlaces([area('A', 0, 0, 200), area('B', 400, 0, 200)]);
    expect(run(tracker, 0, 0, 50, 2)).toHaveLength(1);
    // A brief pass into B (less than the dwell time) is ignored.
    expect(run(tracker, 380, 0, 50, 0.5)).toEqual([]);
    expect(run(tracker, 0, 0, 50, 2)).toEqual([]);
    // Into B properly, then straight back to A: A is not repeated within the cooldown.
    expect(run(tracker, 400, 0, 50, 2).map(arrival => arrival.place.title)).toEqual(['B']);
    expect(run(tracker, 0, 0, 50, 2)).toEqual([]);
  });

  it('names landmarks only when close and low, and marks repeat visits', () => {
    const store = memoryStore();
    const park = area('廣福公園', 0, 0, 55, { tone: 'landmark', category: '公園', maxAltitude: 140 });
    const tracker = new PlaceTracker(store);
    tracker.setPlaces([park]);
    expect(run(tracker, 10, 0, 400, 1)).toEqual([]);
    const arrivals = run(tracker, 10, 0, 40, 1);
    expect(arrivals.map(arrival => arrival.place.title)).toEqual(['廣福公園']);
    expect(arrivals[0].discovered).toBe(1);
    const later = new PlaceTracker(store);
    later.setPlaces([park]);
    expect(run(later, 10, 0, 40, 1)[0].firstVisit).toBe(false);
  });

  it('keeps Wang Fuk Court quiet: only its own blocks are named there', () => {
    const tracker = new PlaceTracker(memoryStore());
    tracker.setPlaces([
      ...memorialPlaces({ x: 0, z: 0 }, [{ name: '宏仁閣', block: 'A', position: { x: 20, z: 0 } }]),
      area('社區會堂', -20, 0, 35, { tone: 'landmark', maxAltitude: 120 }),
      area('元洲仔', 0, 0, 340),
    ]);
    const court = run(tracker, 0, 60, 60, 2);
    expect(court.map(arrival => arrival.place.title)).toEqual(['宏福苑']);
    expect(court[0].place.tone).toBe('memorial');
    expect(run(tracker, -20, 5, 10, 2)).toEqual([]);
    const block = run(tracker, 20, 0, 10, 2);
    expect(block.map(arrival => `${arrival.place.title} ${arrival.place.subtitle}`)).toEqual(['宏仁閣 宏福苑 A 座']);
  });
});
