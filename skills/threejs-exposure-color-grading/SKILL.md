---
name: threejs-exposure-color-grading
description: Meter and grade scene-linear Three.js WebGPU images. Use for choosing fixed or automatic exposure; adapting EV on the GPU; assigning tone-map and output conversion; or placing and validating 3D LUTs.
---

# Exposure And Color Grading

Keep the photographed signal scene-linear until the final image chain. One
declared owner controls each exposure group, tone map, and output conversion.

## 1. Lock the color contract

Name the scene-linear working primaries, radiance scale, alpha convention, and
every producer that enters the photographed signal. Convert irradiance through
the material/lighting model before metering radiance. Apply one shared physical
or perceptual radiance scale to lights, environment, atmosphere, emissive
materials, bloom sources, and optical effects.

Partition targets or views into exposure-control groups. A group may share GPU
state only when its radiance basis, meter mask, exposure key, sample schedule,
and reset history are identical. Assign exactly one meter/adaptation owner, one
tone-map owner, and one output-conversion owner per group.

**Complete when:** every photographed input has one basis and scale, and every
group names its members, three owners, and state-sharing policy.

## 2. Choose the cheapest meter that meets the image requirement

Choose in dependency order:

1. fixed EV for a controlled or calibrated view;
2. a stratified grid or tile sampler for ordinary global auto exposure;
3. exact full-pixel hierarchical reduction when every pixel or exact mask must
   contribute;
4. a log-luminance pyramid only when another feature consumes its levels or
   spatial statistics;
5. a histogram only when percentile clipping fixes a demonstrated outlier or
   bimodal-lighting failure.

Tap resolved, pre-bloom HDR by default. This keeps temporal noise out of the
meter and avoids bloom/exposure feedback. A different tap is an authored image
policy with a regression fixture.

Read [the color-pipeline reference](references/scene-referred-color-pipeline.md#meter-implementations)
when implementing sampled, exact, pyramid, or histogram metering; it contains
the weighted-log equations, traffic model, and small-emitter failure tests.

**Complete when:** one meter is selected, its source and mask are named, and
each cheaper rejected option has a concrete correctness failure.

## 3. Build the GPU exposure controller

Keep `targetEV`, `currentEV`, validity, and frame indices in GPU state. Advance
adaptation every rendered frame toward the last valid target, even when the
meter runs less often. Keep CPU readback diagnostic-only.

Use an explicit producer schedule:

```text
adapt currentEV from the last completed target
  -> render and present with currentEV
  -> reduce the new meter source
  -> publish targetEV for a later frame
```

Bind the source texture as a real node dependency and expose both the source
frame and state frame. Initialize or clear the source before the first
reduction. Read [GPU exposure state](references/scene-referred-color-pipeline.md#gpu-exposure-state)
for reduction state, EV adaptation, invalid aggregates, and r185 compute
semantics.

**Complete when:** a frame trace proves which source produced each target,
adaptation remains GPU-resident, and an invalid aggregate holds the prior valid
target without a CPU substitute.

## 4. Handle discontinuities before presentation

Give cuts an authored `hold`, `reseed`, or fixed-EV policy. Treat a radiance
basis, working-primary, quantity, nonlinear-normalization, or exposure-key
change as a new exposure epoch. For a pure positive scale change
`L_new = k * L_old` with otherwise identical semantics, preserve the displayed
product with:

```text
currentEV_new = currentEV_old - log2(k)
targetEV_new  = targetEV_old  - log2(k)
```

Every other incompatible change resets meter accumulation and reseeds adapted
state before the new signal is presented. Resize or DPR changes rebuild
resolution-dependent meter resources and sampling coordinates. Device loss
recreates and reseeds GPU state under the new resource generation.

**Complete when:** every cut, invalid input, basis/scale change, resize, and
device-loss event maps to one conversion, hold, rebuild, or reseed action that
finishes before the affected frame is admitted.

## 5. Compose one final-image chain

Use this domain order unless the LUT declares another complete contract:

```text
scene-linear HDR
  -> exposure
  -> tone map
  -> tone-mapped-linear LUT
  -> alpha restoration
  -> output conversion
```

Unpremultiply before nonlinear RGB operations and premultiply afterward;
exposure preserves alpha. A scene-linear LUT needs a declared shaper. A
display-encoded LUT owns the exact output primaries and transfer function and
therefore sits after `renderOutput()`.

With explicit `renderOutput()`, set
`RenderPipeline.outputColorTransform = false`. Mark
`renderPipeline.needsUpdate = true` after changing the output node or output
ownership. Read [tone mapping and LUTs](references/scene-referred-color-pipeline.md#tone-mapping-and-luts)
when loading, authoring, or placing a cube.

**Complete when:** the graph contains one exposure multiply, one tone map, one
LUT placement in its declared domain, and one working-to-output conversion.

## 6. Prove the selected branches

Capture deterministic fixtures:

- a key-gray calibration card with the expected target EV;
- a bright source entering and leaving frame, with monotone target/current EV
  trajectories in the expected directions;
- the selected meter's branch-specific mask, small-emitter, and cadence cases;
- an identity LUT with ramps and saturated swatches in its declared domain;
- output isolation showing exactly one tone map and one output conversion.

Measure meter and LUT cost as paired graph deltas after warmup on the target.
GPU time is available only after post-init timestamp-query support is proven;
otherwise report the timing as unavailable.

**Complete when:** all applicable fixtures pass, the final image is inspected,
and each failed fixture identifies the meter, adaptation, LUT-domain, alpha, or
output-ownership cause.

## Routing

Use `$threejs-image-pipeline` for shared MRT, temporal history, adaptive DPR,
and transient lifetime; `$threejs-bloom` for glare source ownership; and
`$threejs-visual-validation` for fixed-view image evidence.
