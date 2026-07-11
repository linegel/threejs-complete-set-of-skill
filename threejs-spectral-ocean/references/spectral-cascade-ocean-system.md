# Spectral-cascade ocean system

This reference defines a directional random sea from dimensional spectrum to
final WebGPU image. It fixes the transform, derivative, geometry, foam, and CPU
coupling conventions that most often produce plausible but wrong oceans.

For islands, shoals, reefs, harbors, cliffs, or moving shorelines, this
reference is only the offshore producer. Read the
[coastal archipelago contract](../../threejs-water-optics/references/coastal-archipelago-system.md)
for bathymetry, coastal-solver selection, terrain/water data, and wet/dry
ownership.

Read the shared
[physics-domain and interaction contract](../../threejs-choose-skills/references/physics-domain-and-interaction-contract.md)
for the SI physics frame, clock/instant/interval ordering, canonical
`WaterSurfaceProvider`,
interaction exchange, state/error versions, residency, and immutable
presentation snapshot. Solver-local FFT records do not replace those external
interfaces.

## Quantitative provenance

Use **[D] Derived**, **[G] Gated**, **[M] Measured**, and **[A] Authored** for
every quantitative claim. Unlabelled integers inside exact equations, tensor
dimensions, byte identities, and API names are [D]. Grid sizes, patch lengths,
physical/model constants, cutoffs, tolerances, timing targets, and memory
limits require an explicit tag.

## Architecture and algorithm choice

The core dataflow is:

```text
dimensional directional spectrum
  -> cascade power windows and coordinate-stable Gaussian coefficients
  -> Hermitian time evolution and frequency-space derivatives
  -> four complex transforms packed into two RGBA lane groups
  -> inverse FFT with an explicit sign and normalization
  -> summed displacement/derivatives
  -> exact tangents, Jacobian, normal, and foam source
  -> transported foam state and filterable display maps
  -> node-material optical transport
  -> one RenderPipeline output transform
```

Choose the transform architecture from target limits and evidence:

| FFT architecture | Select when | Main cost/error |
| --- | --- | --- |
| Global Stockham autosort ping-pong | Correctness reference; arbitrary supported power-of-two grid; workgroup storage is tight. | One whole-grid read/write per stage; dispatch and storage bandwidth dominate. |
| Workgroup-resident row FFT plus transpose | A row or row tile fits workgroup storage/invocation limits and occupancy passes. | Fewer global round trips; shared-memory pressure and transpose traffic. |
| Cooley-Tukey with explicit permutation | An existing verified butterfly/index table is retained. | Bit-reversal/permutation correctness and less regular access. |

Stockham autosort does not also need bit reversal. A Cooley-Tukey schedule may
need input or output permutation depending on decimation convention. Never
combine both from copied recipes.

Direct wave summation is superior when few modes satisfy the visual spectrum;
a bounded compute heightfield is superior when local disturbance and domain
boundaries dominate. FFT is not automatically the cheapest water algorithm.

## Validity domain and coastal handoff

### What the FFT does not solve

The plane-wave basis diagonalizes the linear free-surface operator only for the
declared horizontally homogeneous patch. In this reference, each cascade has a
single periodic patch, scalar mean depth, dispersion relation, and stationary
spectral statistics. A uniform mean current may Doppler-shift all modes. A
spatially varying bottom or current couples modes and invalidates independent
per-bin evolution.

Consequently, sampling a bathymetry texture in the final material does not make
the spectral solution coastal. The FFT alone cannot produce:

- refraction or shoaling caused by depth gradients;
- depth-induced breaking, bottom friction, porous-reef loss, or wave setup;
- diffraction and reflection at islands, harbor walls, cliffs, or obstacles;
- bores, hydraulic jumps, run-up, inundation, or wet/dry fronts; or
- mass-conserving flow around terrain and moving bodies.

The choppy horizontal map is render geometry. Its determinant is a compression
diagnostic, not a conservation-law solution, and clipping that map against land
does not create a boundary condition. Place the offshore/coastal coupling curve
`Gamma` inside an overlap where both models satisfy predeclared dispersion,
depth, and resolution error gates **[G]**. Do not put it at the wet/dry front.

### Shared coupling manifest

The producer and consumer serialize one manifest before allocating either
solver:

```yaml
coastalHandoff:
  mode: phase-resolved | phase-averaged
  physicsContext: "shared context id/version; SI metre frame and gravity"
  physicsSignalDescriptor: "complete shared descriptor; no local subset"
  sampleInstant: "PhysicsInstant with clock mapping/discontinuity revisions"
  transferInterval: "PhysicsTimeInterval when flux/action is integrated"
  waterDatum: "mean free-surface elevation in metres"
  bathymetrySign: "bed elevation or positive-down depth; never implicit"
  couplingGeometry: "oriented physics-frame-metre curve/tile boundary Gamma"
  coastNormal: "orientation and tangent convention"
  spectralBands: "frequency/direction support and stable IDs"
  currentField: "metres per second, sampling space, cadence, owner"
  incomingOwner: spectral-ocean
  outgoingOwner: coastal-solver | absorbing-layer
  waterSurfaceProviderAbi:
    requiredChannels: [freeSurfacePoint, freeSurfaceNormal, geometricNormalVelocityMps]
    parameterization: WaterSurfaceParameterization
    optionalChannels:
      - surfacePointVelocityMps
      - materialCurrentVelocityMps
      - waterColumnDepthMeters
      - densityKgPerM3
      - materialAccelerationMps2
      - pressurePa
      - bathymetryPoint
      - wetDryState
  renderSurfaceOwner: "one mesh/material in every overlap sample"
  foamHistoryOwner: "one state, coordinate space, transport, and remap rule"
  donorStateVersion: "version and validity/error propagation policy"
  residency: "provider state location and legal synchronization boundary"
```

The full coastal data set includes bed elevation, positive water depth, coast
distance/frame, wet mask, obstacle/porosity fields, bottom roughness, currents,
and invalid/unknown regions. The linked coastal contract defines their
generation and filtering. Spectral code consumes these only to locate and
validate the handoff; it must not silently reinterpret them.

Runoff and exposed-surface wetness never become offshore spectral state. The
coastal owner consumes the receiver-to-water runoff exchange committed for
interval `n` as immutable input to interval `n+1`, gathers it exactly once into
the provisional conservative source assembly, and advances its application
ledger only with the accepted atomic `n+1` commit. It publishes one typed
inundation/wash `SurfaceExchange` to the route-selected sole receiver; neither
the spectral donor nor a material/weather display path integrates another
copy.

### Phase-resolved boundary forcing

Use this route when instantaneous wave phase, interference, reflection, or
time-domain interaction is observable. For a linear component at the coupling
curve,

```text
eta_m(x,t) = Re{ A_m exp[i(k_m dot x - omega_abs,m t)] }

omega_abs,m = omega_int,m + k_m dot U                         [D]

q'_m(x,t) = Re{ (omega_int,m / |k_m|^2) k_m A_m
                 exp[i(k_m dot x - omega_abs,m t)] }.          [D]
```

`eta_m` is surface elevation in metres; `q'_m` is the depth-integrated wave
discharge in square metres per second **[D]**; `U` is the separately declared
uniform mean current. The discharge follows from the linear kinematic boundary
condition for the matching finite-depth Airy mode at the constant-depth
offshore side. Derive it from the elevation coefficients and intrinsic
frequency, not from the art-directed choppy displacement. Sum components only
after applying the same cascade power partition used by the rendered surface.

