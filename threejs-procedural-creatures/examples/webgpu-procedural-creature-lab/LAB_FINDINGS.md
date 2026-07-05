# LAB_FINDINGS

## Plan checkpoint: baseline implementation status

### [Task L1–L3 implementation status]
- This file collects empirical doctrine deltas from the lab implementation and captures.
- Expected rows and thresholds are sourced from `threejs-procedural-creatures/references/creature-body-systems.md` and the local plan.
- Findings will be appended as executable proof with evidence paths when available.

## Initial findings

- `LAB_FINDINGS.md` currently initialized during partial implementation.
- No measured findings committed yet; placeholders retained for ongoing data in later stages.

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
