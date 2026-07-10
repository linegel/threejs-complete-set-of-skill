---
name: threejs-image-pipeline
description: Build a minimal, workload-selected WebGPU/TSL final-image pipeline for advanced Three.js scenes. Use for RenderPipeline ownership; conditional pass()/mrt() depth, normal, albedo, emissive, velocity, and history signals; GTAONode, BloomNode, TRAANode, exposure, tone mapping, 3D LUT grading, outputColorTransform, diagnostics, and measured quality/performance tradeoffs.
---

# Image Pipeline

Use this coordinator when several image-space systems share a scene pass,
depth, color attachments, history, ordering, or final output. For one isolated
effect, load its atomic skill.

Route only what the graph needs:

- `$threejs-ambient-contact-shading` for `GTAONode` and indirect-light use;
- `$threejs-bloom` for `BloomNode` and emissive policy;
- `$threejs-exposure-color-grading` for metering, EV adaptation, tone mapping,
  LUT domains, and output conversion;
- `$threejs-dynamic-surface-effects` for feature-local screen history;
- `$threejs-visual-validation` for fixed-view, timing, and leak evidence.

Read
[references/production-image-pipeline.md](references/production-image-pipeline.md)
before implementation.

## Numeric Evidence Rule

Tag every number:

- `[Derived]`: formula, dimensions, format, or verified API consequence;
- `[Gated]`: enabled only after a named capability/correctness gate;
- `[Measured]`: captured on a named target and complete graph;
- `[Authored]`: a deliberate quality/look/controller starting point.

This applies to attachment counts, formats, byte costs, resolution scales,
workgroup sizes, history lengths, timing thresholds, DPR limits, hysteresis,
and frame budgets.

## Required Architecture

Lead with one `WebGPURenderer`, one `RenderPipeline`, and one primary
`pass(scene, camera)` `[Authored: baseline architecture]`. Add only the MRT
outputs whose measured alternative is worse. "One pass plus every possible
gbuffer" is not a performance rule, especially on a tile GPU.

Depth is the pass depth texture; it is not a color output in `mrt()`.

Default order:

```text
primary scene pass: HDR output + depth + selected MRT outputs
  -> effect-local lighting histories, such as temporal AO
  -> lighting-aware AO / atmosphere and layers admitted to temporal history
  -> temporal reconstruction of stable scene radiance, when complete
  -> transparent/refractive layers excluded from that history
  -> exposure meter tap from resolved pre-bloom HDR by default
  -> bloom / glare and other scene-linear optical effects
  -> adapted exposure
  -> tone map
  -> grade in its declared domain
  -> one output conversion
  -> display-domain antialiasing / dither / UI
```

Temporal resolve precedes exposure by default so history remains in stable
scene radiance. Bloom follows temporal resolve by default to avoid reprojecting
broad depthless glare. Deviations require a named history/exposure contract.

Use built-in nodes first. A custom pass must add a measured capability, not
duplicate a private built-in target.

## Native WebGPU Gate And r185 Surface

```js
// Numeric/API literals: [Gated: installed three@0.185.1 source]
import {
  HalfFloatType,
  RenderPipeline,
  WebGPURenderer
} from 'three/webgpu';

const renderer = new WebGPURenderer( {
  antialias: false,
  outputBufferType: HalfFloatType,
  trackTimestamp: true
} );

await renderer.init();
if ( renderer.backend.isWebGPUBackend !== true ) {
  throw new Error( 'Native WebGPU is required for this image pipeline.' );
}

const canTimeGpu = renderer.hasFeature( 'timestamp-query' );
const renderPipeline = new RenderPipeline( renderer );
```

Verified r185 APIs used by this skill:

- `RenderPipeline.render()`, `outputColorTransform`, `needsUpdate`;
- `pass()`, `mrt()`, `PassNode.setResolutionScale()`, `setMRT()`,
  `getTextureNode()`, `getViewZNode()`, `getLinearDepthNode()`,
  `compileAsync(renderer)`;
- `ao(depth, normalOrNull, camera)` with the public
  `GTAONode.resolutionScale` property;
- `bloom(input)` with `BloomNode.setResolutionScale()`;
- `traa(beauty, depth, velocity, camera)` and `TRAANode.setViewOffset()`;
- `renderOutput()` and TSL `toneMapping()`.

`PostProcessing` is the deprecated historical name for `RenderPipeline`; do
not teach it. Do not teach a WebGPU-unavailable route here. If the user
explicitly asks how to apply fallback when WebGPU is unavailable, route to
`$threejs-compatibility-fallbacks`.

## Build Order

- Declare physical canvas pixels, target frame time, target browser/GPU,
  primary visual contract, and no-post baseline.
