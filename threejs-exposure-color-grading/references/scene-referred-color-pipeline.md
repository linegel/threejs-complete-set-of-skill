# Scene-Referred Exposure And Color Pipeline

This reference defines a native-WebGPU/TSL path for global exposure, tone
mapping, and color grading. The optimization target is the *marginal* cost of
the meter inside the actual image graph, not a universal metering algorithm.

## Numeric Evidence Convention

Every numeric value has one provenance tag:

- `[Derived]`: algebra, byte size, API semantics, or format consequence;
- `[Gated]`: enabled only after a named capability/correctness check;
- `[Measured]`: recorded on a named browser/device/resolution/graph;
- `[Authored]`: a deliberate look or controller starting value.

A tag on a table row or code-block heading applies to every numeric literal in
that row or block. Replace `[Authored]` performance placeholders with
`[Measured]` target evidence before acceptance.

## r185 API Proof

The local package resolved to `three@0.185.1` `[Measured: local package]`.

| Contract | Local proof | Consequence |
| --- | --- | --- |
| `RenderPipeline`, `outputColorTransform`, `needsUpdate`, synchronous `render()` | `node_modules/three/src/renderers/common/RenderPipeline.js` | Explicit `renderOutput()` requires `outputColorTransform = false`; changing the output graph requires `needsUpdate = true`. |
| `pass`, `setMRT`, `getTextureNode`, `getViewZNode`, `getLinearDepthNode`, `compileAsync` | `node_modules/three/src/nodes/display/PassNode.js` | Configure MRT outputs and request texture nodes before `scenePass.compileAsync(renderer)`. Depth is the pass depth texture, not an MRT color output. |
| `toneMapping(mapping, exposure, color)` | `node_modules/three/src/nodes/display/ToneMappingNode.js` | The first argument is a numeric Three.js tone-mapping constant, not a lower-case tone-map function. |
| `renderOutput(color, toneMapping, outputColorSpace)` | `node_modules/three/src/nodes/display/RenderOutputNode.js` | It can own both tone mapping and working-to-output conversion. |
| `lut3D(input, texture3DNode, size, intensity)` | `node_modules/three/examples/jsm/tsl/display/Lut3DNode.js` | It samples a 3D texture with the texture sampler; there is no public shaper or tetrahedral interpolation option. |
| `Fn().compute`, `renderer.compute`, `renderer.computeAsync` | `node_modules/three/src/renderers/common/Renderer.js` | `computeAsync()` initializes on demand but does not provide a GPU-completion fence in r185. |
| `getArrayBufferAsync(attribute, target, offset, count)` | `node_modules/three/src/renderers/common/Renderer.js` | Offset and positive count are multiples of `4` bytes `[Derived: r185 validation]`; use only for diagnostics. |
| `workgroupArray`, `workgroupBarrier` | `node_modules/three/src/Three.TSL.js` and `nodes/gpgpu/WorkgroupInfoNode.js` | Hierarchical local reductions are expressible in TSL. The verified r185 workgroup-array helper does not declare atomic element storage. |
| `atomicAdd`, `atomicStore`, `StorageBufferNode.toAtomic()` | `node_modules/three/src/nodes/gpgpu/AtomicFunctionNode.js` and `nodes/accessors/StorageBufferNode.js` | Global atomic storage histograms are expressible. Do not claim a workgroup-local atomic histogram without a compiled custom implementation. |
| built-in color spaces | `node_modules/three/src/math/ColorManagement.js` | r185 registers linear-sRGB working and sRGB output spaces. Wider primaries require a custom registered space and an output/canvas capability gate. |

Verified import skeleton. Numeric literals are `[Gated: r185 API]`:

```js
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  ColorManagement,
  Data3DTexture,
  HalfFloatType,
  LinearSRGBColorSpace,
  NeutralToneMapping,
  NoColorSpace,
  NoToneMapping,
  Vector3,
  WebGPURenderer
} from 'three/webgpu';
import {
  Fn,
  atomicAdd,
  atomicStore,
  mrt,
  pass,
  premultiplyAlpha,
  renderOutput,
  saturate,
  storage,
  texture3D,
  toneMapping,
  unpremultiplyAlpha,
  vec4,
  workgroupArray,
  workgroupBarrier
} from 'three/tsl';
import { lut3D } from 'three/addons/tsl/display/Lut3DNode.js';

const renderer = new WebGPURenderer( {
  antialias: false,
  outputBufferType: HalfFloatType,
  trackTimestamp: true
} );
renderer.toneMapping = NoToneMapping;
renderer.toneMappingExposure = 1;

await renderer.init();
if ( renderer.backend.isWebGPUBackend !== true ) {
  throw new Error( 'Native WebGPU is required for this exposure path.' );
}

const canTimeGpu = renderer.hasFeature( 'timestamp-query' );
const luminanceCoefficients = ColorManagement.getLuminanceCoefficients(
  new Vector3(),
  LinearSRGBColorSpace
);
```

Do not teach a WebGPU-unavailable path here. If the user explicitly asks how to
apply fallback when WebGPU is unavailable, route that teaching to
`../threejs-compatibility-fallbacks/`.

## Signal Order And Tap Points

Default ordering:

```text
scene-linear direct + indirect + emissive + atmosphere
  -> effect-local temporal filters, such as temporal AO
  -> stable scene-linear composite
  -> TRAA, when enabled
  -> exposure meter tap (resolved, pre-bloom HDR)
  -> bloom / glare and other scene-linear optical contributions
  -> multiply by exp2(adaptedExposureEV)
  -> toneMapping(...)
  -> tone-mapped-linear grade
  -> renderOutput(..., NoToneMapping, outputColorSpace)
  -> display-encoded effects and UI, if their contracts require that domain
```

Why this order:

- Temporal color history remains independent of exposure. An exposed history
  requires previous-to-current exposure-ratio compensation and stricter reset
  logic.
- The meter sees temporally stable radiance instead of stochastic shimmer.
- The default meter excludes bloom because bloom is a downstream redistribution
  of radiance; feeding it back into exposure makes bloom strength alter camera
  response. Metering a bounded bloom contribution is `[Authored]`, not default.
- UI and diagnostic overlays are outside the photographed signal unless the
  brief explicitly defines them as scene light.

If a temporal effect consumes post-bloom color, document why its rejection can
handle broad, depthless glare. If exposure must precede temporal resolve, store
the exposure used by each history and rescale history before comparison.

The compute dispatch must sample the intended frame of the meter source. Make
the pass/temporal texture a real node dependency and expose both source and
exposure-state frame indices. An intentionally delayed meter is `[Authored]`;
an accidental previous-frame sample is a scheduling bug.

A robust delayed schedule is:

```text
adapt currentEV from the last completed target
  -> render the scene and present with that currentEV
  -> reduce the newly rendered meter source
  -> publish targetEV for a later frame
```

This order is `[Derived: producer-before-consumer dependency]`. The delay and
meter cadence are `[Authored]`. Running the reduction before the first scene
pass without a cleared/initialized source is invalid.

## Route-Level Radiometric Boundary

Use the canonical schemas in the
[physics domain and interaction contract](../../threejs-choose-skills/references/physics-domain-and-interaction-contract.md).
When the route declares a physics-to-render boundary, the exposure owner latches
the exact `PhysicsPresentationCandidate` -> `CameraViewPublication` ->
`ViewPreparationPublication` -> `PhysicsPresentationSnapshot` chain and binds one
`LightingTransportSnapshot` through a provider-wide `PresentedStatePair`
(`entityId: typed-absence`) in the Candidate whose binding ID is referenced by
the Snapshot. Match context/provider/signal IDs, descriptor and state/resource
generations, and `PresentationStateHandle`. Clocks need not share a `clockId`;
require each `PresentationSampleProvenance` mapping from requested presentation
instant to mapped source instant and validate every channel's
`actualPhysicsTime`,
age, filter, maximum staleness, validity, and error. Record intentional lag.
Reject a
snapshot with unsupported central descriptor schema/context IDs or context
version, invalid bundle/channel validity, or a blocking error.

Validate the exact central `LightingTransportSnapshot` and its channel
descriptors rather than mirroring a reduced exposure-local field list.

