---
name: threejs-visual-validation
description: Validate advanced Three.js WebGPU/TSL graphics as authored systems using fixed-view visual contracts, node-pipeline diagnostics, no-post baselines, seed and temporal sweeps, renderer.info and GPU timing evidence, capability manifests, leak loops, and stable JSON+PNG regression bundles.
---

# Visual Validation

Validate the mechanism that creates the image, not a single polished frame.
The only taught path is latest Three.js with `WebGPURenderer`, TSL,
`NodeMaterial` materials, `RenderPipeline`, built-in post nodes, and
compute/storage evidence where the implementation uses GPU simulation.

## Build Order

1. Define the visual contract and measurable invariants before tuning.
2. Initialize `WebGPURenderer`, call `await renderer.init()`, and record the
   actual backend and capability tier for the run.
3. Build the fastest validation architecture first: deterministic runner,
   fixed camera bookmarks, no-post and final captures, diagnostic passes from
   the node pipeline, seed sweeps, temporal sweeps, GPU timing, `renderer.info`,
   render-target and storage-resource inventories, and dispose/recreate loops.
4. Capture a stable artifact bundle: JSON manifests and PNGs with deterministic
   names, one directory per scene, quality tier, backend, seed, and camera.
5. Reject the implementation when evidence contradicts the declared mechanism,
   even if the final frame is attractive.

## Required Architecture

The validation surface must use:

- `WebGPURenderer` from `three/webgpu`;
- TSL nodes from `three/tsl`;
- `MeshStandardNodeMaterial`, `MeshPhysicalNodeMaterial`,
  `MeshBasicNodeMaterial`, `SpriteNodeMaterial`, or the matching
  `NodeMaterial` family for debug views;
- `RenderPipeline`, `pass()`, `mrt()`, `PassNode.setResolutionScale()`,
  `outputColorTransform`, and `renderOutput()` for post and diagnostic output;
- built-in nodes first where they exist: `GTAONode`, `BloomNode`, `TRAANode`,
  `DepthOfFieldNode`, `CSMShadowNode`, `TileShadowNode`, fog, sky, and related
  node outputs;
- `renderer.compute()` / `renderer.computeAsync()` plus TSL
  `Fn().compute(count)`, `StorageTexture`, `StorageBufferAttribute`,
  `StorageInstancedBufferAttribute`, `storage()` nodes, `textureStore()`,
  `workgroupBarrier`, and `atomic*` evidence when the subject system uses GPU
  simulation, culling, compaction, histories, or generated instance data.

Use [references/graphics-validation-protocol.md](references/graphics-validation-protocol.md)
for the full contract schema, artifact layout, capability tiers, timing
protocol, render-target inventory, color/output rules, mechanism-specific
evidence, and rejection criteria.

## Capability Gate

Every validation run records its actual tier. Compute/storage/MRT validation
uses this gate and stays on native WebGPU tiers:

```js
await renderer.init();

const capabilities = {
  threeRevision: THREE.REVISION,
  renderer: 'WebGPURenderer',
  isPrimaryBackend: renderer.backend.isWebGPUBackend === true,
  outputColorSpace: renderer.outputColorSpace,
  toneMapping: renderer.toneMapping,
  samples: renderer.samples,
  reversedDepthBuffer: renderer.reversedDepthBuffer,
  outputBufferType: renderer.getOutputBufferType(),
  compatibilityMode: renderer.backend?.compatibilityMode ?? null,
  trackTimestamp: renderer.backend?.trackTimestamp ?? null,
  limits: renderer.backend?.device?.limits ?? null,
  features: renderer.backend?.device?.features ? [ ...renderer.backend.device.features ] : null,
  unavailableReason: renderer.backend?.device ? null : 'renderer.backend.device unavailable'
};

if (renderer.backend.isWebGPUBackend === true) {
  qualityTier = 'native-compute';
} else {
  throw new Error('WebGPU backend required for canonical visual validation. If the user explicitly asked how to apply fallback when WebGPU is unavailable, route to threejs-compatibility-fallbacks.');
}
```

Budgeted WebGPU tiers keep the same visual contract but use smaller grids,
fewer temporal samples, lower diagnostic resolution, or other named quality
settings inside the WebGPU architecture. They are not second implementation
recipes.

## Required Evidence

- `visual-contract.json` binding every invariant to `requiredImages`,
  `requiredDiagnostics`, `requiredMetrics`, and `blockingFailures`; a contract
  that requires only `images/final.design.png` is invalid evidence;
- `evidence-manifest.json` with renderer/backend, capabilities, browser/GPU,
  camera, seed, time, viewport, DPR, quality tier, assets, color pipeline,
  post stack, stochastic masks, thresholds, and known compromises;
- final, no-post, diagnostic mosaic, near/design/far, representative seed
  sweep, stress seed, and temporal checkpoints or clip frames as PNGs;
- node pipeline graph summary: `RenderPipeline` output owner, MRT outputs,
  built-in effect nodes, resolution scales, and tone/output transform owner;
- render-target inventory with dimensions, DPR scale, format, type, color
  space, samples, depth/stencil/depth texture, MRT count, lifetime, and owner;
