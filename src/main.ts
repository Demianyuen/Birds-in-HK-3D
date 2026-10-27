import './styles.css';
import { WorldPanel } from './multiplayer/WorldPanel';
import { OpenWorldPanel } from './openWorld/OpenWorldPanel';
import { openWorldConfig } from './openWorld/config';
import { readVisitorForm, rememberedName, type Visitor } from './openWorld/visitor';
import { TouchFlightControls } from './game/TouchFlightControls';
import { createHeritageDiagram } from './game/heritageDiagram';
import { transitionFlow, type ScreenName } from './app/flow';
import { captureRuntimeFrame, reportRuntimeEvent } from './app/runtimeEvidence';
import { BirdsInHkGame, type GameTelemetry, type WorldPresentation } from './game/BirdsInHkGame';
import type { FlightControl } from './game/BirdController';
import { getBirdProfile, type BirdProfileId } from './game/birdProfiles';
import type { MapLoadProgress } from './game/CsdiTiles';
import { getFlightRegion, type FlightRegionId } from './game/regions';
import {
  configuredGoogleMaps,
  mountGoogleMapsCsdiOverlay,
  type GoogleMapsCsdiOverlay,
} from './integrations/GoogleMapsCsdiOverlay';

const app = requireElement<HTMLElement>('app');
const canvas = requireElement<HTMLCanvasElement>('game-canvas');
const visitorForm = requireElement<HTMLFormElement>('visitor-form');
const visitorName = requireElement<HTMLInputElement>('visitor-name');
const visitorMessage = requireElement<HTMLTextAreaElement>('visitor-message');
const visitorError = requireElement<HTMLElement>('visitor-error');
const startButton = requireElement<HTMLButtonElement>('start-button');
const retryButton = requireElement<HTMLButtonElement>('retry-button');
const regionButton = requireElement<HTMLButtonElement>('region-button');
const googleMapsButton = requireElement<HTMLButtonElement>('google-maps-button');
const googleMapsCloseButton = requireElement<HTMLButtonElement>('google-maps-close-button');
const googleMapsPanel = requireElement<HTMLElement>('google-maps-panel');
const googleMapsCanvas = requireElement<HTMLElement>('google-maps-canvas');
const googleMapsStatus = requireElement<HTMLElement>('google-maps-status');
const progressFill = requireElement<HTMLElement>('progress-fill');
const loadingStage = requireElement<HTMLElement>('loading-stage');
const loadingProgress = requireElement<HTMLElement>('loading-progress');
const loadingDetail = requireElement<HTMLElement>('loading-detail');
const errorMessage = requireElement<HTMLElement>('error-message');
const altitudeValue = requireElement<HTMLElement>('altitude-value');
const speedValue = requireElement<HTMLElement>('speed-value');
const headingValue = requireElement<HTMLElement>('heading-value');
const flightState = requireElement<HTMLElement>('flight-state');
const fpsValue = requireElement<HTMLElement>('fps-value');
const groundDetail = requireElement<HTMLElement>('ground-detail');
const gameHud = requireElement<HTMLElement>('game-hud');
const controlsHint = requireElement<HTMLElement>('controls-hint');
const mapStateValue = requireElement<HTMLElement>('map-state-value');
const buildingPresentation = requireElement<HTMLSelectElement>('building-presentation');
const buildingPresentationNote = requireElement<HTMLElement>('building-presentation-note');
const screens: Record<Exclude<ScreenName, 'game'>, HTMLElement> = {
  boot: requireElement<HTMLElement>('boot-screen'),
  menu: requireElement<HTMLElement>('menu-screen'),
  loading: requireElement<HTMLElement>('loading-screen'),
  error: requireElement<HTMLElement>('error-screen'),
};

