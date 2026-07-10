---
name: threejs-water-optics
description: Build workload-selected analytic, bounded, and coastal water in Three.js r185 WebGPU/TSL. Use for generated archipelagos and shorelines, bathymetry-aware shoaling/refraction, mild-slope or shallow-water wet/dry solver selection, sparse active tiles, StorageTexture heightfields, exact displacement and normals, local disturbances, transported foam and wetness, receiver-space caustics, depth-aware refraction, absorption, Fresnel, and offshore/nearshore handoffs.
---

# Water Optics

Use this skill for generated coastlines and archipelagos, bounded interactive
water, authored analytic surfaces, shallow transparent volumes, wet/dry flow,
and local optical effects. Use `$threejs-spectral-ocean` when the offshore
spatial range is a stochastic directional sea synthesized by FFT cascades; its
periodic field does not own transformation around islands or the shoreline.

This is a simulation-and-transport contract, not a blue-material recipe. The
module owns water state, displacement, derivatives, optical evaluation, and
diagnostics. The host owns the renderer, scene partition, camera, lighting,
transparent ordering, and final image pipeline.

“Host owns lighting” means the water shader consumes the shared typed
`LightingTransportSnapshot`: incident radiance, receiver-normal surface/sky
irradiance, direct-solar irradiance, source direction, and transmittance each keep
their quantity, SI radiometric unit, spectral/working basis, footprint, factor
identity/version, validity, and error. Lighting transport is a provider, never
an `InteractionRecord`; atmosphere, cloud, opaque-visibility, and water
extinction factors are identified and applied exactly once.

Before implementation, read the shared
[physics-domain and interaction contract](../threejs-choose-skills/references/physics-domain-and-interaction-contract.md).
All physical water state lives in its SI physics frame. World/scene conversion,
clock/instant/interval identity, graph ordering, interaction exchange, residency, version
propagation, and presentation interpolation use that contract rather than a
water-local dialect.

### Canonical water-provider boundary

This skill publishes the canonical `WaterSurfaceProvider` interface and
`WaterSurfaceSample`. A canonical `PhysicsSampleRequest` is batched and
channel-requested. It carries context/provider/signal/schema IDs, the requested
`PhysicsInstant`, physics-frame-metre points or oriented footprints, channel
masks, filter/frequency response, per-channel tolerances, maximum staleness,
acceptable residency/latency, and batch extent. Descriptor discovery supplies
a stable descriptor-table reference; the request does not deep-copy a complete
descriptor. The returned sample always exposes `freeSurfacePoint` and
`freeSurfaceNormal`; only when represented it exposes
`surfacePointVelocityMps`, `materialCurrentVelocityMps`,
`waterColumnDepthMeters`, `densityKgPerM3`,
`materialAccelerationMps2`, `pressurePa`, `bathymetryPoint`, and `wetDryState`.
Each is a complete `SampledChannel` with actual time/support/filter, validity,
error, and `stateVersion`. The result returns the complete canonical
`PhysicsSignalDescriptor`, bundle `sampleInstant`, and each channel's
`actualPhysicsTime` resolving to a `PhysicsInstant`; requested and actual
instants may differ only within the
declared latency/staleness gates. Consumers preserve that result envelope rather
than copying a water-local subset. Packed GPU batches use stable descriptor-table
handles plus SoA channels, not per-sample descriptor copies. Missing channels
follow `missingChannelPolicy` and are never zero-filled. Surface-point velocity
is geometric motion of the sampled surface, not fluid current. Both velocity
channels are physical polar vectors in `physicsFrameId`: cross-frame transport
rotates their basis only. A moving-frame coordinate derivative is a distinct
coordinate-rate schema and must not receive or lose frame-transport terms by
masquerading as physical velocity.

Analytic waves, bounded heightfields, coastal solvers, spectral donors, and
external free-surface solvers implement adapters to this one ABI. Raw helper
functions such as `getWaterHeight()` are implementation details and cannot be
passed directly to motion, creature, collision, or force consumers.

## Numeric Provenance

Every quantitative choice must carry one of these tags in implementation notes,
presets, and validation artifacts:

- **[D] Derived**: follows from stated equations, dimensions, resource formats,
  or a reproducible calculation.
- **[G] Gated**: a pass/fail limit selected before measurement.
- **[M] Measured**: captured on a named device, viewport, and workload.
- **[A] Authored**: a visual or application input with no universality claim.

Unlabelled integers inside exact equations, vector dimensions, byte identities,
and API names are [D]. Do not publish an unlabelled resolution, timestep,
coefficient, iteration count, memory limit, or millisecond target.

## Choose The Algorithm First

| Requirement | Surface algorithm | Error and cost boundary |
| --- | --- | --- |
| Fixed/perceptual island shot; prescribed waterline; no interactive flow | Coast SDF plus phase-locked analytic shoreline bands | No mass, momentum, diffraction, run-up, or wake claim; nearest-coast ambiguity and crest aliasing are gated. |
| Small authored wave set; no local disturbance | Parametric Gerstner-style map with exact tangents | Cost is linear in component count; CPU parity requires inversion of horizontal displacement. |
| Bounded local interaction; mild non-breaking waves | GPU linear wave equation in ping-ponged storage textures | CFL-limited; cannot represent overturning, hydraulic jumps, or shoreline topology changes. |
| Fixed bathymetry needs shoaling/refraction but not nonlinear flow | Frequency/direction wave-action or ray transport | Geometric rays do not model diffraction/interference and require phase/energy regularization. |
| Fixed islands need linear diffraction/interference | Frequency-domain mild-slope solution, normally precomputed | Invalid for strong nonlinearity, breaking/run-up, moving bathymetry, or broad live spectra. |
| Long waves over permanently wet variable bathymetry | Conservative linearized shallow-water elevation/discharge system | Cannot own moving wet/dry fronts, breaking, or finite-amplitude bores. |
| Run-up, bores, bulk current, obstacle wakes, or changing wet/dry topology | Well-balanced positivity-preserving finite-volume shallow water | Hydrostatic and nondispersive; requires conservative fluxes, wet/dry gates, and fixed-step evidence. |
| Visible finite-depth dispersion beyond shallow water | Validated Boussinesq-family nearshore solver | Higher derivatives/state and fragile boundaries are unjustified unless phase/run-up error is observable. |
| Flat or distant surface where silhouette motion is sub-pixel | Derivative-filtered normal bands only | Lowest geometry cost; explicitly no geometry/normal parity. |
| Large stochastic sea over decades of wavelength | `$threejs-spectral-ocean` | FFT cascades and spectral derivatives. |
| Overturning breakers, entrained air, jets, or three-dimensional vortices | External free-surface/particle/VOF solver | This skill consumes its visual state; a single-valued or depth-averaged model cannot own the phenomenon. |

Choose from spatial scale, smallest resolved wavelength, interaction radius,
allowed phase/error, wet/dry topology, conservation needs, bathymetric variation,
and sustained GPU budget. Do not select by visual style. Do not stack every row
as quality; use the least complex valid model and explicit handoffs only.

### Coastal archipelago preflight

Before selecting a water algorithm, define:

```text
z_b(x,z) = upward-positive bed elevation in metres,
eta(x,z,t) = free-surface elevation in metres,
h = max(eta-z_b,0),
phi > 0 on land, phi = 0 at the authored still-water coast,
phi < 0 in water.                                             [D]
```

Record one owner for bathymetry, water datum, coast SDF/nearest-coast ID,
substrate IDs, obstacle boundaries, offshore wave record, water state, foam,
wetness, optical depth, and final geometry. Horizontal SDF distance is not
vertical water depth. The SDF zero contour and `z_b=eta_0` contour must agree
within a declared gate **[G,M]**.

For reference-like generated islands, prove the causes separately: continuous
deep-to-shallow bathymetry; sand/reef/rock receivers; incident phase transformed
by coast/depth; causal breaking or prescribed crest arrival; transported foam;
wet-sand history; water-column absorption/scatter; and one surface/normal cause.
A cyan halo, radial island gradient, or unrelated scrolling foam texture does
not satisfy the contract.

