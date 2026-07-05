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
5. Render commit: bind the selected level's `DepthTexture` render target, fit
   an orthographic light camera to snapped bounds, draw the caster scene, then
   publish centers. Failure symptom: boundary flicker or state commits without
   renderer calls.
6. Sampling weights: `setupShadowFilter` samples every level unconditionally and
   applies containment weights afterward. Failure symptom: view-angle dependent
   disappearance or shimmer.
7. Invalidation: `invalidateSphere` marks only levels touched in light-space XY
   and forced invalidation bypasses the ordinary cached budget.
8. Bias: scale `normalBias` by world texel width and route material-specific
   variation through `LightShadow.biasNode` when needed.
9. Caster parity: the displaced example caster assigns one shared node object
   to `positionNode`, `castShadowPositionNode`, and
   `receivedShadowPositionNode`.
10. Dispose checkpoint: detached custom node plus cloned shadows, level lights,
    level targets, storage, and debug textures return counters to balance.

Run:

```bash
node threejs-scalable-real-time-shadows/examples/webgpu-cached-clipmap-shadow/validate.js --allow-missing-gpu
```

The GPU artifact layer now has a browser producer. From this example directory,
run:

```bash
node capture-shadow-depth.mjs
```

The capture harness serves the repo root, opens `browser.html` under Playwright
Chromium with WebGPU flags, writes `artifacts/shadow-map.png`,
`artifacts/silhouette.png`, and `artifacts/shadow-capture.json`, then runs:

```bash
node validate.js --artifacts artifacts
```

Without either `--allow-missing-gpu` or produced artifacts, validation exits
non-zero because the artifact layer is intentionally required.

Evidence provenance, stated precisely: `shadow-map.png` is a light-view
depth-ramp re-render of the caster scene through the SAME shared displaced
`positionNode` the shadow pass uses, and `silhouette.png` is the light-view
binary coverage mask — neither is a texel readback of the cached level-0 depth
atlas (r185 depth textures are not directly bufferable from this page; a raw
sample readback returned zeros). The claim "the cached atlas was really
rendered" is carried by the separate validator gate that counts real renderer
draws per committed level plus the `firstDepthTexture`/`renderedLevels`
metadata in `shadow-capture.json`; the PNGs prove the displaced caster is what
the light sees. Do not cite the PNGs as atlas contents.
