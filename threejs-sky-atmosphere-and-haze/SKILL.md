---
name: threejs-sky-atmosphere-and-haze
description: Implement physically coherent sky, atmosphere, and haze in Three.js r185 native WebGPU/TSL using unit-consistent scattering LUTs, depth-aware aerial perspective, ellipsoid-aware geometry, explicit invalidation, and measured pipeline evidence.
---

# Sky, Atmosphere, and Haze

Throughput is won by architecture before code. The taught path is native
WebGPU on Three.js r185, `WebGPURenderer` from `three/webgpu`, TSL from
`three/tsl`, node materials, one `RenderPipeline`, and compute-generated
Hillaire/Bruneton-family scattering products sampled by bounded nodes per
pixel. A WebGL backend is a hard blocker for this skill; there is no alternate
renderer branch here.

Read [references/atmosphere-system-contract.md](references/atmosphere-system-contract.md)
before implementation. It defines the LUT contracts, capability gate, authored
workload trials, measurement obligations, color/output ownership, depth contract, diagnostics, and the
techniques replaced by the WebGPU/TSL architecture.

## Shared Lighting Transport Boundary

For any material, cloud, water, vegetation, or weather consumer, first read the
router's
[physics-domain and interaction contract](../threejs-choose-skills/references/physics-domain-and-interaction-contract.md).
One immutable `PhysicsContext` resolves every snapshot descriptor, frame,
chart, clock, origin epoch, material ID, and world/physics transform revision
used by the atmosphere stage.
Publish one versioned `LightingTransportSnapshot` from this atmosphere model.
The snapshot declares:

- physics-context/origin epoch, `sampleInstant: PhysicsInstant`, descriptor
  `validity` whose temporal domain is a `PhysicsTimeInterval`, producer and
  parameter revisions, spatial support, update cadence, and interpolation/error
  policy;
- sample-to-sun unit direction in `physicsFrameId` and disc angular radius;
- whether the calibrated solar source is normal irradiance or finite-disc
  radiance, including its per-channel SI unit and solid-angle conversion; an
  authored dimensionless relative scale is an internal nonphysical model input
  only and leaves snapshot radiance/irradiance channels absent;
- each returned `SampledChannel`'s quantity kind, SI unit, filter/error,
  `actualPhysicsTime: PhysicsTime` selecting the `instant` arm while its
  `interval` arm is a canonical `TypedAbsence` record, and, where applicable,
  spectral/angular basis and conversion revision; a provider-level transform
  registry never overrides channel metadata;
- atmospheric direct-sun transmittance/irradiance, sky radiance/irradiance, and
  segment transmittance/inscattering providers with their domain and error;
- typed provider request signatures with position, direction/normal or segment
  endpoints, footprint/solid-angle support, frame, and
  `requestedPhysicsTime: PhysicsTime` selecting the `instant` arm while its
  `interval` arm is a canonical `TypedAbsence` record;
- applied versioned `attenuationFactorIds` for every output and explicit
  `skyIncludesDirectSolarDisc` state for sky irradiance. A boolean
  "attenuated" flag is insufficient.

Consumers must choose either a pre-attenuated direct-light value or an
unattenuated source plus the atmosphere transmittance provider. They may not
use both. Cloud optical-depth shadows, opaque-geometry visibility, and water
extinction are separate factors and each is applied exactly once. Do not bake
cloud attenuation into this atmosphere snapshot or let a material reapply
aerial perspective already owned by the image path.

`EnvironmentForcingSnapshot` is a separate thermodynamic/mechanical interface
sampled at `sampleInstant: PhysicsInstant`. Requests for its instantaneous
lighting/forcing channels use `requestedPhysicsTime: PhysicsTime` with the
`instant` arm selected and the `interval` arm a canonical `TypedAbsence` record;
returned channels use the same discrimination in `actualPhysicsTime`. Use raw
`PhysicsTimeInterval` only for an actual validity or graph-stage interval. If
temperature, humidity, pressure, aerosol loading, or wind drive atmosphere
parameters, record that forcing revision and the transfer model; do not treat
RGB extinction coefficients as a wind or humidity provider.

Schedule every physics-facing LUT/provider update on the shared graph and emit
an exact `PhysicsStageExecution` for each attempted recompute or analytic/state-
hold evaluation. A queued compute dispatch alone proves neither stage coverage
nor a publishable provider revision; dropped debt remains in the graph catch-up
loss ledger.

After every physical owner commits, publish one view-independent
`PhysicsPresentationCandidate` with
`requestedPresentationInstant: PhysicsInstant`, containing the atmosphere's
base-provider `presentedStatePairs`, `resourceLeases`, and
`eventSequenceRanges`. Each
pair gives `previousPresented.provenance` and `currentPresented.provenance`
their own full `PresentationSampleProvenance`; never share one bracket, clock
map, or interpolation alpha across the two states. Each arm also carries its
own `presentedInstant: PhysicsInstant`. Static or low-rate products still
declare explicit `hold` or `not-interpolated` provenance.

