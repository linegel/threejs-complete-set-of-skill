---
name: threejs-procedural-creatures
description: Build workload-selected procedural and generated creatures in Three.js r185 WebGPU/TSL. Use for spec-driven bodies, semantic rigs, field-extracted skinned reference meshes, diagnostic SDF shells, procedural gait/hop/flight/swim locomotion, support-relative foot planting, 2-bone IK, verlet appendages, repeated populations, deterministic creature labs, and genetic variation. Not for imported glTF skinned-clip pipelines.
---

# Procedural Creatures

Start with `$threejs-choose-skills` preflight when creatures live inside a
larger scene stack. A creature here is an authored JSON spec compiled into a
posed-primitive control rig. The skeleton is a semantic control rig
(animation, IK, physical proxies, attachments), and its field is the generative
surface source. The stable-topology default is a field-extracted reference mesh
with skinning and optional bounded local correction; the per-slot snapped shell
is diagnostic only. Distant bodies may use view-constrained impostors. No path
raymarches the body. Pose is a compact primitive buffer sampled from an
analytic clock, advanced by a local fixed-step solver only when recurrent state
is standalone/authored, or advanced by its owning `PhysicsGraphStage` when
recurrent state is cross-domain.

Read the shared
[physics-domain and interaction contract](../threejs-choose-skills/references/physics-domain-and-interaction-contract.md)
before habitat, support, water, contact, or cross-domain coupling. It defines the
SI physics frame, gravity, clocks/ticks, scheduler, typed providers including
the immutable `EnvironmentForcingSnapshot`,
`InteractionRecord`, conservation groups, residency/state versions, and
the immutable presentation publication chain. This skill consumes those boundaries;
it does not fork them inside creature locomotion.

Reactive locomotion consumes the complete `SupportSurfaceSample` selected by
the instant arm of its request's `requestedPhysicsTime: PhysicsTime`, including
stable support/feature identity,
point kinematics, sidedness, footprint, validity, and correlated channel
error; it does not turn that kinematic query into a contact impulse. Swimming
and buoyancy consume the complete `WaterSurfaceSample` returned under the
request's channel mask and latency/error gates. They preserve the distinctions
among geometric interface motion, parameterization velocity, material current,
depth, and pressure rather than filling absent channels with zero.

For plants and foliage use `$threejs-procedural-vegetation`. For generic
transform timelines, springs, and staging use
`$threejs-procedural-motion-systems`. Imported glTF skinned-clip pipelines
(retargeting, animation blend trees, VAT crowds) are outside this pack — say so rather
than stretching this skill over them.

## Choose The Skin Representation First

Do not make every generated body pay for a live SDF evaluation. Choose from
the update topology, projected error, and reuse count. Compute pixel error with
the shared
[projected-error contract](../threejs-choose-skills/references/projected-error-contract.md),
including its unjittered projection and hysteresis rules.

| Workload | Representation | Required proof |
| --- | --- | --- |
| pose changes; surface connectivity does not | one extracted reference mesh per compatible `{compilerSignature, topologySignature, geometryDigest}`, then skinning plus optional bounded local field correction | topology validity, bidirectional surface error, skin-weight continuity, correction residual |
| geometry parameters change within a proven fixed-connectivity envelope | the same extracted reference mesh, skinned and locally corrected | signed-Jacobian/inversion and surface-error sweeps over the complete envelope |
| morphology can merge, split, open, or close components | budgeted dynamic extraction, otherwise unsupported | extraction cadence, transition policy, topology/event correctness, full mesh-validity gates |
| close deformation needs joint smoothing | generated skinned mesh plus one bounded field correction | correction residual and shadow/depth parity |
| many bodies share topology | shared generated mesh/material, per-instance pose storage | visible-instance submission, dirty upload bytes, and deformation error |
| projected body diameter is small | orientation-aware impostor or aggressively simplified mesh | silhouette error over the accepted view cone and transition hysteresis |

The per-slot capsule shell that snaps every slot onto the union field is a
preview/diagnostic representation only. It produces coincident or overlapping
surface sheets at blends and cannot establish a manifold skin. The default
stable-connectivity path extracts one reference mesh per compatible compiler,
topology, and rest-geometry identity, skins it, and applies at most a bounded
local field correction.
Marching cubes, surface nets, and dual contouring are load-time choices: select
by topology and feature requirements, validate the extracted surface, and
never remesh at spawn. If the authored morphology changes connectivity, use a
measured dynamic extractor or reject that operation explicitly.

