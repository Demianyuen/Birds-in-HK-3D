import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Group, Vector3, Mesh, MeshStandardMaterial } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { findPigeonWingPivots, prepareProjectPigeonModel } from '../src/game/Pigeon';

const assetPath = resolve(process.cwd(), 'public', 'models', 'pigeon.glb');

describe('Blender pigeon asset', () => {
  const data = readFileSync(assetPath);

  it('aligns the actual exported white pigeon with negative-Z flight, not the trailing camera', async () => {
    const bytes = Uint8Array.from(data);
    const gltf = await new GLTFLoader().parseAsync(bytes.buffer, '');
    prepareProjectPigeonModel(gltf.scene);
    gltf.scene.updateMatrixWorld(true);
    const beak = gltf.scene.getObjectByName('Beak')!.getWorldPosition(new Vector3());
    const tail = gltf.scene.getObjectByName('TailFeather03')!.getWorldPosition(new Vector3());
    expect(beak.z).toBeLessThan(tail.z);
    const head = gltf.scene.getObjectByName('Head') as Mesh;
    const material = head.material as MeshStandardMaterial;
    expect(material.color.r).toBeGreaterThan(0.8);
    expect(material.color.b).toBeGreaterThan(0.8);
    prepareProjectPigeonModel(gltf.scene);
    gltf.scene.updateMatrixWorld(true);
    expect(gltf.scene.getObjectByName('Beak')!.getWorldPosition(new Vector3()).distanceTo(beak)).toBeLessThan(0.0001);
  });

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