let currentScreen: ScreenName = 'boot';
let loading = false;
let highestProgress = 0;
let lastReportedLoadingStage = '';
let lastReportedFlightState = '';
let renderEvidenceReported = false;
let materialEvidenceReported = false;
let roadEvidenceReported = false;
let groundEvidenceReported = false;
let lastPerformanceReport = 0;
let googleMapsOverlay: GoogleMapsCsdiOverlay | null = null;
const googleMapsConfigured = configuredGoogleMaps() !== null;
const game = new BirdsInHkGame(canvas, updateTelemetry);
const worldEndpoint = import.meta.env.VITE_WORLD_SERVER_URL
  || (import.meta.env.DEV ? 'ws://127.0.0.1:8787/world' : undefined);
const worldPanel = new WorldPanel(game, worldEndpoint);
// With the shared Supabase service configured, the open-world panel replaces the
// legacy WebSocket world-server panel.
const openWorldEnabled = openWorldConfig() !== null;
if (!openWorldEnabled) app.append(worldPanel.element);
const openWorld = new OpenWorldPanel(game);
openWorld.mount(app);
let visitor: Visitor | null = null;

const placeBanner = requireElement<HTMLElement>('place-banner');
const placeCategory = requireElement<HTMLElement>('place-category');
const placeFirst = requireElement<HTMLElement>('place-first');
const placeTitle = requireElement<HTMLElement>('place-title');
const placeSubtitle = requireElement<HTMLElement>('place-subtitle');
const placeNote = requireElement<HTMLElement>('place-note');
let placeBannerTimer = 0;
game.onPlaceArrival = arrival => {
  const { place } = arrival;
  placeBanner.dataset.tone = place.tone;
  placeCategory.textContent = place.category;
  placeFirst.hidden = !arrival.firstVisit || place.tone === 'memorial';
  placeTitle.textContent = place.title;
  placeSubtitle.textContent = place.subtitle;
  const memorialCourt = place.id === 'memorial:宏福苑';
  placeNote.hidden = !memorialCourt;
  const flowerCount = game.flowers.count;
  placeNote.textContent = memorialCourt
    ? `${flowerCount > 0 ? `這裏已有 ${flowerCount} 朵花 · ` : ''}降落地面，按 F 放下一朵花`
    : '';
  placeBanner.hidden = false;
  placeBanner.classList.remove('is-showing');
  void placeBanner.offsetWidth; // restart the animation
  placeBanner.classList.add('is-showing');
  window.clearTimeout(placeBannerTimer);
  placeBannerTimer = window.setTimeout(() => {
    placeBanner.classList.remove('is-showing');
    placeBanner.hidden = true;
  }, 5_400);
  reportRuntimeEvent('place.arrival', { id: place.id, tone: place.tone, firstVisit: arrival.firstVisit });
};
let lastFrameTime = performance.now();
visitorName.value = rememberedName();
const touchControls = new TouchFlightControls(game);
app.append(touchControls.element);
document.querySelector('.heritage-evidence')?.append(createHeritageDiagram());
worldPanel.element.addEventListener('toggle', () => {
  touchControls.setVisible(currentScreen === 'game' && !worldPanel.element.open);
});
const PRESENTATION_KEY = 'birds-in-hk:world-presentation';
const PRESENTATION_NOTES: Record<WorldPresentation, string> = {
  photo: '地政總署以斜角航拍相片建成的實景模型。從空中看最清楚，貼近地面會較模糊。',
  reference: 'CSDI 來源材質；不代表初建成或今日現況。地形、光照與碰撞保持相同。',
  preservation: '現為 CSDI 幾何的美術預覽，尚非初建成外觀還原。配色與窗格屬藝術補足。',
};
function selectedPresentation(): WorldPresentation {
  const value = buildingPresentation.value;
  return value === 'reference' || value === 'preservation' ? value : 'photo';
}
try {
  const saved = localStorage.getItem(PRESENTATION_KEY);
  if (saved === 'photo' || saved === 'reference' || saved === 'preservation') buildingPresentation.value = saved;
} catch {
  // storage blocked: keep the default
}
buildingPresentationNote.textContent = PRESENTATION_NOTES[selectedPresentation()];
buildingPresentation.addEventListener('change', () => {
  const mode = selectedPresentation();
  game.setBuildingPresentation(mode);
  buildingPresentationNote.textContent = PRESENTATION_NOTES[mode];
  try { localStorage.setItem(PRESENTATION_KEY, mode); } catch { /* per-browser convenience only */ }
  game.clearControls();
});

