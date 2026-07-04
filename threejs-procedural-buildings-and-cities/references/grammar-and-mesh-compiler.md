# Architecture Grammar and WebGPU Mesh Compiler

Use this reference when a procedural architectural generator must retain
deliberate massing, facade rhythm, construction depth, semantic placement,
inspectable ownership, and city-scale throughput in latest Three.js
`WebGPURenderer` + TSL.

## Contents

1. Compiler architecture
2. Public API and diagnostics
3. Mass grammar
4. Compound footprints and exposed edges
5. Placement grammar
6. Module registry and local frames
7. Material-slot compilation
8. Node materials, color, and output
9. City-scale batching and capability tiers
10. Structural closure
11. Assertions and validation fixtures
12. Adaptation workflow
13. Diagnostics and failure modes

## 1. Lead With the Fast Compiler Architecture

The best default architecture is:

```text
BuildingSettings
  -> createMassTiers()
  -> validate mass spans and topology
  -> computeExposedSurfaceGraph()
  -> createKitPlacements()
  -> validateBuildingPlan()
  -> compile modules into material-slot writers
  -> one BatchedMesh or merged BufferGeometry package per building/chunk
  -> NodeMaterial slots + RenderPipeline integration
```

Do not generate triangles while deciding the building, and do not model an
authored facade as a cloud of primitive instances. The plan is the authority;
the mesh compiler is an emission backend.

Use this decision table:

```text
static hero building:
  merged indexed BufferGeometry per material slot, one compiled group

many module shapes sharing one material:
  BatchedMesh per material slot, with per-object culling/sorting when useful

large counts of one repeated geometry:
  InstancedMesh only for genuinely identical parts such as thousands of
  matching fins, bolts, lamps, or trees outside the facade compiler

large city district:
  chunked material-slot batches, CPU plan cache, optional WebGPU compute for
  visibility/LOD masks and compaction
```

`BufferGeometry.groups` may preserve material partitions inside one geometry,
but it is not a draw-call reduction mechanism. Prefer material-slot batches
when draw-call budgets matter.

The critical intermediate representation is `BuildingPlan`:

```ts
type BuildingPlan = {
  settings: BuildingSettings;
  bayWidth: number;
  floorHeight: number;
  tiers: BuildingTier[];
  footprintPieces: FootprintRect[];
  exposedEdges: FacadeEdge[];
  placements: KitPlacement[];
  diagnostics: BuildingDiagnostics;
};
```

Keep it serializable. It enables topology rendering, deterministic tests,
module-usage accounting, facade ownership inspection, chunk compilation,
regression fixtures, and module replacement without changing mass grammar.

## 2. Public API and Diagnostics

Use this shape unless a host app already has an equivalent boundary:

```ts
function createBuildingPlan(settings: BuildingSettings): BuildingPlan;
function validateBuildingPlan(plan: BuildingPlan): BuildingDiagnostics;
function compileBuilding(
  plan: BuildingPlan,
  materials: BuildingNodeMaterials,
  options: {
    qualityTier: "hero" | "city" | "distant";
    chunkId?: string;
    preferBatchedMesh?: boolean;
  },
): CompiledBuilding;
function disposeCompiledBuilding(compiled: CompiledBuilding): void;
```

Diagnostics must include:

```text
seed and normalized settings
tier role/name/bounds/inset
footprint rectangle IDs
full side intervals and blocker intervals
surviving exposed edges with endpoint semantics
bay count and effective bay width
reserved whole-height zones
placement IDs and ownership rectangles
module usage counts
missing and unused module IDs
exact duplicate ownership keys
general overlap pairs
material slot per triangle
world meters per atlas repeat
triangle count per module and slot
draw calls per building and chunk
BatchedMesh or merged geometry capacity and unused space
chunk bounds and culling state
mass caps, soffits, decks, and connectors
```

Validation errors are data, not console prose. Store them in the plan and fail
before geometry when the plan violates invariants.

## 3. Use Dimensional Constants as Grammar Anchors

The dimensional contract fixes:

```text
BAY_WIDTH = 3.2 m
FLOOR_HEIGHT = 3.35 m
PODIUM_FLOOR_HEIGHT = 4.45 m
```

Settings express spans in bays and floors:

```text
fullWidth = widthBays * 3.2
fullDepth = depthBays * 3.2
podiumHeight = podiumFloors * 4.45
```

