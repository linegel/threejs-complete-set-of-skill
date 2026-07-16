# Procedural Motion Mechanics

Read only the section selected by `SKILL.md`. These mechanisms target Three.js
r185 `WebGPURenderer` and TSL.

## Time and state models

### Closed-form interpolation

Choose interpolation from boundary conditions:

| Boundary condition | Representation |
| --- | --- |
| endpoint position and velocity | cubic Hermite |
| rest-to-rest position with continuous acceleration | quintic minimum jerk |
| constant speed on a curved path | arc-length table with monotone inversion and an error bound |
| constant angular speed between orientations | quaternion `slerp`, with shortest or declared long arc |
| multi-key orientation with first-derivative continuity | sign-continuous `squad` |
| coupled rotation and translation | screw/SE(3) interpolation with a declared frame convention |

### Fixed-step presentation

One owner holds raw delta, clamped delta, fixed step, maximum substeps,
accumulator, simulation time, timeline time, separate debt state, and pause/resume
policy:

```text
debtDecision = none
accumulator += min(rawDelta, maxFrameDelta)
while accumulator >= fixedStep and substeps < maxSubsteps:
  previous = valueCopy(current)
  current = step(current, fixedStep, simulationTime + fixedStep)
  simulationTime += fixedStep
  accumulator -= fixedStep

if accumulator >= fixedStep:
  wholeStepDebt = floor(accumulator / fixedStep) * fixedStep
  accumulator -= wholeStepDebt
  debtDecision = recordDropCatchUpOrDiscontinuity(wholeStepDebt)

if debtDecision is discontinuity:
  resynchronize state and clocks
  previous = valueCopy(current)
  accumulator = 0
  clear separate debt state
  invalidate dependent history

assert 0 <= accumulator < fixedStep
alpha = accumulator / fixedStep
presentationTime = max(0, simulationTime - fixedStep + accumulator)
presented = interpolate(previous, current, alpha)
```

Debt accounts for complete unprocessed steps outside the interpolation
accumulator. Dropping or scheduling that debt does not itself reset history. A
reset occurs only when the state/time mapping becomes discontinuous, and then
the state pair, clocks, and dependent history reset explicitly.

The pair brackets presentation time. If analytic and recurrent actors share a
shot, either sample both at the deliberately delayed presentation time or
perform an explicit resynchronization after debt handling. Sampling analytic
motion from wall time while recurrence drops time causes visible phase drift.

`THREE.Timer` connects once to the document, updates from the timestamp passed
to `renderer.setAnimationLoop()`, and supplies delta to this one policy. A
simulation owner may provide its own cadence; in that branch the render loop
requests presentation but never advances the coupled state.

### Recurrent response

A second-order spring makes velocity part of semantic state:

```text
acceleration = (target - position) * stiffness - velocity * damping
velocity += acceleration * fixedStep
position += velocity * fixedStep
```

Choose the fixed step through stability analysis and step-halving over the full
stiffness/damping envelope. A finite terminal-lock sequence copies the exact
terminal pose and zeros linear/angular velocity; a finite hand-off preserves its
declared terminal pose and velocity. Residual spring drift satisfies neither
contract. A periodic sequence wraps with declared phase/state continuity. An
open-ended sequence follows its declared external stop/reset transition without
imposing a generic terminal pose or zero-velocity rule.

For perceptual response, author retention per second:

```text
alpha = 1 - pow(retentionPerSecond, dt)
value = lerp(value, target, alpha)
```

This update is cadence-invariant only when target history is held or integrated
consistently over each processed interval; it is not a physical integrator.
Define how the target exists between timestamps:

- **continuous:** integrate the exponential-response equation against the known
  target function over the interval, or state and gate the error of the declared
  sampling phase;
- **zero-order hold:** keep each timestamped target until the next timestamp and
  split a render interval at every target change;
- **interpolated samples:** interpolate timestamped samples by the declared rule
  and integrate or converge against that same continuous reconstruction.

Verify 30, 60, 120, and 240 Hz against the same underlying target, not four
different per-frame sample lists. For a held target, the checkpoint reference is

```text
value(T) = target + (value(0) - target) * retentionPerSecond^T
```

For time-varying targets, compare shared wall-time checkpoints with the analytic
integral when available; otherwise run a cadence-refinement convergence gate
against the declared target reconstruction and sampling phase.

### Replay and clip ownership

Persistent state contains only semantic values:

```text
phaseId, phaseLocalTime
position, velocity
baseQuaternion, angularVelocity, spinAngle
stableActorId, generation
seed, rngCounter, oneShotEventFlags
```

The same seed, counter start, event schedule, initial buffers, and fixed step
must reconstruct the same state at matched authoritative times at every
presentation rate. A finite branch must also reconstruct its terminal state;
periodic and open-ended branches verify their wrap or stop/reset contract.
Reset all semantic state atomically when that contract calls for reset.

