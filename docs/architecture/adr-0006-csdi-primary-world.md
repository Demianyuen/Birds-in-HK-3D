# ADR 0006: Make CSDI The Primary World

## Status

Accepted

## Context

ADR 0004 made the deterministic Tai Po range the default while the CSDI pipeline was unstable. The proxy, KTX2 support, WGS84 reorientation, elevation terrain, building and infrastructure endpoints, and readiness metrics now exist. Keeping the local approximation would no longer satisfy the product goal of flying through official Hong Kong 3D data.

## Decision

Select an official regional CSDI world by default. Require parsed and camera-visible building geometry before entering flight. Do not provide a procedural-building fallback.

## Consequences

- Normal play exercises the API key and official map pipeline without exposing a credential field.
- CSDI runtime failure blocks the primary release verdict.
- Upstream outages can be retried or return to region selection without reloading the application.
