import { classifyRings, VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  ShapeUtils,
  Vector2,
} from 'three';
import { geographicToTileFraction } from './AerialImageryGround';
import type { FlightRegion } from './regions';

const EARTH_CIRCUMFERENCE_METRES = 40_075_016.686;
const ROAD_ZOOM = 14;
const ROAD_EDGE_BUFFER_METRES = 450;
const MAX_SEGMENT_LENGTH_METRES = 24;
const ROAD_SURFACE_OFFSET_METRES = 0.48;
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
  meshes: number;
  waterFeatures: number;
  waterTriangles: number;
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

interface GeometryBucket {
  road: number[];
  markings: number[];
}

type ElevationSampler = (worldX: number, worldZ: number) => number;

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
  private readonly resources = new Set<{ dispose: () => void }>();
  private currentMetrics: RoadNetworkMetrics = emptyMetrics();

  public constructor() {
    this.group.name = 'OpenStreetMap road and water network';
  }

  public async load(
    region: FlightRegion,
    sampleElevation: ElevationSampler,
    onProgress: (progress: RoadLoadProgress) => void = () => undefined,
  ): Promise<void> {
    this.clear();
    const requests = createRoadTileRequests(region);
    let completed = 0;
    let successful = 0;
    onProgress({ completed, total: requests.length, successful });

    const tiles = await Promise.all(requests.map(async request => {
      try {
        const response = await fetch(`/road-data/${ROAD_ZOOM}/${request.x}/${request.y}.pbf`);
        if (!response.ok) return null;
        successful += 1;
        return { request, data: await response.arrayBuffer() };
      } catch {
        return null;
      } finally {
        completed += 1;
        onProgress({ completed, total: requests.length, successful });
      }
    }));

    const center = geographicToTileFraction(region.latitude, region.longitude, ROAD_ZOOM);
    const tileWidth = roadTileWidthMetres(region.latitude);
    const buckets = new Map<RoadClass, GeometryBucket>();
    let features = 0;
    let segments = 0;
    let waterFeatures = 0;
    let waterTriangles = 0;
    const waterVertices: number[] = [];

    for (const loaded of tiles) {
      if (!loaded) continue;
      const vectorTile = new VectorTile(new Pbf(loaded.data));
      const layer = vectorTile.layers[ROAD_LAYER_NAME];
      if (!layer) continue;
      for (let index = 0; index < layer.length; index += 1) {
        const feature = layer.feature(index);
        const roadClass = classifyRoad(feature.properties, feature.type);
        if (!roadClass) continue;
        const style = ROAD_STYLES[roadClass];
        const bucket = buckets.get(roadClass) ?? { road: [], markings: [] };
        buckets.set(roadClass, bucket);

        let featureHasSegments = false;
        for (const line of feature.loadGeometry()) {
          const points = line.map(point => vectorTilePointToWorld(
            loaded.request.x,
            loaded.request.y,
            point.x,
            point.y,
            feature.extent,
            center,
            tileWidth,
          ));
          const result = appendRoadRibbon(bucket, points, style, sampleElevation);
          segments += result;
          featureHasSegments ||= result > 0;
        }
        if (featureHasSegments) features += 1;
      }

      const waterLayer = vectorTile.layers.water;
      if (!waterLayer) continue;
      for (let index = 0; index < waterLayer.length; index += 1) {
        const feature = waterLayer.feature(index);
        if (feature.type !== 3) continue;
        let featureTriangles = 0;
        for (const polygon of classifyRings(feature.loadGeometry())) {
          const rings = polygon.map(ring => ring.map(point => vectorTilePointToWorld(
            loaded.request.x,
            loaded.request.y,
            point.x,
            point.y,
            feature.extent,
            center,
            tileWidth,
          )));
          featureTriangles += appendWaterPolygon(
            waterVertices,
            rings,
            sampleElevation,
            String(feature.properties.class ?? ''),
          );
        }
        if (featureTriangles > 0) {
          waterFeatures += 1;
          waterTriangles += featureTriangles;
        }
      }
    }

    if (features === 0) throw new Error('The real Hong Kong road network could not be loaded.');

    let meshes = 0;
    for (const [roadClass, bucket] of buckets) {
      const style = ROAD_STYLES[roadClass];
      if (bucket.road.length > 0) {
        this.group.add(this.createMesh(bucket.road, style.color, `${roadClass} road surface`, 0));
        meshes += 1;
      }
      if (bucket.markings.length > 0) {
        this.group.add(this.createMesh(bucket.markings, '#d9d5bf', `${roadClass} centre markings`, -2));
        meshes += 1;
      }
    }
    if (waterVertices.length > 0) {
      this.group.add(this.createWaterMesh(waterVertices));
      meshes += 1;
    }
    this.currentMetrics = {
      features,
      segments,
      tilesLoaded: successful,
      meshes,
      waterFeatures,
      waterTriangles,
    };
  }

  public get metrics(): Readonly<RoadNetworkMetrics> {
    return this.currentMetrics;
  }

  public dispose(): void {
    this.group.removeFromParent();
    this.clear();
  }

  private createMesh(vertices: number[], color: string, name: string, polygonOffsetFactor: number): Mesh {
    const geometry = this.track(new BufferGeometry());
    geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const material = this.track(new MeshStandardMaterial({
      color,
      roughness: 0.94,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor,
      polygonOffsetUnits: polygonOffsetFactor,
    }));
    const mesh = new Mesh(geometry, material);
    mesh.name = name;
    mesh.receiveShadow = true;
    return mesh;
  }

  private createWaterMesh(vertices: number[]): Mesh {
    const geometry = this.track(new BufferGeometry());
    geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const material = this.track(new MeshStandardMaterial({
      color: '#315f68',
      roughness: 0.38,
      metalness: 0.06,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    }));
    const mesh = new Mesh(geometry, material);
    mesh.name = 'Real Hong Kong water bodies';
    mesh.receiveShadow = true;
    return mesh;
  }

  private clear(): void {
    this.group.clear();
    for (const resource of this.resources) resource.dispose();
    this.resources.clear();
    this.currentMetrics = emptyMetrics();
  }

  private track<T extends { dispose: () => void }>(resource: T): T {
    this.resources.add(resource);
    return resource;
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

function appendRoadRibbon(
  bucket: GeometryBucket,
  points: readonly WorldPoint[],
  style: RoadStyle,
  sampleElevation: ElevationSampler,
): number {
  if (points.length < 2) return 0;
  let segmentCount = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const distance = Math.hypot(end.x - start.x, end.z - start.z);
    const steps = Math.max(1, Math.ceil(distance / MAX_SEGMENT_LENGTH_METRES));
    for (let step = 0; step < steps; step += 1) {
      const amountA = step / steps;
      const amountB = (step + 1) / steps;
      const pointA = interpolatePoint(start, end, amountA);
      const pointB = interpolatePoint(start, end, amountB);
      appendSegment(bucket.road, pointA, pointB, style.widthMetres, sampleElevation, ROAD_SURFACE_OFFSET_METRES);
      if (style.markings && segmentCount % 2 === 0) {
        appendSegment(bucket.markings, pointA, pointB, 0.44, sampleElevation, ROAD_SURFACE_OFFSET_METRES + 0.08);
      }
      segmentCount += 1;
    }
  }
  return segmentCount;
}

