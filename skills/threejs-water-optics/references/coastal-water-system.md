# Coastal water systems

Use this reference when bathymetry, coast geometry, depth-dependent wave
transport, shallow-water state, wet/dry fronts, offshore handoff, or sparse
coastal execution affects the result. Read
[water-surface-system.md](water-surface-system.md) for parametric waves,
bounded linear heightfields, queries, caustics, Fresnel, refraction, and
Beer-Lambert transport.

## Domain data and invariants

Use metres and seconds in a stable physics frame. Let:

```text
x=(x,z)                horizontal position
z_b(x)                 upward-positive bed elevation, metres
eta(x,t)               free-surface elevation, metres
h=max(eta-z_b,0)       water-column depth, metres
u                      depth-averaged velocity, metres per second.
```

Use one signed-distance convention:

```text
phi > 0 on land
phi = 0 at the still-water coast
phi < 0 in water.
```

Where differentiable:

```text
n_land = grad(phi)/|grad(phi)|
n_sea = -n_land
t_coast = (-n_land.z,n_land.x).
```

`phi` is horizontal distance. `eta_0-z_b` is vertical depth. They are not
interchangeable. Verify that the zero contour of `phi` matches
`z_b=eta_0` within a declared world- or screen-space gate.

The domain records:

- bed elevation, datum, valid mask, footprint, reconstruction, and error;
- coast distance, nearest-coast coordinate or stable ID, normal/tangent,
  eikonal residual, and medial-axis ambiguity;
- wet/solid/porous masks, substrate/material IDs, and obstacle boundaries;
- open, wall, inflow, outflow, or periodic boundary labels and treatments;
- current/tide fields with units, frame, clock, cadence, and owner;
- exactly one water, phase, geometry, foam, wetness, optical-depth, and output
  owner.

A depth-averaged solver requires a single-valued bed. Vertical cliffs,
overhangs, caves, pilings, and rock sides become explicit solid boundaries or
obstacle fractions rather than extreme bed slopes.

## Prescribed shoreline phase

Use this branch only when the waterline is prescribed, interaction is absent,
and wave-energy or flow conservation is outside the claim.

Let `r=max(-phi,0)` be seaward horizontal distance and `s_c` a stable
coast coordinate:

```text
theta_in(r,s_c,t)
  = -integral_0^r k_n(r',s_c) dr'
    - omega t + beta(s_c).
```

With `r` increasing seaward, constant phase travels shoreward. A
positive-frequency outgoing component flips only the spatial sign:

```text
theta_out =
  +integral_0^r k_n dr'
  -omega t + beta_out.
```

For depth-dependent prescribed phase speed `C(x)`, a build-time travel field
may satisfy:

```text
|grad T_in| = 1/C(x)
theta = omega[T_in(x)-t]+beta
k = grad(theta).
```

Solve the eikonal equation to convergence and store unreachable/shadow
classification. This bends crests with the speed field; it does not add
diffraction, reflection, amplitude transport, or hydrodynamics.

Construct a filtered coverage from crest phase, depth envelope, and coastwise
continuity:

```text
f_candidate = saturate(B(h) G(s_c) W(theta)).
```

Filter `W` from the fragment footprint. Noise may perturb phase or edge
microstructure after this causal construction but cannot create coverage.

Nearest-coast coordinates are discontinuous at medial axes and in narrow
channels. Detect ambiguity and choose a deterministic coast ID, a solved phase
field, a declared multi-coast energy rule, or a spatial wave solver. Averaging
opposed coast normals is not a valid propagation direction.

The branch passes when crest direction, spacing, speed, coastwise continuity,
eikonal residual, ambiguity handling, and footprint filtering meet their
gates. Its claim is prescribed, coast-following phase—not flow or wave-energy
conservation.

## Depth-aware wave action and rays

Use this branch for fixed bathymetry when waves must turn, shorten, shoal, and
dissipate, while diffraction/interference and nonlinear run-up are outside the
claim.

For local depth `h`, wavenumber magnitude `k`, current `U`,
`tau=sigma_surface/rho`, and intrinsic frequency `sigma_i`:

```text
sigma_i^2 = (g k+tau k^3) tanh(k h)
omega_abs = sigma_i+k dot U
grad(theta)=k
partial_t(theta)=-omega_abs.
```

Ray equations are:

```text
dx/dt = U+c_g
dk/dt = -partial omega_abs/partial x
c_g = partial sigma_i/partial k.
```

Advecting an arbitrary `k` field may destroy integrability. Report phase-loop
closure or `curl(k)` and reconstruct phase from a scalar field where crest
placement matters.