## Pinned Three.js r185 WebGPU Architecture

The API contract below is verified against the repository's installed
`three@0.185.1` **[G]**:

- `WebGPURenderer`, `RenderPipeline`, `StorageTexture`, and node materials come
  from `three/webgpu`.
- TSL nodes come from `three/tsl`.
- Call `await renderer.init()` before inspecting
  `renderer.backend.isWebGPUBackend` or `renderer.hasFeature()`.
- Build kernels with `Fn(...).compute(...)`; after initialization submit an
  ordered node or node array with `renderer.compute(...)`. `computeAsync()` is
  the initialization-safe wrapper, not a GPU-completion fence.
- Set `StorageTexture.colorSpace = NoColorSpace`,
  `generateMipmaps = false`, and `mipmapsAutoUpdate = false` for simulation
  state unless a compute kernel deliberately writes every sampled mip.
- Use `pass(scene, camera)`, optional `mrt(...)`, and one `RenderPipeline`.
  `PassNode.setResolutionScale()` is current. If `renderOutput()` is explicit,
  set `pipeline.outputColorTransform = false`; otherwise leave the pipeline as
  the sole output-transform owner.

```js
const renderer = new WebGPURenderer( { antialias: false } );
await renderer.init();

if ( renderer.backend.isWebGPUBackend !== true ) {
  throw new Error( 'WebGPU is required for this water system.' );
}

renderer.compute( [ impulseNode, propagateNode, derivativeNode ] );
pipeline.render();
```

The opaque color/depth pass sampled by water must exclude the water surface.
Transparent objects need an explicit ordering policy; do not silently include
them in opaque refraction inputs.

## Scientific Gates

### Bounded heightfield

For cell sizes `dx`, `dz`, wave speed `c`, and fixed step `dt`, the explicit
second-order wave stencil must satisfy the derived stability condition

```text
C_x^2 + C_z^2 <= 1,   C_x = c dt / dx,   C_z = c dt / dz.       [D]
```

For square cells this becomes `c dt / dx <= 1/sqrt(2)` **[D]**. Damping does
not legalize a CFL violation. Record the selected CFL margin **[G]**, phase and
amplitude error against an analytic mode **[M]**, and the boundary reflection
coefficient **[M]**.

Boundary mode is part of the model:

- periodic: wrap neighbors and conserve the periodic mean;
- reflecting: mirrored ghost samples implement zero normal derivative;
- absorbing: use a spatial damping sponge and measure reflection over the
  active frequency band;
- fixed-height: a deliberate phase-inverting wall, never a generic clamp.

### Coastal wave transformation

For local depth `h`, wavenumber `k`, current `U`, and intrinsic frequency
`sigma_i`, use the declared finite-depth dispersion model:

```text
sigma_i^2 = (g k + tau k^3) tanh(k h),
omega_abs = sigma_i + k dot U,
grad(theta) = k,
partial_t(theta) = -omega_abs.                                [D]
```

Wave-action transport uses `N=E/sigma_i` and ray velocity
`dx/dt=U+partial sigma_i/partial k` **[D]**. Record incident, outgoing,
dissipated, clipped, and regularized energy by frequency/direction band
**[M]**. A ray field must report phase-loop/curl residual and cannot claim
diffraction or interference. Use a converged mild-slope solution when those
linear phenomena are required over fixed bathymetry.

At an offshore/nearshore handoff, choose one contract. A phase-resolved handoff
transfers frequency, direction, complex surface-elevation amplitude, wavenumber,
intrinsic frequency, energy, and phase-reference `PhysicsInstant`. A phase-averaged handoff transfers
action/energy quadrature and direction with no crest-phase claim; local phase is
a separate owner. Match model validity before blending. Do not alpha-crossfade
independently phased geometric surfaces; one owner supplies height and
derivatives at each location. Measure reflection by frequency and incidence
angle **[M]**. If a coherent display overlap is unavoidable, amplitude weights
sum to one and derivatives include their spatial gradients; square-root power
weights apply only to proven independent/orthogonal fields, not two
representations of one wave.

### Nonlinear shallow water

