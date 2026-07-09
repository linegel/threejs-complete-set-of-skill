---
name: threejs-visual-validation
description: Validate advanced Three.js WebGPU/TSL scenes with falsifiable visual contracts, mechanism diagnostics, sustained CPU/GPU timing, refresh-derived budgets, quality-governor traces, tile-GPU resource models, visual-error metrics, leak loops, and stable JSON+PNG evidence.
---

# Visual Validation

Validate the mechanism that creates the image, its error, and its sustained
cost. A polished frame is not proof. The canonical path is current Three.js
with `WebGPURenderer`, TSL, `NodeMaterial`, `RenderPipeline`, built-in post
nodes, and compute/storage evidence whenever the implementation uses GPU-side
state.

## Acceptance Contract

Accept only when all of these agree:

```text
authored physical and visual invariants
  -> inspectable implementation and ownership graph
  -> mechanism-isolation diagnostics
  -> invariant-specific visual-error measurements
  -> sustained performance and resource evidence on the target
  -> final image inside the declared viewing envelope
```

Define the contract before tuning. Each invariant names its observable,
reference or analytic truth, diagnostic, metric domain, mask, acceptance gate,
and blocking failure. Pixel similarity alone cannot prove geometry, radiometry,
field evolution, temporal reconstruction, or resource ownership.

## Numeric Evidence Labels

Every numeric value in a contract, manifest, table, caption, or conclusion must
carry exactly one label and a source:

- `Authored`: a declared input or policy fixed before the run;
- `Derived`: computed from labelled inputs by a recorded formula;
- `Measured`: observed during this run, with method and sample scope;
- `Gated`: an acceptance bound fixed before inspecting the candidate result.

Serialize numeric evidence as `{ value, unit, label, source }`. Do not publish
bare budgets, sample counts, resolutions, percentiles, quality constants, or
error thresholds. `p50 [Measured]` and `p95 [Measured]` name estimators; their
reported values still use the numeric-evidence record. A gate derived from a
frame envelope is stored twice: the computed envelope as `Derived` and the
frozen acceptance limit as `Gated`, with the latter citing the former.

## Required Architecture

The validation surface uses:

- `WebGPURenderer` from `three/webgpu`, initialized before capability checks;
- TSL nodes from `three/tsl` and the matching `NodeMaterial` family;
- one `RenderPipeline` ownership graph using `pass()`, `mrt()`,
  `PassNode.setResolutionScale()`, and a single output-transform owner;
- built-in nodes first where they implement the required mechanism;
- `renderer.compute()` or `renderer.computeAsync()` and storage-resource
  evidence when simulation, culling, compaction, histories, or generated
  instance data are GPU-owned;
- deterministic automation for fixed cameras, time, seed, viewport, DPR,
  quality state, and diagnostic mode.

After initialization prefer `renderer.compute()` for submission. In r185,
`computeAsync()` is not a GPU-completion fence; CPU-visible completion needs an
actual readback/map, while GPU timing needs resolved timestamp evidence.

Use
[references/graphics-validation-protocol.md](references/graphics-validation-protocol.md)
for the artifact schema, timing protocol, target/storage/bandwidth inventories,
visual-error families, lifecycle tests, and rejection criteria.

## Capability Gate

Set `trackTimestamp: true` when constructing `WebGPURenderer` whenever the
predeclared contract requires GPU timing; requesting it after initialization is
too late. Record backend truth only after initialization:

```js
await renderer.init();

if (renderer.backend.isWebGPUBackend !== true) {
  throw new Error('WebGPU backend required for canonical visual validation. Report the blocker. Only when the user explicitly requested teaching how to apply fallback when WebGPU is unavailable may threejs-compatibility-fallbacks be loaded.');
}
```

After the gate, record revision, renderer/backend identity, output color space,
tone map, sample count, depth mode, output buffer type, compatibility mode,
timestamp support, adapter features, and adapter limits. Wrap every numeric
capability or enum in the numeric-evidence record; do not serialize raw numbers.

