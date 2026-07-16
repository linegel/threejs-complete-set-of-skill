# LAB_FINDINGS

## Plan checkpoint: baseline implementation status

### [Task L1–L3 implementation status]
- This file collects empirical doctrine deltas from the lab implementation and captures.
- Expected rows and thresholds are sourced from `skills/threejs-procedural-creatures/references/creature-body-systems.md` and the local plan.
- Findings will be appended as executable proof with evidence paths when available.

### Current acceptance status — 2026-07-11

- The canonical lab is **incomplete**. The implementation, route, unit, and mutation
  contracts pass, but those results do not substitute for current-source native GPU
  evidence.
- The files currently present under `artifacts/` are historical local output. They are
  ignored by Git and rejected by `npm run validate:artifacts`: the manifest predates
  canonical source hashes and omits the ownership diagnostic added by the current source.
- Current headless Chromium reaches an initialized native WebGPU backend and the capture
  readback call, then loses the device during `copyTextureToBuffer` /
  `readRenderTargetPixelsAsync`. No current-source evidence bundle or performance claim is
  accepted until that blocker is resolved and the required images are directly inspected.
- Public performance is **insufficient evidence**, not passing. A 2026-07-11 live Chrome
  audit at a 1200×834 CSS viewport observed 92 ms LCP and 0 CLS for cold document load,
  but the animation environment itself produced an approximately 33.3 ms requestAnimationFrame
  p50 both with the creature render loop active and with it paused. That cadence therefore
  cannot isolate lab GPU cost. The renderer is constructed without `trackTimestamp`, even
  though the adapter exposes `timestamp-query`, and `measureSteadyFrames()` measures the
  host interval around `renderAsync` submission rather than timestamp-resolved GPU completion.
  All three tiers still declare `frameTargetMs: null`. Closure requires a frozen target-device
  contract, `trackTimestamp: true` before renderer initialization for the performance profile,
  resolved GPU scopes, sustained CPU/GPU/presentation p50/p95, deadline misses, memory, and
  settled-tier evidence. The old approximately 0.1 ms submission median is not a GPU result.
- The sections below are a chronological engineering log. Past phrases such as “passes,”
  “shipped,” and measured image/timing values describe the source revision that produced
  them; they are not present-revision acceptance claims unless repeated above.

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

## Stage 3 — driver + locomotion strengthening (this session)

- **Expected** (reference §9): "hop apex sampling (step the clock to the exact apex)".
  **Observed**: with continuous state durations, the apex generally falls BETWEEN 1/60 ticks,
  so a fixed-step `seek(apexTime)` cannot satisfy a 1e-9 apex assertion. **Applied delta**:
  hopper state durations are quantized to tick boundaries in the lab implementation
  (idle/crouch/air/land rounded to whole ticks) so the apex is exactly reachable by seek.
  Candidate doctrine note for §6/§9: "under a fixed-step driver, quantize state-machine
  durations to whole ticks so evidence sampling can land on exact state events."
- **Gate strengthening deltas vs the inherited (ba569eb) suite**: stance-foot-drift (row 9,
  1e-9, stationary AND moving, irregular render-dt pattern) was absent; platform-foot-slide
  (row 12) had no platform; IK gate was 10x looser than the 4-decimals contract; swim gate
  sampled one instant. All four now match the §10 table; mutations (raw-dt bypass, dropped
  Gram-Schmidt Y) demonstrated failing.

## Stage 4/5 — locomotion sweep gate + executable raise-K policy (this session)

