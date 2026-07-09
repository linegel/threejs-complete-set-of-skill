# Graphics Validation Protocol

Use this protocol to validate authored Three.js graphics on the canonical
WebGPU/TSL path. It separates visual correctness, mechanism correctness,
deadline compliance, GPU attribution, resource pressure, and lifecycle
stability so that evidence for one claim cannot be substituted for another.

## Contents

- Acceptance model
- Numeric evidence labels
- Visual contract
- Capability gate
- Evidence bundle
- Automation and renderer manifests
- Node-pipeline evidence
- Visual-error protocol
- Refresh-derived budgets
- Sustained and thermal protocol
- Quality-governor protocol
- GPU timing sufficiency
- Resource, tile-memory, and bandwidth protocol
- Color and output
- Inspection controls
- Mechanism-specific evidence
- Determinism and temporal validation
- Resource lifetime validation
- Rejection and sign-off

## Acceptance Model

Accept an implementation only when this chain is complete:

```text
declared physical and visual invariant
  -> inspectable implementation and ownership
  -> diagnostic that isolates the invariant
  -> metric in the invariant's native domain
  -> frozen acceptance gate
  -> fixed-view and temporal evidence
  -> sustained target-device cost
```

Code plausibility and a polished frame are insufficient. A weak result exposes
an incomplete, badly weighted, unstable, or under-sampled mechanism. A strong
frame can still conceal invalid depth, radiometric error, temporal ghosting,
resource churn, output-transform duplication, or a quality governor that
silently discards the authored result.

Keep claim classes independent:

- visual correctness: appearance inside the declared camera, lighting, and
  temporal envelope;
- mechanism correctness: physical, geometric, field, radiometric, and state
  invariants;
- performance compliance: sustained deadline and resource gates on a named
  device/browser/display configuration;
- GPU attribution: timestamp-backed GPU and pass/dispatch cost;
- lifecycle stability: bounded resources across resize, reset, and teardown.

A bundle may pass one class and be `INSUFFICIENT_EVIDENCE` or fail another.
Never collapse these into a single unqualified pass.

## Numeric Evidence Labels

Every numeric value in artifacts, prose conclusions, plots, tables, and image
captions carries exactly one label:

- `Authored`: input or policy declared before candidate inspection;
- `Derived`: result of a recorded formula over labelled inputs;
- `Measured`: observation from the named run and sample scope;
- `Gated`: acceptance bound frozen before candidate inspection.

Use this record everywhere:

```ts
type NumericDatum = {
  value: number
  unit: string
  label: 'Authored' | 'Derived' | 'Measured' | 'Gated'
  source: string
  uncertainty?: string
}

type NumericArray = {
  values: number[]
  unit: string
  label: 'Authored' | 'Derived' | 'Measured' | 'Gated'
  source: string
  uncertainty?: string
}
```

Bare frame budgets, refresh rates, DPRs, resolutions, durations, sample counts,
percentiles, memory caps, quality constants, and error thresholds invalidate
the bundle. `p50 [Measured]` and `p95 [Measured]` are estimator names; their
reported values are still `NumericDatum` records. A derived value used for
acceptance is retained as `Derived`, then copied to a separately frozen
`Gated` record that cites it. This preserves calculation provenance and gate
immutability.

API revisions and identifiers are strings, not numeric evidence. Normative
alignment or limit values obtained from an API are `Gated` and cite that API.

## Visual Contract

Write the contract before tuning or capturing:

```ts
type VisualContract = {
  subject: string
  identity: string[]
  invariants: InvariantContract[]
  cameraEnvelope: {
    bookmarks: string[]
    near: NumericDatum
    design: NumericDatum
    far: NumericDatum
  }
  lightingEnvelope: string[]
  temporalEnvelope: string[]
  requiredImages: string[]
  requiredDiagnostics: string[]
  requiredMetrics: string[]
  blockingFailures: string[]
  allowedDivergences: string[]
  performanceClaims: PerformanceClaims
  performanceEnvelope: PerformanceEnvelope
  resourceGates: ResourceGates
}

type InvariantContract = {
  id: string
  statement: string
  domain: 'geometry' | 'field' | 'radiometry' | 'image' | 'temporal' | 'resource' | string
  truthSource: string
  diagnostic: string
  metric: string
  mask?: string
  gate: NumericDatum | NumericDatum[]
  requiredArtifacts: string[]
  blockingFailure: string
}
```