Budgeted tiers retain the canonical WebGPU mechanism and name every visual
loss. They are not compatibility branches. This skill never teaches or embeds
a non-WebGPU fallback.

## Required Evidence

- `visual-contract.json`: invariant-to-artifact bindings, numeric-evidence
  policy, target refresh envelope, visual-error gates, performance claims, and
  blocking failures;
- `evidence-manifest.json`: renderer/backend, target device, browser, display
  refresh, gated presentation rate, camera, seed, time, viewport, DPR, quality
  state, assets, color pipeline, post graph, stochastic masks, and known compromises;
- final, no-post, contribution, diagnostic, near/design/far, representative
  seed, stress, and temporal captures as applicable to the contract;
- pipeline graph: output owner, pass dependencies, MRT outputs, resolution
  scales, histories, and diagnostic routes;
- resource ledger: textures, geometry, uniforms, render targets, storage,
  histories, staging/readback allocations, peak transient liveness, and owner;
- tile-GPU traffic model: attachment load/store/resolve behavior, per-pixel
  attachment footprint, sampled/storage traffic bounds, and uncertainty;
- timing trace: warm-up, cold and sustained windows, `p50 [Measured]`,
  `p95 [Measured]`, deadline misses, GPU timestamps when required, browser and
  compositor reserves, presentation cadence, and capture overhead separated;
- quality-governor trace: decision inputs, thresholds, hysteresis, dwell time,
  tier transitions, visual error per tier, and final stable tier;
- lifecycle evidence: resize, DPR and tier changes, history reset, teardown,
  device errors, and dispose/recreate loops with before/after resource counts.

## Refresh-Derived Performance Envelope

Do not use a universal device-class millisecond table. For each target
device/browser/display/viewport/DPR combination, record requested presentation
rate `Authored`, actual display refresh `Measured`, and a feasible frozen target
rate `Gated`; derive its frame period `Derived` by dimensional inversion.
Measure the browser main-thread reserve and compositor/GPU reserve with a
pass-through host-shell run under the same conditions. An unmeasured reserve
may be `Authored` as a provisional assumption, but it cannot support a claim of
measured device headroom.

Derive separate stage envelopes:

```text
CPU scene envelope [Derived]
  = refresh period [Derived]
  - browser/main-thread reserve [Measured or provisional Authored]
  - CPU safety reserve [Authored]

GPU scene envelope [Derived]
  = refresh period [Derived]
  - compositor/GPU reserve [Measured or provisional Authored]
  - GPU safety reserve [Authored]
```

Use reserve quantiles consistent with the frozen tail-latency gate. If the host
shell exposes only combined browser/compositor overhead, subtract that combined
reserve once and mark the stage attribution unavailable; never subtract
correlated or overlapping reserves twice.

CPU and GPU stages may overlap; do not add their durations unless a measured
dependency serializes them. Freeze `p95 [Gated]` stage limits and deadline-miss
limits as `Gated` values sourced from these envelopes. Record presentation cadence
and dropped/deferred frames independently. Initialization, compilation, asset
upload, readback, PNG encoding, and automation overhead are separate measured
phases, never silently removed from end-to-end startup or capture claims.

## Sustained And Thermal Evidence

Performance acceptance requires both cold and sustained traces on each target
class. Window durations, sampling cadence, workload path, and thermal
stabilization rule are `Authored`; minimum sample and residence requirements
are `Gated`. Report per-window CPU and GPU `p50 [Measured]` and
`p95 [Measured]`, presentation intervals, deadline misses, memory trend, active
quality state, and quality transitions.

The sustained verdict uses the final stable window, not an average that hides
late throttling. Temperature, clocks, power, and hardware counters are
`Measured` when exposed. If they are unavailable, report only observed timing,
cadence, memory, and quality drift; do not claim absence of thermal throttling.
An emulator or desktop emulation is not evidence for a low-power target.

An adaptive governor passes only if the settled tier meets both the performance
gates and its visual-error gates. Oscillation, repeated emergency drops,
unbounded recovery, or satisfying timing by crossing the visual-error gate is
a failure. Log the exact decision metric, filtered value, threshold, hysteresis,
dwell interval, transition cause, and resource rebuild cost.

