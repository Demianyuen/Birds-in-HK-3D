/**
 * Pure wing and body kinematics for the procedural bird rig (radians).
 *
 * Based on how pigeons and doves actually fly:
 * - Downstroke (~55% of the cycle) is the power stroke: the wing is fully
 *   extended, sweeps slightly forward and pronates (leading edge down).
 * - Upstroke folds the hand back at the wrist and flexes the arm, so the
 *   wingtip traces a figure-eight and the wing slips up with little drag.
 * - The body rises during the downstroke and dips during the upstroke.
 * - Between bursts of flapping the wings are held out in a shallow dihedral
 *   glide; on landing the body pitches up, the wings are thrown forward and
 *   beat in short braking strokes, the tail fans down and the feet reach out.
 */

export interface WingPose {
  /** Raise (+) / lower (−) about the body's long axis. */
  elevation: number;
  /** Sweep of the whole wing backwards (+) or forwards (−). */
  sweep: number;
  /** Rotation about the span: + raises the leading edge (supination). */
  twist: number;
  /** Hand folded back at the wrist (0 = straight, ~2.6 = tucked along the body). */
  handFold: number;
  /** Hand raised (+) / dropped (−) relative to the arm. */
  handElevation: number;
  /** Primary feathers fanned (1) or stacked (0). */
  primarySpread: number;
}

export interface BodyPose {
  /** Vertical offset of the whole rig (metres). */
  bob: number;
  /** Visual nose-up (+) pitch on top of the flight orientation. */
  pitch: number;
  tailSpread: number;
  /** Tail raised (+) / lowered (−). */
  tailPitch: number;
  /** 0 = legs hanging/standing, 1 = tucked under the tail for flight. */
  legTuck: number;
  /** Legs swung forward for touchdown (radians). */
  legReach: number;
}

export interface BirdPose {
  wing: WingPose;
  body: BodyPose;
}

export const DOWNSTROKE_FRACTION = 0.55;

const GLIDE: BirdPose = {
  wing: { elevation: 0.14, sweep: 0.14, twist: -0.03, handFold: 0.16, handElevation: 0.06, primarySpread: 0.75 },
  body: { bob: 0, pitch: 0, tailSpread: 0.35, tailPitch: 0.02, legTuck: 1, legReach: 0 },
};

const PERCHED: BirdPose = {
  wing: { elevation: -0.3, sweep: 1.42, twist: 0.05, handFold: 2.6, handElevation: -0.08, primarySpread: 0 },
  body: { bob: 0, pitch: 0.12, tailSpread: 0.05, tailPitch: -0.12, legTuck: 0, legReach: 0 },
};

function easeInOut(value: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * value);
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

/** Flapping pose at cycle phase 0–1. `intensity` 0–1 scales stroke amplitude (cruise vs. take-off). */
export function flapPose(phase: number, intensity: number): BirdPose {
  const p = ((phase % 1) + 1) % 1;
  const amplitude = lerp(0.62, 1, Math.min(1, Math.max(0, intensity)));
  const top = 0.98 * amplitude + 0.1;
  const bottom = -0.62 * amplitude + 0.05;
  let elevation: number;
  let sweep: number;
  let twist: number;
  let handFold: number;
  let handElevation: number;
  let primarySpread: number;
  if (p < DOWNSTROKE_FRACTION) {
    const u = p / DOWNSTROKE_FRACTION;
    const stroke = Math.sin(Math.PI * u);
    elevation = lerp(top, bottom, easeInOut(u));
    sweep = 0.06 - 0.22 * stroke;
    twist = -0.26 * stroke;
    handFold = 0.05;
    handElevation = 0.2 * stroke;
    primarySpread = 1;
  } else {
    const u = (p - DOWNSTROKE_FRACTION) / (1 - DOWNSTROKE_FRACTION);
    const stroke = Math.sin(Math.PI * u);
    elevation = lerp(bottom, top, easeInOut(u));
    sweep = 0.06 + 0.42 * stroke;
    twist = 0.22 * stroke;
    handFold = 0.05 + 1.05 * stroke * amplitude;
    handElevation = -0.42 * stroke;
    primarySpread = 0.25;
  }
  const bob = -0.13 * amplitude * Math.cos(2 * Math.PI * p);
  return {
    wing: { elevation, sweep, twist, handFold, handElevation, primarySpread },
    body: {
      bob,
      pitch: 0.04 * amplitude * Math.sin(2 * Math.PI * p),
      tailSpread: 0.45 + 0.25 * amplitude,
      tailPitch: 0.06 * Math.sin(2 * Math.PI * p + 1.2),
      legTuck: 1,
      legReach: 0,
    },
  };
}

export function glidePose(timeSeconds: number): BirdPose {
  const wobble = Math.sin(timeSeconds * 1.7) * 0.025 + Math.sin(timeSeconds * 3.1) * 0.012;
  return {
    wing: { ...GLIDE.wing, elevation: GLIDE.wing.elevation + wobble, twist: GLIDE.wing.twist + wobble * 0.4 },
    body: { ...GLIDE.body },
  };
}

/** Landing flare: short, fast braking strokes with the wings thrown forward and the body pitched up. */
export function flarePose(timeSeconds: number): BirdPose {
  const beat = Math.sin(timeSeconds * 2 * Math.PI * 6.5);
  return {
    wing: {
      elevation: 0.62 + 0.4 * beat,
      sweep: -0.38,
      twist: 0.5 + 0.12 * beat,
      handFold: 0.12 + 0.1 * Math.max(0, beat),
      handElevation: 0.12,
      primarySpread: 1,
    },
    body: { bob: 0.04 * beat, pitch: 0.78, tailSpread: 1, tailPitch: -0.5, legTuck: 0, legReach: 0.75 },
  };
}

export function perchedPose(): BirdPose {
  return { wing: { ...PERCHED.wing }, body: { ...PERCHED.body } };
}

/** Weighted blend of poses; weights need not sum to 1 (they are normalised). */
export function blendPoses(entries: ReadonlyArray<readonly [BirdPose, number]>): BirdPose {
  const total = entries.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0) || 1;
  const result: BirdPose = {
    wing: { elevation: 0, sweep: 0, twist: 0, handFold: 0, handElevation: 0, primarySpread: 0 },
    body: { bob: 0, pitch: 0, tailSpread: 0, tailPitch: 0, legTuck: 0, legReach: 0 },
  };
  for (const [pose, rawWeight] of entries) {
    const weight = Math.max(0, rawWeight) / total;
    if (weight === 0) continue;
    for (const key of Object.keys(result.wing) as (keyof WingPose)[]) result.wing[key] += pose.wing[key] * weight;
    for (const key of Object.keys(result.body) as (keyof BodyPose)[]) result.body[key] += pose.body[key] * weight;
  }
  return result;
}

/** Flap frequency (Hz): slowed slightly from a real pigeon's ~6 Hz so strokes read at game distance. */
export function flapFrequency(intensity: number, wingspanScale: number): number {
  const base = lerp(3.6, 5.2, Math.min(1, Math.max(0, intensity)));
  // Larger wings beat more slowly (a black kite flaps at roughly half a pigeon's rate).
  return base / Math.max(0.6, wingspanScale);
}
