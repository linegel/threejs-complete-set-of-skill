# Semantic Site Asset Kits

Use this reference to compile deterministic site assemblies around generated
terrain and water: ruins, docks, piers, boats, rocks, rubble, pebbles,
driftwood, flowers, props, markers, and other repeated or modular assets. The
contract is general-purpose Three.js scene construction, not a gameplay object
model. It preserves semantic identity, attachment, support, clearance,
material ownership, spatial culling, and evidence from plan to rendered result.

Numerical labels follow the router: **Derived** values follow stated equations
and labelled inputs, **Gated** values are product/correctness bounds,
**Measured** values name the target harness, and **Authored** values are explicit
design/ecology parameters.

## Contents

- Compiler and ownership architecture
- Environment and site-plan intermediate representation
- Asset manifest and registry
- Physics proxies, body properties, and solver adapters
- Constraint solving and deterministic placement
- Ruins and constructed fragments
- Docks, piers, boats, and water interfaces
- Rocks, rubble, pebbles, debris, and plants
- Compilation, paging, and representation LOD
- Supplemental asset inventory
- Diagnostics and acceptance

## Compiler And Ownership Architecture

The asset registry and environment snapshot are inputs; the serializable plan
is the authority; meshes are emission products:

```text
SiteSettings + EnvironmentSnapshot + AssetRegistry + authored anchors
  -> derive support regions and semantic candidate domains
  -> create deterministic candidates / modular assemblies
  -> solve hard constraints, attachments, and clearance
  -> select asset family, variant, representation policy, and material slots
  -> validate SitePlan
  -> compile spatial pages by representation and material compatibility
  -> bind NodeMaterial identities and dynamic provider interfaces
  -> render / stream / replace through stable semantic IDs
```

Composition order is semantic and deterministic:

```text
required landmarks and authored reservations
  -> dependent supports/attachments (foundation, dock, berth, mooring, access)
  -> ecology and vegetation using the accepted keepouts/sockets
  -> optional filler clusters, debris, pebbles, flowers, and decals
```

Each phase consumes stable outputs from earlier phases and resolves its own
halo candidates by stable priority. Do not scatter filler first and push a
landmark or dock until it fits. Later optional phases may be rejected by prior
required reservations; they may not move those reservations.

Keep these owners separate:

| Cause | Owner |
| --- | --- |
| terrain/coast/bathymetry/exposure/support fields | `$threejs-procedural-fields`, terrain owner, or authoritative data source |
| low-level generated profiles/rocks/module meshes | `$threejs-procedural-geometry` |
| building/ruin/dock/site grammar and semantic assembly | this skill |
| vegetation species, ecology placement, growth, rooted wind | `$threejs-procedural-vegetation` |
| surface PBR identity and filtering | `$threejs-procedural-materials` |
| dynamic free surface, depth, currents, interaction/foam hooks | water owner |
| transform timelines, moored/floating response, vehicle/prop motion | `$threejs-procedural-motion-systems` or the selected domain solver |
| scene output, post, and final color | image-pipeline/output owner |

This compiler may validate and serialize interfaces to every owner. It may not
invent a substitute solver inside a placement callback.

## Environment And Site-Plan Intermediate Representation

### Environment snapshot

```yaml
environmentSnapshot:
  revision: ""
  seed: ""
  coordinateFrame: "" # site-plan coordinates only; never a physics provider frame
  physicsContextRef: { contextId: "", schemaId: "", contextVersion: "" }
  physicsSignalDescriptorRefs: []
  extent: ""
  terrain:
    elevationAndNormal: ""
    slopeCurvatureCavity: ""
    substrateAndSemanticRegions: ""
  coast:
    signedDistance: { channelRef: "", sign: land-positive-water-negative }
    tangentOutwardNormal: { convention: "" }
    restWaterElevation: { channelRef: "" }
    staticWaterDepth: { channelRef: "", derivation: "" }
    runupOrInundationEnvelope: { channelRef: "" }
  ecologyAndExposure:
    moistureSaltWindShelter: ""
  authoredConstraints:
    exclusionVolumes: ""
    pathsAndAccess: ""
    protectedViewsOrClearances: ""
  sampling:
    filterAndCategoricalPolicy: ""
    chunkAndHaloPolicy: ""
    missingDataPolicy: ""
  invalidationKey: ""
```

Do not infer persistent support from the camera depth buffer. The snapshot is
view-independent and versioned. A shoreline tangent/normal must specify which
normal points from land to water; docks and sea-facing modules otherwise flip
unpredictably. Static water depth is **Derived** from terrain and rest-water
elevations only when units and datum agree.
For physics-facing inputs, `physicsSignalDescriptorRefs` references canonical
providers; the snapshot does not restate their units, scale, frame, time,
filter, validity, or errors. `coordinateFrame` describes only site-plan layout.
Obtain `metersPerWorldUnit` and all world/physics transforms only from the
referenced `PhysicsContext`; derive its reciprocal once.

