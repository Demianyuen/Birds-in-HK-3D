/**
 * Wang Fuk Court block plan: HA "Flexi 2" cruciform tower, 31 storeys, 8 flats a
 * floor around a central core of three lifts and the stair (Hong Kong Housing
 * Authority standard cruciform block, 1983). Dimensions come from the floor plan
 * the visitor supplied: two wide wings 2 × 4.83 m flats by 7.525 m deep, two narrow
 * wings 2 × 6.75 m flats by 5.374 m deep.
 *
 * Plan frame: x east, z south (the game's local frame), origin at the core centre,
 * before the block's own rotation.
 */
export type PlanPoint = readonly [number, number];

export const STOREYS = 31;
/** Typical floor-to-floor height of the 1983 HOS blocks (m). */
export const STOREY_HEIGHT = 2.8;

const HALF_CORE_X = 7.4;
const HALF_CORE_Z = 5.5;
const WIDE_HALF = 4.83;
const WIDE_DEPTH_END = 13.0;
const NARROW_HALF = 6.75;
const NARROW_DEPTH_END = 12.9;

/** Outline of the block in plan, clockwise seen from above (z south). */
export const BLOCK_OUTLINE: readonly PlanPoint[] = [
  [-WIDE_HALF, -WIDE_DEPTH_END],
  [WIDE_HALF, -WIDE_DEPTH_END],
  [WIDE_HALF, -HALF_CORE_Z],
  [HALF_CORE_X, -HALF_CORE_Z],
  [HALF_CORE_X, -NARROW_HALF],
  [NARROW_DEPTH_END, -NARROW_HALF],
  [NARROW_DEPTH_END, NARROW_HALF],
  [HALF_CORE_X, NARROW_HALF],
  [HALF_CORE_X, HALF_CORE_Z],
  [WIDE_HALF, HALF_CORE_Z],
  [WIDE_HALF, WIDE_DEPTH_END],
  [-WIDE_HALF, WIDE_DEPTH_END],
  [-WIDE_HALF, HALF_CORE_Z],
  [-HALF_CORE_X, HALF_CORE_Z],
  [-HALF_CORE_X, NARROW_HALF],
  [-NARROW_DEPTH_END, NARROW_HALF],
  [-NARROW_DEPTH_END, -NARROW_HALF],
  [-HALF_CORE_X, -NARROW_HALF],
  [-HALF_CORE_X, -HALF_CORE_Z],
  [-WIDE_HALF, -HALF_CORE_Z],
];

/** Radius that encloses the whole plan from its centre (m). */
export const BLOCK_RADIUS = Math.max(...BLOCK_OUTLINE.map(([x, z]) => Math.hypot(x, z)));

export interface BlockPose {
  x: number;
  z: number;
  /** Rotation about +Y, radians (three.js convention). */
  yaw: number;
}

/** Plan point → world, for a block at `pose`. */
export function planToWorld(pose: BlockPose, point: PlanPoint): [number, number] {
  const cos = Math.cos(pose.yaw);
  const sin = Math.sin(pose.yaw);
  return [pose.x + point[0] * cos + point[1] * sin, pose.z - point[0] * sin + point[1] * cos];
}

/** Distance from a point inside the outline to its boundary along a direction (null if none). */
export function rayToOutline(
  originX: number,
  originZ: number,
  directionX: number,
  directionZ: number,
  outline: readonly PlanPoint[] = BLOCK_OUTLINE,
): number | null {
  let nearest = Infinity;
  for (let index = 0; index < outline.length; index += 1) {
    const [ax, az] = outline[index];
    const [bx, bz] = outline[(index + 1) % outline.length];
    const edgeX = bx - ax;
    const edgeZ = bz - az;
    const denominator = directionX * edgeZ - directionZ * edgeX;
    if (Math.abs(denominator) < 1e-9) continue;
    const toX = ax - originX;
    const toZ = az - originZ;
    const along = (toX * edgeZ - toZ * edgeX) / denominator;
    const across = (toX * directionZ - toZ * directionX) / denominator;
    if (along > 1e-6 && across >= 0 && across <= 1 && along < nearest) nearest = along;
  }
  return Number.isFinite(nearest) ? nearest : null;
}

