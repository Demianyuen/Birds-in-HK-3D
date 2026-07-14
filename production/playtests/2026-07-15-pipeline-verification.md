# Pipeline Verification - 2026-07-15

## Build Under Test

- Build: bounded regional-world implementation recorded with this verification document
- Runtime: Node.js 24.2.0, Vite 6.2.2, Three.js 0.170.0
- Production preview: `http://127.0.0.1:4173/`

## Passed Evidence

- `npm run check`: 12 test files, 44 tests passed
- `npm run build`: production build completed without warnings
- Production preview root: HTTP 200 and expected game title
- Terrarium elevation PNG: HTTP 200, valid PNG
- Blender pigeon GLB: HTTP 200, valid binary glTF
- Basis JavaScript and WASM: HTTP 200, valid payloads
- CSDI building: root tileset HTTP 200 and B3DM HTTP 200 with `b3dm` magic
- CSDI infrastructure: root tileset HTTP 200 and B3DM HTTP 200 with `b3dm` magic
- Secret scan: zero API-key matches outside ignored local environment files
- Blender asset rebuild and Eevee preview render completed successfully
- Maximum-speed collision stops before movement; perching and flap-to-takeoff are covered by focused tests
- CSDI model tracking releases unloaded tile scenes during long-distance streaming
- Tai Po is bounded to a 3.2 km flight radius with ECEF traversal masking and local render clipping
- Tai Po terrain is region-sized rather than territory-sized, with a small edge buffer
- Terrain tiles use 64 by 64 segments with multiscale game-rendered grass, soil, and rock detail
- Real road and mapped-water vector tiles are bounded to the Tai Po world; no aerial imagery is requested
- Bird return steering prevents flight beyond the terrain envelope
- BlenderGIS evaluated as an offline GIS asset tool, not a CSDI 3D Tiles runtime replacement
- Entry-document tests require every Boot, Menu, Loading, Error, and Game control and reject credential inputs, mojibake, or broken closing tags
- The browser interface contains no API-key field; `.env.local` is loaded only by the Vite server and remains ignored by Git

## Passed Runtime Evidence

Fresh schema 5 session `8dd5f726-59d6-447d-b875-c6733be48e10` passed `npm run qa:runtime`:

- Flow: `screen.boot -> screen.menu -> screen.loading -> screen.game`
- World: official `csdi / tai-po`
- WebGL framebuffer: `1440 x 900`
- Official textured building materials: `187`
- Real roads: `2,327` features, `30,214` terrain-following segments, `16` regional tiles
- Mapped water: `525` features, `5,731` triangles
- FPS samples: `21`, `20`
- Flight state: `FLYING`
- Runtime errors: `0`
- Credential inputs in the browser: `0`
- Browser console errors, page errors, failed requests, and HTTP error responses: `0`
- Captured game frame: `runtime-evidence/frames/8dd5f726-59d6-447d-b875-c6733be48e10.png`
- Staged browser captures: `runtime-evidence/browser-smoke/01-boot.png` through `04-game.png`

The captured game frame was visually inspected and contains smoother game-rendered Tai Po terrain, mapped horizontal water, terrain-following real roads, the pigeon, and official buildings. The full-page game capture also contains the HUD, controls, and required map attribution. The validator rejects older evidence schemas and fails unless the latest session proves the official CSDI world, complete screen flow, nonblank framebuffer, valid PNG capture, flying state, FPS, textured official materials, non-empty roads and water, and zero runtime errors.