## Field-Driven Creature Architecture

The canonical renderer path is pinned Three.js r185 `WebGPURenderer` from `three/webgpu`,
TSL from `three/tsl`, storage-buffer pose data, and node materials. Build in
this order; every step ends in something renderable or assertable.

1. **Layering.** Pure core (spec, field math, rig compiler, locomotion) with
   zero `three` imports; a Three/TSL adapter package; a thin scene adapter that
   only feeds world `RigPose` values; a standalone deterministic creature lab
   that imports the package and never the app.
2. **Spec.** A creature is a small JSON `CharacterSpec` (~15–250 lines) of
   round primitives: tapered capsules, spheres, cones, verlet `rope` chains,
   IK `leg` parts. One validation gate; every error names `part.field`,
   because specs are meant to be generated, including by AI.
3. **Rig and blend compile.** Parts map to primitive slots
   (capsule/cone/sphere = 1, rope = `segments`, leg = 2). The spec declares
   either an explicit blend tree/group graph with a symmetric `k` at every
   internal node or a validated order-independent n-ary kernel. Sorting part
   ids is not blend physics: renaming an id must not alter the surface, and
   permuting the input array must preserve both the compiled graph and field.
   Candidate programs retain every active leaf/subtree and blend ancestor,
   plus a saturation or tail certificate for every omitted sibling. A separate
   omitted color-weight bound is mandatory because geometric saturation does
   not bound the proximity-color kernel; rest-AABB
   overlap is only a conservative selector. Validate the
   bounded evaluation against the complete graph over the full pose/morphology
   envelope, including field, normal, and perceptual color error. Failed bounds
   raise K/rebuild or reject the tier; they never silently change grouping.
4. **Pose runtime.** The runtime pose is a typed-array SoA buffer
   (`a.xyz|ra`, `b.xyz|rb`, `k|rgb` per slot), not object graphs re-copied
   into per-material vectors. Standalone/authored locomotion may advance on a
   local fixed-step accumulator (1/60 or 1/120, clamped input dt) and render
   interpolated pose — feet never pop on frame hitches. Cross-domain recurrent
   locomotion advances exclusively through its scheduled `PhysicsGraphStage`
   executions, with each attempted native advance or analytic/state-hold
   evaluation represented by an exact `PhysicsStageExecution` in the
   coordination record. Dropped debt remains in the graph catch-up loss ledger;
   it is not a fake execution. Only
   `PhysicsGraph` owns catch-up, drop, and discontinuity, and the render loop
   never steps that state. Root motion lives in the object
   transform;
   primitives stay creature-local; support-planted feet convert through the
   inverse root transform for body-frame IK, then write creature-local leg
   slots before storage upload and posed-bounds update. Maintain a real
   per-instance bounds from posed primitive AABBs. Prefer a conservative
   animation envelope for unchanged or analytic poses; refit only dirty or
   independently deforming instances. Never ship `frustumCulled = false`.
5. **Field.** Tapered-capsule distance + pairwise polynomial smooth-min
   (Quilez form). Compute the analytic gradient fused into the same loop —
   per-primitive radial direction minus the cone taper term `s·û`, blended
   `grad = mix(gradA, gradB, h)` through each smin (the exact gradient of the
   polynomial smooth-min, not an approximation) — instead of 6-tap finite
   differences (a ~7× field-evaluation saving); keep central differences only
   as a CPU verification tap. PARITY CONTRACT: the CPU sampler and the TSL
   emitter implement the same formulas and change in the same commit.
6. **Surface.** Extract and validate one reference mesh under an explicit
   component policy for each compatible
   `{compilerSignature, topologySignature, geometryDigest}`; compute semantic/geodesic or
   bounded-harmonic skin weights with contact barriers and a measured cap on
   normalized nonnegative influences. Use LBS only where a twist/volume sweep
   passes; use dual-quaternion or center-of-rotation skinning where LBS collapses
   joints, and gate their bulge/twist errors. A local Newton correction uses a
   curvature/edge-scale trust radius plus residual-decreasing backtracking; it
   rejects gradient degeneracy, triangle inversion, or failed descent. The
   acceptance sweep reports signed triangle area/Jacobian, inversion count,
   self-intersections, duplicate/coincident coverage, minimum angle, and
   bidirectional Hausdorff error. Store and transport a continuous radial frame
   from the rest mesh/skeleton; never choose a helper axis anew from the posed
   direction because the branch switch rotates `theta` discontinuously. The
   per-slot capsule shell remains a lab preview for field/candidate debugging,
   never the shipping topology.
