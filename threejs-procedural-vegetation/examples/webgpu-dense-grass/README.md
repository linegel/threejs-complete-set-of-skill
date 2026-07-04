# WebGPU Dense Grass

Canonical dense-grass example for `threejs-procedural-vegetation`. It demonstrates chunked deterministic meadow patches, one-time TSL compute initialization into storage-backed instanced attributes, patch-level frustum culling, distance density LOD, far clump cards, debug overlays, optional generated meadow density masks, and full disposal.

This example is WebGPU/TSL-first. It imports from `three/webgpu` and `three/tsl`, uses `MeshStandardNodeMaterial`/`MeshBasicNodeMaterial`, and keeps custom rendering in node materials plus compute/storage data.

## Pipeline

1. Bounds checkpoint: `createPatchRecord()` chooses deterministic 16-32 m patch descriptors and expanded local/world bounds. In `bounds` mode you must see one stable box per patch, expanded beyond the blade footprint; if boxes hug the raw patch square, wind/terrain displacement is not in the culling bound.
2. Storage checkpoint: `createStaticStorage()` allocates 16-byte aligned storage groups: `originTerrainHeight`, `widthFacingBendSpecies`, `densitySeedsNormal`, and `colorMaterial`. Diagnostics must list all four names per patch; if a name is missing, material nodes are reading private or mismatched storage.
3. Density checkpoint: `makeStaticInitCompute()` builds one `Fn().compute(count, [128])` dispatch per patch. It writes origin, terrain height, height, width, facing, bend, species trend, clump density, blade seed, terrain-normal XZ, color seed, clump seed, and visibility flags. In `density` mode you must see coherent clumps and paths; if the field is white noise, seed/cell coordinates are drifting.
4. Mask checkpoint: Optional `loadMeadowDensityMask()` loads `../../assets/generated-variants/meadow-density-*.png` as `NoColorSpace` data. With a mask supplied you must see the same authored paths in density and final modes; if colors follow a different pattern than density, the material is using a detached field.
5. Wind checkpoint: `makeGrassMaterial()` consumes the storage via `.toAttribute()` in a shared `MeshStandardNodeMaterial`. `positionNode` keeps roots anchored while folding blades with bend, wind, terrain tilt, and camera-facing yaw. In `wind` mode you must see tip-weighted gust/chop with fixed roots; if roots slide, the deformation is not weighted by blade UV from base to tip.
6. Runtime checkpoint: `update()` changes only wind time, debug mode, patch visibility, instance counts, and LOD uniforms. Validation must report `perFrameComputeDispatches: 0`; if this increases in vertex-wind mode, static blade/clump/species data is being regenerated.
7. LOD checkpoint: `updatePatchCullingAndLOD()` tests expanded patch bounds against the camera frustum before draw submission. In `lod` mode you must see near/mid/far colors by patch; if every patch remains near-tier, distance thresholds or camera-space measurement is wrong.
8. Final checkpoint: `makeImpostorMaterial()` switches far patches to clump cards rather than individual blades. In `final` mode you must see dense near grass, reduced mid density, and far cards without a draw-object explosion; if far patches still draw individual blades, impostor transition is not patch-owned.

## Quality Tiers

| Tier | Patch budget | Blade budget | Runtime budget |
| --- | ---: | ---: | --- |
| `ultra` | 81 patches at 20 m | 18k blades each | 81 init dispatches per streamed region, 0 per-frame compute, vertex-node wind |
| `high` | 49 patches at 20 m | 12k blades each | storage init once, typical 2-12 visible patch draws after culling |
| `medium` | 25 patches at 24 m | 8k blades each | lower visibility and density LOD |
| `low` | 9 patches at 28 m | 3k blades each | native WebGPU minimal render budget |

Static storage target is 64 bytes per blade in this readable example. A production pack can reduce that toward 32 bytes per blade with normalized ranges once visual error is below one pixel.

## Debug Modes

- `final`: authored grass color, density, wind, and PBR response.
- `bounds`: expanded patch bounds for frustum culling.
- `density`: clump/mask density visualization.
- `lod`: patch LOD tier colors, with bounds visible.
- `wind`: gust/chop/root weighting visualization.

## Usage

```js
import { WebGPURenderer } from "three/webgpu";
import {
  createWebGPUDenseGrassSystem,
  loadMeadowDensityMask,
  meadowDensityMaskPaths,
} from "./examples/webgpu-dense-grass/index.js";

const renderer = new WebGPURenderer({ antialias: false });
const densityMaskTexture = loadMeadowDensityMask(meadowDensityMaskPaths.a);

const grass = await createWebGPUDenseGrassSystem(renderer, {
  seed: 7331,
  tier: "high",
  densityMaskTexture,
});

scene.add(grass.object);

function frame(elapsedSeconds) {
  grass.update({ elapsed: elapsedSeconds, camera });
  renderer.render(scene, camera);
}

grass.setDebugMode("lod");
// ...
grass.dispose();
densityMaskTexture.dispose();
```

The CPU-filled static storage path is teaching material only for cases where
the user explicitly asks how to apply fallback when WebGPU is unavailable. It
is not a default route or a separate primary implementation path. In that
requested fallback case, if `renderer.backend.isWebGPUBackend` is false after
`renderer.init()`, the example fills deterministic storage on the CPU and keeps
the same node-material rendering surface.
