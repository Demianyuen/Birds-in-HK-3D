# ADR 0004: Separate Core Flight From CSDI Availability

## Status

Superseded by ADR 0006; removed from production on 2026-07-15

## Context

The CSDI API delivers genuine Hong Kong geometry as streamed 3D Tiles, but browser CORS, network latency, individual tile availability, and texture transcoding can fail independently of the flight simulation.

## Decision

Ship a deterministic stylized Tai Po flight range as the default world source. Keep official CSDI buildings as a selectable integration mode behind the same `BirdsInHkGame` interface. Both sources provide an `Object3D` collision root to `BirdController`.

## Consequences

- The game can always demonstrate flight, collision, and perching without external services.
- CSDI remains the authoritative real-map source and keeps its stricter parsed-mesh and visible-tile readiness gate.
- Core gameplay QA and official-data integration QA have separate verdicts.

## Removal Note

The stylized Tai Po source and procedural Wang Fuk Court geometry were deleted after the official regional CSDI tileset passed rendering, visibility, collision, perching, and takeoff verification. This ADR remains as historical context only.
