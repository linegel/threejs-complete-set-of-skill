# Atmosphere System Contract

Use this contract to build a native-WebGPU/TSL atmosphere
that keeps sky, aerial perspective, material irradiance, coordinate transforms,
depth, and output ownership coherent for general visualization, geospatial,
scientific, cinematic, and interactive 3D work.

## Contents

- Numeric provenance and architecture
- Current Three.js API, capability gate, and tiers
- Shared parameter and radiometric model
- `LightingTransportSnapshot` and presentation publication
- LUT products, parameterization, errors, and generation order
- Ellipsoid, frames, and depth ownership
- Sky, surface, lighting, and shell/post composition
- Color/output and performance evidence
- Diagnostics, validation, replaced techniques, and failure conditions

## Numeric Provenance

Every tunable number in an implementation or evidence bundle carries one tag:

- **[Derived]**: follows from units, geometry, a representation, or a stated
  equation. Include that equation.
- **[Gated]**: an acceptance threshold or resource ceiling. Include the test
  that rejects violations.
- **[Measured]**: observed on a named browser, device/GPU, resolution, DPR, and
  revision. Never copy it to another target as fact.
- **[Authored]**: a visual/default quality choice. It may seed tuning but is
  neither a physical constant nor a performance measurement.

Literal algebraic constants such as `2` and `pi` are **[Derived]**. LUT sizes,
step counts, blend widths, update cadences, and example GPU times are not
derived merely because they appear in a table.

## Architecture First

The production architecture is a precomputed scattering LUT system generated on
the GPU, then sampled by cheap TSL nodes:

```text
shared atmosphere parameters
  -> transmittance StorageTexture
  -> multiscatter / irradiance StorageTexture set
  -> sky-view StorageTexture for current sun/camera frame
  -> aerial RGB-inscattering and RGB-optical-depth froxel products, or a
     validated endpoint-transmittance reconstruction
  -> RenderPipeline scene pass depth/color
  -> TSL sky and surface aerial-perspective composition
```

The expensive work is moved into bounded compute dispatches. Visible pixels do
not run nested view and sun optical-depth integration; they reconstruct a
metric ray segment, then sample transmittance/optical depth, sky-view,
multiscatter, and aerial products. A four-channel froxel cannot hold both RGB
inscattering and RGB transmittance. Use two products, reconstruct segment
transmittance from endpoint optical depths, or explicitly gate a reduced
chromatic representation against the reference integrator.

This replaces the older nested dynamic integration path because it scales with
pixel count and sample product. A 1080p frame with 2 million pixels, 16 view
samples, and 8 light samples implies hundreds of millions of density/phase
evaluations before lighting, while LUT/froxel sampling keeps the per-pixel path
near constant cost and amortizes integration across compact grids.

Choose the transport family explicitly:

- **compact Hillaire-style** transmittance + 2D multiscatter response +
  camera-dependent sky/aerial products is the default real-time/mobile
  architecture; its high-order closure is approximate and must pass energy and
  reference-radiance gates;
- **Bruneton-style scattering-order precompute** is appropriate for fixed
  atmospheres or stricter spectral/angular accuracy, but its higher-dimensional
  scattering products and regeneration cost must be budgeted rather than
  described as the compact 2D path;
- a float64 CPU, high-step GPU, or offline Monte Carlo/discrete-ordinate solve
  is a reference, not the visible-pixel runtime path.

Do not combine response terms from two families without proving identical
units, phase conventions, and order ownership; otherwise single or multiple
scattering is counted twice.

## Current Three.js API Contract

Use only the repository's pinned Three.js r185 WebGPU/TSL APIs:

```js
import {
  HalfFloatType,
  NoColorSpace,
  RGBAFormat,
  RenderPipeline,
  Storage3DTexture,
  StorageTexture,
  WebGPURenderer
} from 'three/webgpu';

import {
  Fn,
  mrt,
  pass,
  renderOutput,
  storageTexture3D,
  textureStore
} from 'three/tsl';
```

These imports are verified against installed Three.js `0.185.1`: use
`StorageTexture` plus `textureStore()` for 2D products and
`Storage3DTexture` plus `storageTexture3D()` for volume writes. Set
`format = RGBAFormat`, `type = HalfFloatType`, and
`colorSpace = NoColorSpace`. For r185 2D `StorageTexture`, set both
`generateMipmaps = false` and
`mipmapsAutoUpdate = false` unless authored mip levels are actually generated
and sampled. Set `Storage3DTexture.generateMipmaps = false` when only its base
level is written; it does not expose `mipmapsAutoUpdate`.
Compute work is authored as `Fn().compute(count)` and submitted with
`renderer.compute()` or `renderer.computeAsync()`.
After initialization prefer `renderer.compute()`; `computeAsync()` only
initializes on demand before enqueueing and is not a GPU-completion fence.
Later GPU submissions are queue-ordered. CPU readback, resolved timestamps,
resource reuse, and lifetime decisions require an explicit completion or
readback mechanism rather than awaiting `computeAsync()`.

r185 source proofs in the installed package:

| contract | proof target |
| --- | --- |
| `RenderPipeline`, `StorageTexture`, `Storage3DTexture` exports | `node_modules/three/src/Three.WebGPU.js` |
| `storageTexture3D`, `textureStore`, depth-conversion exports | `node_modules/three/src/Three.TSL.js` |
| perspective-only pass view-Z helper and normalized linear-depth helper | `node_modules/three/src/nodes/display/PassNode.js` |
| reversed-aware perspective/orthographic conversion and logarithmic signature | `node_modules/three/src/nodes/display/ViewportDepthNode.js` |
| 2D-only `mipmapsAutoUpdate` ownership | `node_modules/three/src/renderers/common/StorageTexture.js` and `Storage3DTexture.js` |

Compose the final image with one `RenderPipeline`. Build from a `pass( scene,
camera )`; use `mrt()` only for signals that must be shared by atmosphere,
clouds, AO, bloom, temporal resolve, or diagnostics. Use
`PassNode.getLinearDepthNode()` or `PassNode.getViewZNode()` instead of a
duplicate scene render. Use `PassNode.setResolutionScale()` for any reduced
resolution pass.

Historical note: `PostProcessing` was renamed to `RenderPipeline`; new code
uses `RenderPipeline`. In r185, `PassNode.getViewZNode()` calls the perspective
depth conversion and `getLinearDepthNode()` returns normalized linear depth.
Neither helper is a projection-agnostic metric ray-length function.

