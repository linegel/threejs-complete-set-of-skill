# Cross-System Handoffs

Close one row for each boundary where systems exchange physical state, events,
or GPU resources. Keep each fact at the boundary's single owner.

| Interface | Required decision |
| --- | --- |
| Quantity | Name the quantity, SI or declared project unit, scalar/vector/tensor meaning, sign convention, and conversion owner. |
| Frame and origin | Name producer and consumer frames, handedness, basis, world scale, origin epoch, transform version, and the owner that publishes rebases. |
| Time | Use a timestamp or half-open interval `[t0, t1)`. Name clock, cadence, sample phase, interpolation/extrapolation policy, and discontinuity behavior. |
| Authority | Assign one state owner. Name the producer, every permitted consumer, the consumed version, and publication order. |
| Support and filtering | State point/area/volume support, footprint or kernel, normalization, sampling measure, boundary behavior, and resolution dependence. |
| Validity | State valid interval/domain, staleness limit, missing-value behavior, error quantity with units, and the consumer's rejection threshold. |
| Transfer semantics | Distinguish rates (`quantity / s`) from values integrated over `[t0, t1)`. Keep impulses, instantaneous samples, and accumulated transfers as distinct meanings. |
| Reaction scope | Mark one-way reads as source-preserving. For two-way exchange, name source and reaction owners, application order, conservation target, and the state version that records the applied reaction. |
| GPU dependency | Name producing dispatch/pass, consuming dispatch/pass, resource generation, queue ordering, and the completion evidence required across queues or the host boundary. A resolved `computeAsync()` call is submission evidence, not a GPU-completion fence. |
| Presentation | Publish immutable previous/current committed samples, interpolation interval/alpha, stable semantic identity, and reset rules for discontinuity, rebase, representation change, resize, or resource reallocation. |
| Readback | Keep frame-critical state on the GPU. Schedule diagnostic or validation readback asynchronously outside the state-advance and presentation dependency chain. |
| Lifetime | Name allocation, reuse, invalidation, retirement, and disposal owners, including how in-flight consumers finish before retirement. |

## Ordering

Write the shortest dependency sequence that preserves authority, for example:

```text
producer advances interval -> publishes version -> consumer samples version
-> optional reaction owner applies interval transfer -> presentation snapshots
committed previous/current versions -> render consumes immutable snapshots
```

Multiple native cadences may share a presentation frame. Each owner advances on
its own valid intervals; the coordinator orders dependencies and applies one
declared catch-up/drop policy without silently double-stepping state.

## GPU-resident exchange

Prefer shared storage, textures, or render targets with explicit pass
dependencies. Cross-queue or host consumers require the backend's actual
completion primitive and resource state transition. Readback belongs to an
asynchronous evidence path with recorded integer row stride and alignment.

A handoff is closed when every applicable row has one owner, producer and
consumer versions agree, ordering is acyclic or explicitly iterated, resets
invalidate all dependent state, and the negative control proves the consumer is
reading the declared source.
