# Data Sources

## Lands Department 3D Spatial Data API

- Runtime layers: `building`, `infrastructure`
- Format: Cesium 3D Tiles in WGS84
- Access: same-origin `/csdi-3d` proxy with server-side `CSDI_3D_API_KEY`
- Verification: `npm run qa:csdi`

The credential is never placed in HTML, browser JavaScript, runtime evidence, documentation, or Git.

## Lands Department Map API

- Runtime layer: `imagery/WGS84`
- Format: XYZ PNG tiles
- Coverage used by the vertical slice: 6 by 6 tiles at zoom 16 around Wang Fuk Court
- Access: same-origin `/hk-imagery` proxy

## Terrarium Elevation

- Service: public Mapzen/AWS elevation tiles
- Format: Terrarium RGB PNG
- Usage: zoom 13 height sampling for displacement and collision beneath the Lands Department imagery
- Access: same-origin `/terrain-elevation` proxy

Confirm final public-release attribution and redistribution requirements against the current upstream terms before deployment.

## Pigeon

- Source: project-generated Blender 5.1 model
- Editable source: `assets/blender/pigeon.blend`
- Runtime asset: `public/models/pigeon.glb`
- Generator: `tools/blender/build_pigeon.py`
- Visual QA: `production/playtests/pigeon-preview.png`
