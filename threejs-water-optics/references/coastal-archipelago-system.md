# Coastal and archipelago water system

This reference specifies the causal water stack for generated islands, beaches,
cliffs, reefs, rocks, docks, and shallow-to-deep water. It targets orthographic,
isometric, oblique, and free-camera scenes, including sustained low-end/mobile
deployment. The rendered result may be stylized; the algorithm and data
contracts remain explicit.

Use the quantitative tags **[D] Derived**, **[G] Gated**, **[M] Measured**, and
**[A] Authored**. Unlabelled integers inside exact equations, vector dimensions,
byte identities, and API names are [D]. Every resolution, timestep, threshold,
coefficient, frequency, distance, memory ceiling, and timing target needs a tag.

Read this with
[water-surface-system.md](water-surface-system.md). The bounded-water reference
owns exact parametric geometry, the linear wave grid, caustic flux deposition,
Fresnel, refraction validation, Beer-Lambert transport, and base WebGPU/TSL
resource rules. This document adds coast-specific selection, bathymetry,
shoaling/refraction, wet/dry hydrodynamics, hybrid handoff, sparse execution,
and asset contracts.

## Contents

- Observable contract and canonical coastal state
- Water-model selection
- Shoreline phase without a fluid solver
- Depth-aware linear transport, wave action, and mild slope
- Fixed-wet linear and nonlinear shallow-water systems
- Offshore/nearshore handoff
- Breaking, foam, wetness, optics, and caustics
- Sparse active tiles and fixed-step ownership
- Supplemental assets and generated caches
- Mobile-first quality states
- Validation and falsification

## Observable contract for generated islands

A convincing archipelago image is not `terrain + blue transparent plane`.
The required causes are separable and must remain inspectable:

| Observable | Earliest required cause | Common false substitute |
| --- | --- | --- |
| Deep blue to shallow turquoise transition | Water-column path length over continuous bathymetry, bottom radiance, absorption, and scattering | A screen-space radial gradient around each island |
| Beach, reef, and submerged-rock visibility | Seabed geometry/material plus refracted or validated approximate lookup | Painting cyan around a land mask |
| Shore-parallel white ribbons | Incident wave phase transformed by depth and coast geometry, or a declared shoreline phase model | Concentric circles from an island center |
| Breakers and lingering foam | A breaking/dissipation source plus transport, decay, and obstacle/shore interaction | Thresholded noise added as white radiance |
| Wet sand and a moving waterline | Inundation or shoreline phase history with drying | A permanent dark strip in the terrain texture |
| Ripples around rocks, piers, boats, and reefs | Obstacle-aware phase/scattering or a local solver | Independent decals with no incident-wave direction |
| Crest motion and reflected detail | One shared displacement/derivative cause with filtered unresolved bands | Geometry moving one way while normals scroll another |
| Clear shallow-water sparkle/caustics | Receiver-space focusing or a declared perceptual approximation | Emissive noise on the water surface |

For a fixed high-angle shot and perceptual-style truth contract, a causal
shoreline phase field, bathymetry-aware optics, and transported foam can satisfy
the image without a fluid solver. Interactive flooding, run-up, bores, wakes,
or changing connected wet topology require conservation-law state. Do not pay
for the latter unless those observables are in the contract; do not claim the
former is hydrodynamics.

## Canonical coordinates and state

Use metres and seconds in the simulation domain. Let `x=(x,z)` be horizontal
world or camera-relative coordinates, `z_b(x)` the upward-positive bed
elevation, `eta(x,t)` the free-surface elevation, and

```text
h(x,t) = max(eta(x,t) - z_b(x), 0),                            [D]
u(x,t) = depth-averaged horizontal velocity in m/s.            [D]
```

The still-water datum `eta_0` is an authored input **[A]**. Use one land-water
signed-distance convention everywhere:

```text
phi(x) > 0 on dry land,
phi(x) = 0 on the authored still-water coastline,
phi(x) < 0 in water.                                           [D]
```

Where differentiable,

```text
n_land = grad(phi) / |grad(phi)|,
n_sea  = -n_land,
t_coast = (-n_land.z, n_land.x).                               [D]
```

`phi` is horizontal distance; `eta_0-z_b` is vertical depth. They are not
interchangeable on a sloped beach or cliff. The zero contour of `phi` must
match the bed/water-datum intersection within a world- or screen-space gate
**[G,M]**. If a raster distance transform is used, report
`|grad(phi)|-1`, normal angular error, medial-axis invalidity, and nearest-coast
index stability **[M]**.

The minimum coast-domain contract is:

```yaml
coastalDomain:
  horizontalFrame: { units: metres, handedness: "", originPolicy: "" }
  verticalDatum: { eta0: "[A]", bedElevationOwner: "" }
  bathymetry:
    field: z_b
    texelFootprint: "[D] from world extent and resolution"
    reconstruction: ""
    validMask: ""
  shoreline:
    signedDistance: phi
    signConvention: positive-land
    nearestCoastCoordinate: s_c
    tangentNormalOwner: ""
  substrateIds: ""
  solidObstacleSdf: ""
  boundaryLabels: [land-wall, open-radiation, inflow, outflow, periodic]
  waterStateOwner: ""
  wavePhaseOwner: ""
  foamStateOwner: ""
  wetnessStateOwner: ""
  opticalDepthOwner: ""
  invalidation: []
```

Do not infer simulation depth from a color texture, infer collision solids from
render triangles per frame, or let the water shader independently reconstruct a
different coastline.

