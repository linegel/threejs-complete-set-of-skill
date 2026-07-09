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
- Water-surface, current, and floating-body coupling
- Peeling and released debris
- Quaternion frame contracts
- Animation clip interop
- Color, post, and output
- Budgets
- Replaced techniques
- Failure modes and diagnostics
- Validation

## Architecture contract

Select the time model first:

```text
closed-form / seekable motion -> sample authoritative time directly
event-driven analytic phases -> direct curves + discrete event log
ODE / constraints / collision -> fixed-step state + interpolated presentation
perceptual follow only -> dt-correct exponential response at presentation time
```

Fixed stepping adds state, dispatches, and one-step presentation latency. Use
it only when the next state depends on the previous state; a closed-form
timeline sampled through a fixed-step accumulator is more work and less
seekable than direct evaluation.

For closed-form segments, choose interpolation from boundary conditions:

| Contract | Representation |
| --- | --- |
| prescribed endpoint position and velocity | cubic Hermite |
| rest-to-rest C2 position/acceleration continuity | quintic/minimum-jerk |
| constant speed on a curved path | arc-length table plus monotone inversion, with table error gated |
| constant angular speed between orientations | quaternion `slerp` with shortest/declared long arc |
| C1 multi-key orientation | `squad` with sign-continuous controls |
| physically coupled rotation and translation | screw/SE(3) interpolation with an explicit frame convention |

The complete architecture is:

```text
WebGPURenderer + THREE.Timer + renderer.setAnimationLoop()
+ direct analytic transform timelines for authored motion
+ fixed-step accumulation only for recurrent deterministic state
+ pow(k, dt) smoothing for perceptual response
+ instanced node attributes or compute-updated storage buffers at scale
+ explicit quaternion frame contracts
```

Use `Object3D` transforms for a small number of heterogeneous semantic objects. When
counts grow, keep authoring state in arrays/storage and render it with
`InstancedMesh`, `BatchedMesh`, or storage-driven nodes. Thousands of per-object
updates are a CPU scene-graph problem, not a procedural animation feature.
Use `InstancedMesh` for identical topology. r185 WebGPU submits one backend
draw item per visible `BatchedMesh` multi-draw entry, so BatchedMesh may reduce
object/state-management cost but is not an instanced one-draw bucket.

## Renderer loop and delta policy

