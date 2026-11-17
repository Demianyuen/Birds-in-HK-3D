import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENGLISH } from '../src/i18n';
import { BIRD_ORDER } from '../src/game/birdProfiles';

describe('landing page in English', () => {
  const html = readFileSync('index.html', 'utf8');
  it('has an English line for every marked element and every bird', () => {
    const keys = [...html.matchAll(/data-i18n(?:-placeholder|-aria)?="([^"]+)"/g)].map(match => match[1]);
    expect(keys.length).toBeGreaterThan(20);
    for (const key of keys) expect(ENGLISH[key], key).toBeTruthy();
    for (const id of BIRD_ORDER) {
      expect(ENGLISH[`bird.${id}.label`]).toBeTruthy();
      expect(ENGLISH[`bird.${id}.note`]).toBeTruthy();
    }
  });
});