## Capability Gate And Tiers

Gate immediately after initialization:

```js
const renderer = new WebGPURenderer( {
  antialias: false,
  outputBufferType: HalfFloatType
} );

await renderer.init();

if ( renderer.backend.isWebGPUBackend !== true ) {
  throw new Error(
    'threejs-sky-atmosphere-and-haze requires a native WebGPU backend.'
  );
}

// Full tier: live compute/storage LUT generation and RenderPipeline sharing.
```

There is no alternate-renderer branch in this contract. If native WebGPU,
storage textures, required formats, or memory ceilings are unavailable, report
the failed capability as a blocker.

All dimensions below are **[Authored]** workload trials, not device classes,
memory budgets, or timing evidence.

| Trial | Transmittance | Multiscatter / irradiance | Sky-view | Aerial froxels |
| --- | ---: | ---: | ---: | ---: |
| Full-detail | 256x64 | 64x32 | 192x108 | 192x108x32-48 |
| Budgeted | 192x48-256x64 | 32x32-64x32 | 128x64 | 160x90x24-32 |
| Minimum-resident | 128x32 | 32x16-32x32 | 96x48 | 96x54x16-24 |

Every tier must publish dispatch counts, workgroup sizes, texture formats,
texture dimensions, update cadence, pass count, draw calls, memory, and GPU
time on representative hardware.

The canonical `examples/webgpu-lut-atmosphere/` schedule uses:

| product | texture | format | authored workgroup | exact dependency hash | explicitly not a dependency |
| --- | --- | --- | --- | --- | --- |
| transmittance/optical depth | `StorageTexture` | RGBA16F | **[Authored]** 8x8x1 | bottom/top geometry, density/extinction profiles, integration unit, quadrature and encoding revision | sun direction, solar magnitude, phase `g`, ground albedo, camera |
| multiscatter response | `StorageTexture` | RGBA16F | **[Authored]** 8x8x1 | transmittance version, scattering/extinction, phase closure, ground albedo, iteration/quadrature revision | camera and world transform; solar magnitude when factored out |
| irradiance response | `StorageTexture` or manifest `DataTexture` | RGBA16F | **[Authored]** 8x8x1 | transmittance/multiscatter versions, ground BRDF, parameterization | current sun direction when `mu_s` is a LUT coordinate |
| sky-view | `StorageTexture` | RGBA16F | **[Authored]** 8x8x1 | base-LUT versions, camera body-relative altitude/latitude model, local sun zenith, ground model, resolution | camera yaw/roll, projection jitter, floating-origin translation |
| aerial inscattering | `Storage3DTexture` | RGBA16F | **[Authored]** 8x8x1 | unjittered inverse projection, camera pose in body coordinates, base-LUT versions, sun frame, depth mapping, viewport/aspect tier | temporal jitter alone; world translation that preserves body-relative pose |
| aerial optical depth, when stored | `Storage3DTexture` | RGBA16F | **[Authored]** 8x8x1 | same ray/profile/depth geometry as inscattering | phase function and solar magnitude |

Each product records a canonical serialized dependency hash, generating
revision, dispatch dimensions, last-update reason, byte cost, and measured GPU
time. Dirty propagation follows this table; do not use a single global
`atmosphereChanged` flag. A spherical LUT parameterized by altitude and
`mu_s` is body-frame data, so camera orientation and floating-origin shifts do
not invalidate it. Aerial view products are the expected pose-dependent work;
reproject or update them in slices instead of refreshing static LUTs.

The Phase 1 Node validator constructs five real TSL compute graphs:
transmittance, compact multiscatter, irradiance, fixed-input sky-view, and one
aerial graph that writes RGB inscattering plus RGB optical depth. It does not
initialize `WebGPURenderer` or call either
`renderer.compute()` or `renderer.computeAsync()`, so graph construction is not
dispatch evidence. Its aerial graph uses fixed authored camera/projection
constants; host viewport resize is explicitly not applicable to this fixture.
The multiscatter, irradiance, and sky-view graphs are `reference-ungated`:
authored closure/quadrature source exists, but CPU graph construction proves
neither GPU output nor transport accuracy. Scene depth and final composition
remain descriptor-only until a browser harness implements and executes them.

## Shared Parameter Model

Keep one atmosphere object for sky, aerial perspective, material irradiance,
sun/moon transmittance, and diagnostics. Choose one integration length unit at
the model boundary. The canonical Phase 1 fixture integrates in kilometers and
stores coefficients in `km^-1`; a meter-based implementation instead converts
both lengths and coefficients once. The familiar values below show the
equivalent SI conversion, which is not optional when integration uses meters.

Earth-like three-band starting data:

```text
spectral solar scale = (1.474, 1.8504, 1.91198)       [Authored]
sun angular radius = 0.004675 rad                     [Authored]
bottom radius = 6.360e6 m                             [Authored]
top radius = 6.420e6 m                                [Authored]
Rayleigh scattering/extinction =
  (5.802e-6, 13.558e-6, 33.100e-6) m^-1              [Authored preset; Derived conversion]
Mie scattering = (3.996e-6, 3.996e-6, 3.996e-6) m^-1 [Authored preset; Derived conversion]
Mie extinction = (4.440e-6, 4.440e-6, 4.440e-6) m^-1 [Authored preset; Derived conversion]
absorption extinction =
  (0.650e-6, 1.881e-6, 0.085e-6) m^-1                [Authored preset; Derived conversion]
Mie phase g = 0.8                                     [Authored]
ground diffuse albedo = 0.1                           [Authored]
```

The source values `0.005802`, `0.003996`, and peers are in `km^-1`. If an
implementation instead integrates in kilometers, radii and step lengths must
be converted to kilometers at the single model boundary. Record
`integrationLengthUnit` and assert, with a one-kilometer homogeneous fixture,
that `T = exp(-beta * 1 km)` matches between CPU and GPU.

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

For `h` in meters, `expScale` has units `m^-1`, `linearTerm` has units `m^-1`,
and the other terms are dimensionless. The **[Derived]** conversions of the
common scale heights are `-1 / 8000 m = -1.25e-4 m^-1` for Rayleigh and
`-1 / 1200 m = -8.333333e-4 m^-1` for Mie. Absorption uses two authored linear
layers around the ozone region. Diagnose both raw and clamped profiles:
negative raw values may intentionally terminate a linear layer, but declared
positive support, clamped continuity, and integrated column density must pass
their gates; clamping must not hide a wrong coefficient unit.

