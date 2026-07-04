---
name: threejs-procedural-motion-systems
description: Build high-performance procedural motion systems in Three.js WebGPU/TSL. Use for launch kinematics, gravity turns, staging, spin docking, target-frame decomposition, spring-follow motion, rotating-frame alignment, peeling debris, analytic transform timelines, frame-rate-independent response, storage/instanced animation, and quaternion control.
---

# Procedural Motion Systems

Animate semantic state, not unrelated transform curves. The default architecture
is latest Three.js `WebGPURenderer` from `three/webgpu`, `THREE.Timer`,
`renderer.setAnimationLoop()`, analytic transform timelines, TSL node
materials, and scale routing to instanced attributes or compute-updated storage
buffers before per-object updates become the bottleneck.

## Build order

Throughput decision table:

| Actor count / shape | Route | Notes |
| --- | --- | --- |
| `<200 Object3D` semantic actors | ordinary transforms | hero launch/docking actors, exact phase state, no per-frame allocations |
| `200-10k` repeated actors | `InstancedMesh` or `BatchedMesh` | chunk bounds, stable material buckets, half-rate distant updates |
| `10k+` independent actors | `StorageInstancedBufferAttribute` / compute storage | compact only when removed work exceeds dispatch cost |

1. Choose the throughput class first: hero actors use a small CPU phase state;
   repeated actors use `InstancedMesh` plus node attributes; particle-scale or
   debris-scale motion uses `StorageInstancedBufferAttribute`,
   `StorageBufferAttribute`, `storage()` nodes, and `renderer.compute()`.
2. Create one renderer loop with `await renderer.init()`,
   `timer.connect(document)`, `timer.update(timestamp)`, fixed-step
   accumulation for deterministic simulation, and presentation interpolation
   from analytic time rather than frame count.
3. Define phase contracts, event boundaries, seed ownership, phase-local time,
   replay reset/disposal, and a `DeltaPolicy` with raw delta, clamped delta,
   fixed step, max substeps, simulation time, and presentation time.
4. Derive target position/orientation analytically from named coordinate
   frames: world, subject local, orbital radial/tangent, docking axis, rotating
   hull frame, or camera-authored presentation frame.
5. Encode high-count transforms as compact state: position, velocity, base
   quaternion, angular velocity, phase id, seed, and flags in storage buffers;
   evaluate per-instance pose in compute or vertex TSL instead of walking
   thousands of `Object3D` transforms.
6. Use frame-rate-independent smoothing with `alpha = 1 - pow(k, dt)` for
   perceptual response, and use bounded second-order springs only when velocity
   is part of the authored motion.
7. Preserve world matrices when detaching semantic children; prefer
   `Object3D.attach()` only for uniform-scale hierarchies. For manual or
   `matrixAutoUpdate=false` graphs, set `matrixWorldNeedsUpdate`, call
   `updateWorldMatrix( true, true, true )`, then capture and restore world
   matrices explicitly.
8. Render with `MeshStandardNodeMaterial`, `MeshPhysicalNodeMaterial`, or other
   `NodeMaterial` family materials; drive animated vertex/instance state with
   TSL attributes/storage, and use `RenderPipeline` for node post output.
   Node-post apps call `renderPipeline.render()`, not renderer.render(), and
   keep `outputColorTransform` as the single output owner.

Read [references/procedural-motion-and-docking-systems.md](references/procedural-motion-and-docking-systems.md)
for the WebGPU/TSL launch, staging, docking, debris, spring, quaternion,
compute/storage, replay, and validation contracts.

## Capability gate and quality tiers

Initialize once, then branch only by quality tier. Explicit requests for
compatibility strategies route to `../threejs-compatibility-fallbacks/`; this
skill keeps one flagship architecture.

```js
await renderer.init();
if ( renderer.backend.isWebGPUBackend ) {
  // Full tier: compute/storage motion, high-count instancing, node post.
} else {
  // Compatibility handoff: use the dedicated compatibility-fallbacks skill.
}
```

