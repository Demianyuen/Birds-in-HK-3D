import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Euler,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  SphereGeometry,
  Vector3,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clearWaterLine, inAnyWater, type LaneClass, type StreetData, type StreetLine } from './streetData';

/**
 * Everyday life in Tai Po: cars, taxis, minibuses and buses on the real
 * roads (keeping left, as in Hong Kong), people walking on footpaths and
 * pavements near the bird, and boats crossing Tolo Harbour. Everything is
 * instanced and kept near the bird so it costs little on a laptop GPU.
 */

type VehicleKind = 'car' | 'taxiGreen' | 'taxiRed' | 'minibusGreen' | 'minibusRed' | 'bus' | 'van' | 'lorry';
const VEHICLE_KINDS: readonly VehicleKind[] = ['car', 'taxiGreen', 'taxiRed', 'minibusGreen', 'minibusRed', 'bus', 'van', 'lorry'];
/** Kinds whose colours are built in (the instance colour stays white). */
const FIXED_COLOUR = new Set<VehicleKind>(['taxiGreen', 'taxiRed', 'minibusGreen', 'minibusRed']);
type BoatKind = 'sampan' | 'ferry' | 'trawler';
const BOAT_KINDS: readonly BoatKind[] = ['sampan', 'ferry', 'trawler'];

const VEHICLE_COUNT = 240;
const PEDESTRIAN_COUNT = 150;
const BOAT_COUNT = 18;
const VEHICLE_KEEP_RADIUS = 1_700;
const VEHICLE_SPAWN_RADIUS = 1_300;
const PEDESTRIAN_KEEP_RADIUS = 420;
const PEDESTRIAN_SPAWN_RADIUS = 320;
const BOAT_KEEP_RADIUS = 4_200;
const GRID = 40;

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

  public constructor() {
    this.group.name = 'Street life';
    const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15, flatShading: true });
    this.disposables.push(material);
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
    this.people = new InstancedMesh(personGeometry, material, PEDESTRIAN_COUNT);
    this.people.name = 'Pedestrians';
    this.people.count = 0;
    this.people.frustumCulled = false;
    this.people.instanceMatrix.setUsage(DynamicDrawUsage);
    this.group.add(this.people);

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
    if (this.data.roads.length > 0) this.updateMovers(this.vehicles, deltaSeconds, focus, true);
    if (this.data.paths.length > 0) this.updateMovers(this.pedestrians, deltaSeconds, focus, false);
    if (this.data.water.length > 0) this.updateBoats(deltaSeconds, focus);
    this.refineHeights(1.2);
  }

  // ---- roads and paths -------------------------------------------------------------------

  private updateMovers(movers: Mover[], deltaSeconds: number, focus: Vector3, driving: boolean): void {
    const keep = driving ? VEHICLE_KEEP_RADIUS : PEDESTRIAN_KEEP_RADIUS;
    const counts = new Map<number, number>();
    let spawned = 0;
    for (const mover of movers) {
      if (!mover.active && spawned < 6) {
        if (this.spawn(mover, focus, driving)) spawned += 1;
      }
      if (!mover.active) continue;
      this.advance(mover, mover.speed * deltaSeconds, driving);
      if (!mover.active) continue;
      const point = this.place(mover, this.position);
      if (Math.hypot(point.x - focus.x, point.z - focus.z) > keep) {
        mover.active = false;
        continue;
      }
      const { dx, dz } = this.direction(mover);
      const heading = Math.atan2(dx, dz);
      this.quaternion.setFromAxisAngle(this.up, heading);
      if (!driving) {
        // A gentle step bob.
        point.y += Math.abs(Math.sin(this.clock * 7 + mover.phase)) * 0.05;
      }
      this.matrix.compose(point, this.quaternion, this.scale);
      const mesh = driving ? this.vehicleMeshes.get(VEHICLE_KINDS[mover.kind])! : this.people;
      const index = counts.get(mover.kind) ?? 0;
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
    for (const mesh of [...this.vehicleMeshes.values(), ...this.boatMeshes.values(), this.people, this.wakes]) mesh.dispose();
    for (const item of this.disposables) item.dispose();
    this.group.removeFromParent();
  }
}

// ---- helpers ------------------------------------------------------------------------------

function emptyMover(): Mover {
  return { line: { points: [], laneClass: 'minor', oneway: 0, bridge: false }, seg: 0, t: 0, dir: 1, speed: 0, offset: 0, colour: new Color(), kind: 0, phase: 0, active: false };
}

function cellKey(x: number, z: number): string {
  return `${Math.floor(x / GRID)},${Math.floor(z / GRID)}`;
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/** A coloured box; white parts take the instance colour, other colours tint it. */
function block(width: number, height: number, length: number, x: number, y: number, z: number, colour: string): BufferGeometry {
  const geometry = new BoxGeometry(width, height, length).toNonIndexed();
  geometry.translate(x, y, z);
  return paint(geometry, colour);
}

function paint(geometry: BufferGeometry, colour: string): BufferGeometry {
  const target = geometry.index ? geometry.toNonIndexed() : geometry;
  const value = new Color(colour);
  const colours = new Float32Array(target.attributes.position.count * 3);
  for (let index = 0; index < target.attributes.position.count; index += 1) colours.set([value.r, value.g, value.b], index * 3);
  target.setAttribute('color', new Float32BufferAttribute(colours, 3));
  target.deleteAttribute('uv');
  return target;
}

const GLASS = '#1d2a33';
const TYRE = '#151515';
const LIGHT = '#fff3d0';
const TAIL = '#7a1010';

function wheels(length: number, width: number, radius = 0.33): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  for (const z of [length * 0.32, -length * 0.32]) {
    for (const x of [width / 2 - 0.12, -width / 2 + 0.12]) {
      const wheel = new CylinderGeometry(radius, radius, 0.24, 10).toNonIndexed();
      wheel.rotateZ(Math.PI / 2);
      wheel.translate(x, radius, z);
      parts.push(paint(wheel, TYRE));
    }
  }
  return parts;
}

