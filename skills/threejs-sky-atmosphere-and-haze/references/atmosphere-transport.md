# Atmosphere Transport

Read this reference for LUT radiometry, parameterization, invalidation, imported
products, or convergence. Keep the authored local-sky branch in `SKILL.md`
unless it also needs these mechanisms.

## Contents

- Radiometric model
- Unit fixture
- Three.js products
- Dependencies and update order
- Spherical LUT mappings
- Aerial payload
- Imported products
- Workload evidence
- Convergence

## Radiometric model

For spectral or working band `lambda`, species `j`, and metric path
coordinate `s`:

```text
sigma_t(lambda, x) = sum_j beta_t,j(lambda) * rho_j(x)   [length^-1]
sigma_s(lambda, x) = sum_j beta_s,j(lambda) * rho_j(x)   [length^-1]
tau(lambda, a->b)  = integral_a^b sigma_t ds            [dimensionless]
T(lambda, a->b)    = exp(-tau)                          [dimensionless]
dL/ds              = -sigma_t L + sigma_s * source      [radiance/length]
```

Require componentwise `0 <= beta_s <= beta_t`. Absorption contributes to
extinction, and a Lambertian ground returns `albedo/pi` times incident
irradiance. Higher-order scattering must balance absorbed and escaped energy;
`1-T` by itself is not radiance.

Normalize phase functions over solid angle:

```text
P_R(mu)  = 3 * (1 + mu^2) / (16*pi)
P_HG(mu) = (1-g^2) / (4*pi*(1 + g^2 - 2*g*mu)^(3/2))
2*pi*integral_-1^1 P(mu)dmu = 1
```

Let `omega` point from camera to sample and `sSun` from sample to sun, so
`mu=dot(omega,sSun)`; positive `g` then peaks toward the sun. Keep
`|g| < 1`. Near the lobe, evaluate the HG denominator as:

```text
b = (1-g)^2 + 2*g*(1-mu)       for g >= 0
b = (1+g)^2 - 2*g*(1+mu)       for g < 0
P_HG = (1-g^2) / (4*pi*b^(3/2))
```

Declare the accepted `g_max` and integrate the phase numerically at
`-g_max`, zero, and `+g_max`. A finite-resolution starting gate of
`g_max=0.99` is reasonable only when its peak-direction and normalization
tests pass.

Declare solar input as normal irradiance or finite-disc radiance. For a uniform
disc of angular radius `alpha`:

```text
L_sun = E_normal / (pi * sin(alpha)^2)
```

Apply that conversion once. Keep authored relative brightness outside physical
radiance/irradiance interfaces. Treat transport bands as a declared spectral or
linear working basis; convert to scene-linear RGB once and apply no display
transfer to LUT data.

## Unit fixture

Use one homogeneous path to prove the model boundary:

```text
beta = 0.01 km^-1, ds = 1 km
beta = 0.00001 m^-1, ds = 1000 m
expected tau = 0.01
expected T = exp(-0.01)
```

Run the same fixture through CPU reference math and the GPU path. Accept only
when both unit declarations produce the same optical depth and the CPU/GPU
difference fits the chosen numeric tolerance.

## Three.js products

For Three.js r185:

- use `StorageTexture` plus `textureStore()` for writable 2D products;
- use `Storage3DTexture` plus `storageTexture3D()` for writable volumes;
- set format, type, `NoColorSpace`, filtering, wrapping, and mip generation
  explicitly;
- build compute work with `Fn().compute(count)` and submit after
  `await renderer.init()`;
- treat queue ordering as sufficient for later GPU consumers and use an
  explicit completion/readback mechanism for CPU access, resource reuse, and
  retirement;
- feed one `RenderPipeline`; reuse its color/depth rather than rendering the
  scene again.

A compact real-time branch admits only products consumed by its selected
workload, directly or as dependencies:

| Product | Meaning | Dependencies |
| --- | --- | --- |
| Transmittance | RGB optical depth/transmittance to the atmosphere boundary | body geometry, density/extinction profiles, length unit, map and quadrature revisions |
| Multiscatter | higher-order response or closure | transmittance, scattering/extinction, phase closure, ground model, solver revision |
| Irradiance | normal-dependent diffuse sky lighting | transmittance/multiscatter, ground model, angular parameterization |
| Sky-view | sky radiance around a camera anchor | base products, body-relative anchor, local sun zenith, ground model |
| Aerial inscattering | cumulative RGB `S(0->d)` | base products, camera body pose, sun frame, unjittered projection, depth map, viewport |
| Aerial optical depth | cumulative RGB `tau(0->d)` | the same view-ray/profile/depth geometry as inscattering |

For a Bruneton-style higher-order branch, keep scattering orders explicit:

    transmittance
      -> direct irradiance and single scattering
      -> for each order n >= 2:
           scattering density from prior orders
           indirect irradiance
           order-n multiple scattering
      -> accumulated radiance products

Stop when the next order's radiance and energy contribution fit the convergence
gate. Preserve the spectral basis, phase convention, ground term, and order
ownership through every product; combining a compact closure with explicit
orders needs evidence that it does not count the same transport twice.

Factor solar magnitude out of a product when transport is linear in that
magnitude. Factor sun direction out only when it is an explicit LUT coordinate.

