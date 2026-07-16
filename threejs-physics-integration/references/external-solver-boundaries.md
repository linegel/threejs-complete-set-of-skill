# Frame Transport and External Solver Boundaries

## Moving-frame transport

Let `R^I_F` rotate coordinates from moving frame `F` into inertial frame `I`.
Let `o^I`, `v_o^I`, and `a_o^I` be the position, velocity, and acceleration of
the `F` origin in `I`. Express angular velocity `omega^F` and angular
acceleration `alpha^F` in `F`. For a point with moving-frame position `r^F`,
relative velocity `u^F`, and relative acceleration `a_rel^F`:

```text
x^I = o^I + R^I_F r^F
v^I = v_o^I + R^I_F (u^F + omega^F cross r^F)
a^I = a_o^I + R^I_F (
        a_rel^F
        + 2 omega^F cross u^F
        + alpha^F cross r^F
        + omega^F cross (omega^F cross r^F))
```

The four moving-frame acceleration terms are relative, Coriolis, Euler, and
centrifugal acceleration. If physical force `f^I` is known, solve the relative
equation as:

```text
m a_rel^F = (R^I_F)^T (f^I - m a_o^I)
            - m (2 omega^F cross u^F
                 + alpha^F cross r^F
                 + omega^F cross (omega^F cross r^F))
```

State the transform direction, origin, expression frame, and sample time for
every term. Gravity is a physical force; the other terms above account for the
moving coordinates and enter exactly once.

## SE(3) twists and wrenches

Let `T^A_B = (R, p)` map coordinates from frame `B` to frame `A`, with `p` the
position of the `B` origin from the `A` origin, expressed in `A`. Use twist
ordering `[angular velocity; linear velocity]` and wrench ordering
`[torque; force]`:

```text
omega^A = R omega^B
v^A     = p cross (R omega^B) + R v^B

f^A   = R f^B
tau^A = R tau^B + p cross (R f^B)
```

These are the SE(3) adjoint and coadjoint transforms. They preserve power:

```text
tau^A . omega^A + f^A . v^A
  = tau^B . omega^B + f^B . v^B
```

For a force `f` applied at point `r` relative to a chosen moment origin,
`tau = r cross f`. When shifting that origin from `P` to `Q` in one expression
frame, use `tau_Q = tau_P + (r_P - r_Q) cross f`. Keep polar vectors, axial
vectors, points, normals, twists, and wrenches distinct when changing
handedness or applying scale. Distinguish force and torque rates from
already-integrated linear and angular impulses.

## External authority

An external solver is a library, WASM module, worker, process, service, or
device that owns a state equation or its advancement. Keep its native state
authoritative and translate once at a versioned boundary.

Before integration, assign exactly one owner for each of these responsibilities:

- state advancement and native timestep selection;
- collision detection and contact-manifold lifecycle;
- constraint assembly and solve;
- force, torque, and impulse accumulation;
- commit visibility and failure recovery.

A split responsibility needs one explicit handoff with producer, consumer,
units, frame, interval, sample phase, version, completion condition, and error
or staleness limit. Record the solver/build version and the adapter revision.
Freeze numeric formats, reduction ordering, and every stochastic seed or stream
identity; accept replay only when its declared equivalence gate passes.

Map SI dimensions independently for length, mass, time, force, torque, impulse,
and angular quantities. Map handedness once and apply the correct polar, axial,
twist, and wrench transforms. Map a requested interval to the actual native
steps that cover it. Adaptive stepping reports those intervals through one
authoritative clock mapping.

For each crossing channel, declare direction, physical meaning, rate versus
integral semantics, footprint or support, validity, error, residency, and
reaction scope. Integrate a rate over interval overlap. Apply an impulse once.
When source and reaction are both observable, expose and commit them together
from one accepted step.

## Synchronization and lifecycle

Use this lifecycle for every external authority:

1. Establish the solver identity, transforms, clock map, capabilities, and
   resource generations. The boundary is ready when each required channel has
   one unambiguous mapping.
2. Stage inputs for a named interval after their producer completion. Staging is
   complete when versions and application ranges are frozen.
3. Advance state exactly once and retain the native substep intervals.
   Record submission and consumer-visible completion separately; advance to
   validation only after completion.
4. Validate finite state, constraint/error limits, reactions, and output
   versions. The step is admissible only when every hard limit passes.
5. Commit related state atomically. Rendering consumes immutable previous and
   current committed states with stable entity identity and explicit reset
   markers for spawn, death, teleport, reparent, slot reuse, and discontinuity.
6. Retire resources only after all simulation and render consumers have
   completed. The retired generation must be unreachable from in-flight work.
7. Recover from the last coherent checkpoint and replay unapplied intervals, or
   start a new discontinuity epoch with an explicit reset. Recovery is complete
   when state, identities, event/application cursors, and resource generations
   agree.

Define failure detection and timeout so failure freezes affected commits and
preserves the last coherent presentation until recovery commits a coherent
replacement.

Shared GPU resources still require device identity, access ownership,
subresource layout, acquire/release completion, and loss generation. Keep the
frame-critical path in its consuming residency; use delayed host mirrors for
diagnostics. Measure the full dependency path—conversion, queueing, transport,
solve, completion, validation, and commit—rather than isolated solver time.