visitorForm.addEventListener('submit', event => {
  event.preventDefault();
  const kind = new FormData(visitorForm).get('flower-kind');
  const result = readVisitorForm(visitorName.value, visitorMessage.value, kind);
  visitorError.hidden = !result.error;
  visitorError.textContent = result.error ?? '';
  if (!result.visitor) return;
  visitor = result.visitor;
  showScreen(transitionFlow(currentScreen, 'continue'));
});
startButton.addEventListener('click', () => void beginFlight());
retryButton.addEventListener('click', () => void beginFlight());
regionButton.addEventListener('click', () => showScreen(transitionFlow(currentScreen, 'change-region')));
googleMapsButton.addEventListener('click', () => void openGoogleMapsContext());
googleMapsCloseButton.addEventListener('click', closeGoogleMapsContext);
googleMapsButton.hidden = !googleMapsConfigured;

canvas.addEventListener('click', () => {
  if (currentScreen === 'game') void canvas.requestPointerLock();
});

document.addEventListener('mousemove', event => {
  if (currentScreen !== 'game') return;
  if (document.pointerLockElement === canvas) {
    // Locked pointer (after clicking the view): relative mouse look.
    game.setSteerAxes(0, 0);
    game.steer(event.movementX, event.movementY);
    return;
  }
  // Free cursor: point where to go. Only while the cursor is over the 3D view.
  if (event.target !== canvas) {
    game.setSteerAxes(0, 0);
    return;
  }
  game.setSteerAxes(
    cursorAxis(event.clientX, window.innerWidth),
    cursorAxis(event.clientY, window.innerHeight),
  );
});
canvas.addEventListener('mouseleave', () => game.setSteerAxes(0, 0));
document.addEventListener('pointerlockchange', () => game.setSteerAxes(0, 0));

window.addEventListener('wheel', event => {
  if (currentScreen === 'game' && event.target === canvas) game.adjustSpeed(event.deltaY < 0 ? 1 : -1);
}, { passive: true });

window.addEventListener('keydown', event => {
  if (currentScreen !== 'game') return;
  if (event.target instanceof HTMLElement && (event.target.closest('.world-panel, .open-world-panel, .flower-card') || event.target.isContentEditable
    || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(event.target.tagName))) return;
  if (event.code === 'Space') {
    event.preventDefault();
    game.flap();
    return;
  }
  if (event.code === 'KeyF') {
    event.preventDefault();
    openWorld.tryLayFlower();
    return;
  }
  const control = keyboardControlForCode(event.code);
  if (control) {
    event.preventDefault();
    game.setControl(control, true);
  }
});

window.addEventListener('keyup', event => {
  const control = keyboardControlForCode(event.code);
  if (control) game.setControl(control, false);
});

window.addEventListener('beforeunload', () => {
  worldPanel.dispose();
  openWorld.dispose();
  closeGoogleMapsContext();
  game.dispose();
});
window.addEventListener('blur', () => { game.clearControls(); touchControls.releaseAll(); });
showScreen('boot');

if (import.meta.env.DEV) {
  // Development-only hooks for repeatable QA screenshots (production/qa/evidence).
  Object.assign(window, {
    __birds: {
      game,
      async capture(label: string): Promise<boolean> {
        const blob = await game.debugCapture();
        if (!blob || !/^[a-zA-Z0-9-]{1,80}$/.test(label)) return false;
        const response = await fetch('/__runtime-frame', {
          method: 'POST', headers: { 'Content-Type': 'image/png', 'X-Runtime-Session': label }, body: blob,
        });
        return response.ok;
      },
    },
  });
}