### Radiometric and energy contract

For wavelength band `lambda`, density species `j`, and metric path coordinate
`s`:

```text
sigma_t(lambda, x) = sum_j beta_t,j(lambda) * rho_j(x)       [m^-1]
sigma_s(lambda, x) = sum_j beta_s,j(lambda) * rho_j(x)       [m^-1]
tau(lambda, a->b)  = integral_a^b sigma_t ds                [dimensionless]
T(lambda, a->b)    = exp(-tau)                              [dimensionless]
dL/ds              = -sigma_t L + sigma_s * source          [radiance / m]
```

Phase functions have units `sr^-1` and integrate to one over `4*pi`:

```text
P_R(mu)  = 3 * (1 + mu^2) / (16*pi)
P_HG(mu) = (1-g^2) / (4*pi*(1 + g^2 - 2*g*mu)^(3/2))
```

`|g|=1` is a singular delta distribution, not a finite-lobe parameter. The
canonical finite-resolution fixture gates `|g| <= 0.99`. Evaluate the
denominator base without cancellation near the lobe:

```text
b = (1-g)^2 + 2*g*(1-mu)       for g >= 0
b = (1+g)^2 - 2*g*(1+mu)       for g < 0
P_HG = (1-g^2) / (4*pi*b^(3/2))
```

The only allowed numeric floor is the **[Derived]** roundoff floor
`(1-g_max)^2`; clamping `b^(3/2)` to an arbitrary epsilon changes the lobe
energy. Gate normalization and both peak directions at `g=-g_max,0,+g_max`.

Fix the directional convention in code and manifests. Recommended: `omega` is
the ray direction from camera into the scene and `s` points from the sample to
the sun, so `mu=dot(omega,s)` and positive `g` peaks when looking toward the
sun. A sun-centered angular sweep must prove the forward lobe; a sign error can
remain energy-normalized while putting the halo on the antisolar side.

With the authored defaults, Mie single-scattering albedo is **[Derived]**
`3.996 / 4.440 = 0.9`; enforce componentwise
`0 <= beta_s <= beta_t`. Rayleigh extinction equals Rayleigh scattering for
this model, while absorption contributes only to extinction. A Lambertian
ground returns `albedo/pi` times incident irradiance. The multiscatter solve
must conserve absorbed versus escaped energy; adding `1-T` as radiance is not
an energy model.

Declare whether a calibrated solar provider carries normal irradiance or
finite-disc radiance. For a uniform disc with angular radius `alpha`, the
**[Derived]** conversion is
`L_sun = E_normal / (pi * sin(alpha)^2)`. If solar magnitude is only an
authored dimensionless relative scale, keep it as an internal nonphysical model
input; never publish it through `LightingTransportSnapshot`, and mark the
calibrated solar radiance/irradiance channels absent. The manifest records the
solar calibration status, per-channel quantity/unit/basis and conversion
revision, phase normalization, and whether solar magnitude is factored out of
reusable LUTs.

The three coefficient channels are a declared spectral/basis approximation,
not automatically display sRGB. Record representative wavelengths or basis
functions, integrate transport in that linear basis, then convert once to the
scene's linear working RGB. Scientific colorimetry requires enough wavelength
samples and a documented observer/illuminant integration; applying an sRGB
transfer function to LUT channels is invalid.

Preserve one explicit meter-to-render-unit conversion boundary. Provide tested
examples for `1 world unit = 1 meter` and `1 world unit = 1 kilometer`. Do not
let individual materials, nodes, or passes apply their own scale corrections.

## LightingTransportSnapshot

Publish cross-domain lighting through the router's canonical
[physics-domain and interaction contract](../../threejs-choose-skills/references/physics-domain-and-interaction-contract.md).
`LightingTransportSnapshot` is the immutable radiometric boundary between this
atmosphere and clouds, water, materials, vegetation, particles, and weather.
Do not pass an untyped `sunColor`, `skyColor`, or already-darkened light
uniform across that boundary.
Each sampled provider/resource keeps the router's canonical
`PhysicsSignalDescriptor` envelope—identity/schema/context, owner/consumers,
channels, physics frame/origin/transform revision, optional chart,
clock/sample phase, represented footprint/filter, descriptor `validity` whose
temporal domain is a `PhysicsTimeInterval`, per-channel
error, residency/cadence/latency, state version, resource generation, and
missing-channel policy. The enclosing `LightingTransportSnapshot` supplies
`sampleInstant: PhysicsInstant`. This reference defines radiometric channel
semantics, not a competing envelope. An instantaneous sample is never encoded
as a zero-length interval.

### Required metadata and provider projections

The snapshot declares:

```text
PhysicsContext revision, Cartesian physicsFrameId, physics-origin epoch and transform revision
snapshot/atmosphere parameter revisions and sampleInstant: PhysicsInstant
descriptor validity with an actual temporal PhysicsTimeInterval
spatial support, update cadence, interpolation/hold policy and per-channel errors
sample-to-sun unit direction in physicsFrameId; sun angular radius
solar quantity kind: normal irradiance | finite-disc radiance
per-channel quantity kind, SI unit, angular support, and, where applicable,
  spectral/angular basis and conversion revision
finite-disc solid-angle convention
optional named transform registry to scene-linear working RGB; it never
  overrides PhysicsChannelDescriptor or SampledChannel metadata
transmittance-to-sun provider and its atmosphere/body-occlusion domain
direct-sun provider with versioned attenuationFactorIds
sky-radiance and normal-dependent sky-irradiance providers, each declaring
  whether the direct solar disc is included
camera-segment transmittance and inscattering providers
provider-specific dependency revision, encoding, cadence and per-channel reference errors
```

Every request carries the snapshot/context revision, `physicsFrameId`, transform
revision, physics-origin epoch, `requestedPhysicsTime: PhysicsTime`, requested
filter/footprint, maximum staleness, and consistency policy. These lighting
queries select the wrapper's `instant: PhysicsInstant` arm and encode its
inverse `interval` arm as a canonical `TypedAbsence` record; a raw instant is
not substituted at this generic request boundary. Positions/endpoints are SI
metres in that physics frame. Responses return the actual represented
footprint/filter, latency, and per-channel time/error through the canonical
`PhysicsSignalDescriptor` envelope. The minimum semantic signatures are:

```text
sampleSunTransmittance(positionPhysicsMeters, toSunPhysics,
                       spatialFootprintMeters,
                       solarAngularFootprintSteradians, requestedPhysicsTime)
sampleDirectSun(positionPhysicsMeters, toSunPhysics,
                spatialFootprintMeters,
                solarAngularFootprintSteradians, requestedPhysicsTime)
sampleSkyRadiance(positionPhysicsMeters, incomingPropagationPhysics,
                  angularFootprintSteradians, requestedPhysicsTime)
sampleSkyIrradiance(positionPhysicsMeters, receiverNormalPhysics,
                    spatialFootprintMeters, requestedPhysicsTime)
sampleCameraSegment(startPhysicsMeters, endPhysicsMeters,
                    spatialFootprintMeters, requestedPhysicsTime)
```

The actual ABI may batch queries or expose textures/LUTs, but its adapter must
preserve these arguments and report unsupported footprint/time variation
rather than silently point-sampling. `sampleCameraSegment` returns both RGB
transmittance and RGB inscattering for the same oriented endpoints. A reversed
segment is a different request. `toSunPhysics` points from sample to sun.
`incomingPropagationPhysics` points in the direction photons travel at the
sample; for an outward ray `directionToSky`, request
`incomingPropagationPhysics = -directionToSky`. All direction/normal vectors
are unit polar vectors in `physicsFrameId`.

Every returned `SampledChannel` includes

```text
channelId; quantity kind; SI unit
spectral/angular basis and conversion revision where applicable
actualPhysicsTime: PhysicsTime {
  kind: instant,
  instant: PhysicsInstant,
  interval: TypedAbsence
}; actual support/filter; validity and error
stateVersion
```

The instant and absence records are the canonical wrapper arms, not shorthand
strings or nullable fields. Lighting channels do not encode their instantaneous
sample as a zero-length interval.

The enclosing `LightingTransportSnapshot` carries atomic bundle validity, the
per-channel error map and correlation, explicit `absentChannels`, and
`attenuationFactorIds: [versioned-factor-id]`.

Each factor ID identifies one applied physical attenuation/visibility operation
and its model revision/path. Consumers reject applying an already listed
factor. An empty list means no attenuation factor was applied; it does not mean
the channel itself is present. A boolean attenuation flag is not composition
evidence.

Use `toSunPhysics` for the unit polar direction from the sample toward the sun
in `physicsFrameId`; if a consumer stores photon propagation, name it
`incomingPropagationPhysics = -toSunPhysics`. The solar record carries either
`E_normal` in `W m^-2` (or a declared spectral SI equivalent) or finite-disc
radiance in `W m^-2 sr^-1` (or a declared spectral SI equivalent). An authored
dimensionless relative scale remains an internal nonphysical model input and is
never a `LightingTransportSnapshot` radiance/irradiance channel; without SI
calibration those physical channels are absent. The relation
`L_sun = E_normal / (pi sin^2(alpha))` is applied exactly once for the uniform
disc convention.

Provider output factor ledgers carry attenuation status. A consumer selects
one of:

```text
A. sourceAtTopOrVacuum * T_atmosphere(sample -> sun)
B. directAtSample, attenuationFactorIds contains the atmosphere path factor
```

Using `B * T_atmosphere` is a hard double-attenuation failure. A pre-evaluated
direct value also states whether body/terrain visibility is included; the
default atmosphere snapshot includes atmospheric transport and body occlusion
from its shell model, not cloud or arbitrary scene-mesh shadows.

Cloud and geometry factors remain orthogonal:

```text
E_surface_direct = E_after_atmosphere
                   * T_cloudOnly
                   * V_opaqueGeometry
```

Water-volume extinction acts on the camera/light path inside water and is not
part of the atmosphere transmittance. Aerial perspective owns the
camera-to-surface segment composition
`C_scene*T_segment + S_segment`; a material cannot reapply the same segment
transport. Record the component ledger in diagnostics so a dark result cannot
hide duplicated factors.

Sky radiance `L_sky(x,omega)` and sky irradiance `E_sky(x,n)` are distinct
providers. `E_sky` includes the declared hemisphere/cosine integration over
atmospheric sky radiance; consumers may use it for diffuse lighting. By
default, both diffuse-sky providers set `includesDirectSolarDisc: false` and
the direct provider owns the disc. If a product includes the disc, it sets the
flag and factor ID explicitly and consumers must not add direct solar energy a
second time. A cloud may sample directional `L_sky` in its scattering
quadrature. Neither consumer may reinterpret irradiance as radiance without an
angular closure.

### Spectral and working-basis ownership

Transport LUT channels remain in their declared spectral/basis space until the
snapshot's one named conversion. Every returned `SampledChannel` declares
`spectral-basis` or `scene-linear-working-basis` and the applicable conversion
matrix/integration revision; provider-level metadata may not replace the
channel declaration. Clouds, water, and materials must not repeat that
conversion or apply an sRGB transfer function to transport data. If a consumer
requires a different spectral resolution, it requests another provider or
declares a bounded approximation; it does not guess channel wavelengths.

### Environment forcing is separate

`EnvironmentForcingSnapshot` carries thermodynamic/mechanical state such as air
velocity, temperature K, pressure, and canonical specific humidity in
`kg kg^-1`. Its `sampleInstant: PhysicsInstant`, while every atmosphere request
against its instantaneous channels carries `requestedPhysicsTime: PhysicsTime`
with the `instant` arm selected and the `interval` arm a canonical
`TypedAbsence` record. Returned forcing channels use the same arm selection in
`actualPhysicsTime`; raw `PhysicsTimeInterval` is used only for an actual
validity interval or
`PhysicsGraphStage.executionInterval: PhysicsTimeInterval`. This skill does not
become the wind or weather owner merely because it models an atmosphere. When forcing changes
optical parameters, record the forcing revision and the transfer model into the
affected LUT dependency hashes. Relative humidity, aerosol concentration,
extinction, and RGB haze color are not interchangeable state variables.

### Publication and invalidation order

Publish a lighting snapshot only after every provider it exposes is internally
revision-consistent, then follow the canonical acyclic presentation chain:

```text
latch PhysicsContext and optional
     EnvironmentForcingSnapshot.sampleInstant: PhysicsInstant
  -> update dirty base LUTs and view-independent solar products
  -> publish one LightingTransportSnapshot.sampleInstant: PhysicsInstant
     atomically
  -> after every physical owner commits, publish one view-independent
     PhysicsPresentationCandidate with
     requestedPresentationInstant: PhysicsInstant, presentedStatePairs,
     resourceLeases, and eventSequenceRanges
  -> per target/view publish CameraViewPublication with
     previousRenderSampleInstant: PhysicsInstant and
     currentRenderSampleInstant: PhysicsInstant
  -> per target/view publish ViewPreparationPublication for camera-dependent
     sky/aerial products, visibility, shadows, caches, reactive state, and resets
  -> seal PhysicsPresentationSnapshot with candidateId, presentedStatePairRefs,
     resourceLeaseRefs, scoped eventSequenceRanges, cameraPublicationId,
     and viewPreparationId
  -> render consumes only the sealed snapshot and its transitive publications
```

The candidate contains no camera, render origin, view matrix, shadow/cache
epoch, or `globalToRender` mapping. Each `PresentedStatePair` carries separate
`previousPresented.provenance` and `currentPresented.provenance` records, each a
complete `PresentationSampleProvenance` with its own requested and mapped
`PhysicsInstant`, clock-map revision/error, lower/upper brackets,
interpolation/extrapolation policy, frame/origin/transform revisions, and
resource generation. Each arm also carries its own
`presentedInstant: PhysicsInstant`. Static or low-rate state still uses an
explicit `hold` or `not-interpolated` policy; there is no shared bracket or
graph-wide alpha.

`CameraViewPublication` alone owns
`previousRenderSampleInstant: PhysicsInstant`,
`currentRenderSampleInstant: PhysicsInstant`, camera and
projection revisions, view/projection matrices, viewport/depth convention, and
`globalToRenderPrevious`/`globalToRenderCurrent`. `ViewPreparationPublication`
consumes the immutable candidate and camera publication and owns per-view
sky/aerial products through `visibilityPublicationRefs`,
`accelerationPublicationRefs`, `shadowViewPublicationRefs`,
`cachePublicationRefs`, `reactiveEpochs`, `reactivePublications`,
`resetDependencies`, full `resourceLeases` for newly created view-dependent
generations, and Candidate/same-preparation `resourceLeaseRefs`. Beyond identity,
target/view scope, seal metadata, and scoped `eventSequenceRanges`, the sealed snapshot stores
`candidateId`, `presentedStatePairRefs`, `resourceLeaseRefs`,
`cameraPublicationId`, and `viewPreparationId`; it does not copy pairs,
provenance, camera matrices, or `globalToRender` transforms.

Clouds, materials, and water latch completed provider versions for their next
scheduled update. View preparation may consume the current immutable candidate
but may not mutate it or create a same-phase shadow/cache cycle.

A stale but valid snapshot carries age and error; a half-updated combination of
new transmittance with old irradiance is never published. Floating-origin
translation updates the context epoch/transform but does not regenerate
body-frame LUTs whose physical dependencies are unchanged.

On mobile, publish the same interface from cached base LUTs, compact sky-view
and aerial products, amortized slices, or a reference-gated analytic minimum.
Lower resolution/cadence changes provider error and age, not units, attenuation
ownership, or the consumer API.

## LUT Products

Required products:

- transmittance LUT: optical depth from atmosphere point and sun/view cosine to
  top boundary;
- multiscatter LUT: higher-order scattering approximation shared by sky and
  aerial perspective;
- sky-view LUT: body-local horizon-frame sky radiance for current anchor
  altitude/local-curvature model and sun zenith;
- aerial products: cumulative RGB inscattering plus cumulative RGB optical
  depth over view direction/depth, or a validated endpoint reconstruction for
  the optical depth;
- optional irradiance LUT: material sky-light integration for node materials.

Imported or generated assets must have a manifest with:

```text
dimensions
storage format and channel layout
byte order for binary assets
source atmosphere parameters
per-channel quantity kind, SI unit, and applicable spectral/angular basis/conversion revision
integration length/coefficient units
solar calibration: SI normal irradiance, SI disc radiance, or an internal
  authored relative scale with `LightingTransportSnapshot` solar channels absent
phase normalization and spectral band wavelengths/basis
source algorithm/revision
hashes
mip/filter/wrap policy
color space
parameterization and inverse-map revision
reference-integrator error report
```

Before an imported LUT is sampled, compare the manifest against the live model:
bottom/top radii or axes, every scattering/extinction coefficient, every
density layer, integration/coefficient units, phase function/normalization and
direction convention, solar quantity, solar angular radius/magnitude, and the
spectral basis must match. A byte/hash-valid but model-incompatible LUT is not a
cache hit. The Phase 1 fixture executes this metadata equality gate; it still
labels source transport accuracy unproved because the imported manifest has no
reference-error bundle.

Use `NoColorSpace`, clamp wrapping, deterministic dimensions, and documented
filtering for LUT/data textures. Use `HalfFloatType` or a measured smaller data
format only when precision tests pass against fixed camera/sun cases.

### Spherical LUT parameterization

Do not describe a LUT only by dimensions. Publish the forward map, inverse map,
valid-domain mask, texel-center convention, and interpolation domain. For a
spherical shell with bottom radius `Rg`, top radius `Rt`, point radius `r`, and
ray zenith cosine `mu`, a well-conditioned transmittance map for rays that reach
the top boundary without hitting ground is:

```text
H       = sqrt(Rt^2 - Rg^2)
rho     = sqrt(max(r^2 - Rg^2, 0))
d       = -r*mu + sqrt(max(r^2*(mu^2 - 1) + Rt^2, 0))
dMin    = Rt - r
dMax    = rho + H
xR      = rho / H
xMu     = (d - dMin) / max(dMax - dMin, eps)
```

The **[Derived]** inverse is:

```text
rho  = H*xR
r    = sqrt(rho^2 + Rg^2)
d    = mix(Rt-r, rho+H, xMu)
mu   = (Rt^2 - r^2 - d^2) / (2*r*d)   # use mu=1 when d is zero
```

Guard the discriminant before `sqrt`; do not turn a true miss into a tangent by
unconditional clamping. Test `map(inverse(texel))` and
`inverse(map(physicalSample))` at boundaries. If endpoint coordinates
`x=i/(N-1)` are stored, the sampler coordinate is **[Derived]**
`u=(x*(N-1)+0.5)/N`; sampling `u=x` shifts endpoints by half a texel. Rays below
the geometric horizon use an explicit ground-hit branch and visibility mask,
not extrapolated top-boundary texels.

