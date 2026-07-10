# Precipitation Surface Systems

Precipitation reads as real only when particles, surface masks, normals,
roughness, residue, lighting, and diagnostics share the same weather envelope.
This reference teaches one renderer path: pinned Three.js r185 with
`WebGPURenderer`, TSL, `NodeMaterial`, node post, compute, and storage-backed
instance data.

## Contents

- Architecture
- Capability gate and tiers
- Shared environment, exchange, and receiver contract
- Shared weather envelope
- Compute precipitation volume
- Snow accumulation and object capping
- Wet puddles and ripple normals
- Rain streaks, impacts, and splashes
- Node presentation, color, and output
- Budgets
- Debug outputs
- Replaced techniques
- Boundaries and failure modes

## Architecture

Select analytic, recurrent, and persistent state independently before building
the frame graph:

```text
weather envelope
  -> immutable seeds + analytic camera-wrapped precipitation, OR
     recurrent storage + compute when forces/collisions require state
  -> one draw per rain/snow family through storage-backed attributes
  -> independently integrated world-stable snow/wetness/puddle state
  -> sparse impact buffers/dirty tiles or explicitly stylized ripple variants
  -> RenderPipeline node presentation
```

Static work is done once: spawn seeds, random phase, size, material variant,
surface sampler data, and mesh bindings. Per-frame work is limited to changed
forcing/state, the selected analytic or recurrent motion path, material field
evaluation, and necessary draws.

Before allocating dynamic particle state, classify motion:

- Constant fall plus constant wind is analytic: derive position from immutable
  seed, world-cell origin, and time in vertex TSL. For authored time-varying
  wind use accumulated displacement `integral v_wind(t) dt` or an analytic
  antiderivative. `currentWind * elapsedTime` teleports the field when wind
  changes. Spatially varying, stochastic, or history-dependent wind is
  recurrent state unless an exact trajectory integral exists.
- Turbulence, collision, or feedback is recurrent: update storage in compute.
- Camera-wrapped particles are visual density only. Physical impacts and
  accumulation use world-stable hashed cells/tiles so camera translation cannot
  move causes across the surface.
- Sparse impact events update only affected receiver tiles or a bounded event
  pool.

## Physics Contracts And Visible Signatures

Use physically named quantities even when art direction scales them. If a
particle uses a terminal-speed claim, state diameter/mass, fluid density, drag
coefficient, projected area, and model; for quadratic drag,
`v_t = sqrt(2 m g / (rho_air C_D A))`. Real drops and snow aggregates need
shape/Reynolds-dependent drag, so authored fall speeds are not universal
physics constants. Canonical wind is `airVelocityMps`, a three-component
velocity in `m s^-1` in the declared stable right-handed `PhysicsFrameId`;
only the non-authoritative render projection converts it to world/render units.
Capillary ripple rings are a bounded surface-response
approximation, not a water simulation. Snow deposition needs exposure,
occlusion, slope/adhesion, transport/melt, and capacity policy; an upward-normal
gate alone is only a stylized mask. Wetness first changes roughness,
absorption/base-color response, and layered dielectric Fresnel; do not
arbitrarily animate metalness or a bare-material F0 scalar.

A suspend policy is explicit: freeze the weather clock, analytically catch up
rate equations, or bounded-substep recurrent state. Clamping the duration
derived from `PhysicsGraphStage.executionInterval: PhysicsTimeInterval` while
advancing its clock mapping silently loses deposition and is not deterministic.

Visible signature: rain streak length tracks fall speed, wind drift aligns with
wetness/ripple motion, ripples form expanding rings rather than unrelated
noise, snow does not stick to vertical faces, and wet asphalt roughness changes
before heavy-rain ripple normals. Wrong output: slow beads for heavy rain,
particle/wetness drift, vertical-face snow, roughness tied only to ripple masks,
or splash residue on hidden/downward faces.

## Shared Environment, Exchange, And Receiver Contract

Use the router's canonical
[physics-domain and interaction contract](../../threejs-choose-skills/references/physics-domain-and-interaction-contract.md)
whenever precipitation crosses a subsystem boundary. Its
`EnvironmentForcingSnapshot`, `SurfaceExchange`, `InteractionRecord`, and
`PhysicsPresentationCandidate` -> `CameraViewPublication` ->
`ViewPreparationPublication` -> `PhysicsPresentationSnapshot` chain are
authoritative. The records below are required projections of those types, not
weather-local replacements.
Every provider/resource projection retains the canonical
`PhysicsSignalDescriptor` envelope (`signalId`, `providerId`, `schemaId`,
context/owner/consumers, channels, physics frame/origin/transform revision,
optional chart, clock ID/sample phase, represented footprint/filter, validity,
per-channel error, residency/cadence/latency, state version, resource
generation, and missing-channel policy). Domain fields below only narrow its
channels; they do not rename that envelope.

