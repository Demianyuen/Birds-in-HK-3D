import { createEcefToLocalMatrix, geodeticToEcef } from './geo';

/** Official address markers retrieved 2026-09-06; not surveyed footprints or historic appearance. */
export const WANG_FUK_ADDRESS_POINTS = [
  { block: 'A', name: '宏仁閣', latitude: 22.44727, longitude: 114.17494, easting: 836069, northing: 834204 },
  { block: 'B', name: '宏道閣', latitude: 22.44696, longitude: 114.17504, easting: 836079, northing: 834169 },
  { block: 'C', name: '宏新閣', latitude: 22.44672, longitude: 114.17531, easting: 836107, northing: 834143 },
  { block: 'D', name: '宏建閣', latitude: 22.44671, longitude: 114.17567, easting: 836144, northing: 834142 },
  { block: 'E', name: '宏泰閣', latitude: 22.4465, longitude: 114.1759, easting: 836168, northing: 834118 },
  { block: 'F', name: '宏昌閣', latitude: 22.44651, longitude: 114.17628, easting: 836207, northing: 834120 },
  { block: 'G', name: '宏盛閣', latitude: 22.44687, longitude: 114.17626, easting: 836205, northing: 834159 },
  { block: 'H', name: '宏志閣', latitude: 22.44725, longitude: 114.17618, easting: 836197, northing: 834202 },
] as const;

export function wangFukLocalMarkers(latitude: number, longitude: number) {
  const transform = createEcefToLocalMatrix(latitude, longitude);
  return WANG_FUK_ADDRESS_POINTS.map(point => ({
    ...point,
    position: geodeticToEcef(point.latitude, point.longitude).applyMatrix4(transform),
  }));
}
