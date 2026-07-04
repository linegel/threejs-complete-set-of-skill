---
name: threejs-particles-trails-and-effects
description: Author production WebGPU/TSL particles, trails, and real-time effects in Three.js. Use for ship-conforming reentry plasma, generated capsule wakes, compute-updated instanced sparks, timed dissolving debris, dense-swap effect pools, and MRT-driven scene-relative HDR emission hierarchy.
---

# Particles, Trails, and Effects

Use `$threejs-choose-skills` preflight when an effect also needs custom
atmosphere, shadows, camera staging, temporal surfaces, precipitation, or
post-stack architecture. This skill owns ship-space plasma, generated wakes,
analytic sparks, pooled debris, lifetime compaction, and scene-relative HDR
emission for effects.

## Architecture First

Start with the fastest correct architecture, then scale quality inside it:

```text
event envelope + seed
  -> compute spawn/update/expire/compact into StorageInstancedBufferAttribute
  -> dense live range rendered by SpriteNodeMaterial or instanced NodeMaterial
  -> hull-conforming shell/wake displacement in TSL
  -> MRT emissive output
  -> RenderPipeline selective BloomNode and final output transform
```

Do not teach CPU-per-object effects. The production path is a fixed-capacity
pool with GPU-resident dynamic state, seeded spawn packets, dense-swap
compaction, and one draw per visual class. Static parameters are generated once;
per-frame compute updates only age, transform, velocity, liveness, and compacted
indices.

Use [references/particles-trails-and-effects-system.md](references/particles-trails-and-effects-system.md)
for the full implementation contract: reentry shell/wake representation,
compute pool layout, dense-swap invariants, depth policy, budgets, diagnostics,
and the replaced techniques from the historical implementation.

Canonical WebGPU/TSL fixture: `examples/webgpu-pooled-effects/`.

Legacy WebGL implementation (deprecated, do not extend): `examples/reentry-plasma/reentry-plasma.js`

Historical rename only: `PostProcessing` was renamed to `RenderPipeline`; new
systems use `RenderPipeline`.

## Mandatory Baseline

- Renderer: `WebGPURenderer` from `three/webgpu`; call `await renderer.init()`.
- Materials: TSL from `three/tsl` with `SpriteNodeMaterial`,
  `MeshBasicNodeMaterial`, `MeshStandardNodeMaterial`, or
  `MeshPhysicalNodeMaterial`.
- Compute: TSL `Fn().compute(count)`, `renderer.compute()` or
  `renderer.computeAsync()`, `storage()` nodes, `StorageInstancedBufferAttribute`
  for instance-visible state, and `StorageTexture` only when the effect is a
  texture field.
- Rendering: `InstancedMesh` or sprite batches backed by storage attributes;
  update `mesh.count` from the live range and keep per-patch bounds valid.
- Post: `RenderPipeline`, `pass()`, `mrt()`, `outputColorTransform` or
  `renderOutput()`, and `BloomNode` on the MRT `emissive` texture.
- Built-ins first: use `BloomNode` for bloom, `TRAANode` when the post stack
  needs temporal reprojection, `GTAONode` for shared scene grounding, and
  `$threejs-scalable-real-time-shadows` for `CSMShadowNode` / `TileShadowNode` decisions.

## Capability Gate

Every compute/storage/MRT particle-and-effect system includes this gate. The non-primary path
is a quality tier, not another implementation recipe:

```js
await renderer.init();

const quality = renderer.backend.isWebGPUBackend
  ? "ultra"
  : "compat";

if (quality === "ultra") {
  // full compute/storage path, MRT emissive, pooled dense compaction
} else {
  // reduced-quality tier: lower caps, fewer static LOD layers, no custom
  // renderer rewrite. Explicit fallback recipes live in compatibility-fallbacks.
}
```

Quality tiers:

| Tier | Pool cap | Reentry/wake | Post | Target |
| --- | ---: | --- | --- | --- |
| `ultra` | 64k-256k live instances | 3-5 shells, 2-3 wake classes, 3 octave procedural fields | half-res selective bloom, optional temporal AA | desktop discrete |
| `high` | 24k-64k live instances | 2-4 shells, 1-2 wake classes, 2 octave fields | half-res bloom | desktop integrated |
| `medium` | 8k-24k live instances | 1-2 shells, 1 wake class, 1-2 octave fields | quarter/half-res bloom | mobile or constrained |
| `compat` | 1k-8k visible instances | reduced static shell/wake LODs | bloom optional | non-primary backend |

## Build Order

1. Checkpoint: event envelope and seed.
   Expected: spawn window, normalized lifetime, transform, flow direction,
   luminance scale, and effect class are logged in the validation report.
   If you see nondeterministic captures, remove `Math.random` from spawn paths.
