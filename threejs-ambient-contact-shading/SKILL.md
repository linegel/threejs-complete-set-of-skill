---
name: threejs-ambient-contact-shading
description: Implement production ambient contact shading and ambient occlusion in latest Three.js with WebGPURenderer, TSL, RenderPipeline, GTAONode, TRAANode integration, half-resolution node passes, bilateral reconstruction, and optional custom bent-normal extensions.
---

# Ambient Contact Shading

AO is ambient visibility. It reduces indirect diffuse and environment response;
it must not darken direct light, emission, or the final tone-mapped image.

Use `$threejs-choose-skills` for preflight when AO interacts with a broader
graphics stack. Use `$threejs-image-pipeline` when depth, normal, velocity,
MRT ownership, tone mapping, or output color conversion must be coordinated
with bloom, grading, shadows, SSGI, or other image-space systems.

## Architecture First

Start with the highest-throughput path:

1. Use `WebGPURenderer` from `three/webgpu`, TSL from `three/tsl`,
   `RenderPipeline`, `pass()`, `mrt()`, and the `NodeMaterial` family such as
   `MeshStandardNodeMaterial` or `MeshPhysicalNodeMaterial`.
2. Render one scene pass with MRT output for color and view normals; consume
   the pass depth texture directly.
3. Build AO with the official `ao()` / `GTAONode` baseline. It is the fastest
   correct default because Three.js owns the r185-era node integration,
   internal targets, depth/normal reconstruction behavior, and frame updates.
4. Set AO to half linear resolution with `resolutionScale = 0.5` or
   `setResolutionScale(0.5)` where the pass owns scaling, then reconstruct at
   full resolution with depth- and normal-aware filtering.
5. Enable `GTAONode.useTemporalFiltering` only when the app already uses
   `TRAANode` with valid depth and velocity. Otherwise prefer optional
   `DenoiseNode` or a cheaper spatial preset over unmanaged history.
6. Apply scalar AO through material or node-pipeline ambient visibility before
   tone mapping. Keep HDR buffers as `HalfFloatType` until the single output
   transform.
7. Add a custom TSL bent-normal/horizon extension only when directional
   ambient tint, diagnostics, or a proven scene-specific quality/performance
   win beats the built-in scalar `GTAONode`.

Read [references/gtao-bent-normal-pipeline.md](references/gtao-bent-normal-pipeline.md).

## Capability Gate

Every implementation initializes the renderer and gates features by backend
capability.

```js
await renderer.init();

if ( renderer.backend.isWebGPUBackend ) {
  // Full tier: GTAONode, MRT normals, TRAANode/DenoiseNode, optional storage extension.
} else {
  throw new Error( 'threejs-ambient-contact-shading requires WebGPU; route explicit fallback requests to threejs-compatibility-fallbacks.' );
}
```

Legacy WebGL implementation (deprecated, do not extend): none in this folder;
explicit requests for how to apply fallback when WebGPU is unavailable route to
`../threejs-compatibility-fallbacks/`.

## WebGPU Quality Tiers

| Tier | Use | Settings |
| --- | --- | --- |
| Ultra | Desktop discrete GPU, cinematic close inspection | `GTAONode`, MRT normals, temporal filtering through `TRAANode`, half-res AO, optional `DenoiseNode`, custom bent-normal extension only after validation |
| High | Desktop integrated GPU and normal production default | `GTAONode`, MRT normals, `resolutionScale = 0.5`, normal-aware bilateral reconstruction, no directional tint unless required |
| Medium | WebGPU mobile or thermally constrained devices | `GTAONode`, depth-reconstructed normals if MRT pressure is too high, fewer samples, half/quarter-res AO, no temporal history unless ghosting tests pass |

## Performance Budgets

Target AO as a small part of the post stack:

| Target | Full-resolution output | AO resolution | Budget |
| --- | ---: | ---: | ---: |
| Desktop discrete | 2560x1440 DPR 1 | 1280x720 | 0.6-1.2 ms scalar GTAO, 1.2-2.0 ms with denoise/temporal |
| Desktop integrated | 1920x1080 DPR 1 | 960x540 | 0.8-1.8 ms scalar GTAO, <= 2.5 ms with denoise |
| Mobile/high-DPR tablet | 1920x1080 effective | 960x540 or 480x270 | 1.0-2.5 ms, dynamic scale down before sample count rises |

Budgets include AO gather, denoise or reconstruction, and composite. Track pass
count, draw calls, target size, texture formats, and disabled-AO bypass cost.
Do not increase samples before proving half-resolution scaling, temporal
filtering, and bilateral reconstruction are already exhausted.

## Color And Output

- Color textures use `SRGBColorSpace`; depth, normal, AO, bent-normal, velocity,
  mask, noise, and LUT data stay linear with `NoColorSpace` unless a specific
  node API owns conversion.
- Keep AO and intermediate post buffers in HDR-compatible linear targets;
  prefer `HalfFloatType` where range matters.
- The app has one tone-map owner and one output conversion owner. In the node
  post pipeline, `RenderPipeline.outputColorTransform` or `renderOutput()` owns
  final conversion; AO nodes never double-convert.

## Failure Conditions

- AO multiplies final scene color instead of indirect/environment visibility.
- Direct light, emissive materials, UI, or bloom-fed highlights become gray.
- Radius is specified only in pixels rather than projected from world units.
- Foreground silhouettes cast thick screen-space halos.
- Depth discontinuities are blurred together because normal-aware bilateral
  weights were omitted.
- AO remains strong at distances where its world radius is subpixel.
- Temporal filtering is enabled without valid velocity, depth rejection,
  history invalidation, and camera-cut reset.
- Bent normals are used for lighting before the one-wall validation proves the
  decoded direction turns away from the blocked hemisphere.

## Routing Boundary

This skill owns GTAO configuration, AO quality tiers, scalar ambient-visibility
application, optional custom bent-normal gathering, denoising, and halo
diagnosis. `$threejs-image-pipeline` owns shared depth/normal/velocity buffers,
global pass order, tone mapping, output conversion, and multi-effect MRT reuse.
