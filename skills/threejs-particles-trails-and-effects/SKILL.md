---
name: threejs-particles-trails-and-effects
description: Representation-first Three.js WebGPU/TSL particles, trails, and effects. Use for analytic or recurrent particle motion, stable-slot or scan-compacted GPU pools, flow-conforming shells and wakes, dissolving debris, or effect-specific HDR and depth integration.
---

# Representation-First Particles, Trails, and Effects

Own GPU-resident object- and world-space effects: spawn, motion, lifetime,
compaction, draw representation, depth/blend behavior, and scene-linear HDR
emission. Route viewport history to `$threejs-dynamic-surface-effects`, weather
accumulation to `$threejs-rain-snow-and-wet-surfaces`, authored event motion to
`$threejs-procedural-motion-systems`, and shared post ownership to
`$threejs-image-pipeline` or `$threejs-bloom`.

When an effect consumes collision, forcing, or exchange owned by another
system, close this local handoff before step 1:

- name the quantity and units, producer frame/origin, transform revision, and
  origin generation;
- name the half-open source interval, cadence, sample phase, immutable producer
  version, and permitted pool consumer;
- declare support/filter, validity, staleness, error, and missing/overflow
  policy;
- mark one-way reads or name the two-way source/reaction owners, application
  order, and applied state version;
- bind the GPU resource generation, producing and consuming passes, completion
  dependency, and reset on discontinuity, rebase, or generation change while
  keeping the steady frame readback-free.

