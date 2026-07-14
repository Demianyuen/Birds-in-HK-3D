import type { TilesRenderer } from '3d-tiles-renderer/three';
import { GLTFExtensionsPlugin, ReorientationPlugin } from '3d-tiles-renderer/plugins';
import { Box3, Frustum, MathUtils, Matrix4, Material, Mesh } from 'three';
import type { Object3D, PerspectiveCamera, WebGLRenderer } from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { createRenderedBuildingMaterial } from './BuildingMaterial';
import type { FlightRegion } from './regions';

export type CsdiLayerName = 'building' | 'infrastructure';

export interface MapLoadProgress {
  stage: string;
  detail: string;
  percent: number;
  modelsLoaded: number;
}

export interface CsdiMaterialMetrics {
  meshes: number;
  materials: number;
  texturedMaterials: number;
}

export class CsdiTiles {
  private tiles: TilesRenderer | null = null;
  private ktx2Loader: KTX2Loader | null = null;
  private progressCallback: ((progress: MapLoadProgress) => void) | null = null;
  private modelsLoaded = 0;
  private failedRequests = 0;
  private loadSettled = false;
  private readonly loadedModels = new Set<Object3D>();
  private readonly cameraFrustum = new Frustum();
  private readonly projectionMatrix = new Matrix4();
  private readonly modelBounds = new Box3();
  private cameraVisibleModels = 0;
  private lastVisibilityCheck = 0;
  private materialMetrics: CsdiMaterialMetrics = { meshes: 0, materials: 0, texturedMaterials: 0 };
  private readonly renderedMaterials = new WeakSet<Material>();

  public constructor(private readonly layerName: CsdiLayerName = 'building') {}

