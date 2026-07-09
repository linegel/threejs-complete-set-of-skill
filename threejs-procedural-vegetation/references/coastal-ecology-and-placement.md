# Terrain And Coastal Ecology Placement

Use this reference when procedural vegetation must form coherent communities
on generated terrain, islands, riverbanks, coasts, wetlands, ruins, roofs, or
other constrained surfaces. It defines the interface from environmental fields
to deterministic plants; it does not solve terrain, weather, water, or plant
physiology.

Numerical labels follow the router: **Derived** values follow recorded
equations and labelled inputs, **Gated** values are product/correctness bounds,
**Measured** values are tied to a named harness and target, and **Authored**
values are explicit ecological or style parameters.

## Contents

- Ownership and environmental input
- Species suitability and community structure
- Directional exposure, shelter, and salt
- Deterministic order-independent placement
- Asset and site interface
- Succession, ruins, and authored composition
- Representation, LOD, and mobile cost
- Diagnostics and acceptance

## Ownership And Environmental Input

The vegetation compiler consumes a versioned environmental snapshot:

```yaml
environmentSnapshot:
  revision: ""
  seed: ""
  coordinateFrame: ""
  sceneUnitsPerMeter: ""
  spatialExtent: ""
  terrain:
    elevation: { units: meters, filter: "", invalidValue: "" }
    normalAndSlope: { convention: "", derivation: "" }
    curvatureAndCavity: { support: "", units: "" }
    substrateId: { registry: "" }
  coast:
    signedDistance: { units: meters, sign: land-positive-water-negative }
    tangentNormal: { convention: "" }
    runupEnvelope: { units: meters-or-mask, timeMeaning: "" }
  ecology:
    drainage: { units: "", support: "" }
    soilMoisture: { units: "", support: "" }
    disturbance: { units: "", support: "" }
    canopyOrLight: { units: "", support: "" }
    saltExposure: { units: "", support: "" }
    windExposure: { units: "", prevailingDirection: "" }
  authoredMasks:
    exclusion: ""
    restorationOrPlanting: ""
    pathsAndClearance: ""
  encodingAndResidency: ""
  chunkAndHaloPolicy: ""
  invalidationKey: ""
  missingDataPolicy: ""
```

Do not sample a rendered terrain depth buffer to place persistent vegetation.
Placement uses authoritative terrain coordinates and geometry/field queries;
the render depth is view-dependent, incomplete, and temporally unstable.
Likewise, a material's grass color is not a density field. Both material and
placement consume the same community/coverage cause.

Classify inputs:

| Class | Examples | Placement semantics |
| --- | --- | --- |
| hard eligibility | land/water ownership, active run-up, unsupported slope, built footprint, path, clearance volume | Boolean reject before stochastic ranking |
| limiting response | soil moisture, salinity tolerance, substrate, temperature/light envelope | A poor factor may suppress the species even if other factors are favorable |
| preference response | elevation band, moderate shelter, cavity, aspect | Shapes probability/density without repairing hard failures |
| competition/community | canopy closure, pioneer/mature phase, dominant species patch | Couples species; must not be independent noise per species |
| authored composition | landmark tree, maintained clearing, planted row, restoration area | Explicit constraint with stable identity and provenance |

Every field declares whether it is point-sampled, footprint averaged,
conservatively bounded, or categorical. Never linearly filter categorical
substrate/semantic IDs. If coarse levels can merge disconnected coasts or
habitats, retain conservative bounds or select a level whose support preserves
the classification needed by the candidate.

## Species Suitability And Community Structure

Each species or functional group has a response table:

```yaml
speciesResponse:
  speciesId: ""
  hardRules: []
  responseCurves:
    substrate: ""
    slope: ""
    elevation: ""
    moisture: ""
    drainage: ""
    saltExposure: ""
    windExposure: ""
    shelter: ""
    lightOrCanopy: ""
    disturbance: ""
    coastDistance: ""
  limitingRule: product | minimum | authored-model
  competitionGroup: ""
  nominalSpacing: { value: "", unit: meters, label: Authored, source: species model }
  clusteringScale: { value: "", unit: meters, label: Authored, source: community model }
  variationPolicy: ""
```

Response curves are monotone or unimodal functions with declared domains and
units. Hard-coded color thresholds are not ecological evidence. For a
multiplicative limiting-factor model, the stable **Derived** score is:

```text
E_s(x) in {0,1}                                  hard eligibility
ell_s(x) = sum_k a_s,k * log(max(g_s,k(x), eps)) weighted log response
S_s(x) = E_s(x) * C_s(x) * exp(ell_s(x))         suitability
```