Each invariant must be directly observable. State a falsifiable relation such
as silhouette continuity, field conservation, depth ordering, radiance ratio,
history rejection, root anchoring, or horizon closure. Do not use adjectives
as tests. A contract requiring only the final image is invalid because it
cannot prove mechanism, no-post signal, timing, ownership, or lifecycle.

When matching a supplied reference, record the causal features that define its
identity and every deliberate divergence in backend, asset, scale, camera,
lighting, output transform, or composition. A category-level resemblance is
not reference matching.

## Capability Gate

When `gpuTimingRequirement` is `required`, construct `WebGPURenderer` with
`trackTimestamp: true`; the request must precede initialization. Initialize
before reading backend truth:

```js
await renderer.init();

if (renderer.backend.isWebGPUBackend !== true) {
  throw new Error('WebGPU backend required for canonical visual validation. Report the blocker; do not teach fallback unless the user explicitly requested teaching how to apply fallback when WebGPU is unavailable.');
}
```

After the gate, record revision, renderer/backend identity, output color space,
tone map and exposure, sample count, depth mode, output buffer type, coordinate
system, compatibility mode, timestamp support, adapter features/limits,
initialization state, device loss, and uncaptured errors. Every numeric
capability, enum, matrix, and limit is a `NumericDatum` or `NumericArray`; never
serialize raw numeric fields.

Canonical quality states retain WebGPU, TSL, the ownership graph, and the
mechanism. Reduced resolution, sample count, update rate, or population must
be named, measured, and visual-error gated. A lower state is not a second
renderer recipe and cannot activate compatibility guidance.

## Evidence Bundle

Use stable paths so CI and reviewers compare identical fields:

```text
artifacts/visual-validation/<scene>/<revision>/<target>/<quality>/<seed>/
  visual-contract.json
  evidence-manifest.json
  renderer-info.json
  pipeline-graph.json
  performance-envelope.json
  frame-trace.json
  quality-governor.json
  render-targets.json
  storage-resources.json
  resident-resources.json
  bandwidth-model.json
  visual-errors.json
  leak-loop.json
  images/
    final.design.png
    no-post.design.png
    contribution.design.png
    diagnostics.mosaic.png
    camera.near.png
    camera.design.png
    camera.far.png
    seed.representative.png
    seed.stress.png
    temporal.reset.png
    temporal.response.png
    temporal.steady.png
    temporal.disocclusion.png
    temporal.recovery.png
```

Omit only artifacts irrelevant to a contract, and record why. The bundle must
be reviewable without rerunning the scene. Presence and nonblank checks are
transport checks, not visual validation.

### Required file semantics

| File | Required semantics |
| --- | --- |
| `visual-contract.json` | claim classes, invariant mappings, labelled numeric policy, visual gates, performance envelope, resource gates, blocking failures |
| `evidence-manifest.json` | scene and asset identity, target device/browser/display, viewport, camera, seed, time, quality state, color/output graph, stochastic masks, compromises |
| `renderer-info.json` | initialized renderer/backend truth, adapter when exposed, features, limits, timestamp capability, device errors, `renderer.info` snapshots |
| `pipeline-graph.json` | pass and dispatch DAG, MRT outputs, history edges, resolution scales, output owner, diagnostic and no-post routes |
| `performance-envelope.json` | target refresh, browser/compositor reserves, safety reserves, derived stage envelopes, frozen gates, claim requirements |
| `frame-trace.json` | per-frame CPU/GPU/presentation metrics, active quality, misses, excluded phases, cold and sustained segmentation |
| `quality-governor.json` | inputs, filtering, gates, hysteresis, residence policy, transitions, settled state, per-state visual error |
| `render-targets.json` | target descriptors, attachment semantics, liveness, aliasing, memory, load/store/resolve behavior |
| `storage-resources.json` | buffers/textures, layouts, dispatch ownership, synchronization, read/write volumes, reset policy |
| `resident-resources.json` | textures, geometry, buffers, histories, staging, readback, pipeline estimate, peak live set, upload churn |
| `bandwidth-model.json` | per-pass lower/upper traffic, assumptions, pass breaks, resolves, bytes per frame and per second, counter evidence if exposed |
| `visual-errors.json` | per-invariant metric domain, truth source, alignment, mask, measured distribution, frozen gate, worst-case artifact |
| `leak-loop.json` | operations, before/after resources, trend test, allowed cache plateaus, device errors |