The evolved Hermitian height coefficient contains both propagation senses. For
that assembled coefficient `H_k(t)`, the longitudinal discharge perturbation is

```text
Q'_k = i k / |k|^2 [partial_t H_k + i(k dot U) H_k],           [D]
Q'_0 = 0.                                                       [D]
```

This is the Fourier form of
`(partial_t+U dot grad)eta+div(q')=0` **[D]**. Do not multiply the whole
assembled `H_k` by one positive `omega_int`: the counter-propagating term has
the opposite intrinsic time sign. Evaluate traveling coefficients separately
or use the time derivative above, then verify the continuity residual **[M]**.

Discharge synthesis is not free. Select one measured path:

- directly evaluate the transferred directional coefficients at the coupling-
  curve samples when the product of retained modes and boundary samples is the
  cheaper workload; if this truncates the donor, report omitted elevation,
  discharge, and energy bounds rather than silently narrowing the sea state;
- pack the two real Hermitian fields `Q'_x` and `Q'_z` as one complex transform
  and add its IFFT/resource cost when a dense boundary samples most of the
  periodic patch; or
- precompute a repeatable boundary record only when bathymetry, current, donor
  statistics, and time semantics are immutable.

For omitted directional coefficients `K_o`, fixed-coordinate triangle bounds
are

```text
B_eta = sum_(k in K_o) (|a_k| + |a_-k|),                      [D]
B_q   = sum_(k in K_o) [omega_int(k)/|k|]
                      (|a_k| + |a_-k|),                       [D]
```

with DC excluded. `B_eta` bounds elevation error in metres and `B_q` bounds the
magnitude of depth-integrated discharge error in square metres per second
**[D]**. Keep these separate from measured transform and boundary-interpolation
error **[M]**.

The global Stockham path adds `2 log2(N)` whole-grid stage dispatches per
cascade for one additional packed complex discharge transform **[D]**, before
assembly/sampling. A nominally unused second complex lane still consumes its
RGBA storage traffic unless the kernel/resource layout changes. Compare direct
boundary synthesis against the added transform on the named target **[M]**;
do not allocate a full velocity atlas merely because phase-resolved coupling
was requested.

Transfer `eta_b`, normal and tangential components of `q'_b`, surface slope,
canonical `PhysicsInstant`, donor `stateVersion`/`resourceGeneration`, and stable
mode/band identity under the handoff's complete `PhysicsSignalDescriptor`.
Requested versus actual sample time remains explicit. The coastal boundary
converts these channels to the incoming characteristic or a verified internal
wavemaker. It leaves the outgoing characteristic to the coastal solution or an
absorbing layer. Strongly prescribing both elevation and discharge while
deleting outgoing information overconstrains the boundary and manufactures
reflection.

A one-way spectral donor has no mechanism to display an outgoing reflected
field beyond `Gamma`. If that field is observable, either extend the phase-
resolving spatial domain or project the outgoing boundary signal into admissible
offshore modes. Such a projection must report phase, energy, localization,
truncation, and periodic-image residuals **[G,M]**; injecting localized
reflection into global periodic coefficients without that proof is invalid. An
absorbing layer is an authored model component **[A]** whose reflected-
amplitude curve over frequency and incidence angle is measured **[M]**.

If the coastal model does not share the offshore dispersion relation over the
coupling band, derive and gate its phase and group-velocity mismatch **[G]**.
Do not conceal the mismatch with a broad visual crossfade. At each single-mode
test, measure amplitude, phase, normal discharge, group delay, and reflected-
to-incident amplitude **[M]**.

### Phase-averaged action handoff

Use this route when near-shore statistics, direction, and breaking envelope are
observable but instantaneous offshore phase parity is not. From the height
wavevector variance density `P_eta(k)` with units `m^4` **[D]**, define a
spectral wave-energy density

```text
E(k) = [rho g + sigma_surface |k|^2] P_eta(k),                 [D]
N(k) = E(k) / omega_int(k),                                    [D]
```

where `sigma_surface` is surface tension, not intrinsic frequency. Integrating
`E(k) d^2k` yields energy per horizontal area **[D]** under the linear
capillary-gravity model. For gravity-only coastal models, set the capillary
term to `not represented` and quantify discarded band energy **[M]** instead of
quietly changing units.

The near-shore owner advances a declared action balance such as

```text
partial_t N
  + div_x[(U + c_g) N]
  + div_k[k_dot N]
  = S_total / omega_int,                                      [D]
```

with depth/current refraction in `k_dot` and named source terms for wind input,
whitecapping, bottom loss, depth breaking, and numerical dissipation. The exact
discretization and source models are coastal-owner decisions. Transfer
dimensioned frequency/direction bins or wavevector cells, `N`, `omega_int`,
group velocity, `U`, and band IDs. The coastal renderer may synthesize local
phases, but must label them statistically consistent rather than phase exact.

For an oriented coupling curve whose normal points from the coastal domain to
offshore, the incoming action and energy fluxes are integrals over modes with
`(U+c_g) dot n_Gamma < 0` **[D]**. Record incoming, reflected, transmitted,
bottom-dissipated, breaking-dissipated, and numerically lost flux in one unit
system **[M]**. When currents vary, action rather than absolute wave energy is
the conserved transport variable; a frozen per-tile Doppler shift is accepted
only after cumulative phase and refraction errors pass gates **[G,M]**.

### Band, render, and derivative ownership

Do not let both solvers independently represent the same stochastic energy.
Only disjoint Fourier bins or fields proven to have zero cross-covariance may
use power windows

```text
w_offshore(k) + w_coastal(k) = 1,    w >= 0,                  [D,G]
A_owner(k) = sqrt(w_owner(k)) A(k).                            [D]
```

This is a partition of uncorrelated represented power, not attenuation of a
physical wave as it crosses `Gamma`. Coherent copies have a covariance cross-
term and square-root weights generally amplify their variance. If a phase-
resolved coastal solve receives the same component, preserve its full incoming
phase and amplitude, assign one spatial render owner, and do not reseed it. If
the two coherent approximations need a render-only transition with scalar
coastal weight `beta(x)`, use amplitude weights whose sum is one, phase-match
them, form one composite field, and differentiate that field:

```text
eta = (1-beta) eta_o + beta eta_c,                             [D]

grad eta = (1-beta) grad eta_o + beta grad eta_c
         + (eta_c-eta_o) grad beta.                            [D]
```

Apply the same product rule to horizontal displacement and velocity. Build the
normal from the resulting displaced tangents. Omitting the weight-gradient
term creates a slope seam even when heights meet; lerping already-normalized
normals cannot repair it. Prefer one clipped surface/material owner through the
transition. Two coincident transparent water meshes double refraction and
Fresnel energy and have unstable ordering.

### Current contract

The FFT may include one uniform current `U_0` by evolving phase with
`omega_abs=omega_int+k dot U_0` **[D]**. Its wavevector amplitudes and
directions remain those of the homogeneous patch. A current gradient changes
wavevector, action density, and ray path; route that region to action transport
or a phase-resolving spatial solver. Never advect the final displacement
texture over a varying current and claim refraction. The handoff records mean
current, wave-induced discharge, and render displacement as separate signals.

