# Precipitation Motion

Use this reference after the skill selects airborne motion, physical
deposition, or impact generation.

## Contents

- Branch selection
- Time, units, and spaces
- Analytic motion
- Recurrent motion in Three.js r185
- Stable visual domains
- Deposition and impact conservation
- Dispatch order and lifecycle
- Performance and diagnostics

## Branch selection

Choose the least stateful branch that reproduces the requested cause:

| Required behavior | Representation | Persistent per-particle state |
| --- | --- | --- |
| Constant fall and constant wind | Analytic trajectory from immutable seed and time | None |
| Time-varying wind with a known integral | Analytic trajectory from immutable seed and integrated displacement | None |
| Spatial turbulence, collisions, feedback, or path history | Recurrent GPU storage | Position, velocity, lifetime, flags as required |
| Sparse close impacts | Stable impact cells or bounded event pool | Events and touched receiver tiles |
| Persistent deposition | Receiver-owned field | Liquid/snow inventory, not visual particle state |

Analytic motion removes a simulation dispatch and hot particle-buffer writes.
Recurrent state earns its traffic only when the next state depends on the
previous state. A sparse CPU-authored dirty range can remain cheaper than a GPU
solver when event count is low and branchy; measure the crossover on the named
target.

## Time, units, and spaces

Use one monotonic sample time `t` and one update interval `dt`, both in seconds.
Keep wind and fall velocity in metres per second until the declared
world-to-render projection. Keep these spaces distinct:

| Space | Meaning |
| --- | --- |
| Seed | Immutable normalized spawn coordinates, phase, size, and variant |
| Stable world cell | Persistent identity used for phase, trajectory, impacts, and deposition |
| Streamed visual volume | Camera-centred set of visible stable cells |
| Receiver | World-anchored physical support with area/Jacobian and surface frame |
| Model | Object-locked snow coverage coordinates |
| View | Projection, depth, and presentation only |

Record the time/wind producer version used by each advance. A suspended system
chooses one explicit policy: freeze time, analytically integrate the complete
elapsed interval, or advance recurrent state with bounded substeps while
recording discarded debt. Advancing the clock while silently clamping `dt`
loses deposition and breaks replay.

If a physically interpreted terminal speed is required, name the drag model
and inputs. Quadratic drag gives

```text
v_terminal = sqrt(2 m g / (rho_air C_D A))
```

where `m` is particle mass, `rho_air` is air density, `C_D` is drag
coefficient, and `A` is projected area. Drops and snow aggregates have
shape/Reynolds-dependent drag, so an authored speed is a model parameter unless
those inputs are supplied.

## Analytic motion

For an immutable seed at `x0`, constant fall velocity `v_fall`, and air
velocity `u_air(t)`, evaluate

```text
x(t) = x0 + v_fall * t + integral_0^t u_air(tau) d tau
```

Constant wind reduces the integral to `u_air * t`. For authored periodic wind,
use its analytic antiderivative or accumulate displacement with the same clock
that owns the forcing. `u_air(t_now) * t_now` changes the entire historical
trajectory when the current wind changes and produces a visible teleport.

Hash seed, phase, and lifetime from stable integer world-cell coordinates plus
an instance lane. Stream only the set of cells around the camera. When a
particle wraps vertically or repeats by lifetime, derive the next stable cycle
from its world-cell identity and integer cycle index. Camera movement then
changes membership without changing a surviving cell's phase.

Analytic motion is complete when a fixed seed/cell/time tuple reproduces the
same position and moving the camera preserves every surviving tuple.

## Recurrent motion in Three.js r185

Use `instancedArray()` or storage over `StorageBufferAttribute` /
`StorageInstancedBufferAttribute`. Pack only fields read by the solver or draw;
a common layout is `positionLife`, `velocityLife`, and `seedFlags`.

```js
import { Fn, instanceIndex, instancedArray, uniform, vec4 } from 'three/tsl';

const positions = instancedArray(capacity, 'vec4');
const velocities = instancedArray(capacity, 'vec4');
const dt = uniform(0);

const advance = Fn(() => {
  const i = instanceIndex;
  const p = positions.element(i);
  const v = velocities.element(i);
  p.assign(vec4(p.xyz.add(v.xyz.mul(dt)), p.w.add(dt)));
})().compute(capacity, [64]);

renderer.compute(advance);
```