7. **Rendering at scale.** Share geometry only under a compatible
   `{compilerSignature, topologySignature, geometryDigest, tier}` mesh identity;
   a material may span mesh identities only when its graph/storage layout is
   identical. A biological/species label is not a batch key.
   Pose lives in storage (`instancedArray` / storage buffer) indexed by
   `instanceIndex * maxParts + slot`; evaluate the field over the bounded
   candidate set, with a dynamic loop bounded by the actual part count, never
   a masked full-budget unroll. Upload only active dirty pose ranges; coalesce
   writes and record bytes/frame instead of rewriting page-capacity storage by
   default. Cache material variants by
   `{compilerSignature, topologySignature, tier, outline, debugMode, K}`;
   scalar controls (ramp bands, roughness, outline width, sun, visualization
   range) stay uniform writes, never graph rebuilds.
8. **Shading.** Select a diagnostic scalar view, illustrative ramp, or
   physically based surface from the output contract; toon is not the default
   for every scene. Corrected normals come from the final raw field gradient,
   normalized only for shading. Proximity-blended part identity may drive
   albedo/roughness or a scientific scalar palette. Optional field self-AO uses
   a measured number of taps and only describes intra-body occlusion.
   For toon hatching or paint-stroke stability that wants texture-space
   evaluation, treat a decoupled texture-space cache as an exception with an
   explicit UV, update, filtering, memory, and visible/shadow parity contract;
   it is not a default creature lighting cache.
   Prove shadow parity: the shadow/depth path must consume the same deformed
   position function, verified by a silhouette-vs-shadow test, not assumed.
   Decode authored sRGB colors to linear before any uniform/storage upload.
9. **Outline.** For repeated populations, one post-process ID/normal edge pass over the
   whole population. The per-creature iso-offset back-face hull is a hero-shot
   variant only — it re-runs the entire snap per vertex and doubles draws.
