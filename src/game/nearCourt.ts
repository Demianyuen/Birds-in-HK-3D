import { Vector2, Vector4, type Intersection, type Mesh, type Raycaster } from 'three';
import { Mesh as ThreeMesh } from 'three';

/**
 * Around Wang Fuk Court the aerial photo mesh is too soft to stand beside: its
 * buildings look melted from close by. Inside a circle round the estate the photo
 * mesh therefore keeps only its ground, and the official CSDI buildings (drawn in
 * the same clean style as the eight towers) stand on it, with the stylised ground
 * underneath to fill any gaps. Outside the circle nothing changes.
 *
 * This module holds what the shaders and the collision rays share: the circle,
 * how far the photo mesh's ground sits above the terrain model, and the outline of
 * the estate grounds (which belong to the hand-laid lawns and square).
 */
export const MAX_AREA_CORNERS = 48;
/** Photo mesh higher than this above the ground is treated as a building or a tree crown. */
export const PHOTO_GROUND_BAND = 1.2;
/** The clean buildings reach a little past the circle, so they meet the photo mesh's cut edge. */
export const STYLISED_OVERLAP = 35;

export const nearUniforms = {
  /** x, z, radius, on (1) or off (0). */
  uNear: { value: new Vector4(0, 0, 0, 0) },
  /** Height of the photo mesh's ground above the terrain model here (m). */
  uNearLift: { value: 0 },
  uArea: { value: Array.from({ length: MAX_AREA_CORNERS }, () => new Vector2()) },
  uAreaCount: { value: 0 },
  uAreaMinY: { value: 1e9 },
};

export const NEAR_GLSL_DECLARATIONS = `
uniform vec4 uNear;
uniform float uNearLift;
uniform vec2 uArea[${MAX_AREA_CORNERS}];
uniform int uAreaCount;
uniform float uAreaMinY;
bool nearInArea(vec2 p) {
  if (uAreaCount < 3) return false;
  for (int i = 0; i < ${MAX_AREA_CORNERS}; i++) {
    if (i >= uAreaCount) break;
    vec2 a = uArea[i];
    vec2 b = uArea[i + 1 < uAreaCount ? i + 1 : 0];
    if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) < 0.0) return false;
  }
  return true;
}`;

/** For the stylised ground and CSDI models: drawn only inside the circle and outside the estate grounds. */
export function nearKeepInsideGlsl(world: string): string {
  return `if (uNear.w > 0.5 && (distance(${world}.xz, uNear.xy) > uNear.z + ${STYLISED_OVERLAP.toFixed(1)} || nearInArea(${world}.xz))) discard;`;
}

let area: ReadonlyArray<{ x: number; z: number }> = [];
let sites: ReadonlyArray<{ x: number; z: number; radius: number }> = [];
let terrain: (x: number, z: number) => number = () => 0;

export const nearCourt = {
  get on(): boolean {
    return nearUniforms.uNear.value.w > 0.5;
  },

  enable(centre: { x: number; z: number }, radius: number, lift: number, terrainHeight: (x: number, z: number) => number): void {
    nearUniforms.uNear.value.set(centre.x, centre.z, radius, 1);
    nearUniforms.uNearLift.value = lift;
    terrain = terrainHeight;
  },

  setLift(lift: number): void {
    nearUniforms.uNearLift.value = lift;
  },

  disable(): void {
    nearUniforms.uNear.value.w = 0;
  },

  /** The estate grounds: a convex outline (counter-clockwise in x, z), cut from the photo mesh above minY. */
  setArea(outline: ReadonlyArray<{ x: number; z: number }>, minY: number): void {
    area = outline.slice(0, MAX_AREA_CORNERS);
    nearUniforms.uAreaCount.value = area.length;
    nearUniforms.uAreaMinY.value = area.length >= 3 ? minY : 1e9;
    area.forEach((corner, index) => nearUniforms.uArea.value[index].set(corner.x, corner.z));
  },

  /** Where the hand-built towers stand: the CSDI models of the same towers are not drawn there. */
  setTowerSites(list: ReadonlyArray<{ x: number; z: number; radius: number }>): void {
    sites = list;
  },

  inArea(x: number, z: number): boolean {
    if (area.length < 3) return false;
    for (let index = 0; index < area.length; index += 1) {
      const a = area[index];
      const b = area[(index + 1) % area.length];
      if ((b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x) < 0) return false;
    }
    return true;
  },

  insideCircle(x: number, z: number, extra = 0): boolean {
    const near = nearUniforms.uNear.value;
    return Math.hypot(x - near.x, z - near.y) <= near.z + extra;
  },

  /** True where the photo mesh is not drawn because it is a building or tree inside the circle. */
  photoHidden(point: { x: number; y: number; z: number }): boolean {
    if (!this.on || !this.insideCircle(point.x, point.z)) return false;
    return point.y > terrain(point.x, point.z) + nearUniforms.uNearLift.value + PHOTO_GROUND_BAND;
  },

  /** True where the stylised ground or a CSDI model is not drawn (while the circle is on). */
  stylisedHidden(point: { x: number; z: number }, building: boolean): boolean {
    if (!this.on) return false;
    if (!this.insideCircle(point.x, point.z, STYLISED_OVERLAP) || this.inArea(point.x, point.z)) return true;
    return building && sites.some(site => Math.hypot(point.x - site.x, point.z - site.z) < site.radius);
  },
};

/** What is not drawn cannot be landed on or bumped into: rays skip hits where `hidden` says so. */
export function skipHiddenHits(mesh: Mesh, hidden: (point: { x: number; y: number; z: number }) => boolean): void {
  mesh.raycast = function raycastVisibleOnly(raycaster: Raycaster, intersects: Intersection[]) {
    const before = intersects.length;
    ThreeMesh.prototype.raycast.call(this, raycaster, intersects);
    for (let index = intersects.length - 1; index >= before; index -= 1) {
      if (hidden(intersects[index].point)) intersects.splice(index, 1);
    }
  };
}
