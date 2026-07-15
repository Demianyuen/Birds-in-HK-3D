# ADR 0009: Use The Official Basemap For Regional Ground

## Status

Accepted

## Context

OSM centre lines proved that real road data was available, but expanding every short segment into an independent Three.js ribbon produced cracks at bends, overlaps at junctions, and unstable elevation transitions. The LandsD 3D Spatial Data API provides only Building and Infrastructure; changing game engines would not add a missing road-surface tileset.

## Decision

Keep Three.js and the CSDI 3D Tiles pipeline. Texture each bounded zoom-14 DEM mesh with a 2 by 2 composition of official zoom-15 LandsD `basemap/WGS84` PNG tiles. Require all 64 Tai Po basemap tiles before flight. Keep OSM PBF data for navigation metrics and future AI, but render zero OSM surface meshes.

Use three bird performance profiles during this stage: the production pigeon GLB, a wide-wing black-kite prototype, and a small agile sparrow prototype. Dedicated species assets remain a later Blender or Meshy task.

## Consequences

- Roads and streets are continuous official cartography instead of generated geometry.
- Tai Po stays bounded to 16 terrain meshes and 64 basemap requests rather than loading Hong Kong at once.
- The default world remains non-satellite while an optional official imagery mode remains technically possible.
- Close-to-ground asphalt, kerbs, junction geometry, and road collision are not represented by the basemap; verified hero areas may add offline art later.
- Runtime schema 6 requires complete official ground and zero rendered vector-road meshes.
