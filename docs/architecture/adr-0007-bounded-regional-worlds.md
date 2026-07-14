# ADR 0007: Bound Official Worlds By Flight Region

## Status

Accepted

## Context

A CSDI regional root can cover substantially more land than one playable flight session. Loading the whole root causes distant low-detail buildings to appear beyond available terrain, increases tile traversal and collision work, and makes missing terrain look like buildings floating over water.

## Decision

Treat each selectable Hong Kong district as an independent bounded world. Store a centre and flight radius with every region. Use the `3d-tiles-renderer` load-region plugin in ECEF space to stop traversal outside the region, and local clipping planes to hide coarse parent geometry that crosses the boundary. Build Terrarium DEM coverage only for the same radius plus a small edge buffer. Keep the bird inside the playable radius until an explicit neighbouring-region transition is implemented.

Tai Po is the first enabled world, centred on Wang Fuk Court with a 3.2 km radius. Other configured districts use the same contract but remain unavailable until individually verified.

## Consequences

- Official Lands Department buildings and infrastructure remain the sole built-world source.
- Distant geometry is neither refined nor rendered outside the active district.
- Terrain requests drop from a territory-sized grid to a regional grid of roughly 16 surface meshes in Tai Po.
- Roads and mapped water use the same regional tile envelope; no satellite imagery is requested.
- A future region transition must load the next district as a separate world rather than expanding one unbounded scene.
