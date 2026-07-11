# WebGPU Image Pipeline

The browser entry now loads `canonical-main.js`, the native-WebGPU owner graph:

```text
one primary scene pass: output + depth + tier-selected normal/emissive/velocity
  -> GTAONode diagnostic (not applied without separated indirect radiance)
  -> materialized stable pre-bloom HDR
  -> TRAANode in temporal tiers
  -> BloomNode from the shared emissive producer
  -> host-safe exposure/grading stage
  -> one tone map and one output conversion
```

`main.js`, `pipelineConfig.js`, and the artifact-contract-v3 scripts are retained
as the older minimal construction fixture. They remain useful static tests but
are not the canonical browser entry and cannot satisfy the v2 runtime gate.

The retained v3 browser artifact fixture opts into
`preset: 'feature-demo'`, adding unmeasured normal and emissive attachments,
GTAONode with an explicitly-authored AO split scaffold, and selective bloom.
That legacy preset demonstrates wiring; it is not the canonical v2 final graph
or the copyable mobile default.

## Claim boundary

Static validators prove graph reachability, conditional MRT construction, r185
depth helpers, built-in node wiring, output ownership, resize/DPR mechanics,
and declared disposal ownership. Browser behavior is evidence only after the
versioned artifact bundle is captured and passes `validate:artifacts`. Neither
path proves that the feature preset's MRT selection is faster than
depth reconstruction or a narrow pass. It does not expose physical direct and
indirect lighting buffers. Canonical GTAO is therefore reachable only as a
diagnostic; the final output does not multiply direct light or emissive by AO.
The old v3 numeric AO oracle validates only its explicitly labelled scaffold.

The canonical owner implements temporal output, velocity, rebuild-on-reset,
GPU-resident exposure, tone-mapped-linear LUT grading, and runtime owner/resource
descriptors. Adaptive-DPR control, transient aliasing, wide-gamut/HDR
presentation, and device performance are not accepted. Browser artifacts from older
versions do not prove the current contract.

The `debug` tier adds an albedo diagnostic PassNode. It is reachable only from
`albedo-extra-pass`, and `describePipeline()` then reports two scene
submissions. The shipping `full` and `reduced` routes do not hide that cost.

## Host integration API

`stage.js` exports `createImagePipelineStage(...)` for integration flagships.
The host supplies its initialized native-WebGPU renderer, camera, shared scene
color/depth/velocity/emissive textures, and optional external bloom texture.
The adapter creates no renderer or `RenderPipeline`; it owns only its current
and pre-grade materializations, optional `TRAANode`, and exposure state. The
host assigns `stage.outputNode`, sets its sole pipeline's
`outputColorTransform = false`, calls `stage.beforeRender(dt)` before rendering,
and calls `stage.meterAfterRender()` after the composed pre-grade target exists.
After `stage.resetHistory(cause)`, the host reassigns `stage.outputNode` and
marks its pipeline dirty because the temporal/exposure graph was rebuilt.

The browser fixture is opaque. Its canonical graph preserves pass alpha and
adds only bloom RGB; it is not evidence for transparent-canvas or
post-temporal transparency composition.

Run:

```bash
npm --prefix threejs-image-pipeline/examples/webgpu-image-pipeline run check
npm --prefix threejs-image-pipeline/examples/webgpu-image-pipeline run validate
npm --prefix threejs-image-pipeline/examples/webgpu-image-pipeline run validate:artifacts
```

The standard validation reports the browser-artifact gate as `ABSENT` or
`NOT_RUN`; it does not turn missing evidence into a pass. `validate:artifacts`
is the blocking bundle check.

The browser fixture adds an authored key light, ambient fill, ground, shaded
box, and emissive sphere so normal, depth, AO, emissive, and bloom diagnostics
contain falsifiable signal. These scene choices test graph wiring; they are not
a recommended lighting rig.

The retained `node capture.mjs` writes legacy artifact-contract version `3`.
`node canonical-capture.mjs` writes the v2 native-WebGPU bundle used by
`validate:artifacts`. The legacy diagnostic mosaic
contains only implemented signals: normal, emissive, linear depth, `AO.r`, bloom
contribution, and a compressed RGBA8 inspection of the pre-tone-map graph.
Signed normals are remapped to `[0,1]`, linear depth uses an explicit inverted
grayscale transfer, and HDR-derived signals use a bounded inspection transform.
The artifact
validator explicitly rejects stale velocity, albedo, temporal-AA, exposure, and
LUT claims. GPU time is recorded only when all requested r185
`timestamp-query` samples resolve; otherwise the GPU gate is `SKIP` and the CPU
number is labelled as JS graph-submission time.