Represent rendered vertical cliffs, sea caves, overhangs, and pier/rock sides as
solid wall or obstacle boundaries. A depth-averaged solver assumes a
single-valued bed `z_b(x)` and must not encode an overhang as an extreme bed
slope.

## Select the least complex valid water model

The choices below are alternatives except at an explicitly matched domain or
frequency handoff.

| Required behavior | Primary model | Reject when |
| --- | --- | --- |
| Static or prescribed shore ribbons in a fixed/perceptual scene | Coast SDF plus phase-locked analytic bands | Wave diffraction, run-up, bulk flow, or interactive wakes must be correct |
| Few coherent offshore waves and exact cheap queries | Finite-depth parametric waves | Broad stochastic spectrum or complex coast transformation dominates |
| Shallow/deep color and refraction only | Static bathymetry plus optical transport | Surface motion, waterline motion, or interaction is required |
| Slowly varying shoaling/refraction over fixed bathymetry | Ray or wave-action transport per frequency/direction band | Diffraction, standing interference, sharp bathymetric change, or wet/dry topology dominates |
| Linear diffraction/interference around fixed islands | Frequency-domain mild-slope solve, normally precomputed | Strong nonlinearity, moving bathymetry, breaking/run-up, or broad live spectrum is required |
| Long waves over variable but permanently wet bathymetry | Conservative linearized shallow-water system | Moving wet/dry fronts, breaking, or finite-amplitude bores are required |
| Bounded small-amplitude local ripples on a fixed wet domain | Linear wave-equation grid from the base reference | Bulk flow, hydraulic jumps, moving wet/dry front, or depth conservation matters |
| Flooding, run-up, bores, depth-averaged wakes, connected wet/dry change | Positivity-preserving nonlinear shallow-water finite volume | Dispersive phase or three-dimensional overturning is a required observable |
| Weakly dispersive nearshore wave propagation | A validated Boussinesq-family model | Its extra phase fidelity is not visible, or wet/dry/boundary robustness is unproven |
| Horizon-scale directional wind sea | `$threejs-spectral-ocean` offshore donor | It is being asked to bend around islands or solve shoreline topology |
| Overturning breakers, entrained air, jets, splashes, three-dimensional vortices | External free-surface/particle/VOF solver | A single-valued surface or depth-averaged model satisfies the contract |

Record the selected row, losing candidates, and the measured or gated evidence
that rejected them. Solver complexity is not a quality tier.

## Shoreline phase without a fluid solver

This is the minimum viable architecture for stylized island references when
the waterline is prescribed and object interaction is absent.

### Coast coordinates and phase

Let `r=max(-phi,0)` be seaward horizontal distance and `s_c` the arclength or
stable identifier of the nearest coastline point. For a shore-normal phase
field,

```text
theta_b(r,s_c,t)
  = -integral_0^r k_n(r',s_c) dr' - omega t + beta(s_c).       [D]
```

`k_n` is an authored or depth-derived local normal wavenumber **[A,D]** and
`beta` is a coastwise phase field **[A]**. A constant-spacing approximation is
`theta_b=-k_n r-omega t+beta` **[D]**. With `r` increasing seaward, its
wavevector and constant-phase velocity point shoreward:
`dr/dt=-omega/k_n` **[D]**. This matches the later physical convention
`grad(theta)=k`, `partial_t(theta)=-omega`. For a positive-frequency outgoing
component, flip only the spatial wavevector:
`theta_out=+integral_0^r k_n dr'-omega t+beta_out`, giving
`dr/dt=+omega/k_n` **[D]**. Reversing both spatial and temporal signs would
leave the propagation direction unchanged. The model is acceptable only
when crest trajectory, spacing,
and speed errors pass the image gate **[G,M]**.

For an isotropic prescribed phase speed `C(x)` over fixed bathymetry, a more
coherent build-time travel-time field satisfies

```text
|grad(T_in)| = 1/C(x),
theta_b = omega [T_in(x)-t] + beta,
k = grad(theta_b) = omega grad(T_in) + grad(beta).             [D]
```

Here `T_in` is travel time increasing from the offshore incident boundary in
the shoreward propagation direction; constant phase advances toward increasing
`T_in` **[D]**. Solve the eikonal equation with fast marching/sweeping or another
converged method. It bends crest normals with
depth and removes island-center radial assumptions, but still does not model
diffraction, reflection, amplitude transport, or hydrodynamics. Store travel
time, coast/wave exposure, unreachable/shadow classification, and residual.

Construct coverage from a periodic crest profile `W(theta_b)`, a water-side
depth envelope `B(h)`, and a coastwise continuity envelope `G(s_c)`:

```text
f_candidate = saturate(B(h) G(s_c) W(theta_b)).                [D]
```

`W`, `B`, `G`, spacing, speed, duty cycle, and irregularity are authored
starting points **[A]**. Filter `W` from the fragment footprint so a crest does
not alias when its physical width projects below the image gate **[G]**.
Noise may perturb phase or breakup after this causal construction; it may not
create shore foam independently.

Nearest-point SDF coordinates become discontinuous at medial axes, between
nearby islands, and inside narrow channels. Detect ambiguous nearest-coast
regions. Resolve them with one of:

- a multi-source coast-ID field and deterministic ownership;
- an incident-wave phase field solved over the water domain;
- multiple candidate coasts blended by a declared energy/coverage rule;
- a local hydrodynamic or mild-slope solve.

Do not average opposite coast normals in a channel and call the result a wave
direction.

### Obstacle and island interaction

