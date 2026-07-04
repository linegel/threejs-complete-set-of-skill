# Graphics Validation Protocol

Use this protocol to validate authored Three.js graphics on the current
WebGPU/TSL path: deterministic final frames, mechanism-isolation views,
temporal evidence, seed sweeps, renderer/backend manifests, GPU timing,
resource inventories, leak loops, and explicit budgets.

## Contents

- Acceptance principle
- Fastest validation architecture
- Capability gate and quality tiers
- Evidence bundle
- Visual contract
- Automation contract
- Renderer and backend manifest
- Node pipeline evidence
- Target and storage inventories
- Timing and budgets
- Color and output
- Required inspection controls
- Mechanism-specific evidence
- No-post and isolation gates
- Determinism and captures
- Temporal validation
- Resource lifetime validation
- Rejection criteria
- Sign-off record

## Acceptance Principle

Accept an implementation only when all four layers agree:

```text
declared visual mechanism
  -> inspectable WebGPU/TSL implementation
  -> machine-readable diagnostic evidence
  -> final image that satisfies the visual contract
```

Code plausibility is insufficient. A visually weak result means the mechanism
is incomplete, misweighted, under-sampled, or badly presented. A beautiful final
frame is also insufficient when it hides field instability, broken depth,
temporal failure, bad color ownership, or dependence on presentation treatment.

## Fastest Validation Architecture

Build validation as an authored contract bundle from the start:

1. Deterministic runner: fixed seed, fixed time, fixed camera matrices, fixed
   viewport, DPR, quality tier, asset revisions, and explicit stochastic masks.
2. WebGPU/TSL pipeline: `WebGPURenderer`, TSL node materials, `RenderPipeline`,
   `pass()`, `mrt()`, built-in post nodes, and compute/storage resources where
   the subject system uses GPU-side simulation or generated data.
3. Evidence capture: final, no-post, diagnostic mosaic, near/design/far camera
   views, representative seed sweep, stress seeds, temporal checkpoints or
   clip frames, and failure-sensitive debug views.
4. Metrics capture: `renderer.info`, target inventory, storage inventory,
   dispatch count, pass count, draw calls, primitives, CPU frame time, GPU
   timestamp timing when exposed, median, p95, and readback/capture overhead.
5. Stability capture: resize, tier switch, reset, history clear, device-error
   surfacing, teardown, dispose/recreate loops, and before/after resource
   metrics.

This replaces informal screenshot review. Algorithm class dominates validation
quality: machine-readable contracts and direct GPU evidence catch failure modes
that a final image can hide.

## Capability Gate And Quality Tiers

Every validation surface records the actual backend and chooses a quality tier.
Compute/storage/MRT evidence must use this gate:

```js
await renderer.init();

const capabilities = {
  threeRevision: THREE.REVISION,
  renderer: 'WebGPURenderer',
  isPrimaryBackend: renderer.backend.isWebGPUBackend === true,
  outputColorSpace: renderer.outputColorSpace,
  toneMapping: renderer.toneMapping,
  toneMappingExposure: renderer.toneMappingExposure,
  samples: renderer.samples,
  reversedDepthBuffer: renderer.reversedDepthBuffer,
  logarithmicDepthBuffer: renderer.logarithmicDepthBuffer,
  outputBufferType: renderer.getOutputBufferType(),
  coordinateSystem: renderer.coordinateSystem,
  compatibilityMode: renderer.backend?.compatibilityMode ?? null,
  trackTimestamp: renderer.backend?.trackTimestamp ?? null,
  limits: renderer.backend?.device?.limits ?? null,
  features: renderer.backend?.device?.features ? [ ...renderer.backend.device.features ] : null,
  unavailableReason: renderer.backend?.device ? null : 'renderer.backend.device unavailable',
  initialized: renderer.initialized
};

if (renderer.backend.isWebGPUBackend === true) {
  qualityTier = 'native-compute';
} else {
  throw new Error('WebGPU backend required for canonical visual validation.');
}
```

