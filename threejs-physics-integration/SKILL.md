---
name: threejs-physics-integration
description: "Select, integrate, and validate physics architectures for Three.js WebGPU/TSL scenes. Use for static spatial queries, kinematic motion, rigid bodies, constraints, collision detection, CCD, sleeping, external engines, GPU-resident solvers, multi-domain coupling, physics-to-render publication, recovery, and low-end/mobile cost decisions."
---

# Three.js Physics Integration

Use this skill to choose the smallest solver architecture that satisfies the
observable contract, then connect it to rendering through the shared physics
ABI. The ABI coordinates solvers; it is not a universal solver.

Start with `$threejs-choose-skills`. Read the canonical
[physics domain and interaction contract](../threejs-choose-skills/references/physics-domain-and-interaction-contract.md)
before emitting serialized physics records. Read
[solver selection and architecture](references/solver-selection-and-architecture.md)
for broadphase, narrowphase, CCD, constraint, sleeping, residency, and mobile
tradeoffs. Read [external solver boundaries](references/external-solver-boundaries.md)
when a library, worker, WASM module, process, server, or another GPU owns state.
For a bounded floating body, read the scored
[dynamic-skiff architecture decision](references/bounded-dynamic-skiff-architecture.md)
before selecting hull quadrature, water residency, or coupling direction.

## Decision protocol

Treat every consequential choice as a falsifiable decision problem. Examples
include solver family, collision representation, broadphase, narrowphase,
constraint method, CCD policy, CPU/GPU/external residency, coupling direction,
clocking, recovery, and quality migration.

For each problem:

1. Freeze the observable, units, frame, clock, topology, interaction, target,
   and error bounds.
2. Produce at least five materially different solutions. Do not create five
   parameter variants of one algorithm.
3. Score every solution from 0 to 5 on truth fidelity, target cost,
   integration complexity, determinism, recovery, and evidence feasibility.
   Add workload-specific axes when needed.
4. Record hard-gate failures separately from scores. A high score cannot
   override a failed conservation, stability, latency, memory, capability, or
   identity gate.
5. Record concrete pros, cons, assumptions, and rejection evidence.
6. Select the highest-scoring eligible solution. Break a tie with a declared
   axis fixed before scoring; never adjust weights after seeing the winner.
7. Keep the decision provisional until target-bound evidence distinguishes the
   leading candidates. Retain an A/B route when evidence does not.

Use `examples/external-physics-adapter-conformance/decision-record.js` to reject
fewer than five candidates, missing axes, post-hoc selections, ties without a
policy, and unlabelled quantitative gates.

## Select the conformance profile first

Choose exactly one smallest valid profile; profiles are capability boundaries,
not quality tiers.

| Profile | Select when | Required boundary | Forbidden claim |
| --- | --- | --- | --- |
| `render-only` | No physical state is used. | Explicit absence of physics allocation. | Collision, mass, forces, buoyancy, or simulation. |
| `presentation-consumer` | Rendering consumes an immutable committed snapshot. | `PhysicsPresentationCandidate`, per-view publications, sealed `PhysicsPresentationSnapshot`, `PresentationRenderPlan`. | Advancing or mutating solver state. |
| `query-provider` | Ray, overlap, closest-point, support, or field samples are needed without state integration. | Versioned descriptors, batched requests, units/frame/time/support/error. | Contacts, impulses, or dynamic response. |
| `one-way` | A source affects a receiver and omitted reaction is bounded. | `PhysicsGraph`, typed `InteractionRecord`, exact-once application, open-system ledger. | Reciprocal conservation or unchanged source trajectory without proof. |
| `two-way` | Source and receiver reactions are observable. | Reaction/conservation groups, bounded coupling, atomic commit. | Independent commits, visual-only feedback, or hidden one-frame lag. |
| `external-solver` | Another engine/process/device owns any state equation. | Complete `ExternalSolverAdapter`, synchronization, recovery, cost, and presentation closure. | Treating an opaque handle or API call as conformance. |

Do not add a physics engine merely because an object moves. Authored transforms,
analytic motion, or a query-only BVH are often the correct top-ranked choices.

## Choose representation before algorithms

Separate render, query, collision, support, and physical integration
representations. A visible mesh is not automatically a collider, hydrostatic
hull, support surface, or mass distribution.

Publish a `SupportSurfaceSample` when locomotion, placement, or contact logic
consumes a versioned support-surface query; it carries the owning frame, time,
validity, error, and provider identity rather than borrowing visible mesh state.

- Use analytic shapes for exact primitive queries and compact moving proxies.
- Use convex shapes for robust dynamic contact; decompose only when concavity
  is an observable collision requirement.
