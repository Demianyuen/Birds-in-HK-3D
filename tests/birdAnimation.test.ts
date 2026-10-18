import { describe, expect, it } from 'vitest';
import {
  blendPoses,
  DOWNSTROKE_FRACTION,
  flapFrequency,
  flapPose,
  flarePose,
  glidePose,
  perchedPose,
} from '../src/game/birdAnimation';
import { BirdRig } from '../src/game/BirdRig';

describe('bird wing kinematics', () => {
  it('raises the wing at the top of the stroke and lowers it at the bottom', () => {
    const top = flapPose(0, 1).wing.elevation;
    const bottom = flapPose(DOWNSTROKE_FRACTION, 1).wing.elevation;
    expect(top).toBeGreaterThan(0.8);
    expect(bottom).toBeLessThan(-0.4);
  });

  it('extends the hand on the downstroke and folds it on the upstroke (figure-eight tip path)', () => {
    const downstroke = flapPose(DOWNSTROKE_FRACTION / 2, 1).wing;
    const upstroke = flapPose(DOWNSTROKE_FRACTION + (1 - DOWNSTROKE_FRACTION) / 2, 1).wing;
    expect(downstroke.handFold).toBeLessThan(0.2);
    expect(upstroke.handFold).toBeGreaterThan(0.8);
    expect(downstroke.primarySpread).toBeGreaterThan(upstroke.primarySpread);
    // Pronated (leading edge down) on the power stroke, supinated on the recovery.
    expect(downstroke.twist).toBeLessThan(0);
    expect(upstroke.twist).toBeGreaterThan(0);
  });

  it('lifts the body during the downstroke', () => {
    const start = flapPose(0, 1).body.bob;
    const midDown = flapPose(0.5, 1).body.bob;
    expect(midDown).toBeGreaterThan(start);
  });

  it('is continuous across the cycle wrap', () => {
    const end = flapPose(0.9999, 0.7).wing.elevation;
    const start = flapPose(0, 0.7).wing.elevation;
    expect(Math.abs(end - start)).toBeLessThan(0.01);
  });

  it('flares nose-up with wings forward, tail fanned and feet reaching for the perch', () => {
    const flare = flarePose(0.3);
    expect(flare.body.pitch).toBeGreaterThan(0.5);
    expect(flare.wing.sweep).toBeLessThan(0);
    expect(flare.body.tailSpread).toBe(1);
    expect(flare.body.legTuck).toBe(0);
    expect(flare.body.legReach).toBeGreaterThan(0.5);
  });

  it('tucks the wings along the body and stands on its legs when perched', () => {
    const perched = perchedPose();
    expect(perched.wing.sweep).toBeGreaterThan(1.2);
    expect(perched.wing.handFold).toBeGreaterThan(2);
    expect(perched.body.legTuck).toBe(0);
    expect(glidePose(0).body.legTuck).toBe(1);
  });

  it('blends poses by normalised weight', () => {
    const blended = blendPoses([[glidePose(0), 1], [perchedPose(), 1]]);
    expect(blended.wing.sweep).toBeCloseTo((glidePose(0).wing.sweep + perchedPose().wing.sweep) / 2);
  });

  it('flaps faster when working hard and slower with long wings', () => {
    expect(flapFrequency(1, 1)).toBeGreaterThan(flapFrequency(0, 1));
    expect(flapFrequency(0.5, 1.5)).toBeLessThan(flapFrequency(0.5, 1));
  });
});

describe('procedural bird rig', () => {
  it('builds every profile with two jointed wings and settles into a perched pose', () => {
    for (const profile of ['pigeon', 'dove', 'eagle'] as const) {
      const rig = new BirdRig(profile);
      for (let index = 0; index < 60; index += 1) rig.update(1 / 30, { mode: 'perched', flapDemand: 0 });
      expect(rig.pose.wing.handFold).toBeGreaterThan(2);
      let meshes = 0;
      rig.root.traverse(object => { if ((object as { isMesh?: boolean }).isMesh) meshes += 1; });
      expect(meshes).toBeGreaterThan(30);
      rig.dispose();
    }
  });

  it('moves from glide to flapping when asked to climb', () => {
    const rig = new BirdRig('pigeon');
    const elevations: number[] = [];
    for (let index = 0; index < 90; index += 1) {
      rig.update(1 / 60, { mode: 'flight', flapDemand: 1 });
      elevations.push(rig.pose.wing.elevation);
    }
    expect(Math.max(...elevations) - Math.min(...elevations)).toBeGreaterThan(0.8);
    rig.dispose();
  });
});
