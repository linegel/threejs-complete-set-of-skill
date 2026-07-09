# Sculpted Profiles and Semantic Mesh Writers

Use this reference for reusable profile sweeps, rail skins and caps, oriented
branch rings, semantic indexed `BufferGeometry` writers, explicit material
slots, `BatchedMesh` / `InstancedMesh` selection, dynamic update ranges, and
geometry-level diagnostics in pinned Three.js r185 WebGPU/TSL.

## Contents

- Architecture first
- Capability gate and quality tiers
- Semantic writer contract
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