export interface ProfileSample {
  /** World direction of the ray (unit vector in x, z). */
  dx: number;
  dz: number;
  /** Distance to the first wall seen from the guessed centre; null when nothing was hit. */
  distance: number | null;
}

export interface BlockFit extends BlockPose {
  /** Mean robust error over the rays used (m); small is good. */
  error: number;
  rays: number;
}

/** Expected distance along a world ray from `origin` for a block posed at `pose`. */
function expectedDistance(pose: BlockPose, originX: number, originZ: number, dx: number, dz: number): number | null {
  // Bring the ray into plan space: inverse of planToWorld.
  const cos = Math.cos(pose.yaw);
  const sin = Math.sin(pose.yaw);
  const relX = originX - pose.x;
  const relZ = originZ - pose.z;
  const planOriginX = relX * cos - relZ * sin;
  const planOriginZ = relX * sin + relZ * cos;
  const planDirectionX = dx * cos - dz * sin;
  const planDirectionZ = dx * sin + dz * cos;
  return rayToOutline(planOriginX, planOriginZ, planDirectionX, planDirectionZ);
}

const ROBUST_LIMIT = 3;

function cost(pose: BlockPose, originX: number, originZ: number, samples: readonly ProfileSample[]): { total: number; used: number } {
  let total = 0;
  let used = 0;
  for (const sample of samples) {
    if (sample.distance === null) continue;
    const expected = expectedDistance(pose, originX, originZ, sample.dx, sample.dz);
    const error = expected === null ? ROBUST_LIMIT : Math.min(ROBUST_LIMIT, Math.abs(expected - sample.distance));
    total += error;
    used += 1;
  }
  return { total, used };
}

/**
 * Fit the block pose to a polar wall profile measured from `origin` (a point
 * inside the tower, e.g. the official address point). Coarse-to-fine search over
 * rotation and centre offset; the plan is 2-fold symmetric so rotation spans 180°.
 */
export function fitBlock(originX: number, originZ: number, samples: readonly ProfileSample[]): BlockFit | null {
  const usable = samples.filter(sample => sample.distance !== null);
  if (usable.length < 24) return null;
  let best: BlockFit | null = null;
  const consider = (x: number, z: number, yaw: number): void => {
    const { total, used } = cost({ x, z, yaw }, originX, originZ, samples);
    if (used === 0) return;
    const error = total / used;
    if (!best || error < best.error) best = { x, z, yaw, error, rays: used };
  };
  const coarse = Math.PI / 90; // 2°
  for (let yaw = 0; yaw < Math.PI; yaw += coarse) {
    for (let dx = -8; dx <= 8; dx += 2) for (let dz = -8; dz <= 8; dz += 2) consider(originX + dx, originZ + dz, yaw);
  }
  if (!best) return null;
  for (const [yawStep, shift] of [[Math.PI / 360, 0.6], [Math.PI / 1440, 0.2]] as const) {
    const centre: BlockFit = best;
    for (let yawOffset = -3; yawOffset <= 3; yawOffset += 1) {
      for (let dx = -3; dx <= 3; dx += 1) {
        for (let dz = -3; dz <= 3; dz += 1) {
          consider(centre.x + dx * shift, centre.z + dz * shift, centre.yaw + yawOffset * yawStep);
        }
      }
    }
  }
  const result: BlockFit = best;
  const turns = Math.PI;
  return { ...result, yaw: ((result.yaw % turns) + turns) % turns };
}

/** Evenly spaced world directions for probing a tower's walls. */
export function probeDirections(count = 72): Array<{ dx: number; dz: number }> {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;
    return { dx: Math.cos(angle), dz: Math.sin(angle) };
  });
}
