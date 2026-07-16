# Terrain Ecology And Placement

Read this reference when vegetation density or species identity depends on
terrain, substrate, moisture, light, disturbance, exposure, water, or authored
site constraints. It turns versioned environmental fields into deterministic
plant records; the field owners remain outside vegetation.

## Contents

- Input contract
- Suitability and community
- Stable candidate identity
- Conflict selection
- LOD population invariant
- Site and asset interface
- Completion evidence

## Input contract

Each input names its owner, frame or chart, units, support/filter, validity,
error, revision, and missing-data policy. The minimal set is:

```text
height and geometric normal/slope
categorical substrate or semantic region
authored exclusion and clearance volumes
```

Add only fields that a species response actually consumes, such as moisture,
drainage, cavity, canopy/light, disturbance, temperature, prevailing exposure,
salt, inundation, or signed distance to a boundary. Persistent placement uses
authoritative fields or geometry queries. Render depth, rendered color, and a
transient terrain LOD are view-dependent observations and cannot own habitat.

Classify every input before combining it:

| Class | Meaning | Evaluation |
| --- | --- | --- |
| hard eligibility | occupancy, support, slope limit, active inundation, path, structure, clearance | Boolean rejection before ranking |
| limiting response | moisture, salinity, temperature, rooting depth | one bad factor may suppress the species |
| preference response | aspect, moderate shelter, elevation, cavity, light | changes suitability without repairing a hard failure |
| community state | competition, canopy closure, succession, disturbance phase | shared cause evaluated once for all species |
| authored composition | landmark plant, maintained clearing, planted row | stable explicit constraint with provenance |

Categorical fields use nearest/majority/conservative sampling as declared;
linear interpolation is reserved for continuous quantities. Footprint-scale
plants sample the declared footprint, not just the centre point. A coarse field
level is admissible only while its support preserves the classifications used
by the candidate.

Placement is a compile or sparse-update product. A change invalidates only the
pages whose input support overlaps the changed region. Camera motion, render
LOD, and material detail leave placement identity unchanged.

## Suitability and community

Define one response table per species or functional group:

```yaml
speciesId: stable-id
hardRules: []
responseCurves: { substrate, slope, moisture, light, exposure, disturbance }
limitingRule: product | minimum | named-model
competitionGroup: stable-id
nominalSpacingMeters: authored-or-measured
clusteringScaleMeters: authored-or-measured
```

Response curves have declared domains and units. Keep eligibility separate
from preference. One useful limiting-factor model is:

```text
E_s(x) in {0,1}
ell_s(x) = sum_k a_s,k log(max(g_s,k(x), eps))
S_s(x) = E_s(x) C_s(x) exp(ell_s(x))
```

`E_s` is hard eligibility, `g_s,k` are normalized responses, and `C_s` is the
shared community factor. An additive score is unsuitable when a favourable
factor could compensate for lethal occupancy or salinity. Record the selected
rule and the response of every accepted candidate.

Suitability is not density. Map `S_s` to a target intensity, candidate
acceptance, and spacing rule explicitly. If a sparse cell process uses
`p = clamp(lambda_s A_cell, 0, 1)`, verify that at most one relevant candidate
per cell and weak exclusion correlations make that approximation valid.

Community coherence comes from shared causes: one moisture field, one
disturbance state, one exposure reduction, and one substrate classification
feed placement and any matching ground-cover material. High-frequency hashes
vary individuals and rank candidates; they do not define habitat identity.

Directional exposure uses a direction as well as distance. For prevailing unit
direction `w`, a static shelter approximation may integrate blocker density
upstream:

```text
A(x) = integral rho(x - s w) K(s) ds
T_shelter(x) = exp(-A(x))
```

The kernel, support, and blocker conversion are authored or measured inputs.
Horizon or swept-grid approximations are valid after an error comparison.
Recompute the reduction when terrain, obstacles, or the prevailing condition
changes; instantaneous wind deformation is a separate dynamic branch.

## Stable candidate identity

World-anchored candidates use a fixed-width tuple:

```text
(generatorSchemaVersion, globalSeedWords, stableSpeciesIdWords,
 biasedWorldCellWords, candidateOrdinal)
```

The tuple is the identity. A hash is a compact label and must be collision
checked. Derive an integer priority hash from the tuple, then break equal
priorities with the full tuple:

```text
winnerKey = lexicographic(priorityHashU32, candidateTuple)
```

The higher lexicographic `(priorityHashU32, candidateTuple)` wins. The full
tuple therefore resolves equal priority hashes without treating a hash
collision as identity equality.

