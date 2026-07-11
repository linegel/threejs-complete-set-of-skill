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
- Coupled coastal archipelago
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

### Pack-wide physics, interaction, and presentation linkage

Apply this section whenever a route combines physical domains, consumes an
external solver, or presents solver-owned state. The authoritative interface is
the
[physics domain and interaction contract](../../threejs-choose-skills/references/physics-domain-and-interaction-contract.md).

#### Required physics artifacts

Add these stable artifacts to the evidence bundle:

```text
physics-context.json
physics-schema-validation.json
physics-scheduler-dag.json
physics-signal-inventory.json
physics-provider-contracts.json
physics-interactions.json
physics-overflow-and-conservation.json
physics-materials-and-proxies.json
physics-presentation-candidates.jsonl
physics-camera-view-publications.jsonl
physics-view-preparation-publications.jsonl
physics-presentation-snapshots.jsonl
physics-frame-execution.jsonl
physics-quality-migration.json
physics-performance-and-traffic.json
physics-sparse-active-domain-costs.json
physics-contact-costs.json
physics-external-adapter-costs.json
images/physics.provider-validity.png
images/physics.interactions-and-reactions.png
images/physics.rebase-residual.png
images/physics.migration-residual.png
images/physics.reactive-and-reset-dag.png
images/physics.coupled-rain-water-boat.png
```

`physics-context.json` records only canonical `PhysicsContext` ownership:
schema/context revision, meters-per-world-unit, world-to-physics transform,
axes/handedness, gravity provider, clocks/charts/frames, physics-origin epoch,
stable entity/material IDs, and capability limits. Candidate/Snapshot artifacts
do not own render transforms: `CameraViewPublication` owns render transforms and
render-origin epochs. `physics-signal-inventory.json`
names every field/provider channel, units, basis, frame, support, sampler/filter,
cadence, current state/resource version, error bound, missing-channel policy,
writer, consumers, and residency. Its joined presentation columns must be
explicitly sourced from each
`PresentedStatePair.previousPresented.provenance` and
`currentPresented.provenance`, which independently own requested/mapped
instants, clock-map revision/error, brackets, interpolation/extrapolation, and
state-handle generations.

`physics-interactions.json` records each canonical `InteractionRecord`: source/
reaction role, exact-once key, `applicationInterval`, frame/origin epoch and
transform revision, target state
equation/version, footprint, tagged payload, units, producer/receiver, reaction
link, validity/error, and provenance. Sequence ranges, ordering outcome,
overflow policy, per-consumer cursor, and lost/deferred commodity amounts belong
only to the corresponding `InteractionBatchLedger` in
`physics-overflow-and-conservation.json`. Repeated presentation frames must not
replay births/impulses; skipped frames must not drop sequence ranges. Overflow
is visible evidence, never silent replacement or truncation.

`physics-materials-and-proxies.json` verifies each explicit render-binding to
`PhysicsMaterialId`, then resolves friction, restitution, compliance, adhesion,
permeability, drag, thermal response, and collision proxies from the versioned
`PhysicsMaterialRegistry`. It never infers a physical property from PBR color,
roughness, or metalness. Proxy parity is an error bound over
support, silhouette/contact distance, mass properties, and interaction
envelope; literal parity with fragment microdisplacement is neither required
nor generally possible.

#### Snapshot schema and lifecycle validation

Run executable schema validators on `PhysicsContext`, `PhysicsGraph`, every
`PhysicsSignalDescriptor`, interaction/material/proxy/migration records,
`PhysicsPresentationCandidate`, `CameraViewPublication`,
`ViewPreparationPublication`, sealed `PhysicsPresentationSnapshot`,
`LightingTransportSnapshot`, `PresentationResourceLease`, GPU resource
descriptors, and `FrameExecutionRecord`. The sealed Snapshot is target/view
specific and references, rather than copies, candidate bindings, camera and
preparation publications, leases, and event ranges. Validate the exact central
schemas and transitive closure; do not mirror a reduced field list in the
harness.

`physics-schema-validation.json` records central schema and validator hashes,
validated artifact hashes, validator revision, positive results, every negative
fixture and expected error code, observed error paths/codes, and the final
decision. Negative fixtures include missing required IDs/units, reciprocal
scale fields, wrong frame/clock, absent channel encoded as zero, stale resource
generation, reused entity slot, mutated snapshot, and reset completion written
into the immutable plan. A command exit code without these results is not
reviewable schema evidence.

