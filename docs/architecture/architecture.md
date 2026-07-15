# Architecture

## Runtime Flow

```text
Browser UI state machine
  → BirdsInHkGame
    → AerialImageryGround → Terrarium elevation + LandsD basemap → official regional ground
    → RoadNetwork → regional vector-tile proxy → non-rendered OSM navigation data
    → CsdiTiles → regional same-origin proxy → LandsD CSDI Building + Infrastructure
      → BuildingMaterial → official KTX2 texture + facade PBR shading
    → BirdController → pre-movement raycasts → active world meshes
    → Three.js renderer → WebGL canvas
```

## Boundaries

- `src/main.ts`: DOM events and screen transitions only.
- `BirdsInHkGame`: scene lifecycle, camera, render loop, and readiness gate.
- `CsdiTiles`: official map streaming, ECEF regional traversal mask, local render clipping, KTX2 setup, tile metrics, and disposal.
- `AerialImageryGround`: flight-region Terrarium elevation coverage with 64-segment tiles, multiscale land colouring, shader surface detail, collision, and world-height sampling.
- `RoadNetwork`: validates bounded navigation-road data while deliberately creating no visible surface meshes.
- `BuildingMaterial`: preserves official CSDI textures and adds window, tone, roughness, and reflection rendering.
- `regions.ts`: verified coordinates, radii, and official root tiles for independent Hong Kong flight regions.
- `BirdController`: deterministic flight state, collision response, and bounded-region return steering.
- `geo.ts`: WGS84 ECEF to metre-based local frame.
- `vite.config.ts`: server-only CSDI key injection, CSDI proxy, and cached OpenFreeMap vector-tile middleware.

## Failure Policy

The world may enter flight only when terrain has loaded, the regional road network contains real features, WebGL is healthy, and at least one official building mesh is parsed and camera-visible. A required layer or readiness failure returns to retry or region selection. No procedural building fallback exists. Keys and credential-bearing upstream URLs are not exposed in user-facing error text.

## Performance Budgets

| Metric | Vertical-slice budget |
|---|---:|
| Desktop frame time | ≤ 16.7 ms after tile settling |
| Initial playable load | ≤ 60 s on the development connection |
| Collision | Before movement, no tunnelling at maximum configured speed |
| Main-thread stalls | No task over 100 ms during normal flight |
