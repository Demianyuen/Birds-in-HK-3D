import {
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  Material,
  MeshStandardMaterial,
  RedFormat,
  Vector4,
  type WebGLProgramParametersWithUniforms,
} from 'three';

/**
 * Shared by every stylised building material: a terrain height field so the
 * facade shader knows how far each fragment is above the street. That drives
 * ground-floor shopfronts, signage bands and contact shading.
 */
export const buildingUniforms = {
  uCsdiHeight: { value: createHeightTexture(new Float32Array([0]), 1) },
  uCsdiHeightBounds: { value: new Vector4(0, 0, 1, 1) },
  uCsdiHeightReady: { value: 0 },
};

export interface HeightField {
  heights: Float32Array;
  resolution: number;
  minX: number;
  minZ: number;
  size: number;
}

export function setBuildingGroundHeight(field: HeightField | null): void {
  const previous = buildingUniforms.uCsdiHeight.value;
  if (!field) {
    buildingUniforms.uCsdiHeightReady.value = 0;
    return;
  }
  buildingUniforms.uCsdiHeight.value = createHeightTexture(field.heights, field.resolution);
  buildingUniforms.uCsdiHeightBounds.value.set(field.minX, field.minZ, field.size, field.size);
  buildingUniforms.uCsdiHeightReady.value = 1;
  previous.dispose();
}

function createHeightTexture(heights: Float32Array, resolution: number): DataTexture {
  const half = new Uint16Array(heights.length);
  for (let index = 0; index < heights.length; index += 1) half[index] = DataUtils.toHalfFloat(heights[index]);
  // Row 0 = minimum z, so v follows world z directly.
  const texture = new DataTexture(half, resolution, resolution, RedFormat, HalfFloatType);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}


export type BuildingPresentation = 'preservation' | 'reference';
interface SourceAppearance {
  color: Color;
  roughness: number;
  metalness: number;
  envMapIntensity: number;
  onBeforeCompile: Material['onBeforeCompile'];
  customProgramCacheKey: Material['customProgramCacheKey'];
  identity: string;
}
const sourceAppearances = new WeakMap<MeshStandardMaterial, SourceAppearance>();

export function setBuildingPresentation(source: Material, identity: string, mode: BuildingPresentation): Material {
  if (!(source instanceof MeshStandardMaterial)) return source;
  let original = sourceAppearances.get(source);
  if (!original) {
    original = {
      color: source.color.clone(), roughness: source.roughness, metalness: source.metalness,
      envMapIntensity: source.envMapIntensity, onBeforeCompile: source.onBeforeCompile,
      customProgramCacheKey: source.customProgramCacheKey, identity,
    };
    sourceAppearances.set(source, original);
  }
  source.color.copy(original.color);
  source.roughness = original.roughness;
  source.metalness = original.metalness;
  source.envMapIntensity = original.envMapIntensity;
  source.onBeforeCompile = original.onBeforeCompile;
  source.customProgramCacheKey = original.customProgramCacheKey;
  if (mode === 'preservation') {
    source.color.set('#ffffff');
    source.roughness = 0.86;
    source.metalness = 0;
    source.envMapIntensity = 1;
    source.onBeforeCompile = (shader, renderer) => {
      original.onBeforeCompile.call(source, shader, renderer);
      Object.assign(shader.uniforms, buildingUniforms);
      applyFacadeShader(shader);
    };
    source.customProgramCacheKey = () => `csdi-stylized-building-v5:${original.customProgramCacheKey.call(source)}`;
  }
  source.needsUpdate = true;
  return source;
}

export function createRenderedBuildingMaterial(source: Material, identity: string): Material {
  return setBuildingPresentation(source, identity, 'preservation');
}

function applyFacadeShader(shader: WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
varying vec3 vCsdiWorldPosition;
varying vec3 vCsdiWorldNormal;`,
    )
    .replace(
      '#include <beginnormal_vertex>',
      `#include <beginnormal_vertex>
vCsdiWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
vCsdiWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
    );

  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
