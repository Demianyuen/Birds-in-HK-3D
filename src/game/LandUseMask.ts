import { VectorTile, type VectorTileFeature, type VectorTileLayer } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RGBAFormat,
  UnsignedByteType,
} from 'three';

/**
 * Clean, label-free land-use mask for the stylised ground.
 *
 * The LandsD basemap is a cartographic image: it carries contour lines, trail
 * dashes, text and one-texel outlines that cannot be fully separated from the
 * land-use colours, and its 4 m texels make roads stair-stepped. The same
 * zoom-14 OpenMapTiles vector tiles already used for navigation contain the
 * land cover, water and road geometry directly, so the mask is rasterised from
 * vectors with canvas anti-aliasing instead.
 *
 * Channel encoding (0–255, sampled as 0–1 in the shader):
 *  R  road surface    path 70 · local 150 · distributor 200 · trunk/motorway 255
 *  G  vegetation      sports pitch 100 · grass/park 170 · woodland 255
 *  B  water & sand    sand/beach 110 · water 255
 *  A  built/paved     estates, commercial, industrial, building footprints, piers
 * Overlaps resolve with a per-channel maximum, so anti-aliased edges fade
 * through the lower bands (a thin grass rim around woodland, a sand rim on
 * shores, a curb on major roads), which reads naturally in the stylised look.
 */

export const LAND_USE_ZOOM = 14;
export const LAND_USE_MASK_SIZE = 1024;
export const LAND_USE_DETAIL_SIZE = 2048;

export const MASK_LEVELS = Object.freeze({
  path: 70,
  localRoad: 150,
  distributor: 200,
  majorRoad: 255,
  pitch: 100,
  grass: 170,
  woodland: 255,
  sand: 110,
  water: 255,
  built: 255,
});

export type LandUseClass = 'water' | 'woodland' | 'green' | 'road' | 'footprint' | 'sand' | 'land';

/** Decodes one mask texel into the dominant land-use class (mirrors the shader thresholds). */
export function classifyMaskTexel(red: number, green: number, blue: number, alpha: number): LandUseClass {
  if (red >= 120) return 'road';
  if (blue >= 190) return 'water';
  if (green >= 215) return 'woodland';
  if (green >= 130) return 'green';
  if (blue >= 80) return 'sand';
  if (green >= 75) return 'green';
  if (alpha >= 128) return 'footprint';
  return 'land';
}

// Per carriageway: dual carriageways (Tolo Highway) are mapped as two ways.
const ROAD_WIDTH_METRES: Readonly<Record<string, number>> = Object.freeze({
  motorway: 13,
  trunk: 12,
  primary: 11,
  secondary: 10,
  tertiary: 9,
  minor: 7,
  service: 4.5,
  raceway: 7,
  busway: 7,
  track: 3,
  path: 2.2,
});

const ROAD_LEVEL: Readonly<Record<string, number>> = Object.freeze({
  motorway: MASK_LEVELS.majorRoad,
  trunk: MASK_LEVELS.majorRoad,
  primary: MASK_LEVELS.majorRoad,
  secondary: MASK_LEVELS.distributor,
  tertiary: MASK_LEVELS.distributor,
  minor: MASK_LEVELS.localRoad,
  service: MASK_LEVELS.localRoad,
  raceway: MASK_LEVELS.localRoad,
  busway: MASK_LEVELS.localRoad,
  track: MASK_LEVELS.path,
  path: MASK_LEVELS.path,
});

const WOODLAND_COVER = new Set(['wood', 'forest']);
const GRASS_COVER = new Set(['grass', 'farmland', 'wetland']);
const SAND_COVER = new Set(['sand']);
const BUILT_LANDUSE = new Set([
  'residential', 'commercial', 'industrial', 'retail', 'railway', 'school', 'university', 'college',
  'kindergarten', 'hospital', 'military', 'garages', 'quarry', 'library', 'bus_station', 'dam',
]);
const GREEN_LANDUSE = new Set(['cemetery', 'zoo', 'theme_park']);
const PITCH_LANDUSE = new Set(['pitch', 'playground', 'stadium', 'track']);
const WATERWAY_WIDTH_METRES: Readonly<Record<string, number>> = Object.freeze({
  river: 14,
  canal: 10,
  stream: 2.4,
  drain: 2,
  ditch: 1.5,
});

