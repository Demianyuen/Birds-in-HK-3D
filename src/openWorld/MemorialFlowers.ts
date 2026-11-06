import {
  DoubleSide,
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
  private readonly windTime = { value: 0 };
  /** Flowers and lanterns glow more as the light falls. */
  private glowStrength = 1;
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
    const petals = new MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, side: DoubleSide });
    // Laid flowers move a little in the wind: stems bend more towards the bloom, each flower out of step.
    petals.onBeforeCompile = shader => {
      shader.uniforms.uWindTime = this.windTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWindTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 rootAt = instanceMatrix[3].xyz;
          float sway = pow(clamp(position.y / 0.3, 0.0, 1.2), 2.0);
          float phase = rootAt.x * 0.9 + rootAt.z * 1.7;
          transformed.x += sway * (0.012 * sin(uWindTime * 1.7 + phase) + 0.006 * sin(uWindTime * 3.1 + phase * 2.3));
          transformed.z += sway * 0.009 * sin(uWindTime * 1.3 + phase * 1.4);
        #endif`);
    };
    const lanternMaterial = new MeshStandardMaterial({
      vertexColors: true, flatShading: true, roughness: 0.6, metalness: 0,
      emissive: new Color('#ffb15a'), emissiveIntensity: 0.9,
    });
    this.disposables.push(petals, lanternMaterial);
    for (const kind of FLOWER_KINDS) {
      const geometry = flowerGeometry(kind);
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

  public setGlowStrength(strength: number): void {
    this.glowStrength = strength;
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

  public get(id: string): MemorialFlower | null {
    return this.flowers.get(id) ?? null;
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
    this.windTime.value = this.clock;
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
      (this.glow.material as MeshBasicMaterial).opacity = Math.min(1, (0.42 * this.glowStrength) / this.glowBoost.value ** 0.85);
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
  const geometry = flowerGeometry(kind);
  const material = new MeshStandardMaterial({
    vertexColors: true, roughness: 0.7, metalness: 0, side: DoubleSide,
    // A little light of its own so the white bloom reads against the sky from behind the bird.
    emissive: new Color(kind === 'lantern' ? '#ffb15a' : '#fff6e0'),
    emissiveIntensity: kind === 'lantern' ? 0.9 : 0.22,
  });
  const mesh = new Mesh(geometry, material);
  // Rig units: the bloom is about as big as the bird's head, so it reads from the follow camera.
  const scale = kind === 'lantern' ? 2.6 : 5.2;
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
  const shaft = new CylinderGeometry(0.0045, 0.006, height, 7);
  shaft.translate(0, height / 2, 0);
  const leaf = { length: 0.075, width: 0.024, cup: 0.5, curl: -0.6, point: 0.9, base: '#3f6b2f', tip: '#6b9b4b' };
  const leafA = petal(leaf);
  leafA.rotateX(-0.9);
  leafA.rotateY(Math.PI / 2);
  leafA.translate(0.004, height * 0.33, 0);
  const leafB = petal({ ...leaf, length: 0.065 });
  leafB.rotateX(-0.8);
  leafB.rotateY(-Math.PI / 2 + 0.3);
  leafB.translate(-0.004, height * 0.5, 0);
  return [paint(shaft, '#4f7a3a'), leafA, leafB];
}

interface PetalShape {
  length: number;
  width: number;
  /** How much the two edges lift (0 flat, 1 a deep spoon). */
  cup: number;
  /** Bend along the length in radians: positive arches up and in, negative curls back. */
  curl: number;
  /** 0 = rounded tip, 1 = pointed. */
  point: number;
  base: string;
  tip: string;
}

/**
 * One petal as a smooth curved surface (not a squashed ball): narrow at the base,
 * widest about a third of the way out, cupped across and arched along its length,
 * shading from `base` to `tip`. Lies along +z with its face up (+y), base at the origin.
 */
function petal(shape: PetalShape): BufferGeometry {
  const along = 7;
  const across = 4;
  const positions: number[] = [];
  const colours: number[] = [];
  const baseColour = new Color(shape.base);
  const tipColour = new Color(shape.tip);
  const mixed = new Color();
  let spineY = 0;
  let spineZ = 0;
  const step = shape.length / along;
  for (let i = 0; i <= along; i += 1) {
    const u = i / along;
    const angle = shape.curl * u;
    if (i > 0) {
      const previous = shape.curl * ((i - 0.5) / along);
      spineZ += Math.cos(previous) * step;
      spineY += Math.sin(previous) * step;
    }
    const width = shape.width * (0.22 + 0.78 * Math.sin(Math.PI * Math.min(1, u ** 0.8 * 0.92 + 0.04))) * (1 - shape.point * u ** 3 * 0.85);
    // Normal of the spine in the (z, y) plane.
    const ny = Math.cos(angle);
    const nz = -Math.sin(angle);
    mixed.copy(baseColour).lerp(tipColour, Math.min(1, u * 1.2));
    for (let j = 0; j <= across; j += 1) {
      const v = (j / across) * 2 - 1;
      const lift = shape.cup * v * v * width * 0.5;
      positions.push(v * width * 0.5, spineY + ny * lift, spineZ + nz * lift);
      colours.push(mixed.r, mixed.g, mixed.b);
    }
  }
  const indices: number[] = [];
  for (let i = 0; i < along; i += 1) {
    for (let j = 0; j < across; j += 1) {
      const a = i * (across + 1) + j;
      const b = a + across + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry.toNonIndexed();
}

/** Place petals in a ring: each raised by `tilt` from flat, spread evenly, at height y. */
function ring(count: number, shape: PetalShape, tilt: number, y: number, offset = 0, start = 0.004): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  for (let index = 0; index < count; index += 1) {
    const geometry = petal(shape);
    geometry.rotateX(-tilt);
    geometry.translate(0, 0, start);
    geometry.rotateY((index / count) * Math.PI * 2 + offset);
    geometry.translate(0, y, 0);
    parts.push(geometry);
  }
  return parts;
}

/** The model for each kind of flower: real size (about 0.3 m), stem along +y, standing at the origin. */
export function flowerGeometry(kind: FlowerKind): BufferGeometry {
  switch (kind) {
    case 'lantern': return lanternGeometry();
    case 'lily': return lilyGeometry();
    case 'white-rose': return roseGeometry();
    case 'white-carnation': return carnationGeometry();
    case 'ginger-lily': return gingerLilyGeometry();
    case 'white-lotus': return lotusGeometry();
    case 'white-orchid': return orchidGeometry();
    default: return chrysanthemumGeometry(kind);
  }
}

/** White rose: a cupped spiral of petals around a closed heart. */
function roseGeometry(): BufferGeometry {
  const height = 0.27;
  const parts = stem(height);
  const y = height + 0.012;
  const base = '#ece6d2';
  const tip = '#fbf9f2';
  // Broad rounded petals wrapped around a closed heart, opening outward ring by ring.
  parts.push(...ring(5, { length: 0.028, width: 0.03, cup: 1.4, curl: 1.4, point: 0, base, tip }, 1.35, y + 0.006, 0, 0.001));
  parts.push(...ring(5, { length: 0.036, width: 0.038, cup: 1.2, curl: 1.0, point: 0, base, tip }, 1.05, y + 0.003, 0.6, 0.004));
  parts.push(...ring(6, { length: 0.044, width: 0.044, cup: 0.9, curl: 0.5, point: 0, base, tip }, 0.7, y, 0.25, 0.008));
  for (let index = 0; index < 5; index += 1) {
    const sepal = new ConeGeometry(0.005, 0.03, 3);
    sepal.rotateZ(-Math.PI / 2 - 0.7);
    sepal.translate(0.016, 0, 0);
    sepal.rotateY((index / 5) * Math.PI * 2);
    sepal.translate(0, y - 0.008, 0);
    parts.push(paint(sepal, '#4f7a3a'));
  }
  return mergeGeometries(parts)!;
}

/** White carnation: a ruffled dome of frilled petals on a green calyx. */
function carnationGeometry(): BufferGeometry {
  const height = 0.29;
  const parts = stem(height);
  const calyx = new CylinderGeometry(0.014, 0.009, 0.035, 6);
  calyx.translate(0, height + 0.005, 0);
  parts.push(paint(calyx, '#5e8b45'));
  const top = height + 0.03;
  for (let index = 0; index < 22; index += 1) {
    const ring = index < 9 ? 0 : index < 17 ? 1 : 2;
    const angle = index * 2.399;
    const radius = [0.036, 0.024, 0.01][ring];
    const frill = new IcosahedronGeometry(1, 0);
    frill.scale(0.022, 0.009, 0.018);
    frill.rotateZ(0.5 - ring * 0.25);
    frill.translate(radius, 0, 0);
    frill.rotateY(angle);
    frill.translate(0, top + ring * 0.011, 0);
    parts.push(paint(frill, ring === 2 ? '#eeeae0' : '#faf9f4'));
  }
  return mergeGeometries(parts)!;
}

/** Ginger lily (姜花), common on Hong Kong hillsides: white butterfly-like flowers on a green spike. */
function gingerLilyGeometry(): BufferGeometry {
  const height = 0.3;
  const parts = stem(height);
  for (const side of [-1, 1]) {
    const leaf = new SphereGeometry(1, 6, 3);
    leaf.scale(0.09, 0.006, 0.022);
    leaf.rotateZ(side * 0.45);
    leaf.translate(side * 0.07, height * 0.55, 0);
    parts.push(paint(leaf, '#4b7d3c'));
  }
  const spike = new ConeGeometry(0.018, 0.06, 6);
  spike.translate(0, height + 0.02, 0);
  parts.push(paint(spike, '#6f9a4e'));
  for (let index = 0; index < 4; index += 1) {
    const angle = (index / 4) * Math.PI * 2 + 0.3;
    const y = height + 0.03 + (index % 2) * 0.012;
    for (const wing of [-1, 1]) {
      const petal = new SphereGeometry(1, 6, 3);
      petal.scale(0.026, 0.004, 0.02);
      petal.rotateY(wing * 0.6);
      petal.rotateZ(0.35);
      petal.translate(0.038, 0, wing * 0.012);
      petal.rotateY(angle);
      petal.translate(0, y, 0);
      parts.push(paint(petal, '#fbfaf5'));
    }
    const lip = new SphereGeometry(1, 5, 3);
    lip.scale(0.012, 0.004, 0.014);
    lip.translate(0.052, -0.004, 0);
    lip.rotateY(angle);
    lip.translate(0, y, 0);
    parts.push(paint(lip, '#f4efd9'));
  }
  return mergeGeometries(parts)!;
}

/** White lotus: pointed petals cupped around a golden seed head. */
function lotusGeometry(): BufferGeometry {
  const height = 0.2;
  const shaft = new CylinderGeometry(0.009, 0.011, height, 6);
  shaft.translate(0, height / 2, 0);
  const parts = [paint(shaft, '#557f3f')];
  const y = height + 0.008;
  const pod = new CylinderGeometry(0.02, 0.014, 0.018, 12);
  pod.translate(0, y + 0.016, 0);
  parts.push(paint(pod, '#e3c35a'));
  const shape = { length: 0.07, width: 0.036, cup: 1.1, curl: 0.55, point: 0.75, base: '#f8f2ec', tip: '#f6e4e6' };
  parts.push(...ring(8, shape, 0.75, y, 0, 0.012));
  parts.push(...ring(7, { ...shape, length: 0.062, curl: 0.8, tip: '#fbf6f4' }, 1.05, y + 0.004, 0.4, 0.01));
  return mergeGeometries(parts)!;
}

/** White moth orchid (蝴蝶蘭): an arching stem with three flat flowers. */
function orchidGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const points: Array<[number, number]> = [[0, 0], [0.01, 0.12], [0.03, 0.22], [0.07, 0.29], [0.12, 0.32], [0.17, 0.31]];
  for (let index = 1; index < points.length; index += 1) {
    const [x0, y0] = points[index - 1];
    const [x1, y1] = points[index];
    const length = Math.hypot(x1 - x0, y1 - y0);
    const piece = new CylinderGeometry(0.005, 0.006, length, 5);
    piece.rotateZ(-Math.atan2(x1 - x0, y1 - y0));
    piece.translate((x0 + x1) / 2, (y0 + y1) / 2, 0);
    parts.push(paint(piece, '#5d7f45'));
  }
  const leaf = new SphereGeometry(1, 6, 3);
  leaf.scale(0.07, 0.008, 0.03);
  leaf.translate(-0.03, 0.01, 0);
  parts.push(paint(leaf, '#3f6b33'));
  for (const [x, y, size] of [[0.07, 0.29, 0.9], [0.12, 0.32, 1], [0.17, 0.3, 0.85]] as const) {
    const flower: BufferGeometry[] = [];
    for (const [angle, w, h] of [[0, 0.03, 0.026], [Math.PI, 0.03, 0.026], [Math.PI / 2, 0.014, 0.024], [-Math.PI / 2 - 0.5, 0.012, 0.022], [-Math.PI / 2 + 0.5, 0.012, 0.022]] as const) {
      const petal = new SphereGeometry(1, 6, 3);
      petal.scale(w * size, h * size, 0.004);
      petal.translate(0, h * size * 0.8, 0);
      petal.rotateZ(angle - Math.PI / 2);
      flower.push(paint(petal, '#fdfcf8'));
    }
    const lip = new SphereGeometry(1, 5, 3);
    lip.scale(0.008 * size, 0.012 * size, 0.006);
    lip.translate(0, -0.008 * size, 0.004);
    flower.push(paint(lip, '#e9c46a'));
    const merged = mergeGeometries(flower)!;
    merged.translate(x, y - 0.02, 0.012);
    parts.push(merged);
  }
  return mergeGeometries(parts)!;
}

/** Chrysanthemum: a dense ball of thin petals on a stem. */
function chrysanthemumGeometry(kind: FlowerKind): BufferGeometry {
  const yellow = kind === 'yellow-chrysanthemum';
  const base = yellow ? '#d49a1c' : '#e4e0cc';
  const tip = yellow ? '#f7d65e' : '#fcfbf6';
  const height = 0.26;
  const parts = stem(height);
  const y = height + 0.012;
  const heart = new IcosahedronGeometry(0.016, 1);
  heart.scale(1, 0.7, 1);
  heart.translate(0, y + 0.012, 0);
  parts.push(paint(heart, yellow ? '#c7891a' : '#ddd6b8'));
  // Many narrow, spooned petals in rings, the inner ones standing up and curling in.
  parts.push(...ring(20, { length: 0.05, width: 0.011, cup: 0.9, curl: 0.5, point: 0.2, base, tip }, 0.12, y, 0));
  parts.push(...ring(16, { length: 0.042, width: 0.011, cup: 1, curl: 0.8, point: 0.2, base, tip }, 0.55, y + 0.004, 0.2));
  parts.push(...ring(12, { length: 0.032, width: 0.01, cup: 1, curl: 1.1, point: 0.2, base, tip }, 1.0, y + 0.008, 0.45));
  parts.push(...ring(8, { length: 0.022, width: 0.009, cup: 1, curl: 1.3, point: 0.2, base, tip }, 1.3, y + 0.012, 0.7, 0.002));
  return mergeGeometries(parts)!;
}

/** White lily: six petals curling out of a trumpet. */
function lilyGeometry(): BufferGeometry {
  const height = 0.29;
  const parts = stem(height);
  const y = height + 0.01;
  // Six long pointed petals: they rise as a trumpet, then curl back at the tips.
  const shape = { length: 0.085, width: 0.03, cup: 0.6, curl: -1.6, point: 0.9, base: '#e9efd8', tip: '#fdfcf6' };
  parts.push(...ring(3, shape, 1.05, y, 0));
  parts.push(...ring(3, { ...shape, width: 0.026 }, 1.15, y + 0.003, Math.PI / 3));
  for (let index = 0; index < 6; index += 1) {
    const filament = new CylinderGeometry(0.0012, 0.0012, 0.055, 3);
    filament.rotateX(0.25);
    filament.translate(0, 0.028, 0.006);
    filament.rotateY((index / 6) * Math.PI * 2);
    filament.translate(0, y, 0);
    parts.push(paint(filament, '#dfe6c8'));
    const anther = new SphereGeometry(1, 5, 3);
    anther.scale(0.0035, 0.002, 0.007);
    anther.translate(0, 0.056, 0.013);
    anther.rotateY((index / 6) * Math.PI * 2);
    anther.translate(0, y, 0);
    parts.push(paint(anther, '#b8742e'));
  }
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