### Serializable site plan

```ts
type SitePlan = {
  revision: string;
  seed: number | string;
  environmentRevision: string;
  placements: SitePlacement[];
  attachments: SiteAttachment[];
  pages: SitePagePlan[];
  diagnostics: SiteDiagnostics;
};

type SitePlacement = {
  placementId: string;
  assetId: string;
  assetVersion: string;
  familyId: string;
  variantId: string;
  source: "authored" | "grammar" | "scatter" | "attachment";
  frame: SerializedFrame;
  support: SupportRecord;
  footprint: SerializedShape;
  clearanceVolumes: SerializedShape[];
  attachmentSocketIds: string[];
  materialSlotBindings: Record<string, string>;
  representationPolicyId: string;
  semanticIds: Record<string, string | number>;
  dynamicProviderIds: string[];
  colliderIds: string[];
  deformingSupportIds: string[];
  rigidBodyPropertiesRef?: {
    entityId: string;
    sourceRecordId: string;
    sourceRecordVersion: string;
  };
  hydrostaticHullPropertiesRef?: {
    entityId: string;
    sourceRecordId: string;
    sourceRecordVersion: string;
  };
};
```

`placementId` remains stable while the asset retains the same causal candidate
and accepted constraint state. Runtime page or instance indices are ephemeral
and never become semantic identity.

The plan records every rejection with candidate ID and cause:

```text
missing field or invalid sample
unsupported substrate/semantic region
slope/orientation outside asset contract
insufficient footprint support or embed depth
land/water/depth/run-up violation
clearance or inter-asset conflict
attachment/socket incompatibility
missing asset, material slot, LOD, or dynamic provider
page/representation budget rejection
```

Budget rejection never silently substitutes a semantically different family.
Use an explicit lower representation of the same asset, deterministic density
thinning for optional scatter, or fail the required placement.

## Asset Manifest And Registry

Every generated or imported asset has a stable, versioned manifest:

```yaml
siteAsset:
  assetId: ""
  version: ""
  familyId: ""
  semanticClass: ""
  provenanceAndLicense: ""
  source:
    units: ""
    upAxis: ""
    handedness: ""
    authoringTransform: ""
  geometry:
    representations: []
    topologyIdentityKeys: []
    materialSlots: []
    localBounds: ""
    deformationSweptBounds: ""
  anchors:
    ground: []
    embed: []
    wallOrStructure: []
    waterline: []
    berthOrMooring: []
    interactionEmitters: []
  support:
    footprint: ""
    requiredCoverage: ""
    normalOrTiltPolicy: ""
    substrateAndRegionRules: []
    coastDistanceAndDepthRules: []
  clearance:
    hardVolumes: []
    softSpacingClass: ""
    visibilityOrAccessVolumes: []
  attachments:
    providedSockets: []
    requiredSockets: []
  placement:
    scatterClass: ""
    clusterClass: ""
    orientationPolicy: ""
    variantWeights: []
  dynamicInterfaces:
    providerSchemaIds: []
    providerIds: []
    stateBounds: ""
    interactionTags:
      waterSurface: []
      foamOrWake: []
      wetnessOrRunup: []
      causticReceiver: []
      windResponse: []
  representation:
    lodPolicyId: ""
    impostorOrProxyAssets: []
    shadowPolicyId: ""
    shadowProxies: []
    pickingProxies: []
    collisionOrPhysicalProxies: []
  physics:
    derivedPhysicsMaterialIds: [] # validation projection from collider/body refs; not an owner
    colliderIds: []
    deformingSupportIds: []
    rigidBodyPropertiesRef: { entityId: "", sourceRecordId: "", sourceRecordVersion: "" }
    hydrostaticHullPropertiesRef: { entityId: "", sourceRecordId: "", sourceRecordVersion: "" }
    externalSolverAdapterIds: []
  diagnosticsAndTests: ""
```

The registry validates before site generation:

- source units, axes, local origin, and every anchor frame;
- nonempty conservative bounds for each representation and active deformation;
- material slot names and compatible NodeMaterial identity families;
- topology identity keys for instancing and uniqueness for merge/batch paths;
- LOD/proxy coverage and transition policy;
- required dynamic provider schemas and missing-provider behavior;
- canonical physics provider/adapter IDs, proxy schemas, property records,
  `PhysicsContext` compatibility, and explicit absent-channel behavior;
