---
name: threejs-procedural-buildings-and-cities
description: Build authored procedural buildings, facades, and city kits in latest Three.js WebGPU/TSL. Use for massing grammars, exposed-edge analysis, facade bays, profiles, arches, cornices, roofs, ornaments, material-slot BatchedMesh or merged BufferGeometry compilation, deterministic variants, NodeMaterial identities, and procedural city assets.
---

# Procedural Buildings and Cities

Build the fastest architecture first: a deterministic grammar produces a
validated plan, then the compiler emits one material-slot `BatchedMesh` or
merged indexed `BufferGeometry` package per building or city chunk. Do not
start from per-primitive instance placement and try to optimize it later.

Use latest Three.js with `WebGPURenderer` from `three/webgpu`, TSL from
`three/tsl`, `MeshStandardNodeMaterial` / `MeshPhysicalNodeMaterial` material
identities, node post through `RenderPipeline`, and storage/compute APIs only
where they beat CPU chunking for city-scale state. Built-in node effects are
the fastest correct baseline.

## Required Build Order

```text
settings + seed
  -> mass grammar
  -> plan validation
  -> exposed-surface graph
  -> facade / roof / trim placements
  -> module registry validation
  -> per-material-slot mesh compilation
  -> one compiled building object or chunk batch
  -> WebGPU/TSL materials and node pipeline integration
```

Read
[references/grammar-and-mesh-compiler.md](references/grammar-and-mesh-compiler.md)
before implementing the generator.

Legacy implementation (deprecated, do not extend):
`examples/authored-financial-tower/`.

## Architecture Rules

- Keep grammar, validation, placement, and mesh emission as separate phases.
- Resolve exposed edges before facade placement. Do not decorate hidden
  internal faces.
- Treat exposed-edge analysis as trim and ornament authority: cornices, corner
  joints, parapets, pilasters, plinths, and roof ownership follow surviving
  intervals, not whole-tier rectangles.
- Modules own semantic anchors, local frames, construction depth, UV density,
  and material slots; they do not own global side orientation.
- Compile by material slot. The default output is one compiled building object
  with stable slot membership, not an `InstancedMesh` soup of primitive boxes.
- Use `BatchedMesh` when many local module geometries share one material and
  still need per-part visibility, transforms, sorting, or replacement. Use a
  merged indexed `BufferGeometry` per slot when the building is static and
  only chunk-level culling is needed.
- Use `InstancedMesh` only for large counts of identical repeated objects
  whose unique geometry count is small and whose per-instance identity is
  meaningful. It is not the default compiler architecture for authored facades.
- Preserve real dimensions for floor height, bay width, trim projection, tile
  scale, and texture density.
- Randomness may select among valid designs; it must not repair invalid
  geometry.
- Provide topology, exposed-edge, placement, ownership, material-slot, UV
  density, bounds, draw-call, and triangle diagnostics.

## Public API Shape

```ts
type BuildingQualityTier = "hero" | "city" | "distant";

function createBuildingPlan(settings: BuildingSettings): BuildingPlan;
function validateBuildingPlan(plan: BuildingPlan): BuildingDiagnostics;
function compileBuilding(
  plan: BuildingPlan,
  materials: BuildingNodeMaterials,
  options: {
    qualityTier: BuildingQualityTier;
    chunkId?: string;
    preferBatchedMesh?: boolean;
  },
): CompiledBuilding;
function disposeCompiledBuilding(compiled: CompiledBuilding): void;
```

`BuildingPlan` stays serializable. It must include tiers, footprint pieces,
exposed intervals, placements, module usage, ownership rectangles, missing and
unused module IDs, overlap pairs, material slot counts, UV meters per repeat,
and per-slot triangle budgets.

## WebGPU Capability Gate

Architecture generation is CPU deterministic; city-scale visibility,
regeneration, LOD masks, and animated signs may use storage buffers or compute.
Gate those paths once after renderer initialization:

```js
import { WebGPURenderer } from "three/webgpu";

const renderer = new WebGPURenderer( { antialias: false } );
await renderer.init();

if ( renderer.backend.isWebGPUBackend ) {
  // Full path: StorageBufferAttribute / StorageInstancedBufferAttribute,
  // storage() nodes, renderer.compute(), city chunk visibility, high
  // material-slot budgets, full node post stack.
} else {
  // Reduced-quality tier only: precompiled static chunks, lower ornament
  // density, smaller visibility grids, no custom shader rewrite.
}
```

Quality tiers are asset and budget tiers:

```text
hero:
  full exposed-edge diagnostics, roofs, trim, ornaments, physical UV scale,
  glass separated, close-inspection geometry

city:
  same grammar and validation, fewer ornament rewrites, chunked material-slot
  batches, coarser roof equipment, no tiny one-off geometry

distant:
  serialized precompiled shells, simplified cornice/roof profiles, baked
  color variation, no dynamic per-building recompute
```