Create one animation loop and one timing policy. The following loop is the
recurrent-simulation branch; analytic objects are sampled once from the same
authoritative `policy.timelineTime` outside the fixed-step loop:

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
  timelineTime: 0,
  wallTime: 0,
  droppedTime: 0
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
  policy.wallTime += rawDelta;
  policy.accumulator += clampedDelta;

  let substeps = 0;
  const firstGpuStepTime = policy.simulationTime + policy.fixedStep;
  while ( policy.accumulator >= policy.fixedStep && substeps < policy.maxSubsteps ) {
    copyProceduralState( fixedState.previous, fixedState.current );
    stepProceduralAnimation( fixedState.current, policy.fixedStep, policy.simulationTime + policy.fixedStep );
    policy.simulationTime += policy.fixedStep;
    policy.accumulator -= policy.fixedStep;
    substeps ++;
  }

  if ( substeps > 0 ) {
    submitGpuSteps( policy.fixedStep, firstGpuStepTime, substeps );
  }

  if ( substeps === policy.maxSubsteps && policy.accumulator >= policy.fixedStep ) {
    policy.droppedTime += policy.accumulator;
    policy.accumulator = 0;
  }

  const alpha = policy.accumulator / policy.fixedStep;
  // previous is at simulationTime-fixedStep and current is at simulationTime.
  // Couple analytic motion to the same deliberately one-step-late presentation.
  policy.timelineTime = Math.max(
    0,
    policy.simulationTime - policy.fixedStep + policy.accumulator
  );
  interpolateProceduralState( fixedState.render, fixedState.previous, fixedState.current, alpha );
  sampleAnalyticMotion( policy.timelineTime );
  renderProceduralFrame( fixedState.render, alpha );
} );
```

The policy owns raw delta, clamped delta, fixed step, max substeps, simulation
time, authoritative timeline time, wall telemetry, replay time, and pause/resume behavior. The
spiral-of-death clamp is Gated by `maxSubsteps`; when the gate is hit, discard
the remainder and record the drop for diagnostics instead of executing an
unbounded backlog. Mixers,
compute dispatches, springs, and presentation-only effects consume this policy
rather than sampling their own clocks. If a product chooses analytic catch-up
instead of dropped time, recurrent systems must be resynchronized by an exact
state transition or bounded backlog before analytic motion samples wall time;
never let analytic and recurrent paths silently diverge after a clamp.

## Capability gate and quality tiers

Use `WebGPURenderer` everywhere and gate only the quality tier. Explicit
compatibility strategy requests route to `../threejs-compatibility-fallbacks/`;
this flagship reference keeps one architecture:

```js
await renderer.init();
if ( renderer.backend.isWebGPUBackend !== true ) {
  throw new Error(
    'WebGPU is required for the canonical procedural-motion path; explicit fallback teaching belongs to threejs-compatibility-fallbacks.'
  );
}
```

Do not write a parallel renderer implementation in this skill.

Full tier uses compute/storage when recurrent state needs it. Balanced and
minimum tiers reduce active recurrent counts and update frequency; analytic
motion remains directly sampled. Compatibility strategy details belong in the
compatibility-fallbacks skill.

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
sceneUnits = meters * sceneUnitsPerMeter
# equivalently: sceneUnits = meters / metersPerSceneUnit
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

Use explicit persistent state. For a few semantic objects this can live in TypeScript:

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
  springOmega, springPhase, springAmplitude, springZeta
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
const anchorScale = new THREE.StorageBufferAttribute( instanceCount, 4 );
const springParams = new THREE.StorageBufferAttribute( instanceCount, 4 );

const previousPoseNode = storage( previousPose, 'vec4', instanceCount );
const currentPoseNode = storage( currentPose, 'vec4', instanceCount );
const velocityNode = storage( velocityState, 'vec4', instanceCount );
const anchorNode = storage( anchorScale, 'vec4', instanceCount );
const springNode = storage( springParams, 'vec4', instanceCount );
const fixedStep = uniform( 1 / 120 );
const simTime = uniform( 0 );
const alpha = uniform( 0 );

const integratePose = Fn( ( { previousPose, currentPose, velocity, anchorScale, springParams } ) => {
  const i = instanceIndex;
  const current = currentPose.element( i );
  const v = velocity.element( i );
  const anchor = anchorScale.element( i );
  const spring = springParams.element( i );
  const omega = spring.x;
  const phase = spring.y;
  const amplitude = spring.z;
  const zeta = spring.w;
  const target = anchor.xyz.add(
    vec3( 0, omega.mul( simTime ).add( phase ).sin().mul( amplitude ), 0 )
  );
  const acceleration = target.sub( current.xyz ).mul( omega.mul( omega ) )
    .sub( v.xyz.mul( zeta.mul( omega ).mul( 2 ) ) );
  const nextVelocity = v.xyz.add( acceleration.mul( fixedStep ) );

  previousPose.element( i ).assign( current );
  currentPose.element( i ).assign( vec4( current.xyz.add( nextVelocity.mul( fixedStep ) ), current.w ) );
  velocity.element( i ).assign( vec4( nextVelocity, v.w ) );
} )( { previousPose: previousPoseNode, currentPose: currentPoseNode, velocity: velocityNode, anchorScale: anchorNode, springParams: springNode } )
  .compute( instanceCount, [ 64 ] )
  .setName( 'motion:integrate-instance-spring' );

material.positionNode = positionLocal.add(
  mix(
    previousPoseNode.element( instanceIndex ).xyz,
    currentPoseNode.element( instanceIndex ).xyz,
    alpha
  )
);

function submitGpuSteps( dt: number, firstTime: number, stepCount: number ) {
  fixedStep.value = dt;
  simTime.value = firstTime;
  pendingStepCount.value = stepCount;

  // integratePoseBatch uses a per-invocation TSL Loop to advance exactly
  // stepCount independent fixed steps and retain the final previous/current
  // pair. Global collision/constraint stages instead require their ordered
  // dispatch graph once per step; workgroup barriers are not global barriers.
  renderer.compute(
    dependencyClass === 'independent'
      ? integratePoseBatch
      : orderedGlobalStagesForEachStep
  );
}

function renderGpuAnimation( presentationAlpha: number ) {
  alpha.value = presentationAlpha;
  renderPipeline.render();
}
```

`orderedGlobalStagesForEachStep` above denotes a CPU-built node array with the
required stage sequence repeated per step, not one shader with a fictitious
global barrier. Record fixed steps advanced, compute submissions, dispatches,
and hot bytes separately. Fusing independent catch-up steps is a command/
traffic candidate and must pass the same convergence and presentation gates.

