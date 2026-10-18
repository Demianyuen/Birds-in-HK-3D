# ADR 0011: Vector Land-Use Mask For The Stylised Ground

## Status

Accepted (2026-10-18). Refines ADR 0010 (ground section) and ADR 0009.

## Context

ADR 0010 repainted the ground by classifying the LandsD street basemap colours
in the shader. Playtest screenshots showed the limits of using a cartographic
image as data: contour lines and their height labels ("100", "200"), dashed
trail symbols and text were painted onto the hills; 4 m basemap texels made
roads stair-stepped; and unclassified open land became large flat beige areas.
The fragment shader also took four extra texture taps to suppress one-texel
outlines, and was the main cost on integrated GPUs (the Claude desktop browser
pane runs on Intel UHD: 38 FPS at 1.25 pixel ratio, 60 FPS at half resolution).

The zoom-14 OpenMapTiles tiles already downloaded for navigation carry the same
information as clean geometry: woodland, grass, parks, pitches, sand, ocean,
rivers and streams, every road class, paths, railways and building footprints.

## Decision

- `src/game/LandUseMask.ts` rasterises each zoom-14 vector tile into a
  1024² RGBA mask with canvas anti-aliasing (R roads/paths by class, G woodland/
  grass/pitch, B water/sand, A built land). Real carriageway, path and stream
  widths are converted to pixels. One fetch per tile is shared with `RoadNetwork`.
- `StylizedGround.ts` gains a vector-mask path that paints each class with a
  stylised material (forest canopy, lawn, striped pitches, paving, asphalt with
  kerbs, trails, beaches, animated water). Hills without explicit cover still
  become forest. The water normal is computed only where water is present.
- The tile under the player is re-rasterised at 2048² from the cached vector
  tile (no network) for close-up detail.
- The LandsD basemap path remains, per tile, as the fallback when a vector
  tile cannot be built.
- Trees are placed from the same mask (woodland dense, parks sparse, estates
  almost bare) and thinned evenly to the budget instead of filling the first
  rows of the scan.
- `DynamicResolution` adapts the pixel ratio (0.65–1.5) to hold ~50+ FPS; the
  sun's shadow map refreshes every other frame and is snapped to shadow texels.

## Consequences

- No labels, contours or trail symbols on the ground; roads have smooth edges.
- The ground no longer depends on LandsD basemap delivery in normal play
  (faster load: 16 vector tiles instead of 64 PNG tiles), but does depend on
  OpenFreeMap; the LandsD path covers outages tile by tile.
- OSM attribution now also covers the ground ("Land cover & navigation").
- Land-cover accuracy follows OpenStreetMap; it is art direction, not survey.
- Mask encoding bands and shader thresholds live in two files and must change
  together (`tests/landUseMask.test.ts` guards the decode side).
