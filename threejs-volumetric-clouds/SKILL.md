---
name: threejs-volumetric-clouds
description: Implement workload-selected volumetric cloud systems in Three.js r185 with WebGPURenderer, TSL, NodeMaterial, node RenderPipeline passes, compute/storage textures, temporal reprojection, cloud shadows, and error-bounded quality tiers.
---

# Volumetric Clouds

Cloud throughput is won by architecture before code details: march fewer pixels,
march only occupied volume, amortize with temporal reprojection, and carry enough
depth/velocity data to reject bad history. The taught path is pinned Three.js r185
with `WebGPURenderer` from `three/webgpu`, TSL from `three/tsl`, node materials,
compute/storage resources, and a node `RenderPipeline`.

The density field is an authored meteorological appearance model unless it is
coupled to validated atmospheric data. Beer-Lambert attenuation is physical for
the declared coefficients; dual-lobe phase fits, octave multiple scattering,
powder terms, procedural coverage, and compact shadow tails are approximations.
State this boundary in every implementation.

Read [references/weather-volume-and-reconstruction.md](references/weather-volume-and-reconstruction.md)
before implementing or auditing the cloud system.

Phase 1 WebGPU/TSL validation scaffold:
`examples/webgpu-weather-volume-clouds/`. It includes `validateCloudConfig()`,
asset-manifest checks, and shadow/temporal/composite ownership descriptors. Its
validator checks contract wiring, not radiometric, spatial, temporal, or visual
correctness; use this skill/reference as the implementation specification and
the numerical/image gates below before promoting a renderer. Still run
`node examples/webgpu-weather-volume-clouds/validation.js` after scaffold edits.

Legacy WebGL implementation (quarantined, do not extend or use as a pattern):
`examples/deprecated-weather-volume-clouds/`.

## Build Order

1. Start with the cheapest error-valid spatial route: a full-resolution
   scissored/bounded march for a small projected cloud volume, otherwise a
   measured reduced-resolution bounded raymarch, blue-noise first-sample
   offset, transmittance early exit, adaptive step length, cloud shadow map in
   the same update chain, temporal reprojection with velocity and depth
   rejection, then depth-aware upsample to full resolution in the node pipeline.
2. Initialize one `WebGPURenderer`, call `await renderer.init()`, and route
   compute/storage tiers through a capability gate:

```js
await renderer.init();

if (renderer.backend.isWebGPUBackend) {
  // Canonical compute/storage volumetric path.
} else {
  throw new Error("WebGPU backend unavailable for the canonical path.");
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
   After initialization use `renderer.compute()` for submission; r185
   `computeAsync()` is not a GPU-completion fence.
5. Feed the full-resolution composite as linear HDR cloud radiance plus
   transmittance into the host `RenderPipeline`; combine with scene color before
   the single output transform.

Do not add a second renderer branch to this flagship specification. A missing
WebGPU backend is a reported capability failure.

### r185 API Verification

Verified against local Three.js `REVISION === "185"`:
`WebGPURenderer`, `RenderPipeline`, `StorageTexture`, and `Storage3DTexture` are
exports of `three/webgpu`; `Fn`, `pass`, `mrt`, `renderOutput`,
`storageTexture`, `storageTexture3D`, and `textureStore` are exports of
`three/tsl`. `TRAANode` is the default export and `traa` the named factory from
`three/addons/tsl/display/TRAANode.js`. These symbols are revision-sensitive;
smoke-test imports after upgrades. Explicitly configure every storage texture's
format/type/filter/mipmap policy; r185 `StorageTexture` constructor defaults do
not imply an HDR cloud target.

## Required Architecture

- Weather-shaped density uses packed 2D weather fields plus 3D base/detail
  fields. The example's RGBA layout supports up to four layers; it is a storage
  optimization, not a physical requirement. Keep active layers separate until
  after per-layer altitude, profile, shape, and detail controls.
- Ray intervals come from cloud shell bounds and opaque scene depth. Never scale
  primary cost with camera far distance when the view only crosses a thin cloud
  layer.
- Keep the opaque host scene/depth at its required resolution and allocate a
  separate cloud target when reduction is selected. `PassNode.setResolutionScale()`
  scales its entire pass; it does not selectively downsample one material.
- A small projected cloud bound may use a full-resolution scissor/dispatch and
  no history when that wins the complete A/B. Larger coverage usually uses a
  reduced primary march with spatiotemporal blue-noise
  offset, skips packed empty altitude gaps and conservatively empty 3D
  macrocells, increases step length only under an error/occupancy gate, and
  terminates on a bounded remaining contribution.
- Temporal reconstruction is velocity/depth aware. Same-UV history blending is
  not accepted under camera or cloud motion. A single representative depth is
  allowed only for a unimodal contribution distribution; otherwise store depth
  spread or split layers.
- Cloud shadows are a separate compact optical-depth product, not a reuse of the
  beauty march. Update shadows on their own cadence and feed lighting lookups
  from that representation.
- Upsampling is depth-aware and edge-aware in the node pipeline, not a blind
  stretch. `TRAANode` supplies host temporal AA, not cloud-specific upscaling;
  cloud reprojection still owns cloud depth, motion, confidence, and topology
  rejection.

## Physical And Numerical Contract

Use scene length in meters or declare an exact conversion. With dimensionless
density shape `rho`, base coefficients `beta_s` and `beta_a` in `m^-1`:

```text
sigma_s = rho * beta_s
sigma_a = rho * beta_a
sigma_t = sigma_s + sigma_a
tau = integral(sigma_t ds)                 // dimensionless
dL/ds = -sigma_t L + j                     // j: radiance per meter
L_acc += T_acc * (j / sigma_t) * (1 - exp(-sigma_t ds))
T_acc *= exp(-sigma_t ds)
```

Use the `j * ds` limit as `sigma_t -> 0`. A direct-light single-scattering
source is either `sigma_s * T_sun * integral_sunDisk(p * L_sun dOmega)` for
finite-disk radiance or `sigma_s * p * E_sun * T_sun` under a declared
collimated-irradiance convention. Never substitute radiance for irradiance
without the solid-angle integral. Omitting `sigma_s` or dividing an already-
normalized source twice breaks units. Normalize
phase functions so `2*pi*integral_-1^1 p(mu)dmu = 1`; dual-lobe weights must be
nonnegative and sum to one.

## Architecture Selection

| Evidence | Select | Gate |
| --- | --- | --- |
| Small projected bounded volume, low temporal reuse | Full-resolution scissored/bounded march, no history | Full-res covered pixels cost less than reduced reconstruction/history and pass error gates |
| High occupied-sample fraction | Bounded adaptive march; no 3D hierarchy | Hierarchy lookup/divergence costs more than skipped field reads |
| Sparse, slowly evolving density | Conservative max-density macrocell hierarchy plus DDA | Skipped optical-depth/source upper bound is below the radiance error budget |
| Empty bands only vary by altitude | CPU-merged occupied intervals/complementary gaps | Debug view proves no occupied band is skipped |
| High temporal coherence, unimodal depth | Full low-resolution grid each frame, jitter, one representative depth/motion | Depth spread and rejection rate stay below gates |
| High coherence, strict dispatch budget | Explicit sparse/checkerboard update | Missing-sample reconstruction is defined separately from low-resolution jitter |
| Multi-layer or broad depth contribution | Depth moments, front depth, or separate layer histories | Single-depth reprojection exceeds disocclusion error gate |
| Low coherence, topology change, or camera cut | Current sample dominates; invalidate history | Stale-history confidence is zero |
| Mobile bandwidth limit | Quarter-linear targets, compact formats, fewer live histories, dynamic scale | Measured bytes/frame and GPU timestamps fit device/thermal budget |

## Workload Tuples And Budgets

| Authored key | Linear scale | Primary cap | Light cap | Shadow product | Temporal phase |
| --- | ---: | ---: | ---: | --- | ---: |
| `ultra` | 1/2 | 160 | 8 | 3x 768-1024 | 4 frames |
| `high` | 1/2 | 96 | 6 | 3x 512 | 4 frames |
| `default` | 1/4 | 64 | 4 | 2x 384 | 16 frames |
| `reduced` | 1/4 | 32 | 2 | 1-2x 128-256, amortized | 16 frames |

These are workload trial points, not hardware routes or time promises. A number is
**Derived** when it follows from format/resolution, **Gated** when computed from
an error limit, **Measured** only with hardware/revision/viewport/percentile and
thermal state, and otherwise **Authored**. Keep storage memory explicit:
quarter-linear 1920x1080 RGBA16F is
`480 * 270 * 8 = 1,036,800 B = 0.989 MiB`; half-linear is
`960 * 540 * 8 = 4,147,200 B = 3.955 MiB` (**Derived**). A 512x512 RGBA16F
cascade is `2 MiB` (**Derived**), but a direct-sun optical-depth cascade should
normally be one explicitly formatted channel rather than RGBA16F.

Meter depth cannot be stored directly in binary16 beyond 65,504 m. For a
200 km interval, store interval-normalized/log depth in R16F and decode with the
same ray interval, or use R32F; this range constraint is **Derived**. Record
bytes read/written per dispatch, not only allocation size, because mobile cloud
passes are commonly bandwidth-limited.

Report whole-frame p50/p95 and paired marginal p50/p95 from the same fixture
with the cloud system alternated on/off. Do not subtract unrelated percentile
runs, sum pass percentiles, or select a tuple from a device label. Select from
measured occupancy, quality gates, bytes/frame, paired marginal cost, and
thermal steady state.

## Required Controls

- coverage, cloud type, precipitation, and anvil bias;
- base/top altitude and vertical density profile per active layer;
- shape/detail scales, erosion, and height-dependent detail policy;
- common macro advection plus bounded relative motion for weather, shape,
  detail, and turbulence fields;
- density convention, length-unit conversion, `beta_s`, `beta_a`, and phase
  convention;
- primary step count, adaptive step limits, light step count, and empty-space
  policy;
- frame-rate-independent current response time/weight, velocity limit, depth
  rejection, variance-clipping width, and history reset causes;
- cloud-shadow extent, cascade count, resolution, update cadence, and compact
  channel layout;
- debug mode for each density, march, temporal, and shadow stage.

## Color And Output

- LDR PNG/JPEG color authored in sRGB uses `SRGBColorSpace`; HDR/generated
  radiance remains in its declared linear working space. Weather, noise, masks,
  depth, velocity, LUTs, and shadow optical-depth data use
  `NoColorSpace`/linear sampling.
- HDR cloud current/history/composite buffers use `HalfFloatType` until the
  pipeline tone maps.
- The cloud material/effect must not apply its own output conversion. The host
  `RenderPipeline` owns output conversion with `outputColorTransform` or an
  explicit `renderOutput()` node. When `renderOutput()` is explicit, set
  `renderPipeline.outputColorTransform = false`; after switching diagnostic
  `outputNode`, set `renderPipeline.needsUpdate = true`.
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
- host surface velocity is used as cloud velocity without reconstructing the
  advected representative cloud position;
- shadows use the full beauty march or update every pixel every frame;
- every layer shares the same wind, altitude profile, and density controls;
- output is tone mapped or color-converted more than once.
- meter depth is written to R16F beyond its finite range;
- averaged mipmaps or nonconservative occupancy masks are used to skip density;
- low-resolution jitter and sparse/checkerboard missing-sample reconstruction
  are conflated without a defined target lattice.

## Routing Boundary

Use `$threejs-choose-skills` for preflight when the task spans several rendering
systems. Use `$threejs-sky-atmosphere-and-haze` for molecular/aerosol
scattering without weather density, `$threejs-image-pipeline` for whole-frame
HDR/post ownership, `$threejs-exposure-color-grading` for tone mapping and LUT
policy, and `$threejs-scalable-real-time-shadows` when terrain/scene shadows need CSM or
tiled shadow integration. This skill owns weather-shaped cloud volumes,
temporal reconstruction, cloud lighting, and cloud optical-depth shadows.
