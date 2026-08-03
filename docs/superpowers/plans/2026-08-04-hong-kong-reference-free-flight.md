# Hong Kong Reference Free Flight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing Tai Po CSDI reference scene into a reliable, readable free-flight experience with explicit readiness, recoverable controls, quality limits, and verified Google Maps comparison.

**Architecture:** Keep `BirdsInHkGame` as the single Three.js scene owner and keep LandsD CSDI as the only official runtime building source. Put input/readiness/quality decisions behind small typed methods, expose only telemetry and sanitized runtime evidence to the DOM/Luna bridge, and leave BlenderGIS as an offline tool.

**Tech Stack:** TypeScript, Three.js 0.170, `3d-tiles-renderer`, Vite, Vitest, Playwright/runtime evidence scripts.

---

## File Map

- Modify `src/game/BirdsInHkGame.ts`: renderer quality policy, camera reset, readiness telemetry, and safe runtime state.
- Modify `src/game/BirdController.ts`: public reset semantics and bounded free-flight behavior tests.
- Modify `src/main.ts`: reset/focus input, mobile-friendly controls, and sanitized evidence events.
- Modify `index.html` and `src/styles.css`: visible reset control, compact flight status, and responsive layout.
- Modify `src/integrations/GoogleMapsCsdiOverlay.ts`: explicit overlay lifecycle/error state only if verification finds a gap.
- Add focused tests under `tests/` for reset, quality policy, and DOM control contracts.
- Update `scripts/verify-runtime-session.mjs` only when new evidence events are introduced.
- Update `README.md` only for user-facing controls or verification commands that change.

### Task 1: Lock the current free-flight contract with tests

**Files:**
- Create: `tests/freeFlightContract.test.ts`
- Modify: `src/game/BirdController.ts` only if a test exposes a missing public contract.

- [ ] **Step 1: Add failing controller tests**

```ts
import { describe, expect, it } from 'vitest';
import { BirdController } from '../src/game/BirdController';

describe('reference free-flight contract', () => {
  it('resets to the known Tai Po launch pose and clears held controls', () => {
    const bird = new BirdController();
    bird.setEnabled(true);
    bird.setControl('accelerate', true);
    bird.reset();
    expect(bird.object.position.toArray()).toEqual([0, 220, 320]);
    expect(bird.getTelemetry().state).toBe('FLYING');
    bird.update(0.1, null);
    expect(bird.getTelemetry().speedKmh).toBeGreaterThan(0);
  });

  it('keeps the bird inside the configured bounded region', () => {
    const bird = new BirdController();
    bird.setFlightRadius(100);
    bird.setEnabled(true);
    bird.setControl('accelerate', true);
    for (let i = 0; i < 200; i += 1) bird.update(0.1, null);
    expect(Math.hypot(bird.object.position.x, bird.object.position.z)).toBeLessThanOrEqual(100.001);
  });
});
```

- [ ] **Step 2: Run the focused test and verify the baseline**

Run: `npm exec vitest run tests/freeFlightContract.test.ts`

Expected: the reset test passes against the current controller; the boundary test identifies any missing deterministic bound behavior before further changes.

- [ ] **Step 3: Implement only the missing controller behavior**

Keep `reset()` clearing every control flag and preserve the existing launch pose. Do not add aerodynamic simulation or new dependencies.

- [ ] **Step 4: Re-run the focused test**

Run: `npm exec vitest run tests/freeFlightContract.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the contract test**

```powershell
git add tests/freeFlightContract.test.ts src/game/BirdController.ts
git commit -m "test: lock reference free flight contract"
```

### Task 2: Add an explicit renderer quality policy

**Files:**
- Create: `src/game/renderQuality.ts`
- Create: `tests/renderQuality.test.ts`
- Modify: `src/game/BirdsInHkGame.ts:65-82, 215-220`

- [ ] **Step 1: Add the failing quality-policy test**

```ts
import { describe, expect, it } from 'vitest';
import { renderQualityFor } from '../src/game/renderQuality';

