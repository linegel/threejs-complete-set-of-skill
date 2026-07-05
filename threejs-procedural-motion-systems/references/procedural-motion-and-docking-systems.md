# Procedural Motion and Docking Systems

Use this reference for WebGPU/TSL procedural animation systems with phase-based
launch, staging, docking, spring, rotating-frame, detachment, and debris motion.
The best path is analytic semantic state first, then instanced node attributes
or compute/storage state for scale.

Number labels: Gated values are validation limits, quality tiers, or explicit
budget gates. Derived values come from the authored scene scale, preset
equations, actor count, or measured hardware. Treat unfit hardware or scale as
a reason to choose a lower tier, not to silently change the motion contract.

## Contents

- Architecture contract
- Renderer loop and delta policy
- Capability gate and quality tiers
- Exact r185 import table
- Validity ranges and visible wrongness
- State layout and replay
- TSL/storage scaling path
- Piecewise launch kinematics
- Planet-relative gravity turn
- Camera-independent shake and roll
- Stage detachment
- Spin-docking timeline
- Docking-frame decomposition
- Spring convergence and terminal lock
- Peeling and released debris
- Quaternion frame contracts
- Animation clip interop
- Color, post, and output
- Budgets
- Replaced techniques
- Failure modes and diagnostics
- Validation

## Architecture contract

The top-tier architecture is:

```text
WebGPURenderer + THREE.Timer + renderer.setAnimationLoop()
+ fixed-step accumulation for deterministic state
+ analytic transform timelines for authored motion
+ pow(k, dt) smoothing for perceptual response
+ instanced node attributes or compute-updated storage buffers at scale
+ explicit quaternion frame contracts
```

Use `Object3D` transforms only for a small number of semantic hero actors. When
counts grow, keep authoring state in arrays/storage and render it with
`InstancedMesh`, `BatchedMesh`, or storage-driven nodes. Thousands of per-object
updates are a CPU scene-graph problem, not a procedural animation feature.

## Renderer loop and delta policy

Create one animation loop and one timing policy:

```ts
import * as THREE from 'three/webgpu';

const renderer = new THREE.WebGPURenderer( { antialias: false } );
await renderer.init();

const timer = new THREE.Timer();
timer.connect( document );

const policy = {
  fixedStep: 1 / 120,
  maxFrameDelta: 1 / 15,
  maxSubsteps: 8,
  accumulator: 0,
  simulationTime: 0,
  presentationTime: 0
};

const fixedState = {
  previous: createProceduralState(),
  current: createProceduralState(),
  render: createProceduralState()
};

renderer.setAnimationLoop( ( timestamp ) => {
  timer.update( timestamp );

  const rawDelta = timer.getDelta();
  const clampedDelta = Math.min( rawDelta, policy.maxFrameDelta );
  policy.accumulator += clampedDelta;
  policy.presentationTime = timer.getElapsed();

  let substeps = 0;
  while ( policy.accumulator >= policy.fixedStep && substeps < policy.maxSubsteps ) {
    copyProceduralState( fixedState.previous, fixedState.current );
    stepProceduralAnimation( fixedState.current, policy.fixedStep, policy.simulationTime + policy.fixedStep );
    stepGpuAnimation( policy.fixedStep, policy.simulationTime + policy.fixedStep );
    policy.simulationTime += policy.fixedStep;
    policy.accumulator -= policy.fixedStep;
    substeps ++;
  }

  if ( substeps === policy.maxSubsteps ) policy.accumulator = 0;

  const alpha = policy.accumulator / policy.fixedStep;
  interpolateProceduralState( fixedState.render, fixedState.previous, fixedState.current, alpha );
  renderProceduralFrame( fixedState.render, alpha );
} );
```

The policy owns raw delta, clamped delta, fixed step, max substeps, simulation
time, presentation time, replay time, and pause/resume behavior. The
spiral-of-death clamp is Gated by `maxSubsteps`; when the gate is hit, discard
the remainder and record the drop for diagnostics instead of executing an
unbounded backlog. Mixers,
compute dispatches, springs, and presentation-only effects consume this policy
rather than sampling their own clocks.

