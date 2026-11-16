import { MEMORIAL_PLAZA } from './contentRules.js';

/** Where the square stood before it moved to the middle of the estate (local metres). */
export const FORMER_SQUARES = Object.freeze([
  Object.freeze({ x: -10, z: 4, radius: 20 }),
  Object.freeze({ x: 28, z: -6, radius: 20 }),
]);

/** Flowers are gathered between the dark flower ring and the benches. */
const GATHER_INNER = 5.5;
const GATHER_OUTER = 10.5;
/** Just above the paving of the square (grounds about 6.8 m, measured on the live map). */
export const GATHER_HEIGHT = 7;

export interface FlowerSpot {
  id: string;
  x: number;
  z: number;
}

function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

/**
 * Flowers laid on a former square, with the place each takes on the present one.
 * A flower already on the present square, or laid anywhere else on purpose
 * (beside a tower, on a path), stays where its visitor put it. The new place
 * depends only on the flower's id, so running this twice changes nothing more.
 */
export function flowersToGather(flowers: readonly FlowerSpot[]): Array<{ id: string; x: number; z: number; y: number }> {
  const moved: Array<{ id: string; x: number; z: number; y: number }> = [];
  for (const flower of flowers) {
    const onPresent = Math.hypot(flower.x - MEMORIAL_PLAZA.x, flower.z - MEMORIAL_PLAZA.z) <= MEMORIAL_PLAZA.radius - 2;
    if (onPresent) continue;
    if (!FORMER_SQUARES.some(square => Math.hypot(flower.x - square.x, flower.z - square.z) <= square.radius)) continue;
    const seed = hash(flower.id);
    const angle = ((seed & 0xffff) / 0x10000) * Math.PI * 2;
    const spread = (seed >>> 16) / 0x10000;
    const radius = Math.sqrt(GATHER_INNER ** 2 + spread * (GATHER_OUTER ** 2 - GATHER_INNER ** 2));
    moved.push({
      id: flower.id,
      x: Number((MEMORIAL_PLAZA.x + Math.cos(angle) * radius).toFixed(2)),
      z: Number((MEMORIAL_PLAZA.z + Math.sin(angle) * radius).toFixed(2)),
      y: GATHER_HEIGHT,
    });
  }
  return moved;
}
