# Pipeline Verification - 2026-07-15

## Build Under Test

- Commit: `2a03e16`
- Runtime: Node.js 24.2.0, Vite 6.2.2, Three.js 0.170.0
- Production preview: `http://127.0.0.1:4173/`

## Passed Evidence

- `npm run check`: 6 test files, 16 tests passed
- `npm run build`: production build completed without warnings
- Production preview root: HTTP 200 and expected game title
- Lands Department aerial imagery PNG: HTTP 200, valid PNG
- Terrarium elevation PNG: HTTP 200, valid PNG
- Blender pigeon GLB: HTTP 200, valid binary glTF
- Basis JavaScript and WASM: HTTP 200, valid payloads
- CSDI building: root tileset HTTP 200 and B3DM HTTP 200 with `b3dm` magic
- CSDI infrastructure: root tileset HTTP 200 and B3DM HTTP 200 with `b3dm` magic
- Secret scan: zero API-key matches outside ignored local environment files
- Blender asset rebuild and Eevee preview render completed successfully

## Pending Runtime Evidence

The current build still requires a fresh browser run showing:

- `screen.boot -> screen.menu -> screen.loading -> screen.game`
- `render.frame` proving a nonblank WebGL framebuffer
- At least one `performance.sample`
- Zero `world.error` and zero `screen.error`
- Visual confirmation that aerial imagery, displaced terrain, the Blender pigeon, and the selected world source are visible

Older runtime sessions reached `screen.game`, but they predate commit `2a03e16` and do not satisfy this final gate.