A rock or pier can use a local obstacle SDF and incident direction to generate
a bounded contact/wake envelope only under a perceptual contract. Upstream
compression, downstream wake angle, and decay must rotate with the incident
wave/current frame. If reflection, diffraction shadow, or wake force is an
acceptance property, replace the decal with mild-slope, shallow-water, or an
external solver evidence path.

### What this model may claim

It may claim deterministic, coast-following, phase-coherent ribbons; depth-
gated coverage; derivative-filtered display; and prescribed obstacle accents.
It may not claim mass, momentum, wave-energy, diffraction, run-up, or wet/dry
conservation.

## Depth-aware linear coastal wave transport

Use this layer when the coast is fixed and the required image depends on waves
turning, shortening, shoaling, and dissipating with depth, but not on nonlinear
run-up or bulk-flow conservation.

### Dispersion, phase, and rays

For local depth `h`, wavenumber magnitude `k`, surface-tension ratio
`tau=sigma_surface/rho`, and intrinsic angular frequency `sigma_i`:

```text
sigma_i^2 = (g k + tau k^3) tanh(k h),                         [D]
omega_abs = sigma_i + k dot U,                                 [D]
grad(theta) = k,
partial_t(theta) = -omega_abs.                                 [D]
```

`U` is a prescribed depth-averaged current. The ray equations are

```text
dx/dt = partial omega_abs / partial k = U + c_g,
dk/dt = -partial omega_abs / partial x,                        [D]
c_g = partial sigma_i / partial k.                             [D]
```

Integrate phase or reconstruct it from a scalar potential. Advecting an
arbitrary vector `k` without controlling `curl(k)` can produce a field that is
not the gradient of any phase. Report phase-loop closure or curl residual
**[M]**.

### Wave action and shoaling

Let `mathcal_E_k(x,k,t)` be linear wave-energy density per wavevector-area,
defined by

```text
E_area(x,t) = integral mathcal_E_k d^2 k,                     [D]
[E_area] = J m^-2,
[mathcal_E_k] = J.                                            [D]
```

The corresponding phase-space action density is
`mathcal_N_k=mathcal_E_k/sigma_i` with units `J s` **[D]**. If
`P_eta,b` denotes the discrete surface-elevation variance contribution of a
band in `m^2`, its capillary-gravity energy per horizontal area under that
declared variance convention is

```text
E_b = (rho g + sigma_surface k^2) P_eta,b,                     [D]
[E_b] = J m^-2.                                                [D]
```

Do not transport surface-amplitude squared as action while omitting the
frequency, integration measure, quadrature weight, and capillary-gravity energy
factors. In phase space,

```text
partial_t mathcal_N_k
 + div_x((U+c_g) mathcal_N_k)
 + div_k((dk/dt) mathcal_N_k)
 = mathcal_S_E,k / sigma_i.                                   [D]
```

With stationary bathymetry, no current, no source, and a ray tube of width
`b`, `E_b |c_g| b` is conserved **[D]**. If
`E_b=K(k) a_rms^2`, then

```text
a_rms proportional to 1/sqrt(K(k) |c_g| b),                  [D]
K(k) = rho g + sigma_surface k^2                              [D]
```

under the variance convention above. The familiar inverse square root of
`|c_g|b` alone is only valid when `K` is constant over the transformed band.
Never clamp shoaling amplitude silently; record energy removed by breaking,
numerical diffusion, domain clipping, and display limits.

A practical GPU field may discretize direction/frequency bands rather than
continuous phase space. Each band records frequency support, direction support,
quadrature weight, energy, phase policy, and dissipation. Band counts and grid
resolution are **[A]** candidates selected by phase, crest-direction, and
energy error gates **[G,M]**.

Action is phase-averaged state and carries no instantaneous crest phase. A
separate phase/eikonal/mode owner is required when moving crest placement is an
observable; record its synchronization with action amplitude.

Geometric rays do not fill a wave shadow by diffraction and become singular at
caustics. Regularize ray density from a finite directional/frequency footprint,
or use a wave solve. Do not hide a ray caustic by arbitrary amplitude clipping
without reporting pre/post energy.

### Mild-slope option

For fixed, slowly varying bathymetry and one angular frequency, the classical
linear mild-slope equation for complex surface-potential amplitude `Phi` is

```text
div(C C_g grad(Phi)) + omega^2 (C_g/C) Phi = 0,                [D]
C = omega/k.                                                   [D]
```

It captures linear shoaling, refraction, diffraction, reflection, and
interference within its derivation assumptions. It requires radiation/open
boundary conditions and convergence evidence. For a static island kit, solve
it offline or at asset-build time and store phase/amplitude bands if their
memory and interpolation errors beat a live solve **[M]**. It is not a
breaking, wet/dry, or nonlinear-flow solver.

### Breaking transition

For wave height `H`, local depth `h`, and authored/calibrated breaker index
`gamma_b` **[A]**, the diagnostic

```text
Gamma = H / max(h,h_epsilon),
breaking candidate when Gamma >= gamma_b                            [D,A]
```

may source an action-energy sink and foam. The exact breaker family and
coefficient are model inputs, not universal constants. Removed wave energy must
appear in a dissipation ledger; it may feed foam coverage/turbulence appearance
but not arbitrary emitted light.

## Fixed-wet linear shallow-water option

For long waves over a permanently wet reference depth `H(x)>0`, evolve surface
perturbation `eta'` and depth-integrated discharge `q=H u`:

```text
partial_t eta' + div(q) = 0,
partial_t q + g H grad(eta') = S_linear.                       [D]
```

