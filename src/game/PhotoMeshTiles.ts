import { deviceTier } from './deviceTier';
import { buildingUniforms } from './BuildingMaterial';
import { NEAR_GLSL_DECLARATIONS, nearCourt, nearUniforms, PHOTO_GROUND_BAND } from './nearCourt';
import { insideConvex as insideOutline } from '../wangFuk/MemorialPlaza';
import type { TilesRenderer } from '3d-tiles-renderer/three';
import { GLTFExtensionsPlugin, LoadRegionPlugin, ReorientationPlugin, SphereRegion } from '3d-tiles-renderer/plugins';
import { Color, DoubleSide, Group, MathUtils, Mesh, MeshBasicMaterial, Sphere, Vector2, Vector4, type Material, type MeshStandardMaterial, type Object3D, type PerspectiveCamera, type WebGLRenderer } from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { createRegionClippingPlanes } from './CsdiTiles';
import { geodeticToEcef } from './geo';
import { Ktx2ImageFix, landsdProxyUrl } from './ktx2ImageFix';
import type { FlightRegion } from './regions';

const STREAMING_EDGE_BUFFER_METRES = 650;
const MAX_CUTOUTS = 16;
/** Corners of the one convex area cut away as a whole (the grounds of Wang Fuk Court). */
const MAX_AREA_CORNERS = 48;

export interface PhotoMeshMetrics {
  models: number;
  errors: number;
  downloading: number;
  parsing: number;
}

/**
 * The LandsD 3D Visualisation Map: a photo-textured mesh of the whole city
 * made from oblique aerial images (buildings, ground, trees, water in one).
 * Shown unlit, because the photographs already hold the daylight. Loaded
 * only when the visitor picks the aerial-photo view.
 */
export class PhotoMeshTiles {
  public readonly group = new Group();
  private tiles: TilesRenderer | null = null;
  private loading: Promise<void> | null = null;
  private readonly materials = new Set<MeshBasicMaterial>();
  /** The photos carry daylight; the time of day warms and dims them with this colour. */
  private readonly tint = new Color('#ffffff');
  private readonly cutouts = { value: Array.from({ length: MAX_CUTOUTS }, () => new Vector4(0, 0, 0, 1e9)) };
  private readonly areaCorners = { value: Array.from({ length: MAX_AREA_CORNERS }, () => new Vector2()) };
  private readonly areaCount = { value: 0 };
  private readonly areaMinY = { value: 1e9 };
  private area: ReadonlyArray<{ x: number; z: number }> = [];
  private readonly cutoutCount = { value: 0 };
  private readonly loadedModels = new Set<Object3D>();
  private errors = 0;

  public constructor() {
    this.group.name = 'LandsD aerial photo mesh';
    this.group.visible = false;
  }

  /** Starts streaming (once) around the region. Resolves when the first model has arrived. */
  public load(camera: PerspectiveCamera, renderer: WebGLRenderer, region: FlightRegion): Promise<void> {
    this.loading ??= this.start(camera, renderer, region);
    return this.loading;
  }

