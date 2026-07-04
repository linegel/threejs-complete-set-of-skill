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

The canonical path requires WebGPU. The static fallback-teaching branch is only
for the explicit request to apply fallback when WebGPU is unavailable; it does
not create a parallel shader renderer and leaves dynamic FFT disabled.

## Contract Validation

Run:

```bash
npm --prefix threejs-spectral-ocean/examples/webgpu-fft-ocean run validate
```

This validates FFT fixtures, spectrum physics checks, the `[5,17,250]` cascade
counterexample, missing-requirement reasons, and storage accounting against the
declared tier budget. It also asserts that GPU readback fixtures for
`createBitReverseNode()`, `createFftStageNode()`, and assembly remain required
for browser acceptance; Node validation reports that gate as
`pending-browser-webgpu`, never as passed.

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

The `high` tier at 256² and 3 cascades submits 3 * (4 + 4 * (2 + 16) + 1) = 231 compute nodes before the render pipeline. Independent field stages are batched by `renderer.computeAsync()` arrays to keep stage ordering explicit.
