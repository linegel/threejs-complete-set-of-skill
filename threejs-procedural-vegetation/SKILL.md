---
name: threejs-procedural-vegetation
description: Generate authored procedural trees, grass, and vegetation in Three.js r185 with WebGPURenderer, TSL, and NodeMaterial. Use for terrain/coastal ecology, windward/leeward and salt/moisture placement, deterministic chunk-safe populations, species presets, trunks, branches, roots, canopies, leaf cards, trellises, rooted wind, optional compute/storage, chunked LOD and impostors, and vegetation diagnostics.
---

# Procedural Vegetation

Use this skill for vegetation that has botanical structure and scale discipline: dense grass, authored meadows, deciduous trees, recursive branches, roots, canopies, leaf cards, trellises, deterministic species variation, and rooted wind. Start every implementation with `$threejs-choose-skills` when the scene also needs atmosphere, terrain, water, shadows, post, or camera doctrine.

The taught renderer path is pinned Three.js r185 `WebGPURenderer` from `three/webgpu`, TSL from `three/tsl`, `NodeMaterial` subclasses, node render pipelines, and compute/storage only when selected by workload. Legacy WebGL implementation (deprecated, do not extend): `examples/stylized-meadow-grass/grass-system.js`, `examples/gpu-computed-grass/gpu-grass-system.js`.

Canonical WebGPU dense-grass example: `examples/webgpu-dense-grass/`.

## Select Architecture From Population And Projected Error

Choose the representation by visual error and population before choosing
compute:

| Workload | Default | Reason |
| --- | --- | --- |
| One/few close trees | CPU growth compile into indexed typed arrays; optional generated LODs | Topology changes rarely; compute adds runtime state without saving frame work |
| Repeated trees/shrubs | Species mesh/cluster variants instanced in spatial pages, with geometry LOD then impostors | Reuses topology and preserves chunk culling |
| Dense grass/ground cover | Shared strip/clump geometry plus the cheapest proven placement representation: implicit seed reconstruction, clump records, compact CPU attributes, or storage | Avoids object traversal without assuming per-blade hot storage is free |
| Interactive growth or massive regenerated placement | Compute only the changing topology/placement/state, then compact visible records | Compute earns its dispatch through changed data volume |

Do not confuse GPU generation with GPU efficiency. Static vegetation generated
once on the CPU can be the lowest-runtime-cost result.

For dense grass and meadow vegetation, use this architecture before considering any API detail:

1. Partition the field into deterministic chunks with fixed tile seeds, conservative per-patch bounds, and a visible debug overlay for bounds, density, and impostor state.
2. A/B placement storage: reconstruct invariants from
   `{chunkSeed,instanceIndex,shared density/terrain field}`, store clump-level
   records, upload compact worker-generated attributes, or compute-fill
   per-blade storage. Record the actual r185-aligned stride/resident bytes;
   `vec3` may pad to `vec4` and narrow integers may widen.
3. Consume only irreducible per-instance data from a
   `MeshStandardNodeMaterial`/`MeshPhysicalNodeMaterial`; derive the rest from
   shared fields and stable integer hashes.
4. Keep wind, touch response, camera-facing yaw, seasonal wetness, and trampling as dynamic fields. Update only those fields per frame, or evaluate them in the vertex node when it is cheaper than a dispatch.
5. Cull and LOD by patch before draw submission: frustum culling from expanded bounds, distance density tiers, near geometric blades, mid reduced instance density, far clump/impostor cards, and optional compute compaction for high-overlap fields.
6. Use node post only after the geometry budget is under control: `RenderPipeline`, `pass()`, conditional `mrt()` only for consumed signals, `GTAONode` for contact, full-scene `BloomNode` when HDR vegetation emission/lighting requires glare, and `TRAANode` when alpha shimmer needs temporal stabilization. Selective emissive MRT remains a separately proven exception.

The replaced sub-best path is full-field per-frame parameter regeneration. Static blade and clump data are immutable after spawn; only dynamic fields should be refreshed.

## Terrain And Coastal Ecology Contract

