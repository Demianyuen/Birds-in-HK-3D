# Hong Kong Reference Mode: Free Flight Design

## Goal

Make the existing Tai Po Hong Kong Reference Mode a reliable, readable free-flight experience. A player should be able to enter the real-world scene, fly freely, see official Lands Department CSDI buildings and infrastructure, read the LandsD basemap over Terrarium terrain, and optionally compare the same location with Google Maps.

This is a stylized game experience with authoritative geographic reference data. It is not intended to reproduce Flight Simulator-level aerodynamics or visual fidelity.

## Scope

In scope:

- Preserve the current CSDI Cesium 3D Tiles path as the sole runtime source for official buildings and infrastructure.
- Preserve the current Terrarium elevation and LandsD basemap alignment.
- Improve free-flight controls, camera reset, speed/altitude feedback, and loading states.
- Add quality tiers for distant versus nearby CSDI content where supported by the current renderer.
- Keep Google Maps as an explicit comparison overlay, never as a replacement for the game world.
- Add runtime evidence for a complete, nonblank, flyable reference scene.

Out of scope:

- Replacing CSDI buildings with OSM, Sketchfab, or procedural buildings.
- Making BlenderGIS a browser or server runtime dependency.
- Rebuilding the world offline as GLB before a measured runtime bottleneck exists.
- Flight Simulator-grade aerodynamic simulation.
- Automatic Sketchfab downloads or unverified asset redistribution.

## Architecture

The existing Three.js runtime remains the primary scene owner:

```text
CSDI 3D Tiles -> official buildings/infrastructure
Terrarium     -> terrain height/collision
LandsD map    -> roads, water, land and labels
Google Maps   -> optional comparison overlay
Bird runtime  -> flight input, camera, collision and HUD
```

BlenderGIS is an offline preparation tool only. It may later prepare bounded DEM, GeoTIFF, OSM, or collision assets, but those exports must carry coordinate metadata and be validated against the runtime origin before use.

Luna receives compact, structured state and task summaries. It does not regenerate the scene or code every frame. Public state must exclude credentials, private memories, raw prompts, unrestricted logs, and model reasoning.

## Gameplay Contract

The first acceptance slice is free flight in the existing Tai Po region:

1. The player selects a supported bird and enters the reference mode.
2. Loading remains visible until the official ground, navigation data, and at least one camera-visible official building are ready.
3. The player can steer, gain or lose altitude, and change speed without requiring realistic aircraft controls.
4. A reset action returns the camera and bird to a known safe origin.
5. The HUD exposes current flight state without obscuring the scene.
6. The player can enable the Google Maps comparison layer when its browser-restricted configuration is present.
7. Incomplete or failed data produces an explicit state and actionable retry path; no fake building fallback is rendered.

## Performance and Quality

- Keep one renderer and one animation clock for the focal scene.
- Use the existing bounded region and tile budgets as the baseline.
- Apply DPR and quality caps on mobile, pause inactive/offscreen animation where practical, and reserve layout space for the canvas and HUD.
- Prefer renderer-supported LOD or visibility policies over duplicating geometry.
- Keep exact labels and state in DOM overlays; keep Three.js responsible for spatial content and motion.
- Provide reduced-motion behavior by pausing decorative animation while preserving direct flight and reset controls.

## Coordinate and Interaction Checks

- Validate that terrain, basemap, CSDI tiles, bird origin, and Google Maps overlay share the same WGS84 anchor and altitude convention.
- Keep reset, focus/orientation cues, and mobile touch behavior explicit.
- Do not capture wheel or pinch input without an alternate control path.
- Verify the comparison overlay resets shared WebGL state after drawing.

## Verification

The implementation must pass the existing project checks and add focused evidence for this slice:

- `npm run check`
- `npm run build`
- `npm run qa:assets`
- `npm run qa:csdi`
- `npm run qa:runtime`
- A fresh runtime capture proving a nonblank framebuffer, complete official ground, visible official building, real road/water layers, flight entry, and no console errors.
- Desktop and mobile screenshots proving no HUD/canvas overlap and no horizontal overflow.

## Acceptance Criteria

- The Tai Po reference scene enters flight only after its required official data is ready.
- Free flight is controllable and recoverable with reset on desktop and mobile.
- The scene remains visually legible at the supported quality tiers.
- Google Maps comparison is optional, origin-restricted, and does not receive the CSDI credential.
- No runtime path depends on BlenderGIS or unverified Sketchfab assets.
- All existing tests and fresh runtime evidence pass.