### Canonical water-provider adapter

The FFT and its reduced CPU sampler are internal representations. External
motion, creature, force, and contact consumers query the shared
batched, channel-requested `WaterSurfaceProvider`, in physics-frame metres,
with a declared footprint/filter,
frame and one canonical instant-selected `PhysicsTime` request. The adapter
returns:

```text
domain channel records:
  freeSurfacePoint
  freeSurfaceNormal
  geometricNormalVelocityMps   # mandatory gauge-invariant scalar interface speed
  surfacePointVelocityMps?     # optional fixed-coordinate velocity under the serialized parameterization
  materialCurrentVelocityMps?  # represented declared mean/current only
  waterColumnDepthMeters?      # valid depth/datum only
  densityKgPerM3?              # optional SI density channel
  materialAccelerationMps2?, pressurePa?, bathymetryPoint?, wetDryState?
sample bundle/envelope:
  descriptor: PhysicsSignalDescriptor
  sampleInstant: PhysicsInstant
  surfaceParameterization: WaterSurfaceParameterization
  representedFootprint, filter, validity, error, absentChannels
```

Every channel is the complete shared `SampledChannel`, including actual time,
support/filter, validity, error, and `stateVersion`. The complete
shared `PhysicsSignalDescriptor` and bundle `sampleInstant` are returned without
a spectral-local subset. For an instantaneous water query,
`PhysicsSampleRequest.requestedPhysicsTime`, response `requestedPhysicsTime` and
`actualBundleTime`, and every instantaneous channel's `actualPhysicsTime` are
complete `PhysicsTime` wrappers with `kind: instant`, a populated
`instant: PhysicsInstant`, and a complete `TypedAbsence` in `interval`.
`WaterSurfaceSample.sampleInstant` remains the raw `PhysicsInstant`. The
requested and returned actual instants may differ only within declared
latency/staleness gates. Descriptor discovery supplies a stable table ID/version, and
packed hot batches use that reference plus SoA channels rather than deep-copying
the descriptor. The descriptor owns
the footprint/filter actually represented, validity, per-channel error,
residency/latency/cadence, state/resource generation, frame/transform/source
epochs, and missing-channel policy.

The surface-point velocity is differentiated at fixed coordinates of the exact
serialized parameterization from the same seeded spectral field and horizontal
map used for geometry; it is not phase speed or group speed. When that optional
vector is present, the exact identity is
`geometricNormalVelocityMps = dot(surfacePointVelocityMps,
freeSurfaceNormal)` at the same actual time, support/filter, and state version;
its channel propagates correlated vector/normal error. The scalar is
parameterization/gauge invariant and is mandatory even when an implicit or
reduced owner publishes it directly and marks the full fixed-coordinate vector
absent. Material current is the separately declared fluid current `U`, not surface motion. Missing current,
depth, or density is absent with structured validity; zero remains a
represented physical value. Footprint filtering removes modes that the
response footprint cannot resolve and reports the omitted
height/slope/velocity contribution.

Both returned vector velocity channels are physical polar vectors in
`physicsFrameId`. A frame change rotates their basis only. A translating or
rotating frame's coordinate derivative is a distinct coordinate-rate schema;
do not add origin or `omega x r` transport terms to an already physical vector.

The homogeneous FFT normally reports acceleration, pressure, bathymetry, and
wet/dry channels absent as well; an adapter may expose one only under a named
model with the channel's actual support, validity, and error.

The adapter composes reduced-coefficient bounds, Eulerian-inversion residual,
CPU numeric error, GPU-probe discrepancy when measured, filter truncation,
clock skew/latency, and source `stateVersion`. A lagged GPU reduction is a
lagged measurement, not a bound for the requested tick. The frame path performs
no synchronous readback.

A homogeneous periodic FFT may service one-way samples only when the
authoritative source is identified and omitted feedback has a `[G]` upper bound
or the claim/regime is explicitly narrowed. It rejects two-way
body/source `InteractionRecord` loads because it has no localized
mass/momentum boundary response. Such interactions route to the coastal/
bounded solver or an external hydrodynamic solver, whose conservation group
owns both source and reaction.

### Foam transfer

There is one foam-history owner at each physics-frame point. Transfer it as one
versioned provider signal, not a bare local tuple. The complete
`PhysicsSignalDescriptor` carries context, physics frame, physics-origin epoch,
transform revision, chart when applicable, footprint/filter, cadence/latency/
residency, state/resource generation, validity, missing-channel policy, and
per-channel error. Its canonical `SampledChannel`s carry coverage `[1]`, source
rate `[s^-1]`, carrier velocity `[m s^-1]`, diffusion `[m^2 s^-1]`, and decay
rate `[s^-1]`, with bundle `sampleInstant: PhysicsInstant`. Each channel's
`actualPhysicsTime` selects the arm required by its descriptor's
`timeSemantics`: instantaneous channels use the `instant` arm; source-rate
channels with an actual sampling interval use the `interval` arm. The inactive
arm is a complete `TypedAbsence`. No
independent seconds timestamp is legal. An atlas/coordinate ownership change
uses a declared conservative state map and records remap, clamp, and lost-
coverage residuals.

Attribute offshore whitecap and depth-breaking dissipation to exactly one owner
per band and physics region. Combine those disjoint dissipation terms, then apply
one calibrated conversion into one bounded foam source/reaction update.
Saturating-addition or partitioning of two evolved histories double counts
persistence. When spectral history in parameter space is handed to an Eulerian
coastal atlas, conservatively remap covered area using the displaced-map
Jacobian and report remap loss, clamp loss, and invalid cells **[M]**. Breaking
energy loss and foam coverage have different units; their source conversion is
an authored calibrated model **[A]** with measured coverage and decay evidence
**[M]**.

### Mobile and low-end architecture

All tiers remain WebGPU implementations and preserve the same water datum,
coast geometry, energy/band ownership, and single-output contract:

- **Full.** Offshore FFT plus visible/active phase-resolved coastal tiles when
  interference, reflection, or run-up is required.
- **Budgeted.** Reduce FFT bands from measured variance/slope/image error;
  propagate near-shore action at an independently gated cadence; synthesize a
  bounded analytic phase field for display; activate interaction grids only
  around observable events.
- **Minimum viable.** If displacement and instantaneous phase project below
  their gates, replace the FFT with a few direct modes or filtered normal bands
  owned by `$threejs-water-optics`, and use precomputed bathymetry/coast-distance
  data plus causal shoreline foam. Record spectral-ocean, phase-resolved solve,
  and unused history buffers as `not used` in the route manifest.

Precompute stationary bathymetry pyramids, coast distance/frame, obstacle masks,
and bottom classes. Stream sparse coastal tiles by projected error and solver
support, not viewport resolution. Reduce storage traffic and active domain
before arithmetic. A lower action/foam update cadence requires transport and
reprojection error evidence **[G,M]**. No tier receives a generic device-class
grid, cascade, cadence, or timing budget.

Any tier change that alters a physics-facing spectrum band, coastal solver or
owner, active domain, cadence, provider filter/error, conserved inventory, or
interaction cursor is admitted only through the route coordinator's
`QualityTransition`. It prepares and conservatively maps or explicitly resets
state, commits provider/resource generations and exactly-once ledgers at one
scheduler boundary, and retires the old representation after all consumers
complete. Render-only mesh, normal, or post sampling changes do not mutate the
physical provider.