Quality tiers are native WebGPU evidence tiers, not separate recipes:

| Tier | Use when | Expected evidence | Allowed reduction |
| --- | --- | --- | --- |
| `native-compute` | primary backend exposes compute/storage path | full compute, MRT, timing, storage, and temporal evidence | none beyond declared quality settings |
| `native-budgeted` | primary backend is present but budget is exceeded | same architecture with smaller grids, fewer passes, lower diagnostic resolution, or fewer temporal samples | visible loss must be named |

Do not silently lower quality until a frame looks fast enough. Record the
preserved mechanism and the expected visual loss for every native WebGPU
budget setting. The Node harness may emit `node-schema-fixture` only for schema
self-tests; browser validation must replace fixture PNGs and unavailable
backend fields with WebGPU evidence.

## Evidence Bundle

Write artifacts to a stable directory:

```text
artifacts/visual-validation/<scene-id>/<three-revision>/<tier>/<seed>/
  evidence-manifest.json
  renderer-info.json
  render-targets.json
  storage-resources.json
  timings.json
  leak-loop.json
  images/
    final.design.png
    no-post.design.png
    diagnostics.mosaic.png
    camera.near.png
    camera.design.png
    camera.far.png
    seed-0001.final.png
    seed-stress.final.png
    temporal.t000.png
    temporal.t001.png
```

The bundle must be reviewable without rerunning the scene. Paths are stable so
CI and human review can diff the same fields and PNGs.

## Machine-Readable Artifact Schemas

`examples/webgpu-validation-harness/src/schema/artifact-schemas.js` is the
canonical schema implementation for Phase 1. Every bundle must validate these
required files before success:

| File | Required fields |
| --- | --- |
| `visual-contract.json` | `subject`, `identity`, `invariants`, `invariantArtifacts`, `requiredImages`, `requiredDiagnostics`, `requiredMetrics`, `blockingFailures`, `frameBudgetMs`, `memoryBudgetMB` |
| `evidence-manifest.json` | `skill`, `sceneId`, `threeRevision`, `browser`, `os`, `gpuAdapter`, `renderer`, `backend`, `qualityTier`, `viewport`, `camera`, `seed`, `time`, `assets`, `colorPipeline`, `postStack`, `thresholds`, `stochasticMasks`, `knownCompromises` |
| `renderer-info.json` | `threeRevision`, `renderer`, `isPrimaryBackend`, `coordinateSystem`, `initialized`, `outputBufferType`, `compatibilityMode`, `trackTimestamp`, `features`, `limits`, `unavailableReason`, `info` |
| `render-targets.json` | `required`, `targets`, `totalBytes` |
| `storage-resources.json` | `required`, `resources`, `totalBytes` |
| `timings.json` | `required`, `warmupFrames`, `sampleFrames`, `cpuFrameMs`, `gpuFrameMs`, `gpuTimingUnavailable`, `gpuTimingLabel`, `renderTimestampMs`, `computeTimestampMs`, `qualityTierChanges` |
| `leak-loop.json` | `required`, `loops`, `summary`, `allowedCacheNotes` |

Required images include `images/final.design.png`,
`images/no-post.design.png`, `images/diagnostics.mosaic.png`, near/design/far
camera captures, seed sweep captures, and temporal checkpoints. PNG captures
must pass a nonblank assertion. Regression comparisons use fixed camera matrix
and projection matrix records, named mask files for stochastic regions, and
per-view thresholds. Reproducing a comparison by manually orbiting the view is
invalid evidence.

### `evidence-manifest.json`

