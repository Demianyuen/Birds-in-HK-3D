# Birds in HK — Game Concept

## Core Fantasy

Fly as a Hong Kong pigeon above recognisable aerial imagery at simulator scale, with buildings and trees acting as physical surfaces rather than scenery.

## Vertical Slice

The player completes `Boot → Main Menu → Loading → Flight`, sees the Tai Po skyline and all eight Wang Fuk Court towers, steers a bird, changes speed, flaps, and stops on contact with world geometry. CSDI remains a separately testable experimental world source.

## Pillars

1. **Recognisable Hong Kong** — Lands Department aerial imagery, Tai Po, and Wang Fuk Court anchor the flight range; CSDI supplies official 3D buildings.
2. **Readable Flight** — controls, camera, speed, and altitude remain understandable at all times.
3. **Physical City** — collision is checked before movement; buildings are not pass-through decoration.

## MVP Scope

- White pigeon placeholder with animated wings
- Lands Department aerial imagery centred on Tai Po and Wang Fuk Court
- Detailed eight-tower Wang Fuk Court collision landmark
- Optional CSDI Buildings 3D Tiles with KTX2 textures
- Third-person mouse and keyboard flight with HUD
- Swept building collision and perch/takeoff state
- Loading, failure, and retry flow

## Deferred

- Meshy GLB bird replacement
- Official vegetation data
- Infrastructure tiles, missions, audio, weather, mobile controls, and release deployment

## Acceptance Signals

- No API key input or key in the browser bundle
- No console errors during the successful vertical slice
- Local runtime gate reports collision meshes and a live WebGL context
- CSDI runtime gate separately reports a parsed model, visible tile, and live WebGL context
- Desktop target: 60 FPS at 1920×1080 after nearby tiles settle
