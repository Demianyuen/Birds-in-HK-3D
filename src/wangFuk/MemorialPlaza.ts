import {
  BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Raycaster, RingGeometry,
  Vector3, type Object3D,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MEMORIAL_PLAZA } from '../openWorld/contentRules';

/**
 * A small, level stone square in the open ground between the towers, where birds
 * land and lay their flowers. The aerial photo mesh between tall towers is often
 * a lumpy, sloping mass (the survey cannot see down there), so above the square's
 * level it is cut away and this flat paving shows instead.
 */
export class MemorialPlaza {
  public readonly group = new Group();
  private readonly material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  private readonly mesh: Mesh;
  private readonly raycaster = new Raycaster();
  private measuredY: number | null = null;
  private towerY: number | null = null;
  private wanted = false;

  public constructor() {
    this.group.name = 'Memorial plaza';
    this.mesh = new Mesh(plazaGeometry(MEMORIAL_PLAZA.radius), this.material);
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
    this.group.visible = false;
  }

  /** Height of the paving, once known (null until the ground has been measured). */
  public get level(): number | null {
    return this.towerY ?? this.measuredY;
  }

  /**
   * Measures the ground around the square in the photo mesh (the lowest of rays
   * fired down around its edge, kept only if near the terrain estimate).
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

  /** Ground levels measured at the towers (more reliable than rays between them). */
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

  /** The photo mesh is hidden above the paving inside this circle. */
  public cutout(): { x: number; z: number; radius: number; minY: number } | null {
    const level = this.level;
    return level === null ? null : { x: MEMORIAL_PLAZA.x, z: MEMORIAL_PLAZA.z, radius: MEMORIAL_PLAZA.radius + 1, minY: level + 0.2 };
  }

  public dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }

  private place(): void {
    const level = this.level;
    if (level === null) return;
    this.group.position.set(MEMORIAL_PLAZA.x, level, MEMORIAL_PLAZA.z);
    this.group.updateMatrixWorld(true);
    this.group.visible = this.wanted;
  }
}

/** Where the paving goes: the lowest believable ground (lumps and canopy sit higher); the terrain estimate if none. */
export function plazaLevel(heights: readonly number[], terrain: number): number {
  const believable = heights.filter(height => Math.abs(height - terrain) < 14);
  return believable.length >= 4 ? Math.min(...believable) : terrain;
}

function colour(geometry: BufferGeometry, hex: string, vary = 0): BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  const base = new Color(hex);
  const count = flat.attributes.position.count;
  const values = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 3) {
    // Each triangle a touch lighter or darker, like laid stone.
    const shade = 1 + (vary ? (Math.sin(index * 12.9898) * 43758.5453 % 1) * vary : 0);
    for (let corner = 0; corner < 3 && index + corner < count; corner += 1) {
      values.set([base.r * shade, base.g * shade, base.b * shade], (index + corner) * 3);
    }
  }
  flat.setAttribute('color', new Float32BufferAttribute(values, 3));
  flat.deleteAttribute('uv');
  return flat;
}

/**
 * Plain pale stone in rings, a darker border and a low kerb that drops below the
 * ground so no gap shows where the photo mesh around it is lower.
 */
export function plazaGeometry(radius: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const rings = 5;
  for (let ring = 0; ring < rings; ring += 1) {
    const inner = (ring / rings) * (radius - 1.2);
    const outer = ((ring + 1) / rings) * (radius - 1.2);
    const geometry = new RingGeometry(inner, outer, 48, 1);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, 0.06, 0);
    parts.push(colour(geometry, ring % 2 === 0 ? '#cfcac0' : '#c7c1b6', 0.025));
  }
  const border = new RingGeometry(radius - 1.2, radius, 64, 1);
  border.rotateX(-Math.PI / 2);
  border.translate(0, 0.07, 0);
  parts.push(colour(border, '#8f8a82', 0.03));
  // Kerb: the outer wall of the disc, reaching down into the ground.
  const kerb = new CylinderGeometry(radius, radius + 0.15, 2.2, 64, 1, true);
  kerb.translate(0, 0.07 - 1.1, 0);
  parts.push(colour(kerb, '#7d7870'));
  return mergeGeometries(parts)!;
}
