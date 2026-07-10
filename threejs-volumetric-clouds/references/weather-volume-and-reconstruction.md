# Weather-Shaped Cloud Volume And Reconstruction

Use this reference for planetary or large-world volumetric clouds in pinned
Three.js r185 when the implementation path is `WebGPURenderer`, TSL, node materials,
node `RenderPipeline`, and compute/storage resources. The target architecture is
not an unbounded fixed-step raymarch. Broad coverage uses a reduced-resolution
bounded march with spatiotemporal blue-noise sampling, transmittance early exit,
adaptive stepping, velocity/depth-aware temporal reprojection, cloud shadow
generation in the same frame chain, and depth-aware full-resolution upsample.
A small projected bounded volume may instead use a full-resolution scissored
march without history when the complete A/B wins.

## Contents

1. Performance architecture
2. Capability gate and tiers
3. Texture, storage, and color contract
4. Physical/approximation boundary and units
4a. Shared environment, precipitation, and lighting boundary
5. Layered density topology
6. Packed intervals and conservative empty-space skipping
7. Weather, shape, turbulence, and detail fields
8. Primary march policy
9. Lighting and cloud shadows
10. Temporal reprojection and upsample
11. Workload, memory, and bandwidth gates
12. Diagnostics and failure diagnosis
13. Replaced techniques

## 1. Performance Architecture

Choose the spatial branch from projected coverage and temporal coherence before
allocating passes:

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
4. Beauty branch:
   - small projected bounded volume: full-resolution scissored current-frame
     march; write radiance/transmittance and omit history when it does not win;
   - broad coherent coverage: measured reduced-resolution march; write current
     radiance, transmittance, representative depth, velocity, and rejection
     hints.
5. Broad-coverage temporal branch only: reproject history using cloud velocity
   and representative depth, reject invalid history, variance-clip accepted
   history, and swap history storage.
6. Broad-coverage upsample/composite: use scene depth and neighborhood depth
   agreement to reconstruct cloud radiance/transmittance into the host node
   pipeline. The full-resolution scissored branch composites directly.

The primary raymarch is never the place to recover performance after the fact.
Compare the two complete branches first; then tune step counts inside the
selected topology.

Phase 1 validation scaffold: `examples/webgpu-weather-volume-clouds/`. Its
token/config validators cover API wiring, manifests, interval packing, and
storage accounting; they do not prove that the example implements the physical,
spatial, shadow, or temporal algorithms in this reference. Treat the reference
as the specification and add image/numerical gates before promoting that
scaffold to a canonical renderer. Run
`node examples/webgpu-weather-volume-clouds/validation.js` after changing its
contract, but do not treat a pass as visual or radiometric validation.

Current scaffold audit: `cloud-nodes.js` contains camera-basis ray
reconstruction, spherical/slab/OBB intersections, a supplied opaque-distance
clamp, independent compact-support layers, a fixed-sun short light march, and
separate metric depth/moment/velocity writes. This is source-level scaffold
coverage, not runtime evidence: its velocity is a first-order focal-length
wind/depth estimate rather than the projected motion of an advected
representative world point, and its outputs are not wired into the packed
temporal scaffold. `cloud-history.js` contains normalized-UV lookup,
metric-depth/spread and velocity rejection, response-time weighting, and a
five-tap RGB variance clip. It still lacks an instantiated/proven bilinear
filter policy, reset state machine, split histories, and an advected
representative-point motion source.
`cloud-shadows.js` now stores a valid R16F full-column optical depth for
opaque/ground receivers, but does not implement sun-space projection, cascade
scheduling, or in-cloud depth lookup. Do not copy these algorithms as canonical
until the numerical/image gates in section 12 pass.

## 2. Capability Gate And Tiers

Initialize the renderer before selecting the tier:

```js
await renderer.init();

if (renderer.backend.isWebGPUBackend) {
  // Canonical compute/storage tier.
} else {
  throw new Error("WebGPU backend unavailable for the canonical path.");
}
```

Do not put a second renderer architecture in this flagship reference. Lower
workload tuples below remain WebGPU paths with smaller grids, fewer samples, and
lower update cadence.

Quality tiers:

| Tier | Resolution | Temporal amortization | Main removals |
| --- | --- | --- | --- |
| Ultra | 1/2 linear | 4-8 frames | none; highest shadow and light samples |
| High | 1/2 linear | 4-8 frames | fewer shadow samples, fewer multiple-scattering octaves |
| Default | 1/4 linear | 8-16 frames | lower shadow resolution, no ground bounce by default |
| Reduced workload | 1/4-1/8 linear | 8-16 frames when coherence permits | no turbulence/detail at distance, lower-rate shadows, precomputed weather variants |

Even the reduced workload keeps weather-shaped density, bounded shell/depth
intervals, temporal reprojection, and some directional self-shadowing.

All counts and scales in this tier table are **Authored** starting points.
**Derived** values follow from equations/formats, **Gated** values follow from a
declared error limit, and **Measured** values require named hardware, browser,
Three.js revision, viewport/DPR, scene, thermal state, timestamp method, and
percentile.

## 3. Texture, Storage, And Color Contract

- Use `WebGPURenderer` from `three/webgpu`.
- Write GPU work in TSL `Fn().compute(count)` and dispatch through
  `renderer.compute()` or `renderer.computeAsync()`.
- Use `StorageTexture` for current cloud, history, rejection/debug masks, and
  shadow cascades; use `Storage3DTexture` when generated 3D fields must be
  writable; use `Data3DTexture` for immutable packed volume assets.
- Explicitly set format, type, min/mag filter, wrap, color space, and mipmap
  policy for every resource. In r185 `new StorageTexture(width, height)` is not
  an RGBA16F declaration and has `mipmapsAutoUpdate = true`; disable unused mip
  generation with `generateMipmaps = false` and `mipmapsAutoUpdate = false`,
  and never rely on constructor defaults for cloud data.
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
- With explicit `renderOutput()`, set
  `renderPipeline.outputColorTransform = false`. After replacing `outputNode`
  for a diagnostic, set `renderPipeline.needsUpdate = true`.

r185 import contract, verified by local import smoke test:

```js
import {
  WebGPURenderer, RenderPipeline, StorageTexture, Storage3DTexture,
} from "three/webgpu";
import {
  Fn, pass, mrt, renderOutput, storageTexture, storageTexture3D, textureStore,
} from "three/tsl";
import TRAANode, { traa } from "three/addons/tsl/display/TRAANode.js";
import TAAUNode, { taau } from "three/addons/tsl/display/TAAUNode.js";
```

`TRAANode` is not a cloud upscaler. The add-on
`three/addons/tsl/display/TAAUNode.js` provides temporal upscaling primitives,
but neither node supplies cloud advection, multi-depth topology, or cloud
history rejection automatically.

## 4. Physical/Approximation Boundary And Units

Choose one density convention and keep it end to end:

1. dimensionless shape `rho in [0, 1]` with base coefficients `beta_s` and
   `beta_a` in `m^-1`; or
2. physical mass density in `kg m^-3` with mass-specific coefficients in
   `m^2 kg^-1`.