Also require:

- independent previous/current presented instants, provenance, state handles,
  and global bindings in each Candidate pair;
- complete previous/current `RenderSimilarityTransform`s, unjittered matrices,
  jitter, viewport/DPR/extent, depth convention, and projection validity in
  `CameraViewPublication`, not only origin epoch numbers;
- per-provider/signal mapped instants and brackets with versions, frames/origin
  epochs/transform revisions, clock-map revision/error,
  interpolation/extrapolation policy, alpha, validity, and uncertainty;
- motion bindings for rigid, skinned, instanced, particle, and procedural
  deformation with stable entity/slot maps and explicit spawn, despawn,
  teleport, reparent, and LOD validity reasons;
- GPU resource generation, layout, entity map, slot/range, access mode, and a
  central `PresentationResourceLease` pinned until every consumer submits and
  its `reuseProhibitedUntil` completion join is satisfied, with retirement in
  `FrameExecutionRecord.leaseDispositionById` plus completion join/evidence;
- lighting metadata for canonical `incidentRadiance`, `surfaceIrradiance`,
  `directSolarIrradiance`, `skyIrradiance`, `transmittance`, and
  `sourceDirection`: spectral basis, quantity, SI unit, filter/support,
  bundle `sampleInstant`, channel `actualPhysicsTime`, state/resource version,
  validity, and error; plus every applied
  atmosphere/cloud/visibility factor in `attenuationFactorIds`.

Validate the time shapes, not only their values. Provenance
`requestedPresentationInstant` and bundle `sampleInstant` are narrow
`PhysicsInstant` values. Provider `requestedPhysicsTime` and channel
`actualPhysicsTime` are `PhysicsTime` wrappers whose discriminant selects
exactly one arm consistent with the signal descriptor's `timeSemantics`; a raw
`PhysicsInstant` or `PhysicsTimeInterval` in either wrapper field fails schema
validation.

The lighting snapshot must be bound by a provider-wide `PresentedStatePair`
with `entityId: typed-absence` in the Candidate and referenced by the sealed
Snapshot. Validate context/provider/signal IDs, descriptor and state/resource
generations, `PresentationStateHandle`, requested/mapped presentation instants,
actual channel times/filters/ages, clock-map revisions/errors, maximum
staleness, validity, and error.

One global lighting label cannot legalize incompatible channel units. Verify
every radiance/irradiance conversion through the declared transport/BRDF stage.

Validate this acyclic publication order:

```text
provider/solver commits and origin rebase
  -> immutable PhysicsPresentationCandidate
  -> per-view CameraViewPublication
  -> per-view ViewPreparationPublication with full leases for newly created
     view resources plus visibility/shadow/cache/reactive/reset refs
  -> seal PhysicsPresentationSnapshot
  -> bind leased resources
  -> depth/velocity/radiance/history/output submissions
  -> append completed actions to FrameExecutionRecord
```

Mutation of Candidate, camera publication, preparation publication, or Snapshot
fails. `ViewPreparationPublication.resetDependencies` is an immutable plan;
completion, failure, queue submission, and fallback action belong only in the
append-only `FrameExecutionRecord`. A declared one-frame-deferred cache schedule
passes only when the current snapshot/render retain the exact prior committed
resource/version and the next snapshot receives the late publication.

Exercise both exceptional paths. Pre-seal failure must produce
`overallStatus: aborted` (or `partial-failure` when another target survives), an
empty/omitted snapshot for the failed target, cancelled/deferred actions, and one
keyed abort disposition for failed-target-exclusive preparation leases while
Candidate leases remain joined to surviving snapshots. Device loss must produce
`overallStatus: device-lost` and affected target statuses `device-lost`, advance
`deviceLossGeneration`, cancel actions, invalidate every lost-generation
resource/lease, and contain no fabricated normal completion token.

Distinguish and record:

```text
logicalStateVersion
resourceGeneration
submissionEpoch
GPU queue availability
host visibility/readback completion
```

Equality or monotonicity among those values is not a completion fence.
`renderer.computeAsync()` does not prove GPU completion. Device loss does not
mutate immutable Candidate/Snapshot evidence; it makes their lost-generation
resource references unusable. Validate rebuild/reseed under the new generation
before accepting another frame.