Seeded randomness perturbs constrained decisions:

```text
towerScale = clamp(
  authoredTowerScale + random(-0.05, 0.04),
  0.62,
  0.96
)

setbackInset =
  3.2
  * (1 - towerScale)
  * random(0.86, 1.08)
```

Randomness adjusts shaft floor splits, setback progression, directional
insets, crown inset, and twin-tower narrowing. It does not choose arbitrary
boxes and does not repair invalid geometry.

Every upper span retains at least four bays:

```text
clampedSpan(span, inset) = max(4 * BAY_WIDTH, span - 2 * inset)
```

Without that invariant, upper tiers collapse into non-architectural slivers.

### Exact Mass Patterns

The mass grammar supports:

```text
single tower
outer ring / free court
twin towers with optional skybridge
```

`classic-bank` keeps one shaft slice. `corner-hq` usually creates two. The
setback-tower path creates three when floor count permits.

Twin towers derive:

```text
gap = max(2.2 bays, 18% full width)
towerWidth = max(4 bays, 46% of remaining width)
towerDepth = 82% full depth
towerOffset = gap / 2 + towerWidth / 2
```

The optional bridge is a real `BuildingTier`:

```text
y = podiumHeight + clampedBridgeFloor * FLOOR_HEIGHT
height = 1.15 * FLOOR_HEIGHT
depth = max(1.2 bays, 18% full depth)
```

Treat bridges, podiums, shafts, and crowns as topology so facades and caps use
the same contracts.

## 4. Compound Footprints and Exposed Edges

The footprint grammar uses rectangular pieces:

```text
L:
  front bar depth = 58%
  rear wing width = 44%

T:
  cross bar depth = 36%
  stem width = 46%

U:
  front bar depth = 34%
  each wing width = 26%

courtyard block:
  bar thickness = max(2 bays, 24% of smaller outer span)
```

The free-court path clamps the inner court so every bar retains at least
`1.8 * BAY_WIDTH`, then applies bounded X/Z offsets.

Do not union the pieces before facade planning. Keep pieces and compute
exposed intervals per rectangle. This is the algorithm that prevents hidden
decorations and drives trim ownership.

### Exposed-Edge Subtraction

For each rectangle side:

1. Create its full one-dimensional interval.
2. Find rectangles touching that side within `0.001`.
3. Project touching rectangles into blocker intervals.
4. Subtract blockers sequentially.
5. Preserve which endpoint was clipped.
6. Discard segments shorter than `0.25`.
7. Emit one `FacadeEdge` per surviving segment.

```ts
type FacadeEdge = {
  id: string;
  side: "front" | "back" | "left" | "right";
  center: number;
  length: number;
  x: number;
  z: number;
  start: number;
  end: number;
  isOuterCornerStart: boolean;
  isOuterCornerEnd: boolean;
  isInnerCornerStart: boolean;
  isInnerCornerEnd: boolean;
};
```

Use interval subtraction, not center-point tests. Derive endpoint flags from
the subtraction result; do not mark both endpoints as inner corners just
because a surviving segment is shorter than the original side.

Trim, plinths, belt courses, cornices, parapets, corner joints, and facade
ownership rectangles attach to `FacadeEdge` intervals. Whole-tier decoration
is sub-best because it breaks at compound corners and can draw inside courts.

## 5. Compile Facade Roles Separately

`createKitPlacements()` dispatches by tier role:

```text
podium -> createPodiumPlacements
crown  -> createCrownPlacements
shaft/bridge -> createShaftPlacements
```

Roof placements attach only to the highest crowns. Without crowns, they attach
to highest shaft or bridge tiers. "Highest" means matching maximum
`y0 + height` within `0.001`, so both twin towers can receive roofs.

### Bay Quantization

```text
count = max(minimum, round(edge.length / 3.2))
bayWidth = edge.length / count
bayCenter(i) =
  edge.center - edge.length / 2 + bayWidth * (i + 0.5)
```

The effective bay width adapts to the exact exposed segment. Do not append a
narrow remainder bay.

### Podium

Podium edges use at least five bays on front/back and three on sides.

The first `0.74 m` is a granite plinth unless the fortress archetype replaces
it with a `2.1 m` rusticated block.

Ground-floor selection is semantic:

```text
front:
  center revolving door
  paired lobby doors adjacent to center
  optional corner entrance
  optional colonnade
  otherwise tall lobby windows

back:
  loading dock every third bay
  security doors elsewhere

sides:
  service-bank loading docks
  service doors at edges
  lobby windows elsewhere
```

