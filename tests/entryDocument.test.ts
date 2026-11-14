import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

describe('game entry document', () => {
  it('contains the complete staged game flow', () => {
    for (const id of [
      'boot-screen',
      'menu-screen',
      'loading-screen',
      'error-screen',
      'game-hud',
      'continue-button',
      'start-button',
      'retry-button',
      'region-button',
      'google-maps-button',
      'google-maps-panel',
      'google-maps-canvas',
      'google-maps-close-button',
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it('leaves the choice of bird to the page script (six species)', () => {
    expect(html).toContain('id="bird-picker"');
  });

  it('keeps the server-managed API credential out of the interface', () => {
    expect(html).not.toMatch(/<input[^>]+(?:api.?key|token|credential)/i);
    expect(html).not.toContain('CSDI_3D_API_KEY');
  });

  it('contains valid Traditional Chinese copy without mojibake or broken tags', () => {
    expect(html).toContain('化身一隻鴿子，帶著一朵花飛過大埔，輕輕放在宏福苑。');
    expect(html).toContain('大埔 · 宏福苑');
    expect(html).toContain('正在建立飛行世界');
    expect(html).not.toMatch(/[\uE000-\uF8FF]/u);
    expect(html).not.toMatch(/\?\/(?:p|h[1-6]|strong|button)>/i);
    expect(countMatches(html, /<button\b/g)).toBe(countMatches(html, /<\/button>/g));
    expect(countMatches(html, /<section\b/g)).toBe(countMatches(html, /<\/section>/g));
  });

  it('presents itself as a memorial space, not a game', () => {
    expect(html).toContain('沒有分數、排名或任務的開放世界');
    expect(html).toContain('為宏福苑的天使們留下一朵花');
    expect(html).toContain('只要心裡有香港');
    expect(html).not.toMatch(/遊戲畫面|可遊玩|玩家|得分|排行/);
  });

  it('defines a favicon without issuing an implicit missing-file request', () => {
    expect(html).toContain('<link rel="icon" href="data:," />');
  });
});

function countMatches(value: string, pattern: RegExp): number {
  return [...value.matchAll(pattern)].length;
}
