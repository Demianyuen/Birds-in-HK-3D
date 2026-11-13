import {
  BufferAttribute, BufferGeometry, BoxGeometry, Color, DoubleSide, SRGBColorSpace, Float32BufferAttribute, Group, Mesh,
  MeshStandardMaterial, ShapeUtils, Vector2, Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BLOCK_OUTLINE, BLOCK_RADIUS, STOREYS, type BlockPose } from './plan';

/** Height of the lift motor room on the roof (m). */
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

/** Weathered concrete lift motor room with a water tank on top, baked-shaded vertex colours. */
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
  addBox(9.2, ROOF_CAP_HEIGHT, 6.8, height, new Color().setRGB(0.63, 0.6, 0.55, SRGBColorSpace));
  addBox(9.6, 0.25, 7.2, height + ROOF_CAP_HEIGHT, new Color().setRGB(0.55, 0.53, 0.5, SRGBColorSpace));
  addBox(4.4, 1.6, 3.2, height + ROOF_CAP_HEIGHT + 0.25, new Color().setRGB(0.78, 0.78, 0.76, SRGBColorSpace));
  // Parapet round the roof edge, broken into short runs on each arm of the plan.
  for (const [x, z, w, d] of [[0, -12.7, 11, 0.3], [0, 12.7, 11, 0.3], [12.6, 0, 0.3, 13], [-12.6, 0, 0.3, 13]] as const) {
    const parapet = new BoxGeometry(w, 1.1, d).toNonIndexed();
    parapet.translate(x, height + 0.55, z);
    const normal = parapet.getAttribute('normal');
    const colours = new Float32Array(normal.count * 3);
    const tone = new Color().setRGB(0.66, 0.62, 0.56, SRGBColorSpace);
    for (let index = 0; index < normal.count; index += 1) colours.set([tone.r, tone.g, tone.b], index * 3);
    parapet.setAttribute('color', new BufferAttribute(colours, 3));
    parts.push(parapet);
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach(part => part.dispose());
  return merged ?? new BufferGeometry();
}

/**
 * A thin concrete ledge round the tower at every floor slab, standing proud of
 * the wall so it catches the light and throws a line of shadow, as real slabs do.
 */