The first is appropriate for authored clouds. Do not mix its density amplitude
with meter distances without an inverse-meter coefficient.

```text
sigma_s = rho * beta_s                 // m^-1
sigma_a = rho * beta_a                 // m^-1
sigma_t = sigma_s + sigma_a            // m^-1
omega_0 = sigma_s / max(sigma_t, eps)  // single-scattering albedo, [0,1]
tau(a,b) = integral_a^b sigma_t ds     // dimensionless
T(a,b) = exp(-tau(a,b))
dL(x,wo)/ds = -sigma_t L(x,wo) + j(x,wo)
```

For elastic single scattering:

```text
j_s(x,wo) = sigma_s * integral_S2 p(wi -> wo) * L_i(x,wi) dOmega_i
```

`j_s` has radiance per meter. A collimated-sun implementation may use an
irradiance form, but its solid-angle convention must be derived once; do not
silently treat irradiance as radiance. With coefficients/source constant over a
step:

```text
T_step = exp(-sigma_t * ds)
DeltaL = T_acc * (j / sigma_t) * (1 - T_step)
T_acc *= T_step
```

Use the limit `DeltaL = T_acc * j * ds` as `sigma_t -> 0`. These equations and
units are **Derived**. Code of the form `(source - source*T_step)/sigma_t` is
correct only when `source` means `j`, not incident radiance.

The normalized Henyey-Greenstein phase function is:

```text
p_HG(mu,g) = (1-g^2) / (4*pi*(1+g^2-2*g*mu)^(3/2)),  -1 < g < 1
2*pi*integral_-1^1 p_HG(mu,g) dmu = 1
```

For a dual lobe, require nonnegative weights that sum to one. Numerically
integrate each phase LUT/function over `mu` and gate normalization error before
visual tuning. A convention with integral `4*pi` is possible, but then every
source term must use that same convention.

| Component | Classification |
| --- | --- |
| Beer-Lambert attenuation with declared coefficients | Physical analytic step for a piecewise-constant medium |
| Normalized single scattering | Physical model with discretization and incident-light approximations |
| Dual-HG fit | Empirical phase approximation |
| Octave multiple-scattering compensation | Artistic/empirical unless validated against a reference solver |
| Powder, silver-lining boost, simple ground bounce | Artistic |
| Procedural weather/shape/detail density | Authored appearance topology, not cloud microphysics |
| Low-rate optical-depth shadow map | Numerical approximation with measurable transmittance error |

## 4a. Shared Environment, Precipitation, And Lighting Boundary

Use the router's
[physics-domain and interaction contract](../../threejs-choose-skills/references/physics-domain-and-interaction-contract.md)
for every cross-domain input or output. `EnvironmentForcingSnapshot` and
`LightingTransportSnapshot` are immutable versioned boundaries; a cloud-local
uniform block may cache their projection but may not redefine units, time,
frames, or ownership.
Their providers and GPU resources retain the canonical
`PhysicsSignalDescriptor` envelope: identity/schema/context, owner/consumers,
channels, physics frame/origin/transform revision, optional chart,
registered clock/sample phase, represented footprint/filter, validity and
per-channel error, residency/cadence/latency, state version, resource
generation, and missing-channel policy. `EnvironmentForcingSnapshot` and
`LightingTransportSnapshot` use `sampleInstant: PhysicsInstant`;
`PrecipitationEmissionSnapshot` uses
`emissionInterval: PhysicsTimeInterval`. Their `SampledChannel.actualPhysicsTime`
fields use the corresponding exact `PhysicsInstant` or `PhysicsTimeInterval`
type. The cloud fields below specialize channels only.

### Air motion and thermodynamic forcing

Sample environmental air velocity `u_air(x,t)` in `m s^-1` at
`EnvironmentForcingSnapshot.sampleInstant: PhysicsInstant`, from its declared
Cartesian SI physics frame, altitude/support domain, actual temporal validity
in descriptor `validity` as a `PhysicsTimeInterval`, cadence,
interpolator, requested oriented physical footprint and spatial/temporal filter
or band, returned actual footprint/filter, and per-channel error. The returned
air-velocity channel has `actualPhysicsTime: PhysicsInstant`. Advect a material
cloud feature with

```text
dx_feature/dt = u_air(x_feature,t) + u_relative(x_feature,t)
```

where `u_relative` is a named cloud-topology evolution velocity relative to the
air. It is not a second wind. Water material current, water-surface point
velocity, vegetation modal displacement, and camera-relative texture phase are
different quantities and cannot satisfy this input.
If the forcing exposes mean/gust/turbulence bands, its descriptor declares
which are disjoint and which are already included in `airVelocityMps`; the cloud
never sums overlapping bands or republishes a filtered sample as a new wind.

For a coarse/mobile tier, sample a low-order altitude profile or a bounded
piecewise-constant wind cell and integrate its displacement over the complete
interval. The provider's spatial/temporal interpolation residual becomes part
of the density-advection and shadow-age error. `currentWind * elapsedTime`
remains invalid under a changing forcing snapshot.

Temperature, pressure, and humidity are consumed only when the density,
phase/coefficients, evaporation, or precipitation model declares the transfer
function and thermodynamic convention. Relative humidity, specific humidity,
and mixing ratio are not interchangeable; normalize to canonical specific
humidity before snapshot publication. An authored coverage map is not
meteorological state merely because it samples those controls.

### Appearance-only versus causal precipitation

Declare one mode in the route manifest:

| Mode | Cloud output | Downstream meaning |
| --- | --- | --- |
| `appearance-only` | precipitation-emission channel absent | `precipitationBias` shapes density/appearance only; downstream physics treats the channel as unavailable, not as a measured zero |
| `causal-precipitation` | liquid/ice phase-fraction-resolved `PrecipitationEmissionSnapshot` with oriented mass-area flux | rain/snow transports a dimensioned source to receiver surfaces on a declared scheduler edge |

A causal cloud model first discriminates its internal measure:

- `area-flux`: `q_p` in `kg m^-2 s^-1` on a declared oriented column/surface
  support with its physical area measure and world/support Jacobian;
- `volume-source`: `s_p` in `kg m^-3 s^-1` over a declared cloud volume with
  its physical volume measure and world/support Jacobian.

It also publishes nonnegative liquid/ice phase fractions that sum to one,
emission altitude/depth distribution,
`emissionInterval: PhysicsTimeInterval`, cadence, and uncertainty/error. Every
emission channel has `actualPhysicsTime: PhysicsTimeInterval` equal to that
interval. A layer parameter alone is neither an area nor a volume; the
measure/Jacobian is
mandatory before integration. The emitter publishes one transport choice:

- explicit airborne particles/parcels owned by the precipitation system;
- a fall-time and horizontal-drift map with a declared approximation error; or
- a nonnegative transfer kernel `K(deltaX, tau)` whose integral over horizontal
  displacement and delay is one within the conservation tolerance.

For the kernel form, receiver arrival flux is **Derived** as

```text
q_column(x_h,t) = q_area(x_h,t), or
q_column(x_h,t) = integral s_volume(x_h,z,t) J_volume/J_area dz

q_arrive(x,t) = integral integral q_emit(x-deltaX,t-tau)
                                K(deltaX,tau) d(deltaX) d(tau)
```

