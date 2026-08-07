import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CITY_STYLE_MODELS, type CityStyleModel } from './modelCatalog';

export type ModelLoadState =
  | { state: 'loaded'; sourceSize: number; scale: number }
  | { state: 'failed'; message: string };

export type ModelStatusHandler = (model: CityStyleModel, result: ModelLoadState) => void;

interface AnimatedModel {
  kind: 'cloud' | 'fire' | 'water';
  group: THREE.Group;
  home: THREE.Vector3;
  homeRotationY: number;
  light?: THREE.PointLight;
}

export class CityStyleWorld {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.5, 600);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly resizeObserver: ResizeObserver;
  private readonly dracoLoader = new DRACOLoader();
  private readonly gltfLoader = new GLTFLoader();
  private readonly clock = new THREE.Clock();
  private readonly animatedModels: AnimatedModel[] = [];

  constructor(
    private readonly container: HTMLElement,
    private readonly onModelStatus: ModelStatusHandler,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'city-style-canvas';
    this.renderer.domElement.setAttribute('aria-label', 'Three.js 免費建築模型風格比較');
    this.container.prepend(this.renderer.domElement);

    this.scene.background = new THREE.Color(0xb8ced0);
    this.scene.fog = new THREE.Fog(0xb8ced0, 195, 365);
    this.camera.position.set(132, 98, 154);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 76;
    this.controls.maxDistance = 275;
    this.controls.minPolarAngle = Math.PI * 0.14;
    this.controls.maxPolarAngle = Math.PI * 0.46;
    this.applyDefaultCameraView();

    this.dracoLoader.setDecoderPath('/draco/gltf/');
    this.gltfLoader.setDRACOLoader(this.dracoLoader);

    this.addLighting();
    this.addSite();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.renderer.setAnimationLoop(this.animate);
  }

  async loadModels(): Promise<ModelLoadState[]> {
    return Promise.all(CITY_STYLE_MODELS.map(model => this.loadModel(model)));
  }

  resetCamera(): void {
    this.applyDefaultCameraView();
    this.controls.update();
    this.controls.saveState();
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.dracoLoader.dispose();
    this.renderer.dispose();
  }

  private async loadModel(model: CityStyleModel): Promise<ModelLoadState> {
    try {
      const gltf = await this.gltfLoader.loadAsync(model.modelPath);
      const normalized = this.normalize(gltf.scene, model);
      this.scene.add(normalized.group);
      if (model.featured) this.addModelMarker(model, normalized.width, normalized.depth);
      this.registerAnimation(model, normalized.group);
      const result: ModelLoadState = {
        state: 'loaded',
        sourceSize: normalized.sourceSize,
        scale: normalized.scale,
      };
      this.onModelStatus(model, result);
      return result;
    } catch (error) {
      const result: ModelLoadState = {
        state: 'failed',
        message: error instanceof Error ? error.message : 'Unknown GLB load error',
      };
      this.onModelStatus(model, result);
      return result;
    }
  }

  private normalize(object: THREE.Object3D, model: CityStyleModel): {
    group: THREE.Group;
    sourceSize: number;
    scale: number;
    width: number;
    depth: number;
  } {
    object.updateMatrixWorld(true);
    const sourceBounds = new THREE.Box3().setFromObject(object);
    const sourceSize = sourceBounds.getSize(new THREE.Vector3());
    const sourceBasis = model.scaleAxis === 'height'
      ? sourceSize.y
      : model.scaleAxis === 'horizontal'
        ? Math.max(sourceSize.x, sourceSize.z)
        : Math.max(sourceSize.x, sourceSize.y, sourceSize.z);
    if (!Number.isFinite(sourceBasis) || sourceBasis <= 0) {
      throw new Error(`${model.label} has no measurable ${model.scaleAxis} extent.`);
    }

    const scale = model.targetSizeMetres / sourceBasis;
    object.scale.multiplyScalar(scale);
    object.updateMatrixWorld(true);
    const scaledBounds = new THREE.Box3().setFromObject(object);
    const scaledCenter = scaledBounds.getCenter(new THREE.Vector3());
    const scaledSize = scaledBounds.getSize(new THREE.Vector3());
    object.position.add(new THREE.Vector3(-scaledCenter.x, -scaledBounds.min.y, -scaledCenter.z));
    object.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      child.castShadow = model.animation !== 'cloud';
      child.receiveShadow = true;
    });

    const group = new THREE.Group();
    group.name = `city-style-${model.id}`;
    group.position.set(...model.position);
    group.rotation.y = model.rotationY;
    group.add(object);
    return {
      group,
      sourceSize: sourceBasis,
      scale,
      width: scaledSize.x,
      depth: scaledSize.z,
    };
  }

  private addLighting(): void {
    this.scene.add(new THREE.HemisphereLight(0xe8f5f4, 0x465842, 2.25));
    const sun = new THREE.DirectionalLight(0xffe5bd, 4.1);
    sun.position.set(-68, 128, 74);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -95;
    sun.shadow.camera.right = 95;
    sun.shadow.camera.top = 100;
    sun.shadow.camera.bottom = -72;
    sun.shadow.camera.near = 18;
    sun.shadow.camera.far = 260;
    sun.shadow.bias = -0.0008;
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight(0x89adcb, 0.85);
    fill.position.set(80, 42, -90);
    this.scene.add(fill);
  }

  private addSite(): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(270, 210),
      new THREE.MeshStandardMaterial({ color: 0x879f73, roughness: 0.96 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.22;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const plaza = new THREE.Mesh(
      new THREE.PlaneGeometry(118, 76),
      new THREE.MeshStandardMaterial({ color: 0xb7afa0, roughness: 0.9 }),
    );
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set(2, -0.17, 0);
    plaza.receiveShadow = true;
    this.scene.add(plaza);

    const scalePole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xf0d16c, roughness: 0.72 }),
    );
    scalePole.position.set(-55, 5, 29);
    scalePole.castShadow = true;
    this.scene.add(scalePole);

    for (const [x, z, height] of [
      [-88, -58, 19], [-73, -68, 27], [-52, -60, 13],
      [63, -61, 21], [81, -50, 31], [92, -67, 17],
    ] as const) {
      const hill = new THREE.Mesh(
        new THREE.ConeGeometry(height * 1.45, height, 9),
        new THREE.MeshStandardMaterial({ color: 0x6f8f69, roughness: 1 }),
      );
      hill.position.set(x, height * 0.5 - 0.2, z);
      hill.rotation.y = x * 0.01;
      hill.castShadow = true;
      hill.receiveShadow = true;
      this.scene.add(hill);
    }
  }

  private addModelMarker(model: CityStyleModel, width: number, depth: number): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(Math.max(width, depth) * 0.58, Math.max(width, depth) * 0.61, 48),
      new THREE.MeshBasicMaterial({ color: 0xe4c75e, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(model.position[0], 0.04, model.position[2]);
    this.scene.add(ring);
  }

  private registerAnimation(model: CityStyleModel, group: THREE.Group): void {
    if (!model.animation) return;
    const animated: AnimatedModel = {
      kind: model.animation,
      group,
      home: group.position.clone(),
      homeRotationY: group.rotation.y,
    };
    if (model.animation === 'fire') {
      const light = new THREE.PointLight(0xff8b45, 5.5, 18, 1.8);
      light.position.set(0, 2.3, 0);
      light.castShadow = true;
      group.add(light);
      animated.light = light;
    }
    this.animatedModels.push(animated);
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.applyDefaultCameraView();
    this.camera.updateProjectionMatrix();
  }

  private applyDefaultCameraView(): void {
    const mobile = this.container.clientWidth < 720;
    if (mobile) this.camera.position.set(166, 132, 194);
    else this.camera.position.set(132, 98, 154);
    this.controls.target.set(0, 22, 0);
  }

  private readonly animate = (): void => {
    const elapsed = this.clock.getElapsedTime();
    for (const animated of this.animatedModels) {
      if (animated.kind === 'cloud') {
        animated.group.position.x = animated.home.x + Math.sin(elapsed * 0.08) * 7;
        animated.group.position.y = animated.home.y + Math.sin(elapsed * 0.16) * 1.2;
      } else if (animated.kind === 'water') {
        animated.group.rotation.y = animated.homeRotationY + Math.sin(elapsed * 0.18) * 0.025;
      } else if (animated.light) {
        animated.light.intensity = 5.2 + Math.sin(elapsed * 5.3) * 0.8 + Math.sin(elapsed * 8.7) * 0.35;
      }
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
}
