# Building Grammar and Mesh Compiler

Read this reference when implementing the plan grammar, facade placement,
material-slot compiler, or city-scale paging in Three.js r185 WebGPU/TSL.

## Contents

1. Plan boundary
2. Mass and exposed boundaries
3. Bay placement and ownership
4. Module registry and local frames
5. Material-slot compilation
6. Spatial paging and LOD
7. Materials and output
8. Validation and failure signatures

## 1. Plan Boundary

Use a compiler pipeline with a serializable intermediate representation:

```text
settings + units + seed
  -> mass grammar
  -> topology validation
  -> exposed-boundary graph
  -> facade / roof / trim placements
  -> registry and ownership validation
  -> material-slot compilation
  -> spatial package
```

The plan records:

```text
normalized settings and seed
mass volumes and footprint pieces
full side, height bands, blockers, and surviving exposed surface regions
endpoint/corner semantics
bay counts and effective bay widths
placements and ownership rectangles
module usage, missing IDs, and unused IDs
material slots and physical UV scale
per-module and per-slot vertex/triangle counts
compiled bounds, page IDs, and representation policy
```

Store validation failures in the plan and stop before emission. Randomness
chooses among already-valid alternatives; topology and dimensional constraints
define validity.

## 2. Mass and Exposed Boundaries

Declare every length in scene units with a known conversion to meters. Derive
legal floor, bay, inset, opening, and projection ranges from the product rather
than embedding a building profile. Select only alternatives whose declared
bounds exclude slivers, inversions, self-intersections, and unsupported spans.

Use this minimal operator rail:

```text
footprint pieces
  -> union / court subtraction
  -> extrude / stack
  -> inset / split
  -> optional connector
```

- **Footprint pieces** create dimensioned 2D regions with stable IDs and a
  declared parent/site owner.
- **Union/court subtraction** resolves those regions into valid exterior rings
  and explicit holes; a court is a topological subtraction, not an empty visual
  label.
- **Extrude/stack** assigns valid vertical intervals to a region and records
  parent/child ownership between touching volumes.
- **Inset/split** derives contained child regions with declared minimum spans;
  siblings have disjoint interiors unless a later union resolves them.
- **Connector** joins named volumes only after its supports, clearance,
  intersections, and surface ownership validate.

Derive each result ID from the grammar version, stable seed, parent IDs,
operator kind, chosen-alternative ID, and operator ordinal. Resolve randomness
only among alternatives that pass the operator gates against the current plan:
finite dimensions, valid rings/holes, containment, non-self-intersection,
minimum spans, nonnegative height, and unambiguous parent/surface ownership as
applicable. Reject the plan when none pass; later geometry does not repair it.

Represent a compound orthogonal footprint as interior-disjoint rectangles on a
declared coordinate lattice. For arbitrary overlaps, compute a robust 2D union
or planar arrangement first; side-touch subtraction is valid only after
interiors are disjoint.

The following one-dimensional subtraction is sufficient only for masses with
equal vertical spans. For unequal heights, setbacks, or stacked/overhanging
volumes, split the side into height bands at every relevant bottom/top endpoint
and subtract horizontal blockers separately in each band, or Boolean-subtract
in the two-dimensional side chart `(alongSide, height)`. A low neighbor blocks
only its actual height overlap; it does not remove the taller mass's upper
facade. Horizontal caps/soffits require their own exposed-region subtraction.
Keep the complete surface support in ownership IDs and placement tests.

For each rectangle side in an admitted height band:

1. Create its full one-dimensional interval.
2. Find touching rectangles using a tolerance derived from lattice spacing,
   scene scale, and numeric precision.
3. Project touching rectangles into blocker intervals.
4. Sort and merge blockers, then subtract their union.
5. Derive outer/inner/clipped endpoint semantics from the subtraction result.
6. Reject or classify surviving segments below the declared semantic minimum.
7. Emit one exposed facade interval per survivor.

Interval subtraction, rather than a midpoint test, preserves short exposed
segments and removes entire internal walls. Facades, cornices, parapets,
plinths, corner pieces, caps, and ownership attach to surviving intervals.