Motion-vector truth is:

```text
previous clip <- PresentedStatePair.previousPresented at its presented time
current clip  <- PresentedStatePair.currentPresented at currentRenderSampleInstant
```

using each state's `globalBinding` and the complete respective
`CameraViewPublication` render, view, and projection transforms. Solver `n/n+1`
endpoints are only provenance brackets. Particle
compaction moves stable identity, current state, and previous-presented state
atomically. Birth, death, slot reuse, teleport, reparent, or incompatible LOD
marks motion/history invalid instead of borrowing another entity's vector.

#### Scheduler, convergence, errors, and conservation

Serialize the multi-rate scheduler as a DAG containing the coordination
interval, each stage's `clockId`, execution interval, native step rule and
subcycles, reads, writes, interaction collection, source
application, equal-and-opposite reactions, barriers, GPU submissions, snapshot
publication, and presentation interpolation. Validate one writer per signal,
producer-before-consumer ordering, no undeclared cycle, no double advance, no
stale read, no hidden CPU/GPU synchronization, and deterministic tie-breaking.

For each numerical domain, freeze labelled refinement sequences and minimum
sample counts as `Gated` inputs before inspection. Isolate temporal convergence
by refining domain step/subcycles at fixed spatial representation; isolate
spatial convergence at fixed sufficiently resolved time policy; and separately
sweep cross-domain subcycle ratios/coupling iterations over the same physical
interval to measure integrated exchange error. Report native state/residual
norms and observed order or bounded non-asymptotic error. Coupled `dt`+`dx`
refinement alone is insufficient. Discontinuous contact, breaking, and wet/dry
fronts use integral/weak, impulse, arrival-time, or region metrics rather than
invalid pointwise order claims. Analytic/perceptual branches instead prove their
stated phase, response, and frame-rate invariants; do not impose a conservation
claim they never make.

Inject provider failures independently: stale version, missing channel,
out-of-support query, excessive interpolation/extrapolation error, non-finite
value, clock mismatch, unit/frame mismatch, queue/resource unavailability, and
device loss. Every consumer must propagate `validity`/`error`, select its
declared hold/disable/degrade path, and expose the result. Fabricated zero wind,
flat water, identity transform, or silent last-value reuse fails.

For every consumer, serialize an error propagation rule and downstream gate.
For differentiable transforms a valid first-order bound is

```text
Eout >= Emodel (+) combine_i( norm(J_i) * Ein_i )          [Derived]
```

where `(+)` and `combine` are the correlation/norm rules declared by the
central `PhysicsErrorDescriptor`; correlated inputs cannot be root-sum-squared
by convenience. Nonlinear or discontinuous consumers use interval/Lipschitz,
ensemble/confidence, or explicit worst-case propagation appropriate to their
error class. `unknown` remains `unknown`. Acceptance requires
`Eout <= consumerTolerance` with compatible units/basis; relabelling a provider
error as visual noise or dropping it at an adapter fails.

For a conserved scalar/vector `Q`, report:

```text
residualQ = (Q_next - Q_previous)
            - integratedExternalSourcesIntoDomain
            - integratedBoundaryFluxIntoDomain
            - integratedExchangeReactionsIntoDomain
            + integratedPositiveDissipationSink                  [Derived]
```

Every term is integrated over the same interval; sources/fluxes/reactions are
positive into the control domain and dissipation is a nonnegative sink. A
different convention is legal only when the displayed residual is re-derived
and serialized. Apply this gate only to quantities the route declares
conserved or balanced. For exchanged impulse,
momentum, force, heat, mass, or moisture, report both sides and the reaction
residual; one-way coupling is legal only when explicitly declared and excluded
from a two-way conservation claim. Compare tolerances with discretization,
solver, provider, and proxy error bounds instead of hiding leakage in a visual
threshold.

#### Rebase and quality-migration gates

Cross an origin cell while every physical input is otherwise frozen. Compare
global trajectories, pair distances, contacts, provider samples, forces,
shadow light-space coordinates, current/previous presented poses, motion
vectors, and final radiance before/after applying the two complete
global-to-render transforms. A pure rebase has zero physical impulse and no
false temporal velocity. Missing compensation triggers the declared reset; it
does not pass through a wider temporal filter.