## Pinned Three.js r185 WebGPU/TSL contract

The API statements here were checked against installed `three@0.185.1`
**[G]**.

```js
import {
  FloatType,
  HalfFloatType,
  MeshPhysicalNodeMaterial,
  NoColorSpace,
  RenderPipeline,
  StorageTexture,
  WebGPURenderer,
} from 'three/webgpu';

import {
  Fn,
  instanceIndex,
  mrt,
  normalView,
  output,
  pass,
  renderOutput,
  textureLoad,
  textureStore,
  velocity,
  workgroupArray,
  workgroupBarrier,
} from 'three/tsl';

const renderer = new WebGPURenderer( { antialias: false } );
await renderer.init();

if ( renderer.backend.isWebGPUBackend !== true ) {
  throw new Error( 'WebGPU is required for the spectral transform.' );
}
```

After initialization, `renderer.compute(nodeOrArray)` records one compute pass
and iterates an array in order. `renderer.computeAsync()` guarantees renderer
initialization before the same submission; it does not await GPU completion.
`workgroupBarrier()` synchronizes invocations within one workgroup only. A
whole-grid producer/consumer dependency needs a later dispatch.

Set every FFT and simulation texture to `NoColorSpace`, disable generated
mipmaps, and use integer `textureLoad` during transforms. `FloatType` storage is
the precision reference **[A]**. `HalfFloatType` is retained only after measured
error gates **[M]**. If a resolved float texture must be filtered, check
`renderer.hasFeature('float32-filterable')`; otherwise resolve to a validated
filterable representation.

Device choices use the initialized `renderer.backend.device.limits`. Record
the exact limits that selected workgroup size, shared storage, and dispatch
shape **[M]**.

Use `RenderPipeline`, `pass()`, optional `mrt()`, and one output transform. When
using `renderOutput()` explicitly, set `pipeline.outputColorTransform=false`.
Set `pipeline.needsUpdate=true` after replacing the output graph.

## Environment-forcing adapter for wind sea

The spectral model consumes the shared `EnvironmentForcingSnapshot`; it never
reads a vegetation gust uniform, rain-particle drift, camera-relative wind, or
raw instantaneous air velocity and treats that value as a sea state. A
spectral-forcing adapter records:

```text
complete PhysicsSignalDescriptor and sampleInstant: PhysicsInstant
airVelocityMps plus its measurement/reference height and actual filter
vertical-profile/drag model, roughness and atmospheric stability treatment
fetch geometry and forcing duration/wave age
directional-spreading family and its calibrated parameters
represented wind input, whitecapping, nonlinear-transfer, and bottom terms
spectral forcing adapter calibration/version.                            [D]
```

The `PhysicsGraph` latches this descriptor/version at `sample-forcing` for its
declared interval. Coefficient evolution consumes that immutable version and
that `PhysicsInstant`; it never resamples render time or mutable weather state.

When a logarithmic boundary-layer profile is justified, a neutral/stability-
corrected adapter may use

```text
Phi_m(z) = ln((z-d)/z_0)
           - psi_m((z-d)/L_MO) + psi_m(z_0/L_MO),
U(z) = (u_star/kappa) Phi_m(z),
U_10 = U(z_r) Phi_m(10 m) / Phi_m(z_r).                        [D]
```

with displacement height `d`, aerodynamic roughness `z_0`, von Karman constant
`kappa`, Monin-Obukhov length `L_MO`, and stability function `psi_m`. The
adapter derives the wind vector at 10 m from the ratio above, requiring
`z_r>d+z_0`, `10 m>d+z_0`, finite nonzero profile factors, and a calibration
range that covers both heights. `u_star`, `z_0`, `d`, stability, and
calibration range carry provenance. If those inputs are unavailable, use a
named calibrated transfer or require supplied `U10`; do not silently assume a
neutral profile. Preserve direction during the conversion and report calm,
invalid-height, and out-of-calibration cases.

Fetch is the upwind water-path geometry seen by the forcing footprint, not an
arbitrary scalar copied across islands; duration/wave age controls whether the
target sea can have reached a stationary fetch-limited spectrum. The adapter
therefore produces calibrated reference-height wind, fetch/duration/stability,
directional spreading, and represented source-term parameters with propagated
error/version. A stationary FFT initializes or slowly retargets its statistical
state from a documented snapshot. A genuinely evolving sea advances a
validated spectral action/energy source balance while preserving coefficient
phase continuity; it does not regenerate independent Gaussian coefficients on
each gust.

Water mean current remains a separate `WaterSurfaceSample` channel and Doppler
term. It is not atmospheric wind. Conversely, wind forcing never becomes
`materialCurrentVelocityMps`. Short gusts may drive spray and small-scale
appearance without claiming that the equilibrium wave spectrum responded
instantaneously.

## Wavevector grid and transform convention

For a square periodic patch of length `L`, even power-of-two resolution `N`,
and centered integer indices `s_x,s_z`:

```text
Delta k = 2 pi / L
k = Delta k (s_x,s_z)
s_axis in {-N/2, ..., N/2-1}.                                  [D]
```

The axis Nyquist magnitude is `pi N/L` **[D]**. Grid corners have larger radial
magnitude but anisotropic angular support. A circular upper mask
`|k| < pi N/L` is the clean isotropic bound **[D]**; reserve a transition guard
band selected by an alias/leakage gate **[G]**.

DC is exactly zero for a zero-mean surface. Compute a finite `kSafe` before any
division and branch/select DC away before evaluating inverse powers. Multiplying
an already generated NaN by a zero window does not remove it.

This reference uses the unnormalized inverse discrete transform

```text
f[j_x,j_z] = sum_(n_x,n_z) F[n_x,n_z]
             exp(+i 2 pi (n_x j_x+n_z j_z)/N).                 [D]
```

Consequences:

```text
unit DC coefficient -> unit constant field
unit axis bin -> unit complex sinusoid
sum_j |f_j|^2 = N^2 sum_n |F_n|^2
mean_j |f_j|^2 = sum_n |F_n|^2.                                [D]
```

If a kernel normalizes by `1/N` per axis or `1/N^2` overall, initial
coefficients must be scaled by the inverse factor. State the choice once in
kernel code, CPU reference, tests, and spectrum initialization.

Centered storage requires exactly one reconciliation with the FFT's unshifted
index convention: either apply an `ifftshift` permutation before the transform
or multiply the spatial output by `(-1)^(j_x+j_z)` **[D]**. Doing both restores
the wrong checkerboard; doing neither modulates the result.

## Dispersion and dimensional spectrum

### Capillary-gravity finite-depth dispersion

For wavenumber magnitude `k`, gravity `g`, depth `d`, surface tension `sigma`,
and density `rho`, define `tau=sigma/rho`:

```text
omega^2(k) = (g k + tau k^3) tanh(k d).                         [D]
```

Units are:

```text
[g k] = s^-2
[tau k^3] = s^-2
[omega] = s^-1.                                                 [D]
```

The radial group-speed factor required for a spectrum conversion is

```text
d omega/dk = {
  (g+3 tau k^2) tanh(kd)
  + (gk+tau k^3) d sech^2(kd)
} / (2 omega).                                                  [D]
```

Evaluate it with a safe small-`k` branch. Any saturation of `kd` in `tanh` or
`sech` is a numerical approximation whose maximum error is **[G]** and measured
against the unsaturated CPU expression **[M]**.