  public async load(
    parent: Object3D,
    camera: PerspectiveCamera,
    renderer: WebGLRenderer,
    region: FlightRegion,
    onProgress: (progress: MapLoadProgress) => void,
  ): Promise<void> {
    this.dispose();
    this.progressCallback = onProgress;
    this.modelsLoaded = 0;
    this.failedRequests = 0;
    this.loadSettled = false;
    this.loadedModels.clear();
    this.cameraVisibleModels = 0;
    this.materialMetrics = { meshes: 0, materials: 0, texturedMaterials: 0 };
    onProgress({
      stage: `Connecting to CSDI ${this.layerName}`,
      detail: `Requesting official ${region.englishLabel} ${this.layerName} geometry.`,
      percent: 18,
      modelsLoaded: 0,
    });

    const { TilesRenderer } = await import('3d-tiles-renderer/three');
    const tilesetUrl = new URL(
      `/csdi-region/${this.layerName}/${region.id}/tileset.json`,
      window.location.href,
    ).toString();
    const tiles = new TilesRenderer(tilesetUrl);
    const ktx2Loader = new KTX2Loader(tiles.manager)
      .setTranscoderPath('/basis/')
      .setWorkerLimit(2)
      .detectSupport(renderer);
    this.tiles = tiles;
    this.ktx2Loader = ktx2Loader;
    tiles.optimizeRaycast = true;
    tiles.errorTarget = 16;
    tiles.loadAncestors = true;
    tiles.displayActiveTiles = true;
    tiles.setCamera(camera);
    tiles.setResolutionFromRenderer(camera, renderer);
    tiles.registerPlugin(new GLTFExtensionsPlugin({
      ktxLoader: ktx2Loader,
      autoDispose: false,
    }));
    tiles.registerPlugin(new ReorientationPlugin({
      lat: MathUtils.degToRad(region.latitude),
      lon: MathUtils.degToRad(region.longitude),
      recenter: true,
      azimuth: Math.PI,
    }));
    parent.add(tiles.group);
    tiles.group.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        if (this.loadSettled) return;
        this.loadSettled = true;
        reject(new Error(`CSDI connected, but no playable ${this.layerName} model arrived within 60 seconds.`));
      }, 60_000);

      tiles.addEventListener('load-root-tileset', () => {
        onProgress({
          stage: `${this.layerName} tileset located`,
          detail: `The official WGS84 ${region.englishLabel} ${this.layerName} tileset is ready.`,
          percent: 42,
          modelsLoaded: this.modelsLoaded,
        });
      });

      tiles.addEventListener('load-model', event => {
        if (this.loadedModels.has(event.scene)) return;
        let containsMesh = false;
        event.scene.traverse(object => {
          if (!(object instanceof Mesh)) return;
          containsMesh = true;
          object.castShadow = true;
          object.receiveShadow = true;
          this.materialMetrics.meshes += 1;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          const renderedMaterials = materials.map((material, materialIndex) => {
            this.materialMetrics.materials += 1;
            if ('map' in material && material.map) {
              this.materialMetrics.texturedMaterials += 1;
              material.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
              material.map.needsUpdate = true;
            }
            if (this.layerName !== 'building' || this.renderedMaterials.has(material)) return material;
            this.renderedMaterials.add(material);
            return createRenderedBuildingMaterial(
              material,
              `${event.url}/${object.name}/${materialIndex}`,
            );
          });
          object.material = Array.isArray(object.material) ? renderedMaterials : renderedMaterials[0];
        });
        if (!containsMesh) return;
        this.loadedModels.add(event.scene);
        this.modelsLoaded += 1;
        const percent = Math.min(92, 52 + this.modelsLoaded * 8);
        onProgress({
          stage: `Streaming ${this.layerName}`,
          detail: `${this.modelsLoaded} official ${this.layerName} tile${this.modelsLoaded === 1 ? '' : 's'} ready.`,
          percent,
          modelsLoaded: this.modelsLoaded,
        });
        if (this.modelsLoaded >= 1 && !this.loadSettled) {
          this.loadSettled = true;
          window.clearTimeout(timeout);
          window.setTimeout(resolve, 650);
        }
      });

      tiles.addEventListener('dispose-model', event => {
        if (!this.loadedModels.delete(event.scene)) return;
        this.modelsLoaded = Math.max(0, this.modelsLoaded - 1);
      });

      tiles.addEventListener('load-error', event => {
        if (this.loadSettled) return;
        this.failedRequests += 1;
        onProgress({
          stage: 'Recovering map detail',
          detail: `${this.failedRequests} unavailable city tile${this.failedRequests === 1 ? '' : 's'} skipped; trying other levels of detail.`,
          percent: Math.max(38, 50 + this.modelsLoaded * 8),
          modelsLoaded: this.modelsLoaded,
        });
        if (event.tile === null) {
          this.loadSettled = true;
          window.clearTimeout(timeout);
          reject(new Error(`The CSDI service rejected or could not deliver the Hong Kong ${this.layerName} tiles.`));
        }
      });
    });

    onProgress({
      stage: `${this.layerName} layer ready`,
      detail: `Official Hong Kong ${this.layerName} geometry is active for rendering and collision.`,
      percent: 100,
      modelsLoaded: this.modelsLoaded,
    });
  }

  public update(camera: PerspectiveCamera, renderer: WebGLRenderer): void {
    if (!this.tiles) return;
    camera.updateMatrixWorld(true);
    this.tiles.group.updateMatrixWorld(true);
    this.tiles.setResolutionFromRenderer(camera, renderer);
    this.tiles.update();
    this.updateVisibleModelCount(camera);
    if (this.progressCallback && !this.loadSettled) {
      const networkPercent = Math.round(this.tiles.loadProgress * 35);
      this.progressCallback({
        stage: this.tiles.rootTileset ? 'Selecting city detail' : 'Connecting to CSDI',
        detail: this.tiles.rootTileset ? 'Matching tile detail to the current camera.' : 'Waiting for the official tileset index.',
        percent: Math.max(20, 35 + networkPercent),
        modelsLoaded: this.modelsLoaded,
      });
    }
  }

  public get collisionRoot(): Object3D | null {
    return this.tiles?.group ?? null;
  }

  public get modelCount(): number {
    return this.modelsLoaded;
  }

  public get visibleTileCount(): number {
    return Math.max(this.tiles?.visibleTiles.size ?? 0, this.cameraVisibleModels);
  }

  public get materials(): Readonly<CsdiMaterialMetrics> {
    return this.materialMetrics;
  }

  public dispose(): void {
    this.tiles?.dispose();
    this.ktx2Loader?.dispose();
    this.tiles = null;
    this.ktx2Loader = null;
    this.progressCallback = null;
    this.modelsLoaded = 0;
    this.failedRequests = 0;
    this.loadSettled = false;
    this.loadedModels.clear();
    this.cameraVisibleModels = 0;
    this.materialMetrics = { meshes: 0, materials: 0, texturedMaterials: 0 };
  }

  private updateVisibleModelCount(camera: PerspectiveCamera): void {
    const now = performance.now();
    if (now - this.lastVisibilityCheck < 200) return;
    this.lastVisibilityCheck = now;
    this.projectionMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.cameraFrustum.setFromProjectionMatrix(this.projectionMatrix);
    let visible = 0;
    for (const model of this.loadedModels) {
      if (!model.parent || !model.visible) continue;
      model.updateWorldMatrix(true, true);
      this.modelBounds.setFromObject(model, true);
      if (!this.modelBounds.isEmpty() && this.cameraFrustum.intersectsBox(this.modelBounds)) visible += 1;
    }
    this.cameraVisibleModels = visible;
  }

}