## GPU Timing Sufficiency

The contract declares `gpuTimingRequirement` before capture. GPU timestamp
timing is required for claims about GPU headroom, per-pass or per-dispatch
cost, GPU thermal degradation, bandwidth limitation, or compliance with a GPU
stage envelope. When required timing is unavailable, the verdict is
`INSUFFICIENT_EVIDENCE`; it is not `SKIP`, zero cost, or a pass. CPU frame time,
animation-frame cadence, and presentation intervals remain useful end-to-end
measurements but cannot identify GPU cost.

Resolve and record render and compute timestamp scopes separately. Timestamp
resolution/readback is a measured auxiliary phase and cannot contaminate the
steady-state sample window.

Visual correctness, deterministic behavior, and lifecycle checks may be signed
off separately only when the contract explicitly excludes GPU performance
claims. Record the unsupported claim and the device/browser needed to close it.

## Tile-GPU And Memory Evidence

For low-power and tile-based GPUs, inventory more than allocated target bytes.
Derive and gate:

- resident textures, geometry, buffers, histories, pipelines when estimable,
  and staging/readback allocations;
- peak simultaneously live transient bytes, not the sum of reusable aliases;
- render-pass attachment bytes per pixel including sample count and depth or
  stencil;
- attachment load, store, discard, resolve, and pass-break traffic;
- sampled-texture, storage-texture, and storage-buffer read/write traffic as
  lower and upper bounds with cache, compression, overdraw, and filter
  assumptions;
- bytes per frame and bytes per second at the measured presentation rate;
- allocation churn and upload volume per frame.

Do not infer tile dimensions, on-chip occupancy, cache hit rate, compression,
or physical bandwidth from WebGPU abstractions. Such values are `Measured`
only when hardware counters expose them. Otherwise publish a `Derived` model
with uncertainty and reject any claim that the scene is proven
bandwidth-bound. Avoid avoidable attachment stores, resolves, full-resolution
histories, and pass breaks before reducing the mechanism.

## Visual-Error Gates

Choose metrics per invariant and before seeing the candidate result:

- silhouette overlap plus boundary-distance distribution;
- relative depth error and occlusion disagreement;
- normal angular error;
- scene-linear radiance or luminance error before tone mapping;
- perceptual color difference after the same output transform;
- motion/velocity error, temporally reprojected residual, ghost occupancy, and
  flicker energy;
- field residual, conservation error, or analytic-reference error for the
  claimed mechanism;
- deterministic exact mismatch only where exact identity is expected.

Every result is `Measured`; every acceptance threshold is `Gated`. Store metric
domain, units, reference provenance, alignment, mask, percentile statistic,
and aggregation rule. Report spatial error maps and worst-case captures, not
only a scene-wide scalar. A stochastic mask must be authored before capture and
cannot hide deterministic failure.

## Color And Output

- Color textures use `SRGBColorSpace`.
- Data maps and diagnostic/storage textures use `NoColorSpace` or explicit
  linear-data semantics.
- HDR working targets remain scene-linear until the single tone-map owner.
- `RenderPipeline` or an explicit `renderOutput()` stage owns the sole output
  conversion.
- Captures record encoding and do not double-convert material, target, or
  presentation output.

## Rejection Summary

Reject or narrow the claim when any required invariant lacks a direct
diagnostic and metric; the final relies on post treatment to create missing
form; visual-error gates fail; sustained `p95 [Measured]` or deadline gates
fail; the governor settles outside the visual contract; required GPU timing is
unavailable; tile/resource evidence omits a material cost; deterministic reset
fails; or lifecycle loops leak persistent resources.

## Routing Boundary

This skill evaluates an implementation; it does not supply the subject
mechanism. Load `threejs-choose-skills` first, then only the selected subject
and image-pipeline skills. If canonical WebGPU is unavailable, report the
blocker. Do not load, quote, or propagate compatibility fallback teaching
unless the user explicitly requests teaching how to apply fallback when WebGPU
is unavailable.
