# Pipeline Verification - 2026-07-15

## Build Under Test

- Build: bounded regional-world implementation recorded with this verification document
- Runtime: Node.js 24.2.0, Vite 6.2.2, Three.js 0.170.0
- Production preview: `http://127.0.0.1:4173/`

## Passed Evidence

- `npm run check`: 10 test files, 34 tests passed
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
- Sea-level DEM samples use game-rendered water; no aerial imagery is requested
- Bird return steering prevents flight beyond the terrain envelope
- BlenderGIS evaluated as an offline GIS asset tool, not a CSDI 3D Tiles runtime replacement

## Pending Runtime Evidence

The current schema 3 build still requires a fresh browser run showing:

- `screen.boot -> screen.menu -> screen.loading -> screen.game`
- `render.frame` proving a nonblank WebGL framebuffer
- At least one `performance.sample`
- Zero `world.error` and zero `screen.error`
- Visual confirmation that bounded terrain, rendered water, the Blender pigeon, and official buildings are visible without floating distant districts

Run `npm run qa:runtime` after the playtest. It rejects all older evidence records and fails unless the latest versioned session proves the official CSDI world, complete screen flow, nonblank framebuffer, valid PNG capture, flying state, FPS sample, and zero errors.

`npm run qa:runtime` currently reports that no schema 3 session exists. Older runtime sessions reached `screen.game`, but they predate regional clipping and do not satisfy this final gate.
