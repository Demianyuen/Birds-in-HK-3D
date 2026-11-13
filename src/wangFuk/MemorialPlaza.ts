import {
  BoxGeometry, BufferGeometry, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial,
  Raycaster, RingGeometry, Shape, ShapeGeometry, SphereGeometry, Vector3, type Material, type Object3D,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MEMORIAL_PLAZA } from '../openWorld/contentRules';
import { BLOCK_RADIUS } from './plan';

export interface GroundPoint {
  x: number;
  z: number;
}

/** The estate grounds reach this far past the outermost tower centres (about 8 m past the walls). */
export const ESTATE_MARGIN = BLOCK_RADIUS + 8;
const PATH_WIDTH = 3.2;
const HEDGE_RADIUS = MEMORIAL_PLAZA.radius - 1.6;
const BENCH_RADIUS = 11.5;
const LAMP_RADIUS = MEMORIAL_PLAZA.radius - 3.4;
/** The darker stone ring at the middle of the square, where flowers gather. */
export const FLOWER_RING = { inner: 4.2, outer: 5 };

/**
 * The grounds of Wang Fuk Court, level and calm, so visitors have somewhere to
 * stand together: lawns between the towers, stone paths from each tower to a
 * small memorial square, and in the square benches, low hedges, lamps and a
 * ring of darker stone where the flowers gather.
 *
 * The aerial photo mesh between tall towers is a lumpy, sloping mass (the survey
 * cannot see down there), so inside the grounds it is cut away above this level.
 */
export class MemorialPlaza {
  public readonly group = new Group();
  private readonly outline: GroundPoint[];
  private readonly spokes: Array<{ from: GroundPoint; to: GroundPoint }>;
  private readonly materials: Material[] = [];
  private readonly plinths = new Group();
  private readonly raycaster = new Raycaster();
  private readonly stone: MeshStandardMaterial;
  private measuredY: number | null = null;
  private towerY: number | null = null;
  private wanted = false;

  /** `towers`: the tower centres (local metres). Without them only the square is built. */
  public constructor(towers: readonly GroundPoint[] = []) {
    this.group.name = 'Wang Fuk Court grounds';
    this.group.visible = false;
    this.outline = towers.length >= 3 ? estateOutline([...towers, MEMORIAL_PLAZA], ESTATE_MARGIN) : circleOutline(MEMORIAL_PLAZA, MEMORIAL_PLAZA.radius + 4);
    this.spokes = towers.map(tower => spoke(tower));

    const lawn = groundMaterial('#6f8658', 0.1, 0);
    const paving = groundMaterial('#ffffff', 0.05, 1.1, true);
    this.stone = new MeshStandardMaterial({ color: '#a39d92', roughness: 0.95, flatShading: true });
    const hedge = new MeshStandardMaterial({ color: '#4f7243', roughness: 1, flatShading: true });
    const wood = new MeshStandardMaterial({ color: '#7d5f44', roughness: 0.85 });
    const metal = new MeshStandardMaterial({ color: '#2f3336', roughness: 0.6, metalness: 0.4 });
    const glow = new MeshStandardMaterial({ color: '#fff4dc', emissive: '#ffd79a', emissiveIntensity: 0.9 });
    this.materials.push(lawn, paving, this.stone, hedge, wood, metal, glow);

    this.add(lawnGeometry(this.outline), lawn, 'lawn');
    this.add(pathGeometry(this.spokes), paving, 'paths');
    this.add(plazaGeometry(MEMORIAL_PLAZA.radius), paving, 'square');
    const furniture = furnitureGeometry(this.spokes);
    this.add(furniture.hedges, hedge, 'hedges');
    this.add(furniture.stone, this.stone, 'benches');
    this.add(furniture.seats, wood, 'seats');
    this.add(furniture.poles, metal, 'lamp posts');
    this.add(furniture.lamps, glow, 'lamps', false);
    this.plinths.name = 'tower plinths';
    this.group.add(this.plinths);
  }

  /** Height of the grounds, once known (null until measured). */
  public get level(): number | null {
    return this.towerY ?? this.measuredY;
  }

  /** The edge of the grounds (convex, for cutting the photo mesh). */
  public get boundary(): readonly GroundPoint[] {
    return this.outline;
  }

