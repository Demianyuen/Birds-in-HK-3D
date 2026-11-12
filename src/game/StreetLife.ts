import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  Euler,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Vector3,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  block, contactShadowTexture, pedestrianGeometry, VEHICLE_FOOTPRINT, VEHICLE_KINDS, vehicleGeometry,
  WALK_VERTEX_BODY, WALK_VERTEX_HEAD, type VehicleKind,
} from './streetModels';
import { clearWaterLine, inAnyWater, type LaneClass, type StreetData, type StreetLine } from './streetData';

/**
 * Everyday life in Tai Po: cars, taxis, minibuses and buses on the real
 * roads (keeping left, as in Hong Kong), people walking on footpaths and
 * pavements near the bird, and boats crossing Tolo Harbour. Everything is
 * instanced and kept near the bird so it costs little on a laptop GPU.
 */

/** Kinds whose colours are built in (the instance colour stays white). */
const FIXED_COLOUR = new Set<VehicleKind>(['taxiGreen', 'taxiRed', 'minibusGreen', 'minibusRed']);
type BoatKind = 'sampan' | 'ferry' | 'trawler';
const BOAT_KINDS: readonly BoatKind[] = ['sampan', 'ferry', 'trawler'];

const VEHICLE_COUNT = 240;
const PEDESTRIAN_COUNT = 150;
/** Steps per second ×π: how fast the legs swing. */
const STEP_RATE = 7;
const BOAT_COUNT = 18;
const VEHICLE_KEEP_RADIUS = 1_700;
const VEHICLE_SPAWN_RADIUS = 1_300;
const PEDESTRIAN_KEEP_RADIUS = 420;
const PEDESTRIAN_SPAWN_RADIUS = 320;
const BOAT_KEEP_RADIUS = 4_200;
const GRID = 40;
/** People and vehicles this close to the bird are checked against the real surface. */
const SURFACE_CHECK_RADIUS = 450;
const DOWN = new Vector3(0, -1, 0);
const PERSON_FOOTPRINT: readonly [number, number] = [0.6, 0.6];

const SPEED: Readonly<Record<LaneClass, number>> = {
  motorway: 21, trunk: 18, primary: 13, secondary: 11, tertiary: 9, minor: 6.5, service: 4, path: 1.3,
};
const LANE_OFFSET: Readonly<Record<LaneClass, number>> = {
  motorway: 5.5, trunk: 5, primary: 4, secondary: 3.4, tertiary: 3, minor: 2.2, service: 1.8, path: 0.7,
};

/** Kinds that use each class of road, with weights. */
function pickVehicle(laneClass: LaneClass, random: number): VehicleKind {
  const big = laneClass === 'motorway' || laneClass === 'trunk' || laneClass === 'primary';
  // Tai Po is in the New Territories: mostly green taxis, some red urban ones passing through.
  const table: Array<[VehicleKind, number]> = big
    ? [['car', 0.36], ['taxiGreen', 0.11], ['taxiRed', 0.07], ['bus', 0.14], ['minibusGreen', 0.06], ['minibusRed', 0.02], ['van', 0.12], ['lorry', 0.12]]
    : [['car', 0.42], ['taxiGreen', 0.17], ['taxiRed', 0.07], ['minibusGreen', 0.13], ['minibusRed', 0.03], ['van', 0.12], ['bus', 0.04], ['lorry', 0.02]];
  let sum = 0;
  for (const [kind, weight] of table) {
    sum += weight;
    if (random < sum) return kind;
  }
  return 'car';
}

const CAR_COLOURS = ['#f2f2ef', '#1f2326', '#9aa1a6', '#c9ccce', '#3d4f66', '#7a1f24', '#e8e3d6', '#2f4a3a'];
const BUS_COLOURS = ['#e9e1cd', '#f1efe8', '#d8d3c4', '#c43a33', '#e4d7b8'];
const CLOTHES = ['#f4f1ea', '#20242a', '#5f6f86', '#9a3b37', '#e0c9a6', '#3f6a54', '#c7a33f', '#6d5a7a', '#8fa9c4', '#d9d4cc'];

interface Mover {
  line: StreetLine;
  /** Segment index: between points[seg] and points[seg + 1]. */
  seg: number;
  /** 0..1 along the segment. */
  t: number;
  dir: 1 | -1;
  speed: number;
  offset: number;
  colour: Color;
  kind: number;
  phase: number;
  active: boolean;
  /** Where it stands now, and how far the surface under it is from the terrain estimate (measured, eased). */
  x: number;
  z: number;
  lift: number;
  liftTarget: number;
}