Close the mass independently of facade modules. Add visible decks, caps,
soffits, and closure surfaces for validated connectors before placement
validation.

## 3. Bay Placement and Ownership

For an exposed interval of length `L`, choose an integer bay count within the
legal width range:

```text
nMin = max(1, ceil(L / bayWidthMax))
nMax = floor(L / bayWidthMin)

if nMin <= nMax:
  n = argmin rhythmAndCornerPenalty(k), k in [nMin, nMax]
  effectiveBayWidth = L / n
else:
  classify the interval as an explicit blank/infill or reject the plan
```

Admit finite `L > 0` and `0 < bayWidthMin <= bayWidthMax`, with a bounded safe
integer candidate count before enumerating penalties or allocating geometry.
A zero-length side is absent, not a zero-bay division; an infeasible positive
span is an explicit blank/infill or error. Recheck the resulting effective width
against the legal interval using the declared lattice/roundoff policy. Nearly
integer quotients need a deterministic boundary policy, not a free epsilon
that silently admits undersized bays. Ties in rhythm penalty use a fixed rank.

This creates equal bays without a narrow remainder. Reserve whole-height or
whole-interval zones for entrances, service areas, structural piers, and other
semantic features before filling ordinary bays.

Every placement declares:

```text
placementId and moduleId
mass-volume and exposed-interval owner
horizontal and vertical interval
normal offset and construction depth
local frame and anchors
material slots
physical UV meters-per-repeat
semantic blank/solid/opening role
```

Use both an exact ownership key and geometric overlap tests. The ownership key
contains mass owner, side, exposed interval, horizontal/vertical support, and
normal offset. Derive any quantization tolerance from input precision and the
smallest legal separation. General interval/volume overlap remains necessary
when placements have independent widths, depths, or offsets.

Resolve trim and corner pieces from exposed-interval endpoints. This keeps
inner courts, outer corners, setbacks, and adjacent volumes consistent without
whole-rectangle decoration.

## 4. Module Registry and Local Frames

Resolve every placement through a complete module registry before compilation.
A module owns its local geometry, anchors, construction depth, semantic
material slots, and UV scale. The compiler owns global side orientation,
winding, and placement.

Use one local convention, for example:

```text
local +X: along the facade interval
local +Y: up
local +Z: outward
origin: declared module anchor
```

One `facadeTransform` maps this convention to every side; roof and horizontal
modules use separately declared transforms. Validate transformed winding,
normal direction, and finite bounds. A missing builder is a hard plan error;
an unused registered builder is diagnostic information.

### Deterministic heterogeneous site placement

Generate each candidate from this fixed-arity typed identity tuple:

```text
(
  generatorSchemaVersion: nonempty NFC string,
  stableSeed: uint32,
  familyId: nonempty NFC canonical domain ID,
  sourceCellId: nonempty NFC canonical domain cell ID,
  candidateOrdinal: uint32
)
```

Do not derive either domain ID from locale formatting, iteration order, or the
requesting chunk. Do not coerce lane types. Encode the validated five-lane
array with `JSON.stringify`; that string is the canonical candidate key. Derive
`placementId` as `"placement:" + canonicalCandidateKey`, and namespace each
deterministic random lane by the canonical key plus an explicit `uint32` lane.
A hash may index a lookup bucket, but it never owns identity or tie-breaking:
compare the canonical keys or all typed lanes when hashes collide. Adding an
unrelated family or loading chunks in another order must not change an existing
family's candidates.

Close placement phases in order. Before generating a phase, declare the meaning
and units, or dimensionless status, of `priorityRank` and `scoreRank`; convert
higher-is-better values to a lower-is-better rank. Reject non-finite ranks.
Compare `(priorityRank, scoreRank, candidateTuple)` lexicographically: numeric
order for ranks and `uint32` lanes, code-unit order for the canonical NFC string
lanes. The lower key wins. Run `validateWinnerKeys()` on the complete phase
before sorting or conflict decisions; it snapshots/validates every dense typed
key and rejects duplicate tuples even when their ranks differ. Comparison alone
cannot find all duplicates because sort need not compare every pair. The
comparator validates both operands and returns zero for the same valid key,
including self-comparison, as a consistent sorting comparator must.

