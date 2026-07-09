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

Every numeric value in the fallback plan, implementation notes, or validation
result carries exactly one label and a source:

- `Authored`: declared target, policy, or quality input;
- `Derived`: computed from labelled inputs;
- `Measured`: observed on the named target and run;
- `Gated`: frozen acceptance limit.

Use `{ value, unit, label, source }`. Bare refresh rates, frame budgets,
resolutions, sample counts, update cadences, memory caps, pass counts, error
thresholds, or test durations invalidate the plan. Performance envelopes derive
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
- separate canonical and compatibility test commands and artifact paths;
- every unsupported claim, including `INSUFFICIENT_EVIDENCE_GPU_TIMING` when
  required.
