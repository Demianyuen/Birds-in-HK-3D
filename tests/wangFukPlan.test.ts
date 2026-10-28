import { describe, expect, it } from 'vitest';
import {
  BLOCK_OUTLINE, BLOCK_RADIUS, fitBlock, planToWorld, probeDirections, rayToOutline, STOREYS,
  type BlockPose, type ProfileSample,
} from '../src/wangFuk/plan';

function polygonArea(points: readonly (readonly [number, number])[]): number {
  let area = 0;
  points.forEach(([x, z], index) => {
    const [nx, nz] = points[(index + 1) % points.length];
    area += x * nz - nx * z;
  });
  return Math.abs(area) / 2;
}

/** What a wall-hitting ray from `origin` would measure for a block at `pose`. */
function measure(pose: BlockPose, originX: number, originZ: number, noise = 0): ProfileSample[] {
  let seed = 11;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const cos = Math.cos(pose.yaw);
  const sin = Math.sin(pose.yaw);
  return probeDirections(72).map(({ dx, dz }) => {
    const relX = originX - pose.x;
    const relZ = originZ - pose.z;
    const distance = rayToOutline(relX * cos - relZ * sin, relX * sin + relZ * cos, dx * cos - dz * sin, dx * sin + dz * cos);
    return { dx, dz, distance: distance === null ? null : distance + random() * noise };
  });
}

describe('Wang Fuk Court block plan', () => {
  it('is a closed cruciform of about 31 storeys with the plan dimensions from the floor plan', () => {
    expect(STOREYS).toBe(31);
    expect(BLOCK_OUTLINE).toHaveLength(20);
    const xs = BLOCK_OUTLINE.map(point => point[0]);
    const zs = BLOCK_OUTLINE.map(point => point[1]);
    // 4.83 m × 2 flats wide wings, 7.525 m deep each side of the core.
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(25.8, 1);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(26, 1);
    expect(polygonArea(BLOCK_OUTLINE)).toBeGreaterThan(400);
    expect(polygonArea(BLOCK_OUTLINE)).toBeLessThan(560);
    expect(BLOCK_RADIUS).toBeLessThan(15);
  });

  it('measures the distance to the nearest wall from inside', () => {
    expect(rayToOutline(0, 0, 0, -1)).toBeCloseTo(13, 3);
    expect(rayToOutline(0, 0, 1, 0)).toBeCloseTo(12.9, 3);
    expect(rayToOutline(0, 0, 0, 1)).toBeCloseTo(13, 3);
  });

  it('recovers a block\'s position and rotation from a wall profile', () => {
    const truth: BlockPose = { x: 3.2, z: -2.4, yaw: 0.61 };
    const fit = fitBlock(0, 0, measure(truth, 0, 0));
    expect(fit).not.toBeNull();
    expect(fit!.x).toBeCloseTo(truth.x, 0);
    expect(fit!.z).toBeCloseTo(truth.z, 0);
    const turn = Math.abs(((fit!.yaw - truth.yaw + Math.PI / 2) % Math.PI + Math.PI) % Math.PI - Math.PI / 2);
    expect(turn).toBeLessThan(0.03);
    expect(fit!.error).toBeLessThan(0.3);
  });

  it('still fits when walls are noisy and some rays miss', () => {
    const truth: BlockPose = { x: -5, z: 4, yaw: 2.2 };
    const samples = measure(truth, 0, 0, 1.0).map((sample, index) => (index % 9 === 0 ? { ...sample, distance: null } : sample));
    const fit = fitBlock(0, 0, samples)!;
    expect(Math.hypot(fit.x - truth.x, fit.z - truth.z)).toBeLessThan(1.5);
    const turn = Math.abs(((fit.yaw - truth.yaw + Math.PI / 2) % Math.PI + Math.PI) % Math.PI - Math.PI / 2);
    expect(turn).toBeLessThan(0.08);
  });

  it('refuses to fit when too little was measured', () => {
    expect(fitBlock(0, 0, measure({ x: 0, z: 0, yaw: 0 }, 0, 0).slice(0, 10))).toBeNull();
  });

  it('maps plan points to the world with the block rotation', () => {
    const [x, z] = planToWorld({ x: 10, z: 20, yaw: Math.PI / 2 }, [1, 0]);
    expect(x).toBeCloseTo(10, 5);
    expect(z).toBeCloseTo(19, 5);
  });
});
