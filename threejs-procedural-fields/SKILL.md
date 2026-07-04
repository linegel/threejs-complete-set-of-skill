---
name: threejs-procedural-fields
description: Build coherent WebGPU/TSL procedural scalar and vector fields for Three.js NodeMaterials, compute bakes, storage textures, terrain, planets, wear, biomes, clouds, water masks, displacement, roughness, normals, domain warping, and visuals where many channels derive from shared causes.
---

# Procedural Fields

The first implementation decision is the algorithm class. Do not begin with a
simple material expression and later optimize it. Author the field once as a
deterministic TSL `Fn`, reuse that exact function in material, vertex, and
compute stages, and bake it to storage resources whenever repeated reads make
evaluation the slower path.

Use `$threejs-choose-skills` before this skill when the request spans multiple
graphics systems. Use `$threejs-procedural-materials` when the task is channel
assembly and material response, and `$threejs-procedural-planets` when the
deliverable is a complete planetary body.

Legacy WebGL implementation (deprecated, do not extend): `../threejs-procedural-planets/examples/procedural-planet-surface/planet-system.js`.

## Mandatory Renderer Path

Use only latest Three.js WebGPU/TSL APIs:

- `WebGPURenderer` from `three/webgpu`.
- TSL from `three/tsl`, with reusable `Fn` field functions.
- `MeshStandardNodeMaterial`, `MeshPhysicalNodeMaterial`, or the appropriate
  `NodeMaterial` family member for material consumers.
- `RenderPipeline`, `pass()`, `mrt()`, `PassNode.setResolutionScale()`,
  `outputColorTransform`, and `renderOutput()` for node post pipelines.
- `renderer.compute()` or `renderer.computeAsync()` with `Fn().compute(count)`,
  `StorageTexture`, `textureStore()`, `StorageBufferAttribute`,
  `StorageInstancedBufferAttribute`, `storage()`, barriers, and atomics when the
  field bake or placement algorithm needs them.

Runnable import baseline:

```js
import {
  RenderPipeline,
  StorageBufferAttribute,
  StorageInstancedBufferAttribute,
  StorageTexture,
  WebGPURenderer,
} from 'three/webgpu';

import {
  Fn,
  mrt,
  pass,
  renderOutput,
  storageTexture,
  textureStore,
} from 'three/tsl';
```

`outputColorTransform` is a `RenderPipeline` property, not a TSL export.

## Capability Gate And Tiers

Initialize and branch once at system setup. The reduced tier is a quality tier,
not a second implementation path.

```js
await renderer.init();

const fieldTier = renderer.backend.isWebGPUBackend ? 'gpu-storage' : 'reduced';

if (fieldTier === 'gpu-storage') {
  // Compute/storage path: bake reusable fields, update dynamic tiles, sample
  // storage-backed outputs from NodeMaterials and node post passes.
} else {
  // Reduced quality: smaller CPU/offline grids, precomputed generated variants,
  // lower octave counts, static LODs, and no custom low-level rewrite.
}
```

Quality tiers:

| Tier | Use when | Field architecture |
| --- | --- | --- |
| `gpu-storage` | WebGPU backend with compute/storage available | TSL `Fn` is source of truth; bake hot scalar/vector fields to `StorageTexture` or storage buffers; sample packed outputs many times. |
| `gpu-evaluate` | WebGPU backend, low read count, small field cost | Call the same TSL `Fn` directly in material or vertex nodes; avoid bake memory and dispatch overhead. |
| `reduced` | Backend lacks compute/storage | Use smaller precomputed maps from `assets/generated-variants/`, fewer bands, static geometry LODs, and CPU parity tests; do not author a parallel low-level renderer path. |

## Field Contract

Before code, write a field bundle:

```text
coordinates
  -> macro form
  -> meso structure
  -> derived causes
  -> packed material and placement channels
```

Example:

```text
sphereDirection
  -> tangentially warped direction
  -> elevation + ridges + craterDepth
  -> slope + cavity + latitude + moisture
  -> biome + color + roughness + bump + placementMask
```

The contract must record:

- coordinate domain and units;
- seed ownership and deterministic hash/noise family;
- primary fields and derived causes;
- consuming material, geometry, compute, placement, and post channels;
- filtering rule per frequency band;
- bake-vs-evaluate choice and expected read count;
- CPU parity plan and tolerances;
- debug output for every named field.

## Build Order

1. Choose stable coordinates from the physical cause: radial planet kilometers,
   world XZ water/wetness, branch-local growth coordinates, or authored strata.
2. Define one deterministic TSL `Fn` field bundle. Reuse it everywhere instead
   of duplicating math in separate materials or compute jobs.
3. Port the same math to CPU only for geometry generation, offline assets,
   parity tests, and reduced quality tiers. Keep constants, seeds, wrapping,
   normalization, and remaps byte-for-byte intentional.
4. Decide bake versus direct evaluation from the table below before assigning
   material nodes.
5. Pack baked channels by access pattern and precision, not by visual category.
6. Wire `NodeMaterial` consumers from the shared function or baked texture.
7. Add node-pass diagnostics through `RenderPipeline`, `pass()`, and `mrt()`.
8. Validate parity and budgets before adding extra bands.

