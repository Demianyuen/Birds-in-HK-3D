# ADR 0008: Render Regional Vector Roads And Water

## Status

Superseded by ADR 0009

## Context

The Lands Department Building and Infrastructure 3D Tiles provide the authoritative built world but do not expose a complete semantic street network. Terrain colours alone cannot show real road alignment, and treating every low DEM sample as water creates false inland pools. Browser-width Three.js lines are also unsuitable because they remain one pixel wide and do not follow terrain reliably.

## Decision

Load bounded zoom-14 OpenStreetMap vector tiles through OpenFreeMap using same-origin Vite middleware. Discover the current tile template from TileJSON, cache successful PBF responses, and request only the active flight region plus its edge buffer.

Convert driveable `transportation` line features to metre-wide PBR ribbon meshes, subdivided to at most 24 metres per segment and sampled against the Terrarium DEM. Exclude paths, tracks, railways, and tunnels. Triangulate `water` polygons with holes; keep ocean at sea level and make inland water horizontal at its median boundary elevation.

Require a non-empty road network in the runtime readiness gate and evidence schema. Keep Lands Department CSDI as the sole building and infrastructure source.

## Consequences

- Tai Po contains real motorway, primary, secondary, tertiary, minor, and service alignments without satellite imagery.
- Road widths remain stable across browsers and camera distances.
- False water caused by low-elevation colour heuristics is removed.
- OpenFreeMap, OpenMapTiles, and OpenStreetMap attribution is required in the runtime interface and release documentation.
- The vector service is a required online dependency for initial region load until an approved offline cache is introduced.