`g_s,k` and community factor `C_s` lie in the authored normalized domain;
weights and `eps` are **Authored** until calibrated. A minimum-rule model is
appropriate when the least favorable factor is the declared limiter. An
additive blend is invalid when it lets excess moisture compensate for lethal
salinity or water occupancy. Record the selected model and rejected
alternatives.

Suitability is not coverage. Convert it to a target intensity, candidate
acceptance, and spacing policy explicitly. If `lambda_s(x)` is the target
intensity in instances per unit area and `A_cell` is a candidate cell area,
then a sparse Bernoulli approximation has **Derived** expected occupancy
`p=clamp(lambda_s*A_cell,0,1)`; it is invalid when several candidates per cell
or exclusion correlations dominate. Use a point process with measured density
error instead of silently relying on that approximation.

Community coherence requires shared causes:

- derive patch-scale community or succession state once, then let species
  responses compete inside it;
- use one moisture, exposure, disturbance, and substrate field across plant
  density, material ground cover, and vegetation variation;
- reserve high-frequency hashes for within-species variation and ranking, not
  for habitat identity;
- preserve isolated authored landmarks separately from stochastic populations;
- expose accepted population by species and rejection cause, not only a final
  green coverage image.

For a stylized island composition, plausible bands may include salt-tolerant
strand cover outside active run-up, grass/flowers on low-slope moist caps,
sheltered shrubs in lee cavities, and larger trees only where rooting volume,
salt, wind, and clearance permit. These are species-table consequences, not a
fixed palm-near-water/conifer-inland rule.

## Directional Exposure, Shelter, And Salt

Coast distance is scalar; exposure is directional. Use the prevailing wind
unit vector `w` and a terrain/obstacle attenuation field. One admissible static
model integrates a nonnegative blocker density `rho` along the upwind ray:

```text
A(x) = integral rho(x - s*w) K(s) ds
T_shelter(x) = exp(-A(x))
```

For the chosen kernel and density units this transmittance is **Derived**.
Kernel support, blocker conversion, and terrain horizon policy are
**Authored** or fitted. A cheaper directional horizon-angle or swept-grid
approximation is valid when its error against the selected reference passes.
This field is static until terrain, obstacles, or prevailing climate changes;
do not ray march it per plant per frame.

A salt/spray exposure model separates source and transport:

```text
Q_sea(x)       coast source from distance, sea-facing orientation, and wave/run-up envelope
T_upwind(x)    directional sea-to-point visibility or attenuation
D_height(x)    authored/fitted height attenuation
E_salt(x)      = Q_sea(x) * T_upwind(x) * D_height(x)
```

The product is **Derived** from the selected normalized factors; it is not a
claim of aerosol-fluid accuracy. If measured or scientific salinity/deposition
data exists, it replaces this appearance model. Keep dynamic gust deformation
separate: static exposure selects growth form and placement, while dynamic wind
drives branch/leaf motion from the shared wind field.

Required diagnostics show prevailing direction, sea source, upwind
transmittance, terrain horizon/shelter, final salt exposure, and each species'
response. A symmetric ring around the shore fails a directional exposure
contract even when its average density looks plausible.

## Deterministic Order-Independent Placement

### Stable candidate identity

Candidates use world-anchored integer cells or another persistent spatial key:

```text
speciesGroupIndex = collision-checked stable registry index
candidateTuple = (generatorSchemaVersion, globalSeedWords,
                  speciesGroupIndex, biasedWorldCellWords, candidateOrdinal)
candidateId = hash(candidateTuple)                             [D]
priorityHashU32 = hash(candidateTuple, "priority")             [D]
priority = u32_to_ordered_unit(priorityHashU32)
variant  = hash(candidateTuple, "variant")
winnerKey = lexicographic(priorityHashU32, candidateTuple)     [D]
```

Give every tuple component a declared fixed-width unsigned encoding. Bias
signed world-cell coordinates with an order-preserving mapping, compare
multiword values most-significant word first, and reject duplicate stable
registry indices. The tuple is unique by construction before hashing.
`candidateId` is only a compact lookup label: compilation must collision-check
it and widen it or retain the canonical tuple when a duplicate occurs.

Specify the integer mixer, wraparound semantics, serialization/comparison
order, and CPU/TSL test vectors.
Compare the fixed-width unsigned integer `winnerKey` identically on CPU and
GPU; the collision-free canonical tuple breaks equal priority hashes. Never
compare only floating-point `priority` or a hashed `candidateId`, because a
collision may otherwise accept both neighbors or make dispatch order decisive.
Never consume a mutable RNG stream whose result changes when a neighboring
chunk loads first or an unrelated species is added.
`environmentRevision` is an invalidation/cache key, not candidate identity:
changing a field may reject or accept a stable candidate, but must not
renumber every unaffected candidate. Increment `generatorSchemaVersion` only
when the candidate lattice or identity algorithm itself changes.

