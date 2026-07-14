import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createRegionClippingPlanes } from '../src/game/CsdiTiles';

describe('official CSDI regional clipping', () => {
  it('keeps points inside the Tai Po flight square', () => {
    const planes = createRegionClippingPlanes(3_200);
    const inside = new Vector3(1_200, 500, -2_100);
    expect(planes.every(plane => plane.distanceToPoint(inside) >= 0)).toBe(true);
  });

  it('clips official geometry beyond the flight-area boundary', () => {
    const planes = createRegionClippingPlanes(3_200);
    const outside = new Vector3(3_201, 80, 0);
    expect(planes.some(plane => plane.distanceToPoint(outside) < 0)).toBe(true);
  });
});
