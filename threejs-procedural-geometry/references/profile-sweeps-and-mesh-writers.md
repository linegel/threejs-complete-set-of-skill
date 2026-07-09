# Sculpted Profiles and Semantic Mesh Writers

Use this reference for reusable profile sweeps, rail skins and caps, oriented
branch rings, semantic indexed `BufferGeometry` writers, explicit material
slots, `BatchedMesh` / `InstancedMesh` selection, dynamic update ranges, and
geometry-level diagnostics in pinned Three.js r185 WebGPU/TSL.

## Contents

- Architecture first
- Capability gate and quality tiers
- Semantic writer contract
- Local terrain and coast mesh compiler
- Sculpted frame profile
- Rail mesh emission
- Oriented branch rings
- Batching decision table
- Dynamic and GPU-owned update paths
- NodeMaterial and output rules
- Budgets
- Validation
- Replacements

## Architecture First

Algorithm class dominates performance. The top-tier path for procedural mesh
systems is:

```text
semantic plan
  -> capacity pass
  -> preallocated typed-array writer
  -> indexed BufferGeometry with explicit groups/material slots
  -> BatchedMesh, InstancedMesh, or storage-buffer draw path
  -> NodeMaterial surfaces
  -> node render pipeline diagnostics
```

Do not start from object-per-module meshes. The compiler must know whether
surfaces share topology, material, update cadence, and culling behavior before
it writes vertices.

Use this default split:

```text
unique authored surface, few objects
  -> one indexed BufferGeometry with groups

many same-material objects, varied topology
  -> BatchedMesh with reserved vertex/index capacity

many repeated objects, identical topology
  -> InstancedMesh with instance attributes

many repeated objects with GPU-updated transforms, visibility, or deformation
  -> matrix-free Mesh + InstancedBufferGeometry + storage-backed transform
     reconstruction in TSL compute/vertex nodes

large visibility-compacted procedural set
  -> compute-filled storage buffers plus indirect draw data on the full tier
```

## Space Contract

| space | owner | rule |
| --- | --- | --- |
| world space | Three.js Y-up scene | app/camera owns view convention |
| rail-local | rail orientation | top/bottom/left/right map profile width outward and `s` along the rail |
| profile-local | sculpted profile | `t` travels inner-to-outer; profile arc length drives production V |
| production UV | material sampler | real-distance rail and profile lengths times texels/world unit |
| debug `(s,t)` | diagnostics only | store in a separate `debugUv` attribute |
| winding | writer | outward quads emit `a, b, c / b, d, c` |
| writer inputs | generator modules | semantic dimensions, material slot, smoothing group, UV chart, and boundary reason |

## Capability Gate and Quality Tiers

Initialize once, then choose a native WebGPU quality tier:

```js
await renderer.init();

if (renderer.backend.isWebGPUBackend !== true) {
  throw new Error(
    'WebGPU is required for the canonical procedural-geometry path; explicit fallback teaching belongs to threejs-compatibility-fallbacks.'
  );
}
```

Quality tiers are error contracts; sample counts are outputs of adaptive or
offline refinement, not copied ranges:

```text
hero
  close-view positional, silhouette, profile-feature, normal-angle, and UV
  distortion gates all pass

standard
  the same gates at the declared ordinary view envelope; semantic extrema and
  material boundaries remain pinned

distant
  projected silhouette/normal gates pass while sub-pixel profile structure is
  represented in filtered material response or removed

minimum
  cheapest precomputed representation that preserves the primary silhouette
  and semantic boundaries; native WebGPU, no unnecessary dynamic attributes
```

Every tier follows the shared physical-pixel projected-error contract. Any
initial segment count is **Authored** for a named fixture and is refined until
the gates pass; it is never a device-class default.

## Semantic Writer Contract

The writer owns memory, topology, groups, and validation. Generator modules own
meaning and dimensions.

```text
createWriter(capacity, materialSlots)
  addVertex(position, normal, tangent, uv, color, semanticId)
  addTriangle(a, b, c, materialSlot)
  addQuad(a, b, c, d, materialSlot)
  duplicateForBoundary(vertexId, boundaryReason)
  addGroup(startIndex, indexCount, materialSlot)
  finishGeometry()
```

