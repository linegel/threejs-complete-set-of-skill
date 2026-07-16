# Scene-Referred Exposure And Color Pipeline

Use this reference for automatic meters, GPU EV adaptation, and LUT placement.
Derive dimensions and byte counts, author look controls explicitly, and measure
performance values on the target graph.

## r185 surface

Initialize before testing backend features:

```js
import {
  HalfFloatType,
  NoToneMapping,
  WebGPURenderer,
} from 'three/webgpu';

const renderer = new WebGPURenderer({
  antialias: false,
  outputBufferType: HalfFloatType,
  trackTimestamp: true,
});
renderer.toneMapping = NoToneMapping;
renderer.toneMappingExposure = 1;

await renderer.init();
if (renderer.backend.isWebGPUBackend !== true) {
  throw new Error('Native WebGPU is required for this exposure path.');
}

const canTimeGpu = renderer.hasFeature('timestamp-query');
```

r185 establishes these constraints:

| Surface | Consequence |
| --- | --- |
| `RenderPipeline.outputNode`, `outputColorTransform`, `needsUpdate` | An explicit `renderOutput()` owns output conversion; set `outputColorTransform = false` and dirty the pipeline after graph changes. |
| `pass().setMRT()`, `getTextureNode()` | Request the HDR source before compiling the scene pass. Depth is the pass depth texture, not an MRT color attachment. |
| `toneMapping(mapping, exposure, color)` | `mapping` is a Three.js tone-mapping constant. Keep `renderer.toneMappingExposure = 1` when a node applies adapted exposure. |
| `lut3D(input, texture3DNode, size, intensity)` | The public helper performs texture interpolation and exposes no shaper or tetrahedral mode. |
| `renderer.compute()` / `computeAsync()` | `computeAsync()` initializes on demand but is not a GPU-completion fence. |
| `getArrayBufferAsync(attribute, target, byteOffset, byteCount)` | The byte offset and every positive byte count must be multiples of `4`; r185 throws on misaligned reads. Use scheduled readback for diagnostics only; current-frame exposure remains GPU-resident. |
| `workgroupArray()` | Local reductions are expressible; the helper does not declare atomic array elements. |
| `storage(...).toAtomic()` | Global atomic histograms are expressible. A local-atomic histogram needs a separately compiled implementation. |
| built-in color spaces | Linear-sRGB working and sRGB output are registered. Wider primaries require a registered space plus canvas/device/output evidence. |

Bind the meter to the intended texture and frame. The default image order is:

```text
scene-linear radiance
  -> effect-local temporal filters
  -> temporal color resolve, when enabled
  -> meter tap from resolved pre-bloom HDR
  -> bloom and other scene-linear optical terms
  -> exposure
  -> tone map
  -> grade
  -> output conversion
```

Keep temporal color history unexposed. When a design requires exposed history,
store the exposure used by each history sample and compensate by the
previous-to-current exposure ratio before rejection and blend.

## Meter implementations

Let `N = width * height`, `W` be the validated workgroup lane count, and `S`
the selected sample count.

| Meter | Source reads | Intermediate work | Use when |
| --- | ---: | --- | --- |
| fixed EV | `0` | none | lighting and composition are controlled |
| stratified samples | `S` | about `ceil(S / W)` partials | ordinary global adaptation |
| exact reduction | `N` | `ceil(N / W)` first-level partials, then hierarchical reduction | every pixel or exact mask matters |
| explicit pyramid | about `4N/3` reads and `N/3` writes for ideal two-by-two levels | texture chain | another consumer needs levels or spatial statistics |
| histogram | selected source reads plus clear/merge | bins and percentile scan | clipping a tail fixes a proven image failure |

An internal bloom pyramid is not reusable through the public r185
`BloomNode` surface. An exposure-only pyramid therefore pays extra traffic
without adding a consumer.

### Weighted log statistic

Obtain luminance coefficients with
`ColorManagement.getLuminanceCoefficients(out, workingSpace)` rather than
freezing linear-sRGB literals. For accepted sample luminance `Y_i` and
nonnegative weight `w_i`:

```text
l_i   = log2(max(Y_i, epsilon))
L_key = exp2(sum(w_i * l_i) / max(sum(w_i), epsilon))
```

Weights may multiply validity, photographed-layer inclusion, UI exclusion,
shot mask, and center policy. Define every mask polarity. An empty or nonfinite
weight sum keeps the prior valid GPU target and raises a GPU validity flag.

