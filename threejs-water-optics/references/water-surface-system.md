# WebGPU/TSL bounded-water and optical-transport system

This reference specifies bounded compute heightfields, exact authored-wave
geometry, receiver-space caustics, and water optical transport. It is written
for implementation and audit; every formula states its convention and every
performance claim requires evidence.

## Quantitative provenance

Use the tags **[D] Derived**, **[G] Gated**, **[M] Measured**, and
**[A] Authored**. Unlabelled integers in exact equations, tensor dimensions,
byte identities, and API names are [D]. All tunable constants, resolutions,
timesteps, thresholds, iteration limits, and performance targets need an
explicit tag.

## Algorithm selection by scale and error

Do not combine algorithms merely because they all look like waves.

| Surface class | Choose it when | Reject it when | Dominant error |
| --- | --- | --- | --- |
| Exact parametric wave sum | The surface is authored with few components and local disturbances are unnecessary. | Broad stochastic scale range or dense local interaction is required. | Component truncation, mesh sampling, and inversion of horizontal displacement. |
| Linear wave-equation grid | A bounded domain needs many local disturbances but remains single-valued and weakly nonlinear. | Breaking bores, hydraulic jumps, wet/dry shoreline motion, overturning, or bulk flow controls the image. | Numerical dispersion, boundary reflection, and unresolved wavelengths. |
| Normal-only bands | Surface displacement projects below the silhouette/parallax gate **[G]**. | Close intersections, crest silhouette, caustics, or geometric clearance matters. | Missing parallax and geometry/normal mismatch. |
| Spectral FFT cascades | An unbounded-looking directional sea spans multiple wavelength decades. | The domain is bounded and interaction-driven. | Spectral discretization and periodic repetition. |

The linear heightfield is not a shallow-water solver despite sharing a wave
speed. A nonlinear shallow-water or free-surface flow problem requires a
different conservation-law architecture.

## Pinned Three.js r185 renderer and resource contract

The following names and behavior were checked against the repository's
installed `three@0.185.1` **[G]**:

```js
import {
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
} from 'three/tsl';

const renderer = new WebGPURenderer( { antialias: false } );
await renderer.init();

if ( renderer.backend.isWebGPUBackend !== true ) {
  throw new Error( 'WebGPU is required for bounded-water compute.' );
}
```

`renderer.compute(nodeOrArray)` records compute after initialization.
`renderer.computeAsync(nodeOrArray)` only guarantees initialization before the
same submission; it does not wait for GPU completion. Nodes in one submitted
array are encoded in order in the WebGPU compute pass. A workgroup barrier has
workgroup scope only and cannot replace the dispatch boundary between a writer
and a whole-grid reader.

Create data textures explicitly:

```js
function makeStateTexture( size ) {
  const texture = new StorageTexture( size, size );
  texture.type = HalfFloatType;
  texture.colorSpace = NoColorSpace;
  texture.generateMipmaps = false;
  texture.mipmapsAutoUpdate = false;
  return texture;
}
```

Half-float is an authored format candidate **[A]**, not an accuracy fact.
Compare it against float storage and retain it only when phase, amplitude,
normal, and finite-value gates pass **[M]**. Stencil reads use `textureLoad` at
integer coordinates; filtered sampling belongs in the display path.

Use one scene pass and one output owner:

```js
const scenePass = pass( opaqueSceneWithoutWater, camera );
scenePass.setMRT( mrt( { output } ) );

const pipeline = new RenderPipeline( renderer );
pipeline.outputNode = compositeNode;
pipeline.outputColorTransform = true;
```

Depth remains the pass depth texture. Add normal or velocity MRT outputs only
when named consumers require those exact encodings and a paired target A/B
shows their attachment traffic is cheaper than reconstruction or a separate
reduced pass.

If the graph uses `renderOutput(compositeNode)` explicitly, set
`pipeline.outputColorTransform = false`. When `pipeline.outputNode` is replaced
at runtime, set `pipeline.needsUpdate = true`.

## Stable bounded heightfield

### Model, units, and update

Let height `h` be metres, vertical velocity `v` be metres per second, wave speed
`c` be metres per second, damping rate `gamma` be inverse seconds, and source
acceleration `s` be metres per second squared:

```text
partial_t h = v
partial_t v = c^2 Laplacian(h) - 2 gamma v + s.                [D]
```

For cell sizes `dx`, `dz`, use the second-order central Laplacian:

```text
Lh(i,j) = (h(i+1,j) - 2h(i,j) + h(i-1,j)) / dx^2
        + (h(i,j+1) - 2h(i,j) + h(i,j-1)) / dz^2.             [D]
```