At constant depth and without sources this reduces to

```text
partial_tt eta' = g H Laplacian(eta'),                        [D]
```

and its continuous quadratic energy is

```text
E_linear = rho/2 integral [g eta'^2 + |q|^2/H] dA.            [D]
```

Use compatible discrete divergence/gradient operators or a finite-volume flux
so volume and the declared discrete-energy behavior are measurable. This model
can transmit and refract long linear waves over variable depth; it cannot own
drying, finite-amplitude advection, bores, hydraulic jumps, or breaking. The
constant-speed height grid in the base reference is a cheaper special-purpose
surface model, not an automatic replacement for variable-bathymetry discharge.

## Nonlinear shallow-water solver with wet/dry fronts

Use this only when moving depth, run-up, bores, bulk current, or obstacle wakes
are part of the observable contract.

### Conservation law

For conservative state `q=(h,m_x,m_z)^T` with `m=h u`:

```text
partial_t q + partial_x F(q) + partial_z G(q) = S,             [D]

F = (m_x,
     m_x^2/h + 0.5 g h^2,
     m_x m_z/h)^T,

G = (m_z,
     m_x m_z/h,
     m_z^2/h + 0.5 g h^2)^T,                                  [D]

S_momentum = -g h grad(z_b) + S_friction + S_external.        [D]
```

Never evaluate momentum divisions in dry cells. `h>=0` is a hard invariant
**[G]**. The exact lake-at-rest equilibrium is

```text
u = 0,
eta = h + z_b = constant.                                     [D]
```

A solver that produces waves over static non-flat bathymetry fails before any
visual review.

### Finite-volume reference

Use a cell-centered finite-volume reference with one canonical flux per face.
For a face separating left and right states, hydrostatic reconstruction starts
with

```text
z_star = max(z_b,L, z_b,R),
h_L* = max(0, h_L + z_b,L - z_star),
h_R* = max(0, h_R + z_b,R - z_star).                           [D]
```

Rebuild momenta from reconstructed depth and the finite wet-cell velocity.
Pair the numerical flux with its matching hydrostatic source correction; the
reconstruction alone is not a proof of well balancing.

A robust reference flux is local Lax-Friedrichs/Rusanov:

```text
F_hat = 0.5 [F(q_L*) + F(q_R*)]
      - 0.5 a_max (q_R* - q_L*),                              [D]

a_max = max(|u_n,L| + sqrt(g h_L*),
            |u_n,R| + sqrt(g h_R*)).                          [D]
```

It is diffusive. HLL is eligible when its wave-speed bounds and dry-state
behavior pass. HLLC can restore the middle/contact structure in multidimensional
flow, but its extra branch/state complexity is accepted only when the reference
image or quantitative wake error improves and positivity remains proven
**[G,M]**. Never select a Riemann solver by reputation alone.

For an explicit unsplit update on rectangular cells, a conservative stability
bound is

```text
dt <= C_CFL min_cells 1 /
      [ (|u_x|+sqrt(g h))/dx + (|u_z|+sqrt(g h))/dz ],         [D]
0 < C_CFL <= C_scheme.                                        [G]
```

Derive `C_scheme` for the reconstruction/time integrator actually implemented.
Higher-order MUSCL/WENO reconstruction requires slope limiting and its own
positivity proof. Begin with first-order reference convergence; add order only
if measured diffusion violates a declared visual or physical gate.

### Positivity and wet/dry treatment

Choose a dry-depth threshold from vertical precision, bathymetry error, and
the smallest meaningful film **[A,G]**; demonstrate threshold convergence
**[M]**. Below it, set momentum to zero through the dry-state policy before any
division. Do not clamp negative depth after update and ignore lost mass.
Instead use a positivity-preserving flux/update or rescale outgoing fluxes so a
cell cannot export more water than it owns. Report:

- minimum depth and count of attempted negative updates;
- total mass, boundary/source flux integral, and residual;
- shoreline-position sensitivity to grid, timestep, and dry threshold;
- momentum/velocity maxima in near-dry cells.

Land walls require zero normal discharge and the intended tangential condition.
Open boundaries require characteristic/radiation treatment; copying the last
interior texel is generally reflective.

### Bed friction and sources

For Manning coefficient `n_M` with units `s m^(-1/3)` **[D]**, one common
depth-averaged momentum source is

```text
S_friction = -g n_M^2 |u| m / h^(4/3).                        [D]
```

Regularize it with the declared wet/dry policy and integrate it semi-implicitly
when explicit stiffness near shallow cells violates the timestep gate. Terrain
roughness used by the renderer is not automatically Manning roughness. Rain,
drainage, tides, pumps, moving obstacles, or source impulses require units and
a mass/momentum ledger.

### Dispersive boundary

Linear shallow water has

```text
omega_SWE = sqrt(g h_0) k,                                    [D]
```

whereas finite-depth gravity waves satisfy

```text
omega_phys^2 = g k tanh(k h_0).                               [D]
```

Compare their phase/group error over the visible/injected frequency band
**[G,M]**. With characteristic depth `h_0`, wavelength `L`, and amplitude `a`,

```text
mu = (h_0/L)^2,
epsilon = a/h_0.                                               [D]
```

Hydrostatic SWE is the leading shallow-water model when `mu` is sufficiently
small for the declared error. A Boussinesq-family model adds weak dispersion,
typically under weak-nonlinearity/scaling assumptions; Serre-Green-Naghdi-
family models retain stronger nonlinearity while remaining weakly dispersive.
Their higher derivatives, elliptic solves or auxiliary states, wet/dry
boundaries, and GPU synchronization are separate algorithm costs. Load one only
when its measured phase/run-up improvement is observable and every boundary,
stability, and convergence gate passes.

