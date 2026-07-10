# Layered Particle, Trail, and Effect Systems

Use this reference for flow-conforming reentry plasma, generated capsule wakes,
analytic or compute-updated sparks, dissolving debris, GPU pools, and
scene-relative HDR contribution in the WebGPU/TSL path.

## Contents

- System shape
- Capability and quality tiers
- Exact r185 import table
- Space contract
- Storage pool contract
- Physics contract
- Reentry representation
- Reentry shell and wake TSL
- Instanced spark contract
- Debris dissolve contract
- Depth and blend policy
- HDR and color pipeline
- Budgets
- Diagnostics
- Replaced techniques

## System Shape

For recurrent high-count state that passes the CPU/upload crossover, use a
fixed-capacity, GPU-resident effect graph rather than independent emitters:

```text
event packet buffer
  -> seeded spawn compute or immutable analytic spawn records
  -> hot state storage only for genuinely evolving state
  -> stable alive slots or mark/scan/scatter compaction
  -> dense InstancedMesh or sprite draw
  -> scene-linear HDR beauty
  -> full-scene bloom by default, or a proven selective MRT contribution
```

Each compatible visual class owns fixed-capacity spatial pages and a bounded
draw path; a single global pool is allowed only when its conservative bounds
and submitted invisible work pass:

| Class | Representation | Dynamic state |
| --- | --- | --- |
| Sparks | `SpriteNodeMaterial` with storage-backed instanced attributes | position, velocity, age, radius, HDR scale |
| Debris | `InstancedMesh` with `MeshStandardNodeMaterial` or `MeshPhysicalNodeMaterial` | transform, angular velocity, lifetime, dissolve phase |
| Hull plasma | duplicated hull topology or authored shell mesh with TSL displacement | flow direction, shell thickness, masks, emission |
| Wake core/haze/lobes | generated capsule or half-capsule instanced meshes | frame, length, radius, turbulence, opacity |
| Shock flecks | analytic sprite or tiny quad pool | support point, age, seed, brightness |

Use structure-of-arrays storage for hot fields. Pack cold flags into lower-rate
attributes or constants. Per-frame compute should write only the fields that
changed since the last frame.

## Capability And Quality Tiers

Initialize the renderer before allocating backend-dependent resources:

```js
await renderer.init();

if (renderer.backend.isWebGPUBackend !== true) {
  throw new Error(
    'WebGPU is required for the canonical particle/effect path; explicit fallback teaching belongs to threejs-compatibility-fallbacks.'
  );
}
```

All tiers below are native WebGPU workloads. Explicit WebGPU-unavailable
teaching routes to `../threejs-compatibility-fallbacks/`.

Quality tiers change representation under a visual-error contract:

| Tier | State | Shell/wake detail | Field/post policy |
| --- | --- | --- | --- |
| `full` | analytic or recurrent as required by the effect | all visible mechanism layers | retain field bands below pixel Nyquist; post only when its signal is authored |
| `balanced` | same dynamics with bounded active windows/cadence | merge layers whose isolated removal stays below the image-error gate | lower field/history extent after temporal and silhouette tests |
| `budgeted` | prefer analytic state and stable slots | one primary shell/wake mechanism plus necessary transients | omit optional recurrent fields/post |
| `minimum` | immutable/analytic where possible | primary silhouette/emission cue only | no optional per-frame field update |

Live count, layers, octaves, and resolution are workload outputs. Store them as
Authored trial values until target-context measurement and the complete visual
contract promote them; never infer a device tier from those counts.

## Exact r185 Import Table

| Need | Import |
| --- | --- |
| Renderer and pipeline | `WebGPURenderer`, `RenderPipeline`, `StorageInstancedBufferAttribute`, `IndirectStorageBufferAttribute` from `three/webgpu` |
| TSL compute/storage | `Fn`, `storage`, `instancedArray`, `pass`, `mrt`, `renderOutput`, `workgroupBarrier`, `atomicAdd`, `atomicSub`, `atomicMax`, `atomicMin` from `three/tsl` |
| Bloom | `bloom` from `three/addons/tsl/display/BloomNode.js` |
| Temporal AA | `traa` from `three/addons/tsl/display/TRAANode.js` |
| Ambient occlusion | `ao` from `three/addons/tsl/display/GTAONode.js` |
| Cascaded shadows | `CSMShadowNode` from `three/addons/csm/CSMShadowNode.js` |
| Tile shadows | `TileShadowNode` from `three/addons/tsl/shadows/TileShadowNode.js` |

