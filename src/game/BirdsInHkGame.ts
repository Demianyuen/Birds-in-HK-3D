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
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { AerialImageryGround } from './AerialImageryGround';
import { BirdController, type FlightControl, type FlightTelemetry } from './BirdController';
import { CsdiTiles, type MapLoadProgress } from './CsdiTiles';
import { StylizedHongKong } from './StylizedHongKong';
import { evaluateWorldReadiness } from './worldReadiness';

type GameMode = 'attract' | 'loading' | 'playing';
export type WorldSource = 'stylized' | 'csdi';
export interface GameTelemetry extends FlightTelemetry {
  fps: number;
  renderVerified: boolean;
}

export class BirdsInHkGame {
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly renderer: WebGLRenderer;
  private readonly clock = new Clock();
  private readonly bird = new BirdController();
  private readonly city = new CsdiTiles('building');
  private readonly infrastructure = new CsdiTiles('infrastructure');
  private readonly officialWorldRoot = new Group();
  private readonly stylizedCity = new StylizedHongKong();
  private readonly aerialGround = new AerialImageryGround();
  private readonly sun = new DirectionalLight('#fff1d4', 2.45);
  private readonly sky = new Sky();
  private readonly telemetryCallback: (telemetry: GameTelemetry) => void;
  private mode: GameMode = 'attract';
  private animationFrame = 0;
  private elapsed = 0;
  private activeWorld: WorldSource = 'stylized';
  private smoothedFrameMilliseconds = 16.7;
  private renderVerified = false;

  public constructor(canvas: HTMLCanvasElement, onTelemetry: (telemetry: GameTelemetry) => void) {
    this.telemetryCallback = onTelemetry;
    this.scene.background = new Color('#a7c9d7');
    this.scene.fog = new Fog('#afc4c8', 1_150, 8_500);
    this.camera = new PerspectiveCamera(61, window.innerWidth / window.innerHeight, 0.1, 70_000);
    this.camera.position.set(0, 145, 430);
    this.camera.lookAt(0, 100, 0);

    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;

    this.scene.add(new HemisphereLight('#d6edf4', '#50654e', 1.35));
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
    this.configureSky();
    this.scene.add(this.bird.object);
    void this.bird.loadVisual();
    this.scene.add(this.aerialGround.group);
    this.scene.add(this.stylizedCity.root);
    this.officialWorldRoot.name = 'Official CSDI 3D world';
    this.scene.add(this.officialWorldRoot);

    const harbour = new Mesh(
      new PlaneGeometry(14_000, 14_000),
      new MeshStandardMaterial({ color: '#2d6877', roughness: 0.3, metalness: 0.12 }),
    );
    harbour.rotation.x = -Math.PI / 2;
    harbour.position.y = -2.5;
    harbour.receiveShadow = true;
    this.scene.add(harbour);

    window.addEventListener('resize', this.handleResize);
    this.animate();
  }

  public async loadWorld(source: WorldSource, onProgress: (progress: MapLoadProgress) => void): Promise<void> {
    this.mode = 'loading';
    this.activeWorld = source;
    this.bird.setEnabled(false);
    this.camera.position.set(0, 185, 500);
    this.camera.lookAt(0, 72, 0);
    const imageryPromise = this.aerialGround.load(this.renderer, progress => {
      onProgress({
        stage: 'Streaming Lands Department imagery',
        detail: `${progress.successful} of ${progress.total} official aerial tiles ready.`,
        percent: 12 + progress.completed / progress.total * 48,
        modelsLoaded: progress.successful,
      });
    });
    const birdVisualPromise = this.bird.loadVisual().then(loaded => {
      onProgress({
        stage: loaded ? 'Blender pigeon ready' : 'Using reserve pigeon model',
        detail: loaded
          ? 'Animated GLB plumage, wings, and flight silhouette are active.'
          : 'The GLB could not be loaded; the built-in bird remains available.',
        percent: 64,
        modelsLoaded: loaded ? 1 : 0,
      });
    });

    if (source === 'stylized') {
      this.city.dispose();
      this.infrastructure.dispose();
      this.officialWorldRoot.clear();
      this.stylizedCity.setVisible(true);
      await Promise.all([imageryPromise, birdVisualPromise]);
      this.stylizedCity.root.position.y = this.aerialGround.originElevation;
      onProgress({
        stage: 'Preparing Tai Po simulation',
        detail: 'Combining aerial imagery, skyline, trees, and Wang Fuk Court collision meshes.',
        percent: 72,
        modelsLoaded: this.stylizedCity.collisionMeshCount,
      });
      await new Promise(resolve => window.setTimeout(resolve, 350));
      if (this.renderer.getContext().isContextLost() || this.stylizedCity.collisionMeshCount === 0) {
        throw new Error('The local Hong Kong flight range failed its runtime readiness gate.');
      }
      onProgress({
        stage: 'Tai Po ready',
        detail: 'Wang Fuk Court and the surrounding flight corridor are active for collision.',
        percent: 100,
        modelsLoaded: this.stylizedCity.collisionMeshCount,
      });
      return;
    }

    this.stylizedCity.setVisible(false);
    const infrastructurePromise = this.infrastructure.load(
      this.officialWorldRoot,
      this.camera,
      this.renderer,
      () => undefined,
    ).catch(() => undefined);
    void infrastructurePromise;
    await Promise.all([
      imageryPromise,
      birdVisualPromise,
      this.city.load(this.officialWorldRoot, this.camera, this.renderer, onProgress),
    ]);
    onProgress({
      stage: 'Verifying the visible city',
      detail: 'Checking WebGL, parsed building meshes, and camera-visible CSDI tiles.',
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
    this.stylizedCity.dispose();
    this.aerialGround.dispose();
    this.renderer.dispose();
  }

  private readonly handleResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  private configureSky(): void {
    this.sky.scale.setScalar(45_000);
    const uniforms = this.sky.material.uniforms;
    uniforms.turbidity.value = 7.2;
    uniforms.rayleigh.value = 1.75;
    uniforms.mieCoefficient.value = 0.008;
    uniforms.mieDirectionalG.value = 0.82;
    const sunDirection = new Vector3().setFromSphericalCoords(
      1,
      MathUtils.degToRad(58),
      MathUtils.degToRad(218),
    );
    uniforms.sunPosition.value.copy(sunDirection);
    this.scene.add(this.sky);
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
    if (this.activeWorld === 'csdi') {
      this.city.update(this.camera, this.renderer);
      this.infrastructure.update(this.camera, this.renderer);
    }

    if (this.mode === 'playing') {
      const collisionRoot = this.activeWorld === 'csdi'
        ? [this.aerialGround.group, this.officialWorldRoot]
        : [this.aerialGround.group, this.stylizedCity.collisionRoot];
      this.bird.update(deltaSeconds, collisionRoot);
      this.bird.updateCamera(this.camera, deltaSeconds);
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

    this.sun.position.set(this.camera.position.x - 450, 850, this.camera.position.z + 420);
    this.renderer.render(this.scene, this.camera);
    if (this.mode === 'playing') {
      if (!this.renderVerified) this.renderVerified = this.hasNonBlankFramebuffer();
      this.telemetryCallback({
        ...this.bird.getTelemetry(),
        fps: 1_000 / Math.max(1, this.smoothedFrameMilliseconds),
        renderVerified: this.renderVerified,
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