Vegetation placement consumes the shared terrain/coast field provider; it does
not synthesize private height, shoreline, slope, moisture, or salt noise. The
provider declares coordinate frame, units, generation revision, filtering,
chunk halo, and invalidation for:

```text
terrain height and geometric normal/slope
signed coast distance and coast tangent/normal
substrate/semantic region, cliff/beach/water and authored exclusions
drainage, cavity, soil moisture, disturbance, and canopy/light exposure
prevailing wind, directional terrain shelter, and salt/spray exposure
run-up/inundation envelope and persistent wetness when supplied
```

Keep hard eligibility separate from ecological preference. Water, active
run-up, unstable cliff, built footprint, path, and authored clearance volumes
are hard exclusions when the species contract says so. Moisture, slope,
salinity, wind exposure, sun, substrate, and elevation feed smooth species
response curves. A stable hashed priority or blue-noise/variable-radius Poisson
process turns suitability into candidates. Independent color noise and density
noise are forbidden.

Windward/leeward distribution is directional. Derive static shelter from the
terrain/obstacle field along the prevailing-wind direction, then combine it
with coast exposure and elevation. Distance from water alone cannot distinguish
an exposed windward headland from a protected leeward hollow. Recompute this
coarse field only when terrain, obstacles, or climate policy changes; the
per-frame wind deformation field is a separate dynamic consumer.

Each plant asset carries a root/ground frame, conservative crown and wind-swept
bounds, clearance radius or footprint, material slots, shadow proxy,
species-response table, growth/age variant, LOD/impostor representations, and
stable semantic ID. Flowers, grass clumps, palms, shrubs, and trees are selected
by species identity first and varied within that identity second. Placement
around ruins, paths, rocks, docks, or instruments consumes their exclusion
volumes and optional colonization sockets; it never infers clearance from the
render mesh at runtime.

Read
[references/coastal-ecology-and-placement.md](references/coastal-ecology-and-placement.md)
for suitability equations, windward/leeward and salt fields, order-independent
placement, chunk seams, succession/asset manifests, LOD population invariants,
and coastal diagnostics.

## Shared Environmental And Interaction Boundary

When vegetation participates in coupled weather, contacts, loading, or water,
first read the router's
[physics-domain and interaction contract](../threejs-choose-skills/references/physics-domain-and-interaction-contract.md).
Consume its `PhysicsContext`, `EnvironmentForcingSnapshot`, receiver-state
signal sample, and `InteractionRecord`; do not author private clocks,
wind/current fields, or contact schemas.

Environmental wind is an air-velocity provider in meters per second with a
declared frame, altitude/support domain, exact `sampleInstant: PhysicsInstant`,
cadence, interpolation policy, requested/actual oriented crown/patch footprint
and spatial/temporal filter or band, and per-channel error. Vegetation owns only
the structural response: modal trunk and
branch state, leaf flutter, damping, root constraints, bounds, and LOD
projection. Water current and water-surface velocity are different providers.
Static prevailing-wind exposure used by ecology is a climatological reduction
sampled at an exact `PhysicsInstant` with its own revision; it is not the
instantaneous deformation sample.

Consume trampling, sweep, support-load, and impact events as typed
`InteractionRecord`s. Use stable source/receiver IDs, an
`applicationInterval: PhysicsTimeInterval`, SI-physics-frame footprint/impulse
or load units, deterministic ordering keys, canonical source/target ownership,
`SurfaceExchange.mode`, reaction-group identity, and batch/partition identity.
Keep sequence ranges, consumer cursors, overflow, and lost/deferred commodities
in the canonical immutable `InteractionBatchLedger`; coalescing is a producer
transformation with provenance. Before a completed record changes trampling,
sweep, support-load, impact, touch, or structural state, the vegetation stage
resolves its `applicationLedgerKey` to a canonical
`InteractionApplicationLedger`. The row binds the current
`PhysicsStageExecution`, exact declared interval and execution overlap, payload
time semantics and applied integral/fraction, target patch/entity/equation and
expected state version, cursor before/after, prepared version, commit
transaction, disposition, `applicationContentDigest`, and `receiptDigest`. Only
a `committed` receipt authorizes the state advance; rate payloads integrate over
their exact overlap and interval-integrated payloads commit once. Duplicate or
replayed, disjoint, deferred, and rejected rows do not mutate touch/load state.
The ledger ID resolves from the batch and route inventories and appears in the
stage execution, `StateAdvanceClaim`, accepted coupling iteration when present,
and atomic commit lineage; a record or cursor advance alone is not application
authority. Bin sparse records into affected
patches, update the contact/touch state after physics contact resolution, then
evaluate structural wind/contact deformation and commit domain state over the
declared `PhysicsGraphStage.executionInterval: PhysicsTimeInterval`. The
coordinator records each attempted structural update or analytic/state-hold
evaluation as an exact `PhysicsStageExecution`; vegetation cannot infer
execution or publication eligibility from a compute submission alone. Dropped
debt remains in the graph catch-up loss ledger.

