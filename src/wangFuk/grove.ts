import {
  Color, SRGBColorSpace, CylinderGeometry, DynamicDrawUsage, IcosahedronGeometry, InstancedMesh, Matrix4, MeshBasicMaterial,
  Quaternion, Vector3, BufferGeometry, BufferAttribute,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BLOCK_OUTLINE, planToWorld, type BlockPose } from './plan';

export interface TreeSpot {
  x: number;
  z: number;
  /** Height of the tree in metres. */
  height: number;
  /** 0–1 picks a shade of green. */
  tint: number;
  turn: number;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise in 0–1, used to make the tree cover patchy instead of an even carpet. */
function noise(x: number, z: number, seed: number): number {
  const hash = (ix: number, iz: number): number => {
    const value = Math.sin(ix * 127.1 + iz * 311.7 + seed * 74.7) * 43758.5453;
    return value - Math.floor(value);
  };
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const top = hash(ix, iz) * (1 - sx) + hash(ix + 1, iz) * sx;
  const bottom = hash(ix, iz + 1) * (1 - sx) + hash(ix + 1, iz + 1) * sx;
  return top * (1 - sz) + bottom * sz;
}

/** Distance from a world point to a block's walls; negative inside. */
export function distanceToBlock(pose: BlockPose, x: number, z: number): number {
  const corners = BLOCK_OUTLINE.map(point => planToWorld(pose, point));
  let nearest = Infinity;
  let inside = false;
  for (let index = 0, previous = corners.length - 1; index < corners.length; previous = index, index += 1) {
    const [ax, az] = corners[previous];
    const [bx, bz] = corners[index];
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
    const edgeX = bx - ax;
    const edgeZ = bz - az;
    const along = Math.max(0, Math.min(1, ((x - ax) * edgeX + (z - az) * edgeZ) / (edgeX * edgeX + edgeZ * edgeZ)));
    nearest = Math.min(nearest, Math.hypot(x - (ax + along * edgeX), z - (az + along * edgeZ)));
  }
  return inside ? -nearest : nearest;
}

export interface ScatterOptions {
  seed?: number;
  /** Trees are scattered within this radius of the court centre (m). */
  radius?: number;
  count?: number;
  /** Clear ground kept around every tower wall (m). */
  wallClearance?: number;
  /** Minimum spacing between tree trunks (m). */
  spacing?: number;
  /** Return false for places that cannot hold a tree (water, roads). */
  allowed?: (x: number, z: number) => boolean;
}

/**
 * Shady groves around the court: patchy cover, kept off the walls so the towers
 * still read, thinner between the towers so there is open lawn to walk on.
 */
export function scatterTrees(blocks: readonly BlockPose[], options: ScatterOptions = {}): TreeSpot[] {
  if (blocks.length === 0) return [];
  const random = mulberry32(options.seed ?? 1983);
  const radius = options.radius ?? 110;
  const wanted = options.count ?? 320;
  const clearance = options.wallClearance ?? 5.5;
  const spacing = options.spacing ?? 4.6;
  const centre = {
    x: blocks.reduce((sum, block) => sum + block.x, 0) / blocks.length,
    z: blocks.reduce((sum, block) => sum + block.z, 0) / blocks.length,
  };
  const cells = new Map<string, TreeSpot[]>();
  const cellKey = (x: number, z: number): string => `${Math.floor(x / spacing)},${Math.floor(z / spacing)}`;
  const spots: TreeSpot[] = [];
  for (let attempt = 0; attempt < wanted * 14 && spots.length < wanted; attempt += 1) {
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * radius;
    const x = centre.x + Math.cos(angle) * distance;
    const z = centre.z + Math.sin(angle) * distance;
    if (blocks.some(block => distanceToBlock(block, x, z) < clearance)) continue;
    if (options.allowed && !options.allowed(x, z)) continue;
    // Patchy cover; the middle of the estate keeps more open ground.
    const density = noise(x / 22, z / 22, 7) * 0.8 + noise(x / 7, z / 7, 3) * 0.2;
    const open = Math.max(0, 1 - Math.hypot(x - centre.x, z - centre.z) / 55) * 0.35;
    if (random() > density - open + 0.05) continue;
    const gx = Math.floor(x / spacing);
    const gz = Math.floor(z / spacing);
    let crowded = false;
    for (let dx = -1; dx <= 1 && !crowded; dx += 1) {
      for (let dz = -1; dz <= 1 && !crowded; dz += 1) {
        for (const other of cells.get(`${gx + dx},${gz + dz}`) ?? []) {
          if (Math.hypot(other.x - x, other.z - z) < spacing * (0.7 + 0.3 * random())) crowded = true;
        }
      }
    }
    if (crowded) continue;
    const spot: TreeSpot = { x, z, height: 6 + random() * random() * 11 + random() * 3, tint: random(), turn: random() * Math.PI * 2 };
    spots.push(spot);
    const key = cellKey(x, z);
    cells.set(key, [...(cells.get(key) ?? []), spot]);
  }
  return spots;
}

/** One low-poly broadleaf tree (trunk + three lumpy crowns) with baked top-light vertex colours, 1 m tall. */
export function buildTreeGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const paint = (geometry: BufferGeometry, bottom: Color, top: Color, lowest: number, highest: number): BufferGeometry => {
    const piece = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    const position = piece.getAttribute('position');
    const colours = new Float32Array(position.count * 3);
    const mixed = new Color();
    for (let index = 0; index < position.count; index += 1) {
      const t = (position.getY(index) - lowest) / Math.max(1e-6, highest - lowest);
      mixed.copy(bottom).lerp(top, Math.min(1, Math.max(0, t)));
      colours.set([mixed.r, mixed.g, mixed.b], index * 3);
    }
    piece.setAttribute('color', new BufferAttribute(colours, 3));
    return piece;
  };
  const trunk = new CylinderGeometry(0.045, 0.07, 0.42, 6);
  trunk.translate(0, 0.21, 0);
  parts.push(paint(trunk, new Color().setRGB(0.22, 0.15, 0.1, SRGBColorSpace), new Color().setRGB(0.3, 0.21, 0.14, SRGBColorSpace), 0, 0.42));
  const crowns: Array<[number, number, number, number, number]> = [
    [0, 0.62, 0, 0.3, 0.26], [0.13, 0.5, 0.05, 0.22, 0.2], [-0.12, 0.78, -0.06, 0.22, 0.2],
  ];
  for (const [x, y, z, rx, ry] of crowns) {
    const crown = new IcosahedronGeometry(1, 1);
    crown.scale(rx, ry, rx);
    crown.translate(x, y, z);
    parts.push(paint(crown, new Color().setRGB(0.24, 0.38, 0.14, SRGBColorSpace), new Color().setRGB(0.66, 0.8, 0.36, SRGBColorSpace), y - ry, y + ry));
  }
  const merged = mergeGeometries(parts, false) ?? new BufferGeometry();
  parts.forEach(part => part.dispose());
  return merged;
}