The project/environment coordinator is the sole owner and publisher of
`EnvironmentForcingSnapshot`, including its frame, clock, support/filter,
validity, and revision. Rain consumes that boundary. A rain transport or
receiver owner may publish downstream state and exchanges, but it cannot
publish a competing forcing snapshot.

### Immutable forcing input

Latch one `EnvironmentForcingSnapshot` at its exact
`sampleInstant: PhysicsInstant` for one graph
`coordinationInterval: PhysicsTimeInterval`. Require:

```text
context and forcing revision; origin epoch and coordinate frame
`sampleInstant: PhysicsInstant`, descriptor `validity` whose temporal domain is
  a `PhysicsTimeInterval`, producer cadence, and interpolation policy
air-velocity provider u_air(x,t) in m s^-1, including altitude/support domain,
  requested/actual oriented physical footprint, spatial/temporal filter or
  band, and per-channel error
temperature in K and canonical specific humidity in kg kg^-1; convert external
  relative humidity or mixing ratio in a named thermodynamic adapter
optional pressure and air density in Pa and kg m^-3, or a named equation-of-state
  adapter with propagated per-channel error, when drag/phase models require them
precipitation liquid/ice phase fractions and canonical oriented mass-area flux
  with physical support/Jacobian
source/arrival support, fall-delay/transport model, uncertainty and per-channel error
missing/stale-data and quality-tier policy
```

Do not reinterpret the air velocity as water material current, water-surface
point velocity, vegetation displacement, or cloud-relative topology motion.
If mean, gust, and turbulence channels coexist, the provider declares whether
each band is disjoint or already included in `airVelocityMps`; never add
overlapping bands twice.
Convert scene/world units only at the `PhysicsContext` boundary. Interpolate a
provider only within its validity/error contract; otherwise hold, extrapolate,
degrade, or block according to the declared policy and expose that decision.

Cloud coupling has exactly two modes:

- `appearance-only`: the physical emission channel is absent; precipitation
  bias may coordinate the shot but cannot imply a mass, momentum, wetness, or
  snow transfer;
- `causal-precipitation`: the cloud producer supplies liquid/ice
  phase-fraction-resolved `PrecipitationEmissionSnapshot` over its exact
  `emissionInterval: PhysicsTimeInterval` as canonical oriented mass-area flux
  in `kg m^-2 s^-1`, with support/Jacobian plus a fall-delay/transport kernel or
  explicit airborne state. A cloud volume source is projected to that area
  measure before publication and retains its provenance/error. The snapshot is
  a completed immutable producer output, never a mutation of the forcing
  snapshot already latched for the coordination interval. Rain consumes it on
  a declared direct acyclic scheduler edge whose producer precedes rain, or
  from the next environment-forcing revision, maps it to receiver support, and
  reports initial/final airborne inventory, delivered mass, typed transfer to
  the atmosphere-vapor owner, and rejected/deferred/lost mass. The downstream
  rain `SurfaceExchange.batchLedger` owns the `InteractionBatchLedger` for
  delivery capacity, sequence ranges, cursors, and lost/deferred commodities;
  neither the cloud nor `PrecipitationEmissionSnapshot` owns that ledger. The
  inventory balance closes within the declared numerical error.

### Surface exchange and impact records

Use the canonical `SurfaceExchange` only as the coupling envelope. Give it an
exact `applicationInterval: PhysicsTimeInterval`, point its `sourceDescriptors`
at the forcing/emission versions, and carry precipitation in canonical
`InteractionRecord.payload` tags; do not add weather-local fields to
`SurfaceExchange`.

- A rate representation uses `massFlux` in `kg m^-2 s^-1` plus
  `momentumFlux`/`surfaceTraction` in `Pa`, with the same oriented physical-area
  quadrature and `applicationInterval: PhysicsTimeInterval`.
- An interval-integral representation uses canonical `massTransfer` in `kg`
  plus distributed `momentumTransfer` in `N s` (and `N m s` about its named
  point), over the same interval and conservation group. A discrete local
  impact uses `pointImpulse` instead of pretending to be an area average.
- Liquid/ice mass fractions are nonnegative and sum to one within their
  residual. Support measure/Jacobian, source/target IDs, physics frame/origin/
  transform revisions, target state-equation terms, exact-once keys, and
  reaction ownership come from the canonical records.

Mass is nonnegative and moves from `sourceEntityId` into `targetOwner` under
`positive-source-to-receiver`. Momentum/impulse vectors are the physical
momentum delivered to the receiver in `physicsFrameId`; components may have
either sign. A reverse transfer swaps participants and publishes the actual
delivered vector. An equal-and-opposite reaction is a separate record in the
same conservation group with opposite impulse; never encode reverse mass with
a negative scalar. Select rate or interval-integral as the authoritative
representation. If both are carried for audit, mark one derived and prove its
support/time integral equals the authoritative record within the residual.
When a receiver subcycles, its quadrature weights over the record interval sum
to one application of the parent integral. An `interval-integral` is never
applied once per subcycle; a `flux` is integrated over each disjoint subinterval.

