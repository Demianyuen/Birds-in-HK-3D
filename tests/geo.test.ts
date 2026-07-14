import { describe, expect, it } from 'vitest';
import { createEcefToLocalMatrix, geodeticToEcef, HONG_KONG_ORIGIN } from '../src/game/geo';

describe('Hong Kong local coordinate frame', () => {
  it('is centred on Wang Fuk Court in Tai Po', () => {
    expect(HONG_KONG_ORIGIN.latitude).toBeCloseTo(22.44705, 5);
    expect(HONG_KONG_ORIGIN.longitude).toBeCloseTo(114.17544, 5);
  });

  it('maps the selected WGS84 origin to local zero', () => {
    const origin = geodeticToEcef(HONG_KONG_ORIGIN.latitude, HONG_KONG_ORIGIN.longitude);
    const local = origin.applyMatrix4(createEcefToLocalMatrix(HONG_KONG_ORIGIN.latitude, HONG_KONG_ORIGIN.longitude));
    expect(local.length()).toBeLessThan(0.000001);
  });

  it('keeps a one metre altitude increase on the local up axis', () => {
    const matrix = createEcefToLocalMatrix(HONG_KONG_ORIGIN.latitude, HONG_KONG_ORIGIN.longitude);
    const base = geodeticToEcef(HONG_KONG_ORIGIN.latitude, HONG_KONG_ORIGIN.longitude).applyMatrix4(matrix);
    const raised = geodeticToEcef(HONG_KONG_ORIGIN.latitude, HONG_KONG_ORIGIN.longitude, 1).applyMatrix4(matrix);
    expect(raised.y - base.y).toBeCloseTo(1, 5);
    expect(Math.abs(raised.x - base.x)).toBeLessThan(0.000001);
    expect(Math.abs(raised.z - base.z)).toBeLessThan(0.000001);
  });
});
