---
name: threejs-procedural-geometry
description: Build production procedural mesh systems in latest Three.js WebGPU/TSL. Use for sculpted rail and frame profiles, oriented branch rings, semantic indexed BufferGeometry writers, explicit material slots, BatchedMesh versus InstancedMesh decisions, typed-array update paths, NodeMaterial surfaces, and close-inspection geometry budgets.
---

# Procedural Geometry

Generate geometry from semantic dimensions and explicit coordinate frames. The
fast path is not "make triangles"; it is a reusable mesh compiler that writes
indexed `BufferGeometry` directly into preallocated typed arrays, owns smoothing
groups and material slots, and chooses `BatchedMesh`, `InstancedMesh`, or static
geometry from topology and update behavior before any vertex is emitted.

Use `$threejs-choose-skills` for preflight when geometry, materials, shadows, and
post processing all matter. This skill owns reusable mesh emission. Use
`$threejs-procedural-buildings-and-cities` for building grammars,
`$threejs-procedural-vegetation` for growth hierarchies, and then apply these
mesh-writer mechanisms inside those subject skills.

## API Baseline

- Renderer: `WebGPURenderer` from `three/webgpu`; call `await renderer.init()`.
- Shading: TSL from `three/tsl` with `MeshStandardNodeMaterial`,
  `MeshPhysicalNodeMaterial`, `MeshBasicNodeMaterial`, or other NodeMaterial
  family classes.
- Post and diagnostics: `RenderPipeline`, `pass()`, `mrt()`,
  `PassNode.setResolutionScale()`, built-in `GTAONode`, `BloomNode`,
  `TRAANode`, `CSMShadowNode`, and `TileShadowNode` when those effects are
  needed by the inspection scene.
- GPU-generated or hot dynamic fields: TSL `Fn().compute(count)` through
  `renderer.compute()` / `renderer.computeAsync()`, with `StorageBufferAttribute`,
  `StorageInstancedBufferAttribute`, `storage()` nodes, and indirect draw buffers
  where culling or compaction is compute-owned.
- Color: color textures use `SRGBColorSpace`; geometry data, normals, masks,
  LUTs, and procedural lookup textures use `NoColorSpace`/linear. Keep HDR
  buffers as `HalfFloatType` until the single tone-map and output conversion
  owner in the node pipeline via `outputColorTransform` or `renderOutput()`.

## Capability Gate

Use one renderer path and degrade quality, not implementation model:

```js
await renderer.init();

const tier = renderer.backend.isWebGPUBackend ? "gpu-storage" : "static-lod";

if (tier === "gpu-storage") {
  // Full tier: compute-generated dynamic attributes, storage buffers,
  // indirect draw compaction, and full mesh validation overlays.
} else {
  // Reduced tier: precomputed meshes, smaller grids, static LODs, and fewer
  // material diagnostics. No alternate low-level renderer recipe.
}
```

Legacy WebGL implementation (deprecated, do not extend): `examples/sculpted-gallery-frame/frame-geometry.js`

Canonical implementation contract: `examples/semantic-mesh-writer/`.
Run `node examples/semantic-mesh-writer/validate-geometry.js --fixture frame-hero --json`
after edits.

## Space Contract

| space | owner | rule |
| --- | --- | --- |
| world space | Three.js Y-up scene | app/camera owns view convention |
| rail-local | rail orientation | top/bottom/left/right map `s` along rail and profile width outward |
| profile-local | sculpted profile | `t` travels inner-to-outer, profile arc length owns production V |
| production UV | material sampler | real-distance `s` and profile arc length times texels/world unit |
| debug `(s,t)` | diagnostics only | stored in `debugUv`, never production material UV |
| winding | writer | outward quads use `a, b, c / b, d, c` |
| writer input | generator module | semantic dimensions, material slot, smoothing group, UV chart, boundary reason |

## Build Order

1. Choose the algorithm class and batch model:
   semantic indexed `BufferGeometry` writer for unique authored surfaces,
   `BatchedMesh` for many same-material objects with varied topology,
   `InstancedMesh` for repeated topology with per-instance transforms or
   attributes, and storage/indirect buffers only when visibility or deformation
   is hot enough to justify GPU-side generation.
2. Define semantic dimensions, named regions, material slots, smoothing groups,
   UV charts, and LOD tiers before allocating buffers.
3. Precompute exact vertex/index capacity per tier; allocate typed arrays once;
   select `Uint16Array` indices only when every referenced vertex fits, otherwise
   use `Uint32Array`.
4. Emit through a writer API: `addVertex`, `addTriangle`, `addQuad`, `addGroup`,
   `startSmoothingGroup`, `startUvChart`, and `finishGeometry`.
5. Duplicate vertices intentionally at hard edges, caps, UV seams, material
   boundaries, mirrored tangent spaces, and any place that needs independent
   normals or tangents.
6. Generate UVs from real distance for production materials. Reserve normalized
   `(s,t)` coordinates for local debug views or analytic node masks.
7. Prefer analytic normals and tangents from the generator. Use
   `computeVertexNormals()` only for intentionally smooth shared-vertex regions;
   use `BufferGeometryUtils.computeMikkTSpaceTangents()` for normal-mapped
   surfaces and validate mirrored seams.
8. Assign `BufferGeometry` groups exactly: every index belongs to one group, no
   group overlaps, and material index order is stable across LODs.
9. Set attribute usage before first render. Static meshes can release CPU arrays
   with `onUpload()` when no rebuild is needed; dynamic sections use
   `addUpdateRange()`, `needsUpdate`, and targeted bounds recomputation.
10. Validate finite attributes, index bounds, degenerate triangles, winding,
    normal length, tangent handedness, UV density, bounding box/sphere, group
    coverage, byte cost, draw calls, and renderer stats.

Read [references/profile-sweeps-and-mesh-writers.md](references/profile-sweeps-and-mesh-writers.md)
for the profile sweep, rail emission, branch-ring, semantic writer, batching
decision table, quality tiers, and validation budgets.

## Performance Budgets

- Static hero profile: <= 35k vertices, <= 70k triangles, <= 6 material groups,
  one mesh draw per material group, no per-frame allocation, rebuild only when
  dimensions change.
- Repeated unique modules: `BatchedMesh` per material, one draw per material
  batch, reserve vertex/index capacity up front, keep per-object culling enabled
  unless a measured scene proves otherwise.
- Repeated identical topology: `InstancedMesh` with instance attributes; move hot
  transforms/colors into `StorageInstancedBufferAttribute` when compute updates
  replace CPU uploads.
- Dynamic edits: update only changed component ranges; target zero full-buffer
  uploads during interaction and zero geometry object churn per frame.
- Frame targets for geometry work: <= 0.25 ms CPU update on desktop discrete,
  <= 0.75 ms desktop integrated, <= 1.5 ms mobile for routine edits; rebuilds
  may exceed this only on explicit user actions and must report vertex/index
  counts, bytes, group count, draw calls, and update ranges.

## Failure Conditions

- triangle emission starts before the batch model and material slots are known;
- profile orientation flips along a curve;
- caps reuse side vertices and create averaged edge normals;
- UV scale changes with segment count or LOD tier;
- arbitrary vertex merging destroys hard edges, UV seams, tangent spaces, or
  material boundaries;
- generated dimensions are hidden in magic multipliers;
- `InstancedMesh` is used despite per-instance topology differences;
- `BatchedMesh` is skipped for many same-material unique geometries;
- attribute `usage` is changed after upload instead of rebuilding the attribute;
- dynamic geometry uploads whole buffers when only subranges changed;
- triangle count is the only reported complexity metric.
