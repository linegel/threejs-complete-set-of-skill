# Bounded-water surface and optics

Use this reference for parametric waves, bounded linear heightfields,
physics-horizontal queries, receiver-space caustics, and optical transport.
Coastal propagation and shallow-water solvers live in
[coastal-water-system.md](coastal-water-system.md).

## Bounded linear heightfield

### State, units, and stability

Let height `h` be metres, vertical velocity `v` metres per second, wave speed
`c` metres per second, damping `gamma` inverse seconds, and source
acceleration `s` metres per second squared:

```text
partial_t h = v
partial_t v = c^2 Laplacian(h) - 2 gamma v + s.
```

For cell sizes `dx` and `dz`,

```text
Lh(i,j) =
  [h(i+1,j)-2h(i,j)+h(i-1,j)]/dx^2
 +[h(i,j+1)-2h(i,j)+h(i,j-1)]/dz^2.
```

One symplectic update with exact damping factor is:

```text
v(n+1) = exp(-2 gamma dt)
         [v(n)+dt(c^2 Lh(n)+s(n))]
h(n+1) = h(n)+dt v(n+1).
```

Its undamped stability condition is:

```text
(c dt/dx)^2 + (c dt/dz)^2 <= 1.
```

For square cells this is `c dt/dx <= 1/sqrt(2)`. Select a stricter margin.
Damping does not legalize a CFL violation. If the integrator or stencil
changes, derive its amplification matrix and replace this bound.

The discrete dispersion relation is:

```text
sin^2(omega_d dt/2)
  = C_x^2 sin^2(k_x dx/2)
  + C_z^2 sin^2(k_z dz/2),

C_x=c dt/dx, C_z=c dt/dz.
```

Sweep direction and active wavenumber; CFL alone does not bound anisotropic
phase error near the grid band edge.

### Dimensioned sources

Each event is exactly one of:

```text
height displacement    metres
velocity impulse       metres per second
acceleration over step metres per second squared.
```

Use a compact world-space kernel with declared radius and normalized integral.
If mean height must remain fixed, use zero-integral events or report the
removed mean/volume.

Overlapping events require one writer per output texel. Valid patterns are
texel gathering from a bounded event list, spatial bins plus neighbor gather,
or a supported atomic accumulation representation with an explicit
quantization/error scale. Ordinary float scatter to the same texel races.

### Boundaries

- **Periodic:** wrap neighbors; zero-mean forcing preserves the periodic mean.
- **Reflecting:** ghost samples enforce zero normal derivative under the chosen
  cell/node convention.
- **Absorbing:** a smooth damping sponge; measure reflection over frequency and
  incidence angle.
- **Fixed height:** a deliberate phase-inverting Dirichlet wall.

Boundary handling is shared by propagation and derivative reconstruction.
Ad-hoc clamping changes stencil weights and launches pulses.

### Dispatch and derivatives

Use read/write state ping-pong. The dependency order is:

```text
event gather + propagation
  -> swap state
  -> centered derivatives
  -> optical auxiliaries.
```

Every global edge crosses a dispatch boundary. For a graph surface:

```text
h_x = [h(i+1,j)-h(i-1,j)]/(2 dx)
h_z = [h(i,j+1)-h(i,j-1)]/(2 dz)
n = normalize((-h_x,1,-h_z)).
```

Fixed-step catch-up uses a bounded, recorded policy. A render callback consumes
published state; it does not choose a new PDE timestep or inject a private
advance.

The branch passes only with a positive CFL margin; analytic-mode phase and
amplitude error; boundary reflection; mean/volume drift; overlapping-event
stress; finite-value scan; and half-versus-float comparison.

## Exact parametric waves

For normalized direction `d_i`, wavelength `lambda_i`,
`k_i=2 pi/lambda_i`, amplitude `a_i`, horizontal ratio `Q_i`, and
`b_i=Q_i a_i`:

```text
theta_i = k_i d_i dot q - omega_i t + phi_i

P(q,t) = (
  q_x + sum_i b_i d_ix cos(theta_i),
        sum_i a_i      sin(theta_i),
  q_z + sum_i b_i d_iz cos(theta_i)).
```

For depth `d` and `tau=sigma_surface/rho`:

```text
omega_i^2 = (g k_i+tau k_i^3) tanh(k_i d).
```

Differentiate the actual map:

```text
P_u = (
  1-sum_i b_i k_i d_ix^2 sin(theta_i),
    sum_i a_i k_i d_ix   cos(theta_i),
   -sum_i b_i k_i d_ix d_iz sin(theta_i))

P_v = (
   -sum_i b_i k_i d_ix d_iz sin(theta_i),
    sum_i a_i k_i d_iz   cos(theta_i),
  1-sum_i b_i k_i d_iz^2 sin(theta_i)).
```

The upward normal is:

```text
n = normalize(cross(P_v,P_u)).
```

At fixed parameter coordinate:

```text
partial_t P = (
  sum_i b_i omega_i d_ix sin(theta_i),
 -sum_i a_i omega_i      cos(theta_i),
  sum_i b_i omega_i d_iz sin(theta_i)).
```

This is surface-point velocity under the declared parameterization. Its
gauge-invariant geometric normal speed is `dot(partial_t P,n)`; it is distinct
from phase speed, group speed, and material current.

The horizontal deformation gradient is:

```text
H = I - sum_i b_i k_i sin(theta_i) d_i d_i^T
J_h = det(H).
```

The sufficient global no-fold condition is:

```text
sum_i |b_i k_i| < 1.
```

Also measure actual minimum `J_h`. A negative determinant means the
single-valued surface and ordinary Eulerian query are invalid. Validate
tangents and normals against finite differences over phase, time, and domain.

Mesh spacing `Delta` obeys `k_max Delta <= pi` plus a stricter measured
position/normal gate. Normal-only bands use a footprint-derived low-pass; they
do not claim geometric parity.

## Physics-horizontal queries

The renderer evaluates `P(q,t)`, while a physics-horizontal query supplies
`x=(x,z)`. Solve:

```text
X(q,t) = q + D(q,t) = x.
```

Fixed-point iteration is:

```text
q_(m+1) = x-D(q_m,t).
```

Let `L=sup ||partial D/partial q||_2`. If `L<1`,

```text
||q_m-q*|| <= L^m/(1-L) ||q_1-q_0||.
```

For the wave sum:

```text
L <= sum_i |b_i k_i|
G_y <= sum_i |a_i k_i|.
```

The height error from inversion is bounded by
`G_y ||q_m-q*||` plus numeric evaluation error. Newton uses the same
horizontal Jacobian; damp or reject a step when determinant or conditioning
fails its gate.

Expose parameter and physics-horizontal sampling as different operations. The
result identifies iteration count, horizontal residual, convergence status,
and the represented filter.

### Live GPU-grid query contract

A live GPU grid needs one honest query contract:

- an enforced state envelope `|h_grid|<=H_grid`, making omitted live height
  `+/-H_grid`;
- a CPU surrogate with convergence and probe error; or
- an unavailable live-grid contribution that blocks consumers whose tolerance
  requires it.

An asynchronous reduction is a lagged measurement, not a bound on current or
future state. The frame path performs no synchronous full-grid readback.

## Receiver-space caustics

Let `p=P(q)`, incident propagation direction `i`, surface normal `n`,
refracted direction `r`, receiver-plane point `b`, and receiver normal `n_b`:

```text
tau(q) = n_b dot (b-p)/(n_b dot r)
Q(q) = p + tau r.
```

Reject near-parallel denominators, `tau<=0`, total internal reflection, and
non-finite values. Project `Q` into an orthonormal receiver basis:

```text
F(q) = (e_1 dot Q(q), e_2 dot Q(q)).
```

For parameter-cell derivatives:

```text
A_receiver =
  |F_u.x F_v.y-F_u.y F_v.x| du dv.
```

The product of derivative lengths omits their mutual angle and is generally
wrong.

Incoming cell power is:

```text
A_surface = |P_u cross P_v| du dv
P_in = E_i max(0,-i dot n) A_surface
       (1-F_interface) T_light.
```

Deposit `P_in` into receiver texels with conservative splatting or an inverse
map. Writing source-cell brightness at the source coordinate is not a
receiver-space caustic.