Capacity is computed before allocation:

```text
vertexCount =
  smooth skin vertices
  + duplicated hard-edge vertices
  + cap vertices
  + seam vertices
  + LOD/debug overlay vertices

indexCount =
  triangles * 3
```

Use `Float32Array` for positions, normals, tangents, UVs, and colors unless a
measured asset benefits from normalized integer packing. Use `Uint16Array` for
indices only when the highest vertex index is <= 65535; otherwise use
`Uint32Array`.

Attribute lifecycle:

- set `usage` before first render;
- keep static arrays immutable after upload;
- use `onUpload()` only when rebuilds will not need CPU-side arrays;
- for dynamic sections, call `addUpdateRange(start, count)` in component units,
  set `needsUpdate = true`, then clear ranges after the upload frame;
- recompute `boundingBox` and `boundingSphere` only for changed chunks;
- dispose and rebuild when capacity, item size, or usage model changes.

Groups are a correctness contract: every index belongs to exactly one group,
groups do not overlap, groups do not leave holes, and material indices remain
stable across LOD tiers.

## Local Terrain And Coast Mesh Compiler

This compiler turns the local coastal bundle from
`$threejs-procedural-fields` into reusable land, beach, cliff, shallow-seabed,
and placement geometry. It applies to scientific exhibits, architectural
context, data scenes, product backdrops, cinematic scenes, and stylized
archipelagos. The camera style does not weaken topology, error, or mobile
performance gates.

### Input and algorithm decision

Freeze an input manifest before capacity planning:

```text
coastFieldVersion, seedVersion, waterLevel
coordinate origin, physical units, global sample-lattice key
dCoast, closestCoastId, coast frame, zRaw, zBed
terrace levels, cliffTop/cliffToe, beach and wet-line bands
surface identities, placement suitability, exclusion regions
protected component/hole identities and semantic anchors
```

Select the representation from the required surface class:

| Surface/view contract | Compiler | Reject when |
| --- | --- | --- |
| bounded, single-valued continuous terrain | indexed regular/adaptive height grid | vertical faces, overhangs, or contour identity are observable |
| hard terraces and explicit cliffs | iso-contour regions, constrained cap triangulation, wall extrusion | a screen-space color band is being used to fake silhouette/topology |
| large continuous navigable domain | balanced quadtree or clipmap over a global dyadic lattice | working-set/culling measurements favor whole patches or topology cannot survive seams |
| moderate isolated landforms | whole-island discrete LOD meshes | one island exceeds culling, update, or residency gates |
| visible caves/arches/overhangs | bounded volumetric SDF with marching cubes or feature-preserving dual contouring | voxel memory, non-manifold risk, or generation cost buys no visible topology |

A static seed catalogue should compile offline or during a noninteractive load.
Runtime compute meshing is eligible only for genuinely edited/simulated
topology after measuring dispatch, storage, readback-free consumption, and peak
transition memory. Compute is not required merely because the renderer is
WebGPU.

### Deterministic contour extraction

For threshold `tau`, sample `f(p)-tau` on a global lattice. Marching squares
visits exactly **Derived** `(Nx-1)*(Nz-1)` cells for an `Nx*Nz` sample tile.
For a crossing edge with endpoint values `f_a` and `f_b`, the bilinear-edge
intersection parameter is **Derived** as

```text
t = f_a / (f_a - f_b)
```

after shifting `tau` to zero. Evaluate generation predicates in f64 with
scale-aware error bounds and escalate uncertain orientation/intersection cases
to adaptive exact predicates; quantize only when writing the final attribute.
If the denominator or either sign lies inside its propagated **Gated**
uncertainty, refine/evaluate the authoritative field rather than choosing from
rounded noise. A deterministic global-cell tie-break is permitted only when
topology at that exact contact is explicitly unconstrained.

Refinement cannot resolve an edge or plateau that is identically on the
iso-level. Define the superlevel set globally as `f>=tau`. Extract only the
boundary separating its connected zero/positive plateau from strictly negative
cells; internal zero edges emit no contour. Assign a plateau boundary segment
to one global edge/cell owner so neighboring chunks agree. A symbolic
perturbation keyed by global lattice identity is allowed only when exact-contact
topology is explicitly unconstrained, and the perturbation/order becomes part
of the compiler signature and adversarial fixtures.

