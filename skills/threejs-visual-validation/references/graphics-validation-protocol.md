# Graphics Validation Protocol

Use only the sections required by the claims declared in `SKILL.md`. This file
holds branch-specific measurement facts; the ordered validation process stays
in the skill.

## Claim and numeric records

Keep one compact row per claim:

```text
id | class | invariant | truth source | observable | diagnostic
metric/domain/unit/mask | gate | blocking failure | required artifacts | verdict
```

Every claim-driving number records `{ value, unit, label, source }` where
`label` is:

- `Authored`: a fixed input or policy;
- `Derived`: a recorded calculation from labelled inputs;
- `Measured`: an observation from the named run and sample scope;
- `Gated`: an acceptance bound frozen before candidate inspection.

A derived value used for acceptance remains recorded as `Derived`; copy it to a
separate `Gated` value that cites the derivation. API revisions and identifiers
are strings. API alignment and limit values are `Gated` facts from that API.

## Fixed-run and backend record

Record the exact Three.js revision, import entrypoints, renderer class,
initialized backend, browser/OS/GPU, adapter features and limits when exposed,
viewport, DPR, camera matrices, seed, time/step, quality state, assets, output
color space, tone mapping, exposure, target format, sample/depth mode, and
uncaptured device errors.

`trackTimestamp: true` must be passed to `WebGPURenderer` before
`await renderer.init()` when GPU timing is required. Read
`renderer.backend.isWebGPUBackend` only after initialization. A missing backend
field is unavailable evidence, not a guessed value.

## Capture and ownership

For each applicable claim capture:

| Evidence | What it proves |
| --- | --- |
| final | accepted presentation result inside the declared view envelope |
| no-post | subject form exists before presentation treatment |
| contribution | the selected mechanism contributes the claimed signal |
| controlling field/mask | the claimed cause, support, or selection rule exists |
| depth/normal/velocity/history | geometry and temporal inputs agree with the final |
| pass/dispatch graph | ordering, signal ownership, histories, and output ownership |

Freeze camera matrices, viewport, DPR, seed, time, quality, and output transform
across comparisons. A diagnostic route must change the actual output node and
mark the pipeline dirty when graph compilation depends on it.

Color inputs use `SRGBColorSpace`. Computational data, masks, normals, fields,
and diagnostic storage use `NoColorSpace` or explicit linear-data semantics.
HDR targets remain scene-linear until one tone-map/output-transform owner.
Captures use the same exposure, transform, encoding, and alpha policy.

## Metric selection

Select the metric before inspecting the candidate:

| Invariant | Metric family | Diagnostic |
| --- | --- | --- |
| silhouette/topology | overlap, boundary distance, component/hole mismatch | binary silhouette and boundary error |
| depth/visibility | relative depth error, occlusion disagreement | linear depth and error map |
| orientation | angular normal error, invalid-normal count | normal and angular-error views |
| scene-linear light | relative radiance/luminance error, energy ratio, invalid count | pre-tone reference/candidate/error |
| display color | perceptual color difference under the same transform | output reference/candidate/error |
| motion | transform, velocity, trajectory, or phase error | velocity/trajectory overlay |
| temporal history | reprojection residual, ghost occupancy, flicker, rejection accuracy | history/confidence/disocclusion/error |
| generated/simulated field | analytic residual, conservation drift, spectrum, or distribution error | raw field and signed residual |
| stochastic output | distribution distance and confidence interval | aggregate, variance, worst seed |

Store alignment, mask, estimator, aggregation, sample count, measured
distribution, worst case, spatial/temporal error artifact, and frozen gate. Use
subject or region masks so a large background cannot dilute the error. Exact
pixel identity is appropriate only when exact deterministic output is claimed.

## WebGPU render-target readback

Carry the actual integer row stride used by the copy encoder into decoding:

```text
logicalRowBytes = width * bytesPerPixel
requiredApiAlignment = 256 bytes under the current WebGPU copy contract
minimumAlignedBytesPerRow = alignUp(logicalRowBytes, requiredApiAlignment)
bytesPerRow = actual stride supplied to the copy encoder
minimumCopyBytes = (height - 1) * bytesPerRow + logicalRowBytes
```

Record width, height, format, bytes per pixel, logical row bytes, API alignment,
encoded `bytesPerRow`, encoded copy offset, mapped-view offset, actual buffer
byte length, and map completion.
`bytesPerRow` may exceed the minimum aligned stride. Decode row `y` from
`viewOffset + y * bytesPerRow`. `viewOffset` is relative to the supplied mapped
view; `copyOffset` is the GPU-buffer offset encoded in the copy command and is
validated and recorded without being added during host decoding. Never infer
stride from width or total buffer length. Reject fractional, misaligned,
undersized, or assumed-tight row layouts. Use
[the aligned-readback helper](../scripts/aligned-readback.mjs) for this branch.
It accepts the actual stride and permits backing buffers larger than the minimum
copy span. Mapping/readback completion proves host visibility; submission or
`computeAsync()` alone does not.