interface Boat {
  kind: BoatKind;
  x: number;
  z: number;
  y: number;
  targetX: number;
  targetZ: number;
  speed: number;
  heading: number;
  /** Hull length (m), for the wake. */
  length: number;
  colour: Color;
  phase: number;
  active: boolean;
}

export type GroundHeight = (x: number, z: number) => number;

export class StreetLife {
  public readonly group = new Group();
  private data: StreetData = { roads: [], paths: [], water: [] };
  private readonly vehicleMeshes = new Map<VehicleKind, InstancedMesh>();
  private readonly boatMeshes = new Map<BoatKind, InstancedMesh>();
  private readonly people: InstancedMesh;
  private readonly wakes: InstancedMesh;
  private readonly shadows: InstancedMesh;
  private readonly steps: InstancedBufferAttribute;
  private shadowCount = 0;
  private surfaceCursor = 0;
  private readonly vehicleLimit: number;
  private readonly pedestrianLimit: number;
  private readonly vehicles: Mover[] = [];
  private readonly pedestrians: Mover[] = [];
  private readonly boats: Boat[] = [];
  private readonly roadGrid = new Map<string, Array<{ line: StreetLine; index: number }>>();
  private readonly heightCache = new Map<StreetLine, Float32Array>();
  private readonly refineQueue: Array<{ line: StreetLine; index: number }> = [];
  private readonly queued = new WeakMap<StreetLine, Set<number>>();
  private readonly raycaster = new Raycaster();
  private readonly matrix = new Matrix4();
  private readonly quaternion = new Quaternion();
  private readonly scale = new Vector3(1, 1, 1);
  private readonly position = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private readonly euler = new Euler();
  private readonly wakeScale = new Vector3();
  private ground: GroundHeight = () => 0;
  private roots: Object3D[] = [];
  private clock = 0;
  private readonly disposables: Array<{ dispose: () => void }> = [];