const vectorTileRequests = new Map<string, Promise<ArrayBuffer | null>>();

/** Shared, de-duplicated fetch for zoom-14 OpenMapTiles PBF tiles (navigation + ground mask). */
export function fetchVectorTile(zoom: number, x: number, y: number): Promise<ArrayBuffer | null> {
  const key = `${zoom}/${x}/${y}`;
  let request = vectorTileRequests.get(key);
  if (!request) {
    request = (async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetch(`/road-data/${zoom}/${x}/${y}.pbf`);
          if (response.ok) return await response.arrayBuffer();
        } catch {
          // One retry covers transient delivery; persistent failure falls back to the basemap.
        }
      }
      return null;
    })();
    vectorTileRequests.set(key, request);
    void request.then(data => { if (!data) vectorTileRequests.delete(key); });
  }
  return request;
}

export function clearVectorTileCache(): void {
  vectorTileRequests.clear();
}

export interface LandUseMask {
  readonly size: number;
  /** RGBA bytes, row 0 = north edge of the tile. */
  readonly data: Uint8Array;
  classAt(u: number, v: number): LandUseClass;
}

/**
 * Rasterises a zoom-14 vector tile into a land-use mask.
 * `tileWidthMetres` converts real road and stream widths into pixels.
 */
export function rasterizeLandUseMask(
  data: ArrayBuffer,
  size: number,
  tileWidthMetres: number,
): LandUseMask | null {
  const tile = new VectorTile(new Pbf(data));
  const cover = createCanvas(size);
  const built = createCanvas(size);
  if (!cover || !built) return null;
  const pixelsPerMetre = size / tileWidthMetres;

  for (const context of [cover, built]) {
    context.fillStyle = '#000000';
    context.fillRect(0, 0, size, size);
    context.globalCompositeOperation = 'lighten';
    context.lineCap = 'round';
    context.lineJoin = 'round';
  }

  const landcover = tile.layers.landcover;
  forEachFeature(landcover, feature => {
    if (feature.type !== 3) return;
    const coverClass = String(feature.properties.class ?? '');
    const subclass = String(feature.properties.subclass ?? '');
    if (WOODLAND_COVER.has(coverClass)) fillFeature(cover, feature, size, rgb(0, MASK_LEVELS.woodland, 0));
    else if (SAND_COVER.has(coverClass)) fillFeature(cover, feature, size, rgb(0, 0, MASK_LEVELS.sand));
    else if (GRASS_COVER.has(coverClass) || subclass === 'golf_course') {
      fillFeature(cover, feature, size, rgb(0, MASK_LEVELS.grass, 0));
    }
  });

  forEachFeature(tile.layers.park, feature => {
    if (feature.type === 3) fillFeature(cover, feature, size, rgb(0, MASK_LEVELS.grass, 0));
  });

  forEachFeature(tile.layers.landuse, feature => {
    if (feature.type !== 3) return;
    const landuseClass = String(feature.properties.class ?? '');
    if (PITCH_LANDUSE.has(landuseClass)) fillFeature(cover, feature, size, rgb(0, MASK_LEVELS.pitch, 0));
    else if (GREEN_LANDUSE.has(landuseClass)) fillFeature(cover, feature, size, rgb(0, MASK_LEVELS.grass, 0));
    else if (BUILT_LANDUSE.has(landuseClass)) fillFeature(built, feature, size, rgb(MASK_LEVELS.built, 0, 0));
  });

  forEachFeature(tile.layers.building, feature => {
    if (feature.type === 3) fillFeature(built, feature, size, rgb(MASK_LEVELS.built, 0, 0));
  });

  forEachFeature(tile.layers.water, feature => {
    if (feature.type !== 3 || feature.properties.brunnel === 'tunnel') return;
    fillFeature(cover, feature, size, rgb(0, 0, MASK_LEVELS.water));
  });

  forEachFeature(tile.layers.waterway, feature => {
    if (feature.type !== 2 || feature.properties.brunnel === 'tunnel') return;
    const width = WATERWAY_WIDTH_METRES[String(feature.properties.class ?? '')] ?? 3;
    strokeFeature(cover, feature, size, rgb(0, 0, MASK_LEVELS.water), width * pixelsPerMetre);
  });

  forEachFeature(tile.layers.transportation, feature => {
    const roadClass = String(feature.properties.class ?? '');
    if (feature.properties.brunnel === 'tunnel' || roadClass === 'ferry') return;
    if (feature.type === 3) {
      // Piers, platforms, pedestrian squares and bridge decks are paved areas.
      if (roadClass === 'bridge') fillFeature(cover, feature, size, rgb(MASK_LEVELS.localRoad, 0, 0));
      else fillFeature(built, feature, size, rgb(MASK_LEVELS.built, 0, 0));
      return;
    }
    if (feature.type !== 2) return;
    if (roadClass === 'rail' || roadClass === 'transit') {
      strokeFeature(built, feature, size, rgb(MASK_LEVELS.built, 0, 0), 6 * pixelsPerMetre);
      return;
    }
    const level = ROAD_LEVEL[roadClass];
    const width = ROAD_WIDTH_METRES[roadClass];
    if (!level || !width) return;
    const ramp = feature.properties.ramp === 1 || feature.properties.ramp === true ? 0.7 : 1;
    strokeFeature(cover, feature, size, rgb(level, 0, 0), Math.max(1.1, width * ramp * pixelsPerMetre));
  });

  const coverPixels = cover.getImageData(0, 0, size, size).data;
  const builtPixels = built.getImageData(0, 0, size, size).data;
  const mask = new Uint8Array(size * size * 4);
  for (let index = 0; index < size * size; index += 1) {
    const offset = index * 4;
    mask[offset] = coverPixels[offset];
    mask[offset + 1] = coverPixels[offset + 1];
    mask[offset + 2] = coverPixels[offset + 2];
    mask[offset + 3] = builtPixels[offset];
  }
  return {
    size,
    data: mask,
    classAt(u: number, v: number): LandUseClass {
      const px = Math.min(size - 1, Math.max(0, Math.floor(u * size)));
      const py = Math.min(size - 1, Math.max(0, Math.floor(v * size)));
      const offset = (py * size + px) * 4;
      return classifyMaskTexel(mask[offset], mask[offset + 1], mask[offset + 2], mask[offset + 3]);
    },
  };
}

