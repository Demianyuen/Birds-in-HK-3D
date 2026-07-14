import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Texture,
  Vector3,
} from 'three';

export const WANG_FUK_TOWER_LAYOUT = [
  [-90, -54],
  [-30, -54],
  [30, -54],
  [90, -54],
  [-90, 54],
  [-30, 54],
  [30, 54],
  [90, 54],
] as const;

const TOWER_HEIGHT = 108;
const IDENTITY_ROTATION = new Quaternion();
const WORLD_UP = new Vector3(0, 1, 0);

export class StylizedHongKong {
  public readonly root = new Group();
  private readonly collisionGroup = new Group();
  private readonly visualGroup = new Group();
  private readonly resources = new Set<{ dispose: () => void }>();

  public constructor() {
    this.root.name = 'Stylized Hong Kong flight range';
    this.collisionGroup.name = 'Flight collision geometry';
    this.visualGroup.name = 'Simulation visual detail';
    this.root.add(this.collisionGroup, this.visualGroup);
    this.buildTerrain();
    this.buildWangFukCourt();
    this.buildTaiPoSkyline();
    this.buildTrees();
    this.buildMountains();
  }

  public get collisionRoot(): Object3D {
    return this.collisionGroup;
  }

  public get collisionMeshCount(): number {
    let count = 0;
    this.collisionGroup.traverse(object => {
      if ('isMesh' in object && object.isMesh === true) count += 1;
    });
    return count;
  }

  public setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  public dispose(): void {
    this.root.removeFromParent();
    this.root.clear();
    for (const resource of this.resources) resource.dispose();
    this.resources.clear();
  }

  private buildTerrain(): void {
    const landMaterial = this.track(new MeshStandardMaterial({
      color: '#6f9569',
      roughness: 0.96,
    }));
    const land = new Mesh(this.track(new PlaneGeometry(2_200, 2_700)), landMaterial);
    land.name = 'Tai Po terrain';
    land.rotation.x = -Math.PI / 2;
    land.position.set(0, 0, -580);
    land.receiveShadow = true;
    this.collisionGroup.add(land);

    const roadMaterial = this.track(new MeshStandardMaterial({
      color: '#4f5555',
      roughness: 0.9,
      side: DoubleSide,
    }));
    const roadGeometry = this.track(new PlaneGeometry(38, 1_900));
    for (const x of [-320, 320]) {
      const road = new Mesh(roadGeometry, roadMaterial);
      road.rotation.x = -Math.PI / 2;
      road.position.set(x, 0.08, -500);
      this.visualGroup.add(road);
    }
    const crossRoad = new Mesh(this.track(new PlaneGeometry(1_450, 46)), roadMaterial);
    crossRoad.rotation.x = -Math.PI / 2;
    crossRoad.position.set(0, 0.09, -108);
    this.visualGroup.add(crossRoad);
    this.buildRoadMarkings();
  }

  private buildRoadMarkings(): void {
    const geometry = this.track(new PlaneGeometry(1.7, 13));
    geometry.rotateX(-Math.PI / 2);
    const material = this.track(new MeshStandardMaterial({
      color: '#e5e0cc',
      roughness: 0.88,
      side: DoubleSide,
    }));
    const segmentsPerRoad = 62;
    const markings = new InstancedMesh(geometry, material, segmentsPerRoad * 2);
    const matrix = new Matrix4();
    let instance = 0;
    for (const x of [-320, 320]) {
      for (let segment = 0; segment < segmentsPerRoad; segment += 1) {
        matrix.makeTranslation(x, 0.13, 330 - segment * 29);
        markings.setMatrixAt(instance, matrix);
        instance += 1;
      }
    }
    markings.instanceMatrix.needsUpdate = true;
    markings.computeBoundingSphere();
    this.visualGroup.add(markings);
  }

