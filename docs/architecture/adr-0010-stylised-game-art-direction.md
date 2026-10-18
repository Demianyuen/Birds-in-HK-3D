# ADR 0010: Stylised Game Art Direction Over Official Geometry

## Status

Accepted (2026-10-18). Ground section refined by ADR 0011 (vector land-use mask).

## Context

Playtesting showed the world read as a paper map, not a game. The LandsD street
basemap was draped directly on the terrain (beige hills, pale-blue sea, yellow
roads), and CSDI buildings rendered as dark grey boxes from their low-resolution
source textures. A photorealistic source (Google Photorealistic 3D Tiles) was
considered and rejected by the product owner in favour of a stylised look,
which also avoids a paid, attribution-bound tile service and keeps multiplayer
frame rates predictable.

## Decision

Keep official data as the *shape* of the world and repaint its *appearance*:

- **Ground** (`src/game/StylizedGround.ts`): the basemap is used as a land-use
  mask. A shader classifies each texel (sea, green space, major road, minor road,
  building footprint, civic land, open land) and paints a stylised material per
  class. Open land on hillsides (by elevation and slope) becomes forest so
  country parks read green. Sea gets animated wave normals, low roughness and
  sky reflections.
- **Buildings** (`src/game/BuildingMaterial.ts`, preservation/art-preview mode):
  CSDI geometry is unchanged; colour comes from a Hong Kong residential pastel
  palette chosen per 42 m world cell, with procedural windows, sills and glass
  reflection, distance-faded to avoid moiré, and concrete roofs. The
  "reference" mode still shows CSDI source materials.
- **Lighting**: a PMREM environment generated from the same `Sky` used for the
  background; the directional sun follows the player and matches the sky's sun
  direction.
- **Trees** (`src/game/StylizedTrees.ts`): instanced low-poly trees placed from
  the same land-use classes and terrain. Scenery only — not part of collision.

## Consequences

- No new external services or credentials.
- Building colours are art, not historical record; the preservation note in
  the HUD continues to say so.
- Land-use classification depends on the LandsD basemap palette. If LandsD
  changes its style, the thresholds in `StylizedGround.ts` and
  `classifyBasemapColour` must be updated together.
- Trees are non-colliding, so the bird can pass through canopies.