/** GPU texture for a mask. Row 0 is north, so rows are flipped to match plane UVs (v = 1 at north). */
export function createLandUseTexture(mask: LandUseMask, anisotropy: number): DataTexture {
  const { size, data } = mask;
  const flipped = new Uint8Array(data.length);
  const rowBytes = size * 4;
  for (let row = 0; row < size; row += 1) {
    flipped.set(data.subarray(row * rowBytes, (row + 1) * rowBytes), (size - 1 - row) * rowBytes);
  }
  const texture = new DataTexture(flipped, size, size, RGBAFormat, UnsignedByteType);
  texture.colorSpace = NoColorSpace;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

function createCanvas(size: number): CanvasRenderingContext2D | null {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas.getContext('2d', { willReadFrequently: true });
}

function rgb(red: number, green: number, blue: number): string {
  return `rgb(${red},${green},${blue})`;
}

function forEachFeature(layer: VectorTileLayer | undefined, visit: (feature: VectorTileFeature) => void): void {
  if (!layer) return;
  for (let index = 0; index < layer.length; index += 1) visit(layer.feature(index));
}

function tracePath(context: CanvasRenderingContext2D, feature: VectorTileFeature, size: number, close: boolean): void {
  const scale = size / feature.extent;
  context.beginPath();
  for (const ring of feature.loadGeometry()) {
    if (ring.length === 0) continue;
    context.moveTo(ring[0].x * scale, ring[0].y * scale);
    for (let index = 1; index < ring.length; index += 1) context.lineTo(ring[index].x * scale, ring[index].y * scale);
    if (close) context.closePath();
  }
}

function fillFeature(context: CanvasRenderingContext2D, feature: VectorTileFeature, size: number, colour: string): void {
  tracePath(context, feature, size, true);
  context.fillStyle = colour;
  context.fill('evenodd');
}

function strokeFeature(
  context: CanvasRenderingContext2D,
  feature: VectorTileFeature,
  size: number,
  colour: string,
  widthPixels: number,
): void {
  tracePath(context, feature, size, false);
  context.strokeStyle = colour;
  context.lineWidth = widthPixels;
  context.stroke();
}
