# WebGPU LUT Atmosphere

This is the canonical Phase 1 atmosphere contract. It teaches one shared
WebGPU/TSL path for sky radiance, sun/moon transmittance, segment
transmittance, segment inscattering, optional irradiance, and diagnostics.
The old spherical shader remains only as historical comparison.

## Product Schedule

| product | texture | format | workgroup | dispatch | invalidation | cadence |
| --- | --- | --- | --- | --- | --- | --- |
| transmittance | `StorageTexture` | RGBA16F | 8x8x1 | tier dimensions / 8 | atmosphere profile, unit conversion, solar inputs | update only when shared parameters change |
| multiscatter | `StorageTexture` | RGBA16F | 8x8x1 | tier dimensions / 8 | profile, ground albedo, solar irradiance | update with profile and lighting changes |
| irradiance | `StorageTexture` or manifest `DataTexture` | RGBA16F | 8x8x1 | tier dimensions / 8 | profile, ground albedo, sun direction | disabled for material relighting until the host lighting owner consumes it |
| sky-view | `StorageTexture` | RGBA16F | 8x8x1 | tier dimensions / 8 | camera altitude, sun direction, planet transform | update on sun/camera-frame invalidation |
| aerial froxel | `Storage3DTexture` | RGBA16F | 8x8x1 | width / 8, height / 8, slices | camera projection, view matrix, depth range | stagger under smooth motion |

Tier budgets start as measurements targets, not claims:

| tier | target GPU time | LUT memory target | default per-frame work |
| --- | ---: | ---: | --- |
| Ultra desktop-discrete | 0.4-1.2 ms | 8-24 MB | sky-view plus aerial froxel updates as needed |
| High desktop/integrated | 0.7-1.8 ms | 4-14 MB | staggered LUT refresh, 24-32 froxel slices |
| Mobile/tiled | 0.8-2.5 ms | 2-8 MB | static/precomputed base LUTs, 16-24 froxel slices |
| Fallback route | outside this flagship example | outside this flagship example | use `threejs-compatibility-fallbacks` when fallback behavior is explicitly requested |

## Executed Compute

The example builds real TSL `ComputeNode`s with `Fn().compute(count)` for:

- transmittance LUT: fixed-step numerical extinction integration from radius
  and view/sun cosine to the top atmosphere boundary;
- aerial froxel volume: fixed-step segment extinction and single-scattering
  accumulation, written to a `Storage3DTexture`.

Multiscatter, irradiance, and sky-view compute remain out of scope here until
their algorithms are implemented. The aerial froxel alpha channel stores scalar
single-scattering luminance; full spectral inscattering needs an additional
packing target.

## Build Checkpoints

Render debug `altitude`: must show planet/ECEF coordinates and corrected
altitude. If sea-level and orbit views share the same altitude, the transform
is using a local flat axis.

Render debug `intersections`: must show top and bottom intersections. If
tangent rays blink, check the closest-point segment test and top-atmosphere
miss guard.

Render debug `density`: must show Rayleigh, Mie, and absorption density. If
Mie stays bright at high altitude, verify the density profile scale.

Render debug `optical-depth`: must show view and sun optical depth. If sunset
goes gray instead of warm, inspect ozone absorption and sun visibility.

Render debug `sun-visibility`: must show ground occlusion and horizon
softening. If terrain lights through the planet, check bottom-sphere
intersections.

Render debug `segment-transmittance`: must darken long surface segments. If it
acts like a fixed fog color, the aerial froxel lookup is not using depth.

Render debug `single-multiple-scattering`: must separate direct sky color from
multiscatter. If the limb blooms uniformly, the multiscatter owner is wrong.

Render debug `depth-classification`: must distinguish sky pixel, surface
pixel, clipped surface, reversed depth, logarithmic depth, orthographic depth,
and MSAA resolved depth cases.

Render debug `shell-post`: must blend across atmosphere entry. If the shell
pops, validate the altitude-from-top blend range.

Render debug `lut-coordinates`: must show LUT coordinates and texture slices.
If slices jump under camera motion, verify radius/cosine packing.

Render debug `froxel-depth`: must show logarithmic or cascade-like froxel
depth distribution. If near haze smears, allocate more near slices.

## Output Ownership

The atmosphere outputs scene-linear HDR. When the final node is
`renderOutput(...)`, `RenderPipeline.outputColorTransform` is `false`; otherwise
the host image pipeline owns exactly one tone-map and output color conversion.
LUTs, optical-depth fields, depth, normals, weather masks, and diagnostic
textures use `NoColorSpace`.

## Validation

Run:

```sh
node threejs-sky-atmosphere-and-haze/examples/webgpu-lut-atmosphere/validation.js
```

The validator checks the LUT manifest hashes and byte counts, texture upload
policy, atmosphere parameter object, meter/kilometer unit fixtures, CPU
equivalent ray/segment math, depth-mode helpers, WebGPU/TSL import contract,
resource resize/dispose ownership, and source sentinels for compute and
pipeline ownership. It also runs pure-JS transmittance integrand fixtures,
asserts real TSL compute nodes instead of descriptor strings, checks the
non-WebGPU error route, and verifies renderOutput-owned output transform
ownership.
