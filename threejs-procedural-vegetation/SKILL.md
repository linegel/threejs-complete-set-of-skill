---
name: threejs-procedural-vegetation
description: Generate authored procedural trees, grass, and vegetation in latest Three.js with WebGPURenderer, TSL, NodeMaterial, compute storage buffers, rooted wind, chunked LOD, species presets, trunks, branches, roots, canopies, leaf cards, trellises, and deterministic vegetation diagnostics.
---

# Procedural Vegetation

Use this skill for vegetation that has botanical structure and scale discipline: dense grass, authored meadows, deciduous trees, recursive branches, roots, canopies, leaf cards, trellises, deterministic species variation, and rooted wind. Start every implementation with `$threejs-choose-skills` when the scene also needs atmosphere, terrain, water, shadows, post, or camera doctrine.

The only taught implementation path is latest Three.js `WebGPURenderer` from `three/webgpu`, TSL from `three/tsl`, `NodeMaterial` subclasses, node render pipelines, and compute/storage data. Legacy WebGL implementation (deprecated, do not extend): `examples/stylized-meadow-grass/grass-system.js`, `examples/gpu-computed-grass/gpu-grass-system.js`.

Canonical WebGPU dense-grass example: `examples/webgpu-dense-grass/`.

## Best Architecture First

For dense grass and meadow vegetation, use this architecture before considering any API detail:

1. Partition the field into deterministic chunks with fixed tile seeds, conservative per-patch bounds, and a visible debug overlay for bounds, density, and impostor state.
2. Generate static blade, clump, species, terrain-conforming origin, facing, bend, color, and material parameters once in TSL compute into `StorageInstancedBufferAttribute` or `instancedArray()` storage nodes.
3. Consume the storage data directly from a `MeshStandardNodeMaterial` or `MeshPhysicalNodeMaterial`; attach storage nodes through position, normal, color, roughness, alpha, and translucency node slots.
4. Keep wind, touch response, camera-facing yaw, seasonal wetness, and trampling as dynamic fields. Update only those fields per frame, or evaluate them in the vertex node when it is cheaper than a dispatch.
5. Cull and LOD by patch before draw submission: frustum culling from expanded bounds, distance density tiers, near geometric blades, mid reduced instance density, far clump/impostor cards, and optional compute compaction for high-overlap fields.
6. Use node post only after the geometry budget is under control: `RenderPipeline`, `pass()`, `mrt()` for shared output/normal/depth/emissive data, `GTAONode` for contact, `BloomNode` only for authored emissive vegetation, and `TRAANode` when alpha shimmer needs temporal stabilization.

The replaced sub-best path is full-field per-frame parameter regeneration. Static blade and clump data are immutable after spawn; only dynamic fields should be refreshed.

## Capability Gate And Tiers

Initialize the renderer before allocating storage resources:

```js
import { WebGPURenderer } from "three/webgpu";

const renderer = new WebGPURenderer({ antialias: false });
await renderer.init();

const nativeStorageTier = renderer.backend.isWebGPUBackend;
if (nativeStorageTier) {
  await renderer.computeAsync(initVegetationNode);
} else {
  throw new Error('WebGPU backend unavailable for the canonical vegetation path.');
}
```

Quality tiers are product tiers, not alternate shader stacks:

| Tier | Capability | Vegetation path | Target use |
| --- | --- | --- | --- |
| Ultra | Native storage and compute | 64-128 chunks, compute-filled storage instance data, dynamic wind fields, per-patch cull, density LOD, impostors | desktop discrete |
| High | Native storage and compute with lower budgets | 32-64 chunks, static compute generation, vertex-node wind, reduced post | desktop integrated |
| Medium | Native WebGPU with budgeted storage/compute | 16-32 chunks, coarser storage attributes, lower density, fixed wind textures, fewer dynamic fields | mobile WebGPU |
| Low | Native WebGPU minimal render budget | authored tree meshes, sparse grass cards, impostor rings, static wind phase | screenshots, previews, low-power WebGPU devices |

If the user explicitly asks how to apply fallback when WebGPU is unavailable,
route that teaching to `../threejs-compatibility-fallbacks/` instead of adding
a second path here.

## Dense Grass Build Order

