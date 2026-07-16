---
name: threejs-image-pipeline
description: Coordinate Three.js WebGPU/TSL final-image graphs. Use when effects share scene-pass signals or output ownership, when choosing MRT versus reconstruction or narrow passes, when admitting temporal history, or when whole-graph budgets and lifetimes decide the design.
---

# Image Pipeline

Build one causal image graph: one HDR scene pass with depth, selected shared
signals, and one final output conversion. Add a scene traversal or attachment
only when its measured alternative is worse.

Use the atomic owner for each admitted effect:

- `$threejs-ambient-contact-shading` for GTAO and indirect-light composition;
- `$threejs-bloom` for glare source selection and `BloomNode` controls;
- `$threejs-exposure-color-grading` for metering, adaptation, tone mapping, and
  LUT domains;
- `$threejs-dynamic-surface-effects` for feature-local screen history;
- `$threejs-visual-validation` for capture, timing, and lifecycle evidence.

## 1. Fix the baseline

Declare physical canvas pixels, target browser/GPU, frame budget, primary
visual contract, and a readable no-post view. Initialize one
`WebGPURenderer`, confirm `renderer.backend.isWebGPUBackend`, create one
`RenderPipeline`, and make one `pass(scene, camera)` own scene-linear HDR plus
its depth texture. Set `trackTimestamp` before `renderer.init()` when GPU timing
is requested.

This step is complete when the baseline renders without optional post, the HDR
and depth producers are named, and exactly one component owns presentation.

## 2. Inventory signals

For every candidate signal—HDR color, depth, normal, emissive, velocity,
diffuse/base color, IDs, histories, exposure, and UI—record:

```text
writer | readers | mathematical/color domain | physical format and extent
first write -> last read | history/reset owner | disable path
```

Treat depth as the pass depth texture rather than an MRT color output. Request
only signals with a real reader.

This step is complete when every graph edge has one writer, all consumers agree
on domain and extent, and every optional signal has a working disable path.

## 3. Admit attachments

First reject any reconstruction, attachment, or narrow-rerender candidate that
cannot meet the signal's declared domain, precision/error bound, spatial
coverage, temporal stability, or discard semantics. Compare the remaining
correct candidates on the target graph:

```text
costMRT(a) = export + store/resolve + all later reads
costAlt(a) = reconstruction or narrow rerender + its traffic
```

Keep the attachment when paired evidence shows `costMRT(a) < costAlt(a)` among
the correct candidates and the peak resident budget still passes. Inspect
compiled physical formats:
r185 named `PassNode` attachments clone the pass output by default, so compact
normal or velocity storage exists only after explicit configuration and
verification.

This step is complete when every retained attachment has a named reader,
verified domain and physical format, declared error/coverage contract, measured
winning correct alternative, and accounted peak bytes.

When implementing `pass()`, MRT, compact formats, or depth branches, read
[Graph construction and signal formats](references/production-image-pipeline.md#graph-construction-and-signal-formats).

## 4. Admit temporal history

Enable temporal output only after all rendered motion has valid previous and
current presentation state:

- rigid transforms, instances, bones, and procedural deformation;
- stable particle/slot identity where particles enter history;
- unjittered previous/current camera transforms and one jitter owner;
- depth, velocity, neighborhood, and out-of-bounds rejection;
- resets for resize/DPR, cut, projection or origin change, scene load,
  spawn/despawn, teleport, reparent, LOD/topology change, and discontinuous
  deformation;
- current, history, rejected-history, velocity, jitter, and reset diagnostics.

r185 velocity is `currentNDC - previousNDC`; TRAA converts it to UV with a
negative Y scale. Stock `TRAANode` requires matching color/depth/velocity/input
extents and MSAA off. A composite temporal input materializes another texture
and fullscreen draw. Stock TRAA has no public general reset or reactive-mask
input, so cuts and discontinuities require an evidenced rebuild or
bypass/reseed policy.

This step is complete when horizontal and vertical motion reproject correctly,
every rendered representation has a velocity policy, each discontinuity fires
an executable reset, and every temporal allocation has an owner.

When temporal reconstruction is present, read
[Temporal admission and resets](references/production-image-pipeline.md#temporal-admission-and-resets)
before creating velocity or history nodes.

When stock `TRAANode` is rebuilt for a supported reset, read
[the minimal rebuild example](examples/rebuild-traa-node.mjs) for its public-API
replacement, output rebind, graph invalidation, and explicit old/new ownership.
Retire the returned previous node only after the replacement graph has
compiled/rendered successfully and the prior GPU generation has completed.

## 5. Compose once

Use this default order:

```text
HDR scene pass + depth + admitted MRT
  -> effect-local lighting histories
  -> lighting/AO/atmosphere with valid temporal inputs
  -> temporal scene-radiance resolve, when admitted
  -> excluded transparent or refractive layers
  -> meter tap from resolved pre-bloom HDR, when admitted
  -> bloom and other scene-linear optical effects, when admitted
  -> fixed or adapted exposure, when admitted
  -> tone map, when admitted
  -> LUT in its declared domain, when admitted
  -> one output conversion
  -> display-domain AA, dither, diagnostics, and UI
```

Keep history in stable pre-exposure scene radiance by default. Add bloom RGB
while preserving scene alpha. If `renderOutput()` owns presentation, set
`renderPipeline.outputColorTransform = false`; after any output-node change,
set `renderPipeline.needsUpdate = true`.

This step is complete when every present meter, bloom, exposure, tone map, LUT,
alpha operation, and output conversion has one owner, and every
transparent/refractive layer has an explicit position.

When choosing a LUT/output ending or handling transparent alpha, read
[Color, alpha, and legal endings](references/production-image-pipeline.md#color-alpha-and-legal-endings).

## 6. Own toggles, size, and lifetime

Count persistent private targets owned by built-in `BloomNode`, `GTAONode`,
`TRAANode`, and `PassNode`. Rebuild the pass to reclaim an attachment previously
requested with `getTextureNode()`; a logical MRT toggle does not reclaim it.
On resize or DPR change, update every explicit extent and reseed all affected
histories. Dispose removed nodes, passes, targets, materials, and storage after
their final GPU use.

Add adaptive DPR only after the fixed-DPR graph has sustained timings. Use
asymmetric dwell and cooldown, distinguish fixed from pixel-scaled work, and
remeasure every quality tier after a size change.

This step is complete when repeated cycles for every supported toggle, size,
tier, and admitted resource stabilize resource counts, and every graph mutation
marks the pipeline dirty.

When estimating traffic, private target residency, marginal cost, or adaptive
DPR, read
[Memory, timing, and adaptive resolution](references/production-image-pipeline.md#memory-timing-and-adaptive-resolution).

## 7. Prove the graph

Capture the no-post baseline, each admitted signal, the diagnostics for each
admitted temporal/meter/bloom/color branch, final output, and physical target
inventory. Measure the complete warmed graph and paired marginal variants only
for admitted alternatives at identical scene state. Exercise the applicable
negative controls: disable each supported optional effect, force each reset
class owned by an admitted history, resize admitted size-dependent resources,
and destroy/recreate the graph.

When a capture, timing scope, reset, output-isolation, or lifecycle control fails, read [Diagnostics and failure signatures](references/production-image-pipeline.md#diagnostics-and-failure-signatures).

The pipeline is complete when every supported shipping tier preserves the
visual contract, the full graph and resident targets meet declared budgets,
output isolation shows one output conversion and—when admitted—one tone map,
diagnostics pass for every admitted temporal branch and axis, and lifecycle
counts plateau after disposal.
