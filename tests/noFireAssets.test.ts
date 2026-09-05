import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CITY_STYLE_MODELS } from '../src/city-style/modelCatalog';

describe('no-fire public experience', () => {
  it('does not load any fire model or animation', () => {
    expect(JSON.stringify(CITY_STYLE_MODELS)).not.toMatch(/fire|brazier|flame/i);
    const world = readFileSync('src/city-style/CityStyleWorld.ts', 'utf8');
    expect(world).not.toMatch(/'fire'|animated\.light/);
  });

  it('does not publish the retired asset from the public directory', () => {
    expect(existsSync('public/models/city-style/street/fire-brazier.glb')).toBe(false);
  });
});
