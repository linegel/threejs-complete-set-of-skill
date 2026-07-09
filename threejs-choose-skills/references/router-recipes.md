# Router Recipes

These are routing proofs, not presets. Each route still requires the mandatory
backend/API preflight and a populated `{ value, unit, label, source }` record for
every reported number. `routeStatus: provisional` means no performance verdict
exists until the composed route passes `[Measured]` CPU/GPU/presentation p50 and
p95, memory, error, and sustained-state gates on its target matrix.

`sharedResourceOwners` is the compatibility projection required by existing
route tooling. `not used` means no allocation. The keyed signal registries are
authoritative.

For compactness, `passKeys` below names the unique runtime work. The emitted
manifest expands each key into the canonical view-scoped `passRecord`, supplies
`costRecords`, and instantiates the hysteretic `qualityController`; a key is
counted once regardless of how many skills consume it.

## stylized coastal archipelago

Input brief: the supplied isometric archipelago reference family: compact
islands with grass caps, terraced rock cliffs, beaches, shallow turquoise
bathymetry, deep-blue open water, shore-aligned foam, reefs and rocks, plus
constrained vegetation, ruins, docks, boats, and optional foreground clouds.

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

```yaml
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
  landSignedDistance: { producer: $threejs-procedural-fields, consumers: [terrain compiler, beach bands, water boundary, foam source, asset exclusion] }
  terrainElevationAndRegions: { producer: $threejs-procedural-fields, consumers: [terrain geometry, materials, anchor compilation, placement-factor consumers] }
  bathymetryAndCoastFrame: { producer: $threejs-procedural-fields, consumers: [water regime selection, optics, breaking/foam, validation] }
  terrainMesh: { producer: $threejs-procedural-geometry, consumers: [scene pass, geometry validation] }
  terrainAnchors: { producer: $threejs-procedural-geometry, consumers: [vegetation/site placement compilers, validation] }
  waterState: { producer: $threejs-water-optics, consumers: [water geometry, normals, optics, foam, validation] }
  assetPlacement: { producer: vegetation/building grammar owners, consumers: [scene pass, validation] }
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
coverageStatus: partial
coverageBlockers: general prop-kit generation, lighting/environment authorship, and asset preparation/compression remain project or dedicated-skill inputs unless the required modules and metadata are supplied
```

If run-up, conservative flow, interaction, or persistent transported foam is
required, emit a separate persistent-state manifest. Do not place alternatives
inside one workload-profile enum:

```yaml
routeVariant: persistent-water-state
workloadProfile:
  temporal: simulation
causeLedger:
  selectedAlgorithm: shared coastal fields plus sparse active-tile, well-balanced, positivity-preserving nonlinear Saint-Venant nearshore dynamics with one declared wet/dry policy; $threejs-water-optics owns water state, boundaries, foam transport, optics, and presentation interpolation
owners:
  timebase: fixed-step water/foam clock plus explicit presentation interpolation
requiredSignals:
  historyRegistry:
    foam: { producer: water foam update, consumers: [water shading, validation], reset: seed/shoreline/tier/extent changes }
domainSignals:
  waterState: { producer: $threejs-water-optics, consumers: [water geometry, normals, optics, foam, validation] }
sharedResourceOwners:
  history: $threejs-water-optics
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

The persistent nearshore-plus-foam variant replaces only the steady-work fields
below; its keys are real selected work, not optional entries in the analytic
ledger.

```yaml
routeVariant: persistent-water-state
uniqueWorkLedger:
  simulationStep:
    - water.nearshore-update: "accepted dynamics require local state"
    - water.foam-update: "one source/advection/decay owner"
performanceContract:
  passKeys: [water.nearshore-update, water.foam-update, design-view.opaque-scene, design-view.water-composite, main.present]
```

A spectral offshore donor is a third, separately emitted manifest. It selects
the spectral skill instead of leaving it deferred, names one combined coastal
state owner, and adds the donor update explicitly:

```yaml
routeVariant: spectral-offshore-plus-persistent-nearshore
workloadProfile:
  temporal: simulation