- support, clearance, attachment, and semantic IDs;
- water/foam/wetness/caustic/wind interaction tags plus collision/physical,
  picking, and shadow proxies where the product contract consumes them;
- asset provenance, generation seed/tool revision, and deterministic content
  hash where reproducibility requires it.

An asset with a visually correct mesh but no anchor, units, material slots, or
bounds is incomplete. Do not recover these semantics from vertex extrema at
runtime except in an explicit import/conversion tool that writes and validates
the manifest.

Every family declared required by the composition contract must resolve to
either a licensed compact asset kit with validated manifests or a tested
procedural module/generator with equivalent fixtures. Missing required ruins,
docks, boats, rocks, vegetation, foreground/background cloud silhouettes, or
other identity-bearing families are blockers. They are not permission to emit
generic boxes, cylinders, billboard blobs, or unrelated noise and call the
reference matched. Route cloud generation/transport to the cloud/atmosphere
owner; this registry records only its composition requirement, ID, bounds, and
handoff.

## Physics Proxies, Body Properties, And Solver Adapters

Apply the shared
[physics-domain and interaction contract](../../threejs-choose-skills/references/physics-domain-and-interaction-contract.md).
The site plan declares physical semantics; it does not become a physics engine.
Every consumed record is registered by stable ID and version under one
`PhysicsContext` and one route `PhysicsGraph`/coordinator. Individual graph
stages and records retain their canonical distinct owners.

### Collider and support proxies

A `ColliderProxy` uses the common schema unchanged:

```text
colliderId, entityId, shapeId                       generation-bearing IDs
physicsFrameId, physicsOriginEpoch
shapeRepresentation, topologyRevision, poseStateVersion
sweptBounds, physicsMaterialId, collisionGroups
approximationError, residency
```

The site asset manifest keys source asset/version, semantic owner,
transform-provider ID, sidedness/closedness, margin/CCD policy, scale/state
validity, provenance/build revision, and fixtures to that canonical record; it
does not add a competing collider envelope. A compound object uses child
`ColliderProxy` records when regions need different `PhysicsMaterialId` values.

Select the canonical `analytic`, `convex`, `mesh`, `sdf`, `compound`, or
`external` representation from contact/error and update requirements; a
primitive or heightfield maps through the named analytic/external adapter.
Do not use a render bounding box as an accepted proxy merely because it is
cheap. Concave triangle meshes and moving/deforming shapes require explicit
solver capability, cost, tunnelling/CCD, and update evidence.

Static support exposes the canonical `SupportSurfaceSample` through the terrain
or geometry adapter. A moving or deforming support uses a
`DeformingSupportProxy` with stable support/feature IDs, topology/version,
frame/transform provider, valid `PhysicsTimeInterval`, deformation/swept
bounds, footprint, and error contract. The site compiler may bind that proxy
but may not synthesize motion from the visible mesh. Missing optional sample
channels are absent, never zero-filled.

`SupportSurfaceSample` stays kinematic. Contact lifecycle, A-to-B normals,
manifolds, contact penetration, TOI, moving-frame relative point velocity,
material-state latching, impulses, and reactions belong to the collision
solver, not the site or support provider. `ContactManifoldRecord` owns persistent
manifold/lifecycle/internal state; canonical `InteractionRecord` owns typed
impulses, constraints, and reactions. Optional support signed separation
remains only a kinematic query.

Proxy identity is LOD-invariant. Hero, mid, far, impostor, shadow, picking, and
batched representations all reference the same physical proxy IDs. A proxy may
have its own quality/cost variants only through an explicit physics
`QualityTransition` that preserves semantic body/material IDs, declares changed
error and conservation effects, and is accepted by the physics owner. Graphics
LOD selection cannot silently switch collision topology.

If a physics transition changes proxy representation, migrate or explicitly
reset contact manifolds and warm starts. A render crossfade may show both LODs,
but exactly one physical representation emits contacts/forces.

### Rigid body and hydrostatic records

`RigidBodyProperties` is source data, not an inference from render triangles:

```text
entityId, owner, bodyFrameId
massKg, centerOfMassBodyMeters, inertiaTensorBodyKgM2
colliderIds, physicsMaterialIds
stateEquation, forceTorqueApplicationOwner, error (per-property map)
```

Use those canonical fields unchanged. Store source/provenance, valid
configuration/scale, and derivation evidence in the asset/property source
record referenced by the manifest, not as a second body-property ABI.