10. **Locomotion when requested.** Habitat selection, spawn placement, and
    route choice consume an injected, versioned world-field query with declared
    units, validity, and error; they never infer coast, substrate, slope, or
    water depth from rendered color or read a GPU render target back to the
    CPU. Reactive planted gait consumes an injected
    canonical `SupportSurfaceProvider` returning stable support/feature IDs,
    closest point, outward normal, and represented point velocity/acceleration;
    moving-frame angular kinematics come from its `PhysicsFrameDescriptor`.
    Plant feet in that moving support frame;
    this is kinematic support sampling, not a collision/contact impulse ABI;
    physical contacts use the shared contact record and `InteractionRecord`.
    Derive homes and swing arcs in its tangent plane, including slopes. Then
    use analytic 2-bone IK with a Gram-Schmidt bend hint;
    hopper state machine with volume-preserving squash
    (`sxz = 1/sqrt(squash)`); closed-form flight sampled from sim time;
    weather-responsive flight/appendages consume same-frame relative air
    velocity and density from a versioned `EnvironmentForcingSnapshot` graph
    edge, preserving channel time/support/filter/error and never owning private
    wind state;
    fixed-step verlet ropes; buoyancy response against the shared batched,
    channel-requested `WaterSurfaceProvider`. Habitat, support, and water use
    canonical `PhysicsSampleRequest` records in physics-frame metres with
    context/provider/signal/schema IDs. `requestedPhysicsTime: PhysicsTime`
    selects `kind: instant`, carries a raw `PhysicsInstant` in `instant`, and a
    full canonical `TypedAbsence` record in `interval`; requests also carry
    channel masks, footprint/filter, tolerances, staleness, acceptable
    residency/latency, and batch extent. Descriptor
    discovery supplies a stable descriptor-table reference rather than a deep
    copy. Samples use
    `freeSurfacePoint`, `freeSurfaceNormal`, `geometricNormalVelocityMps`,
    `surfacePointVelocityMps`,
    `materialCurrentVelocityMps`, `waterColumnDepthMeters`, optional
    `densityKgPerM3`. The response envelope retains `requestedPhysicsTime` and
    `actualBundleTime` as `PhysicsTime` wrappers using that instant arm and
    canonical `TypedAbsence` interval arm; every
    `SampledChannel.actualPhysicsTime` retains the same wrapper. The domain
    sample's `sampleInstant` remains a raw `PhysicsInstant`. Requested and
    actual instant-arm values may differ only within declared latency/staleness
    gates. Each channel is the complete shared `SampledChannel`.
    `geometricNormalVelocityMps` is mandatory even when the parameterization-
    dependent full `surfacePointVelocityMps` is absent. Surface-point velocity
    and material current are distinct;
    unrepresented channels are absent, not zero, and a dependent tier is
    blocked rather than inventing them. Consumers do not subset, rename, or
    independently clock the shared envelope. An injected
    open-sea adapter may wrap
    `threejs-spectral-ocean/examples/webgpu-fft-ocean/createCpuWaterHeightSampler()`;
    a bounded-water adapter may wrap
    `threejs-water-optics/examples/webgpu-bounded-water/createBoundedWaterHeightQuery()`
    for its analytic component. The raw spectral sampler supplies truncation
    and per-sample inversion residuals; the provider adapter adds any measured
    floating-point/GPU-probe discrepancy or marks it unavailable. The bounded
    adapter reports analytic inversion/residual error plus either a proven
    live-grid residual bound, a converged surrogate error, or canonical typed
    absence classified `unavailable`. Missing
    error fields block locomotion tiers that require them. Creature locomotion
    never hides those errors behind frame-critical GPU readback. Rope-verlet
    writes its segment slots after base squash staging,
    after root-yaw target conversion, and after IK writes; the last stage
    touching a slot wins. Everything deterministic: seeded LCG + sim clock
    only — `Math.random`/`Date.now`/`performance.now` are banned in render
    code. A one-way creature/water route identifies the authoritative source and
    records a `[G]` upper bound on omitted creature-to-water feedback or
    explicitly narrows the claim/regime. If a creature participates in two-way
    water or contact physics, it
    emits source `InteractionRecord` entries and consumes reduced reaction
    records in the shared both-owner-predict/sample/load-scatter/water-advance/
    reaction-reduce/correct/check/atomic-commit graph; local
    decals or ripple calls are not feedback. Coupling inside one state-equation
    owner may be explicit, semi-implicit, scheduler-bounded iterated, or
    monolithic; monolithic means that owner advances every coupled unknown. Any
    cross-owner route publishes `SurfaceExchange` with exact mode `one-way`,
    `two-way-explicit`, or `two-way-iterated`; it is never labelled monolithic.
    Its gather/scatter pair preserves zeroth/first moments and gates force,
    torque, interface work, and added-mass stability. Source/reaction records
    form an all-or-none `InteractionReactionGroup`; many-to-many reduction is
    legal and balance is tested in its declared frame/reference point. The accepted pose is contributed
    as a per-binding/provider `PresentedStatePair` to the view-independent
    `PhysicsPresentationCandidate`, which contains no camera or render
    transform. `previousPresented` and `currentPresented` each carry independent
    `PresentationSampleProvenance`, `presentedInstant`, state handle, and global
    spatial binding. The camera owner publishes `CameraViewPublication`,
    preparation owners publish `ViewPreparationPublication`, and the sealed
    `PhysicsPresentationSnapshot` references candidate binding IDs and lease
    refs under one `PresentationTimeCohort`. `PresentationRenderPlan` binds exact
    pass/resource/history generations and frame-slot admission before
    `FrameExecutionRecord` records multi-target execution and lease
    disposition keyed by lease ID. The presented states are not assumed solver
    `n/n+1`. Visible deformation, bounds, shadows, motion vectors, and temporal
    history resolve through this chain with separately tracked instants/frame/
    transform/source epochs. Pose/topology/LOD/disocclusion history decisions
    are scoped `ReactivePublication` and `ScopedResetAction` records in
    `ViewPreparationPublication`, not extra pair or snapshot flags.
    Pose/topology/LOD/disocclusion changes contribute scoped reactive epochs and
    affected entities/regions for those per-view records.