varying vec3 vCsdiWorldPosition;
varying vec3 vCsdiWorldNormal;
uniform sampler2D uCsdiHeight;
uniform vec4 uCsdiHeightBounds;
uniform float uCsdiHeightReady;
float csdiHash(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
vec3 csdiPalette(float id) {
  // Hong Kong residential pastels (sRGB); converted to linear below.
  vec3 c = vec3(0.93, 0.88, 0.76);
  c = mix(c, vec3(0.73, 0.86, 0.78), step(0.125, id));
  c = mix(c, vec3(0.92, 0.74, 0.66), step(0.250, id));
  c = mix(c, vec3(0.74, 0.83, 0.91), step(0.375, id));
  c = mix(c, vec3(0.95, 0.88, 0.64), step(0.500, id));
  c = mix(c, vec3(0.93, 0.93, 0.90), step(0.625, id));
  c = mix(c, vec3(0.82, 0.78, 0.88), step(0.750, id));
  c = mix(c, vec3(0.86, 0.62, 0.52), step(0.875, id));
  return pow(c * 0.9, vec3(2.2));
}`,
    )
    .replace(
      '#include <map_fragment>',
      `#include <map_fragment>
vec3 csdiN = normalize(vCsdiWorldNormal);
vec3 csdiP = vCsdiWorldPosition;
float csdiRoof = smoothstep(0.55, 0.85, csdiN.y);
float csdiWall = 1.0 - smoothstep(0.35, 0.60, abs(csdiN.y));
vec2 csdiCell = floor(csdiP.xz / 42.0);
float csdiId = csdiHash(csdiCell);
float csdiTex = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
float csdiDetail = clamp(0.86 + (sqrt(csdiTex) - 0.42) * 0.55, 0.68, 1.08);
vec3 csdiWallColor = csdiPalette(csdiId) * csdiDetail;

float csdiAlong = abs(csdiN.x) > abs(csdiN.z) ? csdiP.z : csdiP.x;
vec2 csdiUv = vec2(csdiAlong / 2.6, (csdiP.y + 0.4) / 2.95);
vec2 csdiF = fract(csdiUv);
vec2 csdiW = max(fwidth(csdiUv), vec2(1e-4));
float csdiFade = 1.0 - smoothstep(0.22, 0.55, max(csdiW.x, csdiW.y));
float csdiPaneX = smoothstep(0.18 - csdiW.x, 0.18 + csdiW.x, csdiF.x)
  * (1.0 - smoothstep(0.82 - csdiW.x, 0.82 + csdiW.x, csdiF.x));
float csdiPaneY = smoothstep(0.30 - csdiW.y, 0.30 + csdiW.y, csdiF.y)
  * (1.0 - smoothstep(0.86 - csdiW.y, 0.86 + csdiW.y, csdiF.y));
float csdiWindow = csdiPaneX * csdiPaneY * csdiWall;
float csdiSill = (smoothstep(0.19, 0.21 + csdiW.y, csdiF.y) - smoothstep(0.27, 0.29 + csdiW.y, csdiF.y)) * csdiWall;
float csdiWinId = csdiHash(floor(csdiUv) + csdiCell * 17.0);
vec3 csdiGlass = mix(vec3(0.035, 0.065, 0.10), vec3(0.16, 0.22, 0.27), csdiWinId);
csdiGlass = mix(csdiGlass, vec3(0.42, 0.36, 0.27), step(0.86, csdiWinId) * 0.65);

vec3 csdiColor = mix(csdiWallColor, csdiWallColor * 1.18, csdiSill * csdiFade);
csdiColor = mix(csdiColor, csdiGlass, csdiWindow * csdiFade);
csdiColor = mix(csdiColor, mix(csdiWallColor, csdiGlass, 0.3), csdiWall * (1.0 - csdiFade) * 0.85);
// Roofs: per-building concrete tone with soft, low-contrast slab joints (no checkerboard).
vec3 csdiRoofColor = mix(vec3(0.34, 0.33, 0.31), vec3(0.46, 0.44, 0.40), csdiHash(csdiCell + 7.31));
vec2 csdiSlab = fract(csdiP.xz / 6.0);
vec2 csdiSlabW = max(fwidth(csdiP.xz / 6.0), vec2(1e-4));
float csdiJoint = (1.0 - smoothstep(0.0, 0.03 + csdiSlabW.x, csdiSlab.x)) + (1.0 - smoothstep(0.0, 0.03 + csdiSlabW.y, csdiSlab.y));
csdiRoofColor *= 1.0 - clamp(csdiJoint, 0.0, 1.0) * 0.07 * csdiFade;
csdiRoofColor *= 0.97 + csdiHash(floor(csdiP.xz / 1.5) + csdiCell) * 0.06 * csdiFade;
// Street level: height above the terrain under this fragment.
vec2 csdiHeightUv = (csdiP.xz - uCsdiHeightBounds.xy) / uCsdiHeightBounds.zw;
float csdiAbove = mix(40.0, csdiP.y - texture2D(uCsdiHeight, csdiHeightUv).r, uCsdiHeightReady);
float csdiStreet = csdiWall * step(-2.0, csdiAbove) * (1.0 - smoothstep(4.3, 4.5, csdiAbove));
// About half of the estates/streets get Hong Kong shopfronts with signage bands.
float csdiShops = step(0.45, csdiHash(csdiCell + 3.17)) * csdiStreet;
float csdiSeg = floor(csdiAlong / 5.5);
float csdiSegId = csdiHash(vec2(csdiSeg, csdiCell.x * 3.1 + csdiCell.y));
vec3 csdiSign = vec3(0.62, 0.10, 0.08);
csdiSign = mix(csdiSign, vec3(0.80, 0.55, 0.06), step(0.25, csdiSegId));
csdiSign = mix(csdiSign, vec3(0.06, 0.38, 0.20), step(0.45, csdiSegId));
csdiSign = mix(csdiSign, vec3(0.08, 0.20, 0.52), step(0.62, csdiSegId));
csdiSign = mix(csdiSign, vec3(0.86, 0.84, 0.80), step(0.80, csdiSegId));
float csdiSignBand = smoothstep(3.0, 3.1, csdiAbove) * (1.0 - smoothstep(4.1, 4.2, csdiAbove));
float csdiShutter = step(0.72, csdiHash(vec2(csdiSeg * 1.7, csdiCell.y)));
vec3 csdiShopGlass = mix(vec3(0.30, 0.22, 0.12), vec3(0.10, 0.10, 0.11), smoothstep(0.4, 2.6, csdiAbove));
vec3 csdiShopFront = mix(csdiShopGlass, vec3(0.30, 0.31, 0.32) * (0.9 + 0.1 * step(0.5, fract(csdiP.y * 4.0))), csdiShutter);
csdiShopFront = mix(csdiShopFront, csdiSign, csdiSignBand);
csdiShopFront = mix(csdiShopFront, csdiWallColor * 0.55, 1.0 - smoothstep(0.25, 0.35, csdiAbove));
csdiColor = mix(csdiColor, csdiShopFront, csdiShops);
// Plain buildings get a darker plinth instead of windows at street level.
csdiColor = mix(csdiColor, csdiWallColor * 0.78, csdiStreet * (1.0 - csdiShops) * (1.0 - smoothstep(2.8, 3.2, csdiAbove)));
// Contact shading: walls darken softly towards the street.
csdiColor *= mix(1.0, mix(0.72, 1.0, smoothstep(0.0, 14.0, csdiAbove)), csdiWall * uCsdiHeightReady);
float csdiGlassBoost = csdiShops * (1.0 - csdiShutter) * (1.0 - csdiSignBand) * smoothstep(0.35, 0.6, csdiAbove) * (1.0 - smoothstep(2.8, 3.0, csdiAbove));
csdiColor = mix(csdiColor, csdiRoofColor, csdiRoof);
diffuseColor.rgb = csdiColor;
float csdiGlassMask = max(csdiWindow * csdiFade * (1.0 - csdiStreet), csdiGlassBoost);`,
    )
    .replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
roughnessFactor = mix(0.86, 0.16, csdiGlassMask);`,
    )
    .replace(
      '#include <metalnessmap_fragment>',
      `#include <metalnessmap_fragment>
metalnessFactor = mix(0.0, 0.4, csdiGlassMask);`,
    );
}

