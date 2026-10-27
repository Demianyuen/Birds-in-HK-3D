import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';

export interface SkyPalette {
  zenith: string;
  horizon: string;
  ground: string;
  sunGlow: string;
}

export const DAY_SKY: SkyPalette = {
  zenith: '#3f8fd8',
  horizon: '#cfe6f0',
  ground: '#9fb9c4',
  sunGlow: '#fff2d6',
};

/** Late-afternoon light for the flight-sim look: deep blue overhead, a warm glowing horizon. */
export const GOLDEN_SKY: SkyPalette = {
  zenith: '#3d7fc6',
  horizon: '#f1dcc4',
  ground: '#a7aa9c',
  sunGlow: '#ffd29a',
};

/** Stylised gradient sky dome with a soft sun halo. Not affected by fog. */
export function createGradientSky(sunDirection: Vector3, palette: SkyPalette = DAY_SKY, radius = 45_000): Mesh {
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: new Color(palette.zenith) },
      uHorizon: { value: new Color(palette.horizon) },
      uGround: { value: new Color(palette.ground) },
      uSunGlow: { value: new Color(palette.sunGlow) },
      uSunDirection: { value: sunDirection.clone().normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vSkyDirection;
      void main() {
        vSkyDirection = normalize(position);
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = clip.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uGround;
      uniform vec3 uSunGlow;
      uniform vec3 uSunDirection;
      varying vec3 vSkyDirection;
      void main() {
        vec3 direction = normalize(vSkyDirection);
        float height = direction.y;
        vec3 sky = mix(uHorizon, uZenith, pow(smoothstep(0.0, 0.62, height), 0.75));
        sky = mix(sky, uGround, smoothstep(0.0, -0.12, height));
        float sun = max(dot(direction, normalize(uSunDirection)), 0.0);
        sky += uSunGlow * (pow(sun, 8.0) * 0.28 + pow(sun, 220.0) * 1.6);
        gl_FragColor = vec4(sky, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new Mesh(new SphereGeometry(radius, 32, 16), material);
  mesh.name = 'Gradient sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}
