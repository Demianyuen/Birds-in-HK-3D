import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('search and answer engines', () => {
  it('the front page names the place plainly and carries structured data', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain('rel="canonical" href="https://birds-in-hk.org/"');
    expect(html).toContain('hreflang="en"');
    const data = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1]);
    expect(data['@type']).toBe('WebSite');
    expect(data.url).toBe('https://birds-in-hk.org/');
  });

  it('the about page answers common questions as an FAQ', () => {
    const html = readFileSync('about.html', 'utf8');
    const data = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1]);
    expect(data['@type']).toBe('FAQPage');
    expect(data.mainEntity.length).toBeGreaterThanOrEqual(4);
    for (const item of data.mainEntity) expect(html).toContain(item.name); // the answers are on the page too, not only in the data
  });

  it('robots keep the moderation and tool pages out, and point to the sitemap', () => {
    const robots = readFileSync('public/robots.txt', 'utf8');
    expect(robots).toContain('Disallow: /moderate.html');
    expect(robots).toContain('Sitemap: https://birds-in-hk.org/sitemap.xml');
    const key = /const KEY = '([0-9a-f]{32})'/.exec(readFileSync('scripts/indexnow.mjs', 'utf8'))![1];
    expect(readFileSync(`public/${key}.txt`, 'utf8').trim()).toBe(key);
  });
});