`AnimationMixer` consumes the same time policy: use `mixer.update(fixedStep)`
for simulation-owned clips and `mixer.setTime(authoritativeTime)` for seeking.
Assign channels explicitly, for example skeletal pose to the clip, root
transform to procedural motion, and camera transform to the camera rig.

## r185 representation and GPU residency

### API and residency

In r185, `BatchedMesh` improves scene/state management but visible multi-draw
entries remain separate backend draw items. It is not an instanced one-draw
bucket.

Use these exact API homes:

| Need | API |
| --- | --- |
| renderer, timer, storage attributes, pipeline | `three/webgpu` |
| `Fn`, `instanceIndex`, `mix`, `positionLocal`, `storage`, `uniform`, vectors | `three/tsl` |
| repeated instance state | `StorageInstancedBufferAttribute` |
| general/static compute state | `StorageBufferAttribute` |
| compute submission | `renderer.compute()` |

Split immutable parameters from hot state. A compact recurrent slot normally
contains previous/current position, velocity, quaternion, angular velocity,
phase, seed/counter, flags, and stable identity generation. Keep two pose slots:
compute writes the next state; vertex TSL reads previous/current and blends by
the CPU-owned `alpha`.

```ts
import * as THREE from 'three/webgpu';
import { instanceIndex, mix, positionLocal, storage, uniform } from 'three/tsl';

const previous = new THREE.StorageInstancedBufferAttribute( capacity, 4 );
const current = new THREE.StorageInstancedBufferAttribute( capacity, 4 );
const previousNode = storage( previous, 'vec4', capacity );
const currentNode = storage( current, 'vec4', capacity );
const alphaNode = uniform( 0 );

material.positionNode = positionLocal.add(
  mix(
    previousNode.element( instanceIndex ).xyz,
    currentNode.element( instanceIndex ).xyz,
    alphaNode
  )
);
```

Independent per-slot catch-up may fuse fixed steps inside one invocation.
Collision, constraints, scans, compaction, and bounds with global dependencies
remain ordered dispatches; workgroup barriers do not create a global barrier.

`computeAsync()` waits for renderer initialization before enqueueing compute;
it does not prove CPU-visible GPU completion. CPU-visible validation requires an
explicit asynchronous copy/map after the submitted work. Keep readback outside
the frame-critical loop.

Treat workgroup size as target-tuned. Measure CPU update/upload and GPU dispatch
p50/p95, active/visible count, aligned hot-state bytes, and presentation error.
Add culling or compaction only when removed work exceeds its dispatch and
traffic cost. Slot reuse increments generation before the new actor becomes
visible.

## Analytic phases, launch, and stage release

### Phase state

Store named boundaries and phase-local time rather than one opaque normalized
timeline. Derive every later boundary from earlier durations so changing one
duration cannot silently overlap or skip a phase. One-shot events record event
time, actor identity, phase, seed, and RNG counter.

For a three-part scalar distance curve with a constant slow phase followed by
constant acceleration and terminal deceleration, solve continuity rather than
repeatedly lerping toward the endpoint:

```text
slowSpeed = slowDistance / slowDuration
remaining = totalDistance - slowDistance

acceleration =
  (remaining - slowSpeed * (accelDuration + 0.5 * decelDuration))
  / (0.5 * accelDuration * (accelDuration + decelDuration))

peakSpeed = slowSpeed + acceleration * accelDuration
deceleration = peakSpeed / decelDuration
```

Integrate each segment analytically and verify position/speed continuity at
both boundaries. Use Hermite or quintic segments when endpoint velocity or
acceleration constraints differ.

### Curved launch frame

For a path around a spherical body, derive basis and velocity from the authored
trajectory:

```text
arcAngle = groundArcDistance / bodyRadius
radial  = normalize(0, cos(arcAngle), -sin(arcAngle))
tangent = normalize(0, -sin(arcAngle), -cos(arcAngle))

position = bodyCenter + radial * (bodyRadius + altitude) + crossrange
velocity = bodyCenterVelocity
         + altitudeDot * radial
         + (bodyRadius + altitude) * arcAngleDot * tangent
         + crossrangeDot
```

Align the model's declared forward/up axis to the differentiated velocity, then
apply authored roll as a separate quaternion in the stated local/world order.
A radial/tangent blend is not the path derivative and may point off-trajectory.
Keep object vibration, camera shake, trajectory, and physical state as separate
channels.

### Detachment and release

Capture the child's world transform before changing ownership. After
reparenting, compute its new local transform as described in the moving-frame
section. The release state inherits the parent's point velocity:

```text
v_release = v_parent_origin + omega_parent cross r_world
          + v_authored_separation
```

