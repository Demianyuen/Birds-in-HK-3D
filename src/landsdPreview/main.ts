import { TilesRenderer } from '3d-tiles-renderer/three';
import { GLTFExtensionsPlugin, LoadRegionPlugin, ReorientationPlugin, SphereRegion } from '3d-tiles-renderer/plugins';
import {
  AmbientLight,
  Color,
  DirectionalLight,
  MathUtils,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { geodeticToEcef } from '../game/geo';
import { WANG_FUK_ADDRESS_POINTS } from '../game/wangFukLocations';

/**
 * Prototype: the LandsD 3D Visualisation Map (photo-textured mesh made from
 * oblique aerial images) around Wang Fuk Court, so we can see which era the
 * capture shows before deciding whether to use it in the game.
 */

const centre = {
  latitude: WANG_FUK_ADDRESS_POINTS.reduce((sum, point) => sum + point.latitude, 0) / WANG_FUK_ADDRESS_POINTS.length,
  longitude: WANG_FUK_ADDRESS_POINTS.reduce((sum, point) => sum + point.longitude, 0) / WANG_FUK_ADDRESS_POINTS.length,
};
const UPSTREAM = /^https?:\/\/data\.map\.gov\.hk\/api\/3d-data\/3dtiles\/f2\//;

const status = document.getElementById('status')!;
const stats = document.getElementById('stats')!;
const assetBox = document.getElementById('asset')!;

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.prepend(renderer.domElement);

const scene = new Scene();
scene.background = new Color('#a9c2cf');
// The mesh carries its own baked photo lighting; keep scene light neutral and bright.
scene.add(new AmbientLight('#ffffff', 2.2));
const sun = new DirectionalLight('#ffffff', 0.6);
sun.position.set(300, 600, 200);
scene.add(sun);

const camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 20_000);
camera.position.set(-260, 220, 260);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 20, 0);
controls.enableDamping = true;
controls.update();

const tiles = new TilesRenderer('/landsd-3dvis/tileset.json');
tiles.registerPlugin({ name: 'LANDSD_PROXY', preprocessURL: (uri: string | URL) => {
  const text = uri.toString();
  // Absolute links back to the upstream service go through our proxy (which adds the key).
  const local = text.replace(UPSTREAM, `${window.location.origin}/landsd-3dvis/`);
  const url = new URL(local, window.location.href);
  url.searchParams.delete('key');
  return url.toString();
} } as never);
tiles.errorTarget = 6;
tiles.setCamera(camera);
tiles.setResolutionFromRenderer(camera, renderer);
const draco = new DRACOLoader(tiles.manager).setDecoderPath('/draco/gltf/');
const ktx2 = new KTX2Loader(tiles.manager).setTranscoderPath('/basis/').detectSupport(renderer);
tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco, ktxLoader: ktx2, rtc: true }));
const region = new LoadRegionPlugin();
region.addRegion(new SphereRegion({
  sphere: new Sphere(geodeticToEcef(centre.latitude, centre.longitude, 40), 700),
  errorTarget: tiles.errorTarget,
  mask: true,
}));
tiles.registerPlugin(region);
tiles.registerPlugin(new ReorientationPlugin({
  lat: MathUtils.degToRad(centre.latitude),
  lon: MathUtils.degToRad(centre.longitude),
  recenter: true,
}));
scene.add(tiles.group);

const metrics = { models: 0, errors: 0, lastError: '', uris: [] as string[], groundY: null as number | null };
(window as unknown as { __landsd: typeof metrics }).__landsd = metrics;

tiles.addEventListener('load-tileset', (event: { tileSet?: { asset?: unknown; root?: { children?: unknown[] } }; url?: string }) => {
  if (metrics.uris.length === 0) {
    status.textContent = '已連接，正在下載宏福苑附近的模型…';
    const asset = event.tileSet?.asset;
    assetBox.textContent = `asset:\n${JSON.stringify(asset, null, 2)}`;
  }
  if (event.url) metrics.uris.push(String(event.url).replace(/\?.*$/, ''));
});
tiles.addEventListener('load-model', (event: { tile?: { content?: { uri?: string } } }) => {
  metrics.models += 1;
  const uri = event.tile?.content?.uri;
  if (uri && metrics.uris.length < 60) metrics.uris.push(uri.replace(/\?.*$/, ''));
});
tiles.addEventListener('load-error', (event: { error?: unknown; url?: string }) => {
  metrics.errors += 1;
  metrics.lastError = `${String(event.url ?? '').replace(/\?.*$/, '')} ${event.error instanceof Error ? event.error.message : String(event.error ?? '')}`;
  status.textContent = `載入錯誤：${metrics.lastError}`;
});

const raycaster = new Raycaster();
function findGround(): void {
  raycaster.set(new Vector3(0, 2_000, 0), new Vector3(0, -1, 0));
  const hit = raycaster.intersectObject(tiles.group, true)[0];
  if (!hit) return;
  if (metrics.groundY === null) {
    metrics.groundY = hit.point.y;
    controls.target.set(0, hit.point.y + 25, 0);
    camera.position.y += hit.point.y;
    status.textContent = '模型已載入。可旋轉觀察宏福苑八座外貌。';
  }
}

const views: Record<string, () => void> = {
  aerial: () => place(new Vector3(-240, 200, 240), 25),
  low: () => place(new Vector3(-150, 70, 120), 30),
  street: () => place(new Vector3(-95, 4, 70), 28),
  top: () => place(new Vector3(1, 520, 1), 0),
};
function place(offset: Vector3, lookHeight: number): void {
  const ground = metrics.groundY ?? 0;
  controls.target.set(0, ground + lookHeight, 0);
  camera.position.set(offset.x, ground + offset.y, offset.z);
  controls.update();
}
document.getElementById('views')!.addEventListener('click', event => {
  const view = (event.target as HTMLElement).dataset.view;
  if (view && views[view]) views[view]();
});
(window as unknown as { __landsdView: (name: string) => void }).__landsdView = name => views[name]?.();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  tiles.setResolutionFromRenderer(camera, renderer);
});

let frame = 0;
// requestAnimationFrame stops while the page sits in a hidden pane or tab;
// a timer keeps tiles streaming (and screenshots possible) regardless.
let lastFrame = 0;
function loop(): void {
  const now = performance.now();
  if (now - lastFrame >= 30) {
    lastFrame = now;
    renderFrame();
  }
}
requestAnimationFrame(function raf() { loop(); requestAnimationFrame(raf); });
setInterval(loop, 50);
(window as unknown as { __landsdCapture: (quality?: number) => string }).__landsdCapture = (quality = 0.8) => {
  renderFrame();
  return renderer.domElement.toDataURL('image/jpeg', quality);
};
function renderFrame(): void {
  controls.update();
  camera.updateMatrixWorld();
  tiles.update();
  renderer.render(scene, camera);
  frame += 1;
  if (frame % 30 === 0) {
    if (metrics.groundY === null) findGround();
    stats.textContent = `已載入模型 ${metrics.models} 個 · 錯誤 ${metrics.errors} · 下載中 ${(tiles as unknown as { stats: { downloading: number; parsing: number } }).stats.downloading} · 解析中 ${(tiles as unknown as { stats: { downloading: number; parsing: number } }).stats.parsing}`;
  }
}