## Capability gate and quality tiers

Use `WebGPURenderer` everywhere and gate only the quality tier. Explicit
compatibility strategy requests route to `../threejs-compatibility-fallbacks/`;
this flagship reference keeps one architecture:

```js
await renderer.init();
if ( renderer.backend.isWebGPUBackend ) {
  // Full tier: storage buffers, compute dispatch, node materials, node post.
} else {
  // Compatibility handoff: use the dedicated compatibility-fallbacks skill.
}
```

Do not write a parallel renderer implementation in this skill.

Full tier uses compute/storage and node post. Balanced tier reduces active
counts and update frequency for distant chunks. Compatibility strategy details
belong in the compatibility-fallbacks skill.

## Exact r185 Import Table

| Need | Import |
| --- | --- |
| Renderer, timer, pipeline, storage | `WebGPURenderer`, `Timer`, `RenderPipeline`, `StorageInstancedBufferAttribute`, `StorageBufferAttribute` from `three/webgpu` |
| TSL compute/storage | `Fn`, `instanceIndex`, `mix`, `positionLocal`, `storage`, `uniform`, `vec3`, `vec4`, `pass`, `mrt`, `renderOutput` from `three/tsl` |
| Temporal reprojection | `traa` from `three/addons/tsl/display/TRAANode.js` |
| Bloom | `bloom` from `three/addons/tsl/display/BloomNode.js` |
| Ambient occlusion | `ao` from `three/addons/tsl/display/GTAONode.js` |
| Cascaded shadows | `CSMShadowNode` from `three/addons/csm/CSMShadowNode.js` |
| Tile shadows | `TileShadowNode` from `three/addons/tsl/shadows/TileShadowNode.js` |

## Validity ranges and visible wrongness

Use one scene scale:

```text
sceneUnits = meters * sceneScaleMeters
```

Recommended validity ranges:

```text
fixed step: 1/240 -> 1/60 s
clamped frame delta: <= 1/20 s
max substeps: 4 -> 12
launch speed: <= 95 sceneUnits / s unless the preset declares another cap
stage spin: 0.06-0.15 rad/s for readable hero debris
docking spin: 0-3.15 rad/s for the reference preset
debris lifetime: 0.5-12 s
terminal snap epsilon: position <= 1e-4 sceneUnits, quaternion angle <= 1e-4 rad
```

Visible signature and wrongness checks:

- frame mixups: presentation Hz changes terminal position even with the same
  fixed-step schedule;
- quaternion double-cover sign flip: `slerp` takes the long visual path or a
  debug line jumps even though the rotation is equivalent;
- radial fallback NaN: on-axis docking creates `NaN` in radial direction,
  target, or quaternion;
- non-rotating debris: released debris lacks tangential velocity from the
  spinning hull;
- terminal drift: a docked or staged actor keeps creeping after terminal lock;
- storage stride mismatch: instanced debris reads a neighbor's phase or seed.

## State layout and replay

Use explicit persistent state. For hero actors this can live in TypeScript:

```ts
type ProceduralAnimationState = {
  elapsedSeconds: number;
  phaseId: number;
  phaseLocalTime: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  baseQuaternion: THREE.Quaternion;
  spinAngle: number;
  angularVelocity: THREE.Vector3;
  seed: number;
  rngCounter: number;
  eventFlags: Record<string, boolean>;
};
```

For high counts, use struct-like storage fields:

```text
dynamicState:
  position.xyz, phaseId
  velocity.xyz, flags
  quaternion.xyzw
  angularVelocity.xyz, spinAngle
  seed, rngCounter, phaseLocalTime, padding

staticState:
  localAnchor.xyz, scale
  localAxis.xyz, presetId
  startTime, duration, massOrSize, materialVariant
```

