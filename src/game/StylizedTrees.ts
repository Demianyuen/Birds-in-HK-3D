import {
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { LandUse } from './AerialImageryGround';

export interface TreeTerrain {
  landUseAt(worldX: number, worldZ: number): LandUse | null;
  getElevationAtWorld(worldX: number, worldZ: number): number;
}

export interface TreePlacementOptions {
  radiusMetres: number;
  spacingMetres: number;
  maximumTrees: number;
  chunkMetres: number;
}

const DEFAULT_OPTIONS: TreePlacementOptions = {
  radiusMetres: 3_200,
  spacingMetres: 13,
  maximumTrees: 28_000,
  chunkMetres: 800,
};

/** Low-poly instanced woodland on hillsides and parks. Scenery only: not used for collision. */
export class StylizedTrees {
  public readonly group = new Group();
  private readonly geometries: BufferGeometry[] = [];
  private readonly material = new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.92,
    metalness: 0,
  });
  public count = 0;

  public constructor() {
    this.group.name = 'Stylised woodland';
    this.geometries.push(createBroadleafGeometry(), createConiferGeometry());
  }

  public build(terrain: TreeTerrain, options: Partial<TreePlacementOptions> = {}): number {
    this.clear();
    const settings = { ...DEFAULT_OPTIONS, ...options };
    const chunks = new Map<string, Matrix4[][]>();
    const colours = new Map<string, Color[][]>();
    const matrix = new Matrix4();
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    const up = new Vector3(0, 1, 0);
    const radiusSquared = settings.radiusMetres ** 2;
    let placed = 0;

    // Pass 1: score every grid candidate. Collecting first (rather than stopping at
    // the budget) keeps the woodland evenly spread instead of filling the first rows.
    const candidates: number[] = [];
    for (let gz = -settings.radiusMetres; gz <= settings.radiusMetres; gz += settings.spacingMetres) {
      for (let gx = -settings.radiusMetres; gx <= settings.radiusMetres; gx += settings.spacingMetres) {
        const jitterA = hash(gx, gz);
        const jitterB = hash(gz + 17.3, gx - 4.1);
        const x = gx + (jitterA - 0.5) * settings.spacingMetres * 0.9;
        const z = gz + (jitterB - 0.5) * settings.spacingMetres * 0.9;
        if (x * x + z * z > radiusSquared) continue;
        const use = terrain.landUseAt(x, z);
        if (use === null || use === 'road' || use === 'water' || use === 'sand') continue;
        const elevation = terrain.getElevationAtWorld(x, z);
        if (elevation > 520 || elevation < 0.5) continue;
        const slope = Math.abs(terrain.getElevationAtWorld(x + 6, z) - elevation) / 6
          + Math.abs(terrain.getElevationAtWorld(x, z + 6) - elevation) / 6;
        const hillside = elevation > 16 || slope > 0.16;
        const cluster = valueNoise(x * 0.012, z * 0.012);
        const probability = treeProbability(use, hillside, cluster);
        if (probability <= 0 || hash(x * 0.37, z * 0.91) > probability) continue;
        // Keep canopies off streets, shorelines and beaches.
        if (blocksTrees(terrain.landUseAt(x + 4, z)) || blocksTrees(terrain.landUseAt(x - 4, z))
          || blocksTrees(terrain.landUseAt(x, z + 4)) || blocksTrees(terrain.landUseAt(x, z - 4))) continue;
        candidates.push(x, z, elevation);
      }
    }

    // Pass 2: thin evenly to the budget.
    const candidateCount = candidates.length / 3;
    const keepRatio = Math.min(1, settings.maximumTrees / Math.max(1, candidateCount));
    for (let index = 0; index < candidateCount; index += 1) {
      const x = candidates[index * 3];
      const z = candidates[index * 3 + 1];
      const elevation = candidates[index * 3 + 2];
      if (keepRatio < 1 && hash(x * 1.91, z * 0.53) > keepRatio) continue;
      if (placed >= settings.maximumTrees) break;

      const variant = elevation > 230 || hash(x, z * 1.7) > 0.82 ? 1 : 0;
      const size = 0.75 + hash(z * 2.1, x) * 0.6;
      position.set(x, elevation - 0.4, z);
      rotation.setFromAxisAngle(up, hash(x * 3.1, z * 0.7) * Math.PI * 2);
      scale.set(size, size * (0.85 + hash(x, z * 3.3) * 0.35), size);
      matrix.compose(position, rotation, scale);

      const key = `${Math.floor(x / settings.chunkMetres)}/${Math.floor(z / settings.chunkMetres)}`;
      let chunk = chunks.get(key);
      let chunkColours = colours.get(key);
      if (!chunk || !chunkColours) {
        chunk = [[], []];
        chunkColours = [[], []];
        chunks.set(key, chunk);
        colours.set(key, chunkColours);
      }
      chunk[variant].push(matrix.clone());
      const tint = 0.82 + hash(x * 1.3, z * 2.9) * 0.3;
      const warm = hash(x * 0.21, z * 0.17) > 0.9 ? 0.12 : 0;
      chunkColours[variant].push(new Color(tint + warm, tint, tint * (1 - warm)));
      placed++;
    }

    for (const [key, chunk] of chunks) {
      const chunkColours = colours.get(key)!;
      chunk.forEach((matrices, variant) => {
        if (matrices.length === 0) return;
        const mesh = new InstancedMesh(this.geometries[variant], this.material, matrices.length);
        matrices.forEach((value, index) => {
          mesh.setMatrixAt(index, value);
          mesh.setColorAt(index, chunkColours[variant][index]);
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.name = `Trees ${key} ${variant === 0 ? 'broadleaf' : 'conifer'}`;
        this.group.add(mesh);
      });
    }
    this.count = placed;
    return placed;
  }

  public clear(): void {
    for (const child of [...this.group.children]) {
      if (child instanceof InstancedMesh) child.dispose();
    }
    this.group.clear();
    this.count = 0;
  }

  public dispose(): void {
    this.clear();
    for (const geometry of this.geometries) geometry.dispose();
    this.material.dispose();
  }
}

function paint(geometry: BufferGeometry, colour: Color, variation = 0): BufferGeometry {
  const target = geometry.index ? geometry.toNonIndexed() : geometry;
  const count = target.attributes.position.count;
  const colours = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 3) {
    const shade = 1 - variation * 0.5 + hash(index, count) * variation;
    for (let corner = 0; corner < 3 && index + corner < count; corner++) {
      colours.set([colour.r * shade, colour.g * shade, colour.b * shade], (index + corner) * 3);
    }
  }
  target.setAttribute('color', new Float32BufferAttribute(colours, 3));
  target.deleteAttribute('uv');
  return target;
}

