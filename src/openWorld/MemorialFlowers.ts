import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FLOWER_KINDS, type FlowerKind } from './contentRules';
import type { MemorialFlower } from './flowerApi';

const CAPACITY = 4_000;

/**
 * Flowers laid at Wang Fuk Court, drawn at real size (about 0.3 m) so they read
 * properly next to the life-size walking bird. Each also has a soft glow on
 * the ground that stays visible from the air, so many flowers read as a field
 * of light around the estate.
 */
export class MemorialFlowers {
  public readonly group = new Group();
  private readonly meshes = new Map<FlowerKind, InstancedMesh>();
  private readonly glow: InstancedMesh;
  private readonly flowers = new Map<string, MemorialFlower>();
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly scale = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private readonly disposables: Array<{ dispose: () => void }> = [];
  private dirty = false;

  public constructor() {
    this.group.name = 'Memorial flowers';
    const petals = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.75, metalness: 0 });
    const lanternMaterial = new MeshStandardMaterial({
      vertexColors: true, flatShading: true, roughness: 0.6, metalness: 0,
      emissive: new Color('#ffb15a'), emissiveIntensity: 0.9,
    });
    this.disposables.push(petals, lanternMaterial);
    for (const kind of FLOWER_KINDS) {
      const geometry = kind === 'lantern' ? lanternGeometry() : kind === 'lily' ? lilyGeometry() : chrysanthemumGeometry(kind);
      this.disposables.push(geometry);
      const mesh = new InstancedMesh(geometry, kind === 'lantern' ? lanternMaterial : petals, CAPACITY);
      mesh.name = `Memorial ${kind}`;
      mesh.count = 0;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      this.meshes.set(kind, mesh);
      this.group.add(mesh);
    }
    const glowGeometry = new PlaneGeometry(1, 1);
    glowGeometry.rotateX(-Math.PI / 2);
    const glowTexture = radialGlowTexture();
    const glowMaterial = new MeshBasicMaterial({
      map: glowTexture, color: '#fff3d6', transparent: true, opacity: 0.55,
      blending: AdditiveBlending, depthWrite: false, fog: true,
    });
    this.disposables.push(glowGeometry, glowTexture, glowMaterial);
    this.glow = new InstancedMesh(glowGeometry, glowMaterial, CAPACITY);
    this.glow.name = 'Memorial flower glow';
    this.glow.count = 0;
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 2;
    this.glow.instanceMatrix.setUsage(DynamicDrawUsage);
    this.group.add(this.glow);
  }

  /** Replace the whole set (from the API), keeping any just-placed local flowers. */
  public setFlowers(flowers: readonly MemorialFlower[]): void {
    const keep = [...this.flowers.values()].filter(flower => flower.id.startsWith('local-'));
    this.flowers.clear();
    for (const flower of flowers) this.flowers.set(flower.id, flower);
    for (const flower of keep) if (!this.flowers.has(flower.id)) this.flowers.set(flower.id, flower);
    this.dirty = true;
  }

  public add(flower: MemorialFlower): void {
    this.flowers.set(flower.id, flower);
    this.dirty = true;
  }

  public replace(localId: string, flower: MemorialFlower): void {
    this.flowers.delete(localId);
    this.flowers.set(flower.id, flower);
    this.dirty = true;
  }

  public remove(id: string): void {
    if (this.flowers.delete(id)) this.dirty = true;
  }

  public get count(): number {
    return this.flowers.size;
  }

  /** Flowers within `radius` metres of a point, nearest first. */
  public nearest(point: Vector3, radius: number, limit: number): Array<{ flower: MemorialFlower; distance: number }> {
    const found: Array<{ flower: MemorialFlower; distance: number }> = [];
    for (const flower of this.flowers.values()) {
      const distance = Math.hypot(flower.x - point.x, flower.y - point.y, flower.z - point.z);
      if (distance <= radius) found.push({ flower, distance });
    }
    return found.sort((a, b) => a.distance - b.distance).slice(0, limit);
  }

  public update(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const counts = new Map<FlowerKind, number>(FLOWER_KINDS.map(kind => [kind, 0]));
    let glowCount = 0;
    for (const flower of this.flowers.values()) {
      const index = counts.get(flower.kind) ?? 0;
      if (index >= CAPACITY || glowCount >= CAPACITY) continue;
      const seed = hash(flower.id);
      this.position.set(flower.x, flower.y, flower.z);
      // Laid flowers lean a little and face different ways.
      this.rotation.setFromAxisAngle(this.up, seed * Math.PI * 2);
      const size = 0.9 + (hash(`${flower.id}:s`) * 0.25);
      this.scale.setScalar(size);
      this.matrix.compose(this.position, this.rotation, this.scale);
      this.meshes.get(flower.kind)!.setMatrixAt(index, this.matrix);
      counts.set(flower.kind, index + 1);
      this.position.y += 0.02;
      this.scale.set(flower.kind === 'lantern' ? 2.4 : 1.6, 1, flower.kind === 'lantern' ? 2.4 : 1.6);
      this.matrix.compose(this.position, this.rotation, this.scale);
      this.glow.setMatrixAt(glowCount, this.matrix);
      glowCount += 1;
    }
    for (const [kind, mesh] of this.meshes) {
      mesh.count = counts.get(kind) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.glow.count = glowCount;
    this.glow.instanceMatrix.needsUpdate = true;
  }

  public dispose(): void {
    for (const mesh of this.meshes.values()) mesh.dispose();
    this.glow.dispose();
    for (const item of this.disposables) item.dispose();
    this.group.removeFromParent();
  }
}