Gate positive mass and a finite symmetric positive-definite inertia tensor;
verify parallel-axis and frame conversions. Scaling an asset requires a newly
derived/versioned mass-property record under a declared density/scale law, not
reuse of the original tensor.
Physics body/proxy frames permit only finite proper rigid transforms; reject
reflection/negative scale at the adapter boundary or bake a separately
validated asset/proxy/properties version. A quaternion cannot encode a
reflection, and an unrecorded scale invalidates mass, inertia, volume, and drag.

`HydrostaticHullProperties` records the closed wetted/hull representation used
by the selected water/body adapter, not the visible hull skin:

```text
entityId, hullFrameId, geometry, geometryRevision
displacedVolumeQuery, waterlineClipping, buoyancyModel
dragModel, addedMassModel, waveExcitationModel
samplingFootprint, approximationError, validity
```

The versioned queries/laws carry closed volume or displaced-volume-versus-
immersion data, center-of-buoyancy/waterplane results, reference waterline and
valid heel/trim/immersion domain, drag/lift areas and coefficients, and their SI
units, regime, provenance, closure/sampling/interpolation errors. Do not promote
those implementation details to alternate top-level field names.

Displacement mass is `rho_fluid * displacedVolume` only for the declared fluid
density and state; store volume and mass semantics separately. A single drag
coefficient without reference area, velocity convention, fluid properties,
valid regime, and provenance is unusable. Visual sample points may drive a
perceptual bobbing adapter, but they do not prove hydrostatic conservation.
The body adapter uses the same filtered `WaterSurfaceSample` bracket as the
coupling schedule: buoyancy uses the declared surface/pressure model, while
drag uses material-current velocity relative to the body, not surface-point
velocity. Added-mass/wave-excitation laws must not duplicate water-solver force.

### External solver adapter

Structural response, fracture, rigid-body contact, mooring constraints,
buoyancy, navigation, and two-way fluid/structure coupling belong to a named
external/domain solver adapter. Use `ExternalSolverAdapter` unchanged:
`adapterId`, `externalSolverIdVersion`, `contextId`, `ownedStateEquations`,
`supportedFramesCharts`, `unitConversion`, `clockMapping`, `stepSemantics`,
`signalDescriptors`, `acceptedInteractions`, `emittedReactions`,
`residencySynchronization`, `precisionDeterminism`, `errorModel`,
`checkpointRollback`, and `failurePolicy`. Site metadata references that
adapter; it does not define another solver envelope. The adapter joins the
canonical scheduler:

```text
ingest -> sample-forcing -> predict -> emit-interactions -> solve-subcycles
       -> reduce-reactions -> correct -> commit -> publish-presentation
```

`publish-presentation` produces a view-independent
`PhysicsPresentationCandidate` with one `PresentedStatePair` per stable
binding/provider. Dynamic transforms use canonical `RigidBodyState`; each
pair's previous/current arm has independent `PresentationSampleProvenance`,
`presentedInstant`, state handle, and spatial binding. The camera owner then
publishes `CameraViewPublication` with render mapping; visibility, LOD,
acceleration, shadows, caches, resets, and preparation lease refs belong to
`ViewPreparationPublication`. The sealed per-target/view snapshot references
candidate binding IDs and leases rather than copying pairs or transforms. The
multi-target `FrameExecutionRecord` owns target status and lease-keyed
completion, abort, device-loss, and retirement disposition. A site/solver
adapter does not publish a singular final snapshot before those consumers run.

Adapters consume canonical `SupportSurfaceSample`, `WaterSurfaceSample`,
`EnvironmentForcingSnapshot`, `ColliderProxy`, and material/body records as
required, and exchange canonical `InteractionRecord`/reaction data. They do
not call site placement or render-mesh raycasts inside the solver step.
Provider latency, stale/missing behavior, CPU/GPU barriers, and interpolation
are declared in the route's `PhysicsGraph`; no in-frame readback is hidden by a
site callback.
The collision adapter alone resolves contact impulses. It computes relative
point velocity with translational and `omega cross r` terms, uses the declared
A-to-B normal convention and begin/persist/end lifecycle, and atomically
latches both `PhysicsMaterialId`/`materialStateVersion` values plus registry and
selected constitutive-pair-law versions before
selecting one admissible pair law.

Validate registry closure, frame/unit/context agreement, LOD-invariant proxy
identity, material bindings, mass/inertia/hull positivity, hydrostatic curves,
proxy-versus-source surface error, swept bounds, missing-provider failure, and
adapter round trips. For supported two-way coupling, close reaction impulse and
mass, linear/angular momentum, energy/work, and species ledgers within product
**Gated** bounds. Check hydrostatic displaced-volume consistency separately;
volume is conserved only under an explicitly fixed-density incompressible model.

