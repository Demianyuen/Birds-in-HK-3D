import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { BLOCK_OUTLINE } from '../src/wangFuk/plan';
import { buildBlockGeometry, buildRoofCaps, ROOF_CAP_HEIGHT, WangFukCourt } from '../src/wangFuk/WangFukCourt';

function triangles(geometry: ReturnType<typeof buildBlockGeometry>) {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const result: Array<{ faceNormal: Vector3; storedNormal: Vector3; area: number; centre: Vector3 }> = [];
  for (let index = 0; index < position.count; index += 3) {
    const a = new Vector3().fromBufferAttribute(position, index);
    const b = new Vector3().fromBufferAttribute(position, index + 1);
    const c = new Vector3().fromBufferAttribute(position, index + 2);
    const cross = new Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
    result.push({
      faceNormal: cross.clone().normalize(),
      storedNormal: new Vector3().fromBufferAttribute(normal, index),
      area: cross.length() / 2,
      centre: a.clone().add(b).add(c).divideScalar(3),
    });
  }
  return result;
}

describe('Wang Fuk Court tower geometry', () => {
  const height = 86.8;
  const geometry = buildBlockGeometry(height);
  const faces = triangles(geometry);

  it('winds every face outward, matching its stored normal', () => {
    for (const face of faces) expect(face.faceNormal.dot(face.storedNormal)).toBeGreaterThan(0.99);
  });

  it('has walls that point away from the centre and a roof that points up', () => {
    for (const face of faces) {
      if (face.storedNormal.y > 0.5) expect(face.centre.y).toBeCloseTo(height, 3);
      else expect(face.centre.clone().setY(0).dot(face.storedNormal)).toBeGreaterThan(0);
    }
  });

  it('covers the whole plan with its roof and the full height with its walls', () => {
    const roofArea = faces.filter(face => face.storedNormal.y > 0.5).reduce((sum, face) => sum + face.area, 0);
    let planArea = 0;
    BLOCK_OUTLINE.forEach(([x, z], index) => {
      const [nx, nz] = BLOCK_OUTLINE[(index + 1) % BLOCK_OUTLINE.length];
      planArea += x * nz - nx * z;
    });
    expect(roofArea).toBeCloseTo(Math.abs(planArea) / 2, 2);
    const wallArea = faces.filter(face => face.storedNormal.y < 0.5).reduce((sum, face) => sum + face.area, 0);
    let perimeter = 0;
    BLOCK_OUTLINE.forEach(([x, z], index) => {
      const [nx, nz] = BLOCK_OUTLINE[(index + 1) % BLOCK_OUTLINE.length];
      perimeter += Math.hypot(nx - x, nz - z);
    });
    expect(wallArea).toBeCloseTo(perimeter * height, 1);
  });

  it('marks the short re-entrant walls as shafts', () => {
    const recess = geometry.getAttribute('aRecess');
    const shaftVertices = Array.from({ length: recess.count }, (_, index) => recess.getX(index)).filter(value => value === 1).length;
    expect(shaftVertices).toBe(8 * 6);
  });

  it('puts a brown-red machine room on the roof', () => {
    const caps = buildRoofCaps(height);
    caps.computeBoundingBox();
    expect(caps.boundingBox!.min.y).toBeCloseTo(height, 3);
    expect(caps.boundingBox!.max.y).toBeGreaterThan(height + ROOF_CAP_HEIGHT);
    const colour = caps.getAttribute('color');
    expect(colour.getX(0)).toBeGreaterThan(colour.getZ(0));
  });
});

describe('WangFukCourt', () => {
  it('places blocks, reports cut-outs just above their ground, and shows only once something stands', () => {
    const court = new WangFukCourt(new Vector3(0.5, 0.6, 0.3));
    court.setVisible(true);
    expect(court.group.visible).toBe(false);
    court.place('A', { x: 100, z: -50, yaw: 0.3 }, 12, 86.8);
    court.setVisible(true);
    expect(court.group.visible).toBe(true);
    expect(court.has('A')).toBe(true);
    const [cut] = court.cutouts();
    expect(cut).toMatchObject({ x: 100, z: -50 });
    expect(cut.minY).toBeCloseTo(13.2, 5);
    expect(cut.radius).toBeGreaterThan(15);
    court.place('A', { x: 101, z: -50, yaw: 0.3 }, 12, 86.8);
    expect(court.count).toBe(1);
    court.dispose();
  });
});