## Numeric provenance

`IMAGE_PIPELINE_NUMERIC_PROVENANCE` classifies every configuration number.
Current values are explicitly scoped:

| Value | Provenance |
| --- | --- |
| primary scene-render count `1` | `[Authored]` baseline architecture |
| scene scale `1`, AO scale `0.5`, bloom scale `0.5` | `[Authored]` feature-demo settings |
| legacy-v3 AO indirect fraction `0.25` | `[Authored]` scaffold, not a canonical lighting ratio |
| static accounting size `1920 * 1080` | `[Authored]` validator fixture, not runtime canvas |
| RGBA16F `8` bytes/pixel, RG16F `4` bytes/pixel | `[Derived]` logical texel storage |
| logical memory gate `256 MiB` | `[Authored]`, not physical allocation evidence |

`ARTIFACT_NUMERIC_PROVENANCE` separately classifies fixed camera bookmarks,
capture extent/DPR, warm-up and sample counts, WebGPU row alignment, lifecycle
iterations, cache allowances, image thresholds, and the shared-schema liveness
ceilings. The latter are artifact health gates, not product frame-time or memory
recommendations.

The static memory result excludes depth, alignment, allocator granularity,
private GTAO/Bloom targets, MSAA, and backend compression. It is a logical lower
bound.

Checkpoint numbers below are `[Derived]` structural ordering.

## Checkpoint 1 — Conditional scene signals

The default selects only `output` and disables GTAO and bloom. `main.js` builds the MRT dictionary from
`config.requiredMRT`. The explicit `feature-demo` preset selects `output`,
`normal`, and `emissive` for browser diagnostics without claiming that wider MRT
wins on a target.

Depth comes from `scenePass.getTextureNode('depth')`. It must never appear in
the MRT color-output list.

## Checkpoint 2 — Raw and linear depth

`depth raw` is the pass depth texture. `linear depth` comes from
`scenePass.getLinearDepthNode('depth')`; it is not a renamed raw-depth view.
Any consumer threshold must still declare perspective, reversed, logarithmic,
or orthographic depth policy.

## Checkpoint 3 — Normal trade

The optional feature-preset normal attachment demonstrates sharing with GTAO and diagnostics.
This example has no paired MRT-versus-depth-reconstruction GPU timing, so it
cannot choose the attachment for a tile/mobile target. The production skill
requires that measurement.

## Checkpoint 4 — Selective emissive/bloom

In the explicit feature preset, the emissive attachment feeds `BloomNode`; the
scene is not rerendered for a bloom mask. The minimal default has neither the
attachment nor bloom. This example does not prove emissive temporal stability.

## Checkpoint 5 — AO boundary

`GTAONode` produces an indirect-visibility diagnostic. The browser scene lacks
separated direct/indirect radiance, so the canonical final path does not apply
AO. The retained v3 scaffold and deliberately wrong RGB multiply are secondary
contract fixtures, not final paths. Bloom adds only its RGB contribution and
preserves stable scene alpha; image-space lighting must not make opacity depend
on AO or glare intensity.

## Checkpoint 6 — Temporal convention

The production skill documents r185 `VelocityNode` as:

```text
velocityNdc = currentNdc.xy - previousNdc.xy             [Derived]
offsetUv = velocityNdc * vec2(0.5, -0.5)                 [Derived]
previousUv = currentUv - offsetUv                        [Derived]
```

The Y flip is mandatory. The canonical full/debug tiers expose actual
`TRAANode` current, version-locked r185 history-target, and resolved diagnostics.
History reset disposes and rebuilds the node, then validates that its first
resolved frame agrees with a fresh current frame. The retained v3 fixture still
rejects temporal configuration and cannot satisfy this canonical proof.

## Checkpoint 7 — Tone/output ownership

The renderer uses `NeutralToneMapping`. `renderOutput()` owns tone mapping and
working-to-output conversion while `RenderPipeline.outputColorTransform` is
disabled. No LUT is present, so `lutDomain` is `null`.

## Checkpoint 8 — Resize, DPR, and lifetimes

`resize()` calls both `renderer.setPixelRatio()` and `renderer.setSize()`.
Pass/effect nodes resize from the drawing buffer. The example reports selected
MRT logical bytes but does not claim transient aliasing; built-in targets remain
persistent until disposal.

## Rejected fixtures

The validator rejects duplicate scene passes, duplicate output ownership,
depth in MRT, undeclared MRT consumers, temporal mode without velocity/jitter/
reset ownership, and enabling exposure/LUT/adaptive-DPR/transient features that
the example does not implement.