async function beginFlight(): Promise<void> {
  if (loading) return;
  loading = true;
  highestProgress = 0;
  lastReportedLoadingStage = '';
  const startEvent = currentScreen === 'error' ? 'retry' : 'start';
  showScreen(transitionFlow(currentScreen, startEvent));
  updateLoading({
    stage: 'Starting flight systems',
    detail: 'Preparing WebGL, the flight camera, and collision systems.',
    percent: 5,
    modelsLoaded: 0,
  });

  try {
    const region = getFlightRegion(selectedRegionId());
    const birdProfile = selectedBirdProfileId();
    game.setBirdProfile(birdProfile);
    mapStateValue.textContent = `${region.englishLabel} · CSDI LIVE`;
    await Promise.all([
      game.loadWorld(region.id, updateLoading),
      delay(1_000),
    ]);
    game.setBuildingPresentation(selectedPresentation());
    updateLoading({
      stage: 'Ready for takeoff',
      detail: 'Hong Kong geometry and collision are active.',
      percent: 100,
      modelsLoaded: 1,
    });
    await delay(700);
    game.startFlight();
    openWorld.begin(visitor ?? readVisitorForm('', '', 'white-chrysanthemum').visitor!);
    reportRuntimeEvent('world.ready', { source: 'csdi', region: region.id, birdProfile });
    showScreen(transitionFlow(currentScreen, 'world-ready'));
  } catch (error) {
    reportRuntimeEvent('world.error', {
      message: error instanceof Error ? error.message : 'Unknown world-loading error.',
    });
    errorMessage.textContent = error instanceof Error
      ? error.message
      : 'The official Hong Kong 3D map could not be prepared.';
    showScreen(transitionFlow(currentScreen, 'world-error'));
  } finally {
    loading = false;
  }
}

function updateLoading(progress: MapLoadProgress): void {
  highestProgress = Math.max(highestProgress, Math.min(100, Math.round(progress.percent)));
  progressFill.style.width = `${highestProgress}%`;
  loadingProgress.textContent = `${highestProgress}%`;
  loadingStage.textContent = progress.stage;
  loadingDetail.textContent = progress.detail;
  if (progress.stage !== lastReportedLoadingStage) {
    lastReportedLoadingStage = progress.stage;
    reportRuntimeEvent('loading.stage', {
      stage: progress.stage,
      percent: highestProgress,
      modelsLoaded: progress.modelsLoaded,
    });
  }
}

function updateTelemetry(telemetry: GameTelemetry): void {
  const frameTime = performance.now();
  openWorld.frame(Math.min(0.25, (frameTime - lastFrameTime) / 1_000), window.innerWidth, window.innerHeight);
  lastFrameTime = frameTime;
  if (!openWorldEnabled) worldPanel.update();
  altitudeValue.textContent = `${Math.max(0, Math.round(telemetry.altitude))} m`;
  speedValue.textContent = `${Math.round(telemetry.speedKmh)} km/h`;
  headingValue.textContent = telemetry.heading;
  flightState.textContent = telemetry.state;
  fpsValue.textContent = `${Math.round(telemetry.fps)}`;
  groundDetail.textContent = telemetry.detailPatchesLoaded > 0 ? '附近高清底圖已載入' : '完整底圖 · 正在補充附近細節';
  if (telemetry.state !== lastReportedFlightState) {
    lastReportedFlightState = telemetry.state;
    reportRuntimeEvent('flight.state', {
      state: telemetry.state,
      altitude: Math.round(telemetry.altitude),
      speedKmh: Math.round(telemetry.speedKmh),
    });
  }
  if (telemetry.renderVerified && !renderEvidenceReported) {
    renderEvidenceReported = true;
    reportRuntimeEvent('render.frame', {
      width: canvas.width,
      height: canvas.height,
      fps: Math.round(telemetry.fps),
    });
    void captureRuntimeFrame(canvas).then(captured => {
      reportRuntimeEvent('render.capture', { captured });
    });
  }
  if (
    telemetry.buildingMaterials.materials > 0
    && !materialEvidenceReported
  ) {
    materialEvidenceReported = true;
    reportRuntimeEvent('building.materials', telemetry.buildingMaterials);
  }
  if (telemetry.roads.features > 0 && !roadEvidenceReported) {
    roadEvidenceReported = true;
    reportRuntimeEvent('road.network', telemetry.roads);
  }
  if (telemetry.ground.texturedMeshes > 0 && !groundEvidenceReported) {
    groundEvidenceReported = true;
    reportRuntimeEvent('terrain.basemap', telemetry.ground);
  }
  const now = performance.now();
  if (telemetry.renderVerified && now - lastPerformanceReport >= 10_000) {
    lastPerformanceReport = now;
    reportRuntimeEvent('performance.sample', {
      fps: Math.round(telemetry.fps),
      altitude: Math.round(telemetry.altitude),
      speedKmh: Math.round(telemetry.speedKmh),
    });
  }
}