Projection depth varies by module:

```text
paired column      1.8 m
corner entrance    1.55 m
revolving door     1.5 m
loading dock       1.2 m
ordinary podium    1.1 m
```

That depth hierarchy is part of the visual result. Coplanar facade rectangles
cannot preserve the portico and entrance reading.

Podium trim includes a first-floor belt, top cornice, optional intermediate
cornice, corner cornices, and explicit corner-joint modules. Each trim run is
generated from exposed intervals.

### Shaft

Shaft edges use at least four bays. Reserve whole-height zones before filling
ordinary floor bays:

- front central glass shaft and side piers for tower archetypes;
- structural blank/service zones on non-front sides;
- full-height corner piers.

Ordinary bay choice depends on side, floor and bay modulo patterns, shaft
rhythm, and archetype.

```text
terra-cotta arcade:
  floor % 4 == 0 -> arcade bay
  else floor % 2 == 0 -> arched window
  else -> brick window

paired rhythm:
  alternating double-window and 3 m window

Chicago grid:
  every third center bay uses 4 m window
```

High ornament density can rewrite one bay into a lower carved/spandrel module
plus an upper window module. It is geometry with ownership and material-slot
cost, not a decal.

Add construction rhythm independently of windows:

- floor band, sill, and lintel strips;
- pilaster bundles every two or three bays;
- lower, middle, and upper courses;
- corner-joint modules at trim endpoints.

Keep ownership separate for infill, vertical structure, and horizontal trim.

### Crown and Roof

Crown bays combine corner parapets, window/parapet infill, lower and upper
cornices, attic/cartouche panels, optional pediment, and finials.

Finial spacing is authored by named rhythm:

```text
edge sparse      5.2 m
edge dense       2.1 m
skyline spikes   3.4 m
default          3.2 m
```

Roof style selects:

```text
pyramidal metal:
  sloped roof + crest

statue tower:
  sloped roof + lantern + mast

flat/service:
  railings + equipment gated by density thresholds
```

Equipment thresholds are `0.12`, `0.32`, `0.58`, and `0.66`; each adds a
specific equipment group rather than scaling one generic clutter count.

## 6. Module Registry and Local Frames

Each placement resolves a registered builder:

```ts
type KitModuleContext = {
  writer: SlotMeshWriter;
  transform: (point: Vec3) => Vec3;
  moduleId: KitModuleId;
  width: number;
  height: number;
  depth: number;
  anchors: Record<string, Vec3>;
  moduleVariant?: string;
  uvMetersPerRepeat: number;
};
```

The compiler chooses:

```text
roof placement   -> roofTransform(x, y, z)
facade placement -> facadeTransform(side, tier dimensions, edge offsets)
```

`facadeTransform()` handles orientation and winding for all four sides.
Module builders author geometry in one local convention.

Do not make each module understand global side placement. That duplicates
orientation logic and creates inconsistent normals.

The registry is asserted before compilation. Missing builders fail rather
than silently producing holes. Unused registered modules are diagnostics, not
hard failures.

Minimum real builders for a production fixture:

```text
plinth
window
glass shaft
corner pier
cornice
roof
finial
```

## 7. Material-Slot Compilation

The material slots are:

```text
limestone
granite
terra-cotta
glass
bronze
black-metal
ornament
roof
```

`SlotMeshWriter` owns positions, normals, tangents when required, UVs, colors
or IDs, and indices per slot. After validation, it emits either:

```text
merged static slot:
  one indexed BufferGeometry per material slot

batched slot:
  one BatchedMesh per material slot with registered module geometries
```

This separates glass from opaque stone, metals from masonry, and ornament from
base limestone while bounding draw calls by semantic material roles.

For static buildings, merge into compact slot geometries, compute bounding
boxes and spheres, and keep a mapping from triangle ranges back to module IDs
for diagnostics and picking. For editable or streamed buildings, reserve
`BatchedMesh` vertex/index capacity, call `computeBoundingBox()` and
`computeBoundingSphere()` after population, and report unused capacity.

### Physical Texture Scale

For limestone and ornament:

```text
stone tile size = 1.45 m
atlas = 3 columns x 2 rows
padding = 0.004 UV
```

Large quads are bilinearly subdivided at `ceil(length / 1.45)` along each
axis. Each subquad maps no more than one atlas-cell span:

```text
uSpan = min(1, subquadWorldWidth / 1.45)
vSpan = min(1, subquadWorldHeight / 1.45)
```

This prevents one stone sample stretching across a tower wall.

Atlas cell choice must be deterministic from seed, module ID, slot, and
coarse facade coordinates. If a project deliberately uses one coherent stone
cell, document it as a style decision rather than claiming per-quad variation.

Texture rules:

```text
albedo/base-color maps: SRGBColorSpace
normal/roughness/metalness/height/mask/ID maps: NoColorSpace
mipmaps: on for repeated surface maps, off only for exact data lookup
atlas padding: enough for the target mip chain
compression: prefer KTX2/Basis for shipping city-scale albedo and normal sets
anisotropy: budgeted per material, highest on hero masonry only
```

## 8. Node Materials, Color, and Output

Use TSL `NodeMaterial` identities, not string shader patches. Typical slot
mapping:

```text
limestone / granite / terra-cotta / ornament:
  MeshStandardNodeMaterial with atlas color, roughness, normal, AO, and
  deterministic variation nodes

bronze / black-metal / roof:
  MeshStandardNodeMaterial with metalness/roughness identities and optional
  patina or dirt masks

glass:
  MeshPhysicalNodeMaterial with separate transparent or alpha-tested slot,
  thickness/IOR/roughness controls, and explicit sorting policy
```

For glass-heavy facades, keep glass in its own slot and draw category. Avoid
interleaving transparent and opaque material ranges inside a single batch.
Prefer alpha test or alpha hash for grilles and small cutouts; reserve full
transparency for panes that actually need it.

The app has one output owner:

```text
RenderPipeline
  -> pass(scene, camera)
  -> optional mrt({ output, normal, emissive, ... })
  -> GTAONode / BloomNode / TRAANode as needed
  -> outputColorTransform or renderOutput()
```

Use `GTAONode` for contact grounding under trim, ledges, and roof equipment.
Use `BloomNode` only from authored emissive material signal. Use `TRAANode`
for temporal anti-aliasing when shimmer from dense facade detail is visible.
Use `CSMShadowNode` or `TileShadowNode` for large architectural shadows before
custom shadow systems.

Keep HDR working buffers as `HalfFloatType` until tone mapping. Do not apply
per-material output conversion.

## 9. City-Scale Batching and Capability Tiers

Initialize the renderer and gate storage/compute paths once:

```js
import { WebGPURenderer } from "three/webgpu";

const renderer = new WebGPURenderer( { antialias: false } );
await renderer.init();

if ( renderer.backend.isWebGPUBackend ) {
  // Full tier: renderer.compute(), StorageBufferAttribute,
  // StorageInstancedBufferAttribute, storage() nodes, per-chunk visibility,
  // and optional StorageTexture + textureStore() for ID/LOD/debug masks.
} else {
  // Reduced tier: precompiled static chunks, lower ornament density,
  // smaller grids, and serialized distant variants.
}
```

The reduced tier is a quality tier, not a second implementation. It keeps the
same plan/compiler contract and swaps budgets:

```text
hero:
  full module set, exposed-edge diagnostics, physical UV scale, glass slot,
  close-inspection profiles, all validation fixtures

city:
  same mass and exposed-edge grammar, fewer ornament rewrites, chunked
  material-slot batches, coarser roof equipment

distant:
  simplified precompiled shells, baked variation, no dynamic regeneration,
  packed material slots
```

Budgets:

```text
hero building:
  draw calls: 6-10
  triangles: 80k-250k
  CPU compile after settings change: < 8 ms amortized
  GPU frame cost: < 0.8 ms desktop-discrete, < 1.6 ms integrated, < 3.0 ms mobile

city block chunk:
  draw calls: <= 48 for 24-80 buildings
  visible triangles: 400k-1.5M after LOD/chunk culling
  storage metadata: <= 8 MB
  compute dispatches: <= 1 visibility/compaction dispatch per moving-camera frame
  GPU frame cost: < 2.5 ms desktop-discrete, < 5 ms integrated, < 8 ms mobile

distant skyline sector:
  draw calls: <= 16
  triangles: <= 120k
  material slots: opaque masonry, glass, roof, emissive
```

