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
  Points,
  PointsMaterial,
  Object3D,
  Quaternion,
  Raycaster,
  RingGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FLOWER_KINDS, MEMORIAL_CENTRE, type FlowerKind } from './contentRules';
import type { MemorialFlower } from './flowerApi';

const CAPACITY = 4_000;
/** Motes of light drifting up from the flowers, so the field reads from the air. */
const MOTE_CAPACITY = 360;
const MOTES_PER_FLOWER = 3;
/** A just-laid flower: bloom, a ring of light on the ground, and a light rising to the sky. */
const BLOOM_SECONDS = 1.1;
const RING_SECONDS = 2.8;
const RISE_SECONDS = 10;
const RISE_HEIGHT = 70;
const LINGER_SECONDS = 2.2;

interface Ceremony {
  flower: MemorialFlower;
  age: number;
  bloom: Mesh;
  ring: Mesh;
  light: Sprite;
}

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
  private readonly glowBoost = { value: 1 };
  private readonly motes: Points;
  private readonly moteSeeds: Float32Array;
  private readonly moteBases: Float32Array;
  private moteCount = 0;
  private clock = 0;
  private readonly ceremonies: Ceremony[] = [];
  /** Flower ids still blooming: drawn by their ceremony, not the instanced set. */
  private readonly blooming = new Set<string>();
  private readonly glowTexture: CanvasTexture;
  private readonly ringMaterial: MeshBasicMaterial;
  private readonly ringGeometry: RingGeometry;
  /** A faint column of light over Wang Fuk Court while the visitor still carries a flower. */
  private readonly guide: Mesh;
  private guideWanted = false;
  /**
   * Where each flower is drawn. The photo mesh refines as you come closer and its
   * ground can rise or sink by a metre, which would bury a flower laid on the
   * coarser version; so flowers near the bird are settled onto the surface that
   * is showing now (a few per frame).
   */
  private readonly settledY = new Map<string, number>();
  private readonly settledAt = new Map<string, number>();
  private settleOrder: string[] = [];
  private settleCursor = 0;
  private readonly raycaster = new Raycaster();
  private readonly down = new Vector3(0, -1, 0);

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
    this.glowTexture = glowTexture;
    const glowMaterial = new MeshBasicMaterial({
      map: glowTexture, color: '#fff3d6', transparent: true, opacity: 0.55,
      blending: AdditiveBlending, depthWrite: false, fog: true,
    });
    // Seen from far away each glow grows, so the flowers still read as a field of light from the air.
    glowMaterial.onBeforeCompile = shader => {
      shader.uniforms.uGlowBoost = this.glowBoost;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uGlowBoost;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.xz *= uGlowBoost;');
    };
    this.disposables.push(glowGeometry, glowTexture, glowMaterial);
    this.glow = new InstancedMesh(glowGeometry, glowMaterial, CAPACITY);
    this.glow.name = 'Memorial flower glow';
    this.glow.count = 0;
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 2;
    this.glow.instanceMatrix.setUsage(DynamicDrawUsage);
    this.group.add(this.glow);

    const moteGeometry = new BufferGeometry();
    moteGeometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(MOTE_CAPACITY * 3), 3).setUsage(DynamicDrawUsage));
    // Additive blending: a darker vertex colour is a fainter mote, so each fades in and out.
    moteGeometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(MOTE_CAPACITY * 3), 3).setUsage(DynamicDrawUsage));
    moteGeometry.setDrawRange(0, 0);
    const moteMaterial = new PointsMaterial({
      map: glowTexture, color: '#ffe9bf', size: 0.5, sizeAttenuation: true, vertexColors: true,
      transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false,
    });
    this.disposables.push(moteGeometry, moteMaterial);
    this.motes = new Points(moteGeometry, moteMaterial);
    this.motes.name = 'Memorial light motes';
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 3;
    this.moteSeeds = new Float32Array(MOTE_CAPACITY);
    this.moteBases = new Float32Array(MOTE_CAPACITY * 3);
    this.group.add(this.motes);

    this.ringGeometry = new RingGeometry(0.86, 1, 48);
    this.ringGeometry.rotateX(-Math.PI / 2);
    this.ringMaterial = new MeshBasicMaterial({
      color: '#fff1cf', transparent: true, opacity: 0.8, blending: AdditiveBlending, depthWrite: false,
    });
    this.disposables.push(this.ringGeometry, this.ringMaterial);

    const guideGeometry = new CylinderGeometry(4, 4, 260, 24, 1, true);
    guideGeometry.translate(0, 130, 0);
    const guideMaterial = new MeshBasicMaterial({
      map: verticalFadeTexture(), color: '#fff2d2', transparent: true, opacity: 0,
      blending: AdditiveBlending, depthWrite: false, side: 2,
    });
    this.disposables.push(guideGeometry, guideMaterial, guideMaterial.map!);
    this.guide = new Mesh(guideGeometry, guideMaterial);
    this.guide.name = 'Memorial guide light';
    this.guide.position.set(MEMORIAL_CENTRE.x, 0, MEMORIAL_CENTRE.z);
    this.guide.renderOrder = 1;
    this.guide.visible = false;
    this.group.add(this.guide);
  }

  /** Show the guiding light (while a flower is carried) at the court's ground height. */
  public showGuide(visible: boolean, groundY = this.guide.position.y): void {
    this.guideWanted = visible;
    this.guide.position.y = groundY;
  }

  /**
   * The moment of laying a flower: it grows out of the ground, a ring of
   * light spreads around it, and a small light rises slowly into the sky.
   */
  public ceremony(flower: MemorialFlower): void {
    this.flowers.set(flower.id, flower);
    this.blooming.add(flower.id);
    this.dirty = true;
    const geometry = this.meshes.get(flower.kind)!.geometry;
    const material = this.meshes.get(flower.kind)!.material as MeshStandardMaterial;
    const bloom = new Mesh(geometry, material);
    bloom.position.set(flower.x, flower.y, flower.z);
    bloom.rotation.y = hash(flower.id) * Math.PI * 2;
    bloom.scale.setScalar(0.001);
    const ring = new Mesh(this.ringGeometry, this.ringMaterial.clone());
    ring.position.set(flower.x, flower.y + 0.03, flower.z);
    ring.renderOrder = 3;
    const light = new Sprite(new SpriteMaterial({
      map: this.glowTexture, color: flower.kind === 'lantern' ? '#ffc477' : '#fff4dc',
      transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0,
    }));
    light.position.set(flower.x, flower.y + 0.4, flower.z);
    light.scale.setScalar(0.6);
    light.renderOrder = 4;
    this.group.add(bloom, ring, light);
    this.ceremonies.push({ flower, age: 0, bloom, ring, light });
  }

  /** True while a just-laid flower is still blooming or its light is rising. */
  public get ceremonyActive(): boolean {
    return this.ceremonies.length > 0;
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
    this.renameBlooming(localId, flower.id);
    this.flowers.delete(localId);
    this.flowers.set(flower.id, flower);
    this.dirty = true;
  }

  public remove(id: string): void {
    if (this.flowers.delete(id)) this.dirty = true;
    this.blooming.delete(id);
    for (const ceremony of this.ceremonies.filter(item => item.flower.id === id)) this.endCeremony(ceremony);
  }

  /** Swap a just-laid local flower for the stored one without restarting its ceremony. */
  private renameBlooming(localId: string, id: string): void {
    if (!this.blooming.delete(localId)) return;
    this.blooming.add(id);
    for (const ceremony of this.ceremonies) if (ceremony.flower.id === localId) ceremony.flower = { ...ceremony.flower, id };
  }

  public get count(): number {
    return this.flowers.size;
  }

  /** Flowers that carry words (approved on the server, or the visitor's own). */
  public get words(): MemorialFlower[] {
    return [...this.flowers.values()].filter(flower => flower.message.trim().length > 0);
  }

  /** Height a flower is drawn at (settled onto the surface showing now). */
  public displayY(flower: MemorialFlower): number {
    return this.settledY.get(flower.id) ?? flower.y;
  }

  /**
   * Settle flowers near `focus` onto the visible surface, `budget` rays per call.
   * Looks only from 1.5 m above to 3 m below where the flower was laid, so a tree
   * crown or a roof overhead never lifts it.
   */
  public settleOnSurface(roots: readonly Object3D[], focus: Vector3, budget = 2): void {
    if (roots.length === 0 || this.flowers.size === 0) return;
    if (this.settleOrder.length !== this.flowers.size) {
      this.settleOrder = [...this.flowers.keys()];
      this.settleCursor = 0;
    }
    let rays = 0;
    for (let looked = 0; looked < 48 && rays < budget; looked += 1) {
      const id = this.settleOrder[this.settleCursor];
      this.settleCursor = (this.settleCursor + 1) % this.settleOrder.length;
      const flower = id ? this.flowers.get(id) : undefined;
      if (!flower || this.blooming.has(flower.id)) continue;
      if (Math.hypot(flower.x - focus.x, flower.z - focus.z) > 160) continue;
      if (this.clock - (this.settledAt.get(flower.id) ?? -Infinity) < 3) continue;
      this.settledAt.set(flower.id, this.clock);
      rays += 1;
      this.raycaster.set(this.position.set(flower.x, flower.y + 1.5, flower.z), this.down);
      this.raycaster.far = 4.5;
      const hit = this.raycaster.intersectObjects(roots as Object3D[], true)[0];
      if (!hit) continue;
      const previous = this.displayY(flower);
      if (Math.abs(hit.point.y - previous) > 0.03) {
        this.settledY.set(flower.id, hit.point.y);
        this.dirty = true;
      }
    }
  }

  /** Every flower shown now. */
  public get all(): MemorialFlower[] {
    return [...this.flowers.values()];
  }

  /**
   * Flowers within `radius` metres of a point across the ground (and, when given,
   * within `height` metres above or below it), nearest first.
   */
  public nearest(point: Vector3, radius: number, limit: number, height = radius): Array<{ flower: MemorialFlower; distance: number }> {
    const found: Array<{ flower: MemorialFlower; distance: number }> = [];
    for (const flower of this.flowers.values()) {
      const across = Math.hypot(flower.x - point.x, flower.z - point.z);
      const rise = Math.abs(this.displayY(flower) - point.y);
      if (across <= radius && rise <= height) found.push({ flower, distance: Math.hypot(across, rise) });
    }
    return found.sort((a, b) => a.distance - b.distance).slice(0, limit);
  }

  /** Per frame: ceremonies, light motes, distance glow, then (when changed) the instanced flowers. */
  public update(deltaSeconds = 0, cameraPosition?: Vector3): void {
    this.clock += deltaSeconds;
    this.updateCeremonies(deltaSeconds);
    this.updateMotes();
    if (cameraPosition) {
      // Fades out as the bird gets close, so it guides without covering the court.
      const near = Math.hypot(cameraPosition.x - this.guide.position.x, cameraPosition.z - this.guide.position.z);
      const material = this.guide.material as MeshBasicMaterial;
      // Stays faintly lit once flowers are laid, a little brighter the more there are, so the place can be found from afar.
      const remembrance = this.flowers.size > 0 ? Math.min(0.08, 0.03 + Math.log10(this.flowers.size + 1) * 0.015) : 0;
      const target = MathClamp((near - 60) / 260, 0, 1) * (this.guideWanted ? 0.2 : remembrance);
      material.opacity += (target - material.opacity) * Math.min(1, deltaSeconds * 2);
      this.guide.visible = material.opacity > 0.005;
    }
    if (cameraPosition && this.flowers.size > 0) {
      // Distance from the camera to the nearest part of the field (roughly its centre).
      const first = this.flowers.values().next().value as MemorialFlower;
      const distance = Math.hypot(cameraPosition.x - first.x, cameraPosition.y - first.y, cameraPosition.z - first.z);
      this.glowBoost.value = MathClamp(distance / 28, 1, 9);
      // Bigger glows overlap: dim each so the field stays a soft light, not a white blob.
      (this.glow.material as MeshBasicMaterial).opacity = 0.42 / this.glowBoost.value ** 0.85;
    }
    if (!this.dirty) return;
    this.dirty = false;
    const counts = new Map<FlowerKind, number>(FLOWER_KINDS.map(kind => [kind, 0]));
    let glowCount = 0;
    this.moteCount = 0;
    for (const flower of this.flowers.values()) {
      for (let mote = 0; mote < MOTES_PER_FLOWER && this.moteCount < MOTE_CAPACITY; mote += 1) {
        const seed = hash(`${flower.id}:m${mote}`);
        this.moteSeeds[this.moteCount] = seed;
        this.moteBases.set([
          flower.x + (hash(`${flower.id}:mx${mote}`) - 0.5) * 1.6,
          this.displayY(flower),
          flower.z + (hash(`${flower.id}:mz${mote}`) - 0.5) * 1.6,
        ], this.moteCount * 3);
        this.moteCount += 1;
      }
      if (this.blooming.has(flower.id)) continue;
      const index = counts.get(flower.kind) ?? 0;
      if (index >= CAPACITY || glowCount >= CAPACITY) continue;
      const seed = hash(flower.id);
      this.position.set(flower.x, this.displayY(flower), flower.z);
      // Laid flowers lean a little and face different ways.
      this.rotation.setFromAxisAngle(this.up, seed * Math.PI * 2);
      const size = 0.9 + (hash(`${flower.id}:s`) * 0.25);
      this.scale.setScalar(size);
      this.matrix.compose(this.position, this.rotation, this.scale);
      this.meshes.get(flower.kind)!.setMatrixAt(index, this.matrix);
      counts.set(flower.kind, index + 1);
      this.position.y += 0.02;
      this.scale.set(flower.kind === 'lantern' ? 3.2 : 2.2, 1, flower.kind === 'lantern' ? 3.2 : 2.2);
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

  private updateCeremonies(deltaSeconds: number): void {
    for (const ceremony of [...this.ceremonies]) {
      ceremony.age += deltaSeconds;
      const t = ceremony.age;
      // Bloom: grows out of the ground with a soft overshoot.
      const bloom = Math.min(1, t / BLOOM_SECONDS);
      const overshoot = 1 + 0.18 * Math.sin(bloom * Math.PI) * (1 - bloom * 0.4);
      ceremony.bloom.scale.setScalar(Math.max(0.001, easeOutCubic(bloom) * overshoot));
      // Ring of light spreading on the ground.
      const ring = Math.min(1, t / RING_SECONDS);
      ceremony.ring.scale.setScalar(0.3 + easeOutCubic(ring) * 7);
      (ceremony.ring.material as MeshBasicMaterial).opacity = 0.85 * (1 - ring) * (1 - ring);
      ceremony.ring.visible = ring < 1;
      // A light that lingers at the flower for a moment, then rises slowly, swaying a little.
      const rise = Math.min(1, t / RISE_SECONDS);
      const lift = Math.max(0, (t - LINGER_SECONDS) / (RISE_SECONDS - LINGER_SECONDS));
      const height = 0.5 * Math.min(1, t / LINGER_SECONDS) + RISE_HEIGHT * lift * lift;
      ceremony.light.position.set(
        ceremony.flower.x + Math.sin(t * 1.3) * 0.6 * rise,
        ceremony.flower.y + 0.4 + height,
        ceremony.flower.z + Math.cos(t * 1.1) * 0.6 * rise,
      );
      const fadeIn = Math.min(1, t / 0.6);
      const fadeOut = rise > 0.7 ? 1 - (rise - 0.7) / 0.3 : 1;
      (ceremony.light.material as SpriteMaterial).opacity = 0.95 * fadeIn * fadeOut;
      // Grows with height so it stays visible as it climbs.
      ceremony.light.scale.setScalar(0.6 + height * 0.06 + Math.sin(t * 4) * 0.06);
      if (t >= BLOOM_SECONDS && this.blooming.delete(ceremony.flower.id)) this.dirty = true;
      if (t >= RISE_SECONDS) this.endCeremony(ceremony);
    }
  }

  private endCeremony(ceremony: Ceremony): void {
    const index = this.ceremonies.indexOf(ceremony);
    if (index >= 0) this.ceremonies.splice(index, 1);
    if (this.blooming.delete(ceremony.flower.id)) this.dirty = true;
    ceremony.bloom.removeFromParent();
    ceremony.ring.removeFromParent();
    (ceremony.ring.material as MeshBasicMaterial).dispose();
    ceremony.light.removeFromParent();
    ceremony.light.material.dispose();
  }

  private updateMotes(): void {
    const attribute = this.motes.geometry.getAttribute('position') as Float32BufferAttribute;
    const positions = attribute.array as Float32Array;
    const colourAttribute = this.motes.geometry.getAttribute('color') as Float32BufferAttribute;
    const colours = colourAttribute.array as Float32Array;
    for (let index = 0; index < this.moteCount; index += 1) {
      const seed = this.moteSeeds[index];
      const period = 9 + seed * 7;
      const phase = ((this.clock / period) + seed) % 1;
      positions[index * 3] = this.moteBases[index * 3] + Math.sin(this.clock * 0.7 + seed * 40) * 0.5 * phase;
      positions[index * 3 + 1] = this.moteBases[index * 3 + 1] + 0.3 + phase * (14 + seed * 10);
      positions[index * 3 + 2] = this.moteBases[index * 3 + 2] + Math.cos(this.clock * 0.6 + seed * 25) * 0.5 * phase;
      const fade = Math.sin(phase * Math.PI);
      colours[index * 3] = colours[index * 3 + 1] = colours[index * 3 + 2] = fade * fade;
    }
    colourAttribute.needsUpdate = this.moteCount > 0;
    this.motes.geometry.setDrawRange(0, this.moteCount);
    attribute.needsUpdate = this.moteCount > 0;
  }

  public dispose(): void {
    for (const ceremony of [...this.ceremonies]) this.endCeremony(ceremony);
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
    // A little light of its own so the white bloom reads against the sky from behind the bird.
    emissive: new Color(kind === 'lantern' ? '#ffb15a' : '#fff6e0'),
    emissiveIntensity: kind === 'lantern' ? 0.9 : 0.22,
  });
  const mesh = new Mesh(geometry, material);
  // Rig units: the bloom is about as big as the bird's head, so it reads from the follow camera.
  const scale = kind === 'lantern' ? 2.6 : 4.4;
  mesh.scale.setScalar(scale);
  const holder = new Group();
  holder.name = 'Carried flower';
  // A lantern hangs from the beak; a flower is held by its stem and points ahead and up.
  holder.userData.hang = kind === 'lantern';
  if (kind === 'lantern') mesh.position.y = -0.2 * scale;
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

function MathClamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function easeOutCubic(value: number): number {
  return 1 - (1 - value) ** 3;
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

/** Bright at the bottom, fading to nothing at the top (for the guide light). */
function verticalFadeTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createLinearGradient(0, 0, 0, 128);
    gradient.addColorStop(0, 'rgba(255,255,255,0)');
    gradient.addColorStop(0.6, 'rgba(255,255,255,0.35)');
    gradient.addColorStop(1, 'rgba(255,255,255,1)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 4, 128);
  }
  return new CanvasTexture(canvas);
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
