/**
 * Phones and tablets get a lighter world so the page stays smooth and is not
 * closed by the browser for using too much memory (Safari on iPhone does that).
 */
export interface DeviceTier {
  phone: boolean;
  /** Highest render pixel ratio. */
  maxPixelRatio: number;
  antialias: boolean;
  shadowMapSize: number;
  bloom: boolean;
  /** Share of the traffic and the crowd that is drawn (0–1). */
  streetDensity: number;
  /** 3D-tile screen-space error: larger loads coarser tiles (less to download and keep). */
  photoMeshError: number;
  csdiError: number;
  /** Most tile data kept in memory, in bytes. */
  tileCacheBytes: number;
}

export function tierFor(touchFirst: boolean, devicePixelRatio: number): DeviceTier {
  if (touchFirst) {
    return {
      phone: true, maxPixelRatio: Math.min(devicePixelRatio || 1, 1.25), antialias: false, shadowMapSize: 1_024, bloom: false,
      streetDensity: 0.45, photoMeshError: 20, csdiError: 24, tileCacheBytes: 160 * 1_048_576,
    };
  }
  return {
    phone: false, maxPixelRatio: Math.min(devicePixelRatio || 1, 1.5), antialias: true, shadowMapSize: 2_048, bloom: true,
    streetDensity: 1, photoMeshError: 8, csdiError: 16, tileCacheBytes: 400 * 1_048_576,
  };
}

let cached: DeviceTier | null = null;

export function deviceTier(): DeviceTier {
  if (cached) return cached;
  let touchFirst = false;
  try {
    touchFirst = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  } catch {
    // no matchMedia: treat as a computer
  }
  cached = tierFor(touchFirst, window.devicePixelRatio || 1);
  return cached;
}
