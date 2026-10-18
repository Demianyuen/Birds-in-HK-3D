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
    expect(rendered.customProgramCacheKey()).toContain('csdi-stylized-building');

    source.dispose();
    texture.dispose();
  });

  it('varies facade tones by world position in the shader, not by per-tile tint', () => {
    const firstSource = new MeshStandardMaterial({ color: '#ffffff' });
    const secondSource = new MeshStandardMaterial({ color: '#ffffff' });
    const first = createRenderedBuildingMaterial(firstSource, 'tile-a') as MeshStandardMaterial;
    const second = createRenderedBuildingMaterial(secondSource, 'tile-b') as MeshStandardMaterial;

    // Same program for every tile, so adjacent tiles of one estate never change colour at a seam.
    expect(first.customProgramCacheKey()).toBe(second.customProgramCacheKey());
    const shader = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>',
    };
    first.onBeforeCompile(shader as never, undefined as never);
    expect(shader.fragmentShader).toContain('csdiPalette(csdiId)');
    expect(shader.fragmentShader).toContain('floor(csdiP.xz / 42.0)');

    first.dispose();
    second.dispose();
  });
});
