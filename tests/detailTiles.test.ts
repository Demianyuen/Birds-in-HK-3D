import { expect, it } from 'vitest';
import { loadDetailTiles } from '../src/game/detailTiles';

it('requests aligned child tiles with bounded concurrency and reports complete mosaics', async () => {
  let active = 0;
  let peak = 0;
  const seen: string[] = [];
  const complete = await loadDetailTiles(13388, 7143, 4, async (x, y, dx, dy) => {
    peak = Math.max(peak, ++active);
    seen.push(`${x}/${y}:${dx}/${dy}`);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
    return true;
  });
  expect(complete).toBe(true);
  expect(seen).toHaveLength(16);
  expect(seen).toContain('53552/28572:0/0');
  expect(seen).toContain('53555/28575:3/3');
  expect(peak).toBeLessThanOrEqual(4);
});

it('rejects partial mosaics and stops starting new requests after failure', async () => {
  let requests = 0;
  const complete = await loadDetailTiles(10, 20, 8, async () => { requests++; return false; });
  expect(complete).toBe(false);
  expect(requests).toBeLessThanOrEqual(4);
});

it('turns thrown fetch failures into an incomplete result so the base map can stay visible', async () => {
  expect(await loadDetailTiles(10, 20, 4, async () => { throw new Error('offline'); })).toBe(false);
});