## Dependencies and update order

Update in this order:

1. Validate the admitted product set, units, coefficient inequalities, body
   radii/axes, density support, formats, and dependency keys.
2. Generate transmittance only when an admitted path requires it.
3. Generate admitted multiscatter, then admitted irradiance, from their
   committed dependencies.
4. Generate sky-view only for an admitted visible-sky consumer.
5. Generate or reproject aerial inscattering and optical depth together only
   for an admitted depth-aware composition consumer.
6. Publish the complete admitted product set, then compose the scene.

Publish a product generation only when every dependency revision matches.
Camera yaw/roll, temporal jitter, and a pure floating-origin translation do not
change a body-frame transmittance or multiscatter product. Camera body-relative
pose, projection, viewport, and depth distribution do change aerial products.
Keep fresh inscattering paired with fresh optical depth; fill disoccluded
froxels from current integration.

## Spherical LUT mappings

Define the forward map, inverse map, valid-domain mask, and texel-center
convention. For a spherical shell with bottom radius `Rg`, top radius `Rt`,
point radius `r`, and ray zenith cosine `mu`, a top-boundary transmittance
map is:

```text
H    = sqrt(Rt^2 - Rg^2)
rho  = sqrt(max(r^2 - Rg^2, 0))
d    = -r*mu + sqrt(r^2*(mu^2 - 1) + Rt^2)
dMin = Rt - r
dMax = rho + H
xR   = rho / H
xMu  = (d - dMin) / (dMax - dMin)
```

Guard a true negative discriminant as a miss before the square root. The inverse
is:

```text
rho = H*xR
r   = sqrt(rho^2 + Rg^2)
d   = mix(Rt-r, rho+H, xMu)
mu  = (Rt^2 - r^2 - d^2) / (2*r*d)   # define mu=1 at d=0
```

When a stored endpoint coordinate is `x=i/(N-1)`, sample its texel center at
`u=(x*(N-1)+0.5)/N`. Route ground-intersecting rays through an explicit
ground branch.

For a sky-view map at camera radius `rc`:

```text
mu_h    = -sqrt(max(1-(Rg/rc)^2, 0))
qSky    = (mu-mu_h)/(1-mu_h)
qGround = (mu_h-mu)/(1+mu_h)
y = 0.5 + 0.5*sqrt(qSky)       when mu >= mu_h
y = 0.5 - 0.5*sqrt(qGround)    otherwise
x = fract(phiSunRelative/(2*pi) + 0.5)
```

Make `x` periodic across azimuth zero and `2*pi`; clamp wrapping alone
cannot interpolate that seam. Use a deterministic tangent basis at zenith and
verify azimuth invariance there. For an exterior camera, enter at the top-shell
intersection rather than clamping its altitude into the LUT.

## Aerial payload

Reconstruct each froxel ray from the same unjittered projection used by its
depth map. A zero-origin exponential depth distribution may use:

```text
d(z) = dMax * (exp(k*z)-1)/(exp(k)-1), z in [0,1]
```

Store cumulative RGB inscattering and RGB optical depth in separate products,
or validate endpoint reconstruction:

```text
choose w so p and q reach the same top boundary without crossing the body
tauSegment = abs(tauToTop(p,w) - tauToTop(q,w))
T_segment  = exp(-tauSegment)
C_out      = C_scene * T_segment + S_segment
```

Use the clipped visible interval when the endpoints cannot share a clear top
boundary. A scalar opacity payload is a reduced chromatic model and needs an
explicit RGB transmittance error gate.

## Imported products

Accept an imported LUT only when its manifest and live model agree on:

- dimensions, format, channels, byte order, hashes, filters, wrapping, mips,
  and color space;
- body geometry, density layers, scattering/extinction coefficients, and
  integration unit;
- solar quantity, angular radius, phase normalization/sign, spectral basis,
  mapping revision, and source algorithm;
- reference error for optical depth, radiance, energy, and half-float
  quantization.

A matching file hash proves identity, not compatibility or transport accuracy.

## Workload evidence

Derive resource and integration work from the admitted products:

    payloadBytes =
      sum(width*height*depth*bytesPerTexel*residentCopies)
    invocations = width*height*depth
    integratorSamples = sum(updatedTexels*samplesPerTexel)

Count unique kernels rather than output textures when one dispatch writes
several products. Record product dimensions/formats, dispatches, update cadence,
peak live generations, full-frame and paired atmosphere cost, resize behavior,
and retirement completion on the named renderer/device. Use those measurements
to choose workload; product dimensions alone are neither timing nor quality.

## Convergence

Compare each admitted product against a float64 CPU, higher-step GPU, or offline
reference at stratified altitude, horizon, shell tangent, ground tangent, night
terminator, and optically thick paths. Gate:

- optical-depth error per band;
- HDR radiance p95 and maximum error using a nonzero reference floor;
- finite/nonnegative radiance and transmittance near `[0,1]` before physical
  clamping;
- phase normalization and forward-lobe direction;
- escaped plus absorbed energy against incident energy and quadrature residual;
- map round trips, horizon continuity, azimuth seam, and half-float error.

Treat thresholds as workload requirements, not physical constants. Admit each
resolution, sample count, format, and approximation on its own evidence.
