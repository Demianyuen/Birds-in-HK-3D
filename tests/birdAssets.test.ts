import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const modelsRoot = resolve(process.cwd(), 'public/models');

describe('runtime bird assets', () => {
  it.each([
    ['dove.glb', 6_797_052],
    ['eagle.glb', 9_107_208],
  ])('contains a validated %s GLB', (filename, expectedBytes) => {
    const path = resolve(modelsRoot, filename);
    const data = readFileSync(path);
    expect(statSync(path).size).toBe(expectedBytes);
    expect(data.subarray(0, 4).toString('ascii')).toBe('glTF');
  });
});