For an axisymmetric spherical model, multiscatter and irradiance use
`xR=rho/H` and `xSun=0.5*(mu_s+1)`. Because current sun zenith is a coordinate,
sun rotation does not invalidate these base LUTs. Solar magnitude should be
factored out when the transport is linear, allowing exposure or stellar power
changes without recompute.

For a sky-view LUT at camera radius `r_c`, let `mu=dot(view,up)` and the
**[Derived]** horizon cosine be
`mu_h=-sqrt(max(1-(Rg/r_c)^2,0))`. A horizon-dense, invertible split map is:

```text
qSky    = (mu - mu_h) / (1 - mu_h)
qGround = (mu_h - mu) / (1 + mu_h)
y = 0.5 + 0.5*sqrt(qSky)       when mu >= mu_h
y = 0.5 - 0.5*sqrt(qGround)    otherwise
x = fract(phiSunRelative/(2*pi) + 0.5)
```

The square-root warp is **[Authored]** but its inverse and horizon continuity
are **[Derived]**. Make `x` periodic; duplicate or manually wrap the seam because
clamp wrapping alone cannot interpolate azimuth `0` against `2*pi`. At zenith,
where azimuth is undefined, choose a deterministic tangent basis and verify
that radiance is azimuth-invariant to the gate tolerance.

The sky-view camera anchor is inside the top shell. For an exterior camera,
intersect the view ray with the top boundary and evaluate from the entry point;
do not extrapolate `xR` above one or clamp an orbital camera to a fake altitude.

### Aerial froxel parameterization and payload

Reconstruct each froxel's ray from the **unjittered** inverse projection at its
texel center. For normalized slice coordinate `z`, a useful zero-origin depth
map is:

```text
d(z) = dMax * (exp(k*z) - 1) / (exp(k) - 1),  z in [0,1]
```

`d(0)=0` and `d(1)=dMax` are **[Derived]**; `k` is **[Authored]** and must be
selected by measured near/horizon error. Store cumulative `S_rgb(0->d)` and
either cumulative `tau_rgb(0->d)` in a second volume or reconstruct it from a
validated endpoint optical-depth LUT:

```text
choose w in {segmentDirection, -segmentDirection} such that p and q both
  reach the same top boundary along w without crossing ground
tauSegment = abs(tauToTop(p,w) - tauToTop(q,w))
T_rgb      = exp(-tauSegment)
C_out      = C_scene * T_rgb + S_rgb
```

Interpolating optical depth is normally better conditioned than interpolating
very small transmittance. One `RGBA16F` froxel containing `S_rgb` and scalar
alpha is a reduced chromatic model, not the full contract. It is allowed only
if the error report proves the scalar approximation on every accepted body and
sun case. If neither orientation reaches a common top boundary, the segment
crosses the opaque body and endpoint subtraction is invalid; use the clipped
visible interval instead.

### Error and convergence gates

Generate references with a CPU float64 or GPU float32 high-step integrator at
stratified physical samples, including horizon, shell tangent, ground tangent,
night terminator, and optically thick paths. Starter acceptance gates are:

- **[Gated]** `max(abs(tau_test-tau_ref)) <= 0.02` per band;
- **[Gated]** radiance relative error, using denominator
  `max(L_ref, 1e-3*referencePeak)`, `p95 <= 2%` and `max <= 5%`;
- **[Gated]** no radiance below `-1e-6*referencePeak`, no NaN/Inf, and
  transmittance within `[-2^-11, 1+2^-10]` before the final physical clamp;
- **[Gated]** phase quadrature integrates each phase function to `1 +/- 0.5%`;
- **[Gated]** hemispherical escaped plus absorbed flux does not exceed incident
  flux by more than the reference quadrature residual.

These thresholds are starting gates, not physical constants. Tighten them for
scientific colorimetry or high-dynamic-range solar discs. A tier is valid only
when its own dimensions, format, steps, and interpolation satisfy the gates;
resolution alone is not evidence.

## Compute Generation Order

1. Validate units, coefficient inequalities, density-layer continuity, radii,
   payload formats, and dependency hashes on the CPU.
2. Dispatch transmittance integration. This is a compact 2D grid and updates
   only when the atmosphere profile changes.
3. Dispatch multiscatter and irradiance response. Update only when the exact
   dependency table changes; factor solar magnitude and parameterized sun
   direction out where transport linearity permits.
4. Dispatch sky-view for camera body-relative altitude/local latitude model,
   local sun zenith, and tier. Camera yaw, roll, projection jitter, and a pure
   floating-origin translation do not dirty a body-frame sky-view LUT.
5. Dispatch or reproject aerial products for the unjittered camera pose,
   projection, viewport, depth distribution, and body-relative transform.
   Update dirty slice ranges under an explicit age/error gate; never mix fresh
   inscattering with stale optical depth. Disoccluded froxels receive current
   integration rather than history.
6. Compose in the render pipeline from scene color and pass depth. The
   full-resolution TSL composition node samples LUTs and froxels; it does not
   integrate atmosphere.

Use bounded ray/segment math inside compute kernels: monotone ray advance,
transmittance early exit, explicit ground/sun occlusion, stratified or
error-controlled quadrature, and fixed maximum iterations per tier. A fixed
step count is **[Authored]**; its reference error is **[Measured]** and gated.
Expensive updates are split by invalidation cause rather than recomputed every
frame.

## Ellipsoid And Depth Ownership

Atmosphere altitude is never `worldPosition.y`. Declare one body-space model
and make terrain, atmosphere, depth reconstruction, and diagnostics consume it:

```text
world position -> floating-origin correction -> world-to-body/ECEF
  -> declared sphere/similar-ellipsoid/geodetic altitude model
  -> ray-shell interval -> LUT coordinates and segment transport
```

### Ellipsoid models are not interchangeable

Choose exactly one contract:

1. **Sphere**: global 2D LUT symmetry is exact. Use when the body is spherical
   by definition or when a quantified error budget permits it.
2. **Similar/coaxial ellipsoids**: bottom/top axes are declared and density is
   a scaled-radial shell coordinate. Ray intersections are exact quadratics,
   but this coordinate is not WGS84 geodetic height.
3. **Geodetic oblate ellipsoid**: height is measured along the reference
   ellipsoid normal. A constant-geodetic-height top surface is not exactly the
   quadric obtained by adding height to both axes. Global spherical 2D LUT
   symmetry is broken; add latitude/curvature parameterization, use local
   osculating-radius LUTs plus a gated residual, or integrate the correction in
   the view product.