Keep scratch vectors/quaternions outside persistent state. Reset every field,
seed counter, event flag, storage buffer, and phase timestamp when restarting a
sequence. Deterministic replay means the same seed, fixed step, event schedule,
and initial buffers produce the same terminal state at 30, 60, 120, and 240 Hz
presentation rates.

Seeded RNG and event-log contract:

```text
seed: uint32 sequence seed
streamId: per system or actor stream selector
rngCounter: monotonically consumed counter, reset on replay
one-shot event flags: stageDetached, dockingCaptured, terminalLocked
eventLog: [{ time, phaseId, eventName, actorId, rngCounter, seed }]
snapshot: seed, streamId, rngCounter, eventLog, storage version, selected hot buffers
```

Reset/dispose clears CPU state and storage: reset phase timestamps, one-shot
event flags, `rngCounter`, `eventLog`, dynamic storage buffers, and any
validation readback buffers before a replay begins.

## TSL/storage scaling path

Use `StorageInstancedBufferAttribute` for per-instance state consumed by
`InstancedMesh`, and `StorageBufferAttribute` for static parameters or general
compute state. Keep two dynamic pose slots. Compute writes the next fixed state;
vertex TSL reads previous/current slots and blends by the CPU-owned
presentation alpha.

```ts
import * as THREE from 'three/webgpu';
import { Fn, instanceIndex, mix, positionLocal, storage, uniform, vec3, vec4 } from 'three/tsl';

const instanceCount = derivedVisibleInstanceCount;
const previousPose = new THREE.StorageInstancedBufferAttribute( instanceCount, 4 );
const currentPose = new THREE.StorageInstancedBufferAttribute( instanceCount, 4 );
const velocityState = new THREE.StorageInstancedBufferAttribute( instanceCount, 4 );
const staticMotion = new THREE.StorageBufferAttribute( instanceCount, 4 );

const previousPoseNode = storage( previousPose, 'vec4', instanceCount );
const currentPoseNode = storage( currentPose, 'vec4', instanceCount );
const velocityNode = storage( velocityState, 'vec4', instanceCount );
const staticNode = storage( staticMotion, 'vec4', instanceCount );
const fixedStep = uniform( 1 / 120 );
const simTime = uniform( 0 );
const alpha = uniform( 0 );

const integratePose = Fn( ( { previousPose, currentPose, velocity, staticMotion } ) => {
  const i = instanceIndex;
  const current = currentPose.element( i );
  const v = velocity.element( i );
  const anchor = staticMotion.element( i );
  const target = anchor.xyz.add( vec3( 0, anchor.w.sin().mul( 0.25 ), 0 ) );
  const acceleration = target.sub( current.xyz ).mul( anchor.w.mul( anchor.w ) ).sub( v.xyz.mul( anchor.w.mul( 1.85 ) ) );
  const nextVelocity = v.xyz.add( acceleration.mul( fixedStep ) );

  previousPose.element( i ).assign( current );
  currentPose.element( i ).assign( vec4( current.xyz.add( nextVelocity.mul( fixedStep ) ), current.w ) );
  velocity.element( i ).assign( vec4( nextVelocity, v.w ) );
} )( { previousPose: previousPoseNode, currentPose: currentPoseNode, velocity: velocityNode, staticMotion: staticNode } )
  .compute( instanceCount, [ 64 ] )
  .setName( 'motion:integrate-instance-spring' );

material.positionNode = positionLocal.add(
  mix(
    previousPoseNode.element( instanceIndex ).xyz,
    currentPoseNode.element( instanceIndex ).xyz,
    alpha
  )
);

function stepGpuAnimation( dt: number, time: number ) {
  fixedStep.value = dt;
  simTime.value = time;
  renderer.compute( integratePose );
}

function renderGpuAnimation( presentationAlpha: number ) {
  alpha.value = presentationAlpha;
  renderPipeline.render();
}
```

