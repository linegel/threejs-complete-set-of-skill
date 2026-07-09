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

| Space | Owner | Convention |
| --- | --- | --- |
| local hull | source mesh | hull samples, normals, and UV shell coordinates before world transform |
| world flow | event packet | normalized downstream fluid-relative-to-body direction `flowDirectionWorld = normalize(vFluidWorld - vBodyWorld)`; a body moving through still fluid therefore supplies one negation; convert physical acceleration with `sceneUnitsPerMeter`, or declare authored world-length-units/s² |
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

## Physics Contract

Use an analytic trajectory when acceleration and drag permit exact seeking;
otherwise use a named integrator in declared scene length units and seconds.
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
name an integrator, fixed step, event solve, and convergence gate. Gravity is
world-space length units per second squared under the project's declared unit
convention. Lateral spawn velocity is in the event frame and then converted to
world flow. Lifetime and drag ranges are authored per effect; gate them by
trajectory/energy/error envelopes rather than copying fixture constants.

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
mass = 0.1
friction = 0.4
restitution = 0.8
gravity scale = 1.2
```

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