export function buildLedgeGeometry(height: number, floorHeight = height / STOREYS, out = 0.22, thick = 0.18): BufferGeometry {
  const outline = BLOCK_OUTLINE.map(([x, z]) => new Vector2(x, z));
  let area = 0;
  outline.forEach((point, index) => {
    const next = outline[(index + 1) % outline.length];
    area += point.x * next.y - next.x * point.y;
  });
  const sign = area > 0 ? 1 : -1;
  const normalOf = (a: Vector2, b: Vector2): Vector2 => new Vector2((b.y - a.y) * sign, -(b.x - a.x) * sign).normalize();
  const grown = outline.map((point, index) => {
    const previous = outline[(index + outline.length - 1) % outline.length];
    const next = outline[(index + 1) % outline.length];
    const n1 = normalOf(previous, point);
    const n2 = normalOf(point, next);
    const miter = n1.clone().add(n2);
    return point.clone().addScaledVector(miter, out / Math.max(0.3, 1 + n1.dot(n2)));
  });
  const positions: number[] = [];
  const quad = (a: Vector3, b: Vector3, c: Vector3, d: Vector3): void => {
    for (const p of [a, b, c, a, c, d]) positions.push(p.x, p.y, p.z);
  };
  for (let floor = 1; floor < STOREYS; floor += 1) {
    const y = floor * floorHeight;
    for (let index = 0; index < outline.length; index += 1) {
      const a = outline[index];
      const b = outline[(index + 1) % outline.length];
      const ga = grown[index];
      const gb = grown[(index + 1) % outline.length];
      const top = y + thick / 2;
      const bottom = y - thick / 2;
      quad(new Vector3(ga.x, bottom, ga.y), new Vector3(gb.x, bottom, gb.y), new Vector3(gb.x, top, gb.y), new Vector3(ga.x, top, ga.y));
      quad(new Vector3(a.x, top, a.y), new Vector3(ga.x, top, ga.y), new Vector3(gb.x, top, gb.y), new Vector3(b.x, top, b.y));
      quad(new Vector3(a.x, bottom, a.y), new Vector3(b.x, bottom, b.y), new Vector3(gb.x, bottom, gb.y), new Vector3(ga.x, bottom, ga.y));
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
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

float gGlass = 0.0;

vec3 court(vec3 p, vec3 n) {
  gGlass = 0.0;
  if (n.y > 0.5) return vec3(0.60, 0.58, 0.54);
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
  float near = 1.0 - smoothstep(40.0, 160.0, vDist);

  // Mosaic-tiled wall: a muted warm beige, each bay and floor a shade apart, fine grout up close.
  vec3 wall = vec3(0.76, 0.68, 0.57) * (0.95 + 0.06 * r1);
  vec2 tile = abs(fract(vec2(u, p.y) / 0.24) - 0.5);
  wall *= 1.0 - 0.07 * near * smoothstep(0.42, 0.5, max(tile.x, tile.y));
  // Grime: darker at the foot of the tower and towards the roof, where rain runs off.
  wall *= mix(0.86, 1.0, smoothstep(0.0, 18.0, p.y));
  if (vRecess > 0.5) {
    // Deep stair and lift shafts: shadowed, with narrow slit windows.
    vec3 shaft = vec3(0.46, 0.42, 0.37);
    float slit = box(cell, vec2(0.40, 0.25), vec2(0.60, 0.78), aa);
    gGlass = slit;
    return mix(shaft, vec3(0.22, 0.25, 0.28), slit);
  }
  // Floor slab line, with a soft shadow just under it.
  wall *= 1.0 - 0.10 * smoothstep(0.10, 0.0, vf) - 0.06 * smoothstep(0.98, 1.0, vf);

  if (floorIndex < 1.0) {
    // Ground storey: lobby glazing behind a grey stone base.
    float lobby = box(cell, vec2(0.08, 0.16), vec2(0.92, 0.88), aa);
    gGlass = lobby;
    vec3 lobbyGlass = mix(vec3(0.30, 0.33, 0.35), vec3(0.62, 0.58, 0.50), box(cell, vec2(0.2, 0.2), vec2(0.8, 0.6), aa) * 0.5);
    return mix(vec3(0.55, 0.53, 0.50), lobbyGlass, lobby);
  }

  vec2 lo = mainBay ? vec2(0.17, 0.32) : vec2(0.33, 0.42);
  vec2 hi = mainBay ? vec2(0.83, 0.80) : vec2(0.67, 0.80);
  // Rain streaks below the sill, faint, each window its own.
  float streak = box(cell, vec2(lo.x + 0.08, 0.0), vec2(hi.x - 0.08, lo.y), aa) * smoothstep(0.0, lo.y, vf);
  wall *= 1.0 - 0.07 * streak * (0.4 + r2);
  float frame = box(cell, lo, hi, aa);
  vec2 glo = lo + vec2(0.04, 0.04);
  vec2 ghi = hi - vec2(0.04, 0.05);
  float glass = box(cell, glo, ghi, aa);
  // Dark glass that the sky reflects in (see roughness); curtains and blinds behind some.
  // Base: the sky and the block opposite seen in the glass, lighter at the top of each pane.
  vec3 inside = mix(vec3(0.16, 0.20, 0.24), vec3(0.42, 0.50, 0.58), smoothstep(glo.y, ghi.y, cell.y) * (0.5 + 0.5 * r4));
  if (r2 < 0.5) inside = mix(inside, curtain(r3) * 0.55, r3 > 0.5 ? 0.75 : 0.5 * step(cell.x, 0.5 + (r4 - 0.5) * 0.4) + 0.15);
  if (r2 > 0.95) inside = vec3(0.22, 0.19, 0.15);
  // Depth: the head of the opening shades the glass below it, the sill catches light.
  float head = smoothstep(ghi.y, ghi.y - 0.12, cell.y);
  inside *= mix(0.55, 1.0, head);
  vec3 colour = wall;
  colour = mix(colour, vec3(0.70, 0.71, 0.72), frame);
  colour = mix(colour, vec3(0.86, 0.84, 0.80), box(cell, vec2(lo.x - 0.03, lo.y - 0.04), vec2(hi.x + 0.03, lo.y), aa));
  colour = mix(colour, inside, glass);
  gGlass = glass;
  if (mainBay) {
    float mullion = box(cell, vec2(0.49, glo.y), vec2(0.51, ghi.y), aa) * glass;
    colour = mix(colour, vec3(0.70, 0.71, 0.72), mullion);
    gGlass *= 1.0 - mullion;
  }

  // Window air-conditioners, common in estates of this age, with a drip stain below.
  if (mainBay && r1 < 0.32) {
    float ac = box(cell, vec2(0.58, 0.10), vec2(0.92, 0.30), aa);
    colour = mix(colour, colour * 0.82, box(cell, vec2(0.60, 0.0), vec2(0.90, 0.10), aa));
    colour = mix(colour, vec3(0.84, 0.84, 0.82), ac);
    colour = mix(colour, vec3(0.42, 0.44, 0.46), ac * box(cell, vec2(0.62, 0.14), vec2(0.88, 0.18), aa));
    gGlass *= 1.0 - ac;
  }
  // A few pot plants on sills.
  if (r3 < 0.04) colour = mix(colour, vec3(0.26, 0.38, 0.22), box(cell, vec2(0.22, 0.30), vec2(0.78, 0.40), aa));
  // Laundry poles out of the small windows, in faded everyday colours.
  float laundryChance = mainBay ? 0.04 : 0.22;
  if (r4 < laundryChance) {
    colour = mix(colour, vec3(0.34, 0.34, 0.35), box(cell, vec2(0.06, 0.885), vec2(0.94, 0.905), aa));
    for (int i = 0; i < 4; i++) {
      float slot = float(i);
      float hangs = h2(vec2(bay + slot * 5.3 + faceId, floorIndex + uSeed * 1.7));
      float x0 = 0.09 + slot * 0.21;
      float bottom = 0.56 + hangs * 0.12;
      vec3 cloth = mix(clothes(h2(vec2(slot + bay * 2.0, floorIndex * 3.0 + faceId))), vec3(0.68, 0.66, 0.62), 0.6);
      float piece = box(cell, vec2(x0, bottom), vec2(x0 + 0.15, 0.89), aa) * step(0.3, hangs);
      colour = mix(colour, cloth, piece);
      gGlass *= 1.0 - piece;
    }
  }
  // From far away the detail settles into the facade tone.
  float far = smoothstep(220.0, 750.0, vDist);
  gGlass *= 1.0 - far;
  return mix(colour, vec3(0.60, 0.54, 0.46), far * 0.75);
}`;

const FRAGMENT_MAIN = `vec3 courtAlbedo = court(vObj, normalize(vNrm));
// Ambient occlusion: the lower storeys sit among trees and walkways, the shafts stay deep.
float groundAo = mix(0.7, 1.0, smoothstep(0.0, 24.0, vObj.y));
float shaftAo = 1.0 - 0.15 * step(0.5, vRecess);
// Colours above are authored as display (sRGB) values.
diffuseColor.rgb *= pow(courtAlbedo, vec3(2.2)) * groundAo * shaftAo;`;

const ROUGHNESS_MAIN = `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.08, gGlass);`;

export interface CourtMaterialOptions {
  seed: number;
  floorHeight: number;
  sunDirection: Vector3;
}

/**
 * Lit like everything else in the scene (sun, shadows, sky reflections): matt
 * tiled walls, glass that mirrors the sky.
 */
export function createFacadeMaterial(options: CourtMaterialOptions): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0, envMapIntensity: 1.1 });
  const uniforms = {
    uSeed: { value: options.seed },
    uFloorHeight: { value: options.floorHeight },
    uSunDir: { value: options.sunDirection },
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
      .replace('#include <map_fragment>', FRAGMENT_MAIN)
      .replace('#include <roughnessmap_fragment>', ROUGHNESS_MAIN);
  };
  material.customProgramCacheKey = () => 'wang-fuk-facade-v3';
  return material;
}

export interface PlacedBlock {
  block: string;
  pose: BlockPose;
  baseY: number;
  height: number;
  mesh: Mesh;
  caps: Mesh;
  ledges: Mesh;
}

/** The eight towers, placed one by one once their position and rotation are measured. */
export class WangFukCourt {
  public readonly group = new Group();
  private readonly placed = new Map<string, PlacedBlock>();
  private readonly geometries = new Map<number, { body: BufferGeometry; caps: BufferGeometry; ledges: BufferGeometry }>();
  private readonly capMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  /** Floor-slab ledges: plain painted concrete. */
  private readonly ledgeMaterial = new MeshStandardMaterial({ color: '#d2c8b8', roughness: 0.9, metalness: 0, side: DoubleSide });

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
      geometry = { body: buildBlockGeometry(height), caps: buildRoofCaps(height), ledges: buildLedgeGeometry(height) };
      this.geometries.set(key, geometry);
    }
    const seed = [...block].reduce((sum, char) => sum + char.charCodeAt(0), 0) * 0.137;
    const material = createFacadeMaterial({ seed, floorHeight: height / STOREYS, sunDirection: this.sunDirection });
    const mesh = new Mesh(geometry.body, material);
    const caps = new Mesh(geometry.caps, this.capMaterial);
    const ledges = new Mesh(geometry.ledges, this.ledgeMaterial);
    for (const part of [mesh, caps, ledges]) {
      part.castShadow = true;
      part.receiveShadow = true;
      part.position.set(pose.x, baseY, pose.z);
      part.rotation.y = pose.yaw;
      part.matrixAutoUpdate = true;
      part.name = `wang-fuk-court-${block}`;
      part.updateMatrixWorld(true);
      this.group.add(part);
    }
    const placed = { block, pose, baseY, height, mesh, caps, ledges };
    this.placed.set(block, placed);
    return placed;
  }

  public remove(block: string): void {
    const existing = this.placed.get(block);
    if (!existing) return;
    (existing.mesh.material as MeshStandardMaterial).dispose();
    this.group.remove(existing.mesh, existing.caps, existing.ledges);
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

  /**
   * The photo mesh is unlit and is warmed and dimmed by hand in the evening; the
   * towers are lit by the scene's own sun and sky, so they need no extra tint.
   */
  public setTint(_tint: Color): void {
    // Kept for the shared lighting call.
  }

  public setVisible(visible: boolean): void {
    this.group.visible = visible && this.placed.size > 0;
  }

  public dispose(): void {
    for (const block of [...this.placed.keys()]) this.remove(block);
    for (const { body, caps, ledges } of this.geometries.values()) {
      body.dispose();
      caps.dispose();
      ledges.dispose();
    }
    this.geometries.clear();
    this.capMaterial.dispose();
    this.ledgeMaterial.dispose();
  }
}

/** Where the court sits, for tests and callers that need the footprint corners. */
export function planCorners(): Vector3[] {
  return BLOCK_OUTLINE.map(([x, z]) => new Vector3(x, 0, z));
}