A physical quality migration requires a queue-drain/version boundary, a
declared conservative restriction/prolongation or state rebuild, contact-
manifold and warm-start migration/reset, event-cursor preservation, history
policy, and a bounded overlap lifetime. During a visual crossfade, exactly one
representation emits forces/sources/reactions. Compare conserved quantities,
support/contact state, phase, presented pose, and visual contribution before,
during, and after migration. Test round trips and repeated transitions; no
duplicate force, event replay, missing event, identity swap, or unbounded
resource overlap is permitted.

#### End-to-end coupled fixture

Run a deterministic fixture containing this complete chain:

```text
cloud/atmosphere precipitation production
  -> dimensioned rain ground/water flux
  -> water mass/momentum source
  -> boat buoyancy, drag, collision, and equal/opposite reaction
  -> boat displacement/wake source
  -> wave propagation/breaking dissipation
  -> exactly one foam source and one foam history owner
  -> shoreline wetness/infiltration/evaporation state
  -> vegetation moisture/load response
  -> boat/terrain/vegetation contact event and reaction
```

Capture every typed provider sample, source/event range, reaction, state
version, residual, presentation bracket, shadow/radiance reactive publication,
history reset/rejection, and isolated visual contribution. Disable each edge
one at a time and prove that no undeclared path carries the response. Sweep rain
rate, water/boat step ratio, presentation rate, external-pose latency/error,
origin rebase, resize/DPR, solver reset, and quality migration. Include a zero-
forcing equilibrium and a stress/overflow case selected before inspection.

Stock r185 `TRAANode` has neither a reactive-mask input nor a public general
reset. A local reactive-mask claim therefore requires a custom/patched temporal
node with direct evidence. The stock path uses an evidenced rebuild, bypass,
reseed wrapper, or conservative full reset; a diagnostic mask alone does not
change its history.

#### Per-execution, memory, traffic, and mobile evidence

For each domain, provider adapter, interaction queue, presentation stage,
shadow preparation, and post/history consumer, record:

```text
coordination intervals and per-owner native ticks/subcycles
executions and compute dispatches per coordination interval and presented frame
render passes, queue submissions, barriers, and timing-query resolves
readbacks/maps and their latency (steady-state physics/render path normally zero)
active elements, allocated capacity, and occupancy
bytes per element and simultaneously hot slots
compulsory reads/writes/atomics per execution
uploads, downloads, attachment stores/resolves, and queue copies
resident bytes, hot working-set bytes, peak transients, frames-in-flight bytes
quality-migration overlap bytes and lifetime
```

The byte inventory includes solver ping-pong, current and previous presentation
slots, provider brackets, event queues, per-consumer cursors, identity/entity-
slot maps, resource-descriptor/lease rings, reactive masks, histories, staging,
readback, and in-flight frame rings. Derive lower/upper traffic per execution,
multiply by measured executions per presented frame, then by measured
presentation rate. Report queue/timestamp resolution latency separately; do not
attribute a blocking query resolve to solver cost.

For every sparse owner, `physics-sparse-active-domain-costs.json` records
eligible/probed, active-core, halo/ghost/boundary, allocated/high-water, and
component/extent distributions plus detection, scan/sort, compaction,
allocation/indirect-argument, neighbor/halo, and solver phase time/traffic.
Exercise fragmented components, advancing fronts, capacity growth,
deactivation/reactivation, overflow, catch-up, and migration. Reject sparse
claims that measure only the final active kernel or silently deactivate state
without an inactive-model error gate.

For the selected contact owner, `physics-contact-costs.json` records body/shape/
proxy populations, moved bounds, broadphase candidates, narrowphase tests by
shape pair, contacts, manifolds/points, islands/largest island, scalar
constraint rows, iterations/residuals, warm-start/cache behavior, deterministic
reduction, lifecycle events, and reactions. Freeze pileup, high-speed crossing,
sleep/wake, proxy/topology change, cold cache, catch-up, and migration fixtures;
average sparse-contact frames do not prove the tail.

For every external adapter, `physics-external-adapter-costs.json` records batch/
message counts, logical/physical bytes, serialization/conversion, queue and
transport kind, ownership/fence/map/cache effects, remote wait/solve when
observable, deserialization/commit tail, in-flight/staging/recovery memory,
clock-map/staleness work, timeout/retry/duplicate/drop results, and exact-once
outcomes. Dependency-aligned end-to-end adapter latency is mandatory even when
remote attribution is unavailable. Test catch-up, migration, process failure,
and device loss.