Derived/Gated labels for the snippet: `instanceCount` is Derived from visible
actor count and LOD; `fixedStep` is Derived from the delta policy; workgroup
size `64` is an authored default chosen as a whole multiple of the common GPU
subgroup widths (32 and 64) — the compute contract records it, but no validator
asserts it as a device gate; spring stiffness `omega^2` is Derived from the
per-instance frequency `anchor.w` stored in `staticMotion`, and the damping
factor `1.85` is Derived as `2 * zeta * omega` with authored damping ratio
`zeta = 0.925` (slightly under-critical, so arrivals settle with one soft
overshoot instead of creeping in); the `0.25` bob amplitude is an authored
demo constant with no gate.

Use one dispatch for simple analytic timelines, two to three dispatches when
you also compact active actors or update chunk bounds. Avoid readback in the
frame loop. Use `renderer.computeAsync()` for setup, validation snapshots, or
explicit synchronization points, not as a per-frame habit.

When pose data is texture-shaped, use `StorageTexture` plus `textureStore()`.
Use `workgroupBarrier()` or storage barriers only when invocations within a
dispatch actually share data; barriers are synchronization costs, not safety
decoration.

## Piecewise launch kinematics

The following constants are example presets, not universal defaults:

```text
ignition hold = 1.2 s
ascent = 24 s
slow phase = 5 s
acceleration phase = 11 s
deceleration phase = 8 s
slow distance fraction = 0.00035
coast linear = 1.2 s
terminal deceleration = 4 s
```

`computeAscentKinematics()` solves a normalized distance curve whose position
and speed remain continuous across ascent phases. This stays best-in-class for
authored launch because it is exact, seekable, deterministic, and cheap enough
to evaluate per instance.

For slow phase:

```text
speed = slowDistance / slowDuration
distance = speed * t
```

Solve acceleration so total normalized distance reaches one after the
acceleration and deceleration phases:

```text
remaining = 1 - slowDistance
accel =
  (
    remaining
    - slowSpeed * (accelDuration + 0.5 * decelDuration)
  )
  /
  (
    0.5 * accelDuration * (accelDuration + decelDuration)
  )

peakSpeed = slowSpeed + accel * accelDuration
decel = peakSpeed / decelDuration
```

Then integrate each phase analytically. Do not approximate this authored
timeline by repeatedly moving toward an endpoint.

## Planet-relative gravity turn

The launch maps normalized distance to:

```text
altitude = ascentProgress * targetOrbitAltitude + coastDistance * coastRate

groundArcDistance =
  ascentProgress^1.22 * maxGroundArcDistance * turnBlend
  + coastDistance * groundTrackRate

arcAngle = groundArcDistance / planetRadius
```

Example preset constants:

```text
target altitude = 420 km converted through sceneScaleMeters
max ground arc = 2200 km converted through sceneScaleMeters
max crossrange = 26 km converted through sceneScaleMeters
```

Declare one unit contract:

```text
sceneUnits = meters * sceneScaleMeters
all authored km/m constants convert before entering simulation/storage
```

Construct:

```text
radial = normalize(0, cos(arcAngle), -sin(arcAngle))
tangent = normalize(0, -sin(arcAngle), -cos(arcAngle))
position = planetCenter + radial * (planetRadius + altitude)
position.x += crossrange
```

Orientation:

```text
flightDirection = normalize(lerp(radial, tangent, gravityTurn * 0.9))
base = fromUnitVectorsSafe(rocketLocalUp, flightDirection)
roll = rotationAroundUnitAxis(flightDirection, rollAmount)
orientation = base then roll in the model's local contract
```

This separates trajectory direction from authored roll/vibration. Verify the
model axis contract before choosing multiplication order.

## Camera-independent shake and roll

Rocket roll:

```text
shake envelope = 1 - smoothstep(0.05, 0.9, ascentProgress)
vibration =
  (
    sin(time * 52)
    + sin(time * 31 + 0.7)
  )
  * 0.0024
  * envelope

roll =
  sin(time * 2.5) * 0.008 * envelope
  + vibration
```

The camera has a separate early launch shake envelope and offset. Keep object
vibration, camera shake, physics state, and trajectory separate so each can be
disabled for diagnostics or routed to `$threejs-camera-controls-and-rigs`.

