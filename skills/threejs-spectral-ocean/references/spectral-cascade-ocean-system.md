# Spectral-cascade ocean

Use this reference after the skill has selected a broad, homogeneous,
periodic sea. It defines the dimensional spectrum, deterministic coefficient
field, transform convention, derivatives, displaced geometry, optional state,
and coastal donor semantics.

## Validity and dataflow

Each cascade has one periodic patch, scalar mean depth, dispersion relation,
and stationary spectral statistics. A uniform current may Doppler-shift every
mode. Spatially varying bathymetry or current couples modes and belongs to a
spatial coastal solver.

The complete causal chain is:

```text
environment forcing
  -> directional dimensional spectrum
  -> cascade power partition
  -> deterministic Gaussian coefficients
  -> Hermitian evolution and exact spectral derivatives
  -> inverse FFT
  -> summed displacement and derivatives
  -> tangents, Jacobian, normal, and foam source
  -> optional foam/query state
  -> optical material
  -> one final output transform
```

Direct summation is preferable for a few modes. A bounded heightfield is
preferable for local disturbances and explicit walls. The FFT cannot produce
bathymetric refraction, shoaling, diffraction, obstacle reflection,
depth-breaking, run-up, inundation, or wet/dry topology.

## Environment forcing

A wind-sea adapter records:

- sampled wind vector, reference or measurement height, averaging interval,
  and spatial footprint;
- vertical-profile or drag model, roughness, displacement height, atmospheric
  stability treatment, calibration range, and propagated error;
- fetch geometry, forcing duration or wave age, directional spreading, and
  represented wind-input, whitecapping, transfer, and bottom source terms;
- immutable forcing version and sample instant consumed by coefficient
  evolution.

If a calibrated logarithmic profile is valid,

```text
Phi_m(z) = ln((z-d)/z_0)
           - psi_m((z-d)/L_MO) + psi_m(z_0/L_MO)

U(z) = (u_star/kappa) Phi_m(z)
U_10 = U(z_r) Phi_m(10 m) / Phi_m(z_r).
```

Require finite nonzero profile factors and
`z_r>d+z_0`, `10 m>d+z_0`. Otherwise require a supplied reference-height wind
or another named calibrated transfer. Preserve wind direction and classify
calm, invalid-height, and out-of-calibration inputs.

Fetch is the upwind water-path length over the sampled footprint. Duration
controls whether the target sea could have reached its assumed state. A
stationary sea freezes or slowly retargets a documented statistical state. An
evolving sea advances a validated action/energy source balance while preserving
coefficient phase. Neither branch regenerates independent Gaussian
coefficients for each gust.

Water current remains a distinct velocity field:

```text
omega_abs = omega_int + k dot U.
```

Uniform current changes the shared phase clock. Wind does not become current,
and current does not replace wind forcing.

## Wavevector and transform convention

For a square patch of length `L` and even power-of-two resolution `N`,

```text
Delta k = 2 pi / L
k = Delta k (s_x,s_z)
s_axis in {-N/2, ..., N/2-1}.
```

The isotropic representable bound is `|k| < pi N/L`; reserve a guard band
before it. DC is zero for a zero-mean surface. Select DC away before evaluating
`1/|k|` or other inverse powers.

This reference uses an unnormalized positive-exponent inverse:

```text
f[j_x,j_z] = sum_(n_x,n_z) F[n_x,n_z]
             exp(+i 2 pi (n_x j_x+n_z j_z)/N).
```

Therefore:

```text
unit DC -> unit constant
sum_j |f_j|^2 = N^2 sum_n |F_n|^2
mean_j |f_j|^2 = sum_n |F_n|^2.
```

A normalized transform requires the inverse scaling in coefficient
initialization. Centered storage requires exactly one correction: either
`ifftshift` before the transform or multiplication by
`(-1)^(j_x+j_z)` afterward.

## Dispersion and dimensional spectrum

For depth `d`, gravity `g`, surface tension `sigma_surface`, density `rho`,
and `tau=sigma_surface/rho`,

```text
omega^2(k) = (g k + tau k^3) tanh(k d)

d omega/dk =
  [(g+3 tau k^2) tanh(kd)
   +(gk+tau k^3) d sech^2(kd)]
  /(2 omega).
```

Use a safe small-`k` branch. Any approximation to `tanh` or `sech` carries a
measured phase/group-speed error over the represented band.

Let `S_omega(omega,theta)` be directional angular-frequency variance density:

```text
integral S_omega d omega d theta = variance(h)
[S_omega] = m^2 s.
```

With a direction distribution normalized over `theta`, convert polar
frequency density to Cartesian wavevector density:

```text
P(k_x,k_z)
  = S_omega(omega(k),theta) |d omega/dk| / k

[P] = m^4
integral P d k_x d k_z = variance(h).
```

