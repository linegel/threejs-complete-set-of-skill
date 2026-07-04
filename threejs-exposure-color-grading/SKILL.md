---
name: threejs-exposure-color-grading
description: Build a maximum-performance WebGPU/TSL exposure and grading path in Three.js. Use for compute-reduced luminance metering, storage-buffer exposure state, shader-side asymmetric adaptation, single tone-map/output ownership, and post-tone-map lut3D color grading.
---

# Exposure and Color Grading

Lead with the fastest architecture: one `WebGPURenderer`, one node
`RenderPipeline`, HDR scene color in `HalfFloatType`, GPU compute reduction for
metering, storage-buffer exposure state, one tone-map owner, `lut3D()` in a
documented post-tone-map domain, and one final output conversion. `lut3D` is an
addon, not a `three/tsl` core export:
`import { lut3D } from 'three/addons/tsl/display/Lut3DNode.js'`.

Do not tune color by stacking compensating operations. Exposure, tone mapping,
creative grading, gamut handling, antialiasing, and output conversion each own
one named stage.

## Order

```text
HDR scene pass / MRT
  -> HDR effects such as bloom
  -> compute luminance reduction into storage buffers
  -> compute adapted exposure state
  -> apply adapted exposure in TSL
  -> tone map into bounded post-tone-map linear display domain
  -> lut3D color grade in that documented domain
  -> optional gamut compression / dithering / FXAA in named domain
  -> renderOutput(..., NoToneMapping, renderer.outputColorSpace)
```

Read [references/scene-referred-color-pipeline.md](references/scene-referred-color-pipeline.md)
for the compute meter, quality tiers, budgets, color-space ownership rules, LUT
setup, and replacements for the old meter/readback path.

## Capability Gate

```js
await renderer.init();

if ( renderer.backend.isWebGPUBackend ) {
  await renderer.computeAsync( exposureWarmupNodes );
  quality.exposure = 'compute-histogram';
} else {
  throw new Error( 'WebGPU backend unavailable for the canonical exposure path.' );
}
```

Budgeted WebGPU tiers may use lower metering cadence, authored shot tables, or
smaller LUTs inside the canonical WebGPU/TSL architecture. Do not build a
parallel shader pipeline inside this skill.
If, and only if, the user explicitly asks how to apply fallback when WebGPU is unavailable,
route that teaching to `../threejs-compatibility-fallbacks/`.

## Failure conditions

- the meter renders a tiny target and reduces it on the CPU;
- per-frame readback blocks exposure or drives the in-frame result;
- tone mapping occurs in both materials and post;
- `renderer.toneMappingExposure` and adapted exposure both animate;
- `renderOutput()` is placed before a LUT that expects linear display-domain input;
- exposure is used to repair physically inconsistent light ratios;
- meter weighting, masks, and percentile clipping are not inspected;
- adaptation speed is symmetric toward light and dark;
- LUT input/output domains are undocumented;
- output conversion happens twice;
- a post-tone-map LUT is moved before tone mapping without being rebuilt.

## Routing boundary

Run `$threejs-choose-skills` preflight for broad final-image ownership. Use
`$threejs-bloom` for HDR glow contribution, `$threejs-image-pipeline` when this
path shares ownership with AO, atmosphere, velocity/history, or effect-local
targets, and `$threejs-visual-validation` for exposure/LUT regression scenes.