- storage-resource inventory with buffer/texture dimensions, formats, byte
  sizes, dispatch sizes, workgroup assumptions, ping-pong ownership, barriers,
  atomics, and readback policy;
- timing evidence: warm-up window, compile/readback excluded from steady state,
  CPU frame time, GPU timestamp time when exposed, median and p95 over a fixed
  window, plus an explicit `SKIP` verdict when GPU timing is unavailable;
- `renderer.info` metrics, manual target/storage memory estimates, draw calls,
  triangles/points/instances, pass count, dispatch count, and dispose/recreate
  leak-loop results.

Use `examples/webgpu-validation-harness/` as the canonical artifact layout and
schema implementation before adding skill-specific validation. Its budget and
pixel-diff gates are not presence checks: CPU/GPU median frame timings and
target/storage memory are compared to the selected manifest budget profile, and
`perViewPixelDiff` records decode manifest-named baseline/candidate PNG pairs
and fail when the differing-pixel ratio exceeds the declared threshold.

## Budgets

State explicit budgets before acceptance:

| Target | Desktop discrete | Desktop integrated | Mobile |
| --- | ---: | ---: | ---: |
| steady final frame | <= 8 ms GPU | <= 16 ms GPU | <= 24 ms GPU |
| validation capture frame | <= 12 ms GPU | <= 24 ms GPU | <= 33 ms GPU |
| CPU frame orchestration | <= 3 ms | <= 5 ms | <= 8 ms |
| readback/capture overhead | excluded, measured separately | excluded, measured separately | excluded, measured separately |

Also budget pass count, draw calls, dispatches, render-target memory, storage
memory, history buffers, screenshot count, seed count, and leak-loop iterations.
If a subject skill gives stricter budgets, use the stricter number.

## Creature Mechanism Evidence

When validating `$threejs-procedural-creatures`, the standalone creature lab
produces the mechanism metrics and this skill owns their artifact-bundle gates.
Use the creature vocabulary exactly: creature-local SDF field and shell,
world-space planted feet, candidate set versus full field, and display/shadow
snapped-position parity.

| Evidence row | Producing harness | Gate threshold |
| --- | --- | --- |
| SDF snap residual over the locomotion sweep | creature lab `snap residual sweep` export in the visual-validation bundle | max `abs(d - iso) < 0.02` of body scale after bounded Newton snap |
| stance drift, space named `world` | creature lab planted-foot telemetry and foot-drift markers | planted foot world delta `< 1e-9` per frame for stationary and moving gait |
| candidate-set vs full-field sweep | creature lab candidate-set parity sweep over the same locomotion clocks and tier `K` | snapped candidate-set surface remains within the snap residual gate, `< 0.02` of body scale, against full-field evaluation |
| silhouette-vs-shadow parity | creature lab fixed-camera silhouette/shadow mask export consumed by the visual-validation PNG/diff gate | same snapped position path: mask IoU `>= 0.98` and directed edge distance `<= 1 px`; any divergent display/depth position node is a blocking failure |

Pending gate: the standalone creature lab named as the producing harness is not
yet built (`HANDOFF.md` §3 item 3.9e, the register's one open item). Until it
lands, these thresholds are contract targets the lab must enforce, not enforced
gates — no creature work may cite this table as passed evidence.

## Color And Output

- Color textures use `SRGBColorSpace`.
- Data maps, normal/roughness/mask/noise/LUT/weather textures, and diagnostic
  storage use `NoColorSpace` or linear data semantics.
- HDR working targets stay `HalfFloatType` until the single tone-map owner.
- The node pipeline owns the one output conversion through
  `outputColorTransform` or an explicit `renderOutput()` stage.
- Screenshots record the encoding path and must not double-convert material,
  target, or presentation output.

## Replaced Techniques

- Single-frame approval was replaced by fixed-camera contracts plus final,
  no-post, diagnostic, temporal, and seed-sweep artifacts.
- CPU-only timing was replaced by timestamp-query GPU timing when exposed,
  with CPU timing retained only as labelled proxy evidence.
- Informal render-target notes were replaced by a typed target and storage
  inventory tied to `renderer.info` and manual byte estimates.
- One stress seed was replaced by representative seed sweeps plus at least one
  stress seed.
- Manual leak judgment was replaced by resize, tier-switch, reset, teardown,
  and dispose/recreate loops with before/after resource metrics.

## Routing Boundary

This skill evaluates an implementation; it does not supply the subject
mechanism. Load `$threejs-choose-skills` first, then the subject or image-effect
skill such as `$threejs-procedural-planets`, `$threejs-volumetric-clouds`,
`$threejs-spectral-ocean`, `$threejs-water-optics`, `$threejs-bloom`,
`$threejs-ambient-contact-shading`, `$threejs-scalable-real-time-shadows`,
`$threejs-dynamic-surface-effects`, `$threejs-procedural-vegetation`,
`$threejs-procedural-creatures`,
`$threejs-procedural-geometry`, `$threejs-procedural-materials`,
`$threejs-particles-trails-and-effects`, or `$threejs-black-holes-and-space-effects`. Use this
protocol to decide whether the result is acceptable.
