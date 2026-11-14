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
import { createGradientSky, GOLDEN_SKY as DAY_SKY, type SkyPalette } from './GradientSky';
import { lightingFor, mixLighting, type Lighting, type TimeOfDay } from './timeOfDay';
import {
  AerialImageryGround,
  type OfficialGroundMetrics,
} from './AerialImageryGround';
import { BirdController, type FlightControl, type FlightTelemetry } from './BirdController';
import { CsdiTiles, type MapLoadProgress } from './CsdiTiles';
import { getFlightRegion, type FlightRegion, type FlightRegionId } from './regions';
import type { Object3D } from 'three';
import { browserDiscoveryStore, memorialPlaces, PlaceTracker, type PlaceArrival } from './PlaceNames';
import { CinematicPost } from './CinematicPost';
import { PhotoMeshTiles, type PhotoMeshMetrics } from './PhotoMeshTiles';
import { RoadNetwork, type RoadNetworkMetrics } from './RoadNetwork';
import { StreetLife } from './StreetLife';
import { getBirdProfile, type BirdProfileId, type PlumageId } from './birdProfiles';
import { evaluateWorldReadiness } from './worldReadiness';
import { stylizedGroundUniforms } from './StylizedGround';
import { DynamicResolution } from './DynamicResolution';
import { deviceTier } from './deviceTier';
import { QualityLadder } from './QualityLadder';
import { AmbientMusic } from './AmbientMusic';
import { StylizedClouds } from './StylizedClouds';
import { StylizedTrees } from './StylizedTrees';
import { setBuildingGroundHeight, setMemorialSites, type BuildingPresentation } from './BuildingMaterial';
import { wangFukLocalMarkers } from './wangFukLocations';
import { CourtPlacer, type CourtMetrics } from '../wangFuk/CourtPlacer';
import { Grove } from '../wangFuk/grove';
import { WangFukCourt } from '../wangFuk/WangFukCourt';
import { inAnyWater, type StreetData } from './streetData';
import { RemoteBirds } from '../multiplayer/RemoteBirds';
import { createCarriedFlower, disposeCarriedFlower, MemorialFlowers } from '../openWorld/MemorialFlowers';
import { MEMORIAL_APPROACH, MEMORIAL_PLAZA, type FlowerKind } from '../openWorld/contentRules';
import { MemorialPlaza } from '../wangFuk/MemorialPlaza';
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

