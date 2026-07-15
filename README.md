# Birds in HK

A Three.js bird flight simulator using official Hong Kong Buildings and Infrastructure from the Lands Department CSDI 3D Spatial Data API. A bounded LandsD basemap shows complete real streets over Terrarium elevation without satellite imagery.

## Run

1. Put `CSDI_3D_API_KEY=...` in `.env.local`.
2. Run `npm install`.
3. Run `npm run dev`.
4. Open `http://127.0.0.1:5173`.

The current machine is already configured locally. The API key remains server-side in the Vite development proxy and is excluded from Git and the browser bundle.

## Flow

`Boot -> Main menu -> World selection -> Loading -> Flight`

The first playable region streams official Tai Po CSDI Building and Infrastructure over 16 bounded elevation meshes textured by 64 zoom-15 LandsD basemap tiles. OpenStreetMap vector tiles remain non-rendered navigation data, so they cannot create cracked road surfaces. It enters flight only after the complete official ground, a camera-visible official building, and navigation data are ready. There is no procedural-building fallback.

The menu includes the production pigeon GLB plus low-poly black-kite and sparrow performance prototypes. They exercise different silhouettes and flight profiles before dedicated Blender or Meshy assets are approved.

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

`qa:assets` and `qa:csdi` expect a dev or preview server to be running. Set `BIRDS_IN_HK_URL` to verify a non-default URL. `qa:runtime` accepts only a fresh evidence-schema session that completes the official CSDI flow, renders a nonblank framebuffer, saves a valid PNG capture, enters flight, records FPS, proves real roads and water are rendered, and emits no errors.

## Bird Asset

The committed pigeon GLB and Blender source are reproducible on the configured workstation:

```powershell
npm run asset:pigeon
```

The game loads `public/models/pigeon.glb` and animates the `Wing.L` and `Wing.R` pivots. It falls back to the built-in bird only if the GLB cannot load.

## Data Sources

See `docs/data-sources.md`. API credentials remain in ignored `.env.local` and are injected only by the Vite server proxy.
