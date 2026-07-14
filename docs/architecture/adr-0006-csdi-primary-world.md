# ADR 0006: Make CSDI The Primary World

## Status

Accepted

## Context

ADR 0004 made the deterministic Tai Po range the default while the CSDI pipeline was unstable. The proxy, KTX2 support, WGS84 reorientation, aerial terrain, building and infrastructure endpoints, readiness metrics, and failure fallback now exist. Keeping the local approximation as the default would no longer satisfy the product goal of flying through official Hong Kong 3D data.

## Decision

Select the official CSDI world by default. Require parsed and camera-visible building geometry before entering flight. Keep the local Wang Fuk Court world as an explicit menu option and as the one-click recovery action on the CSDI error screen.

## Consequences

- Normal play exercises the API key and official map pipeline without exposing a credential field.
- CSDI runtime failure blocks the primary release verdict.
- Upstream outages remain recoverable without reloading the application.
