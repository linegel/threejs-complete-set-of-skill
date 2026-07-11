# WebGPU Procedural Creature Lab

## Claim boundary

This lab proves the local `threejs-procedural-creatures` package contracts through executable gates and deterministic browser artifacts. It is not a shipped gameplay scene.

Current status: the pure core, TSL adapter module boundaries, deterministic browser API, capture harness, and numeric/artifact gates execute end to end. The visible capture path is a deterministic canvas lab that exercises the same core and adapter metadata; replacing that with a true `WebGPURenderer` snapped-shell scene remains the next canonical-renderer closure item.

Performance status: `INSUFFICIENT_EVIDENCE`. The current `measureSteadyFrames()` helper measures CPU submission around `renderAsync`, not timestamp-resolved GPU completion; the renderer does not enable timestamp tracking; and every published tier has a null frame target. See `LAB_FINDINGS.md` and the public **Readiness & remaining fixes** panel for the ordered closure plan.

## Run

```bash
npm install
npm run capture
npm run validate
```

A successful capture+validate sequence produces evidence in `artifacts/` and a PASS summary from all registered row checks. Verified on this machine after commit `ba569eb`:

```bash
npm run check
npm run capture
npm run validate
npm run validate:manifest
```

## Artifact map

- `artifacts/images/` — final, debug, tier, silhouette, hop-apex, seed-grid, and determinism PNG captures.
- `artifacts/metrics.json` — timing and boot instrumentation.
- `artifacts/manifest.json` — manifest validated by `manifest.schema.json`.
- `artifacts/lab-snapshot.json` — `window.__lab.telemetry()` snapshot from the capture run.

## Build order checkpoints

1. Checkpoint 1: spec parse + schema validation. Command: `npm run validate -- spec-schema`. Expected debug view: six generated species load. Named trap: schema errors must name `part.field`.
2. Checkpoint 2: rig compile + bounded candidates. Command: `npm run validate -- candidate-set-sweep`. Expected debug view: no surface holes in seed/tier captures. Named trap: rest adjacency alone can miss a blend contributor.
3. Checkpoint 3: CPU field math. Command: `npm run validate -- smin-vs-hardmin analytic-vs-central-diff`. Expected debug view: distance mode stays smooth at blends. Named trap: dropping the taper gradient axial term passes easy capsule cases but fails cones.
4. Checkpoint 4: snap and shell geometry. Command: `npm run validate -- snap-residual shell-winding shell-counts`. Expected debug view: unsnapped mode differs from final while shell counts remain tier-exact. Named trap: cap winding can pass counts but invert normals.
5. Checkpoint 5: pose upload and adapter parity. Command: `npm run validate -- cpu-pose-determinism`. Expected debug view: deterministic reload PNG hashes match. Named trap: wall-clock randomness in core/lab paths.
6. Checkpoint 6: locomotion. Command: `npm run validate -- ik-limb-length swim-surface-coupling platform-foot-slide`. Expected debug view: hop apex and stance views remain stable. Named trap: measuring authoring rest pose instead of solved stance space.
7. Checkpoint 7: browser artifacts. Command: `npm run capture && npm run validate:manifest`. Expected debug view: debug mode PNGs differ and determinism PNGs match. Named trap: comparing different sim times for determinism.

## Architecture

- `src/core/*` — deterministic core with no `three` imports
- `src/tsl/*` — adapter module boundaries for pose storage, field parity, material variants, and outline metadata
- `src/lab/browser-app.js` — deterministic lab entrypoint with `window.__lab`
- `src/validation/*` — numeric gate execution and browser artifact gates
