import { MeshStandardMaterial, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import { createRenderedBuildingMaterial, setBuildingPresentation } from '../src/game/BuildingMaterial';

describe('official building rendering material', () => {
  it('restores source material in reference mode and never compounds artistic tint on repeated switches', () => {
    const texture = new Texture();
    const material = new MeshStandardMaterial({ color: '#dce0d8', roughness: 0.97, metalness: 0, map: texture });
    const originalColor = material.color.clone();
    const originalHook = material.onBeforeCompile;
    const originalCacheKey = material.customProgramCacheKey;
    setBuildingPresentation(material, 'tile-a', 'preservation');
    const styledColor = material.color.clone();
    expect(styledColor.equals(originalColor)).toBe(false);
    setBuildingPresentation(material, 'tile-a', 'reference');
    expect(material.color.equals(originalColor)).toBe(true);
    expect(material.roughness).toBe(0.97);
    expect(material.metalness).toBe(0);
    expect(material.onBeforeCompile).toBe(originalHook);
    expect(material.customProgramCacheKey).toBe(originalCacheKey);
    expect(material.map).toBe(texture);
    setBuildingPresentation(material, 'tile-a', 'preservation');
    setBuildingPresentation(material, 'tile-a', 'preservation');
    expect(material.color.equals(styledColor)).toBe(true);
    material.dispose();
    texture.dispose();
  });

  it('retains renderer clipping while restoring reference materials', () => {
    const material = new MeshStandardMaterial();
    material.clipShadows = true;
    setBuildingPresentation(material, 'tile-a', 'preservation');
    setBuildingPresentation(material, 'tile-a', 'reference');
    expect(material.clipShadows).toBe(true);
    material.dispose();
  });
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