### Candidate and conflict pipeline

Use the smallest algorithm that satisfies density, spacing, and streaming:

| Workload | Candidate process | Acceptance |
| --- | --- | --- |
| sparse authored assets | deterministic stratified/grid candidates plus authored anchors | hard rules, suitability threshold/rank, explicit clearance |
| static moderate field | CPU variable-radius Poisson or conflict graph over all candidates | deterministic priority wins each exclusion conflict |
| streamed large terrain | world-cell candidate lattice with chunk halo | one-hop Matérn-II/local-maximum acceptance, or explicit global-greedy dependency closure |
| frequently regenerated dense field | compute candidate evaluation/compaction only after CPU/implicit A/B | same IDs, rules, and output order independent of dispatch decomposition |

For candidates `i,j` with exclusion radii `r_i,r_j`, declare the symmetric
conflict rule; examples include center distance below `max(r_i,r_j)` or below a
species-pair matrix value. Choose the independent-set semantics explicitly:

- **one-hop Matérn-II/local maximum:** accept a candidate iff its total
  `winnerKey` outranks every directly conflicting candidate. A halo equal to the
  maximum symmetric conflict reach plus field-filter support is sufficient;
- **global priority-greedy:** visit all candidates in total `winnerKey` order and
  accept those with no accepted conflict. Acceptance can propagate through an
  arbitrarily long conflict chain, so a fixed one-hop halo is not sufficient.
  Compile globally/offline, expand the dependency closure, or iterate boundary
  reconciliation to convergence with an explicit failure bound.

Generate halo/closure candidates with global IDs and emit only candidates owned
by the chunk's half-open interior. Compare the selected process's density and
pair-correlation error against its declared target; do not describe local
Matérn-II output as global greedy Poisson sampling.

### Clusters and companions

Clumps use a parent community candidate plus child offsets generated in its
local frame. Child IDs derive from parent ID and child ordinal. Validate child
hard eligibility and neighbor conflicts; do not translate an entire clump
across water or a path because its center is valid. Companion species sample
the same community state with explicit facilitation/competition rules.

### Density LOD

Placement identity is immutable across render LOD. Assign every accepted
instance a stable thinning rank. Budgeted tiers retain a nested prefix or
threshold of that ordering so density changes do not reshuffle the entire
population. Preserve authored landmarks and protected community/species
fractions before thinning. Report canopy/ground-cover error and biome-boundary
movement, not only retained instance count.

## Asset And Site Interface

Every vegetation asset or generated species package supplies:

```yaml
vegetationAsset:
  assetId: ""
  version: ""
  provenanceAndLicense: ""
  sourceUnitsAndUpAxis: ""
  speciesId: ""
  functionalAndCompetitionGroups: []
  groundAnchor:
    rootOrigin: ""
    rootNormalPolicy: ""
    embedRange: ""
  bounds:
    staticGeometry: ""
    crown: ""
    windSwept: ""
    rootOrClearanceFootprint: ""
  responseTableId: ""
  variants:
    ageOrGrowth: []
    silhouette: []
    seasonal: []
    deadOrDamaged: []
  representations:
    geometryLods: []
    clusterLods: []
    impostorSet: ""
    shadowProxies: []
    pickingProxies: []
    collisionOrPhysicalProxies: []
  materialSlots: []
  deformation:
    rootWeights: ""
    branchModes: ""
    leafFlutter: ""
    boundExpansion: ""
  semanticIdsAndPicking: ""
  authoredSockets:
    colonization: []
    flowerOrGroundCover: []
  interactionTags:
    wind: []
    wetnessOrRunup: []
    saltOrWeather: []
    waterOrFoam: []
    causticReceiver: []
  diagnostics: ""
```

Root anchor and root-normal policy are distinct. A vertical trunk may remain
world-up on a slope while its root flare intersects the terrain; ground cover
may align more strongly to the surface. Clamp/tilt policies are species rules.
The conservative wind-swept bound must match the maximum active deformation in
display and shadow paths.

Every vegetation family required by the reference/composition resolves to a
licensed compact asset package with validated metadata or a tested procedural
species generator with fixed-seed fixtures. Missing grass, flower, shrub,
palm/tree, or other required silhouettes are blockers. Do not substitute
generic cones, crossed rectangles, or unrelated density noise and call species
identity complete. A diagnostic placeholder remains explicitly incomplete.

Site assets such as rocks, ruins, docks, instruments, planters, retaining
walls, and paths provide conservative exclusion volumes plus optional
colonization sockets. Vegetation consumes these semantic interfaces; it does
not parse triangles or infer "flat-looking" ledges each frame. A socket records
local frame, support area/depth, allowed functional groups, moisture/exposure
overrides, clearance, and stable owner ID.

