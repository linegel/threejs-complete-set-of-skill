# Weather-Shaped Cloud Volume And Reconstruction

Use this reference for planetary or large-world volumetric clouds in latest
Three.js when the implementation path is `WebGPURenderer`, TSL, node materials,
node `RenderPipeline`, and compute/storage resources. The target architecture is
not a simple raymarch. It is a reduced-resolution bounded raymarch with
spatiotemporal blue-noise sampling, transmittance early exit, adaptive stepping,
velocity/depth-aware temporal reprojection, cloud shadow generation in the same
frame chain, and depth-aware full-resolution upsample.

## Contents

1. Performance architecture
2. Capability gate and tiers
3. Texture, storage, and color contract
4. Four-layer density model
5. Packed intervals and shell bounds
6. Weather, shape, turbulence, and detail fields
7. Primary march policy
8. Lighting and cloud shadows
9. Temporal reprojection and upsample
10. Budgets
11. Diagnostics and failure diagnosis
12. Replaced techniques

## 1. Performance Architecture

Build the system around these passes:

1. CPU layer packing: upload active layer bounds, profiles, density scales,
   weather exponents, shape/detail amounts, and complementary empty altitude
   gaps into a small uniform/storage buffer.
2. Optional field generation: use TSL compute to produce weather maps,
   `Storage3DTexture` shape/detail fields, turbulence, and blue-noise variants
   only when their recipes or seeds change. Static shipped fields can be loaded
   as `Data3DTexture`/2D textures with documented channel semantics.
3. Cloud shadow update: write compact optical-depth cascades to
   `StorageTexture` targets on an independent cadence before the beauty pass
   needs them.
4. Reduced-resolution beauty march: half linear resolution for high tiers,
   quarter linear resolution for default tiers. Write current radiance,
   transmittance, representative depth, velocity, and rejection hints.
5. Temporal resolve: reproject history using cloud velocity and representative
   depth, reject invalid history, variance-clip accepted history, and swap
   history storage.
6. Full-resolution upsample/composite: use scene depth and neighborhood depth
   agreement to upsample cloud radiance/transmittance into the host node
   pipeline.

The primary raymarch is never the place to recover performance after the fact.
Choose the reduced-resolution temporal architecture first; then tune step
counts.

Canonical Phase 1 checkpoint path: `examples/webgpu-weather-volume-clouds/`.
That folder owns the current WebGPU/TSL contract, asset manifest validator,
layer interval packing, storage-budget accounting, cloud-shadow descriptor,
temporal reconstruction descriptor, and linear HDR composite ownership. Run
`node examples/webgpu-weather-volume-clouds/validation.js` after changing the
skill, asset contract, or cloud example.

## 2. Capability Gate And Tiers

Initialize the renderer before selecting the tier:

```js
await renderer.init();

if (renderer.backend.isWebGPUBackend) {
  // Full compute/storage tier.
} else {
  // Reduced-quality tier: precomputed fields, lower march resolution,
  // static or lower-rate shadows, and fewer lighting samples.
}
```

The reduced tier is a quality tier. It keeps the same density and compositing
contract, but uses smaller grids, precomputed texture variants from assets, and
static or low-rate shadow products. Do not fork a second implementation model.

Quality tiers:

| Tier | Resolution | Temporal amortization | Main removals |
| --- | --- | --- | --- |
| Ultra | 1/2 linear | 4-8 frames | none; highest shadow and light samples |
| High | 1/2 linear | 4-8 frames | fewer shadow samples, fewer multiple-scattering octaves |
| Default | 1/4 linear | 8-16 frames | lower shadow resolution, no ground bounce by default |
| Reduced | 1/4-1/8 linear | 8-16 frames or static | no turbulence/detail at distance, static shadows, precomputed weather variants |

Even the reduced tier keeps weather-shaped density, bounded shell/depth
intervals, temporal reprojection, and some directional self-shadowing.

## 3. Texture, Storage, And Color Contract

- Use `WebGPURenderer` from `three/webgpu`.
- Write GPU work in TSL `Fn().compute(count)` and dispatch through
  `renderer.compute()` or `renderer.computeAsync()`.
