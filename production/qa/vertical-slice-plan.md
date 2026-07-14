# Vertical Slice QA Plan

## Status

Pending playtest evidence

## Required Test

1. Open a fresh browser session at the local game URL.
2. Confirm no API-key input is present.
3. Select `Continue`, keep `Official 3D Hong Kong` selected, then select `Start flight`.
4. Confirm loading reports official aerial-imagery progress, CSDI models, and the visible-world readiness check.
5. Confirm the game HUD appears only after the readiness gate passes.
6. Confirm real Tai Po aerial imagery and official textured 3D buildings are visible and the canvas is not blank.
7. Confirm mouse/WASD steering, wheel/Shift speed control, and Space flap work.
8. Fly into a loaded building at maximum speed; confirm the bird stops without tunnelling.
9. Press Space while perched; confirm takeoff.
10. Reload and repeat once to verify cleanup and deterministic restart.

## Local Fallback Check

1. Reload, select `Tai Po flight range`, and start flight.
2. Confirm the game reaches flight without requesting CSDI tiles.
3. Confirm eight Wang Fuk Court towers are visible and collidable.
4. From a CSDI error screen, confirm `Use aerial flight` enters this fallback without reloading.

Failure of the CSDI primary slice blocks release. The fallback check proves that a temporary upstream outage does not make the game unusable.

## Evidence Required

- Console log with zero uncaught errors
- Network evidence for imagery PNG, elevation PNG, pigeon GLB, and CSDI-mode tileset, B3DM, Basis JS, and Basis WASM
- Desktop screenshot of loading and gameplay
- FPS, frame-time, and memory snapshot after 60 seconds of flight
- Tester, date, browser version, observed defects, and verdict
- `npm run qa:report` output showing `Reached game: YES`, `Rendered frame: YES`, FPS samples, and zero runtime errors

## Pass Rule

All ten core steps pass, the CSDI integration check has its own verdict, and evidence is saved in `production/playtests/`. Until then the project remains a technical prototype.
