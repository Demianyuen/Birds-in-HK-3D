import { PerspectiveCamera, PlaneGeometry, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { BirdController } from '../src/game/BirdController';

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

function standingBird(): BirdController {
  const bird = new BirdController();
  bird.restoreSessionPose({ id: 'p', name: 'p', position: [0, 1.15, 0], quaternion: [0, 0, 0, 1], perched: true });
  bird.setEnabled(true);
  return bird;
}

function settle(bird: BirdController, camera: PerspectiveCamera, roots: Mesh[], seconds: number): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += 1 / 30) {
    bird.update(1 / 30, roots);
    bird.updateCamera(camera, 1 / 30);
  }
}

function viewDirection(camera: PerspectiveCamera): Vector3 {
  return camera.getWorldDirection(new Vector3());
}

describe('looking around while standing still', () => {
  it('turns the camera but not the bird when the locked mouse moves', () => {
    const ground = floor();
    const camera = new PerspectiveCamera();
    const bird = standingBird();
    settle(bird, camera, [ground], 1);
    const before = viewDirection(camera);
    const yawBefore = bird.getTelemetry().heading;
    bird.setPointerLocked(true);
    bird.steer(-300, 0); // mouse moved left → look left
    settle(bird, camera, [ground], 0.5);
    const after = viewDirection(camera);
    expect(bird.lookingAround).toBe(true);
    expect(bird.getTelemetry().heading).toEqual(yawBefore);
    // Looking left of north (−z): the view now points towards −x.
    expect(after.x).toBeLessThan(before.x - 0.5);
  });

  it('follows the free cursor and settles back when it returns to the centre', () => {
    const ground = floor();
    const camera = new PerspectiveCamera();
    const bird = standingBird();
    settle(bird, camera, [ground], 1);
    bird.setSteerAxes(1, 0);
    settle(bird, camera, [ground], 1.5);
    expect(viewDirection(camera).x).toBeGreaterThan(0.5);
    bird.setSteerAxes(0, 0);
    settle(bird, camera, [ground], 2);
    expect(Math.abs(viewDirection(camera).x)).toBeLessThan(0.1);
  });

  it('hands the look direction to the bird when it starts walking', () => {
    const ground = floor();
    const camera = new PerspectiveCamera();
    const bird = standingBird();
    settle(bird, camera, [ground], 1);
    bird.setPointerLocked(true);
    bird.steer(-400, 0);
    settle(bird, camera, [ground], 0.3);
    const looking = viewDirection(camera);
    bird.setControl('pitchUp', true);
    settle(bird, camera, [ground], 2);
    // The bird now walks the way the camera was facing, and the view did not jump back.
    expect(bird.object.position.x).toBeLessThan(-1);
    expect(viewDirection(camera).x).toBeLessThan(looking.x * 0.6);
  });

  it('does not take over steering in flight', () => {
    const bird = new BirdController();
    bird.setEnabled(true);
    const yaw = bird.getTelemetry().heading;
    bird.steer(200, 0);
    expect(bird.lookingAround).toBe(false);
    bird.update(1 / 30, null);
    expect(bird.getTelemetry().heading).not.toEqual(yaw);
  });
});
