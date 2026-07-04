# Layered Particle, Trail, and Effect Systems

Use this reference for ship-conforming reentry plasma, generated capsule wakes,
compute-updated analytic sparks, dissolving debris, dense-swap pools, and
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

The highest-throughput real-time effect architecture is not a set of independent emitters.
It is a fixed-capacity, GPU-resident effect graph:

```text
event packet buffer
  -> seeded spawn compute
  -> hot state storage attributes
  -> expire + dense-swap compaction
  -> dense InstancedMesh or sprite draw
  -> MRT output/emissive
  -> RenderPipeline selective bloom
```

Each visual class owns one pool and one draw path:

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

const effectTier = renderer.backend.isWebGPUBackend ? "ultra" : "compat";
```

The `compat` tier uses lower caps and reduced static LOD layers. It does not
introduce a second renderer recipe; explicit WebGPU-unavailable teaching routes
to `../threejs-compatibility-fallbacks/`.

Recommended tier cuts:

| Tier | Live particles | Shell/wake detail | Procedural field cost |
| --- | ---: | --- | --- |
| `ultra` | 64k-256k | 3-5 transparent layers, 2-3 wake families | 3 octaves, temporal post allowed |
| `high` | 24k-64k | 2-4 layers, 1-2 wake families | 2 octaves |
| `medium` | 8k-24k | 1-2 layers, 1 wake family | 1-2 octaves |
| `compat` | 1k-8k | reduced static LOD layers | no per-frame procedural field updates |

## Exact r185 Import Table

| Need | Import |
| --- | --- |
| Renderer and pipeline | `WebGPURenderer`, `RenderPipeline`, `StorageInstancedBufferAttribute` from `three/webgpu` |
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
| world flow | event packet | normalized `flowDirectionWorld`, Y-up scene, gravity in meters per second squared |
| event frame | effect pool | wake forward from world flow, projected up, right-handed basis |
| camera-facing sprite frame | renderer | camera -Z forward, sprite axes derived after world position |
| UV shell | shell material | `u` around hull or capsule, `v` normalized head-to-tail age |
| depth texture | image pipeline | non-color depth texture in camera clip/depth space with depth-to-meters conversion owned by the shared pipeline |
| scene-linear HDR | material output | beauty and MRT `emissive` remain linear until the one tone-map/output owner |

## Storage Pool Contract

Allocate once:

```text
startPosition: vec4  // xyz + spawn time
velocity: vec4       // xyz + decay
accelAge: vec4       // xyz acceleration + normalized age
render0: vec4        // radius, brightness, seed, flags
transform: mat4      // debris or shell instances only
entityToIndex: uint storage buffer
indexToEntity: uint storage buffer
liveCount: atomic uint
freeCursor: atomic uint
```

Spawn packets contain event transform, flow vector, seed range, count, emission
scale, and visual class. The spawn compute node expands packets into free slots,
using deterministic integer hashing from the event seed. Regression captures
must record seed, elapsed time, camera, exposure, quality tier, and backend.

Dense-swap invariant:

```text
remove dead index i
last = liveCount - 1
copy every render-visible storage slice from last -> i
copy indexToEntity[last] -> indexToEntity[i]
update entityToIndex[movedEntity] = i
liveCount--
```

For many expirations in one frame, batch removals in compute and preserve the
same invariant for every swapped slot. Never update only a draw count while
leaving custom state behind; that attaches stale age, color, or dissolve data
to the moved instance.

TSL compute uses `Fn().compute(count)` and dispatches through
`renderer.compute()` or `renderer.computeAsync()`. Use `workgroupBarrier` and
atomics only when spawn/compact phases share counters inside a workgroup. Avoid
readback in the frame loop; expose readback only in diagnostics builds.

## Physics Contract

Use semi-implicit integration in scene meters and seconds unless an art-directed
trajectory is explicitly named:

```text
velocity += acceleration * dt
velocity *= exp(-drag * dt)
position += velocity * dt
normalizedAge = (time - spawnTime) / lifetime
```

Gravity is world-space meters per second squared. Lateral spawn velocity is in
the event frame and then converted to world flow. Validity ranges are:

```text
dt: 1/240 -> 1/20 s per step, subdivide above that
spark lifetime: 0.15 -> 2.5 s
debris lifetime: 0.5 -> 8.0 s
drag: 0 -> 32 1/s
normalized lifetime: 0 -> 1, clamp only for shading
```

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

Find the wake origin from sampled hull vertices. For the current local fall or
flow direction, choose the support point with the greatest dot product:

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
0.00 -> 0.15: dark red residue, 0.5-2 scene-linear nits
0.15 -> 0.55: orange plasma body, 2-12 scene-linear nits
0.55 -> 0.85: yellow-white shock, 12-40 scene-linear nits
0.85 -> 1.25: white-blue ion edge, 40-80 scene-linear nits
```