`InteractionFootprint.distributionKind` selects one of two dimensionally
distinct paths:

- `intensive-field`: each flux/traction value is a physical density at a
  quadrature point; each quadrature weight includes its chart/support Jacobian,
  has units of square metres, and the weights sum to `representedMeasure`.
  Integrate as `sum_i q_i A_i`; set no normalized spatial kernel. Normalizing
  `A_i` to unity and then applying the same intensive values destroys area and
  is invalid.
- `extensive-distributed`: the payload is one extensive rate or interval
  transfer. Its nonnegative kernel `W` has inverse-square-metre units and
  satisfies `integral_A W dA = 1`; the local density is the extensive quantity
  times `W`. If clipping changes that integral, record rejected transfer or
  renormalize only under an explicit receiver policy.

Never use the extensive-distributed kernel path to disguise an intensive
`massFlux`, `momentumFlux`, `surfaceTraction`, or `heatFlux` sample.

Publish energy/enthalpy flux only when a thermal owner consumes it and its
reference state is declared. For a water receiver with density `rho_w`, the
depth source is **Derived** as `S_h = massFlux / rho_w` in `m s^-1`; the
horizontal depth-integrated momentum source is **Derived** as
`S_hu = momentumFluxHorizontal / rho_w` in `m^2 s^-2`. Vertical impact
momentum is not silently inserted into horizontal shallow-water momentum: the
water owner maps it to splash, turbulence, pressure, or a rejected quantity.

Use `InteractionRecord` for sparse physical impacts/splashes, branch/leaf hits, or
contact-like impulses. It records integrated impulse in `N s`, canonical SI
physics-frame contact/footprint data, exact
`applicationInterval: PhysicsTimeInterval`, stable IDs, deterministic order,
reaction owner, conservation-group ID, collision-free `exactOnceKey`, and
`applicationLedgerKey`. Sequence ranges, delivery cursors, and capacity live in
the batch ledger; causal partition identity lives only in canonical
`partitionMembership`, never in ad hoc fields. Capacity outcomes live
on the owning downstream `SurfaceExchange.batchLedger` as the canonical
immutable `InteractionBatchLedger`. Its lost/deferred
commodity map contains only represented channels (for example mass, impulse,
torque, or energy) with exact SI units and per-channel error; unrepresented
loss quantities block the conservation claim or require a versioned ledger
schema that represents them. `absentChannels` belongs to provider sample
records, never to `InteractionBatchLedger`, and no missing commodity is filled
with zero.
Every causal physical impact that partitions a distributed parent carries
`InteractionRecord.partitionMembership: InteractionPartitionMembership`.
Its `parentExchangeId`, `parentInteractionIds`, `partitionGroupId`,
`partitionId`, `partitionMeasure`, and `closureGroupId` bind the impact to the
parent `SurfaceExchange` and intensive/integrated interaction records. The
disjoint partitions close parent mass, momentum, angular momentum, and energy
within their shared `ConservationGroup`; `applicationLedgerKey` and the batch
sequence/cursors enforce exact-once application. A purely visual splash belongs
to the presentation-event stream, references the parent exchange, and is not a
second physical `InteractionRecord`. Multiple physical batches use disjoint
partition IDs and never each claim the complete parent integral.

Rendered particles are estimators. First integrate intensive fields with
physical-area quadrature `A_i`; then, if sparse physical impacts partition that
integral, assign extensive partition masses `m_i` and impulses `J_i`:

```text
sum_i A_i = representedMeasure
M_parent = sum_i massFlux_i * A_i * dt
J_parent = sum_i momentumFlux_i * A_i * dt
sum_i m_i = M_parent
sum_i J_i = J_parent
```

Changing streak/flake count, camera cell population, update cadence, or LOD
must leave these integrals unchanged. Count deterministic overflow separately;
never renormalize dropped events invisibly when that would concentrate local
flux.

### Single receiver-state owner

Assign one owner for each receiver's liquid storage, snow storage,
temperature-dependent phase, age, and derived display coverage. A non-water
surface normally conserves liquid/snow mass per area in `kg m^-2`; a water
solver may instead conserve depth/volume plus declared density. Choose one
authoritative representation and derive the other, never integrate both.
Derive
snow water-equivalent depth from mass per area and reference liquid-water
density; derive geometric height from snow bulk density/compaction; derive
display coverage from the chosen support model. Water equivalent, height, and
coverage are not additional conserved truths. The owner consumes all
relevant exchanges:

```text
# non-water receiver: m_liquid and m_snow are kg m^-2
d m_liquid / dt = rain + runupOrInundation + melt
                  - drainage - infiltration - evaporation - exportedRunoff
d m_snow / dt   = snowfall + refreeze
                  - melt - sublimation - transport - inundationWash
```

