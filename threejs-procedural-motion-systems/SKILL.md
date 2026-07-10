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

Read the shared
[physics-domain and interaction contract](../threejs-choose-skills/references/physics-domain-and-interaction-contract.md)
before coupling motion to terrain, water, weather, contacts, or another solver.
It defines the SI physics frame, gravity and unit conversion, clocks/ticks,
multi-rate scheduler, `WaterSurfaceProvider`, `InteractionRecord`, residency,
state/error versions, and `PhysicsPresentationSnapshot`. This skill owns motion
algorithms behind that boundary; it does not create local substitutes.

The route coordinator owns one canonical `PhysicsGraph`. This skill contributes
named motion stages whose read/write version rules, dependencies, execution
intervals, and commit groups are fixed by that graph; each admitted
`PhysicsStageExecution` resolves those ports and joins the graph's atomic commit
lineage before its output becomes sampleable.

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

A local fixed-step accumulator is only for standalone/authored motion with no
`PhysicsGraph` edge. Cross-domain recurrent motion advances exclusively through
its scheduled `PhysicsGraphStage` executions. Record every admitted native
advance or analytic/state-hold evaluation as an exact `PhysicsStageExecution`;
dropped debt belongs to the graph catch-up loss ledger, not an invented
execution. Only the graph applies catch-up, drop, or discontinuity
policy across the coordination interval. The render loop
may request work and consume presentation, but never advances coupled state.

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
   timelines from authoritative seconds directly. Only standalone recurrent
   simulations use local fixed-step accumulation; coupled recurrent simulations
   use graph executions. Both retain previous/current state and interpolated
   presentation.
3. Define phase contracts, event boundaries, seed ownership, phase-local time,
   replay reset/disposal, and a `DeltaPolicy` with raw delta, clamped delta,
   fixed step, max substeps, simulation time, and presentation time.
4. Derive target position/orientation analytically from named coordinate
   frames: world, subject local, orbital radial/tangent, docking axis, rotating
   hull frame, or camera-authored presentation frame.
5. Encode high-count transforms as compact state: previous position, current
   position, velocity, base quaternion, angular velocity, phase id, seed, and
   flags in storage buffers; dispatch compute from the standalone fixed-step
   loop or its owning `PhysicsGraphStage` execution and
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

Environment-coupled motion is an explicit algorithm boundary. Boats, buoys,
floating debris, and swimmers consume the canonical batched,
channel-requested `WaterSurfaceProvider`. Requests use physics-frame metres and
declare footprint/filter, frame, and one canonical `PhysicsInstant`. The
provider returns one canonical `WaterSurfaceSample`; the motion stage validates
its descriptor and generation, bundle `sampleInstant`, parameterization,
represented footprint/filter, atomic validity, and per-channel error against
the request before advancing actor state. Its channels use the exact shared
names `freeSurfacePoint`, `freeSurfaceNormal`,
`geometricNormalVelocityMps`, `surfacePointVelocityMps`,
`materialCurrentVelocityMps`,
`waterColumnDepthMeters`, optional `densityKgPerM3`,
and the returned shared `PhysicsSignalDescriptor`.
Each channel is the complete shared `SampledChannel` and retains
`actualPhysicsTime` resolving to a `PhysicsInstant`; the requested and actual
instants may differ only within the
declared latency/staleness gates. Missing channels
follow `missingChannelPolicy` and are never synthesized as zero; geometric
surface velocity and material current remain distinct. Consumers do not
redeclare or subset the descriptor/time envelope. The scalar
`geometricNormalVelocityMps` channel is mandatory even when the parameterization-
dependent full `surfacePointVelocityMps` is absent.

Declare one-way coupling (water drives the actor but receives no load) or
two-way coupling. One-way mode identifies the authoritative source and records
a `[G]` upper bound on omitted actor-to-water feedback or explicitly narrows the
claim/regime. The latter uses the shared scheduler order: both owners
predict, sample one coupling-time water bracket, emit source
`InteractionRecord` entries, conservatively scatter loads by conservation
group, advance water/subcycles, reduce reaction records, correct both owners,
check conservation/stability, and atomically commit. Inside one state-equation
owner, coupling may be explicit, semi-implicit, scheduler-bounded iterated, or
monolithic; monolithic means that owner advances every coupled unknown. Any
cross-owner coupling publishes `SurfaceExchange` with exact mode `one-way`,
`two-way-explicit`, or `two-way-iterated`; it is never labelled monolithic.
Gather/scatter are discrete adjoints preserving zeroth/
first moments and gating force, torque, interface work, and added-mass
stability. Conservation covers represented mass, linear/angular momentum,
energy/work, and species; volume is only a fixed-density incompressible
constraint. A visual wake does not make a one-way model two-way. Never obtain
state through frame-critical GPU readback; use a shared analytic/CPU query,
GPU-resident coupled state, or an explicitly latency-bounded service. Route
metric six-degree-of-freedom hydrodynamics to a domain solver and consume its
pose through the canonical `ExternalSolverAdapter`.