- Write the signal table: producer, consumers, coordinate/color domain,
  physical format, resolution, first write, last read, history, disable path,
  and bytes.
- Create the primary `pass(scene, camera)` and request depth.
- Compare each candidate MRT output against reconstruction or a narrow rerender
  on the target device. Add only winners.
- Compose lighting, atmosphere, and only the layers with valid temporal signals
  before temporal color history.
- Add temporal reconstruction only after velocity, jitter, rejection, and reset
  contracts pass diagnostics.
- Composite transparent/refractive layers excluded from history after the
  temporal resolve and before the photographed meter tap.
- Tap exposure before bloom by default; apply exposure after temporal history.
- Assign tone-map, LUT-domain, and output-conversion ownership once.
- Compute peak live resident bytes and bandwidth separately. Do not claim
  aliasing for built-in private targets.
- Add adaptive DPR only after fixed-DPR graph timings exist.

Use `examples/webgpu-image-pipeline/` as a public-API baseline and
`validateImagePipelineConfig.js` as a graph gate before browser validation.

## Conditional MRT Rule

For candidate attachment `a`, compare:

```text
costMRT(a) = fragment export + attachment store + later reads        [Measured]
costAlt(a) = reconstruction or narrow rerender + its memory traffic  [Measured]
```

Keep `a` only when `costMRT(a) < costAlt(a)` and peak resident memory stays
inside the declared budget. On tile GPUs, an attachment sampled by a later pass
must normally leave tile memory; an MRT can save scene traversal yet still lose
to bandwidth.

Practical candidates:

- normal: omit and pass `null` to `ao()` when depth reconstruction is cheaper;
  retain when several consumers need stable geometric normals;
- emissive: retain only for selective bloom; otherwise bloom from HDR color;
- velocity: retain only while temporal consumers are enabled;
- albedo/base color: r185 exports `diffuseColor`, not `albedo`; use a named MRT
  mapping such as `albedo: diffuseColor.rgb` only when a real composite consumes
  it;
- material/object IDs: add only with a concrete rejection or classification
  consumer.

r185 `PassNode` creates additional named attachments by cloning the output
texture. Do not budget compact `RG16F` velocity or `RGBA8` normals unless the
physical texture format is explicitly configured, compiled, and verified; the
default HDR pass can otherwise allocate all named attachments at its HDR output
format.

## Temporal Contract

Three.js r185 `VelocityNode` writes:

```text
velocityNDC = currentNDC.xy - previousNDC.xy            [Derived: r185 source]
```

Its built-in `TRAANode` converts that to texture UV with a Y flip:

```js
// Constants are [Derived: r185 TRAANode source].
const offsetUV = velocityTexel.xy.mul( vec2( 0.5, - 0.5 ) );
const previousUV = currentUV.sub( offsetUV );
```

Do not use `currentUV - velocity * 0.5` for both axes. The sign mismatch ghosts
vertical motion.

Before enabling temporal output, declare:

- velocity producer for rigid, instanced, skinned, and procedurally deformed
  geometry actually present;
- jitter owner and whether velocity includes jitter;
- depth convention and rejection domain;
- history color domain and exposure used to create it;
- reset events: resize/DPR, cut, projection change, scene load, discontinuous
  deformation, format change, and invalid velocity;
- current/history/rejection/velocity diagnostics.

`traa()` requires a texture input. Passing a composite node causes r185 to
materialize an additional full-resolution `RTTNode` (color target and fullscreen
draw, with default depth unless explicitly disabled). Account, own, and dispose
that target. Stock TRAA also requires scene color/depth/velocity/input extents to
match the drawing buffer; a scaled scene pass is not a silent TAAU path.

`TRAANode` requires MSAA disabled `[Gated: r185 source]`. r185 exposes no public
general `reset()` method; resize is handled internally, while cuts and other
discontinuities need a validated wrapper policy or node rebuild/disposal.

### Physics presentation and reactive radiance

When the route manifest declares a physics-to-render boundary, it first
publishes a view-independent immutable `PhysicsPresentationCandidate`, then one
`CameraViewPublication` per target/view, then `ViewPreparationPublication` for
visibility/shadow/cache/reset results, and finally seals
`PhysicsPresentationSnapshot`. Bind the scene pass to that exact publication
chain and bind the matching
`LightingTransportSnapshot` through a provider-wide `PresentedStatePair`
(`entityId: typed-absence`) referenced from the candidate by the Snapshot, from the
[physics domain and interaction contract](../threejs-choose-skills/references/physics-domain-and-interaction-contract.md).
Validate the exact central Candidate, camera publication, preparation
publication, Snapshot, `PhysicsSignalDescriptor`, and lighting-channel schemas
rather than defining a post-local subset. The target/view Snapshot contains
references, not copied pairs, transforms, or reset records. Resolve stable
binding pairs through `presentedStatePairRefs`, previous/current render instants
and complete transforms/matrices through `cameraPublicationId`, and reactive/
reset records through `viewPreparationId`. A post node may not sample a different provider bracket
or silently mix radiance and irradiance. Match the lighting pair's context,
provider/signal IDs, descriptor/state/resource generations,
`PresentationStateHandle`, each state's requested presentation instant, mapped
source instant and clock-map revision/error, plus the bundle `sampleInstant`;
validate channel `actualPhysicsTime`, filter/age, maximum staleness, validity,
and error.