Every term has one producer, units, support, cadence, and sign. The state owner
may be this weather system, a water/terrain domain, or an application solver,
but never more than one for the same quantity and receiver. Materials consume
an immutable receiver-state snapshot to derive albedo, roughness, normals,
residue, and displacement. They do not integrate state in a fragment shader.

The scheduler edge is fixed:

```text
latch EnvironmentForcingSnapshot.sampleInstant: PhysicsInstant for
     PhysicsGraph.coordinationInterval: PhysicsTimeInterval
  -> execute each
     PhysicsGraphStage.executionInterval: PhysicsTimeInterval
  -> advance analytic/recurrent airborne precipitation
  -> resolve/bin impacts
  -> publish SurfaceExchange.applicationInterval: PhysicsTimeInterval and
     contained InteractionRecord.applicationInterval: PhysicsTimeInterval
  -> water/contact owners consume forces and sources
  -> receiver owner integrates wetness/snow/coverage
  -> commit domain state
  -> publish view-independent PhysicsPresentationCandidate with
     requestedPresentationInstant: PhysicsInstant, presentedStatePairs,
     resourceLeases, and eventSequenceRanges only
  -> camera owner publishes per-target/view CameraViewPublication with
     previousRenderSampleInstant: PhysicsInstant and
     currentRenderSampleInstant: PhysicsInstant plus
     globalToRenderPrevious/globalToRenderCurrent, view/projection matrices,
     jitter, viewport, and depth state
  -> visibility/acceleration/shadow/cache/reactive/reset owners publish
     ViewPreparationPublication with visibilityPublicationRefs,
     accelerationPublicationRefs, shadowViewPublicationRefs,
     cachePublicationRefs, reactiveEpochs, reactivePublications,
     resetDependencies, full resourceLeases for newly created view resources,
     and resourceLeaseRefs
  -> seal PhysicsPresentationSnapshot from presentedStatePairRefs and
     resourceLeaseRefs plus the exact candidateId, cameraPublicationId, and
     viewPreparationId, with closureManifest
  -> materials and render consume only the sealed snapshot
```

Each `PresentedStatePair.previousPresented.provenance` and
`currentPresented.provenance` is its own `PresentationSampleProvenance`,
including requested and mapped `PhysicsInstant` values, clock-map
revision/error, and lower/upper brackets. Each arm also carries its own
`presentedInstant: PhysicsInstant`. The candidate contains no camera, render
origin, global-to-render transform, visibility, shadow, cache, or reset state.
It exposes distinct `PresentedStatePair` bindings for airborne precipitation,
receiver state, and any committed cloud-emission generation used by the view.
The sealed snapshot references candidate pairs and leases only through
`presentedStatePairRefs` and `resourceLeaseRefs`; it never copies
`PresentedStatePair` records, provenance, or transforms. Its
`closureManifest` contains exactly the required pair-state, preparation,
shadow/cache/visibility, reactive/reset lease IDs and addressed event-range
IDs; missing or surplus closure entries are invalid.

Subcycling may change internal solver cadence but not this dependency order.
Store unresolved exchange until the consumer cadence or integrate it exactly;
do not sample-and-drop between rates.

Any change to precipitation equations, recurrent/receiver state, native
cadence, represented support, provider filter/band, exchange representation,
partition/application-ledger identity, or stable IDs requires an admitted
shared `QualityTransition`. Its conservative map preserves inventories,
positivity, event cursors, exact-once ledgers, filters, IDs, and error bounds;
retirement waits for all consumers. Render-only particle density, sprite shape,
beauty scale, and ripple-normal representation may remain local only when those
physical quantities and descriptors are unchanged.

## r185 Import Table

| Domain | Import |
| --- | --- |
| Renderer/pipeline/storage | `WebGPURenderer`, `RenderPipeline`, `StorageInstancedBufferAttribute`, `StorageBufferAttribute` from `three/webgpu` |
| TSL compute/material nodes | `Fn`, `instanceIndex`, `uniform`, `vec4`, `instancedArray`, `storage`, `textureStore`, `pass`, `mrt`, `renderOutput` from `three/tsl` |
| AO grounding | `three/addons/tsl/display/GTAONode.js` |
| Bloom highlights | `three/addons/tsl/display/BloomNode.js` |
| Temporal stability | `three/addons/tsl/display/TRAANode.js` |
| Large-scene shadows | `three/addons/csm/CSMShadowNode.js` |
| Tiled shadows | `three/addons/tsl/shadows/TileShadowNode.js` |

## Space Contract

| Space | Contract |
| --- | --- |
| Seed space | Immutable per-instance normalized spawn state. |
| Storage-record space | Packed `positionLife`, `velocityLife`, and `seedFlags` records. |
| World space | Weather wind, surface normals, splash impact positions. |
| Camera-wrapped volume | Volume centered around camera with no visible emitter edge. |
| View space | Presentation and depth/MRT consumers only. |
| Model space | Object snow coverage locks to model coordinates. |
| Decal/UV space | Puddle/decal masks declare UV origin and texel-center rule. |
| Storage-texture texels | Impact/ripple targets use explicit texel centers. |
| Normal matrix | Splash normals and snow normals are transformed before upward gating. |
| Depth/MRT owner | Shared image pipeline owns depth, normals, velocity, and output. |