Package immutable proxy topology and hull tables once per asset/version and
bind instances through compact SoA IDs/transforms/state versions; do not clone
collider meshes or create per-object query callbacks. Account proxy/property/
identity-map bytes, broad/narrow-phase work, provider batches, interaction and
contact queues, warm starts/manifolds, frame-in-flight resources, and old/new
`QualityTransition` overlap separately from render geometry. View culling may
hide presentation only; physics sleeping/domain activation remains solver-owned
and cannot discard an authoritative body merely because it is off camera.

## Constraint Solving And Deterministic Placement

### Candidate identity and variation

Use world-stable keys:

```text
familyIndex    = collision-checked stable registry index for familyId
candidateTuple = (generatorSchemaVersion, siteSeedWords,
                  familyIndex, spatialCellOrGrammarOwnerWords, ordinal)
candidateId    = hash(candidateTuple)                          [D]
priorityU32    = hash(candidateTuple, "priority")              [D]
variantId      = weightedChoice(hash(candidateTuple, "variant"), validVariants)
yawOrPhase     = hash(candidateTuple, "orientation")
winnerKey      = lexicographic(priorityU32, candidateTuple)    [D]
```

Each component of `candidateTuple` has a declared fixed-width unsigned encoding;
signed cell coordinates use a declared order-preserving bias, and multiword
values compare most-significant word first. The registry rejects duplicate
`familyIndex` values, and the tuple is unique by construction before hashing.
`candidateId` is a compact lookup label, not the collision tie-break. Detect a
duplicate `candidateId` during compilation and either widen it or retain the
canonical tuple beside it; never silently merge two candidates.

Specify integer wraparound, serialization, comparison order, and test vectors.
A mutable PRNG stream is invalid for streamed chunks because load order,
culling, or an added asset family can change every later result.
`environmentRevision` invalidates support and acceptance caches but is not part
of `candidateId`: an environmental edit may accept or reject a candidate
without renumbering unaffected placements. Increment `generatorSchemaVersion`
only when the candidate lattice or identity algorithm changes.
Use the same fixed-width unsigned lexicographic comparison on CPU and GPU.
The collision-free canonical tuple breaks equal priority hashes, so a hash
collision cannot accept both conflicting candidates or defer the decision to
dispatch order.

Filter variants by semantic compatibility before weighted selection. Never
select an invalid boat, dock, tree, or rock and then move it until it happens
to fit. Randomness chooses among valid designs; constraints define validity.

### Support and frame construction

For an accepted point `x`, build a frame from the asset's orientation policy:

```text
ground-aligned:
  up = filtered terrain normal, with authored maximum tilt policy
  tangent = stable projection of world/reference axis into support plane

coast-aligned:
  outward = declared land-to-water coast normal
  along = coast tangent with declared handedness
  up = world/gravity up unless a georeferenced surface says otherwise

berth-aligned:
  frame supplied by dock/harbor socket, never recomputed from boat bounds
```

If projection of the reference axis degenerates, use a deterministic alternate
axis selected from the frame contract. Do not let a floating-point branch pick
different yaw on neighboring devices without a tolerance and test fixture.

Support validation samples the whole declared footprint or conservative
support probes, not only the center. Report minimum/maximum elevation,
uncovered fraction, slope/normal spread, embed depth, and intersection with
hard semantic regions. The exact acceptance bounds are product **Gated** or
asset **Authored** and must be evidence-labelled.

### Clearance and order independence

Represent hard clearance with asset-specific conservative volumes and soft
spacing with symmetric pair rules. Resolve stochastic candidates from total
`winnerKey` values over the declared conflict graph. A one-hop
Matérn-II/local-maximum rule accepts a candidate only when it outranks every directly conflicting
candidate; then a chunk halo containing the maximum conflict reach,
support/filter footprint, and attachment reach is sufficient. A global
priority-greedy independent set can have arbitrarily long dependency chains;
it requires global/offline compilation, dependency-closure expansion, or
iterated boundary reconciliation to convergence—not a claimed finite halo.
Record the selected semantics, closure/reconciliation evidence, and emit only
the half-open interior owner.

Authored anchors have declared priority and conflict behavior. A required dock
may reserve its approach/berth volume before optional rocks and plants; this is
a semantic precedence rule, not a lucky generation order. Record every
displaced/rejected optional placement.

## Ruins And Constructed Fragments

Ruins are structured assemblies, not randomly deleted building triangles.
Start from a plan graph:

```text
foundation/support polygon
  -> surviving wall/column/arch segments
  -> explicit openings and corners
  -> collapse cuts and exposed fracture boundaries
  -> rubble source regions and support
  -> caps, thickness, material layers, and weathered edges
  -> vegetation/attachment sockets
```

Required ruin semantics:

- wall thickness, front/back material ownership, closed cut surfaces, and
  stable normals/UV scale;
- structural module IDs and surviving adjacency so corners, arches, and caps
  remain coherent;
- damage/collapse state selected at plan level; a removed module updates
  support and attachments before mesh emission;
- rubble mass/size distribution and source region, with overlap/support checks;
- foundations embedded into terrain through a declared datum or support fit;
- access/view/maintenance clearances where required by the scene contract;
- colonization sockets for cracks, soil pockets, wall tops, and trellises,
  consumed by vegetation rather than encoded as arbitrary green decals.

Use generated fracture geometry only when close silhouette or exposed cut
surfaces require it. Mid/far states can use precompiled damage variants or
material masks if their projected topology and shadow error pass. Do not spend
unique geometry on subpixel rubble while omitting the ruin's wall thickness or
support.

## Docks, Piers, Boats, And Water Interfaces

### Dock/pier plan

A dock plan is an attachment graph:

```text
landRoot -> approach/deck segments -> optional junction/platform
         -> pile/bed contacts      -> berth/mooring sockets
```

Each segment records:

```text
coast frame and land-root support
deck datum, width/profile, and longitudinal stationing
terrain/water crossing and minimum support/contact semantics
pile or abutment locations, bed contact, and cut/termination policy
material slots and UV distance
berth, mooring, ladder, light, railing, and attachment sockets
approach, under-deck, berth, and navigation clearance volumes
static bounds plus any dynamic/swept bounds
```

The environment supplies coast frame, bathymetry/static depth, and rest-water
datum. The water owner supplies any dynamic surface/current/interaction state.
The site compiler may place piles to declared bed contacts and validate deck
clearance against a supplied run-up/envelope; it does not predict waves.

Generate deck/plank repetition through distance-based UVs, identical-topology
instancing, or merged slot geometry selected by projected detail and draw cost.
Do not create one object per plank/pile when immutable compilation suffices.
Hero irregularity comes from bounded variant IDs and shared material/weathering
fields, not a unique material clone per board.

### Boat/floating asset contract

A boat or floating object supplies:

```yaml
floatingInterface:
  hullFrameId: ""
  authoredWaterlinePlane: ""
  hullBoundsAndDraftEnvelope: ""
  rigidBodyPropertiesRef: { entityId: "", sourceRecordId: "", sourceRecordVersion: "" }
  hydrostaticHullPropertiesRef: { entityId: "", sourceRecordId: "", sourceRecordVersion: "" }
  colliderIds: []             # ColliderProxy.colliderId
  visualSamplePoints: []
  berthAndMooringAnchors: []
  freeWaterClearanceHull: ""
  providerSchemaId: ""
  transformProviderId: ""
  waterProviderId: ""
  wakeOrInteractionEmitters: []
  staticAndSweptRenderBounds: ""
```

The authored waterline is asset semantics, not inferred from whichever
triangles happen to intersect the current water surface. The water provider
returns canonical `WaterSurfaceSample` values at `sampleInstant`; the selected
body/motion solver owns versioned `RigidBodyState` at its `PhysicsInstant` and
`PhysicsTimeInterval` validity. A simple visual
heave/pitch/roll adapter is acceptable only when the truth/style contract
permits it; conserved buoyancy or navigation physics belongs to a domain
solver. The site plan stores provider and anchor IDs, not the solver.
The domain solver consumes the registered mass, inertia, hull, collider,
physics-material, and water-provider records; it must not derive them from the
active hull LOD or its render bounds.

Wake/interaction emitters are metadata: position/frame, footprint, dimensioned
parameterization, activation state, and owner ID. At runtime the owning adapter
serializes them through the canonical `InteractionRecord` schema unchanged,
including `applicationInterval: PhysicsTimeInterval`, tagged dimensional
payload, target state equation, exact-once/application keys,
`reactionGroupId`/`reactionToInteractionIds`, and conservation groups. Overflow belongs to the
`InteractionBatchLedger`, which
uses the canonical published range, per-consumer cursors, typed outcomes,
overflow ranges/policy, lost/deferred commodity maps, and application-ledger
version. A dropped record cannot carry its own status. Water
decides whether accepted records produce analytic ripples, a local heightfield
source, foam, or no effect. A boat material or transform script must not paint
its own independent wake.

Berth fixtures verify boat swept bounds against dock, shore, neighboring
vessels, and approach volumes over the supplied motion envelope. Free-water
scatter additionally validates static depth/draft, coast/obstacle clearance,
and the selected motion provider's domain.

## Rocks, Rubble, Pebbles, Debris, And Plants

### Rock and rubble families