  private buildWangFukCourt(): void {
    const facadeMaterial = this.track(new MeshStandardMaterial({
      color: '#d1aa91',
      map: this.createConcreteTexture(),
      roughness: 0.88,
    }));
    const sideMaterial = this.track(new MeshStandardMaterial({ color: '#a77968', roughness: 0.92 }));
    const roofMaterial = this.track(new MeshStandardMaterial({ color: '#744b42', roughness: 0.9 }));
    const mainGeometry = this.track(new BoxGeometry(28, TOWER_HEIGHT, 43));
    const wingGeometry = this.track(new BoxGeometry(18, TOWER_HEIGHT * 0.84, 34));
    const roofGeometry = this.track(new BoxGeometry(18, 14, 24));

    WANG_FUK_TOWER_LAYOUT.forEach(([x, z], index) => {
      const tower = new Group();
      tower.name = `Wang Fuk Court tower ${index + 1}`;

      const main = new Mesh(mainGeometry, [
        sideMaterial,
        sideMaterial,
        roofMaterial,
        roofMaterial,
        facadeMaterial,
        facadeMaterial,
      ]);
      main.position.y = TOWER_HEIGHT / 2;
      main.castShadow = true;
      main.receiveShadow = true;

      const leftWing = new Mesh(wingGeometry, facadeMaterial);
      leftWing.position.set(-21, TOWER_HEIGHT * 0.42, 4);
      leftWing.castShadow = true;
      leftWing.receiveShadow = true;

      const rightWing = leftWing.clone();
      rightWing.position.x = 21;

      const roof = new Mesh(roofGeometry, roofMaterial);
      roof.position.set(0, TOWER_HEIGHT + 7, 1);
      roof.castShadow = true;

      tower.add(main, leftWing, rightWing, roof);
      tower.position.set(x, 0, z);
      tower.rotation.y = index % 2 === 0 ? 0.08 : -0.08;
      this.collisionGroup.add(tower);
    });

    const podium = new Mesh(
      this.track(new BoxGeometry(250, 8, 180)),
      this.track(new MeshStandardMaterial({ color: '#b6b9a5', roughness: 0.94 })),
    );
    podium.position.set(0, 4, 0);
    podium.receiveShadow = true;
    this.collisionGroup.add(podium);
    this.visualGroup.add(this.createLandmarkLabel());
    this.buildWangFukDetails();
  }

  private buildWangFukDetails(): void {
    const mainFloors = 28;
    const wingFloors = 23;
    const mainWindows = WANG_FUK_TOWER_LAYOUT.length * mainFloors * 5 * 2;
    const wingWindows = WANG_FUK_TOWER_LAYOUT.length * 2 * wingFloors * 3 * 2;
    const windowGeometry = this.track(new BoxGeometry(3.25, 1.45, 0.28));
    const windowMaterial = this.track(new MeshStandardMaterial({
      color: '#33494d',
      emissive: '#142124',
      emissiveIntensity: 0.16,
      metalness: 0.24,
      roughness: 0.32,
    }));
    const windows = new InstancedMesh(windowGeometry, windowMaterial, mainWindows + wingWindows);
    windows.name = 'Wang Fuk Court windows';

    const acGeometry = this.track(new BoxGeometry(1.25, 0.82, 0.62));
    const acMaterial = this.track(new MeshStandardMaterial({
      color: '#d3d3c7',
      metalness: 0.08,
      roughness: 0.78,
    }));
    const acCount = WANG_FUK_TOWER_LAYOUT.length * mainFloors * 3 * 2;
    const airConditioners = new InstancedMesh(acGeometry, acMaterial, acCount);
    airConditioners.name = 'Wang Fuk Court air conditioners';

    const dummy = new Object3D();
    const estatePosition = new Vector3();
    const localPosition = new Vector3();
    let windowIndex = 0;
    let acIndex = 0;

    WANG_FUK_TOWER_LAYOUT.forEach(([x, z], towerIndex) => {
      const angle = towerIndex % 2 === 0 ? 0.08 : -0.08;
      estatePosition.set(x, 0, z);

      for (let floor = 0; floor < mainFloors; floor += 1) {
        const y = 7.6 + floor * 3.55;
        for (const face of [-1, 1]) {
          for (const localX of [-10, -5, 0, 5, 10]) {
            localPosition.set(localX, y, face * 21.65);
            this.setInstanceTransform(windows, windowIndex, dummy, localPosition, estatePosition, angle);
            windowIndex += 1;
          }
          for (const localX of [-7.5, 0, 7.5]) {
            localPosition.set(localX, y - 1.25, face * 22.05);
            this.setInstanceTransform(airConditioners, acIndex, dummy, localPosition, estatePosition, angle);
            acIndex += 1;
          }
        }
      }

      for (const wingX of [-21, 21]) {
        for (let floor = 0; floor < wingFloors; floor += 1) {
          const y = 7.1 + floor * 3.62;
          for (const face of [-1, 1]) {
            for (const offsetX of [-5, 0, 5]) {
              localPosition.set(wingX + offsetX, y, 4 + face * 17.15);
              this.setInstanceTransform(windows, windowIndex, dummy, localPosition, estatePosition, angle);
              windowIndex += 1;
            }
          }
        }
      }

      this.addRoofRailings(x, z, angle);
    });

    windows.instanceMatrix.needsUpdate = true;
    airConditioners.instanceMatrix.needsUpdate = true;
    windows.computeBoundingSphere();
    airConditioners.computeBoundingSphere();
    this.visualGroup.add(windows, airConditioners);
  }

