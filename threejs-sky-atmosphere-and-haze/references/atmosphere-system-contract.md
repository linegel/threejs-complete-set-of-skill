# Atmosphere System Contract

Use this contract to build a maximum-performance WebGPU/TSL atmosphere that
keeps sky, aerial perspective, material irradiance, coordinate transforms,
depth, and output ownership coherent.

## Architecture First

The production architecture is a precomputed scattering LUT system generated on
the GPU, then sampled by cheap TSL nodes:

```text
shared atmosphere parameters
  -> transmittance StorageTexture
  -> multiscatter / irradiance StorageTexture set
  -> sky-view StorageTexture for current sun/camera frame
  -> aerial-perspective froxel StorageTexture atlas or sliced texture set
  -> RenderPipeline scene pass depth/color
  -> TSL sky and surface aerial-perspective composition
```

The expensive work is moved into bounded compute dispatches. Visible pixels do
not run nested view and sun optical-depth integration; they reconstruct ray,
depth, and planet position, then sample transmittance, sky-view, multiscatter,
and aerial-perspective froxels.

This replaces the older nested dynamic integration path because it scales with
pixel count and sample product. A 1080p frame with 2 million pixels, 16 view
samples, and 8 light samples implies hundreds of millions of density/phase
evaluations before lighting, while LUT/froxel sampling keeps the per-pixel path
near constant cost and amortizes integration across compact grids.

## Current Three.js API Contract

Use only latest Three.js WebGPU/TSL APIs:

```js
import {
  HalfFloatType,
  NoColorSpace,
  RenderPipeline,
  StorageTexture,
  WebGPURenderer
} from 'three/webgpu';

import {
  Fn,
  mrt,
  pass,
  renderOutput,
  textureStore
} from 'three/tsl';
```

Compute work is authored as TSL `Fn().compute(count)` and submitted with
`renderer.compute()` or `renderer.computeAsync()`. Store LUT values through
`StorageTexture` and `textureStore()`. If a tier uses buffer-backed tables or
instance data, use `StorageBufferAttribute`, `StorageInstancedBufferAttribute`,
and `storage()` nodes.

Compose the final image with one `RenderPipeline`. Build from a `pass( scene,
camera )`; use `mrt()` only for signals that must be shared by atmosphere,
clouds, AO, bloom, temporal resolve, or diagnostics. Use
`PassNode.getLinearDepthNode()` or `PassNode.getViewZNode()` instead of a
duplicate scene render. Use `PassNode.setResolutionScale()` for any reduced
resolution pass.

Historical note: `PostProcessing` was renamed to `RenderPipeline`; new code uses
`RenderPipeline`.

## Capability Gate And Tiers

Gate immediately after initialization:

```js
const renderer = new WebGPURenderer( {
  antialias: false,
  outputBufferType: HalfFloatType
} );

await renderer.init();

if ( renderer.backend.isWebGPUBackend ) {
  // Full tier: live compute/storage LUT generation and RenderPipeline sharing.
} else {
  // Reduced-quality tier: precomputed LUT assets, smaller grids, static
  // sky-view updates, fewer froxel slices, or disabled optional irradiance.
}
```

Reduced quality is a content and resolution choice, not a second implementation.
Load checked LUT assets when live compute/storage is unavailable, and keep the
same runtime node composition.

| Tier | Transmittance | Multiscatter / irradiance | Sky-view | Aerial froxels | Target |
| --- | ---: | ---: | ---: | ---: | --- |
| Ultra desktop-discrete | 256x64 | 64x32 or higher | 192x108 | 32-64 slices | 0.4-1.2 ms at 1440p |
| High desktop/integrated | 256x64 | 32x32-64x32 | 128x64 | 24-32 slices | 0.7-1.8 ms at 1080p |
| Mobile/tiled | 128x32 | 32x16-32x32 | 96x48 | 16-24 slices | 0.8-2.5 ms at 720p-900p |
| Reduced backend | asset-provided | asset-provided | static or asset-provided | 8-16 slices or disabled | 0.3-1.2 ms |