## Checkpointed Build Order

Checkpoint 1: weather debug. You must see the forcing `sampleInstant`, derived
stage-interval duration, wind, forcing, response-state ages, and quality tier;
if you see drift, the likely mistake is separate clocks or an unregistered
clock mapping.

Checkpoint 2: storage buffer debug. You must see packed position/life,
velocity/life, and seed/flags records; if you see CPU matrix uploads, the
likely mistake is a per-drop object loop.

Checkpoint 3: precipitation-domain test. Unbounded visual weather must show no
camera-streaming seam or phase jump; localized weather must show an intentional
world-anchored boundary/transition. Impacts remain fixed under camera motion.

Checkpoint 4: wetness mask. You must see roughness respond before ripple
normals; if ripples appear on a dry receiver, inspect forcing-to-response
integration and impact occupancy.

Checkpoint 5: normals. You must see snow displacement and snow normals from one
field; if silhouettes rise but normals stay flat, inspect field ownership.

Checkpoint 6: impact occupancy. You must see impact position, normal/tangent
frame, progress/lifetime, atlas, and opacity in storage; if splashes appear on
vertical/hidden faces, inspect world-space normal and depth gates.

Checkpoint 7: final. You must see one `RenderPipeline` output owner; if color
shifts, inspect double output transform.

Trap: unbounded camera-centred cells are world-hashed and only streamed around
the camera, never screen-UV wrapped. Localized volumes stay world-anchored.
Trap: model snow slides when coverage is sampled in world instead of model
space. Trap: splash normal tests must use transformed world normals. Trap:
roughness is tied to wetness before ripple masks. Trap: sRGB-as-data breaks
generated normal maps. Trap: output conversion belongs to the image pipeline.
Trap: CPU matrix upload breaks the storage-instance budget.

## Capability Gate And Tiers

Call `await renderer.init()` before probing the backend or creating resources
that require compute/storage.

```js
await renderer.init();

if (renderer.backend.isWebGPUBackend !== true) {
  throw new Error(
    'WebGPU is required for the canonical weather path; explicit fallback teaching belongs to threejs-compatibility-fallbacks.'
  );
}
```

Native WebGPU tiers preserve the weather cause and change representation:

- `full`: analytic or recurrent precipitation as required, world-stable sparse
  impacts, integrated receiver state, and measured reconstruction/post.
- `balanced`: lower projected density/history extent and fewer field bands,
  with response conservation and image-error gates intact.
- `budgeted`: analytic precipitation where possible, bounded sparse impacts,
  lower-rate/reduced receiver fields, and optional explicitly stylized ripple
  normals; no custom parallel renderer path.

Use the generated normal maps as the cheap rain tier and as diagnostics:

- `assets/generated-variants/ripple-normal-a.png`
- `assets/generated-variants/ripple-normal-b.png`
- `assets/generated-variants/ripple-normal-c.png`

## Projected Weather Uniforms

One immutable projection of the latched environment snapshot feeds visual
particles and surfaces. It exposes canonical-derived time plus projected wind,
temperature, visual event forcing, and quality nodes. Wetness, puddle fill, and
snow coverage remain receiver-owned response states; integrate deposition
against drainage/evaporation/melt rather than assigning every surface to one
progress scalar.

```js
const weather = {
  sampleInstantSeconds: uniform(0),
  executionIntervalSeconds: uniform(0),
  wind: uniform(new THREE.Vector3(1.2, 0, 0.5)),
  temperatureK: uniform(278.15), // [D] 5 degC + 273.15
  forcing: uniform(0),
  visualParticleDensityScale: uniform(1),
  debugMode: uniform(0),
};

function projectWeather(
  sampleInstantSecondsDerived,
  executionIntervalSecondsDerived,
  targetVisualForcing,
) {
  weather.sampleInstantSeconds.value = sampleInstantSecondsDerived;
  weather.executionIntervalSeconds.value = executionIntervalSecondsDerived;
  weather.forcing.value = THREE.MathUtils.damp(
    weather.forcing.value,
    targetVisualForcing,
    0.9,
    executionIntervalSecondsDerived,
  );
}
```

This object is a material/node projection of the latched
`EnvironmentForcingSnapshot`, not a second owner. Convert its wind from the
canonical air-velocity provider into render units once; preserve the source
revision and sample instant. `sampleInstantSecondsDerived` comes from the
latched `EnvironmentForcingSnapshot.sampleInstant: PhysicsInstant`;
`executionIntervalSecondsDerived` is derived from the owning
`PhysicsGraphStage.executionInterval: PhysicsTimeInterval`. Authoritative
deposition consumes `precipitationMassFluxKgPerM2S`, and
`visualParticleDensityScale` cannot author an exchange. Keep temperature in
kelvin; a Celsius UI projection
uses the explicit **Derived** conversion `temperatureC = temperatureK - 273.15`
and never changes the stored forcing quantity. `forcing` coordinates the event, while response
fields integrate their own physically named rates. They share causes and time
ownership without becoming identical curves.