If the image requires overturning, air entrainment, spray, plunging jets, or
three-dimensional vorticity, route physical state to an external free-surface
solver. A heightfield, SWE, or foam shader cannot own those phenomena.

## Offshore-to-nearshore handoff

The archipelago stack normally has one offshore donor and one nearshore owner:

```text
far field:
  spectral FFT or a small parametric set
    -> choose one boundary contract:
       phase-resolved mode record (H, k, sigma_i, time origin)
       phase-averaged action/energy quadrature (no crest phase)
near field:
  phase-resolved mild-slope/linear transformation
  or phase-averaged wave-action transformation plus separate crest synthesis
    -> optional nonlinear shallow-water active regions
display:
  one geometric surface owner per location
    -> shared derivative, foam, wetness, and optical consumers
```

### Match model validity before blending

Place a coupling boundary in a depth/frequency range where both donor and
receiver meet their dispersion/error gates. A deep-water FFT mode cannot be
injected unchanged into hydrostatic SWE at arbitrary depth. For each transferred
phase-resolved mode, record frequency, direction, complex surface-elevation
amplitude `H`, wavenumber, intrinsic frequency, energy, and coordinate/time
origin. This branch can test phase parity. For a phase-averaged handoff, transfer
action/energy with its spectral integration measure, quadrature weight,
direction, intrinsic frequency, and group velocity. It carries no instantaneous
phase; a separate local phase/synthesis owner may match directional statistics
but must not claim donor crest parity.

For a small perturbation about constant depth `h_0`, a progressive long wave
obeys

```text
u_n' = +/- sqrt(g/h_0) eta'.                                   [D]
```

This is eligible for SWE boundary forcing only for bands that pass the
long-wave dispersion gate. For a complex surface-elevation mode `H` with
intrinsic frequency `sigma_i=omega_abs-k dot U`, linearized continuity gives
the irrotational depth-integrated discharge amplitude

```text
q'_k = (sigma_i/k^2) k H.                                     [D]
```

This preserves phase and continuity but does not make a hydrostatic receiver
match the donor dispersion; gate that separately. More generally, use the SWE characteristic
invariants

```text
R_plus  = u_n + 2 sqrt(g h),
R_minus = u_n - 2 sqrt(g h)                                   [D]
```

for locally one-dimensional constant-bed flow: prescribe only the incoming
characteristic from the transformed donor and retain the outgoing characteristic
from the nearshore interior. Select incoming/outgoing from the eigenvalue signs
relative to the boundary normal. Extend or replace this boundary treatment when
bed steps, oblique flow, strong nonlinearity, or multidimensional modes violate
its assumptions.

### No double surface

Do not alpha-crossfade two independently phased geometric surfaces. It creates
beats, nonphysical volume, derivative discontinuities, and two depth owners.
Select one geometry owner in the transition and match height, normal derivative,
phase, and mean level at the boundary. Unresolved detail bands may crossfade in
the material only when their variance/energy partition is declared and the
combined slope spectrum passes **[G,M]**.

For two phase-coherent representations of the same mode, never use square-root
power weights: their covariance produces a cross term. If a display overlap is
unavoidable, preserve one complex phase and use coherent amplitude weights

```text
a_offshore(x) + a_coastal(x) = 1.                             [D]
```

Derive position, velocity, and tangents from the weighted displacement itself;
spatial derivatives include `grad(a)` terms **[D]**. Prefer non-overlapping
domain/characteristic coupling so this display blend is unnecessary. Power
weights are valid only for fields proven statistically independent or
orthogonal, and their combined covariance/variance still requires validation
**[G,M]**.

### Reflection and conservation evidence

Measure reflected-to-incident amplitude/energy across the coupling boundary by
frequency and incidence angle **[M]**. For conservative nearshore state, report
mass and momentum flux. For wave-action transport, report incident, outgoing,
dissipated, and clipped energy. A visually hidden seam is not sufficient.

## Breaking, foam, wetness, and waterline

### Foam source hierarchy

Use the strongest available causal source:

1. modeled energy dissipation from wave-action breaking;
2. modeled shock/breaking dissipation, or a numerical entropy residual only
   after flux/grid/resolution calibration, from shallow water;
3. exact surface Jacobian/compression or curvature from analytic/spectral waves;
4. prescribed coast-phase crest arrival for a perceptual shoreline model.

For shallow water, useful diagnostics include

```text
Fr = |u| / sqrt(g h),
compression = max(0, -div(u)).                                 [D]
```

They are not by themselves calibrated foam mass. Raw numerical entropy loss
changes with flux and resolution and is not a physical source until benchmarked
and calibrated **[G,M]**. Convert the selected source to a nonnegative rate
`s_f` with units `s^-1` **[D,A]**.

For dimensionless area coverage `f`, uniform coverage should remain uniform
under a compressing velocity field in the absence of source/decay/diffusion.
Use the material derivative:

```text
partial_t f + u_f dot grad(f)
  = s_f (1-f) - f/tau_f + kappa_f Laplacian(f),
0 <= f <= 1.                                                   [D]
```

If the state is instead a conserved areal foam mass/density `c`, use

```text
partial_t c + div(u_f c) = S_c - c/tau_c + diffusion.          [D]
```

