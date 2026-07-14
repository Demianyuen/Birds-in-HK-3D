# Control Manifest

- Never expose the CSDI key to client code, source control, logs, or screenshots.
- Do not add OSM or procedural buildings as a production fallback.
- Keep gameplay units in metres and the ECEF conversion isolated in `geo.ts`.
- Register KTX2 support before the first B3DM tile can parse.
- Do not enter flight unless `evaluateWorldReadiness` returns ready.
- Check collision before applying displacement.
- Run `npm run check` and `npm run build` for every change.
- Record a successful vertical-slice playtest before calling the game playable.