  /**
   * Measures the ground around the square in the photo mesh (the lowest of rays
   * fired down around it, kept only if near the terrain estimate).
   */
  public measure(roots: readonly Object3D[], terrain: number): boolean {
    if (this.measuredY !== null || roots.length === 0) return false;
    const heights: number[] = [];
    const down = new Vector3(0, -1, 0);
    for (const reach of [MEMORIAL_PLAZA.radius + 6, MEMORIAL_PLAZA.radius * 0.5]) {
      for (let step = 0; step < 16; step += 1) {
        const angle = (step / 16) * Math.PI * 2;
        this.raycaster.set(new Vector3(MEMORIAL_PLAZA.x + Math.cos(angle) * reach, terrain + 160, MEMORIAL_PLAZA.z + Math.sin(angle) * reach), down);
        this.raycaster.near = 0;
        this.raycaster.far = 400;
        const hit = this.raycaster.intersectObjects(roots as Object3D[], true)[0];
        if (hit) heights.push(hit.point.y);
      }
    }
    this.measuredY = plazaLevel(heights, terrain);
    this.place();
    return true;
  }

  /** Tower bases as measured (more reliable than rays between towers). Also raises a stone plinth under each. */
  public setTowers(towers: ReadonlyArray<GroundPoint & { yaw: number; baseY: number }>): void {
    if (towers.length === 0) return;
    const sorted = towers.map(tower => tower.baseY).sort((a, b) => a - b);
    this.towerY = sorted[Math.floor(sorted.length / 2)];
    for (const child of [...this.plinths.children]) {
      (child as Mesh).geometry.dispose();
      this.plinths.remove(child);
    }
    const level = this.towerY;
    const geometry = mergeGeometries(towers.map(tower => plinthGeometry(tower, tower.baseY - level)));
    if (geometry) this.plinths.add(new Mesh(geometry, this.stone));
    this.place();
  }

  /** Back-compatible: tower ground levels only. */
  public setTowerBases(bases: readonly number[]): void {
    if (bases.length === 0) return;
    const sorted = [...bases].sort((a, b) => a - b);
    this.towerY = sorted[Math.floor(sorted.length / 2)];
    this.place();
  }

  public setVisible(visible: boolean): void {
    this.wanted = visible;
    this.group.visible = visible && this.level !== null;
  }

  /** The photo mesh is hidden above the grounds inside the square's circle. */
  public cutout(): { x: number; z: number; radius: number; minY: number } | null {
    const level = this.level;
    return level === null ? null : { x: MEMORIAL_PLAZA.x, z: MEMORIAL_PLAZA.z, radius: MEMORIAL_PLAZA.radius + 1, minY: level + 0.2 };
  }

  /** The photo mesh is hidden above the grounds inside the whole outline. */
  public groundsCut(): { outline: readonly GroundPoint[]; minY: number } | null {
    const level = this.level;
    return level === null ? null : { outline: this.outline, minY: level + 0.15 };
  }

  /** Height of the grounds here, or null outside them (or before they are measured). */
  public surfaceAt(x: number, z: number): number | null {
    const level = this.level;
    return level !== null && insideConvex(x, z, this.outline) ? level : null;
  }

  /** Paths, the square and the plinths are kept free of trees. */
  public keepClear(x: number, z: number): boolean {
    if (Math.hypot(x - MEMORIAL_PLAZA.x, z - MEMORIAL_PLAZA.z) < MEMORIAL_PLAZA.radius + 3) return true;
    return this.spokes.some(({ from, to }) => distanceToSegment(x, z, from, to) < PATH_WIDTH / 2 + 1.8);
  }

  public dispose(): void {
    this.group.traverse(object => {
      if ((object as Mesh).isMesh) (object as Mesh).geometry.dispose();
    });
    for (const material of this.materials) material.dispose();
  }

  private add(geometry: BufferGeometry | null, material: Material, name: string, shadows = true): void {
    if (!geometry) return;
    const mesh = new Mesh(geometry, material);
    mesh.name = name;
    mesh.receiveShadow = shadows;
    mesh.castShadow = shadows && name !== 'lawn' && name !== 'paths' && name !== 'square';
    this.group.add(mesh);
  }