describe('render quality policy', () => {
  it('caps mobile DPR below desktop and reduces shadow size', () => {
    expect(renderQualityFor({ mobile: true, devicePixelRatio: 3 })).toEqual({
      pixelRatio: 1.35,
      shadowMapSize: 1024,
    });
  });

  it('keeps a higher but bounded desktop quality', () => {
    expect(renderQualityFor({ mobile: false, devicePixelRatio: 3 })).toEqual({
      pixelRatio: 2,
      shadowMapSize: 2048,
    });
  });
});
```

- [ ] **Step 2: Run the test and confirm the missing module failure**

Run: `npm exec vitest run tests/renderQuality.test.ts`

Expected: FAIL because `src/game/renderQuality.ts` does not yet exist.

- [ ] **Step 3: Implement the pure policy function**

Create `renderQualityFor({ mobile, devicePixelRatio })` returning `{ pixelRatio, shadowMapSize }`. Clamp desktop to `Math.min(devicePixelRatio, 2)`, mobile to `Math.min(devicePixelRatio, 1.35)`, and use `1024` mobile/`2048` desktop shadows.

- [ ] **Step 4: Apply the policy in the game constructor and resize path**

Use the same selected policy for `renderer.setPixelRatio`, shadow map size, and resize handling. Do not create a second renderer or fallback scene.

- [ ] **Step 5: Run focused and type tests**

Run: `npm exec vitest run tests/renderQuality.test.ts tests/freeFlightContract.test.ts` and `npm run check`

Expected: PASS.

- [ ] **Step 6: Commit the quality policy**

```powershell
git add src/game/renderQuality.ts src/game/BirdsInHkGame.ts tests/renderQuality.test.ts
git commit -m "perf: add bounded reference scene quality policy"
```

### Task 3: Make reset and touch-safe flight controls explicit

**Files:**
- Modify: `index.html`: add a button with id `flight-reset` in the game HUD.
- Modify: `src/main.ts`: wire reset and a pointer/touch-safe control path.
- Modify: `src/styles.css`: reserve HUD space and prevent mobile overlap.
- Create: `tests/flightHud.test.ts`

- [ ] **Step 1: Add the failing DOM contract test**

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('flight HUD contract', () => {
  it('contains reset control and state values', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(html).toMatch(/id="flight-reset"/);
    expect(html).toMatch(/id="altitude-value"/);
    expect(html).toMatch(/id="speed-value"/);
    expect(html).toMatch(/id="heading-value"/);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm exec vitest run tests/flightHud.test.ts`

Expected: FAIL because `#flight-reset` is absent.

- [ ] **Step 3: Add the reset button and handler**

Add an icon-plus-label button with `aria-label="Reset flight view"`. In `src/main.ts`, require it and call a new `game.resetFlightView()` method that resets the bird and camera to the known launch pose without reloading network data. Report only `flight.reset` with region and bird profile.

- [ ] **Step 4: Add touch-safe input behavior**

Keep keyboard and pointer-lock controls. Add a pointerdown/up path for the existing control buttons or a compact touch pad, with `touch-action: none`; do not capture the whole page wheel/pinch gesture. The reset button must remain reachable in portrait layout.

- [ ] **Step 5: Add responsive CSS and run focused tests**

Run: `npm exec vitest run tests/flightHud.test.ts tests/entryDocument.test.ts` and `npm run check`

Expected: PASS with no missing required element and no TypeScript errors.

- [ ] **Step 6: Commit HUD/input changes**

```powershell
git add index.html src/main.ts src/styles.css src/game/BirdsInHkGame.ts tests/flightHud.test.ts
git commit -m "feat: add recoverable flight reset controls"
```

### Task 4: Strengthen readiness and comparison evidence

**Files:**
- Modify: `src/game/BirdsInHkGame.ts`: expose a typed readiness snapshot in telemetry only.
- Modify: `src/main.ts`: record readiness and Google Maps lifecycle events without credentials.
- Modify: `src/integrations/GoogleMapsCsdiOverlay.ts` only if disposal/error behavior is incomplete.
- Modify: `scripts/verify-runtime-session.mjs`: require readiness evidence and preserve current CSDI checks.
- Create: `tests/referenceEvidence.test.ts`

