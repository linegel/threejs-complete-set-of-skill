# Scene-Referred Exposure And Color Pipeline

Use this reference for a latest Three.js WebGPU/TSL measured HDR-to-display
path: compute-reduced luminance metering, shader-side asymmetric adaptation,
single tone-map/output ownership, and post-tone-map `lut3D()` grading.

## Fastest Architecture

The primary path is a GPU reduction, not a small render target. Render the HDR
scene once through a node `RenderPipeline`, meter the actual HDR signal with
compute, keep exposure state in a storage buffer, and read back only compact
telemetry when needed.

```text
scene NodeMaterial family
  -> pass(scene, camera) / mrt({ output, normal, emissive }) as needed
  -> depth from scenePass.getTextureNode('depth')
  -> HDR effects such as BloomNode from sibling pipeline
  -> compute reduction of HDR luminance into partial storage buffer
  -> compute final weighted log average / optional histogram percentiles
  -> compute adapted exposure state
  -> TSL post node applies exposure
  -> toneMapping(mapping, 1, exposedHdr)
  -> lut3D(vec4(saturate(postToneMapLinear), 1), texture3D(lutTexture), lutSize, lutIntensity)
  -> optional gamut compression / dithering / FXAA in documented domain
  -> renderOutput(graded, NoToneMapping, renderer.outputColorSpace)
```

`RenderPipeline.outputColorTransform = false` for this graph. `toneMapping()`
owns tone mapping before the LUT. The final `renderOutput()` uses
`NoToneMapping` and owns only conversion to `renderer.outputColorSpace`.
Do not place `renderOutput()` before a LUT that claims linear display-domain
input, because `RenderOutputNode` can apply both tone mapping and color-space
conversion.

Use `WebGPURenderer` from `three/webgpu`, TSL from `three/tsl`, and the
`NodeMaterial` family for scene materials. Use `renderer.compute()` when the
dispatch remains in the frame graph; use `renderer.computeAsync()` for warmup,
validation, or scheduled metering boundaries. Use `renderer.getArrayBufferAsync()`
only for compact telemetry readback, not to drive the current frame.

Complete r185 import/API skeleton:

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
  mrt,
  pass,
  renderOutput,
  storage,
  texture3D,
  toneMapping,
  vec4,
  saturate,
  workgroupArray,
  workgroupBarrier
} from 'three/tsl';
import { lut3D } from 'three/addons/tsl/display/Lut3DNode.js';

const renderer = new WebGPURenderer( {
  antialias: false,
  outputBufferType: HalfFloatType
} );
renderer.toneMapping = NoToneMapping;

const toneMappingModes = {
  neutral: NeutralToneMapping,
  agx: AgXToneMapping,
  aces: ACESFilmicToneMapping
};

const lutTexture = new Data3DTexture();
lutTexture.colorSpace = NoColorSpace;

const luminanceCoefficients =
  ColorManagement.getLuminanceCoefficients(
    new Vector3(),
    LinearSRGBColorSpace
  );
```

## Capability Gate And Tiers

```js
await renderer.init();

if ( renderer.backend.isWebGPUBackend ) {
  await renderer.computeAsync( exposureWarmupNodes );
  quality.exposure = 'compute-histogram';
} else {
  throw new Error( 'WebGPU backend unavailable for the canonical exposure path.' );
}
```

Quality tiers:

| Tier | Metering | Adaptation | LUT | Use |
| --- | --- | --- | --- | --- |
| Budgeted WebGPU | Lower metering cadence, coarser histogram, or authored shot table inside WebGPU | Storage-buffer state, lower update cadence, or fixed calibration | `16^3` or `32^3` RGBA8 | Native WebGPU with very low budget |
| Standard | Workgroup parallel weighted-log reduction | Storage-buffer state updated by compute | `32^3` RGBA8 | Default native path |
| Filmic | Weighted-log plus center weighting, UI/sky masks, and 64-128 bin percentile histogram | Storage-buffer state with stale-data hold | `32^3` RGBA8 or `48^3` RGBA16F | Bright skies, windows, emissive highlights |
| Wide gamut | Filmic meter plus gamut diagnostics | Same | `48^3`/`64^3` RGBA16F with gamut compression and dither | P3/HDR display work |

Budgeted tiers are quality tiers inside the WebGPU architecture, not a second
implementation path. If, and only if, the user explicitly asks how to apply
fallback when WebGPU is unavailable, route that teaching to
`../threejs-compatibility-fallbacks/`.

## Compute Meter

Meter the HDR texture that feeds the exposure stage, after ambient occlusion,
atmosphere, and HDR bloom contribution if bloom should affect perceived scene
brightness. Exclude UI overlays unless the art direction explicitly wants UI to
drive adaptation.

The meter source is scene-linear working color before tone map, LUT, output
conversion, and UI overlays. The default luminance coefficients are linear sRGB:

```text
LinearSRGBColorSpace coefficients = [0.2126, 0.7152, 0.0722]
```

For registered custom spaces, derive luminance coefficients with
`ColorManagement.getLuminanceCoefficients(target, colorSpace)` and record the
color space beside the exposure telemetry. Do not meter display-encoded sRGB,
tone-mapped color, or graded output.

The standard reduction keeps the old weighted-log estimator because it is still
robust and cheap, but moves it fully to GPU compute:

```text
for each source pixel:
  luminance = luminance(hdr.rgb)
  mask = sceneMask * uiMask * skyMask
  center = smooth radial center weight, usually 0.35..1.0
  lowWeight = luminance > 0.002 ? 1.0 : 0.15
  weight = mask * center * lowWeight
  partial.logSum += log(max(luminance, 0.0001)) * weight
  partial.weightSum += weight
