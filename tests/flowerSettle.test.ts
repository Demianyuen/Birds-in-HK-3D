import { BoxGeometry, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { MemorialFlowers } from '../src/openWorld/MemorialFlowers';

function slab(top: number): Mesh {
  const mesh = new Mesh(new BoxGeometry(40, 1, 40), new MeshBasicMaterial());
  mesh.position.set(18, top - 0.5, 22);
  mesh.updateMatrixWorld(true);
  return mesh;
}

// The flower set paints two small canvas textures; tests have no DOM, so a blank canvas stands in.
beforeAll(() => {
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => null }) });
});

const flower = { id: 'f1', createdAt: '', name: '甲', message: '', kind: 'lily' as const, x: 18, y: 5, z: 22 };

describe('flowers stay on the ground that is showing', () => {
  it('rises with a refined ground that would otherwise bury it', () => {
    const flowers = new MemorialFlowers();
    flowers.add(flower);
    flowers.settleOnSurface([slab(5.8)], new Vector3(18, 6, 22));
    expect(flowers.displayY(flower)).toBeCloseTo(5.8, 2);
  });

  it('is not lifted onto a roof or a tree crown overhead, nor dropped far below', () => {
    const flowers = new MemorialFlowers();
    flowers.add(flower);
    flowers.settleOnSurface([slab(12)], new Vector3(18, 6, 22));
    expect(flowers.displayY(flower)).toBe(5);
    const below = new MemorialFlowers();
    below.add(flower);
    below.settleOnSurface([slab(-3)], new Vector3(18, 6, 22));
    expect(below.displayY(flower)).toBe(5);
  });

  it('finds flowers near the bird within a height band, so words show when you come close', () => {
    const flowers = new MemorialFlowers();
    flowers.add(flower);
    expect(flowers.nearest(new Vector3(26, 9, 22), 12, 3, 10)).toHaveLength(1);
    expect(flowers.nearest(new Vector3(26, 40, 22), 12, 3, 10)).toHaveLength(0);
    expect(flowers.nearest(new Vector3(40, 5, 22), 12, 3, 10)).toHaveLength(0);
  });
});