## Stage detachment

Before reparenting stage one:

```text
set matrixWorldNeedsUpdate on the actor and affected ancestors
call updateWorldMatrix( true, true, true )
capture world matrix, position, quaternion, and scale
detach semantic child
add to scene or detached actor owner
restore captured world matrix
```

`Object3D.attach()` is acceptable only when the hierarchy has no non-uniform
scale. Otherwise capture and restore the world matrix explicitly.

The detached stage receives readable separation:

```text
along offset = -3.4 m
side offset = 4.2 m
earthward offset = 1.2 m

along speed = -5.2 m/s
side speed = 5.8 m/s
earthward speed = 4.2 m/s
```

Convert these through the scene unit contract before simulation. For one hero
stage, integrate the semantic actor in the fixed step. For many released parts,
write the initial separation vector, seed, and release time into storage and
evaluate the analytic offset or fixed-step velocity in compute.

For the first `2 s`, orientation slerps from the captured quaternion to a
seeded `10-30 deg` tilt. Afterward, it integrates a bounded spin rate
`0.06-0.15 rad/s`. The side direction may be chosen relative to the camera so
separation reads in the shot; label that as presentation-authored, not physics.

## Spin-docking timeline

Docking example preset:

```text
Endurance spin = 3.15 rad/s
Ranger spin-up = 6.5 s
approach starts = 4.0 s
approach duration = 14.5 s
dock settle = 3.0 s
post-dock spin-down = 3.0 s
dock axial clearance = 4.1 scene units
dock radial offset = 0.35 scene units
```

Every phase uses named event times and a `smoothstepRange(start, end, time)`.
The sequence does not hide all timing in one normalized zero-to-one value.

Endurance:

```text
currentSpinRate = lerp(3.15, 0, spinDownT)
spinAngle += currentSpinRate * fixedStep
orientation = baseOrientation followed by localForward spin
```

The docking frame is recomputed from the newly rotated Endurance every fixed
step. For instanced or compute-driven docking swarms, store base frame, spin
axis, spin angle, and port transform in storage; derive the current frame in TSL
from simulation time.

## Docking-frame decomposition

At approach start:

```text
offset = rangerPosition - dockPort
parallel = dot(offset, dockAxis)
radialVector = offset - dockAxis * parallel
radialDistance = length(radialVector)
radialDirection = normalizeOrFallback(radialVector, previousRadialDirection)
```

Target during approach:

```text
parallelApproach =
  lerp(startParallel, dockClearance, approachT)

parallel =
  lerp(parallelApproach, dockClearance, dockT)

radialApproach =
  lerp(startRadial, dockRadialOffset, approachT)

radial =
  lerp(radialApproach, 0, dockT)
radial = lerp(radial, 0, spinDownT)

target =
  dockPort
  + dockAxis * parallel
  + radialDirection * radial
```

This preserves a readable approach corridor while progressively removing
lateral error. Guard the zero-radial case so docking on-axis does not create
NaNs.

## Spring convergence and terminal lock

Use a spring only when velocity and inertia are visible:

```text
acceleration =
  (target - current) * stiffness
  - velocity * damping

velocity += acceleration * fixedStep
current += velocity * fixedStep
```

Substep stiff springs. Clamp inactive-tab deltas before they reach the fixed
step accumulator. Stiffness may increase from `5.0` to `9.8`; damping from
`4.6` to `7.4` as docking settles, but treat those as preset values.

Use exponential response for perceptual parameters:

```text
alpha = 1 - pow(retentionPerSecond, dt)
value = lerp(value, target, alpha)
```

Orientation aligns local up to negative docking axis, then applies spin around
the docking axis with explicit order:

```text
alignment = fromUnitVectorsSafe(localUp, -dockAxis)
spin = rotationAroundUnitAxis(dockAxis, rangerSpinAngle)
orientation = spin/alignment order chosen by declared local-vs-world contract
```