Contribute each stable deformation binding as a `PresentedStatePair` to one
view-independent `PhysicsPresentationCandidate` at
`requestedPresentationInstant: PhysicsInstant`; the candidate owns the
`PresentationResourceLease` records and consumer-scoped event sequence ranges.
Each pair's `previousPresented.provenance` and
`currentPresented.provenance` are independent
`PresentationSampleProvenance` records;
`previousPresented.presentedInstant: PhysicsInstant` and
`currentPresented.presentedInstant: PhysicsInstant` remain distinct, as do
their state handles and global spatial bindings. A shared pair-level provenance
shorthand is forbidden.
The candidate contains no camera or render transform. The camera owner publishes
one `CameraViewPublication` per target/view with
`previousRenderSampleInstant: PhysicsInstant` and
`currentRenderSampleInstant: PhysicsInstant` plus
`globalToRenderPrevious`/`globalToRenderCurrent`, view/projection matrices,
jitter, viewport, and depth state; visibility, acceleration, shadow, cache,
reactive, and reset owners then publish
`ViewPreparationPublication` with `visibilityPublicationRefs`,
`accelerationPublicationRefs`, `shadowViewPublicationRefs`,
`cachePublicationRefs`, `reactiveEpochs`, `reactivePublications`,
`resetDependencies`, full `resourceLeases` for newly created camera-dependent
generations, and `resourceLeaseRefs`. The sealed
`PhysicsPresentationSnapshot` names the candidate, camera/preparation
publications through `candidateId`, `cameraPublicationId`, and
`viewPreparationId`, plus `presentationTargetId`, `viewId`, and `sealVersion`;
its state/resource payload is only `presentedStatePairRefs` and
`resourceLeaseRefs`, accompanied by scoped `eventSequenceRanges`, never copied
pairs or transforms. Never mutate immutable placement or publication records. One-way
visual deformation uses a one-way exchange and emits no reaction record;
two-way coupling leaves the matched reaction to the authoritative physics
solver.

Wetness, run-up, snow load, and melt are consumed from the route-selected
receiver-state owner at an exact `PhysicsInstant` after it integrates all
exchanges. Vegetation and its materials do not create independent accumulation
fields. On budgeted/mobile tiers retain analytic vertex wind, compact sparse
interaction records, bounded dirty patches, lower-rate receiver fields, and
explicit stream-loss/per-channel-error accounting.

A tier change that alters physics-facing state, cadence, represented support or
band/filter, error bounds, inventories, stable IDs/RNG streams, or event and
exact-once application-ledger cursors requires the shared `QualityTransition`:
request it, conservatively map and atomically commit it at a safe graph-step
boundary, then retire the old state through its completion join. A change may
remain vegetation-local only when it is render-only and leaves every provider,
`PhysicsGraph` ownership, interaction, committed state, ID, cursor, and physical
error contract unchanged.

## Capability Gate And Tiers

Initialize the renderer before allocating storage resources:

```js
import { WebGPURenderer } from "three/webgpu";

const renderer = new WebGPURenderer({ antialias: false });
await renderer.init();

if (renderer.backend.isWebGPUBackend !== true) {
  throw new Error('WebGPU backend unavailable for the canonical vegetation path.');
}
```

Quality tiers are product tiers, not alternate shader stacks:

| Tier | Capability | Vegetation path | Acceptance axis |
| --- | --- | --- | --- |
| Full | Native WebGPU | selected CPU/implicit/storage placement, dynamic wind/contact fields, spatial culling, density LOD, impostors | close silhouette, interaction, and motion-error gates all pass |
| Balanced | Native WebGPU with lower bandwidth | implicit/compact static placement, vertex-node wind, reduced post and density | projected blade/canopy and motion error pass |
| Budgeted | Native WebGPU | packed/coarser storage, fewer dynamic fields, larger pages and earlier impostors | whole-frame, memory, alpha-overdraw, and transition gates pass |
| Minimum | Native WebGPU minimal graph | authored tree meshes, sparse grass cards, impostor rings, static wind phase | primary silhouette/species identity remains above the declared error floor |

If the user explicitly asks how to apply fallback when WebGPU is unavailable,
route that teaching to `../threejs-compatibility-fallbacks/` instead of adding
a second path here.

## Dense Grass Build Order

1. Choose patch/page size from the measured culling-versus-submission
   crossover, not texture dimensions or a copied meter/blade count. Budget
   submitted work as `visibleDraws = drawObjectsPerPage * visiblePages`, then
   include rejected-but-submitted vertices and alpha fragments.
2. Select implicit/clump/compact-CPU/per-blade-storage placement by paired A/B.
   If storage wins, derive the real post-init stride, allocator bytes, duplicate
   LOD records, and hot vertex reads. Packing is explicit and capability-tested;
   it is not implied by authoring a narrow JS typed array.
3. Deterministic placement uses one specified u32 mixer with wraparound/bit
   semantics and CPU test vectors shared by CPU/TSL. Float `sin` hashes are only
   same-adapter visual variation. Compute initialization is optional and never a
   GPU-completion claim from `computeAsync()`.
4. Use the same terrain field, density mask, path mask, and clump field for placement, material variation, and LOD thresholds. Do not let visual color clumps drift from density clumps.
5. Render blades with a shared low-vertex strip or clump mesh. Fold the blade in the vertex node with Bezier or circular-arc math from root to tip; keep the root anchored in both color and shadow passes.
6. Update dynamic fields on a fixed budget: wind vector texture or storage buffer, gust-front phase, contact/interactor history, wetness, snow weight, and seasonal color scalar.
7. Submit only visible chunks. Each chunk owns expanded bounds for maximum blade height, terrain displacement, and wind bend. Never make one monolithic uncullable grass object the production default.
8. Transition by patch under the
   [shared physical-pixel error contract](../threejs-choose-skills/references/projected-error-contract.md).
   Trees use world-up-constrained multi-azimuth/octahedral impostors, adding
   depth/normal for relighting/parallax when required; one free-facing sprite
   is insufficient for structured crowns. Use dither/hysteresis/dwell and a
   matched shadow proxy.

Use queued `renderer.compute()` only when compute placement/state wins the A/B.
In r185 `computeAsync()` merely awaits renderer initialization before enqueue;
it is not a GPU-completion fence.

The dense-grass fixture allocates one matrix-free instanced blade mesh and one
impostor-card mesh per patch, but mutual exclusion submits at most one
representation per visible patch. Its **Derived** worst vegetation submission
is therefore `visiblePatchesWorst`; allocation count is still
`2 * patchCount`. Those fixture counts are structural evidence for that
example, not a recommended page size, blade density, or submission ceiling.

Per-patch draws are a culling baseline, not an invariant. If worst-case visible
patch draws exceed the target's measured CPU submission ceiling, aggregate
adjacent patches into larger spatial pages or use compute compaction with an
indirect count. A vertex-stage visibility mask that still processes every
blade is not culling. Select page size from the measured trade between
overdraw/over-submission and culling granularity.

## Creature Composition

Vegetation and creatures consume the same `EnvironmentForcingSnapshot` air
velocity but own different structural response models. Creature stance/contact
resolution publishes typed `InteractionRecord`s; vegetation applies only
records with matching committed `InteractionApplicationLedger` receipts into
its dynamic touch texture or compact patch storage before blade
deformation. The current WebGPU dense-grass example exposes only wind uniforms
and static density storage, so it is not evidence that contact ingestion is
implemented. A production route must instantiate the shared record adapter,
dynamic touch resource, scheduler edge, overflow diagnostic, and immutable
static-placement invariant.

