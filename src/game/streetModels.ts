import {
  BoxGeometry,
  type BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Shape,
  SphereGeometry,
  Vector2,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Models for the traffic and the people of Tai Po, built in code (no downloads):
 * vehicles from side profiles with rounded edges instead of plain boxes, and
 * people with limbs that swing as they walk (see `limb` below).
 * Everything faces +z, stands on y = 0 and is at real size in metres.
 */

export type VehicleKind = 'car' | 'taxiGreen' | 'taxiRed' | 'minibusGreen' | 'minibusRed' | 'bus' | 'van' | 'lorry';
export const VEHICLE_KINDS: readonly VehicleKind[] = ['car', 'taxiGreen', 'taxiRed', 'minibusGreen', 'minibusRed', 'bus', 'van', 'lorry'];

/** Width and length on the ground, for the soft shadow under each vehicle. */
export const VEHICLE_FOOTPRINT: Readonly<Record<VehicleKind, readonly [number, number]>> = Object.freeze({
  car: [1.78, 4.5], taxiGreen: [1.78, 4.6], taxiRed: [1.78, 4.6], minibusGreen: [2.05, 6.9], minibusRed: [2.05, 6.9],
  bus: [2.5, 11.8], van: [1.9, 5.1], lorry: [2.3, 7.3],
});

const GLASS = '#1a262e';
const TYRE = '#141414';
const HUB = '#9a9ea2';
const LIGHT = '#fff3d0';
const TAIL = '#8a1212';
const TRIM = '#22262a';
const WHITE = '#ffffff';

/** White parts take the instance colour; other colours stay as painted. */
export function paint(geometry: BufferGeometry, colour: string): BufferGeometry {
  const target = geometry.index ? geometry.toNonIndexed() : geometry;
  const value = new Color(colour);
  const count = target.attributes.position.count;
  const colours = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) colours.set([value.r, value.g, value.b], index * 3);
  target.setAttribute('color', new Float32BufferAttribute(colours, 3));
  target.deleteAttribute('uv');
  return target;
}

export function block(width: number, height: number, length: number, x: number, y: number, z: number, colour: string): BufferGeometry {
  const geometry = new BoxGeometry(width, height, length).toNonIndexed();
  geometry.translate(x, y, z);
  return paint(geometry, colour);
}

/** A side profile (points as [z, y]) given a width, with softened edges. */
function profile(points: ReadonlyArray<readonly [number, number]>, width: number, colour: string, bevel = 0.06): BufferGeometry {
  const shape = new Shape(points.map(([z, y]) => new Vector2(-z, y)));
  const depth = Math.max(0.01, width - bevel * 2);
  const geometry = new ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 1, curveSegments: 2,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.rotateY(Math.PI / 2);
  return paint(geometry, colour);
}

/** A box with rounded long edges: width × height, `length` along z, centred on (x, z) with its underside at y. */
function rounded(width: number, height: number, length: number, x: number, y: number, z: number, colour: string, radius = 0.14): BufferGeometry {
  const w = width / 2;
  const r = Math.min(radius, w, height / 2);
  const shape = new Shape();
  shape.moveTo(-w + r, 0);
  shape.lineTo(w - r, 0);
  shape.absarc(w - r, r, r, -Math.PI / 2, 0, false);
  shape.lineTo(w, height - r);
  shape.absarc(w - r, height - r, r, 0, Math.PI / 2, false);
  shape.lineTo(-w + r, height);
  shape.absarc(-w + r, height - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(-w, r);
  shape.absarc(-w + r, r, r, Math.PI, Math.PI * 1.5, false);
  const bevel = Math.min(0.08, r);
  const geometry = new ExtrudeGeometry(shape, {
    depth: length - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 1, curveSegments: 2,
  });
  geometry.translate(x, y, z - length / 2 + bevel);
  return paint(geometry, colour);
}

function wheels(positions: readonly number[], width: number, radius = 0.33): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  for (const z of positions) {
    for (const side of [1, -1]) {
      const x = side * (width / 2 - 0.13);
      const tyre = new CylinderGeometry(radius, radius, 0.26, 8).toNonIndexed();
      tyre.rotateZ(Math.PI / 2);
      tyre.translate(x, radius, z);
      parts.push(paint(tyre, TYRE));
      const hub = new CylinderGeometry(radius * 0.58, radius * 0.58, 0.04, 6).toNonIndexed();
      hub.rotateZ(Math.PI / 2);
      hub.translate(x + side * 0.13, radius, z);
      parts.push(paint(hub, HUB));
    }
  }
  return parts;
}