As a scale check only: using `tau=7.28e-5 m^3 s^-2` **[A]**, `g=9.81 m s^-2`
**[A]**, `L=5 m` **[A]**, and `N=512` **[A]** gives isotropic
`k_max=321.70 rad m^-1` **[D]**, capillary/gravity ratio
`tau k_max^2/g=0.768` **[D]**, and deep-water phase-speed multiplier
`sqrt(1+0.768)=1.330` **[D]** relative to gravity-only dispersion. Omitting
capillarity there is not a small phase error.

### Frequency spectrum to wavevector density

Let `S_omega(omega,theta)` be directional angular-frequency variance density:

```text
integral S_omega d omega d theta = variance(h),
[S_omega] = m^2 s.                                              [D]
```

Let the directional distribution `D(omega,theta)` satisfy
`integral D dtheta=1` **[D,G]**. Convert to two-dimensional Cartesian
wavevector density using polar area `d^2k=k dk dtheta`:

```text
P(k_x,k_z)
  = S_omega(omega(k),theta) |d omega/dk| / k,
[P] = m^4,
integral P d k_x d k_z = variance(h).                           [D]
```

This `1/k` Jacobian and the discrete `Delta k_x Delta k_z` cell area are both
required. Validate the numerical directional normalization at each frequency
**[M]**, because a powered-cosine lobe's normalization changes with exponent.

A JONSWAP model may be used as an authored empirical sea-state family:

```text
S_J(omega) = alpha g^2 omega^-5
  exp[-5/4 (omega_p/omega)^4]
  gamma^r,

r = exp[-(omega-omega_p)^2/(2 sigma_J^2 omega_p^2)].            [A]
```

The conventional split `sigma_J=0.07` below the peak and `0.09` above it is
**[A]**. One fetch-limited parameterization is

```text
alpha = 0.076 (g F/U_10^2)^(-0.22)
omega_p = 22 (g^2/(U_10 F))^(1/3),                              [A]
```

whose dimensionless fetch group and `s^-1` peak units are explicit **[D]**.
The coefficients `0.076`, `0.22`, and `22` are empirical **[A]**, not universal
constants. Record the selected spectrum family, wind-height convention, fetch,
peak enhancement, swell model, and directional model as authored inputs.

A TMA finite-depth shape factor is dimensionless **[D]**. If used, apply it
once to the variance spectrum while still using the finite-depth dispersion and
its group-speed Jacobian. Document the exact formulation so finite-depth energy
corrections are not accidentally duplicated.

## Cascade quadrature and deterministic coefficients

### Power partition

For conceptual cascade power windows `w_c(k)`:

```text
w_c(k) >= 0,
sum_c w_c(k) = 1 over the target band.                           [D,G]
```

Two valid choices are:

- hard half-open bands `[k_low,k_high)`, with exact single ownership;
- smooth overlapping windows, assigning `P_c=w_c P` and therefore amplitude
  multiplier `sqrt(w_c)` **[D]**.

Amplitude windows that sum to one do not conserve expected power; power windows
must sum to one. Each window support must lie inside that cascade's representable
isotropic band, including guard bins. Numerically integrate every cascade and
the sum, then compare realized variance to the target **[M]**.

Patch length sets both `Delta k` and exact spatial repetition. Choose the large
patch from the visible footprint/repetition gate **[G]**, not from a fixed
preset. Choose smaller patches so their coarser `Delta k` does not leave a
quadrature hole at handoff. Sharp cutoffs can ring in correlation space; smooth
power windows trade a controlled overlap for reduced ringing.

### Gaussian coefficient normalization

Generate coordinate-stable independent normal variates from
`(seed,cascade,index_x,index_z)`. Masking or changing a cutoff must not consume a
different random sequence.

Let

```text
zeta_k = (xi_1 + i xi_2)/sqrt(2),
xi_1,xi_2 ~ N(0,1),
E|zeta_k|^2 = 1.                                                [D]
```

For unnormalized inverse synthesis, initialize

```text
a_k = sqrt( P_c(k) Delta k_x Delta k_z / 2 ) zeta_k.           [D]
```

Evolve height coefficients as

```text
H_k(t) = a_k exp(-i omega_k t)
       + conjugate(a_-k) exp(+i omega_k t).                     [D]
```

Then `H_-k=conjugate(H_k)` **[D]**, and expected spatial variance sums to the
quadrature of `P_c` under the stated transform convention **[D]**. Directional
asymmetry between `P(k)` and `P(-k)` controls propagation while the instantaneous
height remains real.

At self-conjugate cells, construct a real `H` explicitly. Set DC to zero. Store
the Gaussian convention next to the amplitude equation; using unnormalized
real and imaginary normals without the `1/sqrt(2)` changes variance by a derived
factor of two **[D]**.

## Frequency-space displacement and derivatives

### Sign convention and fields

With the positive-exponent inverse transform above, define positive choppiness
`chi` by

```text
D_x_hat = +i (k_x/k) H
D_z_hat = +i (k_z/k) H.                                        [D]
```

For the one-dimensional mode `h=a cos(kx)`, this yields
`D_x=-a sin(kx)` and `X=x-chi a sin(kx)` **[D]**, so a positive `chi` compresses
the height crest. This one-mode result is a mandatory sign test.

Compute all required fields before the IFFT:

```text
height:                 H
horizontal D_x:        +i k_x/k H
horizontal D_z:        +i k_z/k H
height slope h_x:      +i k_x H
height slope h_z:      +i k_z H
D_xx:                   -k_x^2/k H
D_zz:                   -k_z^2/k H
D_xz = D_zx:            -k_x k_z/k H.                           [D]
```

The cross derivatives are equal because the displacement is generated by one
scalar spectral potential **[D]**. Set every divided field to zero at DC.

### Hermitian projection and Nyquist lines

On an even grid, the represented Nyquist value in an axis has no distinct
positive-frequency partner. A multiplier odd in that axis breaks discrete
Hermitian symmetry unless its Nyquist line is zero.

Apply field-specific rules:

```text
D_x and h_x: zero the k_x Nyquist line
D_z and h_z: zero the k_z Nyquist line
D_xz:        zero either Nyquist line
D_xx,D_zz:   even multipliers; no blanket line mask
height:      preserve, with self-conjugate cells real.          [D]
```

After construction, validate `F(-k)=conjugate(F(k))` for every field. A
pairwise projection

```text
F_p(k) = [F(k)+conjugate(F(-k))]/2                              [D]
```

is a useful validation/reference operation; a production kernel should
construct the same result without an unnecessary pass. Record post-IFFT
imaginary leakage for every packed lane **[M]**.

## Packing four complex transforms

Pair two Hermitian spectra `A` and `B` into one complex transform:

```text
G = A + i B
G_re = A_re - B_im
G_im = A_im + B_re.                                             [D]
```

After the IFFT, `real(g)=a` and `imag(g)=b` **[D]**. A complete layout is:

```text
G_0 = D_x  + i D_z
G_1 = h    + i D_xz
G_2 = h_x  + i h_z
G_3 = D_xx + i D_zz.                                           [D]
```

Store `G_0,G_1` as two complex lanes in one RGBA texture and `G_2,G_3` in a
second. Thus eight real spatial fields require four complex IFFTs but only two
RGBA lane groups **[D]**. `[A.re,B.re,A.im,B.im]` is not this packing and cannot
be unpacked by simply reading real/imaginary output lanes.

