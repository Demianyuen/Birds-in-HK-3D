import type { VectorTile } from '@mapbox/vector-tile';

/**
 * Place names for the "you have arrived at …" banner. Areas (districts,
 * neighbourhoods, villages, hills) come from the OpenStreetMap `place` and
 * `mountain_peak` layers of the same vector tiles the ground already uses;
 * landmarks (parks, stations, temples, viewpoints) from the `poi` layer.
 * Wang Fuk Court and its eight blocks come from the official address points.
 */

export type PlaceTone = 'area' | 'landmark' | 'memorial';

export interface PlaceName {
  /** Stable key, also used to remember discovered places. */
  id: string;
  title: string;
  subtitle: string;
  /** Short category label shown above the name (社區, 公園 …). */
  category: string;
  tone: PlaceTone;
  x: number;
  z: number;
  /** Horizontal radius (m) inside which the bird counts as "here". */
  radius: number;
  /** Landmarks only announce near the ground; areas at any height up to this. */
  maxAltitude: number;
}

export interface PlaceArrival {
  place: PlaceName;
  firstVisit: boolean;
  discovered: number;
}

interface AreaRule { category: string; radius: number; maxAltitude: number }

const AREA_RULES: Readonly<Record<string, AreaRule>> = Object.freeze({
  town: { category: '地區', radius: 2_600, maxAltitude: 900 },
  suburb: { category: '地區', radius: 950, maxAltitude: 700 },
  quarter: { category: '社區', radius: 340, maxAltitude: 420 },
  neighbourhood: { category: '社區', radius: 220, maxAltitude: 360 },
  village: { category: '村落', radius: 190, maxAltitude: 320 },
  hamlet: { category: '村落', radius: 130, maxAltitude: 260 },
  isolated_dwelling: { category: '村落', radius: 70, maxAltitude: 180 },
});

const PEAK_RULE: AreaRule = { category: '山嶺', radius: 260, maxAltitude: 1_200 };

const LANDMARK_RULES: Readonly<Record<string, AreaRule>> = Object.freeze({
  park: { category: '公園', radius: 55, maxAltitude: 140 },
  garden: { category: '花園', radius: 45, maxAltitude: 130 },
  railway: { category: '車站', radius: 70, maxAltitude: 150 },
  museum: { category: '博物館', radius: 45, maxAltitude: 130 },
  attraction: { category: '景點', radius: 45, maxAltitude: 140 },
  monument: { category: '古蹟', radius: 35, maxAltitude: 120 },
  place_of_worship: { category: '廟宇・教堂', radius: 35, maxAltitude: 120 },
  library: { category: '圖書館', radius: 40, maxAltitude: 120 },
  town_hall: { category: '社區會堂', radius: 35, maxAltitude: 110 },
});

const SUBCLASS_CATEGORY: Readonly<Record<string, string>> = Object.freeze({
  viewpoint: '觀景台',
  subway: '港鐵站',
  station: '車站',
  playground: '遊樂場',
});

const CJK = /[㐀-鿿]/;

type Properties = Readonly<Record<string, string | number | boolean>>;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Chinese title first, English underneath; fall back to whichever exists. */
export function placeLabels(properties: Properties): { title: string; subtitle: string } | null {
  const name = text(properties.name);
  const english = text(properties['name:en']) || text(properties.name_en);
  let chinese = text(properties['name:zh-Hant']) || text(properties['name:zh_hant'])
    || text(properties['name:zh']) || text(properties.name_zh);
  if (!chinese && CJK.test(name)) {
    // "大埔墟 Tai Po Market" → "大埔墟"
    chinese = name.split(/\s+(?=[A-Za-z])/)[0]?.trim() ?? '';
  }
  // Mixed simplified/traditional labels like "大鹏湾 - 大鵬灣": keep the last (traditional) part.
  if (chinese.includes(' - ')) chinese = chinese.split(' - ').pop()?.trim() ?? chinese;
  if (chinese && !CJK.test(chinese)) chinese = '';
  const title = chinese || english || name;
  if (!title || title.length > 40) return null;
  const subtitle = chinese && english && english !== chinese ? english : '';
  return { title, subtitle };
}

export interface TileFrame {
  tileX: number;
  tileY: number;
  center: Readonly<{ x: number; y: number }>;
  tileWidthMetres: number;
}

