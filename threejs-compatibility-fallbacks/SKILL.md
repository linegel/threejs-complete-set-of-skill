---
name: threejs-compatibility-fallbacks
description: Use only for teaching how to apply fallback when WebGPU is unavailable after the user explicitly requests it. Never activate for canonical WebGPU/TSL work, low-end tuning, mobile optimization, capability preflight, or general target support.
---

# Three.js Compatibility Fallbacks

This skill is a quarantine boundary, not a general compatibility layer. Load it
only when the current user explicitly requests teaching how to apply fallback
when WebGPU is unavailable. A detected missing backend, low-end or mobile target,
performance pressure, broad browser support request, or agent preference does
not activate it.

## Activation Gate

Before reading or applying any fallback recipe, record:

```text
explicit user request for teaching how to apply fallback when WebGPU is
unavailable
canonical owner skill and feature
tested WebGPU-unavailable condition
accepted scope of visual loss and maintenance
```

If the explicit request is absent, stop at the canonical owner's capability
blocker. Do not propose, sketch, prewire, or silently implement a fallback.

```js
import { WebGPURenderer } from 'three/webgpu';

const renderer = new WebGPURenderer( { antialias: false } );
await renderer.init();

if ( renderer.backend.isWebGPUBackend === true ) {
  throw new Error( 'Use the canonical WebGPU/TSL owner; compatibility fallback is inactive.' );
}

if ( userExplicitlyAskedForUnavailableWebGPUFallback !== true ) {
  throw new Error( 'Report WebGPU as a blocker. Do not teach or implement fallback.' );
}

renderer.dispose();
const compatibilityRenderer = new WebGPURenderer( {
  forceWebGL: true,
  trackTimestamp: gpuTimingRequirement === 'required'
} );
await compatibilityRenderer.init();
```

`forceWebGL` is a named compatibility branch or test branch after activation.
It is never the canonical architecture. Do not recommend a direct
`WebGLRenderer` construction from this skill.

## Non-Leakage Rule

- Never insert compatibility code, imports, tables, or recipes into a flagship
  WebGPU/TSL skill.
- Never make a canonical owner depend on this skill. References flow from this
  quarantine to the owner, not from the owner into fallback teaching.
- Never weaken a canonical mechanism to simplify a future branch.
- Never auto-route here from capability detection. Detection reports a blocker;
  only the user's explicit request authorizes this skill.
- Never treat native WebGPU quality scaling as fallback. It remains owned by
  the canonical skill and its visual-validation contract.
- Never advertise a compatibility branch as equivalent to the canonical path.

## Numeric Evidence Labels

Every quantity used to justify a fallback decision or claim carries a unit,
one label, and a source:

- `Authored`: declared target, policy, or quality input;
- `Derived`: computed from labelled inputs;
- `Measured`: observed on the named target and run;
- `Gated`: frozen acceptance limit.

Use `{ value, unit, label, source }` when a machine-readable target-project
record benefits from it. Claim-driving refresh rates, frame budgets,
resolutions, sample counts, update cadences, memory caps, pass counts, error
thresholds, or test durations still need units and provenance. Performance envelopes derive
from target refresh after browser and compositor reserves; do not copy universal
device-class constants.

## Invariant Ledger

Before implementation, map every canonical physical, geometric, radiometric,
color, temporal, space, and lifecycle invariant to one status:

- `preserved`: canonical proof still applies unchanged;
- `weakened`: name the visible or behavioral error, its diagnostic, metric,
  and `Gated` threshold;
- `removed`: name the feature as disabled, baked, approximate, or stylized and
  delete claims that require it.

If a degraded image would misrepresent the mechanism, remove the feature. Do
not use presentation treatment to hide lost geometry, energy, state, or parity.

## Physics ABI Is Inherited, Not Downgraded

This skill remains exempt from physics routing until the activation gate has
passed. After activation, if the canonical owner participates in cross-domain
physics, read the
[physics domain and interaction contract](../threejs-choose-skills/references/physics-domain-and-interaction-contract.md)
and inherit it unchanged. Fallback authorization does not authorize a second
unit system, frame graph, clock, scheduler, identifier namespace, provider
envelope, interaction/reaction convention, material/collider registry, or
presentation schema.

