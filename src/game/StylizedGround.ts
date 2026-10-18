import type { MeshStandardMaterial, WebGLProgramParametersWithUniforms } from 'three';

/**
 * Game-style ground: the LandsD street basemap is used as a land-use mask,
 * not shown directly. Each basemap colour class (sea, green space, roads,
 * building footprints, open land) is re-painted with a stylised material,
 * and open land on hillsides becomes forest so country parks read as green.
 */
export const stylizedGroundUniforms = {
  uSgTime: { value: 0 },
};

const GLSL_COMMON = /* glsl */ `
uniform float uSgTime;
varying vec3 vSgWorld;
varying vec3 vSgNormal;
float sgHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float sgNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(sgHash(i), sgHash(i + vec2(1.0, 0.0)), u.x),
             mix(sgHash(i + vec2(0.0, 1.0)), sgHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float sgFbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 4; octave++) {
    value += amplitude * sgNoise(p);
    p *= 2.03;
    amplitude *= 0.5;
  }
  return value;
}
float sgWaves(vec2 p, float t) {
  return 0.16 * sin(dot(p, vec2(0.21, 0.13)) + t * 1.25)
    + 0.11 * sin(dot(p, vec2(-0.17, 0.27)) + t * 1.65)
    + 0.07 * sin(dot(p, vec2(0.43, -0.31)) + t * 2.30)
    + 0.22 * sgNoise(p * 0.11 + vec2(t * 0.12, t * 0.07));
}
vec3 sgLinear(vec3 srgb) { return pow(srgb, vec3(2.2)); }
float sgGreenness(vec3 linearColour) {
  vec3 s = pow(max(linearColour, vec3(0.0)), vec3(1.0 / 2.2));
  return smoothstep(0.02, 0.06, s.g - s.r) * smoothstep(0.03, 0.07, s.g - s.b);
}
`;

