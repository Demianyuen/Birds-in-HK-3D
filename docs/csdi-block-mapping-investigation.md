# CSDI block identity investigation

Local retrieval date: 2026-09-06 (Asia/Hong_Kong).
Access was through the existing local server-side CSDI proxy; no credential-bearing URLs were recorded.

## Bounded sample

Root: `/csdi-region/building/tai-po/tileset.json`.
The referenced district tileset is
`/csdi-3d/building/Data/F_Tile_+4_3_0/F_Tile_+4_3_0+R9_0.json`.
Its own B3DM and four child contents were inspected.

| Content suffix | Bytes | BATCH_LENGTH | Batch properties | glTF meshes |
| --- | ---: | ---: | --- | ---: |
| R9_0.b3dm | 1015568 | 0 | Empty | 4 |
| R8_0.b3dm | 861212 | 0 | Empty | 4 |
| R8_1.b3dm | 698268 | 0 | Empty | 4 |
| R8_2.b3dm | 404464 | 0 | Empty | 4 |
| R8_3.b3dm | 665564 | 0 | Empty | 4 |

All sampled primitives expose POSITION, NORMAL and TEXCOORD_0; no building
feature identifier was present in those attributes. Node labels were generated
MatrixTransform/PagedLOD/Group identifiers, not the Housing Authority block names.

The fourth child is a direct `.b3dm` URI, unlike the first three JSON children.
An initial guessed `.json` request returned 404; the actual advertised B3DM
returned valid data. This was a probe correction, not a missing-world finding.

## What this proves

These five district-level contents do not provide the eight block names or
per-building batch identity needed for an automatic name-to-mesh mapping.
It is incorrect to label their four meshes as four individual residential blocks.

## What this does not prove

- It does not prove every deeper CSDI level lacks metadata.
- It does not identify which sampled surface belongs to a specific Wang Fuk block.
- It does not establish original building dimensions, colours, dates or occupancy.
- Mesh/node names alone are not stable semantic building identifiers.

## Next evidence needed

Obtain a surveyed block footprint/site plan or another authoritative building
identifier dataset. Correlate the named block footprints with the same WGS84
frame and check the visible geometry before adding labels or reconstruction
overrides. Keep official geometry unchanged until this correspondence is verified.

Raw metadata-only probe reports were saved in local temporary files with the
prefix `birds-csdi-metadata-`; no source model was published or replaced.
