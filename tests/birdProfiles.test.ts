import { describe, expect, it } from 'vitest';
import { BIRD_PROFILES, getBirdProfile } from '../src/game/birdProfiles';

describe('bird performance profiles', () => {
  it('provides six bounded birds', () => {
    expect(Object.keys(BIRD_PROFILES)).toEqual(['spotted', 'pigeon', 'dove', 'sparrow', 'magpie', 'eagle']);
    for (const profile of Object.values(BIRD_PROFILES)) {
      expect(profile.minimumSpeed).toBeGreaterThan(0);
      expect(profile.cruiseSpeed).toBeGreaterThan(profile.minimumSpeed);
      expect(profile.maximumSpeed).toBeGreaterThan(profile.cruiseSpeed);
      expect(profile.modelPath).toMatch(/^\/models\/[a-z-]+\.glb$/);
    }
  });

  it('falls back to the spotted dove', () => {
    expect(getBirdProfile('unknown').id).toBe('spotted');
  });
});
