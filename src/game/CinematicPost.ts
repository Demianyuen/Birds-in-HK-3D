import { HalfFloatType, ShaderMaterial, Vector2, WebGLRenderTarget, type Camera, type Scene, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/**
 * Flight-sim-like grade with a romantic glow: soft bloom on bright
 * surfaces and sky, a warm golden balance, shadows that lean cool, a touch
 * more colour and a gentle vignette. Bloom drops out on slow machines.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uWarmth: { value: [1.07, 1.0, 0.9] },
    uShadowTint: { value: [0.55, 0.7, 1.0] },
    uSaturation: { value: 1.1 },
    uVignette: { value: 0.2 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 uWarmth;
    uniform vec3 uShadowTint;
    uniform float uSaturation;
    uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 colour = texture2D(tDiffuse, vUv);
      float luma = dot(colour.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 graded = mix(vec3(luma), colour.rgb, uSaturation);
      // Warm light, cool shade.
      float shade = 1.0 - smoothstep(0.02, 0.45, luma);
      graded = graded * mix(uWarmth, uShadowTint, shade * 0.35);
      // A faint lift in the darks, like air between the camera and the city.
      graded += vec3(0.010, 0.012, 0.018) * shade;
      float edge = smoothstep(0.38, 0.9, distance(vUv, vec2(0.5)));
      graded *= 1.0 - uVignette * edge;
      gl_FragColor = vec4(graded, colour.a);
    }`,
};

export class CinematicPost {
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private bloomWanted = true;

  public constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera) {
    const size = renderer.getSize(new Vector2());
    const target = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new Vector2(size.x / 2, size.y / 2), 0.38, 0.72, 0.8);
    this.composer.addPass(this.bloom);
    const grade = new ShaderPass(new ShaderMaterial(GradeShader));
    this.composer.addPass(grade);
    this.composer.addPass(new OutputPass());
  }

  /** Bloom is the costly part: switch it off when the frame budget is tight. */
  public setBloom(enabled: boolean): void {
    this.bloomWanted = enabled;
    this.bloom.enabled = enabled;
  }

  public get bloomEnabled(): boolean {
    return this.bloomWanted;
  }

  public setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
  }

  public setPixelRatio(ratio: number): void {
    this.composer.setPixelRatio(ratio);
  }

  public render(deltaSeconds?: number): void {
    this.composer.render(deltaSeconds);
  }

  public dispose(): void {
    this.composer.dispose();
    this.bloom.dispose();
  }
}