const GREENS = [new Color().setRGB(0.40, 0.62, 0.30, SRGBColorSpace), new Color().setRGB(0.28, 0.50, 0.26, SRGBColorSpace), new Color().setRGB(0.50, 0.66, 0.28, SRGBColorSpace), new Color().setRGB(0.24, 0.44, 0.27, SRGBColorSpace)];

/**
 * Instanced trees. Heights are filled in a little each frame from `groundAt`
 * so measuring the ground never stalls rendering.
 */
export class Grove {
  public readonly mesh: InstancedMesh;
  private readonly pending: TreeSpot[] = [];
  private readonly geometry = buildTreeGeometry();
  private readonly material = new MeshBasicMaterial({ vertexColors: true });
  private readonly matrix = new Matrix4();
  private readonly rotation = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);
  private readonly colour = new Color();
  private placed = 0;

  public constructor(public readonly capacity = 400) {
    this.mesh = new InstancedMesh(this.geometry, this.material, capacity);
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'wang-fuk-grove';
    this.mesh.visible = false;
  }

  public add(spots: readonly TreeSpot[]): void {
    this.pending.push(...spots.slice(0, Math.max(0, this.capacity - this.placed - this.pending.length)));
  }

  public get size(): number {
    return this.placed;
  }

  public get waiting(): number {
    return this.pending.length;
  }

  /** Stand up to `budget` waiting trees on the ground. Returns how many were placed. */
  public update(groundAt: (x: number, z: number) => number | null, budget = 12): number {
    let done = 0;
    while (this.pending.length > 0 && done < budget) {
      const spot = this.pending.shift()!;
      const ground = groundAt(spot.x, spot.z);
      if (ground === null) continue;
      this.rotation.setFromAxisAngle(this.up, spot.turn);
      const width = spot.height * (0.9 + spot.tint * 0.35);
      this.matrix.compose(new Vector3(spot.x, ground - 0.2, spot.z), this.rotation, new Vector3(width, spot.height, width));
      this.mesh.setMatrixAt(this.placed, this.matrix);
      this.colour.copy(GREENS[Math.floor(spot.tint * GREENS.length) % GREENS.length]).multiplyScalar(0.92 + spot.tint * 0.12);
      this.mesh.setColorAt(this.placed, this.colour);
      this.placed += 1;
      done += 1;
    }
    if (done > 0) {
      this.mesh.count = this.placed;
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
    return done;
  }

  public setVisible(visible: boolean): void {
    this.mesh.visible = visible && this.placed > 0;
  }

  public dispose(): void {
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
