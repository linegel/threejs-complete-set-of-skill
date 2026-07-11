---
name: threejs-procedural-buildings-and-cities
description: Build authored procedural buildings, facades, cities, and semantic site-asset assemblies in Three.js r185 WebGPU/TSL. Use for massing grammars and for deterministic placement/compilation of supplied or separately generated ruin, dock, boat, rock, vegetation, and prop families; anchors, sockets, exclusions, exposed-edge analysis, profiles, ornaments, material-slot BatchedMesh or merged BufferGeometry, stable IDs, NodeMaterial identities, spatial paging, LOD, and asset-manifest validation.
---

# Procedural Buildings and Cities

Choose the compiler package before emission: a deterministic grammar produces
a validated plan, then emits material-slot `BatchedMesh` containers or merged
indexed `BufferGeometry` per building/chunk. Do not start from per-primitive
scene objects and try to recover semantics later.

Use the pinned Three.js r185 with `WebGPURenderer` from `three/webgpu`, TSL from
`three/tsl`, `MeshStandardNodeMaterial` / `MeshPhysicalNodeMaterial` material
identities, node post through `RenderPipeline`, and storage/compute APIs only
where they beat CPU chunking for city-scale state. Built-in node effects are
the first revision-matched comparison baseline; retain them only when their
measured quality and cost pass the workload contract.

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

For generated terrain, islands, coasts, ruins, docks, boats, rocks, pebbles,
flowers, or small scene assemblies, also read
[references/semantic-site-asset-kits.md](references/semantic-site-asset-kits.md).
When any asset supplies collision, support, rigid-body, hydrostatic, structural,
or interaction semantics, also apply the shared
[physics-domain and interaction contract](../threejs-choose-skills/references/physics-domain-and-interaction-contract.md).

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
- In installed r185 WebGPU, `BatchedMesh` loops one backend draw item per
  visible multi-draw entry; it reduces scene-object/state management but does
  not prove draw-call collapse. Merge compatible static slot geometry or
  instance identical topology when fewer GPU draw items are required, and
  record actual renderer/backend counts.
- Use `InstancedMesh` only for large counts of identical repeated objects
  whose unique geometry count is small and whose per-instance identity is
  meaningful. It is not the default compiler architecture for authored facades.
- Preserve real dimensions for floor height, bay width, trim projection, tile
  scale, and texture density.
- Randomness may select among valid designs; it must not repair invalid
  geometry.
- Provide topology, exposed-edge, placement, ownership, material-slot, UV
  density, bounds, draw-call, and triangle diagnostics.

## Semantic Site And Coastal Asset Kits

Use the same plan-before-emission architecture for small site assets. The site
plan consumes versioned terrain/coast fields plus a registry of semantic asset
manifests; it emits placements with stable IDs, explicit anchors, support and
exclusion volumes, material slots, LOD representations, and diagnostics. It
does not infer meaning from arbitrary mesh bounds after placement.

Physics-facing manifests additionally publish stable `ColliderProxy` and, when
needed, `DeformingSupportProxy` IDs; `PhysicsMaterialId` bindings; provider IDs;
and versioned `RigidBodyProperties` or `HydrostaticHullProperties`. These proxy
identities and body properties are independent of render LOD, batching, and
runtime instance index. A display hull, building mesh, or bounding box is not a
collision, structural, buoyancy, or drag model.

Dynamic transforms publish `RigidBodyState` and view-independent
`PresentedStatePair` bindings with independent previous/current provenance and
leases. Cameras own render mapping through `CameraViewPublication`; per-view
LOD, visibility, shadows, caches, and resets belong to
`ViewPreparationPublication`. A sealed snapshot references candidate binding
IDs and leases, and multi-target `FrameExecutionRecord` entries retire those
leases only after every consumer completes.

External dynamics cross one declared `ExternalSolverAdapter`: the site package
serializes its adapter and proxy identities, while the adapter owns the exact
unit/frame/time conversion, solver ownership split, synchronization proof, and
step receipts. The site compiler does not synthesize physical exchange records.
The selected domain solver publishes or accepts each dimensioned
`InteractionRecord` with a target equation, physical footprint, application
interval, exact-once key, and conservation membership.
Every selected external dynamics route publishes `PhysicsExternalAdapterCost`
through its adapter owner and binds it to the same opportunity rows as site
state and presentation. Record request/response/batch counts, logical and
physical bytes, serialization plus frame/unit conversion, queue/transport/
ownership/fence dependencies, remote solve and commit tail, retries/exact-once
results, in-flight/recovery memory, clock mapping, and process/device-loss
witnesses. Site compile time or remote-solver time alone is not adapter cost.
After atomic commit, each dynamic asset contributes its leased state pair to a
camera-free `PhysicsPresentationCandidate`; render LOD never substitutes for
that committed physical state. A physics-facing change to collider topology,
body representation, material law, solver cadence, error bound, or stable-ID
policy proceeds only through a coordinator-admitted `QualityTransition` with a
conservative map or explicit reset at a safe step boundary and exactly one
authoritative emitter throughout migration.