Derived/Gated labels for the snippet: `instanceCount` is Derived from visible
actor count and LOD; `fixedStep` is Derived from the delta policy; workgroup
size `64` is an authored starting point, not a portable optimum — adapter
limits, register pressure, memory access, and measured occupancy select the
target value. `springParams={omega,phase,amplitude,zeta}` is separate from
`anchorScale`; require `omega>0`, `zeta>=0`, and derive the fixed step from a
stability analysis plus step-halving convergence over the authored parameter
envelope. The semi-implicit snippet is a recurrent demonstrator, not an exact
spring solver.

Simple analytic timelines evaluate directly in CPU transforms or vertex TSL
with zero simulation dispatch. Materialize them in compute only when multiple
downstream consumers reuse the result and a paired A/B proves the write traffic
is cheaper. Recurrent integration, compaction, and bounds are separate ordered
dispatches when their dependencies are global. Avoid readback in the frame
loop. In r185 `computeAsync()` only awaits renderer initialization before
enqueueing compute; an async readback/map operation is required for CPU-visible
GPU completion.

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
and speed remain continuous across ascent phases. Select it for authored launch
when its exact, seekable, deterministic piecewise curve satisfies the declared
acceleration and jerk gates more cheaply than a recurrent solver.

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

Example **Authored** preset constants:

```text
target altitude = 420 km converted through sceneUnitsPerMeter
max ground arc = 2200 km converted through sceneUnitsPerMeter
max crossrange = 26 km converted through sceneUnitsPerMeter
```

Declare one unit contract:

```text
sceneUnits = meters * sceneUnitsPerMeter
# or sceneUnits = meters / metersPerSceneUnit
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
velocity = planetCenterVelocity
         + altitudeDot * radial
         + (planetRadius + altitude) * arcAngleDot * tangent
         + crossrangeDot * xHat
flightDirection = normalizeOrFallback(velocity, previousFlightDirection)
base = fromUnitVectorsSafe(rocketLocalUp, flightDirection)
roll = rotationAroundUnitAxis(flightDirection, rollAmount)
orientation = base then roll in the model's local contract
```

Differentiate the actual authored trajectory; a radial/tangent lerp is not its
velocity and can point visibly off-path. If an independent pitch program is
intentional, name it separately and gate its angle from velocity. This
separates trajectory direction from authored roll/vibration. Verify the model
axis contract before choosing multiplication order.

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
M_local_new = inverse(M_world_newParent) * M_world_old
assign M_local_new under an explicit matrix/TRS policy
```

`Object3D.attach()` is acceptable only when the hierarchy has no non-uniform
scale. Decompose `M_local_new` only when it is representable as TRS within a
declared residual. Non-uniform ancestry can introduce shear; then retain the
full local matrix with `matrixAutoUpdate=false`, bake the affine transform into
geometry/another wrapper, or reject the handoff. Assigning the old world matrix
as new local state is wrong for a non-identity parent.

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

## Water-surface, current, and floating-body coupling

Water is an injected causal system, not a transform curve. The water owner
publishes a sample with named spaces, units, time, validity, version, and error:

```text
sampleWaterState(worldPoint, timeSeconds, footprint) -> {
  freeSurfacePoint,
  freeSurfaceNormal,
  surfacePointVelocity,
  materialCurrentVelocity,
  waterColumnDepth,
  densityOrNotUsed,
  frameId,
  validity,
  spatialTemporalError,
  representedFootprint,
  fieldVersion
}
```

`surfacePointVelocity` is the time derivative of the geometric surface sample.
`materialCurrentVelocity` is fluid transport. Phase velocity, group velocity,
Stokes drift, Eulerian current, and `partial(eta)/partial(t)` are different
quantities; the provider states which it supplies. Immersion/heave may consume
the geometric surface rate, while drag consumes material-relative velocity.
An unlabelled `velocity` is rejected.

The footprint is the actor/hull response scale, not a shading-texel footprint.
A point-sampled micro-normal can roll a large boat on capillary detail that
should average out. The provider returns a footprint-filtered state or the
motion system integrates a declared distributed sample set; neither consumes a
material normal or foam texture as geometry.

Choose the cheapest coupling class that satisfies the observable:

| Required behavior | Motion route | Water feedback |
| --- | --- | --- |
| kinematic boat/buoy presentation | sample height/normal, evaluate authored heave/roll response around a scripted horizontal path | none; one-way and explicitly nonphysical |
| passive floating actor with visible inertia/current drift | fixed-step rigid pose with distributed buoyancy/drag samples; refine sample layout until pose/force error passes | none; the prescribed water is unchanged |
| visible displacement, object-generated waves, or load-dependent wake | coupled water/body solver with ordered load scatter, water advance, and body correction | two-way; equal-and-opposite source terms and conservation/error ledger required |
| metric hull loads, slamming, planing, added mass, radiation/diffraction, or control design | dedicated hydrodynamics/FSI solver | outside this motion skill; consume timestamped pose/load data |

For the one-way dynamic middle tier, a distributed hydrostatic approximation
can partition the hull into quadrature cells. For cell `i`, compute signed
immersion along the effective-gravity up direction, evaluate a prevalidated
submerged-volume function `V_i(d_i)`, and place that volume at a corresponding
submerged centroid `x_b,i(d_i)`. Then, under the declared gravity frame,

```text
g_up = -g / |g|
d_i = dot(freeSurfacePoint_i - x_i, g_up)
F_b,i = rho * |g| * V_i(d_i) * g_up
v_body,i = v_com + omega_body cross (x_i - x_com)
v_rel,i = v_body,i - materialCurrentVelocity_i
F_d,i = -0.5 * rho * C_d,i * A_i * |v_rel,i| * v_rel,i
tau_i = (x_b,i - x_com) cross F_b,i
      + (x_i - x_com) cross F_d,i