Use seeded variation around declared separation axes. For a closed-form peel,
evaluate attachment-local displacement until the release event:

```text
peelT = smoothstep(peelStart, detachTime, authoritativeTime)
localOffset = outwardAxis * maxPeelDistance * peelT^2
```

After release, advance the detached semantic actor or GPU slot. Many released
actors split static anchors/material variants from hot pose/velocity state.

## Moving frames, docking, and quaternions

### Frame rules

Name world, actor-local, orbital radial/tangent, docking-axis, rotating-parent,
and camera-presentation frames where used. A physical vector changes basis by
rotation (and scale for render units). A coordinate rate in a moving frame is a
different quantity and includes origin and `omega cross r` transport terms.

Docking error is evaluated in the current docking frame:

```text
offset = actorPosition - dockPort
axial = dot(offset, dockAxis)
radialVector = offset - dockAxis * axial
radialDistance = length(radialVector)
radialDirection = normalizeOrFallback(radialVector, previousRadialDirection)
```

Recompute the dock port and axis after the target rotates. Blend axial and
radial errors independently, then snap to the exact target pose and zero
velocity at the terminal condition. Align the actor's declared docking axis,
then compose local spin or world roll in the stated order. The fallback
direction makes on-axis docking finite.

### Quaternion operations

Declare helpers in frame terms:

```text
alignmentThenWorldRoll(base, worldRoll): result = worldRoll * base
localSpinAfterBase(base, localSpin):      result = base * localSpin
worldAngularVelocity(q, omega, dt):       q = deltaWorld(omega, dt) * q
```

In Three.js:

```text
worldRoll * base       -> result.multiplyQuaternions(worldRoll, base)
base * localSpin       -> result.multiplyQuaternions(base, localSpin)
deltaWorld * q         -> q.premultiply(deltaWorld).normalize()
```

Normalize input axes. Nearly parallel alignment returns identity; nearly
antiparallel alignment selects a stable perpendicular axis. Before storing or
interpolating consecutive quaternions, negate the new quaternion when their dot
product is negative so the double cover does not create a long-path jump.
Validate `abs(length(q) - 1)` against a declared tolerance.

### Reparenting without a jump

Update the old and new parent world matrices, capture `M_world_old`, then solve:

```text
M_local_new = inverse(M_world_newParent) * M_world_old
```

`Object3D.attach()` is valid for compatible scale chains. Non-uniform ancestry
may introduce shear; accept TRS decomposition only when recomposition residual
passes. Otherwise preserve the full affine local matrix with
`matrixAutoUpdate = false`, introduce an affine wrapper/bake, or reject the
handoff. Verify the world matrix before and after, not only position.

## Environment-driven actors

Before implementing this branch, declare each exchanged quantity's units,
frame/origin, timestamp or interval, cadence and sample phase,
producer/consumer ownership and publication order, resource/state version,
validity and error bounds, and reset behavior. Motion owns the actor pose; the
environment owner supplies samples or accepts reactions at those declared
instants and intervals.

| Observable | Motion model | Reaction scope |
| --- | --- | --- |
| scripted actor following a surface | analytic path plus filtered height/normal response | one-way, presentation-authored |
| visible inertia or drift | fixed-step actor with distributed force samples | one-way only with a bounded omitted-feedback regime |
| displacement or load-dependent wake | coupled environment/body solver | two-way source and reaction |
| metric slamming, added mass, radiation/diffraction, or control loads | dedicated domain solver | consume its pose through an explicit adapter |

Request samples at the actor's physical support scale. Keep interface geometry
velocity distinct from material transport velocity: height/normal following
uses the former; drag uses material-relative velocity. Missing channels remain
missing and either disable that term or select a declared reduced model.

For a distributed hydrostatic approximation, each validated cell may contribute:

```text
g_up = -g / |g|
immersion_i = dot(surfacePoint_i - samplePoint_i, g_up)
submergedVolume_i, buoyancyCentroid_i = submergedProperties_i(immersion_i)
F_buoyancy_i = density_i * |g| * submergedVolume_i * g_up
v_body_i = v_center + omega_body cross (samplePoint_i - center)
v_relative_i = v_body_i - materialCurrent_i
F_drag_i = -0.5 * density_i * C_d_i * area_i * |v_relative_i| * v_relative_i
torque_i = (buoyancyCentroid_i - center) cross F_buoyancy_i
         + (samplePoint_i - center) cross F_drag_i
```

`buoyancyCentroid_i` is the centroid of cell `i`'s submerged volume at the
current immersion, returned by the same validated hull-cell approximation as
`submergedVolume_i` and expressed in the stable physics frame. `samplePoint_i`
is the declared drag quadrature point in that frame. A dry cell contributes zero
buoyancy force and torque without evaluating a nonexistent submerged centroid.
This approximation needs step-halving and sample-layout refinement. Surface
parameterization velocity is not material current; substituting it creates
wave-phase drift.

