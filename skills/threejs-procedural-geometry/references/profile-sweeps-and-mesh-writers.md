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
attributes to f32 after the decision.

Attribute lifecycle:

- set usage before upload;
- retain immutable static arrays only when rebuilds need them;
- express dynamic ranges with `addUpdateRange(start,count)` in component units;
- set `needsUpdate`, then clear ranges after the upload frame;
- recompute only affected chunk bounds;
- rebuild when capacity, item size, or usage changes.

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

1. Project an authored initial normal off the first tangent and normalize it.
2. Apply the minimal rotation from `t_(i-1)` to `t_i`.
3. For antiparallel tangents, choose a deterministic axis from the prior frame.
4. Re-orthonormalize the transported normal and binormal.
5. Apply authored twist separately around the tangent.
6. For a closed loop, measure residual holonomy and distribute its inverse by
   arc length before closing the seam.

Frenet frames fail at zero curvature and inflections; parallel transport keeps
orientation defined there. Gate tangent/frame angular change, orientation sign,
closed-seam angle, and positional chord error.

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
bounds, draw entries, and bytes. Analytic tangents avoid that conversion when
the parameterization supplies a valid tangent basis.

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
CPU-visible completion uses an actual map/readback outside the frame-critical
path or timestamps for timing.

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