For each target/view, the camera owner publishes `CameraViewPublication` with
`previousRenderSampleInstant: PhysicsInstant`,
`currentRenderSampleInstant: PhysicsInstant`, and
`globalToRenderPrevious`/`globalToRenderCurrent` plus view/projection matrices,
jitter, viewport, and depth state. Sky, aerial, shadow, cache, visibility, and
reset preparation then publishes a `ViewPreparationPublication`
against that camera record and the immutable candidate, owning
`visibilityPublicationRefs`, `accelerationPublicationRefs`,
`shadowViewPublicationRefs`, `cachePublicationRefs`, `reactiveEpochs`,
`reactivePublications`, `resetDependencies`, full `resourceLeases` for newly
created camera-dependent generations, and `resourceLeaseRefs`. Beyond
identity, target/view scope, seal metadata, and scoped `eventSequenceRanges`, the sealed
`PhysicsPresentationSnapshot` carries `candidateId`, `cameraPublicationId`,
`viewPreparationId`, `presentedStatePairRefs`, and `resourceLeaseRefs`; it never
copies `PresentedStatePair` records or `globalToRender` transforms. Leases
remain live through every consumer.

Any tier transition that changes physics-facing state or providers, update
cadence, represented support or spectral/spatial/temporal filter, error bounds,
inventories, stable IDs/RNG streams, or event and exact-once
application-ledger cursors requires the contract's shared `QualityTransition`.
Commit its conservative map atomically at a safe graph-step boundary and retain
old resources through the completion join. A strictly render-only LUT,
resolution, sampling, or composition change may remain local only when all
physics-provider semantics, `PhysicsGraph` ownership, committed physical
versions, IDs, cursors, and physical error bounds remain unchanged.

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
  -> compute aerial inscattering plus RGB optical-depth froxels, or prove an
     endpoint-transmittance reconstruction
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
   discs, material irradiance, and lighting. Declare the integration length
   unit and coefficient unit together: `beta [length^-1] * ds [length]` must be
   dimensionless. Never combine meter radii with per-kilometer coefficients.
3. Initialize `WebGPURenderer`, call `await renderer.init()`, and require
   `renderer.backend.isWebGPUBackend === true` before allocating resources.
4. Generate 2D LUTs with TSL `Fn().compute(count)` dispatches through
   `renderer.compute()` or `renderer.computeAsync()`. Write 2D products with
   `StorageTexture` plus `textureStore()`; write volume products with r185
   `Storage3DTexture` plus `storageTexture3D()`. Treat all products as
   `NoColorSpace` data. Set r185 2D `StorageTexture.generateMipmaps = false`
   and `mipmapsAutoUpdate = false` unless a measured path consumes authored
   mips. Set `Storage3DTexture.generateMipmaps = false` as well when only its
   base level is written; it has no `mipmapsAutoUpdate` property.
   After initialization use `renderer.compute()` for normal submission. In
   r185 `computeAsync()` only initializes on demand before enqueueing; it is
   not a GPU-completion fence. Later GPU submissions are queue-ordered, but CPU
   readback, timestamp resolution, resource reuse, and lifetime decisions need
   an explicit completion/readback mechanism.
5. Use `RenderPipeline`, `pass()`, and `mrt()` when the image chain needs
   shared signals. In r185, `PassNode.getViewZNode()` is the standard/reversed
   **perspective** helper and `getLinearDepthNode()` returns normalized depth,
   not metric ray distance. Orthographic and logarithmic depth require their
   explicit TSL conversions and fixed projection tests.
6. Compose sky radiance and surface-segment transmittance/inscattering with
   TSL nodes. Keep output scene-linear HDR until the single tone-map and output
   color transform owner.
7. Validate inverse LUT mappings at texel centers, quadrature convergence,
   invalidation hashes, units, payload byte counts, energy bounds, depth mode,
   planet intersections, camera altitude, and fixed sun/camera cases before
   tuning color.

Use the canonical validation module for Phase 1 structural/equation gates:

```sh
node examples/webgpu-lut-atmosphere/validation.js
```

It verifies the LUT manifest, RGBA16F upload policy, unit conversion fixtures,
manifest/live-model equality, CPU segment/intersection math, transmittance
mapping, HG normalization through the accepted `|g| <= 0.99` interval, and
projection-specific depth reconstruction including nearest-covered-sample MSAA
resolve. It also builds the TSL graphs. It does not initialize a GPU, submit
compute, render a scene, or measure full-frame performance; those remain
browser-harness obligations.

## Capability Gate

Any path using compute/storage/MRT must gate after renderer initialization:

```js
await renderer.init();

if ( renderer.backend.isWebGPUBackend !== true ) {
  throw new Error(
    'threejs-sky-atmosphere-and-haze requires a native WebGPU backend.'
  );
}

// Full tier: compute-generated LUTs, storage textures, MRT/depth sharing.
```

Quality tiers:

Numeric labels used here and in the reference: **[Derived]** follows from an
equation or representation; **[Gated]** is an acceptance ceiling/floor;
**[Measured]** must come from a named device capture; **[Authored]** is a
starting quality or appearance choice, never a hardware fact.

| Tier | Requirements | Authored starting dimensions |
| --- | --- | --- |
| Full-detail trial | Native WebGPU; two RGB aerial payloads or proven endpoint reconstruction | **[Authored]** 256x64 transmittance, 64x32 multiscatter/irradiance, 192x108 sky-view, 192x108x32-48 aerial |
| Budgeted trial | Native WebGPU; cached static LUTs and staggered view products | **[Authored]** 192x48 transmittance, 128x64 sky-view, 160x90x24-32 aerial |
| Minimum-resident trial | Native WebGPU; one scene pass, compact view products, no hidden full refresh | **[Authored]** 128x32 transmittance, 96x48 sky-view, 96x54x16-24 aerial |

## Required Outputs

- sky radiance and sun/moon disc transmittance/color;
- camera-to-surface segment transmittance;
- camera-to-surface segment inscattering;
- optional sky irradiance for `MeshStandardNodeMaterial` or
  `MeshPhysicalNodeMaterial` lighting integration;
- explicit conversion between render units and atmosphere meters/kilometers;
- diagnostics for LUT coordinates, slices, intersections, depth class, and
  shell/post blend;
- a dependency hash and last-update reason for every LUT;
- reference-integrator errors for optical depth, radiance, horizon, and energy;
- a declared aerial payload: RGB inscattering plus RGB optical depth, or a
  validated method that reconstructs chromatic segment transmittance. Packing
  RGB scattering and only scalar opacity into one RGBA volume is not silently
  equivalent.

## Workload And Performance Evidence

Do not inherit a device-class millisecond or memory table. Derive the workload:

```text
payloadBytes = sum(width * height * depth * bytesPerTexel * residentCopies)
invocations = width * height * depth
workgroupInvocations = wgX * wgY * wgZ
r185FlattenedGroups = ceil(invocations / workgroupInvocations)
integratorSamples = updatedTexels * samplesPerTexel
```

This formula matches a numeric r185 `Fn().compute(count, [wgX,wgY,wgZ])`:
the backend dispatches `[r185FlattenedGroups,1,1]`, wrapping into Y only when
the adapter's `maxComputeWorkgroupsPerDimension` is exceeded. Count unique
kernels, not output textures; one aerial kernel may write both RGB
inscattering and RGB optical depth.

The product supplies its own full-frame GPU p95, CPU-submit p95, presented-frame
p95, and peak-live-byte budgets. Acceptance uses contemporaneous full-frame
captures on the named adapter/browser/viewport/DPR/pass graph. Quality-table
dimensions are **[Authored] trials**, not memory gates or timing evidence.

Do not spend full-resolution nested optical-depth marches per pixel. Every
enabled tier must state texture dimensions, storage formats, dispatch counts,
render resolution, update cadence, draw calls, peak live bytes, full-frame
p50/p95, and resize/disposal behavior.

## Color And Output

- LUTs, density masks, depth, normals, weather inputs, and optical-depth data
  are `NoColorSpace` linear data. Albedo/color art textures use
  `SRGBColorSpace`.
- Atmosphere radiance enters the image chain as scene-linear HDR. Use
  `HalfFloatType` working buffers until tone mapping.
- Exactly one system owns tone mapping and one system owns output color
  conversion. If `renderOutput()` owns final presentation, set
  `RenderPipeline.outputColorTransform = false`; otherwise let the host
  `RenderPipeline.outputColorTransform` own conversion.
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
- reversed depth is manually flipped before an r185 conversion that already
  handles `renderer.reversedDepthBuffer`, or `getLinearDepthNode()` is treated
  as a metric distance;
- direct sun, sky irradiance, segment transmittance, and inscattering are
  collapsed into one color;
- a single scalar alpha is presented as chromatic RGB transmittance without an
  error gate;
- an imported LUT is sampled without proving that radii, coefficients, density
  layers, phase convention, and solar/spectral basis equal the live model;
- HG `g` approaches its singular `|g|=1` limit without a declared accepted
  interval, stable denominator, and normalization/extreme-direction tests;
- camera rotation, temporal projection jitter, or a floating-origin shift
  invalidates body-frame LUTs that are unchanged;
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
This skill is the unique producer of the atmosphere-derived
`LightingTransportSnapshot` for a routed scene.
