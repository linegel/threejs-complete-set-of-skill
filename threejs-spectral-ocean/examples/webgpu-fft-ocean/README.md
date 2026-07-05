# WebGPU FFT Ocean

Canonical WebGPU/TSL implementation for `threejs-spectral-ocean`.

This example demonstrates a deterministic multi-cascade FFT ocean with:

- JONSWAP/TMA directional spectrum and coordinate-stable Gaussian seeds.
- Hermitian-packed `h0(k), conj(h0(-k))` generation in a TSL compute kernel.
- Per-frame frequency-domain evolution of four packed complex fields:
  - horizontal displacement X/Z
  - height and cross derivative
  - height slopes X/Z
  - horizontal derivatives XX/ZZ
- Ordered Cooley-Tukey inverse FFT stages over `StorageTexture` ping-pongs with precomputed butterfly and bit-reversal textures.
- Jacobian whitecap detection and persistent foam history in the compute chain.
- `MeshStandardNodeMaterial` ocean shading with displacement, derivative normals, foam, absorption-colored body response, and shared TSL sky radiance.

## Pipeline

```text
WebGPURenderer.init() + backend gate
  -> validateOceanConfig()
  -> choose quality tier
  -> create disjoint cascade descriptors
  -> compute h0 + debug seed/spectrum/mask textures
  -> per frame:
       submit one ordered compute-node array per cascade:
         evolve four packed frequency fields
         bit-reverse X for all fields
         horizontal FFT stages 0..log2(N)-1
         bit-reverse Y for all fields
         vertical FFT stages 0..log2(N)-1
         center spectrum, assemble displacement/derivatives/Jacobian/foam
       render MeshStandardNodeMaterial through RenderPipeline
```

Independent packed fields are batched at the same stage only when they own disjoint source/scratch textures. The next stage is submitted after the previous whole-grid write boundary completes.

## Quality Tiers

| Tier | Resolution | Cascades | Storage Budget | Target |
| --- | ---: | ---: | ---: | --- |
| `ultra` | 512² | 3 | about 102 MiB, gated at 104 MiB | desktop discrete |
| `high` | 256² | 3 | under 28 MiB | desktop integrated |
| `medium` | 256² | 2 | under 22 MiB | balanced |
| `low` | 128² | 1 | under 8 MiB | mobile or budgeted WebGPU preview |

The canonical path requires WebGPU. On a non-WebGPU backend, throw with a
routing message to `threejs-compatibility-fallbacks`; do not build or document a
reduced fallback tier inside this skill.

## Contract Validation

Run:

```bash
npm --prefix threejs-spectral-ocean/examples/webgpu-fft-ocean run validate
```

This validates FFT fixtures, spectrum physics checks, the `[5,17,250]` cascade
counterexample, missing-requirement reasons, source-level contract rails, and
storage accounting against the declared tier budget. It also validates the
CPU water-height sampler against a full pure-JS spectral mirror at fixed probe
points/times. In Node, GPU readback reports `pending-browser-webgpu`; in a
WebGPU browser, small readback fixtures for `createBitReverseNode()`,
`createFftStageNode()`, and assembly run before `initialized = true`.

## CPU Coupling Query

Use `createCpuWaterHeightSampler(config)` when another skill needs a water
height, such as creature buoyancy. The sampler consumes the same authored
cascade descriptors, seeded Gaussian `h0`, local/swell spectrum lobes, and
capillary-gravity dispersion as the GPU kernels, then keeps the dominant
frequency bins per cascade:

```js
import { createCpuWaterHeightSampler } from './examples/webgpu-fft-ocean/index.js';

// dominantBinCount is an authored speed/accuracy default; whatever value is
// chosen, estimateTruncationError() computes the exact omitted-coefficient
// bound for it at construction, and validation.js gates the bound (it
// validates at 255 bins so dispersion bugs cannot hide under truncation).
const sampler = createCpuWaterHeightSampler({ quality: 'high', dominantBinCount: 32 });
const surfaceY = sampler.getWaterHeight(worldX, worldZ, timeSeconds);
const parity = sampler.estimateTruncationError();
```

The parity model is a coefficient truncation bound:

```text
|height_full - height_truncated| <= sum_{omitted bins} (|h0(k)| + |h0(-k)|)
```

This is the pack coupling-interface template: expose a CPU-evaluable query of
the same authored cause, state the parity error, keep the data flow one-way,
and never use hot-path GPU readback for cross-skill coupling.

## Debug Modes

`final`, `height`, `displacement`, `slopes`, `jacobian`, `foam`, `normal`

`ocean.getDebugTextures()` also exposes capability tier data, butterfly/bit-reversal tables, Gaussian seed field, spectrum/mask textures, evolved packed fields, displacement, derivatives, Jacobian, and foam history.

## Minimal Usage

```js
import {
  createOceanMesh,
  createOceanRenderer,
  createOceanRenderPipeline,
  createOceanSurfaceMaterial,
  createWebGPUFftOcean,
} from './examples/webgpu-fft-ocean/index.js';

const { renderer, isWebGPUBackend } = await createOceanRenderer();
if (!isWebGPUBackend) throw new Error('WebGPU backend required for the canonical FFT ocean path.');

const ocean = await createWebGPUFftOcean(renderer, {
  quality: 'high',
  seed: 0xdecafbad,
});
const material = createOceanSurfaceMaterial(ocean.materialCascades);
const mesh = createOceanMesh(material, { sizeMeters: 400, segments: 384 });
scene.add(mesh);

const pipeline = createOceanRenderPipeline(renderer, scene, camera);
const validation = ocean.validate();
if (!validation.pass) throw new Error(JSON.stringify(validation.selfTests.errors));

function frame(timeMs) {
  const time = timeMs / 1000;
  ocean.update(time, 1 / 60).then(() => pipeline.render());
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

## Budgets

Dispatch estimate per frame:

```text
cascades * (
  4 evolve dispatches
  + 4 packed fields * (2 bit-reversals + 2 * log2(N) FFT stages)
  + 1 assembly/history dispatch
)
```

The `high` tier at 256² and 3 cascades runs 3 * (4 + 4 * (2 + 16) + 1) = 231 compute nodes before the render pipeline. Each cascade submits those nodes as one ordered `renderer.computeAsync()` array; Three.js iterates the array in order, so ping-pong FFT dependencies are preserved without per-stage awaits.
