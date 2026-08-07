import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getBirdProfile, type BirdProfileId } from './birdProfiles';

export class Pigeon {
  public readonly root = new Group();
  private readonly leftWing = new Group();
  private readonly rightWing = new Group();
  private activeLeftWing: Object3D | null = this.leftWing;
  private activeRightWing: Object3D | null = this.rightWing;
  private leftWingBaseRotation = 0;
  private rightWingBaseRotation = 0;
  private modelPromise: Promise<boolean> | null = null;
  private animationTime = 0;
  private flapImpulse = 0;
  private profileId: BirdProfileId = 'pigeon';

  public constructor() {
    const white = new MeshStandardMaterial({ color: new Color('#e5e8e6'), roughness: 0.74 });
    const silver = new MeshStandardMaterial({ color: new Color('#aeb9bc'), roughness: 0.78 });
    const charcoal = new MeshStandardMaterial({ color: new Color('#37474d'), roughness: 0.8 });
    const neck = new MeshStandardMaterial({ color: new Color('#428071'), roughness: 0.64, metalness: 0.05 });
    const orange = new MeshStandardMaterial({ color: new Color('#d8902f'), roughness: 0.62 });
    const black = new MeshStandardMaterial({ color: new Color('#101719'), roughness: 0.3 });
    white.name = 'plumage';
    silver.name = 'breast';
    charcoal.name = 'flight-feathers';
    neck.name = 'neck';

    const body = new Mesh(new SphereGeometry(0.72, 24, 16), white);
    body.scale.set(0.88, 0.82, 1.38);
    const breast = new Mesh(new SphereGeometry(0.46, 20, 14), silver);
    breast.position.set(0, 0.06, -0.52);
    breast.scale.set(0.95, 1.05, 0.8);
    const neckRing = new Mesh(new CylinderGeometry(0.34, 0.44, 0.46, 18), neck);
    neckRing.position.set(0, 0.24, -0.68);
    neckRing.rotation.x = Math.PI / 2;
    const head = new Mesh(new SphereGeometry(0.38, 20, 14), white);
    head.position.set(0, 0.36, -0.96);
    const beak = new Mesh(new ConeGeometry(0.11, 0.4, 8), orange);
    beak.position.set(0, 0.3, -1.3);
    beak.rotation.x = -Math.PI / 2;

    const leftEye = new Mesh(new SphereGeometry(0.045, 10, 8), black);
    leftEye.position.set(-0.31, 0.46, -1.04);
    const rightEye = leftEye.clone();
    rightEye.position.x = 0.31;

    this.leftWing.position.set(-0.56, 0.08, -0.02);
    this.rightWing.position.set(0.56, 0.08, -0.02);
    const leftFeather = new Mesh(new ConeGeometry(0.48, 1.75, 4), charcoal);
    leftFeather.rotation.z = Math.PI / 2;
    leftFeather.position.x = -0.72;
    const rightFeather = leftFeather.clone();
    rightFeather.rotation.z = -Math.PI / 2;
    rightFeather.position.x = 0.72;
    this.leftWing.add(leftFeather);
    this.rightWing.add(rightFeather);

    const tail = new Mesh(new ConeGeometry(0.36, 1.0, 4), charcoal);
    tail.position.set(0, -0.05, 1.14);
    tail.rotation.x = Math.PI / 2;
    this.root.add(body, breast, neckRing, head, beak, leftEye, rightEye, this.leftWing, this.rightWing, tail);
    this.root.traverse(object => {
      if (object instanceof Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
  }

  public triggerFlap(): void {
    this.flapImpulse = 1;
  }

  public setProfile(profileId: BirdProfileId): void {
    if (this.modelPromise) return;
    this.profileId = profileId;
    const profileScale = profileId === 'eagle' ? 1.45 : profileId === 'dove' ? 0.94 : 1;
    this.root.scale.setScalar(profileScale);
    const wingScale = profileId === 'eagle' ? 1.72 : profileId === 'dove' ? 1.06 : 1;
    this.leftWing.scale.set(wingScale, 1, 1);
    this.rightWing.scale.set(wingScale, 1, 1);
    this.root.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!(material instanceof MeshStandardMaterial)) continue;
        if (profileId === 'eagle') {
          if (material.name === 'plumage') material.color.set('#5a4630');
          if (material.name === 'breast') material.color.set('#8b7351');
          if (material.name === 'flight-feathers') material.color.set('#1d1a18');
          if (material.name === 'neck') material.color.set('#655035');
        } else if (profileId === 'dove') {
          if (material.name === 'plumage') material.color.set('#f1f3ef');
          if (material.name === 'breast') material.color.set('#d7dfdb');
          if (material.name === 'flight-feathers') material.color.set('#aebbb6');
          if (material.name === 'neck') material.color.set('#c4d8d1');
        }
      }
    });
  }

  public loadModel(): Promise<boolean> {
    this.modelPromise ??= this.loadGlbModel(getBirdProfile(this.profileId).modelPath);
    return this.modelPromise;
  }

  public animate(deltaSeconds: number, flightSpeed: number, perched: boolean): void {
    this.animationTime += deltaSeconds * (perched ? 1.3 : 6 + flightSpeed * 0.08);
    this.flapImpulse = Math.max(0, this.flapImpulse - deltaSeconds * 3.5);
    const amplitude = perched ? 0.05 : 0.28 + this.flapImpulse * 0.62;
    const wingAngle = Math.sin(this.animationTime) * amplitude;
    if (this.activeLeftWing) this.activeLeftWing.rotation.z = this.leftWingBaseRotation + wingAngle;
    if (this.activeRightWing) this.activeRightWing.rotation.z = this.rightWingBaseRotation - wingAngle;
    this.root.position.y = Math.sin(this.animationTime * 0.5) * (perched ? 0.02 : 0.05);
  }

  private async loadGlbModel(modelPath: string): Promise<boolean> {
    try {
      const gltf = await new GLTFLoader().loadAsync(modelPath);
      const { leftWing, rightWing } = findBirdWingPivots(gltf.scene);

      this.disposeCurrentVisual();
      this.root.clear();
      gltf.scene.name = `${getBirdProfile(this.profileId).loadingLabel} GLB model`;
      gltf.scene.scale.setScalar(1.02);
      gltf.scene.traverse(object => {
        if (object instanceof Mesh) {
          object.castShadow = true;
          object.receiveShadow = true;
        }
      });
      this.root.add(gltf.scene);
      this.activeLeftWing = leftWing ?? null;
      this.activeRightWing = rightWing ?? null;
      this.leftWingBaseRotation = leftWing?.rotation.z ?? 0;
      this.rightWingBaseRotation = rightWing?.rotation.z ?? 0;
      return true;
    } catch {
      return false;
    }
  }

  private disposeCurrentVisual(): void {
    this.root.traverse(object => {
      if (!(object instanceof Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    });
  }
}

export function findPigeonWingPivots(root: Object3D): {
  leftWing: Object3D | undefined;
  rightWing: Object3D | undefined;
} {
  return {
    leftWing: root.getObjectByName('Wing.L') ?? root.getObjectByName('WingL'),
    rightWing: root.getObjectByName('Wing.R') ?? root.getObjectByName('WingR'),
  };
}

function findBirdWingPivots(root: Object3D): {
  leftWing: Object3D | undefined;
  rightWing: Object3D | undefined;
} {
  const blenderPivots = findPigeonWingPivots(root);
  if (blenderPivots.leftWing && blenderPivots.rightWing) return blenderPivots;

  let leftWing: Object3D | undefined;
  let rightWing: Object3D | undefined;
  root.traverse(object => {
    const name = object.name.toLowerCase();
    if (!name.includes('wing')) return;
    if (!leftWing && /(^|[_ .-])(left|l)([_ .-]|$)/.test(name)) leftWing = object;
    if (!rightWing && /(^|[_ .-])(right|r)([_ .-]|$)/.test(name)) rightWing = object;
  });
  return { leftWing, rightWing };
}