For wet/dry flow, conservative state is `q=(h,m_x,m_z)^T`, `m=h u`:

```text
partial_t q + partial_x F(q) + partial_z G(q) = S,
F = (m_x, m_x^2/h + g h^2/2, m_x m_z/h)^T,
G = (m_z, m_x m_z/h, m_z^2/h + g h^2/2)^T,
S_momentum = -g h grad(z_b) + S_friction + S_external.        [D]
```

Use one canonical numerical flux per face, well-balanced bathymetry treatment,
a positivity-preserving update, and an explicit dry-state policy before any
division by `h`. The invariant `u=0`, `h+z_b=constant` must remain a lake at
rest **[G,M]**. A post-update depth clamp that loses unreported mass is a
failure.

For an explicit unsplit rectangular-grid update, derive and enforce

```text
dt <= C_CFL min_cells 1 /
      [ (|u_x|+sqrt(g h))/dx + (|u_z|+sqrt(g h))/dz ].         [D,G]
```

Select Rusanov, HLL, HLLC, reconstruction order, and friction integration from
positivity, diffusion, conservation, convergence, and target-GPU evidence—not
algorithm prestige. Compare shallow-water dispersion
`omega=sqrt(g h_0) k` against `omega^2=g k tanh(k h_0)` over the injected band
**[G,M]**. Load a dispersive model only when this error is observable and its
extra boundary/stability/state cost passes.

### Foam, wetness, and shoreline state

Use modeled breaking dissipation, calibrated shock/entropy loss, surface
compression, exact Jacobian/curvature, or prescribed crest arrival—in that
priority order—as the foam source. Raw numerical entropy loss changes with
flux/grid and is not physical dissipation without convergence calibration.
Declare whether state is dimensionless coverage transported by a material
derivative or conserved areal density transported by a divergence flux; do not
mix their equations. Apply timestep-correct source/decay, optional diffusion,
and bounds. Noise may alter microstructure; it cannot create source coverage.
Partition breaking dissipation once at a model handoff and drive one foam
history; foam coverage is not conserved wave energy.

Exactly one receiver stores exposed-bed wetness separately. Water supplies
inundation/wash `SurfaceExchange`; it runs the receiver update itself only when
the route explicitly assigns it that ownership. For a phase-only/no-solver branch,
`m_wash` is an explicit prescribed beach-inundation mask; static water depth
cannot wet exposed bed:

```text
I_wet = (h >= h_wet) or (m_wash >= m_wet),
w_next = 1                         when I_wet,
w_next = w exp(-dt/tau_dry)        otherwise.                 [D]
```

`h_wet`, `m_wet`, and `tau_dry` are authored inputs **[A]**. Wetness changes
the bed material response, not water mass or geometric shoreline.

### Parametric waves

For each normalized direction `d_i`, amplitude `a_i`, horizontal ratio `Q_i`,
`k_i = 2 pi / wavelength_i`, and phase `theta_i`, use

```text
P(q,t) = (q_x, 0, q_z)
       + sum_i (Q_i a_i d_ix cos(theta_i),
                a_i sin(theta_i),
                Q_i a_i d_iz cos(theta_i)).                    [D]
```

Compute both parametric tangents by differentiation and the upward normal as
`normalize(cross(P_qz, P_qx))`. The shortcut
`normalize((-height_x, 1, -height_z))` is exact only when horizontal
displacement is absent. Require positive horizontal Jacobian for a
single-valued surface. The conservative no-fold gate
`sum_i abs(Q_i a_i k_i) < 1` is **[D]**; the actual minimum determinant over the
authored domain is **[M]**.

### CPU surface queries

`getWaterHeight(x,z,t)` cannot obtain Eulerian parity by evaluating analytic
phases directly at `(x,z)` when horizontal displacement is nonzero. It must
invert the horizontal map with a bounded fixed-point or Newton solve, then
evaluate height at the recovered parameter coordinate. Report iteration limit
**[G]**, residual tolerance **[G]**, and observed residual **[M]**.

The GPU heightfield residual is not bounded by the sum of impulse controls.
Choose one honest contract:

- enforce a hard height envelope `H_grid` **[G]**, giving a derived analytic-
  only query interval of `+/- H_grid` **[D]**;
- maintain a CPU surrogate and report convergence/probe error **[M]**; or
- declare the query analytic-only and unbounded with respect to live GPU
  disturbances.

Never hide readback latency in a per-frame query.

### Coupled interaction order

Water/body feedback uses the shared scheduler and `InteractionRecord` schema;
it is not an actor-side wake callback. For every coupled coordination interval, preserve
the dependency chain

```text
body and water prediction
  -> footprint-filtered sampling from both predictors at one declared bracket
  -> source InteractionRecord generation
  -> conservative load scatter by conservation group
  -> water advance (including declared subcycles)
  -> reaction InteractionRecord reduction
  -> body and water correction, conservation/stability check, atomic commit
  -> water PresentedStatePair for coordinator PhysicsPresentationCandidate. [D]
```

Declare the coupling class as explicit, semi-implicit, scheduler-bounded
iterated, or monolithic; do not let a body or water subsystem perform an
unbounded private iteration.
For a bounded iteration, repeat prediction, same-bracket sampling, source/
reaction construction, solve, reduction, and correction using the exact prior
iteration versions named by `iterationCarriedEdges`; a frozen pre-step sample
is only an explicitly selected one-way/explicit scheme, not an iterated solve.

Every two-way source/reaction relation is an all-or-none
`InteractionReactionGroup`; one source may split across reactions and several
sources may reduce into one reaction. All members are transported to the
group's balance frame/reference point before impulse/torque residuals are
tested. Mass,
linear/angular momentum, energy/work (including declared dissipation/heat), and
species transfers reconcile across their complete conservation group. Volume
is only a separately gated constraint for a fixed-density incompressible model.
Gather and scatter are a discrete-adjoint pair that preserves zeroth and first
kernel moments and gates force, torque, interface-work, and added-mass
stability. Records carry SI units, frame, canonical
`applicationInterval: PhysicsTimeInterval`,
footprint, producer/consumer identities, ordering key, validity/error,
`stateVersion`, and conservation-group identity through the complete shared
`InteractionRecord`; water must not redeclare a subset. Stable interaction and
causal IDs plus application state enforce exactly-once consumption. Reproducible
paths use stable bin/sort and a fixed reduction tree or bounded fixed-point
accumulation, not schedule-dependent floating atomics. The exact
`InteractionBatchLedger` records published sequence range, per-consumer cursor,
accepted/rejected/late/duplicate counts, overflow policy and sequence ranges,
typed lost/deferred conserved commodities, and exact-once ledger version.
Authoritative overflow backpressures, substeps, or conservatively aggregates.
One-way coupling identifies the authoritative source and records a `[G]` upper
bound on omitted feedback or explicitly narrows the claim; it emits no reaction
and must not claim feedback. Keep
coupled hot state on one execution side or in a validated shared mirror;
synchronous frame-critical GPU readback is forbidden.

Water contributes a per-binding/provider `PresentedStatePair` to the
view-independent `PhysicsPresentationCandidate`, which contains committed
state brackets, leases, and events but no camera, render origin, view matrix,
shadow/cache state, or global-to-render transform. `previousPresented` and
`currentPresented` each independently contain a
`PresentationSampleProvenance`, `presentedInstant`, `PresentationStateHandle`,
and `PresentationSpatialBinding`; `motionBinding` references the two state
handles and records identity mapping and motion validity. The camera owner then
publishes a per-view `CameraViewPublication`; visibility/shadow/cache owners
publish `ViewPreparationPublication`; the sealed
`PhysicsPresentationSnapshot` references candidate binding IDs and lease refs
rather than copying pairs or transforms. `FrameExecutionRecord` records all
target/view executions and lease disposition keyed by lease ID. These presented
states need not equal solver states `n` and `n+1`. Surface position,
normals, velocity/MRT output, shadows, foam/wetness display, and temporal
rejection resolve through that immutable publication chain and separately
versioned physical instants, physics-frame transforms, and source-data epochs.
A state, residency,
transform/source epoch, or quality migration that invalidates history is
propagated and reset explicitly rather than hidden by interpolation.
Foam, optical, deformation, wet/dry-topology, and disocclusion changes
contribute scoped reactive epochs/affected regions; the coordinator turns them
into per-view `ReactivePublication` and capability-gated `ScopedResetAction`
plans in `ViewPreparationPublication`. Reset/history flags are not undocumented
`PresentedStatePair` or snapshot fields.

