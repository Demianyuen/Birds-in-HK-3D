// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { BufferGeometry } from 'three';
import { BirdRig } from '../src/game/BirdRig';
import { createCarriedFlower, flowerGeometry } from '../src/openWorld/MemorialFlowers';
import { FLOWER_KINDS } from '../src/openWorld/contentRules';

describe('a flower carried in the beak', () => {
  it('sways gently with each wing beat, never swinging wildly', () => {
    const rig = new BirdRig('pigeon');
    rig.holdInBeak(createCarriedFlower('white-chrysanthemum'));
    let largest = 0;
    let changes = 0;
    let previous = 0;
    for (let frame = 0; frame < 600; frame += 1) {
      rig.update(1 / 60, { mode: 'flight', flapDemand: 1 });
      const { pitch, roll } = rig.heldSway;
      largest = Math.max(largest, Math.abs(pitch), Math.abs(roll));
      if (Math.sign(pitch) !== Math.sign(previous)) changes += 1;
      previous = pitch;
    }
    expect(largest).toBeGreaterThan(0.03); // it moves
    expect(largest).toBeLessThan(0.45); // about 25 degrees at most
    expect(changes).toBeGreaterThan(10); // back and forth, not drifting one way
  });

  it('settles to a slow drift when the bird stands still', () => {
    const rig = new BirdRig('pigeon');
    rig.holdInBeak(createCarriedFlower('lantern'));
    for (let frame = 0; frame < 600; frame += 1) rig.update(1 / 60, { mode: 'perched', flapDemand: 0 });
    expect(Math.abs(rig.heldSway.pitch)).toBeLessThan(0.15);
  });
});

describe('flower models', () => {
  it('build for every kind with smooth normals and colours, about 0.2 to 0.4 m tall', () => {
    for (const kind of FLOWER_KINDS) {
      const geometry: BufferGeometry = flowerGeometry(kind);
      expect(geometry.attributes.normal, kind).toBeTruthy();
      expect(geometry.attributes.color, kind).toBeTruthy();
      geometry.computeBoundingBox();
      const height = geometry.boundingBox!.max.y - geometry.boundingBox!.min.y;
      expect(height, kind).toBeGreaterThan(0.15);
      expect(height, kind).toBeLessThan(0.45);
    }
  });
});