  private place(): void {
    const level = this.level;
    if (level === null) return;
    this.group.position.set(0, level, 0);
    this.group.updateMatrixWorld(true);
    this.group.visible = this.wanted;
  }
}

/** Where the grounds go: the lowest believable ground (lumps and canopy sit higher); the terrain estimate if none. */
export function plazaLevel(heights: readonly number[], terrain: number): number {
  const believable = heights.filter(height => Math.abs(height - terrain) < 14);
  return believable.length >= 4 ? Math.min(...believable) : terrain;
}

/** Convex hull of the points, grown by `margin` with rounded corners. Counter-clockwise in (x, z): inside is to the left of each edge. */
export function estateOutline(points: readonly GroundPoint[], margin: number): GroundPoint[] {
  const hull = convexHull(points);
  const grown: GroundPoint[] = [];
  for (let index = 0; index < hull.length; index += 1) {
    const previous = hull[(index + hull.length - 1) % hull.length];
    const point = hull[index];
    const next = hull[(index + 1) % hull.length];
    // Outward normals of the two edges meeting here; sweep an arc between them.
    const a = Math.atan2(-(point.x - previous.x), point.z - previous.z);
    let b = Math.atan2(-(next.x - point.x), next.z - point.z);
    while (b < a) b += Math.PI * 2;
    const steps = Math.max(1, Math.ceil((b - a) / (Math.PI / 8)));
    for (let step = 0; step <= steps; step += 1) {
      const angle = a + ((b - a) * step) / steps;
      grown.push({ x: point.x + Math.cos(angle) * margin, z: point.z + Math.sin(angle) * margin });
    }
  }
  return grown;
}

function circleOutline(centre: GroundPoint, radius: number): GroundPoint[] {
  return Array.from({ length: 24 }, (_, index) => {
    const angle = (index / 24) * Math.PI * 2;
    return { x: centre.x + Math.cos(angle) * radius, z: centre.z + Math.sin(angle) * radius };
  });
}

/** Andrew's monotone chain; counter-clockwise in (x, z) with z as the second axis. */
function convexHull(points: readonly GroundPoint[]): GroundPoint[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  const cross = (o: GroundPoint, a: GroundPoint, b: GroundPoint): number => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower: GroundPoint[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: GroundPoint[] = [];
  for (const point of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Inside a convex outline made by `estateOutline` (counter-clockwise in x, z). */
export function insideConvex(x: number, z: number, outline: readonly GroundPoint[]): boolean {
  if (outline.length < 3) return false;
  for (let index = 0; index < outline.length; index += 1) {
    const a = outline[index];
    const b = outline[(index + 1) % outline.length];
    if ((b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x) < 0) return false;
  }
  return true;
}

function distanceToSegment(x: number, z: number, a: GroundPoint, b: GroundPoint): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / Math.max(1e-6, dx * dx + dz * dz)));
  return Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
}

/** A path from the square's edge to the edge of a tower's plinth. */
function spoke(tower: GroundPoint): { from: GroundPoint; to: GroundPoint } {
  const dx = tower.x - MEMORIAL_PLAZA.x;
  const dz = tower.z - MEMORIAL_PLAZA.z;
  const length = Math.hypot(dx, dz) || 1;
  const ux = dx / length;
  const uz = dz / length;
  const start = MEMORIAL_PLAZA.radius - 0.5;
  const end = Math.max(start + 1, length - BLOCK_RADIUS - 1);
  return {
    from: { x: MEMORIAL_PLAZA.x + ux * start, z: MEMORIAL_PLAZA.z + uz * start },
    to: { x: MEMORIAL_PLAZA.x + ux * end, z: MEMORIAL_PLAZA.z + uz * end },
  };
}

/**
 * Ground materials with a little life drawn in the shader (no textures to load):
 * soft patches of light and shade, and for paving the joints between slabs.
 */