`directSolarIrradiance`/`skyIrradiance` are transport inputs in irradiance units. The
material/lighting stage must apply its BRDF and geometry terms to produce the
scene-linear radiance sampled by the meter. It is dimensionally invalid to add
irradiance directly to radiance or to compare their numeric values as if they
shared a threshold.

The basis and quantity declaration is per canonical channel. Record for
`incidentRadiance`, `surfaceIrradiance`, `directSolarIrradiance`,
`skyIrradiance`, `transmittance`, and `sourceDirection`: spectral basis,
radiometric quantity, SI unit, filter/support, bundle `sampleInstant`, channel
`actualPhysicsTime`, state/resource version, validity, and error. The bundle
instant is a `PhysicsInstant`; a channel time is the exact instant-or-interval
union allowed by `SampledChannel`. Record all applied atmosphere/cloud/visibility
factors through `attenuationFactorIds`. A global quantity summary cannot
override an incompatible channel descriptor.

Canonical `LightingTransportSnapshot` channels remain SI-valued. Choose exactly
one render-radiance convention:

- calibrated radiance that retains recorded physical units and exposure
  calibration;
- a separately named render-local normalized scene-linear signal produced by a
  versioned SI-to-render conversion with a named reference, provenance, error,
  and one common scale for lights, environment, atmosphere, emissive materials,
  foam, and optical effects.

The second is a perceptual rendering contract, not a canonical physical channel
or physical calibration. A purely perceptual route leaves the router physics
fields `not used` rather than fabricating a normalized physics snapshot.
Auto exposure cannot validate or repair arbitrary gains applied by individual
skills. Store the convention, each consumed channel descriptor/revision, the
meter's working basis, and authored exposure-key revision with every exposure
state.

### Reactive and basis-epoch behavior

Resolve `reactivePublications`/`resetDependencies` from the Snapshot's
`viewPreparationId`:

- local shadow-content commits and local foam/emissive/optical changes alter
  the next valid meter source; adaptation continues unless the shot policy
  explicitly cuts it;
- a camera cut may hold, cut, or reseed exposure only by the authored shot
  policy; it always records the decision;
- a radiance scale/basis, working-primary, quantity-convention, or exposure-key
  change invalidates accumulated meter statistics and the adapted-state
  interpretation unless an exact conversion is supplied;
- invalid or temporally mismatched transport executes a bounded canonical
  `hold-prior` action for the last valid GPU target and raises a diagnostic
  flag; CPU telemetry never substitutes a value.

For a known positive scale change `L_new = k L_old`, preserve the displayed
product with:

```text
currentEV_new = currentEV_old - log2(k)                  [Derived]
targetEV_new  = targetEV_old  - log2(k)                  [Derived]
```

This conversion is legal only when the basis/primaries and exposure key are
otherwise identical. Spectral-basis, primary, quantity, or nonlinear
normalization changes require a new reduction/reseed. Execute that dependency
before tone mapping the new epoch; never let one frame use old exposure state
with an incompatible radiance basis without declaring the transient.

`ViewPreparationPublication.resetDependencies` is immutable. Append the actual conversion,
meter reset/reseed/hold, compute submission, and failure to
`FrameExecutionRecord`. Distinguish logical exposure-state version, resource
generation, submission epoch, GPU queue availability, and diagnostic host
visibility. `computeAsync()` is not a fence. Device loss invalidates exposure
state/resources, appends a `FrameExecutionRecord` with
`overallStatus: device-lost`, affected target execution statuses
`device-lost`, cancelled dependent actions, and lost-generation entries in
`leaseDispositionById`, and requires an authored reseed under a new backend/resource
generation before presentation resumes. The immutable snapshot remains audit
evidence; its lost-generation bindings are unusable.

## Meter Selection: Re-Derivation

Let the source contain `N = width * height` pixels `[Derived]`, use `W` compute
lanes per workgroup `[Gated]`, and let a stratified meter request `S` samples
`[Authored then Measured]`.

