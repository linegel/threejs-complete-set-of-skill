---
name: threejs-compatibility-fallbacks
description: Fallback unavailable WebGPU features through an isolated compatibility branch. Use only when the user explicitly asks how to handle an initialized non-WebGPU backend; then classify canonical behavior as preserved, weakened, or removed.
---

# Three.js Compatibility Fallbacks

Treat fallback as an explicitly authorized product branch. Canonical WebGPU/TSL
work and native WebGPU quality tuning remain with their owning skills.

## 1. Activate the branch

Record all of the following before selecting an implementation:

- the user's explicit request for unavailable-WebGPU fallback;
- proof from an initialized `WebGPURenderer` that
  `renderer.backend.isWebGPUBackend !== true` on the named target;
- the canonical owner and exact feature;
- the accepted scope of visual, physical, temporal, interaction, performance,
  and maintenance loss;
- the compatibility branch's maintenance owner.

Backend truth is available only after `await renderer.init()`. When WebGPU
initializes, return to the canonical owner. When the explicit request is absent,
report the unavailable-WebGPU blocker from the canonical path. Dispose the
capability-probe renderer before constructing a separate compatibility renderer.

This step is complete when the five activation facts are recorded and the
canonical implementation remains unchanged.

## 2. Classify canonical behavior

List the canonical feature's geometric, radiometric, color, temporal,
interaction, state-ownership, and lifecycle invariants. Classify each one:

- `preserved`: the same quantity and proof still apply;
- `weakened`: keep the quantity, name the changed error, support, cadence,
  staleness, or envelope, and freeze a new gate;
- `removed`: mark the capability unsupported and remove dependent claims.

At a cross-system boundary, preservation means retaining the same units,
frames/origin, time interval and sample phase, owner, producer/consumer version,
support/filter, validity/staleness/error, rate-versus-integrated semantics,
one-way or two-way reaction scope, stable identity, immutable previous/current
presentation state, reset behavior, and GPU completion dependency. An
approximation with different semantics is weakened or removed. Keep
steady-frame GPU-to-CPU readback outside frame-critical paths.

This step is complete when every canonical claim has exactly one disposition
and every weakened or removed row names its user-visible consequence.

## 3. Select the first honest representation

Use this order for each feature:

1. precomputed or static canonical output when interaction can be removed;
2. bounded CPU/offline generation with declared upload cadence, latency,
   allocation, and lost dynamics;
3. feature removal with matching UI/documentation and claim removal;
4. an isolated legacy branch after explicit maintenance acceptance.

Read
[the downgrade matrix](references/downgrade-decision-matrix.md) when selecting
among unavailable capabilities. Read the
[r185 API map](references/r185-api-map.md) only when implementing or verifying
the legacy/API branch; reverify each symbol against the installed revision.

This step is complete when the selected representation is the earliest row
that passes every `preserved` invariant and every remaining loss is explicit.

## 4. Isolate ownership

Give the compatibility branch separate imports, build/deployment entrypoint,
tests, artifacts, capability gate, and maintenance ownership. Keep one scene
signal graph and one tone-map/output-transform owner inside the branch. Record
color versus data texture domains, resource creation/reset/resize/disposal, and
the boundary between canonical and compatibility assets.

When a GPU-performance claim requires timestamps, construct the branch renderer
with `trackTimestamp: true` before initialization. A legacy branch may use
`WebGPURenderer( { forceWebGL: true } )` only after activation; it remains a
compatibility product rather than the canonical renderer.

This step is complete when disabling or deleting the compatibility entrypoint
leaves the canonical build and runtime graph unchanged, and every branch-owned
resource has one owner and disposal path.

## 5. Validate the changed claims

Invoke `threejs-visual-validation` for every preserved or weakened claim. Use
the canonical evidence as truth, capture final/no-post/contribution and the
diagnostics needed by those claims, and return `PASS`, `FAIL`, or
`INSUFFICIENT_EVIDENCE` per claim.

Exercise the branch-specific reset, resize/DPR, repeated transition, teardown,
and dispose/recreate paths. Persistent resources must plateau after declared
warm-up. Missing timestamps make a required GPU-attribution claim
`INSUFFICIENT_EVIDENCE`; presentation or CPU duration remains end-to-end
evidence only.

This step is complete when every surviving claim has a direct verdict, every
removed claim is absent from product language, output conversion has one owner,
and lifecycle resources plateau or fail.

## Output

Return one row per feature:

| Feature | Target | Preserved | Weakened | Removed | Representation | Validation |
| --- | --- | --- | --- | --- | --- | --- |

Also record the activation facts, isolated entrypoint and maintenance owner,
output owner, lifecycle result, unsupported claims, and the exact evidence
needed for any `INSUFFICIENT_EVIDENCE` verdict.