Mobile acceptance requires sustained CPU, GPU, presentation, memory, traffic,
allocation, migration-spike, deadline, and settled-quality evidence on the
named physical low-power device. Device labels, desktop emulation, a short warm
trace, or resident bytes without the hot/migration/in-flight set do not pass.

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

### Coupled coastal archipelago

Apply this section when land generation, bathymetry, water, shoreline response,
and procedural asset placement jointly create the result. The supplied
isometric island references require this coupled profile. Read the
[coastal archipelago system](../../threejs-water-optics/references/coastal-archipelago-system.md)
for the algorithm and interface definitions; this section specifies the proof.

#### Reference feature and ownership record

Before implementation, decompose the reference family into falsifiable causes:

```ts
type CoastalEvidenceRecord = {
  referenceImages: {
    id: string
    hash: string
    cropAndScalePolicy: string
    encoding: string
  }[]
  referenceFeatures: {
    islandSilhouettes: string[]
    terrainBands: string[]
    waterDepthAndColorFeatures: string[]
    shorelineAndFoamFeatures: string[]
    assetAndEcologyFeatures: string[]
    cameraProjectionAndCompositionFeatures: string[]
    lightingPaletteFeatures: string[]
    framingAndAtmosphereFeatures: string[]
    deliberateDivergences: string[]
  }
  fieldContract: {
    coordinateFrame: string
    units: string
    coastLevel: NumericDatum
    meanWaterLevel: NumericDatum
    landFieldHash: string
    elevationFieldHash: string
    bathymetryFieldHash: string
    coastFrameDefinition: string
    terrainRegionDefinition: string
  }
  waterBranch: {
    algorithmId: 'analytic-phase' | 'linear-heightfield' | 'spectral-open-water' | 'depth-averaged-flow' | 'hybrid'
    linearVariant?: 'constant-speed-height-grid' | 'fixed-wet-linear-shallow-water'
    coastalTransformId: 'none' | 'coast-sdf-eikonal' | 'wave-action' | 'mild-slope'
    claimedInvariants: string[]
    openWaterOwner: string
    nearshoreOwner: string
    boundaryPolicy: string
    handoffPolicy: string
    simulationExtent: string
    simulationCadence: NumericDatum
    presentationInterpolation: string
    resetConditions: string[]
  }
  assetContract: {
    supportOwner: string
    supportAndExclusionFields: string[]
    stableIdPolicy: string
    placementDistributionTruth: string
    rejectedPlacementAccounting: string
  }
  qualityState: 'Full' | 'Budgeted' | 'Minimum viable'
}
```

The land signed-distance/elevation graph owns the mean coastline and seabed.
Geometry, materials, water boundaries, foam sources, and asset constraints
reference that graph or an explicitly versioned derivative. Independently
painted masks may be accepted only when their registration transform,
resampling policy, provenance, and measured error are recorded. “Looks aligned”
at one camera is not an ownership proof.

Record terrain semantic groups for grass cap, terraces, cliffs, beach, wet
band, submerged shelf, seabed, and reef where present. Record stable island,
terrain-region, water-regime, vegetation, prop, and landmark IDs. Imported
landmark meshes remain asset inputs; the procedural grammar owns their anchor,
orientation, footprint support, clearance, and exclusion—not their authored
vertices.

#### Fixed-view contract

Use immutable matrices and the unjittered projection for geometric error:

| Bookmark | Must expose | Failure-sensitive diagnostics |
| --- | --- | --- |
| `archipelago-overview` | island distribution, negative-water channels, deep/shallow composition, far-water minification | island IDs, bathymetry bands, open/nearshore regime, far normal/foam aliasing |
| `island-design` | complete silhouette, terrace/beach hierarchy, reef, vegetation and landmark composition | coast field, semantic terrain groups, material IDs, support/exclusion occupancy |
| `coast-near` | waterline, cliff/beach join, wet band, stones, shore foam and refraction | predicted instantaneous waterline, rendered boundary, thickness, foam source/history, opaque depth |
| `grazing-water` | Fresnel, normal filtering, reflection/refraction ordering, horizon or far-field stability | resolved normal footprint, regime seam, optical thickness, minification and temporal residual |

