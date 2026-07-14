# Architecture

## Runtime Flow

```text
Browser UI state machine
  → BirdsInHkGame
    → AerialImageryGround → Terrarium elevation → game-rendered PBR terrain
    → CsdiTiles → regional same-origin proxy → LandsD CSDI Building + Infrastructure
      → BuildingMaterial → official KTX2 texture + facade PBR shading
    → BirdController → pre-movement raycasts → active world meshes
    → Three.js renderer → WebGL canvas
```

## Boundaries

- `src/main.ts`: DOM events and screen transitions only.
- `BirdsInHkGame`: scene lifecycle, camera, render loop, and readiness gate.
- `CsdiTiles`: official map streaming, KTX2 setup, tile metrics, and disposal.
- `AerialImageryGround`: bounded Terrarium elevation grid with slope- and height-driven game terrain materials.
- `BuildingMaterial`: preserves official CSDI textures and adds window, tone, roughness, and reflection rendering.
- `regions.ts`: verified coordinates and official root tiles for independent Hong Kong flight regions.
- `BirdController`: deterministic flight state and collision response.
- `geo.ts`: WGS84 ECEF to metre-based local frame.
- `vite.config.ts`: server-only key injection and CSDI proxy.

## Failure Policy

The CSDI world may enter flight only when terrain has loaded, WebGL is healthy, and at least one official building mesh is parsed and camera-visible. Individual tile failures are recoverable; a root or readiness failure returns to retry or region selection. No procedural building fallback exists. Keys and upstream credential URLs are not exposed in user-facing error text.

## Performance Budgets

| Metric | Vertical-slice budget |
|---|---:|
| Desktop frame time | ≤ 16.7 ms after tile settling |
| Initial playable load | ≤ 60 s on the development connection |
| Collision | Before movement, no tunnelling at maximum configured speed |
| Main-thread stalls | No task over 100 ms during normal flight |
