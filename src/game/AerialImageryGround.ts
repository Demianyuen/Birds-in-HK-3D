import {
  ClampToEdgeWrapping,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from 'three';
import type { WebGLRenderer } from 'three';

const EARTH_CIRCUMFERENCE_METRES = 40_075_016.686;
const IMAGERY_ZOOM = 16;
const ELEVATION_ZOOM = 13;
const GRID_RADIUS = 3;
const TERRAIN_TILE_SIZE = 256;
const TERRAIN_SEGMENTS = 16;
const IMAGERY_TO_ELEVATION_SCALE = 2 ** (IMAGERY_ZOOM - ELEVATION_ZOOM);
const TAI_PO = Object.freeze({ latitude: 22.44705, longitude: 114.17544 });

export interface ImageryLoadProgress {
  completed: number;
  total: number;
  successful: number;
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
  private loadPromise: Promise<void> | null = null;

  public constructor() {
    this.group.name = 'Lands Department aerial imagery';
  }

  public load(
    renderer: WebGLRenderer,
    onProgress: (progress: ImageryLoadProgress) => void = () => undefined,
  ): Promise<void> {
    this.loadPromise ??= this.loadTiles(renderer, onProgress).catch(error => {
      this.loadPromise = null;
      throw error;
    });
    return this.loadPromise;
  }

  public dispose(): void {
    this.group.removeFromParent();
    this.group.clear();
    for (const resource of this.resources) resource.dispose();
    this.resources.clear();
    this.loadPromise = null;
  }

  private async loadTiles(
    renderer: WebGLRenderer,
    onProgress: (progress: ImageryLoadProgress) => void,
  ): Promise<void> {
    const requests = createTileRequests();
    const textureLoader = new TextureLoader();
    const elevationTiles = await this.loadElevationCoverage(requests);
    const center = geographicToTileFraction(TAI_PO.latitude, TAI_PO.longitude, IMAGERY_ZOOM);
    this.originElevation = this.sampleElevation(elevationTiles, center.x, center.y);
    let nextRequest = 0;
    let completed = 0;
    let successful = 0;
    const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    const worker = async (): Promise<void> => {
      while (nextRequest < requests.length) {
        const request = requests[nextRequest];
        nextRequest += 1;
        try {
          const texture = await textureLoader.loadAsync(`/hk-imagery/${IMAGERY_ZOOM}/${request.x}/${request.y}.png`);
          this.prepareTexture(texture, maxAnisotropy);
          const material = this.track(new MeshStandardMaterial({
            map: texture,
            color: '#ffffff',
            roughness: 0.98,
            metalness: 0,
          }));
          const geometry = this.createGroundGeometry(request, elevationTiles);
          const tile = new Mesh(geometry, material);
          tile.position.set(request.worldX, 0.16, request.worldZ);
          tile.receiveShadow = true;
          this.group.add(tile);
          successful += 1;
        } catch {
          // A missing edge tile leaves the local fallback terrain visible.
        } finally {
          completed += 1;
          onProgress({ completed, total: requests.length, successful });
        }
      }
    };

    await Promise.all(Array.from({ length: 6 }, () => worker()));
    if (successful === 0) throw new Error('Official Hong Kong aerial imagery could not be loaded.');
  }

  private prepareTexture(texture: Texture, anisotropy: number): void {
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = ClampToEdgeWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.anisotropy = anisotropy;
    this.track(texture);
  }

  private createGroundGeometry(
    request: TileRequest,
    elevationTiles: Map<string, Uint8ClampedArray>,
  ): PlaneGeometry {
    const width = tileWidthMetres() + 0.5;
    const geometry = this.track(new PlaneGeometry(width, width, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS));
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    for (let index = 0; index < positions.count; index += 1) {
      const imageryX = request.x + uv.getX(index);
      const imageryY = request.y + (1 - uv.getY(index));
      positions.setY(index, this.sampleElevation(elevationTiles, imageryX, imageryY));
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
          const x = Math.floor(cornerX / IMAGERY_TO_ELEVATION_SCALE);
          const y = Math.floor(cornerY / IMAGERY_TO_ELEVATION_SCALE);
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
    imageryX: number,
    imageryY: number,
  ): number {
    const terrainX = imageryX / IMAGERY_TO_ELEVATION_SCALE;
    const terrainY = imageryY / IMAGERY_TO_ELEVATION_SCALE;
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
}

function createTileRequests(): TileRequest[] {
  const center = geographicToTileFraction(TAI_PO.latitude, TAI_PO.longitude, IMAGERY_ZOOM);
  const centerX = center.x;
  const centerY = center.y;
  const centerTileX = Math.floor(centerX);
  const centerTileY = Math.floor(centerY);
  const tileWidth = tileWidthMetres();
  const requests: TileRequest[] = [];

  for (let offsetY = -GRID_RADIUS; offsetY < GRID_RADIUS; offsetY += 1) {
    for (let offsetX = -GRID_RADIUS; offsetX < GRID_RADIUS; offsetX += 1) {
      const x = centerTileX + offsetX;
      const y = centerTileY + offsetY;
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

function tileWidthMetres(): number {
  const latitudeRadians = TAI_PO.latitude * Math.PI / 180;
  return EARTH_CIRCUMFERENCE_METRES * Math.cos(latitudeRadians) / 2 ** IMAGERY_ZOOM;
}