function showScreen(screen: ScreenName): void {
  currentScreen = screen;
  app.dataset.screen = screen;
  for (const [name, element] of Object.entries(screens)) element.hidden = name !== screen;
  const inGame = screen === 'game';
  gameHud.hidden = !inGame;
  controlsHint.hidden = !inGame;
  worldPanel.element.hidden = !inGame;
  openWorld.setVisible(inGame);
  touchControls.setVisible(inGame && !worldPanel.element.open);
  reportRuntimeEvent(`screen.${screen}`);
}

async function openGoogleMapsContext(): Promise<void> {
  if (!googleMapsConfigured) return;
  closeGoogleMapsContext();
  googleMapsPanel.hidden = false;
  googleMapsStatus.textContent = 'Preparing Google Maps 3D context.';
  try {
    const region = getFlightRegion(selectedRegionId());
    googleMapsOverlay = await mountGoogleMapsCsdiOverlay({
      container: googleMapsCanvas,
      region,
      onStatus: message => { googleMapsStatus.textContent = message; },
    });
    reportRuntimeEvent('google-maps.opened', { region: region.id, source: 'csdi' });
  } catch (error) {
    googleMapsStatus.textContent = error instanceof Error
      ? error.message
      : 'Google Maps 3D context could not be prepared.';
    reportRuntimeEvent('google-maps.error', { message: googleMapsStatus.textContent });
  }
}

function closeGoogleMapsContext(): void {
  googleMapsOverlay?.dispose();
  googleMapsOverlay = null;
  googleMapsCanvas.replaceChildren();
  googleMapsPanel.hidden = true;
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Required interface element #${id} is missing.`);
  return element as T;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}

function selectedRegionId(): FlightRegionId {
  const selected = document.querySelector<HTMLInputElement>('input[name="flight-region"]:checked');
  return getFlightRegion(selected?.value).id;
}

function selectedBirdProfileId(): BirdProfileId {
  const selected = document.querySelector<HTMLInputElement>('input[name="bird-profile"]:checked');
  return getBirdProfile(selected?.value).id;
}

/** Cursor offset from the centre → steering axis, with a calm dead zone in the middle. */
function cursorAxis(position: number, size: number): number {
  const offset = (position - size / 2) / (size / 2);
  const deadZone = 0.12;
  const magnitude = Math.max(0, Math.abs(offset) - deadZone) / (1 - deadZone);
  return Math.sign(offset) * Math.min(1, magnitude) ** 1.6;
}

function keyboardControlForCode(code: string): FlightControl | null {
  const controls: Record<string, FlightControl> = {
    KeyA: 'yawLeft',
    ArrowLeft: 'yawLeft',
    KeyD: 'yawRight',
    ArrowRight: 'yawRight',
    KeyW: 'pitchUp',
    ArrowUp: 'pitchUp',
    KeyS: 'pitchDown',
    ArrowDown: 'pitchDown',
    ShiftLeft: 'accelerate',
    ShiftRight: 'accelerate',
    ControlLeft: 'decelerate',
    ControlRight: 'decelerate',
  };
  return controls[code] ?? null;
}