### Caustics

Map each surface differential through Snell refraction to a stated receiver.
For receiver-plane coordinates `F(q)`, use

```text
A_receiver = abs(det(dF/dq)) dq_x dq_z                       [D]
P_cell = E_incident max(0, -l dot n) A_surface
         (1 - F_dielectric) T_light                         [D]
E_receiver = P_cell / max(A_receiver, A_epsilon).            [D]
```

`length(dFdx) * length(dFdy)` is not an area; it omits the sine of the angle
between derivatives. Use a determinant in a receiver basis or a cross-product
magnitude. Deposit energy conservatively into receiver texels or solve an
inverse map; merely displaying the ratio at source texels misplaces light.
Clamp only after recording pre-clamp energy and invalid/TIR counts.

### Optical transport

Classify the incident medium before evaluating Snell and Fresnel. Use exact
unpolarized dielectric Fresnel near total internal reflection; Schlick is
allowed only behind a recorded error gate **[G]** and comparison **[M]**.

```text
sigma_t = sigma_a + sigma_s                                   [D]
T_rgb = exp(-sigma_t_rgb * pathLengthMeters)                  [D]
omega_0 = sigma_s / max(sigma_t, epsilon_sigma)               [D]
L = F L_reflected
  + (1-F) [T L_refracted + (1-T) omega_0 L_source]            [D]
```

`sigma_a`, `sigma_s`, and `sigma_t` have units `m^-1` **[D]**; `L_source`
contains the declared phase/source-light approximation. Absorbed energy does
not become in-scattering. Reconstruct positions from scene depth,
reject foreground/off-viewport samples, and validate that the reconstructed
point lies on the forward refracted ray before calling its distance a path
length. A specular BRDF already contains the sun glint; do not add a second
unbudgeted glint lobe. Foam replaces an energy-conserving fraction of the water
response instead of adding white radiance.

## Sustained Performance Contract

Quality is a target-specific measured envelope, not a device-class label. Do
not publish generic mobile/integrated/discrete timing tables. For each named
target, declare the scene, viewport, DPR, grid, fixed cadence, precision,
active effects, warm-up, sample window, power state, and pass/fail threshold
**[G]** before measuring **[M]**.

An `RGBA16F` texture consumes `8 N^2` bytes **[D]**; enumerate every
persistent, ping-pong, transient, scene-color, depth, geometry, and pipeline
allocation. Measure warm percentile frame time, each bandwidth-sensitive pass,
peak live bytes, allocation churn, and thermal drift on the named target
**[M]**. Derive tiers only from those measurements.

For tile/mobile GPUs:

- batch provider requests and `InteractionRecord` streams as compact SoA with
  channel masks, bounded queues, stable IDs distinct from slots, and fixed
  deterministic reductions; never allocate one JavaScript object per sample;
- publish presentation resource handles with `resourceGeneration` and a
  frame-in-flight lease/reuse rule instead of deep-copying water fields or
  allowing compute to overwrite a rendered generation;
- apply physical quality changes only as coordinator-admitted tick-boundary
  `QualityTransition` transactions with state projection, conservation/error ledger, queue-drain
  boundary, atomic provider-version publication, rollback, and peak old/new
  residency; exactly one representation emits reactions during any visual
  crossfade;
- keep simulation resolution independent of viewport resolution;
- restrict nearshore simulation to persistent causal-influence tiles, not
  merely currently visible tiles;
- use a separate halo/boundary pass before any whole-tile stencil and a later
  dispatch for each global producer/consumer dependency;
- retain one canonical face flux when claiming shallow-water conservation;
- account for tile halos, inactive retained state, activation transitions,
  face-flux storage, and simultaneous quality states;