- [ ] **Step 1: Add failing evidence assertions**

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('reference evidence contract', () => {
  it('keeps the runtime verification tied to CSDI and Tai Po', () => {
    const script = readFileSync(new URL('../scripts/verify-runtime-session.mjs', import.meta.url), 'utf8');
    expect(script).toMatch(/source.*csdi/);
    expect(script).toMatch(/region.*tai-po/);
    expect(script).toMatch(/render\.capture/);
  });
});
```

- [ ] **Step 2: Implement readiness evidence**

Emit one sanitized `world.readiness` event after `waitForVisibleWorld()` succeeds, including only booleans/counts for visible official tiles, ground meshes, road features, and WebGL context state. Never include URLs containing keys or environment values.

- [ ] **Step 3: Verify Google Maps lifecycle**

Ensure `openGoogleMapsContext()` reports `google-maps.opened` only after successful mount, reports `google-maps.error` with a generic/configuration-safe message, and `closeGoogleMapsContext()` disposes the overlay and clears the container. Preserve the existing CSDI server proxy boundary.

- [ ] **Step 4: Update the runtime verifier**

Require `world.readiness`, existing CSDI/Tai Po checks, `render.frame`, `render.capture`, flight state, real road features, and official terrain evidence. Keep failure messages actionable and deterministic.

- [ ] **Step 5: Run the full local verification**

Run: `npm run check`, `npm run build`, `npm run qa:assets`, `npm run qa:csdi`, and `npm run qa:runtime` against a fresh evidence session.

Expected: all commands pass; runtime evidence reports a nonblank framebuffer, visible official CSDI geometry, real road/water data, and flight entry with no errors.

- [ ] **Step 6: Commit evidence changes**

```powershell
git add src/game/BirdsInHkGame.ts src/main.ts src/integrations/GoogleMapsCsdiOverlay.ts scripts/verify-runtime-session.mjs tests/referenceEvidence.test.ts
git commit -m "qa: prove Hong Kong reference flight readiness"
```

### Task 5: Browser verification and documentation

**Files:**
- Modify: `README.md`: document reset control, quality behavior, and exact verification commands if changed.
- Create: `runtime-evidence/browser-reference-flight/desktop.png`
- Create: `runtime-evidence/browser-reference-flight/mobile.png`

- [ ] **Step 1: Start the development server**

Run: `npm run dev -- --host 127.0.0.1`

Expected: Vite serves the project at `http://127.0.0.1:5173`.

- [ ] **Step 2: Verify the desktop flow in a real browser**

Open `/`, select a bird, start Tai Po, wait for the ready state, confirm a visible CSDI building and basemap, use reset, and capture a PNG. Record console errors, canvas dimensions, and the `world.readiness`/`flight.reset` events.

- [ ] **Step 3: Verify the mobile flow**

Use a 390x844 viewport, confirm no horizontal overflow, reset remains tappable, HUD values stay within their containers, and capture a PNG. Confirm DPR is capped by the quality policy.

- [ ] **Step 4: Verify the optional Google Maps comparison**

With browser-origin-restricted `VITE_GOOGLE_MAPS_API_KEY` and `VITE_GOOGLE_MAP_ID` configured, open and close the comparison panel. Confirm the panel reports status, the CSDI credential never appears in browser requests, and the Three.js scene continues rendering after disposal.

- [ ] **Step 5: Update the README and commit evidence metadata**

```powershell
git add README.md runtime-evidence/browser-reference-flight
git commit -m "docs: document reference flight verification"
```

## Final Verification Checklist

- [ ] `npm run check`
- [ ] `npm run build`
- [ ] `npm run qa:assets`
- [ ] `npm run qa:csdi`
- [ ] `npm run qa:runtime`
- [ ] Desktop screenshot is nonblank and shows official CSDI content.
- [ ] Mobile screenshot has no overflow or HUD overlap.
- [ ] Reset works without reloading map data.
- [ ] Google Maps remains optional and credential-safe.
- [ ] BlenderGIS and Sketchfab remain outside runtime.

