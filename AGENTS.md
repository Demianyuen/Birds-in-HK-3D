# Birds in HK 3D

- This is a Vite, TypeScript, Three.js, and WebGL game.
- Never print, commit, screenshot, or hardcode the CSDI API key. It belongs in `.env.local` only.
- CSDI WGS84 Cesium 3D Tiles are the building source for the stylised views; the LandsD 3D Visualisation Map photo mesh is the aerial-photo view (ADR-0013). Do not add OSM or procedural-building fallbacks.
- Gameplay units are metres in a local east-up-south frame centred on Hong Kong.
- Perform collision checks before applying movement.
- Run `npm run check` and `npm run build` before handing off changes.
