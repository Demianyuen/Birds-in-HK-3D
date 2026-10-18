import {
  ACESFilmicToneMapping,
  Clock,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  Quaternion,
  Euler,
} from 'three';
import { createGradientSky, DAY_SKY } from './GradientSky';
import {
  AerialImageryGround,
  type OfficialGroundMetrics,
} from './AerialImageryGround';
import { BirdController, type FlightControl, type FlightTelemetry } from './BirdController';
import { CsdiTiles, type MapLoadProgress } from './CsdiTiles';
import { getFlightRegion, type FlightRegionId } from './regions';
import { RoadNetwork, type RoadNetworkMetrics } from './RoadNetwork';
import { getBirdProfile, type BirdProfileId } from './birdProfiles';
import { evaluateWorldReadiness } from './worldReadiness';
import { stylizedGroundUniforms } from './StylizedGround';
import { DynamicResolution } from './DynamicResolution';
import { StylizedClouds } from './StylizedClouds';
import { StylizedTrees } from './StylizedTrees';
import { setBuildingGroundHeight, setMemorialSites, type BuildingPresentation } from './BuildingMaterial';
import { wangFukLocalMarkers } from './wangFukLocations';
import { RemoteBirds } from '../multiplayer/RemoteBirds';
import type { Position, Rotation, WorldPlayer } from '../multiplayer/protocol';

type GameMode = 'attract' | 'loading' | 'playing';
export interface GameTelemetry extends FlightTelemetry {
  fps: number;
  renderVerified: boolean;
  buildingMaterials: {
    meshes: number;
    materials: number;
    texturedMaterials: number;
  };
  roads: Readonly<RoadNetworkMetrics>;
  ground: Readonly<OfficialGroundMetrics>;
  detailPatchesLoaded: number;
}

export class BirdsInHkGame {
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly renderer: WebGLRenderer;
  private readonly clock = new Clock();
  private readonly bird = new BirdController();
  private readonly remoteBirds = new RemoteBirds();
  private readonly city = new CsdiTiles('building');
  private readonly infrastructure = new CsdiTiles('infrastructure');
  private readonly officialWorldRoot = new Group();
  private readonly aerialGround = new AerialImageryGround();
  private readonly roads = new RoadNetwork();
  private readonly trees = new StylizedTrees();
  private readonly clouds = new StylizedClouds();
  private readonly sun = new DirectionalLight('#ffe7c2', 3.1);
  private sky: Mesh | null = null;
  private readonly telemetryCallback: (telemetry: GameTelemetry) => void;
  private mode: GameMode = 'attract';
  private animationFrame = 0;
  private elapsed = 0;
  private smoothedFrameMilliseconds = 16.7;
  private renderVerified = false;
  private paused = false;
  private readonly sunDirection = new Vector3();
  private readonly resolution = new DynamicResolution({
    maximum: Math.min(window.devicePixelRatio || 1, 1.5),
    minimum: 0.65,
  });
  private frameIndex = 0;

  public constructor(canvas: HTMLCanvasElement, onTelemetry: (telemetry: GameTelemetry) => void) {
    this.telemetryCallback = onTelemetry;
    this.scene.background = new Color('#a7c9d7');
    this.scene.fog = new Fog(DAY_SKY.horizon, 1_600, 9_500);
    this.camera = new PerspectiveCamera(61, window.innerWidth / window.innerHeight, 0.1, 70_000);
    this.camera.position.set(0, 145, 430);
    this.camera.lookAt(0, 100, 0);

    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.resolution.current);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    // The sun follows the player; refreshing its shadow map every other frame
    // halves the shadow pass with no visible lag at flight speeds.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.localClippingEnabled = true;