For a declared ellipsoid with semi-axes `a=(ax,ay,az)`, transform a body-space
ray `o+t*d` by `o'=(o-center)/a`, `d'=d/a` and solve:

```text
A = dot(d',d')
B = 2*dot(o',d')
C = dot(o',o') - 1
D = B^2 - 4*A*C
```

Reject `D<0` except for a **[Gated]** scale-aware roundoff interval. Use stable
roots `q=-0.5*(B+signNonZero(B)*sqrt(D))`, `t0=q/A`, `t1=C/q`, with the tangent
special case handled explicitly. Sort roots, intersect the positive ray
interval, and subtract the bottom-body interval from the top-shell interval.
This avoids catastrophic cancellation on orbital tangent rays.

For WGS84-style oblate height, compute geodetic latitude/height with a
Bowring/Newton solution and a pole branch; do not call radial distance minus an
average radius “geodetic altitude.” The surface and atmosphere owners must use
the same solver and axes. Any local-radius approximation publishes maximum
altitude, limb-position, and optical-depth error versus the exact body model.

### r185 depth contract

The render pipeline owns one readable depth/coverage signal. Verified r185
behavior:

- `PassNode.getViewZNode()` calls `perspectiveDepthToViewZ()`; use it for
  perspective standard or reversed depth.
- `perspectiveDepthToViewZ()` and `orthographicDepthToViewZ()` inspect
  `renderer.reversedDepthBuffer`. Do **not** pre-flip `1-depth`.
- `PassNode.getLinearDepthNode()` maps view Z to normalized orthographic depth;
  it is not meters and not Euclidean ray length.
- logarithmic depth uses `logarithmicDepthToViewZ(depth, near, far)` in r185;
  the old `logDepthBufFC` argument is not this API. Reject simultaneous reversed
  plus logarithmic depth unless an installed-source test proves the chosen
  encoding.
- orthographic cameras require `orthographicDepthToViewZ()`; do not use the
  pass's perspective helper.

For a normalized perspective view ray `v_view` with `v_view.z<0`, metric ray
distance to a surface is **[Derived]**
`s = (-viewZ)/(-v_view.z)`. Using `-viewZ` directly underestimates off-axis
segments. Reconstruct body-space position with the same unjittered or jittered
matrix convention used to create depth. For orthographic cameras, reconstruct
the per-pixel ray origin on the near plane and advance along the constant view
direction.

Do not classify sky with a magic `0.999999` threshold across encodings. Prefer
an explicit coverage output or compare against the renderer's declared clear
depth using the active standard/reversed/log encoding. For multisampling,
atmosphere consumes a documented single-sample depth/coverage resolve. Averaged
depth is invalid; a conservative nearest-surface resolve is min depth for
standard encoding and max depth for reversed encoding. If r185 cannot expose a
readable resolved depth for the chosen sample setup, use a single-sample scene
pass with temporal AA rather than a duplicate atmosphere-only geometry render.

Gate standard perspective, reversed perspective, logarithmic perspective,
orthographic, sky coverage, clipped surfaces, oblique rays, and every enabled
MSAA policy with world-position reconstruction error in world units. Normals or
a light mask are optional inputs only for explicit surface relighting; pure
transmittance plus inscattering does not require them.

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

The same ray-shell interval works below, inside, and above the atmosphere, so a
correct LUT/froxel path does not require authored kilometer switch distances.
Clip the camera-to-surface segment against the top-shell interval and integrate
only the overlap. If a shell raster is retained for fill-rate or precision
reasons, blend ownership with a **[Derived]** geometric overlap or an
**[Gated]** error estimate, not fixed `140 km`/`448 km` constants:

```text
segment = intersect(cameraRay, topShell) minus interior bottomBody interval
ownerWeight = smoothstep(errorLow, errorHigh, estimatedPostError)
L = mix(L_shell, L_post, ownerWeight)   # weights sum to one
```

The same body axes/radii, integration unit, sun frame, and profile drive both
owners. Do not add LUT and dynamic-integrated radiance at full weight. Validate
continuity in radiance and first spatial derivative through entry, exit, limb,
and horizon sweeps.

## Color And Output

- Color art textures use `SRGBColorSpace`.
- LUTs, density maps, weather masks, depth, normals, transmittance,
  optical-depth, and diagnostic textures use `NoColorSpace` linear data.
- Atmosphere radiance is scene-linear HDR until the app's single tone-map
  owner. Use `HalfFloatType` for HDR buffers unless a measured tier proves a
  smaller format is acceptable.
- The atmosphere node must not apply display conversion twice. Let
  `RenderPipeline.outputColorTransform` handle the normal final transform, or
  when `renderOutput()` owns final presentation set
  `RenderPipeline.outputColorTransform = false`.
- Exposure belongs to the host camera/image pipeline. It may scale physically
  authored radiance, but it must not compensate for broken units or LUTs.

## Workload And Performance Evidence

Texture memory is **[Derived]** as
`width*height*depth*channels*bytesPerChannel`, excluding alignment, views, and
temporary ping-pong allocations. RGBA16F is eight bytes/texel:

| Product | Example format | Approx memory |
| --- | --- | ---: |
| 256x64 transmittance RGBA16F | data LUT | 128 KB |
| 192x108 sky-view RGBA16F | per-camera LUT | 162 KB |
| 128x64 sky-view RGBA16F | per-camera LUT | 64 KB |
| 64x32 multiscatter RGBA16F | shared LUT | 16 KB |
| 96x54x24 two aerial RGBA16F products | minimum-tier scattering + optical depth | 1.90 MiB |
| 160x90x32 one aerial RGBA16F product | froxel volume | 3.52 MiB |
| 160x90x32 two aerial RGBA16F products | RGB scattering + RGB optical depth | 7.03 MiB |
| 192x108x48 two aerial RGBA16F products | full-tier scattering + optical depth | 15.19 MiB |
| 320x180x32 one aerial RGBA16F product | froxel volume | 14.06 MiB |
| 320x180x32 two aerial RGBA16F products | RGB scattering + RGB optical depth | 28.13 MiB |

Workload accounting is **[Derived]** from the selected trial:

```text
payloadBytes = sum(width*height*depth*bytesPerTexel*residentCopies)
invocations = width*height*depth
workgroupInvocations = wgX*wgY*wgZ
r185FlattenedGroups = ceil(invocations/workgroupInvocations)
integratorSamples = sum(updatedTexels*samplesPerTexel)
```

