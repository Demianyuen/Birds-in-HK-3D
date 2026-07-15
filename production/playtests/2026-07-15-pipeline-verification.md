# Pipeline Verification - 2026-07-15

## Build Under Test

- Build: bounded regional-world implementation recorded with this verification document
- Runtime: Node.js 24.2.0, Vite 6.2.2, Three.js 0.170.0
- Production preview: `http://127.0.0.1:4173/`

## Passed Evidence

- `npm run check`: 13 test files, 49 tests passed
- `npm run build`: production build completed without warnings
- Production preview root: HTTP 200 and expected game title
- Terrarium elevation PNG: HTTP 200, valid PNG
- LandsD official basemap PNG: HTTP 200, valid PNG
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
- Official zoom-15 basemap is bounded to 64 PNG tiles composed over 16 terrain meshes
- OSM road data remains available for navigation with zero rendered vector surface meshes
- Pigeon, black-kite prototype, and sparrow prototype complete isolated browser flight sessions
- Bird return steering prevents flight beyond the terrain envelope
- BlenderGIS evaluated as an offline GIS asset tool, not a CSDI 3D Tiles runtime replacement
- Entry-document tests require every Boot, Menu, Loading, Error, and Game control and reject credential inputs, mojibake, or broken closing tags
- The browser interface contains no API-key field; `.env.local` is loaded only by the Vite server and remains ignored by Git

## Passed Runtime Evidence

Fresh schema 6 session `4288de9f-dac8-4c1a-bbf2-a636cdc7e98e` passed `npm run qa:runtime`:

- Flow: `screen.boot -> screen.menu -> screen.loading -> screen.game`
- World: official `csdi / tai-po`
- WebGL framebuffer: `1440 x 900`
- Bird profile: `pigeon`
- Official textured building materials: `116`
- Official ground: `64/64` basemap tiles on `16/16` textured terrain meshes
- Navigation roads: `2,327` features and `20,666` source segments on `16` regional tiles
- Rendered OSM road/water meshes: `0`
- FPS samples: `21`, `20`
- Flight state: `FLYING`
- Runtime errors: `0`
- Credential inputs in the browser: `0`
- Browser console errors, page errors, failed requests, and HTTP error responses: `0`
- Captured game frame: `runtime-evidence/frames/4288de9f-dac8-4c1a-bbf2-a636cdc7e98e.png`
- Staged browser captures: `runtime-evidence/browser-smoke/pigeon/01-boot.png` through `04-game.png`

The captured frame was visually inspected and contains continuous LandsD streets on the real elevation surface, the pigeon, and official buildings. No generated black road ribbons, junction overlaps, or vector-water wedges remain. Black-kite and sparrow prototype runs also held 20 FPS with zero browser errors. The validator rejects older schemas and requires the complete official basemap, an approved bird profile, zero rendered vector surfaces, official textured buildings, flight, FPS, and a valid framebuffer capture.