- Use `StorageTexture` for current cloud, history, rejection/debug masks, and
  shadow cascades; use `Storage3DTexture` when generated 3D fields must be
  writable; use `Data3DTexture` for immutable packed volume assets.
- Use `storage()`, `storageTexture()`, `storageTexture3D()`, and
  `textureStore()` nodes for storage IO.
- Use `RenderPipeline`, `pass()`, `mrt()`, `PassNode.setResolutionScale()`,
  and texture nodes to share scene color, depth, normal, and velocity with the
  cloud chain.
- Use `TRAANode` for host temporal AA where applicable, but cloud history still
  needs its own representative depth and velocity unless the host velocity field
  exactly covers the cloud sample.
- Use `CSMShadowNode` or `TileShadowNode` for opaque scene shadows. Cloud
  optical-depth shadows are a separate volumetric product.

Color/output rules:

- Albedo or authored color textures use `SRGBColorSpace`.
- Weather, masks, noise, volume density, shadow optical depth, depth, velocity,
  and LUT data use `NoColorSpace`/linear data interpretation.
- Current/history/composite cloud buffers use HDR `HalfFloatType` until tone
  mapping.
- The host `RenderPipeline` owns the single output transform via
  `outputColorTransform` or explicit `renderOutput()`. Cloud nodes output
  linear HDR radiance and transmittance only.

## 4. Four-Layer Density Model

Evaluate four active layers in parallel as vector channels. Do not collapse
them into one scalar weather field before applying per-layer altitude, profile,
shape, and detail controls.

Default active layers:

| Channel | Altitude | Height | Density | Shape | Detail | Coverage width | Shadow |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| R low | 750 m | 650 m | 0.2 | 1.0 | 1.0 | 0.6 | yes |
| G middle | 1000 m | 1200 m | 0.2 | 1.0 | 1.0 | 0.6 | yes |
| B high | 7500 m | 500 m | 0.003 | 0.4 | 0.0 | 0.5 | no |
| A spare | disabled | disabled | default | default | default | default | no |

Each layer owns:

```ts
type CloudLayer = {
  weatherChannel: "r" | "g" | "b" | "a";
  baseAltitudeMeters: number;
  heightMeters: number;
  weatherExponent: number;
  coverageFilterWidth: number;
  shapeAlteringBias: number;
  densityScale: number;
  shapeAmount: number;
  detailAmount: number;
  castsCloudShadow: boolean;
  densityProfile: {
    exponentialTerm: number;
    exponent: number;
    linearTerm: number;
    constantTerm: number;
  };
};
```

Default density profile:

```text
profile(h) =
  exponentialTerm * exp(exponent * h)
  + linearTerm * h
  + constantTerm

default = 0.75 * h + 0.25
```

This profile is an artist-authored function that can rise, fall, or curve by
layer. It is not a generic bottom/top smoothstep.

## 5. Packed Intervals And Shell Bounds

Sort all lower/upper altitude endpoints on CPU, merge occupied ranges, then
pack the complementary empty gaps. The packed intervals are gaps to skip during
beauty and shadow sampling.

For the default layers, low and middle merge into one occupied band from
750-2200 m, followed by an empty gap before the 7500-8000 m high layer.

Adaptation checklist:

1. Merge occupied layer ranges on CPU.
2. Pack complementary empty gaps.
3. Upload both occupied shell bounds and gap bounds.
4. Verify a debug view marks packed intervals as skipped gaps.
5. Never skip the occupied bands.

Intersect view rays with the planet radius, minimum cloud altitude, maximum
cloud altitude, and shadow top altitude. Choose near/far based on camera state:
below clouds, inside the total cloud layer, above clouds, and ground
intersection. Clamp far distance against opaque scene depth so cloud cost ends
at the nearest opaque surface.

Return diagnostic flags for ground intersection, scene occlusion, camera
region, near/far distance, selected sphere intersections, and packed-gap skip
counts.

## 6. Weather, Shape, Turbulence, And Detail Fields

Generate or load fields once, then advect offsets each frame:

```text
weatherOffset += weatherVelocity * dt
shapeOffset += shapeVelocity * dt
detailOffset += detailVelocity * dt
turbulenceOffset += turbulenceVelocity * dt
```

Local weather channels:

```text
R: low-cloud Worley FBM
G: middle-cloud Worley FBM
B: high-cloud anisotropic Perlin
A: auxiliary variation or authored mask
```

Low and middle fields remain separated:

```text
middle = smoothstep(1.0, 1.4, WorleyFBM(point + 0.5))
low = saturate(
  smoothstep(0.8, 1.4, WorleyFBM(point))
  - middle
)
```

Base shape combines Perlin-Worley and Worley FBM:

```text
perlinWorley =
  remap(perlin, 0, 1, worleyFBM, 1)

baseShape =
  remap(perlinWorley, worleyFBM - 1, 1)
```

Use low-frequency-dominant weights such as `0.625, 0.25, 0.125`.

Detail is Worley-only with progressively finer FBM bands from frequencies
`2, 4, 8, 16`, again weighted toward low frequencies. Skip detail reads when
sample footprint or quality tier cannot resolve them.

Turbulence stores a normalized curl field derived from offset channels. It
warps shape coordinates; it is not multiplied into final density as arbitrary
noise. Fade turbulence out by roughly the lower 30% of each layer so it
distorts bases and growth without scrambling entire cloud masses.

Coverage response:

```text
heightFraction =
  remapClamped(height, layerMin, layerMax)

biased = heightFraction ^ shapeAlteringBias
x = clamp(2 * biased - 1, -1, 1)
heightScale = 1 - x^2

factor = 1 - coverage * heightScale
density =
  remapClamped(
    mix(localWeather, 1, coverageFilterWidth),
    factor,
    factor + coverageFilterWidth
  )
```

Global coverage shifts/remaps local weather. It is not a final density
multiplier.

Shape application:

```text
surfaceNormal = normalize(position)
evolution = -surfaceNormal * length(weatherOffset) * 20000

turbulence =
  displacement
  * (curlTexture * 2 - 1)
  * lowHeightMask

shapePosition =
  (position + evolution + turbulence)
  * shapeRepeat
  + shapeOffset

density =
  remapClamped(
    weatherDensity,
    (1 - shapeNoise) * shapeAmount,
    1
  )
```

Height-dependent detail:

```text
topModifier = detail^6
bottomModifier = 1 - detail

modifier =
  mix(
    topModifier,
    bottomModifier,
    remapClamped(heightFraction, 0.2, 0.4)
  )

modifier *= shapeDetailAmount
density =
  remapClamped(
    density * 2,
    modifier * 0.5,
    1
  )
```

Final density:

```text
densityVector =
  saturate(
    densityVector
    * densityScales
    * profile(heightFraction)
  )

totalDensity = sum(densityVector)
layerWeight = densityVector / max(totalDensity, epsilon)
scattering = totalDensity * scatteringCoefficient
extinction =
  totalDensity * absorptionCoefficient
  + scattering
```

## 7. Primary March Policy

Default high-tier budget:

```text
max primary steps: 72-120 at half linear resolution
minimum step: 50 m
maximum step: 1000 m
maximum ray distance: 200 km
perspective step scale: 1.01
minimum density: 1e-5
minimum extinction: 1e-5
minimum transmittance: 1e-2
```

Ultra may raise primary steps to 160. Default quarter-resolution tiers should
stay in the 48-80 range because temporal reprojection supplies the missing
samples over time.

Initial step size grows with ray entry distance:

```text
step =
  minStep
  + (perspectiveScale - 1) * rayNear
```

At each sample:

1. Apply a blue-noise first-step offset tied to the temporal sample pattern.
2. Skip packed empty altitude gaps.
3. Sample rough weather first.
4. If all layer densities are below threshold, take a longer mip-aware step.
5. Otherwise sample base shape, optional turbulence, and detail.
6. Evaluate lighting only when extinction is significant.
7. Integrate front-to-back and terminate at the transmittance threshold.