The volume-to-area pushforward uses the support chart/Jacobian and produces
`kg m^-2 s^-1` before horizontal/time transport. For two horizontal metre
coordinates and delay in seconds, `K` has units `m^-2 s^-1` and
`integral K d(deltaX) d(tau) = 1`. A different coordinate chart publishes the
corresponding measure/Jacobian and kernel units.

Only the resulting oriented mass-area flux enters the canonical
`PrecipitationEmissionSnapshot`; the internal volume source remains provenance
for that derived projection and its error, not a second snapshot ABI.

Physical truncation or escape from the modeled support is recorded as a typed
`ConservationGroup.boundaryFluxes` entry. Terrain occlusion or a rejected
destination does not destroy mass: the mass remains in source/pending inventory
unless a separate typed transfer or boundary flux removes it. Delivery-capacity
overflow is not a `PrecipitationEmissionSnapshot` or per-record field. When the
transport edge batches `InteractionRecord`s, its owning
`SurfaceExchange.batchLedger` records the canonical immutable
`InteractionBatchLedger`: overflow policy and sequence ranges, per-consumer
cursors, typed lost/deferred commodity maps, and application-ledger version.
The `SurfaceExchange.applicationInterval` and every contained
`InteractionRecord.applicationInterval` are `PhysicsTimeInterval` records
contained in or explicitly mapped to the emission interval.
Deferred commodities remain in pending/final inventory; lost commodities enter
the conservation audit explicitly and force the ledger's failed-conservation
status; they are never normalized away. Evaporation/sublimation is a typed mass
transfer to the atmospheric-vapor owner, not numerical loss.
Liquid-to-ice or ice-to-liquid conversion is an internal phase transfer: it
changes phase inventories but not total precipitation mass. Over an audit
interval,

```text
M_airborne(t0) + M_pending(t0) + M_emittedAccepted[t0,t1]
  = M_airborne(t1) + M_pending(t1) + M_delivered[t0,t1]
    + M_transferredToVapor[t0,t1]
    + M_boundaryOutflow[t0,t1]
    + M_batchLedgerLost[t0,t1] + residual
```

within the declared error. Visual cloud opacity, raymarch samples, weather-map
texels, and rendered rain count cannot scale this mass. A cloud appearance
model without a validated microphysical closure may still publish an authored
dimensioned emission policy, but it must be labelled authored/empirical rather
than physically predicted.

The cloud consumes `EnvironmentForcingSnapshot[n]` and publishes a distinct
immutable `PrecipitationEmissionSnapshot[n]`. It never writes into its consumed
snapshot. The scheduler either exposes a direct completed
`emission[n] -> precipitation transport[n+1]` edge or lets the environment
coordinator incorporate emission into `EnvironmentForcingSnapshot[n+1]` with
the declared delay and identical conservation-group identity.

### LightingTransportSnapshot consumption

Consume the atmosphere-owned `LightingTransportSnapshot` through its canonical
descriptor. Each selected `incidentRadiance`, `directSolarIrradiance`,
`skyIrradiance`, `transmittance`, and `sourceDirection` `SampledChannel`
preserves its own quantity kind, SI unit, applicable spectral/angular basis,
`actualPhysicsTime: PhysicsInstant`, actual support/filter, validity, error, and
state version. Snapshot-level `sampleInstant: PhysicsInstant`, atomic validity,
and error correlation do not override channel metadata. Choose one direct-light
path per channel:

```text
Path A: unattenuated solar source * T_atmosphere(sample->sun)
Path B: directSolarIrradiance, or incidentRadiance with declared solar-disc
        angular support, at the sample;
        attenuationFactorIds contains the atmosphere path factor ID/revision
```

Never multiply Path B by atmospheric transmittance again. Convert each consumed
spectral channel into the scene-linear working basis exactly once at a named
adapter or consumer boundary, carrying conversion provenance and error. No
snapshot-wide basis or conversion flag may override channel metadata. Likewise,
do not interpret hemispherical sky irradiance as directional radiance without
the declared angular model. Query the typed provider with SI sample position,
physics frame/transform revision,
sample-to-sun direction plus solar-disc angular footprint, or incoming
sky-propagation direction/receiver normal, requested spatial/solid-angle
footprint and filter, canonical `PhysicsInstant`, and maximum staleness. Do not
reuse a point result outside its returned support/error.

Cloud lighting then applies only cloud-local transport:

```text
j_direct = sigma_s * phase * E_direct_after_atmosphere * T_cloudLocal
T_direct_at_receiver = T_atmosphere * T_cloud * V_opaque
```

with the finite-disc/radiance alternative using its solid-angle integral.
`T_cloud` is the cloud-only transmittance `exp(-tau_cloud)`. The cloud shadow
product discriminates `representation: point-optical-depth |
point-transmittance | footprint-average-transmittance`; publishes the matching
units/encoding, spatial/angular footprint, filter domain,
`sampleInstant: PhysicsInstant`, cadence, per-channel error,
and cloud factor ID/model revision/path key; and must not
bake `T_atmosphere`, terrain/opaque
visibility, exposure, or tone mapping into that product. Water and materials
therefore combine atmosphere, cloud, and geometry terms once each rather than
receiving an ambiguously pre-darkened light color.

Filtering is representation-aware: in general
`E[exp(-tau)] != exp(-E[tau])`. A footprint-average irradiance shadow therefore
filters/integrates transmittance, or stores sufficient optical-depth statistics
to reconstruct it within an error gate. Bilinear/minified optical depth instead
defines an interpolated point-extinction model and cannot be relabelled an area
average.

Sky radiance/irradiance from the snapshot supplies the external sky source and
declares whether it includes the direct solar disc. Do not add a separate disc
source when that factor is already included.
The cloud march may attenuate and scatter that source through cloud density,
but it must not rerun or add the atmosphere's multiple-scattering solution.

### Scheduler and mobile invariant

Use this dependency order:

```text
latch PhysicsContext
  + EnvironmentForcingSnapshot.sampleInstant: PhysicsInstant
  + LightingTransportSnapshot.sampleInstant: PhysicsInstant
  -> advect/evolve cloud density and conservative majorants
  -> publish optional PrecipitationEmissionSnapshot.emissionInterval:
     PhysicsTimeInterval for its declared rain/transport edge
  -> commit view-independent cloud state/resource generations
  -> publish view-independent PhysicsPresentationCandidate with
     requestedPresentationInstant: PhysicsInstant + presentedStatePairs
     + resourceLeases + eventSequenceRanges only
  -> publish per-view CameraViewPublication with
     previousRenderSampleInstant: PhysicsInstant
     + currentRenderSampleInstant: PhysicsInstant
     + globalToRenderPrevious + globalToRenderCurrent
     + view/projection matrices
  -> prepare visibility/acceleration/cloud shadows/caches/reactive-reset plans
     and publish per-view ViewPreparationPublication with
     visibilityPublicationRefs + accelerationPublicationRefs
     + shadowViewPublicationRefs + cachePublicationRefs
     + reactiveEpochs + reactivePublications + resetDependencies
     + resourceLeaseRefs
  -> seal PhysicsPresentationSnapshot with snapshotId + candidateId
     + cameraPublicationId + viewPreparationId + presentationTargetId + viewId
     + presentedStatePairRefs + resourceLeaseRefs + eventSequenceRanges
     + sealVersion only
  -> render submits cloud beauty/reconstruction/composite from the sealed refs
  -> append FrameExecutionRecord without mutating prior publications
```