## Recurrent Compute Precipitation

Use `StorageInstancedBufferAttribute` or TSL `instancedArray()` storage nodes
for dynamic instance state. The documented pattern is a TSL `Fn()` compute node
that writes storage data, then renders from that data via attribute nodes.

```js
const positionBuffer = instancedArray(maxInstances, "vec4");
const velocityLifeBuffer = instancedArray(maxInstances, "vec4");
const executionIntervalSeconds = uniform(0);

const updatePrecipitation = Fn(() => {
  const i = instanceIndex;
  const positionLife = positionBuffer.element(i);
  const velocityLife = velocityLifeBuffer.element(i);
  positionLife.assign(
    vec4(
      positionLife.xyz.add(velocityLife.xyz.mul(executionIntervalSeconds)),
      positionLife.w.add(executionIntervalSeconds)
    )
  );
})().compute(maxInstances, [64]);

renderer.compute(updatePrecipitation);
```

This is only the r185 writable-node shape; set
`executionIntervalSeconds` from the derived duration of the owning
`PhysicsGraphStage.executionInterval: PhysicsTimeInterval`. Constant velocity
should normally be evaluated analytically. A real recurrent solver adds its named force/integrator,
extent guards, lifecycle transition, and convergence gates. Use `storage()` over `StorageBufferAttribute` or
`StorageInstancedBufferAttribute` when you need explicit buffer ownership.
In r185 `computeAsync()` only awaits renderer initialization before enqueueing
compute and is not a GPU-completion fence. Reserve barriers/atomics for their
valid scope; global bins, scans, and compaction stages use ordered dispatches.

Choose the domain. Unbounded visual precipitation streams world-hashed cells
around the camera so finite pool bounds never appear; camera translation does
not change a cell's phase. Localized weather stays in a world-anchored bounded
volume with a physical/soft boundary. Rain may use streak sprites or instanced
capsules; snow may use soft sprites with seeded size/sway. Neither visual pool
owns impacts or accumulation.

Recommended dynamic records:

- `positionLife`: world position plus normalized life/opacity;
- `velocityLife`: fall velocity, wind contribution, and phase;
- `seedFlags`: seed, size, material variant, and active flag.

Keep static random values immutable. Only dynamic fields update in compute.

## Flux And Tier Conservation

Publish precipitation forcing as canonical `mass-area-flux` in
`kg m^-2 s^-1`. An ingestion adapter first projects an external volume source
through its physical support/chart Jacobian, or converts an external
water-equivalent-depth rate in `m s^-1`, before snapshot publication through the
declared reference liquid-water density and provenance:
`massFlux = rho_reference * depthRate`. Water-equivalent rate is not a third
accepted forcing channel, and volume source is not relabelled area flux without
the projection. Rendered particle density is a sampling choice. For physical
area quadrature, `sum_i A_i = A` and deposition is
`sum_i F_i A_i dt`; `A_i` is never normalized to unity. If `N` sparse impacts
partition that integrated parent, their extensive masses sum to the same
integral and their `InteractionPartitionMembership` records close it. Changing
visual particle count, simulation cadence, or LOD cannot change total
deposition. Use stratified world-cell samples, deterministic overflow/drop
accounting, and integrate the complete elapsed forcing, drainage, evaporation,
and melt interval when receiver cadence changes.

## Snow Accumulation And Object Capping

Ground snow needs one height field. The same field controls coverage,
displacement, material blend, sparkle mask, and normal reconstruction. In TSL,
author the field as reusable nodes and assign material slots:

- `positionNode` or displacement path: world-space snow height;
- `normalNode`: normal reconstructed from the same height field;
- `colorNode`: base albedo blended toward cool snow inside the mask;
- `roughnessNode`: high roughness inside settled snow, typically near `0.8`;
- `emissiveNode` or sparkle contribution: sparse and masked by snow coverage.

Do not create a separate normal field for snow. If the terrain cannot afford
dynamic field evaluation, bake the coverage mask and still derive displacement
and normal response from that same mask.

Object snow must be model-locked. Transform the world position into the host
object's stable model space for coverage sampling, then gate by the declared
world-space support-up direction. For ordinary gravity,
`upHat = -normalize(gravityWorld)`; planetary/local fields supply their local
gravity direction per sample:

```text
topMask = smoothstep(flatThreshold, 1.0,
                     saturate(dot(worldNormal, upHat)))
coverage = topMask * modelSpaceCoverage(modelPosition.xz)
```

