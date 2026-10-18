# QA evidence: stylised ground (ADR 0011)

Captured 2026-10-18 in the Claude desktop browser pane (Intel UHD, 1280×800
viewport) with `__birds.capture()` from the dev build, Tai Po region, live CSDI.

| File | What it shows |
| --- | --- |
| `before-basemap-classifier.jpg` | ADR 0010 shader classification of the LandsD basemap: contour labels, trail dashes and stair-stepped edges on the ground. |
| `after-vector-mask-wang-fuk.jpg` | Vector land-use mask: clean woodland, estate paving, pool, pitch; shopfront signage bands and contact shading on buildings. |
| `after-vector-mask-tolo-highway.jpg` | Road classes with kerbs, parks, Tolo Harbour water, low-poly clouds. |
| `after-vector-mask-country-park.jpg` | Hillside forest canopy, streams and trails (before trail/stream width reduction). |

Measured frame rate on the same GPU while flying: 44–60 FPS with dynamic
resolution settling at a 0.65–0.7 pixel ratio (previously 24–38 FPS).
Ground load: 16 of 16 surface tiles from vector masks in ~1.2 s, 0 LandsD
basemap tiles needed.
