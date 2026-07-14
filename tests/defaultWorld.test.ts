import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const groundSource = readFileSync(
  resolve(process.cwd(), 'src', 'game', 'AerialImageryGround.ts'),
  'utf8',
);

describe('default flight region', () => {
  it('selects the official Tai Po CSDI region by default', () => {
    expect(html).toMatch(/name="flight-region"\s+value="tai-po"\s+checked/);
    expect(html).not.toMatch(/stylized|fallback|world-source/i);
  });

  it('does not expose an API credential input', () => {
    expect(html).not.toMatch(/<input[^>]+(?:api.?key|token|credential)/i);
    expect(html).not.toContain('CSDI_3D_API_KEY');
  });

  it('does not use satellite or aerial imagery as the terrain material', () => {
    expect(groundSource).not.toContain('/hk-imagery/');
    expect(groundSource).not.toContain('TextureLoader');
  });
});
