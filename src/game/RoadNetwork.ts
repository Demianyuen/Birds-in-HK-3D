import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { Group } from 'three';
import { geographicToTileFraction } from './AerialImageryGround';
import type { FlightRegion } from './regions';

const EARTH_CIRCUMFERENCE_METRES = 40_075_016.686;
const ROAD_ZOOM = 14;
const ROAD_EDGE_BUFFER_METRES = 450;
const ROAD_LAYER_NAME = 'transportation';

export type RoadClass = 'motorway' | 'primary' | 'secondary' | 'tertiary' | 'minor' | 'service';

export interface RoadStyle {
  widthMetres: number;
  color: string;
  markings: boolean;
}

export interface RoadNetworkMetrics {
  features: number;
  segments: number;
  tilesLoaded: number;
  waterFeatures: number;
  visibleMeshes: number;
  surfacesRendered: boolean;
}

export interface RoadLoadProgress {
  completed: number;
  total: number;
  successful: number;
}

interface TileRequest {
  x: number;
  y: number;
}

interface WorldPoint {
  x: number;
  z: number;
}

const ROAD_STYLES: Readonly<Record<RoadClass, RoadStyle>> = Object.freeze({
  motorway: { widthMetres: 18, color: '#3f4548', markings: true },
  primary: { widthMetres: 14, color: '#454a4b', markings: true },
  secondary: { widthMetres: 11, color: '#4a4e4d', markings: true },
  tertiary: { widthMetres: 9, color: '#505250', markings: false },
  minor: { widthMetres: 7, color: '#555754', markings: false },
  service: { widthMetres: 5, color: '#5a5b57', markings: false },
});

export class RoadNetwork {
  public readonly group = new Group();
  private currentMetrics: RoadNetworkMetrics = emptyMetrics();

  public constructor() {
    this.group.name = 'OpenStreetMap navigation data (not rendered)';
  }

  public async load(
    region: FlightRegion,
    onProgress: (progress: RoadLoadProgress) => void = () => undefined,
  ): Promise<void> {
    this.currentMetrics = emptyMetrics();
    const requests = createRoadTileRequests(region);
    let completed = 0;
    let successful = 0;
    onProgress({ completed, total: requests.length, successful });

    const tiles = await Promise.all(requests.map(async request => {
      try {
        const response = await fetch(`/road-data/${ROAD_ZOOM}/${request.x}/${request.y}.pbf`);
        if (!response.ok) return null;
        successful += 1;
        return await response.arrayBuffer();
      } catch {
        return null;
      } finally {
        completed += 1;
        onProgress({ completed, total: requests.length, successful });
      }
    }));

    let features = 0;
    let segments = 0;
    let waterFeatures = 0;
    for (const data of tiles) {
      if (!data) continue;
      const vectorTile = new VectorTile(new Pbf(data));
      const roads = vectorTile.layers[ROAD_LAYER_NAME];
      if (roads) {
        for (let index = 0; index < roads.length; index += 1) {
          const feature = roads.feature(index);
          if (!classifyRoad(feature.properties, feature.type)) continue;
          const featureSegments = feature.loadGeometry().reduce(
            (total, line) => total + Math.max(0, line.length - 1),
            0,
          );
          if (featureSegments === 0) continue;
          features += 1;
          segments += featureSegments;
        }
      }
      const water = vectorTile.layers.water;
      if (water) {
        for (let index = 0; index < water.length; index += 1) {
          if (water.feature(index).type === 3) waterFeatures += 1;
        }
      }
    }

    if (features === 0) throw new Error('The Hong Kong navigation road data could not be loaded.');
    this.currentMetrics = {
      features,
      segments,
      tilesLoaded: successful,
      waterFeatures,
      visibleMeshes: 0,
      surfacesRendered: false,
    };
  }

  public get metrics(): Readonly<RoadNetworkMetrics> {
    return this.currentMetrics;
  }

  public dispose(): void {
    this.group.removeFromParent();
    this.currentMetrics = emptyMetrics();
  }
}

export function classifyRoad(
  properties: Readonly<Record<string, number | string | boolean>>,
  geometryType: number,
): RoadClass | null {
  if (geometryType !== 2 || properties.brunnel === 'tunnel') return null;
  const roadClass = properties.class;
  return typeof roadClass === 'string' && roadClass in ROAD_STYLES
    ? roadClass as RoadClass
    : null;
}

export function roadStyle(roadClass: RoadClass): Readonly<RoadStyle> {
  return ROAD_STYLES[roadClass];
}

export function vectorTilePointToWorld(
  tileX: number,
  tileY: number,
  pointX: number,
  pointY: number,
  extent: number,
  center: Readonly<{ x: number; y: number }>,
  tileWidthMetres: number,
): WorldPoint {
  return {
    x: (tileX + pointX / extent - center.x) * tileWidthMetres,
    z: (tileY + pointY / extent - center.y) * tileWidthMetres,
  };
}

export function roadTileCount(region: FlightRegion): number {
  return createRoadTileRequests(region).length;
}

function createRoadTileRequests(region: FlightRegion): TileRequest[] {
  const center = geographicToTileFraction(region.latitude, region.longitude, ROAD_ZOOM);
  const tileRadius = (region.flightRadiusMetres + ROAD_EDGE_BUFFER_METRES)
    / roadTileWidthMetres(region.latitude);
  const minimumX = Math.floor(center.x - tileRadius);
  const maximumX = Math.floor(center.x + tileRadius);
  const minimumY = Math.floor(center.y - tileRadius);
  const maximumY = Math.floor(center.y + tileRadius);
  const requests: TileRequest[] = [];
  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) requests.push({ x, y });
  }
  return requests;
}

function roadTileWidthMetres(latitude: number): number {
  return EARTH_CIRCUMFERENCE_METRES * Math.cos(latitude * Math.PI / 180) / 2 ** ROAD_ZOOM;
}

function emptyMetrics(): RoadNetworkMetrics {
  return {
    features: 0,
    segments: 0,
    tilesLoaded: 0,
    waterFeatures: 0,
    visibleMeshes: 0,
    surfacesRendered: false,
  };
}