## Materials, Color, and Output

- Use `MeshStandardNodeMaterial` for masonry, metals, roof, and ornament;
  use `MeshPhysicalNodeMaterial` for glass when transmission, IOR, thickness,
  or clearcoat matters.
- Keep one material identity per semantic slot: limestone, granite,
  terra-cotta, glass, bronze, black-metal, ornament, and roof.
- Color textures use `SRGBColorSpace`. Normal, roughness, metalness, masks,
  IDs, atlas selectors, and diagnostics use `NoColorSpace` / linear data.
- Keep HDR buffers as `HalfFloatType` until tone mapping.
- The node pipeline owns the only tone-map and output conversion through
  `RenderPipeline.outputColorTransform` or an explicit `renderOutput()` node.
  Materials and effects must not double-convert.
- Use `pass(scene, camera)`, `mrt()` only when several nodes share scene data,
  and `PassNode.setResolutionScale()` for reduced-resolution post effects.
- For image treatment, prefer built-in nodes first: `GTAONode` for contact
  grounding, `BloomNode` for authored emissive signs or interiors, `TRAANode`
  for temporal anti-aliasing, and `CSMShadowNode` / `TileShadowNode` for large
  architecture shadows. Use sibling skills for deep rendering systems.

## Performance Budgets

Target budgets for a compiled building:

```text
hero building:
  draw calls: 6-10 opaque/alpha-separated slot draws
  triangles: 80k-250k
  CPU compile: < 8 ms amortized after seed/settings change
  GPU frame cost: < 0.8 ms desktop-discrete, < 1.6 ms integrated, < 3.0 ms mobile

city block chunk:
  draw calls: <= 48 for 24-80 buildings
  triangles: 400k-1.5M visible after LOD/chunk culling
  storage buffers: <= 8 MB visibility/LOD/material metadata
  compute dispatch: <= 1 visibility/compaction dispatch per moving camera frame
  StorageTexture: only for generated ID/LOD/debug masks that need textureStore()
  GPU frame cost: < 2.5 ms desktop-discrete, < 5 ms integrated, < 8 ms mobile

distant skyline:
  draw calls: <= 16 per skyline sector
  triangles: <= 120k per sector
  material slots: packed to opaque masonry, glass, roof, emissive
```

Chunk by spatial bounds before city-scale batching. Compute bounds after
compilation and after every regeneration. Pool reusable arrays and dispose
generated geometries, `BatchedMesh` objects, textures, and node effects when
replacing a district.

## Acceptance

The generated building must survive:

- silhouette-only view;
- flat untextured material;
- grazing light and contact shadowing;
- close inspection of corners, portals, setbacks, roofs, and exposed-edge
  trim transitions;
- fixed-seed fixtures for single tower, compound footprint, courtyard, twin
  towers, bridge, high ornament density, and minimum-span tiers;
- seed variation without broken bays, overlapping ownership, hidden-wall
  decoration, floating ornament, or sliver tiers;
- triangle, draw-call, material-slot, module-count, bounds, and UV-density
  reporting.

## Replaced Techniques

- Replaced per-primitive `InstancedMesh` placement as the default with
  material-slot `BatchedMesh` or merged indexed `BufferGeometry` compilation,
  because authored buildings need many module shapes, stable material
  identities, exposed-edge ownership, and city-scale draw-call control.
- Replaced whole-tier rectangle decoration with exposed-interval ownership,
  because compound footprints otherwise decorate hidden walls and break trim at
  inner and outer corners.
- Replaced post-compile visual debugging only with serializable plan
  diagnostics before mesh emission, because invalid massing and ownership must
  fail before geometry exists.
- Replaced custom renderer-era material hacks with TSL `NodeMaterial`
  identities and node post, because the modern renderer path keeps materials,
  post, color, and compute in one pipeline.

## Routing Boundary

Use `$threejs-choose-skills` for broad graphics preflight when the work spans
materials, shadows, post, validation, and city-scale performance.

Use `$threejs-procedural-geometry` for reusable profiles, sweeps, rings,
arches, frames, or low-level mesh writers without a building grammar.

Use `$threejs-procedural-materials` for procedural masonry, atlas filtering,
derivative normals, weathering, and per-slot material fields.

Use `$threejs-scalable-real-time-shadows` for CSM/tiled shadow budgets and diagnostics.

Use `$threejs-ambient-contact-shading`,
`$threejs-exposure-color-grading`, and `$threejs-image-pipeline` for node
post stack ownership beyond architecture-specific guidance.

This skill owns massing, facade semantics, architectural modules, validation,
and building-plan compilation.