The checked-in validation harness may provide transport and schema scaffolding,
but a bundle is conformant only when it implements every required semantic
above. Do not treat an older harness pass as proof of this protocol.

## Evidence Manifest

Record:

```ts
type EvidenceManifest = {
  skill: 'threejs-visual-validation'
  sceneId: string
  threeRevision: string
  targetId: string
  device: string
  browser: string
  os: string
  gpuAdapter?: string | null
  displayRefresh: NumericDatum
  targetPresentationRate: NumericDatum
  renderer: 'WebGPURenderer'
  backend: {
    isPrimaryBackend: boolean
    initialized: boolean
    coordinateSystem: string | NumericDatum | null
    deviceLostObserved: boolean
    uncapturedErrors: string[]
    features: string[] | null
    limits: Record<string, NumericDatum | string | boolean> | null
    timestampAvailable: boolean
    unavailableReason: string | null
  }
  qualityState: string
  viewport: {
    width: NumericDatum
    height: NumericDatum
    dpr: NumericDatum
  }
  camera: {
    bookmark: string
    matrixWorld: NumericArray
    projectionMatrix: NumericArray
    near: NumericDatum
    far: NumericDatum
    fov?: NumericDatum
  }
  seed: string
  time: {
    fixed: boolean
    seconds: NumericDatum
    frame: NumericDatum
  }
  assets: { id: string; url?: string; hash?: string }[]
  colorPipeline: ColorPipelineRecord
  stochasticMasks: string[]
  knownCompromises: string[]
}
```

Unavailable backend fields are `null` with a reason. An unavailable timestamp
is not a numeric zero.

## Automation Contract

Automation controls the actual pipeline and records:

```text
physical viewport and DPR
display refresh and presentation mode
fixed seed and deterministic sequence
fixed time or deterministic step index
exact camera matrices or immutable bookmark
quality state and governor mode
debug output node
capture path and output encoding
overlay exclusion
warm-up, cold, sustained, and capture phases
```

Freeze stochastic state or compare a converged distribution. Masks are authored
before capture and restricted to known stochastic pixels. Manual camera
repositioning invalidates comparisons.

## Renderer And Backend Manifest

Record the Three.js revision, initialized renderer class, backend flag, browser,
OS, adapter identity when exposed, features, limits, coordinate and depth mode,
sample count, output buffer type, compatibility mode, timestamp capability,
output color space, tone map, exposure, device-loss result, and uncaptured
errors. Include viewport, DPR, display refresh, power state when exposed, and
whether the tab was foreground, visible, and free of automation throttling.

## Node-Pipeline Evidence

Record the graph that produced each capture:

```text
RenderPipeline output owner
outputColorTransform state
explicit renderOutput stage when present
scene pass and camera ownership
MRT attachment names and consumers
pass resolution scales
built-in node types and inputs
history producer, consumer, and reset edges
compute dispatch dependencies and barriers
diagnostic override materials
no-post bypass route
final composite route
```

Inspect the pre-effect signal, contribution, and final composite. Changing only
a diagnostic label is a blocking false diagnostic. A graph change requires
pipeline invalidation before capture.

## Visual-Error Protocol

Select a metric in the invariant's native domain. Global differing-pixel ratio
is permitted only for deterministic exact-output contracts; it is not a
general visual-quality metric.