## Space Contract

For a coupled effect, `world` names the stable SI `physicsFrameId` chosen by
`PhysicsContext`, never camera-relative or scaled Three.js render coordinates.
The presentation adapter performs the one `metersPerWorldUnit` conversion.

| Space | Owner | Convention |
| --- | --- | --- |
| local hull | source mesh | hull samples, normals, and UV shell coordinates before world transform |
| world flow | event packet | normalized downstream fluid-relative-to-body direction `flowDirectionWorld = normalize(vFluidWorld - vBodyWorld)`; a body moving through still fluid therefore supplies one negation; coupled physical acceleration remains SI in `PhysicsContext` and is converted once by its registered render adapter |
| event frame | effect pool | wake forward from world flow, projected up, right-handed basis |
| camera-facing sprite frame | renderer | camera -Z forward, sprite axes derived after world position |
| UV shell | shell material | `u` around hull or capsule, `v` normalized head-to-tail age |
| depth texture | image pipeline | non-color depth texture in camera clip/depth space with depth-to-meters conversion owned by the shared pipeline |
| scene-linear HDR | material output | beauty and any explicitly selected MRT `emissive` contribution remain linear until the one tone-map/output owner |

## State And Compaction Contract

Do not allocate writable hot state for an analytic trajectory. If position,
rotation, size, and color are pure functions of immutable spawn data and time,
evaluate them in vertex TSL; this removes integration dispatches and hot-buffer
writes. Use recurrent compute state only for collisions, stochastic forcing,
constraints, or feedback.

For recurrent state, allocate only the lanes read by that visual/solver class.
There is no universal superset:

```text
common immutable spawn: startPosition+spawnTime, seed, class parameters
analytic sprite: no writable motion state
recurrent sprite: position+age, velocity, only required force/appearance lanes
rigid debris: position, normalized quaternion, scale, velocity/angular velocity
affine/sheared instance: mat4 only when the consumer truly needs general affine state
identity maps: only when stable external identity must survive compaction
occupancy/free-list/scan state: only for the selected allocation/compaction policy
```

Synthesize rigid transforms from position/quaternion/scale in the vertex path.
A hot `mat4<f32>` costs **Derived** 64 payload bytes per instance before other state and is not a
default for sparks or ordinary rigid debris.

Spawn packets contain event transform, flow vector, seed range, count, emission
scale, and visual class. Deterministic spawning uses ordered packet-count prefix
sums to assign ranges and a declared overflow policy. A free cursor alone cannot
reclaim arbitrary stable holes; use a deterministic free-list/bitset protocol,
append after dense compaction, or explicitly accept scheduling-dependent slot
identity outside regression paths. The spawn node uses specified integer
hashing from the event seed. Regression captures
must record seed, elapsed time, camera, exposure, quality tier, and backend.

Serialized dense-swap invariant:

```text
remove dead index i
last = liveCount - 1
copy every render-visible storage slice from last -> i
copy indexToEntity[last] -> indexToEntity[i]
update entityToIndex[movedEntity] = i
liveCount--
```

Do not run that pseudocode independently for many expirations. Concurrent tail
claims can duplicate sources, overwrite live destinations, and race both index
maps. Parallel compaction uses:

```text
mark[i] = alive(state[i])
exclusiveScan(mark) -> destination
if mark[i]: scatter every persistent simulation/render lane to next[destination]
               write nextIndexToEntity[destination]
               rebuild nextEntityToIndex[entity] = destination
publish liveCount/indirect instanceCount = scanTotal
swap current/next
```

Mark, each hierarchical scan level, scatter, and final-count publication are
separate ordered dispatch phases; workgroup barriers do not synchronize global
phases. Keep stable slots when scan/scatter bandwidth costs more than dead work.
Stable slots draw capacity or a maintained last-occupied range and reject
inactive records in the shader. Dense compaction writes an r185 indexed or
non-indexed indirect command to `IndirectStorageBufferAttribute`, attached with
`geometry.setIndirect()`. Never update only a draw count while leaving custom
state or identity maps behind.

