import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FLIGHT_REGION_ID,
  FLIGHT_REGIONS,
  getFlightRegion,
} from '../src/game/regions';

describe('official Hong Kong flight regions', () => {
  it('uses the verified Tai Po regional tileset for the first playable slice', () => {
    const region = getFlightRegion(DEFAULT_FLIGHT_REGION_ID);
    expect(region.id).toBe('tai-po');
    expect(region.csdiTiles.building).toBe(
      'Data/F_Tile_+4_3_0/F_Tile_+4_3_0+R9_0.json',
    );
    expect(region.latitude).toBeCloseTo(22.44705, 5);
    expect(region.longitude).toBeCloseTo(114.17544, 5);
  });

  it('defines independent official tiles for Hong Kong and Kowloon regions', () => {
    expect(new Set(FLIGHT_REGIONS.map(region => region.id)).size).toBe(FLIGHT_REGIONS.length);
    expect(getFlightRegion('central').csdiTiles.building).toContain('F_Tile_+3_1_0');
    expect(getFlightRegion('tsim-sha-tsui').csdiTiles.building).toContain('F_Tile_+4_1_0');
  });

  it('contains no procedural building source', () => {
    expect(JSON.stringify(FLIGHT_REGIONS)).not.toMatch(/stylized|procedural|fallback/i);
  });
});
