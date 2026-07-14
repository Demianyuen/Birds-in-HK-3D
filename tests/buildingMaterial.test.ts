import { MeshStandardMaterial, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import { createRenderedBuildingMaterial } from '../src/game/BuildingMaterial';

describe('official building rendering material', () => {
  it('preserves the official KTX2 texture while adding facade rendering', () => {
    const texture = new Texture();
    const source = new MeshStandardMaterial({ map: texture, roughness: 1 });
    const rendered = createRenderedBuildingMaterial(source, 'tai-po/tile-1');

    expect(rendered).toBeInstanceOf(MeshStandardMaterial);
    expect(rendered).toBe(source);
    expect((rendered as MeshStandardMaterial).map).toBe(texture);
    expect((rendered as MeshStandardMaterial).roughness).toBeLessThan(1);
    expect(rendered.customProgramCacheKey()).toContain('csdi-rendered-building');

    source.dispose();
    texture.dispose();
  });

  it('uses stable but varied facade tones between official tiles', () => {
    const firstSource = new MeshStandardMaterial({ color: '#ffffff' });
    const secondSource = new MeshStandardMaterial({ color: '#ffffff' });
    const first = createRenderedBuildingMaterial(firstSource, 'tile-a') as MeshStandardMaterial;
    const second = createRenderedBuildingMaterial(secondSource, 'tile-b') as MeshStandardMaterial;

    expect(first.color.getHex()).not.toBe(second.color.getHex());

    first.dispose();
    second.dispose();
  });
});
