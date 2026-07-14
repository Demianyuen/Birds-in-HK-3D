export type FlightRegionId = 'tai-po' | 'sha-tin' | 'central' | 'tsim-sha-tsui';
export type CsdiRegionLayer = 'building' | 'infrastructure';

export interface FlightRegion {
  id: FlightRegionId;
  label: string;
  englishLabel: string;
  latitude: number;
  longitude: number;
  flightRadiusMetres: number;
  csdiTiles: Record<CsdiRegionLayer, string>;
}

export const FLIGHT_REGIONS: readonly FlightRegion[] = Object.freeze([
  {
    id: 'tai-po',
    label: '大埔 · 宏福苑',
    englishLabel: 'TAI PO',
    latitude: 22.44705,
    longitude: 114.17544,
    flightRadiusMetres: 3_200,
    csdiTiles: {
      building: 'Data/F_Tile_+4_3_0/F_Tile_+4_3_0+R9_0.json',
      infrastructure: 'Data/F_Tile_+4_3_0/F_Tile_+4_3_0+R9_0.json',
    },
  },
  {
    id: 'sha-tin',
    label: '沙田',
    englishLabel: 'SHA TIN',
    latitude: 22.381,
    longitude: 114.188,
    flightRadiusMetres: 3_200,
    csdiTiles: {
      building: 'Data/F_Tile_+4_3_0/F_Tile_+4_3_0+R9_0.json',
      infrastructure: 'Data/F_Tile_+4_2_0/F_Tile_+4_2_0+R9_0.json',
    },
  },
  {
    id: 'central',
    label: '中環',
    englishLabel: 'CENTRAL',
    latitude: 22.2819,
    longitude: 114.1589,
    flightRadiusMetres: 2_800,
    csdiTiles: {
      building: 'Data/F_Tile_+3_1_0/F_Tile_+3_1_0+R9_0.json',
      infrastructure: 'Data/F_Tile_+3_0_0/F_Tile_+3_0_0+R9_0.json',
    },
  },
  {
    id: 'tsim-sha-tsui',
    label: '尖沙咀 · 維港',
    englishLabel: 'TSIM SHA TSUI',
    latitude: 22.2974,
    longitude: 114.1722,
    flightRadiusMetres: 2_800,
    csdiTiles: {
      building: 'Data/F_Tile_+4_1_0/F_Tile_+4_1_0+R9_0.json',
      infrastructure: 'Data/F_Tile_+4_1_0/F_Tile_+4_1_0+R9_0.json',
    },
  },
]);

export const DEFAULT_FLIGHT_REGION_ID: FlightRegionId = 'tai-po';

export function getFlightRegion(id: string | null | undefined): FlightRegion {
  return FLIGHT_REGIONS.find(region => region.id === id)
    ?? FLIGHT_REGIONS.find(region => region.id === DEFAULT_FLIGHT_REGION_ID)
    ?? FLIGHT_REGIONS[0];
}