The completed precipitation-emission edge is independent of presentation
sealing; rain never waits for a render view. Lighting consumers sample only a
completed cloud-shadow publication with the declared density revision.

The `PhysicsPresentationCandidate` contains no camera, render origin,
`globalToRender`, matrices, shadow/cache epochs, or view-specific temporal
state. Each cloud `PresentedStatePair` has independent
`previousPresented.provenance` and `currentPresented.provenance` records of type
`PresentationSampleProvenance`; one shared provenance record is forbidden, and
each arm carries its own `presentedInstant: PhysicsInstant`.
`CameraViewPublication` exclusively owns
`previousRenderSampleInstant: PhysicsInstant`,
`currentRenderSampleInstant: PhysicsInstant`, render
transforms, and matrices. `ViewPreparationPublication` exclusively owns the
`visibilityPublicationRefs`, `accelerationPublicationRefs`,
`shadowViewPublicationRefs`, `cachePublicationRefs`, `reactiveEpochs`,
`reactivePublications`, `resetDependencies`, full `resourceLeases` for newly
created camera-dependent generations, and `resourceLeaseRefs` fields.
`PhysicsPresentationSnapshot` references candidate pairs and transitive
leases by ID; it copies no pairs or transforms.

Every `PhysicsGraphStage` records `executionInterval: PhysicsTimeInterval`; its
edges name producer/consumer stage IDs, registered `clockId` mappings, required
state version/sample phase, latency, barrier, and maximum staleness. A typed
exchange/interaction edge carries `SurfaceExchange.applicationInterval` and
`InteractionRecord.applicationInterval` as `PhysicsTimeInterval`. A
same-coordination-interval edge is legal only when its producer precedes its
consumer in the outer `PhysicsGraph` DAG; feedback is a scheduler-owned bounded
`BoundedCouplingLoop`. Otherwise publish into an explicitly declared later
interval. Do not use unqualified same-tick/next-tick labels. Do not let rain
read a partially written emission texture or lighting sample a shadow cascade
whose density revision does not match its metadata.

Preserve the same interfaces on constrained targets: use analytic/coarse wind,
low-rate conservative emission columns, compact single-channel cloud optical
depth, sparse dirty shadow tiles, and explicit age/error. Do not add a dense
microphysics grid to make the interface look physical.

## 5. Layered Density Topology

Evaluate active layers independently until altitude, profile, weather, shape,
and detail controls are applied. Packing up to four layers into RGBA vector
channels is efficient when their field sampling is shared; it is not a
requirement to render four layers and is not a meteorological claim.

Example preset (**Authored**):

| Channel | Altitude | Height | Density amplitude | Shape | Detail | Coverage width | Shadow |
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
  precipitationBias: number;
  anvilBias: number;
  densityAmplitude: number; // dimensionless topology amplitude
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

Example density profile (**Authored**):

```text
profile(h) =
  exponentialTerm * exp(exponent * h)
  + linearTerm * h
  + constantTerm

default = 0.75 * h + 0.25
```

This profile is an artist-authored function that can rise, fall, or curve by
layer. Clamp it nonnegative and gate continuity at layer boundaries. It is not a
generic bottom/top smoothstep. Keep `beta_s` and `beta_a` outside this profile so
optical units do not change when topology is edited.

Multiply by an explicit compact-support envelope that approaches zero smoothly
at bottom and top. The example `0.75*h + 0.25` is nonzero at both endpoints and
cannot supply that boundary condition. Apply `weatherExponent`, precipitation,
and anvil controls before final topology/majorant construction; a declared
control that is absent from the density equation is not implemented.

Topology must be dominated by weather and base-shape scales. Detail may erode a
boundary but must not create disconnected high-frequency mass where the
conservative base majorant is empty. Validate connected-component size,
occupied fraction per altitude, and density power by octave across fixed seeds;
otherwise a visually acceptable still can boil under advection.

## 6. Packed Intervals And Conservative Empty-Space Skipping

Sort all lower/upper altitude endpoints on CPU, merge occupied ranges, then
pack the complementary empty gaps. The packed intervals are gaps to skip during
beauty and shadow sampling. This is only a one-dimensional altitude accelerator;
it does not skip horizontal holes within an occupied layer.

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
at the nearest opaque surface. Reconstruct a world/view-space ray distance from
the depth buffer; raw perspective depth is nonlinear and cannot be compared to
meters directly.

Return diagnostic flags for ground intersection, scene occlusion, camera
region, near/far distance, selected sphere intersections, and packed-gap skip
counts.

All domains implement one contract: transform the ray into a numerically stable
local frame, return sorted occupied intervals in declared length units, clamp
them by opaque scene depth, and provide a local height/profile coordinate.

| Domain | Use | Bound/intersection | Performance notes |
| --- | --- | --- | --- |
| Spherical shell | Planetary/global atmosphere | Inner/outer ray-sphere intervals around a camera-relative center | Curvature is visible; avoid large absolute world coordinates |
| Planar slab | Regional sky, horizon not showing curvature | Two planes plus optional horizontal extent | Cheapest and stable on mobile |
| AABB/OBB | Local cloud bank, product/architectural/scientific volume | Slab intersection in volume local space | Supports brick DDA directly |
| SDF/convex proxy | Authored bounded cloud mass | Conservative enclosing interval plus SDF/root refinement | Bound evaluation must cost less than skipped march work |
| Sparse texture bricks | Scanned/simulated volume | Brick bounds/BVH or indirection grid | Best for low occupancy; budget indirection bandwidth |

Planet-centered `normalize(position)` is valid only for the spherical-shell
domain. Planar and local volumes require their own profile coordinate and wind
mapping.

For horizontally sparse fields, build a conservative macrocell hierarchy. Each
cell stores an upper bound `rho_max`, constructed with max reduction over every
weather, profile, base-shape, turbulence-warp reach, and detail operation that
can increase density. Average mipmaps are not occupancy bounds. Traverse cells
with 3D DDA or distance-to-cell-exit stepping.

Skipping a cell of length `Delta s` is exact only when its bound is zero. For a
thresholded skip, bound the omitted optical depth and source:

```text
Delta tau_max = beta_t * rho_max * Delta s
Delta L_max <= T_acc * S_eq_max * (1 - exp(-Delta tau_max))
```

`Delta tau_max` and the source bound are **Derived**; the allowed image/HDR
error is **Gated**. Here `S_eq_max` bounds equilibrium source radiance
`j/sigma_t`. If it is unavailable, the looser
`Delta L_max <= T_acc * j_max * Delta s` is valid; otherwise do not claim a
radiance bound.
Refine the first occupied crossing by DDA boundary entry or a bounded binary
search so a long empty step does not create a bright/dark band.