The source owner retains authority; the pool consumes immutable publications.
Invoke `$threejs-choose-skills` when the route needs additional system owners.
Then read [coupled inputs](references/particles-trails-and-effects-system.md#coupled-inputs)
for effect-specific ownership and degradation rules.

## Process

### 1. Define the observable and its owners

Write one effect contract containing:

- the event interval, deterministic seed, effect class, transform, and
  flow/impact direction;
- the coordinate frame, distance/time units, lifetime clock, and seek/reset
  behavior;
- the visible roles: silhouette, motion, illumination, residue, or occlusion;
- the depth-test, depth-write, blend/order, HDR signal, and final-output owner;
- any external producer and whether the pool is presentation-only or backed by
  a separately owned physical body.

The step is complete when every visible or physical claim has one owner and
every input has a frame, time, validity policy, and consumer.

### 2. Select motion and neighborhood representation

Choose the least writable state that represents the mechanism:

| Mechanism | Representation |
| --- | --- |
| Pose and appearance are pure functions of spawn data and time | Immutable spawn records; evaluate analytically in vertex TSL |
| State recurs independently per particle | Structure-of-arrays hot state; one named compute integration stage |
| Collision or field feedback changes state | Recurrent state plus the owning GPU field/proxy at the same frame and sample time |
| Neighbor interactions matter | Spatial grid/hash or sort-and-scan before bounded local interaction |

Select allocation independently:

| Occupancy behavior | Allocation/compaction |
| --- | --- |
| Holes cost less than scan/scatter traffic | Stable slots, generation-bearing identity, alive flag, and bounded visible range |
| Dense output materially reduces later work | `mark -> exclusive scan -> scatter -> publish indirect count` into a second state set |
| Removal is serialized with unique source/destination ownership | Dense tail swap may be used; move every state and identity lane atomically |

For recurrent or compacted pools, read
[state and compaction](references/particles-trails-and-effects-system.md#state-and-compaction)
before implementation. The step is complete when every writable lane and every
compaction phase is justified by a downstream consumer or measured saving.

### 3. Specify the state transition and identity lifecycle

Keep the order explicit:

```text
ordered event packets
  -> deterministic spawn/range allocation
  -> analytic evaluation or one recurrent update
  -> optional ordered compaction
  -> draw from the committed state/count
  -> post consumers
```

Generate cold parameters once and update only recurrent lanes. Preserve stable
entity identity across slot movement. Birth, death, slot reuse, teleport,
representation change, and unavailable prior state invalidate motion vectors,
trails, interpolation, and temporal history before presentation. Analytic
particles evaluate both previous and current presentation times; recurrent
pools retain adjacent immutable presentation states.

Read [temporal identity](references/particles-trails-and-effects-system.md#temporal-identity)
when the effect feeds TAA, motion vectors, trails, or multi-frame post. The step
is complete when each state version has one writer, draw consumes a committed
version, and a reused slot cannot inherit prior entity history.

### 4. Build the r185 GPU path

Use `WebGPURenderer` from `three/webgpu`, call `await renderer.init()`, and
require `renderer.backend.isWebGPUBackend === true` for this canonical path.
Route explicit WebGPU-unavailable teaching to
`$threejs-compatibility-fallbacks`.
Use `Fn().compute(...)`, `renderer.compute(...)`, storage nodes and
`StorageInstancedBufferAttribute` for recurrent state. Render sprites with
`SpriteNodeMaterial`; render shaped particles with `InstancedMesh` and a
`NodeMaterial` family material. Dense compaction publishes an indirect command
through `IndirectStorageBufferAttribute` and `geometry.setIndirect()`.

`computeAsync()` in r185 waits for renderer initialization, not GPU completion.
Express global phase dependencies as ordered dispatches and keep frame-critical
counts and state GPU-resident.

Read [r185 execution facts](references/particles-trails-and-effects-system.md#r185-execution-facts)
when implementing compute, indirect draw, bounds, or completion. The step is
complete when spawn, update, compaction, and draw have explicit GPU ordering and
the steady frame path performs no readback or per-particle object update.

### 5. Bind representation, depth, and output

Use sprites or instanced quads for camera-facing sparks, instanced lit meshes
for shaped debris, hull-derived geometry for conforming plasma, and generated
capsule/profile geometry for wakes. For flow-conforming work, read
[shells and wakes](references/particles-trails-and-effects-system.md#flow-conforming-shells-and-wakes).
For spark or debris work, read
[analytic sparks and dissolving debris](references/particles-trails-and-effects-system.md#analytic-sparks-and-dissolving-debris).

Give each draw class an explicit depth and transparency contract. Use chunked
analytic bounds or a GPU reduction for storage-driven motion. Keep beauty in
scene-linear HDR through one tone-map/output conversion owner. Full-scene bloom
reads HDR beauty; allocate a selective emissive MRT only for an authored
inclusion/exclusion requirement with a valid transparent blend and measured
attachment cost.

Read [depth, HDR, and output](references/particles-trails-and-effects-system.md#depth-hdr-and-output)
before accepting transparent or emissive effects. The step is complete when
occlusion, ordering, bounds, HDR contribution, and final conversion each have
one tested owner.

### 6. Prove the mechanism and budget

Capture seeded fixed-time states and expose event/spawn count, live/slot count,
overflow, identity mapping, age/velocity, compaction count, bounds, depth mode,
raw HDR, optional selective signal, bloom contribution, overdraw, and GPU time
per compute/draw class. Compare analytic versus recurrent cost, and stable slots
versus compaction, at the same occupancy.

Verify the beauty path with bloom disabled. Preserve readable silhouette,
layer roles, depth, and motion without halo support. Scale by stopping idle
work, removing unnecessary writable state or compaction, then reducing active
count, field bandwidth, transparent layers, and post extent while preserving
the selected motion class and owners.

Read [resource accounting](references/particles-trails-and-effects-system.md#resource-accounting)
and [diagnostics and failure signatures](references/particles-trails-and-effects-system.md#diagnostics-and-failure-signatures)
for the applicable branches. The skill is complete when the seeded result is
repeatable; event, update, compaction, and draw order is evidenced; stable
identity and reset controls pass; the frame path has zero required readbacks;
depth and output ownership are singular; the bloom-off image remains legible;
and the complete scene meets its named resource and timing budget.