| Meter | Source reads | Intermediate traffic | Select when | Reject when |
| --- | --- | --- | --- | --- |
| fixed/authored EV | none `[Derived]` | none `[Derived]` | calibrated shot, product view, or strict consistency | lighting range is uncontrolled |
| stratified grid/tile samples | `S` `[Derived]` | approximately `ceil(S/W)` partial records `[Derived]` | default global adaptation; lowest marginal bandwidth | small/high-energy features are missed or masks are undersampled |
| exact direct reduction | `N` `[Derived]` | approximately `ceil(N/W)` partial records plus hierarchical reads `[Derived]` | every pixel/mask must contribute exactly | bandwidth exceeds the measured budget |
| explicit reduction pyramid | fewer pixels per level but about `4N/3` total texel reads across source and levels, plus `N/3` writes, for an ideal repeated two-by-two reduction `[Derived]` | a texture chain | levels are reused by local exposure, diagnostics, or another authored feature | exposure is its only consumer |
| local histogram + global merge | sampled or exact source count `[Derived]` | histogram clear, local bins, and merge | percentile clipping fixes verified outlier/bimodal failures | weighted-log/key value already passes validation |

For one exact global mean, direct workgroup reduction has less traffic than
materializing a pyramid. A pyramid wins only through reuse or spatial output.
For ordinary auto exposure, a stratified estimator is usually cheaper than
either exact method.

### Stratified Meter

Partition the screen into cells in display UV, sample each cell at a
frame-varying low-discrepancy offset, and sample the mask at the same location.
The sample count is:

```text
S = cellsX * cellsY                                      [Derived]
partialCount = ceil(S / W)                              [Derived]
```

The checked-in example uses a `64 * 36 = 2304` sample grid and a workgroup size
of `128` `[Authored: example baseline; product is Derived]`. Those are not
device truths. Validate at least these failure cases before retaining them:

- a sub-cell emitter traverses cell boundaries;
- thin windows, text, and particles move across the grid;
- a UI/sky mask edge occupies less than one cell;
- camera motion changes the sampled phase;
- temporal jitter produces visible exposure pumping.

One bilinear sample per cell is not a box-filtered downsample. If tiny emitters
must carry energy, use multiple stratified samples per cell, an exact tile sum,
or a separate emitter-coverage term. Do not silently replace energy integration
with a maximum; maxima are deliberately highlight-biased `[Authored]`.

### Weighted Log Statistic

The meter assumes scene-linear radiance proxies with a consistent exposure
scale. If lights, emissive materials, and environment maps use incompatible
units or arbitrary compensating gains, auto exposure only hides the error.
Calibrate that scale before choosing a key value.

For sample luminance `Y_i` and nonnegative weight `w_i`:

```text
l_i = log2(max(Y_i, epsilon))                            [Derived]
L_key = exp2(sum(w_i * l_i) / max(sum(w_i), epsilon))  [Derived]
```

`epsilon`, center weighting, sky inclusion, and any shadow suppression are
`[Authored]`. Record them in telemetry. The r185 linear-sRGB coefficients are
`[0.2126, 0.7152, 0.0722]` `[Derived: ColorManagement source]`; obtain them
through `ColorManagement.getLuminanceCoefficients()` instead of duplicating the
literal when the working space can change.

Weights may encode:

```text
w = validity * photographedLayer * uiExclusion * shotMask * centerPolicy
```

Do not name a sky mask without defining whether zero excludes or includes sky.
If `sum(w_i)` is invalid or effectively empty, keep the last valid GPU target;
CPU telemetry state is irrelevant to this decision.

### Exact Direct Reduction

Use a first compute dispatch that reads the HDR source and writes one partial
per workgroup, then reduce partials until one remains. A binary local reduction
requires a compatible workgroup shape `[Gated]`; choose the lane count from
device compilation plus `[Measured]` timings rather than desktop convention.

```wgsl
// Field counts and byte sizes: [Derived]
struct ExposurePartial {
  weightedLogSum: f32,
  weightSum: f32,
  minLogLuminance: f32,
  maxLogLuminance: f32,
};
```

One partial is `4 * 4 = 16` bytes `[Derived]`. Dispatch counts are:

```text
firstGroups = ceil(N / W)                                [Derived]
nextGroups  = ceil(previousGroups / W)                   [Derived]
repeat until one aggregate remains                       [Derived]
```

Accumulate in `f32`. Validate finite sums and empty masks. Full-resolution
readback is never part of this path.

