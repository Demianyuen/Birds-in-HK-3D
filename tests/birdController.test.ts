import { BoxGeometry, Mesh, MeshBasicMaterial, Vector3 } from 'three';
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
  it('holds on to a building wall hit head-on at maximum speed instead of bouncing back or passing through', () => {
    const bird = new BirdController();
    const wall = createWall(316.5);
    bird.setEnabled(true);
    for (let index = 0; index < 20; index += 1) bird.adjustSpeed(1);

    bird.update(0.05, wall);

    expect(bird.getTelemetry().state).toBe('CLINGING');
    // On the near side of the wall, and not pushed back away from it.
    expect(bird.object.position.z).toBeGreaterThan(316.5);
    expect(bird.object.position.z).toBeLessThan(319);
    for (let index = 0; index < 10; index += 1) bird.update(0.05, wall);
    expect(bird.object.position.z).toBeGreaterThan(316.5);
    expect(bird.getTelemetry().state).toBe('CLINGING');
  });

  it('lands on a roof and takes off again after a flap', () => {
    const bird = new BirdController();
    const roof = createRoof(219);
    bird.setEnabled(true);
    for (let index = 0; index < 40 && bird.getTelemetry().state === 'FLYING'; index += 1) {
      bird.setControl('pitchDown', true);
      bird.update(0.05, roof);
    }
    bird.setControl('pitchDown', false);
    expect(bird.getTelemetry().state).toBe('PERCHED');

    bird.flap();
    bird.update(0.05, roof);

    expect(bird.getTelemetry().state).toBe('FLYING');
    expect(bird.getTelemetry().speedKmh).toBeGreaterThan(0);
  });

  it('glides with a gentle sink instead of accelerating downwards', () => {
    const bird = new BirdController();
    bird.setEnabled(true);
    const start = bird.object.position.y;
    for (let index = 0; index < 200; index += 1) bird.update(0.05, null);
    const sinkRate = (start - bird.object.position.y) / 10;
    expect(sinkRate).toBeGreaterThan(0);
    expect(sinkRate).toBeLessThan(3);
  });

  it('flares before touching down and then stands level on the roof', () => {
    const bird = new BirdController();
    const roof = createRoof(212);
    bird.setEnabled(true);
    let flared = false;
    for (let index = 0; index < 80 && bird.getTelemetry().state === 'FLYING'; index += 1) {
      bird.setControl('pitchDown', true);
      bird.update(0.05, roof);
      if (bird.landing) flared = true;
    }
    bird.setControl('pitchDown', false);
    expect(flared).toBe(true);
    expect(bird.getTelemetry().state).toBe('PERCHED');
    const forward = new Vector3(0, 0, -1).applyQuaternion(bird.object.quaternion);
    expect(Math.abs(forward.y)).toBeLessThan(1e-6);
  });

  it('turns on the spot while perched without tipping over', () => {
    const bird = new BirdController();
    bird.restoreSessionPose({ id: 'p', name: 'p', position: [0, 50, 0], quaternion: [0, 0, 0, 1], perched: true });
    bird.setEnabled(true);
    bird.setControl('yawLeft', true);
    bird.steer(0, -400);
    for (let index = 0; index < 20; index += 1) bird.update(0.05, null);
    expect(bird.getTelemetry().state).toBe('PERCHED');
    // Turning on the spot: the feet stay put while the bird shrinks to life size.
    expect(bird.object.position.x).toBe(0);
    expect(bird.object.position.z).toBe(0);
    expect(bird.object.position.y).toBeLessThanOrEqual(50);
    expect(bird.object.position.y).toBeGreaterThan(50 - 1.15);
    expect(bird.getTelemetry().heading).not.toBe('N');
    const forward = new Vector3(0, 0, -1).applyQuaternion(bird.object.quaternion);
    expect(Math.abs(forward.y)).toBeLessThan(1e-6);
  });

  it('takes off slowly and climbs with strong strokes', () => {
    const bird = new BirdController();
    bird.restoreSessionPose({ id: 'p', name: 'p', position: [0, 50, 0], quaternion: [0, 0, 0, 1], perched: true });
    bird.setEnabled(true);
    bird.flap();
    bird.update(0.05, null);
    expect(bird.getTelemetry().state).toBe('FLYING');
    expect(bird.getTelemetry().speedKmh).toBeLessThan(60);
    for (let index = 0; index < 10; index += 1) bird.update(0.05, null);
    expect(bird.object.position.y).toBeGreaterThan(50);
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

function createRoof(y: number): Mesh {
  const geometry = new BoxGeometry(400, 1, 400);
  const material = new MeshBasicMaterial();
  resources.push(geometry, material);
  const roof = new Mesh(geometry, material);
  roof.position.set(0, y, 250);
  roof.updateMatrixWorld(true);
  return roof;
}

function createWall(z: number): Mesh {
  const geometry = new BoxGeometry(20, 20, 1);
  const material = new MeshBasicMaterial();
  resources.push(geometry, material);
  const wall = new Mesh(geometry, material);
  wall.position.set(0, 220, z);
  wall.updateMatrixWorld(true);
  return wall;
}

describe('memorial approach start', () => {
  it('starts far from the court, high up, and facing it', async () => {
    const { MEMORIAL_APPROACH, MEMORIAL_CENTRE } = await import('../src/openWorld/contentRules');
    const bird = new BirdController();
    bird.beginAt(MEMORIAL_APPROACH, MEMORIAL_CENTRE);
    const position = bird.object.position;
    expect(position.toArray()).toEqual([MEMORIAL_APPROACH.x, MEMORIAL_APPROACH.y, MEMORIAL_APPROACH.z]);
    const away = Math.hypot(position.x - MEMORIAL_CENTRE.x, position.z - MEMORIAL_CENTRE.z);
    expect(away).toBeGreaterThan(1_500);
    expect(away).toBeLessThan(2_500); // inside the 3.2 km flight region, a minute or two at cruise speed
    const forward = new Vector3(0, 0, -1).applyQuaternion(bird.object.quaternion);
    const toCourt = new Vector3(MEMORIAL_CENTRE.x - position.x, 0, MEMORIAL_CENTRE.z - position.z).normalize();
    expect(forward.dot(toCourt)).toBeGreaterThan(0.99);
    bird.setEnabled(true);
    for (let index = 0; index < 100; index += 1) bird.update(0.1, null);
    const after = Math.hypot(bird.object.position.x - MEMORIAL_CENTRE.x, bird.object.position.z - MEMORIAL_CENTRE.z);
    expect(after).toBeLessThan(away - 100);
  });
});