function lamps(width: number, y: number, front: number, back: number): BufferGeometry[] {
  const x = width / 2 - 0.32;
  return [
    block(0.42, 0.13, 0.05, x, y, front, LIGHT), block(0.42, 0.13, 0.05, -x, y, front, LIGHT),
    block(0.36, 0.13, 0.05, x, y, back, TAIL), block(0.36, 0.13, 0.05, -x, y, back, TAIL),
  ];
}

/** Window pillars along a band of glass: body-coloured posts every `spacing` metres. */
function pillars(width: number, height: number, y: number, from: number, to: number, spacing: number, colour: string): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  for (let z = from; z <= to + 1e-6; z += spacing) parts.push(block(width, height, 0.09, 0, y, z, colour));
  return parts;
}

export function vehicleGeometry(kind: VehicleKind): BufferGeometry {
  const parts: BufferGeometry[] = [];
  if (kind === 'car' || kind === 'taxiGreen' || kind === 'taxiRed') {
    const taxi = kind !== 'car';
    const length = VEHICLE_FOOTPRINT[kind][1];
    const h = length / 2;
    // Hong Kong taxis: green with a white roof (New Territories), red with a silver roof (urban).
    const body = kind === 'taxiGreen' ? '#2f8a4c' : kind === 'taxiRed' ? '#c8312b' : WHITE;
    const roof = kind === 'taxiGreen' ? '#f2f2ee' : kind === 'taxiRed' ? '#c9cbcc' : WHITE;
    // Body: boot, waistline, bonnet sloping to the nose.
    parts.push(profile([[-h, 0.3], [-h, 0.78], [-h + 0.25, 0.92], [-h + 0.9, 0.95], [0.75, 0.93], [h - 0.35, 0.82], [h, 0.66], [h, 0.3]], 1.78, body, 0.09));
    // Cabin: raked windscreen and rear window, all glass, with a roof and one pillar each side.
    parts.push(profile([[-h + 0.55, 0.9], [-h + 1.05, 1.4], [0.3, 1.4], [1.0, 0.9]], 1.58, GLASS, 0.1));
    parts.push(profile([[-h + 0.98, 1.36], [-h + 1.08, 1.46], [0.27, 1.46], [0.37, 1.36]], 1.5, roof, 0.05));
    parts.push(block(1.6, 0.46, 0.1, 0, 1.15, -0.35, roof));
    parts.push(block(1.8, 0.13, 0.08, 0, 0.4, h, TRIM), block(1.8, 0.13, 0.08, 0, 0.4, -h, TRIM));
    parts.push(block(0.14, 0.1, 0.16, 0.95, 0.99, 0.7, body), block(0.14, 0.1, 0.16, -0.95, 0.99, 0.7, body));
    parts.push(...lamps(1.78, 0.58, h + 0.005, -h - 0.005));
    if (taxi) parts.push(block(0.6, 0.15, 0.24, 0, 1.53, -0.1, '#f7f7f2'));
    parts.push(...wheels([length * 0.31, -length * 0.31], 1.78));
  } else if (kind === 'minibusGreen' || kind === 'minibusRed') {
    // Public light bus: cream body with a green (fixed route) or red roof.
    const cream = '#efe8d2';
    parts.push(rounded(2.05, 1.72, 6.9, 0, 0.36, 0, cream, 0.16));
    parts.push(rounded(2.06, 0.5, 6.86, 0, 2.02, 0, kind === 'minibusGreen' ? '#2e7d4f' : '#b8312d', 0.22));
    parts.push(block(2.07, 0.62, 5.0, 0, 1.68, -0.55, GLASS));
    parts.push(...pillars(2.09, 0.62, 1.68, -3.05, 1.95, 1.0, cream));
    parts.push(block(1.8, 0.78, 0.06, 0, 1.6, 3.44, GLASS));
    parts.push(block(1.5, 0.5, 0.06, 0, 1.7, -3.44, GLASS));
    parts.push(block(1.3, 0.2, 0.07, 0, 2.2, 3.43, '#f3e9b0'));
    parts.push(block(2.07, 0.14, 0.08, 0, 0.45, 3.44, TRIM), block(2.07, 0.14, 0.08, 0, 0.45, -3.44, TRIM));
    parts.push(...lamps(2.05, 0.72, 3.455, -3.455));
    parts.push(...wheels([2.2, -2.0], 2.05, 0.36));
  } else if (kind === 'bus') {
    // Double-decker in plain colours (no operator livery).
    parts.push(rounded(2.5, 4.0, 11.8, 0, 0.38, 0, WHITE, 0.2));
    parts.push(block(2.52, 0.5, 11.5, 0, 0.66, 0, '#dcdcd8'));
    parts.push(block(2.52, 0.92, 10.4, 0, 1.78, -0.35, GLASS));
    parts.push(block(2.52, 0.86, 11.0, 0, 3.5, 0, GLASS));
    parts.push(...pillars(2.54, 0.92, 1.78, -5.55, 4.85, 1.3, WHITE));
    parts.push(...pillars(2.54, 0.86, 3.5, -5.5, 5.5, 1.375, WHITE));
    parts.push(block(2.24, 1.5, 0.06, 0, 1.75, 5.89, GLASS));
    parts.push(block(2.24, 0.95, 0.06, 0, 3.5, 5.89, GLASS));
    parts.push(block(1.7, 0.34, 0.07, 0, 2.72, 5.89, '#14181b'), block(1.4, 0.16, 0.08, 0, 2.72, 5.9, '#e2a43a'));
    parts.push(block(2.0, 0.9, 0.06, 0, 3.5, -5.89, GLASS));
    parts.push(block(2.52, 0.16, 0.08, 0, 0.5, 5.89, TRIM), block(2.52, 0.16, 0.08, 0, 0.5, -5.89, TRIM));
    parts.push(...lamps(2.5, 0.85, 5.905, -5.905));
    parts.push(...wheels([3.9, -3.2], 2.5, 0.5));
  } else if (kind === 'van') {
    // Light goods van: short sloping nose, long box.
    parts.push(profile([[-2.55, 0.35], [-2.55, 2.02], [-2.45, 2.1], [1.5, 2.1], [2.3, 1.25], [2.55, 1.08], [2.55, 0.35]], 1.9, WHITE, 0.1));
    parts.push(profile([[1.0, 1.25], [1.0, 1.95], [1.56, 2.08], [2.3, 1.3], [2.2, 1.25]], 1.92, GLASS, 0.03));
    parts.push(block(1.92, 0.14, 0.08, 0, 0.45, 2.55, TRIM), block(1.92, 0.14, 0.08, 0, 0.45, -2.55, TRIM));
    parts.push(...lamps(1.9, 0.8, 2.555, -2.555));
    parts.push(...wheels([1.6, -1.55], 1.9));
  } else {
    // Light lorry: cab, chassis and a covered box.
    parts.push(block(2.0, 0.3, 7.0, 0, 0.75, -0.1, TRIM));
    parts.push(profile([[1.75, 0.5], [1.75, 2.45], [2.9, 2.45], [3.5, 1.5], [3.6, 1.3], [3.6, 0.5]], 2.2, '#f2f2f2', 0.1));
    parts.push(profile([[2.35, 1.5], [2.35, 2.25], [2.96, 2.42], [3.52, 1.55], [3.45, 1.5]], 2.22, GLASS, 0.03));
    parts.push(rounded(2.3, 2.5, 5.2, 0, 0.9, -1.0, WHITE, 0.08));
    parts.push(block(2.22, 0.16, 0.08, 0, 0.6, 3.6, TRIM));
    parts.push(...lamps(2.2, 0.95, 3.605, -3.605));
    parts.push(...wheels([2.6, -2.2], 2.2, 0.46));
  }
  for (const part of parts) part.deleteAttribute('uv');
  return mergeGeometries(parts.map(part => (part.index ? part.toNonIndexed() : part)))!;
}

