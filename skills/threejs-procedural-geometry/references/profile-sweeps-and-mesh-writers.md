# Procedural Geometry Mechanics

Use the section selected by the parent skill. Thresholds are **Gated** against a
named product/view envelope; fixed counts are structural or **Authored** starts,
not portable quality tiers.

## Contents

- [Semantic indexed writer](#semantic-indexed-writer)
- [Contour topology and terrain compilation](#contour-topology-and-terrain-compilation)
- [Semantic anchors and LOD bindings](#semantic-anchors-and-lod-bindings)
- [Profile sweeps and transported frames](#profile-sweeps-and-transported-frames)
- [Batching, dynamic updates, and indirect draws](#batching-dynamic-updates-and-indirect-draws)
- [Validation and failure signatures](#validation-and-failure-signatures)

## Semantic indexed writer

The writer owns arrays, topological/render identity, groups, and validation.
Generators supply semantic dimensions and regions.

```text
plan semantic surfaces
  -> exact capacity pass
  -> preallocated typed arrays
  -> indexed BufferGeometry and stable groups
  -> selected batch/draw representation
```

Suggested contract:

```text
createWriter(capacity, materialSlots)
addVertex(position, normal, tangent, uv, semanticId)
addTriangle(a, b, c, materialSlot)
addQuad(a, b, c, d, materialSlot)
duplicateForBoundary(vertexId, reason)
startSmoothingGroup(name)
startUvChart(name)
finishGeometry()
```

Capacity includes seam, cap, hard-edge, material-boundary, and tangent-space
duplicates. Quads with outward winding use `a,b,c / b,d,c` only after verifying
that convention against the local frame. Use f64 and robust predicates for
generation decisions whose rounded result changes topology; quantize final
attributes to f32 after the decision. Use a chunk-local origin before conversion
when world magnitudes would collapse distinct vertices. Recheck triangle area,
edge length, winding, and intersections on the final values; robust f64 decisions
alone do not make a quantized mesh valid. Count the union of split reasons rather
than adding overlapping duplicates; identical tuples may share a render vertex
across material groups within the same topological vertex/domain. Do not weld
unrelated coincident topological vertices merely because their values match.

Attribute lifecycle:

- set usage before upload;
- retain live arrays while any layout, raycast, bounds, clone, serialization, or
  context-restoration path needs them; discard generator intermediates separately;
- express dynamic ranges with `addUpdateRange(start,count)` in component units;
- set `needsUpdate`; retain every pending range across culled/skipped frames and
  let the adapter clear consumed ranges, rather than clearing on a frame clock;
- recompute only affected chunk bounds;
- rebuild when capacity, item size, or usage changes, and retire the old resource
  generation before losing its ownership handles.

Group coverage is exact: every index is in one group, groups neither overlap nor
leave holes, and material slot order remains stable across LODs even when a slot
is empty.

## Contour topology and terrain compilation

Freeze the source revision, coordinate origin and units, lattice identity,
scalar fields, iso-level IDs, protected component/hole identities, semantic
regions, and error budgets before extraction.

### Marching squares and ambiguity

For an `Nx*Nz` sampled tile, marching squares visits **Derived**
`(Nx-1)*(Nz-1)` cells. Shift threshold `tau` to zero; an edge crossing has

```text
t = f_a / (f_a - f_b)
```

Gate the signs and denominator against propagated value error. Refine from the
authoritative field when uncertain. Use these invariants:

- resolve checkerboard cases with the bilinear asymptotic decider;
- key intersections by `(globalEdgeId, isoLevelId)` so cells/chunks share them;
- define the superlevel set globally as `f>=tau`;
- when an edge or plateau is exactly on-level, emit only the boundary separating
  its connected nonnegative region from strictly negative cells;
- assign exact-contact ownership with one global rule; symbolic perturbation is
  legal only when topology at that contact is explicitly unconstrained;
- assemble oriented closed loops; enumerate intentional domain boundaries;
- remove consecutive duplicates and zero-length edges before triangulation;
- classify nesting and holes with robust predicates; reject self-intersection.

Simplification preserves protected extrema, semantic transitions, anchors,
component/hole counts, nesting, and minimum necks, then rechecks world-space
Hausdorff and projected error. A screen-small feature with selection, placement,
drainage, or data identity remains protected.

### Terraces, bands, walls, and split/merge events

For hard levels `L_k`, define

```text
Omega_k = { p : zRaw(p) >= L_k }
R_k = Omega_k minus Omega_(k+1)
```

Triangulate `R_k` as the cap at `L_k`; extrude the boundary of
`Omega_(k+1)` from `L_k` to `L_(k+1)`. This construction supports components
splitting, merging, appearing, or disappearing between levels. Pairing nearest
vertices on unrelated loops does not.

Use constrained triangulation with robust predicates for polygons with holes.
Ear clipping is eligible only for small validated simple loops. A band between
two signed-distance thresholds is a polygonal region with possible topology
changes, not necessarily a strip with corresponding vertices.

Keep two identities:

```text
topological vertex/edge -> adjacency, closure, contour and chunk continuity
render vertex -> duplicates for normal, tangent, material, or UV boundaries
```

Build half-edge or equivalent adjacency before render expansion. A closed
component gives every interior topological edge two oppositely oriented
incident faces. Deliberate open boundaries are enumerated. After collapsing
render duplicates, an orientable component's Euler check is **Derived**
`chi=V-E+F=2-2g-b` for genus `g` and boundary count `b`.

Normals and UV ownership follow the surface:

- horizontal caps use analytic vertical normals and physical-distance planar UVs;
- height surfaces use `normalize(vec3(-dh/dx,1,-dh/dz))` from the authoritative
  gradient;
- walls use semantic boundary normals and remain hard against caps;
- cap UVs use physical planar distance; wall UVs use boundary arc length and
  physical height;
- bounds include caps, walls, toes, bands, and any visible bed, not just the
  heightfield envelope.

### Chunk and LOD seams

Whole-object LOD is preferred when bounded objects fit residency and submission
gates. When chunking is required:

- sample a global dyadic lattice;
- share boundary samples and intersection IDs;
- balance neighbor levels and use declared stitch patterns or matching boundary
  refinement;
- retain a ghost ring covering every gradient, filter, and contour decision;
- assign one owner for each emitted shared position;
- validate all resident mixed-LOD neighbor pairs;
- treat skirts as occlusion only, not metric/topology repair.

Each LOD reports projected height/silhouette error, contour Hausdorff error,
normal/frame angular error, protected topology, maximum seam gap/T-junctions,
vertex/index/group bytes, simultaneous transition bytes, and backend draw
entries.

Adversarial cases include an iso-level through a vertex, an entire edge on a
level, an ambiguous checkerboard cell, a single-cell component/hole, nearly
touching components, a narrow neck, nested holes, split/merge levels, a contour
through a chunk corner, large rebased coordinates, and every mixed-LOD edge
orientation.

## Semantic anchors and LOD bindings

Use this branch when placement, picking, or measurement must stay attached to
authoritative geometry through decimation and rebuilds. Generate anchors from
the source field, contours, or semantic topology before decimation and before
render-vertex duplication. Each anchor records:

```text
anchorId
sourceFieldVersion or sourceGeometryRevision
topologicalFeatureId and semanticRegionId
position and complete surface frame
clearance or footprint class
exclusionRevision
binding: pinned topological feature or verified per-LOD parametric/barycentric map
```

Pin a required anchor's feature in every LOD or provide a per-LOD binding whose
position and frame errors pass the declared bounds. Rebuilds preserve the
stable anchor/source/topology IDs when their represented feature is unchanged;
a removed or changed feature invalidates the anchor explicitly rather than
snapping it to the nearest display vertex. Verify exclusion revision and
clearance/conflict results with the same source version after every rebuild and
LOD transition.

## Profile sweeps and transported frames

Represent each curve section by center, unit tangent, transported normal and
binormal (or quaternion), cross-section parameters, longitudinal distance,
semantic region, smoothing group, material slot, and UV chart.

Construct a rotation-minimizing frame:

1. Reject or explicitly collapse repeated centers and resolve cusp/zero tangents
   before transport. Project the initial normal off the first unit tangent; when
   its norm fails the conditioning gate, project the least-aligned coordinate
   axis with deterministic ties instead. Normalize only a nonzero result.
2. Apply the minimal rotation from `t_(i-1)` to `t_i`.
3. For antiparallel tangents, choose a deterministic axis from the prior frame.
4. Re-orthonormalize the transported normal and binormal.
5. Keep the untwisted transport separate from the authored twist so each sample
   receives its absolute twist once, rather than accumulating it repeatedly.
6. For a closed loop with matching endpoint tangents, distribute inverse base
   holonomy by arc length, then apply a closure-compatible authored twist. Check
   profile, UV, material, and semantic seam symmetry too; positional closure or
   circular cross-section symmetry alone does not make the full seam compatible.

Frenet frames fail at zero curvature and inflections; parallel transport keeps
orientation defined there. Gate tangent/frame angular change, orientation sign,
closed-seam angle, and positional chord error. A valid frame does not establish
an embedded sweep: bound cross-section radius against curvature, inspect the
surface Jacobian, and test nonadjacent sections for unintended intersections.

Emit profile skins, backs, side walls, and caps as separate semantic regions.
Duplicate vertices at hard boundaries. UVs use accumulated curve length and
profile arc length divided by a declared repeat distance. A normalized `(s,t)`
parameter may live in a separate debug attribute.

Prefer analytic normals and tangents from the sweep. `computeVertexNormals()`
operates only on intentionally shared smooth vertices. If a normal map needs
MikkTSpace parity:

```text
await MikkTSpace.ready
computeMikkTSpaceTangents(geometry, MikkTSpace, negateSign)
```

Installed r185 de-indexes indexed input in this path. Treat the result as a new
representation: rebuild groups as needed and recalculate vertex/index counts,
bounds, draw entries, and bytes. The helper mutates the supplied geometry through
`toNonIndexed()` and `copy()`: name, userData, drawRange, attribute gpuType/usage,
and derived metadata can reset even while groups and raw attribute values
survive. Keep semantic identity outside the conversion, restore intended range
and typed attributes, and validate a CPU candidate before publishing it. Never
convert a live uploaded geometry in place and assume old buffers are retired.
Analytic tangents avoid that conversion when the parameterization supplies a
valid tangent basis.

Branch-like hierarchies resolve topology and attachments before parent buffers
are emitted. Reserve attachment rings and all child capacity in the plan pass;
material and semantic IDs remain stable when LOD removes subordinate geometry.

## Batching, dynamic updates, and indirect draws

### Representation facts

| Need | r185 representation |
| --- | --- |
| unique geometry, several materials | indexed `BufferGeometry` groups |
| varied topology, same material family | `BatchedMesh` |
| identical topology and CPU matrices | `InstancedMesh` |
| identical topology and GPU-owned transform | matrix-free instanced geometry plus storage attributes |
| one-time static compatible merge | `BufferGeometryUtils.mergeGeometries` after semantics are encoded |

`BatchedMesh` reserves/reuses geometry storage and supports per-object culling
and replacement. In r185 WebGPU, the backend loops visible `_multiDrawCount`
entries and issues one draw item per entry. Measure renderer stats and GPU
submission; do not claim native draw collapse.

`mergeGeometries(..., true)` creates one group per input geometry, indexed by
input ordinal; it does not preserve each input's nested material groups, honor
its active drawRange, or apply a Mesh transform. Extract the admitted triangles,
put candidates in one coordinate frame with correct normal/winding treatment,
remap semantic groups and anchor IDs, then validate the merged representation.

`InstancedMesh` owns an `instanceMatrix` (`64 B` per f32 mat4). When storage owns
the complete transform, use a matrix-free `Mesh` with instanced geometry and
reconstruct position/quaternion/scale in the NodeMaterial; layering both paths
duplicates transform payload and work.

### Dynamic ownership

Static geometry builds/uploads once. Interactive edits reserve capacity and
write only changed component ranges. Topology-count changes update the draw
range/groups within reserved capacity or trigger a declared rebuild.

For GPU-owned instance state:

```text
StorageInstancedBufferAttribute
  -> storage() node
  -> Fn().compute(instanceCount)
  -> renderer.compute() before render
  -> matrix-free instanced draw reads the same state
```

There is one transform owner. `computeAsync()` initializes before enqueueing in
r185 but does not prove GPU completion. Queue order covers dependent GPU work;
CPU-visible completion uses an awaited map/readback or queue completion promise
outside the frame-critical path; GPU cost needs actual resolved timestamps.

### Pinned r185 attribute adapter boundaries

These details were reproduced against the published `three@0.185.1` source,
including [WebGPUAttributeUtils](https://github.com/mrdoob/three.js/blob/r185/src/renderers/webgpu/utils/WebGPUAttributeUtils.js)
and [Attributes](https://github.com/mrdoob/three.js/blob/r185/src/renderers/common/Attributes.js).

- Uint16 indices are widened to Uint32; value `65535` becomes `0xffffffff`.
  Use Uint16 only through `65534`, or use explicit Uint32. Budget the post-upload
  array and GPU allocation rather than assuming two GPU bytes per index.
- `DynamicDrawUsage` triggers update even with unchanged version. With no pending
  ranges that update copies the full buffer. Intermittent edits use default
  version-driven usage and `needsUpdate`; do not set a dynamic hint merely
  because an attribute may change someday.
- Storage itemSize 3 is padded to 4 and the CPU array is replaced. A later CPU
  update in this release repads already-padded storage with the old stride.
  Use explicit four-lane storage from creation, including the unused lane, and
  index/range/account against that layout. Do not mutate itemSize after upload.
- Packed writes must give a four-byte-aligned destination and byte length. Expand
  dirty intervals to valid aligned ranges while retaining neighboring bytes and
  actual backing-array bounds. `writeBuffer` source offsets/counts for typed
  arrays are elements; the destination offset is always bytes.
- An in-place attribute swap can lose the old allocation before geometry teardown
  sees it. Publish a separately owned geometry generation, then retire the old
  one with all its consumers accounted for. A dispose event alone is not a
  resource-release measurement; storage/indirect buffers also need explicit
  retirement evidence.

### Indirect commands

In r185 an indirect non-indexed command is four u32 words:

```text
vertexCount, instanceCount, firstVertex, firstInstance
```

Indexed is five words:

```text
indexCount:u32, instanceCount:u32, firstIndex:u32,
baseVertex:i32, firstInstance:u32
```

`IndirectStorageBufferAttribute` exposes u32 words, so negative `baseVertex`
uses its two's-complement bit pattern and must remain in i32 range. Each
CPU-known byte offset produces one indirect draw; r185 has no GPU-generated
indirect-count multi-draw. One command can compact instances of one homogeneous
geometry/material bucket. Varied topology needs stable CPU-known buckets.
Validate four-byte command alignment and the complete 16/20-byte range in the
indirect buffer. Keep `firstInstance=0` unless `indirect-first-instance` is
enabled on the actual device. Zero empty command counts each generation before
compaction; bound writes by capacity and publish commands with the same instance
state generation they address. Reject invalid counts/offsets/baseVertex rather
than relying on a silent no-op. See [indirect draw validation](https://developer.mozilla.org/en-US/docs/Web/API/GPURenderPassEncoder/drawIndexedIndirect).

CPU culling and picking do not read storage-only transforms. Supply a conservative
posed bound including all instances and deformation for each view, or explicitly
disable that culling path until a valid bound exists. Picking needs the same
posed geometry through an admitted CPU mirror or a GPU identity pass.

The indirect count must reduce submitted primitives or instances. Moving hidden
items offscreen or masking them in the vertex/fragment path preserves submission
work and is not culling. Compare compute scan/compaction against ordinary CPU
chunk submission on the target.

## Validation and failure signatures

Validate topology before render duplication and attributes afterward.

Topology:

- loops are closed, simple, nested, and oriented as declared;
- interior edges have exactly two opposite incident faces;
- intended boundaries are enumerated;
- T-junctions, bow-ties, duplicate faces, non-manifold edges, and unbound holes
  are absent;
- protected features and mixed-LOD boundary keys survive all tiers.

Attributes and resources:

- positions, normals, tangents, UVs, and colors are finite;
- indices are in range and triangle indices are distinct;
- area exceeds a scale/quantization-conditioned gate and winding is correct;
- normals are unit length; tangent `.w` and handedness match the normal map;
- physical UV density and seam policy pass every tier;
- groups cover each index once and keep stable material indices;
- bounds contain all emitted surfaces;
- planned/written capacities, index width, attribute bytes, updated ranges,
  draw entries, and disposal events agree.

Reject the compiler when emission precedes representation/slot planning,
capacity grows during writing, contour ambiguity uses an arbitrary diagonal,
holes or split/merge regions are forced into paired strips, render vertices are
welded across semantic boundaries, a sweep frame flips, UV scale changes with
segments/LOD, batching claims unsupported draw collapse, dynamic edits upload
unaffected buffers, or triangle count is the only complexity/error claim.
