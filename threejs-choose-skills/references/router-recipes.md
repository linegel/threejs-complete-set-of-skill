# Router Recipes

These are routing proofs, not presets. Each route still requires the mandatory
backend/API preflight and a populated `{ value, unit, label, source }` record for
every reported number. `routeStatus: provisional` means no performance verdict
exists until the composed route passes `[Measured]` CPU/GPU/presentation p50 and
p95, memory, error, and sustained-state gates on its target matrix.

The eight physical-route fences under the archipelago, ocean, rain, forest, and
external-solver sections are deliberately labelled `text`: they are compact,
non-serializable routing sketches, not strict YAML and not accepted manifests.
Their prose macros, symbolic refs, and compact records MUST be expanded before
emission. The final emitted manifest MUST validate against
`physics-domain-and-interaction-contract.schema.json` and pass
`examples/router-contract.test.mjs`; a sketch's `canonicalExpansion: required`
is an explicit incompleteness marker, never evidence of closure. In these
sketches, `TypedAbsence(reason, authority, effectiveTime, provenance)` is only a
readability macro and expands to the six-field record `{ kind: absent, reason,
authority, schemaId: typed-absence-v1, effectiveTime, provenance }`.

`sharedResourceOwners` is the compatibility projection required by existing
route tooling. `not used` means no allocation. The keyed signal registries are
authoritative.

For compactness, `passKeys` below names the unique runtime work. The emitted
manifest expands each key into the canonical view-scoped `passRecord`, supplies
`costRecords`, and instantiates the hysteretic `qualityController`; a key is
counted once regardless of how many skills consume it.

Any route in which physical domains exchange sampled state, flux, impulse,
contact, environmental forcing, or radiometric transport instantiates the
[physics domain and interaction contract](physics-domain-and-interaction-contract.md).
Its emitted manifest contains exactly one `PhysicsContext`, one ordered
`PhysicsGraph`, typed `PhysicsSignalDescriptor` entries, explicit
`SurfaceExchange`/`InteractionRecord` edges for every active exchange, and one
immutable `PresentationTimeCohort`, one view-independent
`PhysicsPresentationCandidate`, then one
`CameraViewPublication`, one `ViewPreparationPublication`, and one sealed
`PhysicsPresentationSnapshot` plus `PresentationRenderPlan` per selected
target/view before frame/slot admission;
`physicsInteractions: []` is explicit when no event or conserved exchange
exists. Each signal and exchange has one producer; a manifest selects one
coupling policy instead of hiding alternatives behind `optional`, `or`, or a
multi-value enum. Hot interaction batches compile
to bounded packed SoA storage with deterministic ordering; overflow/drop facts
live in the exchange-owned canonical `InteractionBatchLedger`, never in a
`PhysicsSignalDescriptor` dialect, and steady presentation never reads them
back.
Every active physical route also emits `PhysicsCostLedger`; compact recipe
summaries may name required evidence, but cannot omit coordination-interval,
per-second, catch-up, critical-path, hot-byte/traffic, multiview, migration-
overlap, and sustained-target accounting from the final manifest.
Every provider response resolves its `errorPropagationLedgerRef` through the
route's `physicsErrorPropagationLedgers`; every accepted interaction resolves
one exact `InteractionApplicationLedger`. Neither error nor exact-once
application may live only in prose or a domain-local queue.
Post-commit domains publish one camera-free `PhysicsPresentationCandidate` made
of per-binding/provider `PresentedStatePair` entries, leases, and event ranges.
Each camera owner derives a `CameraViewPublication`; visibility, shadows, and
caches consume both prior records and emit a `ViewPreparationPublication`; only
then may the route seal a snapshot containing exact refs to all three. Execution
and completion mutate none of them and append one multi-target,
lease-disposition-keyed `FrameExecutionRecord`.
Compact camera `jitter` wording expands to independent previous/current jitter
samples plus one immutable jitter-sequence revision; a current-only sample is
not a temporal contract.

For compactness, `PhysicsSignalDescriptor<T>` below is a typed reference. The
emitted manifest expands it with `signalId`, `providerId`, `schemaId`,
`contextId`, `owner`, `consumers`, `channels`, `physicsFrameId`,
`physicsOriginEpoch`, `transformRevision`, optional `chartId`, `clockId`,
`samplePhase`, represented footprint/filter, validity, per-channel error,
residency, cadence, latency, state version, resource generation, and missing-
channel policy. Exact samples use `PhysicsInstant`; applications and exchanges
use nonempty half-open `PhysicsTimeInterval`; a generic boundary uses the
discriminated `PhysicsTime` union only when it genuinely accepts either.
Every instant carries its canonical rational, clock-mapping revision,
discontinuity epoch, and derived seconds. Every route registers fixed,
timestamp-table, piecewise, or external clock mappings and their coordination
map/error; free-running duplicate seconds and tick-only interval shorthand are
forbidden.
The `PhysicsGraph` stage summaries below expand into canonical stage/edge
templates with owners, read/write version rules, sample phase, native stepping
rule, residency, dependencies, absence/failure policy, and concrete
`PhysicsStageExecution` rows with exact intervals, resolved versions, claims,
and `PhysicsDependencyCompletion` receipts. One graph-wide
`PhysicsCatchUpBatch` owns debt/drop/discontinuity. Feedback appears only as a
declared bounded loop macro whose writes remain provisional. Externally
sampleable versions pass through transaction-private prepared publications and
one bijective `PhysicsCommitReceipt`; pass order is not solver order.

Every `SurfaceExchange` uses ordered source-to-receiver endpoints, nonnegative
transferred mass, receiver-directed SI vector impulse/momentum in the stable
physics frame, an explicit support measure/Jacobian, and exactly one `rate` or
`interval-integrated` transfer form for transported commodities. Kinematic
`movingBoundary` and algebraic `constraintTarget` arms instead use their exact
state/algebraic-over-interval semantics and carry no invented rate/integral.
Reversing an exchange swaps endpoints; signed mass
is not a second encoding. Sparse visual samples reference the parent exchange
and cannot apply its conserved quantities again.
Every `InteractionRecord` carries stable interaction and causal-parent IDs,
one canonical `applicationInterval: PhysicsTimeInterval`, physics frame/origin
epoch/transform revision, source/target owners and
generation-bearing IDs, source/expected-target state versions, a tagged
dimensioned payload with its canonical time semantics, exact
`InteractionFootprint` distinguishing physical-weight intensive quadrature
from inverse-measure normalized distribution kernels, target state equation, source/reaction role and
`reactionGroupId` plus `reactionToInteractionIds`, conservation groups,
exact-once/application keys, validity/error, and provenance. Many-to-many
source/reaction topology uses one canonical `InteractionReactionGroup`. The
optional `InteractionPartitionMembership` plus parent/partition records prove
that physical-impact children are disjoint and close to one parent; visual
children carry no application authority. The target owner records every
prepared/committed/deferred/duplicate disposition in
`InteractionApplicationLedger`. The
canonical exchange-owned `InteractionBatchLedger`—not a physics signal and not
surviving records—owns batch/exchange/producer IDs, published sequence range,
per-consumer cursors, accepted/rejected/late/duplicate counts, overflow policy
and ranges, typed `lostCommodities`/`deferredCommodities`, and the exact-once
ledger version. Unrepresented commodities are absent from those maps; sampled-
signal `absentChannels` is never copied into an interaction ledger.
The compact exchange entries below show the route-selected owner, mode,
descriptor bindings, payload tags, target equations, coupling gate, and
conservation groups. The emitted manifest expands every omitted invariant field
from the canonical `SurfaceExchange` and `InteractionRecord` schemas; these
snippets do not define local dialects.
The image quality governor emits only `QualityChangeRequest`. The physics
coordinator may admit it as `QualityTransition` at the route's declared commit
barrier after migration and rollback resources exist; render code never changes
solver resolution, extent, representation, or cadence during a physics stage.
Each recipe maps every selected skill's local quality names into route
`Full`/`Budgeted`/`Minimum viable` tiers in
`performanceContract.skillTierCrosswalk`; identical labels do not imply
identical equations or error. An unresolved local-tier mapping blocks the route;
the crosswalk names every selected skill, the local state used at each route
tier, protected invariants, and any unavailable mapping.

## stylized coastal archipelago

Input brief: the supplied isometric archipelago reference family: compact
islands with grass caps, terraced rock cliffs, beaches, shallow turquoise
bathymetry, deep-blue open water, shore-aligned foam, reefs and rocks, plus
constrained vegetation, ruins, docks, boats, and optional foreground clouds.

minimal skill set: the first emitted manifest below is the bounded analytic
coastal route; later manifests are explicit spectral, authored-vessel, and
causal-weather/external-body alternatives rather than hidden modes.

This is one coupled land-water-asset problem. It is not “terrain plus a blue
material.” The land field owns the coastline and seabed; semantic geometry
compiles that field; water consumes the same coast and bathymetry; asset
grammars consume support, slope, exposure, and exclusion fields. See the
[coastal archipelago system](../../threejs-water-optics/references/coastal-archipelago-system.md)
for the solver and data-interface decision tree.

### Reference decomposition and route variants

| Observable in the reference family | Earliest owner | Required causal signal |
| --- | --- | --- |
| recognizable island outline and negative-water channels | `$threejs-procedural-fields` | signed land/coast field with deterministic seed and world-unit support |
| stepped cliffs, grass cap, beach shelf, exposed rock faces | `$threejs-procedural-geometry` | elevation, terrace ID, coast distance, slope, curvature, and semantic boundary loops |
| grass, sand, dry/wet rock, seabed and reef separation | `$threejs-procedural-materials` | material-region IDs plus continuous moisture, depth, exposure, and roughness causes |
| shoal color, depth attenuation, refraction, local ripples and shore response | `$threejs-water-optics` | bathymetric depth, land mask, coast frame, surface state, optical thickness, and foam state |
| horizon-scale stochastic wave spectrum | `$threejs-spectral-ocean`, conditional | disjoint open-water spectra and a declared nearshore handoff; never force a periodic deep-water FFT through land |
| orthographic/isometric composition and overview-to-coast scale hierarchy | `$threejs-camera-controls-and-rigs` | exact projection, immutable bookmarks, depth convention, framing envelope, and transition policy |
| palms, conifers, flowers and grass clusters | `$threejs-procedural-vegetation`, conditional | support height/normal, coast distance, slope, salt exposure, moisture, wind exposure, and exclusion masks |
| ruins, docks and authored landmark kits | `$threejs-procedural-buildings-and-cities`, conditional | stable parcel/anchor frames, sockets, access direction, support footprint, material slots, and clearance masks |
| framing clouds or horizon haze | cloud/atmosphere owner, conditional | only when the shot contract includes volumetric depth; a blurred screen sprite is not atmosphere evidence |

For a bounded isometric shot, select analytic multi-band open water plus a
coast-aware bounded response in `$threejs-water-optics`; defer
`$threejs-spectral-ocean`. Select the spectral owner only when the viewing
envelope actually exposes horizon-scale stochastic wave statistics. For a
local archipelago, omit `$threejs-procedural-planets`; load it only when body
curvature, spherical LOD, or orbit-to-surface continuity is observable.

The skill route does not manufacture a coherent prop library from nothing.
Provide tested procedural modules or a licensed compact kit for the asset
families the composition requires:

| Supplemental family | Minimum production contract |
| --- | --- |
| coast geology | terrace/cliff profiles, boulders, shoreline rocks, pebbles, submerged shelf and reef modules with compatible material regions |
| ecology | species silhouettes for palms/conifers/grass/flowers or the requested biome, plus growth anchors and accepted coast/slope/exposure ranges |
| landmarks | ruin wall/corner/arch/cap modules, dock deck/post/ladder modules, boats/wreckage, and authored hero variants where reference identity matters |
| surface detail | filtered water micro-normal or spectrum inputs, foam breakup only as modulation of a causal foam field, caustic pattern or generator, wet-line/detail decals, and compressed material textures when procedural evaluation loses the target-device A/B |
| framing | lighting/environment source and, only for the shown foreground occlusion, low-cost cloud cards or a justified volumetric cloud setup |

Every asset or generator variant carries a stable ID and schema/generator
version; bounds and pivot; support footprint; anchors/sockets; keep-out volume;
accepted semantic surfaces and environmental ranges; material slots;
projected-error LODs or impostors; culling, shadow, collision/picking policy;
and water interactions such as obstacle, foam source, wake source, wetness
receiver, or caustic receiver. Missing required families are blockers, not
permission to substitute arbitrary boxes or independent noise.

Analytic-phase route variant for the supplied fixed/perceptual reference family:

```text
backendManifest: "populate required [Gated] and observed [Measured] fields from canonical preflight"
workloadProfile:
  domain: cinematic-art
  intent: present
  truthContract: perceptual-style
  representation: hybrid
  interaction: fixed-view
  temporal: deterministic-animation
  scale: city-terrain
  topology: procedural-unique
  viewPattern: overview-to-detail
  deployment: "named physical desktop-discrete, integrated, and low-power/mobile WebGPU targets"
causeLedger:
  sourceOfTruth: deterministic island/coast/bathymetry field graph, water-state policy, asset grammars, and supplied reference feature ledger
  primaryObservable: coherent island silhouettes and shallow-to-deep water whose bathymetry, foam, and assets remain registered at every accepted view and quality state
  earliestMissingLayer: field
  selectedAlgorithm: shared coastal fields compiled to semantic land geometry; $threejs-water-optics owns build-time bathymetry-conditioned travel-time phase, resolved displacement, derivative-filtered unresolved normal bands, coast-registered foam, and depth-aware compositing; vegetation and site owners compile constrained asset populations
  rejectedAlgorithms:
    - independent terrain and water noise: cannot keep shoreline, seabed, foam, and placement registered
    - unconstrained blue transparent plane: cannot produce bathymetric color, coast response, wet line, or local obstruction
    - periodic deep-water FFT across islands: has the wrong boundary and depth model for the nearshore domain
    - full fluid simulation everywhere: spends state and bandwidth outside observable active water and is not justified by a perceptual fixed-view contract
    - post-painted foam and caustics: cannot follow world-space coast geometry, depth, occluders, or temporal flow
  noPostBaseline: island silhouette, semantic terrain bands, water depth ordering, coast registration, and asset placement read without bloom, grading, AO, or depth blur
selectedSkills:
  - $threejs-procedural-fields
  - $threejs-procedural-geometry
  - $threejs-procedural-materials
  - $threejs-water-optics
  - $threejs-procedural-vegetation
  - $threejs-procedural-buildings-and-cities
  - $threejs-camera-controls-and-rigs
  - $threejs-image-pipeline
  - $threejs-visual-validation
primaryOwner: $threejs-procedural-fields
deferredSkills:
  - $threejs-spectral-ocean: load only for an accepted horizon/open-water spectrum branch
  - $threejs-sky-atmosphere-and-haze: load only when aerial depth is observable
  - $threejs-volumetric-clouds: load only when clouds are volumetric scene subjects
  - $threejs-procedural-motion-systems: load for authored boat or prop trajectories, not for water evolution
omittedSkills:
  - $threejs-procedural-planets: local planar islands do not require a spherical body
  - $threejs-bloom: no causal HDR-emission requirement in the reference family
  - $threejs-ambient-contact-shading: ordinary lighting/material separation is proven first; AO remains an evidence-gated consumer
owners:
  sourceOfTruth: $threejs-procedural-fields
  representation: semantic terrain plus vegetation/building grammars
  spatialFrame: project world frame with one shared coast/bathymetry transform plus $threejs-camera-controls-and-rigs projection ownership
  timebase: one deterministic analytic phase clock; no simulation interpolation
  semanticIds: terrain region, water regime, island, prop, vegetation, and landmark registries
  selectionPicking: not used unless the product contract requests it
  clipSection: not used
  presentation: $threejs-image-pipeline
  validation: $threejs-visual-validation
requiredSignals:
  sceneColorRegistry:
    design-view: { producer: shared opaque scene pass, consumers: [water optics, presentation] }
  depthRegistry:
    design-view: { producer: shared opaque scene pass, consumers: [water thickness/occlusion, diagnostics] }
  normalRegistry: not used by post until a named consumer is accepted
  velocityRegistry: not used unless a temporal image estimator is accepted; water simulation velocity remains a domain signal
  objectIdRegistry: not used unless picking or semantic outlines are requested
  historyRegistry: not used
domainSignals:
  landSignedDistance: { physicsSignal: landSignedDistanceSignal, producer: $threejs-procedural-fields, consumers: [terrain compiler, beach bands, water boundary, foam source, asset exclusion] }
  terrainElevationAndRegions: { physicsSignal: terrainElevationAndRegionsSignal, producer: $threejs-procedural-fields, consumers: [terrain geometry, materials, anchor compilation, placement-factor consumers] }
  bathymetryAndCoastFrame: { physicsSignal: bathymetryAndCoastFrameSignal, producer: $threejs-procedural-fields, consumers: [water regime selection, optics, breaking/foam, validation] }
  terrainMesh: { producer: $threejs-procedural-geometry, consumers: [scene pass, geometry validation] }
  terrainAnchors: { producer: $threejs-procedural-geometry, consumers: [vegetation/site placement compilers, validation] }
  waterState: { physicsSignal: waterSurface, consumers: [water geometry, normals, optics, foam, validation] }
  assetPlacement: { producer: vegetation/building grammar owners, consumers: [scene pass, validation] }
physicsContext:
  type: PhysicsContext
  producer: route physics coordinator
  consumers: [$threejs-procedural-fields, $threejs-procedural-geometry, $threejs-water-optics, $threejs-image-pipeline, $threejs-visual-validation]
  invariant: one finite positive metersPerWorldUnit is the sole world-to-physics scale boundary; provider state remains SI in a stable right-handed physics frame; typed gravity; coast transform; floating-origin epoch; generation-bearing entity/material IDs; analytic time origin
physicsGraph:
  type: PhysicsGraph
  producer: route physics coordinator
  coordinationInterval: nonempty PhysicsTimeInterval on analytic-coordination-clock
  clocks:
    analyticCoordinationClock: { type: PhysicsClockDescriptor, clockId: analytic-coordination-clock, owner: route physics coordinator, mappingRevision: analytic-clock-map-v1, discontinuityEpoch: analytic-clock-continuity-v1, mappingKind: fixed-rational, mapping: { fixedRational: { epochTick: route-start integer, epochRationalSubstep: canonical zero rational, epochSeconds: labelled exact epoch seconds, secondsPerTick: positive exact reduced rational }, timestampTable: TypedAbsence(not-applicable, route physics coordinator, route interval, fixed-rational selected), piecewiseVersioned: TypedAbsence(not-applicable, route physics coordinator, route interval, fixed-rational selected), external: TypedAbsence(not-applicable, route physics coordinator, route interval, fixed-rational selected) }, pauseSeekPolicy: seek recomputes analytic state and increments discontinuity epoch when continuity is not proven, timeScalePolicy: fixed physical scale, coordinationClockMap: identity-with-zero-error }
    presentationClock: { type: PhysicsClockDescriptor, clockId: presentation-clock, owner: route presentation scheduler, mappingRevision: presentation-clock-map-v1, discontinuityEpoch: presentation-clock-continuity-v1, mappingKind: external, mapping: { fixedRational: TypedAbsence(not-applicable, route presentation scheduler, presentation interval, external selected), timestampTable: TypedAbsence(not-applicable, route presentation scheduler, presentation interval, external selected), piecewiseVersioned: TypedAbsence(not-applicable, route presentation scheduler, presentation interval, external selected), external: { adapterId: presentation-clock-adapter, adapterVersion: route build, mappingHandle: presentation-clock-map-v1, coveredInstantRange: exact presentation interval, frozenEvaluationTable: content-addressed accepted evaluations, onlineQueryProtocol: instant/request-response/revision/digest-v1, unloggedQueryPolicy: reject, error: typed bound } }, pauseSeekPolicy: presentation discontinuity policy, timeScalePolicy: no physics time-scale authority, coordinationClockMap: versioned map with bounded error to analytic-coordination-clock }
  stageParameters:
    analyticSampleInstant: { type: PhysicsInstant, clockId: analytic-coordination-clock, tick: canonical integer, rationalSubstep: canonical reduced rational, clockMappingRevision: analytic-clock-map-v1, discontinuityEpoch: analytic-clock-continuity-v1, timeSecondsDerived: exact mapped quantity; never accumulated }
  stages:
    - ingest: latch PhysicsContext, terrainSupport, bathymetry/coast fields, analytic-wave parameters, and pending quality request
    - sample-forcing: sample immutable terrain/coast providers at analyticSampleInstant
    - predict: write provisional analytic displacement, derivatives, optics inputs, and foam source without persistent solver state
    - emit-interactions: no InteractionRecord or SurfaceExchange is emitted by this selected route
    - solve-subcycles: not used because the selected water representation is analytic and stateless
    - reduce-reactions: no reaction group exists
    - correct: validate provisional finite state, coast/bathymetry registration, filtering, and visual-error gates
    - commit: publish only accepted terrain/water versions through analytic-state-commit-group at the coordination-interval boundary; a prepared QualityTransition uses its own commit group
    - publish-presentation: publish the camera-free PhysicsPresentationCandidate from committed versions; per-view camera and preparation records are later phases
  loopMacros: []
  commitGroups:
    - { commitGroupId: analytic-state-commit-group, owner: route physics coordinator, interval: coordinationInterval, provisionalVersions: [terrainSupport.provisional, waterSurface.provisional], committedPublications: [terrainSupport.committed, waterSurface.committed], stateEquationOwners: { terrain-support: $threejs-procedural-geometry support adapter, analytic-water-surface: $threejs-water-optics }, conservationAndErrorGates: [finite-state, coast-registration, analytic-water-error], preparedPublications: canonicalExpansion(required complete PhysicsPreparedPublication records for every provisional-to-committed publication), commitTransactionId: analytic-state-commit-transaction, atomicity: all-or-none, failureDisposition: preserve-prior-commit }
  originRebaseTransactions: [] # populate with canonical accepted transactions when a physics-origin rebase is scheduled
  publicationRule: predict/correct writes are provisional and non-sampleable; only commit-group publications enter descriptors, candidates, or presentation
  executionLedger: { type: PhysicsExecutionLedger, ledgerId: route-interval-execution-ledger-id, graphId: route PhysicsGraph ID, graphRevision: exact graph revision, coordinationInterval: graph coordinationInterval, coordinationAdvanceId: exact current coordination advance ID, stageExecutions: complete PhysicsStageExecution rows with exact intervals/subcycles/version claims, dependencyCompletions: exact PhysicsDependencyCompletion refs, stateAdvanceClaims: one accepted state-advance claim or explicit state-hold per owned equation and coordination interval, interactionApplicationLedgers: exact accepted InteractionApplicationLedger refs or [], loopResults: bounded-loop iterations/residuals/accepted iterate, commitReceipts: exact successful PhysicsCommitReceipt refs or [], catchUpDebtBeforeAfter: typed duration pair, discontinuityEpoch: graph epoch, physicsCostLedgerId: route-specific-runtime-physics-cost-ledger-id }
physicsCostLedger:
  type: PhysicsCostLedger
  ledgerId: route-specific-runtime-physics-cost-ledger-id
  status: active
  targetAndHarness: named physical target, fixed archipelago views, seed, route tier, viewport, DPR, and sustained protocol
  qualityState: route Full/Budgeted/Minimum viable plus performanceContract.skillTierCrosswalk
  graphStageCosts: [analytic field/sample/evaluation router cost records]
  coordinationIntervalsPerSecond: labelled distribution on analytic-coordination-clock
  stageExecutionsPerCoordinationInterval: labelled counts by stage
  stageExecutionsPerSecond: labelled counts derived from the clock mapping
  coordinationIntervalsPerPresentedFrame: labelled distribution through presentation-clock-map-v1
  subcyclesAndCouplingIterationsPerPresentedFrame: explicit labelled zero/not-used records
  executionsPerPresentedFrame: labelled stage counts
  worstPermittedCatchUpBurst: { triggerAndIntervalDebt: analytic presentation debt policy, executionsDispatchesAndTraffic: labelled records, latencyMemoryAndErrorGate: typed gates }
  hotBytesReadWrittenPerExecution: labelled field/provider/presentation bytes
  solverDispatches: []
  queueSubmissionsAndPassBreaks: labelled counts
  dependencyCriticalPaths: [analytic evaluation to committed candidate to per-view preparation]
  tileGpuTraffic: { attachmentStoreLoadResolveBytes: labelled records, tileSpillEvidence: measured-or-TypedAbsence(not-measured, evidence owner, measurement interval, harness provenance), renderComputePassBreaks: labelled counts }
  bindingAndDeviceLimits: [limit-demand-headroom-and-gate]
  cpuWork: [field sampling, candidate assembly, per-view publication work]
  allocationGcAndCompilation: [cadence-latency-and-byte-record]
  uploadsCopiesMaps: [TrafficRecord]
  hostCompletionsReadbacksPerPresentedFrame: labelled zero-or-failure record
  synchronization: [wait-or-stall-record]
  multiviewAndFramesInFlightMultipliers: labelled view/lease/resource records
  hotState: PhysicsMemoryLedger
  peakTransient: PhysicsMemoryLedger
  migrationOverlap: PhysicsMemoryLedger
  thermalPowerState: measured-or-TypedAbsence(not-measured, evidence owner, measurement interval, harness provenance)
physicsSignals:
  landSignedDistanceSignal: { type: PhysicsSignalDescriptor<metric-signed-coast-distance>, producer: $threejs-procedural-fields, consumers: [terrain compiler, beach/material bands, water boundary, foam source, asset exclusion, $threejs-visual-validation], invariant: SI metre distance plus gradient/Jacobian, support/filter/frame/chart/time/error and immutable state version }
  terrainElevationAndRegionsSignal: { type: PhysicsSignalDescriptor<terrain-elevation-normal-semantic-regions>, producer: $threejs-procedural-fields, consumers: [$threejs-procedural-geometry, $threejs-procedural-materials, anchor/placement compilers, $threejs-visual-validation], invariant: metric elevation/normal and categorical regions share one causal field version and explicit per-channel errors }
  bathymetryAndCoastFrameSignal: { type: PhysicsSignalDescriptor<bathymetry-and-metric-coast-frame>, producer: $threejs-procedural-fields, consumers: [$threejs-water-optics regime/boundary/optics/foam owners, $threejs-visual-validation], invariant: metric bed/depth/coast tangent-normal/Jacobian with medial-axis validity and no color-derived boundary }
  terrainSupport: { type: PhysicsSignalDescriptor<SupportSurfaceSample>, producer: $threejs-procedural-geometry support adapter, consumers: [$threejs-water-optics, asset placement compilers, $threejs-visual-validation] }
  waterSurface: { type: PhysicsSignalDescriptor<WaterSurfaceSample>, producer: $threejs-water-optics, consumers: [water geometry/optics, $threejs-visual-validation] }
  qualityChangeRequest: { type: PhysicsSignalDescriptor<QualityChangeRequest>, producer: $threejs-image-pipeline quality governor, consumers: [route physics coordinator] }
  qualityTransition: { type: PhysicsSignalDescriptor<QualityTransition>, producer: route physics coordinator, consumers: [$threejs-water-optics, $threejs-image-pipeline, $threejs-visual-validation] }
physicsInteractions: []
physicsErrorPropagationLedgers:
  canonicalExpansion: required before emitted-manifest validation
  unresolvedBlocker: emit complete ErrorPropagationLedger records for every committed signal, interaction, and presentation-consumed derived state; every provider response must resolve errorPropagationLedgerRef
physicsCoordinationAdvanceRecords:
  canonicalExpansion: required before emitted-manifest validation
  records: exact PhysicsCoordinationAdvanceRecord records keyed by coordinationAdvanceId, each closing stage executions, dependency completions, state-advance claims, application ledgers, commit receipt, debt arithmetic, and status for one coordination interval
physicsInteractionApplicationLedgers:
  canonicalExpansion: required before emitted-manifest validation
  records: exact InteractionApplicationLedger records for every prepared/committed/deferred/rejected/duplicate interaction disposition; [] only when physicsInteractions is []
physicsCommitTransactions:
  canonicalExpansion: required before emitted-manifest validation
  records: exact PhysicsCommitTransaction records keyed by every commitGroup.commitTransactionId with prepared-publication bijection, gate results, one commit instant, receipt, and rollback disposition
physicsQualityRequests:
  canonicalExpansion: required before emitted-manifest validation
  records: exact QualityChangeRequest records keyed by requestId; each transition requestId/requestSequence/scope/controls/evidence digest resolves one immutable request and its admission
physicsQualityStates:
  canonicalExpansion: required before emitted-manifest validation
  records: exact PhysicsQualityStateDescriptor records keyed by qualityStateId for every active, source, and destination state referenced by a request, admission, transition, conservative map, or cost ledger
physicsQualityTransitions:
  canonicalExpansion: required before emitted-manifest validation
  records: exact QualityTransition records for every admitted QualityChangeRequest; [] only when no quality transition is admitted in the covered interval
physicsPresentationTimeCohortsById:
  analytic-archipelago-cohort: { type: PresentationTimeCohort, timeCohortId: analytic-archipelago-cohort, presentationClockId: presentation-clock, presentationOpportunitySequence: exact monotonic integer, previousRequestedPresentationInstant: exact previous PhysicsInstant, currentRequestedPresentationInstant: exact current PhysicsInstant, requestedPresentationInstant: same current PhysicsInstant, requiredContextIds: [physicsContext.contextId], requiredDiscontinuityEpochs: { physicsContext.contextId: exact current discontinuity epoch }, maximumInterContextSkew: zero for one context, maximumCandidateAge: Gated PhysicsDuration, admissionPolicy: exact-instant, cohortSpecificationDigest: canonical cohort digest }
physicsPresentationCandidate:
  type: PhysicsPresentationCandidate
  candidateId: runtime-id
  contextId: physicsContext.contextId
  presentationEpoch: exact route presentation epoch
  timeCohortId: analytic-archipelago-cohort
  requestedPresentationInstant: physicsPresentationTimeCohortsById.analytic-archipelago-cohort.currentRequestedPresentationInstant
  physicsOriginEpoch: physicsContext.physicsOriginEpoch
  commitProvenance: exact CandidateCommitProvenance resolving analytic terrain/water versions to analytic-state commit receipt IDs/digests
  candidateScope: committed-state-brackets-leases-and-events
  producer: route physics coordinator
  consumers: [design-view camera owner, route presentation assembler]
  contents: requestedPresentationInstant plus committed analytic per-binding/provider PresentedStatePair entries with independent previous/current provenance, physics frame/origin/revision, immutable state handles, resource leases, and event ranges; contains no camera, render origin, view/projection matrix, shadow/cache epoch, or global-to-render transform
  presentedStatePairs: canonicalExpansion(required complete per-binding PresentedStatePair records)
  resourceLeases: canonicalExpansion(required complete Candidate-scoped PresentationResourceLease records)
  eventSequenceRanges: canonicalExpansion(required complete PresentationEventRange records or [])
  qualityMigration: the coordinator admits one request only through a QualityTransition with commitInstant, conservative/reset map, error residuals, queue boundary, atomic provider/registry versions, ConsumerCompletionJoin retirement, scoped presentation/history actions, and rollback before candidate publication
physicsCameraViewPublicationsByTarget:
  main/design-view: { type: CameraViewPublication, cameraPublicationId: runtime-id, candidateId: physicsPresentationCandidate.candidateId, owner: design-view camera owner, presentationTargetId: main, viewId: design-view, cameraId: design-camera, contents: previous/current PhysicsInstant, source-qualified previous/current RenderSimilarityTransform, unjittered view/projection matrices, jitter convention, viewport/DPR/extent, depth convention, projection validity/error }
physicsViewPreparationPublicationsByTarget:
  main/design-view: { type: ViewPreparationPublication, viewPreparationId: runtime-id, candidateId: physicsPresentationCandidate.candidateId, cameraPublicationId: physicsCameraViewPublicationsByTarget["main/design-view"].cameraPublicationId, presentationTargetId: main, viewId: design-view, resourceLeases: full PresentationResourceLease records for newly created camera-dependent resources, resourceLeaseRefs: exact Candidate and same-preparation refs, contents: visibility/acceleration/shadow/cache refs, reactive publications, reset DAG, exact PresentationResourceLeaseRefs }
physicsPresentationSnapshotsByTarget:
  main/design-view: { type: PhysicsPresentationSnapshot, snapshotId: runtime-id, producer: route presentation sealer, candidateId: physicsPresentationCandidate.candidateId, cameraPublicationId: physicsCameraViewPublicationsByTarget["main/design-view"].cameraPublicationId, viewPreparationId: physicsViewPreparationPublicationsByTarget["main/design-view"].viewPreparationId, presentationTargetId: main, viewId: design-view, presentedStatePairRefs: candidate binding IDs, resourceLeaseRefs: transitive exact lease refs, eventSequenceRanges: candidate-scoped ranges, closureManifest: canonicalExpansion(required complete PresentationClosureManifest with exact pair-state, preparation, reactive/reset, shadow/cache/visibility lease closure, event ranges, dependency DAG digest, and closure digest), sealVersion: runtime-version, consumers: [design-view scene/water passes, $threejs-visual-validation] }
physicsPresentationRenderPlansByTarget:
  main/design-view: { type: PresentationRenderPlan, renderPlanId: analytic-archipelago-design-render-plan, timeCohortId: analytic-archipelago-cohort, candidateId: physicsPresentationCandidate.candidateId, snapshotId: physicsPresentationSnapshotsByTarget["main/design-view"].snapshotId, presentationTargetId: main, viewId: design-view, phaseIds: exact selected phase IDs, phaseRecords: canonicalExpansion(required complete RenderPlanPhase records), edges: canonicalExpansion(required complete RenderPlanEdge DAG), requiredPreparationEdgeIds: exact preparation edges, renderResourceLeaseIds: exact render leases, plannedResetActionIds: exact reset actions, expectedResetHistoryGenerations: exact generation map, shadowFactorIds: exact once-applied factor IDs or [], closureDigest: canonical plan closure digest, immutablePlanDigest: canonical immutable plan digest }
frameExecutionRecord:
  type: FrameExecutionRecord
  producer: $threejs-image-pipeline frame executor
  consumers: [$threejs-visual-validation, performance evidence]
  executionId: unique append-only presentation execution
  timeCohortId: analytic-archipelago-cohort
  candidateIds: [physicsPresentationCandidate.candidateId]
  cohortAdmission: exact admitted FrameCohortAdmission for analytic-archipelago-cohort
  renderPlans: [physicsPresentationRenderPlansByTarget["main/design-view"]]
  slotAdmissions: [exact admitted main/design-view FrameSlotAdmission]
  requiredTargetViewKeys: [main/design-view]
  snapshotIds: [physicsPresentationSnapshotsByTarget["main/design-view"].snapshotId]
  overallStatus: submitted | completed | partial-failure | aborted | device-lost
  backendGeneration: exact backend generation
  deviceLossGeneration: exact device-loss generation
  targetExecutions:
    main/design-view: { snapshotId: physicsPresentationSnapshotsByTarget["main/design-view"].snapshotId, renderPlanId: analytic-archipelago-design-render-plan, slotAdmissionId: exact admitted main/design-view slot ID, presentationTargetId: main, viewId: design-view, status: typed target status, submittedPasses: exact pass keys, queueSubmissionEpochs: ordered epochs, actionResults: typed results, resetActionResults: exact planned reset results, completionTokens: exact tokens, presentedTimestamp: mapped presentation-clock record or TypedAbsence(not-presented, frame executor, execution interval, target status), failure: typed failure or TypedAbsence(no-failure, frame executor, execution interval, target status) }
  leaseDispositionById:
    lease-id: { disposition: retained-until-join | retired-after-abort | invalidated-by-device-loss, consumingSnapshotIds: [physicsPresentationSnapshotsByTarget["main/design-view"].snapshotId], completionJoin: { simulationConsumers: [typed tokens], couplingConsumers: [], externalConsumers: [], presentationConsumers: [typed tokens], deviceLossRetirementPath: typed rule }, retirementEvidence: typed completion-or-loss record }
  immutability: completion never mutates candidate, camera publication, view-preparation publication, or snapshot
physicsPresentationSnapshot: not used # deprecated compatibility projection; never allocated
outputOwnersByPresentationTarget:
  main: { toneMap: $threejs-image-pipeline, outputTransform: $threejs-image-pipeline, adaptiveQuality: $threejs-image-pipeline }
sharedResourceOwners:
  gbuffer: not used unless named consumers pass the MRT A/B gate
  depth: $threejs-image-pipeline
  normal: not used
  velocity: not used
  history: not used
  weatherEnvelope: not used
  toneMap: $threejs-image-pipeline
  outputTransform: $threejs-image-pipeline
  adaptiveResolution: $threejs-image-pipeline
performanceContract:
  routeStatus: provisional
  frameInterval: { value: 16.6667, unit: ms, label: Derived, source: frozen-60-Hz-target }
  passKeys: [archipelago.scene, archipelago.water, main.present]
acceptanceEvidence:
  requiredDebugViews: [coast-field, bathymetry, water-state, no-post]
  requiredMetrics: [coast-registration-error, composed-p50-p95, sustained-mobile-memory-traffic]
  requiredCommands: [router-contract-test, skill-pack-validation]
  requiredArtifacts: [route-manifest, physics-ledgers, fixed-view-captures]
coverageStatus: partial
coverageBlockers: general prop-kit generation, lighting/environment authorship, and asset preparation/compression remain project or dedicated-skill inputs unless the required modules and metadata are supplied
```

If run-up, conservative flow, interaction, or persistent transported foam is
required, emit a separate persistent-state manifest. The concrete variant
below selects a prescribed kinematic vessel source whose physical pose is
independent of water and whose footprint injects a declared, externally powered
wake. A separate water-following heave/roll response is presentation-only and
never feeds that footprint. It does not claim rigid-body energy conservation. A route without that observable
emits a different manifest and omits both the motion owner and interaction
edges. Do not place alternatives inside one workload-profile enum:

```text
routeVariant: persistent-water-state-with-authored-vessel-wake
workloadProfile:
  temporal: simulation
selectedSkills:
  - $threejs-procedural-fields
  - $threejs-procedural-geometry
  - $threejs-procedural-materials
  - $threejs-water-optics
  - $threejs-procedural-motion-systems
  - $threejs-procedural-vegetation
  - $threejs-procedural-buildings-and-cities
  - $threejs-camera-controls-and-rigs
  - $threejs-image-pipeline
  - $threejs-visual-validation
causeLedger:
  selectedAlgorithm: shared coastal fields plus sparse active-tile, well-balanced, positivity-preserving nonlinear Saint-Venant nearshore dynamics with one declared wet/dry policy; $threejs-water-optics owns water state, boundaries, foam transport, and optics; $threejs-procedural-motion-systems owns water-independent prescribed vessel source kinematics and an optional presentation-only water-follow response; the wake adapter consumes only the source kinematics
owners:
  timebase: route physics coordinator executing the PhysicsGraph
requiredSignals:
  historyRegistry:
    foam: { producer: water foam update, consumers: [water shading, validation], reset: seed/shoreline/tier/extent changes }
domainSignals:
  waterState: { physicsSignal: waterSurface, consumers: [water geometry, normals, optics, foam, vessel coupling, validation] }
  vesselSourceState: { physicsSignal: vesselSourceState, consumers: [vessel coupling, presentation assembler, validation] }
  vesselVisualResponse: { physicsSignal: vesselVisualResponse, consumers: [presentation assembler, validation], invariant: presentation-only; never a wake/coupling input }
physicsContext:
  type: PhysicsContext
  producer: route physics coordinator
  consumers: [$threejs-water-optics, $threejs-procedural-motion-systems, $threejs-procedural-geometry, $threejs-image-pipeline, $threejs-visual-validation]
  invariant: one finite positive metersPerWorldUnit is the sole world-to-physics scale boundary; provider state remains SI in a stable right-handed physics frame; typed gravity; floating-origin epoch; generation-bearing entity/material IDs; time origin for every stage
  physicsMaterialRegistry: { registryId: authored-vessel-materials, owner: route material-registry owner, registryVersion: exact version, materials: [water, hull, static support], materialStateDescriptors: [water/hull state descriptors when dynamic], pairLawResolver: deterministic ordered water-hull slip/drag law with missing-pair rejection, renderBindings: explicit optional map; no PBR inference }
physicsMaterialsAndProxies:
  vesselBoundaryProxy: { type: ColliderProxy, colliderId: authored-hull collider generation, entityId: authored-vessel generation, shapeId: hull-shape generation, contextId: physicsContext.contextId, shapeFrameId: registered vessel frame, physicsFrameId: physicsContext.physicsRootFrameId, physicsOriginEpoch: current epoch, transformRevision: registered revision, shapeRepresentation: closed mesh or convex compound, shapeDefinitionRef: content-addressed proxy, topologyRevision: hull topology version, poseSignalRef: vesselSourceState descriptor, poseStateVersion: exact provisional source version, validityInterval: wake interval, updateCadence: authored-vessel clock, sweptBounds: conservative interval bound, oneSidedness: two-sided, closedness: watertight-with-gate, collisionMode: continuous-with-named-sweep, featureIdPolicy: stable versioned map, conservativeInflationMeters: Gated quantity, physicsMaterialId: hull material ID, collisionGroups: explicit water-boundary filter, approximationError: support-distance/volume error, residency: CPU authoritative }
physicsGraph:
  type: PhysicsGraph
  producer: route physics coordinator
  coordinationInterval: nonempty PhysicsTimeInterval on coastal-coordination-clock
  clocks:
    coastalCoordinationClock: { type: PhysicsClockDescriptor, clockId: coastal-coordination-clock, owner: route physics coordinator, mappingKind: fixed-rational, mappingRevision: coastal-clock-map-v1, discontinuityEpoch: coastal-clock-continuity-v1, mapping: exact canonical fixed-rational discriminated mapping, pauseSeekPolicy: versioned route policy, timeScalePolicy: fixed physical scale, coordinationClockMap: identity-with-zero-error }
    waterClock: { type: PhysicsClockDescriptor, clockId: water-clock, owner: $threejs-water-optics, mappingKind: fixed-rational, mappingRevision: water-clock-map-v1, discontinuityEpoch: coastal-clock-continuity-v1, mapping: exact canonical fixed-rational discriminated mapping, pauseSeekPolicy: graph discontinuity policy, timeScalePolicy: fixed physical scale, coordinationClockMap: exact versioned map whose PhysicsInstant endpoints tile coordinationInterval under the CFL gate }
    foamClock: { type: PhysicsClockDescriptor, clockId: foam-clock, owner: $threejs-water-optics foam owner, mappingKind: piecewise-versioned, mappingRevision: foam-clock-map-v1, discontinuityEpoch: coastal-clock-continuity-v1, mapping: exact canonical piecewise discriminated mapping, pauseSeekPolicy: graph discontinuity policy, timeScalePolicy: fixed physical scale, coordinationClockMap: versioned cadence map with bounded error }
    authoredVesselClock: { type: PhysicsClockDescriptor, clockId: authored-vessel-clock, owner: $threejs-procedural-motion-systems, mappingKind: fixed-rational, mappingRevision: vessel-clock-map-v1, discontinuityEpoch: coastal-clock-continuity-v1, mapping: exact canonical fixed-rational discriminated mapping, pauseSeekPolicy: authored trajectory seek policy, timeScalePolicy: fixed physical scale, coordinationClockMap: exact map to coastal-coordination-clock }
    presentationClock: { type: PhysicsClockDescriptor, clockId: presentation-clock, owner: route presentation scheduler, mappingKind: external, mappingRevision: presentation-clock-map-v1, discontinuityEpoch: presentation-clock-continuity-v1, mapping: exact canonical external discriminated mapping with frozen accepted evaluations, pauseSeekPolicy: presentation discontinuity policy, timeScalePolicy: no physics authority, coordinationClockMap: versioned map with bounded error to coastal-coordination-clock }
  stages:
    - ingest: latch PhysicsContext/material registry/hull proxy, terrainSupport, previous committed waterSurface, prescribed vessel controls, and coordinationInterval
    - sample-forcing: sample immutable terrain/boundary inputs; water is not an input to prescribed vesselSourceState
    - predict: write provisional water-independent RigidBodyState vesselSourceState and nearshore predictor versions; optional vesselVisualResponse samples committed water only for later presentation
    - emit-interactions: build vesselWakeExchange exactly once over its PhysicsTimeInterval from provisional vesselSourceState and latched hull/material/pair-law versions; vesselVisualResponse is forbidden as an input
    - solve-subcycles: apply vesselWakeExchange to provisional water state over water-clock intervals that exactly cover coordinationInterval, then advance provisional foam state on its mapped cadence
    - reduce-reactions: record prescribed-vessel external work; no reciprocal rigid-body reaction is claimed
    - correct: enforce wet/dry positivity, boundary compatibility, finite-state, and prescribed-work gates on provisional state
    - commit: publish accepted water, foam, vessel-source, and presentation-response versions only through coastal-state-commit-group
    - publish-presentation: publish the camera-free candidate from committed versions; camera/view preparation and sealing follow as immutable per-view publications
  loopMacros: []
  commitGroups:
    - { commitGroupId: coastal-state-commit-group, owner: route physics coordinator, interval: coordinationInterval, provisionalVersions: [waterSurface.provisional, foamState.provisional, vesselSourceState.provisional, vesselVisualResponse.provisional], committedPublications: [waterSurface.committed, foamState.committed, vesselSourceState.committed, vesselVisualResponse.committed], publicationLineage: one digest/equivalence/owner-approved row per provisional-to-committed publication, stateEquationOwners: { nearshore-water: $threejs-water-optics, foam-transport: $threejs-water-optics foam owner, prescribed-vessel-source-kinematics: $threejs-procedural-motion-systems, presentation-only-water-follow-response: $threejs-procedural-motion-systems }, conservationAndErrorGates: [water-positivity, boundary-compatibility, prescribed-work-ledger, visual-response-nonfeedback, finite-state], preparedPublications: canonicalExpansion(required complete PhysicsPreparedPublication records for every provisional-to-committed publication), commitTransactionId: coastal-state-commit-transaction, atomicity: all-or-none, failureDisposition: preserve-prior-commit }
  originRebaseTransactions: [] # populate with canonical accepted transactions when a physics-origin rebase is scheduled
  publicationRule: all predicted/solved versions and interaction reductions remain provisional until coastal-state-commit-group accepts them
  executionLedger: { type: PhysicsExecutionLedger, ledgerId: route-interval-execution-ledger-id, graphId: route PhysicsGraph ID, graphRevision: exact graph revision, coordinationInterval: graph coordinationInterval, coordinationAdvanceId: exact current coordination advance ID, stageExecutions: complete PhysicsStageExecution rows with exact intervals/subcycles/version claims, dependencyCompletions: exact PhysicsDependencyCompletion refs, stateAdvanceClaims: one accepted state-advance claim or explicit state-hold per owned equation and coordination interval, interactionApplicationLedgers: exact accepted InteractionApplicationLedger refs or [], loopResults: bounded-loop iterations/residuals/accepted iterate, commitReceipts: exact successful PhysicsCommitReceipt refs or [], catchUpDebtBeforeAfter: typed duration pair, discontinuityEpoch: graph epoch, physicsCostLedgerId: route-specific-runtime-physics-cost-ledger-id }
physicsCostLedger:
  type: PhysicsCostLedger
  ledgerId: route-specific-runtime-physics-cost-ledger-id
  status: active
  targetAndHarness: named physical target, persistent nearshore state, authored vessel path, fixed views, route tier, viewport, DPR, and sustained protocol
  qualityState: route Full/Budgeted/Minimum viable plus performanceContract.skillTierCrosswalk
  graphStageCosts: [vessel state, wake reduction, nearshore, foam, commit/publication router cost records]
  coordinationIntervalsPerSecond: labelled distribution on coastal-coordination-clock
  stageExecutionsPerCoordinationInterval: labelled counts by stage and owner
  stageExecutionsPerSecond: labelled counts through each clock mapping
  coordinationIntervalsPerPresentedFrame: labelled distribution through presentation-clock-map-v1
  subcyclesAndCouplingIterationsPerPresentedFrame: labelled water/foam distributions; coupling iteration explicitly not used
  executionsPerPresentedFrame: labelled stage counts
  worstPermittedCatchUpBurst: { triggerAndIntervalDebt: graph catch-up policy, executionsDispatchesAndTraffic: labelled water/foam/vessel records, latencyMemoryAndErrorGate: typed gates }
  hotBytesReadWrittenPerExecution: labelled water/foam/vessel/exchange bytes
  solverDispatches: [nearshore and foam extent/workgroup/cadence/timing records]
  queueSubmissionsAndPassBreaks: labelled counts
  dependencyCriticalPaths: [vessel-to-wake-to-water-to-commit, commit-to-candidate-to-view]
  tileGpuTraffic: { attachmentStoreLoadResolveBytes: labelled records, tileSpillEvidence: measured-or-TypedAbsence(not-measured, evidence owner, measurement interval, harness provenance), renderComputePassBreaks: labelled counts }
  bindingAndDeviceLimits: [limit-demand-headroom-and-gate]
  cpuWork: [candidate assembly, authored motion, active-tile scheduling]
  allocationGcAndCompilation: [cadence-latency-and-byte-record]
  uploadsCopiesMaps: [TrafficRecord]
  hostCompletionsReadbacksPerPresentedFrame: labelled zero-or-failure record
  synchronization: [wait-or-stall-record]
  multiviewAndFramesInFlightMultipliers: labelled view/lease/resource records
  hotState: PhysicsMemoryLedger
  peakTransient: PhysicsMemoryLedger
  migrationOverlap: PhysicsMemoryLedger
  thermalPowerState: measured-or-TypedAbsence(not-measured, evidence owner, measurement interval, harness provenance)
physicsSignals:
  terrainSupport: { type: PhysicsSignalDescriptor<SupportSurfaceSample>, producer: $threejs-procedural-geometry support adapter, consumers: [$threejs-water-optics boundary compiler, $threejs-procedural-motion-systems vessel adapter, $threejs-visual-validation] }
  waterSurface: { type: PhysicsSignalDescriptor<WaterSurfaceSample>, producer: $threejs-water-optics, consumers: [$threejs-procedural-motion-systems presentation-response adapter, water optics/shading, $threejs-visual-validation], residency: CPU-authoritative sparse nearshore state/query with immutable async GPU presentation upload; frame-critical GPU readback forbidden }
  vesselSourceState: { type: PhysicsSignalDescriptor<RigidBodyState>, producer: $threejs-procedural-motion-systems, consumers: [$threejs-water-optics vessel coupling adapter, route presentation assembler, $threejs-visual-validation], motionMode: kinematic, invariant: trajectory/pose/twist are independent of water state, residency: CPU committed state with asynchronous immutable presentation upload }
  vesselVisualResponse: { type: PhysicsSignalDescriptor<presentation-only-vessel-response>, producer: $threejs-procedural-motion-systems, consumers: [route presentation assembler, $threejs-visual-validation], sourceInputs: [vesselSourceState.committed, waterSurface.committed], invariant: contributes only a PresentedStatePair/global binding and cannot enter InteractionRecord, ColliderProxy pose, or water boundary state }
  qualityChangeRequest: { type: PhysicsSignalDescriptor<QualityChangeRequest>, producer: $threejs-image-pipeline quality governor, consumers: [route physics coordinator] }
  qualityTransition: { type: PhysicsSignalDescriptor<QualityTransition>, producer: route physics coordinator, consumers: [$threejs-water-optics, $threejs-procedural-motion-systems vessel adapter, $threejs-image-pipeline, $threejs-visual-validation] }
physicsInteractions:
  - exchangeId: vessel-wake-exchange
    type: SurfaceExchange
    mode: one-way
    producer: $threejs-water-optics vessel source adapter
    consumers: [$threejs-water-optics nearshore source reducer, $threejs-visual-validation]
    applicationInterval: vessel-wake-application-interval (PhysicsTimeInterval on coastal-coordination-clock)
    physicsFrameId: PhysicsContext.physicsRootFrameId
    physicsOriginEpoch: PhysicsContext.physicsOriginEpoch
    transformRevision: PhysicsContext.worldTransformRevision
    sourceDescriptors: [vesselSourceState, vesselBoundaryProxy, latched hull/water material states and pair law]
    interactions:
      - { interactionId: vessel-moving-boundary, exactOnceKey: exact interval/stage/source-sequence/interaction key, role: source, sourceOwner: prescribed vessel boundary adapter, sourceEntityId: authored-vessel generation, sourceStateVersions: [vesselSourceState provisional version, hull proxy topology/pose generation, hull/water PhysicsMaterialState versions, resolved pair/slip-law revision], targetOwner: $threejs-water-optics, targetEntityId: nearshore active-tile generation, targetStateVersionExpected: nearshore predictor version, targetStateEquation: nearshore moving-boundary condition, applicationInterval: vessel-wake-application-interval, physicsFrameId: PhysicsContext.physicsRootFrameId, physicsOriginEpoch: PhysicsContext.physicsOriginEpoch, transformRevision: PhysicsContext.worldTransformRevision, footprint: oriented hull area quadrature with physical m2 weights, reference point, geometry/Jacobian/error, payload: { tag: movingBoundary, timeSemantics: state-over-interval, boundaryPositionMetersByQuadraturePoint: versioned hull points, boundaryVelocityMpsByQuadraturePoint: physical point velocities from vesselSourceState, noPenetrationAndSlipLawRef: latched water-hull pair-law revision }, signConvention: positive-source-to-receiver, applicationLedgerKey: exact-once boundary key, reactionGroupId: TypedAbsence(not-applicable, prescribed vessel boundary adapter, wake interval, one-way prescribed source), reactionToInteractionIds: [], conservationGroupIds: [vessel-external-work-open-system], validity: exact source/target bracket and proxy domain, error: propagated pose/proxy/quadrature/law error, provenance: adapter/build/source trajectory }
    reactions: []
    reactionGroups: []
    conservationGroups: [vessel-external-work-open-system]
    stabilityGate: accepted boundary/source amplitude and water-state finite/positivity bounds
    convergence: not-applicable
    batchLedger: { type: InteractionBatchLedger, batchId: vessel-wake-batch, exchangeId: vessel-wake-exchange, producerId: $threejs-water-optics vessel source adapter, publishedSequenceRange: closed monotonic range, perConsumerCursor: per-consumer next sequence, acceptedRejectedLateDuplicate: typed labelled counts, overflowPolicy: reject-batch, overflowSequenceRanges: explicit ranges, lostCommodities: typed momentum/work commodity map, deferredCommodities: typed momentum/work commodity map, applicationLedgerIds: exact InteractionApplicationLedger IDs whose dispositions cover publishedSequenceRange, exactOnceApplicationLedgerVersion: opaque version }
    accounting: prescribed kinematics supply external work; displaced water has zero net mass source, and this route claims no rigid-body reaction
    omittedFeedback: route is explicitly prescribed-kinematic; report a Gated upper bound on ignored water-to-physical-source pose/energy error or narrow the accepted shot envelope; presentation-only water following is not physical feedback
physicsCoordinationAdvanceRecords:
  canonicalExpansion: required before emitted-manifest validation
  records: exact PhysicsCoordinationAdvanceRecord records keyed by coordinationAdvanceId, each closing stage executions, dependency completions, state-advance claims, application ledgers, commit receipt, debt arithmetic, and status for one coordination interval
physicsInteractionApplicationLedgers:
  canonicalExpansion: required before emitted-manifest validation
  records: exact InteractionApplicationLedger records for every prepared/committed/deferred/rejected/duplicate interaction disposition; [] only when physicsInteractions is []
physicsCommitTransactions:
  canonicalExpansion: required before emitted-manifest validation
  records: exact PhysicsCommitTransaction records keyed by every commitGroup.commitTransactionId with prepared-publication bijection, gate results, one commit instant, receipt, and rollback disposition
physicsQualityRequests:
  canonicalExpansion: required before emitted-manifest validation
  records: exact QualityChangeRequest records keyed by requestId; each transition requestId/requestSequence/scope/controls/evidence digest resolves one immutable request and its admission
physicsQualityStates:
  canonicalExpansion: required before emitted-manifest validation
  records: exact PhysicsQualityStateDescriptor records keyed by qualityStateId for every active, source, and destination state referenced by a request, admission, transition, conservative map, or cost ledger
physicsQualityTransitions:
  canonicalExpansion: required before emitted-manifest validation
  records: exact QualityTransition records for every admitted QualityChangeRequest; [] only when no quality transition is admitted in the covered interval
physicsErrorPropagationLedgers:
  canonicalExpansion: required before emitted-manifest validation
  unresolvedBlocker: emit complete ErrorPropagationLedger records for every committed signal, interaction, and presentation-consumed derived state; every provider response must resolve errorPropagationLedgerRef
physicsPresentationTimeCohortsById:
  prescribed-vessel-archipelago-cohort: { type: PresentationTimeCohort, timeCohortId: prescribed-vessel-archipelago-cohort, presentationClockId: presentation-clock, presentationOpportunitySequence: exact monotonic integer, previousRequestedPresentationInstant: exact previous PhysicsInstant, currentRequestedPresentationInstant: exact current PhysicsInstant, requestedPresentationInstant: same current PhysicsInstant, requiredContextIds: [physicsContext.contextId], requiredDiscontinuityEpochs: { physicsContext.contextId: exact current discontinuity epoch }, maximumInterContextSkew: zero for one context, maximumCandidateAge: Gated PhysicsDuration, admissionPolicy: exact-instant, cohortSpecificationDigest: canonical cohort digest }
physicsPresentationCandidate:
  type: PhysicsPresentationCandidate
  candidateId: runtime-id
  contextId: physicsContext.contextId
  presentationEpoch: exact route presentation epoch
  timeCohortId: prescribed-vessel-archipelago-cohort
  requestedPresentationInstant: physicsPresentationTimeCohortsById.prescribed-vessel-archipelago-cohort.currentRequestedPresentationInstant
  physicsOriginEpoch: physicsContext.physicsOriginEpoch
  commitProvenance: exact CandidateCommitProvenance resolving water/foam/vessel versions to coastal-state commit receipt IDs/digests
  candidateScope: committed-state-brackets-leases-and-events
  producer: route physics coordinator
  consumers: [design-view camera owner, route presentation assembler]
  contents: requestedPresentationInstant plus committed water/foam/vessel PresentedStatePair entries with independent provenance and physics-qualified state handles, exact leases, and consumed event ranges; contains no camera, render-origin, view/projection, shadow/cache, or global-to-render data
  presentedStatePairs: canonicalExpansion(required complete per-binding PresentedStatePair records)
  resourceLeases: canonicalExpansion(required complete Candidate-scoped PresentationResourceLease records)
  eventSequenceRanges: canonicalExpansion(required complete PresentationEventRange records or [])
  qualityMigration: a QualityTransition commits at commitInstant with conservative map/reset, interaction-queue boundary, residuals, atomic provider versions, ConsumerCompletionJoin retirement, scoped resets, and rollback before candidate publication
physicsCameraViewPublicationsByTarget:
  main/design-view: { type: CameraViewPublication, cameraPublicationId: runtime-id, candidateId: physicsPresentationCandidate.candidateId, owner: design-view camera owner, presentationTargetId: main, viewId: design-view, cameraId: design-camera, contents: previous/current PhysicsInstant, source-qualified RenderSimilarityTransforms, unjittered matrices, jitter, viewport/DPR/extent, depth, and projection validity/error }
physicsViewPreparationPublicationsByTarget:
  main/design-view: { type: ViewPreparationPublication, viewPreparationId: runtime-id, candidateId: physicsPresentationCandidate.candidateId, cameraPublicationId: physicsCameraViewPublicationsByTarget["main/design-view"].cameraPublicationId, presentationTargetId: main, viewId: design-view, resourceLeases: full PresentationResourceLease records for newly created camera-dependent resources, resourceLeaseRefs: exact Candidate and same-preparation refs, contents: visibility/acceleration/shadow/cache refs, reactive/reset DAG, and exact lease refs }
physicsPresentationSnapshotsByTarget:
  main/design-view: { type: PhysicsPresentationSnapshot, snapshotId: runtime-id, producer: route presentation sealer, candidateId: physicsPresentationCandidate.candidateId, cameraPublicationId: physicsCameraViewPublicationsByTarget["main/design-view"].cameraPublicationId, viewPreparationId: physicsViewPreparationPublicationsByTarget["main/design-view"].viewPreparationId, presentationTargetId: main, viewId: design-view, presentedStatePairRefs: candidate binding IDs, resourceLeaseRefs: exact transitive refs, eventSequenceRanges: candidate ranges, closureManifest: canonicalExpansion(required complete PresentationClosureManifest with exact pair-state, preparation, reactive/reset, shadow/cache/visibility lease closure, event ranges, dependency DAG digest, and closure digest), sealVersion: runtime-version, consumers: [design-view scene/water passes, $threejs-visual-validation] }
physicsPresentationRenderPlansByTarget:
  main/design-view: { type: PresentationRenderPlan, renderPlanId: prescribed-vessel-design-render-plan, timeCohortId: prescribed-vessel-archipelago-cohort, candidateId: physicsPresentationCandidate.candidateId, snapshotId: physicsPresentationSnapshotsByTarget["main/design-view"].snapshotId, presentationTargetId: main, viewId: design-view, phaseIds: exact selected phase IDs, phaseRecords: canonicalExpansion(required complete RenderPlanPhase records), edges: canonicalExpansion(required complete RenderPlanEdge DAG), requiredPreparationEdgeIds: exact preparation edges, renderResourceLeaseIds: exact render leases, plannedResetActionIds: exact reset actions, expectedResetHistoryGenerations: exact generation map, shadowFactorIds: exact once-applied factor IDs or [], closureDigest: canonical plan closure digest, immutablePlanDigest: canonical immutable plan digest }
frameExecutionRecord:
  type: FrameExecutionRecord
  producer: $threejs-image-pipeline frame executor
  consumers: [$threejs-visual-validation, performance evidence]
  executionId: unique append-only presentation execution
  timeCohortId: prescribed-vessel-archipelago-cohort
  candidateIds: [physicsPresentationCandidate.candidateId]
  cohortAdmission: exact admitted FrameCohortAdmission for prescribed-vessel-archipelago-cohort
  renderPlans: [physicsPresentationRenderPlansByTarget["main/design-view"]]
  slotAdmissions: [exact admitted main/design-view FrameSlotAdmission]
  requiredTargetViewKeys: [main/design-view]
  snapshotIds: [physicsPresentationSnapshotsByTarget["main/design-view"].snapshotId]
  overallStatus: submitted | completed | partial-failure | aborted | device-lost
  backendGeneration: exact backend generation
  deviceLossGeneration: exact device-loss generation
  targetExecutions:
    main/design-view: { snapshotId: physicsPresentationSnapshotsByTarget["main/design-view"].snapshotId, renderPlanId: prescribed-vessel-design-render-plan, slotAdmissionId: exact admitted main/design-view slot ID, presentationTargetId: main, viewId: design-view, status: typed target status, submittedPasses: exact pass keys, queueSubmissionEpochs: ordered epochs, actionResults: typed results, resetActionResults: exact planned reset results, completionTokens: exact tokens, presentedTimestamp: mapped presentation-clock record or TypedAbsence(not-presented, frame executor, execution interval, target status), failure: typed failure or TypedAbsence(no-failure, frame executor, execution interval, target status) }
  leaseDispositionById:
    lease-id: { disposition: retained-until-join | retired-after-abort | invalidated-by-device-loss, consumingSnapshotIds: [physicsPresentationSnapshotsByTarget["main/design-view"].snapshotId], completionJoin: { simulationConsumers: [typed tokens], couplingConsumers: [typed tokens], externalConsumers: [], presentationConsumers: [typed tokens], deviceLossRetirementPath: typed rule }, retirementEvidence: typed completion-or-loss record }
  immutability: append completion only; never mutate any prior publication or snapshot
physicsPresentationSnapshot: not used # deprecated compatibility projection; never allocated
sharedResourceOwners:
  history: $threejs-water-optics
coverageStatus: partial
coverageBlockers: general prop assets, lighting/environment authorship, and source-asset preparation remain supplied project inputs; this selected variant owns the typed authored-vessel wake but does not claim external rigid-body dynamics
```

### Unique work and target-quality contract

The manifest lists only the branch actually selected. Alternative analytic,
spectral, and depth-averaged candidates never appear as additive costs. A
selected hybrid lists its open-water and nearshore producers once each and
proves their handoff.

```yaml
uniqueWorkLedger:
  generationOrRegeneration:
    - coast.field-build
    - terrain.semantic-mesh-build
    - assets.constraint-scatter
  simulationStep: not used
  presentedFrame:
    - design-view.opaque-scene
    - design-view.water-composite
    - main.present
  accounting: generation/startup, simulation cadence, and presented-frame cost remain separate; shared coast/depth data is counted once
performanceContract:
  routeStatus: provisional
  skillTierCrosswalk: { status: required-before-acceptance, rule: map every selected skill local tier explicitly to route Full/Budgeted/Minimum viable with protected invariants and explicit unsupported-tier mappings; no implicit name equality }
  frameInterval: { value: "", unit: ms, label: Derived, source: "1000 ms / [Gated] frozen target refresh" }
  targetMatrix:
    - named physical desktop-discrete target
    - named physical integrated target
    - named physical low-power/mobile target
  targetRule: device-class labels carry no timing or memory implication; each target gets measured viewport, DPR, refresh, sustained state, and frozen gates
  passKeys: [design-view.opaque-scene, design-view.water-composite, main.present]
  mobileGate: compare the minimal forward color/depth path with every additional stored attachment and with any scene-color/depth refraction copy; derive grid/history/target bytes and per-step traffic, then validate sustained cadence and quality drift on the physical target
  qualityAdaptation: one hysteretic controller changes only the measured pressure source and resets/resizes dependent water histories atomically
qualityStates:
  Full:
    contract: highest accepted terrain/coast detail, water branch, foam continuity, bathymetric optics, and asset population
    candidates: finer projected-error terrain/shore detail; accepted nearshore state; higher water/foam resolution or cadence; richer constrained assets; optional caustics/clouds
  Budgeted:
    contract: same coast, land regions, bathymetric ordering, water/normal state, foam cause, and landmark identity
    candidates: coarser projected-error chunks; lower local-water/foam resolution or cadence; fewer sub-pixel wave bands; reduced secondary vegetation; optional caustics/clouds removed
  Minimum viable:
    contract: deterministic island silhouette and terrain bands, the selected core water branch at its cheapest valid state, coast-registered foam, shallow/deep separation, and landmark support correctness
    candidates: coarsest accepted extent/resolution/cadence of a claimed solver, or shared-state analytic water when the route made no solver claim; no temporal caustics; sparse repeated assets; minimal forward attachments
  assignmentRule: choose a stable state from measured composed evidence; never preassign Full to desktop or Minimum viable to mobile
```

The persistent nearshore-plus-foam-and-vessel variant replaces only the
steady-work fields below; its keys are real selected work, not optional entries
in the analytic ledger.

```yaml
routeVariant: persistent-water-state-with-authored-vessel-wake
uniqueWorkLedger:
  simulationStep:
    - vessel.authored-motion-update: "one authored body-state producer"
    - water.vessel-source-reduce: "one typed contact-to-SurfaceExchange adapter"
    - water.nearshore-update: "accepted dynamics require local state"
    - water.foam-update: "one source/advection/decay owner"
    - physics.publish-presentation: "one immutable cross-domain snapshot"
performanceContract:
  skillTierCrosswalk: { status: required-before-acceptance, rule: map every selected skill local tier explicitly to route Full/Budgeted/Minimum viable with protected invariants and explicit unsupported-tier mappings; no implicit name equality }
  passKeys: [vessel.authored-motion-update, water.vessel-source-reduce, water.nearshore-update, water.foam-update, physics.publish-presentation, design-view.opaque-scene, design-view.water-composite, main.present]
```

A spectral offshore donor is a third, separately emitted manifest. It selects
the spectral skill instead of leaving it deferred, names one combined coastal
state owner, and adds the donor update explicitly:

```text
routeVariant: spectral-offshore-plus-persistent-nearshore
workloadProfile:
  temporal: simulation
selectedSkills:
  - $threejs-procedural-fields
  - $threejs-procedural-geometry
  - $threejs-procedural-materials
  - $threejs-spectral-ocean
  - $threejs-water-optics
  - $threejs-procedural-motion-systems
  - $threejs-procedural-vegetation
  - $threejs-procedural-buildings-and-cities
  - $threejs-camera-controls-and-rigs
  - $threejs-image-pipeline
  - $threejs-visual-validation
deferredSkills:
  - $threejs-sky-atmosphere-and-haze: load only when aerial depth is observable
  - $threejs-volumetric-clouds: load only when clouds are volumetric scene subjects
causeLedger:
  selectedAlgorithm: $threejs-spectral-ocean owns the homogeneous periodic offshore directional-spectrum donor; $threejs-water-optics owns covariance-aware boundary reconstruction, the sparse well-balanced nonlinear Saint-Venant nearshore state, the single partition-of-unity spatial handoff, and the sole foam/optics history; $threejs-procedural-motion-systems owns a water-independent authored vessel source trajectory plus optional presentation-only water following, and only the source trajectory drives the prescribed wake boundary
domainSignals:
  offshoreSpectrum: { physicsSignal: offshoreBoundaryState, consumers: [$threejs-water-optics coastal boundary adapter, validation] }
  waterState: { physicsSignal: waterSurface, consumers: [water geometry, normals, optics, foam, vessel coupling, validation] }
  vesselSourceState: { physicsSignal: vesselSourceState, consumers: [vessel coupling, presentation assembler, validation] }
  vesselVisualResponse: { physicsSignal: vesselVisualResponse, consumers: [presentation assembler, validation], invariant: presentation-only and excluded from wake construction }
owners:
  timebase: route physics coordinator executing the PhysicsGraph
physicsContext:
  type: PhysicsContext
  producer: route physics coordinator
  consumers: [$threejs-spectral-ocean, $threejs-water-optics, $threejs-procedural-motion-systems, $threejs-procedural-geometry, $threejs-image-pipeline, $threejs-visual-validation]
  invariant: one finite positive metersPerWorldUnit is the sole world-to-physics scale boundary; provider state remains SI in a stable right-handed physics frame; typed gravity; datum; floating-origin epoch; generation-bearing entity/material registry; time origin across offshore, coast, body, and render domains
  physicsMaterialRegistry: { registryId: spectral-authored-vessel-materials, owner: route material-registry owner, registryVersion: exact version, materials: [water, hull, static support], materialStateDescriptors: [water/hull state descriptors when dynamic], pairLawResolver: deterministic ordered water-hull slip/drag law with missing-pair rejection, renderBindings: explicit optional map; no PBR inference }
physicsMaterialsAndProxies:
  vesselBoundaryProxy: { type: ColliderProxy, colliderId: authored-hull collider generation, entityId: authored-vessel generation, shapeId: hull-shape generation, contextId: physicsContext.contextId, shapeFrameId: registered vessel frame, physicsFrameId: physicsContext.physicsRootFrameId, physicsOriginEpoch: current epoch, transformRevision: registered revision, shapeRepresentation: closed mesh or convex compound, shapeDefinitionRef: content-addressed proxy, topologyRevision: hull topology version, poseSignalRef: vesselSourceState descriptor, poseStateVersion: exact provisional source version, validityInterval: wake interval, updateCadence: authored-vessel clock, sweptBounds: conservative interval bound, oneSidedness: two-sided, closedness: watertight-with-gate, collisionMode: continuous-with-named-sweep, featureIdPolicy: stable versioned map, conservativeInflationMeters: Gated quantity, physicsMaterialId: hull material ID, collisionGroups: explicit water-boundary filter, approximationError: support-distance/volume error, residency: CPU authoritative }
physicsGraph:
  type: PhysicsGraph
  producer: route physics coordinator
  coordinationInterval: nonempty PhysicsTimeInterval on coastal-coordination-clock
  clocks:
    coastalCoordinationClock: { type: PhysicsClockDescriptor, clockId: coastal-coordination-clock, owner: route physics coordinator, mappingKind: fixed-rational, mappingRevision: coastal-clock-map-v1, discontinuityEpoch: coastal-clock-continuity-v1, mapping: exact canonical fixed-rational discriminated mapping, pauseSeekPolicy: versioned route policy, timeScalePolicy: fixed physical scale, coordinationClockMap: identity-with-zero-error }
    offshoreClock: { type: PhysicsClockDescriptor, clockId: offshore-clock, owner: $threejs-spectral-ocean, mappingKind: fixed-rational, mappingRevision: offshore-clock-map-v1, discontinuityEpoch: coastal-clock-continuity-v1, mapping: exact canonical fixed-rational discriminated mapping, pauseSeekPolicy: analytic phase seek policy, timeScalePolicy: fixed physical scale, coordinationClockMap: exact versioned map; spectral phase derives from requested PhysicsInstant and is never accumulated }
    nearshoreClock: { type: PhysicsClockDescriptor, clockId: nearshore-clock, owner: $threejs-water-optics, mappingKind: fixed-rational, mappingRevision: nearshore-clock-map-v1, discontinuityEpoch: coastal-clock-continuity-v1, mapping: exact canonical fixed-rational discriminated mapping, pauseSeekPolicy: graph discontinuity policy, timeScalePolicy: fixed physical scale, coordinationClockMap: exact versioned map whose PhysicsTimeInterval substeps tile coordinationInterval under the CFL gate }
    foamClock: { type: PhysicsClockDescriptor, clockId: foam-clock, owner: $threejs-water-optics foam owner, mappingKind: piecewise-versioned, mappingRevision: foam-clock-map-v1, discontinuityEpoch: coastal-clock-continuity-v1, mapping: exact canonical piecewise discriminated mapping, pauseSeekPolicy: graph discontinuity policy, timeScalePolicy: fixed physical scale, coordinationClockMap: versioned cadence map with bounded error }
    authoredVesselClock: { type: PhysicsClockDescriptor, clockId: authored-vessel-clock, owner: $threejs-procedural-motion-systems, mappingKind: fixed-rational, mappingRevision: vessel-clock-map-v1, discontinuityEpoch: coastal-clock-continuity-v1, mapping: exact canonical fixed-rational discriminated mapping, pauseSeekPolicy: authored trajectory seek policy, timeScalePolicy: fixed physical scale, coordinationClockMap: exact map to coastal-coordination-clock }
    presentationClock: { type: PhysicsClockDescriptor, clockId: presentation-clock, owner: route presentation scheduler, mappingKind: external, mappingRevision: presentation-clock-map-v1, discontinuityEpoch: presentation-clock-continuity-v1, mapping: exact canonical external discriminated mapping with frozen accepted evaluations, pauseSeekPolicy: presentation discontinuity policy, timeScalePolicy: no physics authority, coordinationClockMap: versioned map with bounded error to coastal-coordination-clock }
  stages:
    - ingest: latch PhysicsContext/material registry/hull proxy, terrain support, prior committed offshore/nearshore/foam state, prescribed vessel controls, and coordinationInterval
    - sample-forcing: evaluate the offshore donor and boundary adapter at mapped offshore/nearshore PhysicsInstant requests
    - predict: write water-independent provisional RigidBodyState vesselSourceState and the nearshore predictor; optional vesselVisualResponse samples only committed water for later presentation
    - emit-interactions: build vesselWakeExchange exactly once over its PhysicsTimeInterval from provisional vesselSourceState plus latched hull/material/pair-law versions; vesselVisualResponse is forbidden as an input
    - solve-subcycles: write provisional offshore boundary, nearshore water, and foam versions over mapped intervals that cover coordinationInterval without gaps or overlaps
    - reduce-reactions: record prescribed-vessel external work; no reciprocal rigid-body reaction is claimed
    - correct: enforce wet/dry positivity, boundary compatibility, handoff continuity, covariance/error, and finite-state gates on provisional versions
    - commit: publish accepted offshore-boundary, nearshore-water, foam, and vessel versions only through spectral-coastal-state-commit-group
    - publish-presentation: publish the camera-free candidate from committed versions; camera/view preparation and sealing remain later immutable phases
  loopMacros: []
  commitGroups:
    - { commitGroupId: spectral-coastal-state-commit-group, owner: route physics coordinator, interval: coordinationInterval, provisionalVersions: [offshoreBoundaryState.provisional, waterSurface.provisional, foamState.provisional, vesselSourceState.provisional, vesselVisualResponse.provisional], committedPublications: [offshoreBoundaryState.committed, waterSurface.committed, foamState.committed, vesselSourceState.committed, vesselVisualResponse.committed], publicationLineage: one digest/equivalence/owner-approved row per provisional-to-committed publication, stateEquationOwners: { offshore-spectrum: $threejs-spectral-ocean, nearshore-water: $threejs-water-optics, foam-transport: $threejs-water-optics foam owner, prescribed-vessel-source-kinematics: $threejs-procedural-motion-systems, presentation-only-water-follow-response: $threejs-procedural-motion-systems }, conservationAndErrorGates: [handoff-covariance, water-positivity, boundary-continuity, prescribed-work, visual-response-nonfeedback, finite-state], preparedPublications: canonicalExpansion(required complete PhysicsPreparedPublication records for every provisional-to-committed publication), commitTransactionId: spectral-coastal-state-commit-transaction, atomicity: all-or-none, failureDisposition: preserve-prior-commit }
  originRebaseTransactions: [] # populate with canonical accepted transactions when a physics-origin rebase is scheduled
  publicationRule: donor, coastal, foam, and vessel work remains provisional until the commit group accepts the coherent set
  executionLedger: { type: PhysicsExecutionLedger, ledgerId: route-interval-execution-ledger-id, graphId: route PhysicsGraph ID, graphRevision: exact graph revision, coordinationInterval: graph coordinationInterval, coordinationAdvanceId: exact current coordination advance ID, stageExecutions: complete PhysicsStageExecution rows with exact intervals/subcycles/version claims, dependencyCompletions: exact PhysicsDependencyCompletion refs, stateAdvanceClaims: one accepted state-advance claim or explicit state-hold per owned equation and coordination interval, interactionApplicationLedgers: exact accepted InteractionApplicationLedger refs or [], loopResults: bounded-loop iterations/residuals/accepted iterate, commitReceipts: exact successful PhysicsCommitReceipt refs or [], catchUpDebtBeforeAfter: typed duration pair, discontinuityEpoch: graph epoch, physicsCostLedgerId: route-specific-runtime-physics-cost-ledger-id }
physicsCostLedger:
  type: PhysicsCostLedger
  ledgerId: route-specific-runtime-physics-cost-ledger-id
  status: active
  targetAndHarness: named physical target, spectral donor, persistent nearshore/foam, authored vessel path, fixed views, route tier, viewport, DPR, and sustained protocol
  qualityState: route Full/Budgeted/Minimum viable plus performanceContract.skillTierCrosswalk
  graphStageCosts: [offshore, handoff, vessel, wake reduction, nearshore, foam, commit/publication router cost records]
  coordinationIntervalsPerSecond: labelled distribution on coastal-coordination-clock
  stageExecutionsPerCoordinationInterval: labelled counts by owner/stage
  stageExecutionsPerSecond: labelled counts through registered clock maps
  coordinationIntervalsPerPresentedFrame: labelled distribution through presentation-clock-map-v1
  subcyclesAndCouplingIterationsPerPresentedFrame: labelled offshore/nearshore/foam distributions; coupling iteration explicitly not used
  executionsPerPresentedFrame: labelled stage counts
  worstPermittedCatchUpBurst: { triggerAndIntervalDebt: graph catch-up policy, executionsDispatchesAndTraffic: labelled donor/nearshore/foam records, latencyMemoryAndErrorGate: typed gates }
  hotBytesReadWrittenPerExecution: labelled spectrum/boundary/water/foam/vessel/exchange bytes
  solverDispatches: [offshore FFT, boundary reconstruction, nearshore, and foam extent/workgroup/cadence/timing records]
  queueSubmissionsAndPassBreaks: labelled counts
  dependencyCriticalPaths: [offshore-to-boundary-to-nearshore-to-commit, vessel-to-wake-to-water, commit-to-candidate-to-view]
  tileGpuTraffic: { attachmentStoreLoadResolveBytes: labelled records, tileSpillEvidence: measured-or-TypedAbsence(not-measured, evidence owner, measurement interval, harness provenance), renderComputePassBreaks: labelled counts }
  bindingAndDeviceLimits: [limit-demand-headroom-and-gate]
  cpuWork: [candidate assembly, authored motion, active-tile and donor scheduling]
  allocationGcAndCompilation: [cadence-latency-and-byte-record]
  uploadsCopiesMaps: [TrafficRecord]
  hostCompletionsReadbacksPerPresentedFrame: labelled zero-or-failure record
  synchronization: [wait-or-stall-record]
  multiviewAndFramesInFlightMultipliers: labelled view/lease/resource records
  hotState: PhysicsMemoryLedger
  peakTransient: PhysicsMemoryLedger
  migrationOverlap: PhysicsMemoryLedger
  thermalPowerState: measured-or-TypedAbsence(not-measured, evidence owner, measurement interval, harness provenance)
physicsSignals:
  terrainSupport: { type: PhysicsSignalDescriptor<SupportSurfaceSample>, producer: $threejs-procedural-geometry support adapter, consumers: [$threejs-water-optics boundary compiler, $threejs-procedural-motion-systems vessel adapter, $threejs-visual-validation] }
  offshoreBoundaryState: { type: PhysicsSignalDescriptor<water-boundary-state>, producer: $threejs-spectral-ocean, consumers: [$threejs-water-optics coastal boundary adapter, $threejs-visual-validation] }
  waterSurface: { type: PhysicsSignalDescriptor<WaterSurfaceSample>, producer: $threejs-water-optics, consumers: [$threejs-procedural-motion-systems presentation-response adapter, water optics/shading, $threejs-visual-validation], residency: CPU-authoritative nearshore state/query plus same-spectrum analytic offshore adapter with immutable async GPU presentation upload; frame-critical readback forbidden }
  vesselSourceState: { type: PhysicsSignalDescriptor<RigidBodyState>, producer: $threejs-procedural-motion-systems, consumers: [$threejs-water-optics vessel coupling adapter, route presentation assembler, $threejs-visual-validation], motionMode: kinematic, invariant: trajectory/pose/twist independent of water state, residency: CPU committed state with asynchronous immutable presentation upload }
  vesselVisualResponse: { type: PhysicsSignalDescriptor<presentation-only-vessel-response>, producer: $threejs-procedural-motion-systems, consumers: [route presentation assembler, $threejs-visual-validation], sourceInputs: [vesselSourceState.committed, waterSurface.committed], invariant: contributes only a PresentedStatePair/global binding and cannot enter InteractionRecord, ColliderProxy pose, or water boundary state }
  qualityChangeRequest: { type: PhysicsSignalDescriptor<QualityChangeRequest>, producer: $threejs-image-pipeline quality governor, consumers: [route physics coordinator] }
  qualityTransition: { type: PhysicsSignalDescriptor<QualityTransition>, producer: route physics coordinator, consumers: [$threejs-spectral-ocean, $threejs-water-optics, $threejs-procedural-motion-systems vessel adapter, $threejs-image-pipeline, $threejs-visual-validation] }
physicsInteractions:
  - exchangeId: vessel-wake-exchange
    type: SurfaceExchange
    mode: one-way
    producer: $threejs-water-optics vessel source adapter
    consumers: [$threejs-water-optics nearshore source reducer, $threejs-visual-validation]
    applicationInterval: vessel-wake-application-interval (PhysicsTimeInterval on coastal-coordination-clock)
    physicsFrameId: PhysicsContext.physicsRootFrameId
    physicsOriginEpoch: PhysicsContext.physicsOriginEpoch
    transformRevision: PhysicsContext.worldTransformRevision
    sourceDescriptors: [vesselSourceState, vesselBoundaryProxy, latched hull/water material states and pair law]
    interactions:
      - { interactionId: vessel-moving-boundary, exactOnceKey: exact interval/stage/source-sequence/interaction key, role: source, sourceOwner: prescribed vessel boundary adapter, sourceEntityId: authored-vessel generation, sourceStateVersions: [vesselSourceState provisional version, hull proxy topology/pose generation, hull/water PhysicsMaterialState versions, resolved pair/slip-law revision], targetOwner: $threejs-water-optics, targetEntityId: nearshore active-tile generation, targetStateVersionExpected: nearshore predictor version, targetStateEquation: nearshore moving-boundary condition, applicationInterval: vessel-wake-application-interval, physicsFrameId: PhysicsContext.physicsRootFrameId, physicsOriginEpoch: PhysicsContext.physicsOriginEpoch, transformRevision: PhysicsContext.worldTransformRevision, footprint: oriented hull area quadrature with physical m2 weights/reference point/geometry/Jacobian/error, payload: { tag: movingBoundary, timeSemantics: state-over-interval, boundaryPositionMetersByQuadraturePoint: versioned hull points, boundaryVelocityMpsByQuadraturePoint: physical point velocities from vesselSourceState, noPenetrationAndSlipLawRef: latched water-hull pair-law revision }, signConvention: positive-source-to-receiver, applicationLedgerKey: exact-once boundary key, reactionGroupId: TypedAbsence(not-applicable, prescribed vessel boundary adapter, wake interval, one-way prescribed source), reactionToInteractionIds: [], conservationGroupIds: [vessel-external-work-open-system], validity: exact source/target bracket and proxy domain, error: propagated pose/proxy/quadrature/law error, provenance: adapter/build/source trajectory }
    reactions: []
    reactionGroups: []
    conservationGroups: [vessel-external-work-open-system]
    stabilityGate: accepted boundary/source amplitude and water-state finite/positivity bounds
    convergence: not-applicable
    batchLedger: { type: InteractionBatchLedger, batchId: spectral-vessel-wake-batch, exchangeId: vessel-wake-exchange, producerId: $threejs-water-optics vessel source adapter, publishedSequenceRange: closed monotonic range, perConsumerCursor: per-consumer next sequence, acceptedRejectedLateDuplicate: typed labelled counts, overflowPolicy: reject-batch, overflowSequenceRanges: explicit ranges, lostCommodities: typed momentum/work commodity map, deferredCommodities: typed momentum/work commodity map, applicationLedgerIds: exact InteractionApplicationLedger IDs whose dispositions cover publishedSequenceRange, exactOnceApplicationLedgerVersion: opaque version }
    accounting: prescribed kinematics supply external work; displaced water has zero net mass source, and this route claims no rigid-body reaction
    omittedFeedback: route is explicitly prescribed-kinematic; report a Gated upper bound on ignored water-to-physical-source pose/energy error or narrow the accepted shot envelope; presentation-only water following is not physical feedback
physicsCoordinationAdvanceRecords:
  canonicalExpansion: required before emitted-manifest validation
  records: exact PhysicsCoordinationAdvanceRecord records keyed by coordinationAdvanceId, each closing stage executions, dependency completions, state-advance claims, application ledgers, commit receipt, debt arithmetic, and status for one coordination interval
physicsInteractionApplicationLedgers:
  canonicalExpansion: required before emitted-manifest validation
  records: exact InteractionApplicationLedger records for every prepared/committed/deferred/rejected/duplicate interaction disposition; [] only when physicsInteractions is []
physicsCommitTransactions:
  canonicalExpansion: required before emitted-manifest validation
  records: exact PhysicsCommitTransaction records keyed by every commitGroup.commitTransactionId with prepared-publication bijection, gate results, one commit instant, receipt, and rollback disposition
physicsQualityRequests:
  canonicalExpansion: required before emitted-manifest validation
  records: exact QualityChangeRequest records keyed by requestId; each transition requestId/requestSequence/scope/controls/evidence digest resolves one immutable request and its admission
physicsQualityStates:
  canonicalExpansion: required before emitted-manifest validation
  records: exact PhysicsQualityStateDescriptor records keyed by qualityStateId for every active, source, and destination state referenced by a request, admission, transition, conservative map, or cost ledger
physicsQualityTransitions:
  canonicalExpansion: required before emitted-manifest validation
  records: exact QualityTransition records for every admitted QualityChangeRequest; [] only when no quality transition is admitted in the covered interval
physicsErrorPropagationLedgers:
  canonicalExpansion: required before emitted-manifest validation
  unresolvedBlocker: emit complete ErrorPropagationLedger records for every committed signal, interaction, and presentation-consumed derived state; every provider response must resolve errorPropagationLedgerRef
physicsPresentationTimeCohortsById:
  spectral-vessel-archipelago-cohort: { type: PresentationTimeCohort, timeCohortId: spectral-vessel-archipelago-cohort, presentationClockId: presentation-clock, presentationOpportunitySequence: exact monotonic integer, previousRequestedPresentationInstant: exact previous PhysicsInstant, currentRequestedPresentationInstant: exact current PhysicsInstant, requestedPresentationInstant: same current PhysicsInstant, requiredContextIds: [physicsContext.contextId], requiredDiscontinuityEpochs: { physicsContext.contextId: exact current discontinuity epoch }, maximumInterContextSkew: zero for one context, maximumCandidateAge: Gated PhysicsDuration, admissionPolicy: exact-instant, cohortSpecificationDigest: canonical cohort digest }
physicsPresentationCandidate:
  type: PhysicsPresentationCandidate
  candidateId: runtime-id
  contextId: physicsContext.contextId
  presentationEpoch: exact route presentation epoch
  timeCohortId: spectral-vessel-archipelago-cohort
  requestedPresentationInstant: physicsPresentationTimeCohortsById.spectral-vessel-archipelago-cohort.currentRequestedPresentationInstant
  physicsOriginEpoch: physicsContext.physicsOriginEpoch
  commitProvenance: exact CandidateCommitProvenance resolving offshore/coastal/foam/vessel versions to spectral-coastal commit receipt IDs/digests
  candidateScope: committed-state-brackets-leases-and-events
  producer: route physics coordinator
  consumers: [design-view camera owner, route presentation assembler]
  contents: requestedPresentationInstant plus committed offshore/coastal/foam/vessel PresentedStatePair entries with independent provenance, physics-qualified state handles, exact leases, and consumed event ranges; contains no camera/render/view/shadow/cache data
  presentedStatePairs: canonicalExpansion(required complete per-binding PresentedStatePair records)
  resourceLeases: canonicalExpansion(required complete Candidate-scoped PresentationResourceLease records)
  eventSequenceRanges: canonicalExpansion(required complete PresentationEventRange records or [])
  qualityMigration: a QualityTransition commits at commitInstant with conservative map/reset, queue boundary, conservation/covariance/error residuals, atomic provider versions, ConsumerCompletionJoin retirement, scoped resets, and rollback before candidate publication
physicsCameraViewPublicationsByTarget:
  main/design-view: { type: CameraViewPublication, cameraPublicationId: runtime-id, candidateId: physicsPresentationCandidate.candidateId, owner: design-view camera owner, presentationTargetId: main, viewId: design-view, cameraId: design-camera, contents: previous/current PhysicsInstant, source-qualified RenderSimilarityTransforms, unjittered matrices, jitter, viewport/DPR/extent, depth, and projection validity/error }
physicsViewPreparationPublicationsByTarget:
  main/design-view: { type: ViewPreparationPublication, viewPreparationId: runtime-id, candidateId: physicsPresentationCandidate.candidateId, cameraPublicationId: physicsCameraViewPublicationsByTarget["main/design-view"].cameraPublicationId, presentationTargetId: main, viewId: design-view, resourceLeases: full PresentationResourceLease records for newly created camera-dependent resources, resourceLeaseRefs: exact Candidate and same-preparation refs, contents: visibility/acceleration/shadow/cache refs, reactive/reset DAG, and exact lease refs }
physicsPresentationSnapshotsByTarget:
  main/design-view: { type: PhysicsPresentationSnapshot, snapshotId: runtime-id, producer: route presentation sealer, candidateId: physicsPresentationCandidate.candidateId, cameraPublicationId: physicsCameraViewPublicationsByTarget["main/design-view"].cameraPublicationId, viewPreparationId: physicsViewPreparationPublicationsByTarget["main/design-view"].viewPreparationId, presentationTargetId: main, viewId: design-view, presentedStatePairRefs: candidate binding IDs, resourceLeaseRefs: exact transitive refs, eventSequenceRanges: candidate ranges, closureManifest: canonicalExpansion(required complete PresentationClosureManifest with exact pair-state, preparation, reactive/reset, shadow/cache/visibility lease closure, event ranges, dependency DAG digest, and closure digest), sealVersion: runtime-version, consumers: [design-view scene/water passes, $threejs-visual-validation] }
physicsPresentationRenderPlansByTarget:
  main/design-view: { type: PresentationRenderPlan, renderPlanId: spectral-vessel-design-render-plan, timeCohortId: spectral-vessel-archipelago-cohort, candidateId: physicsPresentationCandidate.candidateId, snapshotId: physicsPresentationSnapshotsByTarget["main/design-view"].snapshotId, presentationTargetId: main, viewId: design-view, phaseIds: exact selected phase IDs, phaseRecords: canonicalExpansion(required complete RenderPlanPhase records), edges: canonicalExpansion(required complete RenderPlanEdge DAG), requiredPreparationEdgeIds: exact preparation edges, renderResourceLeaseIds: exact render leases, plannedResetActionIds: exact reset actions, expectedResetHistoryGenerations: exact generation map, shadowFactorIds: exact once-applied factor IDs or [], closureDigest: canonical plan closure digest, immutablePlanDigest: canonical immutable plan digest }
frameExecutionRecord:
  type: FrameExecutionRecord
  producer: $threejs-image-pipeline frame executor
  consumers: [$threejs-visual-validation, performance evidence]
  executionId: unique append-only presentation execution
  timeCohortId: spectral-vessel-archipelago-cohort
  candidateIds: [physicsPresentationCandidate.candidateId]
  cohortAdmission: exact admitted FrameCohortAdmission for spectral-vessel-archipelago-cohort
  renderPlans: [physicsPresentationRenderPlansByTarget["main/design-view"]]
  slotAdmissions: [exact admitted main/design-view FrameSlotAdmission]
  requiredTargetViewKeys: [main/design-view]
  snapshotIds: [physicsPresentationSnapshotsByTarget["main/design-view"].snapshotId]
  overallStatus: submitted | completed | partial-failure | aborted | device-lost
  backendGeneration: exact backend generation
  deviceLossGeneration: exact device-loss generation
  targetExecutions:
    main/design-view: { snapshotId: physicsPresentationSnapshotsByTarget["main/design-view"].snapshotId, renderPlanId: spectral-vessel-design-render-plan, slotAdmissionId: exact admitted main/design-view slot ID, presentationTargetId: main, viewId: design-view, status: typed target status, submittedPasses: exact pass keys, queueSubmissionEpochs: ordered epochs, actionResults: typed results, resetActionResults: exact planned reset results, completionTokens: exact tokens, presentedTimestamp: mapped presentation-clock record or TypedAbsence(not-presented, frame executor, execution interval, target status), failure: typed failure or TypedAbsence(no-failure, frame executor, execution interval, target status) }
  leaseDispositionById:
    lease-id: { disposition: retained-until-join | retired-after-abort | invalidated-by-device-loss, consumingSnapshotIds: [physicsPresentationSnapshotsByTarget["main/design-view"].snapshotId], completionJoin: { simulationConsumers: [typed tokens], couplingConsumers: [typed tokens], externalConsumers: [], presentationConsumers: [typed tokens], deviceLossRetirementPath: typed rule }, retirementEvidence: typed completion-or-loss record }
  immutability: append completion only; never mutate prior records
physicsPresentationSnapshot: not used # deprecated compatibility projection; never allocated
uniqueWorkLedger:
  simulationStep:
    - water.open-update: "selected spectral donor evolution"
    - vessel.authored-motion-update: "one authored body-state producer"
    - water.vessel-source-reduce: "one typed contact-to-SurfaceExchange adapter"
    - water.nearshore-update: "accepted nonlinear nearshore dynamics"
    - water.foam-update: "one source/advection/decay owner"
    - physics.publish-presentation: "one immutable cross-domain snapshot"
performanceContract:
  skillTierCrosswalk: { status: required-before-acceptance, rule: map every selected skill local tier explicitly to route Full/Budgeted/Minimum viable with protected invariants and explicit unsupported-tier mappings; no implicit name equality }
  passKeys: [water.open-update, vessel.authored-motion-update, water.vessel-source-reduce, water.nearshore-update, water.foam-update, physics.publish-presentation, design-view.opaque-scene, design-view.water-composite, main.present]
coverageStatus: partial
coverageBlockers: general prop assets, lighting/environment authorship, and source-asset preparation remain supplied project inputs; this selected variant owns the spectral/coastal handoff and typed authored-vessel wake but does not claim external rigid-body dynamics
```

The full causal-weather/body route is a fourth manifest, not a mode switch on
the authored-vessel route. It keeps authoritative body, bounded coastal water,
receiver inventory, and coupling on CPU/host state; the spectral visual donor
provides a same-spectrum CPU analytic boundary adapter, so no frame-critical
GPU readback is admitted.

```text
routeVariant: spectral-coastal-rigid-body-causal-weather
workloadProfile: { domain: cinematic-art, intent: present, truthContract: physically-plausible, representation: hybrid, interaction: free-navigation, temporal: simulation, scale: city-terrain }
selectedSkills:
  - $threejs-procedural-fields
  - $threejs-procedural-geometry
  - $threejs-procedural-materials
  - $threejs-spectral-ocean
  - $threejs-water-optics
  - $threejs-volumetric-clouds
  - $threejs-rain-snow-and-wet-surfaces
  - $threejs-procedural-vegetation
  - $threejs-procedural-buildings-and-cities
  - $threejs-camera-controls-and-rigs
  - $threejs-image-pipeline
  - $threejs-visual-validation
causeLedger:
  sourceOfTruth: shared coast/bathymetry fields, spectral offshore state, CPU-authoritative bounded coastal state, supplied external rigid-body solver, one EnvironmentForcingSnapshot producer, one causal cloud microphysics owner publishing PrecipitationEmissionSnapshot, and one receiver-liquid owner
  selectedAlgorithm: same-spectrum CPU spectral-boundary sampling drives bounded coastal water; one ExternalSolverAdapter and a bounded semi-implicit reaction group couple the body reciprocally; calibrated forcing drives causal cloud emission on interval n, transport/deposition and sole-owner receiver inventory on the declared later edge, runoff from the preceding committed receiver interval, and density-dependent rooted vegetation loading
  rejectedAlgorithms: [GPU readback to drive the CPU solver, independent visual wake, raw instantaneous wind written directly into spectral parameters, duplicate wetness owners]
owners: { sourceOfTruth: shared field graph plus project forcing/external providers, cloudMicrophysics: $threejs-volumetric-clouds, rigidState: external rigid-body adapter, receiverState: rain receiver reducer, presentation: $threejs-image-pipeline, validation: $threejs-visual-validation }
physicsContext:
  type: PhysicsContext
  producer: route physics coordinator
  invariant: one finite positive metersPerWorldUnit; stable right-handed SI frame; typed gravity; versioned world/physics transform; distinct physics/render origin epochs; generation-bearing provider/entity/collider/material/interaction IDs
  physicsMaterialRegistry: { registryId: archipelago-physics-materials, owner: route material-registry owner, registryVersion: materials-v3, materials: [water, wet/dry substrate, rock, vegetation, hull, dock], pairLawResolver: deterministic ordered-pair laws with explicit missing-pair rejection, renderBindings: explicit render-binding-to-PhysicsMaterialId map; no PBR inference }
physicsMaterialsAndProxies:
  rigidBodyProperties: { type: RigidBodyProperties, entityId: vessel generation-bearing ID, owner: external rigid-body adapter, massKg: positive measured/derived quantity, centerOfMassBodyMeters: typed Vec3, inertiaTensorBodyKgM2: symmetric positive-valid tensor, bodyFrameId: registered body frame, colliderIds: [hull collider ID], physicsMaterialIds: [hull material ID], stateEquation: supplied rigid-body equations, forceTorqueApplicationOwner: external rigid-body adapter, error: per-property bounds }
  hydrostaticHull: { type: HydrostaticHullProperties, entityId: vessel ID, hullFrameId: registered body frame, geometry: clipped-panels, geometryRevision: hull-v3, displacedVolumeQuery: versioned watertight query, waterlineClipping: conservative oriented-panel clipper, buoyancyModel: hydrostatic plus declared wave extension, dragModel: versioned relative-current law, addedMassModel: versioned law with loop stability gate, waveExcitationModel: no duplicate offshore/coastal term, samplingFootprint: hull quadrature support, approximationError: per-output bounds, validity: declared Froude/depth/wave regime }
  hullCollider: { type: ColliderProxy, colliderId: hull collider generation, entityId: vessel generation, shapeId: hull shape generation, contextId: physicsContext.contextId, shapeFrameId: registered body frame, physicsFrameId: physics root, physicsOriginEpoch: current epoch, transformRevision: registered revision, shapeRepresentation: convex compound, shapeDefinitionRef: content-addressed hull proxy, topologyRevision: hull-v3, poseSignalRef: bodyState descriptor ref, poseStateVersion: committed body version, validityInterval: exact body interval, updateCadence: external-body clock, sweptBounds: conservative interval bound, oneSidedness: two-sided, closedness: watertight-with-gate, collisionMode: continuous-with-named-sweep, featureIdPolicy: stable versioned map, conservativeInflationMeters: Gated quantity, physicsMaterialId: hull material ID, collisionGroups: explicit filters, approximationError: support-distance/inertia bounds, residency: CPU external adapter }
  contactManifoldRecords: { type: ContactManifoldRecord, owner: external rigid-body adapter, canonicalFields: generation-bearing manifold ID, solver/law revision, begin/persist/end interval, sample instant, frame/origin/transform, both body/collider/shape/feature/state and material/version records, persistent patch points/tangent/area, separation/TOI/relative velocity, pair law, friction/adhesion/warm-start state, emitted interaction IDs, validity/error/reset-migration policy }
externalSolverAdapter:
  type: ExternalSolverAdapter
  adapterId: external-rigid-body-adapter
  externalSolverIdVersion: supplied solver/build identity plus adapter revision
  contextId: physicsContext.contextId
  boundaryRevision: external-rigid-body-boundary-v3
  ownedStateEquations: [rigid-body pose/twist and linear/angular momentum]
  ownership: { stepping: external-solver, constraintAssemblyAndSolve: external-solver, collisionDetection: external-solver, contactManifoldLifecycle: external-solver, forceImpulseAccumulation: external-solver, committedStatePublication: external rigid-body adapter }
  supportedFramesCharts: [physics root, registered external body frame]
  unitConversion: { sourceUnitSystemId: supplied-solver-units-v1, destinationUnitSystemId: canonical-SI, perQuantityAffineOrLinearMaps: dimension-checked exact factors/offsets, handednessAndAxialConvention: one versioned ingress/egress map, conversionError: per-quantity bounds }
  clockMapping: { externalClockId: external-body-clock, contextClockId: coastal-coordination-clock, mappingRevision: external-body-clock-map-v2, mappingDescriptorRef: physicsGraph.clocks.externalBodyClock, maximumAgeAndMappingError: typed Gated bounds }
  stepSemantics: fixed
  signalDescriptors: [bodyState, contactManifoldSet]
  interactionCapabilities:
    - { type: ExternalInteractionCapability, capabilityId: coastal-hydrodynamic-load-ingress, direction: ingress, role: reaction, payloadTag: wrenchRate, targetEquationId: rigid-body-linear-angular-momentum, frameId: physicsContext.physicsRootFrameId, unitSignature: force-N/torque-Nm/reference-point-m, footprintKinds: [area], cadence: { type: PhysicsCadenceDescriptor, kind: fixed, clockId: external-body-clock, intervalOrTrigger: every loop iteration at the frozen coupling bracket, samplePhase: substep-stage, jitterBound: zero within bracket, maximumBurst: Gated iteration bound, evidence: body-water loop execution trace }, batchBounds: Gated hull-quadrature count/layout/bytes, exactOnceSupport: required-ledger, reactionAtomicity: same-commit-transaction, residency: { type: PhysicsResidencyDescriptor, kind: external, deviceId: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), queueId: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), bindingIdentity: body-state-ABI-v3 wrench ingress, sameQueueAvailability: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), hostVisibility: host-visible, mirror: TypedAbsence(no-mirror, external adapter, capability interval, host-authoritative residency), readbackPolicy: forbidden }, dependencyRef: { type: PhysicsDependencyRef, dependencyId: coastal-hydrodynamic-load-ingress-dependency, requiredCompletionVersion: exact per-iteration completion version }, errorDescriptorRef: body-water-coupling-error }
    - { type: ExternalInteractionCapability, capabilityId: coastal-moving-boundary-egress, direction: egress, role: source, payloadTag: movingBoundary, targetEquationId: nearshore-no-penetration-and-momentum-boundary, frameId: physicsContext.physicsRootFrameId, unitSignature: boundary-position-m/boundary-velocity-mps, footprintKinds: [area], cadence: { type: PhysicsCadenceDescriptor, kind: fixed, clockId: external-body-clock, intervalOrTrigger: every loop iteration at the frozen coupling bracket, samplePhase: substep-stage, jitterBound: zero within bracket, maximumBurst: Gated iteration bound, evidence: body-water loop execution trace }, batchBounds: Gated hull-quadrature count/layout/bytes, exactOnceSupport: required-ledger, reactionAtomicity: same-commit-transaction, residency: { type: PhysicsResidencyDescriptor, kind: external, deviceId: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), queueId: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), bindingIdentity: body-state-ABI-v3 moving-boundary egress, sameQueueAvailability: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), hostVisibility: host-visible, mirror: TypedAbsence(no-mirror, external adapter, capability interval, host-authoritative residency), readbackPolicy: forbidden }, dependencyRef: { type: PhysicsDependencyRef, dependencyId: coastal-moving-boundary-egress-dependency, requiredCompletionVersion: exact per-iteration completion version }, errorDescriptorRef: external-body-boundary-error }
  stepReceipts:
    - { type: ExternalSolverStepReceipt, receiptId: exact external step receipt per loop iteration, adapterId: external-rigid-body-adapter, coordinationAdvanceId: exact current coastal coordination advance ID, externalStepSequence: exact monotonic integer, requestedInterval: exact loop coupling/subcycle PhysicsTimeInterval, actualNativeExecutionIntervals: exact ordered nonoverlapping external intervals, inputStateVersions: exact body/manifold/water/forcing versions, inputApplicationLedgerIds: exact accepted ingress application-ledger IDs, outputPreparedVersions: exact body/manifold loop-provisional or transaction-prepared versions, emittedInteractionSequenceRanges: exact moving-boundary egress ranges, dependencyCompletionRefs: exact ingress/egress PhysicsDependencyCompletion refs, status: prepared | completed | rejected | failed, contentDigest: canonical step receipt digest }
  residencySynchronization:
    authorityBySignalOrStateEquation: { rigid-body-pose-twist-and-momentum: external-rigid-body-adapter, contact-manifold-lifecycle/warm-start/friction-state: external-rigid-body-adapter }
    transport: host-staging
    resourceProtocol: { handleAndLayoutKinds: body-state-ABI-v3, producerAccessAndConsumerAccess: external-write-route-read, generationAndSubresourceFields: explicit, acquireDependency: { type: PhysicsDependencyRef, dependencyId: coastal-moving-boundary-egress-dependency, requiredCompletionVersion: exact per-iteration completion version }, releaseOrCompletionToken: external-step-complete-token, lifecycleAndRetirementOwner: external-rigid-body-adapter }
    transferProtocol: { serializationLayoutAndDigest: canonical-body-state-v3-plus-content-digest, endianPrecisionAndQuantization: little-endian-f64-state-f32-bounded-presentation, sequenceAndExactOnceKeys: external-step-sequence-plus-application-ledger, maximumBytesCadenceLatencyAndStaleness: typed Gated bounds }
    hostVisibilityProof: external-fence-and-validated-transfer
  precisionDeterminism: { scalarFormatsAndAccumulationMode: declared-by-channel, reductionOrdering: deterministic-tree, solverSeedAndStreamIdentity: exact cursor map, replayEquivalenceGate: bounded-observable-error }
  errorModel: per-channel and coupling errors
  checkpointRollback: { support: checkpoint-and-replay, checkpointFormatAndDigest: external-body-checkpoint-v3, cadenceAndMaximumRollback: typed policy, includedStateVersionsInventoriesAndCursors: body/manifold/warm-start/stable-ID/RNG/event/application-ledger set, restoreOrderingAndValidationGates: restore-before-replay then finite/contact/conservation gates }
  failurePolicy: { detectionAndTimeout: typed external-step gates, freezeCommitGroups: [spectral-coastal-weather-body-commit-group], priorCommittedStateDisposition: preserve, queuedInteractionEventDisposition: retain-for-replay, recoveryOwnerAndPlan: external-rigid-body-adapter checkpoint transaction, degradedPublication: forbidden }
physicsGraph:
  type: PhysicsGraph
  producer: route physics coordinator
  graphId: spectral-coastal-weather-body-physics-graph
  contextId: physicsContext.contextId
  coordinationInterval: nonempty PhysicsTimeInterval on coastal-coordination-clock
  coordinationAdvance: one PhysicsCoordinationAdvanceRecord with exact catch-up batch/predecessor receipt, debt, stage execution/claim/transaction IDs, status, and receipt digest
  clocks:
    coastalCoordinationClock: { type: PhysicsClockDescriptor, clockId: coastal-coordination-clock, owner: route physics coordinator, mappingKind: fixed-rational, mappingRevision: coastal-clock-map-v2, discontinuityEpoch: coastal-continuity-v2, coordinationClockMap: identity-with-zero-error }
    forcingClock: { type: PhysicsClockDescriptor, clockId: forcing-clock, owner: project environment coordinator, mappingKind: timestamp-table, mappingRevision: forcing-clock-map-v2, discontinuityEpoch: forcing-continuity-v2, coordinationClockMap: versioned bounded-error map }
    offshoreClock: { type: PhysicsClockDescriptor, clockId: offshore-clock, owner: $threejs-spectral-ocean, mappingKind: fixed-rational, mappingRevision: offshore-clock-map-v2, discontinuityEpoch: coastal-continuity-v2, coordinationClockMap: exact analytic-phase map }
    nearshoreClock: { type: PhysicsClockDescriptor, clockId: nearshore-clock, owner: $threejs-water-optics, mappingKind: piecewise-versioned, mappingRevision: nearshore-clock-map-v2, discontinuityEpoch: coastal-continuity-v2, coordinationClockMap: subinterval map tiling coordinationInterval under CFL gate }
    externalBodyClock: { type: PhysicsClockDescriptor, clockId: external-body-clock, owner: external rigid-body adapter, mappingKind: external, mappingRevision: external-body-clock-map-v2, discontinuityEpoch: coastal-continuity-v2, mapping: { fixedRational: TypedAbsence(not-applicable, external rigid-body adapter, route interval, external mapping selected), timestampTable: TypedAbsence(not-applicable, external rigid-body adapter, route interval, external mapping selected), piecewiseVersioned: TypedAbsence(not-applicable, external rigid-body adapter, route interval, external mapping selected), external: { adapterId: external-rigid-body-adapter, adapterVersion: supplied-solver-build, mappingHandle: body-clock-map-v2, coveredInstantRange: exact route interval, frozenEvaluationTable: content-addressed accepted evaluations, onlineQueryProtocol: instant/request-response/revision/digest-v1, unloggedQueryPolicy: reject, error: typed bound } }, pauseSeekPolicy: external solver policy with discontinuity transaction, timeScalePolicy: fixed physical time scale, coordinationClockMap: versioned map with common exact boundary instants and explicit interior error }
    cloudClock: { type: PhysicsClockDescriptor, clockId: cloud-clock, owner: $threejs-volumetric-clouds, mappingKind: piecewise-versioned, mappingRevision: cloud-clock-map-v2, discontinuityEpoch: coastal-continuity-v2, coordinationClockMap: nonoverlapping emission intervals with bounded transport-delay map }
    receiverClock: { type: PhysicsClockDescriptor, clockId: receiver-clock, owner: rain receiver reducer, mappingKind: fixed-rational, mappingRevision: receiver-clock-map-v2, discontinuityEpoch: coastal-continuity-v2, coordinationClockMap: exact receiver interval boundaries; runoff reads prior committed interval }
    foamClock: { type: PhysicsClockDescriptor, clockId: foam-clock, owner: $threejs-water-optics foam owner, mappingKind: piecewise-versioned, mappingRevision: foam-clock-map-v2, discontinuityEpoch: coastal-continuity-v2, coordinationClockMap: subinterval map tiling coordinationInterval under advection gate }
    vegetationClock: { type: PhysicsClockDescriptor, clockId: vegetation-clock, owner: $threejs-procedural-vegetation, mappingKind: fixed-rational, mappingRevision: vegetation-clock-map-v2, discontinuityEpoch: coastal-continuity-v2, coordinationClockMap: exact cadence map }
    presentationClock: { type: PhysicsClockDescriptor, clockId: presentation-clock, owner: route presentation scheduler, mappingKind: external, mappingRevision: presentation-clock-map-v2, discontinuityEpoch: presentation-continuity-v2, coordinationClockMap: versioned bounded-error map }
  stages:
    - ingest: latch committed terrain/bed/coast/substrate/offshore/coastal/foam/body/cloud-density/receiver/vegetation versions, prior-interval PrecipitationEmissionSnapshot, receiver-runoff-to-water and water-inundation-wash exchanges committed for this interval by the preceding coordination interval, one immutable forcing snapshot, registries, exact-once cursors, and pending quality request
    - sample-forcing: sample forcing, prior cloud emission, current committed runoff, and current committed inundation/wash at mapped PhysicsInstant/PhysicsTimeInterval values; derive filtered reference-height ocean input and sample vegetation/receiver footprints; do not sample the body-water iterate here
    - predict: outside the coupling loop, write provisional offshore boundary, foam, receiver-liquid, and vegetation-response versions exactly once per declared native interval; cloud emission is not predicted ahead of cloud density
    - body-water-predict: for every iteration reconstruct body, contact-manifold, and bounded-water predictors at one frozen coupling bracket from the committed seeds plus the same immutable current-interval runoff exchange; never advance from or add runoff onto the rejected prior iterate
    - emit-interactions: outside the coupling loop, emit deposition from prior committed cloud emission plus receiver-runoff-to-water and water-inundation-wash exchanges for the next coordination interval from interval-start committed receiver/water state; publish each sequence once and never emit either cross-interval source inside the body-water loop
    - body-water-emit-interactions: on every coupling iteration, resample both provisional participants at the same bracket and emit only the provisional body-water source/reaction group
    - solve-subcycles: outside the coupling loop, first evolve cloudDensity over its mapped nonoverlapping PhysicsTimeIntervals and then derive precipitationEmission from that evolved density and the same source/sink inventory; advance receiver once with current deposition plus current committed inundation/wash, and advance offshore boundary, foam, and vegetation; current receiver state cannot feed current runoff
    - body-water-solve-subcycles: recompute only loop-scoped provisional external-body/contact-manifold/bounded-water versions for the current iteration from the committed seed and fixed current runoff source; an accepted source is applied once, while rejected iterations have no application-ledger effect
    - reduce-reactions: reduce cloud-density/emission, deposition, inundation/wash, receiver, and next-interval-runoff commodity ledgers exactly once outside the coupling loop
    - body-water-reduce-reactions: reduce only the provisional body-water reaction group deterministically for the current iteration
    - correct: gate offshore/coastal handoff, receiver closure, vegetation root/strain, cloud/emission closure, and finite outer-domain state
    - body-water-correct: gate coupling convergence, force/torque/interface work, water positivity, collider/material/manifold consistency, added-mass stability, and finite loop state
    - commit: publish only the coherent accepted set through spectral-coastal-weather-body-commit-group
    - publish-presentation: publish one camera-free candidate; camera, preparation, and sealing are later immutable phases
  edges:
    - { type: PhysicsGraphEdge, edgeId: coastal-moving-boundary-egress-edge, producerStageId: body-water-predict, consumerStageId: body-water-emit-interactions, payload: bodyState/contactManifoldSet moving-boundary loop-provisional versions, requiredVersionAndPhase: exact iteration index and frozen bracket, interpolationExtrapolation: not-used, maximumStaleness: not-applicable, latency: exact external predictor latency descriptor, barrier: { type: PhysicsDependencyRef, dependencyId: coastal-moving-boundary-egress-dependency, requiredCompletionVersion: exact per-iteration completion version }, absencePolicy: block }
    - { type: PhysicsGraphEdge, edgeId: coastal-hydrodynamic-load-ingress-edge, producerStageId: body-water-reduce-reactions, consumerStageId: body-water-correct, payload: water-to-body wrenchRate reaction and exact loop-provisional version, requiredVersionAndPhase: exact iteration index and frozen bracket, interpolationExtrapolation: not-used, maximumStaleness: not-applicable, latency: exact same-iteration reaction latency descriptor, barrier: { type: PhysicsDependencyRef, dependencyId: coastal-hydrodynamic-load-ingress-dependency, requiredCompletionVersion: exact per-iteration completion version }, absencePolicy: block }
  dependencies:
    - { type: PhysicsDependency, dependencyId: coastal-moving-boundary-egress-dependency, kind: external-fence, producerStageId: body-water-predict, consumerStageId: body-water-emit-interactions, payloadSchemaAndVersionRule: exact body/manifold movingBoundary iteration-version rule, producerResidencyRule: external host-authoritative staging residency, consumerResidencyRule: coupling adapter CPU residency, resourceSubresourceRule: exact staged hull/body ranges, accessTransitionRule: external write to route immutable read, generationCompatibilityRule: exact adapter/body/manifold/hull generations, releaseAcquireProtocol: external-step token then host first-read acquire, externalFenceOrHostVisibilityRule: external fence plus validated transfer, completionSemantics: same-iteration moving-boundary payload and digest host-visible before emission }
    - { type: PhysicsDependency, dependencyId: coastal-hydrodynamic-load-ingress-dependency, kind: external-fence, producerStageId: body-water-reduce-reactions, consumerStageId: body-water-correct, payloadSchemaAndVersionRule: exact wrenchRate reaction iteration-version rule, producerResidencyRule: water/coupling CPU residency, consumerResidencyRule: external adapter host-authoritative residency, resourceSubresourceRule: exact wrench batch range, accessTransitionRule: reducer write to external ingress read, generationCompatibilityRule: exact body/water/exchange generations, releaseAcquireProtocol: reaction reduction completion then external ingress acquire, externalFenceOrHostVisibilityRule: validated host transfer/fence, completionSemantics: paired reaction and conservation digest available before same-iteration correction }
  loopMacros:
    - loopId: body-water-semi-implicit-loop
      type: BoundedCouplingLoop
      coordinationAdvanceId: exact current coastal coordination advance ID
      couplingInterval: physicsGraph.coordinationInterval
      orderedStageIds: [body-water-predict, body-water-emit-interactions, body-water-solve-subcycles, body-water-reduce-reactions, body-water-correct]
      iterationBound: Gated iteration bound
      residuals: [state increment, force, torque, linear/angular momentum, interface work]
      convergenceBounds: [Gated typed bounds]
      conservationGroupIds: [body-water-momentum-angular-momentum-work]
      provisionalVersionNamespace: body-water-loop-namespace
      seedCommittedVersions: [bodyState.committed, contactManifoldSet.committed, waterSurface.committed]
      externalReads: [offshoreBoundaryState.committed, receiver-runoff-to-water.committed-for-current-interval, terrainSupport.committed, bathymetryBed.committed, physicsContext.physicsMaterialRegistry]
      iterationCarriedEdges:
        - { type: CouplingIterationEdge, edgeId: body-iterate-carry, producerStageId: body-water-correct, consumerStageId: body-water-predict, signalOrExchangeId: bodyState, producedIterationOffset: 0, consumedIterationOffset: 1, requiredBracket: frozen body-water coupling bracket, requiredProvisionalVersionPattern: body-water-loop-namespace/bodyState/iteration-i, barrier: cpu-data }
        - { type: CouplingIterationEdge, edgeId: manifold-iterate-carry, producerStageId: body-water-correct, consumerStageId: body-water-predict, signalOrExchangeId: contactManifoldSet, producedIterationOffset: 0, consumedIterationOffset: 1, requiredBracket: frozen body-water coupling bracket, requiredProvisionalVersionPattern: body-water-loop-namespace/contactManifoldSet/iteration-i, barrier: external-fence }
        - { type: CouplingIterationEdge, edgeId: water-iterate-carry, producerStageId: body-water-correct, consumerStageId: body-water-predict, signalOrExchangeId: waterSurface, producedIterationOffset: 0, consumedIterationOffset: 1, requiredBracket: frozen body-water coupling bracket, requiredProvisionalVersionPattern: body-water-loop-namespace/waterSurface/iteration-i, barrier: cpu-data }
        - { type: CouplingIterationEdge, edgeId: exchange-iterate-carry, producerStageId: body-water-reduce-reactions, consumerStageId: body-water-predict, signalOrExchangeId: body-water-exchange, producedIterationOffset: 0, consumedIterationOffset: 1, requiredBracket: frozen body-water coupling bracket, requiredProvisionalVersionPattern: body-water-loop-namespace/bodyWaterExchange/iteration-i, barrier: cpu-data }
      iterationVersionRule: iteration 0 reads only seedCommittedVersions plus immutable externalReads; iteration i writes the body-water-loop-namespace/signal/iteration-i version at the frozen bracket; iteration i+1 consumes exactly those prior-iteration versions but reconstructs source application from the seed plus receiver-runoff-to-water.committed-for-current-interval, so no rejected iterate or runoff contribution accumulates
      acceptedWrites: [bodyState.provisional-accepted-iteration, contactManifoldSet.provisional-accepted-iteration, waterSurface.provisional-accepted-iteration, bodyWaterExchange.provisional-accepted-iteration]
      perIterationLedger:
        - { type: CouplingIterationLedger, loopId: body-water-semi-implicit-loop, iterationIndex: each executed integer in [0, iterationBound), bracket: frozen body-water coupling bracket, inputVersions: exact seed/external/prior-iteration refs, outputVersions: exact iteration-indexed body/manifold/water/exchange refs, interactionSequenceRanges: loop-local body-water ranges only; excludes runoff/inundation/deposition ranges, residualValues: labelled state/force/torque/momentum/interface-work quantities, conservationResults: [body-water-momentum-angular-momentum-work and status], accepted: exactly one true only after all gates, stageExecutionIds: exact predict/emit/solve-subcycle/reduce/correct execution IDs carrying this loopId and iterationIndex, interactionApplicationLedgerIds: exact loop-local source/reaction ledger IDs for this iteration, outputContentDigest: canonical digest of iteration outputs and ranges, dependencyCompletionRefs: exact CPU/external completion refs }
      acceptedIterationIndex: exact accepted integer or TypedAbsence(not-applicable, record authority, record interval, sketch provenance) on rollback
      acceptedWriteLineage: one CouplingAcceptedWriteLineage per body/manifold/water/exchange accepted write, each binding acceptedIterationIndex, iteration output digest, preparedPublicationId/version, and exact-copy or immutable-handle-promotion proof
      outerEdgePolicy: ingress-committed-and-accepted-egress-only
      acceptedIteratePublication: atomic
      divergenceFallback: rollback
  commitGroups:
    - { commitGroupId: spectral-coastal-weather-body-commit-group, owner: route physics coordinator, interval: coordinationInterval, provisionalVersions: [offshoreBoundaryState.provisional, waterSurface.provisional, foamState.provisional, bodyState.provisional, contactManifoldSet.provisional, cloudDensity.provisional, precipitationEmission.provisional-derived-from-cloudDensity.provisional, receiverWetness.provisional, vegetationResponse.provisional, receiver-runoff-to-water.provisional-for-next-interval, water-inundation-wash-to-receiver.provisional-for-next-interval, accepted exchange cursors], committedPublications: [offshoreBoundaryState.committed, waterSurface.committed, foamState.committed, bodyState.committed, contactManifoldSet.committed, cloudDensity.committed, precipitationEmission.committed-for-next-transport-interval, receiverWetness.committed, vegetationResponse.committed, receiver-runoff-to-water.committed-for-next-interval, water-inundation-wash-to-receiver.committed-for-next-interval, exact-once cursors], publicationLineage: one exact digest/proof/owner/publication-instant row per provisional-to-committed pair, stateEquationOwners: { offshore-spectrum: $threejs-spectral-ocean, nearshore-water-and-foam: $threejs-water-optics, rigid-body-momentum: external rigid-body adapter, contact-manifold-lifecycle/warm-start/friction-state: external rigid-body adapter, cloud-density-and-microphysics: $threejs-volumetric-clouds, precipitation-emission-derived-from-evolved-cloud-density: $threejs-volumetric-clouds, receiver-liquid-mass: rain receiver reducer, vegetation-deformation-recovery: $threejs-procedural-vegetation, next-interval-runoff-publication: rain receiver reducer, next-interval-inundation-wash-publication: $threejs-water-optics boundary adapter }, conservationAndErrorGates: [spectral/coastal handoff, water positivity, body-water reaction closure, collider/material/manifold consistency, cloud airborne/emission mass closure, receiver mass closure with current committed inundation/wash and no current-runoff feedback, vegetation root/strain, all referenced ErrorPropagationLedger acceptance gates, finite state], preparedPublications: canonicalExpansion(required complete PhysicsPreparedPublication records for every provisional-to-committed publication), commitTransactionId: spectral-coastal-weather-body-commit-transaction, atomicity: all-or-none, failureDisposition: preserve-prior-commit }
  originRebaseTransactions: [] # populate with canonical accepted transactions when a physics-origin rebase is scheduled
  publicationRule: every predictor, loop iterate, and exchange cursor is provisional; descriptors/events/presentation reference only commit-group publications
  executionLedger: { type: PhysicsExecutionLedger, ledgerId: route-interval-execution-ledger-id, graphId: route PhysicsGraph ID, graphRevision: exact graph revision, coordinationInterval: graph coordinationInterval, coordinationAdvanceId: exact current coordination advance ID, stageExecutions: complete PhysicsStageExecution rows with exact intervals/subcycles/version claims, dependencyCompletions: exact PhysicsDependencyCompletion refs, stateAdvanceClaims: one accepted state-advance claim or explicit state-hold per owned equation and coordination interval, interactionApplicationLedgers: exact accepted InteractionApplicationLedger refs or [], loopResults: bounded-loop iterations/residuals/accepted iterate, commitReceipts: exact successful PhysicsCommitReceipt refs or [], catchUpDebtBeforeAfter: typed duration pair, discontinuityEpoch: graph epoch, physicsCostLedgerId: route-specific-runtime-physics-cost-ledger-id }
physicsErrorPropagationLedgers:
  inventory: { cloudDensity: archipelago-cloud-density-error-ledger, precipitationEmission: archipelago-precipitation-emission-error-ledger, waterSurface: archipelago-water-surface-error-ledger, receiverWetness: archipelago-receiver-error-ledger, vegetationResponse: archipelago-vegetation-error-ledger, receiver-runoff-to-water: archipelago-runoff-error-ledger, water-inundation-wash-to-receiver: archipelago-inundation-wash-error-ledger, body-water-exchange: archipelago-body-water-error-ledger }
  records:
    archipelago-cloud-density-error-ledger: { type: ErrorPropagationLedger, ledgerId: archipelago-cloud-density-error-ledger, contextId: physicsContext.contextId, outputSignalOrInteractionId: cloudDensity, outputStateVersion: cloudDensity.provisional, evaluationInterval: physicsGraph.coordinationInterval, inputErrors: [forcing channel/filter/time errors, prior cloud-density error], transformsFiltersInterpolations: [clock-map, forcing-footprint filter, cloud advection/microphysics step], correlationAssumptions: [shared forcing channels retain declared covariance], operatorOrGainBounds: [advection and source/sink stability bounds], modeledApproximationTerms: [microphysics closure and volume-discretization errors], numericalTerms: [time-integration and reduction residuals], combinationRule: versioned covariance-plus-operator-bound rule, outputError: cloud-density-output-error, acceptanceGate: cloud density and airborne-mass consumer tolerances, provenance: cloud owner/build/forcing/solver revisions }
    archipelago-precipitation-emission-error-ledger: { type: ErrorPropagationLedger, ledgerId: archipelago-precipitation-emission-error-ledger, contextId: physicsContext.contextId, outputSignalOrInteractionId: precipitationEmission, outputStateVersion: precipitationEmission.provisional-derived-from-cloudDensity.provisional, evaluationInterval: mapped cloud emission interval, inputErrors: [cloud-density-output-error, forcing thermodynamic errors, phase/source-sink errors], transformsFiltersInterpolations: [evolved-density-to-emission operator and destination-support map], correlationAssumptions: [density/emission source terms fully correlated where shared], operatorOrGainBounds: [emission extraction and transport-delay bounds], modeledApproximationTerms: [phase-partition and unresolved-microphysics errors], numericalTerms: [quadrature and reduction residuals], combinationRule: versioned correlated operator-bound rule, outputError: precipitation-emission-output-error, acceptanceGate: airborne-plus-emitted mass/phase/momentum closure and transport consumer tolerances, provenance: cloud emission owner/build/state versions }
    archipelago-water-surface-error-ledger: { type: ErrorPropagationLedger, ledgerId: archipelago-water-surface-error-ledger, contextId: physicsContext.contextId, outputSignalOrInteractionId: waterSurface, outputStateVersion: waterSurface.provisional-accepted-iteration, evaluationInterval: physicsGraph.coordinationInterval, inputErrors: [offshore-boundary error, bathymetry/support errors, current committed runoff error, body moving-boundary error], transformsFiltersInterpolations: [same-spectrum boundary map, wet/dry solver, body-water gather/scatter], correlationAssumptions: [runoff mass/momentum and body reaction correlations preserved], operatorOrGainBounds: [CFL, wet/dry, added-mass, gather/scatter bounds], modeledApproximationTerms: [nearshore closure and hull proxy errors], numericalTerms: [accepted loop residual and water discretization residual], combinationRule: versioned interval/operator-bound rule, outputError: coastal-water-output-error, acceptanceGate: water-sample and presentation consumer tolerances, provenance: water/coupling/offshore adapter revisions }
    archipelago-receiver-error-ledger: { type: ErrorPropagationLedger, ledgerId: archipelago-receiver-error-ledger, contextId: physicsContext.contextId, outputSignalOrInteractionId: receiverWetness, outputStateVersion: receiverWetness.provisional, evaluationInterval: physicsGraph.coordinationInterval, inputErrors: [precipitation deposition error, current inundation/wash error, substrate/support errors, prior receiver error], transformsFiltersInterpolations: [receiver quadrature reduction, infiltration/evaporation/drainage maps], correlationAssumptions: [shared precipitation mass/momentum and wash forcing correlations preserved], operatorOrGainBounds: [nonnegative inventory and storage-law bounds], modeledApproximationTerms: [subgrid retention/drainage error], numericalTerms: [receiver closure residual], combinationRule: versioned conservative interval rule, outputError: receiver-liquid-output-error, acceptanceGate: receiver mass and material/vegetation consumer tolerances, provenance: rain receiver reducer/build/material-law revisions }
    archipelago-vegetation-error-ledger: { type: ErrorPropagationLedger, ledgerId: archipelago-vegetation-error-ledger, contextId: physicsContext.contextId, outputSignalOrInteractionId: vegetationResponse, outputStateVersion: vegetationResponse.provisional, evaluationInterval: mapped vegetation interval, inputErrors: [forcing wind/density errors, terrain support error, prior vegetation-state error], transformsFiltersInterpolations: [anchor sampling, aerodynamic load law, rooted deformation integrator], correlationAssumptions: [wind samples use forcing covariance model], operatorOrGainBounds: [drag, strain, bend, root-response bounds], modeledApproximationTerms: [reduced branch/canopy model error], numericalTerms: [substep and constraint residuals], combinationRule: versioned operator-bound rule, outputError: vegetation-response-output-error, acceptanceGate: deformation/support/presentation tolerances, provenance: vegetation owner/build/species/forcing revisions }
    archipelago-runoff-error-ledger: { type: ErrorPropagationLedger, ledgerId: archipelago-runoff-error-ledger, contextId: physicsContext.contextId, outputSignalOrInteractionId: receiver-runoff-to-water, outputStateVersion: receiver-runoff-to-water.provisional-for-next-interval, evaluationInterval: next runoff application interval, inputErrors: [receiver-liquid-output-error, terrain/coast/bathymetry errors], transformsFiltersInterpolations: [drainage catchment map and physical-area quadrature], correlationAssumptions: [mass/momentum flux share receiver and velocity uncertainty], operatorOrGainBounds: [drainage and slope/velocity bounds], modeledApproximationTerms: [subgrid drainage error], numericalTerms: [quadrature and conservation residuals], combinationRule: versioned correlated interval rule, outputError: runoff-exchange-output-error, acceptanceGate: next-interval water source and conservation tolerances, provenance: receiver runoff adapter/build/state versions }
    archipelago-inundation-wash-error-ledger: { type: ErrorPropagationLedger, ledgerId: archipelago-inundation-wash-error-ledger, contextId: physicsContext.contextId, outputSignalOrInteractionId: water-inundation-wash-to-receiver, outputStateVersion: water-inundation-wash-to-receiver.provisional-for-next-interval, evaluationInterval: next receiver application interval, inputErrors: [coastal-water-output-error, terrain/coast/support errors], transformsFiltersInterpolations: [wet/dry-front intersection, water-to-receiver physical-area quadrature, traction law], correlationAssumptions: [inundation mass and wash traction share water-state covariance], operatorOrGainBounds: [front-speed, flux, and traction bounds], modeledApproximationTerms: [subgrid run-up/wash error], numericalTerms: [front quadrature and source-update residuals], combinationRule: versioned correlated operator-bound rule, outputError: inundation-wash-output-error, acceptanceGate: receiver mass/momentum and coast-registration tolerances, provenance: water boundary adapter/build/state versions }
    archipelago-body-water-error-ledger: { type: ErrorPropagationLedger, ledgerId: archipelago-body-water-error-ledger, contextId: physicsContext.contextId, outputSignalOrInteractionId: body-water-exchange, outputStateVersion: bodyWaterExchange.provisional-accepted-iteration, evaluationInterval: physicsGraph.coordinationInterval, inputErrors: [body/hull/material errors, coastal-water-output-error, clock/bracket errors], transformsFiltersInterpolations: [hull clipping, discrete-adjoint gather/scatter, deterministic wrench reduction], correlationAssumptions: [paired source/reaction errors retained jointly], operatorOrGainBounds: [added-mass and virtual-work bounds], modeledApproximationTerms: [hull proxy and hydrodynamic-law errors], numericalTerms: [accepted force/torque/momentum/interface-work residuals], combinationRule: versioned paired-reaction operator-bound rule, outputError: body-water-exchange-output-error, acceptanceGate: coupling convergence and conservation tolerances, provenance: external solver/water/coupling adapter revisions }
physicsCostLedger:
  type: PhysicsCostLedger
  ledgerId: route-specific-runtime-physics-cost-ledger-id
  status: active
  targetAndHarness: named target, fixed archipelago views/path, seed, forcing trace, body replay, route tier, viewport, DPR, frames-in-flight, sustained protocol
  qualityState: route Full/Budgeted/Minimum viable plus performanceContract.skillTierCrosswalk
  cadenceTraceTotals: { type: CadenceTraceTotals, traceTotalsId: archipelago-cadence-trace-totals, traceRef: content-addressed sustained route trace/protocol, measurementInterval: exact measured PhysicsTimeInterval, exactDuration: duration derived from registered measurement clock, coordinationAdvanceCount: exact count, catchUpBatchCount: exact count, stageExecutionCounts: exact PhysicsGraphStageId-to-count map, nativeSubcycleCounts: exact owner-to-count map, couplingIterationCounts: exact body-water-semi-implicit-loop count, interactionApplicationCounts: exact payload-tag-to-count map, presentedFrameCounts: exact target-view-to-count map, workOccurrenceCounts: exact PhysicsWorkKey-to-count map, trafficOccurrenceAndLogicalByteTotals: exact TrafficRecordId-to-count/byte map, droppedCoordinationIntervals: exact intervals or empty, exactTotalsDigest: canonical trace totals digest }
  graphStageCosts: [forcing, cloud microphysics/emission, rain transport/deposition, spectral boundary, body/water coupling, nearshore, foam, receiver/runoff, vegetation, commit/publication records]
  coordinationIntervalsPerSecond: labelled distribution
  stageExecutionsPerCoordinationInterval: labelled counts
  stageExecutionsPerSecond: labelled counts
  coordinationIntervalsPerPresentedFrame: labelled distribution
  subcyclesAndCouplingIterationsPerPresentedFrame: labelled body/water/foam/vegetation/loop distributions
  executionsPerPresentedFrame: labelled counts
  worstPermittedCatchUpBurst: { triggerAndIntervalDebt: graph policy, executionsDispatchesAndTraffic: labelled records, latencyMemoryAndErrorGate: typed gates }
  hotBytesReadWrittenPerExecution: labelled domain/exchange bytes
  solverDispatches: [cloud microphysics/transport volume, rain visual transport where GPU-owned, spectral visual, and GPU presentation/foam records]
  queueSubmissionsAndPassBreaks: labelled counts
  dependencyCriticalPaths: [forcing-to-coast, body-water-loop-to-commit, receiver-to-runoff-to-water, commit-to-candidate-to-view]
  tileGpuTraffic: { attachmentStoreLoadResolveBytes: labelled records, tileSpillEvidence: measured-or-TypedAbsence(not-measured, evidence owner, measurement interval, harness provenance), renderComputePassBreaks: labelled counts }
  bindingAndDeviceLimits: [limit-demand-headroom-and-gate]
  cpuWork: [external solver, coupling, CPU spectral boundary, bounded water, cloud emission/transport adapters when CPU-owned, rain deposition/receiver/runoff, vegetation, candidate assembly]
  allocationGcAndCompilation: [cadence-latency-and-byte-record]
  uploadsCopiesMaps: [asynchronous committed CPU-to-GPU presentation TrafficRecord]
  hostCompletionsReadbacksPerPresentedFrame: { value: 0, unit: readbacks-per-presented-frame, label: Gated, source: steady critical-path contract }
  synchronization: [cpu-data, external boundary, GPU presentation submission]
  multiviewAndFramesInFlightMultipliers: labelled records
  hotState: PhysicsMemoryLedger
  peakTransient: PhysicsMemoryLedger
  migrationOverlap: PhysicsMemoryLedger
  thermalPowerState: measured-or-TypedAbsence(not-measured, evidence owner, measurement interval, harness provenance)
physicsSignals:
  environmentForcing: { type: PhysicsSignalDescriptor<EnvironmentForcingSnapshot>, producer: project environment coordinator, consumers: [cloud microphysics, spectral forcing adapter, rain transport/deposition adapter, vegetation, validation], requiredChannels: air velocity/density/temperature/pressure/humidity with oriented support/filter/time/error; precipitation mass-flux/phase/velocity channels are explicit TypedAbsence(channel-not-produced, signal owner, sample interval, selected-route ownership) records on this route because precipitationEmission is the sole precipitation source; raw instantaneous wind never mutates spectral state }
  cloudDensity: { type: PhysicsSignalDescriptor<causal-cloud-density-and-microphysics-state>, producer: $threejs-volumetric-clouds, consumers: [precipitation emission derivation, cloud presentation adapter, cloud-shadow preparation, validation], clockId: cloud-clock, invariant: committed density/phase/source-sink/airborne-inventory state precedes and versions the derived precipitationEmission; appearance and emission consume the same committed state generation }
  precipitationEmission: { type: PhysicsSignalDescriptor<PrecipitationEmissionSnapshot>, producer: $threejs-volumetric-clouds, consumers: [rain transport/deposition adapter, receiver reducer, validation], clockId: cloud-clock, invariant: emissionInterval plus phase/mass flux/velocity/airborne inventory/transport delay/destination support/conservation group; appearance-only mode is not selected }
  terrainElevationNormal: { type: PhysicsSignalDescriptor<terrain-elevation-and-normal>, producer: $threejs-procedural-fields, consumers: [terrain compiler, support adapter, water, receiver, vegetation, validation], cadence: immutable/event-driven, invariant: metric height/normal/support and error in the shared physics frame }
  bathymetryBed: { type: PhysicsSignalDescriptor<bathymetric-bed-state>, producer: $threejs-procedural-fields, consumers: [nearshore solver, water optics, receiver/runoff, validation], cadence: immutable/event-driven, invariant: bed point/depth/slope/roughness with topology and transform revision }
  metricCoastFrame: { type: PhysicsSignalDescriptor<metric-coast-distance-and-frame>, producer: $threejs-procedural-fields, consumers: [nearshore boundary, foam, terrain/material bands, asset exclusion, validation], cadence: immutable/event-driven, invariant: signed distance in metres plus tangent/normal/Jacobian and medial-axis validity }
  substrateMaterial: { type: PhysicsSignalDescriptor<substrate-and-physics-material-state>, producer: $threejs-procedural-fields plus material-registry owner, consumers: [receiver, runoff, water boundary, vegetation, contact/coupling, validation], cadence: immutable/event-driven, invariant: explicit PhysicsMaterialId and permeability/roughness law versions; no render-material inference }
  terrainSupport: { type: PhysicsSignalDescriptor<SupportSurfaceSample>, producer: geometry support adapter, consumers: [water, receiver, vegetation, coupling, validation] }
  offshoreBoundaryState: { type: PhysicsSignalDescriptor<water-boundary-state>, producer: same-spectrum CPU analytic adapter, consumers: [nearshore adapter, validation], residency: CPU provider tied to visual donor version and PhysicsInstant; no readback }
  waterSurface: { type: PhysicsSignalDescriptor<WaterSurfaceSample>, producer: $threejs-water-optics, consumers: [coupling, runoff, inundation/wash adapter, geometry/optics/foam, validation], requiredChannels: [freeSurfacePoint, freeSurfaceNormal, surfacePointVelocityMps, geometricNormalVelocityMps, materialCurrentVelocityMps, waterColumnDepthMeters, densityKgPerM3], optionalChannels: [materialAccelerationMps2, pressurePa, bathymetryPoint, wetDryState], residency: CPU authoritative with async immutable GPU upload }
  bodyState: { type: PhysicsSignalDescriptor<RigidBodyState>, producer: external rigid-body adapter, consumers: [coupling, presentation, validation], motionMode: dynamic, residency: CPU/host authoritative with immutable adapter commit }
  receiverWetness: { type: PhysicsSignalDescriptor<receiver-liquid-mass-per-area-state>, producer: rain receiver reducer, consumers: [runoff, materials, vegetation, validation], invariant: kg m^-2 is authoritative; display wetness/depth are derived }
  vegetationResponse: { type: PhysicsSignalDescriptor<DeformingSupportProxy>, producer: $threejs-procedural-vegetation, consumers: [geometry, view preparation, validation] }
  foamState: { type: PhysicsSignalDescriptor<transported-foam-state>, producer: $threejs-water-optics foam owner, consumers: [water shading, presentation, validation] }
  qualityChangeRequest: { type: PhysicsSignalDescriptor<QualityChangeRequest>, producer: $threejs-image-pipeline quality governor, consumers: [route physics coordinator] }
  qualityTransition: { type: PhysicsSignalDescriptor<QualityTransition>, producer: route physics coordinator, consumers: [all physical owners, presentation, validation] }
physicsInteractions:
  - exchangeId: body-water-exchange
    type: SurfaceExchange
    contextId: physicsContext.contextId
    applicationInterval: body-water-application-interval (PhysicsTimeInterval)
    physicsFrameId: physicsContext.physicsRootFrameId
    physicsOriginEpoch: physicsContext.physicsOriginEpoch
    transformRevision: physicsContext.worldTransformRevision
    mode: two-way-iterated
    participants: [external rigid-body adapter, $threejs-water-optics]
    sourceDescriptors: [bodyState, waterSurface]
    interactions: [{ interactionId: body-to-water-moving-boundary, exactOnceKey: interval/stage/producer-sequence/interaction identity, role: source, sourceOwner: external rigid-body adapter, sourceEntityId: vessel generation, sourceStateVersions: [body pose/twist version, hull/material versions], targetOwner: $threejs-water-optics, targetEntityId: nearshore tile generation, targetStateVersionExpected: body-water-loop-namespace provisional water predictor version for this iteration and bracket, targetStateEquation: nearshore no-penetration/momentum boundary, applicationInterval: body-water-application-interval, physicsFrameId: physicsContext.physicsRootFrameId, physicsOriginEpoch: physicsContext.physicsOriginEpoch, transformRevision: physicsContext.worldTransformRevision, payload: { tag: movingBoundary, timeSemantics: state-over-interval, boundaryPositionMetersByQuadraturePoint: dimensioned hull quadrature points, boundaryVelocityMpsByQuadraturePoint: physical point velocities, noPenetrationAndSlipLawRef: versioned water-hull pair law }, footprint: oriented hull area quadrature with physical m2 weights summing represented wetted area; kernel TypedAbsence(no-distribution-kernel, interaction producer, application interval, physical quadrature selected) and normalization target none, signConvention: positive-source-to-receiver, applicationLedgerKey: exact-once application identity, partitionMembership: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), reactionGroupId: body-water-reaction-group, reactionToInteractionIds: [], conservationGroupIds: [body-water-momentum-angular-momentum-work], validity: exact iterate/version domain, error: boundary/quadrature bounds, provenance: external adapter/build/loop iteration }]
    reactions: [{ interactionId: water-to-body-hydrodynamic-load, exactOnceKey: interval/stage/producer-sequence/interaction identity, role: reaction, sourceOwner: $threejs-water-optics, sourceEntityId: nearshore tile generation, sourceStateVersions: [accepted provisional water/material versions], targetOwner: external rigid-body adapter, targetEntityId: vessel generation, targetStateVersionExpected: provisional body iterate version, targetStateEquation: rigid-body linear/angular momentum balance, applicationInterval: body-water-application-interval, physicsFrameId: physicsContext.physicsRootFrameId, physicsOriginEpoch: physicsContext.physicsOriginEpoch, transformRevision: physicsContext.worldTransformRevision, payload: { tag: wrenchRate, timeSemantics: rate, forceN: dimensioned Vec3, torqueNm: dimensioned axial Vec3, referencePointMeters: hull balance point }, footprint: same physical-area hull quadrature/reference point, signConvention: positive-source-to-receiver, applicationLedgerKey: exact-once application identity, partitionMembership: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), reactionGroupId: body-water-reaction-group, reactionToInteractionIds: [body-to-water-moving-boundary], conservationGroupIds: [body-water-momentum-angular-momentum-work], validity: exact iterate/version domain, error: load/reduction bounds, provenance: water solver/loop iteration/reduction tree }]
    physicalImpactParents: []
    physicalImpactPartitions: []
    reactionGroups: [{ reactionGroupId: body-water-reaction-group, contextId: physicsContext.contextId, exchangeId: body-water-exchange, applicationInterval: body-water-application-interval, sourceInteractionIds: [body-to-water-moving-boundary], reactionInteractionIds: [water-to-body-hydrodynamic-load], acceptance: all-or-none, orderedReduction: fixed deterministic tree and floating-point mode, balanceFrameId: physicsContext.physicsRootFrameId, physicsOriginEpoch: physicsContext.physicsOriginEpoch, balanceTransformRevision: physicsContext.worldTransformRevision, balanceReferencePoint: hull reference point in metres, conservationGroupIds: [body-water-momentum-angular-momentum-work], residualsAndBounds: force/torque/momentum/interface-work Gated bounds }]
    conservationGroups: [{ type: ConservationGroup, conservationGroupId: body-water-momentum-angular-momentum-work, contextId: physicsContext.contextId, interval: body-water-application-interval, participants: [external rigid-body adapter, $threejs-water-optics], referencePhysicsFrameId: physicsContext.physicsRootFrameId, physicsOriginEpoch: physicsContext.physicsOriginEpoch, transformRevision: physicsContext.worldTransformRevision, angularMomentumReference: fixed inertial balance point, commodities: [linear-momentum, angular-momentum, energy], explicitConstraints: [], initialInventory: typed map, finalInventory: typed map, externalSources: typed map, boundaryFluxes: typed map, numericalResidual: typed map, residualNorms: typed map, acceptanceBounds: Gated typed map }]
    couplingLoopId: body-water-semi-implicit-loop
    stabilityGate: added-mass/nonpenetration/positivity/interface residual gates
    convergence: bounded deterministic status
    batchLedger: { type: InteractionBatchLedger, batchId: body-water-batch, exchangeId: body-water-exchange, producerId: project coupling adapter, publishedSequenceRange: monotonic range, perConsumerCursor: cursors, acceptedRejectedLateDuplicate: typed counts, overflowPolicy: reject-batch, overflowSequenceRanges: ranges, lostCommodities: typed map, deferredCommodities: typed map, applicationLedgerIds: exact InteractionApplicationLedger IDs whose dispositions cover publishedSequenceRange, exactOnceApplicationLedgerVersion: version }
  - exchangeId: precipitation-receiver-exchange
    type: SurfaceExchange
    contextId: physicsContext.contextId
    applicationInterval: deposition-interval-n-after-cloud-transport (exact PhysicsTimeInterval)
    physicsFrameId: physicsContext.physicsRootFrameId
    physicsOriginEpoch: physicsContext.physicsOriginEpoch
    transformRevision: physicsContext.worldTransformRevision
    mode: one-way
    participants: [$threejs-rain-snow-and-wet-surfaces transport/deposition adapter, rain receiver reducer]
    sourceDescriptors: [precipitationEmission.committed-from-prior-cloud-interval, environmentForcing, terrainSupport]
    interactions: [{ interactionId: precipitation-mass-flux, exactOnceKey: exact interval/stage/producer-sequence/interaction identity, role: source, sourceOwner: $threejs-rain-snow-and-wet-surfaces transport/deposition adapter, sourceEntityId: transported precipitation support generation, sourceStateVersions: [precipitationEmission version, forcing version, transport-adapter version], targetOwner: rain receiver reducer, targetEntityId: receiver tile generation, targetStateVersionExpected: receiver state at start of interval n, targetStateEquation: receiver liquid-mass balance, applicationInterval: deposition-interval-n-after-cloud-transport, physicsFrameId: physicsContext.physicsRootFrameId, physicsOriginEpoch: physicsContext.physicsOriginEpoch, transformRevision: physicsContext.worldTransformRevision, footprint: oriented receiver-area intensive-field quadrature with physical m2 weights summing represented area, payload: { tag: massFlux, timeSemantics: rate, speciesPhaseMassFluxKgPerM2SByQuadraturePoint: typed nonnegative channel map array }, signConvention: positive-source-to-receiver, applicationLedgerKey: exact-once mass-flux application identity, partitionMembership: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), reactionGroupId: TypedAbsence(not-applicable, rain transport/deposition adapter, deposition interval, one-way exchange), reactionToInteractionIds: [], conservationGroupIds: [atmosphere-receiver-mass-momentum-n], validity: emission/transport/deposition overlap, error: flux/support/transport bounds, provenance: cloud emission plus rain transport revisions }, { interactionId: precipitation-momentum-flux, exactOnceKey: exact interval/stage/producer-sequence/interaction identity, role: source, sourceOwner: $threejs-rain-snow-and-wet-surfaces transport/deposition adapter, sourceEntityId: transported precipitation support generation, sourceStateVersions: [precipitationEmission velocity/mass versions, forcing version, transport-adapter version], targetOwner: rain receiver and ground-impact partition owner, targetEntityId: receiver/support tile generation, targetStateVersionExpected: receiver/support state at start of interval n, targetStateEquation: receiver/ground linear-angular-momentum and impact-energy partition, applicationInterval: deposition-interval-n-after-cloud-transport, physicsFrameId: physicsContext.physicsRootFrameId, physicsOriginEpoch: physicsContext.physicsOriginEpoch, transformRevision: physicsContext.worldTransformRevision, footprint: same oriented receiver-area intensive-field quadrature and physical m2 weights, payload: { tag: momentumFlux, timeSemantics: rate, momentumFluxTensorPaByQuadraturePoint: phase mass flux times transported velocity with correlation/error }, signConvention: positive-source-to-receiver, applicationLedgerKey: exact-once momentum-flux application identity, partitionMembership: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), reactionGroupId: TypedAbsence(not-applicable, rain transport/deposition adapter, deposition interval, one-way exchange), reactionToInteractionIds: [], conservationGroupIds: [atmosphere-receiver-mass-momentum-n], validity: same mass/velocity support and interval, error: correlated mass-flux/velocity/quadrature bounds, provenance: cloud emission plus rain transport revisions }]
    reactions: []
    physicalImpactParents: []
    physicalImpactPartitions: []
    reactionGroups: []
    conservationGroups: [{ type: ConservationGroup, conservationGroupId: atmosphere-receiver-mass-momentum-n, contextId: physicsContext.contextId, interval: deposition-interval-n-after-cloud-transport, participants: [cloud airborne inventory, precipitation transport, receiver inventory, ground/support momentum reservoir], referencePhysicsFrameId: physicsContext.physicsRootFrameId, physicsOriginEpoch: physicsContext.physicsOriginEpoch, transformRevision: physicsContext.worldTransformRevision, angularMomentumReference: fixed inertial receiver-domain point, commodities: [mass, species, linear-momentum, angular-momentum, energy], explicitConstraints: [], initialInventory: typed map, finalInventory: typed map, externalSources: gravity plus evaporation/sublimation typed map, boundaryFluxes: typed map, modeledInternalTransfers: transport-to-receiver/support transfers summing zero, modeledConversions: phase-change species/latent-energy map, modeledDissipation: nonnegative impact/ground friction energy sink, numericalResidual: typed map distinct from physical dissipation, residualNorms: typed map, acceptanceBounds: Gated typed map }]
    couplingLoopId: TypedAbsence(not-applicable, record authority, record interval, sketch provenance)
    stabilityGate: nonnegative receiver inventory and bounded transport latency
    convergence: not-applicable
    batchLedger: { type: InteractionBatchLedger, batchId: precipitation-batch, exchangeId: precipitation-receiver-exchange, producerId: $threejs-rain-snow-and-wet-surfaces transport/deposition adapter, publishedSequenceRange: monotonic range, perConsumerCursor: cursors, acceptedRejectedLateDuplicate: typed counts, overflowPolicy: bounded-defer, overflowSequenceRanges: ranges, lostCommodities: typed mass/species/momentum/energy map, deferredCommodities: typed mass/species/momentum/energy map, applicationLedgerIds: exact InteractionApplicationLedger IDs whose dispositions cover publishedSequenceRange, exactOnceApplicationLedgerVersion: version }
  - exchangeId: receiver-runoff-to-water
    type: SurfaceExchange
    contextId: physicsContext.contextId
    applicationInterval: runoff-interval-n-plus-1 (exact PhysicsTimeInterval)
    physicsFrameId: physicsContext.physicsRootFrameId
    physicsOriginEpoch: physicsContext.physicsOriginEpoch
    transformRevision: physicsContext.worldTransformRevision
    mode: one-way
    participants: [rain receiver reducer, $threejs-water-optics]
    sourceDescriptors: [receiverWetness.committed-at-end-of-interval-n, terrainElevationNormal, metricCoastFrame, bathymetryBed, waterSurface.committed-at-start-of-runoff-interval]
    interactions: [{ interactionId: runoff-mass-flux, role: source, targetStateEquation: nearshore mass balance, applicationInterval: runoff-interval-n-plus-1, footprint: oriented receiver-outflow intensive-field area quadrature with physical m2 weights summing represented area; kernel TypedAbsence(no-distribution-kernel, interaction producer, application interval, physical quadrature selected) and normalization target none, payload: { tag: massFlux, timeSemantics: rate, speciesPhaseMassFluxKgPerM2SByQuadraturePoint: typed nonnegative liquid-water channel map array }, partitionMembership: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), reactionGroupId: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), reactionToInteractionIds: [] }, { interactionId: runoff-momentum-flux, role: source, targetStateEquation: nearshore momentum balance, applicationInterval: runoff-interval-n-plus-1, footprint: same physical-area quadrature and orientation, payload: { tag: momentumFlux, timeSemantics: rate, momentumFluxTensorPaByQuadraturePoint: typed oriented tensor array correlated with mass flux }, partitionMembership: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), reactionGroupId: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), reactionToInteractionIds: [] }]
    canonicalInteractionExpansion: both records carry every remaining canonical InteractionRecord identity/owner/state/frame/origin/sign/exact-once/conservation/validity/error/provenance field; this explicit expansion is valid because footprint and payload arms above already use the exact canonical ABI keys and units
    reactions: []
    physicalImpactParents: []
    physicalImpactPartitions: []
    reactionGroups: []
    conservationGroups: [{ type: ConservationGroup, conservationGroupId: receiver-water-mass-momentum-n-plus-1, contextId: physicsContext.contextId, interval: runoff-interval-n-plus-1, participants: [receiver inventory, nearshore water], referencePhysicsFrameId: physicsContext.physicsRootFrameId, physicsOriginEpoch: physicsContext.physicsOriginEpoch, transformRevision: physicsContext.worldTransformRevision, angularMomentumReference: fixed inertial coast reference point, commodities: [mass, linear-momentum, angular-momentum], explicitConstraints: [], initialInventory: typed map, finalInventory: typed map, externalSources: gravity/friction/infiltration typed map, boundaryFluxes: typed map, numericalResidual: typed map, residualNorms: typed map, acceptanceBounds: Gated typed map }]
    couplingLoopId: TypedAbsence(not-applicable, record authority, record interval, sketch provenance)
    stabilityGate: source interval is exactly prior committed receiver state; no same-interval receiver feedback
    convergence: not-applicable
    batchLedger: { type: InteractionBatchLedger, batchId: runoff-batch, exchangeId: receiver-runoff-to-water, producerId: receiver reducer, publishedSequenceRange: monotonic range, perConsumerCursor: cursors, acceptedRejectedLateDuplicate: typed counts, overflowPolicy: reject-batch, overflowSequenceRanges: ranges, lostCommodities: typed mass/momentum map, deferredCommodities: typed mass/momentum map, applicationLedgerIds: exact InteractionApplicationLedger IDs whose dispositions cover publishedSequenceRange, exactOnceApplicationLedgerVersion: version }
  - exchangeId: water-inundation-wash-to-receiver
    type: SurfaceExchange
    contextId: physicsContext.contextId
    applicationInterval: receiver-application-interval-n-plus-1 (exact PhysicsTimeInterval)
    physicsFrameId: physicsContext.physicsRootFrameId
    physicsOriginEpoch: physicsContext.physicsOriginEpoch
    transformRevision: physicsContext.worldTransformRevision
    mode: one-way
    participants: [$threejs-water-optics boundary adapter, rain receiver reducer]
    sourceDescriptors: [waterSurface.committed-at-start-of-interval-n, terrainSupport, metricCoastFrame, substrateMaterial]
    interactions: [{ interactionId: coastal-inundation-mass-flux, role: source, targetStateEquation: receiver liquid-mass balance, applicationInterval: receiver-application-interval-n-plus-1, footprint: oriented inundated-receiver intensive-field area quadrature with physical m2 weights summing represented area; kernel TypedAbsence(no-distribution-kernel, interaction producer, application interval, physical quadrature selected) and normalization target none, payload: { tag: massFlux, timeSemantics: rate, speciesPhaseMassFluxKgPerM2SByQuadraturePoint: typed nonnegative liquid-water channel map array }, partitionMembership: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), reactionGroupId: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), reactionToInteractionIds: [], conservationGroupIds: [water-receiver-inundation-wash] }, { interactionId: coastal-wash-surface-traction, role: source, targetStateEquation: receiver wash/advection momentum term, applicationInterval: receiver-application-interval-n-plus-1, footprint: same physical-area quadrature and water-to-receiver orientation, payload: { tag: surfaceTraction, timeSemantics: rate, tractionPaByQuadraturePoint: typed water-shear/pressure traction Vec3 array }, partitionMembership: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), reactionGroupId: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), reactionToInteractionIds: [], conservationGroupIds: [water-receiver-inundation-wash] }]
    canonicalInteractionExpansion: both records carry every remaining canonical InteractionRecord identity/owner/state/frame/origin/sign/exact-once/validity/error/provenance field; footprint and payload arms above use exact canonical ABI keys and units
    reactions: []
    physicalImpactParents: []
    physicalImpactPartitions: []
    reactionGroups: []
    conservationGroups: [{ type: ConservationGroup, conservationGroupId: water-receiver-inundation-wash, contextId: physicsContext.contextId, interval: receiver-application-interval-n-plus-1, participants: [nearshore water, receiver inventory], referencePhysicsFrameId: physicsContext.physicsRootFrameId, physicsOriginEpoch: physicsContext.physicsOriginEpoch, transformRevision: physicsContext.worldTransformRevision, angularMomentumReference: fixed inertial coast point, commodities: [mass, linear-momentum, angular-momentum, energy], explicitConstraints: [], initialInventory: typed map, finalInventory: typed map, externalSources: gravity/substrate friction typed map, boundaryFluxes: typed map, modeledInternalTransfers: water-to-receiver mass/momentum transfers summing zero with the water source update, modeledConversions: [], modeledDissipation: nonnegative wash/friction energy sink, numericalResidual: typed map, residualNorms: typed map, acceptanceBounds: Gated typed map }]
    couplingLoopId: TypedAbsence(not-applicable, record authority, record interval, sketch provenance)
    stabilityGate: one-interval delayed wet/dry-front source with nonnegative receiver/water inventories; omitted receiver feedback is represented only by next-interval runoff
    convergence: not-applicable
    batchLedger: { type: InteractionBatchLedger, batchId: inundation-wash-batch, exchangeId: water-inundation-wash-to-receiver, producerId: $threejs-water-optics boundary adapter, publishedSequenceRange: monotonic range, perConsumerCursor: cursors, acceptedRejectedLateDuplicate: typed counts, overflowPolicy: reject-batch, overflowSequenceRanges: ranges, lostCommodities: typed mass/momentum/energy map, deferredCommodities: typed mass/momentum/energy map, applicationLedgerIds: exact InteractionApplicationLedger IDs whose dispositions cover publishedSequenceRange, exactOnceApplicationLedgerVersion: version }
    sourceStateUpdate: the water boundary adapter subtracts emitted inundation mass/momentum from the same committed conservation group; the receiver owner alone integrates resulting wetness and later runoff
  - { exchangeId: wind-to-vegetation, type: SurfaceExchange, contextId: physicsContext.contextId, applicationInterval: exact vegetation-load PhysicsTimeInterval, physicsFrameId: physicsContext.physicsRootFrameId, physicsOriginEpoch: physicsContext.physicsOriginEpoch, transformRevision: physicsContext.worldTransformRevision, mode: one-way, participants: [environment forcing owner, $threejs-procedural-vegetation], sourceDescriptors: [environmentForcing, vegetationResponse, terrainSupport], interactions: [{ interactionId: aerodynamic-surface-traction, role: source, targetStateEquation: rooted deformation/recovery momentum term, applicationInterval: vegetation-load interval, footprint: oriented vegetation intensive-field area quadrature with physical m2 weights summing represented area; kernel TypedAbsence(no-distribution-kernel, interaction producer, application interval, physical quadrature selected) and normalization target none, payload: { tag: surfaceTraction, timeSemantics: rate, tractionPaByQuadraturePoint: density/relative-air-velocity/drag-law Vec3 array }, partitionMembership: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), reactionGroupId: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), reactionToInteractionIds: [], conservationGroupIds: [atmosphere-external-work] }], canonicalInteractionExpansion: record carries every remaining canonical InteractionRecord identity/owner/state/frame/origin/sign/exact-once/validity/error/provenance field, reactions: [], physicalImpactParents: [], physicalImpactPartitions: [], reactionGroups: [], conservationGroups: [{ type: ConservationGroup, conservationGroupId: atmosphere-external-work, contextId: physicsContext.contextId, interval: vegetation-load interval, participants: [prescribed atmosphere, rooted vegetation], referencePhysicsFrameId: physicsContext.physicsRootFrameId, physicsOriginEpoch: physicsContext.physicsOriginEpoch, transformRevision: physicsContext.worldTransformRevision, commodities: [linear-momentum, angular-momentum, energy], externalSources: prescribed-atmosphere boundary work, numericalResidual: typed map, acceptanceBounds: Gated typed map }], couplingLoopId: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), stabilityGate: omitted atmosphere feedback bounded or claim narrowed, convergence: not-applicable, batchLedger: { type: InteractionBatchLedger, batchId: vegetation-load-batch, exchangeId: wind-to-vegetation, producerId: vegetation load adapter, publishedSequenceRange: monotonic range, perConsumerCursor: cursors, acceptedRejectedLateDuplicate: typed counts, overflowPolicy: bounded-defer, overflowSequenceRanges: ranges, lostCommodities: typed impulse/work map, deferredCommodities: typed impulse/work map, applicationLedgerIds: exact InteractionApplicationLedger IDs whose dispositions cover publishedSequenceRange, exactOnceApplicationLedgerVersion: version } }
physicsCoordinationAdvanceRecords:
  canonicalExpansion: required before emitted-manifest validation
  records: exact PhysicsCoordinationAdvanceRecord records keyed by coordinationAdvanceId, each closing stage executions, dependency completions, state-advance claims, application ledgers, commit receipt, debt arithmetic, and status for one coordination interval
physicsInteractionApplicationLedgers:
  canonicalExpansion: required before emitted-manifest validation
  records: exact InteractionApplicationLedger records for every prepared/committed/deferred/rejected/duplicate interaction disposition; [] only when physicsInteractions is []
physicsCommitTransactions:
  canonicalExpansion: required before emitted-manifest validation
  records: exact PhysicsCommitTransaction records keyed by every commitGroup.commitTransactionId with prepared-publication bijection, gate results, one commit instant, receipt, and rollback disposition
physicsQualityRequests:
  canonicalExpansion: required before emitted-manifest validation
  records: exact QualityChangeRequest records keyed by requestId; each transition requestId/requestSequence/scope/controls/evidence digest resolves one immutable request and its admission
physicsQualityStates:
  canonicalExpansion: required before emitted-manifest validation
  records: exact PhysicsQualityStateDescriptor records keyed by qualityStateId for every active, source, and destination state referenced by a request, admission, transition, conservative map, or cost ledger
physicsQualityTransitions:
  canonicalExpansion: required before emitted-manifest validation
  records: exact QualityTransition records for every admitted QualityChangeRequest; [] only when no quality transition is admitted in the covered interval
physicsPresentationTimeCohortsById:
  archipelago-design-map-cohort: { type: PresentationTimeCohort, timeCohortId: archipelago-design-map-cohort, presentationClockId: presentation-clock, presentationOpportunitySequence: exact monotonic integer, previousRequestedPresentationInstant: exact previous presentation PhysicsInstant, currentRequestedPresentationInstant: exact current presentation PhysicsInstant, requestedPresentationInstant: same current PhysicsInstant, requiredContextIds: [physicsContext.contextId], requiredDiscontinuityEpochs: { physicsContext.contextId: exact coastal discontinuity epoch }, maximumInterContextSkew: zero for one context, maximumCandidateAge: Gated PhysicsDuration, admissionPolicy: bounded-mapped-skew, cohortSpecificationDigest: canonical cohort specification digest }
physicsPresentationCandidate:
  type: PhysicsPresentationCandidate
  producer: route physics coordinator
  candidateId: runtime-id
  contextId: physicsContext.contextId
  presentationEpoch: exact route presentation epoch
  timeCohortId: archipelago-design-map-cohort
  requestedPresentationInstant: physicsPresentationTimeCohortsById.archipelago-design-map-cohort.currentRequestedPresentationInstant
  physicsOriginEpoch: physicsContext.physicsOriginEpoch
  commitProvenance: exact CandidateCommitProvenance resolving every presented version to spectral-coastal-weather-body commit receipt IDs/digests
  candidateScope: committed-state-brackets-leases-and-events
  contents: requestedPresentationInstant plus committed static terrain/coast/bathymetry field binding, offshore/coastal/foam/body/cloud-density/cloud-emission/receiver/vegetation PresentedStatePairs with independent provenance, physics-qualified immutable handles, exact Candidate leases, and event ranges; no camera/render-origin/view/projection/shadow/cache data
  presentedStatePairs:
    cloud-density-field:
      { type: PresentedStatePair, bindingId: cloud-density-field, entityId: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), providerId: $threejs-volumetric-clouds, signalId: cloudDensity, previousPresented: { provenance: { sourceClockId: cloud-clock, requestedPresentationInstant: exact requested previous instant, mappedSourceInstant: exact mapped previous cloud instant, clockMapRevision: cloud-clock-map-v2, clockMapError: cloud presentation mapping error, lowerBracket: exact cloud state/version/frame/origin/transform/resource generation, upperBracket: exact cloud state/version/frame/origin/transform/resource generation, interpolation: density-preserving field interpolation plus error, extrapolation: TypedAbsence(not-applicable, record authority, record interval, sketch provenance) }, presentedInstant: exact previous presentation instant, stateHandle: { leaseId: cloud-density-previous-lease, resourceGeneration: exact cloud resource generation, deviceLossGeneration: exact backend loss generation, layoutRevision: cloud-density-layout-v2, subresourceOrCpuSlice: exact previous field range }, globalBinding: { kind: field, sourcePhysicsFrameId: physicsContext.physicsRootFrameId, physicsOriginEpoch: physicsContext.physicsOriginEpoch, transformRevision: physicsContext.worldTransformRevision, bindingPayload: cloud volume transform/domain/majorant binding }, originEpochBridge: TypedAbsence(not-applicable, record authority, record interval, sketch provenance) }, currentPresented: { provenance: { sourceClockId: cloud-clock, requestedPresentationInstant: exact requested current instant, mappedSourceInstant: exact mapped current cloud instant, clockMapRevision: cloud-clock-map-v2, clockMapError: cloud presentation mapping error, lowerBracket: exact cloud state/version/frame/origin/transform/resource generation, upperBracket: exact cloud state/version/frame/origin/transform/resource generation, interpolation: density-preserving field interpolation plus error, extrapolation: TypedAbsence(not-applicable, record authority, record interval, sketch provenance) }, presentedInstant: exact current presentation instant, stateHandle: { leaseId: cloud-density-current-lease, resourceGeneration: exact cloud resource generation, deviceLossGeneration: exact backend loss generation, layoutRevision: cloud-density-layout-v2, subresourceOrCpuSlice: exact current field range }, globalBinding: { kind: field, sourcePhysicsFrameId: physicsContext.physicsRootFrameId, physicsOriginEpoch: physicsContext.physicsOriginEpoch, transformRevision: physicsContext.worldTransformRevision, bindingPayload: cloud volume transform/domain/majorant binding }, originEpochBridge: TypedAbsence(not-applicable, record authority, record interval, sketch provenance) }, motionBinding: { kind: field, storageRepresentation: texture-field, previousStateHandle: cloud-density-previous state handle above, currentStateHandle: cloud-density-current state handle above, identitySlotMap: cloud-volume-brick-identity-map-v2, motionVectorValidity: valid } }
  resourceLeases:
    - { type: PresentationResourceLease, leaseId: cloud-density-previous-lease, resourceId: cloud-density-previous-resource, deviceId: route WebGPU device, deviceLossGeneration: exact backend loss generation, resourceGeneration: exact previous cloud resource generation, layoutRevision: cloud-density-layout-v2, entitySlotMapVersion: cloud-volume-brick-identity-map-v2, residency: gpu, slotRangeStrideCount: exact previous volume subresources/strides/counts, owner: $threejs-volumetric-clouds, leaseScope: candidate, access: read, submissionAvailability: exact cloud-state production dependency, leaseBegin: candidate publication sequence, reuseProhibitedUntil: { type: ConsumerCompletionJoin, joinId: cloud-density-previous-completion-join, leaseId: cloud-density-previous-lease, requiredConsumerKeys: [design-view cloud shadow/raymarch, map-view cloud shadow/raymarch], simulationConsumers: exact cloud-owner tokens, couplingConsumers: [], externalConsumers: [], presentationConsumers: exact per-snapshot queue completion tokens, joinPredicate: all-required-consumers-complete-or-loss-invalidated, joinDigest: canonical join digest, deviceLossRetirementPath: generation-invalidated retirement } }
    - { type: PresentationResourceLease, leaseId: cloud-density-current-lease, resourceId: cloud-density-current-resource, deviceId: route WebGPU device, deviceLossGeneration: exact backend loss generation, resourceGeneration: exact current cloud resource generation, layoutRevision: cloud-density-layout-v2, entitySlotMapVersion: cloud-volume-brick-identity-map-v2, residency: gpu, slotRangeStrideCount: exact current volume subresources/strides/counts, owner: $threejs-volumetric-clouds, leaseScope: candidate, access: read, submissionAvailability: exact cloud-state production dependency, leaseBegin: candidate publication sequence, reuseProhibitedUntil: { type: ConsumerCompletionJoin, joinId: cloud-density-current-completion-join, leaseId: cloud-density-current-lease, requiredConsumerKeys: [design-view cloud shadow/raymarch, map-view cloud shadow/raymarch], simulationConsumers: exact cloud-owner tokens, couplingConsumers: [], externalConsumers: [], presentationConsumers: exact per-snapshot queue completion tokens, joinPredicate: all-required-consumers-complete-or-loss-invalidated, joinDigest: canonical join digest, deviceLossRetirementPath: generation-invalidated retirement } }
  eventSequenceRanges: canonicalExpansion(required complete PresentationEventRange records for consumed weather/water/body events or [])
  qualityMigration: coordinator-admitted QualityTransition with commitInstant, conservative map/reset, conservation/error gates, exact-once cursor policy, ConsumerCompletionJoin retirement, and rollback
physicsCameraViewPublicationsByTarget:
  main/design-view: { type: CameraViewPublication, cameraPublicationId: runtime-id, candidateId: physicsPresentationCandidate.candidateId, owner: design-view camera owner, presentationTargetId: main, viewId: design-view, cameraId: design-camera generation, contents: exact previous/current PhysicsInstant, RenderSimilarityTransforms, matrices, jitter, viewport/DPR/extent, depth, validity/error }
  minimap/map-view: { type: CameraViewPublication, cameraPublicationId: runtime-id, candidateId: physicsPresentationCandidate.candidateId, owner: map-view camera owner, presentationTargetId: minimap, viewId: map-view, cameraId: map-camera generation, contents: independent exact previous/current PhysicsInstant, RenderSimilarityTransforms, matrices, jitter, viewport/DPR/extent, depth, validity/error }
physicsViewPreparationPublicationsByTarget:
  main/design-view: { type: ViewPreparationPublication, viewPreparationId: runtime-id, candidateId: physicsPresentationCandidate.candidateId, cameraPublicationId: physicsCameraViewPublicationsByTarget["main/design-view"].cameraPublicationId, presentationTargetId: main, viewId: design-view, visibilityPublicationRefs: exact design-view refs, accelerationPublicationRefs: exact design-view refs, shadowViewPublicationRefs: [{ type: ShadowViewPublicationRef, shadowOwner: $threejs-volumetric-clouds, shadowViewId: design-view-cloud-shadow, presentationTargetId: main, receiverViewId: design-view, cameraPublicationId: physicsCameraViewPublicationsByTarget["main/design-view"].cameraPublicationId, cameraProjectionRevision: exact design camera projection revision, shadowContentEpoch: cloudDensity current state plus light epoch, resourceLeaseRefs: [cloud-density-current-lease ref, design-view-cloud-shadow-lease ref], boundedDelay: TypedAbsence(not-applicable, record authority, record interval, sketch provenance) }], cachePublicationRefs: exact design-view refs, reactiveEpochs: exact cloud/foam/body epochs, reactivePublications: exact publications, resetDependencies: acyclic exact reset DAG, resourceLeases: [full view-preparation-scoped design-view-cloud-shadow-lease and cloud raymarch/cache lease records], resourceLeaseRefs: [cloud-density previous/current Candidate lease refs, exact same-preparation refs] }
  minimap/map-view: { type: ViewPreparationPublication, viewPreparationId: runtime-id, candidateId: physicsPresentationCandidate.candidateId, cameraPublicationId: physicsCameraViewPublicationsByTarget["minimap/map-view"].cameraPublicationId, presentationTargetId: minimap, viewId: map-view, visibilityPublicationRefs: exact map-view refs, accelerationPublicationRefs: exact map-view refs, shadowViewPublicationRefs: [{ type: ShadowViewPublicationRef, shadowOwner: $threejs-volumetric-clouds, shadowViewId: map-view-cloud-shadow, presentationTargetId: minimap, receiverViewId: map-view, cameraPublicationId: physicsCameraViewPublicationsByTarget["minimap/map-view"].cameraPublicationId, cameraProjectionRevision: exact map camera projection revision, shadowContentEpoch: cloudDensity current state plus light epoch, resourceLeaseRefs: [cloud-density-current-lease ref, map-view-cloud-shadow-lease ref], boundedDelay: TypedAbsence(not-applicable, record authority, record interval, sketch provenance) }], cachePublicationRefs: exact map-view refs, reactiveEpochs: exact cloud/foam/body epochs, reactivePublications: exact publications, resetDependencies: acyclic exact reset DAG, resourceLeases: [full view-preparation-scoped map-view-cloud-shadow-lease and cloud raymarch/cache lease records], resourceLeaseRefs: [cloud-density previous/current Candidate lease refs, exact same-preparation refs] }
physicsPresentationSnapshotsByTarget:
  main/design-view: { type: PhysicsPresentationSnapshot, snapshotId: runtime-id, candidateId: physicsPresentationCandidate.candidateId, cameraPublicationId: physicsCameraViewPublicationsByTarget["main/design-view"].cameraPublicationId, viewPreparationId: physicsViewPreparationPublicationsByTarget["main/design-view"].viewPreparationId, presentationTargetId: main, viewId: design-view, presentedStatePairRefs: candidate binding IDs including cloud-density-field, resourceLeaseRefs: exact Candidate plus design-view preparation refs, eventSequenceRanges: exact candidate ranges addressed to main/design-view, closureManifest: { type: PresentationClosureManifest, snapshotId: same runtime-id, pairStateHandleLeaseIds: exact pair previous/current lease IDs including cloud-density-previous/current-lease, preparationDependencyLeaseIds: exact design-view preparation dependency lease IDs, reactiveAndResetLeaseIds: exact design-view reactive/reset lease IDs, shadowCacheVisibilityLeaseIds: exact design-view cloud-shadow/cache/visibility lease IDs, exactRequiredLeaseIds: canonical sorted union of all preceding lease IDs and no others, exactEventRangeIds: canonical sorted exact main/design-view event range IDs, dependencyDagDigest: collision-resistant digest of canonical dependency DAG, closureDigest: collision-resistant digest of canonical IDs and edges }, sealVersion: runtime-version }
  minimap/map-view: { type: PhysicsPresentationSnapshot, snapshotId: runtime-id, candidateId: physicsPresentationCandidate.candidateId, cameraPublicationId: physicsCameraViewPublicationsByTarget["minimap/map-view"].cameraPublicationId, viewPreparationId: physicsViewPreparationPublicationsByTarget["minimap/map-view"].viewPreparationId, presentationTargetId: minimap, viewId: map-view, presentedStatePairRefs: candidate binding IDs including cloud-density-field, resourceLeaseRefs: exact Candidate plus map-view preparation refs, eventSequenceRanges: exact candidate ranges addressed to minimap/map-view, closureManifest: { type: PresentationClosureManifest, snapshotId: same runtime-id, pairStateHandleLeaseIds: exact pair previous/current lease IDs including cloud-density-previous/current-lease, preparationDependencyLeaseIds: exact map-view preparation dependency lease IDs, reactiveAndResetLeaseIds: exact map-view reactive/reset lease IDs, shadowCacheVisibilityLeaseIds: exact map-view cloud-shadow/cache/visibility lease IDs, exactRequiredLeaseIds: canonical sorted union of all preceding lease IDs and no others, exactEventRangeIds: canonical sorted exact minimap/map-view event range IDs, dependencyDagDigest: collision-resistant digest of canonical dependency DAG, closureDigest: collision-resistant digest of canonical IDs and edges }, sealVersion: runtime-version }
physicsPresentationRenderPlansByTarget:
  main/design-view: { type: PresentationRenderPlan, renderPlanId: archipelago-design-view-render-plan, timeCohortId: archipelago-design-map-cohort, candidateId: physicsPresentationCandidate.candidateId, snapshotId: physicsPresentationSnapshotsByTarget["main/design-view"].snapshotId, presentationTargetId: main, viewId: design-view, phaseIds: exact cloud-shadow/opaque/cloud-raymarch/water/cloud-composite/present IDs, phaseRecords: complete RenderPlanPhase records using the performance pass keys, edges: complete RenderPlanEdge DAG with dependency completions and resource generations, requiredPreparationEdgeIds: exact design-view preparation edge IDs, renderResourceLeaseIds: exact design-view render lease IDs, plannedResetActionIds: exact reset IDs, expectedResetHistoryGenerations: exact per-action generation map, shadowFactorIds: exact once-applied cloud/directional shadow factor IDs, closureDigest: canonical plan closure digest, immutablePlanDigest: canonical immutable plan digest }
  minimap/map-view: { type: PresentationRenderPlan, renderPlanId: archipelago-map-view-render-plan, timeCohortId: archipelago-design-map-cohort, candidateId: physicsPresentationCandidate.candidateId, snapshotId: physicsPresentationSnapshotsByTarget["minimap/map-view"].snapshotId, presentationTargetId: minimap, viewId: map-view, phaseIds: exact cloud-shadow/opaque/cloud-raymarch/water/cloud-composite/present IDs, phaseRecords: complete RenderPlanPhase records using the performance pass keys, edges: complete RenderPlanEdge DAG with dependency completions and resource generations, requiredPreparationEdgeIds: exact map-view preparation edge IDs, renderResourceLeaseIds: exact map-view render lease IDs, plannedResetActionIds: exact reset IDs, expectedResetHistoryGenerations: exact per-action generation map, shadowFactorIds: exact once-applied cloud/directional shadow factor IDs, closureDigest: canonical plan closure digest, immutablePlanDigest: canonical immutable plan digest }
frameExecutionRecord:
  type: FrameExecutionRecord
  executionId: unique append-only ID
  timeCohortId: archipelago-design-map-cohort
  candidateIds: [physicsPresentationCandidate.candidateId]
  cohortAdmission: exact admitted FrameCohortAdmission for design-view and map-view
  renderPlans: [physicsPresentationRenderPlansByTarget["main/design-view"], physicsPresentationRenderPlansByTarget["minimap/map-view"]]
  slotAdmissions: [exact admitted main/design-view FrameSlotAdmission, exact admitted minimap/map-view FrameSlotAdmission]
  requiredTargetViewKeys: [main/design-view, minimap/map-view]
  snapshotIds: [physicsPresentationSnapshotsByTarget["main/design-view"].snapshotId, physicsPresentationSnapshotsByTarget["minimap/map-view"].snapshotId]
  overallStatus: submitted | completed | partial-failure | aborted | device-lost
  backendGeneration: exact generation
  deviceLossGeneration: exact generation
  targetExecutions:
    main/design-view: { snapshotId: physicsPresentationSnapshotsByTarget["main/design-view"].snapshotId, renderPlanId: exact admitted design-view render plan ID, slotAdmissionId: exact admitted main/design-view slot ID, presentationTargetId: main, viewId: design-view, status: typed target status, submittedPasses: [design-view.cloud-shadow, design-view.opaque-scene, design-view.cloud-raymarch, design-view.water-composite, design-view.cloud-composite, main.present], queueSubmissionEpochs: ordered epochs, actionResults: typed results, resetActionResults: exact planned reset results, completionTokens: exact tokens, presentedTimestamp: mapped record or TypedAbsence(not-applicable, record authority, record interval, sketch provenance), failure: typed failure or TypedAbsence(not-applicable, record authority, record interval, sketch provenance) }
    minimap/map-view: { snapshotId: physicsPresentationSnapshotsByTarget["minimap/map-view"].snapshotId, renderPlanId: exact admitted map-view render plan ID, slotAdmissionId: exact admitted minimap/map-view slot ID, presentationTargetId: minimap, viewId: map-view, status: typed target status, submittedPasses: [map-view.cloud-shadow, map-view.opaque-scene, map-view.cloud-raymarch, map-view.water-composite, map-view.cloud-composite, minimap.present], queueSubmissionEpochs: ordered epochs, actionResults: typed results, resetActionResults: exact planned reset results, completionTokens: exact tokens, presentedTimestamp: independently mapped record or TypedAbsence(not-applicable, record authority, record interval, sketch provenance), failure: typed failure or TypedAbsence(not-applicable, record authority, record interval, sketch provenance) }
  leaseDispositionById: { every-lease-id: { disposition: typed disposition, consumingSnapshotIds: exact IDs, completionJoin: { type: ConsumerCompletionJoin, simulationConsumers: exact tokens, couplingConsumers: exact tokens, externalConsumers: exact tokens, presentationConsumers: exact tokens, deviceLossRetirementPath: typed rule }, retirementEvidence: typed record } }
physicsPresentationSnapshot: not used
performanceContract:
  routeStatus: provisional
  skillTierCrosswalk:
    $threejs-procedural-fields: { Full: full coast/bed/substrate fields, Budgeted: error-bounded coarser field bake, Minimum viable: fixed-view bounded field domain, protectedInvariants: [coast identity, metric units, descriptor error] }
    $threejs-procedural-geometry: { Full: full projected-error terrain, Budgeted: coarser semantic chunks, Minimum viable: fixed-view terrain set, protectedInvariants: [coast contour, support bounds, stable IDs] }
    $threejs-procedural-materials: { Full: full response bundles, Budgeted: filtered atlas/bundle path, Minimum viable: semantic region materials, protectedInvariants: [material identity, wet/dry ordering, physics binding direction] }
    $threejs-spectral-ocean: { Full: accepted visual cascades plus CPU boundary adapter, Budgeted: fewer accepted cascades, Minimum viable: CPU boundary plus one visible band, protectedInvariants: [same-spectrum handoff, energy/error band, no readback] }
    $threejs-water-optics: { Full: bounded coastal solver/foam/optics, Budgeted: sparse coarser active tiles, Minimum viable: analytic/bounded accepted coastal subset, protectedInvariants: [wet/dry positivity, coast registration, coupling closure] }
    $threejs-volumetric-clouds: { Full: causal microphysics/emission plus visual volume, Budgeted: coarser causal volume/emission, Minimum viable: causal emission owner with bounded visual proxy, protectedInvariants: [airborne/emitted mass closure, transport delay, no appearance-only substitution] }
    $threejs-rain-snow-and-wet-surfaces: { Full: full transport/receiver/runoff, Budgeted: coarser receiver tiles and visual population, Minimum viable: conserved receiver/runoff path, protectedInvariants: [single receiver owner, exact-once mass, interval latency] }
    $threejs-procedural-vegetation: { Full: full constrained population/deformation, Budgeted: population/branch LOD, Minimum viable: landmark vegetation plus rooted response, protectedInvariants: [placement exclusions, root frame, bounded load response] }
    $threejs-procedural-buildings-and-cities: { Full: full semantic asset assemblies, Budgeted: chunk/LOD assemblies, Minimum viable: authored landmark/dock/hull set, protectedInvariants: [anchors, collider/material bindings, stable IDs] }
    $threejs-camera-controls-and-rigs: { Full: design plus map views, Budgeted: both views at bounded lower update/resolution, Minimum viable: both immutable publication chains, protectedInvariants: [per-target camera ownership, exact transforms, no Candidate camera state] }
    $threejs-image-pipeline: { Full: accepted full image route, Budgeted: measured reduced pass scales, Minimum viable: tone/output plus required temporal resets, protectedInvariants: [one output owner, per-view snapshot, no doubled transform] }
    $threejs-visual-validation: { Full: full sustained evidence, Budgeted: same gates with reduced diagnostic cadence, Minimum viable: blocking physics/visual/performance gates, protectedInvariants: [falsifiable evidence, no hidden readback, exact ABI checks] }
  passKeys: [physics.ingest, physics.sample-forcing, water.open-update, water.boundary-adapter, physics.external-body-subcycles, physics.body-water-predict, physics.body-water-emit-interactions, physics.body-water-solve-subcycles, physics.body-water-reduce-reactions, physics.body-water-correct, rain.transport-deposition, receiver.apply-inundation-wash, receiver.update, receiver.publish-runoff-next-interval, water.publish-inundation-wash-next-interval, water.nearshore-update, water.foam-update, cloud.evolve-density, cloud.derive-precipitation-emission, vegetation.update, physics.reduce-outer-ledgers, physics.correct, physics.commit, physics.publish-candidate, design-view.camera-publication, design-view.prepare, design-view.cloud-shadow, design-view.opaque-scene, design-view.cloud-raymarch, design-view.water-composite, design-view.cloud-composite, design-view.seal, map-view.camera-publication, map-view.prepare, map-view.cloud-shadow, map-view.opaque-scene, map-view.cloud-raymarch, map-view.water-composite, map-view.cloud-composite, map-view.seal, main.present, minimap.present]
  mobileGate: compact active CPU coupling/receiver/vegetation domains, no frame-critical readback, asynchronous immutable uploads, full synchronization/traffic/multiview/migration accounting
coverageStatus: partial
coverageBlockers: project must populate measured canonical forcing/cloud-emission calibration, the declared external-solver synchronization/checkpoint/replay values, measured rigid-body/hull/collider/material data, conservative gather/scatter proof, same-spectrum CPU boundary proof, receiver inventory closure, body-water convergence/reaction closure/rollback, sustained two-view mobile evidence, and canonical WebGPU capability
```

### Required acceptance evidence

```yaml
acceptanceEvidence:
  fixedViews:
    - archipelago-overview: island distribution, negative-water channels, deep/shallow composition, and far minification
    - island-design: full island silhouette, terrace/beach hierarchy, reef field, vegetation and landmark composition
    - coast-near: waterline, cliff/beach join, wet band, foam, stones, and support contact
    - grazing-water: normal filtering, Fresnel, horizon/minification, and foam stability
  requiredDebugViews:
    - land signed distance, elevation, terrace/region ID, slope/curvature, beach band, bathymetry, coast tangent/normal
    - semantic terrain groups, hard-edge normals, LOD/chunk seams, material IDs, support and exclusion masks
    - water height/displacement, normal, thickness, absorption, regime ID, boundary state, foam source/history, and wet line
    - asset anchors, support normals, footprint clearance, ecological weights, occupancy, stable IDs, and rejected placements
    - PhysicsContext frames/epochs, per-provider brackets, PhysicsGraph executed stages/versions, SurfaceExchange batch ledger, conservation/open-system residuals, candidate/resource leases, each sealed target snapshot, and FrameExecutionRecord
    - no-post, water contribution, opaque depth, final output, and every active history
  requiredMetrics:
    - coastline zero-contour versus rendered land-water intersection boundary error in world and physical-pixel domains
    - overlap/gap occupancy, bathymetry continuity and depth-order agreement, terrain seam and normal error
    - foam source precision/recall against the coast/breaker mask, on-land leakage, temporal flicker, and reset residual
    - water-state stability plus positivity/conservation/boundary residual only for solvers claiming those invariants
    - asset support penetration/floating error, slope/exclusion violations, placement-distribution error, and seed stability
    - exactly-once interaction delivery, exchange-owned ledger overflow plus typed lost/deferred commodities, provider age/filter/error, candidate/camera/view-preparation/snapshot immutability, rebase-zero-motion, and quality-transition rollback residuals
    - "p50/p95 [Measured] composed CPU/GPU/presentation timing, deadline misses, simulation executions per presented frame, uploads, logical live bytes, per-step traffic model, and sustained quality drift"
  requiredSweeps:
    - deterministic representative and stress seeds selected before candidate inspection
    - still-water/reset, steady wind, stronger forcing, camera motion, disturbance, resize/DPR, and quality-transition trajectories as applicable
    - Full, Budgeted, and Minimum viable captures on every target where that state is eligible
  blockingFailures:
    - visible land-water gap, overlap, coast swimming, shoreline LOD crack, or foam detached from its declared source
    - shallow/deep color that contradicts bathymetry or refracted geometry that crosses an occluder
    - non-finite water state, invalid normal, solver boundary leak, unbounded foam history, or failed deterministic reset
    - floating or buried landmark, vegetation on forbidden support, unstable IDs, or seed-dependent loss of the primary composition
    - quality transition changes coastline identity, bathymetric ordering, landmark support, output ownership, or crosses a frozen visual-error gate
    - required target GPU timing unavailable for a GPU-performance verdict
  requiredArtifacts:
    - reference-feature ledger and declared divergences
    - coastal field/data contract and selected water-algorithm proof
    - supplemental asset/generator inventory with hashes, semantic metadata, LOD/impostor policy, and missing-family blockers
    - fixed-view/diagnostic/seed/temporal/quality image bundle
    - canonical physics context/graph/signal/exchange manifests plus candidate/camera/view-preparation/snapshot/execution traces and quality-migration evidence
    - unique pass/resource ledger, target and storage inventories, traffic model, governor trace, lifecycle loop, and sustained physical-target traces
```

## ocean planet

Input brief: orbit-to-horizon procedural planet with spectral ocean,
atmosphere, optional clouds, and cinematic output.

minimal skill set:

```text
backendManifest: "populate required [Gated] and observed [Measured] fields from canonical preflight"
workloadProfile:
  domain: cinematic-art
  intent: present
  truthContract: physically-plausible
  representation: hybrid
  interaction: orbit
  temporal: deterministic-animation
  scale: planetary
  deployment: "brief-defined desktop/mobile WebGPU matrix"
causeLedger:
  sourceOfTruth: authored planet/ocean parameters
  primaryObservable: stable planet silhouette, horizon-scale waves, and atmospheric depth
  earliestMissingLayer: geometry
  selectedAlgorithm: planet LOD plus spectral ocean and atmosphere transport
  rejectedAlgorithms:
    - bounded heightfield water: cannot own horizon-scale spectra
    - post fog: cannot reproduce geometry-aware atmospheric depth
  noPostBaseline: planet, ocean, and atmosphere read without grading or bloom
selectedSkills:
  - $threejs-procedural-planets
  - $threejs-spectral-ocean
  - $threejs-sky-atmosphere-and-haze
  - $threejs-camera-controls-and-rigs
  - $threejs-image-pipeline
  - $threejs-visual-validation
primaryOwner: $threejs-procedural-planets
deferredSkills:
  - $threejs-volumetric-clouds
  - $threejs-exposure-color-grading
omittedSkills:
  - $threejs-water-optics: bounded-water mechanism is not the primary cause
  - $threejs-bloom: no eligibility until HDR emission/exposure is proven
owners:
  sourceOfTruth: $threejs-procedural-planets
  representation: planet/ocean/atmosphere owners
  spatialFrame: $threejs-procedural-planets
  timebase: route physics coordinator executing the PhysicsGraph
  semanticIds: not used
  selectionPicking: not used
  clipSection: not used
  presentation: $threejs-image-pipeline
  validation: $threejs-visual-validation
requiredSignals:
  sceneColorRegistry:
    primary-view: { producer: shared scene pass, consumers: [presentation] }
  depthRegistry:
    primary-view: { producer: shared scene pass, consumers: [aerial perspective] }
  normalRegistry: not used by a post consumer
  velocityRegistry: not used until a temporal consumer is selected
  objectIdRegistry: not used
  historyRegistry: not used until clouds or temporal reconstruction are selected
domainSignals:
  planetFrameState: { physicsSignal: planetState, consumers: [ocean/atmosphere registration, presentation, validation] }
  oceanField: { physicsSignal: oceanSurface, consumers: [ocean geometry, ocean material] }
  lightingTransport: { physicsSignal: lightingTransport, consumers: [planet material, ocean material, aerial perspective, presentation validation] }
physicsContext:
  type: PhysicsContext
  producer: route physics coordinator
  consumers: [$threejs-procedural-planets, $threejs-spectral-ocean, $threejs-sky-atmosphere-and-haze, $threejs-image-pipeline, $threejs-visual-validation]
  invariant: one finite positive metersPerWorldUnit is the sole world-to-physics scale boundary; provider state remains SI in stable right-handed planet-fixed/inertial frames; typed gravity; nonlinear charts kept out of the rigid-frame graph; floating-origin epoch; radiometric units/basis; generation-bearing entity IDs; time origin
physicsGraph:
  type: PhysicsGraph
  producer: route physics coordinator
  coordinationInterval: nonempty PhysicsTimeInterval on planet-coordination-clock
  clocks:
    planetCoordinationClock: { type: PhysicsClockDescriptor, owner: route physics coordinator, mappingKind: fixed-rational, mappingRevision: planet-clock-map-v1, discontinuityEpoch: planet-clock-continuity-v1, coordinationClockMap: identity-with-zero-error }
    oceanClock: { type: PhysicsClockDescriptor, owner: $threejs-spectral-ocean, mappingKind: fixed-rational, mappingRevision: ocean-clock-map-v1, discontinuityEpoch: planet-clock-continuity-v1, coordinationClockMap: exact versioned map; spectral phase is evaluated from each requested PhysicsInstant and never accumulated }
    atmosphereClock: { type: PhysicsClockDescriptor, owner: $threejs-sky-atmosphere-and-haze, mappingKind: piecewise-versioned, mappingRevision: atmosphere-clock-map-v1, discontinuityEpoch: planet-clock-continuity-v1, coordinationClockMap: versioned cadence map with interpolation/staleness error }
    presentationClock: { type: PhysicsClockDescriptor, owner: route presentation scheduler, mappingKind: external, mappingRevision: presentation-clock-map-v1, discontinuityEpoch: presentation-clock-continuity-v1, coordinationClockMap: versioned map with bounded error to planet-coordination-clock }
  stages:
    - ingest: latch PhysicsContext, planet state, spectral parameters, sun/occluder state, and atmosphere parameters
    - sample-forcing: evaluate the unique sun/sky radiometric boundary at mapped PhysicsInstant requests owned by $threejs-sky-atmosphere-and-haze
    - predict: write provisional view-independent planet frame/surface state and ocean spectral state over mapped intervals derived from coordinationInterval; camera-dependent LOD belongs to view preparation
    - emit-interactions: no InteractionRecord or SurfaceExchange is emitted; radiometry remains a sampled provider
    - solve-subcycles: write provisional atmosphere transport/LUT and ocean versions at their registered clock cadences
    - reduce-reactions: no reaction group exists for this selected one-way provider route
    - correct: enforce planet/ocean seams, finite ocean derivatives, radiometric unit/range gates, and clock-map error on provisional versions
    - commit: publish accepted planet, ocean, and lighting-transport versions only through planet-ocean-transport-commit-group
    - publish-presentation: publish the camera-free candidate from committed versions; camera, view preparation, and sealing are later immutable phases
  loopMacros: []
  commitGroups:
    - { commitGroupId: planet-ocean-transport-commit-group, owner: route physics coordinator, interval: coordinationInterval, provisionalVersions: [planetState.provisional, oceanSurface.provisional, lightingTransport.provisional], committedPublications: [planetState.committed, oceanSurface.committed, lightingTransport.committed], stateEquationOwners: { planet-frame-and-surface-state: $threejs-procedural-planets, offshore-ocean: $threejs-spectral-ocean, atmospheric-transport: $threejs-sky-atmosphere-and-haze }, conservationAndErrorGates: [planet-ocean-seam, finite-ocean-derivatives, radiometric-unit-range, clock-map-error], preparedPublications: canonicalExpansion(required complete PhysicsPreparedPublication records for every provisional-to-committed publication), commitTransactionId: planet-ocean-transport-commit-transaction, atomicity: all-or-none, failureDisposition: preserve-prior-commit }
  originRebaseTransactions: [] # populate with canonical accepted transactions when a physics-origin rebase is scheduled
  publicationRule: prediction and cadence work remains provisional; only commit-group versions are descriptor- or presentation-visible
  executionLedger: { type: PhysicsExecutionLedger, ledgerId: route-interval-execution-ledger-id, graphId: route PhysicsGraph ID, graphRevision: exact graph revision, coordinationInterval: graph coordinationInterval, coordinationAdvanceId: exact current coordination advance ID, stageExecutions: complete PhysicsStageExecution rows with exact intervals/subcycles/version claims, dependencyCompletions: exact PhysicsDependencyCompletion refs, stateAdvanceClaims: one accepted state-advance claim or explicit state-hold per owned equation and coordination interval, interactionApplicationLedgers: exact accepted InteractionApplicationLedger refs or [], loopResults: bounded-loop iterations/residuals/accepted iterate, commitReceipts: exact successful PhysicsCommitReceipt refs or [], catchUpDebtBeforeAfter: typed duration pair, discontinuityEpoch: graph epoch, physicsCostLedgerId: route-specific-runtime-physics-cost-ledger-id }
physicsCostLedger:
  type: PhysicsCostLedger
  ledgerId: route-specific-runtime-physics-cost-ledger-id
  status: active
  targetAndHarness: named physical target, orbit/horizon path, route tier, viewport, DPR, seed, and sustained protocol
  qualityState: route Full/Budgeted/Minimum viable plus performanceContract.skillTierCrosswalk
  graphStageCosts: [planet frame/surface update, ocean, atmosphere transport, commit/publication router cost records]
  coordinationIntervalsPerSecond: labelled distribution on planet-coordination-clock
  stageExecutionsPerCoordinationInterval: labelled counts by stage
  stageExecutionsPerSecond: labelled counts through registered clock maps
  coordinationIntervalsPerPresentedFrame: labelled distribution through presentation-clock-map-v1
  subcyclesAndCouplingIterationsPerPresentedFrame: labelled ocean/atmosphere counts; coupling explicitly not used
  executionsPerPresentedFrame: labelled stage counts
  worstPermittedCatchUpBurst: { triggerAndIntervalDebt: graph catch-up/discontinuity policy, executionsDispatchesAndTraffic: labelled records, latencyMemoryAndErrorGate: typed gates }
  hotBytesReadWrittenPerExecution: labelled planet/ocean/transport/provider bytes
  solverDispatches: [ocean FFT and atmosphere LUT extent/workgroup/cadence/timing records]
  queueSubmissionsAndPassBreaks: labelled counts
  dependencyCriticalPaths: [planet/ocean/transport commit to candidate to view preparation]
  tileGpuTraffic: { attachmentStoreLoadResolveBytes: labelled records, tileSpillEvidence: measured-or-TypedAbsence(not-measured, evidence owner, measurement interval, harness provenance), renderComputePassBreaks: labelled counts }
  bindingAndDeviceLimits: [limit-demand-headroom-and-gate]
  cpuWork: [candidate assembly and camera-dependent LOD/per-view preparation]
  allocationGcAndCompilation: [cadence-latency-and-byte-record]
  uploadsCopiesMaps: [TrafficRecord]
  hostCompletionsReadbacksPerPresentedFrame: labelled zero-or-failure record
  synchronization: [wait-or-stall-record]
  multiviewAndFramesInFlightMultipliers: labelled view/lease/resource records
  hotState: PhysicsMemoryLedger
  peakTransient: PhysicsMemoryLedger
  migrationOverlap: PhysicsMemoryLedger
  thermalPowerState: measured-or-TypedAbsence(not-measured, evidence owner, measurement interval, harness provenance)
physicsSignals:
  planetState: { type: PhysicsSignalDescriptor<PlanetFrameState>, producer: $threejs-procedural-planets, consumers: [$threejs-spectral-ocean, $threejs-sky-atmosphere-and-haze, route presentation assembler, $threejs-visual-validation], invariant: view-independent planet frame/surface/resource epochs only; no camera-dependent LOD selection }
  oceanSurface: { type: PhysicsSignalDescriptor<WaterSurfaceSample>, producer: $threejs-spectral-ocean, consumers: [ocean geometry, ocean material, $threejs-visual-validation] }
  lightingTransport: { type: PhysicsSignalDescriptor<LightingTransportSnapshot>, producer: $threejs-sky-atmosphere-and-haze, consumers: [planet material, ocean material, aerial perspective, $threejs-image-pipeline, $threejs-visual-validation], channels: each declares radiance/irradiance/transmittance quantity, SI unit, spectral/working basis, finite-solar-disc footprint, direction convention, validity, and error; atmosphere/cloud/opaque/water attenuation factors retain distinct IDs and apply exactly once }
  qualityChangeRequest: { type: PhysicsSignalDescriptor<QualityChangeRequest>, producer: $threejs-image-pipeline quality governor, consumers: [route physics coordinator] }
  qualityTransition: { type: PhysicsSignalDescriptor<QualityTransition>, producer: route physics coordinator, consumers: [$threejs-procedural-planets, $threejs-spectral-ocean, $threejs-sky-atmosphere-and-haze, $threejs-image-pipeline, $threejs-visual-validation] }
physicsInteractions: []
physicsCoordinationAdvanceRecords:
  canonicalExpansion: required before emitted-manifest validation
  records: exact PhysicsCoordinationAdvanceRecord records keyed by coordinationAdvanceId, each closing stage executions, dependency completions, state-advance claims, application ledgers, commit receipt, debt arithmetic, and status for one coordination interval
physicsInteractionApplicationLedgers:
  canonicalExpansion: required before emitted-manifest validation
  records: exact InteractionApplicationLedger records for every prepared/committed/deferred/rejected/duplicate interaction disposition; [] only when physicsInteractions is []
physicsCommitTransactions:
  canonicalExpansion: required before emitted-manifest validation
  records: exact PhysicsCommitTransaction records keyed by every commitGroup.commitTransactionId with prepared-publication bijection, gate results, one commit instant, receipt, and rollback disposition
physicsQualityRequests:
  canonicalExpansion: required before emitted-manifest validation
  records: exact QualityChangeRequest records keyed by requestId; each transition requestId/requestSequence/scope/controls/evidence digest resolves one immutable request and its admission
physicsQualityStates:
  canonicalExpansion: required before emitted-manifest validation
  records: exact PhysicsQualityStateDescriptor records keyed by qualityStateId for every active, source, and destination state referenced by a request, admission, transition, conservative map, or cost ledger
physicsQualityTransitions:
  canonicalExpansion: required before emitted-manifest validation
  records: exact QualityTransition records for every admitted QualityChangeRequest; [] only when no quality transition is admitted in the covered interval
physicsErrorPropagationLedgers:
  canonicalExpansion: required before emitted-manifest validation
  unresolvedBlocker: emit complete ErrorPropagationLedger records for every committed signal, interaction, and presentation-consumed derived state; every provider response must resolve errorPropagationLedgerRef
physicsPresentationTimeCohortsById:
  ocean-planet-cohort: { type: PresentationTimeCohort, timeCohortId: ocean-planet-cohort, presentationClockId: presentation-clock, presentationOpportunitySequence: exact monotonic integer, previousRequestedPresentationInstant: exact previous PhysicsInstant, currentRequestedPresentationInstant: exact current PhysicsInstant, requestedPresentationInstant: same current PhysicsInstant, requiredContextIds: [physicsContext.contextId], requiredDiscontinuityEpochs: { physicsContext.contextId: exact current discontinuity epoch }, maximumInterContextSkew: zero for one context, maximumCandidateAge: Gated PhysicsDuration, admissionPolicy: exact-instant, cohortSpecificationDigest: canonical cohort digest }
physicsPresentationCandidate:
  type: PhysicsPresentationCandidate
  candidateId: runtime-id
  contextId: physicsContext.contextId
  presentationEpoch: exact route presentation epoch
  timeCohortId: ocean-planet-cohort
  requestedPresentationInstant: physicsPresentationTimeCohortsById.ocean-planet-cohort.currentRequestedPresentationInstant
  physicsOriginEpoch: physicsContext.physicsOriginEpoch
  commitProvenance: exact CandidateCommitProvenance resolving planet/ocean/transport versions to planet-ocean-transport commit receipt IDs/digests
  candidateScope: committed-state-brackets-leases-and-events
  producer: route physics coordinator
  consumers: [primary-view camera owner, route presentation assembler]
  contents: requestedPresentationInstant plus committed planet/ocean/transport per-binding/provider PresentedStatePair entries, independent previous/current provenance, physics-qualified immutable state handles, exact resource leases, and event ranges; contains no camera, render origin, view/projection matrix, shadow/cache epoch, or global-to-render transform
  presentedStatePairs: canonicalExpansion(required complete per-binding PresentedStatePair records)
  resourceLeases: canonicalExpansion(required complete Candidate-scoped PresentationResourceLease records)
  eventSequenceRanges: canonicalExpansion(required complete PresentationEventRange records or [])
  qualityMigration: a prepared QualityTransition commits at a PhysicsInstant through its own all-or-none commit group with projection/reset map, geometric/radiometric/error residuals, queue boundary, atomic versions, ConsumerCompletionJoin retirement, scoped actions, and rollback before candidate publication
physicsCameraViewPublicationsByTarget:
  main/primary-view: { type: CameraViewPublication, cameraPublicationId: runtime-id, candidateId: physicsPresentationCandidate.candidateId, owner: primary-view camera owner, presentationTargetId: main, viewId: primary-view, cameraId: primary-camera, contents: previous/current PhysicsInstant, source-qualified previous/current RenderSimilarityTransform, unjittered view/projection matrices, jitter convention, viewport/DPR/extent, depth convention, projection validity/error }
physicsViewPreparationPublicationsByTarget:
  main/primary-view: { type: ViewPreparationPublication, viewPreparationId: runtime-id, candidateId: physicsPresentationCandidate.candidateId, cameraPublicationId: physicsCameraViewPublicationsByTarget["main/primary-view"].cameraPublicationId, presentationTargetId: main, viewId: primary-view, resourceLeases: full PresentationResourceLease records for newly created camera-dependent resources, resourceLeaseRefs: exact Candidate and same-preparation refs, contents: visibility/acceleration/shadow/cache refs including camera-dependent planet LOD, reactive publications, reset DAG, exact PresentationResourceLeaseRefs }
physicsPresentationSnapshotsByTarget:
  main/primary-view: { type: PhysicsPresentationSnapshot, snapshotId: runtime-id, producer: route presentation sealer, candidateId: physicsPresentationCandidate.candidateId, cameraPublicationId: physicsCameraViewPublicationsByTarget["main/primary-view"].cameraPublicationId, viewPreparationId: physicsViewPreparationPublicationsByTarget["main/primary-view"].viewPreparationId, presentationTargetId: main, viewId: primary-view, presentedStatePairRefs: candidate binding IDs, resourceLeaseRefs: exact transitive refs, eventSequenceRanges: candidate ranges, closureManifest: canonicalExpansion(required complete PresentationClosureManifest with exact pair-state, preparation, reactive/reset, shadow/cache/visibility lease closure, event ranges, dependency DAG digest, and closure digest), sealVersion: runtime-version, consumers: [primary-view scene/aerial passes, $threejs-visual-validation] }
physicsPresentationRenderPlansByTarget:
  main/primary-view: { type: PresentationRenderPlan, renderPlanId: ocean-planet-primary-render-plan, timeCohortId: ocean-planet-cohort, candidateId: physicsPresentationCandidate.candidateId, snapshotId: physicsPresentationSnapshotsByTarget["main/primary-view"].snapshotId, presentationTargetId: main, viewId: primary-view, phaseIds: exact selected phase IDs, phaseRecords: canonicalExpansion(required complete RenderPlanPhase records), edges: canonicalExpansion(required complete RenderPlanEdge DAG), requiredPreparationEdgeIds: exact preparation edges, renderResourceLeaseIds: exact render leases, plannedResetActionIds: exact reset actions, expectedResetHistoryGenerations: exact generation map, shadowFactorIds: exact once-applied factor IDs or [], closureDigest: canonical plan closure digest, immutablePlanDigest: canonical immutable plan digest }
frameExecutionRecord:
  type: FrameExecutionRecord
  producer: $threejs-image-pipeline frame executor
  consumers: [$threejs-visual-validation, performance evidence]
  executionId: unique append-only presentation execution
  timeCohortId: ocean-planet-cohort
  candidateIds: [physicsPresentationCandidate.candidateId]
  cohortAdmission: exact admitted FrameCohortAdmission for ocean-planet-cohort
  renderPlans: [physicsPresentationRenderPlansByTarget["main/primary-view"]]
  slotAdmissions: [exact admitted main/primary-view FrameSlotAdmission]
  requiredTargetViewKeys: [main/primary-view]
  snapshotIds: [physicsPresentationSnapshotsByTarget["main/primary-view"].snapshotId]
  overallStatus: submitted | completed | partial-failure | aborted | device-lost
  backendGeneration: exact backend generation
  deviceLossGeneration: exact device-loss generation
  targetExecutions:
    main/primary-view: { snapshotId: physicsPresentationSnapshotsByTarget["main/primary-view"].snapshotId, renderPlanId: ocean-planet-primary-render-plan, slotAdmissionId: exact admitted main/primary-view slot ID, presentationTargetId: main, viewId: primary-view, status: submitted | completed | failed | aborted | device-lost, submittedPasses: exact pass/dispatch keys, queueSubmissionEpochs: ordered epochs, actionResults: typed results, resetActionResults: exact planned reset results, completionTokens: exact tokens, presentedTimestamp: mapped presentation-clock record or TypedAbsence(not-presented, frame executor, execution interval, target status), failure: typed failure or TypedAbsence(no-failure, frame executor, execution interval, target status) }
  leaseDispositionById:
    lease-id: { disposition: retained-until-join | retired-after-abort | invalidated-by-device-loss, consumingSnapshotIds: [physicsPresentationSnapshotsByTarget["main/primary-view"].snapshotId], completionJoin: { simulationConsumers: [typed tokens], couplingConsumers: [], externalConsumers: [], presentationConsumers: [typed tokens], deviceLossRetirementPath: typed rule }, retirementEvidence: typed completion-or-loss record }
  immutability: completion never mutates candidate, camera publication, view-preparation publication, or snapshot
physicsPresentationSnapshot: not used # deprecated compatibility projection; never allocated
outputOwnersByPresentationTarget:
  main: { toneMap: $threejs-image-pipeline, outputTransform: $threejs-image-pipeline, adaptiveQuality: $threejs-image-pipeline }
sharedResourceOwners:
  gbuffer: not used
  depth: $threejs-image-pipeline
  normal: not used
  velocity: not used
  history: not used
  weatherEnvelope: not used
  toneMap: $threejs-image-pipeline
  outputTransform: $threejs-image-pipeline
  adaptiveResolution: $threejs-image-pipeline
coverageStatus: partial
coverageBlockers: emitted-manifest closure remains blocked until the ocean error ledgers, coordination advances, application-ledger-empty proof, commit transaction/receipt, quality-transition records, PresentationClosureManifest, and complete render-plan DAG replace every canonicalExpansion marker and pass schema plus router-contract validation
performanceContract:
  routeStatus: provisional
  skillTierCrosswalk: { status: required-before-acceptance, rule: map every selected skill local tier explicitly to route Full/Budgeted/Minimum viable with protected invariants and explicit unsupported-tier mappings; no implicit name equality }
  frameInterval: { value: "", unit: ms, label: Derived, source: "1000 ms / [Gated] frozen target refresh" }
  passKeys: [ocean.simulation, atmosphere.lighting-transport, physics.publish-presentation, primary-view.scene, main.present]
  accounting: unique pass union plus composed full-frame measurement; no skill-max sum
  mobileGate: A/B minimal attachments against every proposed shared MRT output; count ocean/transport versions, per-view PresentedStatePairs, resource leases, quality-migration overlap, and dispatch traffic; no frame-loop readback or unfiltered full-domain duplication
  qualityAdaptation: hysteretic bottleneck-specific transaction preserving horizon and planet error gates
acceptanceEvidence:
  requiredDebugViews: [PhysicsContext planet frames/charts, ocean provider brackets, LightingTransportSnapshot channels/factor IDs, candidate/camera/view-preparation/snapshot versions, planet height/LOD, ocean displacement/derivatives, atmosphere depth, no-post]
  requiredMetrics: ["p50/p95 [Measured] composed timing", geometric continuity, radiometric unit/factor closure, provider age/error, candidate/camera/view-preparation/snapshot immutability, rebase-zero-motion, quality-transition rollback, temporal stability, logical attachment bytes]
  requiredCommands: [installed-source API assertions, project validation/capture command]
  requiredArtifacts: [fixed orbit/horizon captures, PhysicsGraph/descriptor/candidate/camera/view-preparation/snapshot/execution records, pass ledger, sustained target traces]
```

## rainy city street

Input brief: procedurally authored street with buildings, rain, wet surfaces,
local puddles, splashes, and shared presentation.

minimal skill set:

```text
backendManifest: "populate required [Gated] and observed [Measured] fields from canonical preflight"
workloadProfile:
  domain: cinematic-art
  intent: present
  truthContract: physically-plausible
  representation: procedural-mesh
  interaction: free-navigation
  temporal: simulation
  scale: city-terrain
  deployment: "brief-defined desktop/mobile WebGPU matrix"
causeLedger:
  sourceOfTruth: authored street geometry plus one project EnvironmentForcingSnapshot source
  primaryObservable: causally coupled rainfall, impacts, wetness, and bounded puddle response
  earliestMissingLayer: motion
  selectedAlgorithm: one EnvironmentForcingSnapshot drives sparse precipitation; a receiver reducer partitions each typed precipitation SurfaceExchange into retained wetness and residual puddle inflow before bounded puddle dynamics
  rejectedAlgorithms:
    - spectral ocean: wrong spatial scale and wave cause
    - bloom-only wetness: cannot create surface roughness, normals, or water depth
  noPostBaseline: rain impacts, wetness masks, and puddle geometry read without bloom/grading
selectedSkills:
  - $threejs-procedural-buildings-and-cities
  - $threejs-rain-snow-and-wet-surfaces
  - $threejs-water-optics
  - $threejs-image-pipeline
  - $threejs-visual-validation
primaryOwner: $threejs-rain-snow-and-wet-surfaces
deferredSkills:
  - $threejs-bloom
  - $threejs-exposure-color-grading
omittedSkills:
  - $threejs-volumetric-clouds: no cloud-volume observable in the brief
  - $threejs-spectral-ocean: local puddles do not require horizon spectra
owners:
  sourceOfTruth: project environment forcing configuration plus authored street geometry
  representation: building/weather/water owners
  spatialFrame: $threejs-procedural-buildings-and-cities
  timebase: route physics coordinator executing the PhysicsGraph
  semanticIds: project scene layer
  selectionPicking: not used
  clipSection: not used
  presentation: $threejs-image-pipeline
  validation: $threejs-visual-validation
requiredSignals:
  sceneColorRegistry:
    street-view: { producer: shared scene pass, consumers: [presentation] }
  depthRegistry:
    street-view: { producer: shared scene pass, consumers: [precipitation occlusion] }
  normalRegistry: not used by post until AO or a reconstruction consumer is selected
  velocityRegistry: not used until temporal reconstruction is selected
  objectIdRegistry: not used
  historyRegistry: not used until a named temporal consumer is selected
domainSignals:
  weatherEnvelope: { physicsSignal: environmentForcing, consumers: [rain, impacts, receiver wetness, puddle boundary conditions] }
  receiverWetness: { physicsSignal: receiverWetness, consumers: [street materials, runoff partition, validation] }
  puddleWater: { physicsSignal: puddleWater, consumers: [puddle geometry/optics, splash coupling, validation] }
physicsContext:
  type: PhysicsContext
  producer: route physics coordinator
  consumers: [project environment forcing coordinator, $threejs-procedural-buildings-and-cities, $threejs-rain-snow-and-wet-surfaces, $threejs-water-optics, $threejs-image-pipeline, $threejs-visual-validation]
  invariant: one finite positive metersPerWorldUnit is the sole world-to-physics scale boundary; provider state remains SI in a stable right-handed physics frame; typed gravity; floating-origin epoch; generation-bearing material/entity IDs; time origin for precipitation, receivers, puddles, and rendering
physicsGraph:
  type: PhysicsGraph
  producer: route physics coordinator
  graphId: rainy-city-physics-graph
  contextId: physicsContext.contextId
  coordinationInterval: nonempty PhysicsTimeInterval on rainy-city-coordination-clock
  coordinationAdvance: one PhysicsCoordinationAdvanceRecord with exact predecessor receipt, debt, admitted catch-up count, stage/claim/transaction IDs, and committed receipt digest
  clocks:
    rainyCityCoordinationClock: { type: PhysicsClockDescriptor, clockId: rainy-city-coordination-clock, owner: route physics coordinator, mappingKind: fixed-rational, mappingRevision: rainy-city-clock-map-v1, discontinuityEpoch: rainy-city-clock-continuity-v1, coordinationClockMap: identity-with-zero-error }
    forcingClock: { type: PhysicsClockDescriptor, clockId: forcing-clock, owner: project environment forcing coordinator, mappingKind: external, mappingRevision: forcing-clock-map-v1, discontinuityEpoch: forcing-clock-continuity-v1, coordinationClockMap: versioned bounded-error map to rainy-city-coordination-clock }
    precipitationClock: { type: PhysicsClockDescriptor, clockId: precipitation-clock, owner: $threejs-rain-snow-and-wet-surfaces, mappingKind: fixed-rational, mappingRevision: precipitation-clock-map-v1, discontinuityEpoch: rainy-city-clock-continuity-v1, coordinationClockMap: exact subinterval map selected by the fall-speed/collision gate }
    receiverClock: { type: PhysicsClockDescriptor, clockId: receiver-clock, owner: $threejs-rain-snow-and-wet-surfaces receiver reducer, mappingKind: fixed-rational, mappingRevision: receiver-clock-map-v1, discontinuityEpoch: rainy-city-clock-continuity-v1, coordinationClockMap: exact interval map }
    puddleClock: { type: PhysicsClockDescriptor, clockId: puddle-clock, owner: $threejs-water-optics, mappingKind: piecewise-versioned, mappingRevision: puddle-clock-map-v1, discontinuityEpoch: rainy-city-clock-continuity-v1, coordinationClockMap: versioned subinterval map selected by the recorded stability gate }
    presentationClock: { type: PhysicsClockDescriptor, clockId: presentation-clock, owner: route presentation scheduler, mappingKind: external, mappingRevision: presentation-clock-map-v1, discontinuityEpoch: presentation-clock-continuity-v1, coordinationClockMap: versioned bounded-error map to rainy-city-coordination-clock }
  stages:
    - ingest: latch PhysicsContext, streetSupport, PhysicsMaterialRegistry, and the next versioned forcing input
    - sample-forcing: latch one already committed EnvironmentForcingSnapshot at the mapped forcing PhysicsInstant; the route never republishes this external state
    - predict: write transaction-private prepared precipitation, receiver-inventory, and puddle versions over mapped PhysicsTimeIntervals; no stage writes a committed version
    - emit-interactions: emit precipitation-to-receiver exactly once per accepted flux cell; sparse visible hit samples reference that exchange and carry no conserved quantity
    - solve-subcycles: write transaction-private prepared receiver/puddle state after partitioning precipitation mass, deriving runoff-to-puddle and area-distributed impact-to-puddle transfers, and applying each once under exact StateAdvanceClaim and InteractionApplicationLedger IDs
    - reduce-reactions: no reaction group exists; reduce exchange-owned ledgers and verify the shared precipitation conservation group without reapplying mass or momentum
    - correct: enforce nonnegative receiver storage and puddle depth, mass/momentum residual gates, finite state, and mapped-interval coverage
    - commit: publish accepted receiver-wetness, puddle-water, and interaction sequence ranges only through rainy-city-state-commit-group
    - publish-presentation: publish the camera-free candidate from committed versions; camera, view preparation, and sealing follow as immutable per-view publications
  stageExecutionRules:
    precipitation-predict-and-transport: { type: PhysicsStageExecutionRule, activation: per-advance, partition: exact-subcycle-tile, maximumActivationsPerAdvance: 1, maximumExecutionsPerActivation: Gated precipitation subcycle count, nativeSubcycleSelection: stability-bound, ordering: monotonic-interval-then-native-sequence }
    physical-impact-partition: { type: PhysicsStageExecutionRule, activation: per-advance, partition: exact-subcycle-tile, maximumActivationsPerAdvance: 1, maximumExecutionsPerActivation: Gated occupied physical flux tiles, nativeSubcycleSelection: fixed-count, ordering: monotonic-interval-then-native-sequence }
    sparse-visible-hit-samples: { type: PhysicsStageExecutionRule, activation: per-event, partition: sparse-events, maximumActivationsPerAdvance: Gated visual event sets, maximumExecutionsPerActivation: Gated visible hit samples, nativeSubcycleSelection: event-times, ordering: monotonic-interval-then-native-sequence }
    receiver-and-puddle-solve: { type: PhysicsStageExecutionRule, activation: per-advance, partition: exact-subcycle-tile, maximumActivationsPerAdvance: 1, maximumExecutionsPerActivation: Gated receiver/puddle subcycle count, nativeSubcycleSelection: stability-bound, ordering: monotonic-interval-then-native-sequence }
    commit-and-publish: { type: PhysicsStageExecutionRule, activation: per-advance, partition: single, maximumActivationsPerAdvance: 1, maximumExecutionsPerActivation: 1, nativeSubcycleSelection: not-applicable, ordering: monotonic-interval-then-native-sequence }
  stateAdvanceClaimRule: each precipitation, receiver, and puddle state equation has exactly one StateAdvanceClaim for the coordination interval; all exact-subcycle-tile executions name that claim, sparse visual events never advance conserved state, and an admitted cadence interval with no owner advance emits kind state-hold with outputPreparedVersion TypedAbsence(not-applicable, record authority, record interval, sketch provenance) rather than reusing a committed version as a hidden write
  edges:
    - { type: PhysicsGraphEdge, edgeId: forcing-to-precipitation-edge, producerStageId: sample-forcing, consumerStageId: predict, payload: environmentForcing committed version, requiredVersionAndPhase: exact interval-start committed forcing version, interpolationExtrapolation: declared clock-map/filter rule and error, maximumStaleness: forcing consumer tolerance, latency: exact forcing latency descriptor, barrier: { type: PhysicsDependencyRef, dependencyId: forcing-to-precipitation, requiredCompletionVersion: exact completion version }, absencePolicy: block }
    - { type: PhysicsGraphEdge, edgeId: partition-to-receiver-puddle-edge, producerStageId: emit-interactions, consumerStageId: solve-subcycles, payload: physical impact parent/partition records plus prepared interaction ranges, requiredVersionAndPhase: exact transaction-prepared version for this advance, interpolationExtrapolation: not-used, maximumStaleness: not-applicable, latency: exact same-advance latency descriptor, barrier: { type: PhysicsDependencyRef, dependencyId: partition-to-receiver-puddle, requiredCompletionVersion: exact completion version }, absencePolicy: block }
  dependencies:
    - { type: PhysicsDependency, dependencyId: forcing-to-precipitation, kind: cpu-data, producerStageId: sample-forcing, consumerStageId: predict, payloadSchemaAndVersionRule: committed EnvironmentForcingSnapshot exact-version rule, producerResidencyRule: forcing committed host-visible residency, consumerResidencyRule: precipitation input residency with any upload exposed separately, resourceSubresourceRule: TypedAbsence(not-applicable, record authority, record interval, sketch provenance) for CPU value, accessTransitionRule: producer publish/read-only consumer access, generationCompatibilityRule: TypedAbsence(not-applicable, record authority, record interval, sketch provenance) for CPU value, releaseAcquireProtocol: ordered committed-publication dependency, externalFenceOrHostVisibilityRule: committed host-visible proof, completionSemantics: exact forcing version visible before first precipitation read }
    - { type: PhysicsDependency, dependencyId: partition-to-receiver-puddle, kind: cpu-data, producerStageId: emit-interactions, consumerStageId: solve-subcycles, payloadSchemaAndVersionRule: exact PhysicalImpactParentRecord/PhysicalImpactPartitionRecord/interaction-range prepared-version rule, producerResidencyRule: partition reducer host-visible residency, consumerResidencyRule: receiver/puddle source reducer residency with transfer separately exposed, resourceSubresourceRule: exact SoA ranges or TypedAbsence(not-applicable, record authority, record interval, sketch provenance) for values, accessTransitionRule: producer write to immutable consumer read, generationCompatibilityRule: exact range generation or TypedAbsence(not-applicable, record authority, record interval, sketch provenance) for values, releaseAcquireProtocol: ordered same-advance prepared-state dependency, externalFenceOrHostVisibilityRule: host visibility proof, completionSemantics: parent/partition content digests and prepared range complete before receiver/puddle application }
  loopMacros: []
  commitGroups:
    - { commitGroupId: rainy-city-state-commit-group, owner: route physics coordinator, interval: coordinationInterval, provisionalVersions: [precipitationState.transaction-prepared, receiverWetness.transaction-prepared, puddleWater.transaction-prepared, precipitationInteractionRanges.transaction-prepared], preparedPublications: [{ type: PhysicsPreparedPublication, preparedPublicationId: rainy-precipitation-state-prepared, commitGroupId: rainy-city-state-commit-group, stateEquationOwner: $threejs-rain-snow-and-wet-surfaces, signalOrStateEquationId: precipitationState, provisionalVersion: precipitationState.transaction-prepared, preparedVersion: precipitationState.prepared-for-commit, contentDigest: precipitation state/content digest, ownerApproval: precipitation owner/build revision, prepareDependencyRefs: exact forcing/support dependencies, visibility: transaction-private }, { type: PhysicsPreparedPublication, preparedPublicationId: rainy-receiver-state-prepared, commitGroupId: rainy-city-state-commit-group, stateEquationOwner: $threejs-rain-snow-and-wet-surfaces receiver reducer, signalOrStateEquationId: receiverWetness, provisionalVersion: receiverWetness.transaction-prepared, preparedVersion: receiverWetness.prepared-for-commit, contentDigest: receiver state/content digest, ownerApproval: receiver owner/build revision, prepareDependencyRefs: exact interaction/reduction dependencies, visibility: transaction-private }, { type: PhysicsPreparedPublication, preparedPublicationId: rainy-puddle-state-prepared, commitGroupId: rainy-city-state-commit-group, stateEquationOwner: $threejs-water-optics, signalOrStateEquationId: puddleWater, provisionalVersion: puddleWater.transaction-prepared, preparedVersion: puddleWater.prepared-for-commit, contentDigest: puddle state/content digest, ownerApproval: water owner/build revision, prepareDependencyRefs: exact runoff/impact/water dependencies, visibility: transaction-private }, { type: PhysicsPreparedPublication, preparedPublicationId: rainy-interaction-ranges-prepared, commitGroupId: rainy-city-state-commit-group, stateEquationOwner: route interaction coordinator, signalOrStateEquationId: precipitationInteractionRanges, provisionalVersion: precipitationInteractionRanges.transaction-prepared, preparedVersion: precipitationInteractionRanges.prepared-for-commit, contentDigest: exact parent/partition/application-ledger range digest, ownerApproval: route interaction coordinator revision, prepareDependencyRefs: exact partition/reduction dependencies, visibility: transaction-private }], committedPublications: [precipitationState.committed, receiverWetness.committed, puddleWater.committed, precipitationInteractionRanges.committed], publicationLineage: one exact CommitPublicationLineage per prepared publication and committed output, stateEquationOwners: { precipitation-state: $threejs-rain-snow-and-wet-surfaces, receiver-liquid-inventory: $threejs-rain-snow-and-wet-surfaces receiver reducer, puddle-water-mass-and-momentum: $threejs-water-optics, interaction-sequence-publication: route interaction coordinator }, conservationAndErrorGates: [nonnegative-receiver-storage, nonnegative-puddle-depth, precipitation-mass-momentum-partition-closure, exact-once-cursors, all rainy-city ErrorPropagationLedger consumer gates, finite-state], atomicity: all-or-none, failureDisposition: preserve-prior-commit, commitTransactionId: rainy-city-commit-transaction }
  commitTransactions:
    - { type: PhysicsCommitTransaction, commitTransactionId: rainy-city-commit-transaction, coordinationAdvanceId: exact current rainy-city advance ID, contextId: physicsContext.contextId, interval: coordinationInterval, commitGroupIds: [rainy-city-state-commit-group], preparedPublicationIds: [rainy-precipitation-state-prepared, rainy-receiver-state-prepared, rainy-puddle-state-prepared, rainy-interaction-ranges-prepared], conservationErrorAndResourceGates: exact storage/partition/conservation/error/resource results, priorCommittedVersions: [precipitationState prior, receiverWetness prior, puddleWater prior, interaction cursor prior], publicationSetDigest: canonical prepared publication-set digest, atomicPublicationProtocol: prepare-validate-single-registry-swap, status: preparing | prepared | committed | rejected | rolled-back, receipt: on committed status one PhysicsCommitReceipt with receiptId, this commitTransactionId, publicationInstant, preparedToCommittedPublicationMap covering each prepared ID/version/digest and committed version/digest exactly once, committedPublications, priorToCommittedVersionMap, identical publicationSetDigest, registryRevisionBeforeAfter, exact dependencyCompletionRefs, conservationAndErrorGateResults, status committed, and receiptDigest; otherwise TypedAbsence(not-applicable, record authority, record interval, sketch provenance) }
  originRebaseTransactions: [] # populate with canonical accepted transactions when a physics-origin rebase is scheduled
  publicationRule: forcing remains an immutable external committed read; every route-generated stage write is loop-provisional or transaction-prepared and becomes descriptor/event/presentation visible only through the successful rainy-city commit receipt
  executionLedger: { type: PhysicsExecutionLedger, ledgerId: route-interval-execution-ledger-id, graphId: route PhysicsGraph ID, graphRevision: exact graph revision, coordinationInterval: graph coordinationInterval, coordinationAdvanceId: exact current rainy-city advance ID, stageExecutions: complete PhysicsStageExecution records with exact executionInterval, coordinationCoverageInterval, coordinationClockMappingProof, subcycleIndex, read/write resolutions, claims, application ledgers, and transaction-prepared writes, dependencyCompletions: exact refs to physicsDependencyCompletions records below, stateAdvanceClaims: exactly one receiver and one puddle state-advance claim per interval plus precipitation event-application or explicit state-hold claims, interactionApplicationLedgers: exact parent/partition/runoff/impact ledgers with no double application, loopResults: [], commitReceipts: exactly the successful rainy-city-commit-transaction receipt or none, catchUpDebtBeforeAfter: typed duration pair, discontinuityEpoch: graph epoch, physicsCostLedgerId: route-specific-runtime-physics-cost-ledger-id }
  physicsDependencyCompletions:
    - { type: PhysicsDependencyCompletion, completionId: forcing-to-precipitation-completion-for-this-advance, dependencyId: forcing-to-precipitation, coordinationAdvanceId: exact current rainy-city advance ID, producerExecutionId: exact external forcing publication execution, consumerExecutionId: exact precipitation execution, payloadAndVersion: committed EnvironmentForcingSnapshot and exact version, producerResidency: exact forcing residency descriptor, consumerResidency: exact precipitation residency descriptor, resourceIdentityAndSubresource: exact binding/subresource or TypedAbsence(not-applicable, record authority, record interval, sketch provenance) for CPU value, accessTransition: forcing producer write to precipitation read, deviceBackendResourceGenerations: exact tuple or TypedAbsence(not-applicable, record authority, record interval, sketch provenance) for CPU value, producerRelease: exact submission/completion token or TypedAbsence(not-applicable, record authority, record interval, sketch provenance) for CPU value, consumerAcquire: exact wait/first-use or TypedAbsence(not-applicable, record authority, record interval, sketch provenance) for CPU value, externalFenceOrHostVisibility: committed CPU visibility or exact external proof, status: completed, receiptDigest: canonical completion receipt digest }
    - { type: PhysicsDependencyCompletion, completionId: partition-to-receiver-puddle-completion-for-this-advance, dependencyId: partition-to-receiver-puddle, coordinationAdvanceId: exact current rainy-city advance ID, producerExecutionId: exact impact partition execution, consumerExecutionId: exact receiver/puddle solve execution, payloadAndVersion: prepared physical-impact parent/partition records and exact interaction-range version, producerResidency: exact partition reducer residency descriptor, consumerResidency: exact receiver/puddle residency descriptor, resourceIdentityAndSubresource: exact binding/subresource or TypedAbsence(not-applicable, record authority, record interval, sketch provenance) for CPU values, accessTransition: partition producer write to receiver/puddle read, deviceBackendResourceGenerations: exact tuple or TypedAbsence(not-applicable, record authority, record interval, sketch provenance) for CPU values, producerRelease: exact submission/completion token or TypedAbsence(not-applicable, record authority, record interval, sketch provenance) for CPU values, consumerAcquire: exact wait/first-use or TypedAbsence(not-applicable, record authority, record interval, sketch provenance) for CPU values, externalFenceOrHostVisibility: exact host/device visibility proof, status: completed, receiptDigest: canonical completion receipt digest }
  catchUpBatch: { type: PhysicsCatchUpBatch, catchUpBatchId: exact rainy-city presentation-opportunity batch ID, graphId: route PhysicsGraph ID, contextId: physicsContext.contextId, owner: route physics coordinator, debtIdentity: { type: PhysicsCatchUpDebtIdentity, debtIdentityId: exact rainy-city debt identity, graphId: route PhysicsGraph ID, debtClockId: rainy-city-coordination-clock, sourceCursorBeforeAfter: exact monotonic cursor pair, presentationOpportunitySequence: exact integer, observedAt: exact PhysicsInstant, policyRevision: rainy-city-catch-up-policy revision }, debtBefore: exact PhysicsDuration, elapsedDuringBatch: exact elapsed PhysicsDuration on debt clock, admittedAdvanceIntervals: exact ordered PhysicsTimeIntervals, coordinationAdvanceIds: exact ordered advance IDs, committedAdvanceDuration: exact sum of successfully committed advance durations, explicitlyDroppedDuration: zero because policy retains debt, debtAfter: exact PhysicsDuration satisfying debt arithmetic, lossLedger: TypedAbsence(not-applicable, record authority, record interval, sketch provenance) because no interval is dropped, policyRevision: rainy-city-catch-up-policy revision, errorResourceAndExecutionGateResults: exact gate results including native execution maximum, status: completed | rejected | blocked, receiptDigest: canonical catch-up batch receipt digest }
  catchUpPolicy: { type: PhysicsCatchUpPolicy, owner: route physics coordinator, debtClockId: rainy-city-coordination-clock, maximumDebt: Gated PhysicsDuration, maximumCoordinationAdvancesPerPresentationOpportunity: Gated advance count, maximumNativeExecutionsPerOpportunity: Gated exact stage/subcycle/event execution count, debtDisposition: retain, discontinuityOnDrop: forbidden, externalDeadlinePolicy: bounded-defer, errorAndResourceGates: exact precipitation/receiver/puddle/error/memory/latency gates }
  discontinuityPolicy: retained debt never drops an interval; any separately admitted seek/restart increments the discontinuity epoch, accounts lost state/events, applies scoped resets, and forbids interpolation across the gap
physicsErrorPropagationLedgers:
  inventory: { precipitation-to-receiver: rainy-city-precipitation-error-ledger, receiverWetness: rainy-city-receiver-error-ledger, runoff-to-puddle: rainy-city-runoff-error-ledger, impact-to-puddle: rainy-city-impact-error-ledger, puddleWater: rainy-city-puddle-error-ledger }
  records:
    rainy-city-precipitation-error-ledger: { type: ErrorPropagationLedger, ledgerId: rainy-city-precipitation-error-ledger, contextId: physicsContext.contextId, outputSignalOrInteractionId: precipitation-to-receiver, outputStateVersion: precipitation interaction range provisional version, evaluationInterval: precipitation-application-interval, inputErrors: [forcing precipitation/velocity/filter/time errors, street-support error], transformsFiltersInterpolations: [clock map, exposed-area projection, physical-area quadrature], correlationAssumptions: [mass and momentum channels retain forcing covariance], operatorOrGainBounds: [projection and quadrature bounds], modeledApproximationTerms: [unresolved collision/occlusion error], numericalTerms: [flux reduction residual], combinationRule: versioned correlated operator-bound rule, outputError: rainy-city-precipitation-output-error, acceptanceGate: mass/momentum and support consumer tolerances, provenance: forcing/precipitation sampler/support revisions }
    rainy-city-receiver-error-ledger: { type: ErrorPropagationLedger, ledgerId: rainy-city-receiver-error-ledger, contextId: physicsContext.contextId, outputSignalOrInteractionId: receiverWetness, outputStateVersion: receiverWetness.provisional, evaluationInterval: physicsGraph.coordinationInterval, inputErrors: [rainy-city-precipitation-output-error, support/material errors, prior receiver error], transformsFiltersInterpolations: [receiver reduction and retention/infiltration/evaporation maps], correlationAssumptions: [precipitation mass/momentum partitions preserve parent correlation], operatorOrGainBounds: [nonnegative storage and drainage bounds], modeledApproximationTerms: [subgrid retention error], numericalTerms: [receiver inventory residual], combinationRule: versioned conservative interval rule, outputError: rainy-city-receiver-output-error, acceptanceGate: receiver/runoff/material tolerances, provenance: receiver reducer/build/material-law revisions }
    rainy-city-runoff-error-ledger: { type: ErrorPropagationLedger, ledgerId: rainy-city-runoff-error-ledger, contextId: physicsContext.contextId, outputSignalOrInteractionId: runoff-to-puddle, outputStateVersion: runoff interaction range provisional version, evaluationInterval: runoff-application-interval, inputErrors: [rainy-city-receiver-output-error, street support/drainage errors], transformsFiltersInterpolations: [catchment reduction and receiver-to-puddle transfer], correlationAssumptions: [mass/momentum transfer errors remain correlated], operatorOrGainBounds: [drainage velocity and transfer bounds], modeledApproximationTerms: [subgrid drainage error], numericalTerms: [quadrature/conservation residual], combinationRule: versioned correlated interval rule, outputError: rainy-city-runoff-output-error, acceptanceGate: puddle source and receiver closure tolerances, provenance: receiver runoff adapter/build/state versions }
    rainy-city-impact-error-ledger: { type: ErrorPropagationLedger, ledgerId: rainy-city-impact-error-ledger, contextId: physicsContext.contextId, outputSignalOrInteractionId: impact-to-puddle, outputStateVersion: impact interaction range provisional version, evaluationInterval: impact-application-interval, inputErrors: [rainy-city-precipitation-output-error, puddle/support errors], transformsFiltersInterpolations: [parent momentum partition and normalized extensive-distribution kernel], correlationAssumptions: [child partition shares parent momentum covariance], operatorOrGainBounds: [partition closure and kernel moment bounds], modeledApproximationTerms: [subgrid impact-spread error], numericalTerms: [partition and angular-momentum residual], combinationRule: versioned physical-impact partition closure rule, outputError: rainy-city-impact-output-error, acceptanceGate: disjoint partition/momentum/energy tolerances, provenance: rain impact reducer/build/parent-content digest }
    rainy-city-puddle-error-ledger: { type: ErrorPropagationLedger, ledgerId: rainy-city-puddle-error-ledger, contextId: physicsContext.contextId, outputSignalOrInteractionId: puddleWater, outputStateVersion: puddleWater.provisional, evaluationInterval: physicsGraph.coordinationInterval, inputErrors: [rainy-city-runoff-output-error, rainy-city-impact-output-error, prior puddle/support errors], transformsFiltersInterpolations: [puddle source reduction and bounded-water substeps], correlationAssumptions: [runoff/impact shared precipitation correlation retained], operatorOrGainBounds: [positivity/CFL/source bounds], modeledApproximationTerms: [thin-water boundary error], numericalTerms: [water mass/momentum residual], combinationRule: versioned covariance-plus-operator-bound rule, outputError: rainy-city-puddle-output-error, acceptanceGate: water sample/optics/splash tolerances, provenance: water owner/build/source/state revisions }
physicsCostLedger:
  type: PhysicsCostLedger
  ledgerId: route-specific-runtime-physics-cost-ledger-id
  status: active
  targetAndHarness: named physical target, rainy street path/seed, route tier, viewport, DPR, and sustained protocol
  qualityState: route Full/Budgeted/Minimum viable plus performanceContract.skillTierCrosswalk
  cadenceTraceTotals: { type: CadenceTraceTotals, traceTotalsId: rainy-city-cadence-trace-totals, traceRef: content-addressed sustained route trace/protocol, measurementInterval: exact measured PhysicsTimeInterval, exactDuration: duration derived from registered measurement clock, coordinationAdvanceCount: exact count, catchUpBatchCount: exact count, stageExecutionCounts: exact PhysicsGraphStageId-to-count map, nativeSubcycleCounts: exact owner-to-count map, couplingIterationCounts: empty exact map, interactionApplicationCounts: exact payload-tag-to-count map, presentedFrameCounts: exact target-view-to-count map, workOccurrenceCounts: exact PhysicsWorkKey-to-count map, trafficOccurrenceAndLogicalByteTotals: exact TrafficRecordId-to-count/byte map, droppedCoordinationIntervals: exact intervals or empty, exactTotalsDigest: canonical trace totals digest }
  graphStageCosts: [forcing ingest, precipitation, receiver reduction, puddle, commit/publication router cost records]
  coordinationIntervalsPerSecond: labelled distribution on rainy-city-coordination-clock
  stageExecutionsPerCoordinationInterval: labelled counts by stage
  stageExecutionsPerSecond: labelled counts through registered clock maps
  coordinationIntervalsPerPresentedFrame: labelled distribution through presentation-clock-map-v1
  subcyclesAndCouplingIterationsPerPresentedFrame: labelled precipitation/puddle counts; coupling explicitly not used
  executionsPerPresentedFrame: labelled stage counts
  worstPermittedCatchUpBurst: { triggerAndIntervalDebt: graph catch-up/discontinuity policy, executionsDispatchesAndTraffic: labelled weather/receiver/puddle records, latencyMemoryAndErrorGate: typed gates }
  hotBytesReadWrittenPerExecution: labelled forcing/particle/receiver/puddle/exchange bytes
  solverDispatches: [precipitation and puddle extent/workgroup/cadence/timing records]
  queueSubmissionsAndPassBreaks: labelled counts
  dependencyCriticalPaths: [forcing to exchange partition to receiver/puddle commit to candidate to view preparation]
  tileGpuTraffic: { attachmentStoreLoadResolveBytes: labelled records, tileSpillEvidence: measured-or-TypedAbsence(not-measured, evidence owner, measurement interval, harness provenance), renderComputePassBreaks: labelled counts }
  bindingAndDeviceLimits: [limit-demand-headroom-and-gate]
  cpuWork: [forcing latch, exchange reduction, candidate/per-view assembly]
  allocationGcAndCompilation: [cadence-latency-and-byte-record]
  uploadsCopiesMaps: [TrafficRecord]
  hostCompletionsReadbacksPerPresentedFrame: labelled zero-or-failure record
  synchronization: [wait-or-stall-record]
  multiviewAndFramesInFlightMultipliers: labelled view/lease/resource records
  hotState: PhysicsMemoryLedger
  peakTransient: PhysicsMemoryLedger
  migrationOverlap: PhysicsMemoryLedger
  thermalPowerState: measured-or-TypedAbsence(not-measured, evidence owner, measurement interval, harness provenance)
physicsSignals:
  environmentForcing: { type: PhysicsSignalDescriptor<EnvironmentForcingSnapshot>, producer: project environment forcing coordinator, consumers: [$threejs-rain-snow-and-wet-surfaces, $threejs-water-optics boundary adapter, $threejs-visual-validation], channels: material air velocity, temperature, pressure, density, humidity convention, and precipitation mass-area flux in kg m^-2 s^-1 after any water-equivalent input conversion using declared reference density/phase; every channel carries requested/actual oriented footprint/filter, validity/error, and staleness }
  streetSupport: { type: PhysicsSignalDescriptor<SupportSurfaceSample>, producer: $threejs-procedural-buildings-and-cities surface adapter, consumers: [$threejs-rain-snow-and-wet-surfaces collision/receiver reducer, $threejs-water-optics puddle boundary adapter, $threejs-visual-validation] }
  receiverWetness: { type: PhysicsSignalDescriptor<receiver-liquid-mass-per-area-state>, producer: $threejs-rain-snow-and-wet-surfaces receiver reducer, consumers: [street materials, runoff partition diagnostics, $threejs-visual-validation], channels: authoritative liquid mass per receiver area in kg m^-2; dimensionless display wetness and alternate storage depth are derived through declared capacity/density maps }
  puddleWater: { type: PhysicsSignalDescriptor<WaterSurfaceSample>, producer: $threejs-water-optics, consumers: [puddle geometry/optics, $threejs-rain-snow-and-wet-surfaces splash adapter, $threejs-visual-validation] }
  qualityChangeRequest: { type: PhysicsSignalDescriptor<QualityChangeRequest>, producer: $threejs-image-pipeline quality governor, consumers: [route physics coordinator] }
  qualityTransition: { type: PhysicsSignalDescriptor<QualityTransition>, producer: route physics coordinator, consumers: [$threejs-rain-snow-and-wet-surfaces, $threejs-water-optics, $threejs-image-pipeline, $threejs-visual-validation] }
physicsInteractions:
  - exchangeId: precipitation-to-receiver
    type: SurfaceExchange
    contextId: physicsContext.contextId
    applicationInterval: precipitation-application-interval (nonempty PhysicsTimeInterval on precipitation-clock)
    physicsFrameId: physicsContext.physicsRootFrameId
    physicsOriginEpoch: physicsContext.physicsOriginEpoch
    transformRevision: physicsContext.worldTransformRevision
    mode: one-way
    producer: $threejs-rain-snow-and-wet-surfaces precipitation flux sampler
    consumers: [$threejs-rain-snow-and-wet-surfaces receiver reducer, $threejs-visual-validation]
    participants: [project environment forcing boundary, rain receiver reducer]
    sourceDescriptors: [environmentForcing, streetSupport]
    materialRegistry: PhysicsContext.physicsMaterialRegistry
    interactions:
      - { interactionId: precipitation-mass-flux, role: source, targetStateEquation: receiver water-mass balance, payload: { tag: massFlux, timeSemantics: rate, speciesPhaseMassFluxKgPerM2SByQuadraturePoint: typed nonnegative rain-phase channel map array }, applicationInterval: precipitation-application-interval, footprint: exposed-surface intensive-field area quadrature with physical m2 weights summing represented area; kernel TypedAbsence(no-distribution-kernel, interaction producer, application interval, physical quadrature selected) and normalization target none, signConvention: positive-source-to-receiver, partitionMembership: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), reactionGroupId: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), reactionToInteractionIds: [] }
      - { interactionId: precipitation-momentum-flux-parent, role: source, targetStateEquation: precipitation momentum partition inventory; not a direct receiver/puddle application, payload: { tag: momentumFlux, timeSemantics: rate, momentumFluxTensorPaByQuadraturePoint: typed oriented tensor array correlated with precipitation mass/velocity }, applicationInterval: precipitation-application-interval, footprint: same physical-area quadrature and orientation, signConvention: positive-source-to-receiver, partitionMembership: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), reactionGroupId: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), reactionToInteractionIds: [] }
      - { interactionId: receiver-retained-momentum-flux, role: source, targetStateEquation: receiver/ground linear-angular-momentum balance, payload: { tag: momentumFlux, timeSemantics: rate, momentumFluxTensorPaByQuadraturePoint: receiver-retained partition tensor array }, applicationInterval: precipitation-application-interval, footprint: physical-area receiver-retained subset quadrature, signConvention: positive-source-to-receiver, partitionMembership: { type: InteractionPartitionMembership, parentExchangeId: precipitation-to-receiver, parentInteractionIds: [precipitation-momentum-flux-parent], partitionGroupId: rainy-city-precipitation-momentum-partitions, partitionId: receiver-retained-momentum, partitionMeasure: represented receiver area in m2, closureGroupId: precipitation-water-and-momentum }, reactionGroupId: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), reactionToInteractionIds: [] }
    canonicalInteractionExpansion: the three records carry every remaining canonical InteractionRecord identity/owner/state/frame/origin/exact-once/conservation/validity/error/provenance field; the explicit footprints/payloads/partition membership above are not replaced by this expansion
    reactions: []
    physicalImpactParents:
      - { type: PhysicalImpactParentRecord, physicalImpactParentId: rainy-city-precipitation-momentum-parent, contextId: physicsContext.contextId, parentExchangeId: precipitation-to-receiver, parentInteractionIds: [precipitation-momentum-flux-parent], applicationInterval: precipitation-application-interval, physicsFrameId: physicsContext.physicsRootFrameId, physicsOriginEpoch: physicsContext.physicsOriginEpoch, transformRevision: physicsContext.worldTransformRevision, partitionGroupId: rainy-city-precipitation-momentum-partitions, partitionIds: [receiver-retained-momentum, puddle-impact-momentum], totalFootprintMeasure: parent represented area in m2, conservedPayloadInventory: integrated parent linear/angular momentum and energy commodity map, closureGroupId: precipitation-water-and-momentum, sourceContentDigest: canonical parent interaction/footprint/payload digest }
    physicalImpactPartitions:
      - { type: PhysicalImpactPartitionRecord, physicalImpactPartitionId: rainy-city-receiver-retained-partition-record, physicalImpactParentId: rainy-city-precipitation-momentum-parent, membership: { type: InteractionPartitionMembership, parentExchangeId: precipitation-to-receiver, parentInteractionIds: [precipitation-momentum-flux-parent], partitionGroupId: rainy-city-precipitation-momentum-partitions, partitionId: receiver-retained-momentum, partitionMeasure: represented receiver area in m2, closureGroupId: precipitation-water-and-momentum }, childInteractionIds: [receiver-retained-momentum-flux], partitionFootprint: exact physical-area receiver subset footprint, partitionPayloadInventory: integrated retained linear/angular momentum and energy commodity map, visualChildIds: [], partitionContentDigest: canonical receiver partition digest }
      - { type: PhysicalImpactPartitionRecord, physicalImpactPartitionId: rainy-city-puddle-impact-partition-record, physicalImpactParentId: rainy-city-precipitation-momentum-parent, membership: { type: InteractionPartitionMembership, parentExchangeId: precipitation-to-receiver, parentInteractionIds: [precipitation-momentum-flux-parent], partitionGroupId: rainy-city-precipitation-momentum-partitions, partitionId: puddle-impact-momentum, partitionMeasure: represented puddle-impact area in m2, closureGroupId: precipitation-water-and-momentum }, childInteractionIds: [impact-area-momentum-transfer], partitionFootprint: exact extensive-distributed puddle impact footprint, partitionPayloadInventory: integrated puddle linear/angular momentum and energy commodity map, visualChildIds: sparse non-authoritative splash IDs only, partitionContentDigest: canonical puddle partition digest }
    reactionGroups: []
    conservationGroups: [precipitation-water-and-momentum]
    stabilityGate: nonnegative receiver inventory and accepted quadrature/filter error
    convergence: not-applicable
    couplingLoopId: TypedAbsence(not-applicable, record authority, record interval, sketch provenance)
    batchLedger: { type: InteractionBatchLedger, batchId: precipitation-to-receiver-batch, exchangeId: precipitation-to-receiver, producerId: rain precipitation flux sampler, publishedSequenceRange: closed monotonic range, perConsumerCursor: per-consumer next sequence, acceptedRejectedLateDuplicate: typed labelled counts, overflowPolicy: reject-batch, overflowSequenceRanges: explicit ranges, lostCommodities: typed mass/momentum commodity map, deferredCommodities: typed mass/momentum commodity map, applicationLedgerIds: exact InteractionApplicationLedger IDs whose dispositions cover publishedSequenceRange, exactOnceApplicationLedgerVersion: opaque version }
    omittedFeedback: atmospheric source is an explicit open-system boundary; airborne inventory/deposition closure records the removed mass/momentum and this route claims no resolved atmosphere reaction
  - exchangeId: runoff-to-puddle
    type: SurfaceExchange
    contextId: physicsContext.contextId
    applicationInterval: runoff-application-interval (nonempty PhysicsTimeInterval on receiver-clock)
    physicsFrameId: physicsContext.physicsRootFrameId
    physicsOriginEpoch: physicsContext.physicsOriginEpoch
    transformRevision: physicsContext.worldTransformRevision
    mode: one-way
    producer: $threejs-rain-snow-and-wet-surfaces receiver reducer
    consumers: [$threejs-water-optics puddle source reducer, $threejs-visual-validation]
    participants: [rain receiver reducer, $threejs-water-optics]
    sourceDescriptors: [receiverWetness, streetSupport]
    materialRegistry: PhysicsContext.physicsMaterialRegistry
    interactions:
      - { interactionId: runoff-mass-rate, role: source, targetStateEquation: puddle water-mass balance, payload: { tag: massRate, timeSemantics: rate, speciesPhaseMassRateKgPerS: typed nonnegative liquid-water map }, applicationInterval: runoff-application-interval, footprint: receiver-to-puddle boundary support with physical line/area quadrature and represented measure; extensive rate is not normalized as an intensive flux, signConvention: positive-source-to-receiver, partitionMembership: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), reactionGroupId: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), reactionToInteractionIds: [] }
      - { interactionId: runoff-momentum-transfer, role: source, targetStateEquation: puddle momentum balance, payload: { tag: momentumTransfer, timeSemantics: interval-integrated, linearMomentumNs: dimensioned Vec3, angularMomentumNms: dimensioned axial Vec3, referencePointMeters: fixed puddle balance point }, applicationInterval: runoff-application-interval, footprint: same physical boundary support/reference point, signConvention: positive-source-to-receiver, partitionMembership: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), reactionGroupId: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), reactionToInteractionIds: [] }
    canonicalInteractionExpansion: both records carry every remaining canonical InteractionRecord identity/owner/state/frame/origin/exact-once/conservation/validity/error/provenance field; explicit payload arms use exact ABI keys
    reactions: []
    physicalImpactParents: []
    physicalImpactPartitions: []
    reactionGroups: []
    conservationGroups: [precipitation-water-and-momentum]
    stabilityGate: retained plus infiltrated plus evaporated plus runoff mass closes the receiver balance
    convergence: not-applicable
    couplingLoopId: TypedAbsence(not-applicable, record authority, record interval, sketch provenance)
    batchLedger: { type: InteractionBatchLedger, batchId: runoff-to-puddle-batch, exchangeId: runoff-to-puddle, producerId: rain receiver reducer, publishedSequenceRange: closed monotonic range, perConsumerCursor: per-consumer next sequence, acceptedRejectedLateDuplicate: typed labelled counts, overflowPolicy: reject-batch, overflowSequenceRanges: explicit ranges, lostCommodities: typed mass/momentum commodity map, deferredCommodities: typed mass/momentum commodity map, applicationLedgerIds: exact InteractionApplicationLedger IDs whose dispositions cover publishedSequenceRange, exactOnceApplicationLedgerVersion: opaque version }
    sourceStateUpdate: the receiver reducer removes the emitted mass/momentum in the same committed conservation group; no duplicate reaction record is required
  - exchangeId: impact-to-puddle
    type: SurfaceExchange
    contextId: physicsContext.contextId
    applicationInterval: impact-application-interval (nonempty PhysicsTimeInterval on precipitation-clock)
    physicsFrameId: physicsContext.physicsRootFrameId
    physicsOriginEpoch: physicsContext.physicsOriginEpoch
    transformRevision: physicsContext.worldTransformRevision
    mode: one-way
    producer: $threejs-rain-snow-and-wet-surfaces impact reducer
    consumers: [$threejs-water-optics puddle source reducer, $threejs-visual-validation]
    participants: [rain impact reducer, $threejs-water-optics]
    sourceDescriptors: [precipitation-to-receiver/precipitation-momentum-flux-parent committed record and content digest, puddleWater, streetSupport]
    interactions:
      - { interactionId: impact-area-momentum-transfer, role: source, targetStateEquation: puddle momentum balance, payload: { tag: momentumTransfer, timeSemantics: interval-integrated, linearMomentumNs: puddle-impact partition Vec3, angularMomentumNms: puddle-impact axial Vec3 about named point, referencePointMeters: fixed puddle balance point }, applicationInterval: impact-application-interval, footprint: extensive-distributed puddle-area footprint with inverse-square-meter kernel, normalizationTarget unity, normalizationIntegral 1, physical m2 quadrature, represented area, Jacobians, and moment error, signConvention: positive-source-to-receiver, partitionMembership: { type: InteractionPartitionMembership, parentExchangeId: precipitation-to-receiver, parentInteractionIds: [precipitation-momentum-flux-parent], partitionGroupId: rainy-city-precipitation-momentum-partitions, partitionId: puddle-impact-momentum, partitionMeasure: represented puddle-impact area in m2, closureGroupId: precipitation-water-and-momentum }, reactionGroupId: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), reactionToInteractionIds: [] }
    canonicalInteractionExpansion: the impact record carries every remaining canonical InteractionRecord identity/owner/state/frame/origin/exact-once/conservation/validity/error/provenance field; parent and membership IDs resolve to the PhysicalImpactParentRecord/PhysicalImpactPartitionRecord above
    reactions: []
    physicalImpactParents: []
    physicalImpactPartitions: []
    reactionGroups: []
    conservationGroups: [precipitation-water-and-momentum]
    stabilityGate: impact impulse is a disjoint partition of precipitation-momentum-flux and never reapplies mass
    convergence: not-applicable
    couplingLoopId: TypedAbsence(not-applicable, record authority, record interval, sketch provenance)
    batchLedger: { type: InteractionBatchLedger, batchId: impact-to-puddle-batch, exchangeId: impact-to-puddle, producerId: rain impact reducer, publishedSequenceRange: closed monotonic range, perConsumerCursor: per-consumer next sequence, acceptedRejectedLateDuplicate: typed labelled counts, overflowPolicy: reject-batch, overflowSequenceRanges: explicit ranges, lostCommodities: typed momentum commodity map, deferredCommodities: typed momentum commodity map, applicationLedgerIds: exact InteractionApplicationLedger IDs whose dispositions cover publishedSequenceRange, exactOnceApplicationLedgerVersion: opaque version }
    sourceStateUpdate: the receiver/precipitation partition removes this impulse from its parent momentum inventory before puddle application
physicsCoordinationAdvanceRecords:
  canonicalExpansion: required before emitted-manifest validation
  records: exact PhysicsCoordinationAdvanceRecord records keyed by coordinationAdvanceId, each closing stage executions, dependency completions, state-advance claims, application ledgers, commit receipt, debt arithmetic, and status for one coordination interval
physicsInteractionApplicationLedgers:
  canonicalExpansion: required before emitted-manifest validation
  records: exact InteractionApplicationLedger records for every prepared/committed/deferred/rejected/duplicate interaction disposition; [] only when physicsInteractions is []
physicsCommitTransactions:
  canonicalExpansion: required before emitted-manifest validation
  records: exact PhysicsCommitTransaction records keyed by every commitGroup.commitTransactionId with prepared-publication bijection, gate results, one commit instant, receipt, and rollback disposition
physicsQualityRequests:
  canonicalExpansion: required before emitted-manifest validation
  records: exact QualityChangeRequest records keyed by requestId; each transition requestId/requestSequence/scope/controls/evidence digest resolves one immutable request and its admission
physicsQualityStates:
  canonicalExpansion: required before emitted-manifest validation
  records: exact PhysicsQualityStateDescriptor records keyed by qualityStateId for every active, source, and destination state referenced by a request, admission, transition, conservative map, or cost ledger
physicsQualityTransitions:
  canonicalExpansion: required before emitted-manifest validation
  records: exact QualityTransition records for every admitted QualityChangeRequest; [] only when no quality transition is admitted in the covered interval
physicsPresentationTimeCohortsById:
  rainy-city-street-cohort: { type: PresentationTimeCohort, timeCohortId: rainy-city-street-cohort, presentationClockId: presentation-clock, presentationOpportunitySequence: exact monotonic integer, previousRequestedPresentationInstant: exact previous presentation PhysicsInstant, currentRequestedPresentationInstant: exact current presentation PhysicsInstant, requestedPresentationInstant: same current PhysicsInstant, requiredContextIds: [physicsContext.contextId], requiredDiscontinuityEpochs: { physicsContext.contextId: exact rainy-city discontinuity epoch }, maximumInterContextSkew: zero for one context, maximumCandidateAge: Gated PhysicsDuration, admissionPolicy: bounded-mapped-skew, cohortSpecificationDigest: canonical cohort specification digest }
physicsPresentationCandidate:
  type: PhysicsPresentationCandidate
  producer: route physics coordinator
  consumers: [street-view camera owner, route presentation assembler]
  candidateId: runtime-id
  contextId: physicsContext.contextId
  presentationEpoch: exact route presentation epoch
  timeCohortId: rainy-city-street-cohort
  requestedPresentationInstant: physicsPresentationTimeCohortsById.rainy-city-street-cohort.currentRequestedPresentationInstant
  physicsOriginEpoch: physicsContext.physicsOriginEpoch
  commitProvenance: exact CandidateCommitProvenance resolving precipitation/receiver/puddle/range versions to rainy-city commit receipt IDs/digests
  candidateScope: committed-state-brackets-leases-and-events
  contents: requestedPresentationInstant plus committed forcing/receiver/puddle/precipitation per-binding/provider PresentedStatePair entries with independent previous/current provenance, physics-qualified immutable state handles, exact resource leases, and eventSequenceRanges; contains no camera, render origin, view/projection matrix, shadow/cache epoch, or global-to-render transform
  presentedStatePairs: canonicalExpansion(required complete per-binding PresentedStatePair records)
  resourceLeases: canonicalExpansion(required complete Candidate-scoped PresentationResourceLease records)
  eventSequenceRanges: canonicalExpansion(required complete PresentationEventRange records)
  qualityMigration: a prepared QualityTransition commits at commitInstant (PhysicsInstant) through its own all-or-none commit group with conservative map/reset, interaction/source-queue boundary, mass/momentum residual gates, atomic versions, ConsumerCompletionJoin retirement, scoped resets, and rollback before candidate publication
physicsCameraViewPublicationsByTarget:
  main/street-view: { type: CameraViewPublication, cameraPublicationId: runtime-id, candidateId: physicsPresentationCandidate.candidateId, owner: street-view camera owner, presentationTargetId: main, viewId: street-view, cameraId: street-camera, contents: previous/current PhysicsInstant, source-qualified previous/current RenderSimilarityTransform, unjittered view/projection matrices, jitter convention, viewport/DPR/extent, depth convention, projection validity/error }
physicsViewPreparationPublicationsByTarget:
  main/street-view: { type: ViewPreparationPublication, viewPreparationId: runtime-id, candidateId: physicsPresentationCandidate.candidateId, cameraPublicationId: physicsCameraViewPublicationsByTarget["main/street-view"].cameraPublicationId, presentationTargetId: main, viewId: street-view, resourceLeases: full PresentationResourceLease records for newly created camera-dependent resources, resourceLeaseRefs: exact Candidate and same-preparation refs, contents: visibility/acceleration/shadow/cache refs, reactive publications, reset DAG, exact PresentationResourceLeaseRefs }
physicsPresentationSnapshotsByTarget:
  main/street-view: { type: PhysicsPresentationSnapshot, snapshotId: runtime-id, candidateId: physicsPresentationCandidate.candidateId, cameraPublicationId: physicsCameraViewPublicationsByTarget["main/street-view"].cameraPublicationId, viewPreparationId: physicsViewPreparationPublicationsByTarget["main/street-view"].viewPreparationId, presentationTargetId: main, viewId: street-view, presentedStatePairRefs: candidate binding IDs, resourceLeaseRefs: exact transitive refs, eventSequenceRanges: candidate ranges, closureManifest: { type: PresentationClosureManifest, snapshotId: same runtime-id, pairStateHandleLeaseIds: exact forcing/receiver/puddle/precipitation pair-state lease IDs, preparationDependencyLeaseIds: exact street-view preparation dependency lease IDs, reactiveAndResetLeaseIds: exact precipitation/puddle reactive and reset lease IDs, shadowCacheVisibilityLeaseIds: exact street-view shadow/cache/visibility lease IDs, exactRequiredLeaseIds: canonical sorted union of all preceding lease IDs and no others, exactEventRangeIds: canonical sorted exact street-view event range IDs, dependencyDagDigest: collision-resistant digest of canonical dependency DAG, closureDigest: collision-resistant digest of canonical IDs and edges }, sealVersion: runtime-version, consumers: [street-view scene/water/precipitation passes, $threejs-visual-validation] }
physicsPresentationRenderPlansByTarget:
  main/street-view: { type: PresentationRenderPlan, renderPlanId: rainy-city-street-view-render-plan, timeCohortId: rainy-city-street-cohort, candidateId: physicsPresentationCandidate.candidateId, snapshotId: physicsPresentationSnapshotsByTarget["main/street-view"].snapshotId, presentationTargetId: main, viewId: street-view, phaseIds: exact opaque/precipitation/puddle-composite/present IDs, phaseRecords: complete RenderPlanPhase records using the performance pass keys, edges: complete RenderPlanEdge DAG with dependency completions/resource generations, requiredPreparationEdgeIds: exact street-view preparation edge IDs, renderResourceLeaseIds: exact street-view render lease IDs, plannedResetActionIds: exact reset IDs, expectedResetHistoryGenerations: exact per-action generation map, shadowFactorIds: exact once-applied shadow factor IDs, closureDigest: canonical plan closure digest, immutablePlanDigest: canonical immutable plan digest }
frameExecutionRecord:
  type: FrameExecutionRecord
  producer: $threejs-image-pipeline frame executor
  consumers: [$threejs-visual-validation, performance evidence]
  executionId: unique append-only presentation execution
  timeCohortId: rainy-city-street-cohort
  candidateIds: [physicsPresentationCandidate.candidateId]
  cohortAdmission: exact admitted FrameCohortAdmission
  renderPlans: [physicsPresentationRenderPlansByTarget["main/street-view"]]
  slotAdmissions: [exact admitted main/street-view FrameSlotAdmission]
  requiredTargetViewKeys: [main/street-view]
  snapshotIds: [physicsPresentationSnapshotsByTarget["main/street-view"].snapshotId]
  overallStatus: submitted | completed | partial-failure | aborted | device-lost
  backendGeneration: exact backend generation
  deviceLossGeneration: exact device-loss generation
  targetExecutions:
    main/street-view: { snapshotId: physicsPresentationSnapshotsByTarget["main/street-view"].snapshotId, renderPlanId: exact admitted street-view render plan ID, slotAdmissionId: exact admitted main/street-view slot ID, presentationTargetId: main, viewId: street-view, status: submitted | completed | failed | aborted | device-lost, submittedPasses: exact pass/dispatch keys, queueSubmissionEpochs: ordered epochs, actionResults: typed results, resetActionResults: exact planned reset results, completionTokens: exact tokens, presentedTimestamp: mapped presentation-clock PhysicsInstant or TypedAbsence(not-applicable, record authority, record interval, sketch provenance), failure: typed failure or TypedAbsence(not-applicable, record authority, record interval, sketch provenance) }
  leaseDispositionById:
    lease-id: { disposition: retained-until-join | retired-after-abort | invalidated-by-device-loss, consumingSnapshotIds: [physicsPresentationSnapshotsByTarget["main/street-view"].snapshotId], completionJoin: { simulationConsumers: [typed tokens], couplingConsumers: [], externalConsumers: [], presentationConsumers: [typed tokens], deviceLossRetirementPath: typed rule }, retirementEvidence: typed completion-or-loss record }
  immutability: completion never mutates candidate, camera publication, view-preparation publication, or snapshot
physicsPresentationSnapshot: not used # deprecated compatibility projection; never allocated
outputOwnersByPresentationTarget:
  main: { toneMap: $threejs-image-pipeline, outputTransform: $threejs-image-pipeline, adaptiveQuality: $threejs-image-pipeline }
sharedResourceOwners:
  gbuffer: not used
  depth: $threejs-image-pipeline
  normal: not used
  velocity: not used
  history: not used
  weatherEnvelope: project environment forcing coordinator
  toneMap: $threejs-image-pipeline
  outputTransform: $threejs-image-pipeline
  adaptiveResolution: $threejs-image-pipeline
coverageStatus: partial
coverageBlockers: the project must supply the environment-forcing coordinator, street drainage/outflow boundary policy, and validated surface physics materials; the selected skills own precipitation, receiver wetness, puddle dynamics/optics, and their typed exchanges once those inputs exist
performanceContract:
  routeStatus: provisional
  skillTierCrosswalk: { status: required-before-acceptance, rule: map every selected skill local tier explicitly to route Full/Budgeted/Minimum viable with protected invariants and explicit unsupported-tier mappings; no implicit name equality }
  frameInterval: { value: "", unit: ms, label: Derived, source: "1000 ms / [Gated] frozen target refresh" }
  passKeys: [physics.ingest, physics.sample-forcing, precipitation.predict, precipitation.emit-parent-and-partitions, receiver.update, receiver.publish-runoff, puddle.apply-runoff-and-impact, puddle.update, physics.reduce-exchange-ledgers, physics.correct, physics.commit, physics.publish-candidate, street-view.camera-publication, street-view.prepare, street-view.opaque-scene, street-view.precipitation, street-view.puddle-water-composite, street-view.seal, main.present]
  accounting: deduplicated scene/depth pass plus measured precipitation and water marginals
  mobileGate: compact bounded SoA exchanges, sparse active precipitation/receiver/puddle regions, integer cadence changes with integrated catch-up/error, zero steady-frame readback, and complete queue/provider/presentation/migration memory ledgers
  qualityAdaptation: preserve weather coupling; reduce the measured pressure source, not a fixed cinematic order
acceptanceEvidence:
  requiredDebugViews: [PhysicsContext/graph stages and versions, forcing version/age/filter, support/material IDs, precipitation exchanges, wetness owner/state, runoff partition, impact occupancy, candidate/camera/view-preparation/snapshot versions, puddle thickness, ripple normal, no-post]
  requiredMetrics: ["p50/p95 [Measured] composed timing", precipitation/receiver/puddle mass residual, impact momentum residual, exactly-once delivery, exchange-owned ledgers with typed lost/deferred commodities, provider error/staleness, candidate/camera/view-preparation/snapshot immutability, quality-transition rollback, temporal continuity, attachment bytes]
  requiredCommands: [installed-source API assertions, project validation/capture command]
  requiredArtifacts: [fixed street captures, PhysicsGraph/exchange/conservation/candidate/camera/view-preparation/snapshot/execution records, pass ledger, mobile sustained trace]
```

This manifest omits cloud volumes, so no cloud precipitation channel exists.
A separately selected causal-cloud route publishes a typed
`PrecipitationEmissionSnapshot[n]`; the environment/rain coordinator consumes
it no earlier than forcing epoch `n+1`, with declared transport delay and
airborne/receiver inventory closure. A cloud that is appearance-only emits no
physical precipitation, and no cloud may mutate the same
`EnvironmentForcingSnapshot[n]` that it consumed.

## forest flythrough

Input brief: dense procedural vegetation, terrain masks, a shared atmospheric
wind source, sparse trampling/contact, free camera movement, and temporally
stable foliage response.

minimal skill set:

```text
backendManifest: "populate required [Gated] and observed [Measured] fields from canonical preflight"
workloadProfile:
  domain: other
  intent: inspect
  truthContract: perceptual-style
  representation: procedural-mesh
  interaction: free-navigation
  temporal: simulation
  scale: city-terrain
  topology: repeated
  deployment: "brief-defined desktop/mobile WebGPU matrix"
causeLedger:
  sourceOfTruth: species grammar, terrain field, one project EnvironmentForcingSnapshot source, and typed trampling events
  primaryObservable: rooted species silhouettes with coherent environment-driven wind and deterministic local contact response from overview to close inspection
  earliestMissingLayer: geometry
  selectedAlgorithm: chunked vegetation LOD and compatible instancing/batching; the environment owner supplies atmospheric wind while vegetation owns rooted deformation, recovery state, and trampling response
  rejectedAlgorithms:
    - monolithic merged forest: destroys culling and species/selection granularity
    - screen-space sway: cannot preserve roots, depth, or cast-shadow motion
  noPostBaseline: roots, canopies, LOD transitions, and wind read without AO/post
selectedSkills:
  - $threejs-procedural-vegetation
  - $threejs-procedural-fields
  - $threejs-camera-controls-and-rigs
  - $threejs-image-pipeline
  - $threejs-visual-validation
primaryOwner: $threejs-procedural-vegetation
deferredSkills:
  - $threejs-scalable-real-time-shadows
  - $threejs-ambient-contact-shading
omittedSkills:
  - $threejs-procedural-geometry: vegetation owns the biological mesh grammar
  - $threejs-bloom: no HDR emission source
owners:
  sourceOfTruth: species/terrain inputs plus project environment and contact coordinators
  representation: $threejs-procedural-vegetation
  spatialFrame: $threejs-camera-controls-and-rigs
  timebase: route physics coordinator executing the PhysicsGraph
  semanticIds: vegetation chunk/species owner
  selectionPicking: project interaction layer
  clipSection: not used
  presentation: $threejs-image-pipeline
  validation: $threejs-visual-validation
requiredSignals:
  sceneColorRegistry:
    navigation-view: { producer: shared scene pass, consumers: [presentation] }
  depthRegistry: not used by a selected post consumer
  normalRegistry: not used by a selected post consumer
  velocityRegistry: not used until temporal reconstruction is selected and wind velocity is valid
  objectIdRegistry: not used unless picking/outline is requested
  historyRegistry: not used
domainSignals:
  terrainBiomeField: { physicsSignal: terrainSupport, consumers: [vegetation distribution and support] }
  atmosphericWind: { physicsSignal: environmentForcing, consumers: [vegetation rooted-response solver] }
  vegetationResponse: { physicsSignal: vegetationResponse, consumers: [vegetation geometry, validation] }
physicsContext:
  type: PhysicsContext
  producer: route physics coordinator
  consumers: [project environment forcing coordinator, project contact adapter, $threejs-procedural-fields, $threejs-procedural-vegetation, $threejs-camera-controls-and-rigs, $threejs-image-pipeline, $threejs-visual-validation]
  invariant: one finite positive metersPerWorldUnit is the sole world-to-physics scale boundary; provider state remains SI in a stable right-handed physics frame; typed gravity; floating-origin epoch; generation-bearing entity/material IDs; time origin across terrain, contacts, vegetation, and rendering
physicsGraph:
  type: PhysicsGraph
  producer: route physics coordinator
  coordinationInterval: nonempty PhysicsTimeInterval on forest-coordination-clock
  clocks:
    forestCoordinationClock: { type: PhysicsClockDescriptor, clockId: forest-coordination-clock, owner: route physics coordinator, mappingKind: fixed-rational, mappingRevision: forest-clock-map-v1, discontinuityEpoch: forest-clock-continuity-v1, coordinationClockMap: identity-with-zero-error }
    forcingClock: { type: PhysicsClockDescriptor, clockId: forcing-clock, owner: project environment forcing coordinator, mappingKind: external, mappingRevision: forcing-clock-map-v1, discontinuityEpoch: forcing-clock-continuity-v1, coordinationClockMap: versioned bounded-error map to forest-coordination-clock }
    vegetationClock: { type: PhysicsClockDescriptor, clockId: vegetation-clock, owner: $threejs-procedural-vegetation, mappingKind: piecewise-versioned, mappingRevision: vegetation-clock-map-v1, discontinuityEpoch: forest-clock-continuity-v1, coordinationClockMap: versioned subinterval map selected by the deformation/recovery gate }
    contactClock: { type: PhysicsClockDescriptor, clockId: contact-clock, owner: project contact adapter, mappingKind: timestamp-table, mappingRevision: contact-clock-map-v1, discontinuityEpoch: forest-clock-continuity-v1, coordinationClockMap: deterministic interval/event map with bounded timestamp error }
    presentationClock: { type: PhysicsClockDescriptor, clockId: presentation-clock, owner: route presentation scheduler, mappingKind: external, mappingRevision: presentation-clock-map-v1, discontinuityEpoch: presentation-clock-continuity-v1, coordinationClockMap: versioned bounded-error map to forest-coordination-clock }
  stages:
    - ingest: latch PhysicsContext, terrainSupport, species state, PhysicsMaterialRegistry, forcing input, and the ordered trampling interval
    - sample-forcing: latch one committed EnvironmentForcingSnapshot at a mapped PhysicsInstant and sample atmospheric wind at plant anchors
    - predict: write provisional rooted wind/load predictors from committed vegetation state over mapped PhysicsTimeIntervals
    - emit-interactions: publish trampling-exchange exactly once per accepted contact interval with stable IDs and integrated impulse; its exchange-owned ledger records every disposition
    - solve-subcycles: write provisional vegetation deformation/recovery state after wind loads and accepted trampling contacts
    - reduce-reactions: accumulate the declared one-way contact work/residual; no equal-and-opposite body reaction is claimed by this route
    - correct: re-enforce root constraints, finite provisional deformation, strain/bend gates, support validity, and exact-once contact cursors
    - commit: publish accepted vegetation response and consumed interaction sequence ranges only through forest-state-commit-group
    - publish-presentation: publish the camera-free candidate from committed versions; camera, view preparation, and sealing follow as immutable per-view publications
  loopMacros: []
  commitGroups:
    - { commitGroupId: forest-state-commit-group, owner: route physics coordinator, interval: coordinationInterval, provisionalVersions: [vegetationResponse.provisional, tramplingInteractionRanges.provisional], committedPublications: [vegetationResponse.committed, tramplingInteractionRanges.committed], stateEquationOwners: { vegetation-deformation-and-recovery: $threejs-procedural-vegetation, interaction-sequence-publication: project contact adapter }, conservationAndErrorGates: [root-constraint, finite-deformation, strain-bend, support-validity, exact-once-cursors, one-way-work-residual], preparedPublications: canonicalExpansion(required complete PhysicsPreparedPublication records for every provisional-to-committed publication), commitTransactionId: forest-state-commit-transaction, atomicity: all-or-none, failureDisposition: preserve-prior-commit }
  originRebaseTransactions: [] # populate with canonical accepted transactions when a physics-origin rebase is scheduled
  publicationRule: forcing/support are immutable committed inputs; vegetation and event-range writes remain provisional until the commit group accepts both
  executionLedger: { type: PhysicsExecutionLedger, ledgerId: route-interval-execution-ledger-id, graphId: route PhysicsGraph ID, graphRevision: exact graph revision, coordinationInterval: graph coordinationInterval, coordinationAdvanceId: exact current coordination advance ID, stageExecutions: complete PhysicsStageExecution rows with exact intervals/subcycles/version claims, dependencyCompletions: exact PhysicsDependencyCompletion refs, stateAdvanceClaims: one accepted state-advance claim or explicit state-hold per owned equation and coordination interval, interactionApplicationLedgers: exact accepted InteractionApplicationLedger refs or [], loopResults: bounded-loop iterations/residuals/accepted iterate, commitReceipts: exact successful PhysicsCommitReceipt refs or [], catchUpDebtBeforeAfter: typed duration pair, discontinuityEpoch: graph epoch, physicsCostLedgerId: route-specific-runtime-physics-cost-ledger-id }
physicsErrorPropagationLedgers:
  inventory: { vegetationResponse: forest-vegetation-response-error-ledger, trampling-exchange: forest-trampling-error-ledger }
  records:
    forest-vegetation-response-error-ledger: { type: ErrorPropagationLedger, ledgerId: forest-vegetation-response-error-ledger, contextId: physicsContext.contextId, outputSignalOrInteractionId: vegetationResponse, outputStateVersion: vegetationResponse.provisional, evaluationInterval: physicsGraph.coordinationInterval, inputErrors: [forcing wind/density/filter/time errors, terrain support error, species/proxy error, prior vegetation response error, forest-trampling-output-error], transformsFiltersInterpolations: [clock maps, anchor/support sampling, aerodynamic loading, rooted deformation/recovery integrator], correlationAssumptions: [shared forcing samples retain covariance and trampling/support errors are bounded-adversarial], operatorOrGainBounds: [drag, root, strain, bend, damping, substep bounds], modeledApproximationTerms: [reduced branch/canopy and LOD response errors], numericalTerms: [constraint/substep/reduction residuals], combinationRule: versioned covariance-plus-operator-bound rule, outputError: forest-vegetation-response-output-error, acceptanceGate: root/support/deformation/presentation tolerances, provenance: vegetation owner/build/species/forcing/contact revisions }
    forest-trampling-error-ledger: { type: ErrorPropagationLedger, ledgerId: forest-trampling-error-ledger, contextId: physicsContext.contextId, outputSignalOrInteractionId: trampling-exchange, outputStateVersion: tramplingInteractionRanges.provisional, evaluationInterval: trampling-application-interval, inputErrors: [contact point/normal/timestamp/impulse errors, terrain support/material errors], transformsFiltersInterpolations: [contact clock map, frame transform, stable-feature lookup], correlationAssumptions: [contact geometry and impulse errors retain adapter covariance], operatorOrGainBounds: [frame/time conversion and application bounds], modeledApproximationTerms: [externally prescribed actor/no-feedback error], numericalTerms: [exact-once/reduction residual], combinationRule: versioned correlated operator-bound rule, outputError: forest-trampling-output-error, acceptanceGate: contact support/impulse/work and vegetation consumer tolerances, provenance: contact adapter/build/material/clock revisions }
physicsCostLedger:
  type: PhysicsCostLedger
  ledgerId: route-specific-runtime-physics-cost-ledger-id
  status: active
  targetAndHarness: named physical target, forest path/seed, route tier, viewport, DPR, and sustained protocol
  qualityState: route Full/Budgeted/Minimum viable plus performanceContract.skillTierCrosswalk
  cadenceTraceTotals: { type: CadenceTraceTotals, traceTotalsId: forest-cadence-trace-totals, traceRef: content-addressed sustained route trace/protocol, measurementInterval: exact measured PhysicsTimeInterval, exactDuration: duration derived from registered measurement clock, coordinationAdvanceCount: exact count, catchUpBatchCount: exact count, stageExecutionCounts: exact PhysicsGraphStageId-to-count map, nativeSubcycleCounts: exact owner-to-count map, couplingIterationCounts: empty exact map, interactionApplicationCounts: exact payload-tag-to-count map, presentedFrameCounts: exact target-view-to-count map, workOccurrenceCounts: exact PhysicsWorkKey-to-count map, trafficOccurrenceAndLogicalByteTotals: exact TrafficRecordId-to-count/byte map, droppedCoordinationIntervals: exact intervals or empty, exactTotalsDigest: canonical trace totals digest }
  graphStageCosts: [forcing sampling, contact reduction, vegetation deformation/recovery, commit/publication router cost records]
  coordinationIntervalsPerSecond: labelled distribution on forest-coordination-clock
  stageExecutionsPerCoordinationInterval: labelled counts by stage
  stageExecutionsPerSecond: labelled counts through registered clock maps
  coordinationIntervalsPerPresentedFrame: labelled distribution through presentation-clock-map-v1
  subcyclesAndCouplingIterationsPerPresentedFrame: labelled vegetation subcycles; coupling explicitly not used
  executionsPerPresentedFrame: labelled stage counts
  worstPermittedCatchUpBurst: { triggerAndIntervalDebt: graph catch-up/discontinuity policy, executionsDispatchesAndTraffic: labelled vegetation/contact records, latencyMemoryAndErrorGate: typed gates }
  hotBytesReadWrittenPerExecution: labelled forcing/support/vegetation/exchange bytes
  solverDispatches: [vegetation active-chunk extent/workgroup/cadence/timing records]
  queueSubmissionsAndPassBreaks: labelled counts
  dependencyCriticalPaths: [forcing/contact to vegetation commit to candidate to view preparation]
  tileGpuTraffic: { attachmentStoreLoadResolveBytes: labelled records, tileSpillEvidence: measured-or-TypedAbsence(not-measured, evidence owner, measurement interval, harness provenance), renderComputePassBreaks: labelled counts }
  bindingAndDeviceLimits: [limit-demand-headroom-and-gate]
  cpuWork: [chunk/contact scheduling, candidate/per-view assembly]
  allocationGcAndCompilation: [cadence-latency-and-byte-record]
  uploadsCopiesMaps: [TrafficRecord]
  hostCompletionsReadbacksPerPresentedFrame: labelled zero-or-failure record
  synchronization: [wait-or-stall-record]
  multiviewAndFramesInFlightMultipliers: labelled view/lease/resource records
  hotState: PhysicsMemoryLedger
  peakTransient: PhysicsMemoryLedger
  migrationOverlap: PhysicsMemoryLedger
  thermalPowerState: measured-or-TypedAbsence(not-measured, evidence owner, measurement interval, harness provenance)
physicsSignals:
  environmentForcing: { type: PhysicsSignalDescriptor<EnvironmentForcingSnapshot>, producer: project environment forcing coordinator, consumers: [$threejs-procedural-vegetation, $threejs-visual-validation], channels: material air velocity and density plus temperature/pressure/humidity needed by the selected structural law, all with requested/actual oriented footprint/filter, per-channel validity/error, and staleness }
  terrainSupport: { type: PhysicsSignalDescriptor<SupportSurfaceSample>, producer: $threejs-procedural-fields support adapter, consumers: [$threejs-procedural-vegetation placement/response solver, project contact adapter, $threejs-visual-validation] }
  vegetationResponse: { type: PhysicsSignalDescriptor<DeformingSupportProxy>, producer: $threejs-procedural-vegetation, consumers: [vegetation geometry, shadow/cache preparation, $threejs-visual-validation] }
  qualityChangeRequest: { type: PhysicsSignalDescriptor<QualityChangeRequest>, producer: $threejs-image-pipeline quality governor, consumers: [route physics coordinator] }
  qualityTransition: { type: PhysicsSignalDescriptor<QualityTransition>, producer: route physics coordinator, consumers: [$threejs-procedural-vegetation, $threejs-image-pipeline, $threejs-visual-validation] }
physicsInteractions:
  - exchangeId: trampling-exchange
    type: SurfaceExchange
    contextId: physicsContext.contextId
    applicationInterval: trampling-application-interval (nonempty PhysicsTimeInterval on contact-clock)
    physicsFrameId: physicsContext.physicsRootFrameId
    physicsOriginEpoch: physicsContext.physicsOriginEpoch
    transformRevision: physicsContext.worldTransformRevision
    mode: one-way
    producer: project contact adapter
    consumers: [$threejs-procedural-vegetation contact reducer, $threejs-visual-validation]
    participants: [externally prescribed contact actor, $threejs-procedural-vegetation]
    sourceDescriptors: [terrainSupport]
    materialRegistry: PhysicsContext.physicsMaterialRegistry
    interactions:
      - { interactionId: trampling-point-impulse, role: source, targetStateEquation: vegetation deformation/recovery impulse term, payload: { tag: pointImpulse, timeSemantics: interval-integrated, linearImpulseNs: dimensioned contact impulse Vec3, applicationPointMeters: dimensioned contact point Vec3 }, applicationInterval: trampling-application-interval, footprint: exact point footprint with represented measure one, support normal, reference point, and positional error, signConvention: positive-source-to-receiver, partitionMembership: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), reactionGroupId: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), reactionToInteractionIds: [] }
    canonicalInteractionExpansion: the record carries every remaining canonical InteractionRecord identity/owner/state/frame/origin/exact-once/conservation/validity/error/provenance field; the explicit pointImpulse arm uses exact ABI keys
    reactions: []
    physicalImpactParents: []
    physicalImpactPartitions: []
    reactionGroups: []
    conservationGroups: [trampling-external-work]
    stabilityGate: accepted strain/bend/root error and declared upper bound on omitted actor feedback
    convergence: not-applicable
    couplingLoopId: TypedAbsence(not-applicable, record authority, record interval, sketch provenance)
    batchLedger: { type: InteractionBatchLedger, batchId: trampling-batch, exchangeId: trampling-exchange, producerId: project contact adapter, publishedSequenceRange: closed monotonic range, perConsumerCursor: per-consumer next sequence, acceptedRejectedLateDuplicate: typed labelled counts, overflowPolicy: reject-batch, overflowSequenceRanges: explicit ranges, lostCommodities: typed impulse/work commodity map, deferredCommodities: typed impulse/work commodity map, applicationLedgerIds: exact InteractionApplicationLedger IDs whose dispositions cover publishedSequenceRange, exactOnceApplicationLedgerVersion: opaque version }
    omittedFeedback: report the Gated actor-trajectory/energy error from ignoring plant reaction or classify the trampling source as externally prescribed
physicsCoordinationAdvanceRecords:
  canonicalExpansion: required before emitted-manifest validation
  records: exact PhysicsCoordinationAdvanceRecord records keyed by coordinationAdvanceId, each closing stage executions, dependency completions, state-advance claims, application ledgers, commit receipt, debt arithmetic, and status for one coordination interval
physicsInteractionApplicationLedgers:
  canonicalExpansion: required before emitted-manifest validation
  records: exact InteractionApplicationLedger records for every prepared/committed/deferred/rejected/duplicate interaction disposition; [] only when physicsInteractions is []
physicsCommitTransactions:
  canonicalExpansion: required before emitted-manifest validation
  records: exact PhysicsCommitTransaction records keyed by every commitGroup.commitTransactionId with prepared-publication bijection, gate results, one commit instant, receipt, and rollback disposition
physicsQualityRequests:
  canonicalExpansion: required before emitted-manifest validation
  records: exact QualityChangeRequest records keyed by requestId; each transition requestId/requestSequence/scope/controls/evidence digest resolves one immutable request and its admission
physicsQualityStates:
  canonicalExpansion: required before emitted-manifest validation
  records: exact PhysicsQualityStateDescriptor records keyed by qualityStateId for every active, source, and destination state referenced by a request, admission, transition, conservative map, or cost ledger
physicsQualityTransitions:
  canonicalExpansion: required before emitted-manifest validation
  records: exact QualityTransition records for every admitted QualityChangeRequest; [] only when no quality transition is admitted in the covered interval
physicsPresentationTimeCohortsById:
  forest-navigation-cohort: { type: PresentationTimeCohort, timeCohortId: forest-navigation-cohort, presentationClockId: presentation-clock, presentationOpportunitySequence: exact monotonic integer, previousRequestedPresentationInstant: exact previous presentation PhysicsInstant, currentRequestedPresentationInstant: exact current presentation PhysicsInstant, requestedPresentationInstant: same current PhysicsInstant, requiredContextIds: [physicsContext.contextId], requiredDiscontinuityEpochs: { physicsContext.contextId: exact forest discontinuity epoch }, maximumInterContextSkew: zero for one context, maximumCandidateAge: Gated PhysicsDuration, admissionPolicy: bounded-mapped-skew, cohortSpecificationDigest: canonical cohort specification digest }
physicsPresentationCandidate:
  type: PhysicsPresentationCandidate
  producer: route physics coordinator
  consumers: [navigation-view camera owner, route presentation assembler]
  candidateId: runtime-id
  contextId: physicsContext.contextId
  presentationEpoch: exact route presentation epoch
  timeCohortId: forest-navigation-cohort
  requestedPresentationInstant: physicsPresentationTimeCohortsById.forest-navigation-cohort.currentRequestedPresentationInstant
  physicsOriginEpoch: physicsContext.physicsOriginEpoch
  commitProvenance: exact CandidateCommitProvenance resolving forcing/support/vegetation/range versions to their committed receipts/digests
  candidateScope: committed-state-brackets-leases-and-events
  contents: requestedPresentationInstant plus committed forcing/support/vegetation per-binding/provider PresentedStatePair entries with independent previous/current provenance, physics-qualified immutable state handles, exact resource leases, and eventSequenceRanges; contains no camera, render origin, view/projection matrix, shadow/cache epoch, or global-to-render transform
  presentedStatePairs: canonicalExpansion(required complete per-binding PresentedStatePair records)
  resourceLeases: canonicalExpansion(required complete Candidate-scoped PresentationResourceLease records)
  eventSequenceRanges: canonicalExpansion(required complete PresentationEventRange records)
  qualityMigration: a prepared QualityTransition commits at commitInstant (PhysicsInstant) through its own all-or-none commit group with projection/reset map, interaction-queue boundary, energy/error residuals, atomic versions, ConsumerCompletionJoin retirement, scoped invalidations, and rollback before candidate publication
physicsCameraViewPublicationsByTarget:
  main/navigation-view: { type: CameraViewPublication, cameraPublicationId: runtime-id, candidateId: physicsPresentationCandidate.candidateId, owner: navigation-view camera owner, presentationTargetId: main, viewId: navigation-view, cameraId: navigation-camera, contents: previous/current PhysicsInstant, source-qualified previous/current RenderSimilarityTransform, unjittered view/projection matrices, jitter convention, viewport/DPR/extent, depth convention, projection validity/error }
physicsViewPreparationPublicationsByTarget:
  main/navigation-view: { type: ViewPreparationPublication, viewPreparationId: runtime-id, candidateId: physicsPresentationCandidate.candidateId, cameraPublicationId: physicsCameraViewPublicationsByTarget["main/navigation-view"].cameraPublicationId, presentationTargetId: main, viewId: navigation-view, resourceLeases: full PresentationResourceLease records for newly created camera-dependent resources, resourceLeaseRefs: exact Candidate and same-preparation refs, contents: visibility/acceleration/shadow/cache refs, reactive publications, reset DAG, exact PresentationResourceLeaseRefs }
physicsPresentationSnapshotsByTarget:
  main/navigation-view: { type: PhysicsPresentationSnapshot, snapshotId: runtime-id, producer: route presentation sealer, candidateId: physicsPresentationCandidate.candidateId, cameraPublicationId: physicsCameraViewPublicationsByTarget["main/navigation-view"].cameraPublicationId, viewPreparationId: physicsViewPreparationPublicationsByTarget["main/navigation-view"].viewPreparationId, presentationTargetId: main, viewId: navigation-view, presentedStatePairRefs: candidate binding IDs, resourceLeaseRefs: exact transitive refs, eventSequenceRanges: candidate ranges, closureManifest: { type: PresentationClosureManifest, snapshotId: same runtime-id, pairStateHandleLeaseIds: exact forcing/support/vegetation pair-state lease IDs, preparationDependencyLeaseIds: exact navigation-view preparation dependency lease IDs, reactiveAndResetLeaseIds: exact vegetation deformation/LOD reactive and reset lease IDs, shadowCacheVisibilityLeaseIds: exact navigation-view shadow/cache/visibility lease IDs, exactRequiredLeaseIds: canonical sorted union of all preceding lease IDs and no others, exactEventRangeIds: canonical sorted exact navigation-view trampling event range IDs, dependencyDagDigest: collision-resistant digest of canonical dependency DAG, closureDigest: collision-resistant digest of canonical IDs and edges }, sealVersion: runtime-version, consumers: [navigation-view scene pass, $threejs-visual-validation] }
physicsPresentationRenderPlansByTarget:
  main/navigation-view: { type: PresentationRenderPlan, renderPlanId: forest-navigation-view-render-plan, timeCohortId: forest-navigation-cohort, candidateId: physicsPresentationCandidate.candidateId, snapshotId: physicsPresentationSnapshotsByTarget["main/navigation-view"].snapshotId, presentationTargetId: main, viewId: navigation-view, phaseIds: exact scene/present IDs, phaseRecords: complete RenderPlanPhase records using the performance pass keys, edges: complete RenderPlanEdge DAG with dependency completions/resource generations, requiredPreparationEdgeIds: exact navigation-view preparation edge IDs, renderResourceLeaseIds: exact navigation-view render lease IDs, plannedResetActionIds: exact reset IDs, expectedResetHistoryGenerations: exact per-action generation map, shadowFactorIds: exact once-applied shadow factor IDs or empty, closureDigest: canonical plan closure digest, immutablePlanDigest: canonical immutable plan digest }
frameExecutionRecord:
  type: FrameExecutionRecord
  producer: $threejs-image-pipeline frame executor
  consumers: [$threejs-visual-validation, performance evidence]
  executionId: unique append-only presentation execution
  timeCohortId: forest-navigation-cohort
  candidateIds: [physicsPresentationCandidate.candidateId]
  cohortAdmission: exact admitted FrameCohortAdmission
  renderPlans: [physicsPresentationRenderPlansByTarget["main/navigation-view"]]
  slotAdmissions: [exact admitted main/navigation-view FrameSlotAdmission]
  requiredTargetViewKeys: [main/navigation-view]
  snapshotIds: [physicsPresentationSnapshotsByTarget["main/navigation-view"].snapshotId]
  overallStatus: submitted | completed | partial-failure | aborted | device-lost
  backendGeneration: exact backend generation
  deviceLossGeneration: exact device-loss generation
  targetExecutions:
    main/navigation-view: { snapshotId: physicsPresentationSnapshotsByTarget["main/navigation-view"].snapshotId, renderPlanId: exact admitted navigation-view render plan ID, slotAdmissionId: exact admitted main/navigation-view slot ID, presentationTargetId: main, viewId: navigation-view, status: submitted | completed | failed | aborted | device-lost, submittedPasses: exact pass/dispatch keys, queueSubmissionEpochs: ordered epochs, actionResults: typed results, resetActionResults: exact planned reset results, completionTokens: exact tokens, presentedTimestamp: mapped presentation-clock PhysicsInstant or TypedAbsence(not-applicable, record authority, record interval, sketch provenance), failure: typed failure or TypedAbsence(not-applicable, record authority, record interval, sketch provenance) }
  leaseDispositionById:
    lease-id: { disposition: retained-until-join | retired-after-abort | invalidated-by-device-loss, consumingSnapshotIds: [physicsPresentationSnapshotsByTarget["main/navigation-view"].snapshotId], completionJoin: { simulationConsumers: [typed tokens], couplingConsumers: [], externalConsumers: [], presentationConsumers: [typed tokens], deviceLossRetirementPath: typed rule }, retirementEvidence: typed completion-or-loss record }
  immutability: completion never mutates candidate, camera publication, view-preparation publication, or snapshot
physicsPresentationSnapshot: not used # deprecated compatibility projection; never allocated
outputOwnersByPresentationTarget:
  main: { toneMap: $threejs-image-pipeline, outputTransform: $threejs-image-pipeline, adaptiveQuality: $threejs-image-pipeline }
sharedResourceOwners:
  gbuffer: not used
  depth: not used
  normal: not used
  velocity: not used
  history: not used
  weatherEnvelope: project environment forcing coordinator
  toneMap: $threejs-image-pipeline
  outputTransform: $threejs-image-pipeline
  adaptiveResolution: $threejs-image-pipeline
coverageStatus: partial
coverageBlockers: the project must supply the EnvironmentForcingSnapshot producer, PhysicsMaterialRegistry entries, and deterministic contact/trampling adapter; vegetation owns only the biological distribution and response after those typed inputs exist
performanceContract:
  routeStatus: provisional
  skillTierCrosswalk: { status: required-before-acceptance, rule: map every selected skill local tier explicitly to route Full/Budgeted/Minimum viable with protected invariants and explicit unsupported-tier mappings; no implicit name equality }
  frameInterval: { value: "", unit: ms, label: Derived, source: "1000 ms / [Gated] frozen target refresh" }
  passKeys: [physics.ingest, physics.sample-forcing, vegetation.predict, contact.emit-trampling, vegetation.apply-interactions, vegetation.solve-subcycles, physics.reduce-contact-work, physics.correct, physics.commit, physics.publish-candidate, navigation-view.camera-publication, navigation-view.prepare, navigation-view.scene, navigation-view.seal, main.present]
  accounting: composed culling/submit/GPU distributions; no universal draw or triangle cap
  mobileGate: chunk-local active response, bounded packed trampling batches, stable identity separate from slots, integer cadence changes with age/error, zero steady-frame readback, and complete response/presentation/migration memory ledgers
  qualityAdaptation: classify CPU submit, vertex, fill, and memory pressure before changing chunk density, LOD, or DPR
acceptanceEvidence:
  requiredDebugViews: [PhysicsContext/graph stages and versions, forcing version/age/filter, atmospheric wind/density, roots, species IDs, terrain masks/support, trampling exchanges, vegetation response, candidate/camera/view-preparation/snapshot versions, LOD, no-post]
  requiredMetrics: ["p50/p95 [Measured] CPU/GPU/presentation", culling completeness, LOD error, root/support residual, exactly-once interaction ordering plus exchange-owned lost/deferred commodity evidence, deformation/recovery error, candidate/camera/view-preparation/snapshot immutability, quality-transition rollback, temporal stability]
  requiredCommands: [installed-source API assertions, project validation/capture command]
  requiredArtifacts: [fixed navigation path, seed sweep, PhysicsGraph/exchange/candidate/camera/view-preparation/snapshot/execution records, sustained low-end/mobile trace]
```

## external rigid-body water coupling

minimal skill set: external solver adapter ownership plus bounded water,
camera, final-image, and validation skills; the project owns body/proxy assets.

Input brief: a bounded-water inspection scene in which a supplied external
rigid-body solver owns a floating instrument and a project adapter provides
conservative partitioned two-way coupling to the water solver. The external
solver keeps its internal representation and substep; this route standardizes
only the boundary, ordering, evidence, and presentation snapshot.

```text
backendManifest: "populate required [Gated] and observed [Measured] fields from canonical preflight"
workloadProfile:
  domain: scientific-visualization
  intent: inspect
  truthContract: physically-plausible
  representation: hybrid
  interaction: direct-manipulation
  temporal: simulation
  scale: object
  deployment: named physical desktop, integrated, and low-end/mobile WebGPU targets with supplied external solver process
causeLedger:
  sourceOfTruth: supplied external rigid-body solver state, validated body/hull proxies, bounded-water state, and shared PhysicsContext
  primaryObservable: stable float/contact motion and a reciprocal water disturbance that share one timestamp, frame, and conservation ledger
  earliestMissingLayer: motion
  selectedAlgorithm: semi-implicit iterated partitioned coupling with discrete-adjoint gather/scatter; one adapter samples committed water/support providers, computes one paired hydrodynamic exchange, applies opposite signed contributions, and accepts the substep only after force/torque/interface-work and coupling-convergence gates pass
  rejectedAlgorithms:
    - copying external transforms directly into rendering: omits water coupling, interpolation epoch, force ownership, and reset semantics
    - independent visual wake: can double inject momentum and detach from the body/contact footprint
    - replacing the supplied solver with procedural motion: violates the authoritative dynamics contract
  noPostBaseline: body pose, water displacement, contacts, and wake registration read without bloom, AO, or grading
selectedSkills:
  - $threejs-water-optics
  - $threejs-camera-controls-and-rigs
  - $threejs-image-pipeline
  - $threejs-visual-validation
primaryOwner: project external-solver adapter outside pack
deferredSkills: []
omittedSkills:
  - $threejs-procedural-motion-systems: the supplied external solver owns body dynamics
  - $threejs-particles-trails-and-effects: no independent particle cause in the brief
owners:
  sourceOfTruth: supplied external rigid-body solver
  representation: project body renderer plus $threejs-water-optics
  spatialFrame: route PhysicsContext plus $threejs-camera-controls-and-rigs
  timebase: route physics coordinator executing the PhysicsGraph
  semanticIds: project body/collider/material registries
  selectionPicking: project interaction layer
  clipSection: not used
  presentation: $threejs-image-pipeline
  validation: $threejs-visual-validation
domainSignals:
  rigidBodyProperties: { type: RigidBodyProperties, producer: project body-proxy registry, consumers: [external rigid-body adapter, project coupling adapter, $threejs-visual-validation] }
  hydrostaticHullProperties: { type: HydrostaticHullProperties, producer: project body-proxy registry, consumers: [project coupling adapter, $threejs-visual-validation] }
  bodyColliderProxy: { type: ColliderProxy, producer: project body-proxy registry, consumers: [external rigid-body adapter, project coupling adapter, $threejs-visual-validation] }
  contactManifoldRecords: { type: ContactManifoldRecord, owner: external rigid-body adapter, consumers: [project coupling adapter when hull/support contact affects the coupled interval, presentation diagnostics, $threejs-visual-validation], canonicalFields: manifold generation, solver/law revision, begin/persist/end interval and sample instant, frame/origin/transform, both body/collider/shape/feature/state records, both PhysicsMaterialId/material versions, A-to-B normal, persistent patch points/tangent/area, separation/TOI/relative velocity, constitutive pair law, friction/adhesion/warm-start state, emitted interaction IDs, validity/error, reset/migration policy }
physicsContext:
  type: PhysicsContext
  producer: route physics coordinator
  consumers: [external rigid-body adapter, project coupling adapter, $threejs-water-optics, $threejs-camera-controls-and-rigs, $threejs-image-pipeline, $threejs-visual-validation]
  invariant: one finite positive metersPerWorldUnit is the sole world-to-physics scale boundary; provider state remains SI in stable right-handed physics/solver frames; typed gravity; floating-origin epoch; generation-bearing body/collider/material IDs; time origin
  physicsMaterialRegistry: { registryId: external-coupling-materials, owner: project material-registry adapter, registryVersion: exact version, materials: [body/hull, water, static support], pairLawResolver: deterministic ordered pair laws with explicit missing-pair rejection, renderBindings: optional explicit render-binding-to-PhysicsMaterialId map; no PBR inference }
externalSolverAdapter:
  type: ExternalSolverAdapter
  adapterId: external-rigid-body-adapter
  externalSolverIdVersion: supplied solver/build identity plus adapter revision
  contextId: physicsContext.contextId
  boundaryRevision: external-rigid-body-boundary-v3
  ownedStateEquations: [rigid-body pose/twist and linear/angular momentum]
  ownership:
    stepping: external-solver
    constraintAssemblyAndSolve: external-solver
    collisionDetection: external-solver
    contactManifoldLifecycle: external-solver
    forceImpulseAccumulation: external-solver
    committedStatePublication: external rigid-body adapter
  supportedFramesCharts: [physicsContext.physicsRootFrameId, registered external solver/body frames]
  unitConversion: { sourceUnitSystemId: supplied-solver-units-v1, destinationUnitSystemId: canonical-SI, perQuantityAffineOrLinearMaps: dimension-checked exact maps, handednessAndAxialConvention: one versioned ingress/egress map, conversionError: per-quantity bounds }
  clockMapping: { externalClockId: external-solver-clock, contextClockId: body-water-coordination-clock, mappingRevision: external-solver-clock-map-v1, mappingDescriptorRef: physicsGraph.clocks.externalSolverClock, maximumAgeAndMappingError: typed Gated bounds }
  stepSemantics: fixed
  signalDescriptors: [bodyState, contactManifoldSet]
  interactionCapabilities:
    - { type: ExternalInteractionCapability, capabilityId: external-route-hydrodynamic-load-ingress, direction: ingress, role: reaction, payloadTag: wrenchRate, targetEquationId: rigid-body-linear-angular-momentum, frameId: physicsContext.physicsRootFrameId, unitSignature: force-N/torque-Nm/reference-point-m, footprintKinds: [area], cadence: { type: PhysicsCadenceDescriptor, kind: fixed, clockId: external-solver-clock, intervalOrTrigger: every loop iteration at the frozen coupling bracket, samplePhase: substep-stage, jitterBound: zero within bracket, maximumBurst: Gated iteration bound, evidence: body-water loop execution trace }, batchBounds: Gated hull-quadrature count/layout/bytes, exactOnceSupport: required-ledger, reactionAtomicity: same-commit-transaction, residency: { type: PhysicsResidencyDescriptor, kind: external, deviceId: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), queueId: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), bindingIdentity: body-state-ABI-v1 wrench ingress, sameQueueAvailability: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), hostVisibility: host-visible, mirror: TypedAbsence(no-mirror, external adapter, capability interval, host-authoritative residency), readbackPolicy: forbidden }, dependencyRef: { type: PhysicsDependencyRef, dependencyId: water-coupling-cpu-data, requiredCompletionVersion: exact per-iteration completion version }, errorDescriptorRef: external-route-body-water-coupling-error }
    - { type: ExternalInteractionCapability, capabilityId: external-route-moving-boundary-egress, direction: egress, role: source, payloadTag: movingBoundary, targetEquationId: bounded-water-no-penetration-and-momentum-boundary, frameId: physicsContext.physicsRootFrameId, unitSignature: boundary-position-m/boundary-velocity-mps, footprintKinds: [area], cadence: { type: PhysicsCadenceDescriptor, kind: fixed, clockId: external-solver-clock, intervalOrTrigger: every loop iteration at the frozen coupling bracket, samplePhase: substep-stage, jitterBound: zero within bracket, maximumBurst: Gated iteration bound, evidence: body-water loop execution trace }, batchBounds: Gated hull-quadrature count/layout/bytes, exactOnceSupport: required-ledger, reactionAtomicity: same-commit-transaction, residency: { type: PhysicsResidencyDescriptor, kind: external, deviceId: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), queueId: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), bindingIdentity: body-state-ABI-v1 moving-boundary egress, sameQueueAvailability: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), hostVisibility: host-visible, mirror: TypedAbsence(no-mirror, external adapter, capability interval, host-authoritative residency), readbackPolicy: forbidden }, dependencyRef: { type: PhysicsDependencyRef, dependencyId: external-step-and-manifold-fence, requiredCompletionVersion: exact per-iteration completion version }, errorDescriptorRef: external-route-moving-boundary-error }
  stepReceipts:
    - { type: ExternalSolverStepReceipt, receiptId: exact external step receipt per loop iteration, adapterId: external-rigid-body-adapter, coordinationAdvanceId: exact current body-water coordination advance ID, externalStepSequence: exact monotonic integer, requestedInterval: exact loop coupling/subcycle PhysicsTimeInterval, actualNativeExecutionIntervals: exact ordered nonoverlapping external intervals, inputStateVersions: exact body/manifold/water/support versions, inputApplicationLedgerIds: exact accepted wrench application-ledger IDs, outputPreparedVersions: exact body/manifold loop-provisional or transaction-prepared versions, emittedInteractionSequenceRanges: exact moving-boundary egress ranges, dependencyCompletionRefs: exact external-step/manifold and water-coupling completion refs, status: prepared | completed | rejected | failed, contentDigest: canonical step receipt digest }
  residencySynchronization:
    authorityBySignalOrStateEquation: { rigid-body-pose-twist-and-momentum: external-rigid-body-adapter, contact-manifold-lifecycle/warm-start/friction-state: external-rigid-body-adapter }
    transport: host-staging
    resourceProtocol: { handleAndLayoutKinds: body-state-ABI-v1, producerAccessAndConsumerAccess: external-write-route-read, generationAndSubresourceFields: explicit, acquireDependency: { type: PhysicsDependencyRef, dependencyId: external-step-and-manifold-fence, requiredCompletionVersion: exact per-iteration completion version }, releaseOrCompletionToken: external-step-complete-token, lifecycleAndRetirementOwner: external-rigid-body-adapter }
    transferProtocol: { serializationLayoutAndDigest: canonical-body-state-v1-plus-content-digest, endianPrecisionAndQuantization: explicit, sequenceAndExactOnceKeys: external-step-plus-application-ledger keys, maximumBytesCadenceLatencyAndStaleness: typed Gated bounds }
    hostVisibilityProof: external-fence-and-validated-transfer
  precisionDeterminism: { scalarFormatsAndAccumulationMode: declared-by-channel, reductionOrdering: deterministic-tree, solverSeedAndStreamIdentity: exact cursor map, replayEquivalenceGate: bounded-observable-error }
  errorModel: per-channel frame/time/unit/interpolation plus coupling errors
  checkpointRollback: { support: checkpoint-and-replay, checkpointFormatAndDigest: external-body-checkpoint-v1, cadenceAndMaximumRollback: typed policy, includedStateVersionsInventoriesAndCursors: body/water/manifold/warm-start/stable-ID/RNG/event/application-ledger set, restoreOrderingAndValidationGates: restore-before-replay then finite/contact/conservation gates }
  failurePolicy: { detectionAndTimeout: typed external-step gates, freezeCommitGroups: [body-water-state-commit-group], priorCommittedStateDisposition: preserve, queuedInteractionEventDisposition: retain-for-replay, recoveryOwnerAndPlan: external-rigid-body-adapter checkpoint transaction, degradedPublication: forbidden }
physicsGraph:
  type: PhysicsGraph
  producer: route physics coordinator
  graphId: external-body-water-physics-graph
  contextId: physicsContext.contextId
  coordinationInterval: nonempty PhysicsTimeInterval on body-water-coordination-clock
  coordinationAdvance: one PhysicsCoordinationAdvanceRecord with exact catch-up batch/predecessor receipt, debt, stage execution/claim/transaction IDs, status, and receipt digest
  clocks:
    bodyWaterCoordinationClock: { type: PhysicsClockDescriptor, clockId: body-water-coordination-clock, owner: route physics coordinator, mappingKind: fixed-rational, mappingRevision: body-water-clock-map-v1, discontinuityEpoch: body-water-clock-continuity-v1, coordinationClockMap: identity-with-zero-error }
    externalSolverClock: { type: PhysicsClockDescriptor, clockId: external-solver-clock, owner: external-rigid-body-adapter, mappingKind: external, mappingRevision: external-solver-clock-map-v1, discontinuityEpoch: body-water-clock-continuity-v1, mapping: { fixedRational: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), timestampTable: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), piecewiseVersioned: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), external: { adapterId: external-rigid-body-adapter, adapterVersion: supplied-solver-build, mappingHandle: external-solver-clock-map-v1, coveredInstantRange: exact route interval, frozenEvaluationTable: content-addressed accepted evaluations, onlineQueryProtocol: instant/request-response/revision/digest-v1, unloggedQueryPolicy: reject, error: typed bound } }, coordinationClockMap: versioned map with exact common boundary instants and declared interior error }
    waterClock: { type: PhysicsClockDescriptor, clockId: water-clock, owner: $threejs-water-optics, mappingKind: piecewise-versioned, mappingRevision: water-clock-map-v1, discontinuityEpoch: body-water-clock-continuity-v1, coordinationClockMap: versioned map whose stable PhysicsTimeInterval substeps tile coordinationInterval }
    presentationClock: { type: PhysicsClockDescriptor, clockId: presentation-clock, owner: route presentation scheduler, mappingKind: external, mappingRevision: presentation-clock-map-v1, discontinuityEpoch: presentation-clock-continuity-v1, coordinationClockMap: versioned bounded-error map to body-water-coordination-clock }
  edges:
    - { type: PhysicsGraphEdge, edgeId: external-step-and-manifold-edge, producerStageId: body-water-predict, consumerStageId: body-water-emit-interactions, payload: bodyState/contactManifoldSet loop-provisional predictor versions for the same iteration, requiredVersionAndPhase: exact iteration index and frozen bracket, interpolationExtrapolation: not-used, maximumStaleness: not-applicable, latency: exact external predictor latency descriptor, barrier: { type: PhysicsDependencyRef, dependencyId: external-step-and-manifold-fence, requiredCompletionVersion: exact per-iteration completion version }, absencePolicy: block }
    - { type: PhysicsGraphEdge, edgeId: water-coupling-correction-edge, producerStageId: body-water-reduce-reactions, consumerStageId: body-water-correct, payload: waterSurface/bodyWaterExchange loop-provisional versions for the same iteration, requiredVersionAndPhase: exact iteration index and frozen bracket, interpolationExtrapolation: not-used, maximumStaleness: not-applicable, latency: exact same-iteration CPU latency descriptor, barrier: { type: PhysicsDependencyRef, dependencyId: water-coupling-cpu-data, requiredCompletionVersion: exact per-iteration completion version }, absencePolicy: block }
  dependencies:
    - { type: PhysicsDependency, dependencyId: external-step-and-manifold-fence, kind: external-fence, producerStageId: body-water-predict, consumerStageId: body-water-emit-interactions, payloadSchemaAndVersionRule: exact body/manifold loop-provisional predictor iteration-version rule, producerResidencyRule: external host-authoritative staging residency, consumerResidencyRule: coupling adapter CPU residency, resourceSubresourceRule: exact staged body/manifold slice rule, accessTransitionRule: external write to route immutable read, generationCompatibilityRule: exact adapter/body/manifold generations, releaseAcquireProtocol: external-step token then host first-read acquire, externalFenceOrHostVisibilityRule: external fence and validated transfer, completionSemantics: per-iteration body/manifold predictor bytes and digest host-visible before first coupling read }
    - { type: PhysicsDependency, dependencyId: water-coupling-cpu-data, kind: cpu-data, producerStageId: body-water-reduce-reactions, consumerStageId: body-water-correct, payloadSchemaAndVersionRule: exact water/exchange loop-provisional iteration-version rule, producerResidencyRule: bounded-water/coupling CPU residency, consumerResidencyRule: correction CPU residency, resourceSubresourceRule: exact immutable state slices or TypedAbsence(not-applicable, record authority, record interval, sketch provenance) for values, accessTransitionRule: reducer write to correction immutable read, generationCompatibilityRule: exact state/resource generation or TypedAbsence(not-applicable, record authority, record interval, sketch provenance) for values, releaseAcquireProtocol: ordered CPU dependency, externalFenceOrHostVisibilityRule: host visibility by producer completion, completionSemantics: same-iteration water/exchange versions and digest complete before correction }
  loopMacros:
    - loopId: body-water-semi-implicit-loop
      type: BoundedCouplingLoop
      coordinationAdvanceId: exact current body-water coordination advance ID
      couplingInterval: physicsGraph.coordinationInterval
      orderedStageIds: [body-water-predict, body-water-emit-interactions, body-water-solve-subcycles, body-water-reduce-reactions, body-water-correct]
      iterationBound: Gated product/solver iteration bound
      residuals: [body/water state increment, force, torque, linear/angular momentum, interface work]
      convergenceBounds: [Gated typed coupling-error bounds]
      conservationGroupIds: [body-water-momentum-angular-momentum-work]
      provisionalVersionNamespace: body-water-loop-namespace
      seedCommittedVersions: [bodyState.committed, contactManifoldSet.committed, waterSurface.committed]
      externalReads: [staticSupport.committed, rigidBodyProperties.committed, hydrostaticHullProperties.committed, bodyColliderProxy.committed, physicsContext.physicsMaterialRegistry]
      iterationCarriedEdges:
        - { type: CouplingIterationEdge, edgeId: external-body-iterate-carry, producerStageId: body-water-correct, consumerStageId: body-water-predict, signalOrExchangeId: bodyState, producedIterationOffset: 0, consumedIterationOffset: 1, requiredBracket: frozen body-water coupling bracket, requiredProvisionalVersionPattern: body-water-loop-namespace/bodyState/iteration-i, barrier: external-fence }
        - { type: CouplingIterationEdge, edgeId: external-manifold-iterate-carry, producerStageId: body-water-correct, consumerStageId: body-water-predict, signalOrExchangeId: contactManifoldSet, producedIterationOffset: 0, consumedIterationOffset: 1, requiredBracket: frozen body-water coupling bracket, requiredProvisionalVersionPattern: body-water-loop-namespace/contactManifoldSet/iteration-i, barrier: external-fence }
        - { type: CouplingIterationEdge, edgeId: external-water-iterate-carry, producerStageId: body-water-correct, consumerStageId: body-water-predict, signalOrExchangeId: waterSurface, producedIterationOffset: 0, consumedIterationOffset: 1, requiredBracket: frozen body-water coupling bracket, requiredProvisionalVersionPattern: body-water-loop-namespace/waterSurface/iteration-i, barrier: cpu-data }
        - { type: CouplingIterationEdge, edgeId: external-exchange-iterate-carry, producerStageId: body-water-reduce-reactions, consumerStageId: body-water-predict, signalOrExchangeId: body-water-exchange, producedIterationOffset: 0, consumedIterationOffset: 1, requiredBracket: frozen body-water coupling bracket, requiredProvisionalVersionPattern: body-water-loop-namespace/bodyWaterExchange/iteration-i, barrier: cpu-data }
      iterationVersionRule: iteration 0 reads only seedCommittedVersions plus immutable externalReads; iteration i writes exact body-water-loop-namespace signal versions indexed by i at one frozen bracket; iteration i+1 consumes only the prior-index versions and recomputes source/reaction records, while rejected sequence ranges never advance an application cursor
      acceptedWrites: [bodyState.provisional-accepted-iteration, contactManifoldSet.provisional-accepted-iteration, waterSurface.provisional-accepted-iteration, bodyWaterExchange.provisional-accepted-iteration]
      perIterationLedger:
        - { type: CouplingIterationLedger, loopId: body-water-semi-implicit-loop, iterationIndex: each executed integer in [0, iterationBound), bracket: frozen body-water coupling bracket, inputVersions: exact seed/external/prior-iteration refs, outputVersions: exact iteration-indexed body/manifold/water/exchange refs, interactionSequenceRanges: loop-local body-water ranges, residualValues: labelled body/water/force/torque/momentum/interface-work quantities, conservationResults: [body-water-momentum-angular-momentum-work and status], accepted: exactly one true only after all gates, stageExecutionIds: exact predict/emit/solve-subcycle/reduce/correct execution IDs carrying this loopId and iterationIndex, interactionApplicationLedgerIds: exact loop-local source/reaction ledger IDs for this iteration, outputContentDigest: canonical digest of iteration outputs and ranges, dependencyCompletionRefs: exact external-fence/CPU completion refs }
      acceptedIterationIndex: exact accepted integer or TypedAbsence(not-applicable, record authority, record interval, sketch provenance) on rollback
      acceptedWriteLineage: one CouplingAcceptedWriteLineage per body/manifold/water/exchange accepted write, each binding acceptedIterationIndex, iteration output digest, preparedPublicationId/version, and exact-copy or immutable-handle-promotion proof
      outerEdgePolicy: ingress-committed-and-accepted-egress-only
      acceptedIteratePublication: atomic
      divergenceFallback: rollback
  stages:
    - ingest: latch PhysicsContext, registries/proxies, prior committed body/water/support versions, exact-once cursors, pending quality request, and coordinationInterval
    - sample-forcing: sample only immutable static support/gravity inputs and map the common coupling bracket; committed water/body are loop initial conditions, not the emitted iterate
    - body-water-predict: reconstruct body-water-loop-namespace provisional external-body, contact-manifold, and water predictors at the same frozen bracket from the committed seeds and immutable external reads; none is externally sampleable and no rejected iterate is an integration baseline
    - body-water-emit-interactions: resample both provisional predictors at that same bracket on every loop iteration, then write the paired hydrodynamic reaction group provisionally using the declared virtual-work-adjoint gather/scatter pair
    - body-water-solve-subcycles: recompute only loop-scoped provisional body/contact-manifold/water/exchange versions over mapped PhysicsTimeIntervals for the current iteration; the external owner alone advances manifold lifecycle, persistent point IDs, pair-law state, and warm starts, and loop-local source/reaction records are applied once only if that iterate commits
    - body-water-reduce-reactions: reduce opposite signed impulse/work contributions and record their residual with zero steady-frame CPU/GPU readback; validation schedules evidence captures outside the timed presentation path
    - body-water-correct: gate nonpenetration, finite provisional state, water positivity, coupling convergence, added-mass stability, and force/torque/interface-work residuals; rejected iterates never escape the loop namespace
    - commit: publish the accepted body/contact-manifold/water iterate and reaction-group cursor only through body-water-state-commit-group; a prepared QualityTransition commits separately or rolls back
    - publish-presentation: publish the camera-free candidate from committed versions; camera, view preparation, and sealing follow as immutable per-view publications
  stageExecutionRules:
    body-water-predict: { type: PhysicsStageExecutionRule, activation: per-loop-iteration, partition: single, maximumActivationsPerAdvance: iterationBound, maximumExecutionsPerActivation: 1, nativeSubcycleSelection: not-applicable, ordering: monotonic-interval-then-native-sequence }
    body-water-emit-interactions: { type: PhysicsStageExecutionRule, activation: per-loop-iteration, partition: single, maximumActivationsPerAdvance: iterationBound, maximumExecutionsPerActivation: 1, nativeSubcycleSelection: not-applicable, ordering: monotonic-interval-then-native-sequence }
    body-water-solve-subcycles: { type: PhysicsStageExecutionRule, activation: per-loop-iteration, partition: exact-subcycle-tile, maximumActivationsPerAdvance: iterationBound, maximumExecutionsPerActivation: Gated external/body/water subcycle count, nativeSubcycleSelection: stability-bound, ordering: monotonic-interval-then-native-sequence }
    body-water-reduce-and-correct: { type: PhysicsStageExecutionRule, activation: per-loop-iteration, partition: single, maximumActivationsPerAdvance: iterationBound, maximumExecutionsPerActivation: 2, nativeSubcycleSelection: not-applicable, ordering: monotonic-interval-then-native-sequence }
    commit-and-publish: { type: PhysicsStageExecutionRule, activation: per-advance, partition: single, maximumActivationsPerAdvance: 1, maximumExecutionsPerActivation: 1, nativeSubcycleSelection: not-applicable, ordering: monotonic-interval-then-native-sequence }
  stateAdvanceClaimRule: all loop/subcycle PhysicsStageExecution records name their loopId, iterationIndex, subcycleIndex, and the single body/manifold/water StateAdvanceClaim for this coordination interval; only accepted iteration lineage prepares outputs, and a rejected/externally unavailable advance records state-hold with outputPreparedVersion TypedAbsence(not-applicable, record authority, record interval, sketch provenance) plus rollback rather than republishing stale state as a new commit
  commitGroups:
    - { commitGroupId: body-water-state-commit-group, owner: route physics coordinator, interval: coordinationInterval, provisionalVersions: [bodyState.loop-provisional-accepted-iteration, contactManifoldSet.loop-provisional-accepted-iteration, waterSurface.loop-provisional-accepted-iteration, bodyWaterExchange.loop-provisional-accepted-iteration], preparedPublications: [{ type: PhysicsPreparedPublication, preparedPublicationId: body-state-prepared, commitGroupId: body-water-state-commit-group, stateEquationOwner: external rigid-body adapter, signalOrStateEquationId: bodyState, provisionalVersion: bodyState.loop-provisional-accepted-iteration, preparedVersion: bodyState.transaction-prepared, contentDigest: accepted body iteration digest, ownerApproval: external adapter and solver revision, prepareDependencyRefs: exact external-fence/coupling dependencies, visibility: transaction-private }, { type: PhysicsPreparedPublication, preparedPublicationId: manifold-set-prepared, commitGroupId: body-water-state-commit-group, stateEquationOwner: external rigid-body adapter, signalOrStateEquationId: contactManifoldSet, provisionalVersion: contactManifoldSet.loop-provisional-accepted-iteration, preparedVersion: contactManifoldSet.transaction-prepared, contentDigest: accepted manifold iteration digest, ownerApproval: external adapter and solver revision, prepareDependencyRefs: exact external-fence/coupling dependencies, visibility: transaction-private }, { type: PhysicsPreparedPublication, preparedPublicationId: water-surface-prepared, commitGroupId: body-water-state-commit-group, stateEquationOwner: $threejs-water-optics, signalOrStateEquationId: waterSurface, provisionalVersion: waterSurface.loop-provisional-accepted-iteration, preparedVersion: waterSurface.transaction-prepared, contentDigest: accepted water iteration digest, ownerApproval: water owner/build revision, prepareDependencyRefs: exact water/coupling dependencies, visibility: transaction-private }, { type: PhysicsPreparedPublication, preparedPublicationId: body-water-cursor-prepared, commitGroupId: body-water-state-commit-group, stateEquationOwner: project coupling adapter, signalOrStateEquationId: bodyWaterExchange, provisionalVersion: bodyWaterExchange.loop-provisional-accepted-iteration, preparedVersion: bodyWaterExchange.transaction-prepared-cursors, contentDigest: accepted interaction ranges/application-ledger digest, ownerApproval: coupling adapter revision, prepareDependencyRefs: exact reduction/conservation dependencies, visibility: transaction-private }], committedPublications: [bodyState.committed, contactManifoldSet.committed, waterSurface.committed, bodyWaterExchange.committed-cursors], publicationLineage: one exact CommitPublicationLineage per prepared publication and committed output using the accepted iteration digest, stateEquationOwners: { rigid-body-pose-twist-and-momentum: external rigid-body adapter, contact-manifold-lifecycle/warm-start/friction-state: external rigid-body adapter, bounded-water-state: $threejs-water-optics, exchange-sequence-publication: project coupling adapter }, conservationAndErrorGates: [finite-state, collider/material/manifold-version consistency, water-positivity, nonpenetration, added-mass-stability, loop-convergence, momentum-angular-momentum-interface-work-residuals, external-route error-ledger consumer gates], atomicity: all-or-none, failureDisposition: preserve-prior-commit, commitTransactionId: body-water-commit-transaction }
  commitTransactions:
    - { type: PhysicsCommitTransaction, commitTransactionId: body-water-commit-transaction, coordinationAdvanceId: exact current advance ID, contextId: physicsContext.contextId, interval: coordinationInterval, commitGroupIds: [body-water-state-commit-group], preparedPublicationIds: [body-state-prepared, manifold-set-prepared, water-surface-prepared, body-water-cursor-prepared], conservationErrorAndResourceGates: exact finite/contact/water/coupling/error/resource gate results, priorCommittedVersions: [bodyState prior, contactManifoldSet prior, waterSurface prior, bodyWaterExchange cursor prior], publicationSetDigest: canonical prepared publication-set digest, atomicPublicationProtocol: prepare-validate-single-registry-swap, status: preparing | prepared | committed | rejected | rolled-back, receipt: on committed status one PhysicsCommitReceipt with receiptId, this commitTransactionId, publicationInstant, preparedToCommittedPublicationMap covering each prepared ID/version/digest and committed version/digest exactly once, committedPublications, priorToCommittedVersionMap, identical publicationSetDigest, registryRevisionBeforeAfter, exact dependencyCompletionRefs, conservationAndErrorGateResults, status committed, and receiptDigest; otherwise TypedAbsence(not-applicable, record authority, record interval, sketch provenance) }
  originRebaseTransactions: [] # populate with canonical accepted transactions when a physics-origin rebase is scheduled
  publicationRule: loop predictors, interactions, and solver writes remain loop-scoped provisional; only the accepted commit-group set is descriptor-, event-, or presentation-visible
  executionLedger: { type: PhysicsExecutionLedger, ledgerId: route-interval-execution-ledger-id, graphId: route PhysicsGraph ID, graphRevision: exact graph revision, coordinationInterval: graph coordinationInterval, coordinationAdvanceId: exact current advance ID, stageExecutions: complete PhysicsStageExecution records whose executionInterval, coordinationCoverageInterval, coordinationClockMappingProof, couplingLoopId, iterationIndex, and subcycleIndex bind every loop/native execution, dependencyCompletions: exact refs to physicsDependencyCompletions records below, stateAdvanceClaims: exactly one accepted state-advance claim per body/manifold/water equation and interval or an explicit state-hold claim, interactionApplicationLedgers: exact per-iteration ledgers with only accepted-iterate cursor promotion, loopResults: bounded-loop iterations/residuals/accepted iterate and accepted write digests, commitReceipts: exactly the successful body-water-commit-transaction receipt or none, catchUpDebtBeforeAfter: typed duration pair, discontinuityEpoch: graph epoch, physicsCostLedgerId: route-specific-runtime-physics-cost-ledger-id }
  physicsDependencyCompletions:
    - { type: PhysicsDependencyCompletion, completionId: external-step-and-manifold-completion-for-iteration, dependencyId: external-step-and-manifold-fence, coordinationAdvanceId: exact current advance ID, producerExecutionId: exact external body subcycle execution, consumerExecutionId: exact same-iteration coupling execution, payloadAndVersion: exact body/manifold loop-provisional versions, producerResidency: external host-authoritative descriptor, consumerResidency: coupling adapter CPU descriptor, resourceIdentityAndSubresource: exact staged body/manifold slices, accessTransition: external write to route read, deviceBackendResourceGenerations: TypedAbsence(not-applicable, record authority, record interval, sketch provenance) for host staging, producerRelease: external-step-complete-token, consumerAcquire: exact host first-read acquire, externalFenceOrHostVisibility: external fence plus validated transfer/host visibility, status: completed, receiptDigest: canonical completion receipt digest }
    - { type: PhysicsDependencyCompletion, completionId: water-coupling-completion-for-iteration, dependencyId: water-coupling-cpu-data, coordinationAdvanceId: exact current advance ID, producerExecutionId: exact same-iteration water/reduction execution, consumerExecutionId: exact correction execution, payloadAndVersion: exact water/exchange loop-provisional versions, producerResidency: bounded-water/coupling CPU descriptor, consumerResidency: correction CPU descriptor, resourceIdentityAndSubresource: exact state slices or TypedAbsence(not-applicable, record authority, record interval, sketch provenance) for immutable CPU values, accessTransition: water/reduction write to correction read, deviceBackendResourceGenerations: TypedAbsence(not-applicable, record authority, record interval, sketch provenance) for CPU values, producerRelease: TypedAbsence(not-applicable, record authority, record interval, sketch provenance) for CPU data dependency, consumerAcquire: TypedAbsence(not-applicable, record authority, record interval, sketch provenance) for CPU data dependency, externalFenceOrHostVisibility: ordered CPU completion proof, status: completed, receiptDigest: canonical completion receipt digest }
  catchUpBatch: { type: PhysicsCatchUpBatch, catchUpBatchId: exact presentation-opportunity batch ID, graphId: route PhysicsGraph ID, contextId: physicsContext.contextId, owner: route physics coordinator, debtIdentity: { type: PhysicsCatchUpDebtIdentity, debtIdentityId: exact body-water debt identity, graphId: route PhysicsGraph ID, debtClockId: body-water-coordination-clock, sourceCursorBeforeAfter: exact monotonic cursor pair, presentationOpportunitySequence: exact integer, observedAt: exact PhysicsInstant, policyRevision: body-water-catch-up-policy revision }, debtBefore: exact PhysicsDuration, elapsedDuringBatch: exact elapsed PhysicsDuration on debt clock, admittedAdvanceIntervals: exact ordered PhysicsTimeIntervals, coordinationAdvanceIds: exact ordered advance IDs, committedAdvanceDuration: exact sum of successfully committed advance durations, explicitlyDroppedDuration: zero because policy retains debt, debtAfter: exact PhysicsDuration satisfying debt arithmetic, lossLedger: TypedAbsence(not-applicable, record authority, record interval, sketch provenance) because no interval is dropped, policyRevision: body-water-catch-up-policy revision, errorResourceAndExecutionGateResults: exact error/resource/native-execution/deadline gate results, status: completed | rejected | blocked, receiptDigest: canonical catch-up batch receipt digest }
  catchUpPolicy: { type: PhysicsCatchUpPolicy, owner: route physics coordinator, debtClockId: body-water-coordination-clock, maximumDebt: Gated PhysicsDuration, maximumCoordinationAdvancesPerPresentationOpportunity: Gated advance count, maximumNativeExecutionsPerOpportunity: Gated exact external/body/water/loop execution count, debtDisposition: retain, discontinuityOnDrop: forbidden, externalDeadlinePolicy: reject-advance, errorAndResourceGates: exact external deadline/coupling/error/memory/latency gates }
  discontinuityPolicy: external checkpoint restore/replay or explicit discontinuity transaction; no silent interval drop or stale republish
physicsErrorPropagationLedgers:
  inventory: { bodyState: external-route-body-state-error-ledger, waterSurface: external-route-water-surface-error-ledger, body-water-exchange: external-route-body-water-error-ledger }
  records:
    external-route-body-state-error-ledger: { type: ErrorPropagationLedger, ledgerId: external-route-body-state-error-ledger, contextId: physicsContext.contextId, outputSignalOrInteractionId: bodyState, outputStateVersion: bodyState.transaction-prepared, evaluationInterval: physicsGraph.coordinationInterval, inputErrors: [prior body state, unit/frame/clock conversion, hull/material, hydrodynamic wrench errors], transformsFiltersInterpolations: [external clock map, SI/frame adapter, external integrator/constraint solve], correlationAssumptions: [wrench/body coupling errors retain joint covariance], operatorOrGainBounds: [external integrator and constraint/added-mass bounds], modeledApproximationTerms: [external solver/model and hull-proxy errors], numericalTerms: [accepted loop/integrator/contact residuals], combinationRule: versioned coupled operator-bound rule, outputError: external-route-body-output-error, acceptanceGate: body/coupling/presentation consumer tolerances, provenance: external solver/build/adapter/checkpoint revisions }
    external-route-water-surface-error-ledger: { type: ErrorPropagationLedger, ledgerId: external-route-water-surface-error-ledger, contextId: physicsContext.contextId, outputSignalOrInteractionId: waterSurface, outputStateVersion: waterSurface.transaction-prepared, evaluationInterval: physicsGraph.coordinationInterval, inputErrors: [prior water state, support/material errors, external-route-moving-boundary-error], transformsFiltersInterpolations: [moving-boundary gather, bounded-water substeps, wet/dry and query reconstruction], correlationAssumptions: [moving-boundary/reaction errors retained jointly], operatorOrGainBounds: [CFL, positivity, gather/scatter, added-mass bounds], modeledApproximationTerms: [water closure and hull boundary error], numericalTerms: [accepted loop/water residuals], combinationRule: versioned coupled operator-bound rule, outputError: external-route-water-output-error, acceptanceGate: water/coupling/optics consumer tolerances, provenance: water owner/build/support/coupling revisions }
    external-route-body-water-error-ledger: { type: ErrorPropagationLedger, ledgerId: external-route-body-water-error-ledger, contextId: physicsContext.contextId, outputSignalOrInteractionId: body-water-exchange, outputStateVersion: bodyWaterExchange.transaction-prepared-cursors, evaluationInterval: physicsGraph.coordinationInterval, inputErrors: [external-route-body-output-error, external-route-water-output-error, hull/material/bracket errors], transformsFiltersInterpolations: [hull clipping, discrete-adjoint gather/scatter, deterministic wrench reduction], correlationAssumptions: [paired source/reaction and body/water errors retained jointly], operatorOrGainBounds: [virtual-work, moment-preservation, added-mass bounds], modeledApproximationTerms: [hydrodynamic law/proxy errors], numericalTerms: [force/torque/momentum/interface-work and convergence residuals], combinationRule: versioned paired-reaction operator-bound rule, outputError: external-route-body-water-coupling-error, acceptanceGate: conservation/convergence/body/water consumer tolerances, provenance: external solver/water/coupling adapter revisions }
physicsCostLedger:
  type: PhysicsCostLedger
  ledgerId: route-specific-runtime-physics-cost-ledger-id
  status: active
  targetAndHarness: named physical target, deterministic body replay/inspection path, water state, route tier, viewport, DPR, and sustained protocol
  qualityState: route Full/Budgeted/Minimum viable plus performanceContract.skillTierCrosswalk
  cadenceTraceTotals: { type: CadenceTraceTotals, traceTotalsId: external-body-water-cadence-trace-totals, traceRef: content-addressed sustained route trace/protocol, measurementInterval: exact measured PhysicsTimeInterval, exactDuration: duration derived from registered measurement clock, coordinationAdvanceCount: exact count, catchUpBatchCount: exact count, stageExecutionCounts: exact PhysicsGraphStageId-to-count map, nativeSubcycleCounts: exact owner-to-count map, couplingIterationCounts: exact body-water-semi-implicit-loop count, interactionApplicationCounts: exact payload-tag-to-count map, presentedFrameCounts: exact target-view-to-count map, workOccurrenceCounts: exact PhysicsWorkKey-to-count map, trafficOccurrenceAndLogicalByteTotals: exact TrafficRecordId-to-count/byte map, droppedCoordinationIntervals: exact intervals or empty, exactTotalsDigest: canonical trace totals digest }
  graphStageCosts: [external solver, coupling quadrature/reduction, bounded water, commit/publication router cost records]
  coordinationIntervalsPerSecond: labelled distribution on body-water-coordination-clock
  stageExecutionsPerCoordinationInterval: labelled counts by stage/owner
  stageExecutionsPerSecond: labelled counts through registered clock maps
  coordinationIntervalsPerPresentedFrame: labelled distribution through presentation-clock-map-v1
  subcyclesAndCouplingIterationsPerPresentedFrame: labelled external-body/water/loop distributions
  executionsPerPresentedFrame: labelled stage counts
  worstPermittedCatchUpBurst: { triggerAndIntervalDebt: graph catch-up/discontinuity policy, executionsDispatchesAndTraffic: labelled external/coupling/water/upload records, latencyMemoryAndErrorGate: typed gates }
  hotBytesReadWrittenPerExecution: labelled body/water/proxy/manifold/exchange bytes
  solverDispatches: [bounded-water extent/workgroup/cadence/timing records; external CPU solver work stays in cpuWork]
  queueSubmissionsAndPassBreaks: labelled counts
  dependencyCriticalPaths: [external body to exchange to water to atomic commit, commit to async upload to candidate to view preparation]
  tileGpuTraffic: { attachmentStoreLoadResolveBytes: labelled records, tileSpillEvidence: measured-or-TypedAbsence(not-measured, evidence owner, measurement interval, harness provenance), renderComputePassBreaks: labelled counts }
  bindingAndDeviceLimits: [limit-demand-headroom-and-gate]
  cpuWork: [external solver, coupling quadrature/reduction, CPU bounded water, candidate assembly]
  allocationGcAndCompilation: [cadence-latency-and-byte-record]
  uploadsCopiesMaps: [asynchronous committed CPU-to-GPU immutable-presentation TrafficRecord]
  hostCompletionsReadbacksPerPresentedFrame: { value: 0, unit: readbacks-per-presented-frame, label: Gated, source: steady critical-path contract }
  synchronization: [cpu-data dependencies, named external fence when required, GPU presentation submission]
  multiviewAndFramesInFlightMultipliers: labelled view/lease/resource records
  hotState: PhysicsMemoryLedger
  peakTransient: PhysicsMemoryLedger
  migrationOverlap: PhysicsMemoryLedger
  thermalPowerState: measured-or-TypedAbsence(not-measured, evidence owner, measurement interval, harness provenance)
physicsSignals:
  bodyState: { type: PhysicsSignalDescriptor<RigidBodyState>, producer: external rigid-body adapter, consumers: [project coupling adapter, body scene representation, $threejs-visual-validation], motionMode: dynamic, residency: CPU/host authoritative external state with committed immutable adapter publication and asynchronous CPU-to-GPU presentation upload }
  waterSurface: { type: PhysicsSignalDescriptor<WaterSurfaceSample>, producer: $threejs-water-optics, consumers: [project coupling adapter, water geometry/optics, $threejs-visual-validation], requiredChannels: [freeSurfacePoint, freeSurfaceNormal, surfacePointVelocityMps, geometricNormalVelocityMps, materialCurrentVelocityMps, waterColumnDepthMeters, densityKgPerM3, materialAccelerationMps2, pressurePa], optionalChannels: [bathymetryPoint, wetDryState], absencePolicy: any missing required channel blocks the selected hydrostatic/drag/added-mass/wave-excitation model or forces an explicit QualityTransition to a separately validated model; never substitute zero current/pressure/acceleration or infer geometric normal velocity from material current, residency: CPU-authoritative bounded-water query or declared converged CPU mirror with immutable async GPU presentation upload; frame-critical GPU readback forbidden, filterLatencyAndError: every channel retains actual support/filter/time/stateVersion and correlated error }
  contactManifoldSet: { type: PhysicsSignalDescriptor<ContactManifoldRecord[]>, producer: external rigid-body adapter, consumers: [project coupling adapter, presentation diagnostics, $threejs-visual-validation], residency: CPU/host authoritative external state with committed immutable adapter publication, invariant: descriptor/context/frame/origin/material-state/solver-law/manifold generations and exact lifecycle interval are latched atomically }
  staticSupport: { type: PhysicsSignalDescriptor<SupportSurfaceSample>, producer: project static-collider adapter, consumers: [external rigid-body adapter, project coupling adapter, $threejs-visual-validation] }
  qualityChangeRequest: { type: PhysicsSignalDescriptor<QualityChangeRequest>, producer: $threejs-image-pipeline quality governor, consumers: [route physics coordinator] }
  qualityTransition: { type: PhysicsSignalDescriptor<QualityTransition>, producer: route physics coordinator, consumers: [external rigid-body adapter, project coupling adapter, $threejs-water-optics, $threejs-image-pipeline, $threejs-visual-validation] }
physicsInteractions:
  - exchangeId: body-water-exchange
    type: SurfaceExchange
    contextId: physicsContext.contextId
    applicationInterval: physicsGraph.coordinationInterval
    physicsFrameId: physicsContext.physicsRootFrameId
    physicsOriginEpoch: physicsContext.physicsOriginEpoch
    transformRevision: physicsContext.worldTransformRevision
    mode: two-way-iterated
    producer: project coupling adapter
    consumers: [external rigid-body adapter, $threejs-water-optics source reducer, $threejs-visual-validation]
    participants: [external rigid-body owner, $threejs-water-optics]
    sourceDescriptors: [bodyState, waterSurface]
    propertyRecords: [rigidBodyProperties, hydrostaticHullProperties, bodyColliderProxy]
    materialRegistry: PhysicsContext.physicsMaterialRegistry
    interactions:
      - { interactionId: body-to-water-moving-boundary, exactOnceKey: canonical interval/stage/producer-sequence/interaction key, role: source, sourceOwner: external rigid-body owner, sourceEntityId: instrument entity generation, sourceStateVersions: [bodyState loop iterate, RigidBodyProperties version, HydrostaticHullProperties geometry revision, ColliderProxy topology/pose version, hull PhysicsMaterialId/material version, resolved water-hull pair-law revisions], targetOwner: $threejs-water-optics, targetEntityId: bounded-water domain generation, targetStateVersionExpected: waterSurface loop iterate, targetStateEquation: bounded-water no-penetration/momentum boundary, applicationInterval: physicsGraph.coordinationInterval, physicsFrameId: physicsContext.physicsRootFrameId, physicsOriginEpoch: physicsContext.physicsOriginEpoch, transformRevision: physicsContext.worldTransformRevision, footprint: oriented hull area quadrature with physical m2 weights summing represented wetted area, kernel TypedAbsence(no-distribution-kernel, interaction producer, application interval, physical quadrature selected), normalization target none, reference point, and approximation error, payload: { tag: movingBoundary, timeSemantics: state-over-interval, boundaryPositionMetersByQuadraturePoint: dimensioned quadrature points, boundaryVelocityMpsByQuadraturePoint: dimensioned physical point velocities, noPenetrationAndSlipLawRef: latched versioned law }, signConvention: positive-source-to-receiver, applicationLedgerKey: exact-once body-to-water key, partitionMembership: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), reactionGroupId: body-water-reaction-group, reactionToInteractionIds: [], conservationGroupIds: [body-water-momentum-angular-momentum-work], validity: typed validity, error: payload/footprint error, provenance: coupling adapter/revision }
    reactions:
      - { interactionId: hydrodynamic-load, exactOnceKey: canonical interval/stage/producer-sequence/interaction key, role: reaction, sourceOwner: $threejs-water-optics coupling reducer, sourceEntityId: bounded-water domain generation, sourceStateVersions: [waterSurface loop iterate, water PhysicsMaterialId/material version, resolved water-hull pair-law revisions], targetOwner: external rigid-body owner, targetEntityId: instrument entity generation, targetStateVersionExpected: bodyState loop iterate, targetStateEquation: rigid-body linear/angular momentum balance, applicationInterval: physicsGraph.coordinationInterval, physicsFrameId: physicsContext.physicsRootFrameId, physicsOriginEpoch: physicsContext.physicsOriginEpoch, transformRevision: physicsContext.worldTransformRevision, footprint: same physical-area hull quadrature and common wrench reference point, payload: { tag: wrenchRate, timeSemantics: rate, forceN: dimensioned physical Vec3, torqueNm: dimensioned axial Vec3, referencePointMeters: common hull balance point }, signConvention: positive-source-to-receiver, applicationLedgerKey: exact-once hydrodynamic-load key, partitionMembership: TypedAbsence(not-applicable, record authority, record interval, sketch provenance), reactionGroupId: body-water-reaction-group, reactionToInteractionIds: [body-to-water-moving-boundary], conservationGroupIds: [body-water-momentum-angular-momentum-work], validity: typed validity, error: payload/footprint error, provenance: coupling adapter/revision }
    physicalImpactParents: []
    physicalImpactPartitions: []
    reactionGroups:
      - { reactionGroupId: body-water-reaction-group, contextId: physicsContext.contextId, exchangeId: body-water-exchange, applicationInterval: physicsGraph.coordinationInterval, sourceInteractionIds: [body-to-water-moving-boundary], reactionInteractionIds: [hydrodynamic-load], acceptance: all-or-none, orderedReduction: deterministic tree plus declared floating-point mode, balanceFrameId: physicsContext.physicsRootFrameId, physicsOriginEpoch: physicsContext.physicsOriginEpoch, balanceTransformRevision: physicsContext.worldTransformRevision, balanceReferencePoint: fixed inertial point in the balance frame, conservationGroupIds: [body-water-momentum-angular-momentum-work], residualsAndBounds: force/impulse, torque/angular-impulse, and interface-work residuals with Gated bounds }
    conservationGroups: [{ type: ConservationGroup, conservationGroupId: body-water-momentum-angular-momentum-work, contextId: physicsContext.contextId, interval: physicsGraph.coordinationInterval, participants: [external rigid-body owner, $threejs-water-optics], referencePhysicsFrameId: physicsContext.physicsRootFrameId, physicsOriginEpoch: physicsContext.physicsOriginEpoch, transformRevision: physicsContext.worldTransformRevision, angularMomentumReference: fixed inertial balance point, commodities: [linear-momentum, angular-momentum, energy], explicitConstraints: [], initialInventory: typed map, finalInventory: typed map, externalSources: typed map, boundaryFluxes: typed map, numericalResidual: typed map, residualNorms: typed map, acceptanceBounds: Gated typed map }]
    couplingLoopId: body-water-semi-implicit-loop
    stabilityGate: added-mass, nonpenetration, positivity, and force/torque/interface-work residual bounds
    convergence: deterministic bounded iteration residual and status
    batchLedger: { type: InteractionBatchLedger, batchId: body-water-batch, exchangeId: body-water-exchange, producerId: project coupling adapter, publishedSequenceRange: closed monotonic range, perConsumerCursor: per-consumer next sequence, acceptedRejectedLateDuplicate: typed labelled counts, overflowPolicy: reject-batch, overflowSequenceRanges: explicit ranges, lostCommodities: typed zero-or-failed-conservation commodity map, deferredCommodities: typed commodity map, applicationLedgerIds: exact InteractionApplicationLedger IDs whose dispositions cover publishedSequenceRange, exactOnceApplicationLedgerVersion: opaque version }
physicsCoordinationAdvanceRecords:
  canonicalExpansion: required before emitted-manifest validation
  records: exact PhysicsCoordinationAdvanceRecord records keyed by coordinationAdvanceId, each closing stage executions, dependency completions, state-advance claims, application ledgers, commit receipt, debt arithmetic, and status for one coordination interval
physicsInteractionApplicationLedgers:
  canonicalExpansion: required before emitted-manifest validation
  records: exact InteractionApplicationLedger records for every prepared/committed/deferred/rejected/duplicate interaction disposition; [] only when physicsInteractions is []
physicsCommitTransactions:
  canonicalExpansion: required before emitted-manifest validation
  records: exact PhysicsCommitTransaction records keyed by every commitGroup.commitTransactionId with prepared-publication bijection, gate results, one commit instant, receipt, and rollback disposition
physicsQualityRequests:
  canonicalExpansion: required before emitted-manifest validation
  records: exact QualityChangeRequest records keyed by requestId; each transition requestId/requestSequence/scope/controls/evidence digest resolves one immutable request and its admission
physicsQualityStates:
  canonicalExpansion: required before emitted-manifest validation
  records: exact PhysicsQualityStateDescriptor records keyed by qualityStateId for every active, source, and destination state referenced by a request, admission, transition, conservative map, or cost ledger
physicsQualityTransitions:
  canonicalExpansion: required before emitted-manifest validation
  records: exact QualityTransition records for every admitted QualityChangeRequest; [] only when no quality transition is admitted in the covered interval
physicsPresentationTimeCohortsById:
  external-body-water-inspection-cohort: { type: PresentationTimeCohort, timeCohortId: external-body-water-inspection-cohort, presentationClockId: presentation-clock, presentationOpportunitySequence: exact monotonic integer, previousRequestedPresentationInstant: exact previous presentation PhysicsInstant, currentRequestedPresentationInstant: exact current presentation PhysicsInstant, requestedPresentationInstant: same current PhysicsInstant, requiredContextIds: [physicsContext.contextId], requiredDiscontinuityEpochs: { physicsContext.contextId: exact body-water discontinuity epoch }, maximumInterContextSkew: zero for one context, maximumCandidateAge: Gated PhysicsDuration, admissionPolicy: bounded-mapped-skew, cohortSpecificationDigest: canonical cohort specification digest }
physicsPresentationCandidate:
  type: PhysicsPresentationCandidate
  producer: route physics coordinator
  consumers: [inspection-view camera owner, route presentation assembler]
  candidateId: runtime-id
  contextId: physicsContext.contextId
  presentationEpoch: exact route presentation epoch
  timeCohortId: external-body-water-inspection-cohort
  requestedPresentationInstant: physicsPresentationTimeCohortsById.external-body-water-inspection-cohort.currentRequestedPresentationInstant
  physicsOriginEpoch: physicsContext.physicsOriginEpoch
  commitProvenance: exact CandidateCommitProvenance resolving body/manifold/water/support versions to body-water commit receipt IDs/digests
  candidateScope: committed-state-brackets-leases-and-events
  contents: requestedPresentationInstant plus committed body/water/support per-binding/provider PresentedStatePair entries with independent previous/current provenance, physics-qualified immutable state handles, exact CPU/GPU/external leases, and eventSequenceRanges; contains no camera, render origin, view/projection matrix, shadow/cache epoch, or global-to-render transform
  presentedStatePairs: canonicalExpansion(required complete per-binding PresentedStatePair records)
  resourceLeases: canonicalExpansion(required complete Candidate-scoped PresentationResourceLease records)
  eventSequenceRanges: canonicalExpansion(required complete PresentationEventRange records)
  qualityMigration: a prepared QualityTransition commits at commitInstant (PhysicsInstant) through its own all-or-none commit group with conservative restriction/prolongation/reset, interaction-queue boundary, conserved-value/error gates, collider/manifold/warm-start policy, atomic versions, ConsumerCompletionJoin retirement, scoped actions, and rollback before candidate publication; changing solver class or physical law is forbidden as a tier
physicsCameraViewPublicationsByTarget:
  main/inspection-view: { type: CameraViewPublication, cameraPublicationId: runtime-id, candidateId: physicsPresentationCandidate.candidateId, owner: inspection-view camera owner, presentationTargetId: main, viewId: inspection-view, cameraId: inspection-camera, contents: previous/current PhysicsInstant, source-qualified previous/current RenderSimilarityTransform, unjittered view/projection matrices, jitter convention, viewport/DPR/extent, depth convention, projection validity/error }
physicsViewPreparationPublicationsByTarget:
  main/inspection-view: { type: ViewPreparationPublication, viewPreparationId: runtime-id, candidateId: physicsPresentationCandidate.candidateId, cameraPublicationId: physicsCameraViewPublicationsByTarget["main/inspection-view"].cameraPublicationId, presentationTargetId: main, viewId: inspection-view, resourceLeases: full PresentationResourceLease records for newly created camera-dependent resources, resourceLeaseRefs: exact Candidate and same-preparation refs, contents: visibility/acceleration/shadow/cache refs, reactive publications, reset DAG, exact PresentationResourceLeaseRefs }
physicsPresentationSnapshotsByTarget:
  main/inspection-view: { type: PhysicsPresentationSnapshot, snapshotId: runtime-id, producer: route presentation sealer, candidateId: physicsPresentationCandidate.candidateId, cameraPublicationId: physicsCameraViewPublicationsByTarget["main/inspection-view"].cameraPublicationId, viewPreparationId: physicsViewPreparationPublicationsByTarget["main/inspection-view"].viewPreparationId, presentationTargetId: main, viewId: inspection-view, presentedStatePairRefs: candidate binding IDs, resourceLeaseRefs: exact transitive refs, eventSequenceRanges: candidate ranges, closureManifest: { type: PresentationClosureManifest, snapshotId: same runtime-id, pairStateHandleLeaseIds: exact body/water/support previous/current lease IDs, preparationDependencyLeaseIds: exact inspection-view preparation dependency lease IDs, reactiveAndResetLeaseIds: exact body/water motion/disocclusion reactive/reset lease IDs, shadowCacheVisibilityLeaseIds: exact inspection-view shadow/cache/visibility lease IDs, exactRequiredLeaseIds: canonical sorted union of all preceding lease IDs and no others, exactEventRangeIds: canonical sorted exact inspection-view event range IDs, dependencyDagDigest: collision-resistant digest of canonical dependency DAG, closureDigest: collision-resistant digest of canonical IDs and edges }, sealVersion: runtime-version, consumers: [body/water scene passes, motion-vector generation, $threejs-visual-validation] }
physicsPresentationRenderPlansByTarget:
  main/inspection-view: { type: PresentationRenderPlan, renderPlanId: external-body-water-inspection-render-plan, timeCohortId: external-body-water-inspection-cohort, candidateId: physicsPresentationCandidate.candidateId, snapshotId: physicsPresentationSnapshotsByTarget["main/inspection-view"].snapshotId, presentationTargetId: main, viewId: inspection-view, phaseIds: exact opaque/water-composite/present IDs, phaseRecords: complete RenderPlanPhase records using the performance pass keys, edges: complete RenderPlanEdge DAG with dependency completions/resource generations, requiredPreparationEdgeIds: exact inspection-view preparation edge IDs, renderResourceLeaseIds: exact inspection-view render lease IDs, plannedResetActionIds: exact reset IDs, expectedResetHistoryGenerations: exact per-action generation map, shadowFactorIds: exact once-applied shadow factor IDs or empty, closureDigest: canonical plan closure digest, immutablePlanDigest: canonical immutable plan digest }
frameExecutionRecord:
  type: FrameExecutionRecord
  producer: $threejs-image-pipeline frame executor
  consumers: [$threejs-visual-validation, performance evidence]
  executionId: unique append-only presentation execution
  timeCohortId: external-body-water-inspection-cohort
  candidateIds: [physicsPresentationCandidate.candidateId]
  cohortAdmission: exact admitted FrameCohortAdmission
  renderPlans: [physicsPresentationRenderPlansByTarget["main/inspection-view"]]
  slotAdmissions: [exact admitted main/inspection-view FrameSlotAdmission]
  requiredTargetViewKeys: [main/inspection-view]
  snapshotIds: [physicsPresentationSnapshotsByTarget["main/inspection-view"].snapshotId]
  overallStatus: submitted | completed | partial-failure | aborted | device-lost
  backendGeneration: exact backend generation
  deviceLossGeneration: exact device-loss generation
  targetExecutions:
    main/inspection-view: { snapshotId: physicsPresentationSnapshotsByTarget["main/inspection-view"].snapshotId, renderPlanId: exact admitted inspection-view render plan ID, slotAdmissionId: exact admitted main/inspection-view slot ID, presentationTargetId: main, viewId: inspection-view, status: submitted | completed | failed | aborted | device-lost, submittedPasses: exact pass/dispatch keys, queueSubmissionEpochs: ordered epochs, actionResults: typed results, resetActionResults: exact planned reset results, completionTokens: exact tokens, presentedTimestamp: mapped presentation-clock PhysicsInstant or TypedAbsence(not-applicable, record authority, record interval, sketch provenance), failure: typed failure or TypedAbsence(not-applicable, record authority, record interval, sketch provenance) }
  leaseDispositionById:
    lease-id: { disposition: retained-until-join | retired-after-abort | invalidated-by-device-loss, consumingSnapshotIds: [physicsPresentationSnapshotsByTarget["main/inspection-view"].snapshotId], completionJoin: { simulationConsumers: [typed tokens], couplingConsumers: [typed tokens], externalConsumers: [typed tokens], presentationConsumers: [typed tokens], deviceLossRetirementPath: typed rule }, retirementEvidence: typed completion-or-loss record }
  immutability: completion never mutates candidate, camera publication, view-preparation publication, or snapshot
physicsPresentationSnapshot: not used # deprecated compatibility projection; never allocated
requiredSignals:
  sceneColorRegistry:
    inspection-view: { producer: shared body/water scene pass, consumers: [presentation] }
  depthRegistry:
    inspection-view: { producer: shared opaque scene pass, consumers: [water thickness/occlusion] }
  normalRegistry: not used by post
  velocityRegistry:
    inspection-view: { producer: body/water presentation snapshot adapter, consumers: [motion-vector validation] }
  objectIdRegistry: not used unless picking is accepted
  historyRegistry: not used until a named temporal estimator is selected
outputOwnersByPresentationTarget:
  main: { toneMap: $threejs-image-pipeline, outputTransform: $threejs-image-pipeline, adaptiveQuality: $threejs-image-pipeline }
sharedResourceOwners:
  gbuffer: not used
  depth: $threejs-image-pipeline
  normal: not used
  velocity: physics presentation adapter
  history: not used
  weatherEnvelope: not used
  toneMap: $threejs-image-pipeline
  outputTransform: $threejs-image-pipeline
  adaptiveResolution: $threejs-image-pipeline
coverageStatus: partial
coverageBlockers: the external solver, body/collider/material registries, static-support adapter, and conservative coupling adapter are authoritative project inputs outside this pack; the selected skills own bounded water, rendering, and validation after those interfaces pass the contract
performanceContract:
  routeStatus: provisional
  frameInterval: { value: 16.6667, unit: ms, label: Derived, source: frozen-60-Hz-target }
  skillTierCrosswalk: { status: required-before-acceptance, rule: map every selected skill local tier explicitly to route Full/Budgeted/Minimum viable with protected invariants and explicit unsupported-tier mappings; no implicit name equality }
  passKeys: [physics.ingest, physics.sample-support, physics.body-water-predict, physics.body-water-emit-interactions, physics.external-body-subcycles, water.solve-subcycles, physics.body-water-reduce-reactions, physics.body-water-correct, physics.prepare-publications, physics.commit-transaction, physics.publish-candidate, inspection-view.camera-publication, inspection-view.prepare, inspection-view.opaque-scene, inspection-view.water-composite, inspection-view.seal, main.present]
  accounting: external solver, coupling, water, snapshot, and render work are separate unique keys; readback validation is not steady-state work
  mobileGate: batch water/hull queries in their consuming residency, compact active coupling footprints, retain bounded SoA exchanges and resource leases, record external synchronization/traffic, prohibit frame-loop readback, and count old/new migration plus frames-in-flight peak bytes
  qualityAdaptation: the render governor requests changes, but only a coordinator-admitted QualityTransition at a declared coordination-interval commitInstant (PhysicsInstant) may migrate physics state
acceptanceEvidence:
  requiredDebugViews: [frames/epochs/provider versions, PhysicsGraph executed stages/edges, body/collider/material IDs, support/water samples, coupling footprint, paired interaction signs, conservation residual, candidate/resource leases, per-view snapshot, FrameExecutionRecord, no-post]
  requiredMetrics: [body/water force torque impulse and interface-work residuals, gather/scatter moment preservation, coupling-iteration convergence and rollback count, penetration, water positivity, provider error/age/filter, exactly-once ordering plus exchange-owned lost/deferred commodity evidence, candidate/camera/view-preparation/snapshot immutability, rebase-zero-motion, quality-transition rollback, "p50/p95 [Measured] solver/coupling/composed timing"]
  requiredCommands: [external-solver replay comparison, installed-source API assertions, project validation/capture command]
  requiredArtifacts: [versioned solver/adapter manifest, deterministic coupling replay, conservation report, fixed camera path, pass ledger, sustained target trace]
```

## black-hole shot

Input brief: curved-ray black hole, accretion disk, star field, and camera
push-in with deferred bloom/exposure.

minimal skill set:

```yaml
backendManifest: "populate required [Gated] and observed [Measured] fields from canonical preflight"
workloadProfile:
  domain: cinematic-art
  intent: present
  truthContract: physically-plausible
  representation: volume-field
  interaction: fixed-view
  temporal: deterministic-animation
  scale: object
  deployment: "brief-defined WebGPU matrix"
causeLedger:
  sourceOfTruth: authored metric/lensing model and disk emission model
  primaryObservable: bounded curved-ray lensing with stable termination and disk transmittance
  earliestMissingLayer: transport-volume
  selectedAlgorithm: bounded adaptive curved-ray integration with explicit termination diagnostics
  rejectedAlgorithms:
    - screen warp: lacks ray-domain geometry and termination semantics
    - particles: cannot cause gravitational lensing
  noPostBaseline: lensing, disk structure, and star deflection read without bloom/grading
selectedSkills:
  - $threejs-black-holes-and-space-effects
  - $threejs-camera-controls-and-rigs
  - $threejs-image-pipeline
  - $threejs-visual-validation
primaryOwner: $threejs-black-holes-and-space-effects
deferredSkills:
  - $threejs-bloom
  - $threejs-exposure-color-grading
omittedSkills:
  - $threejs-particles-trails-and-effects: no transient particle cause
  - $threejs-sky-atmosphere-and-haze: no planetary atmosphere cause
owners:
  sourceOfTruth: $threejs-black-holes-and-space-effects
  representation: $threejs-black-holes-and-space-effects
  spatialFrame: $threejs-camera-controls-and-rigs
  timebase: authored shot clock
  semanticIds: not used
  selectionPicking: not used
  clipSection: not used
  presentation: $threejs-image-pipeline
  validation: $threejs-visual-validation
requiredSignals:
  sceneColorRegistry:
    shot-view: { producer: curved-ray output, consumers: [presentation] }
  depthRegistry: not used
  normalRegistry: not used
  velocityRegistry: not used until a temporal consumer is selected
  objectIdRegistry: not used
  historyRegistry: not used until a named temporal estimator is selected
domainSignals:
  rayDiagnostics: { producer: $threejs-black-holes-and-space-effects, consumers: [validation] }
physicsContext: not used
physicsGraph: not used
physicsCostLedger: not used
physicsSignals: {}
physicsInteractions: []
physicsPresentationCandidate: not used
physicsCameraViewPublicationsByTarget: {}
physicsViewPreparationPublicationsByTarget: {}
physicsPresentationSnapshotsByTarget: {}
frameExecutionRecord: not used
physicsPresentationSnapshot: not used # deprecated compatibility projection; never allocated
outputOwnersByPresentationTarget:
  main: { toneMap: $threejs-image-pipeline, outputTransform: $threejs-image-pipeline, adaptiveQuality: $threejs-image-pipeline }
sharedResourceOwners:
  gbuffer: not used
  depth: not used
  normal: not used
  velocity: not used
  history: not used
  weatherEnvelope: not used
  toneMap: $threejs-image-pipeline
  outputTransform: $threejs-image-pipeline
  adaptiveResolution: $threejs-image-pipeline
coverageStatus: complete
performanceContract:
  routeStatus: provisional
  skillTierCrosswalk: { status: required-before-acceptance, rule: map every selected skill local tier explicitly to route Full/Budgeted/Minimum viable with protected invariants and explicit unavailable mappings; no implicit name equality }
  frameInterval: { value: "", unit: ms, label: Derived, source: "1000 ms / [Gated] frozen target refresh" }
  passKeys: [shot-view.curved-ray, main.present]
  accounting: measured ray-pass marginal and composed presentation; no fixed post overhead
  qualityAdaptation: preserve lensing/termination error; reduce march extent or resolution only within visual gates
acceptanceEvidence:
  requiredDebugViews: [step count, steering magnitude, transmittance, termination ID, no-post]
  requiredMetrics: ["p50/p95 [Measured] composed timing", lensing error, termination rate, temporal stability]
  requiredCommands: [installed-source API assertions, project validation/capture command]
  requiredArtifacts: [fixed camera-path captures, diagnostic bundle, sustained target trace]
```

## product scene

Input brief: imported glTF product configurator with stable part variants,
material polish, inspection camera, shadows, reflections, and color-managed
output.

minimal skill set:

```yaml
backendManifest: "populate required [Gated] and observed [Measured] fields from canonical preflight"
workloadProfile:
  domain: product-configurator
  intent: configure
  truthContract: identity
  representation: imported-hierarchy
  interaction: direct-manipulation
  temporal: sparse-events
  scale: object
  deployment: "brief-defined desktop/mobile WebGPU matrix"
causeLedger:
  sourceOfTruth: imported product hierarchy, stable part IDs, and variant table
  primaryObservable: exact silhouette/part identity and consistent material/color response across variants
  earliestMissingLayer: material
  selectedAlgorithm: preserve imported hierarchy; update material/visibility state without rebuilding geometry
  rejectedAlgorithms:
    - procedural replacement geometry: violates product identity
    - bloom/AO polish: cannot repair BRDF, lighting, or color-management errors
  noPostBaseline: product silhouette, variants, and material response read under neutral output
selectedSkills:
  - $threejs-procedural-materials
  - $threejs-camera-controls-and-rigs
  - $threejs-image-pipeline
  - $threejs-visual-validation
primaryOwner: $threejs-procedural-materials
deferredSkills:
  - $threejs-scalable-real-time-shadows
  - $threejs-exposure-color-grading
omittedSkills:
  - $threejs-procedural-geometry: authoritative imported silhouette must be preserved
  - asset pipeline: glTF/KTX2/Meshopt/DRACO ownership is outside this pack
  - general lighting/reflections: missing expert owner; use official Three.js IBL/PMREM/reflection guidance
owners:
  sourceOfTruth: project product/asset layer outside pack
  representation: imported hierarchy plus $threejs-procedural-materials
  spatialFrame: $threejs-camera-controls-and-rigs
  timebase: configurator transaction state
  semanticIds: project product/asset layer
  selectionPicking: project interaction layer outside pack
  clipSection: not used
  presentation: $threejs-image-pipeline
  validation: $threejs-visual-validation
requiredSignals:
  sceneColorRegistry:
    product-view: { producer: product scene pass, consumers: [presentation] }
  depthRegistry: not used until a depth consumer is selected
  normalRegistry: not used by post; surface normals remain material inputs
  velocityRegistry: not used
  objectIdRegistry: conditional project picking/outline signal with explicit consumer
  historyRegistry: not used
domainSignals:
  variantState: { producer: project configurator, consumers: [material/visibility binding, validation] }
physicsContext: not used
physicsGraph: not used
physicsCostLedger: not used
physicsSignals: {}
physicsInteractions: []
physicsPresentationCandidate: not used
physicsCameraViewPublicationsByTarget: {}
physicsViewPreparationPublicationsByTarget: {}
physicsPresentationSnapshotsByTarget: {}
frameExecutionRecord: not used
physicsPresentationSnapshot: not used # deprecated compatibility projection; never allocated
outputOwnersByPresentationTarget:
  main: { toneMap: $threejs-image-pipeline, outputTransform: $threejs-image-pipeline, adaptiveQuality: $threejs-image-pipeline }
sharedResourceOwners:
  gbuffer: not used
  depth: not used
  normal: not used
  velocity: not used
  history: not used
  weatherEnvelope: not used
  toneMap: $threejs-image-pipeline
  outputTransform: $threejs-image-pipeline
  adaptiveResolution: $threejs-image-pipeline
coverageStatus: partial
performanceContract:
  routeStatus: provisional
  skillTierCrosswalk: { status: required-before-acceptance, rule: map every selected skill local tier explicitly to route Full/Budgeted/Minimum viable with protected invariants and explicit unavailable mappings; no implicit name equality }
  frameInterval: { value: "", unit: ms, label: Derived, source: "1000 ms / [Gated] frozen target refresh" }
  passKeys: [product-view.scene, main.present]
  blockers: asset optimization and lighting/reflection ownership require official/project guidance
  qualityAdaptation: preserve variant identity, silhouette, picking, and color gates before reducing presentation cost
acceptanceEvidence:
  requiredDebugViews: [part IDs, variant state, material channels, color/output ledger, no-post]
  requiredMetrics: ["p50/p95 [Measured] interaction and composed timing", variant correspondence, color/material error gates]
  requiredCommands: [installed-source API assertions, project validation/capture command]
  requiredArtifacts: [variant sweep, fixed product views, source/representation ownership ledger, sustained mobile trace]
```

## post-heavy dashboard

Input brief: operational data scene with dense glyphs, selection, UI overlay,
optional glow, depth cueing, AO, and grading.

This recipe deliberately routes data representation before post. “Post-heavy”
is presentation intent, not the primary cause.

minimal skill set:

```yaml
backendManifest: "populate required [Gated] and observed [Measured] fields from canonical preflight"
workloadProfile:
  domain: data-scene
  intent: monitor
  truthContract: metric
  representation: points-glyphs
  interaction: direct-manipulation
  temporal: streamed-deltas
  scale: multiscale
  viewPattern: overview-to-detail
  deployment: "brief-defined desktop/mobile WebGPU matrix"
causeLedger:
  sourceOfTruth: versioned operational dataset and mapping specification
  primaryObservable: faithful value/category/identity mapping under filtering, occlusion, and selection
  earliestMissingLayer: geometry
  selectedAlgorithm: stable-ID instanced/batched glyph representation with explicit transfer/legend policy
  rejectedAlgorithms:
    - bloom-first graph: cannot establish data geometry, value mapping, or identity
    - full MRT by default: no allocation without named consumers and mobile A/B
  noPostBaseline: values, missing data, selection, and UI-safe output remain readable with AO/glow/grading disabled
selectedSkills:
  - $threejs-procedural-geometry
  - $threejs-procedural-materials
  - $threejs-camera-controls-and-rigs
  - $threejs-image-pipeline
  - $threejs-visual-validation
primaryOwner: $threejs-procedural-geometry
deferredSkills:
  - $threejs-ambient-contact-shading
  - $threejs-bloom
  - $threejs-exposure-color-grading
omittedSkills:
  - UI overlays: DOM/application UI remains outside graphics ownership
  - adaptive exposure on truth layer: would change quantitative display semantics
  - generic data ingestion/picking: missing expert owner outside this pack
owners:
  sourceOfTruth: application data layer outside pack
  representation: $threejs-procedural-geometry
  spatialFrame: $threejs-camera-controls-and-rigs
  timebase: application snapshot/delta clock
  semanticIds: application data layer plus representation binding
  selectionPicking: application interaction layer outside pack
  clipSection: application interaction layer when requested
  presentation: $threejs-image-pipeline
  validation: $threejs-visual-validation
requiredSignals:
  sceneColorRegistry:
    dashboard-view: { producer: data scene pass, consumers: [presentation] }
  depthRegistry:
    dashboard-view: { producer: data scene pass, consumers: [occlusion policy] }
  normalRegistry: not used until AO is accepted
  velocityRegistry: not used unless streamed motion and temporal reconstruction have valid motion data
  objectIdRegistry: conditional; compare on-demand picking with persistent ID attachment
  historyRegistry: not used until a truth-preserving temporal consumer is accepted
domainSignals:
  valueMapping: { producer: application mapping policy, consumers: [material encoding, legend, validation] }
physicsContext: not used
physicsGraph: not used
physicsCostLedger: not used
physicsSignals: {}
physicsInteractions: []
physicsPresentationCandidate: not used
physicsCameraViewPublicationsByTarget: {}
physicsViewPreparationPublicationsByTarget: {}
physicsPresentationSnapshotsByTarget: {}
frameExecutionRecord: not used
physicsPresentationSnapshot: not used # deprecated compatibility projection; never allocated
outputOwnersByPresentationTarget:
  main: { toneMap: fixed truth-preserving policy, outputTransform: $threejs-image-pipeline, adaptiveQuality: $threejs-image-pipeline }
sharedResourceOwners:
  gbuffer: not used
  depth: $threejs-image-pipeline
  normal: not used
  velocity: not used
  history: not used
  weatherEnvelope: not used
  toneMap: fixed truth-preserving policy
  outputTransform: $threejs-image-pipeline
  adaptiveResolution: $threejs-image-pipeline
coverageStatus: partial
performanceContract:
  routeStatus: provisional
  skillTierCrosswalk: { status: required-before-acceptance, rule: map every selected skill local tier explicitly to route Full/Budgeted/Minimum viable with protected invariants and explicit unavailable mappings; no implicit name equality }
  frameInterval: { value: "", unit: ms, label: Derived, source: "1000 ms / [Gated] frozen target refresh" }
  passKeys: [dashboard-view.scene, main.present]
  accounting: composed glyph/selection/presentation path; persistent ID MRT requires target A/B
  qualityAdaptation: preserve mapping, IDs, filters, and selection; classify submit/fill/upload pressure first
acceptanceEvidence:
  requiredDebugViews: [raw-to-visual mapping, stable IDs, missing/out-of-range values, occlusion, selection, no-post]
  requiredMetrics: ["p50/p95 [Measured] update/interaction/composed timing", mapping error, ID correspondence, upload bytes]
  requiredCommands: [installed-source API assertions, project validation/capture command]
  requiredArtifacts: [replayable data trace, filter/selection sweep, pass ledger, sustained target trace]
```

## scientific field inspection

Input brief: inspect a trusted sampled scalar/vector field with an isosurface,
local vector glyphs, probes, and fixed quantitative color mapping.

minimal skill set:

```yaml
backendManifest: "populate required [Gated] and observed [Measured] fields from canonical preflight"
workloadProfile:
  domain: scientific-visualization
  intent: explain
  truthContract: metric
  representation: hybrid
  interaction: direct-manipulation
  temporal: static
  scale: object
  deployment: "brief-defined WebGPU matrix"
causeLedger:
  sourceOfTruth: trusted sampled dataset, units, topology, uncertainty, and reference probes
  userQuestion: boundary location and local vector direction/magnitude
  primaryObservable: isosurface geometry and glyphs agree with reference interpolation within gated error
  earliestMissingLayer: geometry
  selectedAlgorithm: dataset-preserving isosurface plus glyphs and explicit transfer function
  rejectedAlgorithms:
    - procedural field synthesis: would replace measured truth
    - volume-only integration: weak for precise boundary/probe interrogation
    - temporal smoothing: may bias quantitative values
  noPostBaseline: surface, glyphs, probes, range, and uncertainty read without AO/bloom/adaptation
selectedSkills:
  - $threejs-procedural-geometry
  - $threejs-procedural-materials
  - $threejs-camera-controls-and-rigs
  - $threejs-image-pipeline
  - $threejs-visual-validation
primaryOwner: $threejs-procedural-geometry
deferredSkills: []
omittedSkills:
  - $threejs-procedural-fields: source is measured data, not a procedurally authored field
  - $threejs-ambient-contact-shading: quantitative color/occlusion contract does not require AO
  - scientific ingestion/isosurface numerics: dedicated expert owner is missing; use domain/official guidance
owners:
  sourceOfTruth: scientific data layer outside pack
  representation: $threejs-procedural-geometry
  spatialFrame: scientific data layer plus $threejs-camera-controls-and-rigs
  timebase: dataset sample time
  semanticIds: scientific data layer
  selectionPicking: scientific probe layer outside pack
  clipSection: scientific probe/section layer outside pack
  presentation: $threejs-image-pipeline
  validation: $threejs-visual-validation
requiredSignals:
  sceneColorRegistry:
    inspection-view: { producer: scientific scene pass, consumers: [presentation] }
  depthRegistry:
    inspection-view: { producer: scientific scene pass, consumers: [occlusion/section diagnostics] }
  normalRegistry: not used by post
  velocityRegistry: not used
  objectIdRegistry: conditional probe/pick identity signal
  historyRegistry: not used
domainSignals:
  scalarField: { producer: scientific data layer, consumers: [isosurface, color mapping, probes] }
  vectorField: { producer: scientific data layer, consumers: [glyphs, probes] }
physicsContext: not used
physicsGraph: not used
physicsCostLedger: not used
physicsSignals: {}
physicsInteractions: []
physicsPresentationCandidate: not used
physicsCameraViewPublicationsByTarget: {}
physicsViewPreparationPublicationsByTarget: {}
physicsPresentationSnapshotsByTarget: {}
frameExecutionRecord: not used
physicsPresentationSnapshot: not used # deprecated compatibility projection; never allocated
outputOwnersByPresentationTarget:
  main: { toneMap: fixed quantitative transfer, outputTransform: $threejs-image-pipeline, adaptiveQuality: truth-gated controller }
sharedResourceOwners:
  gbuffer: not used
  depth: $threejs-image-pipeline
  normal: not used
  velocity: not used
  history: not used
  weatherEnvelope: not used
  toneMap: fixed quantitative transfer
  outputTransform: $threejs-image-pipeline
  adaptiveResolution: truth-gated controller
coverageStatus: partial
performanceContract:
  routeStatus: provisional
  skillTierCrosswalk: { status: required-before-acceptance, rule: map every selected skill local tier explicitly to route Full/Budgeted/Minimum viable with protected invariants and explicit unavailable mappings; no implicit name equality }
  frameInterval: { value: "", unit: ms, label: Derived, source: "1000 ms / [Gated] frozen target refresh" }
  passKeys: [inspection-view.scene, main.present]
  blockers: domain data ingestion, isosurface numerical policy, and probing remain outside pack
  qualityAdaptation: never change values, transfer semantics, topology, or uncertainty beyond gated error
acceptanceEvidence:
  requiredDebugViews: [dataset coordinates/units, interpolation error, isosurface error, glyph values, uncertainty, no-post]
  requiredMetrics: [reference probe error, topology checks, mapping/legend consistency, "p50/p95 [Measured] composed timing"]
  requiredCommands: [trusted-reference comparison, installed-source API assertions, project validation/capture command]
  requiredArtifacts: [reference dataset manifest, probe report, fixed inspection captures, pass ledger]
```

## AEC BIM coordination

Input brief: navigate and section an imported BIM model while preserving units,
hierarchy, semantic IDs, measurement, and culling completeness.

minimal skill set:

```yaml
backendManifest: "populate required [Gated] and observed [Measured] fields from canonical preflight"
workloadProfile:
  domain: architecture-aec
  intent: coordinate
  truthContract: metric
  representation: imported-hierarchy
  interaction: free-navigation
  temporal: static
  scale: building
  deployment: "brief-defined desktop/mobile WebGPU matrix"
causeLedger:
  sourceOfTruth: BIM hierarchy, units/CRS, transforms, semantic IDs, and source measurements
  primaryObservable: complete spatial/semantic inspection with correct section and measurement results
  earliestMissingLayer: geometry
  selectedAlgorithm: preserve imported hierarchy; chunk/cull by spatial and semantic granularity; use floating origin when gated
  rejectedAlgorithms:
    - procedural-building regeneration: violates imported dimensions and semantics
    - monolithic merge: destroys selection, section, update, and culling granularity
  noPostBaseline: rooms/elements/sections remain legible and measurable without AO/grading
selectedSkills:
  - $threejs-camera-controls-and-rigs
  - $threejs-image-pipeline
  - $threejs-visual-validation
primaryOwner: project BIM representation layer outside pack
deferredSkills:
  - $threejs-scalable-real-time-shadows
  - $threejs-ambient-contact-shading
omittedSkills:
  - $threejs-procedural-buildings-and-cities: procedural grammar is not imported BIM ownership
  - BIM ingestion/LOD/section/picking: dedicated expert owner is missing
owners:
  sourceOfTruth: project BIM/data layer outside pack
  representation: project semantic scene layer outside pack
  spatialFrame: project BIM layer plus $threejs-camera-controls-and-rigs
  timebase: static model/version state
  semanticIds: project BIM layer
  selectionPicking: project interaction layer outside pack
  clipSection: project sectioning layer outside pack
  presentation: $threejs-image-pipeline
  validation: $threejs-visual-validation
requiredSignals:
  sceneColorRegistry:
    review-view: { producer: BIM scene pass, consumers: [presentation] }
  depthRegistry:
    review-view: { producer: BIM scene pass, consumers: [section/occlusion diagnostics when required] }
  normalRegistry: not used until a named consumer is accepted
  velocityRegistry: not used
  objectIdRegistry: conditional semantic picking/outline signal with named consumer
  historyRegistry: not used
domainSignals:
  semanticHierarchy: { producer: project BIM layer, consumers: [visibility, picking, section, validation] }
physicsContext: not used
physicsGraph: not used
physicsCostLedger: not used
physicsSignals: {}
physicsInteractions: []
physicsPresentationCandidate: not used
physicsCameraViewPublicationsByTarget: {}
physicsViewPreparationPublicationsByTarget: {}
physicsPresentationSnapshotsByTarget: {}
frameExecutionRecord: not used
physicsPresentationSnapshot: not used # deprecated compatibility projection; never allocated
outputOwnersByPresentationTarget:
  main: { toneMap: fixed review policy, outputTransform: $threejs-image-pipeline, adaptiveQuality: truth-gated controller }
sharedResourceOwners:
  gbuffer: not used
  depth: $threejs-image-pipeline
  normal: not used
  velocity: not used
  history: not used
  weatherEnvelope: not used
  toneMap: fixed review policy
  outputTransform: $threejs-image-pipeline
  adaptiveResolution: truth-gated controller
coverageStatus: partial
performanceContract:
  routeStatus: provisional
  skillTierCrosswalk: { status: required-before-acceptance, rule: map every selected skill local tier explicitly to route Full/Budgeted/Minimum viable with protected invariants and explicit unavailable mappings; no implicit name equality }
  frameInterval: { value: "", unit: ms, label: Derived, source: "1000 ms / [Gated] frozen target refresh" }
  passKeys: [review-view.scene, main.present]
  accounting: composed navigation/culling/selection/section path; no universal draw cap
  qualityAdaptation: preserve culling completeness, IDs, section, and measurement error before visual polish
acceptanceEvidence:
  requiredDebugViews: [units/axes, origin precision, semantic IDs, culling cells, section, no-post]
  requiredMetrics: [measurement round-trip error, culling completeness, ID correspondence, "p50/p95 [Measured] navigation/interaction timing"]
  requiredCommands: [source-model comparison, installed-source API assertions, project validation/capture command]
  requiredArtifacts: [model/version manifest, section/measurement report, fixed review path, sustained trace]
```

## digital twin operations

Input brief: monitor repeated industrial assets with stable IDs, timestamped
streamed deltas, thermal/state overlays, and sustained overview-to-detail use.

minimal skill set:

```yaml
backendManifest: "populate required [Gated] and observed [Measured] fields from canonical preflight"
workloadProfile:
  domain: digital-twin
  intent: monitor
  truthContract: metric
  representation: hybrid
  interaction: free-navigation
  temporal: streamed-deltas
  scale: building
  topology: repeated
  deployment: "brief-defined desktop/mobile WebGPU matrix"
causeLedger:
  sourceOfTruth: versioned asset graph plus timestamped telemetry/delta stream
  primaryObservable: each rendered entity/state/value corresponds to the correct ID and accepted sample time
  earliestMissingLayer: field
  selectedAlgorithm: retained repeated representation plus bounded dirty updates and explicit interpolation/staleness policy
  rejectedAlgorithms:
    - full scene rebuild per delta: discards stable state and creates upload/CPU churn
    - generic temporal history: cannot define data interpolation or staleness semantics
  noPostBaseline: entity state, age, missing data, alarms, and selection read without glow/AO/grading
selectedSkills:
  - $threejs-procedural-fields
  - $threejs-procedural-geometry
  - $threejs-procedural-materials
  - $threejs-camera-controls-and-rigs
  - $threejs-image-pipeline
  - $threejs-visual-validation
primaryOwner: $threejs-procedural-fields
deferredSkills:
  - $threejs-bloom
omittedSkills:
  - data transport/schema/interpolation service: application ownership outside pack
  - $threejs-procedural-buildings-and-cities: imported facility/asset semantics are authoritative
owners:
  sourceOfTruth: application twin/data layer outside pack
  representation: retained asset representation plus procedural field/material owners
  spatialFrame: application asset graph plus $threejs-camera-controls-and-rigs
  timebase: application sample/interpolation clock
  semanticIds: application twin/data layer
  selectionPicking: application interaction layer outside pack
  clipSection: application interaction layer when requested
  presentation: $threejs-image-pipeline
  validation: $threejs-visual-validation
requiredSignals:
  sceneColorRegistry:
    operations-view: { producer: twin scene pass, consumers: [presentation] }
  depthRegistry: not used until an occlusion/post consumer is named
  normalRegistry: not used by post
  velocityRegistry: not used unless temporal reconstruction has render motion distinct from data interpolation
  objectIdRegistry: conditional stable-ID picking/outline signal
  historyRegistry: not used for data interpolation; keyed render history only if separately accepted
domainSignals:
  entityState: { producer: application twin layer, consumers: [field/material binding, validation] }
  timeAndStaleness: { producer: application twin layer, consumers: [interpolation, display, validation] }
physicsContext: not used
physicsGraph: not used
physicsCostLedger: not used
physicsSignals: {}
physicsInteractions: []
physicsPresentationCandidate: not used
physicsCameraViewPublicationsByTarget: {}
physicsViewPreparationPublicationsByTarget: {}
physicsPresentationSnapshotsByTarget: {}
frameExecutionRecord: not used
physicsPresentationSnapshot: not used # deprecated compatibility projection; never allocated
outputOwnersByPresentationTarget:
  main: { toneMap: fixed operational policy, outputTransform: $threejs-image-pipeline, adaptiveQuality: truth-gated controller }
sharedResourceOwners:
  gbuffer: not used
  depth: not used
  normal: not used
  velocity: not used
  history: not used
  weatherEnvelope: not used
  toneMap: fixed operational policy
  outputTransform: $threejs-image-pipeline
  adaptiveResolution: truth-gated controller
coverageStatus: partial
performanceContract:
  routeStatus: provisional
  skillTierCrosswalk: { status: required-before-acceptance, rule: map every selected skill local tier explicitly to route Full/Budgeted/Minimum viable with protected invariants and explicit unavailable mappings; no implicit name equality }
  frameInterval: { value: "", unit: ms, label: Derived, source: "1000 ms / [Gated] frozen target refresh" }
  passKeys: [twin.apply-deltas, operations-view.scene, main.present]
  accounting: composed render plus upload/update distributions; data transport measured separately
  qualityAdaptation: preserve IDs, state, timestamps, staleness, and alarms; classify upload/CPU/GPU pressure before transition
acceptanceEvidence:
  requiredDebugViews: [stable IDs, sample time/age, dirty updates, missing data, state mapping, no-post]
  requiredMetrics: [delta ordering, dropped-update accounting, state/ID correspondence, upload bytes, "p50/p95 [Measured] update/interaction/composed timing"]
  requiredCommands: [snapshot replay comparison, installed-source API assertions, project validation/capture command]
  requiredArtifacts: [versioned snapshot/delta trace, correspondence report, fixed operations path, sustained trace]
```

## cinematic procedural sculpture

Input brief: authored procedural sculpture with controlled deformation, material
identity, composed camera movement, and deferred image effects.

minimal skill set:

```yaml
backendManifest: "populate required [Gated] and observed [Measured] fields from canonical preflight"
workloadProfile:
  domain: cinematic-art
  intent: present
  truthContract: perceptual-style
  representation: procedural-mesh
  interaction: fixed-view
  temporal: deterministic-animation
  scale: object
  deployment: "brief-defined WebGPU matrix"
causeLedger:
  sourceOfTruth: authored shape grammar, deformation timeline, material palette, and reference frames
  primaryObservable: readable silhouette and deformation rhythm under authored camera/light
  earliestMissingLayer: geometry
  selectedAlgorithm: semantic generated geometry plus analytic motion and material identity
  rejectedAlgorithms:
    - post distortion: cannot create silhouette, intersections, normals, or cast-shadow motion
    - unrelated noise layers: do not explain the reference mechanism
  noPostBaseline: silhouette, deformation, material separation, and composition read without bloom/grading
selectedSkills:
  - $threejs-procedural-geometry
  - $threejs-procedural-materials
  - $threejs-procedural-motion-systems
  - $threejs-camera-controls-and-rigs
  - $threejs-image-pipeline
  - $threejs-visual-validation
primaryOwner: $threejs-procedural-geometry
deferredSkills:
  - $threejs-bloom
  - $threejs-exposure-color-grading
omittedSkills:
  - $threejs-particles-trails-and-effects: no particle/event cause in the brief
  - general lighting/reflections: missing expert owner; use official Three.js guidance
owners:
  sourceOfTruth: authored sculpture specification
  representation: geometry/material owners
  spatialFrame: $threejs-camera-controls-and-rigs
  timebase: $threejs-procedural-motion-systems
  semanticIds: sculpture part registry
  selectionPicking: not used
  clipSection: not used
  presentation: $threejs-image-pipeline
  validation: $threejs-visual-validation
requiredSignals:
  sceneColorRegistry:
    shot-view: { producer: sculpture scene pass, consumers: [presentation] }
  depthRegistry: not used until a depth consumer is selected
  normalRegistry: not used by post
  velocityRegistry: not used until a temporal consumer is selected and deformation velocity is valid
  objectIdRegistry: not used
  historyRegistry: not used
domainSignals:
  deformationState: { producer: $threejs-procedural-motion-systems, consumers: [geometry/material, validation] }
physicsContext: not used
physicsGraph: not used
physicsCostLedger: not used
physicsSignals: {}
physicsInteractions: []
physicsPresentationCandidate: not used
physicsCameraViewPublicationsByTarget: {}
physicsViewPreparationPublicationsByTarget: {}
physicsPresentationSnapshotsByTarget: {}
frameExecutionRecord: not used
physicsPresentationSnapshot: not used # deprecated compatibility projection; never allocated
outputOwnersByPresentationTarget:
  main: { toneMap: $threejs-image-pipeline, outputTransform: $threejs-image-pipeline, adaptiveQuality: $threejs-image-pipeline }
sharedResourceOwners:
  gbuffer: not used
  depth: not used
  normal: not used
  velocity: not used
  history: not used
  weatherEnvelope: not used
  toneMap: $threejs-image-pipeline
  outputTransform: $threejs-image-pipeline
  adaptiveResolution: $threejs-image-pipeline
coverageStatus: complete
performanceContract:
  routeStatus: provisional
  skillTierCrosswalk: { status: required-before-acceptance, rule: map every selected skill local tier explicitly to route Full/Budgeted/Minimum viable with protected invariants and explicit unavailable mappings; no implicit name equality }
  frameInterval: { value: "", unit: ms, label: Derived, source: "1000 ms / [Gated] frozen target refresh" }
  passKeys: [sculpture.update, shot-view.scene, main.present]
  accounting: unique generated-geometry/material/motion work plus measured full frame
  qualityAdaptation: preserve silhouette and motion contract before reducing secondary material/image cost
acceptanceEvidence:
  requiredDebugViews: [semantic mesh groups, deformation phase, material channels, camera framing, no-post]
  requiredMetrics: [geometry invariants, motion continuity, reference-frame comparison, "p50/p95 [Measured] composed timing"]
  requiredCommands: [installed-source API assertions, project validation/capture command]
  requiredArtifacts: [reference/fixed shot captures, deformation sweep, pass ledger, sustained target trace]
```
