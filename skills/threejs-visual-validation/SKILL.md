---
name: threejs-visual-validation
description: Validate Three.js WebGPU/TSL implementations against falsifiable claims. Use for visual or mechanism correctness, temporal behavior, target performance or GPU attribution, resource ownership, and lifecycle stability.
---

# Visual Validation

Validate claims, not polished frames. Keep each verdict scoped to one declared
claim so evidence for appearance cannot substitute for mechanism, timing, or
lifecycle proof. The owning subject skill defines mechanism truth and failure
signatures; this skill defines how to falsify them.

## 1. Predeclare every claim

For each claim, record:

- class: visual, mechanism, temporal, performance, GPU attribution, resource,
  or lifecycle;
- invariant and truth source;
- observable and the diagnostic that isolates it;
- native-domain metric, units, alignment, mask, and aggregation;
- acceptance gate fixed before candidate inspection;
- blocking failure and required evidence.

Label every claim-driving number `Authored`, `Derived`, `Measured`, or `Gated`
and record its unit and source. Keep unknown values unknown.

This step is complete when every claim has a direct falsifier and no claim is
supported only by the final image.

## 2. Freeze the run

Freeze the exact Three.js revision, renderer and initialized backend, target,
browser/GPU, camera matrices, seed, time or deterministic step, viewport, DPR,
quality state, assets, and color/output graph. Construct the renderer with
timestamp tracking before initialization whenever a declared claim needs GPU
timing:

```js
const renderer = new WebGPURenderer( {
  trackTimestamp: gpuTimingRequirement === 'required'
} );

await renderer.init();

if ( renderer.backend.isWebGPUBackend !== true ) {
  throw new Error( 'Canonical WebGPU validation is unavailable on this target.' );
}
```

Record the blocker when canonical WebGPU is unavailable. Reach
`$threejs-compatibility-fallbacks` only when the user explicitly asks for that
branch.

This step is complete when the run can be repeated from the recorded state and
initialized backend truth is captured rather than inferred.

## 3. Capture the producing mechanism

Capture the real pipeline under the frozen state:

- for visual or mechanism claims, the final, no-post, and contribution views
  required to isolate the claimed cause;
- only the depth, normal, velocity, field, history, mask, resource, or pass
  diagnostics needed by declared claims;
- for performance, GPU-attribution, resource, or lifecycle claims without a
  visual/mechanism claim, only the producing trace and diagnostics required by
  that claim;
- the pass/dispatch ownership graph, including histories and reset edges.

Keep HDR work scene-linear until one tone-map/output-transform owner. Diagnostic
modes must switch the actual output node and invalidate the graph when required;
a label-only toggle proves nothing.

This step is complete when every required artifact is traceable to the pass,
dispatch, resource, and output owner that produced it.

## 4. Measure in the native domain

Compare each observable with its declared truth using the frozen metric and
gate. Inspect the important final and diagnostic images directly; a nonblank
capture or scalar summary is only transport evidence. Store the error map or
worst interval when a global statistic can hide a local failure.

Read
[the graphics validation protocol](references/graphics-validation-protocol.md)
for metric selection, aligned WebGPU readback, target timing, resource models,
and lifecycle checks. Load only the sections used by the declared claims.

This step is complete when every measured value identifies its domain, unit,
source, sample scope, frozen gate, and supporting artifact.

## 5. Exercise conditional state

Run only the branches the claims require:

- temporal: reset, first response, steady state, invalidation/disocclusion, and
  recovery under deterministic camera/object/state changes;
- performance: cold and final sustained windows on the named target;
- GPU attribution: resolved render/compute timestamps outside the measured
  steady-state window;
- resource: resident, transient, attachment, upload/readback, and traffic
  evidence proportional to the claim;
- lifecycle: repeated resize/DPR, quality/debug transition, history reset,
  teardown, and dispose/recreate until resources plateau or trend upward.

`renderer.computeAsync()` submits work; it is not proof of GPU completion.
CPU-visible completion requires an actual readback/map, while GPU cost requires
timestamp evidence.

This step is complete when every state transition named by a claim has a
before/after diagnostic, reset policy, and bounded resource outcome.

## 6. Return claim-scoped verdicts

Assign exactly one verdict to every claim:

- `PASS`: every required artifact exists and all frozen gates pass;
- `FAIL`: a blocking failure occurred or a gate failed;
- `INSUFFICIENT_EVIDENCE`: required evidence or capability is unavailable.

Missing required GPU timestamps produce `INSUFFICIENT_EVIDENCE` for GPU-cost
claims; CPU frame time and presentation cadence do not become GPU timing.
Report unsupported claims and the exact evidence needed to close them.

Validation is complete when every declared claim has one verdict, every verdict
resolves to direct evidence, the sole output owner is identified, deterministic
reset is checked where state exists, and persistent resources either plateau or
fail lifecycle acceptance.
