---
name: threejs-rain-snow-and-wet-surfaces
description: Build coupled WebGPU/TSL rain, snow, and wet-surface systems in Three.js. Use for compute-driven falling snow, rain streaks, snow accumulation, model snow caps, wet asphalt puddles, procedural or generated ripple normals, splash flipbooks, shared weather envelopes, and surface wetness or coverage transitions.
---

# Rain, Snow, and Wet Surfaces

Treat weather as one coupled GPU system: a shared weather envelope drives
precipitation particles, surface masks, normals, roughness, residue, lighting,
and diagnostics. The first design decision is algorithm class: immutable
analytic motion, sparse CPU-updated events, and dense GPU-resident recurrence
have different asymptotic and bandwidth costs.

Run `threejs-choose-skills` preflight for backend, budget, and resource owner
decisions when precipitation joins a larger scene. Dense recurrent state can
benefit from GPU residency; analytic or sparse branch-heavy work can be faster
without a compute dispatch. The target measurement decides.

## Required Architecture

Build new work on pinned Three.js r185 with `WebGPURenderer` from `three/webgpu`,
TSL from `three/tsl`, `NodeMaterial` classes such as
`MeshStandardNodeMaterial`, `MeshPhysicalNodeMaterial`, and
`SpriteNodeMaterial`, and the node post stack with `RenderPipeline`, `pass()`,
`mrt()`, `PassNode.setResolutionScale()`, `outputColorTransform`, and
`renderOutput()`.

The canonical frame graph exposes the selected state path:

```text
shared weather envelope
  -> immutable analytic seeds OR compute-updated recurrent precipitation
  -> domain-selected world cells: unbounded streamed, or localized bounded
  -> TSL surface masks for snow, wetness, puddles, roughness, and normals
  -> GPU impact/splash event buffers or generated ripple-normal quality tier
  -> node presentation with one tone-map and one output transform owner
```

Choose the precipitation update before allocating dynamic storage:

| Required behavior | Default algorithm |
| --- | --- |
| Constant ballistic fall/wind, no collisions | Immutable seeds; derive world-cell position analytically from time in vertex TSL; stream/wrap only for unbounded visual weather |
| Authored time-varying wind with analytic integral | Immutable seeds plus accumulated/integrated wind displacement `integral v_wind(t) dt`; never multiply the current wind by total elapsed time |
| Turbulence, collisions, or recurrent particle state | Compute-updated storage instances |
| World impacts/accumulation | World-stable precipitation cells plus a compact impact/coverage field; camera-wrapped visual particles may not author physical contacts |
| Sparse close splashes | Event pool over impacted tiles/receivers, not a global particle scan |

Analytic precipitation removes hot-buffer writes and a dispatch. Camera wrapping
is a presentation optimization; hash cells in world space so camera motion does
not make rain/snow phase or impact locations jump.

Legacy WebGL implementations (deprecated, do not extend): `examples/snow-accumulation/snow-system.js`, `examples/wet-puddle-rain/rain-puddle-system.js`.

Diagnostic/source scaffold:
`examples/webgpu-rain-snow-and-wet-surfaces/`. Its descriptor and token checks
do not prove renderer initialization, shader compilation, GPU execution,
readback, images, or timing. Run
`node examples/webgpu-rain-snow-and-wet-surfaces/validate.js` after edits.

Read
[references/precipitation-surface-systems.md](references/precipitation-surface-systems.md)
for the full contracts, quality tiers, budgets, diagnostics, and replacement
notes.

## Shared Physics Boundary

When weather interacts with any other simulated domain, first read the router's
[physics-domain and interaction contract](../threejs-choose-skills/references/physics-domain-and-interaction-contract.md).
Bind this skill to its versioned `PhysicsContext`,
`EnvironmentForcingSnapshot`, `SurfaceExchange`, `InteractionRecord`, and
`PhysicsPresentationCandidate`, `CameraViewPublication`,
`ViewPreparationPublication`, and `PhysicsPresentationSnapshot`; do not create
a second weather clock, wind uniform, contact record, or unit convention.

The project/environment coordinator exclusively owns and publishes
`EnvironmentForcingSnapshot`. This skill consumes that immutable snapshot and
may own downstream precipitation transport, exchanges, and receiver state; it
never republishes forcing under a rain-owned revision.

- Consume atmospheric wind from `EnvironmentForcingSnapshot` in meters per
  second at its exact `sampleInstant: PhysicsInstant`, with its declared frame,
  altitude/support domain, cadence,
  requested/actual oriented spatial footprint and spatial/temporal filter or
  band, interpolation policy, and
  per-channel error. Wind is air velocity. It is not plant
  structural response, water material current, or water-surface point velocity.
