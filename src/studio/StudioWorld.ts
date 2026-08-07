import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { AgentId, AgentProfile, AgentState } from './data';

interface AgentVisual {
  group: THREE.Group;
  target: THREE.Vector3;
  label: HTMLButtonElement;
  home: THREE.Vector3;
  state: AgentState;
}

interface FlyingBird {
  group: THREE.Group;
  leftWing: THREE.Mesh;
  rightWing: THREE.Mesh;
  radius: number;
  speed: number;
  phase: number;
}

const HOME_POSITIONS: Record<AgentId, readonly [number, number, number]> = {
  'dou-dou': [-5.1, 0.62, 2.8],
  'nian-nian': [4.9, 0.62, 2.8],
  'map-agent': [-5.2, 0.62, -3.5],
  'qa-agent': [5.1, 0.62, -3.4],
  'asset-agent': [0, 0.62, -5.6],
};

const WORK_POSITIONS: Record<AgentId, readonly [number, number, number]> = {
  'dou-dou': [-1.35, 0.62, 0.25],
  'nian-nian': [1.35, 0.62, 0.25],
  'map-agent': [-2.35, 0.62, -1.8],
  'qa-agent': [2.35, 0.62, -1.8],
  'asset-agent': [0, 0.62, -2.8],
};

export class StudioWorld {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  private readonly controls: OrbitControls;
  private readonly clock = new THREE.Clock();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly agents = new Map<AgentId, AgentVisual>();
  private readonly hitTargets: THREE.Object3D[] = [];
  private readonly birds: FlyingBird[] = [];
  private readonly selectionRing: THREE.Mesh;
  private readonly resizeObserver: ResizeObserver;
  private motionEnabled = true;
  private selectedId: AgentId = 'dou-dou';

  constructor(
    private readonly container: HTMLElement,
    profiles: AgentProfile[],
    private readonly onSelect: (id: AgentId) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'studio-canvas';
    this.renderer.domElement.setAttribute('aria-label', '可旋轉的開放式藝術村 3D 場景');
    this.container.prepend(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x9dd7dc);
    this.scene.fog = new THREE.Fog(0x9dd7dc, 24, 42);
    this.camera.position.set(13, 14, 17);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 17;
    this.controls.maxDistance = 30;
    this.controls.minPolarAngle = Math.PI * 0.19;
    this.controls.maxPolarAngle = Math.PI * 0.42;
    this.controls.target.set(0, 0.2, -0.7);
    this.controls.saveState();

    this.addLights();
    this.addLandscape();
    this.addVillage(profiles);
    this.selectionRing = this.createSelectionRing();
    this.scene.add(this.selectionRing);
    this.setSelected(this.selectedId);

    this.renderer.domElement.addEventListener('pointermove', this.handlePointerMove);
    this.renderer.domElement.addEventListener('click', this.handleClick);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.renderer.setAnimationLoop(this.animate);
  }

  updateProfiles(profiles: AgentProfile[]): void {
    for (const profile of profiles) {
      const visual = this.agents.get(profile.id);
      if (!visual) continue;
      visual.state = profile.state;
      visual.target.copy(this.targetFor(profile));
      visual.label.dataset.state = profile.state;
      visual.label.querySelector<HTMLElement>('[data-state-label]')!.textContent = profile.focus;
      visual.label.querySelector<HTMLElement>('[data-state-dot]')!.dataset.state = profile.state;
    }
  }

  setSelected(id: AgentId): void {
    this.selectedId = id;
    const visual = this.agents.get(id);
    if (!visual) return;
    this.selectionRing.position.set(visual.group.position.x, 0.48, visual.group.position.z);
    for (const [agentId, agent] of this.agents) {
      agent.label.classList.toggle('is-selected', agentId === id);
      agent.label.setAttribute('aria-pressed', String(agentId === id));
    }
  }

  setMotionEnabled(enabled: boolean): void {
    this.motionEnabled = enabled;
  }

  resetCamera(): void {
    this.controls.reset();
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('pointermove', this.handlePointerMove);
    this.renderer.domElement.removeEventListener('click', this.handleClick);
    this.controls.dispose();
    this.renderer.dispose();
  }

