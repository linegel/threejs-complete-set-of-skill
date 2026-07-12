# Solver Selection And Architecture

## Contents

- Problem record
- Five-solution comparison
- Query and collision representations
- Broadphase selection
- Narrowphase selection
- CCD selection
- Constraint and contact selection
- Residency and scheduling
- Low-end/mobile controls
- Validation matrix

## Problem record

Freeze this record before scoring algorithms:

```yaml
physicsDecisionProblem:
  problemId: stable-id
  observable: exact user-visible or quantitative behavior
  truthContract: metric | physically-plausible | authored-kinematic | query-only
  unitsFrameClock: canonical SI, registered proper frame, versioned clock
  bodyAndShapePopulation: counts, shape kinds, static/kinematic/dynamic split
  topologyAndMotion: convexity, deformation, maximum speed/rotation, lifespan
  queryAndContactNeeds: ray, overlap, distance, sweep, contact, constraints
  coupling: none | one-way | two-way-explicit | two-way-iterated | external
  target: device/browser/GPU, refresh, memory, latency, sustained protocol
  hardGates: capability, error, conservation, stability, memory, latency
  evidenceAvailable: source proof, numerical oracle, Browser route, timing
```

Every numerical gate uses `{ value, unit, label, source }`. Counts that are
structural fixture identities may remain integers; budgets and thresholds may
not.

## Five-solution comparison

Compare at least five materially different solutions. A normal dynamic-body
decision starts with:

| Candidate | Best fit | Principal cost | Principal failure |
| --- | --- | --- | --- |
| Analytic/query provider | static or low-count exact queries | pair-specific code | no general dynamics |
| Authored kinematic | directed motion with bounded contacts | authoring and query updates | no force response |
| CPU local solver | moderate body/contact set, host consumers | traversal/contact tail | GPU coupling may require staging |
| GPU specialist | dense bounded, GPU-coupled state | scans, barriers, hot bytes | complexity and weak small-set efficiency |
| External solver adapter | mature general rigid/constraint feature set | boundary synchronization and lifecycle | missing channels/ownership proof |
| Offline/recorded | high-fidelity noninteractive result | storage and interpolation | no live interaction |

Score truth fidelity, target cost, integration simplicity, determinism,
recovery, and evidence feasibility from 0 to 5. Higher simplicity means lower
integration risk. Freeze weights first. A failed hard gate makes a candidate
ineligible regardless of score.

## Query and collision representations

Keep render and physics representations independent:

| Representation | Strength | Weakness | Use when |
| --- | --- | --- | --- |
| sphere/capsule/box/plane | exact, compact, cheap sweep | limited shape fidelity | proxy error stays inside gate |
| convex hull | robust support mapping and inertia | loses concavity | dynamic contact is primary |
| convex compound | preserves bounded concavity | more proxies/pairs | semantic parts justify cost |
| static triangle BVH | exact surface topology for rays/contact | dynamic update is expensive | environment is static or chunk-stable |
| heightfield | compact terrain support | overhangs impossible | single-valued support is valid |
| SDF/field | distance/gradient queries and deformation | sampling/filter error, memory | field is already authoritative |
| external/native shape | solver-specific optimized path | opaque portability | adapter exposes revision/error/lifecycle |

For every proxy record position/rotation source, validity interval, swept
bounds, one-sidedness, closedness, material, filter, feature IDs, residency,
and approximation error. Visual LOD never silently changes collider identity.

## Broadphase selection

Evaluate at least five choices for nontrivial populations:

1. bounded all-pairs: best for very small sets; exact cost is `n(n-1)/2` pair
   tests `[Derived]`;
2. sweep-and-prune: strong temporal coherence and axis separation; degrades
   under rotations, clustering, or a poor sweep axis;
3. dynamic AABB tree: general sparse worlds and incremental updates; measure
   refit, reinsertion, traversal, and imbalance;
4. uniform/hashed grid: bounded-size local objects and predictable domains;
   measure large-object duplication, hash collisions, cell overflow, and empty
   scan work;
5. LBVH/Morton hierarchy: parallel rebuild-friendly GPU populations; measure
   key generation, radix sort, hierarchy construction, traversal, and barriers;
6. domain-specialized active tiles: fluids/terrain/contact regions already use
   sparse tiles; measure activation, halo, compaction, and capacity.

The broadphase output is only a candidate-pair set. Prove no required pair is
lost under swept bounds and motion over the full coordination interval.

## Narrowphase selection