Let `mathcal_E_k` be energy per wavevector-area and
`mathcal_N_k=mathcal_E_k/sigma_i`:

```text
partial_t mathcal_N_k
 + div_x[(U+c_g)mathcal_N_k]
 + div_k[(dk/dt)mathcal_N_k]
 = mathcal_S_E,k/sigma_i.
```

For a discrete elevation-variance band `P_eta,b`:

```text
E_b = (rho g+sigma_surface k^2) P_eta,b
[E_b] = joules per square metre.
```

Record frequency/direction support, quadrature, action/energy, intrinsic
frequency, group velocity, current, phase policy, breaking/bottom/numerical
dissipation, and stable band identity. Surface amplitude squared without
frequency and quadrature is not action.

In a stationary source-free ray tube of width `b`:

```text
E_b |c_g| b = constant
a_rms proportional to
  1/sqrt[(rho g+sigma_surface k^2)|c_g|b].
```

Report energy removed by breaking, clipping, regularization, and numerical
diffusion. Geometric rays do not model diffraction or fill wave shadows.
Regularize caustics from finite source footprint or choose a wave solve.

This branch passes when dispersion/group velocity, analytic refraction,
phase-loop/curl, action/energy balance, shoaling, dissipation, regularization,
and handoff reflection pass over all represented bands.

## Mild-slope branch

Use this branch for linear diffraction, reflection, and interference over
fixed, slowly varying bathymetry at one frequency:

```text
div(C C_g grad(Phi))
  + omega^2 (C_g/C) Phi = 0

C = omega/k.
```

Specify radiation/open and wall boundary conditions. Prefer an offline solve
for stationary bathymetry and forcing, then store complex amplitude/phase with
source version, bounds, footprint, interpolation, and invalidation.

It is not a breaking, wet/dry, or nonlinear-flow solver. The branch passes
manufactured or independent-reference convergence, boundary reflection,
phase/amplitude interpolation, and rebuild invalidation.

## Fixed-wet linear shallow water

For permanently wet reference depth `H(x)>0`, evolve perturbation `eta'` and
depth-integrated discharge `q=H u`:

```text
partial_t eta' + div(q) = 0
partial_t q + g H grad(eta') = S_linear.
```

At constant depth:

```text
partial_tt eta' = g H Laplacian(eta').
```

The continuous quadratic energy is:

```text
E_linear =
  rho/2 integral [g eta'^2+|q|^2/H] dA.
```

Use compatible divergence/gradient operators or a finite-volume flux so volume
and the selected discrete-energy behavior are measurable. This branch can
transmit and refract long linear waves over variable depth. It cannot own
drying, finite-amplitude advection, bores, hydraulic jumps, or breaking.

It passes when the domain remains wet; mass and declared energy close; analytic
mode dispersion and boundary reflection pass; and no unsupported nonlinear or
wet/dry claim remains.

## Nonlinear shallow water with wet/dry fronts

Use this branch when moving depth, run-up, bores, depth-averaged currents, or
obstacle wakes are observable.

### Conservation law

For conservative state `q=(h,m_x,m_z)^T` with `m=h u`:

```text
partial_t q + partial_x F(q)+partial_z G(q)=S

F = (m_x,
     m_x^2/h+g h^2/2,
     m_x m_z/h)^T

G = (m_z,
     m_x m_z/h,
     m_z^2/h+g h^2/2)^T

S_momentum =
  -g h grad(z_b)+S_friction+S_external.
```

`h>=0` is invariant. Division by `h` occurs only after the dry-state policy.
Lake at rest is:

```text
u=0
h+z_b=constant.
```

### Hydrostatic reconstruction and face flux

For a face with left/right states:

```text
z_star = max(z_b,L,z_b,R)
h_L* = max(0,h_L+z_b,L-z_star)
h_R* = max(0,h_R+z_b,R-z_star).
```

Rebuild momentum from reconstructed depth and finite wet velocity. Pair the
flux with its matching hydrostatic source correction; reconstruction alone
does not prove well balancing.

A robust reference flux is Rusanov:

```text
F_hat =
  0.5[F(q_L*)+F(q_R*)]
  -0.5 a_max(q_R*-q_L*)

a_max =
  max(|u_n,L|+sqrt(g h_L*),
      |u_n,R|+sqrt(g h_R*)).
```

HLL or HLLC is eligible only when dry-state positivity, diffusion, wake error,
and cost improve over the reference. One canonical face value is consumed with
opposite signs by its two cells.

For an explicit unsplit rectangular update:

```text
dt <= C_CFL min_cells 1 /
  [(|u_x|+sqrt(g h))/dx
   +(|u_z|+sqrt(g h))/dz].
```

Derive the admissible `C_CFL` for the actual reconstruction and integrator.
Higher order requires limiting and its own positivity evidence.

### Positivity and dry safety

Choose dry depth from vertical precision, bed error, and the smallest meaningful
film; demonstrate threshold convergence. A cell cannot export more water than
it owns. Use a positivity-preserving update or rescale outgoing fluxes rather
than clamping negative depth and losing unreported mass.

Report minimum depth, attempted-negative count, total mass, boundary/source
flux integral, residual, shoreline sensitivity, and near-dry velocity extrema.
Wall boundaries enforce zero normal discharge. Open boundaries use
characteristic/radiation treatment rather than copied interior cells.

For Manning friction:

```text
S_friction =
  -g n_M^2 |u| m / h^(4/3),
```

with `n_M` in `s m^(-1/3)`. Regularize through the dry policy and integrate
semi-implicitly when explicit stiffness violates the stable step.

### Dispersion gate

Hydrostatic shallow water has:

```text
omega_SWE = sqrt(g h_0) k,
```

while finite-depth gravity waves satisfy:

```text
omega_phys^2 = g k tanh(k h_0).
```

Compare phase/group error over the injected band. A Boussinesq-family branch is
eligible only when that measured error is observable and its higher-derivative
state, boundaries, stability, wet/dry treatment, and synchronization pass.
Overturning and entrained-air phenomena remain external-solver work.

The nonlinear branch passes only with positivity, lake-at-rest, mass/source/
boundary closure, finite dry cells, wet/dry run-up and benchmark behavior,
grid/timestep/dry-threshold convergence, reflection, and precision evidence.

## Offshore/nearshore handoff

Place the coupling boundary where donor and receiver both satisfy dispersion,
depth, and resolution gates. Choose one semantics.

### Phase-resolved

Transfer frequency, direction, complex elevation amplitude, wavenumber,
intrinsic frequency, current, energy, sample instant, stable band identity, and
errors. For a linear component:

```text
q'_k = (sigma_i/k^2) k H,
```

where `q'` is depth-integrated discharge in square metres per second. In the
long-wave limit:

```text
u_n' = +/- sqrt(g/h_0) eta'.
```

At an open shallow-water boundary, prescribe only the incoming characteristic
and retain the interior outgoing characteristic. For locally one-dimensional
constant-bed flow:

```text
R_plus = u_n+2 sqrt(g h)
R_minus = u_n-2 sqrt(g h).
```

Select incoming/outgoing from eigenvalue signs relative to the oriented
boundary normal.

### Phase-averaged

Transfer action or energy with its integration measure, quadrature, direction,
intrinsic frequency, group velocity, current, support, band identity, and
errors. It carries no instantaneous crest phase. A separate versioned local
phase owner drives display geometry.

### Ownership and blending

One geometry owner supplies height and derivatives at every point. Two
independently phased surfaces are not alpha-crossfaded.

Independent or orthogonal bands may use power weights that sum to one. Two
coherent representations of one wave use matched amplitude. If a coherent
display overlap with weight `a(x)` is unavoidable, differentiate the composite:

```text
eta = (1-a)eta_o+a eta_c

grad eta =
  (1-a)grad eta_o+a grad eta_c
  +(eta_c-eta_o)grad a.
```

Apply the same product rule to displacement and velocity, then derive the
normal. Measure reflected-to-incident amplitude/energy by frequency and
incidence angle. A one-way donor names the omitted reflected field; two-way
projection proves phase, energy, localization, and truncation.

## Breaking, foam, and wetness

Choose the strongest available foam source:

1. modeled wave-action breaking dissipation;
2. calibrated shock/entropy loss from shallow water;
3. exact compression, Jacobian, or curvature;
4. prescribed crest arrival for the shoreline-phase branch.

Raw numerical entropy depends on flux and grid; calibrate it before treating it
as physical dissipation. Convert the selected cause to nonnegative source rate
`s_f` in inverse seconds.

For dimensionless coverage:

```text
partial_t f+u_f dot grad(f)
  = s_f(1-f)-f/tau_f+kappa_f Laplacian(f)

0 <= f <= 1.
```

For conserved areal density `c`:

```text
partial_t c+div(u_f c)
  = S_c-c/tau_c+diffusion.
```

Use the equation matching stored semantics. Coverage transport reports
extrema/blur; density transport reports mass. With source fixed over one
reaction step:

```text
r=s_f+1/tau_f
f_eq=s_f/r
f_next=f_eq+(f_advected-f_eq)exp(-r dt).
```

Handle `r=0` explicitly. Partition breaking dissipation once and drive one
foam history; coverage is not wave energy.

Exactly one exposed-bed receiver owns wetness `w`:

```text
I_wet = (h>=h_wet) or (m_wash>=m_wet)

w_next = 1                 when I_wet
w_next = w exp(-dt/tau_dry) otherwise.
```

The prescribed-phase branch needs an explicit wash mask to wet exposed bed;
static water depth is insufficient. Wetness changes material response and does
not inject water or move the geometric shoreline.

## Sparse active tiles

Sparse execution is eligible when the causal nearshore domain is much smaller
than the full rectangle. Each tile records stable identity, physics-frame
origin, cell size, interior extent, halo width, neighbors, boundary faces,
validity interval, donor version, wet bounds, and state generation.

Activation uses wave/current influence horizon, interactions, boundaries,
accepted-view error, and persistence—not visibility alone. An inactive tile
retains state, evolves a declared coarse model, or reconstructs from a donor
with measured assimilation error.

The conservative dependency graph is:

```text
immutable input/state version
  -> source gather and deterministic reduction
  -> active list
  -> halo and physical-boundary fill
  -> canonical x/z face fluxes
  -> conservative cell update and balanced bed source
  -> friction/external source
  -> stable subcycles
  -> foam and wetness/inundation publication
  -> displacement, normals, and optical fields
  -> immutable presentation state.
```

Whole-atlas dependencies cross dispatches. Each cell gathers canonical face
fluxes and writes one next-state texel. Workgroup fusion is valid only when
cross-workgroup face ownership and conservation match the reference.

For tile interior `N_x` by `N_z`, halo `g_h`, state channels `C_q`, and bytes
per channel `B_q`:

```text
bytes_state =
  2(N_x+2g_h)(N_z+2g_h) C_q B_q.
```

Canonical face storage with `C_f` channels of `B_f` bytes is:

```text
bytes_flux =
  [(N_x+1)N_z+N_x(N_z+1)] C_f B_f.
```

Add bed, masks, foam, derivatives, metadata, transients, render targets, and
simultaneous generations. Multiple resolutions require conservative
restriction/prolongation, refluxing, and time interpolation; otherwise use one
simulation resolution and vary only display extent/detail.

The simulation clock owns fixed stable steps. Catch-up, time dilation, dropped
time, emergency substeps, or reset is explicit and counted. A detected bound
violation blocks the unstable update. The render loop never reads the grid back
to choose `dt`.

Sparse execution passes with active/dormant maps, halo validity, canonical-face
parity, mass balance, activation/deactivation residual, capacity/fragmentation
stress, inactive-region error, dispatch traffic, peak residency, and sustained
timing.

## Optics and presentation

Use the refracted-ray, Fresnel, Beer-Lambert, and receiver-caustic rules in
[water-surface-system.md](water-surface-system.md). The bed receiver, water
path length, extinction coefficients, and surface state cause the shallow/deep
transition; coast distance alone is not optical depth.

Geometry, tangents, normal, velocity, foam, shadows, refraction, and temporal
effects consume one immutable state generation. Datum, bed, coast, source,
active-domain, representation, cadence, or origin changes migrate state with
an error record or reset all dependent histories. One final output transform
owns presentation.

## Acceptance

Apply every selected branch's falsification set:

- bed units/datum/validity, coast/bed contour agreement, SDF eikonal and
  nearest-coast ambiguity;
- prescribed crest direction/speed/filtering, or action/ray dispersion,
  integrability, energy and refraction, or mild-slope convergence;
- fixed-wet mass/energy/dispersion, or nonlinear positivity, lake-at-rest,
  mass, dry safety, run-up, convergence, and reflection;
- donor/receiver phase or action continuity, incoming-characteristic behavior,
  transmitted energy, reflection, and single geometry owner;
- foam source/transport/reaction and wetness history with one owner each;
- sparse halo/face ownership, activation residual, capacity stress, fixed-step
  stability, and no frame-critical readback;
- refraction, Fresnel/TIR, extinction, receiver-caustic power, and disabled
  optical controls;
- backend, resources, dispatches, warm sustained timings, fixed-camera
  multi-time captures, and lifecycle plateau.

A branch fails if it substitutes a different cause: coast distance for depth,
an FFT clipped at land for coastal propagation, a linear height grid for
wet/dry hydrodynamics, uncalibrated numerical loss for breaking, source-space
brightness for receiver caustics, or two surfaces for one handoff.
