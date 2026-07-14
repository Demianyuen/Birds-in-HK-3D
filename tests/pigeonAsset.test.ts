import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Group } from 'three';
import { findPigeonWingPivots } from '../src/game/Pigeon';

const assetPath = resolve(process.cwd(), 'public', 'models', 'pigeon.glb');

describe('Blender pigeon asset', () => {
  const data = readFileSync(assetPath);

  it('is a compact binary glTF asset', () => {
    expect(data.subarray(0, 4).toString('ascii')).toBe('glTF');
    expect(data.length).toBeGreaterThan(100_000);
    expect(data.length).toBeLessThan(2_000_000);
  });

  it('contains the animated left and right wing pivots', () => {
    const jsonLength = data.readUInt32LE(12);
    const gltf = JSON.parse(data.subarray(20, 20 + jsonLength).toString('utf8').replace(/\0+$/, '')) as {
      nodes?: Array<{ name?: string }>;
    };
    const nodeNames = new Set(gltf.nodes?.map(node => node.name));
    expect(nodeNames.has('Wing.L')).toBe(true);
    expect(nodeNames.has('Wing.R')).toBe(true);
  });

  it('finds wing names after GLTFLoader sanitizes Blender dots', () => {
    const root = new Group();
    const leftWing = new Group();
    const rightWing = new Group();
    leftWing.name = 'WingL';
    rightWing.name = 'WingR';
    root.add(leftWing, rightWing);

    expect(findPigeonWingPivots(root)).toEqual({ leftWing, rightWing });
  });
});
