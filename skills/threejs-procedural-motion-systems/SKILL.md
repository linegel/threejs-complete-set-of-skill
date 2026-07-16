---
name: threejs-procedural-motion-systems
description: Animate semantic state with deterministic Three.js WebGPU/TSL motion. Use for launch or staging kinematics, seekable transform timelines, recurrent fixed-step motion, frame-rate-independent follow, GPU-resident instance motion, moving-frame docking or reparenting, and environment-driven actors.
---

# Procedural Motion Systems

Semantic state is the source of truth; transforms are its presentation. Keep one
writer for each position, orientation, velocity, phase, and event channel.

## Process

### 1. Declare state and its writer

Name the observable motion, SI units, coordinate frame, stable actor identity,
initial state, phase/event state, and duration contract: finite with a terminal
pose plus velocity/hand-off rule, periodic with a wrap rule, or open-ended with
a stop/reset policy. Assign one writer to every animated channel; clips,
procedural roots, instance storage, camera rigs, and external solvers may own
different channels only through an explicit layering order.

When another simulation supplies or reacts to motion, declare:

- exchanged quantities, units, frame/origin, state owner, producer, consumers,
  version, and publication order;
- timestamp or half-open interval, cadence, sample phase, interpolation or
  extrapolation, and discontinuity behavior;
- support/filter, validity, staleness, error bound, and missing-value behavior;
- rate versus interval-integrated semantics and one-way or two-way reaction
  ownership and order;
- GPU producer/consumer passes, resource generation, queue order, and actual
  completion evidence;
- immutable previous/current committed samples, stable identity, and reset,
  reuse, retirement, and disposal rules.

Keep frame-critical state on its owning device; schedule diagnostic readback
asynchronously outside state advance and presentation.

**Complete when:** every animated channel has exactly one writer, one frame and
unit convention, one stable identity, and a defined initial state plus finite,
periodic, or open-ended duration contract; every cross-system boundary closes
every applicable declaration above.

### 2. Choose the time model and representation

Choose by state dependence first, then actor count:

| Motion | Time model | Representation |
| --- | --- | --- |
| Seekable authored transform | closed form at authoritative seconds | `Object3D` for a few actors; vertex TSL for many |
| Phased authored sequence | closed form plus discrete event state | phase-local time and a replayable event log |
| Spring, constraint, collision, or other recurrent state | fixed step with previous/current state | CPU arrays or GPU storage selected by measured crossover |
| Perceptual follow | `dt`-correct exponential response | render-time state, explicitly non-physical |

Use `InstancedMesh` for repeated identical topology. Use `BatchedMesh` for
varied topology with compatible material state. Use storage and compute only
when the measured CPU traversal/upload crossover is passed.

The canonical path initializes `WebGPURenderer` from `three/webgpu` with
`await renderer.init()` and verifies `renderer.backend.isWebGPUBackend === true`.

**Complete when:** each motion branch has one time model and one representation,
and each GPU route states the measured workload threshold that justifies it.

### 3. Make time deterministic

Sample analytic motion directly from authoritative elapsed seconds. Advance
recurrent state by a fixed step, retain immutable previous/current states, and
move every complete unprocessed step into separate debt state so
`0 <= accumulator < fixedStep` before presenting with
`alpha = accumulator / fixedStep`. Define raw-delta clamping, maximum substeps,
debt handling, pause/resume, and replay behavior once for the whole motion
owner. A debt drop or scheduled catch-up and a discontinuity reset are separate
decisions. Coupled state advances on its simulation owner's cadence, not the
render callback's cadence.

For perceptual follow, declare the target as a continuous function integrated
over the interval, a timestamped zero-order hold, or timestamped interpolated
samples. Apply changes at their timestamps; presentation cadence never changes
the underlying target signal.

Use stored seeds, counters, and one-shot event flags. A direct seek reconstructs
the same phase and event state as replay to that time. `AnimationMixer` either
updates at the fixed step or uses `setTime()` for seeking; it does not sample an
independent clock.

**Complete when:** analytic and recurrent clocks cannot diverge after a stall,
the interpolation pair brackets presentation time with a bounded accumulator,
debt and reset decisions are independently observable, and identical initial
state plus every applicable seed, fixed step, event schedule, and target signal
reproduce the same matched-time state at every tested presentation cadence.

### 4. Implement frame-safe transforms