```ts
type EvidenceManifest = {
  skill: 'threejs-visual-validation'
  sceneId: string
  threeRevision: string
  browser: string
  os: string
  gpuAdapter?: string | null
  renderer: 'WebGPURenderer'
  backend: {
    isPrimaryBackend: boolean | null
    coordinateSystem: string | number | null
    initialized: boolean
    deviceLostObserved: boolean
    uncapturedErrors: string[]
    features: string[] | null
    limits: Record<string, number | string | boolean> | null
    unavailableReason: string | null
  }
  qualityTier: 'native-compute' | 'native-budgeted' | 'node-schema-fixture'
  viewport: { width: number; height: number; dpr: number }
  camera: {
    bookmark: 'near' | 'design' | 'far' | string
    matrixWorld: number[]
    projectionMatrix: number[]
    near: number
    far: number
    fov?: number
  }
  seed: string | number
  time: { fixed: boolean; seconds: number; frame: number }
  assets: { id: string; url?: string; hash?: string }[]
  colorPipeline: ColorPipelineRecord
  postStack: PostStackRecord
  thresholds: ThresholdRecord
  stochasticMasks: MaskRecord[]
  knownCompromises: string[]
}
```

## Visual Contract

Write this before tuning:

```ts
type VisualContract = {
  subject: string
  identity: string[]
  silhouette: string[]
  materialSeparation: string[]
  motion: string[]
  cameraEnvelope: {
    near: number
    design: number
    far: number
  }
  lightingEnvelope: string[]
  invariants: string[]
  invariantArtifacts: Record<string, {
    requiredImages: string[]
    requiredDiagnostics: string[]
    requiredMetrics: string[]
    blockingFailures: string[]
  }>
  requiredImages: string[]
  requiredDiagnostics: string[]
  requiredMetrics: string[]
  blockingFailures: string[]
  allowedDivergences: string[]
  frameBudgetMs: {
    desktopDiscrete: number
    desktopIntegrated: number
    mobile: number
  }
  memoryBudgetMB: number
}
```

Each invariant must be observable. Replace vague statements with concrete
checks such as:

```text
the primary rim remains visible in the no-post capture
the water horizon does not reveal the mesh boundary
tree card roots remain attached under maximum wind
planet coast width is stable from orbit to mid approach
cloud history rejects across a foreground disocclusion
```

Each invariant must also map to required artifacts before rendering. A contract
that requires only `images/final.design.png` is rejected because it cannot prove
no-post signal, diagnostics, timing, or lifecycle ownership.

When matching a supplied visual reference, record the mechanisms that create
its identity and every deliberate divergence in backend, resolution, asset,
scale, or composition. Do not substitute a generic category match for the
specific visual contract.

## Automation Contract

Browser automation should set:

```text
viewport width and height
DPR
fixed seed
fixed time or frame index
camera bookmark
quality tier
debug mode
overlay visibility off for captures
capture path
```

Use deterministic frame stepping for stills and temporal checkpoints. For
stochastic pixels, freeze the sequence or compare an accumulated stable result.
Use masks only for known stochastic regions and keep thresholds tight enough to
catch real regressions.

## Renderer And Backend Manifest

Record:

```text
THREE.REVISION
renderer class
actual backend flag
browser and version
OS
GPU adapter when exposed
backend features and limits
coordinate system
depth mode
MSAA sample count
output buffer type
compatibility mode
timestamp tracking flag
output color space
tone mapping and exposure
initialization status
device-lost callback result
uncaptured backend errors
```

The manifest must distinguish unavailable GPU timing from zero GPU cost.
Unavailable backend fields such as `features`, `limits`, `compatibilityMode`,
and `trackTimestamp` are `null` with `unavailableReason`.

## Node Pipeline Evidence

Record the node graph that produced every capture:

```text
RenderPipeline output node owner
outputColorTransform setting
explicit renderOutput stage if used
pass() nodes and cameras
mrt() outputs and consumers
PassNode.setResolutionScale() values
GTAONode / BloomNode / TRAANode / DepthOfFieldNode use
CSMShadowNode / TileShadowNode use
fog and sky nodes
diagnostic override node materials
no-post bypass route
final composite route
```

For post effects, inspect the pre-effect signal, contribution, and final
composite. Tone mapping and output conversion must have one owner.

## Target And Storage Inventories

### Render targets