Both the `1/k` Jacobian and discrete
`Delta k_x Delta k_z` cell area are required. Verify directional
normalization numerically at every sampled frequency.

A JONSWAP-like family is an authored option:

```text
S_J(omega) = alpha g^2 omega^-5
  exp[-5/4 (omega_p/omega)^4] gamma^r

r = exp[-(omega-omega_p)^2/(2 sigma_J^2 omega_p^2)].
```

Treat empirical coefficients, peak enhancement, fetch parameterization, swell
components, and spreading as calibrated inputs rather than universal
constants. If a finite-depth shape factor is used, apply it once.

## Cascade power and deterministic coefficients

Power windows satisfy

```text
w_c(k) >= 0
sum_c w_c(k) = 1
```

over the target band. Hard half-open bands assign a mode once. Smooth overlap
sets `P_c=w_c P`, hence amplitude multiplier `sqrt(w_c)`. Every support lies
inside its cascade's isotropic band and guard region. Numerically integrate
each window and their sum; compare total represented variance with the target.

Patch length sets both spectral spacing and exact spatial repetition. Choose it
from visible footprint and correlation/repetition evidence, not a fixed tier.

Generate coordinate-stable independent normals from
`(seed,cascade,index_x,index_z)`:

```text
zeta_k = (xi_1 + i xi_2)/sqrt(2)
xi_1,xi_2 ~ N(0,1)
E|zeta_k|^2 = 1.
```

For the unnormalized inverse,

```text
a_k = sqrt(P_c(k) Delta k_x Delta k_z / 2) zeta_k

H_k(t) = a_k exp(-i omega_k t)
       + conjugate(a_-k) exp(+i omega_k t).
```

This gives `H_-k=conjugate(H_k)`. Directional asymmetry between `P(k)` and
`P(-k)` controls propagation while instantaneous height stays real. Construct
self-conjugate cells as real and set DC to zero.

## Displacement and derivative spectra

For the positive-exponent inverse, positive choppiness uses:

```text
D_x_hat = +i (k_x/k) H
D_z_hat = +i (k_z/k) H.
```

The one-dimensional check is
`h=a cos(kx) -> D_x=-a sin(kx)`, so
`X=x-chi a sin(kx)` compresses the crest.

Construct:

```text
height:       H
D_x:         +i k_x/k H
D_z:         +i k_z/k H
h_x:         +i k_x H
h_z:         +i k_z H
D_xx:        -k_x^2/k H
D_zz:        -k_z^2/k H
D_xz=D_zx:   -k_x k_z/k H.
```

Set every divided field to zero at DC. On an even grid:

- `D_x` and `h_x` are zero on the `k_x` Nyquist line;
- `D_z` and `h_z` are zero on the `k_z` Nyquist line;
- `D_xz` is zero on either Nyquist line;
- even `D_xx` and `D_zz` retain their Nyquist values;
- every self-conjugate output cell is real.

Verify `F(-k)=conjugate(F(k))` for every field. A pairwise validation
projection is

```text
F_p(k) = [F(k)+conjugate(F(-k))]/2.
```

## Packing and inverse FFT

Pair two Hermitian spectra `A` and `B` into one complex transform:

```text
G = A + i B
G_re = A_re - B_im
G_im = A_im + B_re.
```

After inversion, `real(g)=a` and `imag(g)=b`. One complete four-transform
layout is:

```text
G_0 = D_x  + i D_z
G_1 = h    + i D_xz
G_2 = h_x  + i h_z
G_3 = D_xx + i D_zz.
```

Store two complex lanes per RGBA texture. Component interleaving such as
`[A.re,B.re,A.im,B.im]` is a different representation and cannot use this
unpack rule.

Three FFT layouts are useful:

- **Global Stockham autosort:** correctness reference; ping-pong every stage;
  no separate bit reversal.
- **Global explicit-bit-reversal radix-2:** bit-reverse exactly once, then
  ping-pong every butterfly stage.
- **Workgroup-resident rows plus transpose:** eligible only when row storage,
  invocations, occupancy, and precision pass on the initialized target.

Compute shared-memory bytes from the WGSL element type, not the storage-texture
format. An `RGBA16F` texel loaded into a `vec4<f32>` occupies 16 bytes in
workgroup memory, not 8.

Every output texel has one writer. A whole-grid read-after-write dependency
crosses a dispatch boundary. A workgroup barrier does not synchronize
workgroups. For either global layout, both butterfly inputs read the source
texture, identical indices and twiddles serve both complex lanes, and
source/destination swap only after a complete stage. Stockham performs no
separate bit reversal; explicit-bit-reversal radix-2 performs it exactly once.

## Transform gate

Compare a small GPU transform with a CPU DFT before loading a random spectrum.
Exercise:

- DC;
- positive x and z axis bins;
- an oblique bin;
- a conjugate pair;
- every field-specific Nyquist line;
- a random complex field.