The snippet shows the writable-node shape, not a complete solver. A complete
recurrent branch names its force law, integrator, collision support, extent
policy, lifecycle transition, and stability bound. Supply `dt` from the owning
update interval. Treat r185 `computeAsync()` as initialization/enqueue
convenience; use explicit queue/pass dependencies or a documented readback
completion when host-visible results are genuinely required.

Recurrent motion is complete when every stored field affects a requested
observable or lifecycle rule, the integrator stays within its declared
stability range, and replay from identical seed/state/forcing is deterministic.

## Stable visual domains

Use one of two domain contracts:

- **Unbounded visual weather:** stream stable world cells around the camera.
  The visual boundary follows the camera, while cell identity, motion phase,
  and receiver contacts remain world-stable.
- **Localized weather:** keep a bounded volume fixed in world space and model
  its edge with a physical occluder, falloff, or authored front.

The impact/deposition domain is separate from the visual volume in both
branches. A camera-wrapped particle may contribute appearance, while stable
receiver quadrature or a causal world impact contributes mass and momentum.
This separation makes camera motion and visual density valid negative controls.

## Deposition and impact conservation

Publish rain/snow forcing as mass-area flux `F_i` in `kg m^-2 s^-1`. At
receiver quadrature points with physical-area weights `A_i` in `m^2`, integrate
with the physical-area formula in the skill. Each `A_i` includes the surface
chart Jacobian. Equal weights are valid only
for a proven uniform area measure and integrand. A unit-sum normalized kernel
has a different meaning: it distributes one already-extensive transfer over
area. Convert an external water-equivalent depth rate only through its named
reference density, `massFlux = rho_reference * depthRate`; project a volume
source through its physical support and Jacobian before calling it an area
flux. Select one representation:

- **Rate:** flux/traction over a stated interval; integrate each disjoint
  subinterval once.
- **Interval integral:** mass and impulse already integrated over a stated
  interval; partition across substeps or impacts so all partitions sum to one
  application of the parent.

Momentum flux/traction has units `N m^-2 = Pa`; an interval impact carries
impulse in `N s`. The receiving domain maps vertical impact momentum to its
own pressure, splash, turbulence, or rejection term rather than silently
inserting it into an unrelated horizontal momentum equation.

When sparse impacts stand in for the integrated parent transfer, assign each a
stable identity, receiver, interval, mass, impulse, and partition weight. Their
mass and impulse sums close the parent within the declared residual. Capacity
overflow reports lost or deferred mass/momentum explicitly. A visual splash
references an impact but does not deposit a second copy.

One-way deposition is the default when the weather source does not model
reaction. When two-way reaction is required, publish an explicit equal-and-
opposite impulse to the named source/atmosphere owner in the same interval;
mass still moves with a nonnegative quantity from source to receiver.

After changing the transfer representation, rerun the visual-count and
receiver-cadence invariance controls from the build sequence.

## Dispatch order and lifecycle

Use separate ordered whole-grid stages as needed:

```text
advance solver
  -> classify collisions
  -> count/bin impacts
  -> scan/compact
  -> scatter events or write indirect arguments
  -> integrate touched receiver tiles
```

A workgroup barrier synchronizes threads in one workgroup. A later dispatch or
pass dependency makes whole-grid writes visible to the next stage. Keep
authoritative state resident across these stages; frame-critical host readback
adds a queue stall and needs an explicit reason.

Preserve stable cell/event identities across visual tier changes. On a causal
model or receiver-support change, reset or conservatively remap recurrent
state, impact cursors, and pending transfer; label the transition so old and
new generations are not blended as one history. Resize allocates a new
generation before retiring the old one after its final consumer. Disposal
releases storage, indirect/count buffers, transient targets, materials, and
pipeline nodes owned by the branch.

## Performance and diagnostics

Measure the selected branch rather than a fixed particle target. Record:

```text
visible instances; covered pixels; mean/max transparent layers per pixel;
solver kind; persistent and transient bytes; bytes written per frame;
dispatches; collision candidates; accepted/overflow impacts; touched tiles;
full-frame and paired weather-on/off CPU/GPU p50/p95
```

Expected scaling:

- analytic visual weather scales with visible instances and overdraw, with no
  recurrent particle write;
- recurrent weather scales with active state and solver/collision traffic;
- sparse impacts scale with candidates, accepted events, and touched tiles;
- receiver cost scales with updated support and cadence, not screen density.

Expose diagnostics for time/wind versions, stable cell IDs, analytic/recurrent
selection, stored state, collision candidates, impact partitions, parent
integrals, overflow, and receiver cadence.