## Temporal claims

Use deterministic checkpoints spanning reset, first response, steady state,
invalidation/disocclusion, and recovery. Exercise applicable camera/object
motion, birth/death/identity reuse, resize/DPR, quality change, history rebuild,
and frame-rate or update-rate changes.

Inspect state, contribution, final output, rejection/reset mask, and error at
each checkpoint. A still frame cannot prove stability, history rejection,
phase behavior, or lifetime continuity. Stable identity must move current and
previous-presented state together; spawn, despawn, teleport, reparent, or
incompatible LOD marks history invalid.

## Target performance and GPU attribution

Name the exact device, OS, browser, GPU, display mode, viewport, DPR, power
condition, workload, and target presentation rate. Derive budgets from the
target instead of device-class labels:

```text
refresh period = 1 / target presentation rate
CPU scene envelope = refresh period - browser/main-thread reserve - safety reserve
GPU scene envelope = refresh period - compositor/GPU reserve - safety reserve
```

Record requested rate as `Authored`, actual refresh as `Measured`, feasible
target rate as `Gated`, and the period/envelopes as `Derived`. Measure reserves
under the same host conditions when possible; provisional `Authored` reserves
cannot support measured-headroom claims. CPU and GPU may overlap, so add them
only when a measured dependency serializes them.

Freeze tail-latency and deadline-miss gates before capture. Keep raw samples and
record clock, timestamp scope, warm-up, cold and sustained windows, estimator,
sample count, exclusions, and capture overhead. Acceptance uses the final stable
sustained window; an early fast segment cannot hide later degradation.

GPU timestamps are required for GPU headroom, per-pass/dispatch cost,
GPU-stage-envelope, GPU thermal, or bandwidth-attribution claims. Resolve render
and compute scopes separately and keep query resolution/readback outside the
steady-state window. Missing required timestamps yields
`INSUFFICIENT_EVIDENCE` for the affected claim.

## Resources, tile pressure, and traffic

Inventory only material resources for the claim, including owner, dimensions or
count, format/layout, lifetime, live-slot count, byte formula, update cadence,
reset, and disposal:

- textures, geometry, uniform/storage buffers, and histories;
- render attachments including load/store/resolve and sample count;
- staging/readback allocations and padded layouts;
- pipelines/caches when their growth or variant count matters.

Report resident bytes separately from peak simultaneously live transient
bytes. Count aliases only while concurrent. For each pass derive attachment
bytes per pixel and full attachment footprint from physical pixels, formats,
sample counts, and depth/stencil. These are portable pressure models, not
measurements of hidden tile size, compression, or cache behavior.

For a traffic claim derive lower/upper bounds from attachment loads/stores/
resolves/copies, sampled accesses, storage reads/writes, dispatches, overdraw,
and measured executions per presented frame. Only hardware counters make
physical traffic or achieved bandwidth `Measured`; otherwise retain a
`Derived` model with uncertainty.

## Lifecycle and plateau

Loop the applicable operations: resize, DPR change, quality/debug transition,
history reset, asset reload, scene teardown, renderer dispose/recreate, and
device-loss rebuild when claimed. Record before/after inventories,
`renderer.info`, live histories/targets/storage, staging/readback pools,
pipeline/cache counts, JS heap when exposed, and backend errors.

Declare warm-up and settling policy before the run. A bounded cache may grow
during warm-up and then plateau; persistent monotonic growth, duplicate owners,
or unreleased histories, targets, buffers, geometry, staging allocations, or
pipeline variants fails lifecycle acceptance.

## Verdict rules

- `PASS`: all required artifacts exist and every frozen gate passes.
- `FAIL`: a blocking failure occurs, a gate fails, reset is nondeterministic,
  ownership is ambiguous, output conversion is duplicated, or resources grow
  without a bounded plateau.
- `INSUFFICIENT_EVIDENCE`: a required capability, target, diagnostic, metric,
  timestamp, or artifact is unavailable.

Return separate verdicts for visual, mechanism, temporal, performance, GPU,
resource, and lifecycle claims. State the unsupported claim and exact evidence
needed to close it. Repeat affected evidence whenever the mechanism, Three.js
revision, backend, target/browser/display, camera, quality policy, output graph,
or resource graph changes.