| Occupancy evidence | Accelerator | Decision criterion |
| --- | --- | --- |
| Only vertical gaps are empty | Packed altitude gaps | No occupied layer overlaps a skipped interval |
| Low 3D occupancy, slowly changing fields | Max-density brick hierarchy + DDA | Saved field/light samples exceed hierarchy lookup and divergence cost |
| Weather changes slowly, shape volume is stationary | Rebuild/update conservative weather majorant at lower cadence | Advected/warped density remains inside expanded bound |
| High occupancy | No hierarchy; extinction/footprint-limited steps | Measured hierarchy overhead exceeds saved samples |
| Rapid topology change | Rebuild affected bricks or disable stale skipping | Version/fence proves bounds match current density |
| Mobile bandwidth bound | Coarser compact hierarchy | Measured hierarchy traffic plus march traffic is lower than direct march |

Use the measured break-even inequality, not a universal occupancy percentage:

```text
C_build / reuseFrames + C_traverse + p_occupied * N * C_fine
  < N * C_fine
```

Include divergence and hierarchy bandwidth in `C_traverse`.

## 7. Weather, Shape, Turbulence, And Detail Fields

Generate or load fields once. At each cloud-owner `PhysicsGraphStage` execution
interval, not each render frame, integrate the latched air and named relative
velocities over that stage's canonical `executionInterval: PhysicsTimeInterval`
in the declared Cartesian physics frame:

```text
macroOffset += integral_executionInterval u_air(x,t) dt
weatherOffset = macroOffset + integratedRelativeWeatherOffset
shapeOffset = macroOffset + integratedRelativeShapeOffset
detailOffset = macroOffset + integratedRelativeDetailOffset
turbulenceOffset = macroOffset + integratedRelativeTurbulenceOffset
```

Use one macro advection shared by causally related fields plus bounded relative
motions for shape/detail evolution. Unrestricted independent winds destroy
cross-scale coherence and produce boiling. Periodically wrap/rebase texture
phase in a way that leaves sampled coordinates continuous.
`u_air` comes from the latched `EnvironmentForcingSnapshot`; each relative
velocity is explicitly relative to that air motion. Preserve integrated offsets
across forcing revisions instead of recomputing phase from current velocity and
elapsed time.

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

For layer `i`, apply the declared weather shaping before coverage remapping:

```text
localWeather_i = pow(max(weatherChannel_i, 0), weatherExponent_i)
```

`weatherExponent_i > 0`; incorporate precipitation/anvil biases through named,
bounded remaps and include their maxima in the conservative density bound.

Thresholds above one assume that this particular FBM recipe is not normalized
to `[0,1]`. Record its actual range/CDF per generated asset. If the field is
normalized, recalibrate thresholds from coverage quantiles rather than copying
these values.

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

Those frequencies, weights, thresholds, and remaps are **Authored**. Filter
procedural octaves by the ray differential/projected sample footprint; sampling
an octave above Nyquist creates temporal shimmer that reconstruction cannot
reliably remove.

Turbulence stores a normalized curl field derived from offset channels. It
warps shape coordinates; it is not added to final density as arbitrary noise.
Define an explicit height envelope; for example, fade it in/out over authored
bottom/top fractions if it should affect the interior while preserving compact
support. “Fade out by the lower 30%” is ambiguous and must not substitute for an
equation/debug view.

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

Require `coverageFilterWidth > 0` and define the limiting behavior when it tends
to zero. Clamp `shapeAlteringBias` positive before `pow` so endpoints and
derivatives remain finite.

Shape application in a declared local parameterization:

```text
xPhysicsMeters = samplePositionPhysicsMeters
weatherPosition =
  physicsMetersToWeatherParameter(xPhysicsMeters - weatherOffset)

turbulenceMeters =
  displacementMeters
  * (curlTexture * 2 - 1)
  * turbulenceHeightEnvelope

shapePosition =
  physicsMetersToShapeParameter(
    xPhysicsMeters - shapeOffset + turbulenceMeters
  )

density =
  remapClamped(
    weatherDensity,
    (1 - shapeNoise) * shapeAmount,
    1
  )
```

Both mappings are versioned frame/chart adapters with unit-bearing Jacobians.
Raw time, render-frame count, or current velocity multiplied by elapsed time may
not replace the integrated offsets.

Do not replace vector advection with `length(offset)` along a radial normal; it
loses wind direction and assumes a planet-centered domain. Texture-coordinate
scales and turbulence amplitudes are **Authored** and must be converted through
the declared meter/parameter mapping. Expand the macrocell majorant by the
maximum warp displacement; otherwise skipping can discard density moved in from
a neighboring cell.

Height-dependent detail:

```text
baseErosionModifier = detail^6
crestModifier = 1 - detail

modifier =
  mix(
    baseErosionModifier,
    crestModifier,
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

This keeps strong detail erosion near the layer base and billowy inverted-detail
shaping near the crest.

Final density:

```text
densityVector =
  saturate(
    densityVector
    * densityAmplitudes
    * profile(heightFraction)
  )

totalDensity = sum(densityVector)
layerWeight = densityVector / max(totalDensity, epsilon)
sigma_s = totalDensity * beta_s
sigma_a = totalDensity * beta_a
sigma_t = sigma_s + sigma_a
```

If layers use different droplet/ice optical properties, compute each layer's
`sigma_s`, `sigma_a`, phase, and source before summing; a density-weighted phase
is valid only with scattering-coefficient weights. Saturating each channel and
then summing permits `totalDensity > 1`, which is valid only if the coefficients
were calibrated for that convention.

## 8. Primary March Policy

Example high-tier budget (**Authored**):

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

Do not select step only from distance. Bound it by optical depth, resolved field
bandwidth, geometric boundaries, and the remaining interval:

```text
ds_tau = tau_step_max / max(sigma_t_majorant, epsilon)
ds_signal <= c_nyquist / max(resolvedSpatialFrequency, epsilon)
ds = min(ds_tau, ds_signal, distanceToCellExit, distanceToLayerBoundary,
         rayFar - s, authoredMaxStep)