## r185 Add-On Import Paths

Use these exact add-on paths when vegetation needs built-in post or shadow helpers:

| Helper | Import path |
| --- | --- |
| `GTAONode` / `ao` | `three/addons/tsl/display/GTAONode.js` |
| `BloomNode` / `bloom` | `three/addons/tsl/display/BloomNode.js` |
| `TRAANode` / `traa` | `three/addons/tsl/display/TRAANode.js` |
| `CSMShadowNode` | `three/addons/csm/CSMShadowNode.js` |
| `TileShadowNode` | `three/addons/tsl/shadows/TileShadowNode.js` |

## Trees And Plant Growth

Represent a plant as a growth hierarchy plus rendering adaptations. Do not model it as randomly scattered cylinders.

1. Define a per-level species table: length, radius, taper, child count, emergence range, angle, twist, gnarliness, sections, radial segments.
2. Grow branches iteratively from a queue so recursion depth and budgets remain inspectable.
3. Emit each branch as oriented rings with an intentional UV seam, or route generic ring writing to `$threejs-procedural-geometry`.
4. Update section orientation from inherited direction, stochastic curvature, tropism or external force, and optional attraction constraints.
5. Spawn children with stratified longitudinal slots and independently permuted angular slots.
6. Generate leaves only after branch topology is stable.
7. Build foliage normals from card orientation plus local crown volume; for high-density leaf fields, store per-leaf root, card basis, bend phase, and alpha cutoff in storage attributes.
8. Choose wind scope explicitly. Leaf-root deformation, branch hierarchy deformation, trunk sway, and whole-tree motion are separate systems and must share the same visible and shadow deformation.
9. Production branches use rotation-minimizing quaternion frames plus explicit
   twist, arc-length/feature-scale curvature limits, and a species-calibrated
   pipe/allometry law `r_parent^p >= r_cont^p + sum(r_child^p)`. Hero junctions
   cut at the parent surface and stitch a collar/zipper patch or use load-time
   implicit extraction; mid/far overlap removes hidden caps and gates the seam.
10. Production wind is a reduced-order hierarchy of damped trunk/branch modes
   driven by the shared field, with higher-band leaf flutter. Collapse modes by
   LOD and use identical display/shadow deformation.

Read [references/structured-ash-growth-system.md](references/structured-ash-growth-system.md) before tuning Ash-like deciduous trees. Preserve its preset, continuation, child-placement, leaf, material, wind, composition, diagnostic, and numeric contracts.

## Materials, Alpha, And Output

- Use `MeshStandardNodeMaterial` for grass and bark and
  `MeshPhysicalNodeMaterial` when leaf translucency/wax response matters.
  `SpriteNodeMaterial` is acceptable only inside a validated multi-view far
  impostor representation, not as a single rotating tree card.
- Use `alphaTest` or `alphaHash` for leaves and grass. Avoid sorted transparency for dense vegetation unless the asset truly needs partial glass-like blending. Use `forceSinglePass` for double-sided flat vegetation when it removes redundant back-side work without visible loss.
- Deform shadow casters with the same node math as visible geometry. If the wind root is at `uv.y = 0`, both color and shadow geometry must keep that root fixed.
- LDR bark, leaf, flower, and albedo atlases encoded as sRGB use
  `SRGBColorSpace`; HDR/EXR radiance remains loader-declared linear. Data maps
  such as normal, roughness, density, alpha, path, clump, wind, LUT, and weather
  masks use `NoColorSpace`/linear data. Disable mip generation only when compute
  writes all mip levels or the map is sampled without minification.
- Keep HDR buffers as `HalfFloatType` until tone mapping. The app has one tone-map owner and one output conversion owner through `RenderPipeline.outputColorTransform` or an explicit `renderOutput()` node.
- Start from the cheapest ordinary directional shadow that meets coverage and
  texel-error gates. Route CSM, tiled arrays, or custom cached clipmaps through
  `$threejs-scalable-real-time-shadows`; `TileShadowNode` is not a generic
  large-scene or tile-GPU optimization.