## Inverse FFT implementation

### Global Stockham reference

A global Stockham autosort implementation uses `log2(N)` stages per axis
**[D]**, ping-ponging source and destination. It performs the permutation as
part of the stages and has no separate bit reversal.

For each stage:

- every output texel has exactly one invocation/writer;
- both butterfly inputs come from the read texture;
- both complex lanes use identical indices/twiddles;
- the next stage is a later dispatch;
- source and destination swap only after the whole stage.

Two separately dispatched RGBA lane groups cost
`4 log2(N)` whole-grid stage dispatches per cascade across both axes **[D]**.
A kernel that processes both lane groups together can reduce dispatch count but
increases bindings, registers, and storage traffic per invocation; accept it
only from measured occupancy/timing **[M]**.

### Workgroup-resident rows

When one row or row tile fits initialized device limits, load it into
`workgroupArray`, execute radix stages with `workgroupBarrier()` between shared
memory dependencies, write a transposed intermediate, and repeat for the second
axis. Shared storage must be computed from the WGSL element type, not the
storage-texture bit depth: loading half-float storage into `vec4<f32>` consumes
full float workgroup bytes **[D]**.

Gate:

- workgroup storage and invocation limits **[G]**;
- no bank/pathological access pattern under the target implementation **[M]**;
- occupancy and register pressure **[M]**;
- transform error identical to the global reference gate **[G,M]**;
- transpose traffic and total GPU time **[M]**.

Large rows can use multiple workgroups only with a mathematically valid
decomposition and a dispatch boundary between cross-workgroup stages. A
workgroup barrier cannot synchronize two workgroups.

### Ordered submission

After initialization:

```js
renderer.compute( [
  ...evolutionNodes,
  ...horizontalTransformNodes,
  ...verticalTransformNodes,
  ...assemblyNodes,
  foamNode,
] );
```

In a coupled route, those dispatches are implementation work recorded as
executions of declared `PhysicsGraphStage`s with exact execution intervals,
versioned reads/writes, residency dependencies, and commit groups. Their array
order does not authorize an ad-hoc render-loop timestep: rendering consumes a
sealed presentation publication and never advances coefficients, coastal
state, runoff, or disturbances privately.

The array order is an r185 API property verified in this repository **[G]**.
Do not `await computeAsync()` every frame expecting a GPU fence. Use timestamp
queries or explicit readback APIs only in asynchronous diagnostics.

## Transform validation gate

Before using a random spectrum, compare GPU output against a pure CPU DFT for a
small power-of-two grid selected as a test fixture **[A]**. Gates are chosen by
storage precision **[G]** and results are **[M]**.

Required cases:

```text
DC:
  F(0,0)=1 -> f=1

positive x bin:
  f=exp(+i 2 pi j_x/N)

positive z bin:
  f=exp(+i 2 pi j_z/N)

oblique bin:
  detects axis swap and transposition

conjugate pair:
  expected real cosine and near-zero imaginary residue

Nyquist lines:
  checks every field-specific mask and packing partner

random complex field:
  maximum, RMS, relative L2, and Parseval error.                [D]
```

Diagnose by symptom:

| Symptom | Likely fault |
| --- | --- |
| Alternating sign on DC | centered-order correction missing or duplicated |
| Sine travels backward | inverse twiddle sign or time-evolution sign |
| Axes exchanged | row/column index or transpose fault |
| Every later stage corrupts | ping-pong parity or missing dispatch boundary |
| Real fields leak into packing partners | broken Hermitian/Nyquist rule or packing algebra |
| Correct shape, wrong amplitude | IFFT normalization or Gaussian/cell-area factor |

Do not compensate a failed transform by changing spectrum amplitude,
choppiness, foam threshold, or exposure.

## Spatial assembly and exact surface geometry

Binding topology is part of the algorithm. Gate the initialized device's
`maxStorageTexturesPerShaderStage` before creating assembly kernels. The fused
reference assembly binds seven storage textures and is only a candidate when
that limit and the compiled layout admit it. The portable path splits the same
dependency graph into ordered dispatches using at most three storage textures
per dispatch, with distinct intermediate resources across global dependencies.
Measure both where available; fusion is not automatically faster on a
bandwidth- or occupancy-limited target.

Sum all cascades at the same parameter coordinate before nonlinear operations:

```text
h     = sum_c h_c
D_x   = sum_c D_x,c
D_z   = sum_c D_z,c
h_x   = sum_c h_x,c
h_z   = sum_c h_z,c
D_xx  = sum_c D_xx,c
D_zz  = sum_c D_zz,c
D_xz  = sum_c D_xz,c.                                         [D]
```

For

```text
P(q) = (q_x + chi D_x, h, q_z + chi D_z),                     [D]
```

define

```text
A = 1 + chi D_xx
B =     chi D_xz
C = 1 + chi D_zz.                                              [D]
```

Then

```text
P_qx = (A, h_x, B)
P_qz = (B, h_z, C)

J = A C - B^2

n_unnormalized = cross(P_qz,P_qx)
  = (h_z B - C h_x,
     J,
     B h_x - h_z A).                                           [D]
```

The exact upward normal is `normalize(n_unnormalized)` while `J>0` **[D]**.
The shortcut

```text
(-h_x/A, 1, -h_z/C)
```

is wrong when `B != 0` and even its same-axis division does not reproduce the
cross product. Validate analytic normals against central differences of the
displaced map **[M]**.

Compute the determinant from the summed derivative matrix. Determinants do not
sum across cascades. Gate minimum `J` **[G]**, report its distribution and fold
count **[M]**, and treat `J<=0` as a representational failure/breaking event.
Flipping the normal hides the fold but does not restore a single-valued map.

Resolved maps may pack:

```text
displacement = (chi D_x, h, chi D_z, validity)
tangentA     = (h_x, h_z, chi D_xx, chi D_zz)
tangentB     = (chi D_xz, J, foamSource, diagnostic).           [D]
```

Foam history belongs to its own ping-pong state unless a packed channel's
read/write lifetime is proven non-conflicting.

## Foam source, transport, and decay

Jacobian compression is a visual breaking proxy, not a complete breaking-wave
model. Derive a bounded source `s>=0` from combined-cascade compression,
negative material derivative of `J`, curvature, or a calibrated combination.
Thresholds and gains are **[A]**; source-versus-reference agreement is **[M]**.

The state equation is

```text
D f/Dt = s(1-f) - f/tau_f + kappa Laplacian(f),
0 <= f <= 1.                                                     [D]
```

With source held constant during a step and diffusion handled separately, the
exact reaction update is

```text
r = s + 1/tau_f
if r > 0:
  f_eq = s/r
  f_next = f_eq + (f_advected-f_eq) exp(-r dt)
else:
  f_next = f_advected.                                          [D]
```

This makes source and decay timestep-correct. When `s=0`, it reduces to
`f_next=f_advected exp(-dt/tau_f)` for finite `tau_f`; zero source with
infinite decay time takes the explicit `r=0` identity branch **[D]**.

Declare the transport space:

**Lagrangian parameter history.** A texel is attached to `q` and therefore
moves with the spectral horizontal map. This is the cheapest coherent option,
but it does not add wind drift or exchange after folds.