Select `flatThreshold`, thickness, coverage, and edge softness from the named
surface/scale contract. Displace along the object normal and convert world
thickness to local units when needed.

## Wet Puddles And Ripple Normals

Wet asphalt is a material projection of the route-selected receiver owner's
immutable liquid-storage/coverage state. Rain progress may coordinate only
non-authoritative art direction. Split the material projection into separate
bands:

- Early wetness: darken albedo slightly and move roughness toward a wet range.
- Puddle eligibility/capacity: form low areas from a world- or decal-space TSL
  field, not an undocumented hardcoded world-origin clip; actual fill comes
  from receiver-owned liquid storage.
- Heavy rain: add ripple normals only after wetness is established.

Use `MeshPhysicalNodeMaterial` when clearcoat, IOR, or extra specular controls
matter; otherwise use `MeshStandardNodeMaterial`. Assign node slots directly:

```js
const material = new THREE.MeshPhysicalNodeMaterial({
  metalness: 0,
});

material.colorNode = wetColorNode;
material.roughnessNode = wetRoughnessNode;
material.normalNode = blendedNormalNode;
material.opacityNode = decalOpacityNode;
```

Ripple normals have two valid tiers:

- High tier: dynamic TSL or compute-derived ripple field tied to the shared
  weather envelope and impact/event buffers.
- Medium/reduced tier: preload one of the generated normal variants, mark it as
  data/normal content, and animate UV or blend weight from the shared envelope.

The cheap tier is the default for broad wet roads because it avoids evaluating
expensive ring fields for every wet pixel. Use dynamic ripples only for hero
closeups, bounded puddles, or explicit impact interaction.

## Rain Streaks, Impacts, And Splashes

Rain streaks are storage-instanced sprites or capsules. The compute dispatch
updates world position, life, velocity, opacity, and active state. Rendering is
one draw for the rain family through `SpriteNodeMaterial`, `MeshBasicNodeMaterial`,
or a narrow instanced geometry using node material alpha.

Splash placement should be GPU-owned when counts are high. Build candidate
surface data once, with weights from `dot(worldNormal, upHat)` and optional
authored masks. Gate the support-normal threshold from the receiver contract;
add depth or occlusion rejection when hidden surfaces can receive splashes.

Splash animation data belongs in storage:

- impact position;
- normal or tangent frame;
- progress and lifetime;
- atlas tile or variant;
- opacity.

Flipbook progress maps to a splash atlas in the node material. Billboarding
should rotate around the surface normal or camera-facing axis appropriate to
the shot, but instance transforms should not be rewritten every frame on the
CPU.

## Node Presentation, Color, And Output

Use a single `RenderPipeline` for the final chain:

```js
const pipeline = new RenderPipeline(renderer);
const scenePass = pass(scene, camera);
pipeline.outputNode = scenePass;
```

Use MRT only when later nodes reuse the same pass data, such as depth, normals,
wetness, velocity, or mask data. Use built-in nodes before custom effects:

- `GTAONode` or `ao()` for contact grounding under wet/snowy surfaces;
- `BloomNode` or `bloom()` only for bright splash highlights or stylized ice;
- `TRAANode` or `traa()` for temporal stability when rain streaks shimmer;
- `CSMShadowNode` or `TileShadowNode` for large scenes with weather-visible
  directional shadows.

Color and output rules:

- LDR albedo/base-color textures encoded as sRGB use `SRGBColorSpace`; HDR/EXR
  radiance remains loader-declared linear;
- normal, roughness, AO, masks, weather fields, generated ripple normals, and
  LUTs use `NoColorSpace` or linear treatment;
- keep HDR buffers as `HalfFloatType` until tone mapping;
- the pipeline owns the only tone map and output conversion with
  `outputColorTransform` or explicit `renderOutput()`;
- reduced-resolution effects use `PassNode.setResolutionScale()`.

## Performance contract

Select the state model before allocating a tier:

| Visible requirement | State cost |
| --- | --- |
| camera-relative streaks/flakes only | immutable seeds + analytic TSL position; zero simulation dispatch/storage mutation |
| recurrent forces or particle collisions | GPU-resident state and one measured solver dispatch per family |
| sparse world impacts | bounded event pool plus dirty tiles; cost scales with events/touched tiles |
| persistent wet/snow field | reduced-resolution state, update cadence and catch-up error declared |

Detailed constraints:

- one draw per precipitation family and one draw per splash pool;
- an explicit ordered dispatch ledger per family: solver, event binning,
  mark/scan/scatter or indirect-count stages only when selected; no universal
  one-dispatch cap;
- no per-drop object creation;
- no full-population CPU upload for dense recurrent transforms; sparse dirty
  authoritative ranges are allowed when cheaper than compute;
- use generated normal variants when dynamic ripple fields exceed the material
  budget;
- field octave count is selected by projected-frequency/error analysis; do not
  evaluate bands above pixel Nyquist or below visible contrast.