and derive bounded display coverage from `c` with a calibrated constitutive
map **[A,M]**. Declare exactly which state is stored. Conservative face fluxes
belong to the density branch, not universally to coverage. Semi-Lagrangian
coverage transport is eligible when blur, extrema, and backtrace error pass
**[G,M]**; conservative density transport additionally reports mass error.
For the coverage branch after advection/diffusion, hold `s_f` fixed over one
step and use the exact source/decay reaction update

```text
r = s_f + 1/tau_f,
f_eq = s_f/r,
f_next = f_eq + (f_advected-f_eq) exp(-r dt).                 [D]
```

When `s_f=0`, this reduces to
`f_next=f_advected exp(-dt/tau_f)` **[D]**. Handle a deliberately infinite
decay time with an explicit zero-rate branch; never form `0/0`.
Coverage is not wave energy: the calibrated conversion from breaking-energy
dissipation to `s_f` is recorded separately. Partition one dissipation ledger at
the offshore/coastal handoff and drive one foam source/history. Never blend or
power-partition independent foam histories.

Shore ribbons should inherit the incident crest phase and coast tangent. Keep
source, pre-advection state, transported state, reaction result, and final
microstructure as separate debug views. Micro-noise changes breakup/edge
texture; it does not create coverage.

### Wetness memory

Store an exposed-bed wetness state `w` independent of water color. Define a
wetting event from either physical inundation or, for the no-solver perceptual
branch, a prescribed wash mask `m_wash` derived from crest arrival and beach
reach:

```text
I_wet = (h >= h_wet) or (m_wash >= m_wet),
w_next = 1                                      when I_wet,
w_next = w exp(-dt/tau_dry)                     otherwise.     [D]
```

`h_wet`, `m_wet`, wash reach, and `tau_dry` are authored material/environment
parameters **[A]**. A static-depth perceptual model cannot wet exposed beach
without `m_wash`. Validate the chosen source against waterline motion and
temporal continuity **[M]**.
Wetness may darken diffuse response, change roughness/specular response, and
couple to deposited foam/debris. It must not move the geometric shoreline or
inject water mass.

### Foam energy composition

Foam replaces a bounded fraction of the water response:

```text
L_final = (1-f) L_water + f L_foam.                            [D]
```

Do not add foam, a duplicate sun glint, and bloom as independent white-energy
sources. Bloom is a downstream response to the accepted HDR signal.

## Bathymetry-aware optics and caustics

The shallow turquoise in an island scene should emerge from shorter water paths,
bottom radiance, and water optical coefficients. Let absorption `sigma_a` and
scattering `sigma_s` be in `m^-1`, `sigma_t=sigma_a+sigma_s`, and
`omega_0=sigma_s/max(sigma_t,epsilon_sigma)` componentwise:

```text
T_rgb = exp(-sigma_t_rgb ell),
L_water = F L_reflection
        + (1-F) [T L_bottom + (1-T) omega_0 L_source].         [D]
```

`ell` is a validated refracted path length in metres. `L_bottom` comes from the
actual sand/reef/rock receiver, not from a water-depth color ramp. A stylized
palette may author `sigma_a`, `sigma_s`, the phase-weighted incident source
`L_source`, and substrate albedo **[A]**, but one
depth/bathymetry cause must drive the transition. Keep water/sand/reef color
spaces and scene-linear radiance explicit. The omitted fraction
`(1-T)(1-omega_0)` is absorption; it does not become scattered light. A cheaper
empirical fog coefficient is allowed only when labelled as non-physical
extinction with no energy-partition claim.

For a heightfield bed, an analytic or bounded iterative refracted-ray/bed
intersection can avoid screen-space occlusion errors. Otherwise use the opaque
scene depth contract and rejection tests in the base reference. Record invalid,
foreground, off-screen, and cross-track rejection fractions **[M]**.

Receiver-space caustics use differential-area flux deposition from the base
reference. They are eligible only where the receiving bed/objects are visible
enough to affect the image. A precomputed or procedural caustic tile may be a
minimum-tier perceptual asset, but label it non-conservative and validate that
it remains attached to receiver coordinates, water depth, and surface motion.
Do not call a surface-space bright pattern a caustic simulation.

## Sparse active coastal tiles

Nearshore simulation should cover the domain that can affect accepted views and
interactions, not the entire ocean rectangle.

### Tile record

Each active tile stores:

```yaml
tile:
  id: "stable"
  level: ""
  worldOrigin: ""
  cellSize: "[D]"
  interiorExtent: "[D]"
  haloWidth: "[D from stencil]"
  neighbors: []
  boundaryFaces: []
  stateValidityTime: ""
  donorBoundaryVersion: ""
  wetCellBounds: ""
  qualityState: ""
```

Camera visibility alone is not a physical activation rule: an off-screen wave
may later enter the view. Activation uses a causal influence horizon, interaction
regions, boundary propagation speed, view/error importance, and persistence.
When a tile sleeps, either retain its state, evolve a cheaper coarse state, or
reconstruct it from a donor with an explicit assimilation transient. Record
activation/deactivation mass, energy, and visible discontinuity **[M]**.

### Conservative GPU pass graph

The correctness reference is:

```text
tile metadata and active list
  -> halo and physical-boundary fill
  -> reconstructed x-face and z-face fluxes
  -> conservative cell update plus balanced bed source
  -> friction/external-source treatment
  -> foam/wetness update
  -> displacement/normal/optical display fields.               [D]
```