Every tier must publish dispatch counts, workgroup sizes, texture formats,
texture dimensions, update cadence, pass count, draw calls, memory, and GPU
time on representative hardware.

The canonical `examples/webgpu-lut-atmosphere/` schedule uses:

| product | texture | format | workgroup | invalidation | owner |
| --- | --- | --- | --- | --- | --- |
| transmittance | `StorageTexture` | RGBA16F | 8x8x1 | atmosphere profile, unit conversion, solar inputs | shared atmosphere model |
| multiscatter | `StorageTexture` | RGBA16F | 8x8x1 | profile, ground albedo, solar irradiance | sky and aerial perspective |
| irradiance | `StorageTexture` or manifest `DataTexture` | RGBA16F | 8x8x1 | profile, ground albedo, sun direction | material-lighting integration when enabled |
| sky-view | `StorageTexture` | RGBA16F | 8x8x1 | camera altitude, sun direction, planet transform | sky radiance node |
| aerial froxel | `Storage3DTexture` | RGBA16F | 8x8x1 | camera projection, view matrix, depth range | surface segment transmittance and inscattering |

Each product records dispatch dimensions, update cadence, byte cost, and tier
budget in code. Browser/GPU runs must replace the starter budgets with measured
GPU timings.

## Shared Parameter Model

Keep one atmosphere object for sky, aerial perspective, material irradiance,
sun/moon transmittance, and diagnostics. Earth-like defaults:

```text
solar irradiance = (1.474, 1.8504, 1.91198)
sun angular radius = 0.004675 rad
bottom radius = 6,360,000 m
top radius = 6,420,000 m
Rayleigh scattering = (0.005802, 0.013558, 0.0331)
Mie scattering = (0.003996, 0.003996, 0.003996)
Mie extinction = (0.00444, 0.00444, 0.00444)
Mie phase g = 0.8
absorption extinction = (0.00065, 0.001881, 0.000085)
ground albedo = 0.1
```

Density profiles are two-layer functions:

```text
density(h) =
  clamp(
    expTerm * exp(expScale * h)
    + linearTerm * h
    + constantTerm,
    0,
    1
  )
```

The default Rayleigh exponential scale is `-0.125`, Mie `-0.833333`.
Absorption uses two linear layers centered around the ozone region rather than
another ground-heavy exponential.

Preserve one explicit meter-to-render-unit conversion boundary. Provide tested
examples for `1 world unit = 1 meter` and `1 world unit = 1 kilometer`. Do not
let individual materials, nodes, or passes apply their own scale corrections.

## LUT Products

Required products:

- transmittance LUT: optical depth from atmosphere point and sun/view cosine to
  top boundary;
- multiscatter LUT: higher-order scattering approximation shared by sky and
  aerial perspective;
- sky-view LUT: camera-frame sky radiance for current altitude, sun angle, and
  view angle;
- aerial-perspective froxel volume: segment transmittance and inscattering over
  view direction and depth range;
- optional irradiance LUT: material sky-light integration for node materials.

Imported or generated assets must have a manifest with:

```text
dimensions
storage format and channel layout
byte order for binary assets
source atmosphere parameters
radiance units
source algorithm/revision
hashes
mip/filter/wrap policy
color space
```

Use `NoColorSpace`, clamp wrapping, deterministic dimensions, and documented
filtering for LUT/data textures. Use `HalfFloatType` or a measured smaller data
format only when precision tests pass against fixed camera/sun cases.

## Compute Generation Order

1. Validate atmosphere parameters, unit scale, and radii on the CPU.
2. Dispatch transmittance integration. This is a compact 2D grid and updates
   only when the atmosphere profile changes.
3. Dispatch multiscatter and irradiance. Update when profile, ground albedo, or
   solar inputs change.
4. Dispatch sky-view for current camera altitude, sun direction, and quality
   tier. Update on sun/camera frame changes or stagger when motion permits.
5. Dispatch aerial-perspective froxels for the current camera, projection,
   depth range, and planet transform. Use logarithmic or cascade-like depth
   distribution so near haze and horizon depth both have resolution.
6. Compose in the render pipeline from scene color and pass depth. The
   full-resolution TSL composition node samples LUTs and froxels; it does not
   integrate atmosphere.