/** Stylised CSDI buildings (two looks) or the LandsD aerial photo mesh. */
export type WorldPresentation = BuildingPresentation | 'photo';

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
  /** Flowers laid at Wang Fuk Court by visitors. */
  public readonly flowers = new MemorialFlowers();
  /** LandsD aerial photo mesh, loaded the first time the visitor picks that view. */
  private readonly photoMesh = new PhotoMeshTiles();
  /** Cars, buses, people and boats moving through Tai Po. */
  private readonly streetLife = new StreetLife(deviceTier().streetDensity);
  private worldPresentation: WorldPresentation = 'preservation';
  private readonly post: CinematicPost;
  private region: FlightRegion | null = null;
  private carried: ReturnType<typeof createCarriedFlower> | null = null;
  private readonly sun = new DirectionalLight('#ffd9a6', 3.0);
  private sky: Mesh | null = null;
  private readonly hemisphere = new HemisphereLight('#cfe6f2', '#5d6b4a', 0.85);
  /** Time of day, and the change in progress (blend 0 → 1 over a few seconds). */
  private timeOfDay: TimeOfDay = 'day';
  private timeFrom: TimeOfDay = 'day';
  private timeBlend = 1;
  private readonly telemetryCallback: (telemetry: GameTelemetry) => void;
  private readonly places = new PlaceTracker(browserDiscoveryStore());
  /** Called when the bird arrives somewhere with a name (banner like an open-world area title). */
  public onPlaceArrival: ((arrival: PlaceArrival) => void) | null = null;
  private mode: GameMode = 'attract';
  private animationFrame = 0;
  private elapsed = 0;
  private smoothedFrameMilliseconds = 16.7;
  private readonly quality = new QualityLadder();
  /** Quiet background music (A = 432 Hz), started on the visitor's first tap. */
  public readonly music = new AmbientMusic();
  private renderVerified = false;
  private paused = false;
  private readonly sunDirection = new Vector3();
  /** Hand-built Wang Fuk Court towers and the trees around them, placed once measured in the photo mesh. */
  private readonly court = new WangFukCourt(this.sunDirection);
  private readonly grove = new Grove(420);
  private plaza = new MemorialPlaza();
  private courtPlacer: CourtPlacer | null = null;
  private readonly resolution = new DynamicResolution({
    maximum: deviceTier().maxPixelRatio,
    minimum: deviceTier().phone ? 0.6 : 0.65,
  });
  private frameIndex = 0;

  public constructor(canvas: HTMLCanvasElement, onTelemetry: (telemetry: GameTelemetry) => void) {
    this.telemetryCallback = onTelemetry;
    this.scene.background = new Color('#a7c9d7');
    this.scene.fog = new Fog(DAY_SKY.horizon, 1_400, 8_500);
    this.camera = new PerspectiveCamera(61, window.innerWidth / window.innerHeight, 0.1, 70_000);
    this.camera.position.set(0, 145, 430);
    this.camera.lookAt(0, 100, 0);

    this.renderer = new WebGLRenderer({ canvas, antialias: deviceTier().antialias, powerPreference: 'high-performance' });
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

    this.scene.add(this.hemisphere);
    this.sun.position.set(-450, 850, 420);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(deviceTier().shadowMapSize, deviceTier().shadowMapSize);
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
    this.post = new CinematicPost(this.renderer, this.scene, this.camera);
    this.post.setPixelRatio(this.resolution.current);
    if (!deviceTier().bloom) this.post.setBloom(false);
    this.scene.add(this.bird.object);
    this.scene.add(this.remoteBirds.group);
    this.scene.add(this.aerialGround.group);
    this.scene.add(this.roads.group);
    this.scene.add(this.trees.group);
    this.scene.add(this.clouds.group);
    this.scene.add(this.flowers.group);
    this.clouds.build();
    this.officialWorldRoot.name = 'Official CSDI 3D world';
    this.scene.add(this.officialWorldRoot);
    this.scene.add(this.photoMesh.group);
    this.scene.add(this.court.group);
    this.scene.add(this.grove.mesh);
    this.scene.add(this.plaza.group);
    this.scene.add(this.streetLife.group);

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
    this.region = region;
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
        stage: loaded ? `${birdProfile.loadingLabel} ready` : `Using reserve ${birdProfile.loadingLabel} model`,
        detail: loaded
          ? 'The articulated bird is ready.'
          : 'The selected bird could not be prepared; the built-in bird remains available.',
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
    this.streetLife.setStreets(this.roads.streetData);
    const blocks = region.id === 'tai-po'
      ? wangFukLocalMarkers(region.latitude, region.longitude)
        .map(marker => ({ name: marker.name, block: marker.block, position: { x: marker.position.x, z: marker.position.z } }))
      : [];
    // The grounds of the estate, laid out around the eight towers.
    this.scene.remove(this.plaza.group);
    this.plaza.dispose();
    this.plaza = new MemorialPlaza(blocks.map(block => block.position));
    this.scene.add(this.plaza.group);
    this.streetLife.setLevelGround((x, z) => (this.plaza.group.visible ? this.plaza.surfaceAt(x, z) : null));
    this.courtPlacer = blocks.length > 0
      ? new CourtPlacer(
        this.court,
        this.grove,
        blocks.map(block => ({ block: block.block, x: block.position.x, z: block.position.z })),
        {
          roots: () => [this.photoMesh.group],
          terrain: (x, z) => this.aerialGround.getElevationAtWorld(x, z),
          canGrowTree: (x, z) => !inAnyWater(this.roads.streetData.water, x, z) && !this.plaza.keepClear(x, z),
          surface: (x, z) => this.plaza.surfaceAt(x, z),
        },
        () => {
          this.plaza.setTowers(this.court.blocks.map(block => ({ x: block.pose.x, z: block.pose.z, yaw: block.pose.yaw, baseY: block.baseY })));
          this.refreshCutouts();
          this.applyWorldPresentation();
        },
      )
      : null;
    const courtCentre = blocks.length > 0
      ? {
        x: blocks.reduce((sum, block) => sum + block.position.x, 0) / blocks.length,
        z: blocks.reduce((sum, block) => sum + block.position.z, 0) / blocks.length,
      }
      : null;
    this.places.setPlaces([
      ...(courtCentre ? memorialPlaces(courtCentre, blocks) : []),
      ...this.roads.placeNames,
    ]);
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
    this.bird.beginAt(MEMORIAL_APPROACH, MEMORIAL_PLAZA);
    this.bird.setEnabled(true);
  }

  public setBirdProfile(profileId: BirdProfileId): void {
    this.bird.setBirdProfile(profileId);
  }

  public setBirdPlumage(plumage: PlumageId): void {
    this.bird.setPlumage(plumage);
  }

  public get birdProfileId(): BirdProfileId {
    return this.bird.profileId;
  }

  public get birdPlumage(): PlumageId {
    return this.bird.rig.plumageId;
  }

  /** Show (or stop showing) a flower in the bird's beak. */
  public holdFlower(kind: FlowerKind | null): void {
    if (this.carried) disposeCarriedFlower(this.carried);
    this.carried = kind ? createCarriedFlower(kind) : null;
    this.bird.rig.holdInBeak(this.carried);
  }

  /** Roads, paths and water read from the map (for the radar). */
  public get streetData(): Readonly<StreetData> {
    return this.roads.streetData;
  }

  /** Which way the bird faces, as a yaw angle (0 = north, positive turns west). */
  public get birdYaw(): number {
    return this.yawEuler.setFromQuaternion(this.bird.object.quaternion, 'YXZ').y;
  }
  private readonly yawEuler = new Euler();

  /** Where the bird's feet are while on the ground, or null in the air. */
  public get birdGroundPoint(): Vector3 | null {
    return this.bird.groundPoint;
  }

  public get birdPosition(): Vector3 {
    return this.bird.object.position;
  }

  /** The view camera, for screen-space labels. */
  public get viewCamera(): PerspectiveCamera {
    return this.camera;
  }

  public get remoteBirdLabels(): ReturnType<RemoteBirds['labels']> {
    return this.remoteBirds.labels();
  }

  /** `smoothed` when the poses were already interpolated (shared sky); false to glide towards each one here. */
  public syncPlayers(players: readonly WorldPlayer[], smoothed = false): void {
    this.remoteBirds.sync(players, smoothed);
  }

  public setBuildingPresentation(mode: WorldPresentation): void {
    this.worldPresentation = mode;
    const photo = mode === 'photo';
    if (!photo) this.city.setPresentation(mode);
    if (photo && this.region) void this.photoMesh.load(this.camera, this.renderer, this.region);
    this.applyWorldPresentation();
  }

  /** The photo mesh already holds ground, trees and buildings: hide the stylised ones while it shows. */
  private applyWorldPresentation(): void {
    const photo = this.worldPresentation === 'photo' && this.photoMesh.ready;
    this.photoMesh.setVisible(this.worldPresentation === 'photo');
    this.officialWorldRoot.visible = !photo;
    this.aerialGround.group.visible = !photo;
    this.trees.group.visible = !photo;
    this.court.setVisible(photo);
    this.grove.setVisible(photo);
    this.plaza.setVisible(photo);
  }

  private applyQuality(level: number): void {
    this.post.setBloom(level < 1 && deviceTier().bloom);
    this.post.setEnabled(level < 2);
    const light = level < 3;
    if (this.sun.castShadow !== light) {
      this.sun.castShadow = light;
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.streetLife.setDensity(deviceTier().streetDensity * (light ? 1 : 0.35));
  }

  /** Hide the photo mesh where the hand-built towers and the memorial square stand. */
  private refreshCutouts(): void {
    const plaza = this.plaza.cutout();
    this.photoMesh.setCutouts([...(plaza ? [plaza] : []), ...this.court.cutouts()]);
    this.photoMesh.setCutArea(this.plaza.groundsCut());
  }

  /** How many towers have been measured and built, and the measurements (for checking placement). */
  public get courtMetrics(): CourtMetrics | null {
    return this.courtPlacer ? this.courtPlacer.metrics : null;
  }

  public get photoMeshMetrics(): PhotoMeshMetrics {
    return this.photoMesh.metrics;
  }

  /** What the bird can hit: the photo mesh when shown, else the stylised ground and CSDI models. */
  private collisionRoots(): Object3D[] {
    return this.worldPresentation === 'photo' && this.photoMesh.ready
      ? [this.photoMesh.group, this.court.group, ...(this.plaza.group.visible ? [this.plaza.group] : [])]
      : [this.aerialGround.group, this.officialWorldRoot];
  }

  public getNetworkPose(): { position: Position; quaternion: Rotation; perched: boolean } {
    return {
      position: this.bird.object.position.toArray() as Position,
      quaternion: this.bird.object.quaternion.toArray() as Rotation,
      perched: this.bird.getTelemetry().state !== 'FLYING',
    };
  }

  public resetFlight(): void {
    this.bird.beginAt(MEMORIAL_APPROACH, MEMORIAL_PLAZA);
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
    this.bird.setSteerAxes(0, 0);
  }

  public steer(deltaX: number, deltaY: number): void {
    this.bird.steer(deltaX, deltaY);
  }

  public setPointerLocked(locked: boolean): void {
    this.bird.setPointerLocked(locked);
  }

  public setSteerAxes(x: number, y: number): void {
    this.bird.setSteerAxes(x, y);
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
    this.flowers.dispose();
    this.court.dispose();
    this.grove.dispose();
    this.plaza.dispose();
    this.holdFlower(null);
    this.remoteBirds.dispose();
    this.renderer.dispose();
  }

  private readonly handleResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.post.setSize(window.innerWidth, window.innerHeight);
  };

  private configureSky(): void {
    this.sunDirection.setFromSphericalCoords(
      1,
      MathUtils.degToRad(63),
      MathUtils.degToRad(218),
    );
    this.sky = createGradientSky(this.sunDirection);
    this.scene.add(this.sky);
    this.scene.background = new Color(DAY_SKY.horizon);
  }

  /** Change the time of day: a gentle three-second change, or at once (on load). */
  public setTimeOfDay(time: TimeOfDay, immediate = false): void {
    if (time === this.timeOfDay && this.timeBlend >= 1 && !immediate) return;
    this.timeFrom = immediate ? time : this.timeOfDay;
    this.timeOfDay = time;
    this.timeBlend = immediate ? 1 : 0;
    if (immediate) {
      this.applyLighting(lightingFor(time));
      this.configureEnvironment();
    }
  }

  public get currentTimeOfDay(): TimeOfDay {
    return this.timeOfDay;
  }

  private applyLighting(light: Lighting): void {
    this.sunDirection.setFromSphericalCoords(1, MathUtils.degToRad(90 - light.sunElevation), MathUtils.degToRad(light.sunAzimuth));
    const sky = this.sky?.material as ShaderMaterial | undefined;
    if (sky) {
      sky.uniforms.uZenith.value.copy(light.zenith);
      sky.uniforms.uHorizon.value.copy(light.horizon);
      sky.uniforms.uGround.value.copy(light.ground);
      sky.uniforms.uSunGlow.value.copy(light.sunGlow);
      sky.uniforms.uSunDirection.value.copy(this.sunDirection);
    }
    if (this.scene.background instanceof Color) this.scene.background.copy(light.horizon);
    if (this.scene.fog instanceof Fog) {
      this.scene.fog.color.copy(light.fogColour);
      this.scene.fog.near = light.fogNear;
      this.scene.fog.far = light.fogFar;
    }
    this.renderer.toneMappingExposure = light.exposure;
    this.sun.color.copy(light.sunColour);
    this.sun.intensity = light.sunIntensity;
    this.hemisphere.color.copy(light.hemiSky);
    this.hemisphere.groundColor.copy(light.hemiGround);
    this.hemisphere.intensity = light.hemiIntensity;
    this.post.setGrade(light);
    this.photoMesh.setTint(light.surfaceTint);
    this.court.setTint(light.surfaceTint);
    this.grove.setTint(light.surfaceTint);
    this.clouds.setGlow(light.cloudGlow);
    this.flowers.setGlowStrength(light.flowerGlow);
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** The sky as it is now, for reflections. */
  private currentPalette(): SkyPalette {
    const sky = this.sky?.material as ShaderMaterial | undefined;
    if (!sky) return DAY_SKY;
    const hex = (name: string) => `#${(sky.uniforms[name].value as Color).getHexString()}`;
    return { zenith: hex('uZenith'), horizon: hex('uHorizon'), ground: hex('uGround'), sunGlow: hex('uSunGlow') };
  }

  /** Image-based lighting from the same sky, so glass and water reflect it. */
  private configureEnvironment(): void {
    const pmrem = new PMREMGenerator(this.renderer);
    const skyScene = new Scene();
    const skyCopy = createGradientSky(this.sunDirection, this.currentPalette(), 1_000);
    skyScene.add(skyCopy);
    this.scene.environment?.dispose();
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
    this.post.render();
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

  /** Once the photo mesh is detailed near the court, find the ground level for the memorial square. */
  private measurePlaza(): void {
    if (this.plaza.level !== null || this.region?.id !== 'tai-po') return;
    if (this.worldPresentation !== 'photo' || !this.photoMesh.ready) return;
    const bird = this.bird.object.position;
    if (Math.hypot(bird.x - MEMORIAL_PLAZA.x, bird.z - MEMORIAL_PLAZA.z) > 400) return;
    if (this.plaza.measure([this.photoMesh.group], this.aerialGround.getElevationAtWorld(MEMORIAL_PLAZA.x, MEMORIAL_PLAZA.z))) {
      this.refreshCutouts();
      this.applyWorldPresentation();
    }
  }

  private readonly animate = (): void => {
    this.animationFrame = requestAnimationFrame(this.animate);
    // Up to 0.15 s of real time per frame is played out, so a slow computer flies at
    // the right speed (in steps of at most 0.05 s for the bird); longer stalls are skipped.
    const realSeconds = Math.min(this.clock.getDelta(), 0.15);
    const deltaSeconds = Math.min(realSeconds, 0.05);
    this.smoothedFrameMilliseconds += (deltaSeconds * 1_000 - this.smoothedFrameMilliseconds) * 0.08;
    this.elapsed += deltaSeconds;
    this.city.update(this.camera, this.renderer);
    this.infrastructure.update(this.camera, this.renderer);
    this.photoMesh.update(this.camera, this.renderer);
    // Keep the stylised world showing until the first photo tiles arrive.
    if (this.worldPresentation === 'photo' && this.officialWorldRoot.visible && this.photoMesh.ready) this.applyWorldPresentation();

    if (this.mode === 'playing' && this.paused) {
      this.bird.updateCamera(this.camera, 1);
    } else if (this.mode === 'playing') {
      const roots = this.collisionRoots();
      for (let left = realSeconds; left > 1e-4; left -= 0.05) this.bird.update(Math.min(0.05, left), roots);
      this.bird.updateCamera(this.camera, deltaSeconds);
      this.remoteBirds.update(deltaSeconds);
      // Towers are measured against the whole photo mesh, including what the grounds cut away.
      this.photoMesh.whole(() => this.courtPlacer?.update(deltaSeconds, this.bird.object.position, this.worldPresentation === 'photo' && this.photoMesh.ready));
      this.measurePlaza();
      this.streetLife.setSurface((x, z) => this.aerialGround.getElevationAtWorld(x, z) + 0.2, this.collisionRoots());
      this.streetLife.update(deltaSeconds, this.bird.object.position);
      const position = this.bird.object.position;
      const arrival = this.places.update(deltaSeconds, position.x, position.z, position.y);
      if (arrival) this.onPlaceArrival?.(arrival);
      this.aerialGround.updateDetailNear(this.bird.object.position.x, this.bird.object.position.z, window.innerWidth < 720);
    } else {
      this.bird.rig.update(deltaSeconds, { mode: 'flight', flapDemand: 0.5 });
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
      if (ratio !== null) {
        this.renderer.setPixelRatio(ratio);
        this.post.setPixelRatio(ratio);
      }
      // Still slow: step the costly parts down (judged on real time, so very slow machines are noticed too).
      const level = this.quality.update(performance.now());
      if (level !== null) this.applyQuality(level);
    }
    stylizedGroundUniforms.uSgTime.value = this.elapsed;
    this.clouds.update(this.elapsed);
    if (this.mode === 'playing') this.flowers.settleOnSurface(this.collisionRoots(), this.bird.object.position);
    if (this.timeBlend < 1) {
      this.timeBlend = Math.min(1, this.timeBlend + deltaSeconds / 3);
      const eased = this.timeBlend * this.timeBlend * (3 - 2 * this.timeBlend);
      this.applyLighting(mixLighting(this.timeFrom, this.timeOfDay, eased));
      if (this.timeBlend >= 1) this.configureEnvironment();
    }
    this.flowers.update(deltaSeconds, this.camera.position);
    this.post.render();
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
