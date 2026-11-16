import {
  Color, DoubleSide, LinearFilter, OrthographicCamera, ShaderMaterial, Vector4, WebGLRenderTarget,
  type Object3D, type Scene, type WebGLRenderer,
} from 'three';

/** Layer carrying only the CSDI building meshes, so the mask can draw them alone. */
export const BUILDING_MASK_LAYER = 5;

/**
 * Where the official (CSDI) buildings stand, seen from straight above, as a texture.
 *
 * The aerial photo mesh fuses buildings with the ground and they look melted. With
 * this mask the photo mesh is not drawn wherever a clean CSDI building is being
 * shown, so every building in view is the clean one, while hills, trees, roads
 * and water stay as photographed. Redrawn a few times a second from whatever
 * building tiles are showing.
 */
export const maskUniforms = {
  /** 1 while clean buildings replace the photo mesh's. */
  uClean: { value: 0 },
  uBuildingMask: { value: null as unknown as WebGLRenderTarget['texture'] },
  /** minX, minZ, size, metres the footprints are widened by. */
  uBuildingMaskBounds: { value: new Vector4(0, 0, 1, 4) },
};

export const MASK_GLSL_DECLARATIONS = `
uniform float uClean;
uniform sampler2D uBuildingMask;
uniform vec4 uBuildingMaskBounds;
float buildingMaskAt(vec2 xz) {
  vec2 uv = (xz - uBuildingMaskBounds.xy) / uBuildingMaskBounds.z;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  // The mask camera looks down with north (−z) at the top of the picture.
  uv.y = 1.0 - uv.y;
  return texture2D(uBuildingMask, uv).r;
}
/** x: 1 on a footprint; y: the roof height there, metres. */
vec2 buildingMaskTap(vec2 xz) {
  vec2 uv = (xz - uBuildingMaskBounds.xy) / uBuildingMaskBounds.z;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec2(0.0);
  uv.y = 1.0 - uv.y;
  vec4 t = texture2D(uBuildingMask, uv);
  return t.r > 0.5 ? vec2(1.0, t.g * 512.0) : vec2(0.0);
}
/**
 * Whether a piece of the photo mesh belongs to a building that the clean one replaces.
 * Inside the footprint: always. In a band round it (the photo mesh's building skirts
 * spread past the true walls): walls and overhanging roof go, level ground stays, so
 * no hole opens round the clean building.
 */
bool buildingMaskHides(vec3 world) {
  if (buildingMaskAt(world.xz) > 0.5) return true;
  float w = uBuildingMaskBounds.w;
  vec2 m = buildingMaskTap(world.xz + vec2(w, 0.0));
  m = max(m, buildingMaskTap(world.xz - vec2(w, 0.0)));
  m = max(m, buildingMaskTap(world.xz + vec2(0.0, w)));
  m = max(m, buildingMaskTap(world.xz - vec2(0.0, w)));
  m = max(m, buildingMaskTap(world.xz + vec2(w, w) * 0.7));
  m = max(m, buildingMaskTap(world.xz - vec2(w, w) * 0.7));
  m = max(m, buildingMaskTap(world.xz + vec2(w, -w) * 0.7));
  m = max(m, buildingMaskTap(world.xz - vec2(w, -w) * 0.7));
  if (m.x < 0.5) return false;
  vec3 n = normalize(cross(dFdx(world), dFdy(world)));
  bool level = abs(n.y) > 0.75;
  return !(level && world.y < m.y - 6.0);
}`;

export class BuildingMask {
  private readonly target: WebGLRenderTarget;
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 1, 20_000);
  /** Red: a building stands here. Green: its roof height (0–512 m). */
  private readonly material = new ShaderMaterial({
    side: DoubleSide,
    vertexShader: `varying float vHeight;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vHeight = world.y;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `varying float vHeight;
      void main() { gl_FragColor = vec4(1.0, clamp(vHeight / 512.0, 0.0, 1.0), 0.0, 1.0); }`,
  });
  private readonly black = new Color('#000000');
  private lastDraw = -1e9;

  public constructor(resolution: number) {
    this.target = new WebGLRenderTarget(resolution, resolution, { minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false });
    maskUniforms.uBuildingMask.value = this.target.texture;
    this.camera.layers.set(BUILDING_MASK_LAYER);
    // Looking straight down, north at the top.
    this.camera.up.set(0, 0, -1);
  }

  /** The square of land the mask covers, centred on the region's origin. */
  public setArea(halfSize: number): void {
    this.camera.left = -halfSize;
    this.camera.right = halfSize;
    this.camera.top = halfSize;
    this.camera.bottom = -halfSize;
    this.camera.position.set(0, 10_000, 0);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
    maskUniforms.uBuildingMaskBounds.value.set(-halfSize, -halfSize, halfSize * 2, 4);
  }

  public setOn(on: boolean): void {
    maskUniforms.uClean.value = on ? 1 : 0;
  }

  public get on(): boolean {
    return maskUniforms.uClean.value > 0.5;
  }

  /** Redraw the footprints (at most every `everyMs`). `buildings` must be showing in `scene`. */
  public update(renderer: WebGLRenderer, scene: Scene, nowMs: number, everyMs = 1_500): void {
    if (!this.on || nowMs - this.lastDraw < everyMs) return;
    this.lastDraw = nowMs;
    const background = scene.background;
    const override = scene.overrideMaterial;
    const target = renderer.getRenderTarget();
    const shadows = renderer.shadowMap.enabled;
    const clear = renderer.getClearColor(new Color());
    const alpha = renderer.getClearAlpha();
    scene.background = null;
    scene.overrideMaterial = this.material;
    renderer.shadowMap.enabled = false;
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(this.black, 1);
    renderer.clear();
    renderer.render(scene, this.camera);
    renderer.setRenderTarget(target);
    renderer.setClearColor(clear, alpha);
    renderer.shadowMap.enabled = shadows;
    scene.overrideMaterial = override;
    scene.background = background;
  }

  public dispose(): void {
    this.target.dispose();
    this.material.dispose();
  }
}

/** Marks a CSDI building mesh so the mask camera draws it. */
export function showInBuildingMask(object: Object3D): void {
  object.layers.enable(BUILDING_MASK_LAYER);
}