## Bake-Vs-Evaluate Table

| Reads per frame per field | Best path | Reason |
| --- | --- | --- |
| 1 read and <= 4 cheap bands | Evaluate the TSL `Fn` inline | No dispatch, memory, or sampling overhead. |
| 2-4 reads or shared by several material channels | Evaluate once in a local node bundle and reuse outputs | Keeps causal structure coherent without allocating a texture. |
| 5-12 reads, expensive warp, or used by material plus post | Bake to packed `StorageTexture` at the needed resolution | One compute dispatch amortizes ALU over many filtered samples. |
| 12+ reads, placement/culling, or per-instance consumers | Bake to storage texture plus storage buffers | Compute owns compaction, placement, and field reuse without CPU readback. |
| Static or slow-changing field | Bake once or on targeted invalidation only | Updating every frame wastes bandwidth and hides algorithm mistakes. |
| Dynamic field with local edits | Tile the bake and invalidate dirty tiles | Avoid full-field dispatches when only a region changed. |

Bake scalar fields into `rg16f`/`rgba16f`-class storage textures when precision
matters. Pack categorical masks into integer-compatible lanes only when the
consumer needs exact IDs. Never bake a field just because it is easy; bake when
the read count or cross-system reuse pays for the dispatch and memory.

## Required Field Rules

- Shared causes first: color, roughness, normal, displacement, emission, masks,
  and scattering must derive from the same named fields.
- Domain-warp the coordinates, not every result.
- Warp spherical coordinates tangentially, then renormalize.
- Use separate frequency bands for silhouette, regions, surface breakup, and
  micro-normal.
- Do not displace geometry with frequencies above mesh Nyquist.
- Keep categorical masks broad enough to avoid isolated bubble regions.
- Parameter names must describe perception: `ridgeWidth`, `coastBlend`,
  `cavityDarkening`, not `noise3Amount`.
- Random placement starts with strata and semantic constraints; jitter only
  inside valid cells.

## Filtering And Stability

Filter before the field aliases:

- Stop octave loops when projected wavelength falls below two pixels or two
  mesh edges, whichever is stricter for that consumer.
- Fade high-frequency contribution by camera altitude or projected footprint;
  keep the coordinates stable and fade amplitude only.
- Use mipmapped baked fields for repeated filtered samples.
- For procedural normals, lower detail energy and compensate roughness when
  normal variance would shimmer.
- For displacement, silhouette bands belong in geometry; micro bands belong in
  material normals or baked masks.
- World effects use world coordinates; planetary effects use radial physical
  coordinates; object-local ornament uses local coordinates.

## Color And Output

- Authored color textures use `SRGBColorSpace`.
- Scalar masks, vector fields, normal/roughness/wetness/noise/LUT/weather data,
  and baked field textures use `NoColorSpace` or explicit linear data handling.
- HDR working buffers stay `HalfFloatType` until tone mapping.
- The app has one tone-map owner and one output conversion owner. In node
  pipelines, `RenderPipeline.outputColorTransform` or `renderOutput()` owns the
  final conversion; individual fields and materials do not double-convert.

## Budgets

Set budgets in the field contract and reject designs that exceed them:

| Target | Inline field cost | Bake size | Dispatches | Field memory | Frame budget |
| --- | --- | --- | --- | --- | --- |
| Desktop discrete | <= 8 bands inline or baked when reused | up to 2048^2 per hot field atlas | 1-3 targeted dispatches | <= 64 MB hot field data | <= 1.5 ms fields + bakes |
| Desktop integrated | <= 5 bands inline | up to 1024^2 | 1-2 dispatches | <= 32 MB | <= 2.5 ms |
| Mobile/lower tier | <= 3 bands inline | 512^2-1024^2, fewer lanes | 0-1 dispatch | <= 16 MB | <= 3.5 ms |

Keep draw calls unchanged when adding a field. Avoid in-frame CPU readback.
Use readback only in explicit diagnostics or parity tests. Static fields update
once; slow fields update on a fixed cadence; edited fields update dirty tiles.

## Diagnostics

Every field stack needs a debug route for:

- source coordinates;
- tangential warp vector;
- each frequency band;
- macro height versus material height;
- humidity, temperature, slope, cavity, and identity masks;
- near/mid/far or footprint weights;
- baked channel pack visualization;
- water normal and crest from the same evaluation;
- wetness by world height;
- seed and stratification cells;
- CPU versus TSL parity error.

Use `mrt()` when the diagnostics share one scene pass. Use
`PassNode.setResolutionScale()` for reduced-resolution field diagnostics and
restore full resolution only where inspection needs it.

## What This Skill Emits

- field contract with coordinate owner, physical/perceptual units, seed owner,
  filtering rule, and bake-vs-evaluate decision;
- TSL `Fn` field bundle and CPU parity port;
- packed channel schema for direct material use or `StorageTexture` bakes;
- debug views for every named field;
- validation command: `node examples/webgpu-field-bake/validate-field-contract.mjs`;
- sibling ownership notes for material response, planet bodies, weather,
  image-pipeline ownership, and visual validation.