Near completed docking, position may receive a final blend toward target. After
spin-down reaches `0.995` or error is below the snap epsilon, copy target
exactly, copy the terminal quaternion exactly, and zero linear/angular velocity.
A spring alone can retain imperceptible but destabilizing residual motion.

## Peeling and released debris

Endurance debris has two states.

Attached peel:

```text
peelT = smoothstep(peelStart, detachTime, sequenceTime)
peelDistance = maxDistance * peelT^2
position = shipTransform(localAnchor + outward * peelDistance)
orientation = shipOrientation * localBase * peelTwist
```

At release, velocity inherits rotating-frame tangential velocity:

```text
angularVelocityOfShip =
  dockAxis * currentSpinRate

tangentialVelocity =
  cross(angularVelocityOfShip, worldOffsetFromShip)

velocity =
  tangentialVelocity
  + outward * outwardSpeed
  + axis * axialSpeed
```

Released debris then integrates linear velocity and quaternion rotation from
its angular-velocity vector. Speed is capped at `95` scene units per second
unless the preset declares another scale.

This rotating-frame inheritance is the defining mechanism. Random outward
velocity alone was replaced because it cannot match a spinning hull and does
not replay with physically readable tangential motion.

For more than a few hundred debris pieces, initialize release state in storage,
integrate in compute, and render with `InstancedMesh`. Split static local
anchors/material variants from dynamic position/quaternion/velocity so only hot
state changes each frame.

## Quaternion frame contracts

Declare every helper in local/world terms:

```text
fromUnitVectorsSafe(fromLocalAxis, toWorldAxis)
rotationAroundUnitAxis(worldAxis, radians)
composeWorldOrientation(baseWorld, spinWorldOrLocal, order)
integrateAngularVelocity(quaternion, angularVelocityWorld, fixedStep)
```

Three.js-specific helper contracts:

```text
alignmentThenWorldRoll(baseAlignment, worldRoll):
  result.multiplyQuaternions(worldRoll, baseAlignment)
  Equivalent to baseAlignment.premultiply(worldRoll); world roll is applied
  after the local-to-world alignment.

localSpinAfterBase(baseWorld, localSpin):
  result.multiplyQuaternions(baseWorld, localSpin)
  Equivalent to baseWorld.clone().multiply(localSpin); the spin axis is local.

integrateAngularVelocityWorld(q, angularVelocityWorld, dt):
  deltaWorld.setFromAxisAngle(normalize(angularVelocityWorld), angle)
  q.premultiply(deltaWorld).normalize()
  World angular velocity is applied before the current local orientation.

canonicalizeQuaternionSign(prev,next):
  if dot(prev,next) < 0, negate next before storage or interpolation.
  This avoids double-cover sign flip artifacts across snapshots.
```

Rules:

- Normalize all axes before quaternion construction.
- If vectors are nearly parallel, return identity; if nearly antiparallel, use
  a stable fallback perpendicular axis.
- State multiplication order in words next to the code.
- Normalize accumulated quaternions after integration and after repeated
  multiplication.
- Validate `abs(length(q) - 1) < 1e-4` in debug builds.

## Animation clip interop

`AnimationMixer` consumes the same `DeltaPolicy`. Use `mixer.update(fixedStep)`
inside the fixed-step loop for simulation-owned clips, or `mixer.setTime(time)`
for exact phase jumps and replay scrubbing.

Define ownership per channel:

```text
clip owns skeletal pose
procedural system owns root transform
TSL instance state owns repeated debris transforms
camera skill owns camera rig transforms
```

Do not let a clip and procedural code write the same root position/quaternion
without an explicit layering rule.

## Color, post, and output

Procedural animation data is data, not color:

```text
pose textures, random tables, masks, lookup tables: NoColorSpace
albedo/color textures: SRGBColorSpace
HDR intermediate buffers: HalfFloatType
```

The app has one tone-map owner and one output conversion owner. Use
`RenderPipeline.outputColorTransform` or explicit `renderOutput()`. Node-post
apps call `renderPipeline.render()`, not renderer.render(), so the pipeline owns
the final output path. Keep materials in the `NodeMaterial` family and express
vertex/instance offsets, emissive events, and masks with TSL.