### Explicit Log-Luminance Pyramid

Store two moments per texel: weighted mean log luminance and mean coverage.
For four equal-area children `[Derived]`:

```text
parentWeight = sum(childWeight) / 4                      [Derived]
parentMean   = sum(childMean * childWeight)
             / max(sum(childWeight), epsilon)            [Derived]
```

Mean coverage avoids a half-float weight sum growing with image area. If exact
large sums or unequal-area edge tiles are required, use `f32` and explicit
sample counts `[Gated]`. Do not assume `BloomNode` shares this pyramid: its r185
targets are private.

### Histogram

Map log luminance over an authored EV window into `B` bins:

```text
binWidthEV = (maxLog2Y - minLog2Y) / B                   [Derived]
bin = clamp(floor((log2Y - minLog2Y) / binWidthEV),
            0, B - 1)                                    [Derived]
```

A conventional GPU algorithm is a workgroup-local atomic `u32` histogram followed
by a global merge, but the verified r185 `workgroupArray()` surface emits an
ordinary workgroup array and exposes no atomic-element declaration. Therefore
choose one of these explicit implementation paths:

- for a small stratified meter, use a global storage histogram configured with
  `storage(...).toAtomic()` and prove contention cost `[Measured]`;
- assign bins to invocations/workgroups and scan the sampled set without
  atomics, accepting the derived extra reads when that variant wins
  `[Measured]`;
- use a compiled custom WGSL/node implementation for local atomic bins, with an
  r185 integration test `[Gated]`.

Clearing costs `B` stores `[Derived]`. Direct global atomics per full-resolution
source sample are allowed only with `[Measured]` proof on every target GPU.

A `u32` count histogram defines percentiles over accepted samples, not arbitrary
float weights. If weighted percentiles are required, use a bounded fixed-point
weight with a derived overflow proof or a separate per-bin reduction; state the
quantization. Do not label an unweighted percentile as center-weighted.

Percentile cutoffs and bin count are `[Authored]`; bin memory is `4B` bytes
`[Derived]`. A robust default estimator is the weighted log mean *inside* the
chosen percentile interval, not the percentile midpoint. Resolve the cutoff
bins, then run a second sampled reduction that applies the original float
weights only to samples inside that interval. That second pass costs `S` source
or cached-sample reads `[Derived]`. Using bin centers instead has a maximum
single-bin quantization uncertainty of half `binWidthEV` `[Derived]` and is
legal only when that error passes the authored EV tolerance `[Authored then
Measured]`. Report underflow and overflow counts so the EV window cannot
silently clip the scene.

## GPU Exposure State And Adaptation

Allocate one state record per exposure-control group keyed by target/view,
`cameraPublicationId`, projection revision, and radiance binding. Share a record only when the
meter mask, exposure-key policy, sample-time policy, and reset history are
identical; otherwise one view can adapt another view's exposure.

Keep float and integer state in typed storage records:

```wgsl
// Two four-lane records, 32 bytes total: [Derived]
struct ExposureFloatState {
  keyLuminance: f32,
  targetEV: f32,
  currentEV: f32,
  invalidSeconds: f32,
};

struct ExposureUintState {
  valid: u32,
  sourceFrameIndex: u32,
  stateFrameIndex: u32,
  flags: u32,
};
```

Compute target exposure in stops:

```text
targetEV = clamp(log2(keyCalibration / max(L_key, epsilon))
                 + compensationEV,
                 minEV,
                 maxEV)                                  [Derived]
exposure = exp2(currentEV)                                [Derived]
```

`keyCalibration`, compensation, and EV clamps are `[Authored]`. A calibration
of `0.18` with a full-frame scene-linear `0.18` card yields `targetEV = 0` and
exposure `1` `[Derived from the authored calibration]`; it is not a universal
camera law.

Adapt EV, not linear exposure:

```text
tau = targetEV < currentEV ? tauBrightScene : tauDarkScene [Authored]
alpha = 1 - exp(-max(dt, 0) / max(tau, epsilon))           [Derived]
currentEV += (targetEV - currentEV) * alpha                [Derived]
```