A symplectic update with exponential damping is:

```text
v(n+1) = exp(-2 gamma dt)
         [v(n) + dt (c^2 Lh(n) + s(n))]
h(n+1) = h(n) + dt v(n+1).                                   [D]
```

The undamped stability limit is

```text
(c dt / dx)^2 + (c dt / dz)^2 <= 1.                           [D]
```

For square cells, `c dt / dx <= 1/sqrt(2)` **[D]**. Use a stricter
declared margin **[G]**; damping is not a stability substitute. If the code uses
a different integrator or stencil, derive its amplification matrix and replace
this condition rather than copying it.

The discrete dispersion relation is

```text
sin^2(omega_d dt / 2)
  = C_x^2 sin^2(k_x dx / 2) + C_z^2 sin^2(k_z dz / 2),         [D]
C_x = c dt / dx,  C_z = c dt / dz.
```

This relation, not CFL alone, selects grid spacing. Sweep propagation angle and
active wavenumber; gate relative phase-speed error **[G]** and record it
**[M]**. Energy below Nyquist can still be visually wrong because the stencil
is anisotropic near its band edge.

### Source semantics and races

Declare each event as exactly one of:

```text
height displacement: metres
velocity impulse: metres/second
acceleration over a step: metres/second^2.                     [D]
```

Do not add a dimensionless `strength` to both height and velocity. Apply smooth
compact kernels with declared world-space radius **[A]** and normalized
integral. If the domain must conserve mean height, sources must have zero net
height/velocity integral or a separate mean correction whose removed volume is
reported **[M]**.

Overlapping events cannot scatter ordinary float stores into the same texel:
that is a write race. Choose one architecture:

- each texel gathers a bounded event list;
- events are spatially binned, then each texel gathers its bin and neighbors;
- a separate accumulation representation uses supported atomics and a stated
  quantization scale **[G]**.

Fusing source application with propagation is valid only when every output
texel has a unique writer and all inputs come from the read state.

### Boundary conditions

Boundary behavior changes the solution and must be selected explicitly.

**Periodic.** Wrap every neighbor in both axes. The discrete Laplacian sums to
zero **[D]**; with zero-mean sources the mean mode remains controlled.

**Reflecting.** Construct ghost samples from zero normal derivative under the
chosen node-centered or cell-centered convention. Unit-test the boundary with
normal and oblique analytic modes; ad hoc neighbor clamping changes stencil
weights and launches edge pulses.

**Absorbing sponge.** Add a spatial damping field that is zero in the active
domain and rises smoothly toward the edge. Sponge width, exponent, and maximum
damping are **[A]**. Gate the maximum reflected-to-incident amplitude over the
declared frequency and angle band **[G]**, then measure it **[M]**. A sponge is
not perfectly matched; do not call it one.

**Fixed height.** A Dirichlet wall phase-inverts reflected height. Use only when
that wall is intended.

### State and dispatch order

One compact layout is:

```text
stateRead.rg  = h, v
stateRead.ba  = optional source/validity data
stateWrite    = next h, v
surface.rg    = h_x, h_z
surface.b     = optional curvature/compression metric
surface.a     = validity
```

For the graph surface `(x,h,z)`, reconstruct centered slopes with the same
boundary convention as propagation:

```text
h_x(i,j) = [h(i+1,j)-h(i-1,j)]/(2 dx)
h_z(i,j) = [h(i,j+1)-h(i,j-1)]/(2 dz)
n = normalize((-h_x,1,-h_z)).                                  [D]
```

This is the centered second-order approximation to the height-graph normal; it
is not the normal for a horizontally displaced parametric surface.

The minimum ordered chain is:

```text
source gather + propagation -> swap state -> derivatives -> optical auxiliaries
```

If derivatives or caustics read the just-written state, they require a later
dispatch. Never bind one subresource for conflicting read/write roles in the
same kernel. Fixed-step catch-up count is **[G]**; when exceeded, drop or dilate
simulation time explicitly and increment a diagnostic counter.

## Exact authored-wave geometry

### Convention

Let `q=(u,v)` parameterize the undeformed horizontal plane. For component `i`:

```text
|d_i| = 1
k_i = 2 pi / lambda_i
theta_i = k_i d_i dot q - omega_i t + phi_i
b_i = Q_i a_i

P(q,t) = (
  u + sum_i b_i d_ix cos(theta_i),
      sum_i a_i       sin(theta_i),
  v + sum_i b_i d_iz cos(theta_i)
).                                                               [D]
```