Flowers and small accents remain vegetation assets, not unstructured decal
noise. Pebbles and rocks belong to the geometry/site kit; their placement can
share the environmental/conflict compiler but retains separate asset identity,
material, and LOD contracts.

## Succession, Ruins, And Authored Composition

When age, disturbance, or abandonment is visible, define a succession state
field with a declared time meaning. It selects response tables and variants;
it does not rebuild mature plant topology every frame. Typical transitions are
compile-time, sparse-event, or slowly streamed updates.

Ruins and constructed sites require semantic interaction:

- structural footprints and access paths are hard exclusions;
- cracks, soil pockets, wall tops, and collapsed rubble may expose explicit
  colonization sockets;
- vegetation height/root class must fit socket support and clearance;
- vines or trellis plants use graph/path support supplied by the site asset,
  not arbitrary gravity-defying world noise;
- removal/replacement invalidates only affected spatial pages and preserves
  stable IDs elsewhere.

Authored focal assets override stochastic composition through named anchors,
but still pass terrain intersection, bounds, and material checks. Record the
override so a deterministic seed replay distinguishes art direction from
procedural acceptance.

## Representation, LOD, And Mobile Cost

Static environmental placement should normally compile on the CPU or a worker,
serialize compact records, and remain immutable at runtime. Compute earns its
place only when changed data volume, regeneration cadence, or visibility
compaction beats CPU/implicit alternatives on the named targets.

Measure these cost causes:

```text
placement compile/update:
  candidate count, field samples, conflict queries, chunk halos,
  accepted/rejected by cause, compile p50/p95, upload bytes

resident state:
  instance stride after alignment, species/variant tables, duplicate LOD data,
  dynamic wind/contact fields, impostor/color/depth/normal assets

render:
  visible/submitted pages and instances, rejected-but-processed vertices,
  projected alpha coverage and p95 layers, shadow representation,
  whole-frame and paired-marginal CPU/GPU p50/p95, sustained thermal state
```

Quality reduction order follows measured pressure:

- CPU submission: aggregate only adjacent spatial pages that remain cullable,
  or use measured compaction; do not make a world-wide vegetation object;
- vertex/primitive: nested density thinning, lower geometry LOD, cluster
  replacement, then impostors under projected-error gates;
- fragment/alpha: reduce card overlap, select tighter silhouettes, use
  clustered opaque geometry where it wins, and reduce shadow alpha coverage;
- bandwidth: reconstruct stable variation from IDs, compact static records,
  lower dynamic-field extent/cadence, and avoid per-blade writable state;
- memory: evict distant species/LOD pages and duplicate representations with
  transition-lifetime accounting.

Use world-up-constrained multi-azimuth or octahedral impostors for structured
trees. Add depth/normal layers only when relighting/parallax error justifies
their bytes and samples. Grass/flower clusters may use cards when alpha
coverage and multi-view silhouette pass. Every transition uses unjittered
physical-pixel error, hysteresis/dwell, conservative deformed bounds, and
simultaneous transition memory from the shared projected-error contract.

## Diagnostics And Acceptance

Required views:

```text
terrain height/normal/slope and substrate IDs
signed coast distance, coast frame, run-up and hard exclusions
moisture, drainage, disturbance, light/canopy
wind direction, shelter/terrain horizon, salt source and final salt exposure
per-species response factors, hard eligibility, final suitability
candidate cells/IDs/priorities, rejected cause, conflict radius and winners
chunk interior/halo and seam ownership
species/community IDs, variation/age, thinning rank and LOD representation
root anchors, clearance/wind-swept bounds, site exclusions and sockets
visible/shadow deformation parity and no-post final composition
```

Acceptance includes:

- fixed-seed replays are bit-stable where integer/hash semantics promise it;
- generating chunks in different orders yields identical owned instances and
  no seam duplicates/holes;
- moving the camera or changing render LOD does not change placement IDs or
  migrate habitat boundaries;
- hard exclusions have no violations; every accepted plant reports its source
  fields, species response, candidate ID, asset/variant ID, and site owner;
- windward/leeward and salt gradients agree with the declared directional
  model under rotated prevailing-wind fixtures;
- a field perturbation invalidates only the declared dependency region and
  unchanged candidates retain stable IDs;
- close/mid/far captures preserve species/community identity while projected
  silhouette, alpha, canopy, and density errors remain inside **Gated** bounds;
- composed target runs pass **Measured** CPU/GPU/presentation, live-byte,
  upload, and sustained thermal gates.

Reject a result that merely resembles a green island. The evidence must show
why each community exists, which fields exclude it from cliffs/water/site
assets, how placement remains deterministic across chunks, and how the chosen
representations preserve that ecology on the declared deployment matrix.