Compare analytic pair tests, SAT, GJK plus EPA/MPR, triangle BVH traversal,
and field/SDF contact. Record supported shape pairs and exact fallback policy.

- GJK distance/intersection needs a bounded iteration and nonconvergence
  disposition. EPA/MPR penetration is a separate capability.
- SAT needs stable axes and robust tolerances; box/polytope convenience does
  not generalize to arbitrary smooth shapes.
- Mesh contact needs feature identity, one-sidedness, adjacency policy,
  degeneracy handling, and persistent manifold reduction.
- Field contact needs gradient validity, conservative sampling error, and a
  rule for flat/non-differentiable regions.

Freeze scale-aware tolerances in metres/radians. Do not use one epsilon across
world scales or derive it from the render camera.

## CCD selection

Compare at least:

1. exact swept analytic tests for supported primitive pairs;
2. conservative advancement from distance/support queries;
3. continuous SAT for compatible polytopes;
4. speculative contacts with a bounded false-positive/error model;
5. adaptive substepping under a motion/feature-size gate;
6. explicit unsupported pairs with visible route rejection.

CCD is not `more substeps`. State the swept interval, angular-motion bound,
time-of-impact convention, grazing/touch policy, iteration bound, starting
overlap behavior, and transition into discrete contact. High-speed stress must
cross the thinnest admitted feature.

## Constraint and contact selection

Compare sequential impulses/PGS, TGS-style temporal refinement, XPBD, a direct
small-system solve, and an external solver. Score the actual constraint graph:
contact/friction rows, joints, compliance, mass ratios, stacking, loops, warm
starts, and determinism.

Persistent contact owns begin/persist/end state, point/feature IDs, pair-law
versions, tangent basis, warm starts, friction/adhesion state, and emitted
interactions. Build islands from the declared constraint graph. Measure the
largest island and stress topology; average island size is insufficient.

Sleeping requires:

- translational/angular energy or velocity gates with units;
- minimum quiet residence;
- wake on force, impulse, kinematic contact, support change, material-law
  change, interaction receipt, and relevant field forcing;
- island-wide deterministic propagation;
- cursor and presentation continuity;
- no camera-visibility dependency.

## Residency and scheduling

Choose CPU, GPU, mirrored, or external residency from consumers and update
paths. Compare at least:

1. host-authoritative with GPU upload;
2. GPU-authoritative with GPU presentation;
3. CPU/GPU mirrored with delayed diagnostic mirror;
4. shared GPU resource with explicit ownership transitions;
5. external process/device copy or message transport.

Include hot-state bytes, interaction queues, broadphase/contact scratch,
previous/current presentation handles, frames in flight, checkpoints, and
old/new migration overlap. No frame-critical readback is allowed. A same-queue
consumer still needs a pass/dispatch boundary and resource-generation proof.

The graph owns catch-up. For every presentation opportunity record exact
coordination advances, native substeps, loop iterations, interactions,
dispatches, traffic, and dependency critical paths. Do not add independent
stage percentiles.

## Low-end/mobile controls

Prefer controls that preserve physical identity and observables:

- simpler/versioned collision proxies;
- fewer inactive broadphase updates, not hidden active-body loss;
- stable grids/trees and dirty-range updates;
- bounded contact/manifold capacity with fail-visible overflow;
- lower solver iterations only under residual/error gates;
- lower cadence only through `QualityTransition` with interpolation/error;
- island sleeping with complete wake semantics;
- batched queries/interactions and persistent buffers;
- GPU specialization only after composed evidence beats CPU/external routes;
- minimal render attachments and no duplicate physics presentation buffers.

Measure sustained Full/Budgeted/Minimum states on named targets. Mobile claims
without a mobile-capable measurement route remain architecture models, not
measured acceptance.

## Validation matrix

Require positive and rejection fixtures for:

- five-candidate decision closure and stable winner;
- SI, proper frame, polar/axial, and clock round trips;
- broadphase pair completeness and permutation invariance;
- narrowphase analytic oracle and degeneracies;
- CCD thin-feature crossing and starting overlap;
- manifold lifecycle, warm-start invalidation, and pair-law latching;
- constraint residual, energy/dissipation, stacking, loops, and mass ratio;
- sleep/wake sources and deterministic island propagation;
- exact-once rate/integral interactions and rollback;
- external synchronization, failure, recovery, and cost tail;
- immutable presentation and resource lease retirement;
- target-bound sustained CPU/GPU/presentation/memory evidence.
