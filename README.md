# Birds in HK

A Three.js bird flight simulator using official Hong Kong Buildings and Infrastructure from the Lands Department CSDI 3D Spatial Data API. A bounded LandsD basemap shows complete real streets over Terrarium elevation without satellite imagery.

## Run

1. Put `CSDI_3D_API_KEY=...` in `.env.local`.
2. Run `npm install`.
3. Run `npm run dev`.
4. Open `http://127.0.0.1:5173`.

The current machine is already configured locally. The API key remains server-side in the Vite development proxy and is excluded from Git and the browser bundle.

## Deploy to Vercel

This repository includes `api/proxy.ts` and `vercel.json` so the official map services continue to work after deployment. The browser keeps requesting the same `/csdi-3d`, `/csdi-region`, `/landsd-map`, `/terrain-elevation`, and `/road-data` paths; Vercel rewrites them to the server-side function.

Set these Vercel environment variables before the first Preview deployment:

```text
CSDI_3D_API_KEY=server-only Lands Department key
VITE_GOOGLE_MAPS_API_KEY=optional browser-origin-restricted key
VITE_GOOGLE_MAP_ID=optional vector map ID
```

Never commit `.env.local` or copy `CSDI_3D_API_KEY` into a `VITE_` variable. Verify a deployed URL with `BIRDS_IN_HK_URL`:

```powershell
$env:BIRDS_IN_HK_URL = 'https://your-project.vercel.app'
npm run qa:assets
npm run qa:csdi
```

## Flow

`Boot -> Main menu -> World selection -> Loading -> Flight`

The first playable region streams official Tai Po CSDI Building and Infrastructure over 16 bounded elevation meshes textured by 64 zoom-15 LandsD basemap tiles. OpenStreetMap vector tiles remain non-rendered navigation data, so they cannot create cracked road surfaces. It enters flight only after the complete official ground, a camera-visible official building, and navigation data are ready. There is no procedural-building fallback.

The menu supports pigeon, dove, and eagle flight profiles. The app loads `pigeon.glb`, `dove.glb`, or `eagle.glb` from `public/models` according to the selected bird. A model without named wing pivots still renders safely; it simply keeps the profile's non-destructive idle animation.

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

## Art Studio

Open `/studio.html` while the Vite server is running to inspect the interactive Three.js art village. It groups the CFO/CEO roles, map and QA subagents, and model workshop around an open-field work surface. Select a character in the scene or role rail to inspect current work, this week's milestones, deliverables, and next steps.

The first render uses recorded project evidence. A small local state feed can update agent status without exposing prompts, logs, private memories, or credentials:

```powershell
npm run studio:state -- dou-dou working "驗證 dashboard" "Codex runtime"
```

See `docs/studio-roadmap.md` for the public state schema and Hermes bridge boundary.

## City Style Lab

Open `/city-style.html` to inspect 16 authenticated Free assets from Three.js Assets as a composed village-and-city scene. Buildings, environment pieces, and street furniture share consistent metre-based sizing, ground placement, shadows, and lighting; cloud, water, and fire elements add restrained motion. The page is a visual-language study only: official LandsD CSDI remains the sole building source in the flight world.

The locally downloaded GLBs are ignored by Git because the Free Commercial License permits use in a shipped website but prohibits redistributing the standalone asset files. After downloading them through your Three.js Assets account, verify their binary headers, declared lengths, and SHA-256 values with:

```powershell
npm run qa:city-assets
```

The complete source, licence, byte-size, SHA-256, category, and scene-use manifest is in `docs/threejs-assets.md`.

`qa:assets` and `qa:csdi` expect a dev or preview server to be running. Set `BIRDS_IN_HK_URL` to verify a non-default URL. `qa:runtime` accepts only a fresh evidence-schema session that completes the official CSDI flow, renders a nonblank framebuffer, saves a valid PNG capture, enters flight, records FPS, proves real roads and water are rendered, and emits no errors.

## Bird Asset

The committed pigeon GLB and Blender source are reproducible on the configured workstation:

```powershell
npm run asset:pigeon
```

The committed pigeon model has `Wing.L` and `Wing.R` pivots. The dove and eagle GLBs are now present in `public/models` and are loaded by their matching profiles. Their exact upstream source and licence still need confirmation; the current local provenance and SHA-256 values are recorded in `docs/data-sources.md`. The game falls back to the built-in bird only when the selected GLB is unavailable.

## Google Maps 3D Context

The optional `Google Maps 3D` control mounts the selected LandsD CSDI building and infrastructure layers inside Google Maps `WebGLOverlayView`. It stays hidden unless both values are set in `.env.local`:

```powershell
VITE_GOOGLE_MAPS_API_KEY=browser-origin-restricted-key
VITE_GOOGLE_MAP_ID=vector-map-id
```

Enable Maps JavaScript API for the project, restrict the browser key to the approved local and production origins, and configure the map ID for vector rendering with tilt and rotation. The CSDI credential remains server-only and is never added to the Google Maps request.

## Data Sources

See `docs/data-sources.md`. API credentials remain in ignored `.env.local` and are injected only by the Vite server proxy.
