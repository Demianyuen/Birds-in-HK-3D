import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const modelsRoot = resolve(process.cwd(), 'public/models');

describe('runtime bird assets', () => {
  it.each([
    ['dove.glb', 770_224],
    ['eagle.glb', 864_308],
  ])('contains a validated %s GLB', (filename, expectedBytes) => {
    const path = resolve(modelsRoot, filename);
    const data = readFileSync(path);
    expect(statSync(path).size).toBe(expectedBytes);
    expect(data.subarray(0, 4).toString('ascii')).toBe('glTF');
  });
});
