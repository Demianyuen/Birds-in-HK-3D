import { describe, expect, it } from 'vitest';
import { flowersToGather } from '../src/openWorld/gatherFlowers';
import { MEMORIAL_PLAZA } from '../src/openWorld/contentRules';

describe('gathering flowers from the former squares', () => {
  const flowers = [
    { id: 'a', x: -10, z: 4 }, // middle of a former square
    { id: 'b', x: -52, z: -40 }, // laid beside a tower on purpose
    { id: 'c', x: MEMORIAL_PLAZA.x + 3, z: MEMORIAL_PLAZA.z }, // already on the present square
    { id: 'd', x: 44, z: -4 }, // on the other former square, off the present one
  ];

  it('moves only flowers left on a former square', () => {
    expect(flowersToGather(flowers).map(flower => flower.id)).toEqual(['a', 'd']);
  });

  it('sets them down on the present square, between the flower ring and the benches', () => {
    for (const flower of flowersToGather(flowers)) {
      const away = Math.hypot(flower.x - MEMORIAL_PLAZA.x, flower.z - MEMORIAL_PLAZA.z);
      expect(away).toBeGreaterThan(5);
      expect(away).toBeLessThan(11);
    }
  });

  it('changes nothing more when run again', () => {
    const once = flowersToGather(flowers);
    const after = flowers.map(flower => once.find(moved => moved.id === flower.id) ?? flower);
    expect(flowersToGather(after)).toEqual([]);
  });
});
