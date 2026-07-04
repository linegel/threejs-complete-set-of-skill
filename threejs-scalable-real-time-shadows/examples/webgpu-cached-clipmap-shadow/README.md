# WebGPU Cached Clipmap Shadow

This is the Phase 1 canonical scaffold for `threejs-scalable-real-time-shadows`.
It keeps the built-in choice first, then implements the custom cached-clipmap
contract only for streaming worlds that need persistent coarse shadow coverage.

## Build Checkpoints

1. Architecture decision: compare one `DirectionalLightShadow`, `CSMShadowNode`,
   `TileShadowNode`, and the custom cached clipmap on the same seeded scene.
   Expected debug: selected path plus measured pass/GPU-time fields.
2. Light frame: derive one directional light-space basis per frame. Expected
   debug: stable `directionEpsilon` state; failure symptom is all cached maps
   mixing different sun directions.
3. Level state: create half-widths, map sizes, sampled half-widths, staggered
   ages, committed invalid sentinels, and texture/memory budgets.
4. Snapping: snap X/Y by each level's world texel width and Z by half-width
   quantum. Expected debug: texel grid remains fixed during `slowPan`.
5. Render commit: publish centers only after a selected level renders. Failure
   symptom: boundary flicker from desired-vs-committed drift.
6. Sampling weights: `setupShadowFilter` samples every level unconditionally and
   applies containment weights afterward. Failure symptom: view-angle dependent
   disappearance or shimmer.
7. Invalidation: `invalidateSphere` marks only levels touched in light-space XY
   and forced invalidation bypasses the ordinary cached budget.
8. Bias: scale `normalBias` by world texel width and route material-specific
   variation through `LightShadow.biasNode` when needed.
9. Caster parity: alpha, wind, displacement, morph, skinning, instancing, and
   batched transforms must match visible NodeMaterial paths.
10. Dispose checkpoint: detached custom node plus cloned shadows, level lights,
    level targets, storage, and debug textures return counters to balance.

Run:

```bash
node threejs-scalable-real-time-shadows/examples/webgpu-cached-clipmap-shadow/validate.js
```