```js
const checked = validateWinnerKeys(candidateKeys);
const ordered = [...checked].sort(compareWinnerKeys);
```

Validate identity for all generated records, then exclude unsupported/invalid
candidates from conflict decisions. A geometrically invalid candidate cannot
suppress a valid neighbor. The strict local-winner rule accepts a candidate
only when its key wins against every conflicting eligible candidate. With a
symmetric conflict relation this is conflict-free, but not necessarily maximal:
a priority chain A-B-C can select A and reject C even though A and C do not
conflict. Do not describe this as greedy backfilling or maximal packing. A
maximal/priority-greedy requirement needs its own global phase or proven
multi-round dependency closure, tie-breaking, and termination.

Support and validity may read immutable environment and completed prior phases,
but not acceptance order within the current local-winner phase. Comparator
requirements: [ECMAScript sorting](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-sortindexedproperties).

`environmentRevision` versions terrain, parcel, support, access, and registry
inputs for acceptance-cache invalidation; it is not part of candidate identity
or randomness. For chunk-local solving, derive the full center-to-center query
reach from both candidates' support and clearance extents (their Minkowski
interaction neighborhood), plus validity/environment sampling reach. The
largest individual radius alone can miss a conflict between two large assets.
Assign boundary winners by stable source cell, not the requesting chunk. A rule
without finite dependency reach requires a global phase after all relevant
candidates are known. Revalidate a pending accepted package against the current
environment/registry epoch before publication; stale work cannot overwrite a
newer plan.

The helper's randomLane01 uses a f64 division by 2^32 and lies in `[0,1)` on
CPU. Rounding that value to f32 can reach one. A GPU half-open requirement needs
a separately versioned high-24-bit conversion or another verified mapping; do
not silently change existing candidate identity or random streams.

Replay with reversed chunk order, an inserted unrelated family, forced hash
collisions, and boundary candidates. Accepted placement IDs and transforms must
remain identical while candidate and environment inputs are unchanged; an
environment-only edit may change acceptance without renumbering or rerandomizing
surviving candidates.

## 5. Material-Slot Compilation

Select the package from actual topology and mutability:

| State | Representation | Identity |
| --- | --- | --- |
| Static varied geometry | merged indexed `BufferGeometry` per slot | triangle-range map to placement IDs |
| Editable varied geometry | `BatchedMesh` per compatible slot | batch entry to placement/module ID |
| Identical repeated topology | `InstancedMesh` or compatible storage-instanced path | stable instance record independent of runtime index |

A slot writer owns positions, indices, normals, UVs, optional tangents, and any
semantic ID or variation attribute. It emits compact indexed geometry, then
computes its bounding box and sphere. Preserve a trace from every triangle or
batch entry to its plan owner where picking or diagnostics require it.

Three.js r185 WebGPU submits one backend draw item for each visible
`BatchedMesh` multi-draw entry. `BatchedMesh` can reduce scene-object and state
management while retaining per-entry replacement, sorting, transforms, and
visibility; it does not establish draw collapse. Merge compatible static slot
geometry or instance identical topology when fewer GPU draw items are required,
and report the actual renderer/backend counts.

Admit the complete shared attribute/index schema before batching, including
component types, normalization, and semantic channel meaning. Capacity includes
reserved vertex/index ranges, instances, and representation-specific textures;
reject an over-budget plan before constructing a partial batch. BatchedMesh
reuses numeric entry IDs after deletion, so query/event identity includes the
stable plan ID and generation, not the recycled index alone.

BatchedMesh's installed setMatrixAt path does not support negative-scale
matrices. Bake a mirrored module with corrected winding/tangent parity and use
an admitted positive instance transform, or choose a separately validated
representation. A transform that was accepted as a Matrix4 is not proof the
batch's normal/culling path supports it.

Keep transparent or transmissive geometry in an explicit slot and draw
category. Use world-distance UVs:

```text
uv = surfaceDistanceMeters / metersPerRepeat
```

Atlas-local repetition requires mip-safe gutters for the complete mip chain,
derivative-correct wrapping, and an anisotropic footprint policy. Tessellation
follows silhouette, displacement, curvature, or interpolation error rather than
texture repetition.

