# ADR-0002: Local East-Up-South Frame

## Status

Accepted — 2026-07-14

## Decision

CSDI ECEF coordinates are transformed once at the tileset group into a metre-based east-up-south frame centred on Central, Hong Kong.

## Rationale

Gameplay and collision at Earth-scale coordinates lose floating-point precision. East-up-south preserves Three.js handedness while keeping the player near the origin.

## Validation

Unit tests prove the selected WGS84 origin maps to local zero and a one-metre altitude change maps to local up.