`a_i` and `b_i` are metres; `Q_i` is dimensionless **[D]**. Normalize every
direction once. For depth `d` and `tau=sigma/rho`, use

```text
omega_i^2 = (g k_i + tau k_i^3) tanh(k_i d);                    [D]
```

the deep-water gravity limit is `omega_i=sqrt(g k_i)` **[D]**. Do not mix
phase speeds from different dispersion models or unstated units.

### Tangents, normal, and Jacobian

Differentiate the map actually used for displacement:

```text
P_u = (
  1 - sum_i b_i k_i d_ix^2 sin(theta_i),
      sum_i a_i k_i d_ix   cos(theta_i),
    - sum_i b_i k_i d_ix d_iz sin(theta_i)
)

P_v = (
    - sum_i b_i k_i d_ix d_iz sin(theta_i),
      sum_i a_i k_i d_iz   cos(theta_i),
  1 - sum_i b_i k_i d_iz^2 sin(theta_i)
).                                                               [D]
```

The upward geometric normal is

```text
n = normalize(cross(P_v, P_u)).                                  [D]
```

`normalize((-h_u,1,-h_v))` discards horizontal-displacement derivatives and is
not the same normal. Validate the analytic cross product against central
differences of `P` over phase, time, and parameter-domain sweeps **[M]**.

The horizontal deformation gradient and determinant are

```text
H = I - sum_i b_i k_i sin(theta_i) d_i d_i^T
J_h = det(H).                                                     [D]
```

For one component, `J_h = 1 - b k sin(theta)` **[D]**. A sufficient global
no-fold condition is

```text
sum_i |b_i k_i| < 1.                                             [D]
```

It is conservative, not necessary. Gate and measure the actual minimum
`J_h` **[G,M]**. A negative determinant means the horizontal map folded; a
single-valued height query and ordinary raster surface no longer represent the
same physical sheet.

Use `1-J_h`, curvature, or vertical acceleration as causal crest observables.
Do not derive foam from unrelated scrolling noise; noise may only modulate a
causal source.

### Mesh and normal bandwidth

For mesh spacing `Delta`, the geometric Nyquist condition is
`k_max Delta <= pi` **[D]**. This is only an alias bound. Select a stricter
phase/normal error limit **[G]** and measure against analytic vertex samples
**[M]**.

For normal-only bands, estimate the fragment's world-space footprint `rho` and
apply a smooth low-pass weight `w(k rho)` that tends to zero before the band is
undersampled. The window shape and transition are **[A]**; temporal sparkle and
normal RMS error are **[M]**. Texture LOD is not a substitute when the detail is
evaluated procedurally without an explicit band-limit.

## CPU query and error contract

### Eulerian inversion

The renderer evaluates `P(q,t)`, but callers usually request height at world
horizontal coordinate `x=(x,z)`. Define

```text
X(q,t) = q + D(q,t),
find q*: X(q*,t) = x,
height(x,t) = P_y(q*,t).                                        [D]
```

Directly substituting `x` for `q` is not parity when `D != 0`.

Fixed-point iteration is

```text
q_(m+1) = x - D(q_m,t).                                         [D]
```

Let `L = sup ||partial D / partial q||_2`. If `L < 1`, this is a contraction
and

```text
||q_m - q*|| <= L^m / (1-L) ||q_1-q_0||.                        [D]
```

For the wave sum, `L <= sum_i |b_i k_i|` **[D]**. With
`G_y <= sum_i |a_i k_i|` **[D]**, the corresponding height error is at most
`G_y ||q_m-q*||` plus floating-point error **[D]**. Newton iteration uses the
same horizontal matrix `H`; reject or damp the step when its determinant or
condition number violates a gate **[G]**.

Expose both parametric and Eulerian queries so coordinate semantics cannot be
confused:

```ts
sampleAtParameter(qx, qz, time): { position, normal, jacobian }
sampleAtWorldXZ(x, z, time): {
  height, normal, iterations, horizontalResidual, status
}
```

### Live grid residual

The live compute field is a forced linear dynamical system. Multiple sources
superpose and resonant forcing can exceed every individual source amplitude.
Therefore

```text
|h_grid| <= |dropStrength| + |objectScale|
```

is false in general.

An analytic-only CPU query has one of three valid residual contracts:

- a hard state clamp `|h_grid| <= H_grid` is enforced and counted; then the
  omitted-grid height interval is `+/- H_grid` **[D,G]**;
- a reduced CPU grid mirrors the same sources and integrator; its discrepancy
  is established by resolution/time-step convergence and fixed probes **[M]**;