  private addRoofRailings(x: number, z: number, angle: number): void {
    const material = this.track(new MeshStandardMaterial({
      color: '#d6d2c6',
      metalness: 0.52,
      roughness: 0.46,
    }));
    const horizontal = this.track(new BoxGeometry(25, 0.45, 0.45));
    const vertical = this.track(new BoxGeometry(0.45, 0.45, 27));
    const roof = new Group();
    roof.position.set(x, TOWER_HEIGHT + 14.5, z);
    roof.rotation.y = angle;
    for (const localZ of [-13, 13]) {
      const rail = new Mesh(horizontal, material);
      rail.position.z = localZ;
      roof.add(rail);
    }
    for (const localX of [-12, 12]) {
      const rail = new Mesh(vertical, material);
      rail.position.x = localX;
      roof.add(rail);
    }
    this.visualGroup.add(roof);
  }

  private setInstanceTransform(
    mesh: InstancedMesh,
    index: number,
    dummy: Object3D,
    localPosition: Vector3,
    estatePosition: Vector3,
    angle: number,
  ): void {
    dummy.position.copy(localPosition).applyAxisAngle(WORLD_UP, angle).add(estatePosition);
    dummy.rotation.set(0, angle, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  }

  private buildTaiPoSkyline(): void {
    const geometry = this.track(new BoxGeometry(1, 1, 1));
    const material = this.track(new MeshStandardMaterial({ color: '#d9d2bd', roughness: 0.92 }));
    const buildings: Array<{ position: Vector3; scale: Vector3 }> = [];
    let seed = 0x1983;
    const random = (): number => {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
      return seed / 0xffff_ffff;
    };

    for (let index = 0; index < 86; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const x = side * (390 + random() * 560);
      const z = 120 - random() * 1_550;
      const width = 24 + random() * 44;
      const depth = 22 + random() * 38;
      const height = 26 + random() * 96;
      buildings.push({
        position: new Vector3(x, height / 2, z),
        scale: new Vector3(width, height, depth),
      });
    }

    const skyline = new InstancedMesh(geometry, material, buildings.length);
    skyline.name = 'Tai Po skyline';
    skyline.castShadow = true;
    skyline.receiveShadow = true;
    const matrix = new Matrix4();
    buildings.forEach((building, index) => {
      matrix.compose(building.position, IDENTITY_ROTATION, building.scale);
      skyline.setMatrixAt(index, matrix);
    });
    skyline.instanceMatrix.needsUpdate = true;
    this.collisionGroup.add(skyline);
  }

  private buildTrees(): void {
    const trunkGeometry = this.track(new CylinderGeometry(0.8, 1.1, 7, 7));
    const crownGeometry = this.track(new IcosahedronGeometry(5.7, 1));
    const trunkMaterial = this.track(new MeshStandardMaterial({ color: '#6e5034', roughness: 1 }));
    const crownMaterial = this.track(new MeshStandardMaterial({ color: '#2f704f', roughness: 0.96 }));
    const count = 96;
    const trunks = new InstancedMesh(trunkGeometry, trunkMaterial, count);
    const crowns = new InstancedMesh(crownGeometry, crownMaterial, count * 2);
    const matrix = new Matrix4();

    for (let index = 0; index < count; index += 1) {
      const angle = index * 2.399963;
      const radius = 290 + (index % 13) * 42;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius * 0.72;
      matrix.makeTranslation(x, 3.5, z);
      trunks.setMatrixAt(index, matrix);
      matrix.makeTranslation(x, 13, z);
      crowns.setMatrixAt(index * 2, matrix);
      matrix.compose(
        new Vector3(x + Math.cos(angle) * 3.2, 10.5, z + Math.sin(angle) * 3.2),
        IDENTITY_ROTATION,
        new Vector3(0.75, 0.72, 0.75),
      );
      crowns.setMatrixAt(index * 2 + 1, matrix);
    }
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    trunks.castShadow = true;
    crowns.castShadow = true;
    this.collisionGroup.add(trunks, crowns);
  }

  private buildMountains(): void {
    const geometry = this.track(new PlaneGeometry(3_600, 1_400, 72, 28));
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.attributes.position;
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const z = positions.getZ(index);
      const edgeFade = Math.max(0, Math.sin(((z + 700) / 1_400) * Math.PI));
      const ridge = 155
        + Math.sin(x * 0.0041) * 54
        + Math.sin(x * 0.0117 + 1.4) * 31
        + Math.cos(x * 0.0023) * 38;
      positions.setY(index, -8 + edgeFade * ridge);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    const material = this.track(new MeshStandardMaterial({
      color: '#426958',
      roughness: 1,
      flatShading: false,
    }));
    const mountains = new Mesh(geometry, material);
    mountains.name = 'Pat Sin Leng mountain backdrop';
    mountains.position.z = -1_590;
    mountains.receiveShadow = true;
    this.collisionGroup.add(mountains);
  }

  private createConcreteTexture(): Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create the Wang Fuk Court facade texture.');

    const image = context.createImageData(canvas.width, canvas.height);
    for (let index = 0; index < image.data.length; index += 4) {
      const pixel = index / 4;
      const grain = 150 + ((pixel * 1_103_515_245 + 12_345) >>> 27);
      image.data[index] = grain + 22;
      image.data[index + 1] = grain;
      image.data[index + 2] = grain - 12;
      image.data[index + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    context.fillStyle = 'rgba(238, 220, 201, 0.28)';
    for (let y = 8; y < 256; y += 12) context.fillRect(0, y, canvas.width, 1);

    const texture = this.track(new CanvasTexture(canvas));
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    return texture;
  }

  private createLandmarkLabel(): Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create the landmark label.');
    context.fillStyle = 'rgba(7, 21, 27, 0.86)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = '#9be0b8';
    context.lineWidth = 5;
    context.strokeRect(3, 3, canvas.width - 6, canvas.height - 6);
    context.fillStyle = '#f5f8f6';
    context.font = '700 42px "Segoe UI", sans-serif';
    context.textAlign = 'center';
    context.fillText('宏福苑  WANG FUK COURT', canvas.width / 2, 78);

    const texture = this.track(new CanvasTexture(canvas));
    texture.colorSpace = SRGBColorSpace;
    const material = this.track(new SpriteMaterial({ map: texture, depthTest: false }));
    const label = new Sprite(material);
    label.name = 'Wang Fuk Court landmark label';
    label.position.set(0, 158, 0);
    label.scale.set(115, 28.75, 1);
    return label;
  }

  private track<T extends { dispose: () => void }>(resource: T): T {
    this.resources.add(resource);
    return resource;
  }
}