Use bounded ray/segment math inside compute kernels: one ray advance per loop,
transmittance early exit, explicit ground/sun occlusion, and fixed iteration
budgets per tier. Expensive updates are split by invalidation cause rather than
recomputed every frame.

## Ellipsoid And Depth Ownership

The geospatial path defaults to WGS84-style ellipsoid math and can correct both
camera altitude and geometry error. Atmosphere altitude is therefore not
`worldPosition.y`.

Required coordinate contract:

```text
world position
  -> world-to-ECEF
  -> ellipsoid-relative position
  -> corrected altitude
  -> LUT coordinates / segment scattering
```

The render pipeline owns one depth signal. The atmosphere reads the host pass
depth as linear depth or view Z via the pass node helpers and applies the same
projection mode as the scene. Explicitly test:

- standard perspective depth;
- reversed depth;
- logarithmic depth;
- orthographic depth;
- MSAA-resolved depth;
- sky pixels with no surface depth;
- clipped surfaces outside the atmosphere shell.

Depth helpers used by the canonical example:

```js
standard perspective: perspectiveDepthToViewZ(depth, near, far)
reversed depth: perspectiveDepthToViewZ(1.0 - depth, near, far)
logarithmic depth: logarithmicDepthToViewZ(depth, near, far, logDepthBufFC)
orthographic depth: orthographicDepthToViewZ(depth, near, far)
MSAA: resolve the host depth once before atmosphere sampling
sky pixel: explicit no-surface mask, depth >= 0.999999, or reversed depth <= 0.000001
```

In TSL, prefer `PassNode.getLinearDepthNode()` or `PassNode.getViewZNode()`
from the scene pass. Do not render a duplicate depth pass for atmosphere.

The aerial-perspective node may consume normals or a light mask only when it is
relighting surfaces. Do not require normals for pure transmittance and
inscattering composition.

## Sky, Surface, And Lighting Composition

The sky path reconstructs view rays from camera matrices and samples the
sky-view LUT. It draws sun/moon discs with transmittance and angular radius
from the shared parameter model. Lunar lighting may be authored as a separate
irradiance source, but it must use the same depth/output contract.

The surface path reads scene color and depth, reconstructs the visible segment
through the atmosphere, and applies:

```text
compositedColor =
  sceneColor * segmentTransmittance
  + segmentInscattering
```

Direct sun light, sky-light relighting, cloud shadows, terrain shadows, and
material irradiance are separate signals. Do not collapse them into one fog
color. Feed material sky irradiance into `MeshStandardNodeMaterial` or
`MeshPhysicalNodeMaterial` only after the irradiance LUT is validated; otherwise
mark the integration disabled for that tier.

## Shell/Post Handoff

The preferred production ownership is:

```text
sky pixels: sky-view LUT node
surface pixels: depth-aware aerial-perspective froxel node
limb/edge pixels: validated shell or sky transition node only when needed
```

For ground-to-space cameras, keep a continuous blend across atmosphere entry:

```text
entry blend near = 140 km
entry blend far = max(448 km, visual atmosphere height * 0.58)
post blend = 1 - smoothstep(near, far, altitudeFromTop)
```

The same body center/radii, unit conversion, sun direction, and profile drive
the sky and aerial paths. Do not mix LUT radiance and dynamic integrated
radiance at full weight; choose one owner or validate a transition zone with
diagnostics.

## Color And Output

- Color art textures use `SRGBColorSpace`.
- LUTs, density maps, weather masks, depth, normals, transmittance,
  optical-depth, and diagnostic textures use `NoColorSpace` linear data.
- Atmosphere radiance is scene-linear HDR until the app's single tone-map
  owner. Use `HalfFloatType` for HDR buffers unless a measured tier proves a
  smaller format is acceptable.
- The atmosphere node must not apply display conversion. Let
  `RenderPipeline.outputColorTransform` handle the normal final transform, or
  disable it and call `renderOutput()` when display-referred nodes must execute
  after conversion.
- Exposure belongs to the host camera/image pipeline. It may scale physically
  authored radiance, but it must not compensate for broken units or LUTs.