Compaction moves stable generation-bearing identity, current recurrent state,
previous presented state, and every per-particle render lane atomically, then
rebuilds the versioned `motionBinding.identitySlotMap`. A
`PresentedStatePair` is published once per stable binding/provider after
commit; it is not a per-particle lane and is never scattered through the pool.
Birth, death, generation change, and slot reuse invalidate motion-vector,
trail, interpolation, and temporal-history keys before the slot is presented;
a new entity must not inherit the removed entity's previous pose.

Initialize every invariant indirect word before GPU publication. Non-indexed
layout is `[vertexCount:u32, instanceCount:u32, firstVertex:u32,
firstInstance:u32]`; indexed layout is `[indexCount:u32, instanceCount:u32,
firstIndex:u32, baseVertex:i32, firstInstance:u32]`. The Three attribute stores
`Uint32Array` words, so encode negative `baseVertex` as its i32 two's-complement
bit pattern or gate it to zero. After ordered scan/scatter, publish only the
validated `instanceCount`. Gate byte length, command alignment, signed range,
and `firstInstance` capability before drawing.

TSL compute uses `Fn().compute(count)` and enqueues through
`renderer.compute()`. In r185 `computeAsync()` only awaits renderer
initialization before calling `compute()`; it is not a GPU-completion fence.
Use workgroup/storage barriers only for dependencies in their valid scope and
dispatch boundaries for global phases. Avoid readback in the frame loop; an
actual async readback/map operation is required for CPU-visible completion.

### Presentation snapshot and temporal participation

Bind physics-driven pools to immutable, generation-bearing resources through
the candidate-first lifecycle. The view-independent
`PhysicsPresentationCandidate` owns each exact `PresentationResourceLease` and
one pair per stable binding/provider. Each pair's previous/current arm carries
independent `PresentationSampleProvenance`, `presentedInstant`, state handle,
and particle spatial binding. `CameraViewPublication` owns per-view render
sample instants, camera/projection state, and previous/current render mappings.
`ViewPreparationPublication` owns visibility, culling, acceleration, shadows,
caches, reset actions, and preparation lease refs. A sealed per-target/view
`PhysicsPresentationSnapshot` references candidate binding IDs and lease refs
plus those camera/preparation publication IDs; it copies no pair or transform.
Record resource/device generation, layout and entity-map revision, slot/range,
residency, access, queue availability, and the retirement condition. Metadata
immutability alone does not stop a GPU buffer from being overwritten.

Retain each lease until the multi-target `FrameExecutionRecord` records every
consuming snapshot under its target/view key and satisfies the lease-keyed
`ConsumerCompletionJoin`. On pre-seal failure, keep that target's `snapshotId`
absent and record `retired-after-abort` for each affected lease. On device loss,
record `device-lost`, invalidate the lost resource generation, and use the
lease's `invalidated-by-device-loss` disposition rather than wait for a
completion token that cannot arrive. A frame-in-flight ring is valid only when
it implements these candidate, snapshot-reference, multi-consumer completion,
abort, and loss rules.

Analytic particles evaluate pose at both previous and current presentation
times from immutable spawn data. Recurrent pools retain or generate adjacent
presented states separately from solver endpoints. Motion vectors use adjacent
presented poses, never physical velocity or a slot-index lookup. Publish
validity/rejection for birth, death, teleport, reparent, dissolve discontinuity,
generation/slot reuse, topology/representation change, and unavailable prior
state.

Each transparent class explicitly selects one route: pre-temporal with valid
depth/velocity and rejection, post-temporal, or temporal exclusion. Record the
choice and ghost/disocclusion tests; transparency does not inherit opaque-scene
history semantics automatically.

## Physics Contract

Coupled effects use the shared
[physics-domain and interaction contract](../../threejs-choose-skills/references/physics-domain-and-interaction-contract.md).
They join the route's `PhysicsContext` and `PhysicsGraph`; they do not define a
private gravity, scene scale, origin epoch, collision material, support query,
or timestep. The canonical schedule is:

```text
ingest -> sample-forcing -> predict -> emit-interactions -> solve-subcycles
       -> reduce-reactions -> correct -> commit -> publish-presentation
```

`publish-presentation` emits each stable binding/provider's
`PresentedStatePair` into a view-independent
`PhysicsPresentationCandidate`. The camera owner publishes
`CameraViewPublication`; visibility/shadow/cache owners publish
`ViewPreparationPublication`; only then does the per-target/view snapshot seal
candidate binding and lease refs. An effect pool does not mutate or pre-empt
any phase.

Weather-coupled particles, spray, smoke, debris, and wakes consume the route's
immutable `EnvironmentForcingSnapshot` through a declared `PhysicsGraph` edge.
They compute `vRel = airVelocityMps - particleVelocityMps` only after both
vectors are transformed into the same registered physics frame at the sample
instant. Drag or lift additionally requires `airDensityKgPerM3`, or a named
equation-of-state adapter; a direction-only visual may consume wind without
claiming aerodynamic force. Every consumed `SampledChannel` retains its actual
time, support, filter, state version, validity, and error, and missing required
channels follow the edge's explicit absence policy. Recurrent physical pools
apply forcing in their owned solver stage and publish reciprocal exchange, when
modeled, through canonical `InteractionRecord`/reaction groups. Analytic visual
pools may sample forcing only into immutable event parameters or presentation
state. Neither path owns a second wind field or mutates the forcing snapshot.

Choose the coupling class before allocating recurrent state:

| Effect | Physics boundary |
| --- | --- |
| purely visual analytic spark/trail | consume either a route-local presentation-only event or a non-authoritative view of the canonical `InteractionRecord` stream with its consumer cursor; emit no physical reaction |
| support-colliding particle/debris | consume registered `ColliderProxy` plus canonical `SupportSurfaceSample` at `sampleInstant: PhysicsInstant` |
| wake, impact, deposition, heat, erosion, or momentum source | emit a canonical `InteractionRecord` over `applicationInterval: PhysicsTimeInterval`; join a declared reaction group only when the coupling mode requires reactions |
| two-way debris/fluid/body coupling | solver adapter consumes interactions and returns reactions during `reduce-reactions`; the visual pool does not apply both sides |

An effect pool is presentation-only by default. It becomes an authoritative
physics participant only through a registered solver adapter with SI state and
stable generation-bearing body, collider/shape, proxy/support, and
`PhysicsMaterialId` identities. A colored sprite, visual debris instance, or
analytic trail never acquires mass, momentum, heat, or contact authority from
appearance. Authoritative bodies remain in the solver even when their visual
instances are culled, compacted, thinned, or unavailable.

`ColliderProxy` identity, topology version, frame/transform provider,
`PhysicsMaterialId`, and error bounds come from the site/geometry/domain owner.
The contact solver resolves that ID through the shared
`PhysicsMaterialRegistry`; an effect shader never derives coefficients from PBR
roughness, particle color, or debris appearance.
Support point, frame, physics material, point velocity, and point acceleration
come from the exact canonical `SupportSurfaceSample`. Thermal state, wetness,
receiver inventory, and other non-support quantities come from separate
`PhysicsSignalDescriptor` providers owned by their state equations; they are
not extra support-sample fields. Optional channels that are unavailable remain
absent. Do not zero-fill them, raycast the active render LOD, sample camera
depth as world collision, or create an effect-local height/collision field.
Screen depth remains a visual occlusion/soft-fade input only.

`SupportSurfaceSample` is kinematic. The registered collision solver owns the
separate contact ABI: `ContactManifoldRecord` carries generation-bearing
collider/shape/feature pairs, manifold generation and points, separation and
lifecycle, friction/adhesion state, warm starts, material-law versions,
validity, and migration/reset policy; canonical `InteractionRecord` values
carry dimensioned impulses, constraint targets, and reactions. Moving-frame
relative point velocity includes `omega cross r` under the central frame/time
contract. A presentation-only effect consumes these records; it does not
rediscover or resolve contact.