```

This is an authored quadrature/drag model, not a general wave-body solution.
`V_i`, `A_i`, and `C_d,i` carry units and are calibrated or derived from the
hull partition; `area * penetration` is accepted only when its volume error is
gated. Integrate translation and rotation at a fixed step, normalize
quaternions, and run step-halving plus quadrature-refinement sweeps. Do not use
surface-point velocity as current in the drag term. A simpler critically damped
heave/normal-follow response is presentation-authored and must not be reported
as buoyancy physics. Wave radiation/diffraction, slamming, and dynamic pressure
are absent from this hydrostatic model and route to the final row of the table.

Two-way coupling is a single ordered simulation graph. A valid partitioned
schedule names, for each fixed step, whether it performs body prediction,
water sampling, load/volume/impulse scatter, water advance, and body correction,
and whether those stages are explicit, semi-implicit, or iterated. The water
receives the negative of the actor impulse/source under the same units and
frame; momentum/volume residual and coupling-iteration error are reported.
Workgroup barriers do not order global water and body stages. Use dispatch/pass
boundaries and ping-pong state. If one system is CPU-owned and the other
GPU-owned, do not insert synchronous frame-loop readback; move the coupled hot
state to one side, use a shared analytic mirror where valid, or declare a
latency model whose phase/error gate passes.

Wake ownership follows physics ownership. A foam ribbon or particle trail may
visualize a one-way kinematic wake, but it cannot be cited as displaced water or
two-way momentum exchange. When the water solver accepts wake/vorticity/height
sources, the water skill owns their discretization, stability, wet/dry masking,
and history; motion supplies timestamped hull/source records only.

Validation includes flat-water equilibrium, phase-locked monochromatic waves,
constant-current drift, asymmetric hull torque, surface-normal discontinuities,
water-field version changes, fixed-step convergence, and provider-error
propagation. One-way tests assert that actor motion leaves water state bitwise or
tolerance-equivalent. Two-way tests gate equal-and-opposite impulse, volume/mass
balance appropriate to the selected solver, wake causality, coupling stability,
and deterministic replay. Record zero frame-critical GPU readbacks.

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

The router allocates a marginal motion ceiling from the complete frame. Record
p50/p95 CPU update and GPU dispatch time, simulation rate, dropped time, and
presentation error on each target. A subsystem-local timing is not an
automatic low-power allowance; it must fit the declared refresh budget.

Routing evidence:

```text
semantic transforms: active count, hierarchy depth, changed matrices, upload bytes
instanced fields: one draw per identical-topology/material spatial page after culling
BatchedMesh fields: visible multi-draw entries and backend draw items measured separately
compute motion: named dispatch stages and invocations derived from active recurrent state
workgroup size: target-tuned with occupancy and timing evidence
hot state: active capacity * aligned dynamic stride + history/scan slots
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
- Water coupling must declare one-way or two-way. A visual wake, height-follow
  spring, or actor-side ripple does not prove fluid feedback.
- Surface-point velocity and material current must remain separate; conflating
  them injects wave phase motion into drag and produces nonphysical drift.

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
water provider version/error, free-surface point/normal/rate, material current
water coupling class, sample/quadrature residual, actor loads and reaction sources
two-way stage order, impulse/volume residual, coupling iterations, and readback count
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
one-way water invariance or two-way impulse/volume/coupling-convergence evidence
water-query phase/current separation and zero frame-critical readback
```

Use `$threejs-camera-controls-and-rigs` for camera validation, `$threejs-particles-trails-and-effects`
for effect pooling and plasma/spark systems, and `$threejs-choose-skills` when a
task crosses animation, rendering, geometry, materials, shadows, or post.
