import { Color, MathUtils } from 'three';

/**
 * Light for the two times of day visitors can choose: the bright late-afternoon
 * look (日光) and the warm, low sun of dusk (黃昏). A night with rain comes later.
 *
 * The aerial photo mesh is drawn unlit (its light is baked into the photos), so it
 * is warmed and dimmed with `surfaceTint`; everything lit by the sun follows the sun.
 */
export type TimeOfDay = 'day' | 'dusk';
export const TIMES_OF_DAY: readonly TimeOfDay[] = ['day', 'dusk'];

export const TIME_OF_DAY_LABELS: Readonly<Record<TimeOfDay, string>> = Object.freeze({
  day: '日光',
  dusk: '黃昏',
});

interface LightingSpec {
  zenith: string;
  horizon: string;
  ground: string;
  sunGlow: string;
  /** Degrees above the horizon, and compass bearing (0 = +z / south, 90 = +x / east). */
  sunElevation: number;
  sunAzimuth: number;
  sunColour: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  fogColour: string;
  fogNear: number;
  fogFar: number;
  exposure: number;
  warmth: [number, number, number];
  shadowTint: [number, number, number];
  saturation: number;
  vignette: number;
  bloom: number;
  surfaceTint: string;
  cloudGlow: string;
  /** How strongly flowers and lanterns glow (1 = daylight). */
  flowerGlow: number;
}

const SPECS: Readonly<Record<TimeOfDay, LightingSpec>> = Object.freeze({
  day: {
    zenith: '#3d7fc6', horizon: '#f1dcc4', ground: '#a7aa9c', sunGlow: '#ffd29a',
    sunElevation: 27, sunAzimuth: 218, sunColour: '#ffd9a6', sunIntensity: 3.0,
    hemiSky: '#cfe6f2', hemiGround: '#5d6b4a', hemiIntensity: 0.85,
    fogColour: '#f1dcc4', fogNear: 1_400, fogFar: 8_500, exposure: 0.92,
    warmth: [1.07, 1.0, 0.9], shadowTint: [0.55, 0.7, 1.0], saturation: 1.1, vignette: 0.2, bloom: 0.38,
    surfaceTint: '#ffffff', cloudGlow: '#9fb6c8', flowerGlow: 1,
  },
  dusk: {
    zenith: '#34497e', horizon: '#f2a86e', ground: '#7a6262', sunGlow: '#ffb066',
    sunElevation: 7, sunAzimuth: 250, sunColour: '#ff9d5c', sunIntensity: 2.3,
    hemiSky: '#b8a6c4', hemiGround: '#4a3d3a', hemiIntensity: 0.6,
    fogColour: '#dc9f80', fogNear: 900, fogFar: 6_500, exposure: 0.88,
    warmth: [1.13, 0.97, 0.83], shadowTint: [0.5, 0.58, 1.0], saturation: 1.14, vignette: 0.3, bloom: 0.55,
    surfaceTint: '#e8b99c', cloudGlow: '#d69a86', flowerGlow: 1.6,
  },
});

/** Resolved light, ready to apply (colours as linear three.js colours). */
export interface Lighting {
  zenith: Color;
  horizon: Color;
  ground: Color;
  sunGlow: Color;
  sunElevation: number;
  sunAzimuth: number;
  sunColour: Color;
  sunIntensity: number;
  hemiSky: Color;
  hemiGround: Color;
  hemiIntensity: number;
  fogColour: Color;
  fogNear: number;
  fogFar: number;
  exposure: number;
  warmth: [number, number, number];
  shadowTint: [number, number, number];
  saturation: number;
  vignette: number;
  bloom: number;
  surfaceTint: Color;
  cloudGlow: Color;
  flowerGlow: number;
}

const COLOUR_KEYS = ['zenith', 'horizon', 'ground', 'sunGlow', 'sunColour', 'hemiSky', 'hemiGround', 'fogColour', 'surfaceTint', 'cloudGlow'] as const;
const NUMBER_KEYS = ['sunElevation', 'sunAzimuth', 'sunIntensity', 'hemiIntensity', 'fogNear', 'fogFar', 'exposure', 'saturation', 'vignette', 'bloom', 'flowerGlow'] as const;

export function lightingFor(time: TimeOfDay): Lighting {
  return mixLighting(time, time, 0);
}

/** Light part way from `from` to `to` (t from 0 to 1), for a gentle change of time. */
export function mixLighting(from: TimeOfDay, to: TimeOfDay, t: number): Lighting {
  const a = SPECS[from];
  const b = SPECS[to];
  const k = MathUtils.clamp(t, 0, 1);
  const result = {} as Record<string, unknown>;
  for (const key of COLOUR_KEYS) result[key] = new Color(a[key]).lerp(new Color(b[key]), k);
  for (const key of NUMBER_KEYS) result[key] = MathUtils.lerp(a[key], b[key], k);
  result.warmth = a.warmth.map((value, index) => MathUtils.lerp(value, b.warmth[index], k));
  result.shadowTint = a.shadowTint.map((value, index) => MathUtils.lerp(value, b.shadowTint[index], k));
  return result as unknown as Lighting;
}

export function isTimeOfDay(value: unknown): value is TimeOfDay {
  return value === 'day' || value === 'dusk';
}
