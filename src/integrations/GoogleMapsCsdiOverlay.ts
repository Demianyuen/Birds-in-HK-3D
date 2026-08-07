import { AmbientLight, Group, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { CsdiTiles } from '../game/CsdiTiles';
import type { FlightRegion } from '../game/regions';

export interface GoogleMapsConfiguration {
  apiKey: string;
  mapId: string;
}

interface GoogleMapInstance {}

interface GoogleWebGlOverlayView {
  onAdd: (() => void) | null;
  onContextRestored: ((options: { gl: WebGLRenderingContext }) => void) | null;
  onDraw: ((options: { gl: WebGLRenderingContext; transformer: GoogleCoordinateTransformer }) => void) | null;
  onContextLost: (() => void) | null;
  onRemove: (() => void) | null;
  requestRedraw: () => void;
  setMap: (map: GoogleMapInstance | null) => void;
}

interface GoogleCoordinateTransformer {
  fromLatLngAltitude: (position: { lat: number; lng: number; altitude: number }) => ArrayLike<number>;
}

interface GoogleMapsRuntime {
  maps: {
    Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMapInstance;
    WebGLOverlayView: new () => GoogleWebGlOverlayView;
  };
}

declare global {
  interface Window {
    google?: GoogleMapsRuntime;
  }
}

export interface GoogleMapsCsdiOverlayOptions {
  container: HTMLElement;
  region: FlightRegion;
  onStatus?: (message: string) => void;
}

export interface GoogleMapsCsdiOverlay {
  dispose: () => void;
}

let mapsLoadPromise: Promise<GoogleMapsRuntime> | null = null;

export function readGoogleMapsConfiguration(
  values: Readonly<Record<string, string | undefined>>,
): GoogleMapsConfiguration | null {
  const apiKey = values.VITE_GOOGLE_MAPS_API_KEY?.trim();
  const mapId = values.VITE_GOOGLE_MAP_ID?.trim();
  return apiKey && mapId ? { apiKey, mapId } : null;
}

export function configuredGoogleMaps(): GoogleMapsConfiguration | null {
  return readGoogleMapsConfiguration({
    VITE_GOOGLE_MAPS_API_KEY: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    VITE_GOOGLE_MAP_ID: import.meta.env.VITE_GOOGLE_MAP_ID,
  });
}

export async function mountGoogleMapsCsdiOverlay(
  options: GoogleMapsCsdiOverlayOptions,
): Promise<GoogleMapsCsdiOverlay> {
  const configuration = configuredGoogleMaps();
  if (!configuration) {
    throw new Error('Google Maps 3D needs VITE_GOOGLE_MAPS_API_KEY and VITE_GOOGLE_MAP_ID.');
  }

  const google = await loadGoogleMaps(configuration);
  const map = new google.maps.Map(options.container, {
    center: { lat: options.region.latitude, lng: options.region.longitude },
    zoom: 16,
    mapId: configuration.mapId,
    heading: 0,
    tilt: 55,
    disableDefaultUI: true,
    gestureHandling: 'greedy',
  });
  const overlay = new google.maps.WebGLOverlayView();
  const scene = new Scene();
  const csdiRoot = new Group();
  const camera = new PerspectiveCamera();
  let city = new CsdiTiles('building');
  let infrastructure = new CsdiTiles('infrastructure');
  let renderer: WebGLRenderer | null = null;
  let disposed = false;
  let layersStarted = false;

  scene.add(new AmbientLight('#ffffff', 1.25));
  scene.add(csdiRoot);

  const startLayers = (): void => {
    if (!renderer || layersStarted || disposed) return;
    layersStarted = true;
    options.onStatus?.('Connecting Google Maps overlay to LandsD CSDI.');
    void Promise.all([
      city.load(csdiRoot, camera, renderer, options.region, progress => {
        options.onStatus?.(`CSDI building: ${progress.stage}`);
      }),
      infrastructure.load(csdiRoot, camera, renderer, options.region, progress => {
        options.onStatus?.(`CSDI infrastructure: ${progress.stage}`);
      }),
    ]).then(
      () => options.onStatus?.('LandsD CSDI 3D overlay ready.'),
      error => options.onStatus?.(error instanceof Error ? error.message : 'CSDI overlay could not load.'),
    );
  };

  const releaseRenderer = (): void => {
    if (!renderer) return;
    renderer.dispose();
    renderer = null;
  };

  overlay.onAdd = () => options.onStatus?.('Preparing Google Maps 3D context.');
  overlay.onContextRestored = ({ gl }) => {
    if (disposed) return;
    renderer = new WebGLRenderer({
      canvas: gl.canvas,
      context: gl,
      ...(gl.getContextAttributes() ?? {}),
    });
    renderer.autoClear = false;
    startLayers();
  };
  overlay.onDraw = ({ transformer }) => {
    if (!renderer || disposed) return;
    camera.projectionMatrix.fromArray(transformer.fromLatLngAltitude({
      lat: options.region.latitude,
      lng: options.region.longitude,
      altitude: 0,
    }));
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    camera.matrixWorld.identity();
    camera.matrixWorldInverse.identity();
    city.update(camera, renderer);
    infrastructure.update(camera, renderer);
    renderer.render(scene, camera);
    renderer.resetState();
    overlay.requestRedraw();
  };
  overlay.onContextLost = () => {
    releaseRenderer();
    city.dispose();
    infrastructure.dispose();
    csdiRoot.clear();
    city = new CsdiTiles('building');
    infrastructure = new CsdiTiles('infrastructure');
    layersStarted = false;
  };
  overlay.onRemove = () => {
    city.dispose();
    infrastructure.dispose();
    releaseRenderer();
  };
  overlay.setMap(map);

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      overlay.setMap(null);
    },
  };
}

function loadGoogleMaps(configuration: GoogleMapsConfiguration): Promise<GoogleMapsRuntime> {
  if (window.google?.maps) return Promise.resolve(window.google);
  mapsLoadPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const url = new URL('https://maps.googleapis.com/maps/api/js');
    url.searchParams.set('key', configuration.apiKey);
    url.searchParams.set('v', 'weekly');
    url.searchParams.set('loading', 'async');
    script.id = 'google-maps-javascript-api';
    script.src = url.toString();
    script.async = true;
    script.onerror = () => {
      mapsLoadPromise = null;
      reject(new Error('Google Maps JavaScript API could not be loaded.'));
    };
    script.onload = () => {
      if (window.google?.maps) resolve(window.google);
      else {
        mapsLoadPromise = null;
        reject(new Error('Google Maps JavaScript API loaded without its maps runtime.'));
      }
    };
    document.head.append(script);
  });
  return mapsLoadPromise;
}
