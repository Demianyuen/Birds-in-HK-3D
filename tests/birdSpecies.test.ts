import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BIRD_ORDER, BIRD_PROFILES, getBirdProfile, isBirdProfileId } from '../src/game/birdProfiles';
import { BirdRig } from '../src/game/BirdRig';

describe('everyday Hong Kong birds', () => {
  it('offers six species, the spotted dove first, each with a name and a note', () => {
    expect(BIRD_ORDER[0]).toBe('spotted');
    expect(BIRD_ORDER.map(id => BIRD_PROFILES[id].label)).toEqual(['珠頸斑鳩', '灰鴿', '白鴿', '麻雀', '喜鵲', '麻鷹']);
    for (const id of BIRD_ORDER) {
      expect(BIRD_PROFILES[id].note).toBeTruthy();
      // Ids travel between visitors in a field that only allows lowercase letters.
      expect(id).toMatch(/^[a-z]{1,16}$/);
      expect(() => new BirdRig(id)).not.toThrow();
    }
    expect(getBirdProfile('dragon').id).toBe('spotted');
    expect(isBirdProfileId('white')).toBe(false);
  });

  it('no longer asks visitors for a feather colour', () => {
    expect(readFileSync('index.html', 'utf8')).not.toContain('plumage-picker');
    expect(readFileSync('index.html', 'utf8')).not.toContain('bird-call');
  });
});