/** A single flower for the bird to carry in its beak (owned and disposed by the caller). */
export function createCarriedFlower(kind: FlowerKind): Group {
  const geometry = kind === 'lantern' ? lanternGeometry() : kind === 'lily' ? lilyGeometry() : chrysanthemumGeometry(kind);
  const material = new MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.75, metalness: 0,
    emissive: new Color(kind === 'lantern' ? '#ffb15a' : '#000000'), emissiveIntensity: kind === 'lantern' ? 0.9 : 0,
  });
  const mesh = new Mesh(geometry, material);
  // Rig units: about twice life size so it reads on the flight-size bird.
  mesh.scale.setScalar(1.7);
  // Stem runs along local +y; centre the bloom near the beak tip.
  mesh.position.y = -0.2;
  const holder = new Group();
  holder.name = 'Carried flower';
  holder.add(mesh);
  return holder;
}

/** Frees a carried flower's geometry and material. */
export function disposeCarriedFlower(holder: Group): void {
  holder.traverse(object => {
    if (object instanceof Mesh) {
      object.geometry.dispose();
      (object.material as MeshStandardMaterial).dispose();
    }
  });
  holder.removeFromParent();
}

function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return ((value >>> 0) % 10_000) / 10_000;
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

function stem(height: number): BufferGeometry[] {
  const shaft = new CylinderGeometry(0.008, 0.01, height, 5);
  shaft.translate(0, height / 2, 0);
  const leafA = new SphereGeometry(1, 5, 3);
  leafA.scale(0.05, 0.008, 0.02);
  leafA.rotateZ(0.5);
  leafA.translate(0.035, height * 0.35, 0);
  const leafB = leafA.clone();
  leafB.rotateY(Math.PI);
  leafB.translate(0, height * 0.12, 0);
  return [paint(shaft, '#4f7a3a'), paint(leafA, '#58873f'), paint(leafB, '#58873f')];
}

/** Chrysanthemum: a dense ball of thin petals on a stem. */
function chrysanthemumGeometry(kind: FlowerKind): BufferGeometry {
  const petalColour = kind === 'yellow-chrysanthemum' ? '#f2c94c' : '#f6f4ec';
  const innerColour = kind === 'yellow-chrysanthemum' ? '#e0a92a' : '#e6e2cf';
  const height = 0.26;
  const parts = stem(height);
  const bloom = new IcosahedronGeometry(0.055, 1);
  bloom.scale(1, 0.7, 1);
  bloom.translate(0, height + 0.02, 0);
  parts.push(paint(bloom, innerColour));
  for (let ring = 0; ring < 2; ring += 1) {
    const petals = ring === 0 ? 14 : 10;
    for (let index = 0; index < petals; index += 1) {
      const petal = new ConeGeometry(0.012, 0.075 - ring * 0.02, 3);
      petal.rotateZ(-Math.PI / 2 + 0.35 + ring * 0.5);
      petal.translate(0.04 - ring * 0.01, 0, 0);
      petal.rotateY((index / petals) * Math.PI * 2 + ring * 0.2);
      petal.translate(0, height + 0.02 + ring * 0.015, 0);
      parts.push(paint(petal, petalColour));
    }
  }
  return mergeGeometries(parts)!;
}

/** White lily: six petals curling out of a trumpet. */
function lilyGeometry(): BufferGeometry {
  const height = 0.3;
  const parts = stem(height);
  const trumpet = new ConeGeometry(0.03, 0.07, 6, 1, true);
  trumpet.rotateX(Math.PI);
  trumpet.translate(0, height + 0.03, 0);
  parts.push(paint(trumpet, '#f3f1e6'));
  for (let index = 0; index < 6; index += 1) {
    const petal = new SphereGeometry(1, 5, 3);
    petal.scale(0.06, 0.006, 0.022);
    petal.rotateZ(0.55);
    petal.translate(0.05, height + 0.07, 0);
    petal.rotateY((index / 6) * Math.PI * 2);
    parts.push(paint(petal, '#fbfaf3'));
  }
  const stamens = new CylinderGeometry(0.004, 0.004, 0.06, 4);
  stamens.translate(0, height + 0.07, 0);
  parts.push(paint(stamens, '#c9873d'));
  return mergeGeometries(parts)!;
}

/** Small paper lantern on the ground, glowing warm. */
function lanternGeometry(): BufferGeometry {
  const body = new CylinderGeometry(0.075, 0.075, 0.16, 8);
  body.translate(0, 0.1, 0);
  const top = new CylinderGeometry(0.05, 0.075, 0.025, 8);
  top.translate(0, 0.19, 0);
  const base = new CylinderGeometry(0.075, 0.06, 0.02, 8);
  base.translate(0, 0.01, 0);
  return mergeGeometries([paint(body, '#fff1d6'), paint(top, '#7d4a2c'), paint(base, '#7d4a2c')])!;
}

function radialGlowTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  return new CanvasTexture(canvas);
}