Auto exposure assumes all contributors share one scene-linear radiance scale.
It cannot repair arbitrary per-light, emissive, environment, atmosphere, foam,
or optical-effect gains.

### Stratified sampling

Partition display UV into cells and choose a low-discrepancy, frame-varying
sample in each cell. Sample the image and mask at the same coordinate:

```text
S = cellsX * cellsY
partialCount = ceil(S / W)
```

One bilinear lookup per cell is a point estimator, not a box-filtered energy
integral. Validate sub-cell emitters, thin windows/text/particles, mask edges,
camera motion, and temporal jitter. When small sources must retain their
energy, use multiple stratified samples, an exact tile sum, or a separate
coverage term.

### Exact reduction

The first dispatch reads HDR and writes one partial per workgroup; later
dispatches reduce partials until one remains:

```wgsl
struct ExposurePartial {
  weightedLogSum: f32,
  weightSum: f32,
  minLogLuminance: f32,
  maxLogLuminance: f32,
};
```

```text
firstGroups = ceil(N / W)
nextGroups  = ceil(previousGroups / W)
repeat until one aggregate remains
```

The four `f32` fields occupy 16 bytes per partial. Choose a workgroup shape that
compiles on every target and wins measured timings. Accumulate finite values in
`f32`; keep full-resolution readback outside the controller.

### Explicit pyramid

Store weighted mean log luminance plus mean coverage. For four equal-area
children:

```text
parentWeight = sum(childWeight) / 4
parentMean   = sum(childMean * childWeight)
             / max(sum(childWeight), epsilon)
```

Use explicit sample counts or `f32` sums when edge tiles have unequal areas or
exact large sums matter. Keep the level chain only when its spatial outputs
have a named consumer.

### Histogram

Map log luminance into `B` bins over an authored EV interval:

```text
binWidthEV = (maxLog2Y - minLog2Y) / B
bin = clamp(floor((log2Y - minLog2Y) / binWidthEV), 0, B - 1)
```

Choose one explicit implementation:

- a global atomic histogram for a small sampled set, after contention is
  measured;
- bin-owned invocations that rescan the sampled set;
- a compiled custom node/WGSL path with workgroup-local atomic bins.

Clear costs `B` stores and `u32` bins cost `4B` bytes. Counts define an
unweighted percentile. Weighted percentiles require bounded fixed-point weights
with an overflow proof or a per-bin weight reduction.

After locating the percentile interval, prefer a second weighted-log reduction
over accepted samples. Using bin centers instead has at most half a bin of
single-bin quantization error and is valid only inside the declared EV
tolerance. Record underflow and overflow so the interval cannot silently clip
the distribution.

## GPU exposure state

Allocate one state record per exposure-control group. Key it by target/view,
radiance basis, meter policy, and reset epoch. A compact typed layout is:

```wgsl
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

The two four-lane records occupy 32 bytes. Derive target exposure in stops:

```text
targetEV = clamp(log2(keyCalibration / max(L_key, epsilon))
                 + compensationEV,
                 minEV,
                 maxEV)
exposure = exp2(currentEV)
```

`keyCalibration`, compensation, and clamps are authored controls. A card whose
luminance equals the authored key has `targetEV = 0` and exposure `1`.

Adapt EV rather than linear exposure:

```text
tau = targetEV < currentEV ? tauBrightScene : tauDarkScene
alpha = 1 - exp(-max(dt, 0) / max(tau, epsilon))
currentEV += (targetEV - currentEV) * alpha
```

Clamp stalled `dt`. Choose bright-to-dark and dark-to-bright time constants
from the authored response and verify their trajectories. Meter cadence may be
lower than presentation cadence; adaptation advances every frame toward the
last valid target.

Schedule state by dependency:

```text
adapt from last completed target
  -> present with currentEV
  -> reduce the new source
  -> publish the next target