1. Choose patch size from culling, not from texture dimensions. A good default is 16-32 m patches with 8-20 k blades each; keep one `InstancedMesh` per patch per LOD representation, and budget submitted draw objects as `visibleDraws = drawObjectsPerPatch * visiblePatches`.
2. Allocate static storage attributes: origin/height/width/facing/bend, clump id/density/species, color variation, terrain normal, and packed material flags. Prefer 16-byte alignment and pack half-precision-like ranges into normalized fields when visual error is below one pixel.
3. Run one initialization dispatch per chunk with `Fn().compute(count)` and deterministic hash seeds. Write to `StorageInstancedBufferAttribute` via `storage()` nodes or use `instancedArray()` then `toAttribute()` for render consumption.
4. Use the same terrain field, density mask, path mask, and clump field for placement, material variation, and LOD thresholds. Do not let visual color clumps drift from density clumps.
5. Render blades with a shared low-vertex strip or clump mesh. Fold the blade in the vertex node with Bezier or circular-arc math from root to tip; keep the root anchored in both color and shadow passes.
6. Update dynamic fields on a fixed budget: wind vector texture or storage buffer, gust-front phase, player/object touch history, wetness, snow weight, and seasonal color scalar.
7. Submit only visible chunks. Each chunk owns expanded bounds for maximum blade height, terrain displacement, and wind bend. Never make one monolithic uncullable grass object the production default.
8. Transition to impostors by patch, not by individual blade. Cross-fade density or alpha hash over a short distance band and keep shadow density matched to visible density.

Use `renderer.compute()` when dispatch order can stay inside the frame graph; use `renderer.computeAsync()` for explicit initialization, streaming chunk generation, readback-free validation steps, or when the app needs a promise boundary.

Canonical dense-grass draw counts are per patch because the patch is the culling granularity. In `examples/webgpu-dense-grass/dense-grass-system.js`, each patch owns one blade `InstancedMesh` and one impostor-card `InstancedMesh`; `getStats().drawObjectsPerPatch` reports `2`, and `validateDenseGrassConfig()` uses `visibleDrawObjectCeiling = patchCount * 2`. Derive patch count as `visiblePatchesWorst = (2 * patchGridRadius + 1)^2`. The ultra preset comment cites `81` patches, `1.46M` visible blades, and `2` draw objects per visible patch; the high preset comment cites `49` patches, `588k` visible blades, and `2-12` submitted patch draws typical after frustum culling.

| Preset | Source parameters | Worst visible patches | Worst submitted draw objects | Allocated blades |
| --- | --- | ---: | ---: | ---: |
| Ultra | `patchGridRadius = 4`, `drawObjectsPerPatch = 2`, `bladesPerPatch = 18000` | `(2 * 4 + 1)^2 = 81` | `2 * 81 = 162` | `81 * 18000 = 1458000` |
| High | `patchGridRadius = 3`, `drawObjectsPerPatch = 2`, `bladesPerPatch = 12000` | `(2 * 3 + 1)^2 = 49` | `2 * 49 = 98` | `49 * 12000 = 588000` |
| Default runtime options | `normalizeOptions({})` selects `high` | `(2 * 3 + 1)^2 = 49` | `2 * 49 = 98` | `49 * 12000 = 588000` |

## Creature Composition

Vegetation owns the wind field as an authored procedural field in the sense of `$threejs-procedural-fields`; creatures sample that same field for fur, feather, cloth, or antenna response, so there is no second wind system with an independent phase. For trampling, creature stance events must write world-space contact positions, radii, weights, and decay into the same touch/interaction channel consumed by grass displacement. The current WebGPU dense-grass example exposes wind uniforms and static density storage but no local trampling displacement channel, so this is a future contract: add a dynamic touch texture or compact storage buffer, sample it in the blade position node, and leave static blade storage immutable.

## r185 Add-On Import Paths

Use these exact add-on paths when vegetation needs built-in post or shadow helpers:

| Helper | Import path |
| --- | --- |
| `GTAONode` / `ao` | `three/examples/jsm/tsl/display/GTAONode.js` |
| `BloomNode` / `bloom` | `three/examples/jsm/tsl/display/BloomNode.js` |
| `TRAANode` / `traa` | `three/examples/jsm/tsl/display/TRAANode.js` |
| `CSMShadowNode` | `three/examples/jsm/csm/CSMShadowNode.js` |
| `TileShadowNode` | `three/examples/jsm/tsl/shadows/TileShadowNode.js` |

## Trees And Plant Growth

Represent a plant as a growth hierarchy plus rendering adaptations. Do not model it as randomly scattered cylinders.

1. Define a per-level species table: length, radius, taper, child count, emergence range, angle, twist, gnarliness, sections, radial segments.
2. Grow branches iteratively from a queue so recursion depth and budgets remain inspectable.
3. Emit each branch as oriented rings with an intentional UV seam, or route generic ring writing to `$threejs-procedural-geometry`.
4. Update section orientation from inherited direction, stochastic curvature, tropism or external force, and optional attraction constraints.
5. Spawn children with stratified longitudinal slots and independently permuted angular slots.
6. Generate leaves only after branch topology is stable.
7. Build foliage normals from card orientation plus local crown volume; for high-density leaf fields, store per-leaf root, card basis, bend phase, and alpha cutoff in storage attributes.
8. Choose wind scope explicitly. Leaf-root deformation, branch hierarchy deformation, trunk sway, and whole-tree motion are separate systems and must share the same visible and shadow deformation.

