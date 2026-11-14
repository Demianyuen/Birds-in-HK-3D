import { Mesh, MeshBasicMaterial, PlaneGeometry, Vector3, Vector4 } from 'three';
import { describe, expect, it } from 'vitest';
import { insideCutouts } from '../src/game/PhotoMeshTiles';
import { MEMORIAL_PLAZA, insideMemorialGround } from '../src/openWorld/contentRules';
import { wangFukLocalMarkers } from '../src/game/wangFukLocations';
import { BLOCK_RADIUS } from '../src/wangFuk/plan';
import { bankGeometry, estateOutline, insideConvex, MemorialPlaza, plazaGeometry, plazaLevel } from '../src/wangFuk/MemorialPlaza';

const towers = wangFukLocalMarkers(22.44705, 114.17544).map(marker => ({ x: marker.position.x, z: marker.position.z }));

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
    expect(geometry.boundingBox!.max.y).toBeLessThan(0.15);
    expect(geometry.boundingBox!.max.x).toBeCloseTo(MEMORIAL_PLAZA.x + MEMORIAL_PLAZA.radius, 1);

    // A sloping lump of "photo mesh" where the square goes: the grounds settle at the low edge.
    const lump = new Mesh(new PlaneGeometry(200, 200, 40, 40), new MeshBasicMaterial());
    lump.rotation.x = -Math.PI / 2;
    lump.position.set(MEMORIAL_PLAZA.x, 4, MEMORIAL_PLAZA.z);
    lump.updateMatrixWorld(true);
    const plaza = new MemorialPlaza(towers);
    expect(plaza.level).toBeNull();
    expect(plaza.cutout()).toBeNull();
    expect(plaza.groundsCut()).toBeNull();
    expect(plaza.measure([lump], 4.5)).toBe(true);
    expect(plaza.level).toBeCloseTo(4, 3);
    plaza.setVisible(true);
    expect(plaza.group.visible).toBe(true);
    expect(plaza.cutout()).toMatchObject({ x: MEMORIAL_PLAZA.x, z: MEMORIAL_PLAZA.z, minY: expect.closeTo(3.4, 3) });
    // Tower bases, once measured, win over the rays, and each tower gets a plinth.
    plaza.setTowers(towers.slice(0, 3).map((tower, index) => ({ ...tower, yaw: 0.3, baseY: [3.1, 3.4, 9][index] })));
    expect(plaza.level).toBeCloseTo(3.4);
    expect(plaza.surfaceAt(MEMORIAL_PLAZA.x, MEMORIAL_PLAZA.z)).toBeCloseTo(3.4);
    plaza.dispose();
  });

  it('covers every tower and the square, keeps paths and the square free of trees, and stops near the estate', () => {
    const plaza = new MemorialPlaza(towers);
    plaza.setTowerBases([5]);
    for (const tower of towers) {
      expect(plaza.surfaceAt(tower.x, tower.z)).toBe(5);
      // A point just past the tower wall, away from the square, is still on the grounds.
      const away = Math.atan2(tower.z - MEMORIAL_PLAZA.z, tower.x - MEMORIAL_PLAZA.x);
      expect(plaza.surfaceAt(tower.x + Math.cos(away) * (BLOCK_RADIUS + 4), tower.z + Math.sin(away) * (BLOCK_RADIUS + 4))).toBe(5);
      // Halfway along the path from the square to this tower: no tree.
      expect(plaza.keepClear((tower.x + MEMORIAL_PLAZA.x) / 2, (tower.z + MEMORIAL_PLAZA.z) / 2)).toBe(true);
    }
    expect(plaza.keepClear(MEMORIAL_PLAZA.x, MEMORIAL_PLAZA.z)).toBe(true);
    // 200 m away is not part of the grounds.
    expect(plaza.surfaceAt(MEMORIAL_PLAZA.x + 200, MEMORIAL_PLAZA.z)).toBeNull();
    const cut = plaza.groundsCut()!;
    expect(cut.minY).toBeCloseTo(4.4);
    expect(cut.outline.length).toBeLessThanOrEqual(48);
    plaza.dispose();
  });
});

describe('grass bank at the edge of the grounds', () => {
  it('rises to meet higher land outside, so there is no open edge to see under', () => {
    // Land all round standing 3 m above the level the grounds settle at.
    const land = new Mesh(new PlaneGeometry(600, 600), new MeshBasicMaterial());
    land.rotation.x = -Math.PI / 2;
    land.position.set(MEMORIAL_PLAZA.x, 8, MEMORIAL_PLAZA.z);
    land.updateMatrixWorld(true);
    const plaza = new MemorialPlaza(towers);
    plaza.setTowerBases([5]);
    expect(plaza.fitEdge([land])).toBe(true);
    const bank = plaza.group.getObjectByName('grass bank')!.children[0] as Mesh;
    bank.geometry.computeBoundingBox();
    expect(bank.geometry.boundingBox!.max.y).toBeCloseTo(3.05, 1);
    expect(bank.geometry.boundingBox!.min.y).toBeCloseTo(0.03, 2);
    plaza.dispose();
  });

  it('ignores one stray height between two ordinary ones', () => {
    const outline = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }];
    const outward = outline.map(point => ({ x: Math.sign(point.x - 5) * Math.SQRT1_2, z: Math.sign(point.z - 5) * Math.SQRT1_2 }));
    const geometry = bankGeometry(outline, outward, [1, 9, 1, 1]);
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.max.y).toBeCloseTo(1.05, 2);
  });
});

describe('estate outline', () => {
  it('is the hull grown by the margin, convex and counter-clockwise', () => {
    const square = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }, { x: 5, z: 5 }];
    const outline = estateOutline(square, 2);
    expect(insideConvex(5, 5, outline)).toBe(true);
    expect(insideConvex(-1.9, 5, outline)).toBe(true);
    expect(insideConvex(-2.2, 5, outline)).toBe(false);
    expect(insideConvex(11.35, 11.35, outline)).toBe(true);
    expect(insideConvex(11.5, 11.5, outline)).toBe(false);
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