function createBroadleafGeometry(): BufferGeometry {
  const trunk = new CylinderGeometry(0.28, 0.42, 3.2, 5);
  trunk.translate(0, 1.6, 0);
  const canopy = new IcosahedronGeometry(3.1, 0);
  canopy.scale(1, 0.86, 1);
  canopy.translate(0, 5.4, 0);
  const crown = new IcosahedronGeometry(1.9, 0);
  crown.translate(0.9, 7.1, -0.4);
  return mergeGeometries([
    paint(trunk, new Color('#6b4a33')),
    paint(canopy, new Color('#3f7d34'), 0.22),
    paint(crown, new Color('#4f9140'), 0.2),
  ])!;
}

function createConiferGeometry(): BufferGeometry {
  const trunk = new CylinderGeometry(0.22, 0.32, 2.4, 5);
  trunk.translate(0, 1.2, 0);
  const lower = new ConeGeometry(2.6, 5.2, 7);
  lower.translate(0, 4.2, 0);
  const upper = new ConeGeometry(1.8, 4.0, 7);
  upper.translate(0, 7.0, 0);
  return mergeGeometries([
    paint(trunk, new Color('#5e4430')),
    paint(lower, new Color('#2f6a37'), 0.2),
    paint(upper, new Color('#3a7a3f'), 0.2),
  ])!;
}

/** Chance that a grid candidate grows a tree, by land use. Exported for tests. */
export function treeProbability(use: LandUse, hillside: boolean, cluster: number): number {
  switch (use) {
    case 'woodland': return 0.86;
    case 'green': return hillside ? 0.7 : 0.24;
    case 'land': return hillside ? 0.58 + cluster * 0.3 : 0.04;
    case 'footprint': return 0.035;
    default: return 0;
  }
}

function blocksTrees(use: LandUse | null): boolean {
  return use === 'road' || use === 'water' || use === 'sand';
}

function hash(x: number, y: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43_758.5453;
  return value - Math.floor(value);
}

function valueNoise(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = (x - x0) ** 2 * (3 - 2 * (x - x0));
  const ty = (y - y0) ** 2 * (3 - 2 * (y - y0));
  const top = hash(x0, y0) + (hash(x0 + 1, y0) - hash(x0, y0)) * tx;
  const bottom = hash(x0, y0 + 1) + (hash(x0 + 1, y0 + 1) - hash(x0, y0 + 1)) * tx;
  return top + (bottom - top) * ty;
}