- on constrained/mobile targets, keep the same exchange integrals while using
  analytic visual particles, conservative column/fall-delay transport,
  bounded event pools, dirty receiver tiles, and lower receiver cadence with
  exact interval accumulation; record clipped support and overflow error.
- account for exchange batches, interaction stream/ledger capacity, receiver
  state, `PresentedStatePair` slots, exact snapshot `closureManifest`,
  identity/partition maps, `QualityTransition` overlap, and in-flight resource
  generations. Keep authoritative transfer GPU-resident or compactly
  host-authored; steady-frame rendering performs no synchronous readback.

Record `{visibleInstances, coveredPixels, layersPerPixel, solverKind,
storageBytes, eventCount, dirtyTiles, fieldExtent, renderExtent, sampleCount}`.
Validate contemporaneous full-frame and paired-marginal p50/p95, transparent
overdraw, hot traffic, impact-field work, peak live bytes, and thermal behavior
against the product's scene allocation. A fixed instance count or device label
is not a performance proof.

## Debug Outputs

Expose at least:

- `final`: complete weather and surface response;
- `mask`: snow, wetness, puddle, or impact coverage;
- `normals`: accumulated snow normal or ripple normal tier;
- `particles`: precipitation density, wrapping, and active instance count;
- `events`: splash or impact buffer occupancy;
- `progress`: shared weather envelope.
- `exchange`: rate/integral discriminant, support measure, parent/partition IDs,
  physical-area weights, integrated mass/momentum, closure group, reaction
  owner, and `InteractionBatchLedger` overflow/cursors;
- `receiver`: selected state owner plus deposition/run-up/melt/drainage/
  infiltration/evaporation terms and published state revision;
- `presentation`: airborne/receiver/emission pair refs and exact
  `closureManifest` lease/event sets;
- `quality`: admitted `QualityTransition` ID/state epochs, or proof that the
  active tier change is render-only.

Diagnostics should report backend tier, instance count, dispatch count, storage
size, generated variant selection, coverage percentage, and whether particles
and surfaces read the same `EnvironmentForcingSnapshot` revision.

## Replaced Techniques

- CPU-updated rain and splash transforms were replaced with
  compute-updated storage instance data, because upload bandwidth and matrix
  mutation become the bottleneck at useful precipitation counts.
- Independent particle, puddle, and splash timers were replaced with one
  weather envelope, because coupled weather must not drift across systems.
- String-patched material customization was replaced with TSL node slots on
  `NodeMaterial`, because the node path is the current renderer architecture and
  composes with node post.
- Always-evaluated analytic ripple rings were replaced by generated ripple
  normal variants as the default road tier; dynamic ripple fields are reserved
  for closeups or interactive impacts where the extra cost buys visible value.
- Local-space splash weighting was replaced with world-space normal gating and
  optional depth or occlusion rejection, because transformed meshes otherwise
  spawn residue on invalid faces.
- Hardcoded circular wet decals were replaced with explicit material mode:
  either full-surface wetness driven by world/decal coordinates or a documented
  decal mask.

## Boundaries And Failure Modes

Use `$threejs-water-optics` when the system needs refraction through a bounded
water body, caustics, Fresnel, or Beer-Lambert thickness. Use
`$threejs-particles-trails-and-effects` for non-weather particles. Use
`$threejs-dynamic-surface-effects` for screen-space touch history, frost clearing, or
similar temporal surface buffers. Use `$threejs-image-pipeline` when the
precipitation effect must integrate with a larger HDR post stack. Use
`$threejs-scalable-real-time-shadows` when large-scene shadow allocation dominates weather
visibility.

Known failure modes:

- snow silhouettes rise but normals stay flat;
- object snow uses world coordinates and slides under animation;
- particles and surfaces read different time, wind, or progress values;
- puddle masks are independent of roughness and normal changes;
- roughness collapse is tied only to heavy-rain ripple masks;
- splashes sample all triangles and appear under objects or on vertical faces;
- data textures are tagged as color textures;
- the post stage double-applies output conversion;
- generated ripple-normal assets are used without preserving their normal-map
  interpretation.
- sparse impact records and their parent `SurfaceExchange` both deposit the
  same mass/momentum, omit `InteractionPartitionMembership`, or multiple
  partitions each claim the whole exchange;
- intensive flux is multiplied by a normalized kernel or uses unit-sum area
  weights instead of physical-square-metre quadrature;
- particle count, receiver tessellation, or update cadence changes integrated
  deposition under a fixed forcing trace;
- a physical cadence/state/support/filter/ID change bypasses
  `QualityTransition`, or a render-only change mutates a provider descriptor;
- a sealed snapshot omits/supersets its `closureManifest` or collapses
  airborne, receiver, and causal-emission state into an ambiguous binding;
- water, weather, and a material each integrate private wetness/snow state, or
  a material consumes a different receiver revision than the visible residue;
- a Celsius projection is sampled as kelvin or an air-velocity field is used as
  water current/vegetation displacement.
