import { BoxGeometry, Mesh, MeshBasicMaterial } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { BirdController } from '../src/game/BirdController';

const resources: Array<{ dispose: () => void }> = [];

afterEach(() => {
  for (const resource of resources.splice(0)) resource.dispose();
});

describe('bird collision and perching', () => {
  it.each([
    ['yawLeft', 'NW', -1],
    ['yawRight', 'NE', 1],
  ] as const)('reports compass heading consistent with %s world movement', (control, heading, xSign) => {
    const bird = new BirdController();
    bird.setEnabled(true);
    bird.setControl(control, true);
    for (let index = 0; index < 12; index++) bird.update(0.05, null);
    expect(Math.sign(bird.object.position.x)).toBe(xSign);
    expect(bird.object.position.z).toBeLessThan(320);
    expect(bird.getTelemetry().heading).toBe(heading);
  });
  it('restores a saved session location and perched state without held flight input', () => {
    const bird = new BirdController();
    bird.setControl('yawLeft', true);
    bird.restoreSessionPose({
      id: 'returning', name: '同伴', position: [120, 80, -50], quaternion: [0, 0, 0, 1], perched: true,
    });
    expect(bird.object.position.toArray()).toEqual([120, 80, -50]);
    bird.setEnabled(true);
    bird.update(0.05, null);
    expect(bird.getTelemetry().state).toBe('PERCHED');
    expect(bird.getTelemetry().heading).toBe('N');
  });
  it('stops before a building surface at maximum flight speed', () => {
    const bird = new BirdController();
    const wall = createWall(316.5);
    bird.setEnabled(true);
    for (let index = 0; index < 20; index += 1) bird.adjustSpeed(1);

    bird.update(0.05, wall);

    expect(bird.getTelemetry().state).toBe('PERCHED');
    expect(bird.object.position.z).toBeGreaterThan(317);
  });

  it('takes off from a collision surface after a flap', () => {
    const bird = new BirdController();
    const wall = createWall(318);
    bird.setEnabled(true);
    bird.update(0.05, wall);
    expect(bird.getTelemetry().state).toBe('PERCHED');

    bird.flap();
    bird.update(0.05, wall);

    expect(bird.getTelemetry().state).toBe('FLYING');
    expect(bird.getTelemetry().speedKmh).toBeGreaterThan(0);
  });

  it('clears held controls when a new flight starts', () => {
    const bird = new BirdController();
    bird.setEnabled(true);
    bird.setControl('yawLeft', true);
    bird.reset();

    for (let index = 0; index < 12; index += 1) bird.update(0.05, null);

    expect(bird.getTelemetry().heading).toBe('N');
  });

  it('turns the bird back before it leaves a bounded flight region', () => {
    const bird = new BirdController();
    bird.setFlightRadius(300);
    bird.setEnabled(true);

    for (let index = 0; index < 20; index += 1) bird.update(0.05, null);

    expect(Math.hypot(bird.object.position.x, bird.object.position.z)).toBeLessThanOrEqual(300);
    expect(bird.getTelemetry().state).toBe('FLYING');
  });
});

function createWall(z: number): Mesh {
  const geometry = new BoxGeometry(20, 20, 1);
  const material = new MeshBasicMaterial();
  resources.push(geometry, material);
  const wall = new Mesh(geometry, material);
  wall.position.set(0, 220, z);
  wall.updateMatrixWorld(true);
  return wall;
}