Required extraction rules:

- resolve checkerboard cells with the asymptotic decider applied to the
  bilinear interpolant, not a seed-dependent diagonal;
- identify an intersection by `(globalEdgeId, isoLevelId)`, so neighboring
  cells and chunks reuse one position and topological vertex;
- orient loops by evaluating the positive-inside field and verify the emitted
  top face cross product points toward `+Y`; never infer winding from a picture;
- assemble closed loops, reject open chains except at a declared domain
  boundary, classify nesting, and represent holes explicitly;
- remove duplicate consecutive points and zero-length edges before
  triangulation; use robust segment predicates to reject self-intersections;
- preserve closest-coast IDs, extrema, cliff/beach transitions, anchors, and
  chunk-boundary vertices during simplification.

Simplify only against a **Gated** world-space Hausdorff bound projected through
the shared physical-pixel contract. Douglas-Peucker or area-based removal is a
candidate, not proof: recheck self-intersection, nesting, minimum neck width,
protected topology, and coast-frame angular error after every simplification
tier. A visually small neck can still carry a stable entity, path, drainage
divide, or selected object and therefore be topologically protected.

### Terraces, cliffs, beaches, and seabed

For hard terrace levels `L_k`, define superlevel regions

```text
Omega_k = { p : zRaw(p) >= L_k }
R_k = Omega_k minus Omega_(k+1)
```

Triangulate `R_k` as a horizontal cap at `L_k`. Extrude every loop bounding
`Omega_(k+1)` from `L_k` to `L_(k+1)` to form the next vertical wall. This
construction tolerates islands splitting, merging, appearing, or disappearing
between levels; pairing nearest vertices on two unrelated contour loops does
not.

Use constrained Delaunay triangulation with robust predicates, or another
validated constrained polygon triangulator, for regions with holes. Simple ear
clipping has **Derived** quadratic candidate work in loop vertex count and is
eligible only for small validated simple polygons. Use robust orientation and
in-circle predicates. Add Steiner/interior samples only where a nonflat cap or
band needs them to meet height/normal error; a flat terrace does not need a
decorative grid.

For a closed contour with `m` segments, one top/bottom wall quad per segment is
**Derived** `2m` triangles before material, UV, or hard-normal duplication.
Emit walls from semantic boundary records:

```text
boundary id
ordered coast/terrace positions
bottom and top elevation functions
outward/inward side
material slot and smoothing group
arc-length origin and UV chart
```

An outer cliff wall joins the field's `cliffTop` to `cliffToe`. A sloped beach
or wet-sand band is the implicit annulus between declared `dCoast` thresholds;
triangulate that region with holes and evaluate the shared cross-shore height at
its vertices. Do not assume corresponding samples exist on inner and outer
loops when a band changes topology. The visible shallow seabed may use the same
clipped/adaptive grid or band triangulation with `zBed`; preserve the exact
shoreline vertex keys where it meets the beach. Deep or optically hidden bed
geometry is omitted by projected/visibility evidence, not generated at maximum
density and hidden with color.

### Rendering topology, normals, UVs, and groups

Keep two identities:

```text
topological vertex/edge id
  proves adjacency, manifold closure, contour and chunk continuity

render vertex id
  may duplicate the same position for hard normals, tangent handedness,
  material groups, UV charts, or independently filtered attributes
```

Do not weld render vertices across a semantic boundary to make an edge-count
test pass. Conversely, do not report a crack because correct render duplicates
share a topological position. Build a half-edge or equivalent adjacency ledger
before expanding render vertices.

Surface rules:

- terrace caps use analytic `+Y` normals and world-distance XZ UVs;
- continuous land/beach/seabed height `h(x,z)` uses
  `normalize(vec3(-dh/dx, 1, -dh/dz))` from the authoritative gradient;
- cliff/terrace walls use segment or deliberately smoothed coast normals and
  remain hard against caps;
- cap UVs are physical XZ distance/repeat coordinates; wall `u` is coast arc
  length and wall `v` is physical height/repeat distance;
