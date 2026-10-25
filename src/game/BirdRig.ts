import {
  MathUtils,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  BoxGeometry,
} from 'three';
import type { BirdProfileId } from './birdProfiles';
import {
  blendPoses,
  flapFrequency,
  flapPose,
  flarePose,
  glidePose,
  perchedPose,
  type BirdPose,
} from './birdAnimation';

/** What the flight controller asks the rig to show this frame. */
export interface BirdMotion {
  mode: 'flight' | 'flare' | 'perched' | 'walk';
  /** 0 = glide, 1 = flap hard (take-off, climbing, slow flight). */
  flapDemand: number;
  /** Walking pace 0–1 (1 = running) when mode is 'walk'. */
  walkPace?: number;
}

interface Palette {
  body: string;
  breast: string;
  rump: string;
  head: string;
  neck: string;
  neckSheen: string;
  coverts: string;
  wingBar: string | null;
  secondaries: string;
  primaries: string;
  primaryPatch: string | null;
  tail: string;
  tailTip: string;
  beak: string;
  cere: string;
  eye: string;
  legs: string;
}

interface Shape3 {
  wingspan: number;
  forkedTail: boolean;
  scale: number;
}

const PALETTES: Readonly<Record<BirdProfileId, Palette>> = Object.freeze({
  // Hong Kong feral pigeon (rock dove): blue-grey, two black wing bars, iridescent neck.
  pigeon: {
    body: '#97a0ad', breast: '#8a90a0', rump: '#b8bfc9', head: '#8c94a3', neck: '#3f8a6c', neckSheen: '#7a4f8f',
    coverts: '#a9b1bc', wingBar: '#2c3036', secondaries: '#9aa2ae', primaries: '#4a4f58', primaryPatch: null,
    tail: '#8b929e', tailTip: '#2b2e34', beak: '#2b2b2b', cere: '#ece9e1', eye: '#e2782c', legs: '#c25a5d',
  },
  // White dove.
  dove: {
    body: '#f5f6f1', breast: '#eef0ea', rump: '#f8f8f4', head: '#f6f7f2', neck: '#f1f3ee', neckSheen: '#e7ebe6',
    coverts: '#f3f4ef', wingBar: null, secondaries: '#eceee9', primaries: '#e2e6e2', primaryPatch: null,
    tail: '#eef0eb', tailTip: '#e6e9e5', beak: '#d8a08c', cere: '#f3e9e4', eye: '#3a2119', legs: '#d06e72',
  },
  // Black kite (麻鷹), Hong Kong's common raptor: brown, pale primary patch, forked tail.
  eagle: {
    body: '#6a4e35', breast: '#7b5b3d', rump: '#5f4630', head: '#9f8565', neck: '#86694a', neckSheen: '#86694a',
    coverts: '#6e5238', wingBar: null, secondaries: '#4f3b2a', primaries: '#2e2520', primaryPatch: '#b9a78f',
    tail: '#5d4632', tailTip: '#4a3828', beak: '#1f1c1a', cere: '#e0bf44', eye: '#e6c25a', legs: '#e0bf44',
  },
});

const SHAPES: Readonly<Record<BirdProfileId, Shape3>> = Object.freeze({
  pigeon: { wingspan: 1, forkedTail: false, scale: 0.82 },
  dove: { wingspan: 1.04, forkedTail: false, scale: 0.8 },
  eagle: { wingspan: 1.5, forkedTail: true, scale: 1.05 },
});

const PRIMARY_COUNT = 7;
const SECONDARY_COUNT = 7;
const TAIL_COUNT = 9;
const LEG_TOP_Y = -0.36;
const LEG_LENGTH = 0.34;
/** Distance from the rig origin down to the soles of the feet when standing (before scale). */
export const FOOT_DEPTH = -(LEG_TOP_Y - LEG_LENGTH - 0.03);

interface WingRig {
  shoulder: Group;
  wrist: Group;
  primaries: Mesh[];
  primaryAngles: number[];
}

/**
 * Procedural, articulated low-poly bird in the same flat-shaded style as the
 * trees and clouds. Each wing has an arm (coverts + secondaries) and a hand
 * (primaries) jointed at the wrist so it can fold on the upstroke and tuck
 * along the body when perched; the tail fans and the legs tuck in flight.
 */
