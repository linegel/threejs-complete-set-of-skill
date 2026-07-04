---
name: threejs-image-pipeline
description: Build a maximum-performance WebGPU/TSL final-image pipeline for advanced Three.js scenes. Use for RenderPipeline ownership; pass()/mrt() depth, normal, albedo, emissive, velocity, and history signals; GTAONode, BloomNode, TRAANode, exposure, tone mapping, 3D LUT grading, outputColorTransform, and pass diagnostics.
---

# Image Pipeline

Use this skill only when several image-space systems must share buffers,
ordering, temporal history, or final-output ownership. For one isolated effect,
load its atomic skill instead.

Route to companion skills only when needed:

- `$threejs-ambient-contact-shading` for `GTAONode`, bent normals,
  AO denoising, or lighting application;
- `$threejs-bloom` for `BloomNode`, emissive MRT extraction, and HDR bloom;
- `$threejs-exposure-color-grading` for luminance metering, adaptation, tone
  mapping, LUTs, grading, and output conversion;
- `$threejs-dynamic-surface-effects` for feature-local history targets and temporal
  surface effects.

The pipeline must expose its signals, owners, resolution scales, memory cost,
and disable paths before tuning any image.

## Required Architecture

Lead with the highest-throughput architecture: one `WebGPURenderer` from
`three/webgpu`, one node-based `RenderPipeline`, one primary scene `pass()`,
and `mrt()` outputs for every shared gbuffer signal. Do not re-render the scene
for AO, bloom masks, grading, or diagnostics when an MRT signal can feed the
node graph.

Canonical order:

```text
scene pass() with mrt(output, depth, normal, albedo, emissive, optional velocity)
  -> lighting-related screen nodes: GTAONode, bent normals, indirect tint
  -> atmosphere/transparency composition from the shared depth contract
  -> BloomNode from HDR emissive or HDR color
  -> optional temporal resolve from velocity/depth/history
  -> exposure meter and adapted exposure
  -> one tone-map owner
  -> scene-linear or tone-mapped grading, chosen by LUT domain
  -> one output color transform owner
  -> display-referred presentation nodes, UI-safe overlay, diagnostics
```

Use built-in nodes first. A custom node is justified only when it adds a
measured capability the built-in node does not cover.

`PostProcessing` is the deprecated historical name for `RenderPipeline`; do not
teach it as an implementation path.

Legacy WebGL implementation (deprecated, do not extend): none in this folder.

## Capability Gate

Initialize once, then choose quality tiers by capability. Do not teach a local
WebGPU-unavailable path here. If, and only if, the user explicitly asks how to
apply fallback when WebGPU is unavailable, route that teaching to
`$threejs-compatibility-fallbacks`.

```js
import { WebGPURenderer, RenderPipeline, HalfFloatType } from 'three/webgpu';

const renderer = new WebGPURenderer( { antialias: false, outputBufferType: HalfFloatType } );
await renderer.init();

if ( renderer.backend.isWebGPUBackend !== true ) {
  throw new Error( 'WebGPU backend required for the canonical image pipeline. If the user explicitly asks how to apply fallback when WebGPU is unavailable, route to threejs-compatibility-fallbacks.' );
}

const tier = {
  backend: 'WebGPU',
  requiredMRT: 3,
  requiredStorage: false,
  timestampQuery: renderer.hasFeature( 'timestamp-query' ),
  outputBufferType: renderer.getOutputBufferType(),
  memoryBudget: 256 * 1024 * 1024,
  budgetReason: []
};

// compute/storage/MRT path: live metering, temporal history, storage buffers.
```

Quality tiers:

| Tier | Requirements | Defaults |
| --- | --- | --- |
| Full | WebGPU backend with MRT, node passes, storage/compute where used | HDR MRT, live exposure, `GTAONode`, `BloomNode`, optional `TRAANode`, diagnostics |
| Reduced | WebGPU exists but the frame or storage budget is tight | no live compute history, AO/bloom at lower scale, precomputed LUTs, static variants |
| Debug | WebGPU backend during authoring | one diagnostic output at a time, pass timers, owner labels, forced disable paths |

## Build Order

1. Write the signal table before code: producer, consumers, space, type, color
   space, resolution scale, history, disable path, and memory.
   Include world/view/clip/NDC/UV/texel spaces, Y-up, camera looks down `-Z`,
   UV origin, depth policy (`reversedDepthBuffer` or `logarithmicDepthBuffer`),
   normal encoding, velocity sign/current-to-previous convention, and whether a
   delta is in pixels or UV units.
