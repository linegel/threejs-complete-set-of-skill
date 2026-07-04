---
name: threejs-spectral-ocean
description: Build large procedural oceans in latest Three.js with WebGPURenderer, TSL compute FFT cascades, StorageTexture ping-pongs, NodeMaterial shading, node post pipelines, multi-cascade wavelength bands, clear-water optics, above/below surface rendering, spectral derivatives, Jacobian whitecaps, temporal foam, analytic sky reflection, underwater absorption, crest scatter, and GPU validation.
---

# Spectral Ocean

Treat an ocean as a sampled stochastic wave field whose highest-throughput implementation is owned in frequency space. Start from compute-shader FFT cascades, not analytic wave piles, scrolling textures, or a simplified renderer path.

Run `$threejs-choose-skills` first when the request spans ocean simulation plus atmosphere, shadows, validation, or final-image treatment. Read [references/spectral-cascade-ocean-system.md](references/spectral-cascade-ocean-system.md) before implementing or auditing this skill.

Canonical WebGPU/TSL example: [examples/webgpu-fft-ocean/](examples/webgpu-fft-ocean/).

## Build Order

1. Create a `WebGPURenderer` from `three/webgpu`, initialize it, and install the capability gate before allocating compute resources.
2. Choose the quality tier from grid size, cascade count, dispatch budget, texture memory, and target GPU class.
3. Build disjoint wavelength cascades from a deterministic directional spectrum.
4. Generate coordinate-stable Gaussian seeds and conjugate-packed `h0(k)` for every cell before masking out-of-band energy.
5. Evolve height, horizontal displacement, slopes, horizontal derivatives, and cross derivatives in frequency space with TSL `Fn().compute()` kernels.
6. Pack derivative fields before the inverse transform; never derive slopes or Jacobians with finite differences after the IFFT.
7. Run Stockham or Cooley-Tukey inverse FFT stages through `StorageTexture` ping-pongs, using `renderer.compute()` or `renderer.computeAsync()` with ordered stage boundaries.
8. Assemble filterable displacement, derivative, Jacobian, and foam-history textures in the same compute dispatch chain.
9. Shade the displaced mesh with a `MeshStandardNodeMaterial` or `MeshPhysicalNodeMaterial` graph driven by the resolved spectral maps.
10. Compose reflections, underwater absorption, crest scatter, optional `BloomNode`/`GTAONode`/`TRAANode`, and output conversion in a `RenderPipeline`.
11. Expose diagnostics for spectra, transformed fields, foam history, node-pass outputs, and GPU timings.

Legacy WebGL implementation (deprecated, do not extend): `examples/spectral-cascade-ocean/`, `examples/hybrid-clear-water-ocean/`, `examples/stylized-above-below-ocean/`.

## Capability Gate

Use one implementation path: WebGPU-backed TSL compute. If that canonical path
is unavailable, report the missing backend as a blocker unless the user
explicitly asks how to apply fallback when WebGPU is unavailable.

```js
import { WebGPURenderer } from 'three/webgpu';

const renderer = new WebGPURenderer( { antialias: false } );
await renderer.init();

if ( renderer.backend.isWebGPUBackend ) {
  await ocean.allocateStorageTextures();
  await renderer.computeAsync( ocean.validateFftNodes );
} else {
  throw new Error( 'WebGPU backend required for the canonical FFT ocean path.' );
}
```

Budgeted WebGPU tiers use smaller grids, fewer cascades, or lower-resolution
debug input fixtures inside the canonical architecture. They must not contain a second
hand-written renderer backend. If, and only if, the user explicitly asks how to
apply fallback when WebGPU is unavailable, route that teaching to
`$threejs-compatibility-fallbacks`.

## Non-Negotiable Gates

- Require power-of-two grids, positive patch lengths, disjoint wavenumber intervals, finite depth/gravity values, and a supported storage texture format before construction.
- Validate DC, X-frequency, Y-frequency, horizontal-displacement direction, derivative sign, and Jacobian determinant before connecting the spectrum to the surface.
- Keep Gaussian samples coordinate-stable: hash by `(seed, cascade, x, y)` or consume random values for every cell before masking.
- Compute all displacement derivatives in frequency space: slopes, horizontal derivatives, and the cross derivative are transformed fields, not post-IFFT differences.
- Persist foam as simulation state in a ping-ponged storage texture; display thresholds are separate from history recovery.
- Submit FFT stages with ordered whole-grid boundaries verified against the active Three.js backend; batch independent fields at the same stage, then advance.
- Share sun, sky, exposure, and output-conversion ownership across the sky, ocean reflection, underwater path, and post pipeline.
- Keep fixed seeds, fixed camera captures, no-post baselines, and GPU timing history for comparisons.

## Budgets

- High desktop discrete: `512^2`, 3 cascades, 4 packed complex fields per cascade, about `3 * (8 evolve + 4 * 2 * log2(N) FFT + 4 assemble/history)` compute dispatch groups, about 102 MiB ocean storage with a 104 MiB tier gate, target 2.5-4.0 ms simulation and 1.5-3.0 ms ocean shading/post at 1440p.
- Standard desktop integrated: `256^2`, 3 cascades, half-float storage when validated, under 28 MiB ocean storage, target 1.5-3.0 ms simulation and 1.5-2.5 ms shading/post at 1080p.
- Mobile or budgeted WebGPU tier: `128^2`, 1-2 cascades and lower-resolution debug inputs, under 8 MiB ocean storage, target under 2.0 ms simulation-equivalent work and no spray.
- Draw calls: one ocean surface draw, one sky draw, optional spray/crest instancing only when routed through `$threejs-particles-trails-and-effects`.
- Post passes: one scene `pass()`, optional `mrt()` for normal/emissive outputs, reduced-resolution `BloomNode` or `GTAONode` only when visibly useful, one output transform.

## Color And Output

- Color textures use `SRGBColorSpace`; spectra, displacement, derivative, Jacobian, foam, normal, noise, LUT, and weather data use `NoColorSpace` or linear data semantics.
- Keep ocean simulation textures as data, with mipmaps disabled unless the compute chain writes them deliberately.
- Use HDR `HalfFloatType` working buffers until tone mapping.
- The `RenderPipeline` owns tone mapping and color conversion through `outputColorTransform` or an explicit `renderOutput()` node. Materials and custom nodes must not double-convert.
- `PostProcessing` is only a renamed predecessor of `RenderPipeline`; do not use it for new work.

## Route Elsewhere

- Use `$threejs-water-optics` for bounded pools, screen-space refraction, local heightfield ripples, shoreline absorption, caustics, and analytic wave surfaces.
- Add `$threejs-particles-trails-and-effects` only when crest spray, splashes, foam particles, or interaction effects are required.
- Add `$threejs-visual-validation` for fixed-view contracts, cross-seed sweeps, temporal stability, pass diagnostics, and GPU evidence.
- Add `$threejs-image-pipeline` or `$threejs-exposure-color-grading` when the ocean must share a larger HDR, bloom, exposure, or grading stack.
