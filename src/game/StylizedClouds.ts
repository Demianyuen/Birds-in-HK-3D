import {
  Color,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';

export interface CloudOptions {
  radiusMetres: number;
  clouds: number;
  minimumAltitude: number;
  maximumAltitude: number;
}

const DEFAULT_OPTIONS: CloudOptions = {
  radiusMetres: 4_200,
  clouds: 46,
  minimumAltitude: 360,
  maximumAltitude: 720,
};

/**
 * Low-poly cumulus puffs above the flight region. One instanced draw call,
 * flat-shaded so they match the trees; they drift slowly with the wind and
 * wrap around the region. Scenery only: the bird flies straight through them.
 */
export class StylizedClouds {
  public readonly group = new Group();
  private readonly geometry = new IcosahedronGeometry(1, 1);
  private readonly material = new MeshStandardMaterial({
    color: '#ffffff',
    emissive: new Color('#9fb6c8'),
    emissiveIntensity: 0.35,
    roughness: 1,
    metalness: 0,
    flatShading: true,
  });
  private mesh: InstancedMesh | null = null;
  private readonly offsets: Vector3[] = [];
  private readonly scales: Vector3[] = [];
  private readonly rotations: Quaternion[] = [];
  private readonly centres: Vector3[] = [];
  private radius = DEFAULT_OPTIONS.radiusMetres;
  private readonly wind = new Vector3(2.4, 0, 0.9);
  private readonly drift = new Vector3();
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();

  public constructor() {
    this.group.name = 'Stylised clouds';
  }

  public build(options: Partial<CloudOptions> = {}): number {
    this.clear();
    const settings = { ...DEFAULT_OPTIONS, ...options };
    this.radius = settings.radiusMetres;
    for (let cloud = 0; cloud < settings.clouds; cloud += 1) {
      const angle = hash(cloud, 1.3) * Math.PI * 2;
      const distance = Math.sqrt(hash(cloud, 7.1)) * settings.radiusMetres;
      const centre = new Vector3(
        Math.cos(angle) * distance,
        settings.minimumAltitude + hash(cloud, 3.7) * (settings.maximumAltitude - settings.minimumAltitude),
        Math.sin(angle) * distance,
      );
      const size = 40 + hash(cloud, 5.9) * 70;
      const puffs = 5 + Math.floor(hash(cloud, 9.2) * 5);
      for (let puff = 0; puff < puffs; puff += 1) {
        const spread = (puff / Math.max(1, puffs - 1) - 0.5) * size * 2.2;
        const radius = size * (0.45 + hash(cloud * 13 + puff, 2.2) * 0.45) * (1 - Math.abs(spread) / (size * 2.6));
        this.centres.push(centre);
        this.offsets.push(new Vector3(
          spread,
          radius * 0.28 + hash(cloud + puff, 4.4) * size * 0.12,
          (hash(puff, cloud * 0.7) - 0.5) * size * 0.7,
        ));
        // Flattened puffs read as cumulus rather than spheres.
        this.scales.push(new Vector3(radius * 1.2, radius * 0.72, radius));
        this.rotations.push(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), hash(cloud, puff) * Math.PI));
      }
    }
    this.mesh = new InstancedMesh(this.geometry, this.material, this.offsets.length);
    this.mesh.name = 'Cloud puffs';
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    this.update(0);
    return settings.clouds;
  }

  public update(elapsedSeconds: number): void {
    if (!this.mesh) return;
    this.drift.copy(this.wind).multiplyScalar(elapsedSeconds);
    const span = this.radius * 2;
    for (let index = 0; index < this.offsets.length; index += 1) {
      const centre = this.centres[index];
      // Wrap each cloud inside the region so the sky never empties.
      const x = wrap(centre.x + this.drift.x, this.radius, span);
      const z = wrap(centre.z + this.drift.z, this.radius, span);
      this.position.set(x, centre.y, z).add(this.offsets[index]);
      this.matrix.compose(this.position, this.rotations[index], this.scales[index]);
      this.mesh.setMatrixAt(index, this.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  public clear(): void {
    this.mesh?.dispose();
    this.mesh = null;
    this.group.clear();
    this.offsets.length = 0;
    this.scales.length = 0;
    this.rotations.length = 0;
    this.centres.length = 0;
  }

  public dispose(): void {
    this.clear();
    this.geometry.dispose();
    this.material.dispose();
  }
}

function wrap(value: number, radius: number, span: number): number {
  return ((((value + radius) % span) + span) % span) - radius;
}

function hash(x: number, y: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43_758.5453;
  return value - Math.floor(value);
}