- stable material slots include the required subset of `terrain-cap`,
  `cliff-wall`, `dry-beach`, `wet-beach`, `visible-seabed`, and authored
  substrate identities; slots remain stable across LODs even when empty;
- every index belongs to exactly one contiguous group or to a documented set of
  nonoverlapping groups emitted by the writer.

Recompute bounds from every cap, wall, beach, and seabed vertex. A land-only
height bound omits vertical toes and shallow-bed extent and invalidates culling.

### Chunk seams and LOD

Prefer whole-island LOD for bounded isolated landforms when its residency and
submission measurements pass. It removes internal crack classes and preserves
component identity. Account for both meshes, overdraw, and materials during a
cross-fade; hysteretic popping control is not free memory.

When chunking is required:

- sample a global dyadic lattice and make adjacent chunks share boundary
  sample/intersection IDs;
- use a balanced quadtree with a declared neighbor-level difference and
  explicit stitch index patterns, or force matching boundary refinement;
- preserve a ghost ring wide enough for every gradient/filter/contour decision;
- choose one owner for each shared boundary and copy/reference its emitted
  positions, rather than averaging independently generated borders;
- record neighbor residency during transitions and verify all mixed-LOD pairs;
- treat skirts as an occlusion-only last resort. They do not repair metric
  continuity, waterline identity, shadows, section cuts, or underside views.

Every LOD reports:

```text
maximum projected cap-height error
shoreline and terrace-contour Hausdorff error
maximum protected coast-frame/normal angular error
component/hole and semantic-boundary preservation
maximum mixed-LOD seam gap and T-junction count
vertex/index/group/attribute bytes
simultaneous transition bytes and draw/backend-entry counts
```

Pin semantic anchors and contour extrema before simplification. A topology
change is legal only if every removed component/hole is below its projected
error/identity gates for the complete view envelope and has no selection,
placement, drainage, or data identity. Triangle-count ratios are not an LOD
contract.

### Placement anchors and exclusions

Emit placement data beside the mesh, not by later raycasting an arbitrary LOD:

```text
anchorId, sourceFieldVersion, sourceBoundaryId
positionWorld, normalWorld, tangentWorld, coastInwardWorld
surfaceIdentity, terraceId, dCoast, slope, exposure, moisture
clearanceRadius, footprintClass, exclusionRevision, deterministicSeed
binding = topological feature id or per-LOD barycentric map
```

Generate candidate anchors from the authoritative field/contours before
decimation. Pin required anchors in all LODs or provide a verified barycentric
binding per LOD. Nearest-display-vertex snapping causes trees, rocks, ruins, and
measurement glyphs to move as LOD changes.

Specialized consumers add constraints rather than new shorelines:

- a dock anchor needs coast tangent, inward/sea directions, a land approach
  footprint, a water corridor, and depth samples along the sea direction;
- a cliff prop needs wall segment ID, height interval, outward normal, and toe
  clearance;
- vegetation needs cap/soil identity, slope, coast/salt distance, moisture,
  exposure, and infrastructure exclusion;
- a building or ruin needs a connected support footprint, height/slope
  variation gate, access orientation, and a reserved exclusion polygon;
- rocks and reef assets need substrate, depth/elevation band, clearance, and
  stable candidate IDs.

Rasterize accepted footprints back into the shared exclusion field or maintain
a spatial index whose version is recorded. Order-dependent "place then reject"
loops are not deterministic when generation order or threading changes; use
stable candidate priorities and a declared conflict rule.

### Bounded complexity and low-end/mobile policy

For an unclipped regular grid, counts are **Derived**:

```text
V = Nx * Nz
T = 2 * (Nx - 1) * (Nz - 1)
indexBytes = 3 * T * bytesPerIndex
attributeBytes = V * sum(attributeStrideBytes)
```

Add contour intersections, wall vertices/triangles, boundary duplication,
groups, anchors, chunk tables, and simultaneous LODs explicitly; do not quote
the grid formula as total mesh cost. Record peak compiler memory separately
from resident GPU geometry because contour graphs and triangulation workspaces
may dominate a load-time build.

The target evidence decides among:

```text
precomputed mesh asset
runtime CPU compiler with immutable upload
dirty-tile CPU rebuild and component-range upload
GPU field evaluation with CPU topology compiler
fully GPU-resident meshing/indirect consumption
```

Prefer the earliest path that passes generation latency, resident/peak bytes,
upload, CPU submit, GPU vertex/fragment, and sustained thermal gates. Static
land has zero steady per-frame geometry mutation. On low-end/mobile targets,
precomputed deterministic variants, whole-island LOD, compressed attributes
whose error is proven, and omission of invisible deep seabed are primary
candidates; a wide compute/storage architecture is not automatically cheaper.

### Topology and degeneracy validation

Run validation on topological identities before render-vertex expansion and on
the final `BufferGeometry` afterward.

Topological checks:

- contour loops are closed, simple, correctly nested, and consistently
  oriented; protected component/hole counts match the field manifest;
- every interior topological edge has exactly two oppositely oriented incident
  faces; declared open domain/waterline/chunk edges are enumerated;
- there are no T-junctions, bow-tie vertices, duplicate faces, non-manifold
  edges, or unbound holes;
- after collapsing deliberate render duplicates, Euler characteristic
  `chi=V-E+F` matches the **Derived** identity `2-2g-b` per connected
  orientable component with genus `g` and boundary count `b`;
- closed components have consistent signed volume/winding and wall normals;
- all mixed-LOD neighbor pairs preserve shared topological boundary keys.

Numerical/geometry checks:

- robust-predicate source coordinates and final f32 positions are finite;
- quantization does not collapse distinct contour vertices or flip triangle
  orientation;
- every index is in range and every triangle has distinct indices;
- doubled triangle area exceeds a **Gated** scale/quantization-conditioned
  bound, not a hard-coded world epsilon;
- triangle aspect/angle bounds pass where interpolation, shadows, or normals
  require them; constrained triangulation is not self-validating;
- cap heights, wall top/toe, beach, and seabed agree with authoritative fields
  within their propagated bounds;
- shoreline/terrace Hausdorff error, seam gap, normal-angle error, UV density,
  group coverage, bounds, and projected LOD error pass simultaneously;
- anchor positions, frames, clearances, and exclusion conflicts remain stable
  over seed, rebuild, and LOD sweeps.

The adversarial corpus includes an iso-level through a grid vertex, an entire
edge on a level, an ambiguous checkerboard cell, a one-cell island and hole,
two nearly touching components, a narrow isthmus, nested holes, terrace
split/merge events, a coast crossing a chunk corner, large rebased coordinates,
and every mixed-LOD edge orientation. Capture cap/wall ownership, topological
edge incidence, winding, normals, UV density, material groups, anchors,
exclusions, and seam-error overlays. A pretty final frame cannot replace these
proof views.

## Sculpted Frame Profile

The frame remains a sculpted profile, not a beveled box. A normalized rail
coordinate `t` drives named lobes:

```text
crown:
  0.355 * scale * sin(pi*t)^0.56

inner bead:
  0.105 * scale * exp(-((t - 0.085) / 0.033)^2)

outer bead:
  0.092 * scale * exp(-((t - 0.905) / 0.038)^2)

inner groove:
  -0.115 * scale * exp(-((t - 0.205) / 0.043)^2)

outer groove:
  -0.102 * scale * exp(-((t - 0.735) / 0.052)^2)

shoulder:
  0.045 * scale * exp(-((t - 0.42) / 0.15)^2)

cove:
  -0.035 * scale * exp(-((t - 0.61) / 0.095)^2)
```

`scale = railWidth / 0.75`. Blend the inner and outer ends to controlled
terminal depths so the crown does not meet the artwork or wall with an
accidental vertical edge.

The old `92` sample profile is a hero-tier choice for close inspection. For
standard and crowd tiers, preserve all lobe extrema, then bound the projected
deviation of each piecewise segment over the target camera envelope. A segment
count without the
[physical-pixel projected-error contract](../../threejs-choose-skills/references/projected-error-contract.md)
is only an authored guess.

## Rail Mesh Emission

Each rail orientation has a coordinate frame. The profile travels across rail
width while `s` travels along the side.

Emit through the writer in this order:

```text
top skin, smooth group "profile-top"
bottom skin, hard group "backing"
inner wall, hard boundary against top and backing
outer wall, hard boundary against top and backing
end caps, separate smoothing group and UV chart per cap
```

For every profile sample and length sample, compute:

```text
top position at profile depth
bottom position at fixed backing depth
store physical distance or repeats explicitly
u = distanceAlong * texelsPerWorldU / textureWidthTexels
v = distanceAcross * texelsPerWorldV / textureHeightTexels
# equivalently distance/metersPerRepeat
debug UV = optional normalized (s, t)
semantic id = rail orientation + surface kind
```

Quad winding remains:

```text
a, b, c
b, d, c
```

Normals:

- use analytic normals for the smooth top profile when possible;
- duplicate vertices for backing, walls, caps, material edges, and UV seams;
- use `computeVertexNormals()` only within intentionally smooth shared regions;
- prefer analytic tangents from the parameterization. If a baked normal map
  requires Mikk parity, await `MikkTSpace.ready`, then call
  `computeMikkTSpaceTangents(geometry,MikkTSpace,negateSign)` with the asset's
  sign convention. r185 de-indexes indexed input; this is a distinct output
  representation, so recompute counts, groups, bounds, and byte budgets.

Frame dimensions remain semantically coupled:

```text
innerWidth = postWidth
innerHeight = innerWidth / embedAspectRatio
railWidthX = (outerWidth - innerWidth) / 2
railWidthY = (outerHeight - innerHeight) / 2
profileRailWidth = min(railWidthX, railWidthY)
art card Z = rail offset + profileDepth(innerRimT)
```

Do not tune artwork, mat, frame, and backing Z positions independently.

## Oriented Branch Rings

Branch geometry is emitted from a growth hierarchy after the hierarchy has
resolved topology and LOD:

```text
section:
  center
  rotation-minimizing frame or quaternion orientation
  radius
  longitudinal fraction
  branch level
  material slot
```

Construct sweep frames by parallel transport: project an authored initial
normal off `t0`; apply the minimal quaternion taking `t(i-1)` to `t(i)` with a
deterministic antiparallel axis; re-orthonormalize `n,b`; then apply authored
twist separately. Frenet frames are rejected at zero curvature/inflexions.
For closed loops, measure residual holonomy and distribute its inverse by arc
length so the seam closes. Gate tangent/frame angular change, sign continuity,
closed-seam orientation, and positional chord error.

Ring vertices use branch-local radial angle and an explicit seam. Bark UV
length follows branch length and circumference, not normalized branch index.
Radial segment count is a tier decision:

```text
trunk / hero limb: 12-18 radial segments
secondary limb: 8-12
twig: 5-8
far impostor branch: precomputed strip or card mesh
```

Child branches do not modify parent topology after parent buffers are emitted.
Plan all attachment rings first, reserve capacity, then write parent and child
sections into stable material groups. Leaf cards or canopy meshes may use
authored normals that differ from face normals when that better represents
canopy lighting.

## Batching Decision Table

```text
Need                                      Use
---------------------------------------   -----------------------------------
one sculpted object, several materials    indexed BufferGeometry groups
many unique shapes, same material         BatchedMesh
many unique shapes, many materials        one BatchedMesh per material family
many exact repeats                        InstancedMesh
many repeats with GPU-updated fields      StorageInstancedBufferAttribute
same topology but different materials     InstancedMesh per material bucket
rare one-time merge of static pieces      BufferGeometryUtils.mergeGeometries
creasing after import-like conversion     explicit duplication first; utility
                                          creasing only when semantic edges are
                                          unrecoverable
```

`BatchedMesh` is a candidate container for many varied same-material procedural
geometries when per-object culling/replacement matters. Reserve vertex and index capacity when adding geometry that may be
replaced later, compute batch bounds, keep per-object frustum culling enabled,
and call `optimize()` only during noninteractive maintenance windows.

Installed r185 WebGPU does not issue one native multi-draw for the batch:
`WebGPUBackend` loops `drawIndexed`/`draw` over visible `_multiDrawCount`
entries and updates renderer draw statistics per entry. Use `BatchedMesh` for
object/state management, storage reuse, culling, sorting, and replacement—not
as a draw-collapse proof. For fewer GPU draw items use static compatible
merging, identical-topology instancing, or a capability-proven indirect route,
then measure submitted work.