Record maximum, RMS, relative-L2, Parseval, Hermitian-partner, and
imaginary-leakage errors. Diagnose before changing the spectrum:

| Failure | Likely cause |
| --- | --- |
| Alternating sign on DC | Centered correction missing or doubled |
| Backward travel | Inverse twiddle or evolution sign |
| Axes exchanged | Row/column or transpose indexing |
| Later stages corrupt | Ping-pong parity or missing dispatch boundary |
| Packing partners leak | Hermitian/Nyquist or packing algebra |
| Correct shape, wrong amplitude | IFFT scale or Gaussian/cell-area factor |

## Exact displaced geometry

Sum fields across cascades before forming nonlinear geometry:

```text
h    = sum_c h_c
D_x  = sum_c D_x,c
D_z  = sum_c D_z,c
h_x  = sum_c h_x,c
h_z  = sum_c h_z,c
D_xx = sum_c D_xx,c
D_zz = sum_c D_zz,c
D_xz = sum_c D_xz,c.
```

For

```text
P(q) = (q_x + chi D_x, h, q_z + chi D_z)
A = 1 + chi D_xx
B =     chi D_xz
C = 1 + chi D_zz

P_qx = (A,h_x,B)
P_qz = (B,h_z,C)
J = A C - B^2

cross(P_qz,P_qx)
  = (h_z B-C h_x, J, B h_x-h_z A).
```

Use the normalized cross product while `J>0`. A shortcut that divides each
slope by its same-axis stretch omits cross coupling. Validate both tangents and
the normal against central differences of the displaced map. Report minimum
`J` and fold count; `J<=0` invalidates a single-valued surface.

Differentiate the same evolved coefficients at fixed parameter coordinate:

```text
partial_t P|q =
  (chi partial_t D_x,
   partial_t h,
   chi partial_t D_z).
```

This is surface-point velocity under the declared parameterization, not phase
speed, group speed, or material current. Its invariant geometric interface
speed is `dot(partial_t P|q,n)`. Position, tangents, normal, and velocity use
the same coefficient time and filter.

Mesh spacing `Delta_mesh` must at least satisfy
`k_geometry,max Delta_mesh <= pi`, with a stricter measured position/normal
error gate. Distance-adaptive patches must share boundary samples or hide
skirts below a declared visibility limit. Periodicity is tested with fixed
flight paths and autocorrelation; random phase does not remove it.

## Foam

Jacobian compression is a breaking proxy, not persistent state. Create one
nonnegative source `s` from combined-cascade compression, negative material
`J` change, curvature, or a calibrated combination. Then evolve one declared
state.

For dimensionless coverage:

```text
D f/Dt = s(1-f) - f/tau_f + kappa Laplacian(f)
0 <= f <= 1.
```

With source constant during the reaction step:

```text
r = s + 1/tau_f
f_eq = s/r
f_next = f_eq + (f_advected-f_eq) exp(-r dt).
```

Handle `r=0` explicitly. Declare whether texels live in Lagrangian parameter
space, an Eulerian stable-frame atlas, or a conservative density grid.
Eulerian semi-Lagrangian transport reports blur/backtrace error; a conservative
finite-volume branch reports mass error and satisfies its positivity CFL. One
combined source drives one history—never saturating-add independent histories.

## CPU queries

Retain a deterministic coefficient set `K_r`. For omitted modes `K_o`:

```text
B_0 = sum_(k in K_o) (|a_k|+|a_-k|)
B_1 = sum_(k in K_o) |k| (|a_k|+|a_-k|)
B_t = sum_(k in K_o) |omega_param(k)| (|a_k|+|a_-k|).
```

At fixed parameter coordinate:

```text
|delta h| <= B_0
||delta grad h|| <= B_1
||delta chi D|| <= chi B_0
|delta partial_t h| <= B_t
||delta chi partial_t D|| <= chi B_t.
```

Serialize whether the parameter chart is stationary in the physics frame or
advected exactly by uniform current; that selects `omega_param`. Sort retained
modes for the queried quantity: amplitude for height, `|k|`-weighted amplitude
for slopes, and frequency-weighted amplitude for velocity.

For a physics-horizontal query, solve:

```text
X(q) = q + chi D(q) = x.
```

With

```text
G = sum_all |k|(|a_k|+|a_-k|)
L = chi G,
```

`L<1` gives the conservative bounds:

```text
||q_full-q_reduced|| <= chi B_0/(1-L)

|h_full(q_full)-h_reduced(q_reduced)|
  <= B_0 + G chi B_0/(1-L).
```

When `L>=1` or folds are allowed, publish a parametric result or measured local
probe error rather than a global Eulerian bound. Keep coefficient omission,
inversion tolerance, floating-point error, filter omission, latency, and GPU
probe discrepancy separate. Full-map readback is diagnostic-only and uses the
actual aligned row stride.