| Invariant | Required metric family | Required diagnostic |
| --- | --- | --- |
| silhouette and topology | mask overlap, boundary-distance distribution, component or hole mismatch | binary silhouette and boundary error map |
| depth and visibility | relative depth error, occlusion disagreement, disocclusion classification | linear depth and error map |
| surface orientation | angular normal error distribution, invalid-normal count | world- or view-space normal and angular error map |
| scene-linear light | relative radiance/luminance error, energy ratio, clipped or non-finite count | pre-tone-map reference, candidate, and signed error |
| display color | perceptual color-difference distribution under the same transform | output-referred reference, candidate, and difference map |
| material separation | class confusion, channel residual, highlight-width or roughness-response error | channel and lighting-isolation views |
| motion | transform, velocity, trajectory, or phase error | velocity and trajectory overlays |
| temporal reconstruction | reprojected residual, ghost occupancy, flicker energy, rejection classification | history, confidence, disocclusion, and residual views |
| procedural or simulated field | analytic/sample residual, conservation drift, spectrum or distribution error | raw field and signed residual |
| stochastic output | distribution-distance and confidence interval over frozen conditions | sample aggregate, variance, and worst seed |

For every metric, store domain, units, truth-source hash, camera and output
transform, alignment, mask, estimator, aggregation, `p50 [Measured]`,
`p95 [Measured]`, worst case, spatial error map, `Gated` limit, and pass/fail. Use
area-weighted or perceptually justified aggregation where screen resolution
changes. Do not let a large background dilute subject error.

Thresholds come from an analytic error bound, perceptual study, reference
uncertainty, or authored product requirement. Record which. Tuning against the
candidate and then declaring its error as the threshold is invalid.

## Refresh-Derived Budgets

### Target declaration

Each performance claim names the exact target device, OS, browser, adapter,
display mode, viewport, DPR, power source, thermal starting condition,
foreground state, scene path, requested presentation rate `Authored`, actual
display refresh `Measured`, and feasible target presentation rate `Gated`.
Device-class names alone are not budgets.

For deadline-driven presentation:

```text
refresh period [Derived]
  = dimensional reciprocal of target presentation rate [Gated]

CPU scene envelope [Derived]
  = refresh period [Derived]
  - browser/main-thread reserve [Measured or provisional Authored]
  - CPU safety reserve [Authored]

GPU scene envelope [Derived]
  = refresh period [Derived]
  - compositor/GPU reserve [Measured or provisional Authored]
  - GPU safety reserve [Authored]
```

Measure reserves with a pass-through host shell using the same page structure,
browser, device, display mode, viewport, DPR, canvas composition, event load,
and presentation cadence. The browser reserve covers non-scene main-thread
work; the compositor reserve covers presentation work not attributable to the
scene pipeline. Report reserve `p50 [Measured]` and `p95 [Measured]`, use the
quantile consistent with each frozen tail gate, and record the subtraction
policy. When only a combined host reserve is observable, subtract it once and
mark CPU/GPU attribution unavailable. Never double-subtract overlapping or
correlated reserves.

If a reserve cannot be measured, mark it provisional `Authored`. The resulting
envelope remains `Derived`, but the conclusion must state that device headroom
is conditional. Do not hide browser or compositor work in a generic safety
margin.

CPU and GPU can overlap. Gate each stage against its own deadline and record
end-to-end presentation intervals. Add stage times only when a timestamped
dependency proves serialization. For non-deadline rendering, replace refresh
with an authored throughput or latency service-level objective and retain the
same label discipline.

### Frozen gates

Before candidate capture, freeze as `Gated`:

- CPU and GPU `p95 [Gated]` limits sourced from the derived envelopes;
- presentation-interval `p95 [Gated]` and deadline-miss ratio;
- startup and first-stable-frame latency when claimed;
- memory, traffic, upload, and allocation-churn limits;
- sustained degradation and quality-transition limits;
- visual-error limits for every quality state.

