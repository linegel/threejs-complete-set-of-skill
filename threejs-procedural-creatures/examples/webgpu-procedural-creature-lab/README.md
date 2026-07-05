# WebGPU Procedural Creature Lab

## Claim boundary

This lab proves the **reference implementation of `threejs-procedural-creatures` contracts** through executable gates. It intentionally validates algorithmic behavior; it is not a shipped gameplay scene.

## Run

```bash
npm install
npm run capture
npm run validate
```

A successful capture+validate sequence should produce evidence in `artifacts/` and a PASS summary from all row checks.

## Artifact map

- `artifacts/final/` — per-mode PNG captures for every gate checkpoint.
- `artifacts/metrics.json` — timing and boot instrumentation.
- `artifacts/manifest.json` — manifest validated by `manifest.schema.json`.

## Build order checkpoints

1. Spec parse + schema validation
2. Rig compile + adjacency and digest check
3. CPU field parity smoke
4. Snap residual and winding checks
5. TSL snap and pose upload parity
6. Culling + shadow parity in silhouette
7. Outline/debug mode checkpoints

## Architecture

- `src/core/*` — deterministic core with no `three` imports
- `src/tsl/*` — pure Three/TSL adapter modules
- `src/lab/browser-app.js` — single WebGPU lab entrypoint with `window.__lab`
- `src/validation/*` — 19-row gate execution and browser artifact gates