Every physically meaningful spawn, impact, scrape, deposition, wake, or heat
exchange crossing an owner boundary is one canonical `InteractionRecord`
serialized exactly as defined by the shared contract; this skill defines no
abbreviated record, alias, or parallel event envelope. Preserve the canonical
source and target state versions, target state equation, time/frame/origin,
footprint, tagged dimensional payload and sign, exact-once/application keys,
reaction/conservation links, validity, error, and provenance. Effect-specific
code selects a legal payload tag but cannot rename or omit common fields.
Generate child visual seeds from `interactionId`. Do not reconstruct an impulse
from flash brightness, convert particle count to mass, or emit separate
wake/impact formats per effect class. A presentation-only event is explicitly
non-authoritative and cannot enter an `InteractionBatchLedger` or
`InteractionReactionGroup`.

Batch support/proxy sampling and interaction emission on the owning compute or
solver path. Declare queue capacity, exactly-once producer sequence and consumer
cursor, total ordering, compaction, coalescing, and CPU/GPU barriers. Serialize
the exact canonical `InteractionBatchLedger`; do not define an effect-local
subset. In particular retain `batchId`, `exchangeId`, `producerId`, published
sequence range, every per-consumer cursor, typed accepted/rejected/late/
duplicate counts, overflow policy and sequence ranges, lost/deferred commodity
maps, and `exactOnceApplicationLedgerVersion`. The published range and typed
outcomes account produced, coalesced, or dropped work without adding per-record
overflow. A record that never entered the queue cannot report its own loss. A
full authoritative
queue backpressures, substeps, or conservatively aggregates under the route's
policy; silent loss can violate conservation or regression identity. A
reproducible GPU path uses stable bin/sort and a fixed reduction tree or proven
bounded fixed-point accumulation, not scheduling-dependent floating atomics.
Avoid in-frame readback. When a visual pool consumes a physics event without
feedback, mark it non-authoritative so it cannot accidentally enter an
`InteractionReactionGroup` or `ConservationGroup`.

Pool capacity and graphics quality are not conservation controls. Overflow,
LOD thinning, lifetime expiry, scan/compaction, or render-page eviction may
drop or coalesce presentation records under the declared visual policy, but
must never delete an authoritative body, contact lifecycle, or undelivered
physical `InteractionRecord`. Size authoritative queues from the physics
contract or apply its explicit backpressure/failure rule; maintain a separate
best-effort visual queue when graceful degradation is required.

An authoritative physics `QualityTransition` also migrates or explicitly
resets contact manifolds, warm-start impulses, and dependent history under the
shared error/conservation gate. During any render crossfade, exactly one
physical representation owns force/contact emission; overlapping visual
representations may both draw but may not both emit interactions or reactions.

Use an analytic trajectory when acceleration and drag permit exact seeking;
otherwise use a named integrator. Coupled state uses `PhysicsContext` SI meters
and seconds, then converts to rendering once; an authored visual-only path may
use art units only while it emits no physical `InteractionRecord` or reaction.
For `dv/dt = a - gamma*v` with constant `a` over a step, use the exponential
update rather than attenuating a newly added acceleration impulse:

```text
x = gamma * dt; require gamma >= 0
phi1(x) = -expm1(-x)/x
phi2(x) = (x + expm1(-x))/x^2
for small |x|:
  phi1 = 1 - x/2 + x^2/6 - ...
  phi2 = 1/2 - x/6 + x^2/24 - ...
velocityNext = exp(-x)*velocity + acceleration*dt*phi1(x)
positionNext = position + velocity*dt*phi1(x)
              + acceleration*dt^2*phi2(x)
normalizedAge = (time - spawnTime) / lifetime
```

For position/velocity-dependent forces, collision, or constraints, choose and
name an integrator, fixed step, event solve, and convergence gate inside the
registered `PhysicsGraph`. Gravity comes from `PhysicsContext` in SI and is
converted at the declared boundary once. Lateral spawn velocity is in the
event frame and then converted to the canonical physics frame. Lifetime and
drag ranges are authored per effect; gate them by trajectory/energy/error
envelopes rather than copying fixture constants.

Visible wrongness signatures:

- frame-dependent decay: trails shorten or lengthen when FPS changes;
- double-applied time: sparks arc too far because decayed velocity is multiplied
  by elapsed lifetime again;
- nonphysical arcs: debris accelerates in a local emitter frame after the event
  frame has rotated;