Classify each physics-facing channel explicitly:

| Status | Required compatibility behavior |
| --- | --- |
| `preserved` | Keep the owner's exact `PhysicsContext`, `PhysicsGraph` dependency, `PhysicsSignalDescriptor`, stable generation-bearing IDs, `PhysicsMaterialRegistry`/`PhysicsMaterialId`/`ColliderProxy` identity, applicable `SurfaceExchange`/`InteractionRecord`/`InteractionBatchLedger`/`ContactManifoldRecord` semantics, and the complete view-independent `PhysicsPresentationCandidate` -> per-view `CameraViewPublication` -> `ViewPreparationPublication` -> sealed `PhysicsPresentationSnapshot` -> append-only `FrameExecutionRecord` lifecycle. Preserve the candidate's per-binding `PresentedStatePair` provenance and `requestedPresentationInstant`, camera `previousRenderSampleInstant`/`currentRenderSampleInstant` and transforms, preparation/reset publications, read-only `PresentationResourceLease`, `ConsumerCompletionJoin`, and abort/device-loss disposition. |
| `weakened` | Keep the same schema and physical quantity; publish the increased error, latency, staleness, footprint, cadence, or reduced valid `PhysicsTimeInterval`. A renamed or differently dimensioned approximation is not the same channel. |
| `removed` | Mark the channel absent/unsupported with a typed error and remove the associated physical, interaction, and conservation claims. Never zero-fill missing force, mass, velocity, temperature, wetness, or contact. |

A cached or precomputed branch claiming preservation retains provider/signal
and resource generations, units, valid `PhysicsTimeInterval`,
residency/latency, typed error, each state pair's independent
`PresentationSampleProvenance`, candidate
`requestedPresentationInstant`, per-view camera render instants, preparation
publications, snapshot references, lease retirement, and candidate abort/
device-loss cleanup. It does not move view transforms or reset state into the
candidate/snapshot or collapse source and presentation clocks. `NodeMaterial`
or PBR appearance cannot substitute for a
`PhysicsMaterialId` registered in `PhysicsMaterialRegistry`; stable material/
collider IDs either remain valid or the capability is explicitly unsupported.
CPU/offline substitution must not add a frame-critical readback or silently
change the source `PhysicsInstant` or its clock mapping.

Inside inherited physics records, retain the canonical quantitative form
`{ value, unit, label: Derived|Gated|Measured|Authored, source }`.
`[D/G/M/A]` are compact prose aliases only; the fallback must not rewrite the
canonical provider or interaction schema.

Preserved dynamics still require replay, convergence, conservation/reaction,
origin-rebase, stable-ID, and sustained-resource evidence. A
`QualityTransition` must prove state migration/reset and history invalidation;
it cannot silently change solver/model class or let old and new representations
emit the same reaction. If those proofs cannot survive, mark the mechanism
weakened or removed rather than presenting visual similarity as physics parity.

## Workflow After Activation

- Name the canonical owner and exact downgraded feature.
- List required canonical primitives: backend, TSL, NodeMaterial, storage,
  compute, MRT, node post, timestamps, and built-in nodes.
- Record the actual unavailable-WebGPU condition plus any secondary target
  constraints: browser, GPU, memory, bandwidth, thermal, interaction, or
  maintenance limits.
- Freeze the canonical visual contract and capture its reference evidence.
- Choose one downgrade axis per feature, in this order:
  - precomputed or static data when interaction can be removed;
  - CPU or offline generation for fields, geometry, LUTs, or impostors;
  - feature removal when the invariant cannot survive honestly;
  - a legacy WebGL branch only with explicit maintenance acceptance.
- Write the invariant and resource deltas before code.
- Derive target-specific performance gates from refresh, browser reserve, and
  compositor reserve; model tile attachment traffic and peak memory.
- Validate preserved invariants unchanged and weakened invariants with their
  own visual-error gates.
- Keep canonical and compatibility tests, bundles, and deployment paths
  separate.

