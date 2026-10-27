# ADR-0013: LandsD aerial photo mesh as the default view, plus street life

Date: 2026-10-28
Status: Accepted

## Context

The stylised CSDI buildings read as plain blocks; the owner wants Tai Po to
look as real as a flight simulator, with traffic, people and boats.
The LandsD 3D Visualisation Map (`/api/3d-data/3dtiles/f2`) is a
photo-textured mesh made from oblique aerial images, covering the whole
territory. Around Wang Fuk Court it shows the eight blocks intact, without the
renovation scaffolding or fire damage, so it reflects the estate before the
fire (the capture year is not published).

## Decision

- The world view gains a third option, **航拍實景**, and it is the default.
  It streams the LandsD mesh through the keyed proxy route
  `/landsd-3dvis/*`, in the same reoriented frame as the CSDI layers.
- The mesh's KTX2 textures are referenced without `KHR_texture_basisu`;
  `ktx2ImageFix.ts` patches the glTF before parsing.
- Shown unlit (the photos hold the daylight). While it shows, the stylised
  ground, trees and CSDI models are hidden and the bird collides with the
  photo mesh. Until its first tiles arrive the stylised world stays visible.
- A cut-out shader lets hand-built hero models (Wang Fuk Court) replace the
  photo mesh locally.
- CSDI Cesium 3D Tiles remain the building source for the two stylised
  views. The photo mesh is also official LandsD data; no OSM or procedural
  buildings are added.
- Street life (`StreetLife.ts`): vehicles on OSM roads (driving on the
  left), people on footpaths and pavements near the bird, boats on open
  water, all instanced and kept near the bird. Generic vehicle colours only,
  no operator liveries or logos.
- A post-processing grade (`CinematicPost.ts`): soft bloom, warm light and
  cool shade, gentle vignette; bloom switches off on slow machines.

## Consequences

- Up close at street level the photo mesh is soft; the memorial ground will
  get a hand-built model.
- More bandwidth on first load of the photo view (KTX2 tiles, cached by the
  proxy for a day).
