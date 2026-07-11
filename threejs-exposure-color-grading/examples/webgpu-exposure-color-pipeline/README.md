# WebGPU Exposure Color Pipeline

Canonical r185 browser lab with three locked tiers. The checked-in Node
validator proves CPU oracles, ownership, storage layouts, route rejection, and
TSL graph construction. Native-WebGPU execution, readback, and timing remain
`INSUFFICIENT_EVIDENCE` until the browser capture is run on a named adapter.

```text
last completed targetEV
  -> EV adaptation for the frame
  -> render raw scene-pass HDR
  -> exposure multiplier exp2(currentEV) on RGB only
  -> toneMapping()
  -> tone-mapped-linear identity lut3D()
  -> renderOutput(..., NoToneMapping, outputColorSpace)
  -> optional post-render weighted-log or histogram-percentile meter
  -> targetEV for a later frame
```

## Claim boundary

This example implements a stratified weighted-log meter and a sampled
histogram path with real clear, fixed-point weighted global-atomic binning,
weighted prefix/percentile bounds, percentile-clipped second weighted-log,
target-EV, and adaptation dispatches. It does not claim an
exact full-pixel meter, luminance pyramid, temporal meter source, bloom-aware
meter, wide-gamut output, GPU timing budget, or mobile performance.

The full histogram tier records weighted underflow and overflow independently.
Each floating meter weight is quantized to `[0, 65535]` for bounded `u32`
atomic accumulation. Percentile ranks use those fixed-point weights, and the
second reduction applies the original floating weight only to samples inside
the selected interval. CPU oracles prove the quantization total, percentile
window, clipped reduction, and the `2304 * 65535 < 2^32` overflow bound.

The meter source is the raw scene pass, not a temporally reconstructed signal.
The pass requests no named normal/emissive MRT outputs; exposure consumes only
HDR color, while ordinary scene depth testing remains a raster requirement.
The weighted-log reduction has one partial stage plus one single-workgroup
aggregate. Its constructor rejects unsupported sample/workgroup shapes instead
of pretending to be a general hierarchical reducer. Histogram mode precedes
that reduction with its four bounded stages.

The `masked-ui` fixture places a scene-linear HDR panel wholly inside the live
screen-space exclusion rectangle. Capture resets the meter sequence for an
emitter-only baseline and the masked panel case, then requires a visible image
difference while bounding target-EV drift. The mask is therefore exercised by
the compute kernels rather than represented only by a diagnostic label.

The post-render meter deliberately updates a later frame. Adaptation executes
before presentation from the last completed target, the scene pass produces the
current meter texture, and the reduction runs afterward. This prevents the first
dispatch from reading an uninitialized pass target and makes
`sourceFrameIndex` truthful.

Run:

```bash
npm --prefix threejs-exposure-color-grading/examples/webgpu-exposure-color-pipeline run check
npm --prefix threejs-exposure-color-grading/examples/webgpu-exposure-color-pipeline run validate
```

Locked routes are generated from the same implementation:

```text
mechanism/log-luminance-reduction
mechanism/histogram-and-percentiles
mechanism/adaptation
mechanism/metering-masks
mechanism/tone-mapping
mechanism/lut-grading
tier/full-histogram
tier/balanced-log-reduction
tier/minimum-fixed-shot
```

## Numeric provenance

All runtime numbers are exported with provenance in `NUMERIC_PROVENANCE`.
Current example seeds:

| Value | Provenance |
| --- | --- |
| meter grid `64 * 36 = 2304` samples | `[Authored]`; product `[Derived]` |
| workgroup size `128` | `[Authored]`, compile/measurement gated |
| meter cadence `30 Hz` | `[Authored]` |
| key calibration `0.18` | `[Authored]` scene/exposure scale |
| EV clamps `[-4, +4]` | `[Authored]` example range |
| bright-scene time constant `0.25 s` | `[Authored]` |
| dark-scene time constant `1.0 s` | `[Authored]` |
| partial/state byte sizes | `[Derived]` from typed vector layouts |
| histogram counters/prefix/state | `[Derived]` from `66 u32 + 64 u32 + 2 uvec4` |
| linear-sRGB luminance coefficients | `[Derived]` from Three.js r185 `ColorManagement` |
| identity LUT edge `32` | `[Authored]`; storage bytes and code-step tolerance `[Derived]` |

These are not device-class performance claims.

The visual fixture uses authored ambient/key lighting, a rough ground plane, a
shaded box, and a small HDR emissive sphere. That distribution exists to make
meter sampling and highlight response inspectable; it is not a recommended
lighting rig. Every fixture number is classified as `[Authored]` by the runtime
diagnostics.

Checkpoint numbers below are `[Derived]` structural ordering.

## Checkpoint 1 — HDR source

`meter source HDR` must be scene-linear and precede exposure, tone mapping,
LUT, output conversion, and UI. Its source/state frame indices must identify
which rendered frame produced each target EV.

## Checkpoint 2 — Samples and mask

The Halton within-cell jitter uses a dedicated meter-update index, must stay
inside each meter cell, and must cover both horizontal half-cells in the tested
prefix. Using render-frame indices would alias regular render/meter cadence
ratios. The mask is sampled at the same UV. A tiny-emitter sweep is still
required before using this estimator in a product; one sample per cell is not a
box-filtered downsample.

## Checkpoint 3 — Reduction

`partial weightedLogSum weightSum` must be finite. In histogram mode, prefix
totals must equal accepted fixed-point meter weight and `lowBin <= highBin`.
Percentile-rejected samples contribute exactly zero to both second-pass sums. The executable
reduction shape requires:

```text
sampleCount % workgroupSize == 0                         [Derived gate]
workgroupSize is a power of two                          [Derived gate]
partialCount <= workgroupSize                            [Derived gate]
```

Larger/exact reductions use the hierarchical algorithm in the reference, not
this fixture.

## Checkpoint 4 — Key and target EV

The authored key card produces `targetEV = 0` and exposure multiplier `1`
`[Derived from key calibration]`. Very bright/dark inputs clamp to the authored
EV range.

## Checkpoint 5 — EV adaptation

`currentEV` moves monotonically toward `targetEV` with a time-based exponential
response. A bright intrusion reduces exposure faster than the example raises it
in darkness because the two authored time constants differ. Linear-exposure
adaptation is not part of this example.

Metering updates at the authored cadence; adaptation runs every rendered frame
toward the last valid target. A meter result therefore has explicit frame
latency instead of silently affecting the frame that produced its source. CPU
readback never drives GPU state.

## Checkpoint 6 — Tone-mapped-linear domain

The pass color is unpremultiplied before nonlinear exposure, tone mapping, and
LUT operations. `toneMapping()` receives
`vec4(straightHdr.rgb * exp2(currentEV), straightHdr.a)`. The graded result is
repremultiplied before `renderOutput()`. Exposure does not alter alpha. The
tone-mapped RGB is clamped only for the bounded LUT input and remains in working
primaries with linear transfer.

## Checkpoint 7 — LUT

The identity `Data3DTexture` is `NoColorSpace`, uses `LinearFilter`, and is
validated with an off-grid trilinear CPU oracle. Nearest sampling is not cited
as proof for the runtime `lut3D()` path.

## Checkpoint 8 — Final output

The explicit `toneMapping()` node owns tone mapping. Final
`renderOutput(..., NoToneMapping, renderer.outputColorSpace)` owns only output
conversion, and `RenderPipeline.outputColorTransform` remains disabled.
