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

export function createRenderedBuildingMaterial(source: Material, identity: string): Material {
  const material = source;
  if (!(material instanceof MeshStandardMaterial)) return material;

  const tint = BUILDING_TINTS[stableHash(identity) % BUILDING_TINTS.length];
  material.color.multiply(tint);
  material.roughness = Math.min(material.roughness, 0.78);
  material.metalness = Math.max(material.metalness, 0.02);
  material.envMapIntensity = 0.72;
  material.onBeforeCompile = shader => applyFacadeShader(shader);
  material.customProgramCacheKey = () => 'csdi-rendered-building-v1';
  material.needsUpdate = true;
  return material;
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
