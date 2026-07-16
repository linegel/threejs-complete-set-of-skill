# Solver Selection and Architecture

Select the smallest mechanism that satisfies the observable. Freeze its units,
frames, time interval, supported interactions, error limits, target device, and
failure behavior before choosing an engine.

## Solver boundaries

| Family | Use when | Boundary |
| --- | --- | --- |
| Analytic or query-only | The result is a ray, overlap, distance, sweep, or field sample. | No integrated physical state or impulse response. |
| Authored kinematic | Motion is directed and force response is outside the observable. | Contacts are queries or explicitly bounded authored reactions. |
| Local CPU solver | General rigid contact and constraints have host-side consumers. | GPU coupling must tolerate upload or delayed diagnostic readback. |
| GPU specialist | A bounded equation and its consumers are GPU-resident. | The implementation owns scans, barriers, capacity, recovery, and numerical validation. |
| External solver | Mature collision, joints, vehicles, soft bodies, or another authority is required. | One adapter owns conversion, synchronization, completion, recovery, and version compatibility. |
| Offline recording | Live response is unnecessary. | Interpolation and compression error remain inside the observable's limits. |

Body count alone does not select a family. Use the worst relevant contact
island, shape population, motion, coupling, memory, synchronization tail, and
sustained target cost.

## Representation boundaries

Keep each representation independent even when several derive from one source:

| Representation | Owns |
| --- | --- |
| Render surface | Appearance, shading topology, and visual LOD. |
| Query proxy | Rays, overlaps, closest points, sweeps, or field samples. |
| Collider | Exclusion geometry, filtering, material law, and feature identity. |
| Support surface | Placement or locomotion height/point, normal, surface velocity, validity interval, and approximation error. |
| Integration model | Mass, center of mass, inertia, generalized coordinates, and state equations. |

Primitive and convex proxies suit moving contact when their approximation error
is acceptable. Convex compounds preserve bounded concavity at additional pair
cost. Triangle meshes normally serve static or chunk-stable geometry. A field
or SDF is suitable only where distance, gradient, support, update, and filtering
errors are declared. Visual LOD may change without changing physical identity.

Keep collider, entity, shape, feature, and material identities stable across
batching, compaction, sleeping, and LOD. Physical density, friction,
restitution, compliance, and filters belong to the physical model rather than
the render material.

## Contact versus support

A support query answers where a surface is, how it moves, when the sample is
valid, and how wrong it may be. It can drive placement, foot targets, suspension
queries, or authored locomotion without creating a collision response.

A contact owns a body pair, signed separation or time of impact, normal,
contact points and feature identities, material law, begin/persist/end
lifecycle, and the reaction applied to the state equations. Broadphase overlap
is only a contact candidate. Source geometry may be shared while each consumer
keeps its own semantics.

## Algorithm boundaries

- **Broadphase:** use bounded all-pairs for genuinely small sets,
  sweep-and-prune for coherent separation, trees for sparse incremental worlds,
  grids for bounded local sizes, and LBVH/Morton rebuilds for parallel dense
  populations. Swept bounds must retain every required pair over the interval.
- **Narrowphase:** use analytic pairs, SAT, GJK with a separate penetration
  method, mesh-BVH traversal, or field contact according to supported shapes.
  Declare degeneracy, iteration, tolerance, and unsupported-pair behavior.
- **Continuous collision:** select swept analytic tests, conservative
  advancement, continuous SAT, speculative contact, or bounded substeps from
  motion and feature size. Substeps alone are not general CCD.
- **Constraints:** select sequential impulses, temporal refinement, XPBD,
  direct small-system solves, or an external owner from graph topology, mass
  ratios, compliance, stacking, loops, and residual limits.

Sleeping is a state transition. Its quiet threshold, residence time, wake
sources, island propagation, identity continuity, and deterministic ordering
must be explicit. Base it on physical signals independent of camera visibility.

## Residency, coupling, and evidence

Keep authoritative state near its frame-critical consumers. A CPU/GPU or
external boundary must name the producer, consumer, interval, ownership
transfer, completion condition, and stale-data behavior. Keep the
frame-critical GPU path resident and use delayed readback for diagnostics.

One-way coupling is valid only when omitted reaction is bounded. Two-way
coupling applies source and reaction over the same interval and commits both or
neither. Iterated coupling must have a fixed convergence and failure bound.

Accept a route only after the evidence that matters to its branch is direct:
query oracles for query providers, pair-completeness tests for broadphases,
degenerate and analytic cases for narrowphases, thin-feature crossings for CCD,
residual and energy checks for constraints, lifecycle checks for contacts, and
sustained end-to-end measurements for residency decisions.
