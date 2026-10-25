import { BoxGeometry, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { BirdController, WALK_SCALE } from '../src/game/BirdController';

const resources: Array<{ dispose: () => void }> = [];
afterEach(() => { for (const resource of resources.splice(0)) resource.dispose(); });

function floor(y = 0, size = 200): Mesh {
  const geometry = new PlaneGeometry(size, size);
  geometry.rotateX(-Math.PI / 2);
  const material = new MeshBasicMaterial();
  resources.push(geometry, material);
  const mesh = new Mesh(geometry, material);
  mesh.position.y = y;
  mesh.updateMatrixWorld(true);
  return mesh;
}

function box(x: number, y: number, z: number, w: number, h: number, d: number): Mesh {
  const geometry = new BoxGeometry(w, h, d);
  const material = new MeshBasicMaterial();
  resources.push(geometry, material);
  const mesh = new Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.updateMatrixWorld(true);
  return mesh;
}

function standingBird(x = 0, z = 0, groundY = 0): BirdController {
  const bird = new BirdController();
  bird.restoreSessionPose({ id: 'p', name: 'p', position: [x, groundY + 1.15, z], quaternion: [0, 0, 0, 1], perched: true });
  bird.setEnabled(true);
  return bird;
}

function step(bird: BirdController, roots: Mesh[], seconds: number): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += 1 / 30) bird.update(1 / 30, roots);
}

describe('walking on the ground', () => {
  it('shrinks to life size and walks forward at a pigeon pace', () => {
    const ground = floor();
    const bird = standingBird();
    step(bird, [ground], 1);
    expect(bird.object.scale.x).toBeLessThan(WALK_SCALE + 0.05);
    bird.setControl('pitchUp', true);
    step(bird, [ground], 2);
    expect(bird.getTelemetry().state).toBe('WALKING');
    // Facing north (−z): about 1.4 m/s for ~2 s.
    expect(bird.object.position.z).toBeLessThan(-2);
    expect(bird.object.position.z).toBeGreaterThan(-3.5);
    expect(bird.getTelemetry().speedKmh).toBeGreaterThan(4);
    expect(bird.getTelemetry().speedKmh).toBeLessThan(6);
    // Feet stay on the ground.
    expect(bird.object.position.y).toBeCloseTo(WALK_SCALE * 1.15, 1);
  });

  it('runs faster with Shift and stops when the key is released', () => {
    const ground = floor();
    const bird = standingBird();
    bird.setControl('pitchUp', true);
    bird.setControl('accelerate', true);
    step(bird, [ground], 1.5);
    expect(bird.getTelemetry().speedKmh).toBeGreaterThan(10);
    bird.setControl('pitchUp', false);
    bird.setControl('accelerate', false);
    step(bird, [ground], 1);
    expect(bird.getTelemetry().state).toBe('PERCHED');
  });

  it('slides along a wall instead of walking through or bouncing off it', () => {
    const ground = floor();
    // A wall 1.5 m ahead, running east–west.
    const wall = box(0, 5, -1.5, 40, 10, 0.4);
    const bird = standingBird();
    // About 35° off square: a glancing walk slides; walking straight at it climbs (birdClimbing.test.ts).
    bird.setControl('yawLeft', true);
    step(bird, [ground, wall], 0.6);
    bird.setControl('yawLeft', false);
    bird.setControl('pitchUp', true);
    step(bird, [ground, wall], 4);
    expect(bird.object.position.z).toBeGreaterThan(-1.3);
    // It kept moving sideways along the wall.
    expect(Math.abs(bird.object.position.x)).toBeGreaterThan(0.5);
    expect(bird.getTelemetry().state).not.toBe('FLYING');
  });

  it('hops up a kerb but not a wall-high step', () => {
    const ground = floor();
    const kerb = box(0, 0.075, -3, 10, 0.15, 2);
    const bird = standingBird();
    bird.setControl('pitchUp', true);
    step(bird, [ground, kerb], 2.4);
    expect(bird.object.position.z).toBeLessThan(-2.2);
    expect(bird.object.position.y).toBeGreaterThan(0.15);

    const block = box(0, 1, -3, 10, 2, 2);
    const blocked = standingBird();
    blocked.setControl('pitchUp', true);
    step(blocked, [ground, block], 3);
    expect(blocked.object.position.z).toBeGreaterThan(-2);
  });

  it('glides off into flight when it walks off a roof edge', () => {
    const roof = box(0, 20, 0, 6, 1, 6);
    const ground = floor();
    const bird = standingBird(0, 0, 20.5);
    bird.setControl('pitchUp', true);
    bird.setControl('accelerate', true);
    step(bird, [roof, ground], 3);
    expect(bird.getTelemetry().state).toBe('FLYING');
    step(bird, [roof, ground], 1);
    expect(bird.object.scale.x).toBeGreaterThan(0.6);
  });
});