Medians describe central cost; they do not gate tail latency alone. A passing
`p50 [Measured]` with a failing `p95 [Measured]` is a failure. Capture/readback,
shader compilation, asset upload, and automation are measured separately and
included only in claims whose user-visible path contains them.

### Sampling and aggregation

Keep contemporaneous raw frame samples. Record clock source, timestamp scope,
quantile estimator, warm-up policy, sample count, outlier policy, and excluded
phase. Policy values are `Authored`; minimum evidence requirements are `Gated`;
reported statistics are `Measured`.

Compute full-frame `p50 [Measured]` and `p95 [Measured]` from full-frame samples.
Never sum subsystem percentiles, copied skill budgets, or timings recorded on
different frames. Timestamp scopes may overlap or nest; account from their DAG
rather than summing labels. For a subsystem's marginal cost, run interleaved,
matched baseline/candidate blocks and compute the distribution of paired frame
differences. Do not subtract independently measured percentiles. A planning
estimate remains `Derived` and cannot replace measured full-frame acceptance.

## Sustained And Thermal Protocol

Run the same deterministic workload path through distinct cold, transition,
and sustained segments. Segment durations, sample cadence, repetitions,
foreground policy, power condition, and stabilization rule are `Authored`.
Minimum samples, minimum stable residence, and allowed drift are `Gated`.

For each segment record:

- CPU and GPU `p50 [Measured]` and `p95 [Measured]`;
- presentation-interval `p50 [Measured]` and `p95 [Measured]`;
- deadline misses and long-frame cluster lengths;
- active quality state, transition cause, and residence;
- resident and transient memory, upload traffic, and allocation churn;
- temperature, clocks, power, and hardware counters when exposed;
- browser visibility, background throttling, garbage collection, and device
  errors when observable.

The acceptance segment is the final stable sustained segment. Never average an
early fast segment with a late throttled segment. Report the slope and
step-change between segments. If temperature or clock telemetry is unavailable,
describe only observed time, cadence, memory, and quality drift. That evidence
can reveal degradation but cannot prove its thermal cause or prove the absence
of throttling.

If the authored stabilization rule is not reached within the run, return
`INSUFFICIENT_EVIDENCE_SUSTAINED` rather than selecting the last arbitrary
window.

Run low-power targets on physical devices. Desktop emulation, reduced browser
viewport, or user-agent substitution does not reproduce mobile tile memory,
bandwidth, scheduling, or thermal behavior.

## Quality-Governor Protocol

Record the governor as a deterministic state machine:

```text
input metric and sampling domain
filter and window definition
degrade gate and recovery gate
hysteresis and minimum residence
state transition table
resource rebuild and history-reset behavior
visual-error gate per state
performance envelope per state
```

All numeric policy inputs are `Authored`; transition thresholds and residence
requirements are `Gated`; filtered values and transitions are `Measured`;
derived state budgets are `Derived`. Store every transition with time, prior
state, next state, cause, filtered metric, resource delta, history reset, and
visible discontinuity metric.

Acceptance requires a stable final state that passes both sustained performance
and visual-error gates. The following fail:

- oscillation between states;
- repeated emergency degradation;
- recovery that violates the residence policy;
- timing compliance obtained by crossing the visual-error gate;
- hidden DPR or resolution changes absent from the manifest;
- state changes that leak or duplicate persistent resources;
- averaging results across states instead of reporting each state.

## GPU Timing Sufficiency

Set `gpuTimingRequirement` in the contract before the run:

- `required`: GPU envelope compliance, GPU headroom, pass/dispatch cost,
  GPU-side thermal degradation, bandwidth limitation, or optimization claims;
- `not-claimed`: visual, deterministic, resource-layout, or lifecycle evidence
  with no GPU performance conclusion.

When required timestamps are unavailable, return
`INSUFFICIENT_EVIDENCE_GPU_TIMING`. Do not emit `SKIP`, infer GPU cost from CPU
duration, substitute animation-frame cadence, shorten the window, or claim zero
cost. End-to-end presentation metrics remain valid `Measured` evidence for
deadline behavior but cannot attribute the cause or establish GPU headroom.

