# Data Sources

## Lands Department 3D Spatial Data API

- Runtime layers: `building`, `infrastructure`
- Format: Cesium 3D Tiles in WGS84
- Access: same-origin `/csdi-3d` proxy with server-side `CSDI_3D_API_KEY`
- Verification: `npm run qa:csdi`

The credential is never placed in HTML, browser JavaScript, runtime evidence, documentation, or Git.

## Terrarium Elevation

- Service: public Mapzen/AWS elevation tiles
- Format: Terrarium RGB PNG
- Usage: zoom 13 height sampling for displacement, road placement, and terrain collision
- Access: same-origin `/terrain-elevation` proxy

No satellite or aerial imagery is used as the terrain material. The elevation mesh is rendered with game-generated PBR grass, soil, and rock colours derived from height, slope, and deterministic detail noise.

## OpenStreetMap Vector Data

- Delivery: OpenFreeMap vector-tile service and OpenMapTiles schema
- Runtime layers: `transportation`, `water`
- Usage: driveable road ribbons and mapped water polygons only
- Access: same-origin `/road-data` middleware with server-side TileJSON discovery and memory caching
- Attribution: OpenFreeMap, OpenMapTiles, and OpenStreetMap contributors

The road renderer accepts motorway, primary, secondary, tertiary, minor, and service line features. Paths, tracks, railways, and tunnels are excluded. Roads are subdivided and sampled against the Terrarium DEM so their mesh follows local terrain. Water uses mapped polygon boundaries; ocean polygons remain at sea level and inland polygons use a robust local DEM height.

OpenStreetMap data is not a building fallback. Lands Department CSDI remains the sole source for buildings and infrastructure. Confirm the current OpenFreeMap, OpenMapTiles, and OpenStreetMap attribution and redistribution terms before public deployment.

Confirm final Terrarium public-release attribution and redistribution requirements against the current upstream terms before deployment.

## Pigeon

- Source: project-generated Blender 5.1 model
- Editable source: `assets/blender/pigeon.blend`
- Runtime asset: `public/models/pigeon.glb`
- Generator: `tools/blender/build_pigeon.py`
- Visual QA: `production/playtests/pigeon-preview.png`

## BlenderGIS Evaluation

- Status: evaluated, not installed as a runtime dependency
- Suitable uses: offline DEM, GeoTIFF, Shapefile, and OSM asset preparation in Blender
- Not suitable for: consuming or streaming the CSDI Cesium 3D Tiles API

The official Hong Kong world therefore stays in the Three.js `3d-tiles-renderer` pipeline. BlenderGIS may be introduced later only for bounded offline art or simplified collision assets, with georeferencing and licensing verified separately.
