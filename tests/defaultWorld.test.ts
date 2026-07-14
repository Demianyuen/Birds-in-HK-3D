import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

describe('default world selection', () => {
  it('selects the official CSDI world by default', () => {
    expect(html).toMatch(/name="world-source"\s+value="csdi"\s+checked/);
    expect(html).not.toMatch(/name="world-source"\s+value="stylized"\s+checked/);
  });

  it('does not expose an API credential input', () => {
    expect(html).not.toMatch(/<input[^>]+(?:api.?key|token|credential)/i);
    expect(html).not.toContain('CSDI_3D_API_KEY');
  });
});
