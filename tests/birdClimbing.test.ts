import { BoxGeometry, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { BirdController, WALK_SCALE } from '../src/game/BirdController';

const resources: Array<{ dispose: () => void }> = [];
afterEach(() => { for (const resource of resources.splice(0)) resource.dispose(); });

function floor(): Mesh {
  const geometry = new PlaneGeometry(400, 400);
  geometry.rotateX(-Math.PI / 2);
  const material = new MeshBasicMaterial();
  resources.push(geometry, material);
  const mesh = new Mesh(geometry, material);
  mesh.updateMatrixWorld(true);
  return mesh;
}

/** A 30 m tower whose south face is at z = −20. */
function tower(height = 30): Mesh {
  const geometry = new BoxGeometry(30, height, 20);
  const material = new MeshBasicMaterial();
  resources.push(geometry, material);
  const mesh = new Mesh(geometry, material);
  mesh.position.set(0, height / 2, -30);
  mesh.updateMatrixWorld(true);
  return mesh;
}

function step(bird: BirdController, roots: Mesh[], seconds: number): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += 1 / 30) bird.update(1 / 30, roots);
}

/** Flying north at 12 m height, straight at the tower's south face. */
function flyingAtTower(roots: Mesh[]): BirdController {
  const bird = new BirdController();
  bird.restoreSessionPose({ id: 'p', name: 'p', position: [0, 12, 0], quaternion: [0, 0, 0, 1], perched: false });
  bird.setEnabled(true);
  step(bird, roots, 3);
  return bird;
}

describe('clinging to and climbing building walls', () => {
  it('stops and holds on when it flies head-on into a wall', () => {
    const roots = [tower(), floor()];
    const bird = flyingAtTower(roots);
    expect(bird.getTelemetry().state).toBe('CLINGING');
    expect(bird.isClinging).toBe(true);
    // Right against the facade, not bounced back or through it.
    expect(bird.object.position.z).toBeGreaterThan(-20);
    expect(bird.object.position.z).toBeLessThan(-19);
    const held = bird.object.position.clone();
    step(bird, roots, 1);
    expect(bird.object.position.distanceTo(held)).toBeLessThan(0.05);
    expect(bird.object.scale.x).toBeLessThan(WALK_SCALE + 0.05);
  });

  it('climbs up with W and sideways with D', () => {
    const roots = [tower(), floor()];
    const bird = flyingAtTower(roots);
    const start = bird.object.position.clone();
    bird.setControl('pitchUp', true);
    step(bird, roots, 2);
    bird.setControl('pitchUp', false);
    expect(bird.object.position.y).toBeGreaterThan(start.y + 1.2);
    expect(bird.object.position.z).toBeGreaterThan(-20);
    bird.setControl('yawRight', true);
    step(bird, roots, 2);
    // Facing north, right is east.
    expect(bird.object.position.x).toBeGreaterThan(start.x + 1.2);
    expect(bird.getTelemetry().state).toBe('CLINGING');
  });

  it('steps onto the roof at the top of the wall', () => {
    const roots = [tower(14), floor()];
    const bird = flyingAtTower(roots);
    expect(bird.isClinging).toBe(true);
    bird.setControl('pitchUp', true);
    bird.setControl('accelerate', true);
    step(bird, roots, 3);
    bird.setControl('pitchUp', false);
    bird.setControl('accelerate', false);
    step(bird, roots, 0.2);
    expect(bird.isClinging).toBe(false);
    expect(['PERCHED', 'WALKING']).toContain(bird.getTelemetry().state);
    expect(bird.object.position.y).toBeGreaterThan(14);
    expect(bird.object.position.z).toBeLessThan(-20);
  });

  it('climbs down onto the ground and walks', () => {
    const roots = [tower(), floor()];
    const bird = flyingAtTower(roots);
    bird.setControl('pitchDown', true);
    bird.setControl('accelerate', true);
    step(bird, roots, 8);
    bird.setControl('pitchDown', false);
    bird.setControl('accelerate', false);
    expect(bird.isClinging).toBe(false);
    expect(bird.object.position.y).toBeLessThan(0.5);
    expect(['PERCHED', 'WALKING']).toContain(bird.getTelemetry().state);
  });

  it('lets go and flies away from the wall with Space', () => {
    const roots = [tower(), floor()];
    const bird = flyingAtTower(roots);
    bird.flap();
    step(bird, roots, 1);
    expect(bird.getTelemetry().state).toBe('FLYING');
    expect(bird.object.position.z).toBeGreaterThan(-18);
  });

  it('glances off a wall it only grazes instead of clinging', () => {
    const roots = [tower(), floor()];
    const bird = new BirdController();
    // Heading north-west at a shallow angle along the south face.
    const angle = 1.25; // radians left of north
    bird.restoreSessionPose({
      id: 'p', name: 'p', position: [18, 12, -17],
      quaternion: [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)], perched: false,
    });
    bird.setEnabled(true);
    step(bird, roots, 2);
    expect(bird.isClinging).toBe(false);
  });

  it('starts climbing when it walks straight into a wall', () => {
    const roots = [tower(), floor()];
    const bird = new BirdController();
    bird.restoreSessionPose({ id: 'p', name: 'p', position: [0, 1.15, -17], quaternion: [0, 0, 0, 1], perched: true });
    bird.setEnabled(true);
    bird.setControl('pitchUp', true);
    step(bird, roots, 3);
    expect(bird.isClinging).toBe(true);
    step(bird, roots, 1);
    expect(bird.object.position.y).toBeGreaterThan(0.6);
  });
});