selectedSkills:
  - $threejs-procedural-fields
  - $threejs-procedural-geometry
  - $threejs-procedural-materials
  - $threejs-spectral-ocean
  - $threejs-water-optics
  - $threejs-procedural-vegetation
  - $threejs-procedural-buildings-and-cities
  - $threejs-camera-controls-and-rigs
  - $threejs-image-pipeline
  - $threejs-visual-validation
deferredSkills:
  - $threejs-sky-atmosphere-and-haze: load only when aerial depth is observable
  - $threejs-volumetric-clouds: load only when clouds are volumetric scene subjects
  - $threejs-procedural-motion-systems: load for authored boat or prop trajectories, not for water evolution
causeLedger:
  selectedAlgorithm: $threejs-spectral-ocean owns the homogeneous periodic offshore directional-spectrum donor; $threejs-water-optics owns covariance-aware boundary reconstruction, the sparse well-balanced nonlinear Saint-Venant nearshore state, the single partition-of-unity spatial handoff, and the sole foam/optics history
domainSignals:
  offshoreSpectrum: { producer: $threejs-spectral-ocean, consumers: [$threejs-water-optics coastal boundary adapter, validation] }
  waterState: { producer: $threejs-water-optics, contributors: [$threejs-spectral-ocean], consumers: [water geometry, normals, optics, foam, validation] }
owners:
  timebase: one fixed-step spectral/nearshore/foam clock plus explicit presentation interpolation
uniqueWorkLedger:
  simulationStep:
    - water.open-update: "selected spectral donor evolution"
    - water.nearshore-update: "accepted nonlinear nearshore dynamics"
    - water.foam-update: "one source/advection/decay owner"
performanceContract:
  passKeys: [water.open-update, water.nearshore-update, water.foam-update, design-view.opaque-scene, design-view.water-composite, main.present]
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
    - no-post, water contribution, opaque depth, final output, and every active history
  requiredMetrics:
    - coastline zero-contour versus rendered land-water intersection boundary error in world and physical-pixel domains
    - overlap/gap occupancy, bathymetry continuity and depth-order agreement, terrain seam and normal error
    - foam source precision/recall against the coast/breaker mask, on-land leakage, temporal flicker, and reset residual
    - water-state stability plus positivity/conservation/boundary residual only for solvers claiming those invariants
    - asset support penetration/floating error, slope/exclusion violations, placement-distribution error, and seed stability
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
    - unique pass/resource ledger, target and storage inventories, traffic model, governor trace, lifecycle loop, and sustained physical-target traces
```

## ocean planet

Input brief: orbit-to-horizon procedural planet with spectral ocean,
atmosphere, optional clouds, and cinematic output.

minimal skill set:

```yaml
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
  timebase: spectral-ocean simulation clock
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
  oceanField: { producer: $threejs-spectral-ocean, consumers: [ocean geometry, ocean material] }
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
coverageStatus: complete
performanceContract:
  routeStatus: provisional
  frameInterval: { value: "", unit: ms, label: Derived, source: "1000 ms / [Gated] frozen target refresh" }
  passKeys: [ocean.simulation, primary-view.scene, main.present]
  accounting: unique pass union plus composed full-frame measurement; no skill-max sum
  mobileGate: A/B minimal attachments against every proposed shared MRT output
  qualityAdaptation: hysteretic bottleneck-specific transaction preserving horizon and planet error gates
acceptanceEvidence:
  requiredDebugViews: [planet height/LOD, ocean displacement/derivatives, atmosphere depth, no-post]
  requiredMetrics: ["p50/p95 [Measured] composed timing", geometric continuity, temporal stability, logical attachment bytes]
  requiredCommands: [installed-source API assertions, project validation/capture command]
  requiredArtifacts: [fixed orbit/horizon captures, pass ledger, sustained target traces]
