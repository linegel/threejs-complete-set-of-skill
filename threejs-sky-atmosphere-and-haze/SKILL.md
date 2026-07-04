---
name: threejs-sky-atmosphere-and-haze
description: Implement maximum-performance sky, atmosphere, and haze systems in latest Three.js with WebGPURenderer, TSL, NodeMaterial, RenderPipeline, compute-generated scattering LUTs, depth-aware aerial perspective, sun/moon discs, and atmosphere-aware lighting.
---

# Sky, Atmosphere, and Haze

Throughput is won by architecture before code. The taught path is latest
Three.js `WebGPURenderer` from `three/webgpu`, TSL from `three/tsl`,
`NodeMaterial` materials, node `RenderPipeline`, and compute-generated
Hillaire/Bruneton-family scattering LUTs sampled by cheap nodes per pixel.

Read [references/atmosphere-system-contract.md](references/atmosphere-system-contract.md)
before implementation. It defines the LUT contracts, capability gate, quality
tiers, budgets, color/output ownership, depth contract, diagnostics, and the
techniques replaced by the WebGPU/TSL architecture.

Canonical implementation contract: `examples/webgpu-lut-atmosphere/`.
Run `node examples/webgpu-lut-atmosphere/validation.js` after edits.

Legacy WebGL implementation (deprecated, do not extend): `examples/lut-aerial-perspective/atmosphere-effect.js`.

## Required Architecture

Lead with precomputed scattering, not per-pixel full scattering integration:

```text
atmosphere parameters + planet/ellipsoid transform
  -> compute transmittance LUT
  -> compute multiscatter / irradiance LUTs
  -> compute sky-view LUT for the active camera/sun frame
  -> compute aerial-perspective froxel volume for view depth ranges
  -> scene pass() with shared color/depth ownership
  -> TSL sky and aerial-perspective nodes sample LUTs
  -> one HDR RenderPipeline output path
```

This architecture amortizes expensive optical-depth integration into compute
dispatches and replaces nested view/light marches in every visible pixel with
texture lookups, segment transmittance, and depth-aware composition.

## Build Order

1. Run `$threejs-choose-skills` preflight when atmosphere touches terrain,
   clouds, shadows, exposure, or post ownership.
2. Define one atmosphere model shared by sky, aerial perspective, sun/moon
   discs, material irradiance, and lighting: radii, density profiles,
   coefficients, sun direction, exposure scale, and unit conversion.
3. Initialize `WebGPURenderer`, call `await renderer.init()`, and choose a
   quality tier through the capability gate. The reduced tier uses smaller or
   precomputed LUTs, not a parallel renderer.
4. Generate LUTs with TSL `Fn().compute(count)` dispatches through
   `renderer.compute()` or `renderer.computeAsync()`. Write into
   `StorageTexture` resources with `textureStore()` and treat LUTs as
   `NoColorSpace` data.
5. Use `RenderPipeline`, `pass()`, `mrt()` when the host image chain needs
   shared color/depth/normal/velocity signals, and `PassNode.getLinearDepthNode()`
   or `getViewZNode()` for the aerial-perspective depth contract.
6. Compose sky radiance and surface-segment transmittance/inscattering with
   TSL nodes. Keep output scene-linear HDR until the single tone-map and output
   color transform owner.
7. Validate LUT dimensions, units, byte counts for imported assets, depth mode,
   planet intersections, camera altitude, and fixed sun/camera screenshot cases
   before tuning color.

Use the canonical validation module for Phase 1 hard gates:

```sh
node examples/webgpu-lut-atmosphere/validation.js
```

It verifies the LUT manifest, RGBA16F upload policy, unit conversion fixtures,
CPU segment/intersection math, depth-mode helpers, WebGPU/TSL API ownership,
and resource resize/dispose contracts.

## Capability Gate

Any path using compute/storage/MRT must gate after renderer initialization:

```js
await renderer.init();

if ( renderer.backend.isWebGPUBackend ) {
  // Full tier: compute-generated LUTs, storage textures, MRT/depth sharing.
} else {
  // Reduced tier: smaller grids, offline/precomputed LUT assets, static sky-view
  // updates, or disabled material irradiance. Do not build a parallel path.
}
```