11. **Boot.** All heavy work is init-phase and budgeted. Only an immutable unit
    primitive template may be global; extracted connectivity, shell/reference
    mapping, transported radial frames, blend ancestry, candidate sets, and
    skin weights are mesh-identity-specific. Allocate fixed-size
    topology/tier instance pages, each bound to one compatible geometry
    identity, and add/recycle pages only at
    controlled lifetime boundaries—never resize one global population buffer.
    Time-slice compilation to the product's measured main-thread allowance or
    move it to a worker. `await renderer.compileAsync(...)` every shippable
    material/pass variant — display, depth/shadow, outline, configured MRT —
    behind the load screen using the owning scene/pass compilation API.
    Spawning a creature is validation plus an O(slots) buffer write;
    it never builds geometry, materials, or pipelines.
12. **Lab.** A strict-port standalone lab app with a deterministic driver
    (`seekTick(n)` must equal `stepTicks(n)`), machine-readable
    telemetry, debug modes, foot-drift markers, and seed sweeps. Lab evidence
    proves the package, never the shipping scene.

## Capability Gate

```js
const renderer = new WebGPURenderer({ antialias: false });
await renderer.init();
if (!renderer.backend.isWebGPUBackend) {
  throw new Error('WebGPU backend unavailable for the canonical creature path.');
}
```

The following are authored preview-shell/local-correction starting points. An
extracted shipping mesh selects density from projected error, deformation, and
mesh-validity gates rather than inheriting these counts:

| Tier | Use for | Preview shell | Correction field trials | Candidate K | Normals | Outline |
| --- | --- | --- | ---: | ---: | --- | --- |
| Hero | one or few close subjects | 12 radial, 3 cap rings/slot | 2 + residual early-out | 8 | analytic gradient, optional fragment-stage | iso-offset hull or post edge |
| Repeated | many visible bodies | 10 radial, 2 cap rings | 1–2 | 4–6 | analytic gradient, vertex varying | shared post edge pass |
| Distant | small projected silhouettes | 8 radial, 2 cap rings | 1 | 2–4 | analytic gradient, vertex varying | none |

If the user explicitly asks how to apply fallback when WebGPU is unavailable,
route that teaching to `../threejs-compatibility-fallbacks/` instead of adding
it here.

## Performance Contract

Budget the population before styling it. The per-slot counts above describe
the preview shell, not the extracted shipping mesh. Per-slot vertices (§5):
`V_slot = (2 + 2·capRings)·radialSegments + 2` (hero 98, repeated 62, distant
50). Per creature: `V_shell = P · V_slot` where `P` = compiled primitive count
from the spec. For any field-corrected vertex, let `S` count correction trial
field evaluations after the initial query, including rejected backtracking
trials, and let `K` be candidate-leaf count. Then count fused evaluations exactly:
`E_snap = (S + 1)K`, `E_color ∈ {0,K}` (reuse final distances or evaluate once),
and `E_AO = R K` for `R` offset samples. Never multiply color or AO by the snap
iteration count, and never use `(S + 1)7P` from a masked full-budget unroll with
finite-difference normals. The forbidden-to-snap ratio is `7P/K` at equal
depth. Prove cost in the lab; do not copy population, slot, or millisecond
constants from another fixture.
Counts in the tier table are authored starting points, not device classes.
Record the complete workload tuple
`{visibleInstances, topologySignatures, geometryDigests, pages, P, K, S, meshVertices,
correctedVertices, influences, skinningMethod, shadowPasses, outlineMode,
renderExtent, sampleCount}` and report contemporaneous full-frame
p50/p95 plus the paired marginal cost of enabling the bodies. Also record CPU
fixed-step p50/p95, submitted draws, field evaluations, dirty upload bytes,
peak live bytes, and thermal/sustained behavior on the named adapter. A tier
passes only against the product's gated whole-frame CPU, GPU, memory, and
presented-cadence budgets.

For constrained adapters, change representation before shaving constants. If
the skin-only reference mesh passes projected/deformation error, remove live
field correction, its candidate storage, and field self-AO entirely. If only a
joint region needs correction, compare a correction-only mesh partition with a
static per-vertex branch; accept the extra submission only when paired full-
frame evidence beats divergent field work. Use an impostor only inside its
silhouette/view-cone contract. Never select LBS as a cheaper tier where its
twist/volume gate fails.