Required reference families must resolve to a licensed compact asset kit or a
tested procedural module/generator. A missing ruin, dock, boat, rock/reef,
vegetation, cloud-silhouette, or other identity-bearing family is a blocker,
not permission to fabricate boxes, billboard blobs, or unrelated noise.

```text
environment snapshot + seed + authored anchors
  -> candidate/support regions
  -> constraint and clearance validation
  -> deterministic asset/variant selection
  -> semantic placements and adjacency/attachment graph
  -> per-material/per-representation compilation
  -> serialized site plan + runtime package
```

Place required landmarks and their reservations first, then dependent
supports/attachments, then ecology, then optional filler clusters or decals.
Every streamed phase uses stable candidate sorting and a conflict/filter halo;
generation or chunk load order must not alter owned placements.

Required environment inputs declare units, sign, coordinate frame, filtering,
revision, and missing-data behavior for terrain elevation/normal/slope,
substrate and semantic regions, signed coast distance and coast frame,
still-water depth or bathymetry where relevant, exposure, paths, and authored
exclusions. Site assets consume dynamic water/motion hooks but do not solve
them.

| Asset family | Required semantic contract | Causal owner outside this compiler |
| --- | --- | --- |
| ruin/wall/foundation | module graph, corners/openings, support footprint, collapse state, material slots, vegetation sockets | low-level profiles/mesh writers route to geometry; materials route to procedural materials |
| dock/pier/bridge | land root, coast tangent/outward normal, deck datum, pile/bed contacts, berth/mooring frames, clearance prism | water surface/depth from water; optional motion from motion systems |
| boat/floating prop | hull/waterline frame, conservative swept bound, berth/free-water mode, material slots, `RigidBodyProperties`, `HydrostaticHullProperties`, stable collider/support proxy and wake/interaction emitter metadata | buoyancy/wave/current state from water or domain solver; transform motion from motion systems |
| rock/boulder/pebble/debris | ground/embed anchor, support normal policy, footprint, cluster group, substrate/coast eligibility | topology from procedural geometry; PBR identity from procedural materials |
| flower/grass/shrub/tree | root anchor, ecology/species response, crown/wind bounds, clearance, growth/LOD package | placement/growth/wind from procedural vegetation |

Do not promote each pebble, flower, plank, or rubble fragment to a scene
object. Compile immutable identical topology through spatially paged instancing;
merge compatible static unique pieces by material slot; retain `BatchedMesh`
only when replacement, per-part visibility, or identity justifies its measured
r185 multi-draw entries. Authored landmark assets preserve individual IDs.

Choose the runtime package from mutability and visibility:

| Workload | Package | Visibility policy |
| --- | --- | --- |
| One static close-inspection building | Merged indexed geometry per material slot | Object/part bounds; no runtime grammar work |
| Editable building with varied modules | `BatchedMesh` per compatible material family | Per-object batch visibility and targeted replacement |
| Repeated identical modules | `InstancedMesh` or storage-instanced attributes | Spatial pages; never one city-wide uncullable batch |
| Large district | Serialized spatial chunks with projected-error LOD and optional occlusion/compute compaction | Submit only visible chunks; impostor/proxy far field |

GPU visibility is justified only when its scan/compaction plus indirect draw
actually removes more submission/vertex work than CPU chunk culling.
Every LOD/packing transition uses the
[shared physical-pixel projected-error contract](../threejs-choose-skills/references/projected-error-contract.md),
including nearest support depth, unjittered projection, hysteresis/dwell, and
simultaneous transition memory.

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