/** Height of the hips and the shoulders: where legs and arms turn. */
const HIP = 0.88;
const SHOULDER = 1.38;

/** Marks a part as a swinging limb: x = direction (+1 / −1, 0 for the body), y = height of its joint. */
function limb(geometry: BufferGeometry, swing: number, pivot: number): BufferGeometry {
  const count = geometry.attributes.position.count;
  const values = new Float32Array(count * 2);
  for (let index = 0; index < count; index += 1) values.set([swing, pivot], index * 2);
  geometry.setAttribute('limb', new Float32BufferAttribute(values, 2));
  return geometry;
}

function capsule(radius: number, length: number, x: number, y: number, z: number, colour: string): BufferGeometry {
  const geometry = new CapsuleGeometry(radius, length, 1, 5);
  geometry.translate(x, y, z);
  return paint(geometry, colour);
}

/**
 * A person about 1.68 m tall. The top takes the instance colour; legs and arms
 * carry the `limb` attribute so the material can swing them in step.
 */
export function pedestrianGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const trousers = '#2b2f36';
  const skin = '#c99f80';
  for (const side of [1, -1]) {
    const leg = capsule(0.075, 0.7, side * 0.09, 0.455, 0, trousers);
    const shoe = block(0.12, 0.08, 0.24, side * 0.09, 0.04, 0.05, '#1a1a1c');
    parts.push(limb(leg, side, HIP), limb(shoe, side, HIP));
    const sleeve = capsule(0.05, 0.26, side * 0.255, 1.2, 0, WHITE);
    const forearm = capsule(0.042, 0.26, side * 0.255, 0.92, 0, skin);
    parts.push(limb(sleeve, -side, SHOULDER), limb(forearm, -side, SHOULDER));
  }
  const torso = new CylinderGeometry(0.2, 0.165, 0.6, 7);
  torso.scale(1, 1, 0.62);
  torso.translate(0, 1.14, 0);
  parts.push(limb(paint(torso, WHITE), 0, 0));
  const shoulders = new SphereGeometry(0.2, 7, 3);
  shoulders.scale(1, 0.32, 0.62);
  shoulders.translate(0, 1.44, 0);
  parts.push(limb(paint(shoulders, WHITE), 0, 0));
  const neck = new CylinderGeometry(0.05, 0.055, 0.1, 5);
  neck.translate(0, 1.5, 0);
  parts.push(limb(paint(neck, skin), 0, 0));
  const head = new SphereGeometry(0.105, 8, 6);
  head.scale(0.94, 1.12, 1);
  head.translate(0, 1.6, 0.005);
  parts.push(limb(paint(head, skin), 0, 0));
  const hair = new SphereGeometry(0.112, 8, 3, 0, Math.PI * 2, 0, Math.PI * 0.55);
  hair.scale(0.96, 1.12, 1.02);
  hair.translate(0, 1.605, -0.012);
  parts.push(limb(paint(hair, '#1b1714'), 0, 0));
  return mergeGeometries(parts)!;
}

/** Vertex shader lines that swing the limbs; `aStep` is each person's place in the walking cycle. */
export const WALK_VERTEX_HEAD = 'attribute vec2 limb;\nattribute float aStep;';
export const WALK_VERTEX_BODY = `
  if (limb.x != 0.0) {
    float reach = limb.y > 1.0 ? 0.4 : 0.46;
    float turn = limb.x * reach * sin(aStep);
    float up = transformed.y - limb.y;
    float c = cos(turn);
    float s = sin(turn);
    transformed = vec3(transformed.x, limb.y + up * c + transformed.z * s, transformed.z * c - up * s);
  }`;

/** A soft dark patch for under vehicles and people, so they sit on the ground rather than float. */
export function contactShadowTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 4, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(0,0,0,1)');
    gradient.addColorStop(0.55, 'rgba(0,0,0,0.75)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  return new CanvasTexture(canvas);
}
