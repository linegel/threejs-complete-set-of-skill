---
name: threejs-procedural-planets
description: Author high-performance procedural planetary bodies in latest Three.js with WebGPURenderer, TSL, NodeMaterial, cube-sphere quadtree LOD, GPU displacement, coupled crater/biome/climate fields, analytic normals, altitude LOD, and atmosphere handoff from orbit through close approach.
---

# Procedural Planets

Build a planet as a streaming cube-sphere quadtree whose visible patches are
displaced by one shared TSL field bundle. The same planet-space causes must
drive geometry, normals, color, roughness, biome masks, crater topology,
climate, water/ice identity, diagnostic views, and atmosphere handoff.

Canonical implementation contract: `examples/webgpu-quadtree-planet/`.
Run `node examples/webgpu-quadtree-planet/validate-planet.mjs` after edits.

Legacy WebGL implementation (deprecated, do not extend): `examples/procedural-planet-surface/planet-system.js` and `examples/procedural-planet-surface/terrain-field.js`.

## Required Architecture

1. Use `WebGPURenderer` from `three/webgpu`, `MeshStandardNodeMaterial` or
   `MeshPhysicalNodeMaterial`, and TSL from `three/tsl`.
2. Represent the body as six cube faces split into quadtree patches with
   stable patch IDs, neighbor-aware edge stitching, and per-patch bounds.
3. Generate patch vertices as unit cube-sphere directions; keep the undeformed
   direction in a `surfaceDirection` attribute and treat it as the canonical
   planet coordinate.
4. Evaluate shared TSL `Fn` field functions for displacement, material causes,
   and diagnostics. Reuse the same functions in vertex displacement, surface
   material nodes, and compute passes.
5. Run compute passes through `renderer.compute()` or `renderer.computeAsync()`
   to fill `StorageBufferAttribute` patch data, parity sample buffers, optional
   indirect dispatch data, and cached min/max bounds.
6. Build crater, biome, hydrology, snow/ice, volcanic, ridge, humidity, and
   temperature fields as coupled causes. Do not author isolated color noise
   after terrain.
7. Filter detail by represented patch scale and camera altitude. Fade
   contribution strength; do not change procedural frequency abruptly.
8. Feed shared planet center, radius, radiance scale, surface altitude, and
   atmosphere masks to `$threejs-sky-atmosphere-and-haze`.
9. Use `RenderPipeline` with node passes for the final stack. Prefer built-in
   `TRAANode`, `GTAONode`, `BloomNode`, `CSMShadowNode`, and `TileShadowNode`
   when they cover the need; custom nodes must beat or extend them.

Read [references/planet-field-and-atmosphere-systems.md](references/planet-field-and-atmosphere-systems.md)
for the complete field contract, quadtree LOD policy, parity harness, crater
model, material assembly, atmosphere handoff, diagnostics, and performance
budgets.

## Capability Gate And Quality Tiers

Initialize the renderer before allocating compute or storage resources:

```js
await renderer.init();

const tier = renderer.backend.isWebGPUBackend ? "full" : "reduced";
```

- Full tier: compute-generated quadtree patches, storage-backed parity samples,
  GPU patch bounds, node material displacement, node post pipeline, and dynamic
  atmosphere handoff.
- Balanced tier: same architecture with lower patch density, fewer crater
  octaves, cached far-field tiles, half-resolution diagnostics, and fewer
  active node passes.
- Reduced tier: static precomputed patch rings or generated variant textures,
  coarse LOD distances, disabled compute readback diagnostics, and simpler
  material channels. It is a quality reduction, not a parallel implementation.

## Performance Budgets

Use budgets as design inputs, not after-the-fact measurements:

| Target | Patch vertices | Active patches | Compute | Draws | Planet cost |
| --- | ---: | ---: | ---: | ---: | ---: |
| desktop discrete | 128-257 per side near camera | 300-900 | 2-5 dispatches/frame, dirty patches only | 150-500 | 2.0-4.0 ms |
| desktop integrated | 65-129 per side | 120-360 | 1-3 dispatches/frame | 80-220 | 3.0-6.0 ms |
| mobile WebGPU | 33-65 per side | 60-160 | 0-2 dispatches/frame, mostly cached | 40-120 | 4.0-8.0 ms |

Keep the far field mostly static. Rebuild only dirty patch rings, body-identity
changes, or camera-threshold crossings. Store patch metadata compactly:
center/radius/error/min/max in one storage record per patch, and avoid per-frame
CPU readback except explicit parity tests.

## Color And Output

- Color textures use `SRGBColorSpace`.
- Data textures, masks, field LUTs, crater atlases, biome tables, and generated
  diagnostic textures use `NoColorSpace`/linear data.
- Keep HDR working buffers as `HalfFloatType` until the single tone-map owner.
- The node post pipeline owns the one output conversion through
  `RenderPipeline.outputColorTransform` or an explicit `renderOutput()` node.
  Materials and effects must not double-convert.

## Non-Negotiable Constraints

- Do not use a single static high-resolution sphere as the primary path; it is
  replaced by cube-sphere quadtree LOD because it wastes vertices away from the
  camera and cannot stream close approach.
- Domain-warp tangentially and renormalize; never stretch regions by radial
  coordinate drift.
- Craters need floor, wall, rim, ejecta, age/degradation, overlap behavior, and
  shared material outputs.
- Continents and biomes are region fields derived from geological and climate
  causes, not isolated threshold bubbles.
- Geometry displacement and material normals describe the same height function.
- Macro silhouette must survive altitude changes; micro detail may fade out.
- Expose field views, patch error, parity error, detail weights, and
  displacement exaggeration.

## Completion Test

Validate at fixed cameras and at least three seeds:

- unlit silhouette;
- flat albedo with atmosphere disabled;
- grazing directional light;
- orbit, horizon, and close-approach views;
- biome-mask, crater-topology, normal-only, roughness-only, and patch-error
  views;
- CPU query versus TSL compute parity samples with reported max and mean error;
- atmosphere handoff masks and shell/post blend from
  `$threejs-sky-atmosphere-and-haze`.

## Routing Boundary

Use `$threejs-choose-skills` for multi-system preflight when planets are part of
a larger scene. Use `$threejs-procedural-fields` for reusable field bundles
without a complete body, `$threejs-procedural-materials` for standalone
material authoring, `$threejs-ambient-contact-shading` for custom GTAO
work beyond the built-in node, `$threejs-scalable-real-time-shadows` for
large-world shadow policy, `$threejs-image-pipeline` for shared gbuffer,
velocity, and output ownership, `$threejs-visual-validation` for screenshot
and GPU proof, `$threejs-exposure-color-grading` for metering and tone-map
ownership, `$threejs-water-optics` for water volume optics, `$threejs-volumetric-clouds`
for cloud volumes, `$threejs-rain-snow-and-wet-surfaces` for weather envelopes
and precipitation masks, `$threejs-compatibility-fallbacks` only for explicit
teaching on how to apply fallback when WebGPU is unavailable, and
`$threejs-sky-atmosphere-and-haze` for scattering
independent of planet generation. This skill owns the coupled planetary surface
and its LOD/parity architecture.