CPU side: rig update writes into a CPU `Float32Array` backing/staging store;
that array is not a persistently mapped WebGPU buffer. Upload dirty page ranges
through the Three.js storage-attribute update path. Require zero
per-frame allocation; ordinary locomotion is O(slots) per creature per fixed
step, while rope-verlet CPU cost is
`ropeSubsteps * ropeRelaxationPasses * ropeSegments`, not O(slots). Static and
closed-form poses must not be rewritten or integrated merely to exercise a
compute path.

Batch habitat/support/water requests and interaction records as compact
channel-masked SoA with generation-bearing identities distinct from population
slots, bounded deterministic queues, and canonical batch-level
`InteractionBatchLedger` records. Avoid
per-creature query objects. Presented pose/resource generations use a
frame-in-flight lease/reuse rule so compute or slot recycling cannot overwrite
state still referenced by a sealed snapshot.
Kinematic `SupportSurfaceSample` queries do not enter a contact ledger. When a
route instead selects physical creature contact, publish `PhysicsContactCost`
from the actual contact owner: body/shape/proxy counts, moved bounds,
broadphase candidates, narrowphase shape-pair tests, contacts, manifolds and
points, islands/largest island, scalar constraint rows, iterations/residuals,
warm-start hits/misses/invalidations/cache bytes, deterministic sort/reduction,
and contact/reaction lifecycle events. Measure frozen pileup, dense flock
landing, high-speed crossing, sleeping/waking, topology/proxy change, cold
warm-start cache, catch-up, and quality migration; ordinary gait over empty
ground is not a contact-tail benchmark.
Physical locomotion/interaction `QualityTransition` commits only at a scheduler
tick with state projection, queue boundary, conserved-value/error ledger,
atomic provider/identity generation, history action, rollback, and measured
old/new peak residency. Visual mesh/LOD crossfades never duplicate an
authoritative body or its reactions.
Any physics-facing change to
`PhysicsQualityStateDescriptor.nativeStepAndCouplingControls`,
`.stateVariablesAndInventories`, `.representedBandsFootprintsAndFilters`,
`.stableIdPolicy`, or `.presentationRepresentation` requires that exact
`QualityTransition`; it maps every `InteractionRecord.applicationLedgerKey`
and `InteractionBatchLedger.exactOnceApplicationLedgerVersion`, commits through
`PhysicsCommitTransaction`, and publishes new versioned state only through
`PresentationTimeCohort`, `PhysicsPresentationCandidate`,
`CameraViewPublication`, `ViewPreparationPublication`, sealed
`PhysicsPresentationSnapshot`, and `PresentationRenderPlan`.
In-place mutation or an unledgered presentation crossfade is invalid.

Boot side: all shippable material variants `compileAsync`-warmed before
reveal; build work is time-sliced to a declared main-thread gate or off-thread;
capacity is a measured set of fixed topology/tier pages. Spawn is an O(slots)
dirty write with zero geometry/material construction and zero pipeline compiles.
Gate cold and first-visible frames separately from sustained frames; numeric
limits come from the product contract and carry measured context.

## Color And Output

- Authored part colors are sRGB hex; decode to linear
  (`c <= 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4`) before upload. Storage
  and uniform pose data is `NoColorSpace` linear data.
- Genome/color mutation operates in perceptual space (OKLab/HSL on the sRGB
  hex), never on decoded linear floats.
- The scene node pipeline owns tone mapping and output conversion; creature
  materials must not double-convert.

## Reference

Read [references/creature-body-systems.md](references/creature-body-systems.md)
for the exact build contract: spec schema, field formulas and constants, rig
compiler rules, locomotion constants and gates, scale architecture, the
surface-quality ladder, the creature-lab contract, the
boot/compile/spawn contract, and the numeric gate table.

Diagnostic lab: `examples/webgpu-procedural-creature-lab/`.
The lab currently provides a pure-core runtime, TSL adapter module boundaries,
deterministic `window.__lab` browser surface, Playwright capture harness,
numeric gates, and artifact gates for field math, snap residuals, preview-shell counts,
locomotion, determinism, boot metrics, and capture manifests. Current caveat:
the visible capture path is deterministic canvas evidence over the core and
adapter contracts, not shipping-surface proof. Canonical closure requires a
real `WebGPURenderer` reference-mesh path with proven skinning/local correction,
mesh-validity gates, and visible/cast/received-shadow parity. The per-slot
snapped shell remains diagnostic even after that closure.

