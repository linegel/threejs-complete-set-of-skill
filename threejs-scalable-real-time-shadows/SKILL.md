---
name: threejs-scalable-real-time-shadows
description: Implement scalable real-time WebGPU/TSL shadow systems for Three.js. Use for dynamic scenes, bounded lights, cascades, tiled projections, streaming open worlds, cached clipmaps, ShadowNode hooks, texel stabilization, update budgets, targeted invalidation, and node-material caster parity.
---

# Scalable Real-Time Shadows

Start by choosing the cheapest architecture that matches the spatial problem. Caching and update budgeting are the order-of-magnitude lever; do not re-render wide shadow coverage every frame unless the scene truly changes every frame.

| Scene shape | First implementation path | Why |
| --- | --- | --- |
| Bounded receiver/caster region | One `DirectionalLight` with its normal `DirectionalLightShadow` | One shadow render pass, one map, lowest binding pressure. |
| Camera-frustum cascades | Built-in `CSMShadowNode` from `three/addons/csm/CSMShadowNode.js` | Official WebGPU cascade implementation; tune splits before custom code. |
| Huge mostly static projection split into independent squares | Built-in `TileShadowNode` from `three/addons/tsl/shadows/TileShadowNode.js` | Tiled shadow maps avoid one overlarge projection without custom cache ownership. |
| Streaming open world with persistent coarse coverage | Custom cached clipmap by extending `ShadowNode`/`ShadowBaseNode` behavior | Reuses coarse maps across frames, refreshes only dirty levels, and targets invalidation to changed chunks. |

Legacy WebGL implementation (deprecated, do not extend): `../threejs-procedural-buildings-and-cities/examples/authored-financial-tower/shadow-clipmaps.js`.

## Required Baseline

Use `WebGPURenderer` from `three/webgpu`, TSL from `three/tsl`, NodeMaterial-family materials, and node shadow hooks. Do not hand-author a parallel renderer path.

Capability gate for custom clipmaps, compute-generated caster lists, storage-backed dirty masks, or other WebGPU-only resources:

```js
await renderer.init();

const fullShadowTier = renderer.backend?.isWebGPUBackend === true;

if (fullShadowTier) {
  // Full tier: CSMShadowNode, TileShadowNode, or custom cached clipmap.
} else {
  // Reduced tier: fewer levels, smaller maps, static/precomputed casters, no custom compute queue.
}
```

Quality tiers are algorithmic, not alternate implementations:

- `ultra`: `CSMShadowNode` or custom clipmap, 4-6 levels, dynamic near levels, cached coarse levels, GPU-timed update budget.
- `high`: 3-4 levels or 2x2 `TileShadowNode`, reduced far distance, targeted invalidation.
- `reduced`: one shadow or two near levels, static far receivers, precomputed terrain/structure caster sets.

## Custom Clipmap Contract

Use a custom cached clipmap only after built-in nodes fail the open-world requirement. The implementation must:

1. Define concentric light-space square levels.
2. Snap every committed level center to that level's world texel grid.
3. Publish material-facing centers only after the corresponding map render completes.
4. Sample all level comparison textures in uniform control flow, then apply weights.
5. Refresh near dynamic levels every frame and update coarse levels under a hard budget.
6. Let explicit invalidation bypass the ordinary coarse-level budget.
7. Scale normal bias by world texel width and use `LightShadow.biasNode` when the bias varies by level/material.
8. Dispose cloned shadows, level lights, targets, shadow nodes, storage buffers, and debug textures.

Read [references/cached-clipmap-shadows.md](references/cached-clipmap-shadows.md) before implementing custom cached directional shadows.

Use `examples/webgpu-cached-clipmap-shadow/` as the canonical Phase 1 contract
for custom clipmaps. It includes the decision record, `CachedClipmapShadowNode`
hook boundary, per-level `inverseMapSize` gates, targeted invalidation,
dispose counters, and `node examples/webgpu-cached-clipmap-shadow/validate.js`.

## Budgets

Set budgets before tuning visuals:

- Shadow passes: bounded scene `1`; cascades `2-4`; tiles `tilesX * tilesY`; custom clipmap `dynamicLevels + cachedBudget + forcedInvalidations`.
- Map memory: `sum(width * height * bytesPerDepthTexel)` plus any debug/variance maps; keep the default custom profile under 64 MiB on desktop and under 24 MiB on integrated/mobile tiers.
- Sampled shadow textures per material: stay under the target backend limit; prefer 3-4 custom levels before raising map count.
- Draw calls: count per shadow pass. Split static and dynamic casters so cached coarse passes skip unchanged static geometry.
- GPU time targets: desktop discrete <= 1.5 ms average / <= 4 ms spike; desktop integrated <= 2.5 ms average / <= 6 ms spike; mobile/reduced <= 3 ms average / <= 8 ms spike.
- Compute/storage: dirty-mask and caster-compaction dispatches should stay below one dispatch per changed chunk class plus one prefix/compaction dispatch; no CPU readback in the frame loop.

## Color And Output

Shadows are data, not color. Shadow maps, masks, dirty textures, and debug numeric overlays use linear/no-color data handling. App color output remains owned by the node pipeline: one tone-map owner, one output transform owner through `RenderPipeline.outputColorTransform` or `renderOutput()`, and HDR buffers stay `HalfFloatType` until tone mapping.

## Failure Conditions

- The decision table is skipped and a custom clipmap is built for a bounded scene.
- Projection centers move by fractions of a texel.
- Shader containment uses desired centers instead of committed rendered centers.
- Coarse levels refresh every frame without measured need.
- Explicit invalidation waits behind the ordinary coarse update budget.
- Comparison sampling is placed behind per-pixel conditionals.
- The same normal bias is used across radically different texel sizes.
- Visible materials and shadow casters do not share alpha, displacement, morph, skinning, or instancing logic in their node graphs.
- Level boundaries become visible under slow camera motion.

## Routing Boundary

Use this skill for light-space directional shadow maps. Use `$threejs-ambient-contact-shading` for view-dependent ambient visibility; AO is not a replacement for cast shadows. Use `$threejs-image-pipeline` when shadow output must coordinate with the node post pipeline, and `$threejs-visual-validation` for fixed-view shimmer, cache, and budget regression tests.