- Consume temperature and humidity only with their declared thermodynamic
  convention. Consume canonical precipitation as oriented mass-area flux.
  Convert any external volume source through its physical support/Jacobian, or
  any water-equivalent-depth rate through explicit reference density/provenance,
  before publishing the forcing snapshot. Preserve liquid/ice fractions,
  physical support/Jacobian, and arrival-time information. A scalar `forcing` may
  coordinate art direction but cannot author deposition or conservation.
- Treat clouds in one declared mode. Appearance-only clouds publish no physical
  precipitation channel. A causal cloud producer may publish a separate
  immutable `PrecipitationEmissionSnapshot` with
  `emissionInterval: PhysicsTimeInterval`, cloud support,
  fall-delay/transport policy, cadence, and per-channel error; this skill
  transports it on the declared later scheduler edge to physics-frame-stable receivers.
- Emit distributed rain/snow transfer as `SurfaceExchange` with mass and
  momentum fluxes over its exact `applicationInterval: PhysicsTimeInterval`.
  Intensive flux uses `InteractionFootprint.distributionKind: intensive-field`:
  physical-area quadrature weights include Jacobians and sum to
  `representedMeasure`; no normalized `W` multiplies the flux. A normalized
  inverse-square-metre kernel is permitted only for
  `distributionKind: extensive-distributed`, where it distributes one
  extensive rate or interval transfer.
  Emit sparse impacts as `InteractionRecord` with impulse, footprint in the
  declared SI physics frame, source/receiver IDs, exact
  `applicationInterval: PhysicsTimeInterval`, frame/transform revision,
  ordering key, reaction owner, and batch/partition identity. Put capacity
  outcomes in this downstream `SurfaceExchange.batchLedger` as the canonical
  immutable `InteractionBatchLedger`, never on the cloud emission or individual
  records. Rendered streak/flake count never changes either integral. Every
  causal physical impact carries
  `InteractionRecord.partitionMembership: InteractionPartitionMembership`
  with its `parentExchangeId`, `parentInteractionIds`, `partitionGroupId`,
  `partitionId`, `partitionMeasure`, and `closureGroupId`; disjoint partitions
  close their parent exchange exactly. Non-authoritative visual splashes use a
  presentation-event stream that references the exchange; neither path deposits
  a second copy. The receiver records every prepared/committed application and
  every deferred, rejected, or duplicate-no-op disposition in
  `InteractionApplicationLedger`, keyed by the record's `applicationLedgerKey`,
  execution overlap, batch/partition/version cursor, and target prepared state;
  the batch ledger names those application-ledger IDs before receiver state can
  commit.
- Assign exactly one wetness/coverage owner per receiver. That owner integrates
  rain deposition, water run-up/inundation, melt, drainage, infiltration, and
  evaporation into one state. Water, this skill, and materials may not each
  integrate private copies. A material consumes the published receiver state;
  it never integrates precipitation in a fragment node.

Order coupled updates as follows: latch one immutable forcing snapshot at its
`sampleInstant: PhysicsInstant` for the graph's
`coordinationInterval: PhysicsTimeInterval`; give every participating
`PhysicsGraphStage` an exact `executionInterval: PhysicsTimeInterval` and emit
one `PhysicsStageExecution` for each attempted advance or analytic/state-hold
evaluation; record dropped debt in the graph catch-up loss ledger; advance
analytic or recurrent precipitation; resolve/bin impacts; publish exchanges and
interaction records with exact `applicationInterval: PhysicsTimeInterval`; let
the selected receiver owner integrate wetness/snow/coverage; and commit domain
state. Do not read a newly written receiver field inside the update that
produced it unless the graph declares the exact dispatch dependency, pass
boundary, same-queue order, or host-visible completion. A workgroup barrier
never orders a whole grid.

After commit, publish one view-independent `PhysicsPresentationCandidate` at
`requestedPresentationInstant: PhysicsInstant`, containing
`presentedStatePairs`, `resourceLeases`, and `eventSequenceRanges`, but no
camera, render-origin transform, visibility, shadow, cache, or reset state.
Each pair's `previousPresented.provenance` and
`currentPresented.provenance` are independent
`PresentationSampleProvenance` records, and each arm carries its own
`presentedInstant: PhysicsInstant`. The camera owner then publishes one
`CameraViewPublication` per target/view with
`previousRenderSampleInstant: PhysicsInstant` and
`currentRenderSampleInstant: PhysicsInstant` plus
`globalToRenderPrevious`/`globalToRenderCurrent`, view/projection matrices,
jitter, viewport, and depth state; visibility, acceleration, shadow, cache,
reactive, and reset owners publish the corresponding
`ViewPreparationPublication` with `visibilityPublicationRefs`,
`accelerationPublicationRefs`, `shadowViewPublicationRefs`,
`cachePublicationRefs`, `reactiveEpochs`, `reactivePublications`,
`resetDependencies`, full `resourceLeases` for newly created camera-dependent
generations, and `resourceLeaseRefs`. Finally,
seal a `PhysicsPresentationSnapshot` whose state/resource payload is only
`presentedStatePairRefs` and `resourceLeaseRefs` plus the exact `candidateId`,
`cameraPublicationId`, and `viewPreparationId`, with an exact
`closureManifest`. Present airborne precipitation, receiver state, and any
causal cloud-emission generation used by the view as distinct
`PresentedStatePair` bindings. The snapshot never copies `PresentedStatePair`
records, provenance, or global-to-render transforms.