- Use triangle meshes primarily for static/query geometry. Dynamic concave
  meshes require an explicit algorithm and cost proof.
- Use signed-distance or field proxies only when distance/gradient semantics,
  update cost, and conservative error are declared.
- Use compound proxies when semantic parts, filtering, or inertia require them.
- Preserve stable collider, shape, feature, entity, and material IDs across
  batching, LOD, compaction, and presentation.

`ColliderProxy`, `RigidBodyProperties`, `RigidBodyState`,
`ContactManifoldRecord`, and `PhysicsMaterialRegistry` remain separate records.
Never infer density, friction, restitution, compliance, or collision filtering
from a Three.js material.

## Select solver architecture

Compare at least these five families for every dynamic request:

1. analytic/query-only;
2. authored kinematic with typed contacts or no contacts;
3. local CPU rigid/contact solver;
4. bounded GPU-specialist solver;
5. external engine adapter;
6. offline/recorded simulation when real-time truth is not required.

Then compare the internal algorithms that materially affect the workload:

- broadphase: brute-force bounded set, sweep-and-prune, dynamic AABB tree,
  uniform or hashed grid, LBVH/Morton hierarchy;
- narrowphase: analytic pairs, SAT, GJK plus EPA/MPR, mesh BVH traversal,
  field/SDF contact;
- continuous collision: swept analytic tests, conservative advancement,
  speculative contacts, substepping, or explicit unsupported pairs;
- constraints: projected Gauss-Seidel/sequential impulses, TGS-style temporal
  refinement, XPBD/compliance, direct small-system solve, or external owner;
- coupling: one-way, explicit partitioned two-way, iterated partitioned, or
  monolithic/offline.

Reject an algorithm from the actual observable and target, not from folklore.
For example, a GPU broadphase can lose on a small mobile scene because list
construction, barriers, storage traffic, and dispatches dominate; a CPU solver
can lose when frame-critical readback would be required by a GPU water owner.

## Freeze the execution architecture

One `PhysicsContext` owns SI scale, proper frames, clock registry, origin epoch,
identity namespaces, gravity provider, and physics materials. One
`PhysicsGraph` orders:

```text
ingest -> sample-forcing -> predict -> emit-interactions
       -> solve-subcycles -> reduce-reactions -> correct
       -> commit -> publish-presentation
```

Every state equation has exactly one advancing owner. Every stage execution
names its interval, reads, prepared writes, dependency completions, state
advance claim, and status. Only the graph-wide catch-up policy may admit,
retain, or drop debt. Domain-local clipping or render-loop stepping is invalid.

`PhysicsStageExecution` is the typed record for that interval, resolved read and
write versions, dependency completions, state-advance claim, and status.

Keep fixed-step clocks rational and versioned. Use substeps only from a stated
stability, tunnelling, or solver-convergence gate. More substeps are not a
substitute for CCD, a suitable constraint formulation, or a stable coupling
scheme.

## Integrate collision and constraints

Broadphase output is a candidate set, not contact truth. Measure moved proxies,
candidate pairs, narrowphase tests, accepted contacts, manifolds, constraint
rows, islands, iterations, warm-start hits, and cache bytes. Freeze pileup,
high-speed, topology-change, sleep/wake, and cache-cold stresses.
Serialize this workload tail as `PhysicsContactCost`; body count alone is not
contact-performance evidence.

Contact ownership includes manifold begin/persist/end, stable point IDs,
material-pair selection, warm starts, friction state, and emitted impulses.
Support queries do not emit collision impulses. For CCD, publish supported
shape pairs, time-of-impact convention, maximum motion/error, failure policy,
and interaction with discrete contact.

Sleeping is a state transition, not culling. Define energy/velocity gates,
minimum residence, wake sources, contact-island propagation, kinematic/forcing
wakes, deterministic ordering, and state migration. Never sleep because an
object is off camera.

## Connect physical domains

Use typed `PhysicsSignalDescriptor` providers and `SurfaceExchange` records.
Each `InteractionRecord` declares payload tag, rate versus integral semantics,
application interval, SI units, frame, origin epoch, transform revision,
physical footprint, sign, target equation, error, and exact-once key.
`InteractionApplicationLedger` records exact-once application for each consumer
and interval. Use its cursor and key to reject duplicate retries or substep
applications.

- Integrate rates only over interval overlap.
- Apply an integral exactly once, never once per substep or render.
- Group source/reaction records atomically.
- Close force, torque, work, mass, momentum, and energy in the declared balance
  frame when those commodities are claimed.
- Keep visual spray, dust, foam, and deformation as non-authoritative children.