Specify the integer mixer, wraparound, serialization, signed-coordinate bias,
and CPU/TSL test vectors. Environmental revisions invalidate acceptance but do
not renumber unaffected candidates. A mutable RNG stream is inappropriate
because loading another chunk or adding a species would shift later results.
`stableSpeciesIdWords` are immutable identifiers, not the current position of a
species in a registry. If an implementation uses a numeric registry index, the
index must remain append-only for the complete generator-schema lifetime;
reordering or reusing an index requires a new `generatorSchemaVersion`.

Use [placement-oracle.mjs](../scripts/placement-oracle.mjs) as the executable
oracle for tuple serialization, collision-aware winner comparison, half-open
chunk ownership, Matérn-II acceptance, and nested LOD rank selection.
Its schema uses two global-seed words, two authored immutable species-ID words,
three biased signed-cell-coordinate words, and one candidate ordinal. A
different tuple width or field order requires a new generator schema and its
own parity oracle.

## Conflict selection

Choose one process and preserve its semantics:

| Workload | Candidate process | Acceptance semantics |
| --- | --- | --- |
| sparse authored plants | stratified candidates plus anchors | hard rules, suitability rank, explicit clearance |
| moderate static population | CPU variable-radius candidates | declared deterministic independent set |
| streamed terrain | world-cell lattice plus halo | one-hop Matérn-II or explicit global-greedy closure |
| frequently regenerated dense population | compute evaluation/compaction after an A/B comparison | same IDs and independent-set result across dispatch layouts |

Declare the symmetric conflict distance, such as `max(r_i,r_j)` or a
species-pair matrix.

- **Matérn-II/local maximum:** accept `i` exactly when its total `winnerKey` is
  lexicographically higher than every directly conflicting candidate's key. A
  halo covering the maximum conflict reach plus all sampled-field support is
  sufficient.
- **Global priority-greedy:** visit all candidates in total priority order and
  accept each candidate with no already accepted conflict. Influence may cross
  arbitrarily long conflict chains, so use a global/offline compile, an
  expanded dependency closure, or boundary reconciliation with a convergence
  bound.

Generate halo candidates from global IDs and emit only the half-open chunk
interior. Report the selected Matérn-II or global-greedy semantics explicitly;
their densities and pair correlations differ. Compare the selected process
with its stated target.

Clusters derive child IDs from `(parentId, childOrdinal)`. Each child passes
eligibility and conflict tests independently, so a valid centre cannot drag a
clump across a boundary or path.

## LOD population invariant

Accepted placement is immutable across render LOD. Derive a stable thinning key
independently from the placement winner key, order plants from higher to lower
thinning key, and define every lower-density tier as a prefix of that same
ordering. Preserve landmarks and protected species/community fractions
explicitly without reordering unrelated plants. A transition passes only when
canopy or ground-cover error and habitat-boundary movement remain inside the
declared limits. Chunk loading and camera motion cannot reshuffle survivors.

Static placement normally compiles on the CPU or a worker into compact records.
Compute earns the branch only when changed data volume, regeneration cadence,
or visibility compaction beats CPU/implicit placement on the target. The
runtime record carries stable plant/species/variant IDs, root frame, footprint,
bounds, representation identities, thinning rank, and source revisions.

## Site and asset interface

A plant asset supplies source units/up axis, root anchor and alignment policy,
static/crown/wind-swept bounds, root or clearance footprint, response table,
growth/season variants, geometry/cluster/impostor representations, shadow
proxy, materials, deformation bindings, and provenance/license. Root alignment
is a species rule: a trunk may remain world-up on a slope while ground cover
aligns to the surface.

Site elements publish conservative exclusion volumes and optional
colonization sockets. A socket names its owner, local frame, support area,
allowed plant groups, environmental overrides, and clearance. The placement
compiler consumes this interface rather than inferring ledges or access paths
from render triangles.

## Completion evidence

Capture input fields, hard eligibility, each suitability factor, candidate IDs
and winner keys, conflict winners, chunk interior/halo, accepted/rejected cause,
species/community IDs, thinning rank, root frames, bounds, and near/mid/far
representations. Acceptance requires all of the following:

- fixed inputs reproduce the same identities and winners;
- chunk generation order produces identical owned plants without seam
  duplicates or holes;
- hard exclusions have zero accepted violations;
- every accepted plant resolves its source revisions, response factors, asset,
  and stable identity;
- field changes invalidate only the declared support region;
- render LOD preserves IDs and nested population membership;
- directional probes rotate the exposure response with the declared
  prevailing direction;
- compile time, resident bytes, submitted pages, projected alpha coverage,
  and whole-frame cost pass the named target budgets.
