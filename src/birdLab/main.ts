/**
 * Development-only pose sheet for the procedural bird (not part of the game build).
 * Open /bird-lab.html?profile=pigeon&view=side. `window.__lab.ready` turns true once drawn.
 */
import {
  AmbientLight, Color, DirectionalLight, HemisphereLight, OrthographicCamera, Scene, SRGBColorSpace, WebGLRenderer,
} from 'three';
import { BirdRig, type BirdMotion } from '../game/BirdRig';
import type { BirdProfileId } from '../game/birdProfiles';

const params = new URLSearchParams(location.search);
const profile = (params.get('profile') ?? 'pigeon') as BirdProfileId;
const view = params.get('view') ?? 'side';

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = SRGBColorSpace;
renderer.shadowMap.enabled = true;
document.body.append(renderer.domElement);

const scene = new Scene();
scene.background = new Color('#cfe0e8');
scene.add(new HemisphereLight('#e6f2f8', '#6b7a5c', 1.2), new AmbientLight('#ffffff', 0.25));
const sun = new DirectionalLight('#fff1dc', 2.4);
sun.position.set(-4, 8, 5);
scene.add(sun);

interface Cell { label: string; motion: BirdMotion; settle: number; phase?: number }
const cells: Cell[] = [
  { label: 'glide', motion: { mode: 'flight', flapDemand: 0 }, settle: 2 },
  { label: 'flap top', motion: { mode: 'flight', flapDemand: 1 }, settle: 0, phase: 0 },
  { label: 'mid down', motion: { mode: 'flight', flapDemand: 1 }, settle: 0, phase: 0.27 },
  { label: 'bottom', motion: { mode: 'flight', flapDemand: 1 }, settle: 0, phase: 0.55 },
  { label: 'mid up', motion: { mode: 'flight', flapDemand: 1 }, settle: 0, phase: 0.78 },
  { label: 'flare', motion: { mode: 'flare', flapDemand: 0 }, settle: 1.5 },
  { label: 'perched', motion: { mode: 'perched', flapDemand: 0 }, settle: 2 },
  { label: 'perched (wait)', motion: { mode: 'perched', flapDemand: 0 }, settle: 4 },
  { label: 'walk', motion: { mode: 'walk', flapDemand: 0, walkPace: 0.4 }, settle: 2.1 },
  { label: 'walk (stride)', motion: { mode: 'walk', flapDemand: 0, walkPace: 0.4 }, settle: 2.35 },
  { label: 'run', motion: { mode: 'walk', flapDemand: 0, walkPace: 1 }, settle: 2.2 },
];

const columns = 4;
const spacing = 6.5;
cells.forEach((cell, index) => {
  const rig = new BirdRig(profile);
  const internal = rig as unknown as { phase: number; flapWeight: number; flapIntensity: number };
  for (let t = 0; t < cell.settle; t += 1 / 60) rig.update(1 / 60, cell.motion);
  if (cell.phase !== undefined) {
    internal.flapWeight = 1;
    internal.flapIntensity = 1;
    internal.phase = cell.phase;
    rig.update(0, cell.motion);
  }
  const column = index % columns;
  const row = Math.floor(index / columns);
  rig.root.position.set((column - (columns - 1) / 2) * spacing, -(row - 1) * spacing * 0.75, 0);
  if (view === 'side') rig.root.rotation.y = -Math.PI / 2;
  if (view === 'front') rig.root.rotation.y = 0;
  if (view === 'rear') rig.root.rotation.y = Math.PI;
  if (view === 'three') rig.root.rotation.y = -Math.PI / 2 + 0.7;
  scene.add(rig.root);
});

const aspect = window.innerWidth / window.innerHeight;
const half = 15;
const camera = new OrthographicCamera(-half, half, half / aspect, -half / aspect, 0.1, 200);
if (view === 'top') { camera.position.set(0, 40, 0.01); } else if (view === 'three') { camera.position.set(0, 9, 40); } else { camera.position.set(0, 2, 40); }
camera.lookAt(0, 0, 0);
renderer.render(scene, camera);
(window as unknown as { __lab: { ready: boolean } }).__lab = { ready: true };