Native WebGPU quality pressure is not a fallback axis and does not belong in
this skill. If WebGPU is available, return to the canonical owner.

## Allowed Patterns After Activation

- Precomputed textures, LUTs, fields, geometry, animation, or impostors with
  hashes, color-domain records, regeneration inputs, and named lost dynamics.
- CPU/offline generation with bounded upload cadence, allocation evidence, and
  explicit loss of GPU-owned interaction.
- Feature removal with honest UI and documentation.
- A quarantined legacy branch using `ShaderMaterial`, `EffectComposer`,
  render-target ping-pong, `InstancedMesh`, or `onBeforeCompile`, only after the
  activation and maintenance gates pass.

## Forbidden Patterns

- Fallback teaching in any destination WebGPU/TSL skill.
- Runtime fallback code added speculatively before an explicit request.
- A legacy branch presented as the recommended architecture.
- Double tone mapping, duplicated output transforms, sRGB data textures,
  broken energy accounting, or divergent shared fields used to mimic parity.
- Reduced physics described as physically based.
- CPU frame duration used as GPU cost.
- Missing required GPU timestamps reported as a pass or `SKIP`.
- A single final frame used to prove preservation.
- A second renderer product without explicit maintenance acceptance.

## Performance And Validation Delta

Fallback does not lower evidence standards. For each target, record requested
presentation rate `Authored`, actual display refresh `Measured`, target rate
`Gated`, refresh period `Derived`, browser and compositor reserves `Measured`
or provisional `Authored`, stage envelopes `Derived`, and frozen `Gated` limits.
Record cold and sustained CPU/GPU `p50 [Measured]` and
`p95 [Measured]`, presentation misses, quality transitions, peak
resident/transient memory, tile attachment footprint, modeled traffic, and
per-invariant visual error.

If the fallback performance claim requires GPU attribution and timestamps are
unavailable, return `INSUFFICIENT_EVIDENCE_GPU_TIMING`. End-to-end presentation
timing may still be reported as `Measured`, but it cannot establish GPU
headroom or a GPU bottleneck. A compatibility branch receives no exemption.

For tile GPUs, record attachment load/store/resolve behavior, pass breaks,
sample counts, peak live attachments, storage and sampled traffic bounds,
uploads, and bytes per presented frame. Hidden tile size, compression, cache
behavior, and physical bandwidth are not measured unless counters expose them.

## References

- [Physics domain and interaction contract](../threejs-choose-skills/references/physics-domain-and-interaction-contract.md):
  conditional canonical ABI inherited only after explicit fallback activation;
  it is not an activation route into this skill.

- [references/canonical-loss-ledger.md](references/canonical-loss-ledger.md):
  owner invariants, permitted losses, forbidden misrepresentation, and proof
  deltas.
- [references/downgrade-decision-matrix.md](references/downgrade-decision-matrix.md):
  ordered choices after activation.
- [compatibility API map](references/r185-api-map.md): checked-in API anchors
  and legacy quarantine; its filename revision identifier is `Gated`.
- [references/checkpoints-and-traps.md](references/checkpoints-and-traps.md):
  activation, evidence, and architecture traps.

## Output Contract

After the activation gate passes, return a table:

| Branch | Target | Preserved | Weakened | Removed | Implementation | Validation |
| --- | --- | --- | --- | --- | --- | --- |

Also include:

- the recorded explicit request and WebGPU-unavailable evidence;
- canonical owner, files, invariants, and reference bundle;
- isolated branch boundary and maintenance owner;
- labelled target refresh envelope, sustained timing, memory, tile traffic,
  quality policy, and visual-error gates;
- exact color/data texture domains and output owner;
- lifecycle, disposal, and rebuild deltas;
- the exact preserved/weakened/removed physics channels, typed unsupported
  errors, stable-ID/material/collider continuity, presentation semantics, and
  replay/convergence/conservation/rebase proof delta, including candidate,
  camera, view-preparation, snapshot-reference, lease, and execution records;
- separate canonical and compatibility test commands and artifact paths;
- every unsupported claim, including `INSUFFICIENT_EVIDENCE_GPU_TIMING` when
  required.