## Failure Conditions

- the field is evaluated with masked full-budget unrolled loops over the slot budget instead of
  closed candidate subgraphs and a part-count loop;
- a per-slot snapped capsule concatenation is shipped as a manifold body mesh;
- field correction passes residual checks while triangles invert, self-intersect,
  duplicate coverage, or collapse below the declared minimum angle;
- normals come from 6-tap finite differences in the shader when the analytic
  gradient is available in the same loop;
- pose is per-creature material uniforms (one material per creature instead of per signature page), so compatible creatures cannot
  batch and every creature is its own draw call;
- `frustumCulled = false` instead of per-instance posed bounds;
- locomotion consumes raw render dt, so foot plants and hop phases pop under
  frame hitches;
- cross-owner recurrent locomotion advances from a creature-local/render-loop
  accumulator, so it diverges from `PhysicsGraph` catch-up and exact-once
  interaction application;
- physical contact is budgeted from creature/body count while broadphase pairs,
  shape-pair tests, manifolds, constraint rows/iterations, cache behavior, and
  frozen pileup/topology-change tails are absent;
- part-id sorting defines a repeated smooth-min fold, so a rename changes the
  field, or candidate leaves are folded outside their declared blend ancestry;
- proximity skin weights leak across contacting limbs, influences are not
  normalized after pruning, or LBS/DQ/CoR is chosen without bend/twist gates;
- a helper-axis branch is recomputed from posed direction and flips radial
  surface coordinates;
- gait assumes a static horizontal plane instead of querying the moving/sloped
  support frame;
- habitat or spawn logic samples rendered albedo/noise, transient terrain LOD,
  or a frame-critical GPU readback instead of a versioned causal world query;
- a swimmer treats wave phase/surface-height velocity as material current, or
  consumes an unlabelled `velocity` channel whose frame and meaning are
  undefined;
- a missing `WaterSurfaceSample` channel follows the descriptor's explicit
  `missingChannelPolicy` (`absent`, `reject`, or a schema-named reconstruction
  policy); it is never silently zero-filled, and provider error/version
  is discarded, or a two-way creature bypasses `InteractionRecord` and its
  conservation group;
- creature scale is multiplied into the shared gravity-provider acceleration
  while the SI metre/second contract remains fixed;
- shadows silently use a different position path than the visible deformed
  surface;
- visible pose, bounds, shadows, motion vectors, or temporal history consume
  different physics presentation snapshots, state versions, or origin epochs;
- spawn/death, teleport, reparent, page-slot reuse, topology or LOD transition
  emits an extreme motion vector instead of an explicit history-invalid reason;
- the outline doubles the full field-correction cost per body in a
  repeated-population scene;
- debug/tier/band changes rebuild materials and meshes per creature instead of
  hitting a variant cache and uniforms;
- geometry cache keys omit schema/compiler versions or rely on a 32-bit hash
  alone;
- one resizable global population buffer replaces fixed topology/tier pages, or
  a CPU backing array is described as a persistently mapped GPU buffer;
- sRGB hex is uploaded as-is (washed-out creatures) or decoded twice (dark
  creatures);
- snap residual, stance drift, and CPU/GPU parity are eyeballed instead of
  gated numerically;
- creature motion calls `Math.random` or wall-clock time anywhere in the
  render path.

## Routing Boundary

Use `$threejs-procedural-motion-systems` for generic transform timelines,
springs, staging, and rotating frames; this skill owns creature bodies, rigs,
and creature locomotion. Terrain, planetary, and water skills own environment
fields and their query error; this skill only consumes their support, habitat,
and shared provider interfaces under the physics-domain and interaction
contract. Use `$threejs-procedural-geometry` for general
semantic mesh writers; this skill owns field-derived reference skins and its
diagnostic shell. Use
`$threejs-procedural-vegetation` for plants. Use `$threejs-visual-validation`
for evidence bundles the creature lab emits. Imported skinned-asset character
pipelines (glTF clips, retargeting, VAT crowds) are an explicit gap in this
pack — do not stretch this skill over them.