## 6. Spatial Paging and LOD

Bound chunks before batching. A page contains only geometry whose visibility
and lifecycle can be managed together; its bounds include any active animation
or transition envelope. Recompute bounds after compilation and every geometry
replacement. Include transforms and instance-count changes, not only edits to
vertex buffers. `InstancedMesh.setMatrixAt()` neither marks the upload dirty
nor recomputes existing bounds: set `instanceMatrix.needsUpdate = true` after
writes and refresh the page box/sphere before culling. BatchedMesh updates its
matrix texture but leaves aggregate bounds stale. Recompute both levels of
bounds after relevant changes; GPU deformation requires an independently
expanded envelope. Use chunk-local Float32 positions with a stable high-precision
anchor when global positions lose the required detail. Rebasing an anchor does
not rename placements or resample their randomness.

Gate LOD in physical pixels using each active view's actual physical
viewport dimensions and unjittered projection. Use the router's paired-point
projected-error contract over the complete animated support and displacement
set, including zoom, depth changes, and near-plane admission. Comparing projected
bounding-box extents alone does not bound movement of corresponding features;
unchanged outer boxes can hide a moved window or doorway. Give every view
separate split/merge thresholds and dwell, select the most demanding result, and budget simultaneous transition
residency.

For a district, report:

```text
source, visible, and culled buildings/pages
visible and submitted vertices/triangles
material and representation buckets
backend draw items
metadata, geometry, texture, and transition bytes
compile, upload, cull, submit, and full-frame p50/p95
```

CPU chunk culling is the baseline. A compute visibility/compaction path earns
its place when measured scan, compaction, synchronization, and indirect
submission remove more CPU or vertex work than they add. Runtime visibility
stays GPU-resident; asynchronous readback belongs to diagnostics.

## 7. Materials and Output

Map each semantic slot to one `MeshStandardNodeMaterial` or
`MeshPhysicalNodeMaterial` identity. Base-color and emissive art with an sRGB
transfer uses `SRGBColorSpace`; normals, roughness, metalness, masks, IDs, and
procedural data use `NoColorSpace` or their declared linear encoding. Keep HDR
working color linear until the scene's one output transform.

Use `RenderPipeline` for scene output. Add MRT attachments only for named
consumers and account their bandwidth and lifetime. Retire the replaced package
after its last render/picking consumer. BatchedMesh disposal owns its merged
geometry and internal textures, not the borrowed material. InstancedMesh disposal
does not dispose shared source geometry/material; use the actual owner/refcounts.
Node/pipeline disposal is not recursive cleanup. A failed replacement retains
the previous valid package or a declared unavailable state, not a half-emitted
mix of registry generations.

## 8. Validation and Failure Signatures

Gate at least:

```text
valid mass spans and non-self-intersecting footprints
no internal facade intervals
legal bay quantization or explicit blanks
complete module registry
unique ownership and zero unapproved overlaps
closed visible mass surfaces
finite positions, normals, UVs, and bounds
complete material-slot membership
stable physical UV density
deterministic plan replay across seeds and chunk order
deterministic heterogeneous placement across family insertion and hash collision
projected-error LOD with bounded transition memory
actual triangle, byte, and backend draw counts
```

Diagnose failures from the earliest authoritative phase:

| Symptom | Inspect |
| --- | --- |
| Facades inside a court or seam | blocker union and exposed-interval subtraction |
| Broken corner trim | endpoint semantics and interval ownership |
| Narrow remainder modules | feasible integer bay range |
| Window/door collisions | reserved zones and general overlap test |
| Holes under setbacks | mass caps, decks, soffits, and connectors |
| Missing facade pieces | registry completeness and placement-to-builder resolution |
| Flipped normals | shared local-frame transform and winding |
| Texture scale changes | meters-per-repeat and chart/LOD UV policy |
| Draw count exceeds expectation | merge/instance eligibility and visible `BatchedMesh` entries |
| Incorrect city culling | post-compilation bounds and page transition envelope |

Completion requires a fixed-camera silhouette, flat-material view, grazing-light
view, semantic ownership overlay, and measured final representation for every
supported footprint and package branch.
