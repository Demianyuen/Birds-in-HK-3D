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

No satellite or aerial imagery is used as the default terrain material. Terrarium supplies height and collision only.

## LandsD Map API

- Runtime layer: `basemap/WGS84`
- Usage: official roads, streets, water, land parcels, paths, and labels on the DEM terrain
- Resolution: zoom 15, composed as four 256-pixel tiles per zoom-14 terrain mesh
- Regional budget: 64 PNG tiles on 16 terrain meshes for Tai Po
- Access: same-origin `/landsd-map/basemap` proxy with server-side credential injection

The game rejects an incomplete basemap instead of exposing fallback road geometry. The optional LandsD `imagery` endpoint is verified but is not requested by the default world.

## OpenStreetMap Vector Data

- Delivery: OpenFreeMap vector-tile service and OpenMapTiles schema
- Runtime layers: `transportation`, `water`
- Usage: non-rendered navigation classification and future AI routing only
- Access: same-origin `/road-data` middleware with server-side TileJSON discovery and memory caching
- Attribution: OpenFreeMap, OpenMapTiles, and OpenStreetMap contributors

Motorway, primary, secondary, tertiary, minor, and service features are retained as data. Paths, tracks, railways, and tunnels are excluded. No OSM road or water mesh is added to the Three.js scene.

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