```

## rainy city street

Input brief: procedurally authored street with buildings, rain, wet surfaces,
local puddles, splashes, and shared presentation.

minimal skill set:

```yaml
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
  sourceOfTruth: authored street geometry and shared weather state
  primaryObservable: causally coupled rainfall, impacts, wetness, and bounded puddle response
  earliestMissingLayer: motion
  selectedAlgorithm: shared weather envelope plus sparse precipitation/impacts and bounded puddle optics
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
  sourceOfTruth: $threejs-rain-snow-and-wet-surfaces
  representation: building/weather/water owners
  spatialFrame: $threejs-procedural-buildings-and-cities
  timebase: shared weather clock
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
  weatherEnvelope: { producer: $threejs-rain-snow-and-wet-surfaces, consumers: [rain, impacts, wetness, puddles] }
outputOwnersByPresentationTarget:
  main: { toneMap: $threejs-image-pipeline, outputTransform: $threejs-image-pipeline, adaptiveQuality: $threejs-image-pipeline }
sharedResourceOwners:
  gbuffer: not used
  depth: $threejs-image-pipeline
  normal: not used
  velocity: not used
  history: not used
  weatherEnvelope: $threejs-rain-snow-and-wet-surfaces
  toneMap: $threejs-image-pipeline
  outputTransform: $threejs-image-pipeline
  adaptiveResolution: $threejs-image-pipeline
coverageStatus: complete
performanceContract:
  routeStatus: provisional
  frameInterval: { value: "", unit: ms, label: Derived, source: "1000 ms / [Gated] frozen target refresh" }
  passKeys: [weather.simulation, street-view.scene, main.present]
  accounting: deduplicated scene/depth pass plus measured precipitation and water marginals
  qualityAdaptation: preserve weather coupling; reduce the measured pressure source, not a fixed cinematic order
acceptanceEvidence:
  requiredDebugViews: [wetness, impact occupancy, puddle thickness, ripple normal, no-post]
  requiredMetrics: ["p50/p95 [Measured] composed timing", impact conservation/error gate, temporal continuity, attachment bytes]
  requiredCommands: [installed-source API assertions, project validation/capture command]
  requiredArtifacts: [fixed street captures, pass ledger, mobile sustained trace]
```

## forest flythrough

Input brief: dense procedural vegetation, terrain masks, rooted wind, free camera
movement, and temporally stable foliage.

minimal skill set:

```yaml
backendManifest: "populate required [Gated] and observed [Measured] fields from canonical preflight"
workloadProfile:
  domain: other
  intent: inspect
  truthContract: perceptual-style
  representation: procedural-mesh
  interaction: free-navigation
  temporal: deterministic-animation
  scale: city-terrain
  topology: repeated
  deployment: "brief-defined desktop/mobile WebGPU matrix"
causeLedger:
  sourceOfTruth: species grammar, terrain field, and wind field
  primaryObservable: rooted species silhouettes with coherent wind from overview to close inspection
  earliestMissingLayer: geometry
  selectedAlgorithm: chunked vegetation LOD, compatible instancing/batching, and rooted procedural deformation
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
  sourceOfTruth: $threejs-procedural-vegetation
  representation: $threejs-procedural-vegetation
  spatialFrame: $threejs-camera-controls-and-rigs
  timebase: rooted wind field clock
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
  terrainBiomeField: { producer: $threejs-procedural-fields, consumers: [vegetation distribution] }
  rootedWindField: { producer: $threejs-procedural-vegetation, consumers: [vegetation deformation] }
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
  frameInterval: { value: "", unit: ms, label: Derived, source: "1000 ms / [Gated] frozen target refresh" }
  passKeys: [vegetation.update, navigation-view.scene, main.present]
  accounting: composed culling/submit/GPU distributions; no universal draw or triangle cap
  qualityAdaptation: classify CPU submit, vertex, fill, and memory pressure before changing chunk density, LOD, or DPR
acceptanceEvidence:
  requiredDebugViews: [roots, species IDs, terrain masks, wind displacement, LOD, no-post]
  requiredMetrics: ["p50/p95 [Measured] CPU/GPU/presentation", culling completeness, LOD error, temporal stability]
  requiredCommands: [installed-source API assertions, project validation/capture command]
  requiredArtifacts: [fixed navigation path, seed sweep, sustained low-end/mobile trace]
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