Do not write a parallel renderer implementation in this skill.

Quality tiers:

- Full: compute-updated storage buffers, 50k-250k animated instances, 60-120 Hz
  fixed simulation, node post, and GPU timing validation.
- Balanced: 10k-50k instances, fewer active debris phases, half-rate compute
  for distant chunks, and static far LODs.
- Compatibility handoff: use `../threejs-compatibility-fallbacks/` for
  explicit non-primary backend teaching.

## Performance budgets

- Hero actors: under 200 semantic `Object3D` updates, under 0.25 ms CPU
  animation on desktop-discrete, under 0.6 ms on integrated/mobile.
- Instanced actor fields: one draw per geometry/material bucket, one storage
  update dispatch per active system, no per-instance CPU matrix uploads after
  initialization.
- Compute motion: 64-256 invocations per workgroup, one to three dispatches per
  frame for integration, culling/compaction only when it removes more work than
  it costs, and no readback in the frame loop.
- Memory: keep hot state to 48-96 bytes per instance; split static parameters
  from dynamic state so static buffers are uploaded once.
- Frame targets: animation/update budget below 1 ms desktop-discrete, 2 ms
  desktop-integrated, 3-4 ms mobile; shed quality by count, update rate, and
  active phase windows before lowering visual correctness.

## Color and output

- Color textures use `SRGBColorSpace`; data maps, pose textures, noise,
  masks, lookup tables, and generated animation data use `NoColorSpace`.
- Keep HDR buffers as `HalfFloatType` until tone mapping.
- The node post pipeline has one tone-map owner and one output conversion owner:
  `RenderPipeline.outputColorTransform` or an explicit `renderOutput()`, not
  duplicated in materials or effects.
- Prefer built-in node passes where relevant to animated scenes:
  `TRAANode` for temporal reprojection, `BloomNode` for emissive events,
  `GTAONode` for contact grounding, and `CSMShadowNode`/`TileShadowNode` for
  scalable directional shadows before custom code.

## Non-negotiable rules

- Use elapsed seconds, fixed simulation seconds, and presentation seconds; never
  make motion frame-count based.
- Derive orientation from a declared frame, then apply authored roll/spin as a
  separate quaternion with explicit multiplication order.
- Normalize input axes, guard zero-length vectors and antiparallel unit-vector
  cases, and periodically normalize accumulated quaternions.
- Decompose docking error into axial and radial components in the current
  docking frame.
- Switch from spring convergence to an exact terminal pose at the end of a
  sequence; terminal locks must zero residual velocity.
- Use seeded randomness with stored seed, stream/counter, and event flags when
  motion must be reproducible.
- Keep visual shake in a bounded envelope and separate it from trajectory,
  camera shake, and physics state.

## Replaced techniques

- Replaced repeated endpoint lerps with analytic transform timelines because
  they provide continuous position/speed, deterministic replay, and direct
  phase seeking.
- Replaced per-object matrix updates for high-count debris with instanced node
  attributes or compute-updated storage buffers because CPU scene traversal and
  matrix uploads lose one to two orders of magnitude at scale.
- Replaced plain `exp(-lambda * dt)` smoothing spelling with
  `1 - pow(k, dt)` half-life/retention contracts because authored retention is
  easier to tune consistently across frame rates.
- Replaced unconstrained semi-implicit springs as a default with fixed-step
  substepped springs plus terminal snap, and with analytic timelines whenever
  inertia is not part of the visible motion.

## Routing boundary

Use `$threejs-choose-skills` for preflight when a procedural animation request
also spans rendering, geometry, materials, shadows, atmosphere, or post.
Use `$threejs-camera-controls-and-rigs` for shot composition and camera handoffs.
Use `$threejs-particles-trails-and-effects` when the deliverable is primarily plasma, sparks,
or effect pooling rather than object transform motion.
