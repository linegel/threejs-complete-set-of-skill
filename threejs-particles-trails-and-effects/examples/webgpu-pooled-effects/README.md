# WebGPU Pooled Effects

Canonical fixture for the particles, trails, and effects skill.

Checkpoint 1: allocate storage pools.
Expected: `StorageInstancedBufferAttribute` arrays exist for start position,
velocity, age, render attributes, and transform.
If you see holes in the live range, run `dense-swap.test.mjs` before tuning
visuals.

Checkpoint 2: spawn deterministic event packets.
Expected: the same seed replays the same spark and debris buffers.
If you see drift between captures, remove all `Math.random` usage from the
effect path.

Checkpoint 3: run compute update and compaction.
Expected: integration uses semi-implicit velocity, drag uses `Math.exp`, and
expired instances dense-swap every render-visible storage slice.
If you see stale colors or dissolve age on moved entities, the pool copied the
matrix but not the custom attributes.

Checkpoint 4: attach the hull shell and wake fields.
Expected: `supportPoint`, `flowDirectionWorld`, `flowFacingMask`, `wakeOrigin`,
and `shearLobe` diagnostics update from the same event frame.
If you see a disconnected glow, the shell is not derived from local hull
samples.

Checkpoint 5: render MRT emissive and bloom.
Expected: beauty remains readable with bloom disabled, while selective bloom
uses the `emissive` target from the `RenderPipeline` graph.
If you see bloom-only shape, fix HDR emission before changing the bloom node.

Checkpoint 6: verify depth and bounds.
Expected: hull plasma, wake core, haze, sparks, and debris keep `depthTest`
enabled, use `softDepthFade` for near occluders, and call `computeBounds` for
live chunks.
If you see effects through unrelated geometry, do not disable depth testing;
reduce layers or repair the depth texture path.

Checkpoint 7: inspect budgets.
Expected: `renderer.info` and the validation report expose draw, compute,
occupancy, shell triangle, and live instance counters.
If you see a missed GPU budget, lower live cap, layer count, field octaves, or
bloom scale before moving simulation to the CPU.

Run:

```sh
node --check main.js
node dense-swap.test.mjs
node validate-effects.mjs
```