/** Named points from one vector tile, in the local east/south metre frame. */
export function extractPlaceNames(tile: VectorTile, frame: TileFrame): PlaceName[] {
  const places: PlaceName[] = [];
  const read = (layerName: string, rule: (properties: Properties) => (AreaRule & { tone: PlaceTone; category: string }) | null) => {
    const layer = tile.layers[layerName];
    if (!layer) return;
    for (let index = 0; index < layer.length; index += 1) {
      const feature = layer.feature(index);
      if (feature.type !== 1) continue;
      const properties = feature.properties as Properties;
      const chosen = rule(properties);
      if (!chosen) continue;
      const labels = placeLabels(properties);
      if (!labels) continue;
      const point = feature.loadGeometry()[0]?.[0];
      if (!point) continue;
      // Points on the tile buffer belong to the neighbouring tile.
      if (point.x < 0 || point.y < 0 || point.x >= layer.extent || point.y >= layer.extent) continue;
      const x = (frame.tileX + point.x / layer.extent - frame.center.x) * frame.tileWidthMetres;
      const z = (frame.tileY + point.y / layer.extent - frame.center.y) * frame.tileWidthMetres;
      places.push({
        id: `${layerName}:${labels.title}`,
        title: labels.title,
        subtitle: labels.subtitle,
        category: chosen.category,
        tone: chosen.tone,
        x,
        z,
        radius: chosen.radius,
        maxAltitude: chosen.maxAltitude,
      });
    }
  };
  read('place', properties => {
    const rule = AREA_RULES[text(properties.class)];
    return rule ? { ...rule, tone: 'area' } : null;
  });
  read('mountain_peak', properties => (text(properties.class) === 'peak' ? { ...PEAK_RULE, tone: 'area' } : null));
  read('poi', properties => {
    const rule = LANDMARK_RULES[text(properties.class)];
    if (!rule) return null;
    const category = SUBCLASS_CATEGORY[text(properties.subclass)] ?? rule.category;
    return { ...rule, category, tone: 'landmark' };
  });
  return places;
}

/** Same name from several tiles (or a node and an area): keep one, the first seen. */
export function dedupePlaces(places: readonly PlaceName[]): PlaceName[] {
  const byId = new Map<string, PlaceName>();
  for (const place of places) {
    const existing = byId.get(place.id);
    if (!existing) {
      byId.set(place.id, place);
      continue;
    }
    // A repeated name far away is a different place (two "觀景臺"): keep both.
    if (Math.hypot(existing.x - place.x, existing.z - place.z) > existing.radius * 2) {
      byId.set(`${place.id}@${Math.round(place.x)},${Math.round(place.z)}`, { ...place, id: `${place.id}@${Math.round(place.x)},${Math.round(place.z)}` });
    }
  }
  return [...byId.values()];
}

export interface MemorialBlock { name: string; block: string; position: { x: number; z: number } }

/** Wang Fuk Court as a place of remembrance, and each of its eight blocks. */
export function memorialPlaces(centre: { x: number; z: number }, blocks: readonly MemorialBlock[]): PlaceName[] {
  return [
    {
      id: 'memorial:宏福苑',
      title: '宏福苑',
      subtitle: 'Wang Fuk Court',
      category: '紀念之地',
      tone: 'memorial',
      x: centre.x,
      z: centre.z,
      radius: 150,
      maxAltitude: 420,
    },
    ...blocks.map(block => ({
      id: `memorial:${block.name}`,
      title: block.name,
      subtitle: `宏福苑 ${block.block} 座`,
      category: '紀念之地',
      tone: 'memorial' as const,
      x: block.position.x,
      z: block.position.z,
      radius: 24,
      maxAltitude: 120,
    })),
  ];
}

export interface DiscoveryStore {
  has(id: string): boolean;
  add(id: string): void;
  readonly size: number;
}

/** Discovered places for this browser; works (in memory) when storage is blocked. */
export function browserDiscoveryStore(key = 'birds-in-hk:discovered-places'): DiscoveryStore {
  const seen = new Set<string>();
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    if (Array.isArray(stored)) for (const id of stored) if (typeof id === 'string') seen.add(id);
  } catch {
    // private window or blocked storage
  }
  return {
    has: id => seen.has(id),
    add: id => {
      seen.add(id);
      try {
        window.localStorage.setItem(key, JSON.stringify([...seen].slice(-500)));
      } catch {
        // keep it in memory only
      }
    },
    get size() {
      return seen.size;
    },
  };
}

