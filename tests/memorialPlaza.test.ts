import { Mesh, MeshBasicMaterial, PlaneGeometry, Vector3, Vector4 } from 'three';
import { describe, expect, it } from 'vitest';
import { insideCutouts } from '../src/game/PhotoMeshTiles';
import { MEMORIAL_PLAZA, insideMemorialGround } from '../src/openWorld/contentRules';
import { wangFukLocalMarkers } from '../src/game/wangFukLocations';
import { BLOCK_RADIUS } from '../src/wangFuk/plan';
import { MemorialPlaza, plazaGeometry, plazaLevel } from '../src/wangFuk/MemorialPlaza';

describe('memorial square', () => {
  it('sits in open ground, clear of every Wang Fuk Court tower, on the memorial ground', () => {
    for (const marker of wangFukLocalMarkers(22.44705, 114.17544)) {
      const gap = Math.hypot(marker.position.x - MEMORIAL_PLAZA.x, marker.position.z - MEMORIAL_PLAZA.z) - BLOCK_RADIUS;
      expect(gap, marker.block).toBeGreaterThan(MEMORIAL_PLAZA.radius + 6);
    }
    expect(insideMemorialGround(MEMORIAL_PLAZA.x, MEMORIAL_PLAZA.z)).toBe(true);
  });

  it('takes the lowest believable ground, ignoring lumps far above or holes far below', () => {
    expect(plazaLevel([5.2, 7.9, 12.4, 5.6, 40, -30], 5)).toBeCloseTo(5.2);
    expect(plazaLevel([5.2, 6], 5)).toBe(5);
  });

  it('is flat on top and lands where it was measured', () => {
    const geometry = plazaGeometry(MEMORIAL_PLAZA.radius);
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.max.y).toBeLessThan(0.1);
    expect(geometry.boundingBox!.max.x).toBeCloseTo(MEMORIAL_PLAZA.radius + 0.15, 1);

    // A sloping lump of "photo mesh" where the square goes: the square settles at the low edge.
    const lump = new Mesh(new PlaneGeometry(200, 200, 40, 40), new MeshBasicMaterial());
    lump.rotation.x = -Math.PI / 2;
    lump.position.set(MEMORIAL_PLAZA.x, 4, MEMORIAL_PLAZA.z);
    lump.updateMatrixWorld(true);
    const plaza = new MemorialPlaza();
    expect(plaza.level).toBeNull();
    expect(plaza.cutout()).toBeNull();
    expect(plaza.measure([lump], 4.5)).toBe(true);
    expect(plaza.level).toBeCloseTo(4, 3);
    plaza.setVisible(true);
    expect(plaza.group.visible).toBe(true);
    expect(plaza.cutout()).toMatchObject({ x: MEMORIAL_PLAZA.x, z: MEMORIAL_PLAZA.z, minY: expect.closeTo(4.2, 3) });
    // Tower bases, once measured, win over the rays.
    plaza.setTowerBases([3.1, 3.4, 9]);
    expect(plaza.level).toBeCloseTo(3.4);
    plaza.dispose();
  });
});

describe('cut-away photo mesh', () => {
  it('cannot be landed on above the cut, but still can below it and outside the circle', () => {
    const circles = [new Vector4(28, -6, 19, 4.2)];
    expect(insideCutouts(new Vector3(30, 9, -4), circles, 1)).toBe(true);
    expect(insideCutouts(new Vector3(30, 4, -4), circles, 1)).toBe(false);
    expect(insideCutouts(new Vector3(60, 9, -4), circles, 1)).toBe(false);
    expect(insideCutouts(new Vector3(30, 9, -4), circles, 0)).toBe(false);
  });
});