- fuse kernels only when read/write hazards remain explicit;
- prefer `textureLoad` for stencil state and filtered sampling only for resolved
  display fields;
- reduce storage traffic before reducing arithmetic;
- update caustics less often only if reprojection error remains below a stated
  screen-space gate **[G]**;
- exclude diagnostic textures and timestamp queries from production budgets,
  but include their separate measured overhead **[M]**.

## Required Evidence

Read [references/water-surface-system.md](references/water-surface-system.md)
and
[references/coastal-archipelago-system.md](references/coastal-archipelago-system.md)
before coastal or archipelago implementation. Validation must include the
applicable subset below and every algorithm-specific gate from those references:

- bathymetry/datum/shoreline agreement, SDF eikonal and nearest-coast ambiguity;
- crest phase/direction/filtering and coastwise continuity for prescribed bands;
- wave-action energy/direction, separately owned crest phase, shoaling/
  refraction, and handoff reflection when depth transformation is used;
- lake-at-rest, positivity, mass/flux residual, wet/dry run-up, convergence,
  and boundary reflection when shallow water is used;
- analytic single-mode phase/amplitude error and the CFL margin;
- boundary reflection and mean/volume drift;
- finite-value scan of all state and derivative outputs;
- exact tangent-normal versus finite-difference normal error;
- minimum horizontal Jacobian and fold count;
- CPU query residual plus its declared live-grid error contract;
- receiver-space caustic energy before/after deposition and clamp;
- exact Fresnel versus approximation error, TIR classification, refraction-ray
  residual, and invalid-sample fraction;
- foam source/transport/reaction coverage plus bed wetness/inundation history;
- canonical `WaterSurfaceProvider` conformance, absent-channel rejection, footprint
  filtering, state-version/error propagation, and CPU/GPU adapter parity;
- one-way authoritative-source, omitted-feedback bound/claim, and invariance;
  or two-way scheduler-order, source/reaction
  `InteractionRecord`, conservation-group, and zero-frame-readback evidence;
- physics presentation-snapshot coherence across interpolation, origin/version
  changes, velocity output, shadows, and temporal-history rejection;
- `LightingTransportSnapshot` channel units/bases/filters and factor ledger
  proving solar disc, sky, atmosphere, cloud, visibility, and water extinction
  are neither omitted nor double-applied;
- close beach/cliff, whole-island, multi-island, and rock/pier fixed views at
  multiple times, with bathymetry/depth/phase/flow/foam/optics diagnostics;
- final/no-optics/no-caustics/no-foam fixed views;
- renderer info, allocation ledger, dispatch count, and sustained GPU timings.

Fail the build on an unstable stencil, stale derivative state, invalid values,
double output conversion, source-space caustics presented as receiver-space
light, two geometric surface owners at a handoff, negative/unbalanced shallow
water, unexplained mass/energy loss, a cache without units/datum/channel
semantics, or any unlabeled quantitative claim.

## Routing Boundary

This skill consumes the versioned coast SDF, bathymetry, obstacle, and substrate
contract from the terrain/data owner and the shared physics ABI from
`../threejs-choose-skills/references/physics-domain-and-interaction-contract.md`.
It owns shoreline phase, bathymetry-aware
nearshore transformation, water boundary/state, bounded wave grids,
depth-averaged shallow-water wet/dry state, sparse coastal tiles, exact
small-wave parametric surfaces, transported foam, and inundation/wash exchange.
It owns integrated receiver wetness only when explicitly selected as the single
receiver owner; otherwise the route-selected receiver-state owner integrates it.
It also owns depth-aware refraction, water-volume attenuation, and bounded
caustics. Use
`$threejs-spectral-ocean` for offshore directional spectra and FFT cascades,
then hand off explicitly. Precipitation and surface accumulation consume the
`SurfaceExchange`/`InteractionRecord` boundary published by
`$threejs-rain-snow-and-wet-surfaces`; no additional adapter skill owns this
handoff. Route overturning/three-dimensional free-surface physics to an external
solver and consume its versioned provider and presentation state here.