**Eulerian/physics-frame history.** Backtrace with surface transport velocity
and sample a stable physics-frame atlas. Camera-relative storage is only an
implementation window with an explicit origin epoch and conservative remap; it
never changes the coordinates of the conserved state. Semi-Lagrangian transport is stable
for large steps but diffusive; gate backtrace distance in texels and mass loss
**[G,M]**. A bounded MacCormack/BFECC correction costs more and must clamp to
the source neighborhood to avoid negative/overshoot coverage.

**Conservative finite-volume transport.** Use when coverage mass matters. For
an unsplit first-order upwind update, a sufficient positivity CFL is

```text
|u_x| dt/dx + |u_z| dt/dz <= 1.                                [D]
```

For explicit central diffusion, stability requires

```text
kappa dt (1/dx^2 + 1/dz^2) <= 1/2.                             [D]
```

Do not maintain independent foam histories per cascade and then saturating-add
them without a power/coverage model. Form one combined breaking source first,
then evolve one declared history representation. Diagnose source, pre-advection
state, transported state, reaction result, and display coverage separately.

## Optical transport and final material

The ocean material consumes the exact displacement, tangents, normal,
Jacobian, and foam state. It must not reconstruct a different wave cause from
unrelated normal textures.

Consume the shared typed `LightingTransportSnapshot`. Use its
`incidentRadiance` channel for the visible sky/reflected ray where requested,
and its separately identified `directSolarIrradiance`, `skyIrradiance`,
`surfaceIrradiance`, `transmittance`, and `sourceDirection` channels. Each keeps
its radiometric quantity/unit, spectral/working basis, angular/spatial filter,
factor identity/revision, validity, and error; the snapshot states whether sky
irradiance already includes the disc. Atmosphere, cloud, opaque-visibility, and
water-extinction factors apply exactly once. Radiometry is not an
`InteractionRecord`. Evaluate
side-aware dielectric Fresnel and Beer-Lambert attenuation as specified in
`../../threejs-water-optics/references/water-surface-system.md`. For water-side
views use exact Fresnel near total internal reflection. A specular node material
already contains direct-light glint; do not add another sun lobe without
removing or budgeting the first.

An energy-auditable composition is

```text
L_water = F L_reflection
        + (1-F) [T L_background + (1-T) omega_0 L_source]
L_final = (1-f) L_water + f L_foam.                             [D]
```

Here `T=exp[-(sigma_absorb+sigma_scatter) ell]` and
`omega_0=sigma_scatter/(sigma_absorb+sigma_scatter)` use the
zero-extinction branch and source/
phase convention from the bounded-water reference. Absorption is not an
in-scattering source.

Caustics in shallow scenes require receiver-space flux deposition; a bright
projected texture is not sufficient. Use the bounded-water reference's
differential-area mapping.

Use one `RenderPipeline`. Simulation/data textures use `NoColorSpace`; input
color textures use their actual color space; intermediate radiance remains
linear HDR; tone mapping and output conversion occur once. Add bloom, ambient
occlusion, or temporal reconstruction only when their input signals and cost
pass explicit gates **[G,M]**.

The spectral owner contributes a `PresentedStatePair` to the view-independent
`PhysicsPresentationCandidate`, which contains no camera or render transform.
`previousPresented` and `currentPresented` each carry independent
`PresentationSampleProvenance`, `presentedInstant`, state handle, and global
spatial binding. A per-view `CameraViewPublication` owns render mappings and
camera matrices; `ViewPreparationPublication` owns visibility, shadows, caches,
reactive publications, and resets. The sealed `PhysicsPresentationSnapshot`
references candidate binding IDs and lease refs rather than copying pairs or
transforms, and `FrameExecutionRecord` records multi-target completion plus
lease disposition keyed by lease ID. Those presented states need not be solver
states `n` and `n+1`. Their independent provenance, errors, and motion validity jointly
own displacement, exact derivatives, surface
velocity, foam, shadows, motion vectors, and temporal reconstruction.
Physics-time, physics-frame transform, floating-origin, and source-data epochs
remain separate. State/residency/coefficient/quality or transform/source-epoch
changes that break continuity produce scoped `ReactivePublication` and
`ScopedResetAction` records in `ViewPreparationPublication` or explicitly
migrate history; reset flags are not extra pair or snapshot fields.

## CPU coupling and rigorous truncation error

### Parameter-coordinate query

Retain a deterministic subset `K_r` of seeded coefficients on CPU. For omitted
set `K_o`, define

```text
B_0 = sum_(k in K_o) (|a_k|+|a_-k|)
B_1 = sum_(k in K_o) |k| (|a_k|+|a_-k|)
B_t = sum_(k in K_o) |omega_param(k)| (|a_k|+|a_-k|),          [D]

omega_param = omega_abs for a physics-frame-stationary q,
omega_param = omega_int for a parameter chart advected exactly by U.         [D]
```

At any time and fixed parameter coordinate:

```text
|h_full-h_reduced| <= B_0
||grad h_full-grad h_reduced|| <= B_1
||chi D_full-chi D_reduced|| <= chi B_0
|partial_t h_full-partial_t h_reduced| <= B_t
||chi partial_t D_full-chi partial_t D_reduced|| <= chi B_t.   [D]
```

The last two bounds apply to `surfacePointVelocityMps`, which is the derivative
of `P(q,t)` at fixed surface parameter as required by the shared ABI. After a
physics-horizontal inversion, add the recovered-parameter error propagated
through the spatial Jacobian of that velocity; do not relabel the vertical
Eulerian height rate or phase/group speed as the full surface-point velocity.
Serialize whether `q` is physics-frame stationary or advected by the uniform
current; that choice selects `omega_param` and cannot change between geometry
and provider evaluation.

Sort retained modes for the queried quantity: amplitude controls height,
whereas `|k|`-weighted amplitude controls slopes/normals. A single
"dominant-bin" list is not optimal for both.

### Physics-horizontal query

For physics-frame horizontal coordinate `x`, solve

```text
X(q) = q + chi D(q) = x.                                       [D]
```

Let

```text
G = sum_all |k| (|a_k|+|a_-k|)
L = chi G.                                                       [D]
```

If `L<1`, the horizontal map is globally a contraction perturbation of the
identity under this conservative bound. The reduced/full inverse-coordinate
error obeys

```text
||q_full-q_reduced|| <= chi B_0/(1-L),                          [D]
```

and the Eulerian height error obeys

```text
|h_full(q_full)-h_reduced(q_reduced)|
  <= B_0 + G chi B_0/(1-L).                                    [D]
```

This bound is conservative. When `L>=1` or folds are allowed, do not claim a
global physics-coordinate bound; return parametric results or measured local
probe error **[M]**. Add CPU solver tolerance **[G]**, floating-point/FFT probe
discrepancy **[M]**, and omitted-coefficient bound **[D]** as separate fields.

Do not read full GPU displacement maps back in the frame path. Asynchronous
diagnostic readback is allowed and must include WebGPU padded-row stride rather
than assuming tight rows.

## Geometry sampling and repetition

The mesh must resolve the smallest geometrically displaced wavelength visible
at its projected distance. The absolute alias condition is

```text
k_geometry,max Delta_mesh <= pi,                               [D]
```

but select a stricter position/normal error gate **[G]**. Use distance-adaptive
patches, projected-grid geometry, or concentric meshes when one uniform plane
would oversample the horizon and undersample the foreground. Avoid cracks by
sharing boundary samples or using skirts whose visibility is gated **[G]**.

