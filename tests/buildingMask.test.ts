import { describe, expect, it } from 'vitest';
import { BUILDING_MASK_LAYER, MASK_GLSL_DECLARATIONS, maskUniforms, showInBuildingMask } from '../src/game/BuildingMask';
import { Mesh } from 'three';

describe('building mask', () => {
  it('is off until the aerial-photo view asks for clean buildings', () => {
    expect(maskUniforms.uClean.value).toBe(0);
  });

  it('marks building meshes for the mask camera without hiding them from the main one', () => {
    const mesh = new Mesh();
    showInBuildingMask(mesh);
    expect(mesh.layers.isEnabled(BUILDING_MASK_LAYER)).toBe(true);
    expect(mesh.layers.isEnabled(0)).toBe(true);
  });

  it('reads the mask with north at the top and widens footprints', () => {
    expect(MASK_GLSL_DECLARATIONS).toContain('uv.y = 1.0 - uv.y');
    expect(MASK_GLSL_DECLARATIONS).toContain('buildingMaskHides');
  });
});