Quality tiers:

| Tier | Requirements | Defaults |
| --- | --- | --- |
| Ultra desktop-discrete | WebGPU backend with generous storage budget | 256x64 transmittance, 64x32 multiscatter/irradiance, 192x108 sky-view, 32-64 aerial froxel slices, optional temporal update split |
| High desktop-discrete/integrated | WebGPU backend with moderate storage budget | 256x64 transmittance, 128x64 sky-view, 24-32 froxel slices, update sky-view when sun/camera frame changes |
| Default mobile/tiled | WebGPU backend with tight bandwidth | 128x32 transmittance, 96x48 sky-view, 16-24 froxel slices, lower-frequency multiscatter refresh |
| Reduced backend tier | Non-WebGPU backend selected by `WebGPURenderer` | precomputed LUT assets, smaller grids, static sky-view, no live froxel compute |

## Required Outputs

- sky radiance and sun/moon disc transmittance/color;
- camera-to-surface segment transmittance;
- camera-to-surface segment inscattering;
- optional sky irradiance for `MeshStandardNodeMaterial` or
  `MeshPhysicalNodeMaterial` lighting integration;
- explicit conversion between render units and atmosphere meters/kilometers;
- diagnostics for LUT coordinates, slices, intersections, depth class, and
  shell/post blend.

## Budgets

Start with these budgets, then measure on target hardware:

| Target | Atmosphere cost | LUT memory target | Per-frame work |
| --- | ---: | ---: | --- |
| Desktop discrete 1440p | 0.4-1.2 ms | 8-24 MB | sky-view plus aerial froxel updates as needed |
| Desktop integrated 1080p | 0.7-1.8 ms | 4-14 MB | staggered LUT refresh, 24-32 froxel slices |
| Mobile/tiled 720p-900p | 0.8-2.5 ms | 2-8 MB | static/precomputed base LUTs, 16-24 froxel slices |

Do not spend full-resolution nested optical-depth marches per pixel. Every
enabled tier must state texture dimensions, storage formats, dispatch counts,
render resolution, update cadence, draw calls, GPU time, and resize/disposal
behavior.

## Color And Output

- LUTs, density masks, depth, normals, weather inputs, and optical-depth data
  are `NoColorSpace` linear data. Albedo/color art textures use
  `SRGBColorSpace`.
- Atmosphere radiance enters the image chain as scene-linear HDR. Use
  `HalfFloatType` working buffers until tone mapping.
- Exactly one system owns tone mapping and one system owns output color
  conversion. Prefer the host `RenderPipeline` `outputColorTransform`; use
  `renderOutput()` only when display-referred nodes intentionally run after
  conversion.
- Exposure can scale physically authored radiance, but it must not hide wrong
  units, coefficients, or transmittance.

## Failure Conditions

- sky and terrain haze use different sun directions, coefficients, radii, or
  unit conversions;
- per-pixel nested view/light marching is used as the primary production path;
- aerial perspective is a uniform fog color or transparent sphere;
- camera altitude is measured in a local flat frame during orbital/geospatial
  motion;
- depth reconstruction ignores standard, reversed, logarithmic, orthographic,
  MSAA-resolved, or sky-pixel cases used by the host renderer;
- direct sun, sky irradiance, segment transmittance, and inscattering are
  collapsed into one color;
- tone mapping or output color conversion happens more than once;
- atmosphere fades abruptly at shell entry or switches ownership without a
  validated transition.

## Routing Boundary

This skill owns molecular/aerosol sky scattering, sun/moon transmittance,
material sky irradiance, and depth-based surface-segment aerial perspective.
Use `$threejs-image-pipeline` for whole-frame HDR/depth/MRT ownership,
`$threejs-exposure-color-grading` for metering and tone mapping,
`$threejs-volumetric-clouds` for weather-shaped cloud density and cloud
shadows, `$threejs-procedural-planets` for planet terrain/material fields, and
`$threejs-visual-validation` for fixed-view diagnostics and GPU timing evidence.