Canonical lighting-provider channels remain SI-valued. A normalized RGB working
buffer is a separately named render-local signal derived through a versioned
SI-to-render conversion with reference scale, provenance, and error; it is not a
normalized `LightingTransportSnapshot` channel. A nonphysical image route keeps
the router physics fields `not used` and declares its render-local color basis
without instantiating this ABI.

Velocity is projected from the pair's independent `previousPresented` and
`currentPresented` state handles/global bindings, using the corresponding
previous/current `RenderSimilarityTransform` and unjittered matrices from
`CameraViewPublication`. Each provider's fixed-step states only bracket each
presented sample through `PresentationSampleProvenance`; they are not the
previous/current rendered poses. Bindings cover rigid,
skinned, instanced, and procedural deformation and explicitly invalidate
spawn/despawn/teleport/reparent/LOD changes. A rebase must disappear after
origin compensation, not become a full-screen motion vector.

Velocity projects unjittered previous/current view and projection matrices;
the temporal owner applies jitter separately. Stock r185 `VelocityNode` is
gated to one presentation history and one velocity-bearing render per object
per presented frame, with built-in previous-state coverage sufficient for the
rendered rigid/skinned/instanced/deformation path. It is not target/view keyed.
Multiple views/targets, multiple velocity passes, or arbitrary snapshot-bound
previous deformation require a custom velocity path consuming the central
presented pairs and leased resources.

The camera owner returns `CameraViewPublication`; view-preparation owners return
`ViewPreparationPublication`; no phase mutates an earlier record. Feedback that cannot precede the seal is
explicitly one-frame deferred; the current render continues to sample the
prior committed version named by its snapshot.

The route serializes typed view-scoped `reactivePublications` and
`resetDependencies` in `ViewPreparationPublication`. At minimum,
dependency edges cover solver reset/quality migration, uncompensated origin or
projection change, shadow-content commit, and discontinuous foam, emissive, or
optical state. Use a conservative full reset when no reliable affected-pixel
mask exists; otherwise a custom/patched temporal node may consume a versioned
reactive mask. Stock r185 `TRAANode` has no reactive-mask input or public
general reset, so its executable choices are evidenced rebuild, bypass/reseed
wrapper, or conservative full reset—not a diagnostic mask alone.

Each publication uses the exact central view-scoped record: source/version/
epoch, kind (`shadow-content`, `foam`, `emissive`, `optical`, `topology`,
`deformation`, `disocclusion`, or `event`), full-frame or leased mask
affected-region form, validity/error, and planned history action. A mask ID
without descriptor, alignment, error, resource generation, and retirement
lease is invalid.
Do not reset exposure for every local radiance edit. Reset or analytically
convert exposure state only when the radiance basis/calibration, working
primaries, quantity convention, or authored exposure key changes.

Execute the dependency DAG before the first consumer of the new epoch:

```text
presentation candidate
  -> CameraViewPublication with transforms/matrices/jitter/depth
  -> ViewPreparationPublication with visibility/shadows/reactive/reset records
  -> seal snapshot references
  -> depth + velocity + scene-linear radiance
  -> AO/surface/volumetric/color history rejection or reseed
  -> resolved meter source
  -> exposure adaptation
  -> bloom, tone map, grade, output
```

Every planned edge names its writer, consumers, and action. The immutable
snapshot does not claim completion; append actual rebuild/reseed/submission
results to a separate `FrameExecutionRecord`. GPU descriptors pin resource
generation, layout, entity map, slot/range, and a central
`PresentationResourceLease` until all consumers submit and its
`reuseProhibitedUntil` completion join is satisfied; retirement is recorded in
`FrameExecutionRecord.leaseDispositionById`.
Logical state version, submission epoch, GPU queue
availability, and host visibility are distinct; `computeAsync()` is not a
fence.