A two-way interval orders prediction, common-time sampling, source creation,
conservative scatter, environment advance, reaction reduction, actor
correction, conservation/stability checks, and atomic publication. Declare rate
versus interval-integrated semantics once. Keep the coupled hot state on one
side of the CPU/GPU boundary or use a latency-bounded service; synchronous
frame-loop readback is outside the valid route.

## Presentation, resets, output, and lifecycle

### Immutable presentation pair

Publish previous/current pose generations with independent timestamps and the
same stable actor identity. Presentation interpolates this pair; transforms,
motion vectors, bounds, shadows, and temporal effects consume it without
resampling live simulation state. Resource reuse waits until all consumers of a
generation are complete.

Every discontinuity chooses a scoped history action:

| Discontinuity | Required action |
| --- | --- |
| camera cut or teleport | reset affected motion-vector and temporal history |
| spawn/despawn or storage-slot reuse | change stable identity generation; reject cross-identity velocity |
| reparent or frame/origin change | publish both frame mappings or reset affected history |
| topology, deformation, or LOD change | migrate only with a defined correspondence; otherwise reset |
| abrupt quality/state representation change | project both pose states with bounded error or reset |

An explicit reset clears phase/event state, accumulator and debt records,
seeds/counters, previous/current buffers, finite terminal locks, and validation
staging together. A debt drop or scheduled catch-up without a discontinuity
preserves history. A reset creates a valid zero/unknown motion vector rather
than a large derived velocity.

### Output and resource ownership

Animation data textures, pose buffers, masks, and lookup tables use
`NoColorSpace`; albedo uses `SRGBColorSpace`; HDR intermediates remain linear.
Use node materials for vertex/instance motion. A node-post app renders through
`RenderPipeline` and has one tone-map/output conversion owner,
`outputColorTransform` or explicit `renderOutput()`.

Disposal stops the animation loop and releases owned listeners, timers, storage
attributes/buffers, compute resources, validation readback staging, materials,
geometry, and pipeline resources. Reset preserves reusable allocations;
disposal relinquishes ownership.

## Failure signatures and verification

### Diagnose visible wrongness

| Symptom | Likely cause | Check |
| --- | --- | --- |
| terminal pose changes with display Hz | render delta entered semantic state | replay with one fixed schedule at four presentation rates |
| analytic actor separates after a hidden-tab stall | analytic clock ignored recurrent debt policy | compare timeline and simulation/presentation time after clamp |
| orientation takes a long arc or flips | quaternion signs differ across the double cover | log consecutive dot products before interpolation |
| NaN on an aligned or opposite axis | zero/antiparallel fallback absent | exercise both degenerate alignment inputs |
| detached child jumps | old world matrix used as new local matrix | compare complete world matrices around reparenting |
| detached part lacks readable tangential motion | rotating-parent `omega cross r` omitted | compare release velocity with analytic transport term |
| finite docked actor creeps | terminal lock retained residual velocity | inspect exact pose and zero linear/angular velocity |
| instance reads another actor's phase | stride, slot generation, or identity mismatch | validate selected slots outside the frame loop |
| history streaks after teleport or slot reuse | validity epoch was preserved incorrectly | inspect reset scope and stable identity generation |
| CPU stalls on GPU motion | frame-critical map/readback | count copies/maps on the frame path |

### Verification matrix

For every selected branch, record thresholds and direct evidence:

- analytic: direct seek equals replay at phase boundaries, matched checkpoints,
  and finite terminal time when the branch has one;
- recurrent: step-halving passes over the authored parameter envelope;
- perceptual: 30, 60, 120, and 240 Hz consume one declared target signal and
  agree at shared wall-time checkpoints within the branch's analytic or
  convergence tolerance;
- duration: finite motion reaches its exact pose and declared velocity/hand-off,
  with zero residual velocity only for a finite terminal lock; periodic motion
  preserves phase/wrap continuity; open-ended motion obeys its stop/reset
  transition without a fabricated terminal state;
- frames: zero-length and antiparallel inputs stay finite, quaternion norm and
  sign continuity pass, and reparenting preserves the world matrix;
- identity: spawn/despawn, slot reuse, topology/LOD, teleport, reparent, and cut
  select the intended reset or migration;
- GPU: named dispatch order, storage layout/bytes, p50/p95 timing, selected-slot
  snapshots outside the frame loop, and zero frame-critical readbacks;
- environment: sample support and timing pass; one-way leaves the source
  unchanged within its claim, or two-way closes declared force/torque/work
  residuals;
- presentation: pose, motion vectors, bounds, shadows, and temporal consumers
  resolve one immutable pair and one output owner;
- lifecycle: replay reset restores all semantic state and disposal releases
  every owned resource.
