# ADR-0003: KTX2 Tile Texture Pipeline

## Status

Accepted — 2026-07-14

## Decision

Register `GLTFExtensionsPlugin` with a renderer-detected `KTX2Loader`. Serve the pinned Three.js Basis transcoder from `/basis/`, copied during `postinstall`.

## Rationale

CSDI B3DM payloads contain KTX2 textures. Without the loader every model download succeeds but GLTF parsing fails.

## Validation

- Basis JavaScript and WASM return 200.
- A successful vertical slice must show textured building meshes with no KTX2 errors.