- no bound is claimed, and consumers receive `gridResidualBound: null`.

An asynchronous GPU reduction can measure an earlier frame's maximum, but that
is a lagged measurement **[M]**, not a bound on future state.

## Receiver-space caustics

### Refracted ray and receiver map

Let `p=P(q)` be a surface point, `i` a unit incident-light propagation
direction, `n` the unit normal pointing into the incident medium, and `r` the
Snell-refracted propagation direction. For receiver plane point `b` and normal
`n_b`:

```text
tau(q) = n_b dot (b-p) / (n_b dot r)
Q(q) = p + tau r.                                                [D]
```

Reject near-parallel denominators, `tau <= 0`, total internal reflection, and
non-finite values. Project `Q` into an orthonormal receiver basis `(e_1,e_2)`:

```text
F(q) = (e_1 dot Q(q), e_2 dot Q(q)).                             [D]
```

For central differences in parameter space,

```text
F_u ~= [F(u+du,v)-F(u-du,v)]/(2du)
F_v ~= [F(u,v+dv)-F(u,v-dv)]/(2dv)
A_r = |F_u.x F_v.y - F_u.y F_v.x| du dv.                        [D]
```

The product `length(F_u) length(F_v)` is wrong unless the derivatives are
orthogonal. Equivalently use the magnitude of their cross product after
embedding them in the receiver plane.

### Flux, deposition, and singularities

Let incoming irradiance normal to the ray be `E_i`. The power entering a source
cell is

```text
A_s = |P_u cross P_v| du dv
P_in = E_i max(0,-i dot n) A_s (1-F_interface) T_light.          [D]
```

Conserve this power when depositing into receiver texels. Bilinear splatting
with atomic-safe accumulation, tiled source lists, or an inverse receiver map
are valid. Writing `P_in/A_r` at the source-grid coordinate is not a caustic on
the receiver.

At a fold, geometric optics predicts a singularity. A finite pixel, finite sun
solid angle, rough interface, and wave bandwidth regularize it. Set
`A_epsilon` from the receiver texel footprint and optical blur model **[D,A]**,
then gate the maximum displayed radiance **[G]**. Record energy before
regularization, after deposition, after filtering, and after display clamp
**[M]**. An arbitrary epsilon without units is invalid.

For mobile/tile GPUs, a lower-rate receiver map plus motion reprojection is
acceptable only when receiver-space reprojection residual and energy drift pass
declared gates **[G,M]**.

## Refraction, Fresnel, and Beer-Lambert transport

### Side classification and exact Fresnel

Select incident and transmitted refractive indices from the actual side. With
positive incident cosine `c_i`, `eta=n_i/n_t`:

```text
s_t^2 = eta^2 (1-c_i^2)
TIR when s_t^2 > 1
c_t = sqrt(max(0,1-s_t^2))

R_s = [(n_i c_i - n_t c_t)/(n_i c_i + n_t c_t)]^2
R_p = [(n_t c_i - n_i c_t)/(n_t c_i + n_i c_t)]^2
F = (R_s + R_p)/2.                                              [D]
```

For authored air and water indices `n_air=1.000` **[A]** and
`n_water=1.333` **[A]**, normal-incidence `F0=0.02037` **[D]** and the
water-to-air critical angle is `48.61 degrees` **[D]**. Use the configured
indices in code; these values are an authored reference, not constants of all
wavelengths, temperatures, or salinities.

Schlick's form

```text
F_s = F0 + (1-F0)(1-c_i)^5                                     [D]
```

is useful away from TIR. Gate its maximum error over the active angle/index
range **[G]** and compare with exact Fresnel **[M]**. Exact Fresnel is preferred
for underwater views and near the critical angle.

### Screen-space ray validation

For a candidate refracted screen coordinate:

- reject coordinates outside the viewport;
- sample opaque depth and reconstruct view-space point `q_s`;
- reject points in front of the water point `p_s` under the renderer's depth
  convention;
- let `r_s` be the normalized refracted ray in the same space;
- compute `ell = dot(q_s-p_s,r_s)` and require `ell > 0`;
- compute cross-track residual
  `e_ray = ||q_s-p_s-ell r_s||` **[D]**;
- accept `ell` as path length only when `e_ray` passes a world- or pixel-space
  gate **[G]**.

A nonlinear raw-depth subtraction is not metres. A reconstructed view-depth
difference is still not refracted-ray distance unless the cross-track test
passes. Invalid samples blend to a declared environment/body term and increment
reason-specific counters.