Manifest each family by scale class, topology variants, substrate/material
identity, embed/support policy, cluster rule, and LOD package. Select variants
from stable candidate IDs. Align large rock support through conservative base
probes and an authored tilt policy; do not fully align every boulder to a
single noisy triangle normal. Embed depth is part of the asset contract and
must not expose hollow undersides.

Cluster generation separates parent patch from children:

- parent candidate uses terrain/coast/substrate/exposure eligibility;
- child IDs derive from parent ID and ordinal;
- child offsets/orientations are generated in the support frame;
- every child revalidates water/land, slope, support, and conflicts;
- cluster material/palette variation uses shared causes and family IDs.

Pebbles and small debris should normally be paged identical-topology instances,
merged static geometry, a material/height representation, or omitted according
to projected silhouette/parallax and shadow error. Do not allocate individual
scene nodes for subpixel accents. Preserve a sparse set of larger semantic
stones where they establish shoreline scale or navigation/reference context.

Rubble from ruins remains tied to source assembly/damage IDs. Driftwood and
wrack consume run-up/deposition regions if provided; an arbitrary coast-distance
ring is only an explicitly authored appearance approximation.

### Plants and flowers

The site compiler contributes constructed exclusions, sockets, and authored
plant anchors. `$threejs-procedural-vegetation` owns species suitability,
order-independent ecology placement, growth, wind bounds, and density LOD.
Flowers are vegetation assets with root anchors and ecology response, not
colored pebbles. Site plans reference their stable vegetation placement/page
IDs rather than duplicating them in a generic prop scatter.

## Compilation, Paging, And Representation LOD

Choose package from topology, mutability, identity, material compatibility,
and spatial visibility:

| Asset state | Default package | Keep identity at |
| --- | --- | --- |
| static unique ruin/dock assembly | merged indexed geometry per material slot, with triangle-range map | module/placement range in plan |
| editable modular assembly | `BatchedMesh` per compatible slot when replacement/visibility needs it | batch object plus placement/module ID |
| repeated identical rocks/pebbles/plants/props | spatially paged `InstancedMesh` or compatible instance-storage path | stable instance record independent of runtime index |
| many static small unique fragments | merge by page/material after semantic plan validation | compact range/ID map or page-level identity if permitted |
| distant complex landmark | authored/generated proxy or multi-view impostor | landmark placement ID |

Installed r185 WebGPU loops visible `BatchedMesh` multi-draw entries; it does
not prove one draw per material family. Report backend entries. Merge compatible
static geometry or instance identical topology when actual draw reduction is
required.

Spatial pages are bounded before draw submission. Page bounds include maximum
active deformation, water/boat motion envelopes, and LOD transition overlap.
Do not group an entire archipelago into one uncullable asset batch. Conversely,
do not make every pebble a page. Select page size from **Measured** culling,
submission, overdraw, upload, and memory evidence.

Representation transitions follow unjittered physical-pixel error:

- geometry for silhouette, cast-shadow, section/intersection, and close
  parallax that the lower representation cannot preserve;
- normal/height/material detail for resolved shading without topology change;
- proxy/impostor for distant complex assemblies when view and relighting error
  pass;
- nested deterministic thinning for optional scatter, preserving landmark and
  family/cluster composition.

Each transition records simultaneous residency/visibility, hysteresis/dwell,
shadow proxy, identity/picking policy, and memory lifetime. A lower tier may
remove optional pebbles or flowers; it may not replace a ruin, dock, boat, or
navigation/reference marker with a semantically unrelated object.

## Supplemental Asset Inventory

The procedural skills provide algorithms and contracts; a scene still needs
source content or generators for the identities it intends to show. Declare
each inventory item as required, optional, generated-at-build, generated-at-
runtime, or absent-with-approved-substitute:

```yaml
supplementalInventory:
  terrainAndCoast:
    - semantic substrate/region registry
    - bathymetry/rest-water/coast-frame data products
    - cliff/beach/terrace profile library where geometry requires it
  materialFamilies:
    - grass/soil, cliff/rock, dry/wet sand, seabed/reef response bundles
    - wood, masonry, metal, roof, vegetation, boat-hull response bundles
    - mip-safe color/data arrays or generated fields with scale metadata
    - normal mean/cone-variance or height data where specular filtering needs it
  geometryFamilies:
    - rock/boulder/pebble and submerged-reef variants
    - ruin wall/corner/opening/arch/cap/fracture/rubble modules
    - dock deck/beam/pile/railing/ladder/mooring modules
    - boat/floating-prop hull and representation variants
    - driftwood/debris/marker/utility families required by the composition
  vegetationFamilies:
    - grass/ground-cover/flower/shrub/tree/palm species packages
    - seasonal/growth variants, wind weights/modes, shadow proxies, impostors
  representationAssets:
    - geometry LODs, cluster proxies, impostor color/depth/normal as justified
    - shadow proxies and conservative bounds
    - ColliderProxy/DeformingSupportProxy records and picking proxies when consumed
    - RigidBodyProperties and HydrostaticHullProperties for dynamic/floating assets
  compositionFamilies:
    - required ruin, dock, boat, rock/reef, debris, and vegetation kits
    - required foreground/background cloud-silhouette package or tested cloud generator
  semanticData:
    - all asset manifests, anchors, sockets, support/clearance shapes
    - material-slot registry, stable IDs, provenance, generation revisions
    - PhysicsMaterialId bindings and provider/adapter schemas for water/motion/interactions
  validation:
    - fixed seeds, environment snapshots, reference cameras/trajectories
    - field/identity/anchor/LOD diagnostics and target-device evidence profiles
```