Every face flux has one canonical value consumed with opposite signs by its two
wet neighbors. Separate face-flux textures cost bandwidth but make conservation
auditable. A workgroup-fused interior path is eligible only when cross-workgroup
faces retain canonical ownership and it matches the reference mass/momentum and
image gates **[G,M]**. Workgroup barriers never synchronize tile workgroups;
whole-atlas dependencies require dispatch boundaries.

Do not scatter ordinary floating-point updates from faces to cells. Let each
cell gather canonical face fluxes and write exactly one next-state texel. Keep
read and write states distinct until the update completes.

For tile interior `N_x` by `N_z`, halo width `g_h`, state channels `C_q`, and
bytes per channel `B_q`, state ping-pong consumes

```text
bytes_state = 2 (N_x+2g_h)(N_z+2g_h) C_q B_q.                 [D]
```

Canonical x- and z-face flux storage with `C_f` channels and `B_f` bytes uses

```text
bytes_flux = [(N_x+1)N_z + N_x(N_z+1)] C_f B_f.               [D]
```

Add bathymetry, masks, foam, wetness, derivatives, active-tile metadata,
transients, donor fields, render targets, and simultaneous old/new quality
states. Atlas padding/alignment and backend allocation are **[M]**, not implied
by these logical formulas.

### Multiple resolutions

Prefer a small fixed set of nested uniform levels over arbitrary live AMR on
bandwidth-constrained targets. Coarse/fine boundaries require conservative
restriction/prolongation and flux correction (refluxing) if mass conservation
is claimed. Subcycling needs time interpolation at the interface and a shared
physical time. If that architecture is not implemented and validated, use one
simulation resolution and vary only display detail/extent.

### Fixed-step ownership

The simulation clock owns a fixed stable step. The render loop supplies elapsed
time; it does not change the PDE timestep continuously. Cap catch-up work with a
declared policy **[G]**: time dilation, dropped simulation time, or reduced
quality is explicit and counted. For GPU-resident shallow water, prefer a fixed
step derived from a declared global bound on `|u|+sqrt(g h)`. A detected or
guaranteed bound violation must hard-fail, substep through a prevalidated
emergency state, or reset before the unstable update; merely incrementing a
counter is not safe. Count every event. Do not read the grid back each frame to
choose `dt`.
`computeAsync()` is not a per-frame GPU fence. Keep full-grid readback out of
the frame path.

## Supplemental asset and generated-data contract

Procedural water still needs authored inputs and reusable receiver assets. The
following list states what must exist, what can be derived, and what is merely a
detail supplement.

| Asset or field | Status | Required metadata and acceptance |
| --- | --- | --- |
| Bed elevation/bathymetry | Required source | Metres, vertical datum, world transform, valid mask, sampling kernel, reconstruction error, coastline agreement |
| Land/solid mask | Required for clipping/solver | Relationship to bathymetry, obstacle boundary type, conservative rasterization/padding rule |
| Coast SDF plus nearest-coast ID/coordinate | Derived or authored cache | Sign, texel footprint, zero-contour error, eikonal residual, medial-axis/ambiguity mask |
| Substrate/material IDs | Required for reference-like shallow water | Sand/rock/reef/mud classes, linear-data encoding, seam policy, mip semantics |
| Open-boundary wave record | Required for transformed/live waves | Frequencies, directions, complex phase/amplitude, energy units, time origin, current/depth convention |
| Current/tide field | Optional causal input | Metres/second or metres, coordinate/time basis, divergence/source policy, update cadence |
| Obstacle SDF/porosity/drag | Required when obstacles affect flow | World footprint, sub-cell treatment, boundary/drag model, motion version |
| Sand/rock/reef receiver materials | Required visual assets or procedural bundles | Albedo color space, normal/roughness data encoding, world scale, LOD/filtering |
| Submerged rock, reef, coral, seagrass meshes | Optional depth cues | Stable IDs, bounds, underwater material, culling LOD, collision/flow proxy if interactive |
| Pier, piling, wreck, boat proxies | Optional scene assets | Separate render geometry and hydrodynamic proxy; wake/solid ownership; transform update |
| Foam microstructure tile/SDF/flipbook | Optional display supplement | Coverage-preserving mip chain, linear-data encoding, world scale, temporal phase; never source ownership |
| Caustic kernel/tile | Optional minimum-tier supplement | Receiver-space mapping, energy normalization or explicit non-conservative label, depth/motion coupling |
| Wet-sand response bundle | Required when a beach is visible | Dry/wet albedo and roughness endpoints, drying law inputs, waterline mask owner |
| Underwater color/visibility coefficients | Required optics inputs | `sigma_a`, `sigma_s`, and `sigma_t` in `m^-1`; phase/source model or explicit empirical-extinction label; refractive indices; calibration lighting |

Generated caches are build products, not independent artistic truth:

- bathymetry gradients, curvature, depth bands, coast SDF, nearest-coast ID,
  tangent/normal, travel time, wave exposure, breaking candidates, and
  medial-axis mask;
- wave-action energy, direction, group velocity, and dissipation atlases by
  band, plus a separately owned phase/eikonal field when crests are required;
- mild-slope complex amplitude/phase fields;
- solver tile classification, open/solid boundary atlas, obstacle fractions,
  and conservative coarse/fine maps;
- foam-source/history, wetness, optical depth, and receiver-caustic targets.

Each cache records source hash/version, world bounds, datum, texel footprint,
format, channel semantics, color/data space, wrap/border behavior, mip policy,
precision reference error, and invalidation dependencies. A pretty texture with
unknown units is not a reusable procedural asset.

## Mobile-first quality states

