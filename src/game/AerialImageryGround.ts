import {
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';
import type { FlightRegion } from './regions';

const EARTH_CIRCUMFERENCE_METRES = 40_075_016.686;
const SURFACE_ZOOM = 14;
export const OFFICIAL_BASEMAP_ZOOM = 15;
const ELEVATION_ZOOM = 13;
const TERRAIN_TILE_SIZE = 256;
const BASEMAP_SCALE = 2 ** (OFFICIAL_BASEMAP_ZOOM - SURFACE_ZOOM);
export const TERRAIN_SEGMENTS = 64;
const SURFACE_TO_ELEVATION_SCALE = 2 ** (SURFACE_ZOOM - ELEVATION_ZOOM);
const TERRAIN_EDGE_BUFFER_METRES = 450;

export interface ImageryLoadProgress {
  completed: number;
  total: number;
  successful: number;
  basemapCompleted: number;
  basemapTotal: number;
  basemapSuccessful: number;
}

export interface OfficialGroundMetrics {
  terrainMeshes: number;
  texturedMeshes: number;
  basemapTilesLoaded: number;
  basemapTilesTotal: number;
}

interface TileRequest {
  x: number;
  y: number;
  worldX: number;
  worldZ: number;
}

export class AerialImageryGround {
  public readonly group = new Group();
  public originElevation = 0;
  private readonly resources = new Set<{ dispose: () => void }>();
  private readonly progressListeners = new Set<(progress: ImageryLoadProgress) => void>();
  private loadPromise: Promise<void> | null = null;
  private progress: ImageryLoadProgress = emptyProgress();
  private groundMetrics: OfficialGroundMetrics = emptyGroundMetrics();
  private activeRegionId: string | null = null;
  private activeElevationTiles = new Map<string, Uint8ClampedArray>();
  private activeSurfaceCenter: { x: number; y: number } | null = null;
  private activeTileWidthMetres = 0;

  public constructor() {
    this.group.name = 'Hong Kong elevation terrain';
  }

  public load(
    region: FlightRegion,
    onProgress: (progress: ImageryLoadProgress) => void = () => undefined,
  ): Promise<void> {
    if (this.activeRegionId !== region.id) {
      this.clearTiles();
      this.activeRegionId = region.id;
    }
    this.progressListeners.add(onProgress);
    onProgress(this.progress);
    this.loadPromise ??= this.loadTiles(region).catch(error => {
      this.loadPromise = null;
      throw error;
    });
    return this.loadPromise.finally(() => this.progressListeners.delete(onProgress));
  }

  public dispose(): void {
    this.group.removeFromParent();
    this.clearTiles();
    this.activeRegionId = null;
  }

  public getElevationAtWorld(worldX: number, worldZ: number): number {
    if (!this.activeSurfaceCenter || this.activeElevationTiles.size === 0) return 0;
    const surfaceX = this.activeSurfaceCenter.x + worldX / this.activeTileWidthMetres;
    const surfaceY = this.activeSurfaceCenter.y + worldZ / this.activeTileWidthMetres;
    return this.sampleElevation(this.activeElevationTiles, surfaceX, surfaceY);
  }

  public get metrics(): Readonly<OfficialGroundMetrics> {
    return this.groundMetrics;
  }

  private clearTiles(): void {
    this.group.clear();
    for (const resource of this.resources) resource.dispose();
    this.resources.clear();
    this.progressListeners.clear();
    this.loadPromise = null;
    this.progress = emptyProgress();
    this.groundMetrics = emptyGroundMetrics();
    this.activeElevationTiles.clear();
    this.activeSurfaceCenter = null;
    this.activeTileWidthMetres = 0;
  }

  private async loadTiles(region: FlightRegion): Promise<void> {
    const requests = createTileRequests(region);
    this.progress = {
      completed: 0,
      total: requests.length,
      successful: 0,
      basemapCompleted: 0,
      basemapTotal: requests.length * BASEMAP_SCALE ** 2,
      basemapSuccessful: 0,
    };
    this.notifyProgress();
    const elevationTiles = await this.loadElevationCoverage(requests);
    if (elevationTiles.size === 0) throw new Error('Hong Kong elevation terrain could not be loaded.');
    const center = geographicToTileFraction(region.latitude, region.longitude, SURFACE_ZOOM);
    this.activeElevationTiles = elevationTiles;
    this.activeSurfaceCenter = center;
    this.activeTileWidthMetres = tileWidthMetres(region.latitude);
    this.originElevation = this.sampleElevation(elevationTiles, center.x, center.y);
    const basemapTextures = await Promise.all(
      requests.map(request => this.loadOfficialBasemapTexture(request)),
    );
    if (basemapTextures.some(texture => texture === null)) {
      throw new Error('The LandsD basemap could not deliver the complete Tai Po street surface.');
    }
    for (let index = 0; index < requests.length; index += 1) {
      const request = requests[index];
      const geometry = this.createGroundGeometry(request, elevationTiles, region.latitude);
      const material = this.track(new MeshStandardMaterial({
        map: basemapTextures[index],
        color: '#ffffff',
        roughness: 0.94,
        metalness: 0,
      }));
      const tile = new Mesh(geometry, material);
      tile.position.set(request.worldX, 0.16, request.worldZ);
      tile.receiveShadow = true;
      this.group.add(tile);
      this.progress = {
        completed: index + 1,
        total: requests.length,
        successful: index + 1,
        basemapCompleted: this.progress.basemapCompleted,
        basemapTotal: this.progress.basemapTotal,
        basemapSuccessful: this.progress.basemapSuccessful,
      };
      this.groundMetrics = {
        terrainMeshes: index + 1,
        texturedMeshes: index + 1,
        basemapTilesLoaded: this.progress.basemapSuccessful,
        basemapTilesTotal: this.progress.basemapTotal,
      };
      this.notifyProgress();
    }
  }

  private async loadOfficialBasemapTexture(request: TileRequest): Promise<CanvasTexture | null> {
    const canvas = document.createElement('canvas');
    canvas.width = TERRAIN_TILE_SIZE * BASEMAP_SCALE;
    canvas.height = TERRAIN_TILE_SIZE * BASEMAP_SCALE;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.fillStyle = '#68775f';
    context.fillRect(0, 0, canvas.width, canvas.height);
    let successful = 0;
    await Promise.all(Array.from({ length: BASEMAP_SCALE ** 2 }, async (_, index) => {
      const offsetX = index % BASEMAP_SCALE;
      const offsetY = Math.floor(index / BASEMAP_SCALE);
      const x = request.x * BASEMAP_SCALE + offsetX;
      const y = request.y * BASEMAP_SCALE + offsetY;
      const bitmap = await this.loadBasemapBitmap(x, y);
      this.progress.basemapCompleted += 1;
      if (bitmap) {
        successful += 1;
        this.progress.basemapSuccessful += 1;
        context.drawImage(
          bitmap,
          offsetX * TERRAIN_TILE_SIZE,
          offsetY * TERRAIN_TILE_SIZE,
          TERRAIN_TILE_SIZE,
          TERRAIN_TILE_SIZE,
        );
        bitmap.close();
      }
      this.notifyProgress();
    }));
    if (successful !== BASEMAP_SCALE ** 2) return null;
    const texture = this.track(new CanvasTexture(canvas));
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  }

  private async loadBasemapBitmap(x: number, y: number): Promise<ImageBitmap | null> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(`/landsd-map/basemap/${OFFICIAL_BASEMAP_ZOOM}/${x}/${y}.png`);
        if (!response.ok) continue;
        return await createImageBitmap(await response.blob());
      } catch {
        // A single retry handles transient tile delivery without hiding persistent failures.
      }
    }
    return null;
  }

  private createGroundGeometry(
    request: TileRequest,
    elevationTiles: Map<string, Uint8ClampedArray>,
    latitude: number,
  ): PlaneGeometry {
    const width = tileWidthMetres(latitude) + 0.5;
    const geometry = this.track(new PlaneGeometry(width, width, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS));
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    for (let index = 0; index < positions.count; index += 1) {
      const surfaceX = request.x + uv.getX(index);
      const surfaceY = request.y + (1 - uv.getY(index));
      positions.setY(index, this.sampleElevation(elevationTiles, surfaceX, surfaceY));
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
  }

  private async loadElevationCoverage(requests: TileRequest[]): Promise<Map<string, Uint8ClampedArray>> {
    const coordinates = new Map<string, { x: number; y: number }>();
    for (const request of requests) {
      for (const cornerX of [request.x, request.x + 1]) {
        for (const cornerY of [request.y, request.y + 1]) {
          const x = Math.floor(cornerX / SURFACE_TO_ELEVATION_SCALE);
          const y = Math.floor(cornerY / SURFACE_TO_ELEVATION_SCALE);
          coordinates.set(`${x}/${y}`, { x, y });
        }
      }
    }

    const tiles = new Map<string, Uint8ClampedArray>();
    await Promise.all([...coordinates.entries()].map(async ([key, coordinate]) => {
      const pixels = await this.loadElevationTile(coordinate.x, coordinate.y);
      if (pixels) tiles.set(key, pixels);
    }));
    return tiles;
  }

  private async loadElevationTile(x: number, y: number): Promise<Uint8ClampedArray | null> {
    try {
      const response = await fetch(`/terrain-elevation/${ELEVATION_ZOOM}/${x}/${y}.png`);
      if (!response.ok) return null;
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = document.createElement('canvas');
      canvas.width = TERRAIN_TILE_SIZE;
      canvas.height = TERRAIN_TILE_SIZE;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return null;
      context.drawImage(bitmap, 0, 0, TERRAIN_TILE_SIZE, TERRAIN_TILE_SIZE);
      bitmap.close();
      return context.getImageData(0, 0, TERRAIN_TILE_SIZE, TERRAIN_TILE_SIZE).data;
    } catch {
      return null;
    }
  }

  private sampleElevation(
    tiles: Map<string, Uint8ClampedArray>,
    surfaceX: number,
    surfaceY: number,
  ): number {
    const terrainX = surfaceX / SURFACE_TO_ELEVATION_SCALE;
    const terrainY = surfaceY / SURFACE_TO_ELEVATION_SCALE;
    const tileX = Math.floor(terrainX);
    const tileY = Math.floor(terrainY);
    const pixels = tiles.get(`${tileX}/${tileY}`);
    if (!pixels) return 0;
    const pixelX = Math.min(TERRAIN_TILE_SIZE - 1, Math.floor((terrainX - tileX) * TERRAIN_TILE_SIZE));
    const pixelY = Math.min(TERRAIN_TILE_SIZE - 1, Math.floor((terrainY - tileY) * TERRAIN_TILE_SIZE));
    const index = (pixelY * TERRAIN_TILE_SIZE + pixelX) * 4;
    const elevation = decodeTerrariumElevation(pixels[index], pixels[index + 1], pixels[index + 2]);
    return Number.isFinite(elevation) && Math.abs(elevation) < 9_000 ? elevation : 0;
  }

  private track<T extends { dispose: () => void }>(resource: T): T {
    this.resources.add(resource);
    return resource;
  }

  private notifyProgress(): void {
    for (const listener of this.progressListeners) listener(this.progress);
  }
}