Each cascade repeats every patch length. Hide repetition by choosing the large
patch from maximum visible water footprint, using physically justified haze,
and checking autocorrelation/fixed-flight captures **[M]**. Random phase does
not remove periodicity. Rotating cascades changes directional statistics and
must be reflected in derivatives and the spectrum model.

## Performance, memory, and mobile/tile GPUs

### Exact accounting

For square resolution `N`, channels `C`, and bytes per channel `B`:

```text
textureBytes = N^2 C B.                                        [D]
```

Therefore:

```text
RGBA16F: 8 N^2 bytes
RGBA32F: 16 N^2 bytes.                                         [D]
```

The ledger includes initial coefficients/seeds retained on GPU, two packed
complex lane groups, every ping-pong scratch partner, resolved maps, foam
ping-pong, optional transpose buffers, scene pass attachments, and post
transients. Report allocated bytes and peak simultaneously live bytes **[M]**.

For the global Stockham layout with two separately transformed RGBA lane groups:

```text
stage dispatches/cascade = 4 log2(N),                           [D]
```

before evolution, centered correction/assembly, Jacobian, and foam. Report the
actual graph count; fused lane groups or workgroup-local rows change it.

### Precision placement

Repeated half-float stores at every FFT stage quantize after each butterfly.
Using half-float only for resolved displacement maps quantizes once. Treat these
as different tiers and measure:

- transform relative `L2`, maximum error, and Parseval drift;
- imaginary leakage and Hermitian partner error;
- phase/slope error over time;
- Jacobian/fold classification changes;
- final-image temporal shimmer.

Use float FFT storage when half-float changes any gate, then reduce bandwidth
elsewhere. Float storage sampling need not be filterable inside the FFT because
all butterfly reads are integer loads.

### Sustained targets

The compiled workload contract supplies target-specific resolution candidates
**[A]** and predeclared error/time/memory gates **[G]**; this reference supplies
no device-class defaults. Accept a tier only after warm steady-state percentile
timings on a named device **[M]**. For mobile/tile hardware also record long-run clock/thermal
drift, power mode, viewport, device-pixel ratio, active cascades, texture
formats, and post passes.

Optimize in this order:

- remove redundant fields or transforms while preserving exact tangents;
- pack complex lanes correctly;
- select workgroup-local rows when limits and occupancy support them;
- reduce global storage round trips and transposes;
- reduce cascade count from a quantified spectral-energy/error gate;
- reduce resolution from slope/Jacobian/image error, not a GPU-name heuristic;
- decimate foam or optical updates only with temporal/reprojection evidence;
- keep diagnostics out of production timings but measure their overhead
  separately.

## Required diagnostic and validation bundle

### Spectrum

- `EnvironmentForcingSnapshot` identity/version/error, averaging footprint/
  interval, measured/reference height, vertical-profile/stability calibration,
  derived `U10`, fetch geometry, duration/wave age, directional spreading, and
  represented source terms; calm/invalid/out-of-range classifications;
- stationary forcing replay and evolving-source continuity showing that gusts
  neither reseed coefficients nor masquerade as material water current;
- all input units and authored sea-state parameters;
- `S_omega`, directional normalization, `P(k_x,k_z)`, and `d omega/dk`;
- Gaussian mean/variance and coordinate stability;
- per-cascade power window, represented support, and quadrature variance;
- target versus realized significant statistics **[M]**.

### Transform

- declared sign, normalization, centered-order correction, and FFT family;
- DC, axis, oblique, conjugate-pair, Nyquist, and random DFT tests;
- maximum/RMS/relative error, Parseval drift, and imaginary leakage **[M]**;
- float reference versus every reduced-precision tier **[M]**.

### Geometry

- each frequency-space field and each unpacked spatial field;
- one-mode travel direction and crest-compression sign;
- analytic versus finite-difference tangents/normals **[M]**;
- per-cascade fields, summed fields, `A`, `B`, `C`, `J`, and fold count;
- mesh sampling error and repetition/autocorrelation captures **[M]**.

### Foam and optics

- combined source, transport velocity, pre/post-advection state, reaction
  result, diffusion, and display coverage;
- coverage conservation/loss and decay half-life comparison **[M]**;
- reflection, transmission, scattering, foam, and final energy terms;
- exact Fresnel/TIR and scene-depth refraction validity where applicable.

### Runtime

- renderer/backend identity, relevant device limits, texture formats;
- canonical `WaterSurfaceProvider` conformance, requested-channel and
  footprint/filter behavior, absent-channel rejection, residency, and complete
  state-version/error propagation;
- raw-sampler-to-provider parity for surface point/normal/velocity, current,
  depth when represented, including the mandatory
  `geometricNormalVelocityMps` projection identity and the valid case where the
  optional full `surfacePointVelocityMps` is absent, and zero frame-critical
  readbacks;
- `PhysicsPresentationSnapshot` coherence across displacement, derivatives,
  velocity, shadows, foam, temporal history, origin epochs, and quality/state
  migrations;
- allocation and peak-live ledger;
- dispatch and draw inventory;
- GPU time by evolution, transforms, assembly, foam, surface, and post **[M]**;
- fixed-camera multi-time final, no-foam, no-detail, and no-post images;
- leak/rebuild loop and sustained mobile thermal run **[M]**.

### Offshore/coastal composition

- serialized coupling manifest plus bathymetry, coast frame, wet/obstacle mask,
  current, solver ownership, and overlap-band diagnostic views;
- `PhysicsGraph` execution trace proving prior committed runoff is immutable
  input to the next coastal interval, applied exactly once at accepted commit,
  and paired with one inundation/wash exchange to the sole receiver;
- phase-resolved constant-depth single-mode tests at normal and oblique
  incidence: `eta`, wave discharge, phase, group delay, reflection, and
  transmitted power, plus the spectral continuity residual for bidirectional
  fields **[M]**;
- discharge-producer inventory and paired direct-boundary versus packed-IFFT
  timing/storage evidence when both are eligible **[M]**;
- phase-averaged no-source/no-current action-flux closure, followed by separate
  bottom-loss, breaking-loss, and current-work cases **[M]**;
- uniform-current Doppler test and a spatial-current case compared with an
  independent action/ray or phase-resolved reference **[M]**;
- bathymetric-slope shoaling and refraction compared with an independent
  convergence/reference solution over the represented band **[M]**;
- outgoing-mode projection reconstruction, localization, and periodic-image
  residuals when two-way coupling is claimed **[M]**;
- offshore/coastal band-power closure, no duplicated modes, and render-
  transition tangent/normal finite-difference parity **[M]**;
- foam covered-area remap, source partition, decay, and invalid/clamp loss
  **[M]**; and
- fixed-view and flight-path captures across the transition over seed, time,
  water datum, current, and every quality tier, plus sustained composed mobile
  timing and memory evidence **[M]**.

Reject the system if a plausible image masks dimensional inconsistency,
implicit FFT scale, Nyquist leakage, wrong displacement sign, inexact normals,
stateless foam, undocumented coordinate semantics, duplicated offshore/coastal
power, square-root power weights applied to coherent copies, an overconstrained
coupling boundary, a homogeneous FFT presented as bathymetry-aware flow, or a
timing number without a named measurement context.