2. Checkpoint: storage-backed pools per visual class.
   Expected: sparks, debris, wake cards, and shock flecks allocate
   structure-of-arrays storage once.
   If you see per-frame object churn, the system has fallen back to emitters.
3. Checkpoint: static attributes.
   Expected: random phase, local anchor, base radius, color family, mesh
   variant, and material flags are generated once.
   If you see upload spikes, cold fields are being rewritten in the frame loop.
4. Checkpoint: compute update and dense-swap compaction.
   Expected: event packets spawn, age integrates, expired instances swap every
   render-visible slice, and live indices stay dense.
   If you see stale colors or dissolve values, custom attributes did not move
   with the swapped entity.
5. Checkpoint: dense live rendering.
   Expected: `SpriteNodeMaterial` handles camera-facing sparks and instanced
   NodeMaterial meshes handle debris and hull-conforming shells.
   If you see WebGPU point-size artifacts, replace point primitives with sprites
   or instanced quads.
6. Checkpoint: hull shell and wake fields.
   Expected: flow-facing masks, support-point wake origin, capsule wake/lobe
   meshes, and analytic filament fields share one event frame.
   If you see a detached aura, rebuild the shell from local hull samples.
7. Checkpoint: MRT emissive and bloom-off proof.
   Expected: HDR color writes to MRT `emissive`, bloom reads only that texture,
   and the beauty path stays legible when bloom is disabled.
   If you see bloom-only shape, fix material emission before post tuning.
8. Checkpoint: diagnostics and budgets.
   Expected: pool occupancy, spawn count, compact count, overdraw heat, layer
   masks, raw HDR, bloom contribution, depth policy, and per-tier GPU time are
   visible.
   If you see a missed budget, lower live cap, layer count, field octaves, or
   bloom scale before changing the architecture.

## Performance Budgets

Targets are for the whole particle-and-effect subsystem at 1080p, excluding unrelated scene
cost:

| Budget | Desktop discrete | Desktop integrated | Mobile/constrained |
| --- | ---: | ---: | ---: |
| GPU time | 0.8-1.5 ms | 1.5-3.0 ms | 3.0-5.0 ms |
| Compute dispatches | 2-5/frame | 1-4/frame | 1-3/frame |
| Draw calls | 1 per visual class, 4-8 total | 3-6 total | 2-4 total |
| Live instances | 64k-256k | 24k-64k | 8k-24k |
| Storage writes | <= 64 bytes/live instance/frame hot path | <= 48 bytes | <= 32 bytes |
| Transparent layers over hull | 3-5 | 2-4 | 1-2 |
| Bloom resolution | 0.5 scale | 0.5 scale | 0.25-0.5 scale |
| HDR targets | `HalfFloatType` | `HalfFloatType` | prefer `HalfFloatType`, drop tier first |

Use chunked bounds and per-patch visibility for large fields. Avoid a single
unculled monolith unless the effect is camera-attached and its bounds are
explicitly validated.

## Color And Output

- Color textures use `SRGBColorSpace`; data textures, masks, noise, LUTs, and
  storage-generated fields use `NoColorSpace`/linear.
- Keep HDR in `HalfFloatType` working buffers until the final transform.
- There is one tone-map owner and one output conversion owner: the node
  pipeline via `outputColorTransform`, or explicit `renderOutput()` when a
  late post node needs transformed input.
- Material emission is scene-relative. Preserve hierarchy, then calibrate:
  spark flash > projectile > laser > ordinary surface.
- Bloom is a response to authored HDR emission, not the primary shape. Always
  verify a bloom-disabled baseline.

## Rules

- Every layer must earn its cost through silhouette, motion, illumination, or
  residue.
- Use normalized lifetime curves and seeded randomness.
- Derive secondary motion from the same event direction, flow field, or impact
  frame.
- Keep spawn, simulation, compaction, draw, and post costs measurable per tier.
- Expose raw debug views for masks, age, velocity, live indices, overdraw,
  luminance, MRT emissive, and bloom.
- Treat old constants as scene-relative evidence, not portable defaults.

## Routing Boundary

Use `$threejs-dynamic-surface-effects` only for screen-space frost, thaw, and
touch-history masks. Use `$threejs-rain-snow-and-wet-surfaces` for falling rain or
snow, splash flipbooks, and weather events that alter ground materials. Use
`$threejs-procedural-motion-systems` for authored motion timelines, staging debris,
and event kinematics. Use `$threejs-camera-controls-and-rigs` for camera-relative
readability and velocity framing. Use `$threejs-bloom` and
`$threejs-image-pipeline` when the shared post stack or exposure path is the
primary task.