For numeric r185 `Fn().compute(invocations, [wgX,wgY,wgZ])`, the backend's
actual dispatch is `[r185FlattenedGroups,1,1]` until the adapter's
`maxComputeWorkgroupsPerDimension` forces wrapping into Y. The authored fixture
trials remain below WebGPU's minimum limit. Sum unique kernel dispatches, not
payload products: its one `aerial-products` kernel writes both volumes and is
counted once.

Update cadence and history copies change both bytes and work; record them in
the ledger. No device-class timing or memory ceiling in this reference is a
product gate.

`LightingTransportSnapshot` carries descriptor/handle generations, not copies
of every LUT or froxel. Count in-flight resource slots, factor ledgers, provider
tables, candidate `PresentedStatePair` handles and leases, per-view camera and
preparation publications, sealed snapshots, and quality-transition overlap.
Consumers use declared same-queue ordering or a versioned host/analytic mirror;
never add a steady-frame LUT readback to answer a CPU lighting query.

Warm profile changes may spend more time for base-LUT regeneration, but
camera-only movement updates only view-dependent products. On mobile, use a
single full-screen composition, render-scale-aware froxel dimensions, cached
base LUTs, slice amortization/reprojection with age and disocclusion gates, and
no CPU readback. Do not allocate both an atlas and a 3D volume for the same
payload; resize only on tier/aspect bucket transitions and dispose replaced
storage textures after submission ownership is complete.

That resize rule applies to a camera-bound production implementation. The Phase
1 fixture has fixed authored grid/projection constants, records a host viewport
only as evidence metadata, performs no resource resize, and reports resize as
not applicable rather than pretending to react to aspect changes.

A **[Measured]** row names Three revision, browser/OS, adapter, power and
thermal state, CSS viewport, DPR, drawing-buffer extent, formats, complete pass
graph, LUT update cadence, timestamp source, warmup, and sample window. Report
full-frame and atmosphere paired-A/B GPU p50/p95 plus CPU submit p50/p95; do not
sum subsystem percentile tables or treat one warm frame as steady-state cost.

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
per-product dependency hash, age, and invalidation reason
LightingTransportSnapshot sampleInstant/revision, provider request arguments and factor ledgers
candidateId/presentedStatePairRefs/resourceLeaseRefs, cameraPublicationId,
  viewPreparationId, eventSequenceRanges, and sealVersion
direct-solar-disc inclusion; per-channel quantity/SI unit/filter/error and applicable spectral-angular basis/conversion revision
reference tau/radiance error and energy residual
RGB optical depth versus any scalar-transmittance approximation
manifest hash and byte-count checks for imported LUT assets
```

Required tests:

- CPU-equivalent ray/segment intersection tests, including closest-point
  outside-atmosphere cases;
- forward/inverse LUT maps at endpoints, texel centers, horizon splits, azimuth
  seam, and random physical samples;
- top-atmosphere miss cases are explicitly guarded before square roots;
- fixed sun/camera screenshots for sea level, mountain altitude, low orbit,
  high orbit, horizon, night side, and shell entry;
- depth reconstruction tests for every enabled projection/depth mode;
- LUT byte-count, format, dimension, channel, hash, and unit checks for
  imported assets;
- timing captures for each quality tier.
- homogeneous-medium unit fixtures, phase-normalization quadrature,
  single-scattering convergence, multiscatter energy balance, and half-float
  error against the reference integrator;
- invalidation tests proving that camera yaw, projection jitter, and
  floating-origin translation do not refresh unchanged body-frame LUTs;
- payload tests proving chromatic segment transmittance for the accepted aerial
  representation.
- typed-provider fixtures over position, direction/normal, segment endpoints,
  spatial/solid-angle footprint, frame/origin epoch, and
  `requestedPhysicsTime: PhysicsTime` selecting the instant arm with a
  `TypedAbsence` interval arm, including stale, interval-arm, malformed-absence,
  and unsupported-footprint rejection;
- factor-ledger tests proving atmosphere, cloud, geometry, water, and aerial
  segment factors are each applied once and duplicate factor IDs are rejected;
- sky-radiance/irradiance fixtures with the direct solar disc both excluded and
  explicitly included, proving total direct-plus-diffuse energy is not counted
  twice;
- presentation fixtures proving the candidate is view-independent, previous and
  current provenance are independent, per-view camera/preparation publications
  precede sealing, and the snapshot contains references rather than copied pairs
  or `globalToRender` transforms;

Phase 1 structural/equation gate:

```sh
node examples/webgpu-lut-atmosphere/validation.js
```

The validation module exports and exercises `validateAtmosphereConfig()` and
`validateAtmosphereLuts()`, rejects corrupt parameters or byte counts, checks
the imported LUT manifest SHA-256 values and live-model compatibility, proves
the top-atmosphere miss guard, normalizes HG through `g=+/-0.99`, and
round-trips standard, reversed, logarithmic, orthographic, and CPU-resolved
MSAA depth. It checks base-level-only mip policy, fixed-grid resize
non-applicability, and disposal ownership. It does not prove GPU dispatch,
raster composition, image quality, timings, or peak live memory.

## Replaced Techniques

- Replaced per-pixel nested view/light integration as the production path with
  compute-generated transmittance, multiscatter, sky-view, and aerial froxel
  LUTs. The old method remains useful for offline validation and tiny debug
  comparisons, but not as the taught runtime architecture.
- Replaced artist-only multiple scattering derived from `1 - transmittance`
  with a validated multiscatter LUT. An approximation may be a minimum-WebGPU-
  tier placeholder only when its reference error is documented and gated.
- Replaced the ambiguous one-RGBA aerial payload with explicit RGB
  inscattering plus RGB optical-depth ownership, or a reference-gated endpoint
  reconstruction.
- Replaced fixed-altitude shell/post blend constants with ray-shell geometry
  and error-gated ownership.
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
- meter radii are combined with inverse-kilometer coefficients;
- a spherical two-dimensional LUT is claimed exact for a geodetic ellipsoid;
- r185 reversed depth is manually flipped before a conversion that already
  handles it, or normalized linear depth is treated as metric distance;
- direct sun, sky-light relighting, segment transmittance, and inscattering are
  merged into one signal;
- a one-alpha aerial payload is presented as RGB transmittance without a
  reference error gate;
- LUTs are loaded without manifest validation;
- LUTs refresh from a global dirty flag rather than their dependency hashes;
- output is tone mapped or color-converted twice;
- atmosphere ownership pops at shell entry or horizon transitions.
