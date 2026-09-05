import {
  Color,
  Material,
  MeshStandardMaterial,
  type WebGLProgramParametersWithUniforms,
} from 'three';

const BUILDING_TINTS = [
  new Color('#d4c8b8'),
  new Color('#bac7c3'),
  new Color('#c7b7ae'),
  new Color('#b7c1c8'),
  new Color('#d1d0c4'),
];

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
    const tint = BUILDING_TINTS[stableHash(original.identity) % BUILDING_TINTS.length];
    source.color.multiply(tint);
    source.roughness = Math.min(source.roughness, 0.78);
    source.metalness = Math.max(source.metalness, 0.02);
    source.envMapIntensity = 0.72;
    source.onBeforeCompile = (shader, renderer) => {
      original.onBeforeCompile.call(source, shader, renderer);
      applyFacadeShader(shader);
    };
    source.customProgramCacheKey = () => `csdi-rendered-building-v2:${original.customProgramCacheKey.call(source)}`;
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
varying vec3 vCsdiWorldNormal;`,
    )
    .replace(
      '#include <map_fragment>',
      `#include <map_fragment>
vec3 csdiNormal = normalize(vCsdiWorldNormal);
float csdiFacade = 1.0 - smoothstep(0.42, 0.72, abs(csdiNormal.y));
float csdiHorizontal = abs(csdiNormal.x) > abs(csdiNormal.z)
  ? vCsdiWorldPosition.z
  : vCsdiWorldPosition.x;
float csdiColumn = fract(csdiHorizontal * 0.18);
float csdiRow = fract((vCsdiWorldPosition.y + 0.35) / 3.25);
float csdiPane = step(0.16, csdiColumn) * (1.0 - step(0.84, csdiColumn))
  * step(0.22, csdiRow) * (1.0 - step(0.78, csdiRow));
float csdiWindow = csdiFacade * csdiPane * 0.42;
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.22, 0.36, 0.44), csdiWindow);`,
    );
}

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}