## Coastal donor

Read this section only when a spatial depth-varying owner consumes the
offshore field. Place the coupling boundary where donor and receiver both pass
their dispersion, depth, and resolution gates.

### Phase-resolved

For a component:

```text
eta_m = Re{A_m exp[i(k_m dot x-omega_abs,m t)]}
omega_abs,m = omega_int,m + k_m dot U

q'_m = Re{(omega_int,m/|k_m|^2) k_m A_m
          exp[i(k_m dot x-omega_abs,m t)]}.
```

`eta` is metres and depth-integrated discharge `q'` is square metres per
second. For an assembled coefficient,

```text
Q'_k = i k/|k|^2 [partial_t H_k+i(k dot U)H_k]
Q'_0 = 0.
```

This preserves opposite intrinsic-time signs. Multiplying the assembled
`H_k` by one positive frequency is wrong. Transfer elevation, discharge,
surface slope, phase/sample instant, current, stable band identity, and
separate omission/interpolation errors. The coastal boundary prescribes the
incoming characteristic and retains its outgoing solution.

For omitted modes:

```text
B_eta = sum_(k in K_o) (|a_k|+|a_-k|)
B_q   = sum_(k in K_o) [omega_int(k)/|k|]
                      (|a_k|+|a_-k|).
```

Choose direct boundary synthesis or an additional packed discharge IFFT from
measured mode-count, boundary-sample, storage, and timing costs.

### Phase-averaged

From height wavevector variance density:

```text
E(k) = [rho g+sigma_surface |k|^2] P_eta(k)
N(k) = E(k)/omega_int(k).
```

Transfer dimensioned action/energy quadrature, intrinsic frequency, group
velocity, direction, current, and stable band IDs. The nearshore model owns
refraction, shoaling, breaking loss, and local display phase. Record incoming,
reflected, transmitted, dissipated, and numerical fluxes in one unit
convention.

### Ownership

A one-way donor cannot display coastal reflection propagating back through the
boundary. If it is observable, extend the spatial domain or implement a
two-way modal projection with phase, energy, localization, truncation, and
periodic-copy residuals.

Disjoint or uncorrelated bands may use power weights summing to one. Coherent
copies retain full incoming amplitude and one spatial render owner. For an
unavoidable coherent display blend:

```text
eta = (1-beta) eta_o + beta eta_c

grad eta = (1-beta) grad eta_o + beta grad eta_c
         + (eta_c-eta_o) grad beta.
```

Apply the product rule to displacement and velocity and derive one normal from
the composite. One foam-history owner partitions dissipation once and evolves
one state.

## WebGPU and performance

Initialize `WebGPURenderer` before inspecting
`renderer.backend.isWebGPUBackend`, device limits, or features. FFT and state
textures use `NoColorSpace`, no generated mipmaps, explicit float or
half-float storage, and integer `textureLoad` in transform kernels.

After initialization, `renderer.compute(nodeOrArray)` submits nodes in order;
`computeAsync()` is initialization-safe, not a GPU-completion fence. Select a
fused assembly only after its compiled storage bindings fit the initialized
device and it beats the split dependency graph.

For square `N`:

```text
RGBA16F bytes = 8 N^2
RGBA32F bytes = 16 N^2.
```

Count coefficient state, every FFT ping-pong and transpose, resolved maps,
foam, scene attachments, and simultaneous old/new generations. Repeated
half-float stores at every FFT stage are a stricter error case than a
half-float resolved map; compare both with the float reference.

Use one `RenderPipeline` and one output conversion. A presentation generation
remains immutable while rendering consumes it. Seed, spectrum, transform,
representation, cadence, resolution, or origin changes propagate a new
generation and reset or migrate every dependent history.

## Acceptance

The implementation is complete only when all applicable evidence exists:

- forcing provenance, deterministic replay, and wind/current separation;
- directional normalization, cascade power closure, and target/realized
  variance;
- DC/axis/oblique/pair/Nyquist DFT cases, transform/Parseval errors, Hermitian
  residual, and imaginary leakage;
- one-mode propagation and choppiness signs, every derivative sign, exact
  tangent/normal error, minimum Jacobian, and fold count;
- represented/omitted band, geometry sampling, and periodic-repeat evidence;
- foam source, transport, reaction/decay, diffusion, and display diagnostics;
- CPU omission bound, horizontal inversion residual, and optional GPU probe
  discrepancy, with no frame-critical readback;
- phase-resolved discharge/phase/reflection or phase-averaged action/energy
  closure for every coastal handoff;
- initialized backend, resource and dispatch inventory, precision comparison,
  warm sustained timings, lifecycle plateau, and final/no-foam/no-detail/
  no-post images;
- one surface state, one foam history, and one output transform throughout.