Add underwater and water-crossing bookmarks only when those views are claimed.
At every applicable bookmark capture final, no-post, water contribution,
semantic terrain, controlling fields, boundary diagnostics, and the active
history state under the same color/output transform.

For supplied-reference matching, record the projection family, exact matrix,
view direction, crop, subject occupancy, island/landmark screen anchors, and
semantic-region masks. Gate silhouette/landmark boundary and anchor residuals
without free manual image warping. Compare scene-linear luminance/material
response before presentation and output-referred perceptual color after the
same transform, stratified by grass, dry/wet rock, sand, shallow/deep water,
foam, vegetation, and landmark regions. A global palette score may not let the
ocean background hide a failed island or foam region.

#### Land-water registration metrics

Measure both the source contract and the rendered consequence:

- Sample the authored coast level set in world space and compare it with the
  corresponding mean-water intersection of compiled terrain. Store symmetric
  boundary-distance distributions, component/hole disagreement, and worst
  island. The coast iso value and all thresholds are frozen `Gated` or authored
  inputs; the errors are `Measured`.
- For animated water, compute the predicted instantaneous waterline from the
  terrain surface and the same water state used for displacement. Project that
  line with the exact unjittered camera and compare it with a diagnostic raster
  of the rendered land-water boundary in physical pixels. Do not compare a
  moving waterline with only the mean coast contour.
- Within a predeclared coastal mask, classify dry land, submerged land, visible
  water, gap/background, and invalid overlap. Report confusion area, connected
  leak components, and worst-case boundary distance. Exclude true occluders
  with a separately captured depth/ID mask; never hand-edit the error mask.
- Across terrain chunks and LODs, measure positional seam residual, normal-angle
  residual, material-region mismatch, and coast-level mismatch under a frozen
  camera trajectory and forced transition sweep.

For bathymetry, define water depth from the selected surface state and seabed
in one coordinate frame. Capture raw seabed elevation, depth, regime ID,
optical thickness, absorption/transmittance, and output color. Gate field
continuity at chunk/regime boundaries, depth-order monotonicity under the fixed
optical model, and raw clearance `c=eta-z_b` classification:
`c>epsilon_h` is wet and `c<-epsilon_h` is dry outside the frozen wet/dry
hysteresis and uncertainty band. Also report disagreement between
visible shallow/deep bands and the depth field. Color similarity alone cannot
prove bathymetry.

#### Water-branch numerical evidence

Apply only the row corresponding to the declared branch; do not impose a
conservation law on a perceptual analytic surface or excuse a physical claim
from its numerical invariants.

| Branch | Required native-domain evidence | Blocking numerical failure |
| --- | --- | --- |
| analytic phase bands | coast-SDF/eikonal residual, phase-speed and crest-spacing error, displacement-normal agreement, footprint filtering, deterministic time | unrelated normal noise, medial-axis direction failure, far-field aliasing above its gate, frame-rate-dependent phase |
| bounded linear heightfield | explicit constant-speed-grid or fixed-wet elevation/discharge variant; update-equation residual against analytic modes, boundary response, stability, reset, and the variant's energy/volume behavior | variant ambiguity, non-finite state, unstable growth, unexplained boundary energy/volume, reset mismatch, hydrodynamic claim from the constant-speed grid |
| spectral open water | offshore-donor-only declaration, target versus realized spectrum, cascade support/disjointness, inverse-transform tests, derivative agreement, repeat/tiling diagnostics | energy outside declared bands, transform/derivative error, periodic pattern visible above its gate, FFT clipped around land and called coastal propagation |
| depth-averaged flow | well-balanced positivity-preserving Saint-Venant finite-volume contract; non-negative wet depth, lake-at-rest balance, mass versus boundary/source flux, wet/dry-front location, Courant record, and boundary residual | negative depth outside tolerance, non-finite state, lake-at-rest waves, unbounded conservation drift, shoreline leak, unstable wet/dry chatter |
| hybrid | donor, coast-phase/wave-action/mild-slope transform, and optional sparse active-tile evidence; height, slope/normal, energy/statistics, foam-source, and temporal residual across every handoff | visible seam, double-counted energy, phase jump, divergent clocks, two geometric owners, transform stage hidden inside an FFT or shallow-water label |