Two-way source/reaction records form an all-or-none
`InteractionReactionGroup`; many-to-many reduction is legal, and balance is
tested after transport to its declared frame/reference point.

Presentation is not another physics query. Motion contributes a per-binding/provider
`PresentedStatePair` to the view-independent `PhysicsPresentationCandidate`,
which contains no camera or render transform. `previousPresented` and
`currentPresented` each carry independent `PresentationSampleProvenance`,
`presentedInstant`, state handle, and global spatial binding; `motionBinding`
references both handles and records identity mapping and validity. The camera
owner publishes `CameraViewPublication`, preparation owners publish
`ViewPreparationPublication`, and the sealed `PhysicsPresentationSnapshot`
references candidate binding IDs and lease refs under one
`PresentationTimeCohort`. `PresentationRenderPlan` binds exact pass/resource/
history generations and frame-slot admission before `FrameExecutionRecord` records
multi-target execution and lease disposition keyed by lease ID. Those poses
need not be solver states `n` and `n+1`. Visible transforms, motion vectors,
shadows, bounds, and temporal history resolve through that immutable chain.
Physical instants, physics-frame transforms, floating-origin, and source epochs
remain separate. An incompatible state, transform/source
epoch, residency, or quality migration invalidates or explicitly migrates
history through scoped `ReactivePublication` and `ScopedResetAction` records in
`ViewPreparationPublication`, not extra pair or snapshot flags.
Teleports, topology/deformation changes, emissive events, and disocclusion
contribute scoped reactive epochs/regions for the coordinator's per-view
publication and reset plan.

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
- Provider requests and interaction streams use compact channel-masked SoA,
  bounded queues, generation-bearing identities distinct from storage slots,
  deterministic reductions, and canonical batch-level
  `InteractionBatchLedger` records; avoid per-sample
  JavaScript objects.
- Presentation bindings reference immutable resource generations under a
  frame-in-flight lease/reuse rule; no solver overwrites a pose generation
  still used by a sealed snapshot.
- Physical representation/quality `QualityTransition` is coordinator-admitted at a tick
  boundary with state projection, conserved-value/error ledger, interaction-
  queue boundary, atomic provider generation, history action, rollback, and
  peak old/new residency. Visual crossfades never duplicate forces/reactions.
- Any physics-facing change to
  `PhysicsQualityStateDescriptor.nativeStepAndCouplingControls`,
  `.stateVariablesAndInventories`, `.representedBandsFootprintsAndFilters`,
  `.stableIdPolicy`, or `.presentationRepresentation` requires that exact
  `QualityTransition`; it maps every
  `InteractionRecord.applicationLedgerKey` and
  `InteractionBatchLedger.exactOnceApplicationLedgerVersion`, commits through
  `PhysicsCommitTransaction`, and publishes new versioned state only through
  `PresentationTimeCohort`, `PhysicsPresentationCandidate`,
  `CameraViewPublication`, `ViewPreparationPublication`, sealed
  `PhysicsPresentationSnapshot`, and `PresentationRenderPlan`.
  In-place mutation or an unledgered presentation crossfade is invalid.
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
- A local accumulator never advances a `PhysicsGraph` participant; render delta
  is not cross-domain scheduler time.
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
- Do not call wave phase velocity, group velocity, or the vertical rate of a
  height field a material current. Every water velocity channel names its
  frame and meaning.
- One-way and two-way water coupling are different contracts. One-way requires
  authoritative-source identity plus a gated omitted-feedback bound or narrowed
  claim. Two-way requires
  predict/sample/source-record/load-scatter/water-advance/reaction-reduce/
  correct/check/atomic-commit order, conservation-group and error gates, and matching state
  versions; a foam trail is not feedback.
- Render transforms, velocities, bounds, shadows, and temporal consumers read
  one sealed per-target/view `PhysicsPresentationSnapshot`, never a mixture of
  the candidate with live pre-step or post-step resources.
- Spawn, despawn, teleport, reparent, slot reuse, topology/LOD, and discontinuous
  quality changes publish a motion/history validity reason; they never become
  an extreme derived velocity.

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
Use `$threejs-water-optics` for bounded/coastal free-surface state and
`$threejs-spectral-ocean` for open-ocean wave state. Those skills own the water
query, solver, and coupling error; this skill owns actor pose integration from
the shared `WaterSurfaceProvider` contract. Full rigid-body hydrodynamics,
collision, and control remain domain-physics ownership, while cross-domain
ordering and exchange remain governed by the shared physics-domain and
interaction contract.
