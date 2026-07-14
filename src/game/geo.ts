import { MathUtils, Matrix4, Vector3 } from 'three';

const WGS84_A = 6_378_137;
const WGS84_E2 = 6.69437999014e-3;

export const HONG_KONG_ORIGIN = Object.freeze({ latitude: 22.44705, longitude: 114.17544 });

export function geodeticToEcef(latitude: number, longitude: number, height = 0): Vector3 {
  const latitudeRadians = MathUtils.degToRad(latitude);
  const longitudeRadians = MathUtils.degToRad(longitude);
  const sinLatitude = Math.sin(latitudeRadians);
  const cosLatitude = Math.cos(latitudeRadians);
  const primeVerticalRadius = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLatitude * sinLatitude);

  return new Vector3(
    (primeVerticalRadius + height) * cosLatitude * Math.cos(longitudeRadians),
    (primeVerticalRadius + height) * cosLatitude * Math.sin(longitudeRadians),
    (primeVerticalRadius * (1 - WGS84_E2) + height) * sinLatitude,
  );
}

export function createEcefToLocalMatrix(latitude: number, longitude: number): Matrix4 {
  const latitudeRadians = MathUtils.degToRad(latitude);
  const longitudeRadians = MathUtils.degToRad(longitude);
  const east = new Vector3(-Math.sin(longitudeRadians), Math.cos(longitudeRadians), 0);
  const up = new Vector3(
    Math.cos(latitudeRadians) * Math.cos(longitudeRadians),
    Math.cos(latitudeRadians) * Math.sin(longitudeRadians),
    Math.sin(latitudeRadians),
  );
  const south = new Vector3(
    Math.sin(latitudeRadians) * Math.cos(longitudeRadians),
    Math.sin(latitudeRadians) * Math.sin(longitudeRadians),
    -Math.cos(latitudeRadians),
  );

  return new Matrix4()
    .makeBasis(east, up, south)
    .setPosition(geodeticToEcef(latitude, longitude))
    .invert();
}
