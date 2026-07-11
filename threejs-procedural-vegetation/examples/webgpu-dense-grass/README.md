# WebGPU Dense Grass

Canonical source scaffold for `threejs-procedural-vegetation`: spatial patches,
one-time TSL storage initialization, instanced geometry without per-instance
matrices, patch frustum culling, density LOD, far clump cards, debug views, and
disposal. It is not GPU-performance or visual-acceptance evidence. The package
validator exercises source/configuration contracts; it does not compile the TSL
graph on a WebGPU adapter or read initialized storage back from the GPU.

The example requires an initialized r185 `WebGPURenderer`. It has no alternate
backend path. `renderer.compute()` queues each initialization dispatch after
`renderer.init()`; neither `compute()` nor `computeAsync()` is a GPU-completion
fence.

## Data And Draw Architecture

1. `createPatchRecord()` produces stable integer patch coordinates, a u32 patch
   seed, and conservative local/world bounds expanded for terrain and wind.
2. Four `vec4` storage arrays hold origin/terrain/height,
   width/facing/bend/species, density/phase/terrain-normal XZ, and material
   variation/visibility. Their logical payload is exactly 64 bytes per blade.
3. `makeStaticInitCompute()` issues one `Fn().compute(count, [128])` node per
   patch. It writes static placement once. Runtime wind is vertex-node work, so
   this implementation declares zero per-frame compute dispatches.
4. Blade and card draws use `Mesh` with `InstancedBufferGeometry`. The storage
   nodes reconstruct placement, so allocating unread identity `instanceMatrix`
   buffers would add bandwidth and memory while also risking zero-matrix normal
   transforms.
5. `updatePatchCullingAndLOD()` rejects whole patches, changes
   `geometry.instanceCount`, and selects blade or card representation. Two draw
   objects are allocated per patch, but blade and card visibility are mutually
   exclusive, so final rendering submits at most one vegetation representation
   per visible patch. Bounds helpers add diagnostic-only draws.
6. `makeGrassMaterial()` consumes the same density and variation fields for
   placement, color, wind phase, and LOD thinning. `positionNode` weights bending
   by blade UV so the root remains fixed.
7. Optional meadow masks are `NoColorSpace` data textures. Density and final
   diagnostic views must show the same mask topology.

## Deterministic Integer Hash Contract

`DENSE_GRASS_HASH_CONTRACT` specifies one lowbias32-style mixer:

- all arithmetic is u32 wraparound;
- blade keys are `{patchSeed, instanceIndex}`;
- clump keys are `{globalSeed, integerClumpCellX, integerClumpCellZ}`;
- independent random channels use an integer lane and the fixed
  `0x9e3779b9` step;
- conversion to `[0, 1)` takes the upper 24 bits and multiplies by `2^-24`,
  avoiding the `u32 -> f32` rounding that can otherwise map large hashes to
  exactly `1`;
- negative clump coordinates are converted through signed `i32` and bitcast to
  `u32` in TSL, matching JavaScript bit semantics.

The JavaScript validator gates fixed CPU vectors and the presence of the same
TSL multipliers, shifts, bit operations, typed u32 uniforms, and keys. Exact
CPU↔GPU parity remains unproven until a real WebGPU run reads representative
storage records back and compares them with the CPU oracle. No `sin/fract`
pseudo-random hash is used for placement.

## Derived Source Workloads

These are arithmetic consequences of the presets, not device recommendations
or measured budgets. Logical storage excludes geometry, textures, render
targets, allocator padding, staging, and driver residency.

| Tier | Patches | Blades/patch | Blades | Init dispatches | Allocated draw objects | Final representation submit ceiling | Logical static storage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `ultra` | 81 | 18,000 | 1,458,000 | 81 | 162 | 81 | 93,312,000 B |
| `high` | 49 | 12,000 | 588,000 | 49 | 98 | 49 | 37,632,000 B |
| `medium` | 25 | 8,000 | 200,000 | 25 | 50 | 25 | 12,800,000 B |
| `low` | 9 | 3,000 | 27,000 | 9 | 18 | 9 | 1,728,000 B |

Choose a preset only after measuring the complete scene on the target workload.
For constrained targets, first reduce visible patch submission, projected alpha
coverage, shadow representation, and hot storage traffic. A smaller label is
not evidence that a tier fits a device.

## Required Visual Checks

- `bounds`: stable expanded patch boxes; displaced tips stay inside.
- `density`: coherent seeded clumps and optional mask paths, not white noise.
- `lod`: patch-owned transitions with hysteresis/dwell added by the host when
  the fixed thresholds visibly pop.
- `wind`: tip-weighted motion with stationary roots and matching shadow
  deformation.
- `final`: near blades, reduced mid density, and far cards preserve the declared
  silhouette/error contract.

These are acceptance requirements, not claims that the repository currently
contains qualifying captures.

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
