import { expect, it } from 'vitest';
import { wangFukLocalMarkers } from '../src/game/wangFukLocations';

it('projects official address markers into the game east-up-south frame without swapping east and north', () => {
  const markers = wangFukLocalMarkers(22.44705, 114.17544);
  const a = markers.find(marker => marker.block === 'A')!;
  const h = markers.find(marker => marker.block === 'H')!;
  expect(a.position.x).toBeGreaterThan(-54);
  expect(a.position.x).toBeLessThan(-49);
  expect(a.position.z).toBeGreaterThan(-27);
  expect(a.position.z).toBeLessThan(-22);
  expect(h.position.x).toBeGreaterThan(73);
  expect(h.position.z).toBeLessThan(0);
  expect(markers.every(marker => Math.hypot(marker.position.x, marker.position.z) < 150)).toBe(true);
});