`heatToColor` returns scene-linear HDR RGB and an alpha recommendation. Bloom is
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
spark flash > projectile > laser > ordinary surface
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
| Dissolving debris | on | usually off while dissolving | stable render order by pool class | avoid stale depth silhouettes |
| Hull plasma shell | on | off | after hull, before large haze | validate occluders and near-hull offsets |
| Wake core | on | off | behind shell | should not draw through unrelated geometry |
| Haze/lobes | on unless deliberately camera-local | off | late transparent class | tier down before disabling occlusion |
| Sparks/flecks | on | off | dense sprite class | use soft depth fade when available; do not rely on WebGPU point-size primitives for large particles |

Only disable depth testing for a camera-local diagnostic or an authored effect
that is explicitly allowed to ignore occluders. Record that decision in the
debug panel. Compute per-class bounds with `computeBounds` or chunked bounds
instead of blanket `frustumCulled = false`; the canonical fixture also exposes
`softDepthFade` for occluder intersections.

## HDR And Color Pipeline

Use MRT so materials write beauty and `emissive` once. `BloomNode` reads the
emissive texture; the main color path remains readable when bloom is bypassed.

```text
beauty target: scene color
emissive target: selective effect/light contribution
bloom input: emissive target
final: beauty + bloom, then one output transform
```

Rules:

- Color textures use `SRGBColorSpace`.
- Data maps, masks, noise, LUTs, storage fields, and generated variants use
  `NoColorSpace`/linear.
- HDR working buffers use `HalfFloatType` until tone mapping.
- One owner performs tone mapping and color conversion in the node pipeline.
- Luminance constants are scene-relative. Validate in raw HDR, bloom-only, and
  bloom-disabled views.

## Budgets

Per-frame budgets for the particle and effect subsystem:

| Metric | Ultra | High | Medium | Compat |
| --- | ---: | ---: | ---: | ---: |
| GPU time | 0.8-1.5 ms | 1.5-3.0 ms | 3.0-5.0 ms | feature budget, not visual parity |
| Compute dispatches | 3-5 | 2-4 | 1-3 | 0-1 |
| Visual-class draws | 4-8 | 3-6 | 2-4 | 1-3 |
| Storage hot writes | <= 64 B/live | <= 48 B/live | <= 32 B/live | minimized |
| Shell/wake triangles | 80k-180k | 35k-90k | 10k-40k | static LOD |
| Transparent overdraw | 4-8 local layers | 3-6 | 2-4 | 1-2 |
| Bloom scale | 0.5 | 0.5 | 0.25-0.5 | optional |

If the budget is missed, first reduce algorithmic cost: live cap, layer count,
field octaves, dispatch count, and post resolution. Do not hide cost by moving
simulation to the CPU or allocating transient objects.

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
MRT emissive contribution
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
- Per-burst mesh allocation is replaced by fixed-capacity pools and dense-swap
  compaction. This stabilizes memory and keeps draw ranges dense.
- Generic reentry spheres/cones are replaced by hull-conforming shell meshes
  with TSL displacement and flow-facing masks. This preserves the authored
  ship silhouette at similar or lower overdraw.
- Bloom-only shaping is replaced by authored HDR emission into MRT `emissive`
  plus a bloom-disabled readability baseline.
- Global unculled fields are replaced by per-class or per-patch bounds with a
  documented exception only for validated camera-attached effects.
- Nondeterministic spawn randomness is replaced by event-seeded integer hashing
  so visual regression captures are repeatable.
- Scene constants copied as universal values are replaced by tiered budgets and
  scene-relative calibration.
