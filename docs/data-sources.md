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

## Dove and Eagle

- Runtime paths: `public/models/dove.glb`, `public/models/eagle.glb`
- Local provenance: imported from the existing `C:\Users\kin16\Bird-in-HK\models` checkout after GLB-header validation; this is a development provenance record, not an upstream licence assertion.
- SHA-256: `dove.glb` = `1D426EF48548669B97CFC1052D00F04BBC6F80183C0AD400EC406A93D1730686`; `eagle.glb` = `7B08841A6BFB90C6DF4AF54A42D193A9C70C3BD1377FE3BA703AFD6655F0F4EA`.
- Runtime note: the loader accepts models without named wing pivots, so these assets render with the profile's safe idle animation until their rig metadata is confirmed.
- Required before release: confirm the exact upstream URL, licence, author attribution, and any animation limitations.

## Google Maps Interoperability

- The in-game 3D model remains the LandsD CSDI WGS84 tileset; it is not replaced by Google building data.
- `src/integrations/GoogleMapsCsdiOverlay.ts` mounts the same official CSDI building and infrastructure layers in a Google Maps `WebGLOverlayView`, anchored at the selected flight region's WGS84 latitude, longitude, and altitude origin.
- Enable it only with a browser-origin-restricted Google Maps JavaScript API key and a vector map ID in `VITE_GOOGLE_MAPS_API_KEY` and `VITE_GOOGLE_MAP_ID`. The supplied configuration provides project identifiers only, so the integration stays hidden until both settings exist.
- Never send the CSDI credential to Google Maps. The overlay requests CSDI only through this project's same-origin server proxy, then resets the shared WebGL state after every draw.

## Three.js Assets City Style Study

The separate `/city-style.html` scene loads 16 authenticated Free GLBs as a composed village-and-city study. They do not replace or supplement LandsD CSDI buildings in the flight world.

See [Three.js Assets Free Collection](threejs-assets.md) for every official asset URL, category, local runtime path, intended use, byte size, SHA-256, and the Free Commercial License restrictions. The standalone GLBs are ignored by Git and `npm run qa:city-assets` verifies the complete local collection.

## BlenderGIS Evaluation

- Status: evaluated, not installed as a runtime dependency
- Suitable uses: offline DEM, GeoTIFF, Shapefile, and OSM asset preparation in Blender
- Not suitable for: consuming or streaming the CSDI Cesium 3D Tiles API

The official Hong Kong world therefore stays in the Three.js `3d-tiles-renderer` pipeline. BlenderGIS may be introduced later only for bounded offline art or simplified collision assets, with georeferencing and licensing verified separately.
