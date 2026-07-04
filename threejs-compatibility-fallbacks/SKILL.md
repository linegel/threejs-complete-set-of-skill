---
name: threejs-compatibility-fallbacks
description: Teach how to apply fallback for Three.js WebGPU work only when the user explicitly asks how to apply fallback when WebGPU is unavailable. Do not use for flagship WebGPU/TSL implementations, automatic routing, or unrelated target-support/tuning work.
---

# Three.js Compatibility Fallbacks

This skill quarantines teaching on how to apply fallback when WebGPU is
unavailable. Flagship Three.js skills teach the best r185-era WebGPU/TSL
architecture first; load this skill only when the user explicitly asks for
how to apply fallback when WebGPU is unavailable.

## Non-Negotiable Rule

Do not weaken the flagship skill to make fallback easier.

Fallback teaching is a derived plan from the canonical implementation:

```text
canonical algorithm and visual contract
  -> required engine capabilities
  -> missing capability on target
  -> cheapest acceptable degradation
  -> explicit lost features and validation deltas
```

Never hide a fallback inside the core skill as "also works on WebGL". Name the
downgrade and its cost, and keep it attached to the user's explicit request for
how to apply fallback when WebGPU is unavailable.

## Invariant Ledger

Every fallback answer must include an invariant ledger before implementation
details. For each canonical physical, color, temporal, and space invariant,
mark exactly one status:

- `preserved`: canonical tests still apply unchanged;
- `weakened`: name the visible wrongness and the metric/screenshot threshold;
- `removed`: name the feature honestly as disabled, baked, approximate, or
  stylized.

If the visible wrongness would be misleading, remove the feature before
choosing a legacy branch.

## Workflow

1. Record the canonical owner skill and the exact feature being downgraded.
2. List the required canonical primitives: WebGPU, TSL, NodeMaterial, storage buffers/textures, MRT, node post, compute, timestamp queries, or specific built-in nodes.
3. Record the exact WebGPU-unavailable constraint the user asked about:
   browser, GPU class, no storage, no MRT float, memory cap, thermal cap, or
   product requirement.
4. Choose one downgrade axis first. Order of preference:
   - quality pressure inside WebGPU: lower resolution, update rate, samples,
     steps, cascades, blades, particles, or LOD rings;
   - precomputed/static assets when interaction can be removed;
   - CPU/offline bake for fields, geometry, LUTs, or impostors;
   - feature removal when the degraded result would lie;
   - legacy WebGL implementation only after the explicit WebGPU-unavailable
     request and explicit maintenance acceptance.
   Feature removal before legacy is mandatory when the degraded visual would
   misrepresent the canonical invariant.
5. Preserve the core physical/algorithmic invariant where possible. If the invariant cannot survive, state the new artifact honestly.
6. Write a validation delta: which canonical tests still pass, which are weakened, and which screenshots/metrics prove the fallback is acceptable.

## Capability Gate

Use the canonical owner first, then branch only from an explicit
WebGPU-unavailable request:

```js
import { WebGPURenderer } from 'three/webgpu';

const renderer = new WebGPURenderer( { antialias: false } );
await renderer.init();

if ( renderer.backend.isWebGPUBackend === true ) {
  throw new Error( 'Use the canonical owner skill; fallback teaching is not active.' );
}

if ( userExplicitlyAskedForWebGPUUnavailableFallback !== true ) {
  throw new Error( 'Report WebGPU as a blocker instead of teaching fallback.' );
}

const compatibilityRenderer = new WebGPURenderer( { forceWebGL: true } );
```

`forceWebGL` is a compatibility branch or test branch, never the canonical
architecture. Do not recommend `new WebGLRenderer()` from this skill.

## Allowed Teaching Patterns

- **Quality pressure inside WebGPU**: reduce pass resolution, samples, raymarch steps, grid size, update cadence, or visible density while keeping the same architecture.
- **Precomputed fallback**: replace dynamic compute with generated textures, LUTs, impostors, baked fields, or static variants when the interaction can be removed.
- **Legacy WebGL branch**: use `ShaderMaterial`, `EffectComposer`, render-target ping-pong, `InstancedMesh`, or `onBeforeCompile` only as a named branch when the user explicitly asks how to apply fallback when WebGPU is unavailable.
- **CPU/offline fallback**: generate geometry, fields, or lookup textures ahead of time when runtime compute/storage is unavailable.
- **Feature removal**: turn off the feature rather than shipping a fake equivalent when the degraded result would mislead the scene.

## Forbidden Patterns

- Do not put fallback teaching into destination WebGPU/TSL skills.
- Do not present a fallback as the recommended architecture.
- Do not preserve visuals by breaking color/output ownership, double tone mapping, energy budgets, or shared field parity.
- Do not build a second full renderer-specific product unless the user explicitly
  asks how to apply fallback when WebGPU is unavailable and accepts the maintenance
  cost.
- Do not call reduced physics "physically based"; name it as approximate, stylized, baked, or disabled.

## References And Planner

- [references/canonical-loss-ledger.md](references/canonical-loss-ledger.md):
  owner-by-owner invariant, forbidden fake, and validation delta table.
- [references/downgrade-decision-matrix.md](references/downgrade-decision-matrix.md):
  ranked downgrade options by missing capability.
- [references/r185-api-map.md](references/r185-api-map.md): current Three.js
  API anchors and legacy quarantine map.
- [references/checkpoints-and-traps.md](references/checkpoints-and-traps.md):
  observable gates and exact traps.
- [examples/tier-planner/](examples/tier-planner/): JSON-in/table-out planner
  with validation for exactly one downgrade axis per feature.

## Output Contract

When this skill is used because the user explicitly asked how to apply fallback
when WebGPU is unavailable, return a fallback teaching table:

| Tier | Target | Kept | Lost | Implementation | Validation |
| --- | --- | --- | --- | --- | --- |

Also include:

- capability gate code or pseudocode;
- exact files or skills that own the canonical path;
- target frame budget, pass count, memory cap, degraded resolution/update
  cadence, screenshot names, and metric thresholds per tier;
- data texture color-space rules for any precomputed maps;
- lifecycle/disposal changes, including dispose/recreate obligations;
- tests that must run separately from canonical WebGPU validation.