  private addLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xe8fbff, 0x426a45, 2.4));
    const sun = new THREE.DirectionalLight(0xfff2cc, 3.2);
    sun.position.set(-8, 16, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -13;
    sun.shadow.camera.right = 13;
    sun.shadow.camera.top = 13;
    sun.shadow.camera.bottom = -13;
    this.scene.add(sun);
  }

  private addLandscape(): void {
    const grass = new THREE.Mesh(
      new THREE.CylinderGeometry(10.2, 10.8, 0.8, 12),
      new THREE.MeshStandardMaterial({ color: 0x79b86b, roughness: 0.92 }),
    );
    grass.receiveShadow = true;
    grass.position.y = -0.42;
    this.scene.add(grass);

    const cliff = new THREE.Mesh(
      new THREE.CylinderGeometry(10.1, 10.7, 0.55, 12),
      new THREE.MeshStandardMaterial({ color: 0x9c7b54, roughness: 1 }),
    );
    cliff.position.y = -0.82;
    this.scene.add(cliff);

    this.addPath(0, 1.2, 0.95, 10.8, 0);
    this.addPath(0, -1.2, 9.8, 0.9, 0);
    this.addPath(-3.8, -1.6, 0.75, 6.2, -0.72);
    this.addPath(3.8, -1.6, 0.75, 6.2, 0.72);

    const pond = new THREE.Mesh(
      new THREE.CircleGeometry(1.45, 36),
      new THREE.MeshPhysicalMaterial({ color: 0x4eaeb8, roughness: 0.2, metalness: 0.05, clearcoat: 0.65 }),
    );
    pond.rotation.x = -Math.PI / 2;
    pond.scale.set(1.4, 0.72, 1);
    pond.position.set(6.2, 0.03, 5.3);
    this.scene.add(pond);

    const plaza = new THREE.Mesh(
      new THREE.CylinderGeometry(3.2, 3.35, 0.14, 16),
      new THREE.MeshStandardMaterial({ color: 0xc9b276, roughness: 1 }),
    );
    plaza.position.set(0, 0.06, -0.8);
    plaza.receiveShadow = true;
    this.scene.add(plaza);

    for (const tree of [
      [-8.2, -4.1, 1.05], [-7.7, 5.1, 0.85], [7.9, -5.2, 1.15],
      [8.5, 1.2, 0.8], [-1.7, 7.5, 0.9], [2.2, 7.7, 0.7],
    ] as const) this.scene.add(this.createTree(tree[0], tree[1], tree[2]));

    for (let index = 0; index < 32; index += 1) {
      const angle = index * 2.399;
      const radius = 4.1 + (index % 7) * 0.68;
      const flower = this.createFlower(index % 3 === 0 ? 0xf2c94c : index % 3 === 1 ? 0xf47b66 : 0xf2efe2);
      flower.position.set(Math.cos(angle) * radius, 0.08, Math.sin(angle) * radius);
      this.scene.add(flower);
    }

    for (let index = 0; index < 3; index += 1) this.addBird(index);
  }

  private addVillage(profiles: AgentProfile[]): void {
    profiles.forEach((profile, index) => {
      const home = new THREE.Vector3(...HOME_POSITIONS[profile.id]);
      const cabin = this.createCabin(profile.accent, index);
      cabin.position.set(home.x, 0.02, home.z);
      cabin.rotation.y = Math.atan2(-home.x, -home.z) * 0.18;
      this.markInteractive(cabin, profile.id);
      this.scene.add(cabin);

      const avatar = this.createAvatar(profile.accent, index);
      avatar.position.copy(this.targetFor(profile));
      this.markInteractive(avatar, profile.id);
      this.scene.add(avatar);

      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'world-label';
      label.dataset.agent = profile.id;
      label.dataset.state = profile.state;
      label.setAttribute('aria-label', `查看 ${profile.name} 的工作`);
      label.innerHTML = `<span class="world-label-name"><b data-state-dot data-state="${profile.state}"></b>${profile.name}</span><span data-state-label>${profile.focus}</span>`;
      label.addEventListener('click', () => this.onSelect(profile.id));
      this.container.append(label);

      this.agents.set(profile.id, {
        group: avatar,
        target: avatar.position.clone(),
        label,
        home,
        state: profile.state,
      });
    });

    const table = this.createWorkTable();
    table.position.set(0, 0.12, -0.75);
    this.scene.add(table);
  }

  private targetFor(profile: AgentProfile): THREE.Vector3 {
    const home = new THREE.Vector3(...HOME_POSITIONS[profile.id]);
    const work = new THREE.Vector3(...WORK_POSITIONS[profile.id]);
    if (profile.state === 'working' || profile.state === 'reviewing') return work;
    if (profile.state === 'handoff') return home.clone().lerp(new THREE.Vector3(0, 0.62, -0.8), 0.48);
    if (profile.state === 'blocked') return home.clone().add(new THREE.Vector3(0.65, 0, 0.25));
    return home.clone().add(new THREE.Vector3(home.x > 0 ? -0.8 : 0.8, 0, home.z > 0 ? -0.55 : 0.55));
  }

  private createCabin(accent: number, variant: number): THREE.Group {
    const group = new THREE.Group();
    const wallColors = [0xe4b36d, 0xdb956d, 0xd8bd75, 0xd9a779, 0xc99269];
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(2.35, 1.55, 1.95),
      new THREE.MeshStandardMaterial({ color: wallColors[variant % wallColors.length], roughness: 0.9 }),
    );
    wall.position.y = 0.92;
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);

    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(1.85, 1.15, 4),
      new THREE.MeshStandardMaterial({ color: accent, roughness: 0.82 }),
    );
    roof.position.y = 2.1;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    group.add(roof);

    const door = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.95, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x644b38, roughness: 1 }),
    );
    door.position.set(0.45, 0.56, 1.02);
    group.add(door);

    const windowMaterial = new THREE.MeshStandardMaterial({ color: 0xf1d889, emissive: 0x594719, emissiveIntensity: 0.24 });
    const window = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.5, 0.12), windowMaterial);
    window.position.set(-0.48, 1.02, 1.02);
    group.add(window);

    const chimney = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.9, 0.38),
      new THREE.MeshStandardMaterial({ color: 0x8d6f5a, roughness: 1 }),
    );
    chimney.position.set(0.7, 2.25, -0.35);
    chimney.castShadow = true;
    group.add(chimney);
    return group;
  }

  private createAvatar(accent: number, variant: number): THREE.Group {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.28, 0.48, 5, 10),
      new THREE.MeshStandardMaterial({ color: accent, roughness: 0.72 }),
    );
    body.position.y = 0.68;
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.31, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xf2c7a2, roughness: 0.82 }),
    );
    head.position.y = 1.35;
    head.castShadow = true;
    group.add(head);

    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.325, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.54),
      new THREE.MeshStandardMaterial({ color: [0x3d322c, 0x24354a, 0x684b31, 0x33474b, 0x8a4a3c][variant], roughness: 0.92 }),
    );
    hair.position.y = 1.41;
    head.add(hair);

    const satchel = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.34, 0.18),
      new THREE.MeshStandardMaterial({ color: 0xd6b466, roughness: 0.9 }),
    );
    satchel.position.set(0.3, 0.64, 0.14);
    group.add(satchel);
    return group;
  }

  private createWorkTable(): THREE.Group {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: 0x916f49, roughness: 0.95 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.16, 1.25), material);
    top.position.y = 0.95;
    top.castShadow = true;
    group.add(top);
    for (const x of [-0.92, 0.92]) {
      for (const z of [-0.42, 0.42]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.9, 0.16), material);
        leg.position.set(x, 0.46, z);
        group.add(leg);
      }
    }
    const plan = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.03, 0.62),
      new THREE.MeshStandardMaterial({ color: 0xdce8dd, roughness: 1 }),
    );
    plan.position.set(-0.35, 1.05, 0.03);
    plan.rotation.y = -0.22;
    group.add(plan);
    return group;
  }

  private createTree(x: number, z: number, scale: number): THREE.Group {
    const group = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.26, 1.8, 7),
      new THREE.MeshStandardMaterial({ color: 0x73523d, roughness: 1 }),
    );
    trunk.position.y = 0.9;
    trunk.castShadow = true;
    group.add(trunk);
    const crownMaterial = new THREE.MeshStandardMaterial({ color: 0x316e4c, roughness: 0.9 });
    for (const [cx, cy, cz, radius] of [[0, 2.15, 0, 0.88], [-0.48, 1.94, 0.12, 0.62], [0.45, 1.92, -0.08, 0.68]] as const) {
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 1), crownMaterial);
      crown.position.set(cx, cy, cz);
      crown.castShadow = true;
      group.add(crown);
    }
    group.position.set(x, 0, z);
    group.scale.setScalar(scale);
    return group;
  }

  private createFlower(color: number): THREE.Group {
    const group = new THREE.Group();
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.025, 0.25, 5),
      new THREE.MeshStandardMaterial({ color: 0x397a4d }),
    );
    stem.position.y = 0.13;
    group.add(stem);
    const bloom = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.07, 0),
      new THREE.MeshStandardMaterial({ color, roughness: 0.7 }),
    );
    bloom.position.y = 0.29;
    group.add(bloom);
    return group;
  }

  private addPath(x: number, z: number, width: number, depth: number, rotation: number): void {
    const path = new THREE.Mesh(
      new THREE.BoxGeometry(width, 0.08, depth),
      new THREE.MeshStandardMaterial({ color: 0xcdb67f, roughness: 1 }),
    );
    path.position.set(x, 0.015, z);
    path.rotation.y = rotation;
    path.receiveShadow = true;
    this.scene.add(path);
  }

  private addBird(index: number): void {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: index === 0 ? 0xf2f0e8 : 0x5c6871, roughness: 0.75 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), material);
    body.scale.set(1.6, 0.7, 0.72);
    group.add(body);
    const wingGeometry = new THREE.ConeGeometry(0.22, 0.58, 3);
    const leftWing = new THREE.Mesh(wingGeometry, material);
    leftWing.position.x = -0.29;
    leftWing.rotation.z = -Math.PI / 2;
    group.add(leftWing);
    const rightWing = leftWing.clone();
    rightWing.position.x = 0.29;
    rightWing.rotation.z = Math.PI / 2;
    group.add(rightWing);
    this.scene.add(group);
    this.birds.push({ group, leftWing, rightWing, radius: 5.2 + index * 1.2, speed: 0.15 + index * 0.035, phase: index * 2.1 });
  }

  private createSelectionRing(): THREE.Mesh {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.48, 0.61, 32),
      new THREE.MeshBasicMaterial({ color: 0xffdf63, transparent: true, opacity: 0.92, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    return ring;
  }

  private markInteractive(object: THREE.Object3D, id: AgentId): void {
    object.traverse(child => {
      child.userData.agentId = id;
      if (child instanceof THREE.Mesh) this.hitTargets.push(child);
    });
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    const mobile = width < 640;
    this.camera.position.set(mobile ? 16 : 13, mobile ? 17 : 14, mobile ? 21 : 17);
    this.controls.target.set(0, 0.2, mobile ? -0.4 : -0.7);
    this.camera.updateProjectionMatrix();
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    const hit = this.pick(event);
    this.renderer.domElement.style.cursor = hit ? 'pointer' : 'grab';
  };

  private readonly handleClick = (event: MouseEvent): void => {
    const hit = this.pick(event);
    const id = hit?.object.userData.agentId as AgentId | undefined;
    if (id) this.onSelect(id);
  };

  private pick(event: MouseEvent | PointerEvent): THREE.Intersection | undefined {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(this.hitTargets, false)[0];
  }

  private readonly animate = (): void => {
    const elapsed = this.clock.getElapsedTime();
    const delta = Math.min(this.clock.getDelta(), 0.05);
    this.controls.update(delta);

    for (const [id, visual] of this.agents) {
      if (this.motionEnabled) visual.group.position.lerp(visual.target, 0.035);
      else visual.group.position.copy(visual.target);
      const working = visual.state === 'working' || visual.state === 'reviewing' || visual.state === 'handoff';
      visual.group.rotation.y = working ? Math.sin(elapsed * 0.6 + visual.home.x) * 0.12 : 0;
      visual.group.position.y = visual.target.y + (this.motionEnabled && working ? Math.sin(elapsed * 2.2 + visual.home.z) * 0.035 : 0);
      if (id === this.selectedId) this.selectionRing.position.set(visual.group.position.x, 0.48, visual.group.position.z);
      this.positionLabel(visual);
    }

    this.birds.forEach((bird, index) => {
      const angle = elapsed * bird.speed + bird.phase;
      bird.group.position.set(Math.cos(angle) * bird.radius, 5.2 + index * 0.45 + Math.sin(angle * 2) * 0.25, Math.sin(angle) * bird.radius);
      bird.group.rotation.y = -angle + Math.PI / 2;
      const flap = this.motionEnabled ? Math.sin(elapsed * 7 + index) * 0.55 : 0.1;
      bird.leftWing.rotation.y = flap;
      bird.rightWing.rotation.y = -flap;
    });

    const pulse = this.motionEnabled ? 1 + Math.sin(elapsed * 3) * 0.08 : 1;
    this.selectionRing.scale.setScalar(pulse);
    this.renderer.render(this.scene, this.camera);
  };

  private positionLabel(visual: AgentVisual): void {
    const world = visual.group.position.clone().add(new THREE.Vector3(0, 2.05, 0));
    world.project(this.camera);
    const x = (world.x * 0.5 + 0.5) * this.container.clientWidth;
    const y = (-world.y * 0.5 + 0.5) * this.container.clientHeight;
    visual.label.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px) translate(var(--label-x), var(--label-y))`;
    visual.label.hidden = world.z > 1 || x < -80 || x > this.container.clientWidth + 80 || y < -80 || y > this.container.clientHeight + 80;
  }
}