For camera-like behavior, reducing exposure after a bright intrusion is
usually authored faster than raising it in darkness. The actual time constants,
pause `dt` clamp, and cut behavior remain `[Authored]` and require trajectory
captures.

The meter may update less often than rendering; adaptation still advances every
frame toward the last valid target. A failed diagnostic readback marks the
*telemetry* stale and does not touch GPU state. Invalid GPU aggregates hold the
last valid target and set a GPU validity flag.

## Tone Mapping And LUT Domains

There are three distinct LUT contracts. Never identify a LUT only as
"display LUT."

| Contract | Input | Required metadata | Placement |
| --- | --- | --- | --- |
| scene-linear shaper + LUT | unbounded scene-linear working color | working primaries, log/shaper equation, EV range, output domain | before tone map |
| tone-mapped-linear LUT | bounded tone-mapped color in working primaries with linear transfer | tone mapper/version, primaries, legal range, interpolation | after `toneMapping()`, before output conversion |
| display-encoded LUT | exact output primaries and transfer | output color space, transfer, legal/code range, display target | after `renderOutput()`; no later conversion |

Canonical tone-mapped-linear path. Code literals are
`[Gated: r185 API]`; clamp bounds are `[Derived: LUT legal domain]`:

```js
const straightHdr = unpremultiplyAlpha( hdrColor );
const exposedStraightHdr = vec4(
  straightHdr.rgb.mul( adaptedExposure ),
  straightHdr.a
);
const postToneMapLinear = toneMapping( mapping, 1, exposedStraightHdr );
const lutInput = vec4(
  saturate( postToneMapLinear.rgb ),
  hdrColor.a.clamp( 0, 1 )
);
const gradedStraight = lut3D(
  lutInput,
  texture3D( lutTexture ),
  lutSize,
  lutIntensity
);
const final = renderOutput(
  premultiplyAlpha( gradedStraight ),
  NoToneMapping,
  renderer.outputColorSpace
);

renderPipeline.outputColorTransform = false;
renderPipeline.outputNode = final;
renderPipeline.needsUpdate = true;
```

The scene pass is treated as premultiplied. Exposure, tone mapping, and LUT
grading are nonlinear RGB operations, so the canonical path unpremultiplies
first and repremultiplies before `RenderOutputNode` performs output conversion.
Exposure never changes alpha `[Derived]`.

Tone-map constants verified in r185:

| Mapping | Selection rule |
| --- | --- |
| `NeutralToneMapping` | `[Authored]` product/PBR fidelity baseline; validate reference swatches |
| `AgXToneMapping` | `[Authored]` filmic roll-off baseline; validate saturated highlights |
| `ACESFilmicToneMapping` | `[Authored]` contrast/look choice; validate hue and saturation shifts |

The mapping is a look/encoding decision, not a performance tier. A LUT bound to
one mapping must be rebuilt when the mapping changes.

For an unbounded scene-linear LUT, apply a declared shaper before cube lookup.
For each channel, one possible log shaper is:

```text
u = saturate((log2(max(x, epsilon)) - minEV) / (maxEV - minEV)) [Derived]
```

The cube's output and inverse-shaper/tone-map handoff must be explicit. Merely
clamping HDR to the cube is not a scene-linear grade.

## LUT Storage And Precision

Required r185 texture state:

```text
texture class: Data3DTexture                              [Gated: r185]
colorSpace: NoColorSpace                                 [Derived: transform data]
min/mag filter: LinearFilter                             [Gated: chosen trilinear path]
wrap S/T/R: ClampToEdgeWrapping                          [Derived: legal cube edge]
generateMipmaps: false                                   [Derived: one cube level]
unpackAlignment: 1                                       [Gated: Data3DTexture default]
```

For cube edge `D`, channel count `C`, and bytes per channel `b`:

```text
bytes = D^3 * C * b                                      [Derived]
```

Examples:

| Cube | Storage | Resident bytes |
| --- | --- | ---: |
| `16^3` RGBA8 `[Authored: compact baseline]` | `C=4`, `b=1` `[Derived]` | `16 KiB` `[Derived]` |
| `32^3` RGBA8 `[Authored: standard baseline]` | `C=4`, `b=1` `[Derived]` | `128 KiB` `[Derived]` |
| `32^3` RGBA16F `[Gated: precision validation]` | `C=4`, `b=2` `[Derived]` | `256 KiB` `[Derived]` |
| `64^3` RGBA16F `[Gated: strong-gradient validation]` | `C=4`, `b=2` `[Derived]` | `2 MiB` `[Derived]` |