  /** `density` (0–1) thins the traffic and the crowd on phones. */
  public constructor(density = 1) {
    this.group.name = 'Street life';
    this.vehicleLimit = Math.round(VEHICLE_COUNT * density);
    this.pedestrianLimit = Math.round(PEDESTRIAN_COUNT * density);
    // Paint with a little shine, so the sky shows on roofs and bonnets.
    const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.28, flatShading: true });
    const peopleMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
    peopleMaterial.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${WALK_VERTEX_HEAD}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WALK_VERTEX_BODY}`);
    };
    this.disposables.push(material, peopleMaterial);
    for (const kind of VEHICLE_KINDS) {
      const geometry = vehicleGeometry(kind);
      this.disposables.push(geometry);
      const mesh = new InstancedMesh(geometry, material, VEHICLE_COUNT);
      mesh.name = `Traffic ${kind}`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      this.vehicleMeshes.set(kind, mesh);
      this.group.add(mesh);
    }
    const personGeometry = pedestrianGeometry();
    this.disposables.push(personGeometry);
    this.steps = new InstancedBufferAttribute(new Float32Array(PEDESTRIAN_COUNT), 1);
    this.steps.setUsage(DynamicDrawUsage);
    personGeometry.setAttribute('aStep', this.steps);
    this.people = new InstancedMesh(personGeometry, peopleMaterial, PEDESTRIAN_COUNT);
    this.people.name = 'Pedestrians';
    this.people.count = 0;
    this.people.frustumCulled = false;
    this.people.instanceMatrix.setUsage(DynamicDrawUsage);
    this.group.add(this.people);

    // One soft dark patch under every vehicle and person: without it they look pasted on.
    const shadowGeometry = new PlaneGeometry(1, 1);
    shadowGeometry.rotateX(-Math.PI / 2);
    const shadowTexture = contactShadowTexture();
    const shadowMaterial = new MeshBasicMaterial({
      color: '#000000', alphaMap: shadowTexture, transparent: true, opacity: 0.5, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.disposables.push(shadowGeometry, shadowTexture, shadowMaterial);
    this.shadows = new InstancedMesh(shadowGeometry, shadowMaterial, VEHICLE_COUNT + PEDESTRIAN_COUNT);
    this.shadows.name = 'Contact shadows';
    this.shadows.count = 0;
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = 1;
    this.shadows.instanceMatrix.setUsage(DynamicDrawUsage);
    this.group.add(this.shadows);

    const boatMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05, flatShading: true });
    this.disposables.push(boatMaterial);
    for (const kind of BOAT_KINDS) {
      const geometry = boatGeometry(kind);
      this.disposables.push(geometry);
      const mesh = new InstancedMesh(geometry, boatMaterial, BOAT_COUNT);
      mesh.name = `Boat ${kind}`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      this.boatMeshes.set(kind, mesh);
      this.group.add(mesh);
    }
    const wakeGeometry = new PlaneGeometry(1, 1);
    wakeGeometry.rotateX(-Math.PI / 2);
    wakeGeometry.translate(0, 0, -0.5);
    const wakeTexture = wakeGradient();
    const wakeMaterial = new MeshBasicMaterial({
      map: wakeTexture, color: '#ffffff', transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false,
    });
    this.disposables.push(wakeGeometry, wakeTexture, wakeMaterial);
    this.wakes = new InstancedMesh(wakeGeometry, wakeMaterial, BOAT_COUNT);
    this.wakes.name = 'Boat wakes';
    this.wakes.count = 0;
    this.wakes.frustumCulled = false;
    this.wakes.renderOrder = 2;
    this.group.add(this.wakes);

    for (let index = 0; index < VEHICLE_COUNT; index += 1) this.vehicles.push(emptyMover());
    for (let index = 0; index < PEDESTRIAN_COUNT; index += 1) this.pedestrians.push(emptyMover());
    for (let index = 0; index < BOAT_COUNT; index += 1) {
      this.boats.push({ kind: 'sampan', x: 0, z: 0, y: 0, targetX: 0, targetZ: 0, speed: 0, heading: 0, length: 7, colour: new Color(), phase: 0, active: false });
    }
  }

  public setStreets(data: StreetData): void {
    this.data = data;
    this.roadGrid.clear();
    this.heightCache.clear();
    this.refineQueue.length = 0;
    for (const line of data.roads) {
      line.points.forEach((point, index) => {
        const key = cellKey(point.x, point.z);
        let cell = this.roadGrid.get(key);
        if (!cell) this.roadGrid.set(key, cell = []);
        cell.push({ line, index });
      });
    }
    for (const mover of [...this.vehicles, ...this.pedestrians]) mover.active = false;
    for (const boat of this.boats) boat.active = false;
  }

  /** Ground height for things on the road before the exact surface is known, and what to drop rays on. */
  public setSurface(ground: GroundHeight, roots: Object3D[]): void {
    this.ground = ground;
    const changed = roots.length !== this.roots.length || roots.some((root, index) => root !== this.roots[index]);
    this.roots = roots;
    if (changed) {
      this.heightCache.clear();
      this.refineQueue.length = 0;
      for (const boat of this.boats) boat.active = false;
    }
  }

  public update(deltaSeconds: number, focus: Vector3): void {
    this.clock += deltaSeconds;
    this.shadowCount = 0;
    if (this.data.roads.length > 0) this.updateMovers(this.vehicles, deltaSeconds, focus, true);
    if (this.data.paths.length > 0) this.updateMovers(this.pedestrians, deltaSeconds, focus, false);
    this.shadows.count = this.shadowCount;
    this.shadows.instanceMatrix.needsUpdate = true;
    if (this.data.water.length > 0) this.updateBoats(deltaSeconds, focus);
    this.refineHeights(0.6);
    this.standOnSurface(focus, 1.0);
  }

  // ---- roads and paths -------------------------------------------------------------------

  private updateMovers(movers: Mover[], deltaSeconds: number, focus: Vector3, driving: boolean): void {
    const keep = driving ? VEHICLE_KEEP_RADIUS : PEDESTRIAN_KEEP_RADIUS;
    const counts = new Map<number, number>();
    let spawned = 0;
    const limit = driving ? this.vehicleLimit : this.pedestrianLimit;
    for (let slot = 0; slot < movers.length; slot += 1) {
      const mover = movers[slot];
      if (slot >= limit) {
        mover.active = false;
        continue;
      }
      if (!mover.active && spawned < 6) {
        if (this.spawn(mover, focus, driving)) spawned += 1;
      }
      if (!mover.active) continue;
      this.advance(mover, mover.speed * deltaSeconds, driving);
      if (!mover.active) continue;
      mover.lift += (mover.liftTarget - mover.lift) * Math.min(1, deltaSeconds * 5);
      const point = this.place(mover, this.position);
      if (Math.hypot(point.x - focus.x, point.z - focus.z) > keep) {
        mover.active = false;
        continue;
      }
      const { dx, dz } = this.direction(mover);
      const heading = Math.atan2(dx, dz);
      this.quaternion.setFromAxisAngle(this.up, heading);
      // The soft shadow, flat on the ground under it.
      const [wide, long] = driving ? VEHICLE_FOOTPRINT[VEHICLE_KINDS[mover.kind]] : PERSON_FOOTPRINT;
      this.scale.set(wide * 1.35, 1, long * 1.2);
      point.y += 0.05;
      this.matrix.compose(point, this.quaternion, this.scale);
      this.shadows.setMatrixAt(this.shadowCount, this.matrix);
      this.shadowCount += 1;
      point.y -= 0.05;
      this.scale.set(1, 1, 1);
      const index = counts.get(driving ? mover.kind : 0) ?? 0;
      if (!driving) {
        // People differ a little in height; legs and arms swing in time with a gentle bob.
        const step = this.clock * STEP_RATE * (mover.speed / 1.3) + mover.phase;
        point.y += Math.abs(Math.sin(step)) * 0.035;
        const height = 0.92 + (mover.phase % 1) * 0.16;
        this.scale.set(height, height, height);
        this.steps.setX(index, step % (Math.PI * 2));
      }
      this.matrix.compose(point, this.quaternion, this.scale);
      this.scale.set(1, 1, 1);
      const mesh = driving ? this.vehicleMeshes.get(VEHICLE_KINDS[mover.kind])! : this.people;
      if (driving) counts.set(mover.kind, index + 1);
      else counts.set(0, index + 1);
      mesh.setMatrixAt(index, this.matrix);
      mesh.setColorAt(index, mover.colour);
    }
    if (driving) {
      VEHICLE_KINDS.forEach((kind, kindIndex) => {
        const mesh = this.vehicleMeshes.get(kind)!;
        mesh.count = counts.get(kindIndex) ?? 0;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      });
    } else {
      this.people.count = counts.get(0) ?? 0;
      this.people.instanceMatrix.needsUpdate = true;
      this.steps.needsUpdate = true;
      if (this.people.instanceColor) this.people.instanceColor.needsUpdate = true;
    }
  }

  private spawn(mover: Mover, focus: Vector3, driving: boolean): boolean {
    const lines = driving ? this.data.roads : this.data.paths;
    const radius = driving ? VEHICLE_SPAWN_RADIUS : PEDESTRIAN_SPAWN_RADIUS;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const line = lines[Math.floor(Math.random() * lines.length)];
      const seg = Math.floor(Math.random() * (line.points.length - 1));
      const a = line.points[seg];
      const distance = Math.hypot(a.x - focus.x, a.z - focus.z);
      if (distance > radius) continue;
      // Cars appear out of the way rather than right in front of the bird.
      if (driving && distance < 160) continue;
      mover.line = line;
      mover.seg = seg;
      mover.t = Math.random();
      mover.dir = line.oneway === 1 ? 1 : line.oneway === -1 ? -1 : Math.random() < 0.5 ? 1 : -1;
      const base = SPEED[line.laneClass];
      if (driving) {
        mover.kind = VEHICLE_KINDS.indexOf(pickVehicle(line.laneClass, Math.random()));
        const kind = VEHICLE_KINDS[mover.kind];
        mover.speed = base * (kind === 'bus' || kind === 'lorry' ? 0.8 : 0.85 + Math.random() * 0.3);
        const lanes = line.laneClass === 'motorway' || line.laneClass === 'trunk' ? (Math.random() < 0.5 ? 0.62 : 1.25) : 1;
        mover.offset = line.oneway !== 0 ? (Math.random() - 0.5) * 3 : LANE_OFFSET[line.laneClass] * lanes;
        mover.colour.set(FIXED_COLOUR.has(kind) ? '#ffffff'
          : kind === 'bus' ? pick(BUS_COLOURS)
              : kind === 'lorry' || kind === 'van' ? pick(['#f0efe9', '#d9d6cf', '#3c5d8a', '#c9b48a'])
                : pick(CAR_COLOURS));
      } else {
        mover.kind = 0;
        mover.speed = 1.05 + Math.random() * 0.5;
        // On a street's pavement, or either side of a footpath.
        const side = Math.random() < 0.5 ? -1 : 1;
        mover.offset = side * (line.laneClass === 'path' ? 0.4 + Math.random() * 0.8 : 5 + Math.random() * 1.5);
        mover.colour.set(pick(CLOTHES));
      }
      mover.phase = Math.random() * 10;
      mover.lift = 0;
      mover.liftTarget = 0;
      mover.active = true;
      return true;
    }
    return false;
  }

  /** Moves along the line; at its end, carries on along a connecting street or turns back. */
  private advance(mover: Mover, distance: number, driving: boolean): void {
    let remaining = distance;
    for (let guard = 0; guard < 8 && remaining > 0; guard += 1) {
      const points = mover.line.points;
      const a = points[mover.seg];
      const b = points[mover.seg + 1];
      const length = Math.max(0.01, Math.hypot(b.x - a.x, b.z - a.z));
      const left = mover.dir === 1 ? (1 - mover.t) * length : mover.t * length;
      if (remaining < left) {
        mover.t += (mover.dir * remaining) / length;
        return;
      }
      remaining -= left;
      if (mover.dir === 1 && mover.seg < points.length - 2) {
        mover.seg += 1;
        mover.t = 0;
      } else if (mover.dir === -1 && mover.seg > 0) {
        mover.seg -= 1;
        mover.t = 1;
      } else if (!driving || !this.continueOnto(mover)) {
        if (mover.line.oneway !== 0 && driving) {
          mover.active = false;
          return;
        }
        mover.dir = mover.dir === 1 ? -1 : 1;
      }
    }
  }

  private continueOnto(mover: Mover): boolean {
    const points = mover.line.points;
    const end = mover.dir === 1 ? points[points.length - 1] : points[0];
    const before = mover.dir === 1 ? points[points.length - 2] : points[1];
    const hx = end.x - before.x;
    const hz = end.z - before.z;
    const hl = Math.hypot(hx, hz) || 1;
    const options: Array<{ line: StreetLine; seg: number; t: number; dir: 1 | -1; score: number }> = [];
    const cx = Math.floor(end.x / GRID);
    const cz = Math.floor(end.z / GRID);
    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oz = -1; oz <= 1; oz += 1) {
        for (const { line, index } of this.roadGrid.get(`${cx + ox},${cz + oz}`) ?? []) {
          if (line === mover.line) continue;
          const point = line.points[index];
          const gap = Math.hypot(point.x - end.x, point.z - end.z);
          if (gap > 18) continue;
          for (const dir of [1, -1] as const) {
            if (line.oneway !== 0 && line.oneway !== dir) continue;
            const next = line.points[index + dir];
            if (!next) continue;
            const vx = next.x - point.x;
            const vz = next.z - point.z;
            const vl = Math.hypot(vx, vz) || 1;
            const dot = (vx * hx + vz * hz) / (vl * hl);
            if (dot < 0.25) continue;
            options.push({ line, seg: dir === 1 ? index : index - 1, t: dir === 1 ? 0 : 1, dir, score: dot - gap / 40 + Math.random() * 0.6 });
          }
        }
      }
    }
    if (options.length === 0) return false;
    options.sort((a, b) => b.score - a.score);
    const chosen = options[0];
    mover.line = chosen.line;
    mover.seg = chosen.seg;
    mover.t = chosen.t;
    mover.dir = chosen.dir;
    return true;
  }

  private direction(mover: Mover): { dx: number; dz: number } {
    const a = mover.line.points[mover.seg];
    const b = mover.line.points[mover.seg + 1];
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { dx: ((b.x - a.x) / length) * mover.dir, dz: ((b.z - a.z) / length) * mover.dir };
  }

  /** World position on the road, kept left of the centre line (Hong Kong drives on the left). */
  private place(mover: Mover, out: Vector3): Vector3 {
    const a = mover.line.points[mover.seg];
    const b = mover.line.points[mover.seg + 1];
    const { dx, dz } = this.direction(mover);
    const x = a.x + (b.x - a.x) * mover.t + dz * mover.offset;
    const z = a.z + (b.z - a.z) * mover.t - dx * mover.offset;
    mover.x = x;
    mover.z = z;
    if (!mover.line.bridge) {
      // The ground right under it (not a straight line between two far-apart road points,
      // which leaves people in the air over a dip or buried in a rise).
      return out.set(x, this.ground(x, z) + mover.lift, z);
    }
    const ya = this.vertexHeight(mover.line, mover.seg);
    const yb = this.vertexHeight(mover.line, mover.seg + 1);
    return out.set(x, ya + (yb - ya) * mover.t, z);
  }

  private vertexHeight(line: StreetLine, index: number): number {
    let cache = this.heightCache.get(line);
    if (!cache) {
      cache = new Float32Array(line.points.length).fill(Number.NaN);
      this.heightCache.set(line, cache);
    }
    const value = cache[index];
    if (!Number.isNaN(value)) return value;
    const point = line.points[index];
    let queued = this.queued.get(line);
    if (!queued) this.queued.set(line, queued = new Set());
    if (!queued.has(index) && this.roots.length > 0) {
      queued.add(index);
      this.refineQueue.push({ line, index });
    }
    return this.ground(point.x, point.z);
  }

  /** Drop rays onto the real surface for road points in use, within a small time budget each frame. */
  private refineHeights(budgetMilliseconds: number): void {
    if (this.roots.length === 0) return;
    const start = performance.now();
    this.raycaster.near = 0;
    while (this.refineQueue.length > 0 && performance.now() - start < budgetMilliseconds) {
      const { line, index } = this.refineQueue.shift()!;
      this.queued.get(line)?.delete(index);
      const point = line.points[index];
      const estimate = this.ground(point.x, point.z);
      this.raycaster.set(this.position.set(point.x, estimate + 70, point.z), new Vector3(0, -1, 0));
      this.raycaster.far = 160;
      const hits = this.raycaster.intersectObjects(this.roots, true);
      let best: number | null = null;
      for (const hit of hits) {
        // Bridges: the deck; elsewhere: the surface nearest the terrain estimate (not a roof).
        const candidate = hit.point.y;
        if (Math.abs(candidate - estimate) > (line.bridge ? 30 : 12)) continue;
        if (best === null || (line.bridge ? candidate > best : Math.abs(candidate - estimate) < Math.abs(best - estimate))) best = candidate;
      }
      const cache = this.heightCache.get(line);
      if (cache) cache[index] = best ?? estimate;
    }
  }

  /**
   * Measures the real surface under each person and vehicle near the bird, a few every frame,
   * so they follow slopes, kerbs and the photo mesh as its detail changes.
   */
  private standOnSurface(focus: Vector3, budgetMilliseconds: number): void {
    if (this.roots.length === 0) return;
    const start = performance.now();
    const total = this.pedestrians.length + this.vehicles.length;
    this.raycaster.near = 0;
    this.raycaster.far = 60;
    for (let tried = 0; tried < total && performance.now() - start < budgetMilliseconds; tried += 1) {
      this.surfaceCursor = (this.surfaceCursor + 1) % total;
      const mover = this.surfaceCursor < this.pedestrians.length
        ? this.pedestrians[this.surfaceCursor]
        : this.vehicles[this.surfaceCursor - this.pedestrians.length];
      if (!mover.active || mover.line.bridge) continue;
      if (Math.hypot(mover.x - focus.x, mover.z - focus.z) > SURFACE_CHECK_RADIUS) continue;
      const estimate = this.ground(mover.x, mover.z);
      this.raycaster.set(this.position.set(mover.x, estimate + 30, mover.z), DOWN);
      let best: number | null = null;
      for (const hit of this.raycaster.intersectObjects(this.roots, true)) {
        // The surface nearest the terrain estimate: the street, not a roof or a canopy above it.
        if (Math.abs(hit.point.y - estimate) > 8) continue;
        if (best === null || Math.abs(hit.point.y - estimate) < Math.abs(best - estimate)) best = hit.point.y;
      }
      mover.liftTarget = best === null ? 0 : best + 0.03 - estimate;
    }
  }

  // ---- boats ------------------------------------------------------------------------------

  private updateBoats(deltaSeconds: number, focus: Vector3): void {
    const counts = new Map<BoatKind, number>();
    let wakeCount = 0;
    let spawned = 0;
    for (const boat of this.boats) {
      if (!boat.active && spawned < 2 && this.spawnBoat(boat, focus)) spawned += 1;
      if (!boat.active) continue;
      const dx = boat.targetX - boat.x;
      const dz = boat.targetZ - boat.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 20 && !this.nextWaypoint(boat)) {
        boat.active = false;
        continue;
      }
      const desired = Math.atan2(dx, dz);
      let turn = desired - boat.heading;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      boat.heading += Math.max(-0.25, Math.min(0.25, turn)) * deltaSeconds;
      const step = boat.speed * deltaSeconds * (Math.abs(turn) > 1 ? 0.4 : 1);
      boat.x += Math.sin(boat.heading) * step;
      boat.z += Math.cos(boat.heading) * step;
      if (Math.hypot(boat.x - focus.x, boat.z - focus.z) > BOAT_KEEP_RADIUS) {
        boat.active = false;
        continue;
      }
      const index = counts.get(boat.kind) ?? 0;
      counts.set(boat.kind, index + 1);
      // Rocking on the swell.
      const roll = Math.sin(this.clock * 1.3 + boat.phase) * 0.035;
      const pitch = Math.sin(this.clock * 0.9 + boat.phase * 2) * 0.02;
      this.quaternion.setFromEuler(this.euler.set(pitch, boat.heading, roll, 'YXZ'));
      this.position.set(boat.x, boat.y + Math.sin(this.clock * 1.1 + boat.phase) * 0.12, boat.z);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      const mesh = this.boatMeshes.get(boat.kind)!;
      mesh.setMatrixAt(index, this.matrix);
      mesh.setColorAt(index, boat.colour);
      // Foam wake behind, longer with speed.
      const length = boat.length * 0.6 + boat.speed * 5;
      this.matrix.compose(
        this.position.set(boat.x - Math.sin(boat.heading) * boat.length * 0.45, boat.y + 0.15, boat.z - Math.cos(boat.heading) * boat.length * 0.45),
        this.quaternion.setFromAxisAngle(this.up, boat.heading),
        this.wakeScale.set(boat.length * 0.55, 1, length),
      );
      this.wakes.setMatrixAt(wakeCount, this.matrix);
      wakeCount += 1;
    }
    for (const kind of BOAT_KINDS) {
      const mesh = this.boatMeshes.get(kind)!;
      mesh.count = counts.get(kind) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.wakes.count = wakeCount;
    this.wakes.instanceMatrix.needsUpdate = true;
  }

  private spawnBoat(boat: Boat, focus: Vector3): boolean {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const area = this.data.water[Math.floor(Math.random() * this.data.water.length)];
      const x = area.minX + Math.random() * (area.maxX - area.minX);
      const z = area.minZ + Math.random() * (area.maxZ - area.minZ);
      if (Math.hypot(x - focus.x, z - focus.z) > BOAT_KEEP_RADIUS * 0.85) continue;
      if (!inAnyWater(this.data.water, x, z) || !clearWaterLine(this.data.water, x, z, x + 1, z + 1, 30)) continue;
      boat.x = x;
      boat.z = z;
      boat.kind = pick(['sampan', 'sampan', 'trawler', 'ferry'] as const);
      boat.length = boat.kind === 'ferry' ? 24 : boat.kind === 'trawler' ? 16 : 7.5;
      boat.speed = boat.kind === 'ferry' ? 7 + Math.random() * 3 : boat.kind === 'trawler' ? 3 + Math.random() * 2 : 2 + Math.random() * 2;
      boat.colour.set(boat.kind === 'ferry' ? '#ffffff' : pick(['#ffffff', '#f3ede0', '#e6efe9', '#f6e7cf']));
      boat.phase = Math.random() * 10;
      boat.y = this.waterLevel(x, z);
      if (!this.nextWaypoint(boat)) continue;
      boat.heading = Math.atan2(boat.targetX - x, boat.targetZ - z);
      boat.active = true;
      return true;
    }
    return false;
  }

  private nextWaypoint(boat: Boat): boolean {
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const angle = boat.heading + (Math.random() - 0.5) * (attempt < 7 ? 1.6 : Math.PI * 2);
      const reach = 250 + Math.random() * 700;
      const x = boat.x + Math.sin(angle) * reach;
      const z = boat.z + Math.cos(angle) * reach;
      if (!clearWaterLine(this.data.water, boat.x, boat.z, x, z, 30)) continue;
      boat.targetX = x;
      boat.targetZ = z;
      return true;
    }
    return false;
  }

  /** Sea level under a point: the surface hit nearest to the terrain estimate (photo mesh or stylised water). */
  private waterLevel(x: number, z: number): number {
    const estimate = this.ground(x, z);
    if (this.roots.length === 0) return estimate;
    this.raycaster.set(this.position.set(x, estimate + 60, z), new Vector3(0, -1, 0));
    this.raycaster.far = 120;
    const hit = this.raycaster.intersectObjects(this.roots, true).find(item => Math.abs(item.point.y - estimate) < 15);
    return hit ? hit.point.y : estimate;
  }

  public get counts(): { vehicles: number; pedestrians: number; boats: number } {
    return {
      vehicles: this.vehicles.filter(mover => mover.active).length,
      pedestrians: this.pedestrians.filter(mover => mover.active).length,
      boats: this.boats.filter(boat => boat.active).length,
    };
  }

  public dispose(): void {
    for (const mesh of [...this.vehicleMeshes.values(), ...this.boatMeshes.values(), this.people, this.wakes, this.shadows]) mesh.dispose();
    for (const item of this.disposables) item.dispose();
    this.group.removeFromParent();
  }
}

// ---- helpers ------------------------------------------------------------------------------

function emptyMover(): Mover {
  return { line: { points: [], laneClass: 'minor', oneway: 0, bridge: false }, seg: 0, t: 0, dir: 1, speed: 0, offset: 0, colour: new Color(), kind: 0, phase: 0, active: false, x: 0, z: 0, lift: 0, liftTarget: 0 };
}

function cellKey(x: number, z: number): string {
  return `${Math.floor(x / GRID)},${Math.floor(z / GRID)}`;
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

const GLASS = '#1d2a33';

/** Boats face +z with the waterline at y = 0. */
function boatGeometry(kind: BoatKind): BufferGeometry {
  const parts: BufferGeometry[] = [];
  if (kind === 'sampan') {
    parts.push(block(2.0, 0.7, 7.5, 0, 0.15, 0, '#7a5a3c'));
    parts.push(block(1.6, 0.1, 7.0, 0, 0.52, 0, '#8d6b4a'));
    // Curved canopy, roughly.
    parts.push(block(1.7, 0.9, 2.6, 0, 1.0, -0.8, '#3f4a3a'));
  } else if (kind === 'trawler') {
    parts.push(block(4.2, 1.4, 16, 0, 0.3, 0, '#ffffff'));
    parts.push(block(4.25, 0.3, 16.05, 0, -0.25, 0, '#2c4e6e'));
    parts.push(block(3.2, 2.4, 4.5, 0, 2.1, -3.0, '#f1ece0'));
    parts.push(block(3.22, 0.6, 4.4, 0, 2.7, -3.0, GLASS));
    parts.push(block(0.15, 6, 0.15, 0, 3.6, 3.2, '#5a4a3a'));
  } else {
    // Small harbour ferry.
    parts.push(block(6.4, 1.6, 24, 0, 0.4, 0, '#ffffff'));
    parts.push(block(6.45, 0.35, 24.05, 0, -0.25, 0, '#1f5e8c'));
    parts.push(block(5.6, 2.3, 16, 0, 2.3, -0.5, '#f4f4f0'));
    parts.push(block(5.62, 0.9, 15.6, 0, 2.5, -0.5, GLASS));
    parts.push(block(4.2, 1.4, 4.0, 0, 4.1, 2.6, '#f4f4f0'));
  }
  const merged = mergeGeometries(parts)!;
  return merged;
}

function wakeGradient(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    // Bright at the stern (top), fading behind, soft at the sides.
    const along = context.createLinearGradient(0, 0, 0, 128);
    along.addColorStop(0, 'rgba(255,255,255,0.95)');
    along.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = along;
    context.fillRect(0, 0, 32, 128);
    context.globalCompositeOperation = 'destination-in';
    const across = context.createLinearGradient(0, 0, 32, 0);
    across.addColorStop(0, 'rgba(0,0,0,0)');
    across.addColorStop(0.5, 'rgba(0,0,0,1)');
    across.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = across;
    context.fillRect(0, 0, 32, 128);
  }
  return new CanvasTexture(canvas);
}