  private async start(camera: PerspectiveCamera, renderer: WebGLRenderer, region: FlightRegion): Promise<void> {
    const { TilesRenderer: Renderer } = await import('3d-tiles-renderer/three');
    const tiles = new Renderer(new URL('/landsd-3dvis/tileset.json', window.location.href).toString());
    this.tiles = tiles;
    tiles.registerPlugin({ name: 'LANDSD_PROXY', preprocessURL: (uri: string | URL) => landsdProxyUrl(uri, window.location.origin) } as never);
    tiles.errorTarget = deviceTier().photoMeshError;
    tiles.lruCache.maxBytesSize = deviceTier().tileCacheBytes;
    tiles.lruCache.minBytesSize = deviceTier().tileCacheBytes * 0.75;
    tiles.loadAncestors = true;
    tiles.setCamera(camera);
    tiles.setResolutionFromRenderer(camera, renderer);
    const draco = new DRACOLoader(tiles.manager).setDecoderPath('/draco/gltf/');
    const ktx2 = new KTX2Loader(tiles.manager).setTranscoderPath('/basis/').setWorkerLimit(2).detectSupport(renderer);
    tiles.registerPlugin(new GLTFExtensionsPlugin({
      dracoLoader: draco,
      ktxLoader: ktx2,
      rtc: true,
      autoDispose: false,
      plugins: [parser => new Ktx2ImageFix(parser as never) as never],
    }));
    const loadRegion = new LoadRegionPlugin();
    loadRegion.addRegion(new SphereRegion({
      sphere: new Sphere(geodeticToEcef(region.latitude, region.longitude, 120), region.flightRadiusMetres + STREAMING_EDGE_BUFFER_METRES),
      errorTarget: tiles.errorTarget,
      mask: true,
    }));
    tiles.registerPlugin(loadRegion);
    // Same frame as the CSDI layers, so the two line up and switch cleanly.
    tiles.registerPlugin(new ReorientationPlugin({
      lat: MathUtils.degToRad(region.latitude),
      lon: MathUtils.degToRad(region.longitude),
      recenter: true,
      azimuth: Math.PI,
    }));
    const clipping = createRegionClippingPlanes(region.flightRadiusMetres);
    this.group.add(tiles.group);

    await new Promise<void>(resolve => {
      let settled = false;
      tiles.addEventListener('load-model', (event: { scene: Object3D }) => {
        this.loadedModels.add(event.scene);
        event.scene.traverse(object => {
          const mesh = object as Mesh;
          if (!mesh.isMesh) return;
          const old = mesh.material as MeshStandardMaterial;
          // Both sides, so rays fired from inside a tower (to measure it) still meet its walls.
          const material = new MeshBasicMaterial({ map: old.map ?? null, color: old.map ? '#ffffff' : '#cfcfcf', side: DoubleSide });
          material.color.multiply(this.tint);
          material.userData.baseColour = old.map ? 1 : 0.6;
          if (material.map) material.map.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
          material.clippingPlanes = clipping;
          this.addCutoutShader(material);
          this.materials.add(material);
          mesh.material = material;
          old.dispose();
          mesh.castShadow = false;
          mesh.receiveShadow = false;
          // What is cut away out of sight cannot be landed on or bumped into either.
          const cutouts = this.cutouts;
          const owner = this;
          const count = this.cutoutCount;
          mesh.raycast = function raycastOutsideCutouts(raycaster, intersects) {
            const before = intersects.length;
            Mesh.prototype.raycast.call(this, raycaster, intersects);
            for (let index = intersects.length - 1; index >= before; index -= 1) {
              const point = intersects[index].point;
              if (owner.measuringWhole) break;
              if (insideCutouts(point, cutouts.value, count.value) || owner.hidesInArea(point) || nearCourt.photoHidden(point)) intersects.splice(index, 1);
            }
          };
        });
        if (!settled) {
          settled = true;
          resolve();
        }
      });
      tiles.addEventListener('dispose-model', (event: { scene: Object3D }) => {
        this.loadedModels.delete(event.scene);
        event.scene.traverse(object => {
          const mesh = object as Mesh;
          if (!mesh.isMesh) return;
          const material = mesh.material as MeshBasicMaterial;
          this.materials.delete(material);
          material.map?.dispose();
          material.dispose();
        });
      });
      tiles.addEventListener('load-error', () => {
        this.errors += 1;
      });
      // Never block the game on this optional layer.
      window.setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve();
        }
      }, 45_000);
    });
  }

  /** Hide the photo mesh inside these circles above `minY` (for hand-built hero models). */
  public setCutouts(circles: ReadonlyArray<{ x: number; z: number; radius: number; minY: number }>): void {
    this.cutoutCount.value = Math.min(MAX_CUTOUTS, circles.length);
    circles.slice(0, MAX_CUTOUTS).forEach((circle, index) => this.cutouts.value[index].set(circle.x, circle.z, circle.radius, circle.minY));
  }

  /** Coarser tiles on slow computers: 1 is normal, larger loads less detail. */
  public setDetail(coarseness: number): void {
    if (this.tiles) this.tiles.errorTarget = deviceTier().photoMeshError * coarseness;
  }

  /** Hide the photo mesh above `minY` inside one convex outline (counter-clockwise in x, z), or nowhere. */
  public setCutArea(area: { outline: ReadonlyArray<{ x: number; z: number }>; minY: number } | null): void {
    const outline = area ? area.outline.slice(0, MAX_AREA_CORNERS) : [];
    this.area = outline;
    this.areaCount.value = outline.length;
    this.areaMinY.value = area ? area.minY : 1e9;
    outline.forEach((corner, index) => this.areaCorners.value[index].set(corner.x, corner.z));
    nearCourt.setArea(outline, area ? area.minY : 1e9);
  }

  /** While true, rays see the whole photo mesh, cut-away parts included. */
  public measuringWhole = false;

  /**
   * Runs `measure` with rays seeing the whole photo mesh. The towers of Wang Fuk
   * Court are found by measuring the photo mesh where it is later cut away, so
   * that measuring must not be blinded by the cuts.
   */
  public whole<T>(measure: () => T): T {
    this.measuringWhole = true;
    try {
      return measure();
    } finally {
      this.measuringWhole = false;
    }
  }

  /** True where the cut area hides the photo mesh. */
  public hidesInArea(point: { x: number; y: number; z: number }): boolean {
    return this.area.length >= 3 && point.y > this.areaMinY.value && insideOutline(point.x, point.z, this.area);
  }

  private addCutoutShader(material: Material): void {
    material.onBeforeCompile = shader => {
      shader.uniforms.uCutouts = this.cutouts;
      shader.uniforms.uCutoutCount = this.cutoutCount;
      Object.assign(shader.uniforms, nearUniforms, {
        uCsdiHeight: buildingUniforms.uCsdiHeight, uCsdiHeightBounds: buildingUniforms.uCsdiHeightBounds,
      });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vPhotoWorld;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvPhotoWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vPhotoWorld;
uniform vec4 uCutouts[${MAX_CUTOUTS}];
uniform int uCutoutCount;
uniform sampler2D uCsdiHeight;
uniform vec4 uCsdiHeightBounds;
${NEAR_GLSL_DECLARATIONS}`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
for (int i = 0; i < ${MAX_CUTOUTS}; i++) {
  if (i >= uCutoutCount) break;
  vec4 c = uCutouts[i];
  if (vPhotoWorld.y > c.w && distance(vPhotoWorld.xz, c.xy) < c.z) discard;
}
if (vPhotoWorld.y > uAreaMinY && nearInArea(vPhotoWorld.xz)) discard;
// Round the estate only the photo mesh's ground is kept: its buildings are too soft up close.
if (uNear.w > 0.5 && distance(vPhotoWorld.xz, uNear.xy) < uNear.z) {
  float nearGround = texture2D(uCsdiHeight, (vPhotoWorld.xz - uCsdiHeightBounds.xy) / uCsdiHeightBounds.zw).r + uNearLift;
  if (vPhotoWorld.y > nearGround + ${PHOTO_GROUND_BAND.toFixed(1)}) discard;
}`);
    };
    material.customProgramCacheKey = () => 'landsd-photo-cutouts-near-v1';
  }

  public setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  public get visible(): boolean {
    return this.group.visible;
  }

  public get ready(): boolean {
    return this.loadedModels.size > 0;
  }

  public setTint(tint: Color): void {
    this.tint.copy(tint);
    for (const material of this.materials) {
      const base = typeof material.userData.baseColour === 'number' ? material.userData.baseColour : 1;
      material.color.setScalar(base).multiply(this.tint);
    }
  }

  public update(camera: PerspectiveCamera, renderer: WebGLRenderer): void {
    if (!this.tiles || !this.group.visible) return;
    camera.updateMatrixWorld(true);
    this.tiles.group.updateMatrixWorld(true);
    this.tiles.setResolutionFromRenderer(camera, renderer);
    this.tiles.update();
  }

  public get metrics(): PhotoMeshMetrics {
    const stats = (this.tiles as unknown as { stats?: { downloading: number; parsing: number } } | null)?.stats;
    return { models: this.loadedModels.size, errors: this.errors, downloading: stats?.downloading ?? 0, parsing: stats?.parsing ?? 0 };
  }

  public dispose(): void {
    this.tiles?.dispose();
    this.tiles = null;
    this.loading = null;
    this.group.clear();
  }
}

/** True where the photo mesh is hidden: inside one of the first `count` circles (x, z, radius, minY) and above its minY. */
export function insideCutouts(point: { x: number; y: number; z: number }, circles: readonly Vector4[], count: number): boolean {
  for (let index = 0; index < Math.min(count, circles.length); index += 1) {
    const circle = circles[index];
    if (point.y > circle.w && Math.hypot(point.x - circle.x, point.z - circle.y) < circle.z) return true;
  }
  return false;
}