Store the residual field and its distribution, not only a pass flag. If a
solver step is decoupled from presentation, record step timestamps, executions
per presented frame, interpolation state, dropped/capped steps, and the effect
of a presentation-rate sweep. A lower update cadence passes only if both the
native numerical gate and the rendered temporal-error gate pass.

For a `hybrid`, validate the declared coastal transform independently:

| Coastal transform | Required evidence | Claim boundary |
| --- | --- | --- |
| coast-SDF/eikonal phase | coast-distance and eikonal residual, travel-time/crest-speed error, coast-ID/medial-axis ambiguity, footprint-filtered crest width | prescribed phase only; no diffraction, reflection, mass, momentum, or wave-action conservation claim |
| wave action/rays | finite-depth dispersion and group velocity by band, phase curl/loop closure, refraction against analytic cases, incident/outgoing/dissipated/clipped action balance, ray-density/caustic regularization | no diffraction or standing interference unless another wave solver owns it |
| mild slope | manufactured/analytic convergence, radiation-boundary residual, phase/amplitude, reflection and diffraction/interference error over the accepted fixed bathymetry | no breaking, nonlinear run-up, moving bathymetry, or wet/dry conservation claim |

For an offshore-to-coastal hybrid, validate the transfer representation rather
than only its blended image:

- A phase-resolved boundary stores frequency, physical wavevector, complex
  phase/amplitude, depth/current/time origin, and finite-depth dispersion. Gate
  the elevation-to-wave-discharge relation and prescribe only the incoming
  characteristic; measure reflected outgoing energy instead of overwriting it.
- A phase-averaged boundary converts surface-elevation variance to physical wave
  energy, transports action `N = E / omega_intrinsic` under the declared current,
  and reports incident, outgoing, dissipated, and clipped action/energy by band.
- The same coherent mode has one full-amplitude owner. If a render-only overlap
  is unavoidable, coherent amplitude weights sum to unity as a `Gated`
  invariant, and position, velocity, and tangents include spatial weight-
  derivative terms. Square-root power windows are eligible only for disjoint or
  measured zero-covariance bands.
- Breaking/whitecap dissipation has one ledger owner and maps once into one foam
  source/history. Two independently blended foam histories fail ownership even
  when their final opacity looks continuous.

#### Foam, wet line, and obstruction evidence

Separate foam generation, transport/history, and shading. Capture source
probability or impulse, coast/breaker/obstacle masks, current or transport
field, previous history, next history, age/decay, and final opacity. Evaluate:

- source precision/recall against the declared coast-distance, breaker, impact,
  wake, or obstruction rule using thresholds frozen before inspection;
- foam occupancy on dry land, across excluded geometry, or outside the maximum
  admissible source/transport envelope;
- source-to-visible response latency, advection residual along the declared
  transport field, decay-law residual, detached-component lifetime, temporal
  flicker energy, and reset residue;
- continuity and width distributions along shoreline arcs in world space and
  physical pixels, stratified by beach, cliff, rock, dock, and open-water
  segments rather than averaged across the whole image;
- wet-line distance and hysteresis relative to the instantaneous/mean waterline,
  with tide or run-up ownership declared when present.

Decorrelated screen-space noise does not pass as shore foam. A static coast
ribbon may be valid for `Minimum viable` perceptual output, but it must be
declared static, remain registered through camera/LOD changes, and must not be
described as simulated transport or breaking.

#### Asset and ecology evidence

For every generated or placed asset, record stable ID, grammar/species, island
and chunk owner, support sample, support normal, footprint samples, coast
distance, slope, exposure/moisture/salt inputs where used, exclusion results,
orientation frame, scale/variant, LOD, and rejection reason. Validate:

- support penetration and floating distance over the whole footprint, not only
  the pivot;
- normal/up alignment, slope and coast-distance gates, footprint clearance,
  dock/water access direction, and landmark exclusion zones;
- empirical placement distributions against the authored conditional density,
  including empty islands and overcrowded stress seeds;
- stable-ID and deterministic-seed correspondence across rebuild, chunk order,
  culling, LOD transition, and quality changes;
- retained landmark composition and readable population hierarchy at every
  accepted quality state.

Capture both accepted and rejected candidates. Silently discarding failed
placements biases the distribution and hides impossible grammar constraints.