```

`ds_tau` and interval clamps are **Derived**. `tau_step_max`, the Nyquist safety
factor, and authored min/max steps are **Authored** until image/reference errors
make them **Gated**. A perspective-distance proposal may enlarge `ds_signal`
only after the sample footprint has filtered unresolved octaves. An authored
minimum step must not override a smaller error-gated upper bound; if the budget
cannot afford the required step, lower resolved frequency/quality or report the
gate failure.

At each sample:

1. Apply a blue-noise first-step offset tied to the temporal sample pattern.
2. Skip packed empty altitude gaps.
3. Sample a conservative rough-weather/base majorant first.
4. If every active layer's upper bound passes the skip-error gate, advance to
   the conservative cell/band exit.
5. Otherwise sample base shape, optional turbulence, and detail.
6. Evaluate lighting only when extinction is significant.
7. Integrate front-to-back and terminate when a bound on remaining HDR
   contribution is below the output error gate. A fixed transmittance threshold
   is only **Authored** and can fail in front of a bright source.

In r185 compute shaders, a plain TSL `texture(volume, uvw)` has no fragment
derivatives and samples level zero; request the intended
LOD with the texture node's `.level(lodNode)` path. Generate a separate
max-reduction mip/hierarchy for occupancy. Ordinary averaged/auto mipmaps are
valid for filtered density appearance, never for conservative skipping.

Long empty-space steps can band near the first dense crossing. Refine the cell
entry or first threshold crossing locally rather than raising fixed steps
everywhere. Validate against a step-halved reference with:

```text
relative transmittance error
HDR radiance error before tone mapping
first-contribution depth error in pixels
silhouette/edge displacement
early-exit and skipped-distance histograms
```

| Error/occupancy evidence | March policy |
| --- | --- |
| Dense medium, low extinction | Signal/footprint-limited deterministic march |
| Dense medium, high extinction | Optical-depth-limited march plus contribution-bound early exit |
| Sparse medium, reliable majorant | DDA skip empty cells; refine occupied entry |
| Majorant loose or rapidly stale | Short rough samples; disable unsafe long skips |
| Thin high-density feature | Boundary/event clamp plus local substeps |
| Step-halving changes topology | Reduce step/filter octaves before increasing temporal history |

## 9. Lighting And Cloud Shadows

Latch the atmosphere-owned `LightingTransportSnapshot` before this stage.
Every direct or sky source below declares whether atmospheric attenuation and
spectral-to-working-basis conversion are already included. Cloud self-shadow
terms contain cloud optical depth only.

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

The phase function may use two normalized Henyey-Greenstein lobes. Clamp each
`g` strictly inside `(-1,1)`, keep weights nonnegative with unit sum, and verify
the numerical solid-angle integral. Fitted large-particle phase functions remain
single-scattering models; multiple scattering is a separate transport problem.

Define direction signs once. If `rayDirection` points camera-to-sample and
`toSun` points sample-to-sun, incident photon propagation is `-toSun`, outgoing
propagation to the camera is `-rayDirection`, so
`mu = dot(toSun, rayDirection)` and `mu = 1` is forward scattering. A different
vector convention requires the corresponding derivation; a sign error swaps
forward silver lining with backscatter.

At each occupied sample form a source coefficient, not an untyped color:

```text
j_direct = sigma_s * T_sun * integral_sunDisk(p(mu_i) * L_sun(wi) dOmega_i)
# or, for a declared collimated irradiance convention:
j_direct = sigma_s * p(mu) * E_sun * T_sun
j_sky    = sigma_s * quadrature_or_approximation(integral p * L_sky dOmega)
j         = j_direct + j_sky + j_multiple + j_emission
T_step    = exp(-sigma_t * ds)
L_acc    += T_acc * (j / sigma_t) * (1 - T_step)
T_acc    *= T_step
```

Never use finite-disk radiance without its solid-angle integral. If the sun
input is irradiance, use the implementation's derived collimated-source
convention and test it against a homogeneous slab.

An octave multiple-scattering approximation is **Artistic/empirical** unless it
is fitted against a reference transport solver. A dimensionally consistent
shape is:

```text
w = 1
for each octave:
  contribution +=
    w * sourceScale
    * exp(-opticalDepth * attenuationB)
    * phase(cosTheta, attenuationC)
  w *= weightDecay
```

The old form that updated an `attenuation` variable without multiplying the
contribution by it is invalid. Record the integral/maximum of the aggregate
phase-source boost, constrain it explicitly, and compare homogeneous slabs and
silver-lining views with a reference. The example `4-8` octave count is
**Authored**. Reduce light work before raising primary steps when light samples
dominate measured cost; temporal reprojection does not amortize repeated light
work inside a current sample.

Piecewise-constant transfer integration (**Derived**):

```text
stepT = exp(-extinction * stepLength)
stepRadiance = sourceCoefficient / extinction * (1 - stepT)