2. Create one scene `pass( scene, camera )`; attach `mrt()` for `output`,
   `normal`, `albedo`, `emissive`, and optional `velocity`. Read depth from the
   pass instead of adding an unmeasured duplicate scene render.
3. Feed shared nodes from the pass textures with `getTextureNode()` and
   `getLinearDepthNode()` or `getViewZNode()` when a consumer needs linear
   depth. Use `PassNode.setResolutionScale()` or effect-node
   `setResolutionScale()` for bandwidth-heavy nodes.
4. Compose the graph as a single `RenderPipeline.outputNode`. Use
   `renderPipeline.render()` in the frame loop.
5. Decide output ownership once. Keep HDR `HalfFloatType` buffers until the
   tone-map owner. Leave `RenderPipeline.outputColorTransform` enabled only
   when the final node is still scene-linear HDR; set it to `false` and use
   `renderOutput()` when display-referred nodes must run after conversion.
6. Add temporal history only when the velocity contract is complete. `TRAANode`
   needs current beauty, depth, velocity, camera jitter ownership, reset events,
   and diagnostics for rejected history.
7. Use GPU compute for live reductions and history preparation only on the full
   tier: `renderer.compute()` / `renderer.computeAsync()`, `Fn().compute(count)`,
   `StorageTexture`, `StorageBufferAttribute`, `StorageInstancedBufferAttribute`,
   `storage()`, and `textureStore()`.
8. Add diagnostics and budgets before visual tuning.

Use `examples/webgpu-image-pipeline/` as the canonical shared-gbuffer example
and `validateImagePipelineConfig.js` as the hard graph gate before browser
render validation.

Read [references/production-image-pipeline.md](references/production-image-pipeline.md)
for concrete contracts, pass graphs, replacement notes, budget targets, and
failure checks.

## Color And Output

- Color textures are `SRGBColorSpace`; data maps, masks, normals, roughness,
  LUT indices, history, and diagnostic data are linear/no-color data.
- Keep working color in scene-linear HDR until the tone-map owner. Use
  `HalfFloatType` for HDR pipeline buffers unless a measured memory tier says
  otherwise.
- Tone-map once. Convert to output color space once. Individual materials,
  effects, and UI overlays must not double-convert.
- A scene-linear creative LUT belongs before tone mapping. A display-referred
  LUT belongs after `renderOutput()`, with `outputColorTransform = false`.
- Exclude UI and debug overlays from exposure metering and HDR bloom unless
  the product explicitly wants those pixels to affect camera response.

## Budgets

Set budgets per enabled graph. Start here, then measure on target hardware:

| Target | Frame cost for full post | Full-res HDR attachments | Reduced passes | Notes |
| --- | ---: | ---: | ---: | --- |
| Desktop discrete | 2.0-4.0 ms at 1440p | 4-6 | 0.5x-0.75x | temporal AO/AA allowed when stable |
| Desktop integrated | 3.0-5.5 ms at 1080p | 3-4 | 0.5x | prefer fewer MRT outputs and shared denoise |
| Mobile/tiled | 4.0-7.0 ms at 720p-900p | 2-3 | 0.33x-0.5x | disable optional history first |

Memory estimate per 1920x1080 attachment:

| Attachment type | Cost |
| --- | ---: |
| RGBA16F HDR | about 16 MB |
| RG16F velocity | about 8 MB |
| R16F scalar | about 4 MB |
| RGBA8 display/data | about 8 MB |

Every enabled pass must state dispatch count if compute is used, render
resolution, attachment count, target type, draw/scene render count, GPU time,
and resize/disposal behavior.

## Rules

- One scene render is the default. Extra scene renders require a measured reason.
- Use `mrt()` for shared depth-adjacent signals instead of duplicating passes.
- Use `GTAONode`, `BloomNode`, `TRAANode`, `DepthOfFieldNode`, and built-in sky,
  fog, and shadow nodes before custom nodes.
- Apply AO to the lighting component it represents; do not blindly multiply the
  final color.
- Use depth/normal-aware upsampling for reduced-resolution effects.
- Own camera jitter in one place; reset history on resize, cut, projection
  change, large exposure jump, material ID instability, or disocclusion.
- Keep pass toggles, effect-only views, and graph inspection available in
  production builds behind diagnostics.
- Do not load all atomic post skills by default. Route only the effects actually
  requested.

## Routing Boundary

Use this skill when multiple image-space systems must share buffers, ordering,
history, budgets, or output ownership. For one isolated effect, use the atomic
skill without loading this coordinator.