A required camera/shadow/cache or sealing failure appends a
`FrameExecutionRecord` with `overallStatus: aborted` (or `partial-failure` when
other targets survive), omits that target's snapshot from `snapshotIds`, stores
typed absence in its `targetExecutions.snapshotId`, cancels or defers actions,
retires only failed-target-exclusive preparation leases, and retains
Candidate/shared leases until all surviving snapshot consumers join through
`leaseDispositionById`. Device loss
appends `overallStatus: device-lost` and affected target statuses
`device-lost`, advances
`deviceLossGeneration`, cancels dependent actions, and invalidates resources
and leases from the lost generation without inventing a completion token. The
immutable Candidate/Snapshot remain audit records; their lost-generation
resource references are no longer bindable. Rebuild histories and timing proof
under the new backend/resource generation.

Even with compensated custom velocity, stock r185 `TRAANode` cannot preserve
history across a render-origin translation or tangent-basis rebase because its
previous-depth reconstruction has no previous-render-to-current-render bridge.
Rebuild/reseed it on every such rebase. Only a custom/patched temporal node
that consumes both complete global-to-render transforms may preserve history
after an invariance proof.

## Output Ownership

- source color textures tagged with an sRGB transfer use `SRGBColorSpace`;
- linear HDR sources and working render targets remain in the registered
  working space;
- normals, masks, velocity, depth, LUT transform data, and histories that are
  not colors use `NoColorSpace`/data semantics;
- choose the HDR working format from required range, precision, filtering,
  blending, target support, and measured bandwidth. `HalfFloatType` is a common
  candidate, not a universal requirement `[Gated]`;
- one tone-map owner, one working-to-output conversion owner;
- a scene-linear LUT needs a shaper for unbounded HDR;
- a tone-mapped-linear LUT sits after `toneMapping()` and before
  `renderOutput(..., NoToneMapping, outputColorSpace)`;
- a display-encoded LUT sits after `renderOutput()` and receives no second
  conversion;
- explicit `renderOutput()` requires
  `RenderPipeline.outputColorTransform = false`.

## Lifetime And Adaptive Resolution

r185 has no public transient render-graph alias allocator. Built-in
`BloomNode`, `GTAONode`, and `TRAANode` own persistent private render targets.
Count all of those allocations. Custom target reuse is legal only for
non-overlapping lifetimes with identical dimensions, format, sample count, and
usage; history and diagnostic pins never alias.

Adaptive DPR uses sustained GPU pressure, asymmetric hysteresis, and a cooldown.
It must distinguish scalable pixel work from fixed work, quantize changes to an
authored step, and reset/reseed every affected history. The complete controller
and formulas live in the reference.

## Composable Budget Contract

Never add a coordinator's full-post cost to the absolute costs of effects it
already contains. Use:

```text
fullGraph = measured end-to-end GPU frame                            [Measured]
marginal(effect | graph) = graphWithEffect - identicalGraphWithout  [Measured]
```

For planning only:

```text
estimatedGraph = measuredBase + sum(measuredMarginals) + interactionReserve
```

`interactionReserve` is `[Authored]` until the assembled full graph is
`[Measured]`; then the full-graph measurement wins. Every result states canvas
physical pixels, DPR, enabled graph, warmup, statistic, browser, and GPU.

r185 render/compute timestamp pools sum instrumented pass durations. They do
not automatically include copies, barriers, submission gaps, or presentation;
do not label their sum end-to-end `fullGraph` without an independent scope gate.

For parent physical extent `W * H`, scale `s`, texel bytes `b`, sample count
`m`, array layers `l`, and retained allocation slots `k`, the uncompressed
payload lower bound is:

```text
Wp = floor(W * s)                                         [Derived: r185 PassNode]
Hp = floor(H * s)                                         [Derived: r185 PassNode]
bytes >= Wp * Hp * b * m * l * k                          [Derived]
```

Use the dimensions actually reported by the target; backend alignment,
compression, resolves, allocator granularity, and private targets are outside
that payload equation. Count resident bytes and peak live bytes separately;
sum bandwidth only for actual reads/writes.

## Rules

- the primary scene pass is the baseline; extra scene renders need a measured
  reason;
- depth is shared from the pass, not duplicated as an MRT color attachment;
- MRT is conditional, not a completeness checklist;
- apply AO only to the indirect-light term it models;
- use depth/normal-aware reconstruction for reduced effects;
- keep temporal history in a stable pre-exposure domain by default;
- exclude UI/debug from exposure and HDR bloom unless intentionally authored;
- call `scenePass.compileAsync(renderer)` only after MRT and texture-node
  requests are complete;
- set `renderPipeline.needsUpdate = true` after output-graph changes;
- expose disable paths, effect-only views, physical formats, peak bytes, and
  timings in production diagnostics;
- dispose removed node effects and their targets.

## Routing Boundary

Use this skill for shared buffers, ordering, history, lifetimes, adaptive DPR,
budgets, or final output. Use an atomic skill for one isolated effect and return
here only when it joins the shared graph.