accumulatedRadiance += accumulatedT * stepRadiance
accumulatedT *= stepT
```

Use the analytic `sourceCoefficient * stepLength` limit near zero extinction.
Calling incident light or a source function `radiance` in this equation hides a
factor of `sigma_s` or `sigma_t`; preserve the names/units above.

Representative depth uses opacity-deposition weights
`w_i = T_i * (1 - T_step_i)`, not `T_i` alone:

```text
z_bar = sum(w_i * s_i) / max(sum(w_i), epsilon)
variance_z = sum(w_i * (s_i - z_bar)^2) / max(sum(w_i), epsilon)
```

Store front-contribution depth as well when required. Use depth spread to decide
whether a single history surface is valid; aerial perspective and color
integration still use the full march, not only `z_bar`.

For an opaque/ground receiver behind the whole cloud column, the minimal
direct-sun cloud shadow representation is total optical depth along the sun
ray:

```text
R = min(integral sigma_t ds, tau_max)
decoded transmittance = exp(-R)
```

`tau_max = -log(T_min)` is **Derived** from the smallest required
transmittance. Use explicit R16F/R32F storage; add front depth or moments only
when a documented decoder/reprojection consumes them. “Maximum accumulated
optical depth” duplicates final optical depth because accumulation is monotone,
and an undefined tail channel is not a usable contract.

A beauty-march sample inside the volume needs optical depth from that sample to
the sun, not the total column. A 2D total-optical-depth map cannot answer this
without depth. Choose one:

- a short direct sun march when local cost is acceptable;
- a light-space transmittance volume/deep-opacity slices with explicit depth
  interpolation;
- a piecewise front-depth/extinction/tail encoding with a documented decoder
  and reference error.

Do not subtract unrelated total-depth values or call undefined RGBA moments a
shadow approximation.

Shadow marching follows the light direction:

1. Intersect the sun ray with the same conservative cloud intervals/hierarchy.
2. March or DDA-skip along the sun direction with a stable low-discrepancy
   offset.
3. Integrate dimensionless optical depth and stop at `tau_max`.
4. Write the compact optical-depth target; reproject/advect or refresh tiles on
   an explicit cadence.

An alternative set of sampling-plane normals is experimental unless its
decoder and transmittance error are defined. It is not the default direct-sun
shadow algorithm.

Default shadow budget:

```text
high:    3 cascades, 512x512, 40-64 samples, update every 2-4 frames
default: 2 cascades, 256-384, 24-40 samples, update every 4-8 frames
reduced: 1-2 cascades, 128-256, 12-24 samples, amortized update
minimum transmittance: 1e-4 high, 1e-2 reduced
```

These counts are **Authored**. Choose update cadence from measured cloud/wind
coherence: reproject the cascade footprint, estimate the maximum optical-depth
change, and refresh when its projected transmittance error exceeds the gate.

| Occupancy/coherence | Shadow architecture |
| --- | --- |
| Dense cloud, coherent sun/view | Low-rate sun-aligned R16F optical-depth cascades |
| Sparse cloud | Same conservative macrocell DDA as beauty, with light-space bounds |
| Rapidly advecting topology | Tile invalidation/partial refresh; lower history weight |
| Local bounded volume | One fitted light-space map or direct short sun march |
| Low-end/mobile bandwidth limit | Fewer single-channel cascades; measure refresh traffic before resolution |

| Receiver need | Minimum valid representation |
| --- | --- |
| Ground/opaque receiver after full column | 2D total optical depth |
| In-cloud sample, low depth complexity | Short sun march or decoded piecewise-depth product |
| In-cloud sample, high depth complexity | Deep-opacity slices/light-space transmittance volume |

## 10. Temporal Reprojection And Upsample

Render current clouds at half or quarter linear resolution:

```text
half:    lowWidth = ceil(fullWidth / 2), lowHeight = ceil(fullHeight / 2)
quarter: lowWidth = ceil(fullWidth / 4), lowHeight = ceil(fullHeight / 4)
```

Choose one reconstruction architecture; do not mix their terms:

| Current sampling | Coherence/cost fit | Contract |
| --- | --- | --- |
| Full low-resolution grid every frame | Default; robust SIMD/dispatch behavior | Every low texel is current. Jitter its ray inside the corresponding full-resolution footprint; there are no missing low texels. |
| Sparse/checkerboard logical grid | Very high coherence and a strict current-sample budget | Dispatch only the active phase and explicitly reconstruct missing logical texels. Store/update phase and age. |
| Separate histories per layer/depth cluster | Multiple independently moving layers or broad depth variance | Composite histories after layer-specific reprojection. |

A `2x2`/`4x4` phase pattern is **Authored**. Tie camera jitter, ray jitter, and
blue-noise phase to the same deterministic frame index, but reset phase/history
on projection or resolution changes.

Current cloud targets store:

```text
RGBA16F: cloud radiance.rgb and transmittance.a
R32F or encoded R16F: representative depth
RG16F: velocity; optional R16F depth spread/confidence
R8/R16: rejection/debug mask when needed
optional: shadow length or light-confidence data
```

Binary16's maximum finite value is `65,504`, so meter depth over a `200 km`
interval overflows. For an interval-normalized value in `[0,1]`, the largest
adjacent binary16 gap below one is `2^-11`; over `200 km` that is `97.7 m`,
with at most about `48.8 m` round-to-nearest error (**Derived**). Use R32F, a shorter
per-interval normalization, or a proven encoding whenever quantization exceeds
the **Gated** temporal/upsample depth error. Store the encoding parameters with
the frame and reject history when they change.

Temporal resolve:

1. Reconstruct a representative current world point and advect it back with the
   cloud field, not opaque-surface velocity:

   ```text
   x_current = rayOrigin + rayDirection * z_bar
   x_previous = x_current - macroCloudVelocity(x_current) * dt
   historyUV = project(previousViewProjection, x_previous)
   ```

2. If using sparse/checkerboard updates, select a current proxy from a defined
   neighborhood by depth/confidence; skip this step for a full low grid.
3. Reject history UV outside the viewport before clamp or texture lookup.
4. Sample history with a defined bilinear/manual filter; integer rounding and
   clamping are not reprojection.
5. Reject on depth mismatch including depth-spread/quantization uncertainty,
   velocity spike, camera cut, projection change,
   weather discontinuity, layer topology change, or resolution/render-scale
   change.
6. Variance-clip accepted history against current neighborhood color.
7. Blend premultiplied linear HDR radiance and transmittance separately, update
   confidence/history length, then write and swap history.

Define alpha as current-frame weight and make it frame-rate independent:

```text
alpha_current = 1 - exp(-dt / responseTime)
resolved = alpha_current * current + (1 - alpha_current) * clippedHistory
```

At 60 Hz, `alpha_current = 0.05` corresponds to `responseTime ~= 0.325 s`
(**Derived**). Fixed alpha at 30 Hz doubles real-time lag. Response time is
**Authored**, while local increases driven by disocclusion, motion, depth
spread, topology residual, or low confidence are **Gated** by rejection/error
evidence. Variance clipping should operate on premultiplied values using
log-luminance or a decorrelated HDR color representation; clamp transmittance
independently to `[0,1]`.

| Depth/coherence evidence | History representation |
| --- | --- |
| Narrow opacity-depth variance, shared wind | One depth, one velocity, one history |
| Broad variance but one connected layer | Front depth + mean/variance; reduce history weight |
| Two separated layers or independent winds | Split layer/depth histories |
| High topology residual or camera cut | Invalidate; current sample weight one |
| High rejection rate for several frames | Spend budget on current samples/resolution instead of longer history |

Depth-aware upsample:

1. Gather the resolved low-resolution cloud neighborhood.
2. Compare representative cloud depth with full-resolution scene depth and
   nearby low-resolution depths, including encoding and depth-spread bounds.
3. Weight samples by depth agreement, transmittance confidence, and edge
   distance.
4. Composite cloud radiance/transmittance in linear HDR before tone mapping.

`TRAANode` handles host temporal AA, not this resolve. `TAAUNode` can upscale a
reduced upstream pass in r185, but it still does not infer cloud advection or
multi-depth history. Keep the cloud-specific contract explicit.

## 11. Workload, Memory, And Bandwidth Gates

Authored trial tuples at 1920x1080; they are neither hardware routes nor timing
claims:

| Key | Linear scale | Primary cap | Light cap | Worst nested evaluations | Shadow tuple |
| --- | ---: | ---: | ---: | ---: | --- |
| `ultra` | 1/2 | 160 | 8 | 663,552,000 | 3x 768-1024, authored cadence |
| `high` | 1/2 | 96 | 6 | 298,598,400 | 3x 512, authored cadence |
| `default` | 1/4 | 64 | 4 | 33,177,600 | 2x 384, authored cadence |
| `reduced` | 1/4 | 32 | 2 | 8,294,400 | 1-2x 128-256, amortized |

The nested count is **Derived** as:

```text
ceil(width*scale) * ceil(height*scale) * primaryCap * lightCap
```

These **Derived** counts exclude weather/base/detail/turbulence reads and all
primary work. Report occupied-sample and early-exit distributions with:

- whole-frame p50/p95 from the complete target scene; and
- paired marginal p50/p95 from alternating matched frames with the cloud system
  enabled/disabled.

Compute percentiles from whole-frame samples and paired deltas. Do not subtract
unpaired percentile summaries, add pass percentiles, or select a workload from
a device label.

In r185, enable `{ trackTimestamp: true }`, initialize, gate
`renderer.hasFeature("timestamp-query")`, then resolve
`renderer.resolveTimestampsAsync("compute")`/`("render")` before reading the
matching `renderer.info.*.timestamp` fields.

Memory targets:

```text
quarter-linear 1920x1080 RGBA16F: 1,036,800 B = 0.989 MiB
half-linear 1920x1080 RGBA16F: 4,147,200 B = 3.955 MiB
512x512 RGBA16F: 2,097,152 B = 2 MiB
512x512 R16F optical depth: 524,288 B = 0.5 MiB
128^3 R8 volume: 2,097,152 B = 2 MiB
128^3 RGBA8 volume: 8,388,608 B = 8 MiB
```

Allocation is not bandwidth. A four-tap full-HD RGBA16F upsample reads
`1920*1080*4*8 = 66,355,200 B = 63.3 MiB/frame`, or about `3.71 GiB/s` at
60 Hz before writes, depth, cache behavior, and other passes (**Derived
theoretical traffic**). Nine taps read `142.4 MiB/frame`. Record actual
bytes/texel, tap count, live texture count, and dispatch reads/writes for mobile
or otherwise bandwidth-constrained tuple selection.

Keep pass count stable:

```text
scene pass with depth/velocity/MRT: host owned
cloud shadow update: 0-1 amortized dispatch group per frame
cloud beauty march: 1 dispatch/pass at reduced resolution
temporal resolve: 1 dispatch/pass
depth-aware upsample/composite: 1 node pass
optional bloom/aerial perspective: host image pipeline
```

Also count forcing/emission descriptors, precipitation support/Jacobian data,
inventory/conservation ledgers, cloud-shadow representation/mips, and every
in-flight resource generation. The candidate carries view-independent pairs,
leases, and event ranges; camera and view-preparation publications add per-view
transforms and shadow/cache/reset lease refs. The sealed snapshot contains only
IDs and refs, never copied pairs or transforms. Rain or CPU logic may not
synchronously read a GPU emission texture in the steady frame loop; use
same-queue GPU consumption, an explicitly delayed host mirror, or a compact
analytic emission projection with declared latency/error.

Use `BloomNode`, `GTAONode`, and related built-in display nodes in the host
image pipeline before writing custom post nodes. Custom cloud nodes are
justified because the density, optical-depth shadow, and temporal data contract
is domain-specific.

Constrained-workload control order:

1. clamp drawing-buffer DPR and choose quarter/eighth linear cloud scale;
2. reduce resolved field octaves and light samples using footprint/error gates;
3. compact depth/confidence/shadow formats within precision gates;
4. reduce shadow refresh area/cadence from coherence evidence;
5. reduce primary work only after bounds/occupancy/early exits are verified;
6. use whole-frame and paired marginal p95 plus thermal steady-state to drive
   hysteretic dynamic resolution, never a single timing sample.

## 12. Diagnostics And Failure Diagnosis

Expose debug views:

```text
weather RGBA
EnvironmentForcingSnapshot revision/age and sampled air-velocity support/error
appearance-only versus causal-precipitation mode
emission measure/Jacobian, liquid/ice fractions, airborne inventory and mass residual
per-layer height fractions
packed empty intervals
coverage-remapped density
base shape
detail modifier
turbulence displacement
final per-layer density vector
sigma_s, sigma_a, sigma_t, source coefficient, and unit convention
ray near/far and scene clamp
macrocell rho_max, DDA cells, skipped distance/error bound
primary/shape/detail/light sample counts
sun optical depth
cloud shadow optical depth, cascade age, and invalidation
transmittance
representative/front depth, depth variance, and encoding error
cloud velocity versus host velocity
history UV
variance bounds
history rejection reason, age, and confidence
upsample depth weights
shadow cascade index
phase normalization/direction diagnostic
LightingTransportSnapshot revision, typed request support and factor ledger
direct-solar-disc inclusion and cloud-only shadow factor ID/revision
candidate ID plus previous/current PresentationSampleProvenance and pair/lease/event inventory
CameraViewPublication ID, sample instants, globalToRender revisions, and matrices
ViewPreparationPublication ID plus full leases for newly created view resources
and visibility/shadow/cache/reactive/reset lease refs
snapshotId/candidateId/cameraPublicationId/viewPreparationId/target/view plus pair/lease/event refs; no copied pairs/transforms
storage texture format, resolution, live bytes, and estimated traffic
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
  field offsets use unrelated macro motion, topology aliases, or textures regenerate