function groundMaterial(colour: string, mottle: number, slab: number, vertexColors = false): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: colour, vertexColors, roughness: 0.96, metalness: 0, side: DoubleSide });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGroundXZ;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGroundXZ;')
      .replace('#include <color_fragment>', `#include <color_fragment>
  {
    vec2 p = vGroundXZ;
    float n = sin(p.x * 0.31 + sin(p.y * 0.17) * 2.0) * sin(p.y * 0.27 + sin(p.x * 0.13) * 2.0);
    float fine = fract(sin(dot(floor(p * 1.7), vec2(12.9898, 78.233))) * 43758.5453);
    diffuseColor.rgb *= 1.0 + ${mottle.toFixed(3)} * n + ${(mottle * 0.5).toFixed(3)} * (fine - 0.5);
    ${slab > 0 ? `vec2 g = abs(fract(p / ${slab.toFixed(2)}) - 0.5);
    float joint = smoothstep(0.47, 0.5, max(g.x, g.y));
    diffuseColor.rgb *= 1.0 - 0.18 * joint;` : ''}
  }`);
  };
  material.customProgramCacheKey = () => `wang-fuk-ground-${mottle}-${slab}-${vertexColors}`;
  return material;
}

function colour(geometry: BufferGeometry, hex: string): BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  const value = new Color(hex);
  const count = flat.attributes.position.count;
  const values = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) values.set([value.r, value.g, value.b], index * 3);
  flat.setAttribute('color', new Float32BufferAttribute(values, 3));
  return flat;
}

function strip(geometry: BufferGeometry): BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  flat.deleteAttribute('uv');
  if (!flat.getAttribute('normal')) flat.computeVertexNormals();
  return flat;
}

/** Lawn over the whole outline, with a kerb that drops into the ground all round. */
function lawnGeometry(outline: readonly GroundPoint[]): BufferGeometry {
  const shape = new Shape(outline.map(point => ({ x: point.x, y: -point.z }) as never));
  const top = new ShapeGeometry(shape);
  top.rotateX(-Math.PI / 2);
  const positions: number[] = [];
  for (let index = 0; index < outline.length; index += 1) {
    const a = outline[index];
    const b = outline[(index + 1) % outline.length];
    positions.push(a.x, 0, a.z, b.x, -2.5, b.z, b.x, 0, b.z, a.x, 0, a.z, a.x, -2.5, a.z, b.x, -2.5, b.z);
  }
  const kerb = new BufferGeometry();
  kerb.setAttribute('position', new Float32BufferAttribute(positions, 3));
  kerb.computeVertexNormals();
  return mergeGeometries([strip(top), strip(kerb)])!;
}

function pathGeometry(spokes: ReadonlyArray<{ from: GroundPoint; to: GroundPoint }>): BufferGeometry | null {
  const parts = spokes.map(({ from, to }) => {
    const length = Math.hypot(to.x - from.x, to.z - from.z);
    const path = new BoxGeometry(PATH_WIDTH, 0.06, length);
    path.rotateY(Math.atan2(to.x - from.x, to.z - from.z));
    path.translate((from.x + to.x) / 2, 0.03, (from.z + to.z) / 2);
    return colour(strip(path), '#bdb6aa');
  });
  return parts.length > 0 ? mergeGeometries(parts) : null;
}

/**
 * The square's paving, centred on the square: pale stone in rings, the darker
 * flower ring at the middle and a darker border, raised a step above the lawn.
 */
export function plazaGeometry(radius: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const top = 0.12;
  const bands: Array<[number, number, string]> = [
    [0, FLOWER_RING.inner, '#d3cec4'],
    [FLOWER_RING.inner, FLOWER_RING.outer, '#8d877d'],
    [FLOWER_RING.outer, radius * 0.55, '#cdc7bc'],
    [radius * 0.55, radius - 1.2, '#d1cbc0'],
    [radius - 1.2, radius, '#958f86'],
  ];
  for (const [inner, outer, hex] of bands) {
    const ring = new RingGeometry(inner, outer, 64, 1);
    ring.rotateX(-Math.PI / 2);
    ring.translate(0, top, 0);
    parts.push(colour(strip(ring), hex));
  }
  const edge = new CylinderGeometry(radius, radius, top + 0.4, 64, 1, true);
  edge.translate(0, (top - 0.4) / 2, 0);
  parts.push(colour(strip(edge), '#8a847b'));
  const geometry = mergeGeometries(parts)!;
  geometry.translate(MEMORIAL_PLAZA.x, 0, MEMORIAL_PLAZA.z);
  return geometry;
}

