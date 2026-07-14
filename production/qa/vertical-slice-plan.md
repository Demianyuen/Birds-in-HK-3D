# Vertical Slice QA Plan

## Status

Pending playtest evidence

## Required Test

1. Open a fresh browser session at the local game URL.
2. Confirm no API-key input is present.
3. Select `Continue`, keep `Tai Po flight range` selected, then select `Start flight`.
4. Confirm loading reports official aerial-imagery progress and the local collision-world readiness check.
5. Confirm the game HUD appears only after the readiness gate passes.
6. Confirm real Tai Po aerial imagery, the skyline, and eight Wang Fuk Court towers are visible and the canvas is not blank.
7. Confirm mouse/WASD steering, wheel/Shift speed control, and Space flap work.
8. Fly into a loaded building at maximum speed; confirm the bird stops without tunnelling.
9. Press Space while perched; confirm takeoff.
10. Reload and repeat once to verify cleanup and deterministic restart.

## Official CSDI Integration Check

1. Reload, select `Official 3D Hong Kong`, and start flight.
2. Confirm the root tileset, one nested tileset or B3DM, Basis JS, and Basis WASM return HTTP 200.
3. Confirm loading reports a parsed model and camera-visible tile before gameplay.
4. Confirm an official textured building is visible and collidable.

Failure of this integration check blocks the official world source, but does not invalidate the self-contained flight vertical slice.

## Evidence Required

- Console log with zero uncaught errors
- Network evidence for imagery PNG, elevation PNG, pigeon GLB, and CSDI-mode tileset, B3DM, Basis JS, and Basis WASM
- Desktop screenshot of loading and gameplay
- FPS, frame-time, and memory snapshot after 60 seconds of flight
- Tester, date, browser version, observed defects, and verdict
- `npm run qa:report` output showing `screen.game` and zero runtime errors

## Pass Rule

All ten core steps pass, the CSDI integration check has its own verdict, and evidence is saved in `production/playtests/`. Until then the project remains a technical prototype.
