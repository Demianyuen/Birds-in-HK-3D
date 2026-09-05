import { Group, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3, SphereGeometry, ConeGeometry, BufferGeometry, DynamicDrawUsage } from 'three';
import { WORLD_PLAYER_LIMIT, type WorldPlayer } from './protocol';

interface RemoteBird {
  position: Vector3;
  rotation: Quaternion;
  targetPosition: Vector3;
  targetRotation: Quaternion;
  perched: boolean;
  phase: number;
}

export class RemoteBirds {
  readonly group = new Group();
  private readonly birds = new Map<string, RemoteBird>();
  private readonly batches: Array<{ mesh: InstancedMesh; local: Matrix4; wing: number }> = [];
  private readonly geometries = new Set<BufferGeometry>();
  private readonly materials = new Set<MeshStandardMaterial>();
  private readonly transform = new Matrix4();
  private readonly localWing = new Matrix4();
  private readonly combined = new Matrix4();
  private readonly scale = new Vector3(1, 1, 1);
  private disposed = false;

  constructor() {
    const white = new MeshStandardMaterial({ color: '#f4f5ee', roughness: 0.8 });
    const feather = new MeshStandardMaterial({ color: '#dfe6e1', roughness: 0.85 });
    const beak = new MeshStandardMaterial({ color: '#c99662', roughness: 0.6 });
    const eye = new MeshStandardMaterial({ color: '#101719', roughness: 0.2 });
    const sphere = new SphereGeometry(1, 12, 8);
    const wing = new ConeGeometry(0.48, 1.75, 4);
    wing.rotateZ(Math.PI / 2);
    wing.translate(-0.72, 0, 0);
    const tail = new ConeGeometry(0.36, 1, 4);
    tail.rotateX(Math.PI / 2);
    const beakShape = new ConeGeometry(0.11, 0.4, 8);
    beakShape.rotateX(-Math.PI / 2);
    this.addBatch('body', sphere, white, [0, 0, 0], [0.63, 0.59, 0.99]);
    this.addBatch('head', sphere, white, [0, 0.36, -0.96], [0.38, 0.38, 0.38]);
    this.addBatch('neck', sphere, white, [0, 0.2, -0.66], [0.34, 0.4, 0.4]);
    this.addBatch('beak', beakShape, beak, [0, 0.3, -1.3], [1, 1, 1]);
    this.addBatch('eye-left', sphere, eye, [-0.31, 0.46, -1.04], [0.045, 0.045, 0.045]);
    this.addBatch('eye-right', sphere, eye, [0.31, 0.46, -1.04], [0.045, 0.045, 0.045]);
    this.addBatch('tail', tail, feather, [0, -0.05, 1.14], [1, 1, 1]);
    this.addBatch('wing-left', wing, feather, [-0.56, 0.08, -0.02], [1, 1, 1], -1);
    // Rotate the right wing geometry rather than using a negative instance scale.
    const rightWing = wing.clone();
    rightWing.rotateY(Math.PI);
    this.addBatch('wing-right', rightWing, feather, [0.56, 0.08, -0.02], [1, 1, 1], 1);
  }

  private addBatch(name: string, geometry: BufferGeometry, material: MeshStandardMaterial, position: number[], size: number[], wing = 0): void {
    this.geometries.add(geometry);
    this.materials.add(material);
    const mesh = new InstancedMesh(geometry, material, WORLD_PLAYER_LIMIT);
    mesh.name = `remote-${name}`;
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.receiveShadow = true;
    // Remote flock does not generate 100 sets of shadow passes.
    mesh.castShadow = false;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    const local = new Matrix4().compose(new Vector3().fromArray(position), new Quaternion(), new Vector3().fromArray(size));
    this.batches.push({ mesh, local, wing });
  }

  sync(players: readonly WorldPlayer[]): void {
    if (this.disposed) return;
    if (players.length > WORLD_PLAYER_LIMIT) throw new Error('Remote player count exceeds world capacity.');
    const present = new Set(players.map(player => player.id));
    for (const id of this.birds.keys()) {
      if (!present.has(id)) this.birds.delete(id);
    }
    for (const player of players) {
      let bird = this.birds.get(player.id);
      if (!bird) {
        bird = {
          position: new Vector3().fromArray(player.position),
          rotation: new Quaternion().fromArray(player.quaternion),
          targetPosition: new Vector3(), targetRotation: new Quaternion(), perched: false,
          phase: this.birds.size * 0.71,
        };
        this.birds.set(player.id, bird);
      }
      bird.targetPosition.fromArray(player.position);
      bird.targetRotation.fromArray(player.quaternion).normalize();
      bird.perched = player.perched;
    }
    this.update(0);
  }

  update(delta: number): void {
    if (this.disposed) return;
    const alpha = 1 - Math.exp(-12 * delta);
    let index = 0;
    for (const bird of this.birds.values()) {
      bird.position.lerp(bird.targetPosition, alpha);
      bird.rotation.slerp(bird.targetRotation, alpha);
      bird.phase += delta * (bird.perched ? 1.3 : 8);
      this.transform.compose(bird.position, bird.rotation, this.scale);
      for (const batch of this.batches) {
        this.combined.multiplyMatrices(this.transform, batch.local);
        if (batch.wing) {
          this.localWing.makeRotationZ(batch.wing * Math.sin(bird.phase) * (bird.perched ? 0.05 : 0.35));
          this.combined.multiply(this.localWing);
        }
        batch.mesh.setMatrixAt(index, this.combined);
      }
      index++;
    }
    for (const batch of this.batches) {
      batch.mesh.count = index;
      batch.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.birds.clear();
    for (const batch of this.batches) batch.mesh.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.group.clear();
    this.group.removeFromParent();
  }
}
