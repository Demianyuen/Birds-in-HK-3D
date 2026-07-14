import './styles.css';
import { transitionFlow, type ScreenName } from './app/flow';
import { reportRuntimeEvent } from './app/runtimeEvidence';
import { BirdsInHkGame, type GameTelemetry, type WorldSource } from './game/BirdsInHkGame';
import type { FlightControl } from './game/BirdController';
import type { MapLoadProgress } from './game/CsdiTiles';

const app = requireElement<HTMLElement>('app');
const canvas = requireElement<HTMLCanvasElement>('game-canvas');
const continueButton = requireElement<HTMLButtonElement>('continue-button');
const startButton = requireElement<HTMLButtonElement>('start-button');
const retryButton = requireElement<HTMLButtonElement>('retry-button');
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
const gameHud = requireElement<HTMLElement>('game-hud');
const controlsHint = requireElement<HTMLElement>('controls-hint');
const mapStateValue = requireElement<HTMLElement>('map-state-value');
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
let lastPerformanceReport = 0;
const game = new BirdsInHkGame(canvas, updateTelemetry);

continueButton.addEventListener('click', () => showScreen(transitionFlow(currentScreen, 'continue')));
startButton.addEventListener('click', () => void beginFlight());
retryButton.addEventListener('click', () => void beginFlight());

canvas.addEventListener('click', () => {
  if (currentScreen === 'game') void canvas.requestPointerLock();
});

document.addEventListener('mousemove', event => {
  if (currentScreen === 'game' && document.pointerLockElement === canvas) {
    game.steer(event.movementX, event.movementY);
  }
});

window.addEventListener('wheel', event => {
  if (currentScreen === 'game') game.adjustSpeed(event.deltaY < 0 ? 1 : -1);
}, { passive: true });

window.addEventListener('keydown', event => {
  if (currentScreen !== 'game') return;
  if (event.code === 'Space') {
    event.preventDefault();
    game.flap();
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

window.addEventListener('beforeunload', () => game.dispose());
showScreen('boot');

async function beginFlight(): Promise<void> {
  if (loading) return;
  loading = true;
  highestProgress = 0;
  const startEvent = currentScreen === 'error' ? 'retry' : 'start';
  showScreen(transitionFlow(currentScreen, startEvent));
  updateLoading({
    stage: 'Starting flight systems',
    detail: 'Preparing WebGL, the flight camera, and collision systems.',
    percent: 5,
    modelsLoaded: 0,
  });

  try {
    const source = selectedWorldSource();
    mapStateValue.textContent = source === 'csdi' ? 'CSDI LIVE' : 'TAI PO RANGE';
    await Promise.all([
      game.loadWorld(source, updateLoading),
      delay(1_000),
    ]);
    updateLoading({
      stage: 'Ready for takeoff',
      detail: 'Hong Kong geometry and collision are active.',
      percent: 100,
      modelsLoaded: 1,
    });
    await delay(700);
    game.startFlight();
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
  altitudeValue.textContent = `${Math.max(0, Math.round(telemetry.altitude))} m`;
  speedValue.textContent = `${Math.round(telemetry.speedKmh)} km/h`;
  headingValue.textContent = telemetry.heading;
  flightState.textContent = telemetry.state;
  fpsValue.textContent = `${Math.round(telemetry.fps)}`;
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
  reportRuntimeEvent(`screen.${screen}`);
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Required interface element #${id} is missing.`);
  return element as T;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}

function selectedWorldSource(): WorldSource {
  const selected = document.querySelector<HTMLInputElement>('input[name="world-source"]:checked');
  return selected?.value === 'csdi' ? 'csdi' : 'stylized';
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