Read [references/structured-ash-growth-system.md](references/structured-ash-growth-system.md) before tuning Ash-like deciduous trees. Preserve its preset, continuation, child-placement, leaf, material, wind, composition, diagnostic, and numeric contracts.

## Materials, Alpha, And Output

- Use `MeshStandardNodeMaterial` for grass and bark, `MeshPhysicalNodeMaterial` when leaf translucency or clearcoat-style wax response matters, and `SpriteNodeMaterial` only for far impostors.
- Use `alphaTest` or `alphaHash` for leaves and grass. Avoid sorted transparency for dense vegetation unless the asset truly needs partial glass-like blending. Use `forceSinglePass` for double-sided flat vegetation when it removes redundant back-side work without visible loss.
- Deform shadow casters with the same node math as visible geometry. If the wind root is at `uv.y = 0`, both color and shadow geometry must keep that root fixed.
- Color textures such as bark, leaf, flower, and albedo atlases use `SRGBColorSpace`. Data maps such as normal, roughness, density, alpha, path, clump, wind, LUT, and weather masks use `NoColorSpace`/linear data. Disable mip generation only when compute writes all mip levels or the map is sampled without minification.
- Keep HDR buffers as `HalfFloatType` until tone mapping. The app has one tone-map owner and one output conversion owner through `RenderPipeline.outputColorTransform` or an explicit `renderOutput()` node.
- Prefer `CSMShadowNode` for sunlit vegetation ranges and `TileShadowNode` for large tiled scenes. Custom cached clipmaps belong in `$threejs-scalable-real-time-shadows`.

## Performance Budgets

State budgets before implementation:

| Device tier | Visible blades | Chunks submitted | Init compute | Per-frame compute | Submitted draw objects | Post budget |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Desktop discrete | 1-4 M | 64-128 | under 8 ms per streamed region | under 0.8 ms | `2 * visiblePatches`; ultra worst `2 * 81 = 162` | under 2.0 ms |
| Desktop integrated | 250 k-1 M | 24-64 | under 12 ms per streamed region | under 0.5 ms | `2 * visiblePatches`; high/default worst `2 * 49 = 98`; typical `2-12` after culling | under 1.2 ms |
| Mobile/low power | 50-250 k | 8-32 | amortized over frames | under 0.25 ms | `2 * visiblePatches`; derive worst from preset radius | under 0.8 ms |

Storage budget targets:

- Static grass attributes: 32-64 bytes per blade after packing.
- Dynamic fields: one 2D wind/touch texture or one compact storage buffer per active region, under 8 MB for desktop and under 2 MB for low-power tiers.
- Tree geometry: compile once into typed buffers; do not allocate vector objects in runtime wind or per-frame LOD loops.
- Node post: one scene pass with `mrt()` when normals/depth/emissive are reused, reduced-resolution AO/bloom via `setResolutionScale()`, and no duplicate scene re-render for diagnostics unless explicitly requested.

## Diagnostics And Failure Conditions

Capture diagnostics as first-class views: patch bounds, density LOD, impostor transitions, static versus dynamic storage fields, clump ids, terrain height/normal fit, wind displacement magnitude, alpha coverage, shadow parity, leaf origins, branch-level colors, bark UV checker, and final composition.

Visual failures:

- branches form visible helices;
- dense grass ignores terrain height, path masks, or clump-level variation;
- static blade parameters regenerate every frame;
- chunks outside the frustum still dominate submitted draw work;
- every child emerges at the same relative height;
- bark texture scale changes unintentionally with branch radius;
- leaves reveal flat card normals under rotation;
- leaf or grass wind moves roots instead of keeping them anchored;
- visible vegetation and shadow vegetation deform differently;
- different seeds change species identity rather than controlled variation;
- geometry cost grows without per-level, per-chunk, and per-device budgets.

## Routing Boundary

Use `$threejs-procedural-geometry` for generic branch-ring emission without a growth model. Use `$threejs-procedural-fields` for shared terrain, density, weather, and biome fields. Use `$threejs-procedural-materials` for authored bark/leaf/grass PBR identities. Use `$threejs-scalable-real-time-shadows` for custom shadow clipmaps beyond `CSMShadowNode` or `TileShadowNode`. Use `$threejs-image-pipeline` when the vegetation scene owns the final HDR, AO, bloom, temporal AA, and output-transform stack.

This skill owns species tables, topology, child placement, foliage, grass fields, roots, chunked dense vegetation, static/dynamic storage separation, and hierarchical/rooted wind.