Use built-in nodes first where animation affects image quality:

```text
TRAANode: temporal reprojection for subpixel animated motion
BloomNode: emissive ignition, plasma, impacts, warning lights
GTAONode: contact grounding for docking/landing actors
CSMShadowNode or TileShadowNode: scalable directional shadows
```

## Budgets

Targets for the animation system alone:

```text
desktop-discrete: <= 1.0 ms update/dispatch, 60-120 Hz simulation
desktop-integrated: <= 2.0 ms update/dispatch, 60 Hz simulation
mobile: <= 3-4 ms update/dispatch, 30-60 Hz simulation tier
```

Routing budgets:

```text
hero actors: <= 200 Object3D updates, <= 0.25 ms CPU desktop-discrete
instanced fields: one draw per geometry/material bucket
compute motion: one to three dispatches per active system per frame
workgroup size: usually 64-256 invocations
hot state: 48-96 bytes per instance
draw calls: stable and bucketed by material/geometry, not by actor
readback: zero in the frame loop
```

Shed load by reducing active counts, distant update cadence, chunk visibility,
and post resolution scale before changing the authored motion contract.

## Replaced techniques

- Replaced repeated endpoint interpolation with analytic timelines because
  analytic curves are continuous, seekable, deterministic, and cheaper to
  validate.
- Replaced high-count `Object3D` transform loops with instanced attributes or
  compute/storage state because the latter avoids CPU traversal and per-instance
  matrix uploads.
- Replaced unbounded variable-delta springs with fixed-step/substepped springs
  plus terminal locks because resume spikes and high stiffness otherwise create
  divergent replay.
- Replaced plain random debris impulses with rotating-frame inherited velocity
  plus seeded variation because tangential inheritance is the visible physical
  cue.
- Replaced ambiguous quaternion snippets with explicit frame helpers because
  local/world order mistakes are hard to see until a model axis changes.

## Failure modes and diagnostics

Observed boundaries:

- Detachment randomness must be seeded; never call ambient randomness for
  replayed motion.
- Springs need fixed steps, substep thresholds, and snap epsilons.
- Launch presets are authored for one scale and shot duration; declare unit
  conversion before reuse.
- Camera-relative separation is intentionally cinematic rather than physical.
- Repeated quaternion multiplication must normalize periodically.
- Timeline phase constants are coupled; changing one duration requires
  recomputing later event boundaries.
- Storage layouts must be versioned when validation snapshots depend on byte
  offsets.

Expose:

```text
sequence time, fixed simulation time, presentation time, and current phase
raw/clamped delta, accumulator, substep count, dropped-substep flag
seed, rng counter, event flags, phase-local timestamps
analytic position/speed curve
radial, tangent, flight-direction, dock-axis, and fallback vectors
base orientation, roll/spin, multiplication order, and final orientation
quaternion norm and angular velocity
stage world matrix before/after reparent
detached scalar offsets/velocities
dock port, axis, parallel error, radial error, and snap epsilon
spring target, velocity, stiffness, damping, and terminal lock state
spin rates and accumulated angles
debris inherited tangential/outward/axial velocity
active instance count, dispatch count, workgroup size, storage bytes
node post passes and output transform owner
```

## Validation

Run deterministic replay checks at 30, 60, 120, and 240 Hz presentation rates
against the same fixed simulation step. Include:

```text
hidden-tab resume with clamped delta
terminal pose exactness within position/quaternion epsilon
reparent before/after world-matrix equality
seeded output stability
zero NaNs in radial fallback and quaternion helpers
quaternion norm drift below threshold
storage buffer snapshot for selected frames outside the frame loop
GPU timing for compute dispatches and render pass count
```

Use `$threejs-camera-controls-and-rigs` for camera validation, `$threejs-particles-trails-and-effects`
for effect pooling and plasma/spark systems, and `$threejs-choose-skills` when a
task crosses animation, rendering, geometry, materials, shadows, or post.