function createTileRequests(region: FlightRegion): TileRequest[] {
  const center = geographicToTileFraction(region.latitude, region.longitude, SURFACE_ZOOM);
  const centerX = center.x;
  const centerY = center.y;
  const tileWidth = tileWidthMetres(region.latitude);
  const tileRadius = (region.flightRadiusMetres + TERRAIN_EDGE_BUFFER_METRES) / tileWidth;
  const minimumTileX = Math.floor(centerX - tileRadius);
  const maximumTileX = Math.floor(centerX + tileRadius);
  const minimumTileY = Math.floor(centerY - tileRadius);
  const maximumTileY = Math.floor(centerY + tileRadius);
  const requests: TileRequest[] = [];

  for (let y = minimumTileY; y <= maximumTileY; y += 1) {
    for (let x = minimumTileX; x <= maximumTileX; x += 1) {
      requests.push({
        x,
        y,
        worldX: (x + 0.5 - centerX) * tileWidth,
        worldZ: (y + 0.5 - centerY) * tileWidth,
      });
    }
  }
  return requests;
}

export function geographicToTileFraction(
  latitude: number,
  longitude: number,
  zoom: number,
): { x: number; y: number } {
  const scale = 2 ** zoom;
  const latitudeRadians = latitude * Math.PI / 180;
  return {
    x: ((longitude + 180) / 360) * scale,
    y: (1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2 * scale,
  };
}

export function decodeTerrariumElevation(red: number, green: number, blue: number): number {
  return red * 256 + green + blue / 256 - 32_768;
}

function tileWidthMetres(latitude: number): number {
  const latitudeRadians = latitude * Math.PI / 180;
  return EARTH_CIRCUMFERENCE_METRES * Math.cos(latitudeRadians) / 2 ** SURFACE_ZOOM;
}

export function terrainCoverageMetres(region: FlightRegion): number {
  const requests = createTileRequests(region);
  if (requests.length === 0) return 0;
  const worldX = requests.map(request => request.worldX);
  return Math.max(...worldX) - Math.min(...worldX) + tileWidthMetres(region.latitude);
}

export function terrainTileCount(region: FlightRegion): number {
  return createTileRequests(region).length;
}

export function officialBasemapTileCount(region: FlightRegion): number {
  return terrainTileCount(region) * BASEMAP_SCALE ** 2;
}

const LOWLAND = new Color('#61705a');
const GRASS = new Color('#4f6748');
const DRY_GRASS = new Color('#77765b');
const SOIL = new Color('#716455');
const HIGHLAND = new Color('#646958');
const ROCK = new Color('#7b7b73');

export function sampleTerrainColor(
  elevation: number,
  slope: number,
  worldX: number,
  worldZ: number,
  target: Color,
): Color {
  const broadVariation = fractalTerrainNoise(worldX * 0.0024, worldZ * 0.0024);
  const fineVariation = fractalTerrainNoise(worldX * 0.018, worldZ * 0.018);
  const highlandMix = smoothStep(80, 360, elevation);
  const rockMix = smoothStep(0.09, 0.48, slope) * (0.5 + highlandMix * 0.5);
  const soilMix = smoothStep(0.04, 0.28, slope) * (0.16 + fineVariation * 0.24);
  const dryMix = smoothStep(0.52, 0.88, broadVariation) * (1 - rockMix) * 0.42;

  target.copy(LOWLAND)
    .lerp(GRASS, 0.38 + broadVariation * 0.42)
    .lerp(DRY_GRASS, dryMix)
    .lerp(HIGHLAND, highlandMix * 0.72)
    .lerp(SOIL, soilMix)
    .lerp(ROCK, rockMix * 0.78);
  return target.multiplyScalar(0.91 + fineVariation * 0.12);
}

function fractalTerrainNoise(x: number, y: number): number {
  let value = 0;
  let amplitude = 0.56;
  let frequency = 1;
  let normalizer = 0;
  for (let octave = 0; octave < 4; octave += 1) {
    value += valueNoise(x * frequency, y * frequency) * amplitude;
    normalizer += amplitude;
    amplitude *= 0.5;
    frequency *= 2.07;
  }
  return value / normalizer;
}

function valueNoise(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const top = mix(hash2d(x0, y0), hash2d(x0 + 1, y0), tx);
  const bottom = mix(hash2d(x0, y0 + 1), hash2d(x0 + 1, y0 + 1), tx);
  return mix(top, bottom, ty);
}

function hash2d(x: number, y: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43_758.5453;
  return value - Math.floor(value);
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function smoothStep(minimum: number, maximum: number, value: number): number {
  return smoothCurve(Math.min(1, Math.max(0, (value - minimum) / (maximum - minimum))));
}

function mix(left: number, right: number, amount: number): number {
  return left + (right - left) * amount;
}

function emptyProgress(): ImageryLoadProgress {
  return {
    completed: 0,
    total: 0,
    successful: 0,
    basemapCompleted: 0,
    basemapTotal: 0,
    basemapSuccessful: 0,
  };
}

function emptyGroundMetrics(): OfficialGroundMetrics {
  return {
    terrainMeshes: 0,
    texturedMeshes: 0,
    basemapTilesLoaded: 0,
    basemapTilesTotal: 0,
  };
}