`InstancedMesh` is correct only when topology is identical. Per-instance matrix,
color, scalar parameters, material selection bucket, and deformation phase are
attributes; topology differences are not.

`mergeGeometries()` is a final static bake, not the live compiler. It requires
compatible attributes and cannot preserve semantic authoring intent unless the
writer already encoded groups, seams, and material slots correctly.

## Dynamic and GPU-Owned Update Paths

Static procedural geometry:

```text
build once
upload once
release CPU arrays only if no rebuild path needs them
```

Interactive edits:

```text
reserve max edit capacity
write changed vertices into typed arrays
addUpdateRange() for positions/normals/tangents/uvs touched
set needsUpdate
recompute changed chunk bounds
update group draw range only if topology count changed
```

Hot per-frame transforms or attributes use one transform owner:

```text
StorageInstancedBufferAttribute
  -> storage() node
  -> Fn().compute(instanceCount)
  -> renderer.compute() before its consuming render
  -> matrix-free Mesh + InstancedBufferGeometry reads storage in NodeMaterial
```

Keep `InstancedMesh` when its `instanceMatrix` is the actual transform owner.
Do not add a storage-owned transform on top of it: r185 allocates/binds the
matrix and applies it before `positionNode`, duplicating payload and work.

Visibility compaction or procedural draw commands on the full tier:

```text
input chunks / instances
  -> TSL compute culls and compacts
  -> storage buffer contains visible records
  -> IndirectStorageBufferAttribute drives BufferGeometry.setIndirect(indirect, indirectOffset)
```

In r185 an indirect non-indexed command is four `u32`
`{vertexCount,instanceCount,firstVertex,firstInstance}`. Indexed is
`{indexCount:u32,instanceCount:u32,firstIndex:u32,baseVertex:i32,firstInstance:u32}`.
`IndirectStorageBufferAttribute` exposes `Uint32Array` words, so a negative
`baseVertex` must be written as its signed two's-complement bit pattern (for
example `baseVertex >>> 0`) and remain inside the i32 range; otherwise gate it
to zero. Offsets are
CPU-known byte offsets and each produces one `drawIndirect`/
`drawIndexedIndirect`; r185 exposes no GPU-generated indirect-count multi-draw.
One GPU-written command therefore compacts a homogeneous geometry/material
bucket by changing its `instanceCount`. Varied topology needs fixed CPU-known
buckets/offsets or ordinary static chunk submission.

Avoid CPU readback in the frame loop. Use readback only for validation tooling or
offline capture.

`computeAsync()` is not a GPU-completion fence in r185; it only awaits renderer
initialization before enqueueing compute. Use an actual async readback/map for
CPU-visible completion.

The indirect count must actually control submitted primitives or instances.
Masking hidden records in the vertex shader preserves submission and vertex
cost and must not be reported as GPU culling. Compare scan/compaction cost with
ordinary CPU chunk submission before selecting the compute path.

The canonical fixture is
`examples/semantic-mesh-writer/indirect-fixture.js`; it names
`IndirectStorageBufferAttribute` and `setIndirect()` directly so the API does
not drift into generic "indirect draw attribute" wording.

## NodeMaterial and Output Rules

Surfaces use NodeMaterial classes. Put procedural material variation in TSL nodes
fed by semantic attributes, UV charts, object ids, and material slots. Keep
geometry attributes linear and color-managed deliberately:

- albedo/base-color textures: `SRGBColorSpace`;
- normal, roughness, metallic, height, mask, id, and lookup textures:
  `NoColorSpace`;
- HDR render targets: `HalfFloatType` until tone mapping;
- one tone-map owner and one output conversion owner in `RenderPipeline`.

For inspection scenes, use built-in node passes first:

```text
pass(scene, camera)
  -> mrt({ output, normal, emissive, viewZ/depth as needed })
  -> GTAONode for contact readability
  -> BloomNode from full-scene HDR by default; selective emissive only when proven
  -> TRAANode when temporal stability matters and MSAA is disabled
  -> renderOutput() or outputColorTransform as the single output owner
```

