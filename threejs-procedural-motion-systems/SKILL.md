---
name: threejs-procedural-motion-systems
description: Build representation-selected procedural motion systems in Three.js WebGPU/TSL. Use for launch kinematics, gravity turns, staging, spin docking, target-frame decomposition, spring-follow motion, rotating-frame alignment, analytic transform timelines, frame-rate-independent response, storage/instanced animation, and quaternion control.
---

# Procedural Motion Systems

Animate semantic state, not unrelated transform curves. The default architecture
is pinned Three.js r185 `WebGPURenderer` from `three/webgpu`, `THREE.Timer`,
`renderer.setAnimationLoop()`, analytic transform timelines, TSL node
materials, and scale routing to instanced attributes or compute-updated storage
buffers before per-object updates become the bottleneck.

Every numeric claim is `Authored`, `Derived`, `Gated`, or `Measured` with
source and context. An authored count/rate is a trial point, a derived value
cites its equation, a gate belongs to the product contract, and a measurement
names runtime, target, workload, and quantile. None is universal by default.

## Build order

Choose the time model before the throughput model:

| Motion class | State/update path | Presentation |
| --- | --- | --- |
| Closed-form, seekable transform | Evaluate directly from authoritative time on CPU for few actors or in vertex TSL for many | No fixed-step integration or interpolation latency |
| Event-driven analytic phases | Evaluate phase curves directly; store only discrete event state | Exact seek plus deterministic event replay |
| ODE, constraint, collision, or spring state | Fixed-step/substepped integration with previous/current states | Interpolate with `alpha = accumulator / fixedStep` |
| Pure perceptual follow | Frame-rate-independent exponential response | Render-time response; do not label it physical simulation |

Do not dispatch fixed-step compute for a transform already expressible in
closed form. Conversely, do not sample recurrent spring or constraint state
from variable render delta.

Throughput decision table:

| State/reuse shape | Route | Notes |
| --- | --- | --- |
| few heterogeneous semantic objects | ordinary transforms | exact phase state, hierarchy semantics, no per-frame allocations |
| repeated identical topology/material | `InstancedMesh` | one instanced draw per visible spatial page/bucket; dirty attributes only |
| varied topology sharing compatible material state | `BatchedMesh` | r185 scene/state management and per-object culling; measure one backend draw item per visible multi-draw entry |
| dense independent recurrent state that remains GPU-resident | storage attributes + measured compute | use only past the measured CPU/upload crossover; compact only when removed work exceeds dispatch cost |

1. Choose the throughput class first: a few semantic objects use small CPU phase state;
   repeated actors use `InstancedMesh` plus node attributes; particle-scale or
   debris-scale motion uses `StorageInstancedBufferAttribute`,
   `StorageBufferAttribute`, `storage()` nodes, and `renderer.compute()`.
2. Create one renderer loop with `await renderer.init()`,
   `timer.connect(document)`, and `timer.update(timestamp)`. Sample analytic
   timelines from authoritative seconds directly. Only recurrent simulations
   use fixed-step accumulation, previous/current state, and interpolated
   presentation.
3. Define phase contracts, event boundaries, seed ownership, phase-local time,
   replay reset/disposal, and a `DeltaPolicy` with raw delta, clamped delta,
   fixed step, max substeps, simulation time, and presentation time.
4. Derive target position/orientation analytically from named coordinate
   frames: world, subject local, orbital radial/tangent, docking axis, rotating
   hull frame, or camera-authored presentation frame.
5. Encode high-count transforms as compact state: previous position, current
   position, velocity, base quaternion, angular velocity, phase id, seed, and
   flags in storage buffers; dispatch compute from the fixed-step loop and
   evaluate render pose in vertex TSL from previous/current storage plus alpha
   instead of walking thousands of `Object3D` transforms.
6. Use frame-rate-independent smoothing with `alpha = 1 - pow(k, dt)` for
   perceptual response, and use bounded second-order springs only when velocity
   is part of the authored motion.
7. Preserve world transforms when reparenting semantic children. Compute
   `M_local_new = inverse(M_world_newParent) * M_world_old`; decompose only when
   TRS residual passes. Non-uniform ancestry may create shear, which requires a
   full local matrix with `matrixAutoUpdate=false`, a baked/affine wrapper, or
   rejection. `Object3D.attach()` is only for compatible uniform-scale chains.
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
if ( renderer.backend.isWebGPUBackend !== true ) {
  throw new Error(
    'WebGPU is required for the canonical procedural-motion path; explicit fallback teaching belongs to threejs-compatibility-fallbacks.'
  );
}
```

Do not write a parallel renderer implementation in this skill.

Quality tiers:

- Full: the selected analytic/recurrent solver, complete interaction and
  deformation contract, full-rate active state, and measured timing.
- Balanced: same motion invariants with lower distant update cadence, bounded
  active windows, coarser representation, and explicit presentation error.
- Minimum: native WebGPU, fewer active actors, analytic transforms where
  possible, coarse distant cadence, and static far LODs.

## Performance contract

- CPU semantic transforms: record active count, hierarchy depth, changed
  matrices, upload bytes, and update/submission p50/p95. Static and closed-form
  state is sampled directly and does not require recurrent integration.
- Instanced fields: one draw per compatible identical-topology/material page
  after culling; record submitted/visible instances and dirty parameter bytes.
  `BatchedMesh` varied-topology entries remain separate r185 backend draw items
  and use their own submitted-entry ledger.
- Compute motion: derive invocations from active recurrent state and tune
  workgroup size on the target. Add culling/compaction only when it removes more
  submission/vertex/fragment work than its dispatch and traffic cost; no
  steady-frame readback.
- Memory: derive hot state as `activeCapacity * alignedDynamicStrideBytes` plus
  history/scan slots. Split immutable parameters from dynamic state and upload
  dirty ranges only.
- Frame target: the router allocates a marginal update ceiling from the whole
  frame. Gate contemporaneous full-frame and paired-marginal p50/p95 CPU/GPU
  update time on target hardware; shed count,
  recurrent-state frequency, and active phase windows before changing the
  authored motion contract.

## Color and output

- LDR color textures encoded as sRGB use `SRGBColorSpace`; HDR/EXR radiance
  remains loader-declared linear. Data maps, pose textures, noise, masks,
  lookup tables, and generated animation data use `NoColorSpace`.
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