```

Expose source and state frame indices. A deliberately delayed meter is an
authored schedule; an untracked previous-frame texture is a scheduling defect.

### Reset and conversion

- An invalid aggregate holds the last valid target and marks invalidity in GPU
  state.
- A cut executes its declared hold, fixed-EV, or reseed policy.
- A pure positive scale change `L_new = k * L_old` converts both EV values with
  `EV_new = EV_old - log2(k)` when primaries, quantity, and exposure key are
  unchanged.
- A primary, spectral basis, quantity, nonlinear normalization, or key change
  clears meter statistics and reseeds adaptation before presentation.
- A resize/DPR change rebuilds source-sized resources and regenerates sample
  coordinates.
- Device loss recreates buffers and seeds the new resource generation from an
  authored valid state.

Diagnostic readback age affects telemetry only. It never changes controller
state or gates the current frame.

## Tone mapping and LUTs

Three LUT domains require different placement:

| Contract | Input | Required metadata | Placement |
| --- | --- | --- | --- |
| scene-linear shaper + cube | unbounded working radiance | primaries, shaper equation/range, cube output domain | before tone map |
| tone-mapped-linear cube | bounded linear color | tone mapper/version, primaries, legal range, interpolation | after tone map, before output conversion |
| display-encoded cube | exact output primaries and transfer | color space, transfer, code range, display target | after `renderOutput()` with no later conversion |

Tone-map choice is authored appearance, not a performance tier:

| Mapping | Useful baseline | Required check |
| --- | --- | --- |
| `NeutralToneMapping` | product/PBR fidelity | reference swatches |
| `AgXToneMapping` | filmic roll-off | saturated highlights |
| `ACESFilmicToneMapping` | contrast/look | hue and saturation shifts |

A cube bound to one mapping is rebuilt when that mapping changes.

For an unbounded scene-linear cube, a per-channel logarithmic shaper can be:

```text
u = saturate((log2(max(x, epsilon)) - minEV) / (maxEV - minEV))
```

State the cube output and inverse-shaper/tone-map handoff. Clamping unbounded
HDR directly to a cube does not constitute a scene-linear grade.

Canonical tone-mapped-linear composition:

```js
const straightHdr = unpremultiplyAlpha(hdrColor);
const exposed = vec4(straightHdr.rgb.mul(adaptedExposure), straightHdr.a);
const toneMapped = toneMapping(mapping, 1, exposed);
const lutInput = vec4(saturate(toneMapped.rgb), hdrColor.a.clamp(0, 1));
const graded = lut3D(lutInput, texture3D(lutTexture), lutSize, lutIntensity);
const final = renderOutput(
  premultiplyAlpha(graded),
  NoToneMapping,
  renderer.outputColorSpace,
);

renderPipeline.outputColorTransform = false;
renderPipeline.outputNode = final;
renderPipeline.needsUpdate = true;
```

The scene pass is premultiplied here. Exposure, tone mapping, and grading are
nonlinear RGB operations, so unpremultiply before them and premultiply before
output conversion. Preserve alpha through exposure.

Use `Data3DTexture` as transform data with `NoColorSpace`, linear min/mag
filters, clamp-to-edge wrapping, no mipmaps, and unpack alignment compatible
with the uploaded rows. For cube edge `D`, channels `C`, and bytes per channel
`b`:

```text
residentBytes = D^3 * C * b
```

Choose the smallest cube that passes fixed ramps and swatches. Public r185
`lut3D()` uses texture interpolation; a tetrahedral requirement needs a custom
node and image evidence that earns the added path. A float cube does not by
itself create wide-gamut output.

## Timing and acceptance

Measure marginal graph cost after warmup with paired variants:

```text
meterMarginal = fullGraphWithMeter - identicalGraphWithFixedExposure
gradeMarginal = fullGraphWithLutSample - identicalGraphWithTrueLutBypass
```

An identity cube still performs a texture sample and mix, so it is a
correctness fixture rather than the performance bypass. Interleave variants to
separate graph cost from thermal and scene drift. Record browser, adapter,
physical resolution, meter mode/count/cadence, workgroup shape, dispatches,
buffer sizes, cube size/format, and timestamp source.

Resolve renderer timestamps only when timestamp queries are supported after
initialization. r185 render timestamps cover timestamped render passes, not
compute, copies, queue gaps, or presentation; label narrower evidence
accordingly.

Acceptance requires:

- key-card target EV;
- monotone target/current EV response to a bright-source trajectory;
- sampled-versus-exact small-emitter and mask evidence when sampling is used;
- histogram underflow/overflow and interval evidence when a histogram is used;
- meter invariance under excluded UI;
- identity-cube ramps, saturated swatches, and declared-domain error;
- unchanged alpha through exposure and grading;
- exactly one exposure, tone map, and output conversion.

Failure signatures localize the cause: pumping implicates source stability,
sampling, or cadence; a one-frame jump implicates source/state ordering or
reset timing; clipped or shifted ramps implicate LUT domain or storage; halos
at transparency implicate alpha handling; double contrast or gamma implicates
multiple tone-map/output owners.
