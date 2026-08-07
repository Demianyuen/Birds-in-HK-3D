import { describe, expect, it } from 'vitest';
import { CITY_STYLE_MODELS } from '../src/city-style/modelCatalog';

const EXPECTED_IDS = [
  'apartment-block-01',
  'glass-skyscraper-01',
  'convenience-store-01',
  'corner-store-01',
  'home-thatched-house-01',
  'shop-awning-01',
  'terrain-grass-01',
  'water-open-oasis',
  'tree-oak-01',
  'date-palm',
  'bush-round-01',
  'cloud-puff-01',
  'road-cobble-straight-01',
  'bench-01',
  'trash-bin-01',
  'fire-brazier',
];

describe('city style model catalogue', () => {
  it('contains the complete authenticated Three.js Assets Free collection', () => {
    expect(CITY_STYLE_MODELS.map(model => model.id)).toEqual(EXPECTED_IDS);
    for (const model of CITY_STYLE_MODELS) {
      expect(model.modelPath).toMatch(/^\/models\/city-style\/(?:buildings|environment|street)\/[a-z0-9-]+\.glb$/);
      expect(model.sourceUrl).toBe(`https://threejsassets.com/assets/${model.id}`);
      expect(model.licenseName).toBe('Three.js Assets Free Commercial License');
      expect(model.licenseUrl).toBe('https://threejsassets.com/license#free-asset-license');
      expect(model.targetSizeMetres).toBeGreaterThan(0);
    }
  });

  it('keeps paths and placements unique with three featured studies', () => {
    expect(new Set(CITY_STYLE_MODELS.map(model => model.modelPath)).size).toBe(CITY_STYLE_MODELS.length);
    expect(new Set(CITY_STYLE_MODELS.map(model => model.position.join(','))).size).toBe(CITY_STYLE_MODELS.length);
    expect(CITY_STYLE_MODELS.filter(model => model.featured)).toHaveLength(3);
    expect(new Set(CITY_STYLE_MODELS.map(model => model.category))).toEqual(new Set(['building', 'environment', 'street']));
  });
});
