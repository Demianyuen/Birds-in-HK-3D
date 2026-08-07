import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(resolve(process.cwd(), 'studio.html'), 'utf8');

describe('art studio entry document', () => {
  it('contains the 3D work surface, controls, feed state, and inspector', () => {
    for (const id of [
      'studio-app',
      'studio-world',
      'agent-list',
      'feed-source',
      'feed-time',
      'motion-toggle',
      'camera-reset',
      'inspector-name',
      'inspector-content',
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('data-view="current"');
    expect(html).toContain('data-view="week"');
    expect(html).toContain('統一作戰藝術村');
  });

  it('does not expose API credentials', () => {
    expect(html).not.toMatch(/CSDI_3D_API_KEY|GOOGLE_MAPS_API_KEY|token/i);
  });

  it('contains valid Traditional Chinese copy without broken tags', () => {
    expect(html).toContain('可互動的 3D 草原藝術村');
    expect(html).not.toMatch(/[\uE000-\uF8FF]/u);
    expect(html).not.toMatch(/\?\/(?:p|h[1-6]|strong|button)>/i);
    expect(countMatches(html, /<button\b/g)).toBe(countMatches(html, /<\/button>/g));
  });
});

function countMatches(value: string, pattern: RegExp): number {
  return [...value.matchAll(pattern)].length;
}
