# ADR 0005: Use Official Aerial Imagery For Simulator-Scale Ground

## Status

Accepted

## Context

The Lands Department 3D Spatial Data API exposes `building` and `infrastructure` 3D Tiles, but it does not provide textured terrain or a photogrammetry mesh. Building geometry over a flat procedural ground cannot meet the aerial flight-simulator visual target.

## Decision

Use the Lands Department Map API `imagery/WGS84` XYZ service as the ground imagery. Stream a bounded 6 by 6 tile grid at zoom 16 around Wang Fuk Court through a same-origin Vite proxy. Decode public AWS/Mapzen Terrarium RGB elevation tiles at zoom 13 and displace the imagery mesh. Overlay CSDI building geometry and local collision detail in the same WGS84-derived east-up-south coordinate frame.

## Consequences

- High-altitude views show real Tai Po roads, water, vegetation, and urban texture.
- The imagery grid remains bounded to control memory and network usage.
- Terrain height is sampled at roughly 17 metre spacing and participates in bird collision.
- Blender is reserved for bird and near-field prop assets, not whole-territory map conversion.