## Performance Budgets

Texture memory estimates at common sizes:

| Product | Example format | Approx memory |
| --- | --- | ---: |
| 256x64 transmittance RGBA16F | data LUT | 128 KB |
| 192x108 sky-view RGBA16F | per-camera LUT | 162 KB |
| 128x64 sky-view RGBA16F | per-camera LUT | 64 KB |
| 64x32 multiscatter RGBA16F | shared LUT | 16 KB |
| 160x90x32 aerial froxel RGBA16F | froxel atlas/slices | 3.5 MB |
| 320x180x32 aerial froxel RGBA16F | froxel atlas/slices | 14 MB |

Frame budget defaults:

| Target | Compute dispatches | Render passes | Target GPU time |
| --- | ---: | ---: | ---: |
| Desktop discrete | 2-5 active dispatches after cache warmup | 1 scene pass + composition | 0.4-1.2 ms |
| Desktop integrated | 1-4 active dispatches, staggered | 1 scene pass + composition | 0.7-1.8 ms |
| Mobile/tiled | 0-3 active dispatches, many cached | 1 scene pass + composition | 0.8-2.5 ms |
| Reduced backend | 0 live compute dispatches | 1 scene pass + composition | 0.3-1.2 ms |

Warm profile changes may spend more time for transmittance/multiscatter
regeneration, but camera-only movement should update only sky-view and aerial
froxel products. Avoid full-resolution work for the expensive integration.

## Diagnostics And Validation

Expose one diagnostic output at a time:

```text
planet/ECEF coordinates and corrected altitude
top and bottom intersections
Rayleigh, Mie, and absorption density
view and sun optical depth inside compute grids
sun visibility and ground occlusion
segment transmittance
single and multiple scattering
sky versus surface depth classification
shell/post blend
LUT coordinates and texture slices
froxel depth distribution
manifest hash and byte-count checks for imported LUT assets
```

Required tests:

- CPU-equivalent ray/segment intersection tests, including closest-point
  outside-atmosphere cases;
- top-atmosphere miss cases are explicitly guarded before square roots;
- fixed sun/camera screenshots for sea level, mountain altitude, low orbit,
  high orbit, horizon, night side, and shell entry;
- depth reconstruction tests for every enabled projection/depth mode;
- LUT byte-count, format, dimension, channel, hash, and unit checks for
  imported assets;
- timing captures for each quality tier.

Phase 1 hard gate:

```sh
node examples/webgpu-lut-atmosphere/validation.js
```

The validation module exports and exercises `validateAtmosphereConfig()` and
`validateAtmosphereLuts()`, rejects corrupt parameters or byte counts, checks
the imported LUT manifest SHA-256 values, proves the top-atmosphere miss guard,
and verifies resize/dispose ownership for WebGPU storage products.

## Replaced Techniques

- Replaced per-pixel nested view/light integration as the production path with
  compute-generated transmittance, multiscatter, sky-view, and aerial froxel
  LUTs. The old method remains useful for offline validation and tiny debug
  comparisons, but not as the taught runtime architecture.
- Replaced artist-only multiple scattering derived from `1 - transmittance`
  with a validated multiscatter LUT. The approximation may be a reduced-tier
  placeholder only when the quality difference is documented.
- Replaced custom output transforms inside the atmosphere effect with
  scene-linear HDR output into the host `RenderPipeline`.
- Replaced direct routing to the example implementation with a single
  deprecated legacy pointer in `SKILL.md`; the reference contract is now the
  implementation source of truth.

## Failure Conditions

- sky, terrain haze, sun/moon discs, and material irradiance use different
  atmosphere parameters;
- the atmosphere is a uniform transparent sphere or fixed fog color;
- nested per-pixel optical-depth integration is used for the main runtime path;
- altitude is taken from a local flat axis in orbital/geospatial views;
- scene depth is sampled without a declared projection/depth mode;
- direct sun, sky-light relighting, segment transmittance, and inscattering are
  merged into one signal;
- LUTs are loaded without manifest validation;
- output is tone mapped or color-converted twice;
- atmosphere ownership pops at shell entry or horizon transitions.
