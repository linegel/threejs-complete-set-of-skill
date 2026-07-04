# WebGPU Exposure Color Pipeline

Canonical Phase 1 example for `threejs-exposure-color-grading`: one
`WebGPURenderer`, one `RenderPipeline`, compute-reduced scene-linear luminance
metering, one exposure state owner, `toneMapping()` before `lut3D()`, and final
`renderOutput(..., NoToneMapping, renderer.outputColorSpace)`.

Run static and numeric checks:

```bash
npm --prefix threejs-exposure-color-grading/examples/webgpu-exposure-color-pipeline run check
npm --prefix threejs-exposure-color-grading/examples/webgpu-exposure-color-pipeline run validate
```

## Checkpoint 1 — HDR Source

Expected: `meter source HDR` is scene-linear HDR before tone mapping, LUT, or UI.
If you see display-referred values here, you made the mistake of metering after
tone mapping or output conversion.

## Checkpoint 2 — Meter Mask

Expected: `meter mask` separates center weighting, sky/window policy, and UI
exclusion. If UI changes target exposure, you made the mistake of metering the
overlay instead of the photographed scene.

## Checkpoint 3 — Partial Sums

Expected: `partial logSum weightSum` contains finite per-workgroup values and
the storage count matches `dispatchCount = ceil(pixelCount / workgroupSize)`.
If partials are zero with a visible HDR source, you made the mistake of sampling
the wrong texture or mask channel.

## Checkpoint 4 — Aggregate Average

Expected: an 18% gray card produces target exposure `1.0`. If it does not, you
made the mistake of metering display-encoded color, using the wrong luminance
coefficients, or applying exposure twice.

## Checkpoint 5 — Adapted Exposure

Expected: `adapted exposure` moves monotonically toward target and adapts faster
toward brightening than darkening. If both directions move at the same rate, you
made the mistake of using symmetric adaptation.

## Checkpoint 6 — Post-Tone-Map Linear

Expected: `post-tone-map linear` is bounded linear color before LUT sampling. If
values are already sRGB encoded, you made the mistake of placing
`renderOutput()` before the LUT.

## Checkpoint 7 — LUT Output

Expected: identity LUT output matches input within 1/255. If the identity LUT
changes neutral swatches, you made the mistake of using the wrong LUT domain,
texture color space, or 3D texture layout.

## Checkpoint 8 — Final Output

Expected: final output has exactly one output conversion owner. If
`RenderPipeline.outputColorTransform` is true while `renderOutput()` also owns
conversion, you made the mistake of double-encoding the final image.