/** Seconds inside a new area before its banner shows (stops flicker at borders). */
const AREA_DWELL = 1.1;
/** The same place is not announced again for this long (s). */
const REPEAT_COOLDOWN = 120;
/** Leaving an area needs this much extra distance (fraction of its radius). */
const EXIT_MARGIN = 0.15;

/**
 * Tracks which named place the bird is in and reports arrivals.
 * The most specific area (smallest radius) containing the bird wins;
 * landmarks and memorial blocks announce when the bird is close and low.
 */
export class PlaceTracker {
  private places: PlaceName[] = [];
  private currentArea: PlaceName | null = null;
  private candidate: PlaceName | null = null;
  private candidateTime = 0;
  private currentLandmark: PlaceName | null = null;
  private clock = 0;
  private readonly lastShown = new Map<string, number>();

  public constructor(private readonly discoveries: DiscoveryStore = { has: () => false, add: () => undefined, size: 0 }) {}

  public setPlaces(places: readonly PlaceName[]): void {
    this.places = [...places];
    this.currentArea = null;
    this.candidate = null;
    this.currentLandmark = null;
  }

  public get count(): number {
    return this.places.length;
  }

  public get area(): PlaceName | null {
    return this.currentArea;
  }

  public update(deltaSeconds: number, x: number, z: number, altitude: number): PlaceArrival | null {
    this.clock += deltaSeconds;
    if (this.places.length === 0) return null;
    const inside = (place: PlaceName, margin = 0) =>
      altitude <= place.maxAltitude && Math.hypot(place.x - x, place.z - z) <= place.radius * (1 + margin);

    // Small, close things first: a landmark or one memorial block.
    let landmark: PlaceName | null = null;
    for (const place of this.places) {
      if (place.radius > 80 || !inside(place)) continue;
      // Keep Wang Fuk Court quiet: only its own blocks are named there.
      if (this.currentArea?.tone === 'memorial' && place.tone !== 'memorial') continue;
      if (!landmark || Math.hypot(place.x - x, place.z - z) < Math.hypot(landmark.x - x, landmark.z - z)) landmark = place;
    }
    if (this.currentLandmark && !inside(this.currentLandmark, EXIT_MARGIN)) this.currentLandmark = null;
    if (landmark && landmark !== this.currentLandmark && !this.currentLandmark) {
      this.currentLandmark = landmark;
      const arrival = this.announce(landmark);
      if (arrival) return arrival;
    }

    // Areas: keep the current one while still inside it (with a margin), unless a more specific one contains the bird.
    let best: PlaceName | null = null;
    for (const place of this.places) {
      if (place.radius <= 80 || !inside(place)) continue;
      if (!best || place.radius < best.radius
        || (place.radius === best.radius && Math.hypot(place.x - x, place.z - z) < Math.hypot(best.x - x, best.z - z))) {
        best = place;
      }
    }
    const stay = this.currentArea && inside(this.currentArea, EXIT_MARGIN) ? this.currentArea : null;
    const next = best && (!stay || best.radius < stay.radius) ? best : stay;
    if (next === this.currentArea) {
      this.candidate = null;
      return null;
    }
    if (!next) {
      this.currentArea = null;
      this.candidate = null;
      return null;
    }
    if (next !== this.candidate) {
      this.candidate = next;
      this.candidateTime = 0;
    }
    this.candidateTime += deltaSeconds;
    if (this.candidateTime < AREA_DWELL) return null;
    this.currentArea = next;
    this.candidate = null;
    return this.announce(next);
  }

  private announce(place: PlaceName): PlaceArrival | null {
    const last = this.lastShown.get(place.id);
    if (last !== undefined && this.clock - last < REPEAT_COOLDOWN) return null;
    this.lastShown.set(place.id, this.clock);
    const firstVisit = !this.discoveries.has(place.id);
    if (firstVisit) this.discoveries.add(place.id);
    return { place, firstVisit, discovered: this.discoveries.size };
  }
}
