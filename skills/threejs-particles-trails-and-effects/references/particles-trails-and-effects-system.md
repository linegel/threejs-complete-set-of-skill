# Particle, Trail, and Effect Mechanisms

Branch reference for GPU-resident Three.js r185 WebGPU/TSL effects. Load only
the sections selected by the process in `SKILL.md`.

## Contents

- [State and compaction](#state-and-compaction)
- [Temporal identity](#temporal-identity)
- [r185 execution facts](#r185-execution-facts)
- [Coupled inputs](#coupled-inputs)
- [Flow-conforming shells and wakes](#flow-conforming-shells-and-wakes)
- [Analytic sparks and dissolving debris](#analytic-sparks-and-dissolving-debris)
- [Depth, HDR, and output](#depth-hdr-and-output)
- [Resource accounting](#resource-accounting)
- [Diagnostics and failure signatures](#diagnostics-and-failure-signatures)

## State and Compaction

### Allocate only recurrent state

If position, orientation, scale, color, and age are pure functions of immutable
spawn data and presentation time, evaluate them analytically. Use recurrent
compute only for feedback, collision, constraints, or non-seekable forcing.

Keep hot state structure-of-arrays and specific to the consumer:

| Representation | Required state |
| --- | --- |
| Analytic sprite | immutable position/time, seed, class parameters; no writable motion state |
| Recurrent sprite | position, velocity, age, plus only sampled force/appearance lanes |
| Rigid debris | position, normalized quaternion, scale, linear/angular velocity |
| Affine instance | `mat4` only when shear or another general affine transform is consumed |
| Stable external identity | generation-bearing entity/slot maps and explicit reset metadata |

Synthesize rigid transforms from position/quaternion/scale in the vertex path.
A hot `mat4<f32>` contributes 64 payload bytes per instance before any other
state.

Spawn packets carry an ordered interval, transform, direction, seed range,
count, emission scale, and class. Prefix-sum packet counts to assign deterministic
ranges. Declare capacity behavior: reject, coalesce presentation-only work, or
defer it. Seed integer hashing from the event identity; record seed, time,
camera, exposure, backend, and workload for reproducible captures.

Partition fixed-capacity pages by compatible representation and conservative
spatial bounds. Batch one draw per geometry/material/depth/blend class within a
visible page; preserve separate pages when combining them would defeat culling
or add more invisible work than it removes.

### Stable slots

Use stable slots when their inactive vertex/fragment work is cheaper than
compaction traffic. Store an alive bit, generation, and bounded visible range.
A free cursor only appends; arbitrary holes require a free list/bitset or a
dense rebuild. Slot reuse increments the generation and invalidates every
temporal consumer before draw. Draw capacity or a maintained last-occupied
range, and exclude inactive slots before they contribute depth or color.

### Deterministic dense compaction

Use separate globally ordered phases:

```text
mark[i] = alive(current[i])
exclusiveScan(mark) -> destination
if mark[i]:
  scatter every persistent state/render lane to next[destination]
  nextIndexToEntity[destination] = indexToEntity[i]
  nextEntityToIndex[entity] = destination
publish liveCount and indirect instanceCount from scan total
swap current and next
```

Dispatch boundaries separate mark, each hierarchical scan level, scatter, and
publication; a workgroup barrier cannot order separate workgroups globally.
Move identity, current recurrent state, previous presentation state, and every
render lane together. Publishing only a new count leaves state and identity
incoherent.

A serialized tail swap is correct only when one remover owns each source and
destination:

```text
last = liveCount - 1
copy every lane last -> removedIndex
copy and rebuild both identity maps
liveCount--
```

Parallel tail claims need a proven unique-ownership protocol. Otherwise two
invocations can duplicate a source or overwrite a live destination.

### Analytic decay under constant acceleration

For `dv/dt = a - gamma*v`, constant `a` over the interval, and `gamma >= 0`:

```text
x = gamma * dt
phi1(x) = -expm1(-x) / x
phi2(x) = (x + expm1(-x)) / x^2

small |x|:
  phi1 = 1 - x/2 + x^2/6 - ...
  phi2 = 1/2 - x/6 + x^2/24 - ...

vNext = exp(-x)*v + a*dt*phi1(x)
pNext = p + v*dt*phi1(x) + a*dt^2*phi2(x)
age01 = (time - spawnTime) / lifetime
```

Use a named fixed-step integrator for position-dependent forces, collision, or
constraints. Convert units and frames once at the boundary; keep lateral spawn
velocity in the event frame until that conversion.

## Temporal Identity

Temporal consumers bind stable entity generation, not a transient slot index.
Publish immutable previous/current presentation samples after update and
compaction commit. Analytic particles evaluate both sample times from the same
spawn record. Recurrent pools retain adjacent committed states or generate
them in a separate presentation stage.

Reset motion vectors, trails, interpolation, and history for birth, death,
generation or slot reuse, teleport, reparenting, topology/representation
change, missing prior state, or incompatible resource generation. A moved
entity keeps its history; a new entity in the old slot does not.

Transparent effects choose one temporal policy explicitly:

- pre-temporal with valid depth, motion, and rejection;
- post-temporal;
- excluded from temporal accumulation.

Validate disocclusion and ghosting for the selected policy. Physical velocity
is not a motion vector; derive motion from adjacent presented poses and the
camera mappings used for those poses.

Keep previous/current resources immutable until every consuming submission has
completed. Resource rings are safe only when reuse is gated by the actual GPU
completion for all consumers; device loss invalidates the resource generation
and forces a reset.

## r185 Execution Facts

Initialize before capability-dependent allocation:

```js
await renderer.init();
if (renderer.backend.isWebGPUBackend !== true) {
  throw new Error('WebGPU is required for this particle/effect path.');
}
```

| Need | r185 API |
| --- | --- |
| Renderer/pipeline | `WebGPURenderer`, `RenderPipeline`, `StorageInstancedBufferAttribute`, `IndirectStorageBufferAttribute` from `three/webgpu` |
| Compute/storage | `Fn`, `storage`, `instancedArray`, barriers and atomics from `three/tsl` |
| Sprite draw | `SpriteNodeMaterial` backed by instanced storage attributes |
| Shaped draw | `InstancedMesh` with `MeshBasicNodeMaterial`, `MeshStandardNodeMaterial`, or `MeshPhysicalNodeMaterial` |
| Texture field | `StorageTexture` only when the evolving state is a texture field |
| Pipeline signals | `pass()`, conditional `mrt()`, and one `outputColorTransform` or `renderOutput()` owner |
| Shared post consumers | `BloomNode`, `TRAANode`, and `GTAONode` only when the routed post stack selects them |

Create compute nodes with `Fn().compute(...)` and enqueue them with
`renderer.compute(...)`. In r185, `computeAsync()` awaits renderer
initialization and then calls compute; it is not a GPU-completion fence. Use
dispatch order for global stages and an actual asynchronous read/map operation
only for diagnostics that require CPU visibility.

Dense draw commands use `IndirectStorageBufferAttribute` plus
`geometry.setIndirect()`:

```text
non-indexed: [vertexCount:u32, instanceCount:u32, firstVertex:u32, firstInstance:u32]
indexed:     [indexCount:u32, instanceCount:u32, firstIndex:u32,
              baseVertex:i32, firstInstance:u32]
```

Initialize every word before publication. The attribute stores `Uint32Array`
words, so a negative `baseVertex` uses its two's-complement bit pattern. Check
byte length, alignment, signed range, and `firstInstance` support before draw.

`InstancedMesh.computeBoundingBox()` and `computeBoundingSphere()` cover
CPU-authored instance matrices. Storage-driven motion uses conservative
analytic envelopes per page/chunk or a GPU reduction. Bound pages separately
so culling does not depend on frame-critical readback.

## Coupled Inputs

Treat collision, wind, support, and exchange as immutable inputs from their
declared owners. Transform values to one frame and sample time before use; carry
units, support/filter, validity, staleness, and error. Aerodynamic force needs
relative air velocity and density in the same frame; direction-only wind can
drive presentation without making a force claim.

Screen depth is a visual occlusion/soft-fade input, not world collision.
Appearance does not confer mass, material, impulse, heat, or reaction authority.
An authoritative body remains in its solver when its visual instance is culled,
thinned, compacted, or dropped. Visual capacity policy can degrade presentation
records only; it cannot remove undelivered physical state or exchange.

Run producer, effect update, and draw in the declared GPU dependency order.
Consume committed publications without frame-critical CPU readback. For
two-way coupling, the named state owner applies the source and optional
reaction exactly once; the visual pool never applies both sides.

## Flow-Conforming Shells and Wakes

Use a hull-derived shell for the front layer and generated profile geometry for
the wake. A useful composition is:

```text
hull-conforming front shell
  + compact energetic core wake
  + broader low-opacity envelope
  + optional asymmetric shear lobes or sprite flecks
```

Define `flowDirectionWorld` once as downstream fluid motion relative to the
body. Build a stable right-handed event frame:

```text
forward = normalize(flowDirectionWorld)
up = project(preferredUp onto plane normal to forward)
if |up| is small: project(preferredRight instead)
right = normalize(cross(up, forward))
up = cross(forward, right)
wakeOrigin = hull vertex maximizing dot(positionWorld, forward)
```

Cache hull samples and update the support point only when hull pose or flow
direction changes enough to exceed the visible error gate. Displace the shell
along hull normals just enough to avoid depth fighting.

Use a flow-facing shell mask:

```text
facing = saturate(dot(normalWorld, -flowDirectionWorld))
facingMask = smoothstep(facingLow, facingHigh, facing)
```

Separate core heat, silhouette/Fresnel envelope, shock/filament band, opacity,
and emission into inspectable nodes. Map normalized heat and layer role to
scene-linear HDR; calibrate the map in raw HDR with bloom disabled.

For a generated wake profile along `t in [0,1]`:

```text
axial = -length * t
radius = baseRadius * spread(t)
profile = radius * (1 + turbulence(theta, t))
tail = fade(t)
```

Select length, spread, profile resolution, field bandwidth, and layer count
from projected silhouette/energy error and transparent cost. Core, envelope,
and lobes keep distinct scale, motion, and opacity roles; merging is accepted
only when isolated removal stays below the image-error gate.

Failure signatures: a detached aura indicates non-hull geometry or excessive
offset; a wake on the leading edge indicates the flow sign changed twice; a
camera-locked wake indicates mixed frames; flat white raw HDR indicates clipped
emission rather than calibrated heat.

## Analytic Sparks and Dissolving Debris

Use `SpriteNodeMaterial` for camera-facing sparks and flecks. Generate seed,
lateral direction, radius, lifetime, and color role once. Drive scale and HDR
response from normalized age. Use circular/capsule coverage in the material
instead of point-size primitives.

Use instanced meshes for fragments that need shape, rotation, lighting, or
collision readability. Store position/quaternion/scale, angular velocity,
lifetime/dissolve phase, and material flags only when consumed. Drive dissolve
from a geometry-space field so fragments retain recognizable structure. Feed
the same cutout to the shadow branch or disable that shadow contribution, so an
opaque shadow cannot outlive a dissolving fragment.

Presentation debris remains distinct from any authoritative body. If a solver
owns the fragment, bind the visual instance to its immutable previous/current
presentation samples; keep mass, collision, gravity, and material response in
that solver.

Failure signatures: frame-dependent trail length indicates per-frame decay;
an overlong arc indicates elapsed time was applied twice; local-frame
acceleration after the source rotated indicates a missing boundary conversion;
inherited dissolve/color after slot reuse indicates incomplete identity reset.

## Depth, HDR, and Output

| Draw class | Depth/write | Ordering policy |
| --- | --- | --- |
| Opaque debris | test on, write on | normal opaque scene order |
| Dissolving debris | test on, write according to cutout/transparent branch | alpha hash, sorted/premultiplied, or accepted OIT |
| Plasma and wake emission | test on, write off | additive only for an order-independent energy model; otherwise sorted/OIT |
| Haze | test on, write off | sorted bins or accepted OIT; reduce layers before sacrificing occlusion |
| Sparks/flecks | test on, write off | additive emission or alpha-hash/temporal-cutout contract; optional soft depth fade |

Class order does not solve ordinary alpha transparency. Record which
approximation owns ordering and validate intersecting layers and occluders.

Keep beauty scene-linear in `HalfFloatType` working buffers. LDR color textures
use `SRGBColorSpace`; HDR radiance stays loader-declared linear; masks, noise,
LUTs, and storage fields use `NoColorSpace`.

Full-scene bloom consumes HDR beauty directly. A selective `emissive` MRT is a
separate branch that requires authored inclusion/exclusion, a compatible
transparent blend, a real consumer, and measured attachment traffic. Compose
beauty plus bloom before the single tone-map/output conversion. Validate raw
HDR, bloom-only, and bloom-disabled beauty.

## Resource Accounting

| Work | Cost evidence |
| --- | --- |
| Analytic trajectory | immutable parameter bytes and vertex ALU; zero recurrent dispatch/hot write |
| Recurrent state | `N_active * dynamicStrideBytes` plus invocations and traffic for every named stage |
| Stable slots | capacity, live count, hole ratio, submitted/visible work |
| Scan compaction | mark/scan/scatter reads+writes, moved lanes, identity traffic, indirect publication |
| Draw | draw classes, submitted/visible instances, triangles, covered pixels |
| Transparency | covered pixels times mean/p95 layers per pixel |
| Post | exact formats, extents, reads/writes, mip/history slots, and peak-live bytes |

Record `{N_active, strideBytes, stages, compactionMode, coveredPixels,
layersPerPixel, drawClasses, postExtent}` with contemporaneous whole-frame
p50/p95 and paired marginal cost on the named target. Compare alternatives at
the same visible workload. Account event binning, neighbor search, transparent
fragments, attachment traffic, peak-live memory, and sustained behavior.

## Diagnostics and Failure Signatures

Expose only applicable views and counters:

```text
event seed/count and spawn ranges
live count, slot generations, hole ratio, compaction count, overflow
entity-to-slot and slot-to-entity consistency
age, velocity, acceleration, radius, and flow/support frame
previous/current presented pose and temporal rejection
shell core/envelope/shock masks and wake profile/tail
depth mode, soft fade, bounds, submitted/visible count, overdraw
raw HDR by layer, selective contribution when active, bloom-only, bloom-off
compute/draw GPU time, traffic estimate, backend, workload tuple
```

Required negative controls:

- repeat the seeded fixed-time capture;
- disable recurrent update and confirm only recurrent branches freeze;
- force holes and compaction, then verify every identity/state lane;
- reuse a slot and confirm prior temporal history is rejected;
- toggle bloom and selective MRT independently;
- place unrelated occluders through transparent effects;
- resize/recreate resources and verify reset plus disposal;
- confirm the steady path performs zero readbacks.

Report PASS, FAIL, or INSUFFICIENT for each selected branch. A nonblank image or
a pool count alone does not establish motion, identity, compaction, depth, HDR,
or performance correctness.