const GLSL_CLASSIFY_BASEMAP = /* glsl */ `
vec3 sgSrc = pow(max(diffuseColor.rgb, vec3(0.0)), vec3(1.0 / 2.2));
float sgMin = min(min(sgSrc.r, sgSrc.g), sgSrc.b);
float sgMax = max(max(sgSrc.r, sgSrc.g), sgSrc.b);
float sgLum = dot(sgSrc, vec3(0.299, 0.587, 0.114));
float sgWater = smoothstep(0.05, 0.10, sgSrc.g - sgSrc.r) * smoothstep(0.015, 0.045, sgSrc.b - sgSrc.g);
float sgGreen = smoothstep(0.02, 0.06, sgSrc.g - sgSrc.r) * smoothstep(0.03, 0.07, sgSrc.g - sgSrc.b);
float sgRoad = smoothstep(0.17, 0.27, sgSrc.r - sgSrc.b);
float sgHighway = sgRoad * smoothstep(0.55, 0.75, sgSrc.r - sgSrc.b);
float sgMinor = smoothstep(0.935, 0.962, sgMin);
#ifdef USE_MAP
vec2 sgTexel = 1.0 / vec2(textureSize(map, 0));
vec3 sgN1 = texture2D(map, vMapUv + vec2(sgTexel.x, 0.0)).rgb;
vec3 sgN2 = texture2D(map, vMapUv - vec2(sgTexel.x, 0.0)).rgb;
vec3 sgN3 = texture2D(map, vMapUv + vec2(0.0, sgTexel.y)).rgb;
vec3 sgN4 = texture2D(map, vMapUv - vec2(0.0, sgTexel.y)).rgb;
float sgNeighbourWhite = step(0.86, min(sgN1.r, sgN1.b)) + step(0.86, min(sgN2.r, sgN2.b))
  + step(0.86, min(sgN3.r, sgN3.b)) + step(0.86, min(sgN4.r, sgN4.b));
float sgNeighbourGreen = sgGreenness(sgN1) + sgGreenness(sgN2) + sgGreenness(sgN3) + sgGreenness(sgN4);
// Thin map outlines (one texel wide) are absorbed into the surrounding class.
sgMinor *= smoothstep(1.5, 2.5, sgNeighbourWhite);
float sgOutline = smoothstep(1.4, 2.4, sgNeighbourGreen);
sgGreen = max(sgGreen, sgOutline * (1.0 - sgRoad));
#endif
float sgFootprint = (1.0 - smoothstep(0.76, 0.83, sgLum)) * (1.0 - smoothstep(0.03, 0.06, sgMax - sgMin));
float sgCivic = smoothstep(0.05, 0.08, sgSrc.b - sgSrc.r) * (1.0 - smoothstep(0.02, 0.05, sgSrc.g - sgSrc.r));

#ifdef USE_MAP
sgFootprint *= 1.0 - sgOutline;
sgMinor *= 1.0 - sgOutline;
#endif
vec3 sgN = normalize(vSgNormal);
float sgSlope = 1.0 - sgN.y;
vec2 sgP = vSgWorld.xz;
float sgBroad = sgFbm(sgP * 0.006);
float sgFine = sgFbm(sgP * 0.09);
float sgGrain = sgNoise(sgP * 0.9);
float sgHill = clamp(max(smoothstep(14.0, 40.0, vSgWorld.y + (sgBroad - 0.5) * 18.0), smoothstep(0.10, 0.22, sgSlope)), 0.0, 1.0);

vec3 sgForestA = sgLinear(vec3(0.27, 0.48, 0.21));
vec3 sgForestB = sgLinear(vec3(0.19, 0.37, 0.18));
vec3 sgForestLight = sgLinear(vec3(0.45, 0.62, 0.27));
vec3 sgScrub = sgLinear(vec3(0.58, 0.60, 0.36));
vec3 sgRock = sgLinear(vec3(0.55, 0.53, 0.48));
vec3 sgForest = mix(sgForestB, sgForestA, smoothstep(0.30, 0.70, sgFine));
sgForest = mix(sgForest, sgForestLight, smoothstep(0.62, 0.85, sgBroad) * 0.55);
sgForest = mix(sgForest, sgScrub, smoothstep(0.55, 0.90, vSgWorld.y / 420.0 + sgBroad * 0.35) * 0.5);
sgForest = mix(sgForest, sgRock, smoothstep(0.42, 0.62, sgSlope) * 0.6);

vec3 sgPaving = mix(sgLinear(vec3(0.62, 0.58, 0.52)), sgLinear(vec3(0.54, 0.52, 0.48)), sgFine);
vec3 sgLawn = mix(sgLinear(vec3(0.36, 0.60, 0.26)), sgLinear(vec3(0.46, 0.67, 0.30)), sgFine);
vec3 sgOpenLow = mix(sgPaving, sgLawn, smoothstep(0.52, 0.68, sgBroad) * 0.85);
vec3 sgLand = mix(sgOpenLow, sgForest, sgHill);
vec3 sgPark = mix(sgLawn, sgForest, sgHill * 0.7);
vec3 sgPlaza = mix(sgLinear(vec3(0.58, 0.56, 0.53)), sgLinear(vec3(0.52, 0.51, 0.49)), sgFine);
vec3 sgCivicLand = mix(sgLinear(vec3(0.70, 0.64, 0.54)), sgLawn, 0.35);
vec3 sgAsphalt = mix(sgLinear(vec3(0.33, 0.35, 0.38)), sgLinear(vec3(0.27, 0.29, 0.32)), sgGrain);
vec3 sgLane = sgLinear(vec3(0.44, 0.45, 0.47));

float sgDepth = sgFbm(sgP * 0.004 + 3.1);
vec3 sgWaterDeep = sgLinear(vec3(0.07, 0.36, 0.48));
vec3 sgWaterShallow = sgLinear(vec3(0.16, 0.56, 0.62));
vec3 sgWaterColor = mix(sgWaterDeep, sgWaterShallow, smoothstep(0.35, 0.75, sgDepth));
float sgShore = sgWater * (1.0 - sgWater) * 4.0;
sgWaterColor = mix(sgWaterColor, sgLinear(vec3(0.86, 0.94, 0.95)), sgShore * 0.55);

vec3 sgColor = sgLand;
sgColor = mix(sgColor, sgCivicLand, sgCivic * (1.0 - sgHill));
sgColor = mix(sgColor, sgPark, sgGreen);
sgColor = mix(sgColor, sgPlaza, sgFootprint);
sgColor = mix(sgColor, sgLane, sgMinor * (1.0 - sgHill * 0.6));
sgColor = mix(sgColor, sgAsphalt, sgRoad);
sgColor = mix(sgColor, sgAsphalt * 0.85, sgHighway);
sgColor = mix(sgColor, sgWaterColor, sgWater);
sgColor *= 0.93 + sgGrain * 0.12;
diffuseColor.rgb = sgColor;

float sgPathMask = 0.0;
float sgRoadEdge = 0.0;
`;