- stale age after dense-swap: a moved entity inherits the removed entity's
  dissolve or color state.

## Reentry Representation

Do not model reentry as a generic particle cloud. Compose:

```text
ship-shaped front shell
  + expanding capsule core wake
  + larger low-opacity haze wake
  + asymmetric side shear lobes
  + optional shock fleck sprite pool
```

The front shell uses hull topology or a hull-derived shell mesh so the plasma
follows the authored silhouette. Scale or displace along normals only enough to
avoid depth fighting; large separation reads as an unrelated aura.

Find the wake origin from sampled hull vertices. `flowDirectionWorld` always
means downstream fluid motion relative to the body; convert body velocity or
an upstream wind vector once at the event boundary, never inside individual
shell/wake formulas. Choose the support point with the greatest dot product:

```text
wake forward = normalized flow direction
wake up = projected local up, fallback local right when nearly parallel
wake right = cross(up, forward)
wake origin = hull support point along flow direction
```

Cache the hull sample set. Recompute the support point only when the flow frame
or hull pose changes enough to move the origin visibly.

## Reentry Shell And Wake TSL

The shell mask is flow-facing:

```text
facing = saturate(dot(normalWorld, -flowDirectionWorld))
facingMask = smoothstep(0.18, 0.96, facing)
```

Keep the useful domain controls from the historical version, but express them
as TSL nodes:

```text
coarse frequency = 3.6
fine frequency = 11.2
coarse/fine mix = 0.62 / 0.38
fine filament exponent = 3.1
flow speed basis = time * 5.4 + external flow * 0.08
```

Separate material response into nodes:

- core heat from flow-facing area;
- Fresnel envelope around silhouette;
- shock band requiring high facing, rim response, and filaments;
- alpha from shell role, depth policy, and normalized event lifetime;
- emissive output calibrated for the scene's HDR hierarchy.

Use `heatToColor(heat, role)` for radiometry instead of guessed emissive values.
The input heat domain is normalized but unclamped during composition:

```text
0.00 -> 0.15: dark red residue, 0.5-2 relative scene-linear units
0.15 -> 0.55: orange plasma body, 2-12 relative scene-linear units
0.55 -> 0.85: yellow-white shock, 12-40 relative scene-linear units
0.85 -> 1.25: white-blue ion edge, 40-80 relative scene-linear units
```

These are authored relative exposure units, not physical nits. Use `nit` only
when the entire renderer, light transport, exposure calibration, and display
target share an absolute photometric scale. `heatToColor` returns scene-linear
HDR RGB and an alpha recommendation. Bloom is
disabled while calibrating the LUT. The bloom-disabled expected look is readable
silhouette, flow bands, and wake role separation without halo support. Wrongness
cases: bloom-only shape, guessed emissive magnitudes copied from another scene,
flat white clipping in raw HDR, or ion colors authored in display space.

Color hierarchy:

```text
hot core: orange -> near white
ion envelope: magenta -> violet
outer sheath: violet -> cyan
shock: white -> blue
```

Wake geometry remains a generated capsule-profile tube because it is cheap,
stable, and art-directable. Along normalized length `t`:

```text
z = -trailLength * t
radial spread = 1 + t^1.24 * expansion
axial spread = 1 + 0.1 * t
profile turbulence = 1 + sin(theta * 3.3 + t * 8.7) * 0.1 * t
```

Reference dimensions relative to ship length:

```text
profile length = 0.74
profile radius = 0.068
trail length = 1.55

core: 52 radial x 26 longitudinal, expansion 1.9
haze: 40 x 20, radius 1.2x, length 1.05x, opacity 0.28
lobes: 28 x 14, half profile, length 0.88x, opacity 0.34
```

Treat those segment counts as the `ultra` starting point. Tier down by reducing
longitudinal segments first, then lobe count, then field octave count. Do not
replace the hull shell with an unrelated sphere or cone unless that is an
explicit low-tier static LOD.

Wake shading uses elliptical profile distance, a front gate, tail fade,
coarse/fine longitudinal fields, Fresnel, and separate core/envelope/filament
colors. Core, haze, and lobes should have separate scale/speed parameters; a
single mesh with changed opacity loses the readable layer roles.