Optional water-owned visual assets such as caustic/normal/noise sources,
whitecap or foam structure targets, and wake/splash atlases belong in the water
system's manifest. The site registry may reference their emitter/schema IDs but
does not define their solver or transport.

The inventory is an acceptance gate, not a shopping suggestion. For every
required family, record `licensed-asset-kit`, `tested-procedural-module`, or
`blocked`. `placeholder` is allowed only in an explicitly incomplete diagnostic
fixture and cannot pass reference-level visual acceptance.

Prefer generated geometry and fields where parameterization, scale variation,
or semantic coupling is the missing capability. Prefer authored/imported assets
when identity, industrial design, cultural style, or measured shape is the
source of truth. Hybrid assemblies commonly use procedural mass/placement with
authored module meshes and generated material/weathering fields.

## Diagnostics And Acceptance

Required plan views and reports:

```text
environment revision, terrain/support, substrate/semantic regions
signed coast distance, coast frame, rest water/depth/run-up inputs
candidate IDs/priorities/families/variants and rejection causes
placement anchors/frames, support probes, embed, footprint, and normal spread
hard/soft clearance volumes, conflicts, winners, authored precedence
attachment graph, sockets, required/missing providers
PhysicsContext/frame/epoch, physics-material and LOD-invariant proxy IDs
RigidBodyProperties mass/COM/inertia and HydrostaticHullProperties diagnostics
external solver adapter stage, interaction/reaction ownership, and conservation residuals
ruin module/damage/closure/rubble/colonization ownership
dock root/deck/piles/bed contacts/berths/approach and under-deck clearance
boat hull/waterline/swept bounds/moorings/provider/wake emitter metadata
rock/debris clusters and vegetation exclusion/socket handoffs
material slot and representation per placement/triangle/instance
spatial page bounds, visible/culled/submitted work, LOD transitions
compiled draws/backend entries, V/T, instance stride, metadata and asset bytes
no-post final composition and semantic-ID overlay
```

Validation fixtures include:

- flat, sloped, terraced, cliff, concave coast, convex headland, narrow island,
  disconnected islands, shallow shelf, and missing-data environment snapshots;
- ruin alone, ruin with rubble, ruin with vegetation sockets, dock across a
  sloped shore, piles over variable bed, dock with several berths, moored boat,
  free-water boat, rock/pebble clusters across chunk seams, and mixed landmark
  plus optional scatter;
- seed replay and chunk-order permutations that produce identical owned
  placements and no seam duplicates/holes;
- rotated/negated coast-frame tests that catch inward/outward and tangent
  convention errors;
- missing asset/material/anchor/socket/provider tests that fail plan validation
  before partial geometry appears;
- proxy identity across every render LOD, context/frame/epoch mismatch,
  unknown `PhysicsMaterialId`, invalid mass/inertia/hull properties, absent
  optional channels, missing external solver adapter, and interaction-stream
  overflow/conservation fixtures that fail before simulation;
- overlap, unsupported footprint, hollow underside, water/depth, run-up,
  access, berth, and swept-bound failures with explicit diagnostics;
- close/mid/far and trajectory captures showing representation, shadow,
  identity, and population transitions under **Gated** projected-error bounds;
- sustained composed runs on the declared deployment matrix with **Measured**
  CPU/GPU/presentation p50/p95, uploads, resident/transient bytes, visible versus
  culled work, attachment/alpha cost, and thermal/quality drift.

Reject the system when visual plausibility depends on generation order,
untracked mesh extrema, per-object material clones, uncullable world batches,
private terrain/water noise, render-derived physical properties or proxies, or
silent asset substitution. A valid site can be
explained from environment revision and seed through candidates, constraints,
anchors, manifests, compilation, and final representation.
