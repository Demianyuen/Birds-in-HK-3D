import { describe, expect, it } from 'vitest';
import { stickAxis } from '../src/game/TouchFlightControls';

describe('drag-to-steer stick', () => {
  it('ignores a resting thumb and small jitters', () => {
    expect(stickAxis(0)).toBe(0);
    expect(stickAxis(6)).toBe(0);
    expect(stickAxis(-6)).toBe(0);
  });

  it('turns gently for a small drag and fully at the rim, the same both ways', () => {
    expect(stickAxis(24)).toBeGreaterThan(0);
    expect(stickAxis(24)).toBeLessThan(0.3);
    expect(stickAxis(72)).toBeCloseTo(1);
    expect(stickAxis(500)).toBeCloseTo(1);
    expect(stickAxis(-40)).toBeCloseTo(-stickAxis(40));
  });
});