/** Vehicles face +z, sit on y = 0, at real size (m). */
function vehicleGeometry(kind: VehicleKind): BufferGeometry {
  const parts: BufferGeometry[] = [];
  if (kind === 'car' || kind === 'taxiGreen' || kind === 'taxiRed') {
    const taxi = kind !== 'car';
    const length = taxi ? 4.6 : 4.5;
    // Hong Kong taxis: green with a white roof (New Territories), red with a silver roof (urban).
    const body = kind === 'taxiGreen' ? '#2f8a4c' : kind === 'taxiRed' ? '#c8312b' : '#ffffff';
    const roof = kind === 'taxiGreen' ? '#f2f2ee' : kind === 'taxiRed' ? '#c9cbcc' : '#ffffff';
    parts.push(block(1.78, 0.7, length, 0, 0.62, 0, body));
    parts.push(block(1.6, 0.58, 2.4, 0, 1.24, -0.25, roof));
    parts.push(block(1.62, 0.44, 2.3, 0, 1.25, -0.25, GLASS));
    parts.push(block(0.5, 0.12, 0.05, 0.55, 0.72, length / 2, LIGHT), block(0.5, 0.12, 0.05, -0.55, 0.72, length / 2, LIGHT));
    parts.push(block(0.4, 0.12, 0.05, 0.6, 0.72, -length / 2, TAIL), block(0.4, 0.12, 0.05, -0.6, 0.72, -length / 2, TAIL));
    if (taxi) parts.push(block(0.62, 0.16, 0.26, 0, 1.6, -0.1, '#f7f7f2'));
    parts.push(...wheels(length, 1.78));
  } else if (kind === 'minibusGreen' || kind === 'minibusRed') {
    // Public light bus: cream body with a green (fixed route) or red roof band.
    parts.push(block(2.05, 1.65, 6.9, 0, 1.3, 0, '#efe8d2'));
    parts.push(block(2.07, 0.42, 6.9, 0, 2.3, 0, kind === 'minibusGreen' ? '#2e7d4f' : '#b8312d'));
    parts.push(block(2.08, 0.62, 5.2, 0, 1.75, -0.6, GLASS));
    parts.push(block(1.9, 0.7, 0.05, 0, 1.7, 3.45, GLASS));
    parts.push(...wheels(6.9, 2.05, 0.36));
  } else if (kind === 'bus') {
    // Double-decker, generic colours (no operator livery).
    parts.push(block(2.5, 4.0, 11.8, 0, 2.25, 0, '#ffffff'));
    parts.push(block(2.52, 0.9, 10.6, 0, 1.75, -0.3, GLASS));
    parts.push(block(2.52, 0.9, 11.2, 0, 3.45, 0, GLASS));
    parts.push(block(2.3, 1.6, 0.05, 0, 2.3, 5.9, GLASS));
    parts.push(block(2.52, 0.18, 11.82, 0, 4.25, 0, '#e8e8e8'));
    parts.push(...wheels(11.8, 2.5, 0.5));
  } else if (kind === 'van') {
    parts.push(block(1.9, 1.85, 5.1, 0, 1.25, 0, '#ffffff'));
    parts.push(block(1.92, 0.6, 1.1, 0, 1.75, 1.9, GLASS));
    parts.push(...wheels(5.1, 1.9));
  } else {
    // Light lorry: cab plus a covered box.
    parts.push(block(2.2, 2.2, 1.9, 0, 1.55, 2.6, '#f2f2f2'));
    parts.push(block(2.22, 0.7, 1.0, 0, 2.05, 3.1, GLASS));
    parts.push(block(2.3, 2.6, 5.2, 0, 2.05, -1.0, '#ffffff'));
    parts.push(...wheels(7.2, 2.2, 0.48));
  }
  return mergeGeometries(parts)!;
}

/** A person about 1.65 m tall, facing +z; the shirt takes the instance colour. */
function pedestrianGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  parts.push(block(0.15, 0.82, 0.18, 0.1, 0.41, 0, '#2b2f36'), block(0.15, 0.82, 0.18, -0.1, 0.41, 0, '#2b2f36'));
  parts.push(block(0.44, 0.6, 0.24, 0, 1.12, 0, '#ffffff'));
  parts.push(block(0.1, 0.55, 0.12, 0.28, 1.1, 0, '#ffffff'), block(0.1, 0.55, 0.12, -0.28, 1.1, 0, '#ffffff'));
  const head = new SphereGeometry(0.12, 8, 6).toNonIndexed();
  head.translate(0, 1.53, 0);
  parts.push(paint(head, '#c99f80'));
  const hair = new SphereGeometry(0.125, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed();
  hair.translate(0, 1.55, -0.01);
  parts.push(paint(hair, '#1b1714'));
  return mergeGeometries(parts)!;
}

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