export class BirdRig {
  public readonly root = new Group();
  private readonly body = new Group();
  private readonly head = new Group();
  private readonly tail = new Group();
  private readonly tailFeathers: Mesh[] = [];
  private readonly tailAngles: number[] = [];
  private readonly legs: Group[] = [];
  private wings: WingRig[] = [];
  private readonly material = new MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.86, metalness: 0, side: DoubleSide,
  });
  private readonly sheenMaterial = new MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.38, metalness: 0.32,
  });
  private profileId: BirdProfileId = 'pigeon';
  private shape: Shape3 = SHAPES.pigeon;

  private phase = 0;
  private time = 0;
  private flapWeight = 0;
  private flapIntensity = 0.5;
  private flareWeight = 0;
  private perchWeight = 0;
  private headYaw = 0;
  private headPitch = 0;
  private headTargetYaw = 0;
  private headTargetPitch = 0;
  private nextGlance = 1.5;
  private flapImpulse = 0;
  private walkWeight = 0;
  private walkPace = 0;
  private walkPhase = 0;
  /** Current walk-cycle phase 0–1 (tests). */
  public get stridePhase(): number {
    return this.walkPhase;
  }

  /** Latest blended pose, exposed for tests and debugging. */
  public pose: BirdPose = glidePose(0);

  public constructor(profileId: BirdProfileId = 'pigeon') {
    this.root.name = 'Procedural bird';
    this.root.add(this.body);
    this.build(profileId);
  }

  public get profile(): BirdProfileId {
    return this.profileId;
  }

  public setProfile(profileId: BirdProfileId): void {
    if (profileId === this.profileId && this.wings.length) return;
    this.build(profileId);
  }

  /** A burst of strong strokes (Space / take-off). */
  public triggerFlap(): void {
    this.flapImpulse = 1;
  }

  public update(deltaSeconds: number, motion: BirdMotion): void {
    const dt = Math.min(0.1, Math.max(0, deltaSeconds));
    this.time += dt;
    this.flapImpulse = Math.max(0, this.flapImpulse - dt * 1.1);
    const demand = Math.min(1, Math.max(motion.flapDemand, this.flapImpulse));

    const approach = (current: number, target: number, rate: number) => current + (target - current) * (1 - Math.exp(-rate * dt));
    const grounded = motion.mode === 'perched' || motion.mode === 'walk';
    this.perchWeight = approach(this.perchWeight, grounded ? 1 : 0, grounded ? 5 : 9);
    this.walkWeight = approach(this.walkWeight, motion.mode === 'walk' ? 1 : 0, 10);
    this.walkPace = approach(this.walkPace, motion.mode === 'walk' ? Math.min(1, Math.max(0, motion.walkPace ?? 0.4)) : 0, 6);
    // Pigeons take quick short steps: about 2 strides a second walking, 4 running.
    this.walkPhase = (this.walkPhase + dt * (1.6 + 2.6 * this.walkPace) * this.walkWeight) % 1;
    this.flareWeight = approach(this.flareWeight, motion.mode === 'flare' ? 1 : 0, 7);
    this.flapWeight = approach(this.flapWeight, demand > 0.05 ? 1 : 0, demand > 0.05 ? 9 : 3.5);
    this.flapIntensity = approach(this.flapIntensity, Math.max(0.35, demand), 4);

    const frequency = flapFrequency(this.flapIntensity, this.shape.wingspan);
    // Keep the cycle running while gliding so a new burst starts smoothly from wherever the wing is.
    this.phase = (this.phase + dt * frequency * Math.max(0.25, this.flapWeight)) % 1;

    const flightWeight = Math.max(0, 1 - this.perchWeight - this.flareWeight);
    this.pose = blendPoses([
      [flapPose(this.phase, this.flapIntensity), flightWeight * this.flapWeight],
      [glidePose(this.time), flightWeight * (1 - this.flapWeight)],
      [flarePose(this.time), this.flareWeight],
      [perchedPose(), this.perchWeight],
    ]);
    this.applyPose(dt, grounded);
  }

  public dispose(): void {
    this.clearMeshes();
    this.material.dispose();
    this.sheenMaterial.dispose();
  }

  private applyPose(dt: number, perched: boolean): void {
    const { wing, body } = this.pose;
    for (const rig of this.wings) {
      rig.shoulder.rotation.set(wing.twist, -wing.sweep, wing.elevation, 'YZX');
      rig.wrist.rotation.set(0, -wing.handFold, wing.handElevation, 'YZX');
      const spread = 0.3 + 0.7 * wing.primarySpread;
      rig.primaries.forEach((feather, index) => { feather.rotation.y = rig.primaryAngles[index] * spread; });
    }
    // Standing: drop the rig so the feet, not the belly, meet the perch.
    const standDrop = this.perchWeight * (1.15 - FOOT_DEPTH * this.shape.scale);
    this.body.position.y = body.bob - standDrop / this.shape.scale;
    this.body.rotation.x = body.pitch;
    const tailSpread = 0.25 + 0.75 * body.tailSpread;
    this.tailFeathers.forEach((feather, index) => { feather.rotation.y = -Math.PI / 2 + this.tailAngles[index] * tailSpread; });
    this.tail.rotation.x = -body.tailPitch;
    const stride = 0.5 + 0.25 * this.walkPace;
    this.legs.forEach((leg, index) => {
      // Tucked feet draw up into the belly feathers and trail back under the tail.
      const cycle = 2 * Math.PI * (this.walkPhase + index * 0.5);
      const swing = Math.sin(cycle) * stride * this.walkWeight;
      // The swinging foot lifts clear; the planted foot carries the body.
      const lift = Math.max(0, Math.cos(cycle)) * 0.07 * this.walkWeight;
      leg.position.y = LEG_TOP_Y + body.legTuck * 0.16 + lift;
      leg.rotation.x = -body.legTuck * 1.6 + body.legReach * 0.8 + swing;
      leg.scale.y = 1 - body.legTuck * 0.45;
    });
    // Waddle: the body rolls a little over the planted foot.
    this.body.rotation.z = Math.sin(2 * Math.PI * this.walkPhase) * 0.07 * this.walkWeight;

    // Head: steadied against body pitch in flight; quick pigeon-like glances when perched.
    if (perched) {
      this.nextGlance -= dt;
      if (this.nextGlance <= 0) {
        this.nextGlance = 1.2 + Math.random() * 2.6;
        this.headTargetYaw = (Math.random() - 0.5) * 1.5;
        this.headTargetPitch = (Math.random() - 0.4) * 0.5;
      }
    } else {
      this.headTargetYaw = 0;
      this.headTargetPitch = 0;
    }
    const snap = perched ? 14 : 5;
    this.headYaw += (this.headTargetYaw - this.headYaw) * (1 - Math.exp(-snap * dt));
    this.headPitch += (this.headTargetPitch - this.headPitch) * (1 - Math.exp(-snap * dt));
    // A small forward-back head bob while standing reads unmistakably as a pigeon.
    const idleBob = perched ? Math.sin(this.time * 2.2) * 0.025 : 0;
    // Walking: the head holds still in the world while the body steps under it
    // (drifting back relative to the body), then thrusts forward — twice per stride.
    const beat = (this.walkPhase * 2) % 1;
    const thrust = beat < 0.72 ? MathUtils.lerp(-0.16, 0.05, beat / 0.72) : MathUtils.lerp(0.05, -0.16, (beat - 0.72) / 0.28);
    this.head.position.z = -0.98 + MathUtils.lerp(idleBob, thrust, this.walkWeight);
    this.head.rotation.set(this.headPitch - body.pitch * 0.8, this.headYaw, 0, 'YXZ');
  }

  private build(profileId: BirdProfileId): void {
    this.clearMeshes();
    this.profileId = profileId;
    this.shape = SHAPES[profileId];
    const palette = PALETTES[profileId];
    this.root.scale.setScalar(this.shape.scale);

    const part = (geometry: BufferGeometry, colour: string, parent: Object3D, sheen = false): Mesh => {
      const mesh = new Mesh(paint(geometry, colour, sheen ? palette.neckSheen : null), sheen ? this.sheenMaterial : this.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const ellipsoid = (rx: number, ry: number, rz: number, x: number, y: number, z: number, colour: string, parent: Object3D, sheen = false) => {
      const geometry = new SphereGeometry(1, 10, 8);
      geometry.scale(rx, ry, rz);
      geometry.translate(x, y, z);
      return part(geometry, colour, parent, sheen);
    };

    // Body, breast, rump, iridescent neck.
    ellipsoid(0.5, 0.45, 0.95, 0, 0, 0.05, palette.body, this.body);
    ellipsoid(0.45, 0.44, 0.52, 0, -0.06, -0.48, palette.breast, this.body);
    ellipsoid(0.36, 0.3, 0.5, 0, 0.05, 0.62, palette.rump, this.body);
    ellipsoid(0.31, 0.36, 0.34, 0, 0.27, -0.78, palette.neck, this.body, true);

    // Head with beak, cere and eyes.
    this.head.position.set(0, 0.47, -0.98);
    this.body.add(this.head);
    ellipsoid(0.25, 0.26, 0.31, 0, 0, 0, palette.head, this.head);
    const beak = new ConeGeometry(0.065, profileId === 'eagle' ? 0.26 : 0.3, 6);
    beak.rotateX(-Math.PI / 2);
    beak.translate(0, -0.05, profileId === 'eagle' ? -0.36 : -0.4);
    part(beak, palette.beak, this.head);
    if (profileId === 'eagle') {
      const hook = new ConeGeometry(0.04, 0.12, 5);
      hook.rotateX(Math.PI);
      hook.translate(0, -0.1, -0.47);
      part(hook, palette.beak, this.head);
    }
    ellipsoid(0.075, 0.05, 0.07, 0, 0.0, -0.27, palette.cere, this.head);
    for (const side of [-1, 1]) {
      ellipsoid(0.06, 0.06, 0.04, side * 0.19, 0.06, -0.12, palette.eye, this.head);
      ellipsoid(0.028, 0.028, 0.02, side * 0.225, 0.065, -0.135, '#0d0d0f', this.head);
    }

    // Wings: the left wing is a mirror of the right (scale.x = −1), so poses apply identically.
    this.wings = [];
    for (const side of [1, -1]) {
      const mirror = new Group();
      mirror.scale.x = side;
      this.body.add(mirror);
      this.wings.push(this.buildWing(mirror, palette, part, ellipsoid));
    }

    // Tail fan.
    this.tail.position.set(0, 0.06, 0.92);
    this.body.add(this.tail);
    this.tailFeathers.length = 0;
    this.tailAngles.length = 0;
    for (let index = 0; index < TAIL_COUNT; index += 1) {
      const offset = index - (TAIL_COUNT - 1) / 2;
      const outer = Math.abs(offset) / ((TAIL_COUNT - 1) / 2);
      const length = this.shape.forkedTail ? 1.05 + outer * 0.35 : 1.0 - outer * 0.08;
      const feather = part(featherGeometry(length, 0.26, palette.tail, palette.tailTip, 0.8), palette.tail, this.tail);
      feather.position.y = 0.01 * (TAIL_COUNT - Math.abs(offset));
      this.tailFeathers.push(feather);
      this.tailAngles.push(offset * 0.13);
    }

    // Legs and feet.
    this.legs.length = 0;
    for (const side of [-1, 1]) {
      const leg = new Group();
      leg.position.set(side * 0.16, LEG_TOP_Y, 0.12);
      this.body.add(leg);
      const shank = new CylinderGeometry(0.04, 0.034, LEG_LENGTH, 5);
      shank.translate(0, -LEG_LENGTH / 2, 0);
      part(shank, palette.legs, leg);
      for (const toe of [-0.5, 0, 0.5, Math.PI]) {
        const geometry = new BoxGeometry(0.035, 0.03, toe === Math.PI ? 0.11 : 0.17);
        geometry.translate(0, 0, toe === Math.PI ? 0.06 : -0.085);
        geometry.rotateY(toe === Math.PI ? 0 : toe * 0.6);
        geometry.translate(0, -LEG_LENGTH - 0.015, 0);
        part(geometry, palette.legs, leg);
      }
      this.legs.push(leg);
    }
    this.applyPose(0, false);
  }

  private buildWing(
    parent: Group,
    palette: Palette,
    part: (geometry: BufferGeometry, colour: string, parent: Object3D, sheen?: boolean) => Mesh,
    ellipsoid: (rx: number, ry: number, rz: number, x: number, y: number, z: number, colour: string, parent: Object3D) => Mesh,
  ): WingRig {
    const span = this.shape.wingspan;
    const armLength = 1.08 * span;
    const shoulder = new Group();
    shoulder.position.set(0.4, 0.2, -0.3);
    parent.add(shoulder);

    // Arm: rounded leading edge of coverts, secondaries trailing behind.
    ellipsoid(armLength * 0.52, 0.075, 0.3, armLength * 0.5, 0.01, 0.08, palette.coverts, shoulder);
    for (let index = 0; index < SECONDARY_COUNT; index += 1) {
      const t = index / (SECONDARY_COUNT - 1);
      const length = (0.92 - t * 0.18) * Math.sqrt(span);
      const feather = part(featherGeometry(length, 0.3, palette.secondaries, palette.secondaries, 1), palette.secondaries, shoulder);
      feather.position.set(0.08 + t * armLength * 0.92, -0.01 - t * 0.004, 0.12);
      feather.rotation.y = -Math.PI / 2 + t * 0.22;
    }
    if (palette.wingBar) {
      for (const z of [0.36, 0.56]) {
        const bar = new BoxGeometry(armLength * 0.78, 0.02, 0.07);
        bar.translate(armLength * 0.5, 0.025, z);
        part(bar, palette.wingBar, shoulder);
      }
    }

    // Hand: jointed at the wrist; primaries fan from outward-pointing to swept back.
    const wrist = new Group();
    wrist.position.set(armLength, 0, 0);
    shoulder.add(wrist);
    const handLength = 0.55 * span;
    ellipsoid(handLength * 0.62, 0.06, 0.22, handLength * 0.45, 0, 0.06, palette.coverts, wrist);
    const primaries: Mesh[] = [];
    const primaryAngles: number[] = [];
    for (let index = 0; index < PRIMARY_COUNT; index += 1) {
      const t = index / (PRIMARY_COUNT - 1);
      const length = (1.18 - (1 - t) * 0.3) * span * (this.shape.wingspan > 1.2 ? 0.92 : 1);
      const base = palette.primaryPatch && t < 0.8 ? palette.primaryPatch : palette.primaries;
      const feather = part(featherGeometry(length, 0.22, base, palette.primaries, palette.primaryPatch ? 0.45 : 1), base, wrist);
      feather.position.set(t * handLength * 0.85, 0.005 * index, 0.04);
      // Outermost primary points along the span, inner ones sweep back towards the secondaries.
      const angle = -(1 - t) * 1.05 - 0.04;
      feather.rotation.y = angle;
      primaries.push(feather);
      primaryAngles.push(angle);
    }
    return { shoulder, wrist, primaries, primaryAngles };
  }

  private clearMeshes(): void {
    this.body.traverse(object => {
      if (object instanceof Mesh) object.geometry.dispose();
    });
    this.body.clear();
    this.head.clear();
    this.tail.clear();
  }
}

/** Tapered feather blade lying in the XZ plane, pointing along +X, base at the origin. */
export function featherGeometry(length: number, width: number, baseColour: string, tipColour: string, tipStart: number): BufferGeometry {
  const half = width / 2;
  const shape = new Shape();
  const band = Math.min(0.98, Math.max(0.2, tipStart));
  shape.moveTo(0, -half * 0.45);
  shape.lineTo(length * 0.18, -half);
  shape.lineTo(length * band, -half * 0.92);
  shape.lineTo(length * 0.97, -half * 0.45);
  shape.lineTo(length, 0);
  shape.lineTo(length * 0.97, half * 0.45);
  shape.lineTo(length * band, half * 0.92);
  shape.lineTo(length * 0.18, half);
  shape.lineTo(0, half * 0.45);
  shape.closePath();
  const geometry = new ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  const base = new Color(baseColour);
  const tip = new Color(tipColour);
  const position = geometry.attributes.position;
  const colours = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    const colour = position.getX(index) >= length * band - 1e-4 ? tip : base;
    colours.set([colour.r, colour.g, colour.b], index * 3);
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colours, 3));
  return geometry;
}

/** Vertex-colour a geometry (keeps an existing colour attribute); optional sheen tints the upper half. */
function paint(geometry: BufferGeometry, colour: string, sheen: string | null): BufferGeometry {
  if (geometry.getAttribute('color')) return geometry;
  const base = new Color(colour);
  const tint = sheen ? new Color(sheen) : null;
  const position = geometry.attributes.position;
  const colours = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    const value = tint && position.getX(index) > 0 ? tint : base;
    colours.set([value.r, value.g, value.b], index * 3);
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colours, 3));
  return geometry;
}