Every render target row must include:

| Field | Requirement |
| --- | --- |
| name | stable logical name |
| role | beauty, normal, depth, history, diagnostic, effect, final |
| owner | pass or node that writes it |
| width / height | physical pixels |
| DPR scale | full, half, quarter, custom |
| format / type | exact Three.js texture format and type |
| color space | `SRGBColorSpace`, `NoColorSpace`, or linear semantics |
| samples | MSAA sample count |
| depth/stencil/depth texture | present/absent and format when known |
| MRT count | number and names of outputs |
| lifetime | transient, persistent, history, capture-only |
| memory estimate | bytes and formula |
| readback layout | `rowBytes`, 256-byte-aligned `bytesPerRow`, and padded `byteLength` when pixels are copied from WebGPU |

### Storage resources

Every storage row must include:

| Field | Requirement |
| --- | --- |
| name | stable logical name |
| kind | `StorageTexture`, `StorageBufferAttribute`, `StorageInstancedBufferAttribute` |
| dimensions/count | texture dimensions or element count |
| format/type | texture format or buffer element layout |
| bytes | estimated total bytes |
| owner dispatch | TSL compute node name |
| dispatch size | scalar count or `[x, y, z]` |
| workgroup assumptions | workgroup size, local memory, barriers |
| synchronization | `workgroupBarrier`, atomics, ping-pong, or none |
| readback policy | none, metrics-only, capture-only |
| reset policy | when and how it is cleared |

GPU simulations, histories, culling, compaction, and generated instance data
must be validated from storage evidence, not inferred from the final image.

## Timing And Budgets

Run a warm-up window before recording. Separate initialization, shader
compilation, asset upload, screenshot readback, and steady-state rendering.

Record:

```text
warm-up frame count
sample frame count
CPU frame median and p95
GPU timestamp median and p95 when exposed
readback/capture time separately
draw calls
triangles / points / instances
pass count
dispatch count
render-target memory
storage memory
cache updates this frame
active quality tier
```

Use these default budgets unless the subject skill is stricter:

| Target | Desktop discrete | Desktop integrated | Mobile |
| --- | ---: | ---: | ---: |
| steady final frame | <= 8 ms GPU | <= 16 ms GPU | <= 24 ms GPU |
| validation capture frame | <= 12 ms GPU | <= 24 ms GPU | <= 33 ms GPU |
| CPU frame orchestration | <= 3 ms | <= 5 ms | <= 8 ms |
| render-target memory | <= 256 MB | <= 192 MB | <= 128 MB |
| storage memory | <= 256 MB | <= 192 MB | <= 128 MB |

CPU-only timing is proxy evidence. Label it as such and do not use it to claim
GPU headroom.

## Color And Output

Record a `ColorPipelineRecord`:

```ts
type ColorPipelineRecord = {
  rendererOutputColorSpace: 'SRGBColorSpace' | string
  rendererToneMapping: string | number
  rendererToneMappingExposure: number
  outputBufferType: string | number
  toneMapOwner: 'RenderPipeline' | 'renderOutput' | string
  outputTransformOwner: 'RenderPipeline' | 'renderOutput' | string
  hdrWorkingType: 'HalfFloatType' | string
  colorTextures: { name: string; colorSpace: 'SRGBColorSpace' | string }[]
  dataTextures: { name: string; colorSpace: 'NoColorSpace' | 'linear' | string }[]
  screenshotEncoding: string
}
```

Rules:

- Color textures use `SRGBColorSpace`.
- Data maps, normal/roughness/mask/noise/LUT/weather textures, and diagnostic
  storage use `NoColorSpace` or linear data semantics.
- HDR working buffers use `HalfFloatType` until tone mapping.
- The node pipeline owns exactly one tone-map stage and one output conversion.
- Individual materials, effects, captures, and PNG encoders must not apply a
  second output transform.

## Required Inspection Controls

Any runnable inspection surface should expose:

```text
pause / resume
fixed time or time scale
fixed seed
fixed camera bookmarks
viewport and DPR
quality tier
debug mode
canvas capture
runtime metrics
renderer/backend manifest
reset history
recreate resources
clear timings
```

At minimum, provide:

- one design camera;
- near and far camera bookmarks;
- final and no-post views;
- every controlling field or pass needed to prove the mechanism;
- deterministic reset;
- visible runtime errors and performance metrics;
- JSON export for the current evidence bundle.

Controls must alter the actual pipeline. A debug dropdown that only changes a
label is worse than no diagnostic because it creates false confidence.

## Mechanism-Specific Evidence

### Procedural growth

Report topology separately from final composition:

```text
branch jobs by level
terminal continuations by level
lateral children by level
ring and leaf-card counts
branch and leaf bounds
compute-generated or CPU-generated ownership
seed sweep
storage or geometry memory
```

Inspect hierarchy-only, continuation branches, foliage roots, rounded normals,
final composition, maximum wind, representative seeds, and one stress seed.
The species identity must survive the sweep.

### Spectral water

Require:

```text
disjoint wavelength ownership per cascade
independent FFT impulse and frequency tests
height and horizontal displacement fields
derivatives computed in frequency space
Jacobian or breaking metric
persistent foam history
shared sky/reflection parameters
StorageTexture ping-pong inventory
dispatch chain and workgroup assumptions
```

Inspect individual cascades, resolved normals, breaking/foam state, temporal
history, and final shading. A plausible ocean frame does not prove that the
FFT, derivatives, or history are correct.

### Analytic water

Require displacement and normals to derive from the same wave bundle. Inspect:

```text
displacement only
resolved normals
Fresnel
reflection
refraction
absorption or thickness estimate
crest response and foam
shared wave parameter source
```

Test near-grazing views, far-horizon minification, and a high-DPR capture.
Reject sparkling micro-bands that survive below one pixel.

### Planet fields and atmosphere

Require:

```text
undeformed sphere direction
macro height
continents and coast
climate or biome causes
resolved normals and roughness
surface lighting without atmosphere
atmosphere only
combined final
shared body center, radius, sun direction, and scale conversion
```

Inspect orbit, mid approach, and close approach. A shell that looks acceptable
only against black space is not sufficient evidence of ground-to-space
continuity.

### Volumetric clouds

Require:

```text
weather channels
base-shape density
detail erosion
bounded ray interval
beauty transmittance
lighting contribution
history confidence or rejection
cloud shadow
reprojection velocity/depth rejection
reduced-resolution march and depth-aware upsample evidence
```

Test camera translation, foreground disocclusion, sun-angle changes, and
quality-tier transitions. Still frames cannot validate temporal reconstruction.

### Curved-ray and volumetric effects

Expose:

```text
integration bounds
step or iteration count
accumulated steering
density contribution
remaining transmittance
background lookup direction
capped or invalid pixels
early-exit count
step-budget quality tier
```

Use a stress camera that approaches the singular or highest-curvature region.
Reject NaNs, persistent capped bands, unexplained asymmetry, and unbounded
iteration pressure.

### Temporal surfaces

Expose the complete state transition:

```text
previous history
current deposit or erase input
next history
blurred scene
static structure
composite mask
resolved normal/refraction
StorageTexture history ownership
frame-rate-independent response constants
```

Test reset, resize, pointer release, repeated deposition, frame-rate changes,
and long idle decay.

### Shadows and post nodes

For `CSMShadowNode` or `TileShadowNode`, inspect:

```text
level or tile ownership
committed light-space centers
texel grid
levels or tiles refreshed this frame
cross-level blend weights
normal bias in world units
unshadowed outside-coverage weight
update budget
targeted invalidation causes
```

For post nodes such as `GTAONode`, `BloomNode`, `TRAANode`, and
`DepthOfFieldNode`, inspect input signal, contribution, intermediate target
resolution, temporal history when present, and final composite.

## No-Post And Isolation Gates

Every image-effect example must expose:

