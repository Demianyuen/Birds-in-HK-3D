import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyPlumage } from '../src/game/BirdRig';
import { getPlumage, PLUMAGES } from '../src/game/birdProfiles';
import { FLOWER_KINDS, isFlowerKind } from '../src/openWorld/contentRules';
import { FLOWER_LABELS } from '../src/openWorld/visitor';

const pigeon = {
  body: '#97a0ad', breast: '#8a90a0', rump: '#b8bfc9', head: '#8c94a3', neck: '#3f8a6c', neckSheen: '#7a4f8f',
  coverts: '#a9b1bc', wingBar: '#2c3036', secondaries: '#9aa2ae', primaries: '#4a4f58', primaryPatch: null,
  tail: '#8b929e', tailTip: '#2b2e34', beak: '#2b2b2b', cere: '#ece9e1', eye: '#e2782c', legs: '#c25a5d',
};

describe('bird colours', () => {
  it('keeps the species colours for 原色 and recolours feathers, not beak, eyes or legs', () => {
    expect(applyPlumage(pigeon, getPlumage('natural'))).toBe(pigeon);
    const white = applyPlumage(pigeon, getPlumage('white'));
    expect(white.body).not.toBe(pigeon.body);
    expect(white.primaries).toBe('#d9dbd6');
    expect(white.beak).toBe(pigeon.beak);
    expect(white.eye).toBe(pigeon.eye);
    expect(white.legs).toBe(pigeon.legs);
  });

  it('offers six colours with Chinese names and falls back to 原色', () => {
    expect(PLUMAGES.map(plumage => plumage.label)).toEqual(['原色', '純白', '銀灰', '米白', '啡褐', '墨黑']);
    expect(getPlumage('rainbow').id).toBe('natural');
  });
});

describe('flowers of remembrance', () => {
  it('has more white flowers, each named, and the database migration lists exactly the same kinds', () => {
    expect(FLOWER_KINDS).toEqual(expect.arrayContaining(['white-rose', 'white-carnation', 'ginger-lily', 'white-lotus', 'white-orchid']));
    for (const kind of FLOWER_KINDS) {
      expect(isFlowerKind(kind)).toBe(true);
      expect(FLOWER_LABELS[kind]).toBeTruthy();
    }
    const sql = readFileSync('supabase/migrations/0003_more_white_flowers.sql', 'utf8');
    const listed = [...sql.matchAll(/'([a-z-]+)'/g)].map(match => match[1]);
    expect(new Set(listed)).toEqual(new Set(FLOWER_KINDS));
  });

  it('lets visitors pick every flower on the landing page, which asks only for a name and a flower', () => {
    const html = readFileSync('index.html', 'utf8');
    for (const kind of FLOWER_KINDS) expect(html).toContain(`name="flower-kind" value="${kind}"`);
    expect(html).not.toContain('id="visitor-message"');
  });
});