### Absorption, scattering, and energy partition

For absorption `sigma_a`, scattering `sigma_s`, extinction
`sigma_t=sigma_a+sigma_s` in inverse metres, and path `ell` in metres:

```text
T_rgb = exp(-sigma_t_rgb ell),
omega_0 = sigma_s/max(sigma_t,epsilon_sigma).                   [D]
```

For a bounded single-scattering approximation with authored phase-weighted
source radiance `L_s` **[A]**:

```text
L_water = F L_reflection
        + (1-F) [T L_background + (1-T) omega_0 L_s].           [D]
```

The represented coefficients are nonnegative when `F,T,omega_0` lie in the
unit interval; `(1-T)(1-omega_0)` is absorbed rather than re-emitted **[D]**.
Handle `sigma_t=0` explicitly. More complex scattering may replace `L_s`, but
it must retain an explicit extinction, phase, and source model. An empirical
fog coefficient is not a physical absorption/scattering partition. Do not add deep color, crest tint,
caustics, and glints independently.

Sun glint belongs to the reflected specular BRDF. If the node material already
evaluates that BRDF under the sun light, a separate analytic glint double counts
energy. If an analytic sky/sun reflection replaces environment lighting, test
its integrated lobe and HDR range **[M]** before bloom.

Foam coverage `f` composites as

```text
L_final = (1-f) L_water + f L_foam,   0 <= f <= 1.               [D]
```

Its source must depend on impulse, compression, curvature, or another shared
surface cause. Texture noise may break uniformity but cannot create foam by
itself.

## Performance architecture and accounting

### Storage accounting

For square resolution `N`, channel count `C`, and bytes per channel `B`:

```text
textureBytes = N^2 C B.                                         [D]
```

Thus one `RGBA16F` texture uses `8 N^2` bytes **[D]** and one `RGBA32F`
texture uses `16 N^2` bytes **[D]**. Count both sides of every ping-pong,
derived fields, event buffers, caustic targets, scene color/depth, and transient
post targets. Report allocated and peak-live bytes separately **[M]**.

### Bandwidth and dispatch choices

On sustained mobile/tile GPUs, storage traffic and full-screen sampling often
dominate arithmetic. Apply changes in this order:

- remove unused persistent channels;
- fuse per-cell source gather and propagation when unique-write semantics hold;
- keep derivative/caustic passes separate when they require the new whole grid;
- lower simulation resolution from the spatial error gate, not viewport size;
- lower caustic update rate only with receiver-space reprojection evidence;
- lower refraction resolution with edge-aware reconstruction and depth
  rejection, not an unconditional blur;
- avoid MRT attachments that no downstream consumer reads.

Use authored tier candidates only as search points. The accepted tier is the
largest one satisfying all numerical, image, memory, and sustained frame gates.
Timestamp-query availability is checked with
`renderer.hasFeature('timestamp-query')`; timing without it requires an
explicitly documented measurement method.

## Validation matrix

### Numerical state

- CFL margin **[D,G]** and discrete dispersion sweep **[M]**.
- Analytic single-mode phase and amplitude error **[M]**.
- Mean-height/volume drift under zero-mean forcing **[M]**.
- Boundary reflection versus frequency and incidence angle **[M]**.
- Half- versus full-float state error and finite-value scan **[M]**.
- Overlapping-event race stress test.

### Geometry and queries

- Parametric tangents versus central differences **[M]**.
- Exact normal angular error **[M]**.
- Minimum and percentile horizontal Jacobian **[M]**.
- Fixed-point/Newton residual, iteration distribution, and failure count
  **[M]**.
- Declared live-grid residual contract present and machine-readable.

### Optics

- Fresnel approximation error and TIR classification **[M]**.
- Refraction candidate validity by rejection reason **[M]**.
- Refracted-ray cross-track residual and accepted path length **[M]**.
- Caustic source power, receiver power, regularization loss, and clamp loss
  **[M]**.
- Reflection, transmission, scattering, foam, and caustic diagnostic views.

### GPU and image

- Renderer/backend identity and selected texture formats.
- Allocation ledger, dispatch count, draw count, and pass inventory.
- Warm steady-state GPU phase timings and percentile frame time **[M]**.
- Sustained mobile thermal run with named device and conditions **[M]**.
- Fixed cameras at multiple times, including no-optics and no-post baselines.

Reject the implementation when a quantitative field lacks provenance, the
surface and normal use different causes, source writes race, the receiver
caustic does not conserve deposited power within its gate, or the final image
depends on double tone mapping/output conversion.
