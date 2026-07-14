# Birds in HK

A Three.js pigeon flight simulator using official Hong Kong Buildings and Infrastructure from the Lands Department CSDI 3D Spatial Data API. The terrain keeps real elevation but uses game-rendered grass, soil, and rock instead of satellite imagery.

## Run

1. Put `CSDI_3D_API_KEY=...` in `.env.local`.
2. Run `npm install`.
3. Run `npm run dev`.
4. Open `http://127.0.0.1:5173`.

The current machine is already configured locally. The API key remains server-side in the Vite development proxy and is excluded from Git and the browser bundle.

## Flow

`Boot -> Main menu -> World selection -> Loading -> Flight`

The first playable region streams official Tai Po CSDI Building and Infrastructure over a bounded Terrarium elevation grid. It enters flight only after a real model is parsed and camera-visible. There is no procedural-building fallback: an upstream failure returns to retry or region selection. Mouse or WASD steer, the wheel or Shift/Control changes speed, and Space flaps or launches from a surface.

The official KTX2 building texture, UVs, geometry, and collision remain intact. A Three.js PBR facade layer adds stable building tones, window shading, reflections, and shadows. BlenderGIS is not part of the runtime map path: it does not consume the CSDI Cesium 3D Tiles service.

## Verification

```powershell
npm run check
npm run build
npm run preview
npm run qa:assets
npm run qa:csdi
npm run qa:runtime
```

`qa:assets` and `qa:csdi` expect a dev or preview server to be running. Set `BIRDS_IN_HK_URL` to verify a non-default URL. `qa:runtime` accepts only a fresh evidence-schema session that completes the official CSDI flow, renders a nonblank framebuffer, saves a valid PNG capture, enters flight, records FPS, and emits no errors.

## Bird Asset

The committed pigeon GLB and Blender source are reproducible on the configured workstation:

```powershell
npm run asset:pigeon
```

The game loads `public/models/pigeon.glb` and animates the `Wing.L` and `Wing.R` pivots. It falls back to the built-in bird only if the GLB cannot load.

## Data Sources

See `docs/data-sources.md`. API credentials remain in ignored `.env.local` and are injected only by the Vite server proxy.
