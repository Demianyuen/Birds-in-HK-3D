import { describe, expect, it } from 'vitest';
import { Grove, distanceToBlock, scatterTrees } from '../src/wangFuk/grove';
import type { BlockPose } from '../src/wangFuk/plan';

const blocks: BlockPose[] = [
  { x: 0, z: 0, yaw: 0.3 },
  { x: 40, z: 5, yaw: 0.3 },
  { x: 20, z: 45, yaw: 0.9 },
];

describe('distanceToBlock', () => {
  it('is negative inside the walls and grows outside', () => {
    expect(distanceToBlock(blocks[0], 0, 0)).toBeLessThan(0);
    expect(distanceToBlock(blocks[0], 100, 100)).toBeGreaterThan(80);
  });
});

describe('scatterTrees', () => {
  const trees = scatterTrees(blocks, { seed: 5, count: 200 });

  it('is deterministic', () => {
    expect(scatterTrees(blocks, { seed: 5, count: 200 })).toEqual(trees);
  });

  it('makes a good number of trees but keeps them off the walls and apart from each other', () => {
    expect(trees.length).toBeGreaterThan(80);
    for (const tree of trees) {
      for (const block of blocks) expect(distanceToBlock(block, tree.x, tree.z)).toBeGreaterThanOrEqual(5.5);
    }
    for (let first = 0; first < trees.length; first += 1) {
      for (let second = first + 1; second < trees.length; second += 1) {
        expect(Math.hypot(trees[first].x - trees[second].x, trees[first].z - trees[second].z)).toBeGreaterThan(2.5);
      }
    }
  });

  it('respects places that cannot hold a tree', () => {
    const dry = scatterTrees(blocks, { seed: 5, count: 200, allowed: x => x < 20 });
    expect(dry.every(tree => tree.x < 20)).toBe(true);
  });

  it('has varied sizes between a young tree and a large shade tree', () => {
    const heights = trees.map(tree => tree.height);
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(6);
    expect(Math.max(...heights)).toBeGreaterThan(12);
  });
});

describe('Grove', () => {
  it('stands trees on the ground a few at a time and skips places with no ground', () => {
    const grove = new Grove(50);
    grove.add(scatterTrees(blocks, { seed: 2, count: 30 }));
    const waiting = grove.waiting;
    expect(grove.update((x, z) => (x > 1000 ? null : 12 + z * 0.01), 10)).toBe(10);
    expect(grove.mesh.count).toBe(10);
    while (grove.waiting > 0) grove.update(() => 12, 10);
    expect(grove.size).toBe(waiting);
    grove.dispose();
  });
});