- **Expected** (SKILL.md tier table): hero candidate K = 8.
  **Observed** (candidate-set-sweep gate details): the swimmer spec (8-segment rope tail)
  FAILS the full-field locomotion sweep at K=8 and passes at kRequired=10; the raise-K
  policy fired on a real authored spec, not just the fixture. The quadruped passes at K=8
  with maxDelta 0.0294 vs threshold 0.0298 — 98.7% of the bound, driven by the posed rope
  tail. Evidence: `npm run validate` gate `candidate-set-sweep` perSpec table.
  **Proposed delta (stage 9/10)**: the tier-table K column should carry the sweep-gate
  qualifier explicitly ("authored default; the sweep gate may raise K per spec — measured:
  swimmer needs 10 at hero") — K=8 is not universally sufficient and the lab now proves it.
- Raise/reject policy is itself gated: under-connected 13-capsule star fixture fails at
  K=1..11, passes at 13; capped at 2 it produces the named REJECT error.
- `gate-coverage-index` was vacuous (unconditional pass with a hardcoded list); now
  dynamically imports every gate module and fails on any missing required id.

## Stage 6 — real WebGPU TSL snapped-shell path (this session)

- **Expected** (reference §7/§10 boot rows): pipeline counting "via renderer.info / GPU capture".
  **Observed**: renderer.info has no pipeline counter (plan §9 fact confirmed live); wrapping
  GPUDevice.createRenderPipeline/Async/createComputePipeline/createBuffer after renderer.init()
  works headless and yields countersAtInit / countersAtReveal (7+7 pipelines, 76 buffers at
  reveal for the 6-species scene). Doctrine delta candidate: reference §11 should name the
  device-wrap mechanism, not renderer.info, for gates 16-17.
- **Headless screenshot caveat**: page.screenshot() of the WebGPU canvas is presentation-blank
  in headless Chromium (known pack caveat). Stage 7 must capture via in-page render-target
  readback (readRenderTargetPixelsAsync) + CPU PNG encode (visual-validation png.js pattern),
  not compositor screenshots.
- **Parity-order hazard checked**: CPU field sorts candidate indices ascending; the compiler
  stores candidate sets ascending (verified for all 16 quadruped slots), so the TSL as-stored
  loop matches the CPU fold order. The stage-7 f32 parity artifact remains the executable bound.
- Fragment SDF self-AO deliberately skipped at this stage (cost); toon ramp + analytic
  gradient normals implemented; documented in material.userData.selfAO.

## Stage 7 — historical capture findings (current bundle rejected)

- **Gate-rigging removed from delegated output**: the codex-written capture clamped
  `firstFrameMs` to 1.5× the steady median *before* computing the gated ratio — the gate
  could never fail. Replaced with raw timings; the 1 ms denominator floor and every
  measurement decision are documented next to the numbers in `boot.json`.
- **r185 `setupPosition` clobbers instanceMatrix under a custom positionNode**
  (`NodeMaterial.setupPosition` applies `instancedMesh(object)` BEFORE
  `positionLocal.assign(this.positionNode)`) — a from-storage positionNode silently
  discards the instance transform, so root motion CANNOT live in the instance matrix on
  this path. The shadows-recipe example survives only because its positionNode reads
  `positionLocal.add(...)`. Lab fix: per-creature root (layout+position+yaw) is applied
  once, in-shader, from the roots storage; SoA slot endpoints stay creature-local, so
  rootTransformSingleApplication still holds. **Doctrine delta for reference §5/§11.**
- **Storage/material lifetime law**: the material-variant cache pins the exact storage
  *node objects* it compiled with. Recreating pose/candidate storages on tier rebuild left
  cached materials reading buffers that no longer receive writes (blank creatures).
  Pose storage is allocated once per app lifetime; candidate storages are cached per
  species+tier; dispose() clears both together with the variant cache.
- **Headless WebGPU liveness matrix** (each cell measured): (a) awaited canvas
  `renderAsync` outside rAF hangs once the swapchain runs dry (~a few frames);
  (b) offscreen-RT renders always resolve; (c) resources created by a scene REBUILD only
  render correctly after real loop-driven frames — single-shot RT captures of a rebuilt
  scene read blank no matter how many explicit compiles/renders/barriers precede them.
  Harness consequence: tier captures run under `resumeLoop()`; `captureFrame` suspends the
  loop only for the duration of its awaited renders.
- **Determinism needs `?paused=1`**: free-running ticks between page-ready and `pauseLoop`
  are a nondeterministic race (measured: pose hashes diverged while PNG hashes matched).
  The determinism pair now boots with the simulation frozen at tick 0.
- **First-frame ratio is JIT-noise dominated at this scene scale**: with an identical
  warm path, frame 1 costs ~0.9–2.8 ms vs 0.1 ms steady (JS warm-up, not GPU compile).
  The reveal metric used the median of a 10-frame reveal window (raw samples were emitted
  in the historical `boot.json`); one-shot compile stalls remain the job of the counter-based
  `pipelines-after-reveal` gate (compile-before-reveal: RT-bound `compileAsync` + one
  untimed pre-reveal warm frame covers the shadow pass, which `compileAsync` does not walk).
  Completion barriers were tried and rejected with evidence: `onSubmittedWorkDone` stalls
  ~130 ms/frame steady-state headless; a per-sample readback allocates a staging buffer —
  caught by our own `buffer-reallocs-after-init` gate (the verifier verified the verifier).
- **Readback PNGs are linear-light**: the canvas gets an sRGB output transform, RT
  readbacks do not; capture now encodes linear→sRGB (mean brightness 18→~90/255).
- **Shadow bias pair implemented, pending current recapture** (Derived): `bias -2e-4`
  (~1 depth texel of the 16-unit ortho frustum), `normalBias 0.02` (~1.5 shadow texels
  world-size) — the snapped shell self-shadows at grazing texels without it.
- **Historical visual finding, pending ownership-mode recapture**: sparse dark speckle was
  visible on some creature surfaces (z-fight-like, worst where blends fold the shell). The
  current deterministic owner mask is intended to remove coincident shell sheets, but that
  visual result is not accepted until recaptured. The historical silhouette
  diff image legend was fixed (agreement=dim gray, mismatch=bright red — judges misread the
  old green fill as mismatch; diffTexels 12 vs derived budget 121 was always the truth).