    this.scene.add(new HemisphereLight('#cfe6f2', '#5d6b4a', 0.85));
    this.sun.position.set(-450, 850, 420);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2_048, 2_048);
    this.sun.shadow.camera.left = -700;
    this.sun.shadow.camera.right = 700;
    this.sun.shadow.camera.top = 700;
    this.sun.shadow.camera.bottom = -700;
    this.sun.shadow.camera.near = 20;
    this.sun.shadow.camera.far = 2_600;
    this.sun.shadow.bias = -0.00016;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.configureSky();
    this.configureEnvironment();
    this.scene.add(this.bird.object);
    this.scene.add(this.remoteBirds.group);
    this.scene.add(this.aerialGround.group);
    this.scene.add(this.roads.group);
    this.scene.add(this.trees.group);
    this.scene.add(this.clouds.group);
    this.clouds.build();
    this.officialWorldRoot.name = 'Official CSDI 3D world';
    this.scene.add(this.officialWorldRoot);

    const harbour = new Mesh(
      new PlaneGeometry(9_000, 9_000),
      new MeshStandardMaterial({ color: '#1d6a86', roughness: 0.1, metalness: 0 }),
    );
    harbour.rotation.x = -Math.PI / 2;
    harbour.position.y = -2.5;
    harbour.receiveShadow = true;
    this.scene.add(harbour);

    window.addEventListener('resize', this.handleResize);
    this.animate();
  }

  public async loadWorld(regionId: FlightRegionId, onProgress: (progress: MapLoadProgress) => void): Promise<void> {
    const region = getFlightRegion(regionId);
    this.mode = 'loading';
    this.bird.setEnabled(false);
    this.bird.setFlightRadius(region.flightRadiusMetres - 120);
    this.camera.position.set(0, 185, 500);
    this.camera.lookAt(0, 72, 0);
    const terrainPromise = this.aerialGround.load(region, progress => {
      const maskRatio = progress.maskTotal > 0 ? progress.maskCompleted / progress.maskTotal : 0;
      const basemapRatio = progress.basemapTotal > 0
        ? progress.basemapCompleted / progress.basemapTotal
        : 1;
      const meshRatio = progress.total > 0 ? progress.completed / progress.total : 0;
      const painting = progress.maskCompleted < progress.maskTotal;
      const fallback = progress.basemapCompleted < progress.basemapTotal;
      onProgress({
        stage: painting
          ? 'Painting Hong Kong land cover'
          : fallback ? 'Loading LandsD official streets' : 'Building Hong Kong terrain',
        detail: painting
          ? `${progress.maskSuccessful} of ${progress.maskTotal} land-cover tiles painted.`
          : fallback
            ? `${progress.basemapSuccessful} of ${progress.basemapTotal} official basemap tiles ready.`
            : `${progress.successful} of ${progress.total} textured elevation meshes ready.`,
        percent: 10 + maskRatio * 16 + basemapRatio * 6 + meshRatio * 6,
        modelsLoaded: progress.successful,
      });
    });
    const birdVisualPromise = this.bird.loadVisual().then(loaded => {
      const birdProfile = getBirdProfile(this.bird.profileId);
      onProgress({
        stage: loaded ? `${birdProfile.loadingLabel} GLB ready` : `Using reserve ${birdProfile.loadingLabel} model`,
        detail: loaded
          ? 'The selected GLB bird visual is active.'
          : 'The selected GLB could not be loaded; the built-in bird remains available.',
        percent: 40,
        modelsLoaded: loaded ? 1 : 0,
      });
    });

    const infrastructurePromise = this.infrastructure.load(
      this.officialWorldRoot,
      this.camera,
      this.renderer,
      region,
      progress => {
        onProgress({
          ...progress,
          percent: 42 + progress.percent * 0.22,
        });
      },
    ).catch(error => {
      // Bridges and flyovers are scenery; a slow infrastructure layer must not block flight.
      console.warn('CSDI infrastructure layer unavailable; continuing without it.', error);
    });
    setMemorialSites(region.id === 'tai-po'
      ? wangFukLocalMarkers(region.latitude, region.longitude).map(marker => ({
        x: marker.position.x, z: marker.position.z, radius: 28,
      }))
      : []);
    const scenery = terrainPromise.then(() => {
      setBuildingGroundHeight(this.aerialGround.heightField());
      this.trees.build(this.aerialGround, {
        radiusMetres: region.flightRadiusMetres + 300,
        maximumTrees: window.innerWidth < 720 ? 9_000 : 28_000,
      });
      this.aerialGround.releaseLandUseCache();
    });
    await Promise.all([
      scenery,
      birdVisualPromise,
      this.city.load(this.officialWorldRoot, this.camera, this.renderer, region, progress => {
        onProgress({
          ...progress,
          percent: 42 + progress.percent * 0.26,
        });
      }),
      infrastructurePromise,
    ]);
    await this.roads.load(
      region,
      progress => {
        const completionRatio = progress.total > 0 ? progress.completed / progress.total : 0;
        onProgress({
          stage: 'Building real streets',
          detail: `${progress.successful} of ${progress.total} OpenStreetMap road tiles ready.`,
          percent: 70 + completionRatio * 22,
          modelsLoaded: progress.successful,
        });
      },
    );
    onProgress({
      stage: 'navigation road data ready',
      detail: `${this.roads.metrics.features} road features are available without rendered ribbon meshes.`,
      percent: 94,
      modelsLoaded: this.roads.metrics.features,
    });
    onProgress({
      stage: 'Verifying the visible city',
      detail: `Checking camera-visible official buildings in ${region.englishLabel}.`,
      percent: 96,
      modelsLoaded: this.city.modelCount,
    });
    await this.waitForVisibleWorld();
  }

  public startFlight(): void {
    this.mode = 'playing';
    this.renderVerified = false;
    this.bird.reset();
    this.bird.setEnabled(true);
  }

  public setBirdProfile(profileId: BirdProfileId): void {
    this.bird.setBirdProfile(profileId);
  }

  public syncPlayers(players: readonly WorldPlayer[]): void {
    this.remoteBirds.sync(players);
  }

  public setBuildingPresentation(mode: BuildingPresentation): void {
    this.city.setPresentation(mode);
  }

  public getNetworkPose(): { position: Position; quaternion: Rotation; perched: boolean } {
    return {
      position: this.bird.object.position.toArray() as Position,
      quaternion: this.bird.object.quaternion.toArray() as Rotation,
      perched: this.bird.getTelemetry().state === 'PERCHED',
    };
  }

  public resetFlight(): void {
    this.bird.reset();
    this.bird.updateCamera(this.camera, 1);
  }

  public restoreSessionPose(player: WorldPlayer): void {
    this.bird.restoreSessionPose(player);
    this.bird.updateCamera(this.camera, 1);
  }

  public clearControls(): void {
    for (const control of ['yawLeft', 'yawRight', 'pitchUp', 'pitchDown', 'accelerate', 'decelerate'] as const) {
      this.bird.setControl(control, false);
    }
  }

  public steer(deltaX: number, deltaY: number): void {
    this.bird.steer(deltaX, deltaY);
  }

  public adjustSpeed(direction: number): void {
    this.bird.adjustSpeed(direction);
  }

  public flap(): void {
    this.bird.flap();
  }

  public setControl(control: FlightControl, pressed: boolean): void {
    this.bird.setControl(control, pressed);
  }

  public dispose(): void {
    cancelAnimationFrame(this.animationFrame);
    window.removeEventListener('resize', this.handleResize);
    this.city.dispose();
    this.infrastructure.dispose();
    this.aerialGround.dispose();
    this.roads.dispose();
    this.trees.dispose();
    this.clouds.dispose();
    this.remoteBirds.dispose();
    this.renderer.dispose();
  }

  private readonly handleResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  private configureSky(): void {
    this.sunDirection.setFromSphericalCoords(
      1,
      MathUtils.degToRad(56),
      MathUtils.degToRad(218),
    );
    this.sky = createGradientSky(this.sunDirection);
    this.scene.add(this.sky);
    this.scene.background = new Color(DAY_SKY.horizon);
  }

  /** Image-based lighting from the same sky, so glass and water reflect it. */
  private configureEnvironment(): void {
    const pmrem = new PMREMGenerator(this.renderer);
    const skyScene = new Scene();
    const skyCopy = createGradientSky(this.sunDirection, DAY_SKY, 1_000);
    skyScene.add(skyCopy);
    this.scene.environment = pmrem.fromScene(skyScene, 0, 0.1, 2_000).texture;
    this.scene.environmentIntensity = 0.6;
    skyCopy.geometry.dispose();
    (skyCopy.material as ShaderMaterial).dispose();
    pmrem.dispose();
  }

  /** Development aids for repeatable screenshots; not used by gameplay. */
  /** Current adaptive pixel ratio (QA/telemetry). */
  public get pixelRatio(): number {
    return this.renderer.getPixelRatio();
  }

  public debugSetPaused(paused: boolean): void {
    this.paused = paused;
  }

  public debugSetPose(x: number, y: number, z: number, yawDegrees: number, pitchDegrees: number): void {
    const quaternion = new Quaternion().setFromEuler(new Euler(
      MathUtils.degToRad(pitchDegrees), MathUtils.degToRad(yawDegrees), 0, 'YXZ',
    ));
    this.bird.restoreSessionPose({
      id: 'debug', name: 'debug', position: [x, y, z],
      quaternion: quaternion.toArray() as Rotation, perched: false,
    });
    this.bird.updateCamera(this.camera, 1);
  }

  public debugCapture(): Promise<Blob | null> {
    this.renderer.render(this.scene, this.camera);
    return new Promise(resolve => this.renderer.domElement.toBlob(resolve, 'image/png'));
  }

  private async waitForVisibleWorld(): Promise<void> {
    const deadline = performance.now() + 10_000;
    let lastBlockers: string[] = [];
    while (performance.now() < deadline) {
      const readiness = evaluateWorldReadiness({
        parsedModels: this.city.modelCount,
        visibleTiles: this.city.visibleTileCount,
        webglContextAvailable: !this.renderer.getContext().isContextLost(),
      });
      if (this.roads.metrics.features === 0) {
        lastBlockers = [...readiness.blockers, 'No real road features are ready.'];
        await new Promise(resolve => window.setTimeout(resolve, 100));
        continue;
      }
      if (readiness.ready) return;
      lastBlockers = readiness.blockers;
      await new Promise(resolve => window.setTimeout(resolve, 100));
    }
    throw new Error(`Hong Kong loaded but failed the runtime readiness gate: ${lastBlockers.join(' ')}`);
  }

  private readonly animate = (): void => {
    this.animationFrame = requestAnimationFrame(this.animate);
    const deltaSeconds = Math.min(this.clock.getDelta(), 0.05);
    this.smoothedFrameMilliseconds += (deltaSeconds * 1_000 - this.smoothedFrameMilliseconds) * 0.08;
    this.elapsed += deltaSeconds;
    this.city.update(this.camera, this.renderer);
    this.infrastructure.update(this.camera, this.renderer);

    if (this.mode === 'playing' && this.paused) {
      this.bird.updateCamera(this.camera, 1);
    } else if (this.mode === 'playing') {
      this.bird.update(deltaSeconds, [this.aerialGround.group, this.officialWorldRoot]);
      this.bird.updateCamera(this.camera, deltaSeconds);
      this.remoteBirds.update(deltaSeconds);
      this.aerialGround.updateDetailNear(this.bird.object.position.x, this.bird.object.position.z, window.innerWidth < 720);
    } else {
      this.bird.pigeon.animate(deltaSeconds, 18, false);
      this.bird.object.position.set(
        Math.sin(this.elapsed * 0.18) * 28,
        112 + Math.sin(this.elapsed * 0.7) * 3,
        70 + Math.cos(this.elapsed * 0.18) * 22,
      );
      this.bird.object.rotation.y = Math.sin(this.elapsed * 0.18) * 0.3;
      const desiredX = Math.sin(this.elapsed * 0.08) * 30;
      this.camera.position.x += (desiredX - this.camera.position.x) * (1 - Math.exp(-1.5 * deltaSeconds));
      this.camera.lookAt(0, 78, 0);
    }

    this.frameIndex += 1;
    if (this.frameIndex % 2 === 0 || this.mode !== 'playing') {
      const focus = this.mode === 'playing' ? this.bird.object.position : this.camera.position;
      // Snap the shadow camera to whole shadow texels so static shadows do not shimmer.
      const texel = (this.sun.shadow.camera.right - this.sun.shadow.camera.left) / this.sun.shadow.mapSize.x;
      this.sun.target.position.set(Math.round(focus.x / texel) * texel, 0, Math.round(focus.z / texel) * texel);
      this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDirection, 1_400);
      this.sun.target.updateMatrixWorld();
      this.renderer.shadowMap.needsUpdate = true;
    }
    if (this.mode === 'playing' && !this.paused) {
      const ratio = this.resolution.update(deltaSeconds * 1_000, performance.now());
      if (ratio !== null) this.renderer.setPixelRatio(ratio);
    }
    stylizedGroundUniforms.uSgTime.value = this.elapsed;
    this.clouds.update(this.elapsed);
    this.renderer.render(this.scene, this.camera);
    if (this.mode === 'playing') {
      if (!this.renderVerified) this.renderVerified = this.hasNonBlankFramebuffer();
      this.telemetryCallback({
        ...this.bird.getTelemetry(),
        fps: 1_000 / Math.max(1, this.smoothedFrameMilliseconds),
        renderVerified: this.renderVerified,
        buildingMaterials: this.city.materials,
        roads: this.roads.metrics,
        ground: this.aerialGround.metrics,
        detailPatchesLoaded: this.aerialGround.detailPatchesLoaded,
      });
    }
  };

  private hasNonBlankFramebuffer(): boolean {
    const gl = this.renderer.getContext();
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    if (width < 2 || height < 2 || gl.isContextLost()) return false;
    const pixel = new Uint8Array(4);
    const colors = new Set<string>();
    const points = [
      [0.5, 0.5],
      [0.25, 0.25],
      [0.75, 0.25],
      [0.25, 0.75],
      [0.75, 0.75],
    ];
    for (const [xRatio, yRatio] of points) {
      gl.readPixels(
        Math.min(width - 1, Math.floor(width * xRatio)),
        Math.min(height - 1, Math.floor(height * yRatio)),
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixel,
      );
      if (pixel[3] > 0 && pixel[0] + pixel[1] + pixel[2] > 0) {
        colors.add(`${pixel[0]},${pixel[1]},${pixel[2]}`);
      }
    }
    return colors.size >= 2;
  }
}
