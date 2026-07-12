# External Solver Boundaries

## Contents

- Boundary rule
- Adapter inventory
- Units, frames, and clocks
- Directional capabilities
- Synchronization transports
- Atomic execution and failure
- Recovery
- Cost and evidence

## Boundary rule

An external solver is any library, WASM module, worker, process, service, or
device whose internal state or stepping is not owned by the route coordinator.
Keep its internal representation and timestep authoritative. Translate only at
one versioned boundary and publish the canonical `ExternalSolverAdapter`.

Do not rename it `ExternalPhysicsAdapter` in serialized records. That phrase may
describe the capability, but the shared ABI token is `ExternalSolverAdapter`.

## Adapter inventory

Every route stores adapters in `physicsExternalSolverAdaptersById`, keyed by the
exact `adapterId`. The value is the complete canonical record, not a pointer,
partial overlay, or prose sketch.

Declare exactly one owner for:

- stepping;
- constraint assembly and solve;
- collision detection;
- contact-manifold lifecycle;
- force/impulse accumulation;
- committed-state publication.

Split ownership is allowed only with a typed handoff. `engine default`,
`automatic`, `shared`, or an omitted field is invalid.

## Units, frames, and clocks

Convert into canonical SI at the adapter. Record dimension-checked maps for
length, mass, time, force, torque, impulse, angular quantities, and any domain
specific channel. Record offsets only for affine quantities that permit them.

Map handedness once. Distinguish points, polar vectors, axial vectors, normals,
tensors, coordinate rates, twists, and wrenches. Validate proper rotations and
SE(3) adjoint/coadjoint power preservation. Negative scale or an implicit
left/right-handed swap is invalid.

Clock mapping identifies external and context clocks, mapping revision,
discontinuity epoch, frozen evaluations/replay, maximum age, and mapping error.
Never carry independent authoritative ticks and seconds. An adaptive or remote
step receipt lists the actual native intervals that tile the requested route
interval.

## Directional capabilities

Each boundary-crossing interaction matches exactly one
`ExternalInteractionCapability`:

- direction and source/reaction role;
- payload tag and exact SI dimensional signature;
- target equation for ingress;
- frame and supported footprint kinds;
- cadence, batch count/layout/bytes;
- exact-once support;
- reaction atomicity;
- residency and dependency;
- error descriptor.

Ambiguous matches and unused capability claims fail. Required unsupported
channels or payloads block the route; do not synthesize zeros.

An `ExternalSolverStepReceipt` binds the requested coordination interval,
actual native intervals, input state versions, committed application ledgers,
prepared outputs, emitted sequence ranges, dependency completions, status, and
content digest. Prepared outputs enter one atomic commit transaction.

## Synchronization transports

Compare at least five transports even when one seems obvious:

1. same-process CPU calls;
2. shared GPU resources;
3. device copy plus map/staging;
4. worker/process IPC with shared memory or messages;
5. network/remote service;
6. offline recorded state.

Shared GPU resources require device, backend, resource and loss generations,
layout, subresource, producer/consumer access, acquire dependency, release or
completion token, and retirement owner. A handle string is insufficient.

Copy/message paths require a versioned byte layout, endianness, precision,
quantization, content digest, sequence/exact-once keys, byte/cadence/latency/
staleness gates, and host-visibility proof. Dispatch promise resolution or
submission is not completion. “Zero copy” still accounts for ownership
transitions, fences, cache effects, queueing, and in-flight residency.

## Atomic execution and failure

The adapter participates in `PhysicsGraph`; it does not run independently in a
render callback. Before a step, validate capabilities, versions, clocks,
dependencies, and input application ledgers. After it, validate receipt digest,
interval tiling, output closure, reactions, conservation/error gates, and one
atomic prepared-to-committed promotion.

Failure policy names detection/timeout, frozen commit groups, prior committed
state disposition, queued interactions/events, recovery owner/transaction, and
whether degraded publication is forbidden. A timeout cannot expose half of a
two-way exchange.

## Recovery

Compare at least:

1. preserve prior commit and retry;
2. checkpoint restore;
3. checkpoint plus exact replay;
4. explicit discontinuous restart with loss ledger;
5. block route and require external intervention.

Checkpoint/replay includes state versions, inventories, stable IDs, RNG/event/
application cursors, context/graph/material/frame/clock revisions, content
digest, rollback bound, and restore validation. Restore the cursor before the
closed replay range, apply only keys without committed receipts, then atomically
publish the post-range cursor.

Without a coherent checkpoint, publish the complete lost inventory/event/
cursor ledger, new discontinuity epoch, reset plan, new resource generations,
and validated restart state. Never reconstruct authority from rendered poses.

## Cost and evidence

`PhysicsExternalAdapterCost` covers:

```text
enqueue -> serialize/convert -> queue wait -> transport/ownership transfer
        -> remote wait/solve -> fence/completion -> deserialize
        -> conservation/error validation -> atomic commit
```

Record aligned request/response/batch counts, logical and physical bytes,
staging/shared/in-flight memory, retries, duplicates, drops, timeouts, clock-map
work, recovery, catch-up, migration, and dependency critical paths. Do not add
overlapping spans or assign unavailable remote time to local CPU/GPU work.

Evidence must bind solver/build, adapter boundary revision, route/source digest,
target/browser/device/backend generations, exact workload, quality state, and
protocol. Browser-free conformance proves record semantics. Native WebGPU and
performance/recovery acceptance require the frozen route in Codex's in-app
Browser with directly inspected diagnostics.