```

Implementation shape:

1. First compute dispatch samples the HDR texture directly and writes one
   partial struct per workgroup into a `StorageBufferAttribute` wrapped by
   `storage()`. Use `Fn().compute(pixelCount, [128])` or `[256]` depending on
   target device. Use `workgroupArray()` plus `workgroupBarrier()` for local
   reductions.
2. One or more hierarchical compute dispatches reduce partial structs until one
   aggregate remains. For histogram tiers, write luminance bins to a separate
   integer storage buffer and use atomics only for the bin counter path.
3. The final compute dispatch resolves the aggregate:

```text
average = exp(logSum / max(weightSum, 0.0001))
target = clamp(middleGray / average * exp2(exposureCompensationEv),
               minExposure, maxExposure)
```

4. Store `average`, `target`, `current`, `staleSeconds`, and validity flags in a
   small exposure-state storage buffer.

Optional telemetry readback copies only the final state or histogram bins at a
   wall-clock cadence such as 5-10 Hz. If a readback is late or fails, hold the
   last valid measurement, mark telemetry stale, and optionally ease toward neutral
   after a timeout. Never reset target exposure directly to `1` on a failed
   readback.

Concrete compute-meter contract:

```wgsl
struct ExposurePartial {
  logSum: f32,
  weightSum: f32,
  minLogLuminance: f32,
  maxLogLuminance: f32,
};

struct ExposureState {
  average: f32,
  target: f32,
  current: f32,
  staleSeconds: f32,
  valid: u32,
  histogramOffset: u32,
  frameIndex: u32,
  flags: u32,
};
```

Both structs are 16-byte aligned. `ExposurePartial` is one `vec4<f32>`.
`ExposureState` is two `vec4<u32/f32>` storage slots or one packed 32-byte
record, depending on the app's storage helper.

```text
workgroupSize = 128 or 256
pixelCount = sourceWidth * sourceHeight
dispatchCount = ceil(pixelCount / workgroupSize)
partialCount = dispatchCount
reducePassCount = ceil-log(partialCount, workgroupSize) until one aggregate remains
histogramBins = 64 or 128 unsigned integer counters
readback byte ranges:
  ExposureState = 0..32
  histogramBins = histogramOffset..histogramOffset + histogramBins * 4
telemetry readback:
  renderer.getArrayBufferAsync(exposureStateAttribute, null, 0, 32)