/**
 * Vector land-use mask path (see LandUseMask.ts for the channel encoding).
 * Every class gets a hand-tuned stylised material; hills without explicit
 * land cover become forest so country parks read green from the air.
 */
const GLSL_CLASSIFY_VECTOR = /* glsl */ `
vec4 sgMask = diffuseColor;
float sgRoad = smoothstep(0.43, 0.57, sgMask.r);
float sgHighway = smoothstep(0.86, 0.96, sgMask.r);
float sgDistributor = smoothstep(0.70, 0.80, sgMask.r) * (1.0 - sgHighway);
float sgPathMask = smoothstep(0.17, 0.26, sgMask.r) * (1.0 - sgRoad);
// Anti-aliased road borders fall through the lower bands: paint them as kerbs.
float sgRoadEdge = sgRoad * (1.0 - smoothstep(0.57, 0.66, sgMask.r)) * (1.0 - sgHighway);
float sgWood = smoothstep(0.80, 0.94, sgMask.g);
float sgGrass = smoothstep(0.55, 0.64, sgMask.g) * (1.0 - sgWood);
float sgPitch = smoothstep(0.32, 0.40, sgMask.g) * (1.0 - smoothstep(0.55, 0.64, sgMask.g));
float sgWater = smoothstep(0.66, 0.86, sgMask.b);
float sgSand = smoothstep(0.30, 0.40, sgMask.b) * (1.0 - sgWater);
float sgBuilt = smoothstep(0.35, 0.75, sgMask.a);
float sgMinor = 0.0;

vec3 sgN = normalize(vSgNormal);
float sgSlope = 1.0 - sgN.y;
vec2 sgP = vSgWorld.xz;
float sgBroad = sgFbm(sgP * 0.006);
float sgFine = sgNoise(sgP * 0.09) * 0.65 + sgNoise(sgP * 0.23) * 0.35;
float sgGrain = sgNoise(sgP * 0.9);
float sgHill = clamp(max(smoothstep(14.0, 40.0, vSgWorld.y + (sgBroad - 0.5) * 18.0), smoothstep(0.10, 0.22, sgSlope)), 0.0, 1.0);

// Woodland canopy: two-tone blotches, lighter on ridges, scrub and rock on high or steep ground.
vec3 sgForestA = sgLinear(vec3(0.30, 0.52, 0.22));
vec3 sgForestB = sgLinear(vec3(0.17, 0.36, 0.17));
vec3 sgForestLight = sgLinear(vec3(0.50, 0.66, 0.28));
vec3 sgScrub = sgLinear(vec3(0.62, 0.64, 0.38));
vec3 sgRock = sgLinear(vec3(0.58, 0.56, 0.50));
float sgCanopy = smoothstep(0.38, 0.62, sgNoise(sgP * 0.07) * 0.6 + sgNoise(sgP * 0.19) * 0.4);
vec3 sgForest = mix(sgForestB, sgForestA, sgCanopy);
sgForest = mix(sgForest, sgForestLight, smoothstep(0.62, 0.85, sgBroad) * 0.5);
vec3 sgHillCover = mix(sgForest, sgScrub, smoothstep(0.55, 0.90, vSgWorld.y / 420.0 + sgBroad * 0.35) * 0.55);
sgHillCover = mix(sgHillCover, sgRock, smoothstep(0.45, 0.66, sgSlope) * 0.65);

vec3 sgLawn = mix(sgLinear(vec3(0.42, 0.66, 0.28)), sgLinear(vec3(0.52, 0.72, 0.33)), sgFine);
vec3 sgMeadow = mix(sgLinear(vec3(0.55, 0.64, 0.34)), sgLinear(vec3(0.46, 0.60, 0.30)), sgFine);
float sgStripe = step(0.5, fract(sgP.x / 9.0));
vec3 sgPitchColor = mix(sgLinear(vec3(0.36, 0.64, 0.30)), sgLinear(vec3(0.44, 0.71, 0.35)), sgStripe);
vec3 sgSandColor = mix(sgLinear(vec3(0.90, 0.82, 0.62)), sgLinear(vec3(0.84, 0.75, 0.56)), sgFine);
vec2 sgTile = fract(sgP / 4.0);
float sgJoint = max(step(0.94, sgTile.x), step(0.94, sgTile.y));
vec3 sgPavingColor = mix(sgLinear(vec3(0.80, 0.76, 0.69)), sgLinear(vec3(0.72, 0.69, 0.64)), sgFine);
sgPavingColor *= 1.0 - sgJoint * 0.08;
vec3 sgAsphalt = mix(sgLinear(vec3(0.47, 0.47, 0.48)), sgLinear(vec3(0.42, 0.42, 0.43)), sgGrain);
vec3 sgDistributorColor = sgAsphalt * 0.92;
vec3 sgHighwayColor = mix(sgLinear(vec3(0.40, 0.40, 0.42)), sgLinear(vec3(0.36, 0.36, 0.38)), sgGrain);
vec3 sgKerb = sgLinear(vec3(0.78, 0.76, 0.72));
vec3 sgTrail = mix(sgLinear(vec3(0.66, 0.58, 0.44)), sgLinear(vec3(0.80, 0.78, 0.74)), 1.0 - sgHill);

vec3 sgColor = mix(sgMeadow, sgHillCover, sgHill);
sgColor = mix(sgColor, sgPavingColor, sgBuilt * (1.0 - sgHill * 0.35));
sgColor = mix(sgColor, mix(sgLawn, sgForest, sgHill * 0.6), sgGrass);
sgColor = mix(sgColor, sgPitchColor, sgPitch);
sgColor = mix(sgColor, sgHillCover * vec3(0.94, 1.0, 0.94), sgWood * max(sgHill, 0.75));
sgColor = mix(sgColor, sgForest, sgWood * (1.0 - max(sgHill, 0.75)));
sgColor = mix(sgColor, sgSandColor, sgSand);

float sgDepth = 0.5;
vec3 sgWaterColor = vec3(0.0);
if (sgWater > 0.002) {
  sgDepth = sgFbm(sgP * 0.004 + 3.1);
  vec3 sgWaterDeep = sgLinear(vec3(0.06, 0.38, 0.52));
  vec3 sgWaterShallow = sgLinear(vec3(0.18, 0.60, 0.66));
  sgWaterColor = mix(sgWaterDeep, sgWaterShallow, smoothstep(0.35, 0.75, sgDepth));
  float sgShore = 1.0 - smoothstep(0.86, 0.97, sgMask.b);
  sgWaterColor = mix(sgWaterColor, sgLinear(vec3(0.70, 0.86, 0.88)), sgShore * 0.3);
}
sgColor = mix(sgColor, sgWaterColor, sgWater);
sgColor = mix(sgColor, sgTrail, sgPathMask * mix(0.75, 0.42, sgHill));
sgColor = mix(sgColor, sgAsphalt, sgRoad);
sgColor = mix(sgColor, sgDistributorColor, sgDistributor);
sgColor = mix(sgColor, sgHighwayColor, sgHighway);
sgColor = mix(sgColor, sgKerb, sgRoadEdge * 0.5);
sgColor *= 0.94 + sgGrain * 0.10;
diffuseColor = vec4(sgColor, 1.0);
`;