Do not map these states to device names or fixed resolutions. Candidate sizes
are **[A]** and acceptance comes from named-target numerical, image, memory,
thermal, and frame gates **[G,M]**.

### Minimum viable

- terrain-derived bathymetry, coast SDF, and one coastline owner;
- exact small parametric waves or derivative-filtered normal bands;
- phase-locked coast foam with no hydrodynamic claims;
- depth-aware bottom visibility and Beer-Lambert optical partition;
- wetness only if its history affects an accepted view;
- no compute solver or caustic pass unless its measured marginal is required.

This state is invalid if the truth contract requires run-up, changing wet/dry
topology, bulk flow, or interactive obstacle wakes.

### Budgeted

- offshore analytic or reduced spectral donor selected by the visible band;
- precomputed or reduced-cadence wave-action/mild-slope coastal fields;
- sparse local interaction tiles only in causal influence regions;
- transported foam at independently selected resolution/cadence;
- lower-rate receiver caustics or no caustics based on fixed-view difference;
- display displacement and normals filtered from the same state.

### Full

- offshore donor plus validated depth transformation;
- positivity-preserving nearshore hydrodynamics only where its observables are
  required;
- matched open boundaries and measured reflection;
- causal breaking, state-appropriate error-bounded foam transport, wetness, and
  receiver-space caustics;
- exact derivative/normal/optical consumers and a complete pass/resource ledger.

`Full` does not mean spectral FFT, mild-slope, linear grid, SWE, Boussinesq, and
ray tracing all run over the same water. It means the smallest valid hybrid at
the highest accepted spatial/frequency coverage.

For tile/mobile GPUs, reduce persistent storage traffic before arithmetic:

- omit channels without consumers;
- derive display-only quantities at reduced cadence when error permits;
- keep simulation resolution independent of viewport/DPR;
- retain canonical face fluxes only if the conservation contract needs them;
- A/B half/full precision against state, flux, shoreline, and image gates;
- avoid a wide scene MRT solely for water when depth reconstruction or a
  reduced opaque pass is cheaper on the named target;
- measure sustained thermal/clock behavior, not a cold frame burst.

## Validation and falsification

### Field and static-coast tests

- bathymetry units/datum, valid mask, reconstruction error, and continuity;
- coast zero-contour versus `z_b=eta_0` error;
- SDF eikonal residual, normal/tangent angular error, nearest-ID ambiguity;
- phase-loop closure/curl, crest spacing/speed, coastwise continuity, and
  fragment-footprint filtering;
- obstacle-frame rotation and incident-direction response.

### Wave-action and handoff tests

- finite-depth dispersion and group-velocity error by band;
- ray/refraction angle against analytic constant-slope or Snell cases;
- action/energy balance, shoaling amplitude, dissipation, and caustic
  regularization ledger;
- mild-slope manufactured/analytic convergence when used;
- donor/receiver phase, amplitude, derivative, and mean-level continuity;
- reflected-to-incident energy by frequency/incidence angle;
- no-double-surface and combined slope-spectrum evidence.

### Shallow-water tests

- lake at rest over non-flat and discontinuous bed;
- positivity and mass balance for wet/dry dam break and shoreline run-up;
- periodic/sloshing Thacker-bowl free-surface and shoreline trajectory;
- solitary-wave run-up and a conical-island inundation benchmark when those
  observables are claimed;
- constant-state advection and axis/oblique propagation;
- Riemann problems with wet/wet and wet/dry states;
- grid/timestep/dry-threshold convergence;
- boundary reflection, obstacle force/wake, Froude and entropy/dissipation maps;
- precision comparison, finite-value scan, and near-dry velocity distribution.

Use an external analytical benchmark or a high-resolution/reference solver for
each claimed physical behavior. A visually smooth PDE output is not numerical
validation.

### Foam, wetness, optics, and image tests

- source, transport, reaction/decay, diffusion, coverage extrema or density
  mass/loss according to stored semantics, and final foam microstructure
  separately;
- inundation/drying events, wetness half-life, and material response;
- bottom-only, reflection-only, transmission-only, scattering-only, foam-only,
  caustic-only, and final energy views;
- exact Fresnel/TIR, refracted-ray residual, invalid reason counts, and optical
  path-length comparison;
- receiver caustic power before/after deposition, filtering, and clamp;
- fixed close beach/cliff view, whole-island view, multi-island wide view, and
  rock/pier interaction view at multiple times;
- no-water-motion, no-foam, no-caustics, no-optics, and no-post baselines.

### Runtime tests

- initialized backend/API proof and selected format/feature limits;
- active/dormant tile map, activation transient, halo validity, dispatch graph,
  and canonical face ownership;
- logical and peak-live allocation ledger, upload/readback inventory, and
  allocation churn;
- composed CPU/presentation and GPU p50/p95 on named targets, pass marginals,
  sustained thermal drift, and quality-controller trace;
- rebuild/dispose leak loop and deterministic seed/time replay.

Reject the system when any of the following is true:

- shoreline foam is unrelated to coast geometry or incident phase;
- shallow color is a screen gradient with no bathymetry/optical owner;
- an FFT ocean is clipped around islands and called coastal refraction;
- a linear height grid or SDF band is called shallow-water hydrodynamics;
- SWE loses positivity, lake-at-rest balance, or unexplained mass;
- the offshore/nearshore seam has two geometric surface owners;
- foam has no state/transport semantics, or wetness changes water mass;
- source-space brightness is presented as receiver-space caustics;
- a cache lacks units, datum, coordinate bounds, channel semantics, or source
  version;
- a performance number lacks a named target and measurement context.