Record timestamp support, query scope, render and compute coverage, conversion
method, calibration if applicable, query-readback latency, disjoint/error state,
and whether timing perturbs the workload. Resolve render and compute timestamp
scopes separately; keep resolution/readback outside the steady-state window.
If a browser omits timestamps, rerun on a target configuration that exposes
them or narrow the signed-off claim.

## Resource, Tile-Memory, And Bandwidth Protocol

### Resident and transient memory

Inventory all material GPU-visible resources, not only render targets:

| Resource class | Required fields |
| --- | --- |
| texture | dimensions, layers, mips, format, compression, color domain, owner, lifetime, byte formula, upload source |
| geometry | vertex/index layouts, counts, usage, variants, owner, lifetime, byte formula |
| uniform/storage buffer | element layout, count, usage, owner, update cadence, byte formula |
| render attachment | dimensions, format, samples, load/store/resolve, lifetime, alias group, byte formula |
| history | producer/consumer, ping-pong count, reset, lifetime, byte formula |
| staging/readback | allocation policy, padded layout, cadence, peak live bytes |
| pipeline/cache | owner, variant key, count, estimate method, cache plateau |

Compute resident bytes and peak simultaneously live transient bytes separately.
Do not sum mutually aliased resources as if concurrent; do not omit temporary
resolves or readbacks because they are short-lived. Compare manual formulas to
`renderer.info`, but do not treat `renderer.info` as complete device-memory
telemetry.

WebGPU texture-copy rows record logical row bytes, API-aligned row pitch, and
padded byte length. The required alignment is `Gated` from the active API
contract. Reject fractional, under-sized, or assumed-tight row layouts.

### Tile attachment pressure

For each render pass derive:

```text
attachment bytes per pixel [Derived]
  = sum(format bytes per sample * sample count * layer count)
  + depth/stencil bytes per sample

full attachment footprint [Derived]
  = physical pixel count * attachment bytes per pixel
```

Record every load, clear, discard, store, resolve, subpass-equivalent reuse,
and pass break. The per-pixel attachment footprint is a portable pressure
indicator; it is not an on-chip tile-memory measurement. Tile dimensions,
hidden compression, cache capacity, and internal resolve strategy are
`Measured` only with hardware counters or authoritative device data.

On tile GPUs, unnecessary stored intermediates, multisample resolves,
full-resolution MRT attachments, and pass fragmentation can dominate external
traffic even when total allocation appears acceptable. Prefer discardable
transients, resolution reduction justified by visual-error gates, compatible
attachment reuse, and fewer pass breaks.

### Traffic model

For each pass or dispatch derive lower and upper traffic bounds:

```text
attachment traffic
  = loads + stores + resolves + explicit copies

sampled-texture traffic
  = covered fragments * samples per fragment * bytes per sample
    adjusted only by declared cache/compression bounds

storage traffic
  = invocations * declared reads/writes * element bytes

per-frame traffic
  = sum(per-execution traffic * measured executions per presented frame)

per-second traffic
  = per-frame traffic * measured presentation rate
```

Inputs and assumptions are individually labelled. Include overdraw, trilinear
or anisotropic sampling, mip choice, texture compression, cache reuse,
atomics, ping-pong histories, compute intermediates, uploads, readbacks, and
resolve copies. Separate compulsory lower-bound traffic from a conservative
upper model.

Only hardware counters make traffic or achieved bandwidth `Measured`. Without
counters, publish a `Derived` model with uncertainty. A derived model can gate
an authored traffic budget, but it cannot prove that the workload is physically
bandwidth-bound. Attribute a bottleneck only when timing changes under an
isolating perturbation or counters support it.

## Color And Output

Record:

```ts
type ColorPipelineRecord = {
  rendererOutputColorSpace: string
  rendererToneMapping: string | NumericDatum
  rendererToneMappingExposure: NumericDatum
  outputBufferType: string | NumericDatum
  toneMapOwner: string
  outputTransformOwner: string
  hdrWorkingType: string
  colorTextures: { name: string; colorSpace: string }[]
  dataTextures: { name: string; colorSpace: string }[]
  screenshotEncoding: string
}
```