Choose the smallest cube whose fixed swatch/ramp validation passes. `lut3D()`
uses texture interpolation; if tetrahedral interpolation is required, r185 has
no public helper in `Lut3DNode.js`, so a custom node must justify its marginal
cost with `[Measured]` banding/error evidence.

r185 only registers linear-sRGB and sRGB in `ColorManagement` by default.
Display-P3, custom wide-gamut, or HDR presentation is `[Gated]` on a registered
space, canvas/device support, and captured output evidence; a larger or float
LUT alone does not create a wide-gamut pipeline.

## Budget Contract

Do not use a device-class millisecond table as evidence. Measure the meter as a
marginal graph delta after shader warmup:

```text
meterMarginal = fullGraphWithMeter - identicalGraphWithFixedExposure [Measured]
gradeMarginal = fullGraphWithLutSample - identicalGraphWithTrueLutBypass [Measured]
```

An identity cube still performs the 3D texture sample and mix, so it is a
correctness oracle, not the performance baseline for grading cost.

Interleave deterministic paired variants and report a distribution plus the
chosen statistic; one frame cannot separate the meter from thermal drift,
shader compilation, or changing scene phase.

Record:

```yaml
evidence: Measured
threeRevision:
browserVersion:
gpuAdapter:
canvasPhysicalPixels:
meterMode:
meterSamples:
meterCadenceHz:
workgroupSize:
dispatches:
partialBytes:
histogramBytes:
lutBytes:
fullGraphGpuMs:
meterMarginalGpuMs:
gradeMarginalGpuMs:
timestampSource:
```

Use `renderer.hasFeature('timestamp-query')` only after `await renderer.init()`.
If timestamps are unavailable, CPU frame intervals are a coarse gate and must
not be presented as pass GPU time.

## Diagnostics And Acceptance

Required stable views:

```text
meter source before bloom
meter sample positions / exact-pixel coverage
combined meter weight and each authored mask
partial weightedLogSum / weightSum
histogram with underflow, overflow, and chosen interval
key luminance, target EV, current EV, validity, and meter cadence
temporal source before exposure
HDR after exposure
tone-mapped-linear LUT input
LUT output and out-of-domain mask
output conversion only
final output with UI exclusion visible
```

Acceptance scenes:

- calibration card at the authored key: expected target EV is zero `[Derived]`;
- sub-cell emitter sweep: stratified and exact meters differ within the
  authored tolerance `[Authored, then Measured]`;
- bright emitter entering/leaving frame: target/current EV are monotone in the
  expected direction `[Derived]`;
- window/sky-dominant and bimodal interiors: selected estimator has no pumping
  or percentile-window saturation `[Measured]`;
- temporal jitter on/off: meter variance stays within the authored tolerance
  `[Authored, then Measured]`;
- UI overlay on/off: GPU meter state is unchanged `[Derived from mask policy]`;
- identity LUT ramps and saturated swatches: error is reported in the declared
  domain `[Measured]`;
- output-transform isolation: exactly one tone-map owner and one conversion
  owner `[Derived]`.

## Rejected Architectures

- tiny render target plus per-frame CPU reduction: unnecessary readback and
  synchronization;
- unconditional full-pixel metering: exactness paid for without a correctness
  requirement;
- exposure-only luminance pyramid: more traffic than a direct exact statistic;
- global histogram atomics per full-resolution pixel: contention without a
  local-aggregation proof;
- post-bloom feedback meter by accident: bloom strength changes exposure;
- adapting linear exposure with direction names such as "up/down" left
  ambiguous: use EV and name the scene transition;
- interpreting stale CPU telemetry as stale GPU exposure;
- assigning `SRGBColorSpace` to LUT transform data;
- moving a tone-mapped-linear LUT before tone mapping without rebuilding its
  domain;
- claiming wide gamut from float storage without output-space support.