## Instanced Spark Contract

Sparks are analytic sprites, not tiny meshes. Use `SpriteNodeMaterial` with
instanced storage attributes:

```text
pool cap: tier-dependent, 12k is a medium/high reference point
lifetime: 1.3 s reference
velocity decay: 16 reference
scale: max((lifetime - age) * baseRadius / lifetime, 0)
coverage: circular or soft capsule alpha in the material node
HDR color: hot orange/white -> dark red by normalized age
```

Spawn uses deterministic event-seeded variation, including lateral velocity in
the event frame. Keep the useful visual hierarchy from historical scenes:

```text
short transient flash > powered emitter core > persistent emitter > ordinary surface
```

If an effect intentionally needs the old nonphysical spark arc, label it as an
art-directed trajectory and keep it isolated behind a named curve. Otherwise
integrate velocity and acceleration with consistent units in compute.

## Debris Dissolve Contract

Debris uses instanced meshes when fragments need shape, rotation, lighting, or
collision readability. Reference artistic parameters:

```text
radius = 0.45
lifetime = random 2 -> 4 seconds
```

Those are visual fixture values in authored object/time units, not physics.
Presentation debris has no mass, friction, restitution, or gravity scale. An
authoritative fragment instead binds versioned SI `RigidBodyProperties`, a
generation-bearing `ColliderProxy`, `PhysicsMaterialId` plus state version, and
the `PhysicsContext` gravity provider. Its solver state remains outside the
effect pool. After commit, the authoritative binding publishes its
`PresentedStatePair` into `PhysicsPresentationCandidate`; each visual pool
resolves that candidate binding through the per-view
`CameraViewPublication`, `ViewPreparationPublication`, and sealed snapshot
refs. The snapshot copies no pair or render mapping, and the pool creates no
private snapshot mirror or second presentation-state owner.

Per-instance data:

```text
material flags
spawn/removal time
dissolve phase
angular velocity
current transform
```

Geometry-space procedural fields drive dissolve against remaining lifetime.
Material nodes add Fresnel-shaped heat, directional grounding tint, and a small
environment term. Use `GTAONode` from the shared post stack when debris
grounding matters across the scene; keep per-material fake terms subtle.

## Depth And Blend Policy

Depth policy is part of the effect contract:

| Layer | Depth test | Depth write | Sort/render policy | Notes |
| --- | --- | --- | --- | --- |
| Opaque debris | on | on | normal scene order | casts/receives according to scene budget |
| Dissolving debris | on | usually off while dissolving | premultiplied depth sort/bin, accepted weighted OIT, or alpha-hash contract | avoid stale depth silhouettes |
| Hull plasma shell | on | off | additive if its energy model is order-independent; otherwise sorted/OIT | validate occluders and near-hull offsets |
| Wake core | on | off | same declared blend owner as shell | should not draw through unrelated geometry |
| Haze/lobes | on unless deliberately camera-local | off | premultiplied depth bins/radix sort or accepted weighted OIT | tier down before disabling occlusion |
| Sparks/flecks | on | off | additive emission or alpha-hash/temporal cutout contract | use soft depth fade when available; do not rely on WebGPU point-size primitives for large particles |

Pool-class order alone does not solve ordinary alpha transparency and will pop
as records cross depths/classes. Additive emission is order-independent only
when its energy model permits it; otherwise use sorting/binning, weighted OIT
with an approximation gate, or alpha hash plus temporal stability.

Only disable depth testing for a camera-local diagnostic or an authored effect
that is explicitly allowed to ignore occluders. Record that decision in the
debug panel. `computeBounds` is not an r185 API. CPU instance matrices may use
`InstancedMesh.computeBoundingBox()`/`computeBoundingSphere()`; storage/TSL
motion needs analytic per-chunk emission envelopes or a GPU reduction. Use
chunked bounds instead of blanket `frustumCulled = false`; the canonical fixture also exposes
`softDepthFade` for occluder intersections.

## HDR And Color Pipeline

Default optical bloom consumes full-scene HDR radiance. Allocate an MRT
`emissive` signal only when selective inclusion/exclusion is an authored
requirement and its transparent blending plus tile-traffic contract is proven.
The main color path remains readable when bloom is bypassed.