/**
 * Bridges, flyovers and footbridges from the CSDI infrastructure layer.
 * Geometry is untouched; decks read as asphalt and piers/sides as light
 * concrete so they match the stylised ground instead of floating grey slabs.
 */
export function createInfrastructureMaterial(source: Material): Material {
  if (!(source instanceof MeshStandardMaterial)) return source;
  if (source.userData.stylisedInfrastructure) return source;
  source.userData.stylisedInfrastructure = true;
  const previous = source.onBeforeCompile;
  const previousKey = source.customProgramCacheKey;
  source.color.set('#ffffff');
  source.roughness = 0.84;
  source.metalness = 0;
  source.onBeforeCompile = (shader, renderer) => {
    previous.call(source, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vInfraWorldNormal;
varying vec3 vInfraWorldPosition;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
vInfraWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vInfraWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vInfraWorldNormal;
varying vec3 vInfraWorldPosition;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
float infraTex = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
float infraDeck = smoothstep(0.6, 0.85, normalize(vInfraWorldNormal).y);
vec3 infraConcrete = pow(vec3(0.80, 0.78, 0.74), vec3(2.2)) * (0.92 + clamp(sqrt(infraTex), 0.0, 1.0) * 0.12);
float infraBand = smoothstep(0.0, 0.6, fract(vInfraWorldPosition.y / 3.0)) * 0.06;
infraConcrete *= 1.0 - infraBand;
vec3 infraAsphalt = pow(vec3(0.38, 0.39, 0.42), vec3(2.2));
diffuseColor.rgb = mix(infraConcrete, infraAsphalt, infraDeck);`);
  };
  source.customProgramCacheKey = () => `csdi-stylised-infrastructure-v1:${previousKey.call(source)}`;
  source.needsUpdate = true;
  return source;
}
