import { BoxGeometry, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { nearCourt, nearKeepInsideGlsl, PHOTO_GROUND_BAND, skipHiddenHits, STYLISED_OVERLAP } from '../src/game/nearCourt';

afterEach(() => {
  nearCourt.disable();
  nearCourt.setArea([], 0);
  nearCourt.setTowerSites([]);
});

describe('clean buildings round the estate', () => {
  it('changes nothing until it is switched on', () => {
    expect(nearCourt.on).toBe(false);
    expect(nearCourt.photoHidden({ x: 0, y: 500, z: 0 })).toBe(false);
    expect(nearCourt.stylisedHidden({ x: 9_000, z: 0 }, true)).toBe(false);
  });

  it('inside the circle keeps the photo ground and hides photo buildings; outside keeps everything', () => {
    // Terrain model at 4 m; the photo mesh's ground stands 2 m above it.
    nearCourt.enable({ x: 0, z: 0 }, 400, 2, () => 4);
    expect(nearCourt.on).toBe(true);
    expect(nearCourt.photoHidden({ x: 50, y: 6.5, z: 0 })).toBe(false);
    expect(nearCourt.photoHidden({ x: 50, y: 6 + PHOTO_GROUND_BAND + 0.1, z: 0 })).toBe(true);
    expect(nearCourt.photoHidden({ x: 500, y: 80, z: 0 })).toBe(false);
  });

  it('draws the clean buildings only inside the circle (plus a little overlap), not on the estate grounds or at the towers', () => {
    nearCourt.enable({ x: 0, z: 0 }, 400, 0, () => 0);
    nearCourt.setArea([{ x: -20, z: -20 }, { x: 20, z: -20 }, { x: 20, z: 20 }, { x: -20, z: 20 }], 5);
    nearCourt.setTowerSites([{ x: 100, z: 0, radius: 30 }]);
    expect(nearCourt.stylisedHidden({ x: 200, z: 0 }, true)).toBe(false);
    expect(nearCourt.stylisedHidden({ x: 400 + STYLISED_OVERLAP - 1, z: 0 }, true)).toBe(false);
    expect(nearCourt.stylisedHidden({ x: 400 + STYLISED_OVERLAP + 1, z: 0 }, true)).toBe(true);
    expect(nearCourt.stylisedHidden({ x: 0, z: 0 }, false)).toBe(true);
    expect(nearCourt.stylisedHidden({ x: 110, z: 0 }, true)).toBe(true);
    // The ground under a tower site is still ground.
    expect(nearCourt.stylisedHidden({ x: 110, z: 0 }, false)).toBe(false);
  });

  it('rays pass through what is not drawn', () => {
    nearCourt.enable({ x: 0, z: 0 }, 400, 0, () => 0);
    const far = new Mesh(new BoxGeometry(10, 10, 10), new MeshBasicMaterial());
    far.position.set(600, 5, 0);
    far.updateMatrixWorld(true);
    skipHiddenHits(far, point => nearCourt.stylisedHidden(point, true));
    const ray = new Raycaster(new Vector3(600, 50, 0), new Vector3(0, -1, 0));
    expect(ray.intersectObject(far)).toHaveLength(0);
    nearCourt.disable();
    expect(ray.intersectObject(far).length).toBeGreaterThan(0);
  });

  it('writes a shader test against the given position', () => {
    expect(nearKeepInsideGlsl('vWorld')).toContain('distance(vWorld.xz, uNear.xy)');
  });
});