```

`getArrayBufferAsync` readback is telemetry. It must not block or drive the
current frame. Failed or late readback holds the last valid target/current,
increments `staleSeconds`, and records a stale telemetry flag.

## Shader-Side Adaptation

Adapt exposure in compute or in a TSL node that reads/writes exposure state.
The response remains frame-rate independent and asymmetric:

```text
speed = target > current ? speedUp : speedDown
amount = 1 - exp(-max(deltaSeconds, 0) * speed)
current = current + (target - current) * amount
```

Defaults:

```text
minimum exposure = 0.45
maximum exposure = 1.85
middle gray = 0.18
compensation = 0 EV
speed up = 3.2
speed down = 1.1
stale telemetry timeout = 1.0 s before optional neutral ease
```

Exposure ownership invariant:

```text
dynamic exposure owner = exposure storage buffer current
renderer.toneMappingExposure = fixed calibration, normally 1
```

Do not animate both. If an art preset needs a fixed calibration such as `0.72`,
fold it into the target formula or document it as a constant multiplier before
the tone-mapping node.

## Tone Mapping And LUT Domain

The LUT recipes are authored for this domain:

```text
input: bounded post-tone-map linear working color, normally linear sRGB in [0, 1]
output: bounded post-tone-map linear working color
placement: after toneMapping(), before final output conversion
```

Use TSL tone mapping nodes for the tone-map stage when a LUT or other effect
must run after tone mapping but before output conversion:

```text
exposed = hdrColor * adaptedExposure
postToneMapLinear = toneMapping(mapping, 1, exposed)
graded = lut3D(vec4(saturate(postToneMapLinear), 1), lutNode, lutSize, intensity)
final = renderOutput(graded, NoToneMapping, renderer.outputColorSpace)
```

Tone-mapper selection:

| Mapping | Use |
| --- | --- |
| `NeutralToneMapping` | Product/PBR color fidelity and stable swatch validation |
| `AgXToneMapping` | Neutral filmic rolloff with fewer hue surprises |
| `ACESFilmicToneMapping` | Cinematic contrast with known hue/saturation tradeoffs |
| `linearToneMapping`, `reinhardToneMapping`, `cineonToneMapping` | Only when the project has an explicit look target or prior calibration |

If the LUT must move before tone mapping, rebuild it for a scene-linear or log
scene domain and rename the domain in file metadata. A display-domain LUT cannot
be moved upstream by changing only sampling coordinates.

## 3D LUT Construction

Build LUTs as `Data3DTexture` assets and sample them through `texture3D()` or
`lut3D()` nodes. Required setup:

```text
size: 32^3 default, 48^3/64^3 for wide-gamut or heavy grades
format: RGBAFormat
type: UnsignedByteType for compact display looks; HalfFloatType for wide-gamut/HDR-grade precision
colorSpace: NoColorSpace
minFilter/magFilter: LinearFilter
wrapS/wrapT/wrapR: ClampToEdgeWrapping
generateMipmaps: false
unpackAlignment: 1
domain metadata: input/output color space, transfer, tone-map dependency, intensity default
```

Recipe controls preserved from the previous skill because they remain useful:

```text
contrast
saturation
vibrance
black/white point
per-channel gamma
shadow/midtone/highlight tint
strength for each tonal range
```

Recipe order for display-domain looks:

```text
normalize black/white range
S-curve blend
contrast around 0.5
shadow tint
midtone tint
highlight tint
per-channel gamma
saturation
vibrance
highlight bias only if documented as a creative look
clamp to [0, 1]
```

Tonal weights are calculated from pre-grade post-tone-map luminance:

```text
shadow = 1 - smoothstep(0.12, 0.54, luma)
highlight = smoothstep(0.48, 0.92, luma)
midtone = max(0, 1 - abs(luma - 0.5) * 2)
```

Memory budgets:

```text
32^3 RGBA8       ~= 128 KiB
32^3 RGBA16F     ~= 256 KiB
48^3 RGBA16F     ~= 864 KiB
64^3 RGBA16F     ~= 2 MiB
```

## Performance Budgets

Targets for 1920x1080:

| Device class | Meter dispatches | Storage | Readback | Target cost |
| --- | --- | --- | --- | --- |
| Desktop discrete | first pass + 1-2 reduce + adaptation | <= 256 KiB partials, <= 4 KiB state/histogram | 16-1024 bytes at 5-10 Hz | <= 0.10 ms GPU, no frame stall |
| Desktop integrated | same, lower workgroup size if needed | <= 192 KiB partials | same | <= 0.25 ms GPU |
| Mobile/tile GPU | quarter/half-rate metering or coarser dispatch | <= 128 KiB partials | <= 64 bytes at 2-5 Hz | <= 0.60 ms GPU |

Targets for 3840x2160:

```text
desktop discrete: <= 0.25 ms
desktop integrated: <= 0.70 ms
mobile/tile GPU: use half-rate metering or static tier
```

The post stack should add no extra scene render. Use the existing scene pass or
MRT output from `$threejs-image-pipeline`; do not re-render the scene just to
meter exposure.

## Color And Output Rules

- Color textures use `SRGBColorSpace`.
- Data maps, masks, noise, LUTs, histograms, and exposure buffers use
  `NoColorSpace` or linear data semantics.
- HDR working buffers stay `HalfFloatType` until tone mapping.
- One dynamic exposure owner: the exposure storage buffer.
- One tone-map owner: the explicit `toneMapping()` node before a post-tone-map
  LUT, or `renderOutput()` only when no post-tone-map effect needs linear input.
- One output conversion owner: final `renderOutput(..., NoToneMapping,
  renderer.outputColorSpace)` in the LUT graph.
- UI overlays should render after exposure and tone mapping unless explicitly
  authored as part of the photographed scene.

## Diagnostics

Expose these debug views and telemetry:

```text
meter source HDR
meter mask: center, UI, sky, and combined masks
per-workgroup partial logSum / weightSum heatmap
histogram bins and chosen percentiles
measured average luminance
target/current exposure over time
stale telemetry flag and readback cadence
HDR before exposure
post exposure before tone map
post tone-map before LUT
identity LUT versus selected LUT
per-recipe tonal weights
out-of-domain mask before LUT
gamut compression and dither toggles
final with exposure, tone mapping, LUT, and output conversion isolated one at a time
```

Validation scenes:

```text
18% gray card
bright emitter entering/leaving frame
saturated RGB/skin/product swatches
sky or window occupying most of the frame
UI overlay that must not affect exposure
identity LUT round trip
LUT disabled
exposure disabled
output conversion isolated
```

## Visible Correctness Signatures

Visible correctness means the numeric exposure state explains what the user sees
without relying on display-encoded metering or hidden output conversion.

- 18% gray convergence: a full-frame 0.18 scene-linear gray card resolves to
  target exposure `1.0` and stays neutral through identity LUT validation.
- Bright-emitter adaptation curve: when an HDR emitter enters the frame, target
  exposure moves down monotonically and current exposure follows with the
  configured asymmetric response.
- Sky/window dominance: sky or window-heavy frames use the authored sky mask or
  percentile policy instead of crushing the whole scene from one bright region.
- UI exclusion: UI overlays do not change average luminance, target exposure, or
  histogram bins unless explicitly flagged as scene light.
- Identity LUT neutrality: an identity `32^3` LUT changes no swatch by more
  than 1/255 in the post-tone-map linear domain.

Wrongness signatures:

- double exposure: `renderer.toneMappingExposure` animates while the exposure
  storage buffer current value also animates;
- graded or tonemapped metering: exposure changes when LUT intensity changes or
  tone-mapper selection changes without changing the HDR source;
- display-encoded metering: 18% gray does not converge to exposure `1.0` and
  bright values lose HDR contrast before the meter;
- symmetric adaptation: brightening and darkening travel the same fraction for
  the same `deltaSeconds`, ignoring `speedUp` and `speedDown`.

## Checkpointed Build Order

Checkpoint 1 — HDR source: expected scene-linear HDR before exposure, tone map,
LUT, or UI. if you see display-referred values, you made the mistake of metering
after output conversion.

Checkpoint 2 — meter mask: expected center, UI, sky, and combined masks. If UI
changes exposure, you made the mistake of metering overlays.

Checkpoint 3 — partial sums: expected finite `logSum` and `weightSum` per
workgroup. If all partials are zero while the source is visible, you made the
mistake of sampling the wrong texture or mask.

Checkpoint 4 — aggregate average: expected 18% gray resolves to target exposure
`1.0`. If it does not, you made the mistake of using display-encoded metering,
wrong luminance coefficients, or double exposure.

Checkpoint 5 — adapted exposure: expected monotonic asymmetric response toward
target. If you see symmetric adaptation, you made the mistake of using one speed
for both light-to-dark and dark-to-light transitions.

Checkpoint 6 — post-tone-map linear: expected bounded linear color before LUT
sampling. If you see sRGB encoded values, you made the mistake of placing
`renderOutput()` before the LUT.

Checkpoint 7 — LUT output: expected identity LUT neutrality within tolerance. If
neutral swatches shift, you made the mistake of assigning the LUT a color
texture domain or wrong 3D layout.

Checkpoint 8 — final output: expected one output conversion owner. If final
looks double-encoded, you made the mistake of enabling both
`RenderPipeline.outputColorTransform` and final `renderOutput()`.

## Replaced Techniques

- Replaced tiny render-target metering plus CPU reduction with compute-side
  hierarchical reduction into storage buffers. This removes quantization,
  avoids per-frame CPU work, and scales with the source signal instead of a
  hand-picked proxy resolution.
- Replaced encoded byte luminance with direct HDR texture sampling and float
  partial sums. This preserves bright emitters and dark-room precision.
- Replaced frame-count readback cadence with wall-clock telemetry cadence.
- Replaced failed-readback reset-to-neutral with hold-last-valid plus stale
  telemetry.
- Replaced dual dynamic exposure controls with one storage-buffer exposure
  owner and fixed renderer calibration.
- Replaced ambiguous `renderOutput()` before LUT with explicit `toneMapping()`
  before `lut3D()` and final `renderOutput(..., NoToneMapping, outputColorSpace)`.