Long empty-space steps can band near the first dense crossing. The best fix is
a short binary search or step refinement at the first threshold crossing, not
more fixed steps everywhere.

## 8. Lighting And Cloud Shadows

Per occupied sample, evaluate:

```text
sun irradiance
sky irradiance
short optical-depth march toward sun
cloud shadow optical-depth lookup beyond that short march
multi-scattering approximation
optional ground bounce
sky gradient contribution
powder attenuation
```

The phase function defaults to two Henyey-Greenstein lobes. Fitted
large-particle phase functions are acceptable only with adequate multiple
scattering; otherwise they look harsh and energy-imbalanced.

Multiple scattering uses octave accumulation:

```text
for each octave:
  contribution +=
    attenuationA
    * exp(-opticalDepth * attenuationB)
    * phase(cosTheta, attenuationC)
  attenuation *= 0.5
```

Use 4-8 octaves by tier. Spend fewer octaves before raising the primary step
count, because temporal reprojection amortizes geometry but not repeated light
work inside each sample.

Energy-conserving integration:

```text
stepT = exp(-extinction * stepLength)
stepScatter =
  (radiance - radiance * stepT)
  / max(extinction, epsilon)

accumulatedRadiance += accumulatedT * stepScatter
accumulatedT *= stepT
```

Representative depth is a transmittance-weighted sample distance. Use it for
aerial perspective, temporal velocity, and depth-aware upsample.

Cloud shadow representation:

```text
R front depth
G mean extinction
B maximum accumulated optical depth
A optical-depth tail estimate after early termination
```

Shadow marching uses structured volume sampling:

1. Choose one of three icosahedral structure normals from ray direction and a
   stable temporal index.
2. Intersect regularly spaced planes perpendicular to that normal.
3. March samples on those planes.
4. Write compact optical-depth channels to cascade storage.

Default shadow budget:

```text
high:    3 cascades, 512x512, 40-64 samples, update every 2-4 frames
default: 2 cascades, 256-384, 24-40 samples, update every 4-8 frames
reduced: 1-2 cascades, 256 or static, 12-24 samples
minimum transmittance: 1e-4 high, 1e-2 reduced
```

This structured shadow product intentionally trades some spatial precision for
temporal stability and low lighting cost.

## 9. Temporal Reprojection And Upsample

Render current clouds at half or quarter linear resolution:

```text
half:    lowWidth = ceil(fullWidth / 2), lowHeight = ceil(fullHeight / 2)
quarter: lowWidth = ceil(fullWidth / 4), lowHeight = ceil(fullHeight / 4)
```

Use a 2x2 or 4x4 subpixel pattern to distribute current samples over 4-16
frames. Tie camera/view jitter and the first-step blue-noise offset to the same
frame index.

Current cloud targets store:

```text
RGBA16F: cloud radiance.rgb and transmittance.a
RG16F or RGBA16F: representative depth, packed velocity, confidence
R8/R16: rejection/debug mask when needed
optional: shadow length or light-confidence data
```

Temporal resolve:

1. Prefer the newly rendered current texel for the active subpixel.
2. For missing subpixels, select the closest-depth or highest-confidence sample
   in a 3x3 low-resolution neighborhood.
3. Reproject history with velocity.
4. Reject history outside the viewport.
5. Reject on depth mismatch, velocity spike, camera cut, projection change,
   weather discontinuity, layer topology change, or resolution/render-scale
   change.
6. Variance-clip accepted history against current neighborhood color.
7. Blend with tiered alpha, then write and swap history.

Recommended temporal alpha:

```text
ultra/high: 0.05-0.12
default:    0.08-0.18
reduced:    0.12-0.25
```

Depth-aware upsample:

1. Gather the resolved low-resolution cloud neighborhood.
2. Compare representative cloud depth with full-resolution scene depth and
   nearby low-resolution depths.
3. Weight samples by depth agreement, transmittance confidence, and edge
   distance.
4. Composite cloud radiance/transmittance in linear HDR before tone mapping.

## 10. Budgets

Per-frame targets at 1920x1080:

| Hardware | Tier | Cloud total | March dispatch | Temporal+upsample | Shadow amortized |
| --- | --- | ---: | ---: | ---: | ---: |
| Desktop discrete | High | 1.8-3.0 ms | 0.9-1.7 ms | 0.3-0.6 ms | 0.4-0.8 ms |
| Desktop discrete | Ultra | 2.5-4.0 ms | 1.4-2.4 ms | 0.4-0.7 ms | 0.6-1.0 ms |
| Desktop integrated | Default | 1.2-2.2 ms | 0.6-1.2 ms | 0.3-0.5 ms | 0.2-0.5 ms |
| Mobile-class | Reduced | 0.5-1.2 ms | 0.25-0.7 ms | 0.15-0.35 ms | 0.1-0.25 ms |

Memory targets:

```text
quarter 1920x1080 RGBA16F buffer: ~4 MB
half 1920x1080 RGBA16F buffer: ~16 MB
512x512 RGBA16F shadow cascade: ~2 MB
128^3 single-channel 8-bit volume: ~2 MB
128^3 RGBA8 volume: ~8 MB
```

Keep pass count stable:

```text
scene pass with depth/velocity/MRT: host owned
cloud shadow update: 0-1 amortized dispatch group per frame
cloud beauty march: 1 dispatch/pass at reduced resolution
temporal resolve: 1 dispatch/pass
depth-aware upsample/composite: 1 node pass
optional bloom/aerial perspective: host image pipeline
```

Use `BloomNode`, `GTAONode`, and related built-in display nodes in the host
image pipeline before writing custom post nodes. Custom cloud nodes are
justified because the density, optical-depth shadow, and temporal data contract
is domain-specific.

## 11. Diagnostics And Failure Diagnosis

Expose debug views:

```text
weather RGBA
per-layer height fractions
packed empty intervals
coverage-remapped density
base shape
detail modifier
turbulence displacement
final per-layer density vector
total scattering/extinction
ray near/far and scene clamp
primary/shape/detail sample counts
sun optical depth
cloud shadow RGBA channels
transmittance
representative depth
velocity
history UV
variance bounds
history rejection
upsample depth weights
shadow cascade index
shadow structured-sampling planes
storage texture resolution and memory
```

Failure diagnosis:

```text
clouds disappear between low and high layers:
  occupied ranges were mistaken for packed empty gaps

all cloud types share one silhouette:
  layer vectors were summed before profile/shape controls

porous smoke:
  detail was added uniformly instead of height-dependent remapping

boiling motion:
  field offsets use unrelated directions/speeds or textures regenerate

bright flat interior:
  short sun optical depth or shadow map is missing

dark featureless cloud:
  multi-scattering, sky light, or powder balance is absent

edge trails:
  representative depth/velocity is wrong or history lacks variance clipping

ghosting during camera motion:
  history is same-screen-position accumulation instead of velocity reprojection

flickering cloud shadows:
  beauty jitter was reused instead of temporally stable structured sampling

cost scales with view distance:
  shell interval, scene depth clamp, or empty-gap skipping is broken

unexpected color shift:
  cloud output was tone mapped or color-converted outside the host pipeline
```

## 12. Replaced Techniques

- Full or near-full-resolution cloud rendering is replaced by half/quarter
  linear resolution plus temporal reprojection and depth-aware upsample because
  it buys 4-16x fewer expensive march pixels at comparable visual quality.
- Same-screen-position history smoothing is replaced by representative
  depth/velocity reprojection with viewport, velocity, depth, and variance
  rejection because ordinary camera motion should amortize samples, not reset
  or smear them.
- Per-frame generated procedural field targets are replaced by compute-generated
  or loaded persistent fields because field recipes are static relative to the
  march and should not consume frame budget.
- Full beauty-march shadows are replaced by compact optical-depth shadow
  cascades because lighting needs stable directional transmittance, not beauty
  color.
- Uniform detail application is replaced by height-dependent erosion because it
  preserves cloud topology: fluffy tops and eroded bases.
- Raising primary step count as the first quality lever is replaced by bounded
  intervals, empty-gap skipping, adaptive steps, early transmittance exit, and
  temporal amortization.
