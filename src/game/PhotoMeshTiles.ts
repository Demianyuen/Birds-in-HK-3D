import type { TilesRenderer } from '3d-tiles-renderer/three';
import { GLTFExtensionsPlugin, LoadRegionPlugin, ReorientationPlugin, SphereRegion } from '3d-tiles-renderer/plugins';
import { DoubleSide, Group, MathUtils, Mesh, MeshBasicMaterial, Sphere, Vector4, type Material, type MeshStandardMaterial, type Object3D, type PerspectiveCamera, type WebGLRenderer } from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { createRegionClippingPlanes } from './CsdiTiles';
import { geodeticToEcef } from './geo';
import { Ktx2ImageFix, landsdProxyUrl } from './ktx2ImageFix';
import type { FlightRegion } from './regions';

const STREAMING_EDGE_BUFFER_METRES = 650;
const MAX_CUTOUTS = 16;

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
  private readonly cutouts = { value: Array.from({ length: MAX_CUTOUTS }, () => new Vector4(0, 0, 0, 1e9)) };
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
    tiles.errorTarget = 12;
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
          if (material.map) material.map.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
          material.clippingPlanes = clipping;
          this.addCutoutShader(material);
          this.materials.add(material);
          mesh.material = material;
          old.dispose();
          mesh.castShadow = false;
          mesh.receiveShadow = false;
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

  private addCutoutShader(material: Material): void {
    material.onBeforeCompile = shader => {
      shader.uniforms.uCutouts = this.cutouts;
      shader.uniforms.uCutoutCount = this.cutoutCount;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vPhotoWorld;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvPhotoWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vPhotoWorld;
uniform vec4 uCutouts[${MAX_CUTOUTS}];
uniform int uCutoutCount;`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
for (int i = 0; i < ${MAX_CUTOUTS}; i++) {
  if (i >= uCutoutCount) break;
  vec4 c = uCutouts[i];
  if (vPhotoWorld.y > c.w && distance(vPhotoWorld.xz, c.xy) < c.z) discard;
}`);
    };
    material.customProgramCacheKey = () => 'landsd-photo-cutouts';
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
