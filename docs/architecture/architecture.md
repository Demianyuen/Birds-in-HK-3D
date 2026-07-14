# Architecture

## Runtime Flow

```text
Browser UI state machine
  → BirdsInHkGame
    → AerialImageryGround → LandsD imagery + Terrarium elevation → realistic terrain
    → StylizedHongKong → Tai Po collision and near-field landmark detail
    → CsdiTiles → same-origin Vite proxy → LandsD CSDI (optional)
    → BirdController → pre-movement raycasts → active world meshes
    → Three.js renderer → WebGL canvas
```

## Boundaries

- `src/main.ts`: DOM events and screen transitions only.
- `BirdsInHkGame`: scene lifecycle, camera, render loop, and readiness gate.
- `CsdiTiles`: official map streaming, KTX2 setup, tile metrics, and disposal.
- `AerialImageryGround`: bounded, concurrency-limited Lands Department aerial imagery grid displaced by public Terrarium elevation around Wang Fuk Court.
- `StylizedHongKong`: deterministic Tai Po flight range, Wang Fuk Court landmark, terrain, buildings, trees, and collision root.
- `BirdController`: deterministic flight state and collision response.
- `geo.ts`: WGS84 ECEF to metre-based local frame.
- `vite.config.ts`: server-only key injection and CSDI proxy.

## Failure Policy

The default flight range may enter flight only when aerial imagery has loaded, its collision world exists, and WebGL is healthy. CSDI mode additionally requires a parsed mesh and camera-visible model. Root CSDI failure is fatal only to that optional mode; individual tile failures are recoverable. Keys and upstream URLs are not exposed in user-facing error text.

## Performance Budgets

| Metric | Vertical-slice budget |
|---|---:|
| Desktop frame time | ≤ 16.7 ms after tile settling |
| Initial playable load | ≤ 60 s on the development connection |
| Collision | Before movement, no tunnelling at maximum configured speed |
| Main-thread stalls | No task over 100 ms during normal flight |