Finite pixels, source angular extent, interface roughness, and wave bandwidth
regularize caustic folds. Derive the minimum receiver area from that footprint.
Record invalid/TIR counts and power before regularization, after deposition,
after filtering, and after display clamp.

## Refraction and Fresnel

Classify the incident side before selecting refractive indices. With
`c_i>0` and `eta=n_i/n_t`:

```text
s_t^2 = eta^2(1-c_i^2)
TIR when s_t^2 > 1
c_t = sqrt(max(0,1-s_t^2))

R_s = [(n_i c_i-n_t c_t)/(n_i c_i+n_t c_t)]^2
R_p = [(n_t c_i-n_i c_t)/(n_t c_i+n_i c_t)]^2
F = (R_s+R_p)/2.
```

Schlick is eligible only when its measured error over the active side,
angle, and index range meets the declared gate. Use exact Fresnel near total
internal reflection.

For screen-space refraction:

1. reject off-viewport coordinates;
2. sample opaque depth and reconstruct the scene point in the same space as the
   water point and refracted ray;
3. reject foreground points;
4. compute `ell=dot(q_s-p_s,r_s)` and require `ell>0`;
5. require cross-track residual
   `||q_s-p_s-ell r_s||` below its world- or pixel-space gate.

Only then is `ell` a path length in metres. Raw-depth subtraction and
view-depth difference alone are not refracted-ray distance.

## Beer-Lambert transport

For nonnegative absorption `sigma_a` and scattering `sigma_s` in inverse
metres:

```text
sigma_t = sigma_a+sigma_s
T_rgb = exp(-sigma_t_rgb ell)
omega_0 = sigma_s/max(sigma_t,epsilon_sigma)

L_water = F L_reflection
        + (1-F)[T L_background+(1-T)omega_0 L_source].
```

Handle zero extinction explicitly. The fraction
`(1-T)(1-omega_0)` is absorbed; it is not emitted as scattering. More complex
scattering may replace `L_source` only with an explicit phase and source-light
model.

Sun glint belongs to the reflected specular BRDF. Foam coverage composites:

```text
L_final = (1-f)L_water + f L_foam
0 <= f <= 1.
```

Optical effects share the geometric surface normal and one scene-linear HDR
path. Tone mapping and output conversion happen once.

## WebGPU implementation

Initialize `WebGPURenderer` before checking its backend or features.
Simulation resources are `StorageTexture` instances with `NoColorSpace`,
generated mipmaps disabled, and explicit float/half-float precision.
Stencil reads use integer `textureLoad`. A global writer/reader dependency
crosses a dispatch.

Use one opaque scene pass that excludes water. Add MRT attachments only for
named consumers whose measured cost is lower than reconstruction or a reduced
pass. Transparent objects have an explicit refraction ordering policy.

Render through one `RenderPipeline`. If `renderOutput(...)` owns conversion,
set `pipeline.outputColorTransform = false`; otherwise the pipeline owns it.
After replacing `pipeline.outputNode`, set `pipeline.needsUpdate = true`.

For a square `N`:

```text
RGBA16F bytes = 8 N^2
RGBA32F bytes = 16 N^2.
```

Count both ping-pong states, derivatives, events, caustics, opaque color/depth,
and transient post targets. Keep simulation size independent of viewport size.
Select precision, update cadence, and effect resolution from numerical/image
error and sustained named-target measurements.

Presentation consumes immutable previous/current state. Resize, timestep,
representation, datum, source, or origin changes migrate compatible state or
reset derivatives, foam, caustic reprojection, and temporal history together.

## Acceptance

The applicable branch is complete only when:

- heightfield CFL, dispersion, phase/amplitude, boundary reflection, mean
  drift, event-race, precision, and finite-value checks pass;
- parametric tangents, normals, minimum Jacobian, fold classification, and
  parameter/Eulerian query residuals pass;
- Fresnel/TIR, refracted-ray validity, path length, absorption/scattering
  partition, and disabled-optics controls pass;
- receiver-caustic location and power close across deposition,
  regularization, filtering, and clamp;
- backend, formats, allocations, dispatches, warm sustained timings, final
  images, and lifecycle plateau are recorded;
- geometry, normal, foam, optics, temporal state, and output conversion each
  have one owner.