Only move city visibility or repeated-detail transforms to
`renderer.compute()` / `renderer.computeAsync()` after CPU chunking and
material-slot compilation are already measured. The fastest building compiler
is still plan cache plus static slot geometry; compute is for hot city-scale
state, not for replacing deterministic grammar.

Use `workgroupBarrier` or `atomic*` only for measured compaction, counters, or
visibility prefix work that needs synchronization. Do not add synchronized
compute stages to deterministic building grammar when CPU plan caching is
already cheaper.

## 10. Close the Mass Independently

Before placement compilation, the mass compiler adds:

- soffits under elevated tiers;
- decks on podium/crown/bridge tiers;
- raised deck-edge strips;
- connectors between touching rectangles at equal role, `y0`, and height.

This prevents holes at setbacks and compound-footprint seams.

Skipping decks for shaft tiers is acceptable only when upper shaft roofs are
never visible in the target camera set. Otherwise deck visibility is a mass
compiler decision.

Structural closure belongs to the mass compiler, not window or cornice
modules.

## 11. Assertions and Validation Fixtures

Fail generation on:

```text
registered module IDs without builders
duplicate surface ownership keys
general placement overlap pairs above tolerance
invalid exposed-edge endpoint flags
upper tier spans below four bays
facade placements on blocked intervals
slot geometry exceeding quality-tier budget
```

The ownership key includes side, tier, edge, X/Z offsets, horizontal interval,
vertical interval, and normal offset, rounded to `0.01`.

Exact duplicate-key detection is not enough. Perform interval-overlap
validation whenever modules can have independent widths, projection depths, or
arbitrary offsets.

Required fixed-seed fixtures:

```text
single tower
compound L/T/U footprint
courtyard / free court
twin towers
twin towers with bridge
high ornament density
minimum-span upper tiers
glass-heavy facade
distant skyline chunk
```

Every fixture records plan JSON, diagnostics, material-slot counts, triangle
counts, draw calls, and bounding boxes.

## 12. Adapt in This Order

1. Define bay/floor constants and quality budgets.
2. Produce deterministic mass tiers only.
3. Validate mass spans and serialize `BuildingPlan`.
4. Render topology blocks colored by role.
5. Decompose footprints and inspect exposed-edge intervals.
6. Emit placements without geometry.
7. Validate ownership, overlaps, endpoint flags, and missing builders.
8. Compile a minimal plinth/window/corner/cornice/roof kit.
9. Emit material-slot merged geometry or `BatchedMesh` per slot.
10. Add physical atlas scale and UV-density diagnostics.
11. Add per-slot TSL `NodeMaterial` identities.
12. Add reserved zones and ornament rewrites.
13. Add crowns and roof equipment after facade rhythm is stable.
14. Chunk buildings and measure draw calls, triangles, bounds, and GPU cost.
15. Add storage-buffer or compute visibility only when city-scale profiling
    shows CPU or upload cost is the bottleneck.

Do not begin with dozens of decorative builders. A weak mass and edge graph
cannot be repaired by ornament.

## 13. Diagnostics and Failure Modes

Expose:

```text
seed and normalized settings
tier role/name/bounds/inset
footprint rectangle IDs
full side and blocker intervals
surviving exposed edges
bay count and effective bay width
reserved whole-height zones
placement IDs and ownership rectangles
module usage counts
missing and unused module IDs
exact duplicate ownership keys
general overlap pairs
material slot per triangle
world meters per atlas repeat
triangle count per module and slot
draw calls per building and chunk
BatchedMesh capacity and unused vertex/index space
merged geometry bounds
mass caps, soffits, decks, and connectors
```

Failure diagnosis:

```text
facades inside a courtyard:
  blockers were not subtracted from rectangle sides

upper tiers become slivers:
  minimum four-bay span was removed

window rhythm collides with central/service zones:
  reserved vertical zones were filled again

cornices stop at compound corners:
  trim was generated per whole tier instead of per exposed edge

stone scale changes across walls:
  quads were not subdivided at the physical tile scale

holes appear under setbacks:
  mass caps/soffits were delegated to facade modules

missing pieces fail silently:
  registry completeness was not asserted

overlaps survive validation:
  exact duplicate-key detection was mistaken for general overlap testing

draw calls explode:
  primitive instances were emitted per module instead of compiling by material slot

transparent panes sort incorrectly:
  glass was mixed into opaque slots or lacks an explicit sorting/alpha policy

city chunks cull incorrectly:
  bounds were not recomputed after regeneration or batch population
```