Color textures use `SRGBColorSpace`. Data maps, normals, roughness, masks,
noise, LUT data, weather data, and diagnostic storage use `NoColorSpace` or
explicit linear semantics. HDR working buffers remain scene-linear until one
tone-map owner. Materials, effects, capture paths, and encoders cannot apply a
second output transform. Visual comparisons use the same transform, exposure,
encoding, and alpha/compositing policy.

## Required Inspection Controls

A runnable inspection surface exposes pause/resume, deterministic stepping,
fixed seed, fixed cameras, viewport and DPR, quality state, governor lock,
debug mode, final/no-post/contribution views, history reset, resource recreate,
timing reset, runtime errors, manifests, and bundle export. Controls must alter
the real pipeline and report the resulting graph and resource state.

## Mechanism-Specific Evidence

### Generated geometry, vegetation, and structures

Report semantic element counts, topology groups, material slots, exposed-edge
logic, bounds, LOD ownership, instance/batch ownership, seed identity, geometry
and storage bytes, upload volume, culling result, and deformation root. Inspect
topology, hard edges, UV density, normals, hierarchy, silhouettes, deformation
extremes, representative seeds, and a stress seed. A final composition cannot
prove topology or batching.

### Spectral water

Require disjoint cascade spectra, transform tests, frequency-space derivatives,
height and horizontal displacement, breaking measure, foam history, shared sky
parameters, storage ping-pong ownership, dispatch dependencies, and workgroup
assumptions. Inspect each cascade, resolved normals, breaking state, history,
and final shading. A plausible surface cannot prove spectrum, derivatives, or
history.

### Analytic and simulated water

Displacement and normals derive from the same state. Inspect displacement,
normal, Fresnel, reflection, refraction, absorption/thickness, caustics when
present, crest response, foam, simulation boundaries, and shared parameter
ownership. Test grazing views, far-horizon minification, high-DPR output,
resizes, disturbances, and sustained state.

### Terrain, planetary bodies, and atmosphere

Inspect undeformed coordinates, height, region or biome cause, coast or
boundary masks, normals, roughness, surface lighting without atmosphere,
atmosphere alone, aerial perspective, and combined output. Share body center,
radius, sun direction, and unit conversion. Test far, middle, and close camera
envelopes plus face/patch boundaries. Background contrast cannot substitute
for ground-to-distance continuity.

### Volumetric media and clouds

Expose density inputs, bounded integration interval, transmittance, lighting,
early exit, step pressure, temporal confidence/rejection, reduced-resolution
march, reconstruction, and shadowing when claimed. Test camera translation,
foreground disocclusion, lighting changes, and quality transitions. Still
frames cannot validate temporal reconstruction.

### Curved-ray and bounded iterative effects

Expose integration bounds, step count, accumulated steering, contribution,
transmittance, lookup direction, invalid/non-finite pixels, capped pixels,
early exits, and quality state. Use a stress view near the highest-curvature or
worst-conditioned region. Reject unbounded iteration, hidden non-finite values,
or error concealed by bloom or grading.

### Temporal surfaces, particles, trails, and histories

Expose previous state, current input, next state, reconstruction, composite,
resolved geometry/normal, identity mapping, pool occupancy when used, reset,
and storage ownership. Test reset, resize, input release, repeated interaction,
frame-rate changes, long idle evolution, birth/death/reuse, and tier changes.
Use frame-rate-independent response and identity-safe pooling metrics.

### Shadows and post nodes

For shadows inspect coverage ownership, committed light-space state, texel
stability, refreshed regions, blend weights, bias in scene units, outside-
coverage behavior, invalidation causes, target memory, and update traffic. For
AO, bloom, temporal AA, depth of field, exposure, or grading inspect input,
contribution, intermediate resolution, history, error, and final composite.

