---
name: threejs-volumetric-clouds
description: Implement maximum-performance volumetric cloud systems in latest Three.js with WebGPURenderer, TSL, NodeMaterial, node RenderPipeline passes, compute/storage textures, temporal reprojection, cloud shadows, and scalable quality tiers.
---

# Volumetric Clouds

Cloud throughput is won by architecture before code details: march fewer pixels,
march only occupied volume, amortize with temporal reprojection, and carry enough
depth/velocity data to reject bad history. The taught path is latest Three.js
with `WebGPURenderer` from `three/webgpu`, TSL from `three/tsl`, node materials,
compute/storage resources, and a node `RenderPipeline`.

Read [references/weather-volume-and-reconstruction.md](references/weather-volume-and-reconstruction.md)
before implementing or auditing the cloud system.

Active canonical implementation contract:
`examples/webgpu-weather-volume-clouds/`. It is the WebGPU/TSL-only active path
for new work, includes `validateCloudConfig()`, asset-manifest checks, cloud
shadow/temporal/composite ownership modules, and must pass
`node examples/webgpu-weather-volume-clouds/validation.js` after edits.

Legacy WebGL implementation (deprecated, do not extend): `examples/weather-volume-clouds/`.

## Build Order

1. Start with the performance architecture: half-resolution high tier or
   quarter-resolution default tier bounded raymarch, blue-noise first-sample
   offset, transmittance early exit, adaptive step length, cloud shadow map in
   the same update chain, temporal reprojection with velocity and depth
   rejection, then depth-aware upsample to full resolution in the node pipeline.
2. Initialize one `WebGPURenderer`, call `await renderer.init()`, and route
   compute/storage tiers through a capability gate:

```js
await renderer.init();

if (renderer.backend.isWebGPUBackend) {
  // compute/storage volumetric path
} else {
  // reduced-quality tier: precomputed assets, lower resolution, static shadows
}
```

3. Use `RenderPipeline`, `pass()`, `mrt()`, `PassNode.setResolutionScale()`,
   `renderOutput()`, and `outputColorTransform` ownership for the host image
   chain. Keep one tone-map owner and one output transform owner.
4. Produce cloud work in TSL `Fn().compute(count)` dispatches through
   `renderer.compute()` or `renderer.computeAsync()`. Write current cloud
   radiance/transmittance, representative depth, velocity, history, and compact
   shadow data into `StorageTexture`/`Storage3DTexture` resources with
   `textureStore()`/`storageTexture()`.
5. Feed the full-resolution composite as linear HDR cloud radiance plus
   transmittance into the host `RenderPipeline`; combine with scene color before
   the single output transform.

## Required Architecture

- Weather-shaped density uses packed 2D weather fields plus 3D base/detail
  fields. Keep the four-layer vector model until after per-layer altitude,
  profile, shape, and detail controls.
- Ray intervals come from cloud shell bounds and opaque scene depth. Never scale
  primary cost with camera far distance when the view only crosses a thin cloud
  layer.
- Primary march runs at reduced resolution, uses spatiotemporal blue-noise
  offset, skips packed empty altitude gaps, increases step length through empty
  or low-density space, and terminates on transmittance.
- Temporal reconstruction is velocity/depth aware. Same-UV history blending is
  not accepted because it loses the 4-16x amortization that makes the reduced
  march viable under camera motion.
- Cloud shadows are a separate compact optical-depth product, not a reuse of the
  beauty march. Update shadows on their own cadence and feed lighting lookups
  from that representation.
- Upsampling is depth-aware and edge-aware in the node pipeline, not a blind
  stretch. Prefer `TRAANode` when the host scene also needs temporal AA; custom
  cloud reprojection must still provide representative depth and velocity.

## Quality Tiers And Budgets

| Tier | March scale | Primary steps | Light steps | Shadow maps | Target cost |
| --- | ---: | ---: | ---: | --- | --- |
| Ultra desktop-discrete | 1/2 linear | 96-160 | 6-8 | 3x 768-1024 | 2.5-4.0 ms |
| High desktop-discrete | 1/2 linear | 72-120 | 4-6 | 3x 512 | 1.8-3.0 ms |
| Default integrated/mobile | 1/4 linear | 48-80 | 3-4 | 2x 256-384 | 1.0-2.0 ms |
| Reduced backend tier | 1/4-1/8 linear | 24-48 or precomputed | 1-2 | static/precomputed | 0.5-1.2 ms |

Budgets assume one cloud layer stack, one depth-aware upsample, one temporal
resolve, and one shadow update amortized over 2-8 frames. Keep storage memory
explicit: quarter-linear 1920x1080 current+history RGBA16F is about 4 MB per
buffer; representative depth/velocity and rejection masks should stay below the
cloud color history footprint. Shadow cascades are the largest fixed cost: a
512x512 RGBA16F cascade is about 2 MB.

## Required Controls

- coverage, cloud type, precipitation, and anvil bias;
- base/top altitude and vertical density profile per active layer;
- shape/detail scales, erosion, and height-dependent detail policy;
- independent wind for weather, shape, detail, and turbulence fields;
- primary step count, adaptive step limits, light step count, and empty-space
  policy;
- temporal alpha, velocity limit, depth rejection, variance-clipping width, and
  history reset causes;
- cloud-shadow extent, cascade count, resolution, update cadence, and compact
  channel layout;
- debug mode for each density, march, temporal, and shadow stage.

## Color And Output

- Color textures use `SRGBColorSpace`. Weather, noise, masks, depth, velocity,
  LUTs, and shadow optical-depth data use `NoColorSpace`/linear sampling.
- HDR cloud current/history/composite buffers use `HalfFloatType` until the
  pipeline tone maps.
- The cloud material/effect must not apply its own output conversion. The host
  `RenderPipeline` owns output conversion with `outputColorTransform` or an
  explicit `renderOutput()` node.
- Generated volume textures use deterministic seeds, documented dimensions,
  channel semantics, wrap/filter policy, and mip policy. Regenerate them only
  when their recipe changes.

## Failure Conditions

- density is only procedural noise evaluated at position;
- the raymarch traverses the full camera range instead of bounded shell/depth
  intervals;
- detail noise adds density instead of eroding shaped masses by height;
- temporal history is accepted without velocity and depth rejection;
- history is reset on ordinary camera motion instead of reprojected;
- shadows use the full beauty march or update every pixel every frame;
- every layer shares the same wind, altitude profile, and density controls;
- output is tone mapped or color-converted more than once.

## Routing Boundary

Use `$threejs-choose-skills` for preflight when the task spans several rendering
systems. Use `$threejs-sky-atmosphere-and-haze` for molecular/aerosol
scattering without weather density, `$threejs-image-pipeline` for whole-frame
HDR/post ownership, `$threejs-exposure-color-grading` for tone mapping and LUT
policy, and `$threejs-scalable-real-time-shadows` when terrain/scene shadows need CSM or
tiled shadow integration. This skill owns weather-shaped cloud volumes,
temporal reconstruction, cloud lighting, and cloud optical-depth shadows.