## Performance Contract

State the workload before implementation: visible spatial pages/patches,
instances per representation, blade/card pixels, mean and p95 alpha layers,
shadowed instances, dynamic-field texels, dirty interactions, draw objects,
storage stride, and post attachments. Instance count without projected alpha
coverage is not a vegetation cost model.

For terrain/coastal placement also record accepted/rejected candidates by
cause, species suitability distributions, overlap/clearance violations, chunk
halo work, coast/slope/moisture/salt field samples, static shelter-bake cost,
LOD population change, and resident bytes for species/asset manifests. These
are compile/update costs unless the placement actually changes every frame.

Storage budget targets:

- Static grass attributes: derive `instanceCount * alignedStrideBytes` from the
  actual packed layout and include duplicate LOD/impostor records.
- Dynamic fields: sum exact wind/contact texture or storage extents, formats,
  history slots, dirty update traffic, and cadence per active region.
- Tree geometry: compile once into typed buffers; do not allocate vector objects in runtime wind or per-frame LOD loops.
- Node post: one scene pass with `mrt()` when normals/depth/emissive are reused, reduced-resolution AO/bloom via `setResolutionScale()`, and no duplicate scene re-render for diagnostics unless explicitly requested.

Allocate vegetation cost from the whole frame and accept with contemporaneous
full-frame and paired-marginal p50/p95 GPU time, CPU submission, visible/culled
instances, alpha fragments, hot traffic, peak resident/transient bytes, and
thermal behavior. On low-power/tile targets first reduce invisible submission,
alpha coverage, shadow representation, and dynamic-field bandwidth while
preserving the primary silhouette/species contract.

## Diagnostics And Failure Conditions

Capture diagnostics as first-class views: patch bounds, density LOD, impostor transitions, static versus dynamic storage fields, clump ids, terrain height/normal fit, signed coast distance, hard exclusions, species suitability, wind exposure/shelter, salt exposure, moisture, accepted candidate priority, clearance conflicts, wind displacement magnitude, alpha coverage, shadow parity, leaf origins, branch-level colors, bark UV checker, and final composition.

Visual failures:

- branches form visible helices;
- dense grass ignores terrain height, path masks, or clump-level variation;
- static blade parameters regenerate every frame;
- chunks outside the frustum still dominate submitted draw work;
- every child emerges at the same relative height;
- bark texture scale changes unintentionally with branch radius;
- leaves reveal flat card normals under rotation;
- leaf or grass wind moves roots instead of keeping them anchored;
- visible vegetation and shadow vegetation deform differently;
- different seeds change species identity rather than controlled variation;
- geometry cost grows without per-level, per-chunk, and named-target evidence.
- coast-distance rings replace a real ecology response, windward and leeward
  sides receive identical populations despite a directional exposure contract,
  or vegetation occupies active run-up/unstable cliff/building exclusions;
- chunk generation order changes accepted plants, neighboring chunks disagree
  at seams, or density LOD causes the apparent biome boundary to migrate;

## Routing Boundary

Use `$threejs-procedural-geometry` for generic branch-ring emission without a growth model. Use `$threejs-procedural-fields` for shared terrain, coast, exposure, density, weather, and biome fields. Use `$threejs-procedural-materials` for authored bark/leaf/grass PBR identities. Use `$threejs-water-optics` for run-up/inundation/shore signals when water is their causal owner; vegetation consumes those signals but does not solve water. Use `$threejs-scalable-real-time-shadows` for custom shadow clipmaps beyond `CSMShadowNode` or `TileShadowNode`. Use `$threejs-image-pipeline` when the vegetation scene owns the final HDR, AO, bloom, temporal AA, and output-transform stack.

This skill owns species tables, topology, child placement, foliage, grass fields,
roots, chunked dense vegetation, static/dynamic storage separation, and
hierarchical/rooted structural response. The routed environment owner supplies
air velocity; the authoritative contact solver supplies interaction records.
