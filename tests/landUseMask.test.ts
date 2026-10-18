import { describe, expect, it } from 'vitest';
import { classifyMaskTexel, MASK_LEVELS } from '../src/game/LandUseMask';
import { treeProbability } from '../src/game/StylizedTrees';

describe('vector land-use mask', () => {
  it('decodes every encoded level back to its land-use class', () => {
    expect(classifyMaskTexel(MASK_LEVELS.majorRoad, 0, 0, 0)).toBe('road');
    expect(classifyMaskTexel(MASK_LEVELS.localRoad, MASK_LEVELS.woodland, 0, 0)).toBe('road');
    expect(classifyMaskTexel(0, 0, MASK_LEVELS.water, 0)).toBe('water');
    expect(classifyMaskTexel(0, MASK_LEVELS.woodland, 0, 0)).toBe('woodland');
    expect(classifyMaskTexel(0, MASK_LEVELS.grass, 0, 0)).toBe('green');
    expect(classifyMaskTexel(0, MASK_LEVELS.pitch, 0, 0)).toBe('green');
    expect(classifyMaskTexel(0, 0, MASK_LEVELS.sand, 0)).toBe('sand');
    expect(classifyMaskTexel(0, 0, 0, MASK_LEVELS.built)).toBe('footprint');
    expect(classifyMaskTexel(0, 0, 0, 0)).toBe('land');
  });

  it('lets roads cross water (bridges) and water win over sand', () => {
    expect(classifyMaskTexel(MASK_LEVELS.distributor, 0, MASK_LEVELS.water, 0)).toBe('road');
    expect(classifyMaskTexel(0, 0, Math.max(MASK_LEVELS.sand, MASK_LEVELS.water), 0)).toBe('water');
  });

  it('treats footpaths as open land rather than road so trails do not block woodland', () => {
    expect(classifyMaskTexel(MASK_LEVELS.path, MASK_LEVELS.woodland, 0, 0)).toBe('woodland');
  });

  it('keeps encoded bands far enough apart to survive texture filtering', () => {
    const roadBands = [MASK_LEVELS.path, MASK_LEVELS.localRoad, MASK_LEVELS.distributor, MASK_LEVELS.majorRoad];
    const greenBands = [MASK_LEVELS.pitch, MASK_LEVELS.grass, MASK_LEVELS.woodland];
    for (const bands of [roadBands, greenBands, [MASK_LEVELS.sand, MASK_LEVELS.water]]) {
      for (let index = 1; index < bands.length; index += 1) {
        expect(bands[index] - bands[index - 1]).toBeGreaterThanOrEqual(50);
      }
    }
  });
});

describe('tree placement', () => {
  it('grows dense woodland, sparse parks and almost no trees on streets or estates', () => {
    expect(treeProbability('woodland', false, 0.5)).toBeGreaterThan(0.8);
    expect(treeProbability('green', false, 0.5)).toBeLessThan(0.3);
    expect(treeProbability('green', true, 0.5)).toBeGreaterThan(treeProbability('green', false, 0.5));
    expect(treeProbability('footprint', false, 0.5)).toBeLessThan(0.05);
    expect(treeProbability('road', true, 1)).toBe(0);
    expect(treeProbability('water', true, 1)).toBe(0);
    expect(treeProbability('sand', true, 1)).toBe(0);
  });
});