```text
beauty target: scene color
optional emissive target: selective effect/light contribution
bloom input: full HDR beauty, or the proven selective target
final: beauty + bloom, then one output transform
```

Rules:

- LDR color textures encoded as sRGB use `SRGBColorSpace`; HDR/EXR radiance
  remains loader-declared linear.
- Data maps, masks, noise, LUTs, storage fields, and generated variants use
  `NoColorSpace`/linear.
- HDR working buffers use `HalfFloatType` until tone mapping.
- One owner performs tone mapping and color conversion in the node pipeline.
- Luminance constants are scene-relative. Validate in raw HDR, bloom-only, and
  bloom-disabled views.

## Performance contract

Account unique work rather than assigning a universal tier table:

| Work | Cost expression / evidence |
| --- | --- |
| analytic trajectory | immutable parameter bytes and vertex ALU; zero hot-state write |
| recurrent solver | `N_active * dynamicStrideBytes` plus invocations for each named stage |
| stable-slot draw | capacity versus live count and hole ratio; accept only if wasted vertex/fragment work fits |
| scan compaction | mark/scan/scatter reads+writes and moved records; compare against stable slots under identical occupancy |
| effect draw | submitted/visible instances, triangles, covered pixels, mean/p95 transparent layers |
| physics linkage | proxy/support samples, interaction records, queue/overflow counts, subcycles, barriers, and reaction reductions; deduplicate shared provider work |
| post | exact formats/extents/history slots and attachment read/write lower bound |

Allocate a ceiling from the complete frame, then measure contemporaneous
full-frame p50/p95 and paired marginal A/B cost with the complete workload
tuple. If the budget is missed, first remove unnecessary writable state or
compaction, then reduce active count, layer count, field bandwidth, and post
resolution subject to the visual contract. Do not hide cost by moving a dense
solver to per-object CPU work; do not move sparse branch-heavy authoritative
events to compute without an A/B result either.

## Diagnostics

Expose these views or counters:

```text
event packet count and seed
spawn count per class
live count, free cursor, compact/swap count
pool occupancy and overflow drops
instance index/entity mapping
age, velocity, acceleration, and radius
fall/flow direction and support point
PhysicsContext/frame/origin epoch and PhysicsGraph stage
ColliderProxy/SupportSurfaceSample provider IDs, versions, validity, and errors
InteractionRecord payload/source/target/interval/order/dedup/reaction group
canonical InteractionBatchLedger occupancy, sequence/outcome/overflow/loss fields
shell facing/core/envelope/shock masks
coarse and fine wake fields
wake profile distance and tail fade
raw HDR emission by layer
optional selective MRT contribution when that route is active
bloom contribution by layer
bloom-disabled baseline
depth-test and soft-depth modes
overdraw heat
GPU time per compute dispatch and draw class
quality tier and backend
```

Diagnostics may use readback, but never on the normal frame path.

## Replaced Techniques

- Independent particle emitters are replaced by event packets feeding pooled,
  compute-updated storage attributes. This preserves coherence and removes
  per-emitter scheduling overhead.
- CPU-updated instance state for large bursts is replaced by GPU-resident
  compute updates into `StorageInstancedBufferAttribute`. This avoids per-frame
  upload bandwidth as the effect scales.
- Per-burst mesh allocation is replaced by fixed-capacity pools with stable
  slots or deterministic mark/scan/scatter compaction. A parallel tail-swap is
  rejected unless unique ownership is serialized or proven atomic.
- Generic reentry spheres/cones are replaced by hull-conforming shell meshes
  with TSL displacement and flow-facing masks. This preserves the authored
  ship silhouette at similar or lower overdraw.
- Bloom-only shaping is replaced by authored HDR emission plus a bloom-disabled
  readability baseline. Full-scene bloom consumes beauty directly; allocate an
  MRT `emissive` contribution only for an explicitly proven selective contract.
- Global unculled fields are replaced by per-class or per-patch bounds with a
  documented exception only for validated camera-attached effects.
- Nondeterministic spawn randomness is replaced by event-seeded integer hashing
  so visual regression captures are repeatable.
- Scene constants copied as universal values are replaced by tiered budgets and
  scene-relative calibration.
