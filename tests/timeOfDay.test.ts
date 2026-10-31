import { describe, expect, it } from 'vitest';
import { isTimeOfDay, lightingFor, mixLighting, TIME_OF_DAY_LABELS } from '../src/game/timeOfDay';

describe('time of day', () => {
  it('keeps daylight as it was and puts the dusk sun low in the west, warm and dimmer', () => {
    const day = lightingFor('day');
    const dusk = lightingFor('dusk');
    expect(day.sunElevation).toBe(27);
    expect(dusk.sunElevation).toBeLessThan(12);
    expect(Math.sin((dusk.sunAzimuth * Math.PI) / 180)).toBeLessThan(-0.8); // -x is west
    expect(dusk.sunColour.r).toBeGreaterThan(dusk.sunColour.b * 2);
    expect(dusk.surfaceTint.b).toBeLessThan(day.surfaceTint.b);
    expect(dusk.flowerGlow).toBeGreaterThan(day.flowerGlow);
    expect(dusk.fogFar).toBeLessThan(day.fogFar);
  });

  it('changes gently: half way is between the two, and the ends match exactly', () => {
    const start = mixLighting('day', 'dusk', 0);
    const middle = mixLighting('day', 'dusk', 0.5);
    const end = mixLighting('day', 'dusk', 1);
    expect(start.sunElevation).toBe(lightingFor('day').sunElevation);
    expect(end.sunElevation).toBe(lightingFor('dusk').sunElevation);
    expect(middle.sunElevation).toBeCloseTo((27 + lightingFor('dusk').sunElevation) / 2, 5);
    expect(middle.horizon.g).toBeLessThan(start.horizon.g);
    expect(middle.horizon.g).toBeGreaterThan(end.horizon.g);
    expect(mixLighting('day', 'dusk', 2).exposure).toBe(end.exposure);
  });

  it('names the times in Chinese and recognises saved values', () => {
    expect(TIME_OF_DAY_LABELS).toEqual({ day: '日光', dusk: '黃昏' });
    expect(isTimeOfDay('dusk')).toBe(true);
    expect(isTimeOfDay('night')).toBe(false);
  });
});
