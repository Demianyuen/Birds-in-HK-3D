import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BIRD_ORDER, BIRD_PROFILES, getBirdProfile, isBirdProfileId } from '../src/game/birdProfiles';
import { BIRD_CALLS } from '../src/game/BirdVoice';
import { BirdRig } from '../src/game/BirdRig';

describe('everyday Hong Kong birds', () => {
  it('offers six species, the spotted dove first, each with a name, a note and a call', () => {
    expect(BIRD_ORDER[0]).toBe('spotted');
    expect(BIRD_ORDER.map(id => BIRD_PROFILES[id].label)).toEqual(['珠頸斑鳩', '灰鴿', '白鴿', '麻雀', '喜鵲', '麻鷹']);
    for (const id of BIRD_ORDER) {
      expect(BIRD_PROFILES[id].note).toBeTruthy();
      expect(BIRD_CALLS[id].length).toBeGreaterThan(0);
      // Ids travel between visitors in a field that only allows lowercase letters.
      expect(id).toMatch(/^[a-z]{1,16}$/);
      expect(() => new BirdRig(id)).not.toThrow();
    }
    expect(getBirdProfile('dragon').id).toBe('spotted');
    expect(isBirdProfileId('white')).toBe(false);
  });

  it('the spotted dove coos in three parts: short, long, short', () => {
    const [first, second, third] = BIRD_CALLS.spotted;
    expect(BIRD_CALLS.spotted).toHaveLength(3);
    expect(second.length).toBeGreaterThan(first.length);
    expect(second.length).toBeGreaterThan(third.length);
    expect(first.from).toBeLessThan(900);
  });

  it('no longer asks visitors for a feather colour', () => {
    expect(readFileSync('index.html', 'utf8')).not.toContain('plumage-picker');
  });
});