### Instanced deformation and procedural motion

Inspect shared geometry/material ownership, per-instance state indexing,
posed bounds, upload layout, draw and dispatch counts, transform-space
invariants, deterministic clocks, interpolation, quaternion continuity, and
shadow/visible position parity. Validate trajectory and deformation error over
the authored motion envelope; do not substitute a representative still.

## No-Post And Isolation Gates

Every effect-bearing scene exposes final output, no presentation treatment,
effect contribution, controlling field/mask, and depth/normal/velocity/history
as applicable. Reject when presentation treatment supplies missing silhouette,
atmosphere hides flat fields, blur conceals aliasing, normals imply absent
geometry, a temporal result cannot expose its state transition, iteration
pressure is hidden, or shadows are judged only after grading.

## Determinism And Captures

Freeze seed, camera matrices, projection, viewport, DPR, time, quality state,
governor state, backend, asset versions, color pipeline, and stochastic sequence.
Capture design, near/detail, far/silhouette, no-post, contribution, diagnostic
mosaic, a controlling diagnostic, a failure-sensitive diagnostic,
representative seeds, and stress conditions required by the contract.

Use exact matrices or immutable bookmarks. Manual repositioning invalidates
image evidence. When exact output is not expected, compare labelled metrics and
distributions rather than relaxing an arbitrary pixel threshold.

## Temporal Validation

Use deterministic clips or checkpoints spanning reset, first response, steady
state, disocclusion/invalidation, and recovery. Cover camera and object motion,
history accumulation, shadow refresh, simulation persistence, deformation,
particle lifecycle, governor transitions, resolution changes, and resource
rebuilds as applicable. Inspect at presentation speed and frame-by-frame.

Report temporal metric distributions, worst intervals, state transitions, and
error maps. Still captures cannot prove absence of shimmer, swimming, stale
history, phase error, or lifetime discontinuities.

## Resource Lifetime Validation

Loop resize, DPR change, quality transition, debug transition, history reset,
asset reload, scene teardown, and renderer dispose/recreate. Loop counts and
settling policy are `Authored`; plateau and trend limits are `Gated`; observed
counts and slopes are `Measured`.

Record before/after `renderer.info`, resident and transient inventories, live
textures/buffers when observable, JS heap when exposed, upload/readback pools,
pipeline/cache counts, and uncaptured backend errors. Distinguish bounded cache
warm-up from monotonic growth. Unreleased histories, targets, storage,
geometry, staging buffers, or pipeline variants block lifecycle acceptance.

## Rejection Criteria

Reject or narrow the claim when any applies:

- an invariant lacks a native-domain diagnostic, metric, and frozen gate;
- the final is weaker than the declared visual contract or reference feature;
- post treatment manufactures form absent from no-post evidence;
- backend, asset, algorithm, scale, color, or quality divergence is undisclosed;
- deterministic reset or fixed-view capture is impossible;
- sustained `p95 [Measured]`, deadline, visual-error, memory, or traffic gates
  fail;
- the quality governor oscillates or settles outside the visual contract;
- required GPU timing is unavailable;
- tile/resource costs omit material attachments, histories, resolves, uploads,
  readbacks, or transient peaks;
- a derived bandwidth model is presented as measured hardware bandwidth;
- ownership cannot be reconstructed from the pass, target, and storage graphs;
- lifecycle loops show unbounded growth or backend errors;
- evidence is too weak for the stated conclusion.

## Sign-Off Record

Record the skill and scene identity, contract revision, Three.js revision,
target device/browser/display, initialized backend, camera/viewport/DPR, seed,
time, quality state, governor state, mechanisms, divergences, diagnostics,
visual errors, cold and sustained timing, GPU timing sufficiency, presentation
cadence, performance envelope, target/storage/resident inventories, tile and
bandwidth model, color/output graph, lifecycle result, unsupported claims,
known defects, decision, and bundle path.

Repeat the evidence whenever mechanism code, Three.js revision, target,
backend, browser, display mode, camera, quality policy, color pipeline, or
resource graph changes.