#### Seed, trajectory, and quality matrix

Choose representative and stress seeds before candidate inspection. The seed
set must cover coastline complexity, narrow channels, tiny islands, steep
cliffs, broad beaches, dense/sparse asset populations, near-touching exclusion
regions, and the selected water branch's boundary stress. Report the selection
rule and population statistics; do not replace a failed seed after viewing it.

Run deterministic trajectories for reset/still water, steady forcing, stronger
forcing, local disturbance, camera motion, LOD crossing, resize/DPR,
`Full`/`Budgeted`/`Minimum viable` transitions, and sustained evolution as
applicable. Validate state immediately before, during, and after each change.
Tier transitions update simulation extents, texel metrics, interpolation,
history allocation/reset, coastline transforms, and diagnostic metadata as one
transaction.

Every quality state preserves island/coast identity, terrain-region ordering,
bathymetric depth order, displacement-normal agreement, foam cause, landmark
support, deterministic IDs, and output-transform ownership. Allowed reductions
must name their visible consequence and pass the associated frozen error gate.
Do not assume `Full` for desktop or `Minimum viable` for mobile; measure each
eligible state on each named physical target.

#### Coastal work, memory, and bandwidth ledger

Separate generation, simulation, and presentation scopes:

```text
field/mesh/scatter regeneration: invocation cause, CPU/GPU time, uploads, output bytes
water step: algorithm branch, active extent, state layout, dispatches, reads/writes, step timestamp
foam step: source/transport/decay layout, history ping-pong, update cadence
opaque scene: visible chunks/assets, draw and backend multi-draw entries, attachments
water composite: opaque color/depth inputs, water targets, load/store/resolve, overdraw
presentation: tone map, output transform, upsample when present
```

Derive state and traffic records from labelled inputs:

```text
state bytes [Derived]
  = sum over resources(active elements * bytes per element * simultaneously live slots)

step traffic lower bound [Derived]
  = sum over resources(active elements * compulsory accesses per element * bytes per access)

presented-frame simulation traffic [Derived]
  = sum over update keys(step traffic * measured executions per presented frame)
```

Inventory bathymetry/coast fields, water state, spectral intermediates when
selected, foam histories, caustic fields, opaque scene color/depth copies,
water targets, asset instance data, terrain/asset geometry, staging, and
readback. Record active versus allocated extents, dirty/update regions, pass
breaks, attachment stores/resolves, transient overlap, upload churn, and
quality-transition allocation spikes.

For each named physical desktop-discrete, integrated, and low-power/mobile
target, record viewport, DPR, actual refresh, frozen presentation rate, cold
and sustained CPU/GPU/presentation distributions, simulation and foam cadence,
deadline misses, settled quality state, logical live bytes, peak transients,
traffic model, and quality drift. Device-class labels imply no universal
millisecond, grid, memory, or bandwidth budget. A GPU-performance verdict
without required timestamp coverage is `INSUFFICIENT_EVIDENCE_GPU_TIMING`.

#### Bundle additions and rejection gates

Add these artifacts under the normal evidence-bundle path when applicable:

```text
coastal-fields.json
coastal-water-branch.json
coastal-alignment-errors.json
coastal-asset-inventory.json
asset-placement-evidence.json
images/reference.camera-and-anchors.png
images/reference.semantic-region-color-error.png
images/coast.field.png
images/coast.predicted-waterline.png
images/coast.rendered-boundary.png
images/coast.alignment-error.png
images/bathymetry.depth.png
images/bathymetry.optical-thickness.png
images/water.regime-and-boundary.png
images/foam.source.png
images/foam.history.png
images/foam.leakage-and-temporal-error.png
images/assets.support-and-exclusion.png
images/quality.full.png
images/quality.budgeted.png
images/quality.minimum-viable.png
```

Reject or narrow the coastal claim on any required field/owner mismatch;
visible gap, overlap, coast swimming, or LOD crack; bathymetry/optics
contradiction; foam detached from its declared source; refracted geometry
crossing an opaque occluder; non-finite/invalid water state or normal; failed
branch-specific invariant; unbounded history; unstable reset; floating/buried
landmark; forbidden vegetation support; seed instability; quality transition
outside a visual gate; omitted active-state/traffic resource; or insufficient
timing evidence for the performance claim.

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