Name source and destination frames for every position, direction, velocity, and
quaternion. Normalize axes, handle parallel and antiparallel vector alignment,
canonicalize quaternion signs before interpolation, state multiplication order,
and normalize accumulated rotations.

Preserve world pose during reparenting with
`M_local_new = inverse(M_world_newParent) * M_world_old`. Decompose to TRS only
when the residual passes; retain an affine matrix or wrapper when non-uniform
ancestry creates shear. Released children inherit moving-frame velocity,
including `omega cross r` for a rotating parent. Docking error is decomposed in
the current docking frame, not a stale world frame.

**Complete when:** every transform has a declared frame chain and quaternion
order, reparenting preserves the world matrix within tolerance, zero/antiparallel
inputs stay finite, and moving-frame release includes all transport terms.

### 5. Publish, reset, and dispose

Publish immutable previous/current pose generations with stable actor identity;
derive render pose, motion vectors, bounds, shadows, and temporal consumers from
that same pair. A cut, teleport, spawn/despawn, reparent, topology or deformation
change, LOD/quality change, storage-slot reuse, or identity change starts a new
validity epoch and resets the affected history instead of deriving an extreme
velocity.

Reset phase timestamps, accumulator and debt records, seed counters, event
flags, finite terminal locks, and previous/current buffers together only for a
semantic motion reset. A camera cut or other temporal-only reset clears the
affected presentation history without restarting semantic motion. Disposal
releases storage, compute resources, readback staging, listeners, timers, and
the renderer loop owned by the system.

**Complete when:** every discontinuity selects preserve, migrate, or reset for
each history consumer; temporal-only resets preserve semantic state; semantic
resets restore the declared initial state atomically; no old identity can
observe a reused slot; disposal leaves no live owner, listener, buffer, or
animation loop.

### 6. Verify the invariants

For each selected branch, run only its applicable checks. Analytic motion
compares direct seek with replay at 30, 60, 120, and 240 Hz presentation.
Recurrent motion holds one fixed-step schedule across those presentation rates
and passes step-halving. Perceptual follow consumes one timestamped or
analytically integrated target signal and compares shared wall-time checkpoints.
Finite motion reaches its exact terminal pose and declared velocity or hand-off;
only a terminal lock requires zero residual velocity. Periodic and open-ended
motion verify their declared wrap or stop/reset transition.

Where selected, also check quaternion norm and sign continuity, world-matrix
equality across reparenting, stable instance identity, and reset behavior for
every discontinuity. GPU motion records dispatches, hot bytes, p50/p95 time, and
zero frame-critical readbacks. Node post proves one presentation/output owner.

**Complete when:** every selected branch passes its cadence, ownership, frame,
reset, lifecycle, and visible-failure checks, with thresholds and target hardware
recorded where performance claims are made.

## Conditional references

- For analytic interpolation, phase events, launch paths, detachment, or debris,
  read [Analytic phases, launch, and stage release](references/procedural-motion-and-docking-systems.md#analytic-phases-launch-and-stage-release).
- For recurrent timing, springs, replay, `AnimationMixer`, or terminal locks,
  read [Time and state models](references/procedural-motion-and-docking-systems.md#time-and-state-models).
- For `InstancedMesh`, `BatchedMesh`, storage attributes, TSL compute, or GPU
  completion, read [r185 representation and GPU residency](references/procedural-motion-and-docking-systems.md#r185-representation-and-gpu-residency).
- For docking frames, quaternion order, reparenting, or rotating-parent release,
  read [Moving frames, docking, and quaternions](references/procedural-motion-and-docking-systems.md#moving-frames-docking-and-quaternions).
- For water-, terrain-, weather-, contact-, or solver-driven actors, read
  [Environment-driven actors](references/procedural-motion-and-docking-systems.md#environment-driven-actors) and apply the handoff requirements in step 1.
- For temporal publication, reset scope, output ownership, disposal, or failure
  diagnosis, read [Presentation, resets, output, and lifecycle](references/procedural-motion-and-docking-systems.md#presentation-resets-output-and-lifecycle) and
  [Failure signatures and verification](references/procedural-motion-and-docking-systems.md#failure-signatures-and-verification).

## Routing boundary

Use `$threejs-camera-controls-and-rigs` for camera motion and handoffs,
`$threejs-particles-trails-and-effects` when pooled effects are the deliverable,
and the relevant water or terrain skill for environment state. Use
`$threejs-choose-skills` when the request spans motion plus rendering, geometry,
materials, shadows, post, or another simulation.
