import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(resolve(process.cwd(), 'city-style.html'), 'utf8');

describe('city style entry document', () => {
  it('contains the comparison scene, controls, featured studies, and collection rail', () => {
    for (const id of ['city-style-app', 'city-style-world', 'scene-status', 'camera-reset', 'model-list', 'asset-list']) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(countMatches(html, /data-model-card=/g)).toBe(3);
    expect(html).toContain('Apartment Block 01');
    expect(html).toContain('Glass Skyscraper 01');
    expect(html).toContain('Convenience Store 01');
    expect(html).toContain('正在載入 16 個 Free GLB');
    expect(html).toContain('13 ITEMS');
  });

  it('records the Free licence links and keeps credentials out of the page', () => {
    expect(countMatches(html, /threejsassets\.com\/license#free-asset-license/g)).toBe(3);
    expect(html).not.toMatch(/CSDI_3D_API_KEY|GOOGLE_MAPS_API_KEY|token/i);
  });

  it('contains valid Traditional Chinese copy and balanced structural tags', () => {
    expect(html).toContain('香港城市風格研究');
    expect(html).toContain('CSDI 保留為飛行世界唯一真實建築來源');
    expect(html).not.toMatch(/[\uE000-\uF8FF]/u);
    expect(countMatches(html, /<article\b/g)).toBe(countMatches(html, /<\/article>/g));
  });
});

function countMatches(value: string, pattern: RegExp): number {
  return [...value.matchAll(pattern)].length;
}
