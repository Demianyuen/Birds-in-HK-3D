import {
  BufferAttribute, BufferGeometry, BoxGeometry, Color, SRGBColorSpace, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial,
  ShapeUtils, Vector2, Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BLOCK_OUTLINE, BLOCK_RADIUS, STOREYS, type BlockPose } from './plan';

/** Height of the brown-red lift motor room on the roof (m). */
export const ROOF_CAP_HEIGHT = 4.2;

/**
 * The tower body: the cruciform plan extruded to `height`, walls with outward
 * normals and a flat roof. `recess` marks the short walls inside the re-entrant
 * corners next to the core, which are the dark stair/lift shafts seen in photos.
 */
export function buildBlockGeometry(height: number): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const recess: number[] = [];
  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number, shaft: number): void => {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    recess.push(shaft);
  };
  for (let index = 0; index < BLOCK_OUTLINE.length; index += 1) {
    const [ax, az] = BLOCK_OUTLINE[index];
    const [bx, bz] = BLOCK_OUTLINE[(index + 1) % BLOCK_OUTLINE.length];
    const length = Math.hypot(bx - ax, bz - az);
    let nx = bz - az;
    let nz = -(bx - ax);
    // Outward = away from the plan centre.
    if (nx * (ax + bx) + nz * (az + bz) < 0) { nx = -nx; nz = -nz; }
    const scale = 1 / Math.hypot(nx, nz);
    nx *= scale; nz *= scale;
    const shaft = length < 3 ? 1 : 0;
    const corners: Array<[number, number, number]> = [[ax, 0, az], [bx, 0, bz], [bx, height, bz], [ax, height, az]];
    // Wind so the face normal matches the outward normal.
    const order = ((bx - ax) * nz - (bz - az) * nx) > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    for (const corner of order) {
      const [x, y, z] = corners[corner];
      push(x, y, z, nx, 0, nz, shaft);
    }
  }
  // Roof.
  const contour = BLOCK_OUTLINE.map(([x, z]) => new Vector2(x, z));
  const triangles = ShapeUtils.triangulateShape(contour, []);
  for (const triangle of triangles) {
    // Face up: check the winding of the triangle in the x/z plane.
    const [a, b, c] = triangle.map(i => contour[i]);
    const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const order = area < 0 ? [a, b, c] : [a, c, b];
    for (const p of order) push(p.x, height, p.y, 0, 1, 0, 0);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('aRecess', new Float32BufferAttribute(recess, 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

/** Brown-red lift motor room with a small grey service box on top, baked-shaded vertex colours. */
export function buildRoofCaps(height: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const addBox = (width: number, boxHeight: number, depth: number, y: number, colour: Color): void => {
    const box = new BoxGeometry(width, boxHeight, depth).toNonIndexed();
    box.translate(0, y + boxHeight / 2, 0);
    const normal = box.getAttribute('normal');
    const colours = new Float32Array(normal.count * 3);
    for (let index = 0; index < normal.count; index += 1) {
      const up = normal.getY(index);
      const shade = up > 0.5 ? 1.05 : 0.78 + 0.16 * Math.abs(normal.getX(index));
      colours.set([colour.r * shade, colour.g * shade, colour.b * shade], index * 3);
    }
    box.setAttribute('color', new BufferAttribute(colours, 3));
    parts.push(box);
  };
  addBox(9.2, ROOF_CAP_HEIGHT, 6.8, height, new Color().setRGB(0.45, 0.22, 0.16, SRGBColorSpace));
  addBox(4.4, 1.6, 3.2, height + ROOF_CAP_HEIGHT, new Color().setRGB(0.52, 0.5, 0.46, SRGBColorSpace));
  const merged = mergeGeometries(parts, false);
  parts.forEach(part => part.dispose());
  return merged ?? new BufferGeometry();
}

const VERTEX_DECLARATIONS = `varying vec3 vObj;
varying vec3 vNrm;
varying vec3 vWorldNormal;
varying float vRecess;
varying float vDist;
attribute float aRecess;`;

const FRAGMENT_DECLARATIONS = `uniform float uSeed;
uniform float uFloorHeight;
uniform vec3 uSunDir;
varying vec3 vObj;
varying vec3 vNrm;
varying vec3 vWorldNormal;
varying float vRecess;
varying float vDist;

float h2(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float box(vec2 p, vec2 lo, vec2 hi, float aa) {
  vec2 a = smoothstep(lo - aa, lo + aa, p);
  vec2 b = 1.0 - smoothstep(hi - aa, hi + aa, p);
  return a.x * a.y * b.x * b.y;
}
vec3 clothes(float k) {
  if (k < 0.16) return vec3(0.95, 0.95, 0.93);
  if (k < 0.32) return vec3(0.30, 0.50, 0.78);
  if (k < 0.48) return vec3(0.82, 0.25, 0.22);
  if (k < 0.64) return vec3(0.94, 0.78, 0.26);
  if (k < 0.80) return vec3(0.34, 0.62, 0.40);
  return vec3(0.55, 0.55, 0.58);
}
vec3 curtain(float k) {
  if (k < 0.25) return vec3(0.88, 0.82, 0.68);
  if (k < 0.5) return vec3(0.66, 0.77, 0.84);
  if (k < 0.75) return vec3(0.89, 0.70, 0.70);
  return vec3(0.68, 0.80, 0.64);
}

vec3 court(vec3 p, vec3 n) {
  if (n.y > 0.5) return vec3(0.56, 0.55, 0.51);
  vec2 tangent = normalize(vec2(-n.z, n.x));
  float u = dot(p.xz, tangent);
  float faceId = floor(dot(p.xz, n.xz) * 0.37 + atan(n.z, n.x) * 3.0);
  float fy = p.y / uFloorHeight;
  float floorIndex = floor(fy);
  float vf = fract(fy);
  const float BAY = 2.415;
  float ub = u / BAY;
  float bay = floor(ub);
  float uf = fract(ub);
  float aa = clamp(max(fwidth(ub), fwidth(fy)) * 0.8, 0.01, 0.5);
  float r1 = h2(vec2(bay + faceId * 13.7, floorIndex * 1.31 + uSeed));
  float r2 = h2(vec2(bay * 3.7 + 11.0 + faceId, floorIndex + uSeed * 2.3));
  float r3 = h2(vec2(bay + 40.0 + faceId * 7.0, floorIndex * 0.77 + uSeed * 5.1));
  float r4 = h2(vec2(bay * 1.9 + 71.0, floorIndex * 2.1 + faceId + uSeed));
  bool mainBay = mod(bay, 2.0) < 0.5;
  vec2 cell = vec2(uf, vf);

  vec3 wall = vec3(0.70, 0.57, 0.42) * (0.94 + 0.08 * r1);
  if (vRecess > 0.5) {
    // Dark stair and lift shafts: deep recess with narrow slit windows.
    vec3 shaft = vec3(0.36, 0.29, 0.22);
    shaft = mix(shaft, vec3(0.20, 0.25, 0.30), box(cell, vec2(0.38, 0.22), vec2(0.62, 0.80), aa));
    return shaft;
  }
  // Floor slab line and weathering streaks under sills.
  wall = mix(wall, wall * 0.86, smoothstep(0.12, 0.0, vf));
  wall = mix(wall, wall * 0.93, box(cell, vec2(0.16, 0.0), vec2(0.84, 0.30), aa) * r2);

  if (floorIndex < 1.0) {
    // Ground storey: lobby glazing, darker.
    return mix(vec3(0.42, 0.37, 0.32), vec3(0.22, 0.28, 0.32), box(cell, vec2(0.10, 0.18), vec2(0.90, 0.86), aa));
  }

  vec2 lo = mainBay ? vec2(0.17, 0.30) : vec2(0.33, 0.40);
  vec2 hi = mainBay ? vec2(0.83, 0.78) : vec2(0.67, 0.78);
  float frame = box(cell, lo, hi, aa);
  vec2 glo = lo + vec2(0.045, 0.045);
  vec2 ghi = hi - vec2(0.045, 0.045);
  float glass = box(cell, glo, ghi, aa);
  vec3 sky = mix(vec3(0.40, 0.52, 0.64), vec3(0.16, 0.23, 0.33), clamp((cell.y - glo.y) / (ghi.y - glo.y), 0.0, 1.0));
  vec3 inside = sky;
  if (r2 < 0.55) inside = mix(sky, curtain(r3) * 0.85, r3 > 0.5 ? 0.8 : 0.5 * step(cell.x, 0.5 + (r4 - 0.5) * 0.4) + 0.2);
  if (r2 > 0.93) inside = r3 > 0.5 ? vec3(0.96, 0.82, 0.54) : vec3(0.14, 0.14, 0.16);
  vec3 colour = wall;
  colour = mix(colour, vec3(0.80, 0.76, 0.68), frame);
  colour = mix(colour, inside, glass);
  if (mainBay) colour = mix(colour, vec3(0.80, 0.76, 0.68), box(cell, vec2(0.485, glo.y), vec2(0.515, ghi.y), aa) * glass);

  // Air-conditioner box hung under the sill.
  if (mainBay && r1 < 0.17) {
    float ac = box(cell, vec2(0.58, 0.07), vec2(0.95, 0.27), aa);
    colour = mix(colour, vec3(0.93, 0.93, 0.91), ac);
    colour = mix(colour, vec3(0.50, 0.52, 0.54), ac * box(cell, vec2(0.62, 0.10), vec2(0.91, 0.15), aa));
  }
  // Pot plants on the sill.
  if (r3 < 0.06) {
    colour = mix(colour, vec3(0.24, 0.46, 0.22), box(cell, vec2(0.22, 0.28), vec2(0.78, 0.44), aa));
  }
  // Laundry on a pole, mostly out of the small kitchen windows beside each door.
  float laundryChance = mainBay ? 0.10 : 0.38;
  if (r4 < laundryChance) {
    colour = mix(colour, vec3(0.30, 0.30, 0.32), box(cell, vec2(0.06, 0.885), vec2(0.94, 0.915), aa));
    for (int i = 0; i < 4; i++) {
      float slot = float(i);
      float hangs = h2(vec2(bay + slot * 5.3 + faceId, floorIndex + uSeed * 1.7));
      float x0 = 0.09 + slot * 0.21;
      float bottom = 0.52 + hangs * 0.12;
      colour = mix(colour, clothes(h2(vec2(slot + bay * 2.0, floorIndex * 3.0 + faceId))), box(cell, vec2(x0, bottom), vec2(x0 + 0.15, 0.89), aa) * step(0.25, hangs));
    }
  }
  // From far away the windows blur into the facade tone.
  float far = smoothstep(180.0, 650.0, vDist);
  return mix(colour, vec3(0.55, 0.45, 0.34), far * 0.8);
}`;

const FRAGMENT_MAIN = `vec3 courtAlbedo = court(vObj, normalize(vNrm));
float sunTerm = dot(normalize(vWorldNormal), uSunDir);
// Soft wrap lighting, warm on the sunlit side and cool in shade.
float courtShade = 0.74 + 0.26 * smoothstep(-0.6, 0.8, sunTerm);
// Ambient occlusion: tree shade and street clutter darken the lower storeys, the shafts stay deep.
float groundAo = mix(0.62, 1.0, smoothstep(0.0, 26.0, vObj.y));
float shaftAo = 1.0 - 0.18 * step(0.5, vRecess);
courtShade *= groundAo * shaftAo;
vec3 courtTint = mix(vec3(0.93, 0.96, 1.04), vec3(1.06, 1.0, 0.92), smoothstep(-0.3, 0.7, sunTerm));
// Colours above are authored as display (sRGB) values.
diffuseColor.rgb *= pow(courtAlbedo, vec3(2.2)) * courtShade * courtTint;`;

export interface CourtMaterialOptions {
  seed: number;
  floorHeight: number;
  sunDirection: Vector3;
}

export function createFacadeMaterial(options: CourtMaterialOptions): MeshBasicMaterial {
  const material = new MeshBasicMaterial({ color: 0xffffff });
  const uniforms = {
    uSeed: { value: options.seed },
    uFloorHeight: { value: options.floorHeight },
    uSunDir: { value: options.sunDirection.clone().normalize() },
  };
  material.userData.uniforms = uniforms;
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_DECLARATIONS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vObj = position;
vNrm = normal;
vWorldNormal = mat3(modelMatrix) * normal;
vRecess = aRecess;
vDist = length((modelViewMatrix * vec4(position, 1.0)).xyz);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_DECLARATIONS}`)
      .replace('#include <map_fragment>', FRAGMENT_MAIN);
  };
  material.customProgramCacheKey = () => 'wang-fuk-facade-v2';
  return material;
}

export interface PlacedBlock {
  block: string;
  pose: BlockPose;
  baseY: number;
  height: number;
  mesh: Mesh;
  caps: Mesh;
}

/** The eight towers, placed one by one once their position and rotation are measured. */
export class WangFukCourt {
  public readonly group = new Group();
  private readonly placed = new Map<string, PlacedBlock>();
  private readonly geometries = new Map<number, { body: BufferGeometry; caps: BufferGeometry }>();
  private readonly capMaterial = new MeshBasicMaterial({ vertexColors: true });

  public constructor(private readonly sunDirection: Vector3) {
    this.group.name = 'wang-fuk-court';
    this.group.visible = false;
  }

  /** Place (or move) a block. `height` is the walled body, excluding the roof machine room. */
  public place(block: string, pose: BlockPose, baseY: number, height: number): PlacedBlock {
    this.remove(block);
    const key = Math.round(height * 10);
    let geometry = this.geometries.get(key);
    if (!geometry) {
      geometry = { body: buildBlockGeometry(height), caps: buildRoofCaps(height) };
      this.geometries.set(key, geometry);
    }
    const seed = [...block].reduce((sum, char) => sum + char.charCodeAt(0), 0) * 0.137;
    const material = createFacadeMaterial({ seed, floorHeight: height / STOREYS, sunDirection: this.sunDirection });
    const mesh = new Mesh(geometry.body, material);
    const caps = new Mesh(geometry.caps, this.capMaterial);
    for (const part of [mesh, caps]) {
      part.position.set(pose.x, baseY, pose.z);
      part.rotation.y = pose.yaw;
      part.matrixAutoUpdate = true;
      part.name = `wang-fuk-court-${block}`;
      part.updateMatrixWorld(true);
      this.group.add(part);
    }
    const placed = { block, pose, baseY, height, mesh, caps };
    this.placed.set(block, placed);
    return placed;
  }

  public remove(block: string): void {
    const existing = this.placed.get(block);
    if (!existing) return;
    (existing.mesh.material as MeshBasicMaterial).dispose();
    this.group.remove(existing.mesh, existing.caps);
    this.placed.delete(block);
  }

  public has(block: string): boolean {
    return this.placed.has(block);
  }

  public get blocks(): readonly PlacedBlock[] {
    return [...this.placed.values()];
  }

  public get count(): number {
    return this.placed.size;
  }

  /** Circles that hide the photo mesh where a tower now stands (just above its ground). */
  public cutouts(): Array<{ x: number; z: number; radius: number; minY: number }> {
    return this.blocks.map(item => ({ x: item.pose.x, z: item.pose.z, radius: BLOCK_RADIUS + 3, minY: item.baseY + 1.2 }));
  }

  public setVisible(visible: boolean): void {
    this.group.visible = visible && this.placed.size > 0;
  }

  public dispose(): void {
    for (const block of [...this.placed.keys()]) this.remove(block);
    for (const { body, caps } of this.geometries.values()) {
      body.dispose();
      caps.dispose();
    }
    this.geometries.clear();
    this.capMaterial.dispose();
  }
}

/** Where the court sits, for tests and callers that need the footprint corners. */
export function planCorners(): Vector3[] {
  return BLOCK_OUTLINE.map(([x, z]) => new Vector3(x, 0, z));
}