```text
final
no presentation treatment
effect contribution only
controlling field or mask
normal / depth / velocity / history when relevant
```

Reject when:

- bloom supplies the only readable silhouette;
- atmosphere hides flat planet fields;
- post blur hides aliasing;
- a normal map implies waves absent from displaced geometry;
- temporal output cannot show previous state, deposit, and next state;
- a raymarch cannot reveal iteration pressure or capped pixels;
- shadows are judged only in the final graded image.

## Determinism And Captures

Freeze:

```text
seed
camera transform and projection
viewport
DPR
time or paused state
quality tier
backend flag
asset versions
color pipeline
```

Capture:

```text
design view
near/detail view
far/silhouette view
no-post baseline
diagnostic mosaic
one controlling diagnostic
one failure-sensitive diagnostic
representative seed sweep
stress condition
```

Use exact camera matrices or named camera bookmarks. Reproducing a comparison
by manually orbiting until it looks close invalidates image evidence.

## Temporal Validation

Use fixed-duration clips or sampled checkpoints for:

- camera motion;
- object motion;
- history accumulation and rejection;
- shadow-cache refresh;
- ocean foam persistence;
- cloud reconstruction;
- wind deformation;
- particle birth, death, and pool reuse;
- tier switches and resolution changes.

Record at least:

```text
t = 0 reset
t = first visible response
t = steady state
t = disocclusion or invalidation
t = recovery
```

Inspect at normal playback speed and frame-by-frame. Still captures cannot
prove the absence of shimmer, swimming, stale history, or lifetime pops.

## Resource Lifetime Validation

Run leak loops for:

```text
resize
DPR change
quality tier switch
debug mode switch
history reset
asset reload
scene teardown
renderer dispose/recreate
```

For each loop, record before/after `renderer.info`, target inventory, storage
inventory, live texture count, live buffer count when known, JS heap when
available, and uncaptured backend errors. Failing to release persistent targets,
histories, storage buffers, generated geometry, or pipeline resources blocks
acceptance.

## Rejection Criteria

Delete or withhold an example when any applies:

- it is visually weaker than the supplied reference in the target feature;
- its code is mostly generic material or noise boilerplate;
- mechanism-defining constants or ownership were replaced by guesses;
- it has no diagnostic mode proving the claimed mechanism;
- it relies on presentation treatment to manufacture missing form;
- it contains undisclosed backend, algorithm, asset, scale, or color
  divergences;
- deterministic reset or fixed-camera capture is impossible;
- the implementation cannot meet its declared performance envelope;
- GPU timing is claimed from CPU frame time alone;
- storage, target, or history ownership cannot be inventoried;
- leak loops show unreleased resources;
- available evidence is too weak to support excellence-level guidance.

## Replaced Techniques

- Subjective screenshot approval was replaced by authored visual contracts and
  stable JSON+PNG evidence bundles.
- CPU-only performance claims were replaced by GPU timestamp timing when
  exposed, with labelled proxy timing when unavailable.
- One stress seed was replaced by representative seed sweeps plus stress seeds.
- Informal target and memory notes were replaced by render-target and storage
  inventories tied to `renderer.info` and byte estimates.
- Manual resource confidence was replaced by repeatable resize, tier-switch,
  teardown, and dispose/recreate leak loops.
- Presentation-dependent approval was replaced by no-post and contribution-only
  gates from the node pipeline.

## Sign-Off Record

Record:

```text
skill and example ID
visual contract and invariants
Three.js revision
renderer/backend manifest
viewport, DPR, camera bookmark, seed, and time
quality tier and reductions
mechanisms exercised
deliberate divergences
debug modes inspected
temporal cases inspected
performance and memory metrics
render-target inventory
storage-resource inventory
color pipeline
known defects
review decision
artifact bundle path
```

Publish only accepted examples. Repeat the same evidence set whenever
mechanism code, Three.js revision, backend, camera, quality tier, color
pipeline, or target/storage layout changes.