function appendWaterPolygon(
  vertices: number[],
  rings: readonly (readonly WorldPoint[])[],
  sampleElevation: ElevationSampler,
  waterClass: string,
): number {
  const normalizedRings = rings
    .map(removeClosingPoint)
    .filter(ring => ring.length >= 3);
  const contour = normalizedRings[0];
  if (!contour) return 0;
  const holes = normalizedRings.slice(1);
  const contour2d = contour.map(point => new Vector2(point.x, point.z));
  const holes2d = holes.map(ring => ring.map(point => new Vector2(point.x, point.z)));
  const points = [contour, ...holes].flat();
  const waterHeight = waterClass === 'ocean'
    ? 0.28
    : median(points.map(point => sampleElevation(point.x, point.z))) + 0.42;
  const triangles = ShapeUtils.triangulateShape(contour2d, holes2d);
  for (const [first, second, third] of triangles) {
    const pointA = points[first];
    const pointB = points[second];
    const pointC = points[third];
    if (!pointA || !pointB || !pointC) continue;
    pushTriangle(
      vertices,
      [pointA.x, waterHeight, pointA.z],
      [pointC.x, waterHeight, pointC.z],
      [pointB.x, waterHeight, pointB.z],
    );
  }
  return triangles.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  values.sort((left, right) => left - right);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0
    ? (values[middle - 1] + values[middle]) * 0.5
    : values[middle];
}

function removeClosingPoint(points: readonly WorldPoint[]): WorldPoint[] {
  if (points.length < 2) return [...points];
  const first = points[0];
  const last = points[points.length - 1];
  return Math.hypot(last.x - first.x, last.z - first.z) < 0.01
    ? points.slice(0, -1)
    : [...points];
}

function appendSegment(
  vertices: number[],
  start: WorldPoint,
  end: WorldPoint,
  width: number,
  sampleElevation: ElevationSampler,
  heightOffset: number,
): void {
  const deltaX = end.x - start.x;
  const deltaZ = end.z - start.z;
  const length = Math.hypot(deltaX, deltaZ);
  if (length < 0.05) return;
  const offsetX = -deltaZ / length * width * 0.5;
  const offsetZ = deltaX / length * width * 0.5;
  const leftA = elevated(start.x + offsetX, start.z + offsetZ, sampleElevation, heightOffset);
  const rightA = elevated(start.x - offsetX, start.z - offsetZ, sampleElevation, heightOffset);
  const leftB = elevated(end.x + offsetX, end.z + offsetZ, sampleElevation, heightOffset);
  const rightB = elevated(end.x - offsetX, end.z - offsetZ, sampleElevation, heightOffset);
  pushTriangle(vertices, leftA, leftB, rightA);
  pushTriangle(vertices, leftB, rightB, rightA);
}

function elevated(
  x: number,
  z: number,
  sampleElevation: ElevationSampler,
  heightOffset: number,
): [number, number, number] {
  return [x, sampleElevation(x, z) + heightOffset, z];
}

function pushTriangle(
  vertices: number[],
  first: readonly number[],
  second: readonly number[],
  third: readonly number[],
): void {
  vertices.push(...first, ...second, ...third);
}

function interpolatePoint(start: WorldPoint, end: WorldPoint, amount: number): WorldPoint {
  return {
    x: start.x + (end.x - start.x) * amount,
    z: start.z + (end.z - start.z) * amount,
  };
}

function roadTileWidthMetres(latitude: number): number {
  return EARTH_CIRCUMFERENCE_METRES * Math.cos(latitude * Math.PI / 180) / 2 ** ROAD_ZOOM;
}

function emptyMetrics(): RoadNetworkMetrics {
  return {
    features: 0,
    segments: 0,
    tilesLoaded: 0,
    meshes: 0,
    waterFeatures: 0,
    waterTriangles: 0,
  };
}