if (renderer.backend.isWebGPUBackend !== true) {
  throw new Error(
    'WebGPU is required for the canonical architecture compiler path; explicit fallback teaching belongs to threejs-compatibility-fallbacks.'
  );
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
- Do not put physical transmission on every distant pane. Hero panes may use
  transmission; mid/far facades use reflection probes/environment response,
  opaque layered-window materials, or baked interiors selected by projected
  pane size. Transparent sorting and background capture are part of the cost.
- Keep one material identity per semantic slot: limestone, granite,
  terra-cotta, glass, bronze, black-metal, ornament, and roof.
- LDR base-color/emissive textures encoded as sRGB use `SRGBColorSpace`;
  HDR/EXR radiance remains loader-declared linear. Normal, roughness,
  metalness, masks, IDs, atlas selectors, and diagnostics use
  `NoColorSpace` / linear data.
- Keep HDR buffers as `HalfFloatType` until tone mapping.
- The node pipeline owns the only tone-map and output conversion through
  `RenderPipeline.outputColorTransform` or an explicit `renderOutput()` node.
  Materials and effects must not double-convert.
- Use `pass(scene, camera)`, `mrt()` only when several nodes share scene data,
  and `PassNode.setResolutionScale()` for reduced-resolution post effects.
- For image treatment, prefer built-in nodes first: `GTAONode` for contact
  grounding, `BloomNode` for authored emissive signs or interiors, `TRAANode`
  for temporal anti-aliasing. Start shadows from an ordinary fitted directional
  map; route CSM, tiled arrays, or caching through the shadow skill only when
  coverage/error/invalidation and measured cost require them.

## Performance Contract

Record a workload ledger for every compiled representation:

```text
hero building:
  semantic/material slots, V/T, projected facade/profile error,
  compile p50/p95, peak transient bytes, draws after material batching

city block chunk:
  source buildings, visible chunks/instances, submitted and culled V/T,
  metadata bytes, CPU culling/submission or compute-compaction work IDs,
  attachment/overdraw cost
  StorageTexture: only for generated ID/LOD/debug masks that need textureStore()

site asset chunk:
  accepted/rejected placements by constraint, stable asset/variant IDs,
  anchor/clearance/support violations, visible/submitted instances and V/T,
  material/representation buckets, transition overlap, metadata/asset bytes,
  compile/upload/cull p50/p95 and composed paired-marginal evidence

distant skyline:
  sector bounds, projected silhouette error, visible V/T, draws/material slots,
  baked texture bytes and transition hysteresis
```

Chunk by spatial bounds before city-scale batching. Compute bounds after
compilation and after every regeneration. Pool reusable arrays and dispose
generated geometries, `BatchedMesh` objects, textures, and node effects when
replacing a district.

Allocate architecture cost from the complete frame and measure contemporaneous
whole-frame and paired-marginal p50/p95 GPU time, CPU compile/cull/submission,
overdraw, visible/culled triangles, upload traffic, peak resident/transient
bytes, and sustained thermal behavior. Geometry/detail levels are selected by
projected error and semantic requirements; no building/triangle/draw count is a
portable device-class guarantee.

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

A semantic site kit must additionally survive chunk-order permutations,
terrain/coast revision invalidation, rotated coast-frame fixtures, missing asset
and anchor failures, overlap/support/clearance assertions, LOD population and
identity checks, waterline/deck/berth diagnostics, and low-end/mobile composed
measurement. A visually plausible pile of untracked props is not an accepted
site plan.

## Replaced Techniques

- Replaced per-primitive `InstancedMesh` placement as the default with
  material-slot `BatchedMesh` or merged indexed `BufferGeometry` compilation,
  because authored buildings need many module shapes, stable material
  identities, exposed-edge ownership, and explicit mutability/culling policy.
  Only merged static geometry or identical-topology instancing is presumed to
  collapse r185 WebGPU draw items; BatchedMesh counts are measured.
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

Use `$threejs-procedural-fields` for terrain/coast/support/exposure fields,
`$threejs-procedural-vegetation` for plant ecology and growth, and
`$threejs-water-optics` or `$threejs-procedural-motion-systems` for dynamic
water and transform state consumed by docks/boats. This compiler owns semantic
assembly, anchors, attachments, exclusions, stable asset selection, and the
site-plan package; it does not own water simulation, buoyancy physics, plant
growth, or generic rock mesh generation.

Structural deformation, fracture progression, collision resolution, rigid-body
dynamics, buoyancy, and fluid/structure coupling remain owned by the selected
external/domain solver. The site compiler serializes the canonical proxy,
property, provider, and adapter IDs; the solver participates in the shared
`PhysicsGraph` and exchanges canonical samples/interactions. Do not add a
site-local timestep, force accumulator, or mesh-bound collision callback.

Use `$threejs-scalable-real-time-shadows` for CSM/tiled shadow budgets and diagnostics.

Use `$threejs-ambient-contact-shading`,
`$threejs-exposure-color-grading`, and `$threejs-image-pipeline` for node
post stack ownership beyond architecture-specific guidance.

This skill owns massing, facade semantics, architectural modules, validation,
and building-plan compilation.