Start from an ordinary fitted directional shadow. Select CSM, tiled arrays, or
custom caching only when coverage, texel error, invalidation behavior, and
measured target cost reject the simpler path. `TileShadowNode` is not a generic
large-scene or tile-GPU optimization.

## Budgets

Report all budgets per tier:

```text
vertices
triangles
index type and index bytes
attribute bytes
group count
draw calls
batch count
storage buffer bytes
compute dispatch count
updated component ranges per frame
bounding volume update cost
named target/browser/adapter/workload CPU and GPU p50/p95 gates
```

Evidence record:

```text
static mesh
  record V, T, index width, attribute stride, groups, allocation bytes,
  projected geometric error, compile p50/p95, and peak transient bytes

standard repeated module
  record unique geometry bytes, BatchedMesh material families, visible
  multi-draw entries/backend draw items, culling cost, and submission p50/p95

interactive edit frame
  zero steady allocation, dirty range count/bytes, no full upload unless the
  edited topology requires it

compute-updated instance field
  one dispatch per independent field group; pack scalars to vec4 lanes when
  it reduces storage fetches without obscuring validation

acceptance
  product-gated whole-frame and paired-marginal p50/p95 on the named target;
  projected error and semantic topology gates pass simultaneously
```

Allocate the geometry/update ceiling from the complete scene and validate
sustained p50/p95 timing, peak upload bytes, and draw submission on each target.
Counts are outputs of the representation and projected-error contract, not
portable device-tier constants.

## Validation

A mesh writer is not complete until it can prove:

- all position, normal, tangent, UV, and color values are finite;
- every index is in range;
- every triangle area is above the tier epsilon;
- winding matches the expected outward normal;
- normal length is approximately one after final transforms;
- tangent `.w` handedness is valid where tangents exist;
- UV density stays within the material's texel target;
- hard edges, caps, UV seams, and material boundaries have duplicated vertices;
- every group has a material slot and covers exactly its index range;
- bounding box and bounding sphere contain all vertices;
- draw calls, batch counts, storage bytes, and update ranges match the budget;
- reduced tiers preserve lobe extrema, silhouette edges, material slots, and UV
  scale.

Debug overlays should show profile lobe contributions, sample indices, rail
orientation, skin/wall/cap ownership, winding, normals, UV density, group ranges,
batch id, LOD tier, and updated ranges.

Checkpointed writer flow:

```text
capacity pass -> must see exact vertex/index budgets; if you see growth, caps/seams were not counted
top skin spans -> must see smooth profile-top only; if you see cap shading mush, hard-edge duplication is missing
backing/walls/caps -> must see separate surfaces; if you see group holes, material ranges are wrong
UV checker -> must see real-distance density; if you see swimming, normalized debug UV leaked into production
normal debug -> must see unit normals and tangent handedness; if you see mirrored seams, regenerate MikkTSpace tangents
group coverage -> must see every index covered once; if you see overlaps, draw calls are unstable
```

## Replacements

- Replaced object-per-module mesh construction with semantic typed-array writers
  into indexed `BufferGeometry`, because explicit capacity, groups, and update
  ranges scale better and are easier to validate.
- Replaced plain growing arrays for production geometry with preallocated typed
  arrays, because they avoid allocation churn and make byte budgets exact.
- Replaced arbitrary global vertex merging with semantic vertex duplication,
  because smoothing groups, UV seams, material boundaries, and tangent spaces are
  authoring decisions.
- Replaced "instancing for any repetition" with the decision table above:
  `BatchedMesh` for varied topology, `InstancedMesh` for identical topology, and
  storage attributes for hot GPU-updated fields.
- Replaced global normal computation as a default with analytic normals plus
  targeted `computeVertexNormals()` only for deliberate smooth regions.
- Replaced generic tangent generation with MikkTSpace tangents for normal-mapped
  NodeMaterial surfaces.
- Replaced normalized production UVs with real-distance UVs; normalized `(s,t)`
  remains only a debug or analytic-mask coordinate.
- Replaced full-buffer dynamic uploads with component-level update ranges and
  targeted bounds recomputation.
