import { describe, expect, it } from 'vitest';
import {
  decodeTerrariumElevation,
  geographicToTileFraction,
  sampleTerrainColor,
  terrainCoverageMetres,
} from '../src/game/AerialImageryGround';
import { Color } from 'three';

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

  it('renders DEM terrain with game materials instead of aerial imagery', () => {
    const lowland = sampleTerrainColor(25, 0.02, 100, 100, new Color());
    const steepHighland = sampleTerrainColor(360, 0.55, 100, 100, new Color());
    expect(lowland.getHex()).not.toBe(steepHighland.getHex());
    expect(lowland.g).toBeGreaterThan(lowland.r);
    expect(Math.abs(steepHighland.r - steepHighland.g)).toBeLessThan(0.12);
  });

  it('covers the complete official Tai Po regional building tile', () => {
    expect(terrainCoverageMetres(22.44705)).toBeGreaterThan(17_000);
  });
});
