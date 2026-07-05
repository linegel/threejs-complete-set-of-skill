# LAB_FINDINGS

## Plan checkpoint: baseline implementation status

### [Task L1–L3 implementation status]
- This file collects empirical doctrine deltas from the lab implementation and captures.
- Expected rows and thresholds are sourced from `threejs-procedural-creatures/references/creature-body-systems.md` and the local plan.
- Findings will be appended as executable proof with evidence paths when available.

## Initial findings

- The initial scaffold was partial. As of commit `ba569eb`, `npm run capture && npm run validate`
  executes end to end with 20 registered gates and 26 artifact checks passing.
- Remaining empirical gap: the visible capture path is deterministic canvas evidence over the
  core/adapter contracts, not yet a canonical `WebGPURenderer` snapped-shell scene.

## Stage 1 — scaffold (commit 024a312)

- **Expected** (HANDOFF.md 3.9(e), pre-correction): "the 15-gate `npm run validate`".
  **Observed**: reference §10 table at HEAD has 19 rows — 15 mechanism gates + 4 boot gates
  (pipeline compiles / buffer reallocs / spawn cost / first-frame ratio).
  **Applied delta**: HANDOFF 3.9(e) reworded to 19 rows (same commit). Doctrine docs
  (SKILL.md, reference §10) already count correctly; no further edit needed.
- No performance/visual/API findings possible yet (no implementation exercised).

## Stage 2 — field/compiler/snap/shell (gates rows 1–7, 14)

- **Expected** (reference §10 row 2): thin-part containment ≤ 0.006 excess with `kCap`.
  **Observed**: with `kCap = 0.001` antennae the measured excess is ~1.1e-16 (float noise) —
  the kCap mechanism suppresses blend inflation to numerically zero at these radii, far
  under the doctrinal 0.006 bound. Evidence: `thin-part-containment` gate details.
  **Delta**: none applied yet; if the sweep/mutation stages confirm the bound is slack by
  orders of magnitude, consider tightening the doctrine number (Derived-from-measurement).
- **Implementation hazard not in the doctrine**: canonical part ordering via
  `String.prototype.localeCompare` is locale-dependent and would make the order-dependent
  sequential smin machine-dependent. Fixed to codepoint comparison in `rig-compiler.js`.
  Candidate doctrine delta: reference §3/§4 could state "sort by codepoint order, never
  locale collation" — to be applied in the Stage 9/10 docs pass.

## Stage 3/7 partial — browser/capture/runtime gates (commit ba569eb)

- **Expected** (plan §7 Task L3.1): deterministic capture artifacts for debug modes, tier
  switcher, silhouette/shadow composite, hop apex, seed grid, browser determinism, parity,
  boot/perf, and manifest validation.
  **Observed**: `npm run capture && npm run validate` passes. Artifact validator reports
  26/26 checks passing. Determinism evidence: pose hash and PNG hash are byte-stable across
  clean reloads after `seek(7.3)`.
  **Applied delta**: capture determinism now reloads before both screenshots; comparing an
  initial frame against a `seek(7.3)` frame correctly failed.
- **Expected** (SKILL §10 swim): swimmer root follows injected `getWaterHeight(x,z,t)` within
  0.09 world units.
  **Observed**: alphabetical slot ordering made slot 0 a non-body part; measuring slot 0
  produced a false failure. Runtime and gate now select the `main|body|torso` slot, falling
  back to largest radius. Final measured error is ~7.3e-11.
  **Applied delta**: `makeSwimState()` and `swim-surface-coupling` gate use named body-root
  selection.
- **Expected** (SKILL §10 IK): two-bone IK reconstructs limb lengths to four decimals.
  **Observed**: solver clamped the mathematical reach but still returned the requested foot
  target, so the pose buffer could contain the wrong lower length. Final gate passes at
  tolerance 5e-4 after writing the reconstructed lower endpoint.
  **Applied delta**: `solveLimbTarget2Bone()` returns the reconstructed endpoint as `segment.foot`.
- **Expected** (SKILL §3 candidate sets): bounded K candidates approximate the canonical full
  sequential smooth-min within the snap-residual sweep.
  **Observed**: pure rest-AABB adjacency missed one hexapod surface sample. Nearest-slot
  ranking with adjacency preference keeps K bounded and reduces max measured delta to
  ~5.6e-17 in the current sweep.
  **Applied delta**: `buildCandidateSets()` ranks all slots by center distance with adjacency
  bias instead of filtering exclusively to rest-AABB intersections.
- **Renderer caveat**: `window.__lab.telemetry().renderer.backend` currently reports
  `deterministic-canvas-lab`, not `WebGPURenderer`. The artifact gates therefore prove the
  package runtime/capture contracts and adapter identity metadata, but not a real GPU
  snapped-shell render path. This must be closed before claiming full plan completion.
