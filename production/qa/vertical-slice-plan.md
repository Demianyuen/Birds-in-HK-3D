# Vertical Slice QA Plan

## Status

Pending playtest evidence

## Required Test

1. Open a fresh browser session at the local game URL.
2. Confirm no API-key input is present.
3. Select `Continue`, keep the official Tai Po region selected, then select `Start flight`.
4. Confirm loading reports elevation-terrain progress, CSDI models, and the visible-world readiness check.
5. Confirm the game HUD appears only after the readiness gate passes.
6. Confirm game-rendered Tai Po terrain and official textured 3D buildings are visible and the canvas is not blank.
7. Confirm no distant official building geometry appears outside the bounded Tai Po terrain.
8. Confirm sea-level DEM areas render as water and no aerial-imagery requests occur.
9. Confirm mouse/WASD steering, wheel/Shift speed control, and Space flap work.
10. Fly into a loaded building at maximum speed; confirm the bird stops without tunnelling.
11. Press Space while perched; confirm takeoff.
12. Fly toward the regional edge; confirm the bird turns back before leaving terrain coverage.
13. Reload and repeat once to verify cleanup and deterministic restart.

## Failure Check

1. Confirm a CSDI root or readiness failure stays on the error screen.
2. Confirm retry does not skip loading.
3. Confirm returning to region selection never loads procedural buildings.

Failure of the official CSDI slice blocks release. There is no procedural-building fallback.

## Evidence Required

- Console log with zero uncaught errors
- Network evidence for elevation PNG, pigeon GLB, regional tileset, B3DM, Basis JS, and Basis WASM
- Desktop screenshot of loading and gameplay
- FPS, frame-time, and memory snapshot after 60 seconds of flight
- Tester, date, browser version, observed defects, and verdict
- `npm run qa:report` output showing `Reached game: YES`, `Rendered frame: YES`, FPS samples, and zero runtime errors

## Pass Rule

All thirteen core steps pass, the CSDI integration check has its own verdict, and evidence is saved in `production/playtests/`. Until then the project remains a technical prototype.