Use the shared `QualityTransition` for every physics-authoritative change to
precipitation equations, recurrent state, cadence, receiver support/filter,
exchange representation, partition/ledger identity, or stable IDs. A
render-only change to streak count, beauty resolution, sprite geometry, or
ripple-normal presentation may remain local only when physical state,
integrals, descriptors, filters, cadence, and identities are unchanged.

## Capability Gate

Initialize the renderer before allocating compute or storage resources. The
high tier requires the WebGPU backend; the reduced tiers keep the same weather
envelope and switch quality, not implementation doctrine.

```js
await renderer.init();

if (renderer.backend.isWebGPUBackend !== true) {
  throw new Error(
    'WebGPU is required for the canonical weather path; explicit fallback teaching belongs to threejs-compatibility-fallbacks.'
  );
}
```

Native WebGPU quality tiers preserve the shared weather cause:

- `full`: analytic or recurrent motion as required, world-stable sparse
  impacts, integrated receiver fields, and measured reconstruction/post.
- `balanced`: lower projected density/history extent and fewer field bands,
  with response conservation and image-error gates intact.
- `budgeted`: analytic precipitation where possible, bounded event pools,
  lower-rate/reduced receiver state, and optional explicitly stylized generated
  ripple normals.

## Build Order

1. Define one immutable weather projection from the latched forcing snapshot:
   sample time comes from `sampleInstant: PhysicsInstant`, step duration is
   derived from the owning stage's `executionInterval: PhysicsTimeInterval`,
   and wind, temperature, precipitation flux, and debug state preserve their
   source versions. Rendered particle count is a
   sampling/appearance choice: accepted impacts use deterministic quadrature
   over the declared exposed-surface measure. Physical-area weights include
   Jacobians and sum to represented area; deposition is
   `sum_i flux_i * areaWeight_i * dt`. Do not normalize these area weights.
   Extensive impact sample weights instead close the already integrated parent
   transfer. Equal division by particle count is valid only for a proven
   uniform measure/integrand. Wetness and snow coverage are integrated
   state with deposition, drainage/evaporation, or melt terms; they consume the
   same forcing but are not aliases of instantaneous precipitation progress.
2. Allocate static per-instance seeds once. Evaluate ballistic/domain motion
   analytically when possible. Update only recurrent particle state with
   queued `renderer.compute()` into storage; r185 `computeAsync()` is not a
   GPU-completion fence.
3. Choose the visual domain. Unbounded precipitation uses camera-centred
   world-cell streaming with stable world hashes. Localized weather uses a
   world-anchored bounded volume whose boundary is physically hidden or softly
   modelled. Impacts/accumulation always use an independent world-stable
   receiver field.
4. Author surfaces as `MeshStandardNodeMaterial` or
   `MeshPhysicalNodeMaterial`. Drive color, roughness, metalness, normal,
   opacity, and displacement through node slots, not string patching.
5. Use one field per phenomenon: one snow height function feeds both
   displacement and normals; one wetness/puddle mask gates roughness, ripple
   normals, splash intensity, and debug output.
6. For rain surfaces, split early wetness from heavy-rain ripple response.
   Roughness should change before ripple normals appear.
7. For splashes, generate or compact impact candidates on the GPU only past the
   measured CPU/dirty-upload crossover. Weight by world-space upward normals, reject hidden/downward
   surfaces, and animate flipbook progress without per-splash CPU rewrites.
8. Present with `RenderPipeline`. Use built-in nodes first: `GTAONode` or
   `ao()` for contact grounding, `BloomNode` or `bloom()` only for bright
   splash highlights, `TRAANode` or `traa()` when temporal stability matters,
   and `CSMShadowNode` or `TileShadowNode` for large precipitation-lit scenes.

## Required Controls

- precipitation density, rate, speed, and quality tier;
- wind direction, strength, and gust phase;
- shared weather forcing plus independently integrated wetness/snow state;
- visual domain bounds, cell-streaming/wrapping policy, and receiver-field extent;
- wetness, snow, or puddle mask threshold and softness;
- ripple source: dynamic field, generated variant A/B/C, or disabled;
- ripple or drift normal strength;
- surface roughness and color response;
- particle, residue, and splash opacity;
- debug modes for masks, normals, particles, event buffers, forcing, and
  integrated surface state.

