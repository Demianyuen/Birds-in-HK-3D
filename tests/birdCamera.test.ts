import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { BirdController } from '../src/game/BirdController';

describe('chase camera', () => {
  it('stays on the bird side of a wall directly behind it instead of clipping inside', () => {
    const bird = new BirdController();
    bird.restoreSessionPose({ id: 'p', name: 'p', position: [0, 10, 0], quaternion: [0, 0, 0, 1], perched: true });
    // The bird faces −Z, so the camera boom points to +Z; put a wall 5 m behind.
    const geometry = new BoxGeometry(60, 60, 1);
    const material = new MeshBasicMaterial();
    const wall = new Mesh(geometry, material);
    wall.position.set(0, 10, 5);
    wall.updateMatrixWorld(true);
    const camera = new PerspectiveCamera();
    bird.setEnabled(true);
    for (let index = 0; index < 30; index += 1) {
      bird.update(1 / 30, wall);
      bird.updateCamera(camera, 1 / 30);
    }
    expect(camera.position.z).toBeLessThan(4.5);
    geometry.dispose();
    material.dispose();
  });

  it('uses the full boom in open sky', () => {
    const bird = new BirdController();
    const camera = new PerspectiveCamera();
    bird.setEnabled(true);
    for (let index = 0; index < 60; index += 1) {
      bird.update(1 / 30, null);
      bird.updateCamera(camera, 1 / 30);
    }
    expect(camera.position.distanceTo(bird.object.position)).toBeGreaterThan(12);
  });
});
