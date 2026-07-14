import { describe, expect, it } from 'vitest';
import {
  decodeTerrariumElevation,
  geographicToTileFraction,
} from '../src/game/AerialImageryGround';

describe('Tai Po terrain data', () => {
  it('decodes Terrarium RGB elevation in metres', () => {
    expect(decodeTerrariumElevation(128, 0, 0)).toBe(0);
    expect(decodeTerrariumElevation(128, 100, 128)).toBe(100.5);
    expect(decodeTerrariumElevation(127, 255, 0)).toBe(-1);
  });

  it('maps Wang Fuk Court to the verified LandsD imagery tile', () => {
    const tile = geographicToTileFraction(22.44705, 114.17544, 16);
    expect(Math.floor(tile.x)).toBe(53_553);
    expect(Math.floor(tile.y)).toBe(28_572);
  });
});