`ConservationGroup` binds each claimed conserved commodity to its source,
reaction, residual, tolerance, and balance frame.

Use a bounded coupling loop when explicit partitioning violates the
added-mass/stiffness gate. Recompute both participants at one bracket, record
iteration lineage and residuals, and commit only the accepted iterate.

## Integrate external solvers

Create one complete `ExternalSolverAdapter` per external authority. It must own:

- solver/build identity and boundary revision;
- exact stepping, constraints, collision, manifold, accumulation, and commit
  ownership;
- dimension-checked SI, handedness, polar/axial, frame, and clock mappings;
- immutable signal descriptors and directional interaction capabilities;
- step receipts and exact-once ingress/egress sequence ranges;
- shared-resource, device-copy, host-staging, IPC, or network synchronization;
- precision, reduction ordering, RNG/replay policy, and error model;
- checkpoint/replay or explicit discontinuous restart;
- failure detection, frozen commit groups, queued-event disposition, and
  degraded-publication policy;
- `PhysicsExternalAdapterCost` covering the full dependency tail.

Submission is not device completion, a handle is not a resource-generation
proof, and “zero copy” does not remove fences, ownership transfer, cache
effects, or in-flight memory. Frame-critical GPU-to-CPU readback is forbidden.

## Publish to Three.js

Never render mutable solver work state. Publish committed previous/current
state handles through `PhysicsPresentationCandidate`, then per-view
`CameraViewPublication` and `ViewPreparationPublication`, seal a
`PhysicsPresentationSnapshot`, and submit its `PresentationRenderPlan`.
`FrameExecutionRecord` then records the target submissions, completion tokens,
reset actions, failures, and resource-lease dispositions. The sealed snapshot
remains immutable.

Keep physics origin separate from render origin. Preserve exact entity/slot
identity across compaction. Mark spawn, death, teleport, reparent, LOD change,
slot reuse, and discontinuity explicitly so motion vectors and histories reject
invalid correspondence. Pin resource generations through every simulation,
coupling, external, and presentation consumer completion join.

## Design for low-end and mobile targets

Do not use a universal body, draw, or memory budget. Freeze target-specific
gates and measure the composed scene. Candidate controls include:

- reduce collision proxy complexity before visual geometry;
- use stable spatial partitions and dirty proxy updates;
- batch queries/interactions and compact active ranges;
- cap pair/manifold/constraint capacity with visible overflow policy;
- use island sleeping with correct wake propagation;
- keep hot state in its consuming residency;
- avoid host staging and per-frame allocation;
- preserve one render of shared depth/state and one presentation publication;
- account for frames in flight, multiview, migration overlap, and tile-GPU
  attachment traffic.

Report full-frame CPU/GPU/presentation distributions separately. Do not add
subsystem p95 values. For external engines, measure enqueue, conversion,
queueing, transport, remote wait/solve, fence, deserialize, and atomic-commit
tail along the actual dependency path. Mark unavailable remote/GPU attribution
as insufficient evidence.

`PhysicsCostLedger` composes shared and per-target work, hot and peak resource
bytes, submissions, transfers, and timing attribution. `PhysicsContactCost`
records broadphase, narrowphase, manifold, constraint, cache, and stress-tail
work separately from body count.

## Quality and recovery

A quality governor may request a change but cannot mutate physics. Every
physics quality state declares equations, discretization, active domain,
cadence, conserved inventories, IDs/cursors, error, and cost. Every transition
uses prepare, validate, atomic step-boundary commit, completion-joined retire,
and rollback. A solver-family change is a new truth contract, not a tier.
`QualityTransition` binds the old and new state versions, migration plan,
invariant gates, commit boundary, resource overlap, and rollback result.

GPU loss and external-process failure freeze affected commits. Restore one
digest-closed checkpoint and replay exact-once ranges, or publish an explicit
loss ledger, new discontinuity epoch, reset plan, and validated restart. Never
reconstruct authoritative physics from visible render state.

`AuthoritativeGpuStateRecovery` records the checkpoint, lost and restored
resource generations, replay interval, cursor closure, and restart verdict.

## Validate The Created Integration

The target project's conformance fixture must reject fewer than five solutions, missing decision axes, post-hoc
winner changes, implicit ownership, wrong SI/frame/clock maps, ambiguous
capabilities, missing exact-once support, submission-only visibility, half
commits, incomplete recovery, and omitted external-tail cost.

A green contract fixture proves selection and boundary invariants only. Claim
native WebGPU execution, physics correctness, performance, or recovery only
after the corresponding target-project mechanism diagnostics and claim-scoped
measurements have been inspected on the named target.