/** Hedges with openings where the paths come in, plain stone benches facing the middle, and lamps. */
function furnitureGeometry(spokes: ReadonlyArray<{ from: GroundPoint; to: GroundPoint }>): {
  hedges: BufferGeometry | null; stone: BufferGeometry | null; seats: BufferGeometry | null; poles: BufferGeometry | null; lamps: BufferGeometry | null;
} {
  const openings = spokes.map(({ from }) => Math.atan2(from.z - MEMORIAL_PLAZA.z, from.x - MEMORIAL_PLAZA.x));
  if (openings.length === 0) openings.push(Math.PI / 2, -Math.PI / 2);
  const near = (angle: number, radius: number, clearance: number): boolean => openings.some(opening => {
    const gap = Math.abs(Math.atan2(Math.sin(angle - opening), Math.cos(angle - opening)));
    return gap * radius < clearance;
  });
  const at = (geometry: BufferGeometry, angle: number, radius: number, y: number): BufferGeometry => {
    // Long side along the circle.
    geometry.rotateY(-angle + Math.PI / 2);
    geometry.translate(MEMORIAL_PLAZA.x + Math.cos(angle) * radius, y, MEMORIAL_PLAZA.z + Math.sin(angle) * radius);
    return strip(geometry);
  };

  const hedges: BufferGeometry[] = [];
  const segment = 1.5;
  const count = Math.round((2 * Math.PI * HEDGE_RADIUS) / segment);
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    if (near(angle, HEDGE_RADIUS, PATH_WIDTH / 2 + 1.4)) continue;
    const height = 0.75 + 0.08 * Math.sin(index * 2.3);
    hedges.push(at(new BoxGeometry(segment + 0.05, height, 0.9), angle, HEDGE_RADIUS, 0.12 + height / 2));
  }

  const stone: BufferGeometry[] = [];
  const seats: BufferGeometry[] = [];
  let benches = 0;
  for (let index = 0; index < 16 && benches < 8; index += 1) {
    const angle = (index / 16) * Math.PI * 2 + Math.PI / 16;
    if (near(angle, BENCH_RADIUS, PATH_WIDTH / 2 + 2)) continue;
    benches += 1;
    for (const offset of [-0.7, 0.7]) {
      const leg = new BoxGeometry(0.16, 0.4, 0.42);
      leg.translate(offset, 0, 0);
      stone.push(at(leg, angle, BENCH_RADIUS, 0.12 + 0.2));
    }
    seats.push(at(new BoxGeometry(1.9, 0.07, 0.5), angle, BENCH_RADIUS, 0.12 + 0.435));
  }

  const poles: BufferGeometry[] = [];
  const lamps: BufferGeometry[] = [];
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2;
    if (near(angle, LAMP_RADIUS, PATH_WIDTH / 2 + 0.8)) continue;
    const x = MEMORIAL_PLAZA.x + Math.cos(angle) * LAMP_RADIUS;
    const z = MEMORIAL_PLAZA.z + Math.sin(angle) * LAMP_RADIUS;
    const pole = new CylinderGeometry(0.06, 0.08, 3.1, 6);
    pole.translate(x, 0.12 + 1.55, z);
    poles.push(strip(pole));
    const cap = new CylinderGeometry(0.2, 0.12, 0.08, 8);
    cap.translate(x, 0.12 + 3.32, z);
    poles.push(strip(cap));
    const lamp = new SphereGeometry(0.16, 10, 6);
    lamp.translate(x, 0.12 + 3.16, z);
    lamps.push(strip(lamp));
  }
  const merge = (parts: BufferGeometry[]): BufferGeometry | null => (parts.length > 0 ? mergeGeometries(parts) : null);
  return { hedges: merge(hedges), stone: merge(stone), seats: merge(seats), poles: merge(poles), lamps: merge(lamps) };
}

/** A low octagonal stone plinth under a tower, tall enough to meet its base. */
function plinthGeometry(tower: GroundPoint & { yaw: number }, baseAbove: number): BufferGeometry {
  const height = Math.max(0.4, baseAbove + 0.3);
  const plinth = new CylinderGeometry(BLOCK_RADIUS + 1.2, BLOCK_RADIUS + 1.5, height + 1, 8);
  plinth.rotateY(tower.yaw + Math.PI / 8);
  plinth.translate(tower.x, height - (height + 1) / 2, tower.z);
  return strip(plinth);
}
