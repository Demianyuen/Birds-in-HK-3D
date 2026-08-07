import { describe, expect, it } from 'vitest';
import { BirdController } from '../src/game/BirdController';

describe('reference free-flight contract', () => {
  it('resets to the known Tai Po launch pose and clears held controls', () => {
    const bird = new BirdController();
    bird.setEnabled(true);
    for (const control of ['yawLeft', 'yawRight', 'pitchUp', 'pitchDown', 'accelerate', 'decelerate'] as const) {
      bird.setControl(control, true);
    }

    bird.reset();

    expect(bird.object.position.toArray()).toEqual([0, 220, 320]);
    expect(bird.getTelemetry().state).toBe('FLYING');

    const speedBeforeUpdate = bird.getTelemetry().speedKmh;
    bird.update(0.1, null);

    expect(bird.getTelemetry().heading).toBe('N');
    expect(bird.getTelemetry().speedKmh).toBe(speedBeforeUpdate);
  });

  it('keeps the bird inside the configured bounded region after repeated updates', () => {
    const bird = new BirdController();
    bird.setFlightRadius(100);
    bird.setEnabled(true);
    bird.setControl('accelerate', true);

    for (let index = 0; index < 200; index += 1) bird.update(0.1, null);

    expect(Math.hypot(bird.object.position.x, bird.object.position.z)).toBeLessThanOrEqual(100.001);
  });
});