## Performance Contract

Derive particle count from projected coverage and overdraw, not a device-class
lookup table. An analytic camera-relative precipitation field can render with
immutable seeds and no simulation dispatch. A recurrent particle solver pays
storage plus compute only when interaction, collision, or persistent state is
visible. Sparse world impacts use a bounded event pool; do not update a dense
world grid merely because precipitation is dense on screen.

- Storage: keep recurrent instance buffers packed to the fields actually read.
  For an **Authored** example capacity of 100,000 instances with three
  `vec4<f32>` records, the **Derived** payload is
  `100000 * 3 * 16 = 4,800,000 B = 4.58 MiB`, excluding allocator padding,
  render targets, and duplicate/history slots.
- Passes: one beauty pass, optional MRT only when later nodes reuse depth,
  normals, wetness, or velocity; reduced-resolution post effects must use
  `PassNode.setResolutionScale()`.
- Draw calls: one draw per visible spatial page and compatible precipitation
  or splash material class; never trade submission savings for one uncullable
  world-wide batch. Use no per-drop or per-splash object allocation.

Record `{visibleInstances, pixelsCovered, mean/max layersPerPixel, streakQuadPx,
solverKind, storageBytes, dirtyImpactTiles, renderExtent, sampleCount}`. The
router assigns a whole-frame allocation; report contemporaneous full-frame
p50/p95 and a paired marginal A/B result for precipitation. Gate sustained GPU
and CPU p50/p95, hot bytes/frame, transparent overdraw, impact-field work, peak
live memory, and thermal behavior on the named target. On tile GPUs compare
analytic/no-history, reduced field, and recurrent tiers under the same visual
error contract; instance count alone says nothing about mobile suitability.

## Color And Output

- LDR albedo/emissive textures encoded as sRGB use `SRGBColorSpace`; HDR/EXR
  radiance remains loader-declared linear.
- Data textures, normal maps, roughness maps, masks, noise, LUTs, and weather
  fields use `NoColorSpace` or linear treatment.
- Decide mipmaps per use: pregenerated ripple-normal variants should have
  stable filtering; storage textures written by compute need explicit mip
  ownership.
- Keep HDR working buffers as `HalfFloatType` until the tone-map step.
- The node pipeline owns exactly one tone map and one output conversion through
  `outputColorTransform` or an explicit `renderOutput()` node.

## Replacement Doctrine

- For dense recurrent state, replace per-frame CPU instance rewrites with
  GPU-resident compute/storage only after the state remains resident and the
  measured dispatch is cheaper. Analytic seeds need neither path; sparse,
  branch-heavy authoritative events may remain CPU-updated dirty ranges.
- Replace disconnected particle clocks and surface clocks with one weather
  envelope. This prevents rain, splashes, puddles, and snow coverage from
  drifting apart.
- Replace string-injected material customization with TSL node slots on
  `NodeMaterial` classes. This is the current renderer path and keeps material
  fields composable.
- Replace expensive analytic ripple evaluation on every wet pixel with dynamic
  fields only when justified; otherwise use the generated normal variants under
  `assets/generated-variants/` as the cheap tier.
- Replace local-space splash weighting with world-space normal tests and
  optional depth or occlusion rejection.

## Failure Conditions

- falling precipitation ignores the wind, time, or progress used by surfaces;
- instance positions or splash progress are rewritten on the CPU every frame;
- an unbounded streamed volume exposes emitter edges, or a localized volume
  hides an unexplained hard boundary;
- snow height and snow normals come from different fields;
- model snow slides in world space or sticks to vertical faces;
- puddles only lower roughness without a mask, normal response, or ripple tier;
- splashes appear on downward, vertical, hidden, or transformed faces because
  normals were not evaluated in world space;
- temporal wetness is faked with unrelated noise instead of shared weather
  progress;
- color textures and data textures use the same color-space settings;
- the node pipeline double-applies tone mapping or output conversion.

## Routing Boundary

Use `$threejs-water-optics` for bounded pool simulation, caustics, Fresnel,
refraction, and Beer-Lambert water volumes. Use `$threejs-particles-trails-and-effects` for
general sparks, plasma, trails, and non-weather particles. Use
`$threejs-dynamic-surface-effects` for screen-space touch history or frost clearing.
Use `$threejs-image-pipeline` for full-frame post ownership when precipitation
is part of a larger HDR pipeline. Use `$threejs-scalable-real-time-shadows` when weather
visibility depends on large-scene shadow budgets. This skill owns
precipitation transport and its typed exchanges. The route-selected receiver
owner owns integrated wetness/coverage; surface materials only consume it.
