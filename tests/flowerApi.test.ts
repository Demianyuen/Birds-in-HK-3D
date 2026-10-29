import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowerRefused, placeFlower } from '../src/openWorld/flowerApi';

const input = { name: '甲', message: '', kind: 'lily', x: 18, y: 5, z: 22 } as const;

function respond(status: number, body: unknown): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

afterEach(() => vi.unstubAllGlobals());

describe('placeFlower failures', () => {
  it('treats a refusal (too many, outside the grounds) as a refusal', async () => {
    respond(429, { error: '你剛剛已經放了幾朵花，請稍後再放。' });
    await expect(placeFlower(input)).rejects.toBeInstanceOf(FlowerRefused);
  });

  it('treats a broken or missing service as something to try again, so the flower is kept', async () => {
    for (const status of [500, 502, 503, 404]) {
      respond(status, { error: 'x' });
      const error = await placeFlower(input).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(FlowerRefused);
    }
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    await expect(placeFlower(input)).rejects.not.toBeInstanceOf(FlowerRefused);
  });
});
