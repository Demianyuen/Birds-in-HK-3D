import { describe, expect, it } from 'vitest';
import { DynamicResolution } from '../src/game/DynamicResolution';

function run(resolution: DynamicResolution, fps: number, seconds: number, start = 0): number {
  const frameMs = 1_000 / fps;
  let now = start;
  for (let elapsed = 0; elapsed < seconds * 1_000; elapsed += frameMs) {
    now += frameMs;
    resolution.update(frameMs, now);
  }
  return now;
}

describe('dynamic resolution', () => {
  it('steps the pixel ratio down while the frame rate is low, not below the floor', () => {
    const resolution = new DynamicResolution({ maximum: 1.25, minimum: 0.7 });
    run(resolution, 30, 30);
    expect(resolution.current).toBeCloseTo(0.7);
  });

  it('keeps full resolution at a steady 60 FPS', () => {
    const resolution = new DynamicResolution({ maximum: 1.25 });
    run(resolution, 60, 20);
    expect(resolution.current).toBe(1.25);
  });

  it('recovers slowly once there is headroom again', () => {
    const resolution = new DynamicResolution({ maximum: 1.2, minimum: 0.6 });
    const now = run(resolution, 25, 20);
    const lowered = resolution.current;
    expect(lowered).toBeLessThan(1.2);
    run(resolution, 60, 60, now);
    expect(resolution.current).toBeGreaterThan(lowered);
    expect(resolution.current).toBeLessThanOrEqual(1.2);
  });

  it('ignores single long hitches', () => {
    const resolution = new DynamicResolution({ maximum: 1 });
    expect(resolution.update(900, 900)).toBeNull();
    run(resolution, 60, 5, 900);
    expect(resolution.current).toBe(1);
  });
});