const GLSL_WATER_NORMAL = /* glsl */ `
vec3 sgWaterNormal = vec3(0.0, 1.0, 0.0);
if (sgWater > 0.002) {
  float sgH0 = sgWaves(sgP, uSgTime);
  float sgHx = sgWaves(sgP + vec2(0.6, 0.0), uSgTime);
  float sgHz = sgWaves(sgP + vec2(0.0, 0.6), uSgTime);
  sgWaterNormal = normalize(vec3(-(sgHx - sgH0) / 0.6, 1.0, -(sgHz - sgH0) / 0.6));
}
`;

export interface StylizedGroundOptions {
  /** True when `material.map` is a LandUseMask texture rather than the LandsD basemap. */
  vectorMask: boolean;
}

export function applyStylizedGround(
  material: MeshStandardMaterial,
  options: StylizedGroundOptions = { vectorMask: false },
): MeshStandardMaterial {
  const classify = options.vectorMask ? GLSL_CLASSIFY_VECTOR : GLSL_CLASSIFY_BASEMAP;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, stylizedGroundUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vSgWorld;
varying vec3 vSgNormal;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
vSgNormal = normalize(mat3(modelMatrix) * objectNormal);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vSgWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
${GLSL_COMMON}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
${classify}
${GLSL_WATER_NORMAL}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.62, max(sgRoad, sgMinor * 0.3));
roughnessFactor = mix(roughnessFactor, 0.07, sgWater);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = normalize(mix(normal, normalize((viewMatrix * vec4(sgWaterNormal, 0.0)).xyz), sgWater));`);
  };
  material.customProgramCacheKey = () => (options.vectorMask ? 'stylized-ground-vector-v2' : 'stylized-ground-v4');
  material.needsUpdate = true;
  return material;
}
