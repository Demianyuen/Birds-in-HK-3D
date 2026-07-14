# Birds in HK

A Three.js pigeon flight simulator using Lands Department aerial imagery, a detailed Wang Fuk Court flight range, and optional official Hong Kong Buildings from the CSDI 3D Spatial Data API.

## Run

1. Put `CSDI_3D_API_KEY=...` in `.env.local`.
2. Run `npm install`.
3. Run `npm run dev`.
4. Open `http://127.0.0.1:5173`.

The current machine is already configured locally. The API key remains server-side in the Vite development proxy and is excluded from Git and the browser bundle.

## Flow

`Boot -> Main menu -> World selection -> Loading -> Flight`

The default world streams a bounded grid of official aerial imagery around Tai Po and includes eight detailed Wang Fuk Court collision towers. The official CSDI mode additionally enters flight only after a real model is parsed and camera-visible. Mouse or WASD steer, the wheel or Shift/Control changes speed, and Space flaps or launches from a surface.

## Verification

```powershell
npm run check
npm run build
npm run preview
npm run qa:assets
npm run qa:csdi
```

`qa:assets` and `qa:csdi` expect a dev or preview server to be running. Set `BIRDS_IN_HK_URL` to verify a non-default URL.

## Bird Asset

The committed pigeon GLB and Blender source are reproducible on the configured workstation:

```powershell
npm run asset:pigeon
```

The game loads `public/models/pigeon.glb` and animates the `Wing.L` and `Wing.R` pivots. It falls back to the built-in bird only if the GLB cannot load.

## Data Sources

See `docs/data-sources.md`. API credentials remain in ignored `.env.local` and are injected only by the Vite server proxy.