bright flat interior:
  short sun optical depth or shadow map is missing

dark featureless cloud:
  multi-scattering, sky light, or powder balance is absent

brightness changes with step size:
  source coefficient/function units are mixed or analytic segment integration is wrong

edge trails:
  representative depth/velocity is wrong or history lacks variance clipping

ghosting during camera motion:
  history is same-screen-position accumulation instead of velocity reprojection

flickering cloud shadows:
  bounds/cadence are stale or light-space sampling is not temporally stable

cost scales with view distance:
  shell interval, scene depth clamp, or empty-gap skipping is broken

density vanishes under skipping:
  averaged mip or undilated warp bound was used instead of a conservative majorant

far history rejects or overflows:
  meter depth exceeded/under-resolved its encoding

unexpected color shift:
  cloud output was tone mapped or color-converted outside the host pipeline
```

Required numerical/image gates:

1. Homogeneous slab against
   `L_out = L_bg*exp(-sigma_t*D) + (j/sigma_t)*(1-exp(-sigma_t*D))`, including
   step-partition invariance and the zero-extinction limit.
2. Numerical phase integration and forward/back direction sign.
3. Brute-force versus hierarchy-skipped radiance/transmittance under the
   declared error bound.
4. Depth encoding round-trip over every supported interval, compared with the
   temporal depth gate.
5. Known translating density field with reprojection residual and ghost-decay
   time.
6. Fixed-camera linear-HDR output against a high-step/high-light reference,
   measuring radiance, transmittance, silhouette, and halo error.
7. Resource create/resize/tier-switch/dispose loops plus p50/p95 GPU timestamps,
   live bytes, estimated traffic, and thermal behavior on named desktop and
   mobile targets.
8. Identical air-velocity traces at several cloud update cadences preserve
   integrated advection within the provider/interpolation error; replacing the
   trace with water current or vegetation response must fail schema validation.
9. Causal precipitation closes initial plus accepted emitted mass against final
   airborne and pending/deferred inventory, delivered mass, typed transfer to
   vapor, `ConservationGroup.boundaryFluxes`, typed
   `InteractionBatchLedger.lostCommodities`, and numerical residual for both
   area-flux and volume-source fixtures. Reconcile
   `InteractionBatchLedger.deferredCommodities` with pending inventory; no
   per-record overflow field is permitted, and any nonzero lost commodity forces
   failed-conservation status. Liquid/ice internal transfers close separately
   without changing total mass.
   Appearance-only mode exposes no physical emission channel.
10. Lighting fixtures reject a duplicate atmosphere factor, distinguish
    diffuse sky with/without the direct disc, and prove cloud shadow products
    contain cloud attenuation only. Validate before tone mapping.
11. Presentation fixtures prove that the candidate is view-independent; each
    pair has independent previous/current `PresentationSampleProvenance`;
    `CameraViewPublication` owns sample instants, render transforms, and
    matrices; `ViewPreparationPublication` owns visibility/shadow/cache/reactive/
    reset publications and lease refs; and the snapshot contains only IDs,
    `presentedStatePairRefs`, `resourceLeaseRefs`, and event ranges. Reject
    copied pairs/transforms and any aggregate provenance shorthand.

## 13. Replaced Techniques

- Full or near-full-resolution cloud rendering is replaced by half/quarter
  linear resolution plus temporal reprojection and depth-aware upsample. The
  marched pixel count falls by exactly 4x/16x (**Derived**); comparable visual
  quality must pass the temporal/edge error gates.
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
- Unqualified procedural “physics” is replaced by explicit density/optical
  units and a physical-versus-empirical model table.
- Average-mip empty skipping is replaced by conservative max-density bounds and
  a radiance-error gate.
- One representative depth for every topology is replaced by a depth-spread
  decision: single surface, moments/front depth, or split histories.
