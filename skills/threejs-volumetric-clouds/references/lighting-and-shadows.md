# Cloud Lighting and Shadows

Read this reference for cloud source terms, phase fitting, atmosphere-derived
lighting, direct-sun self-shadowing, receiver shadow products, or shadow
filtering.

## Contents

- Optical transfer
- Atmosphere handoff
- Direct and sky source
- Multiple-scattering approximations
- Shadow representations
- Filtering and cadence
- Verification

## Optical transfer

For dimensionless shape density and inverse-length coefficients:

```text
sigma_s = rho*beta_s
sigma_a = rho*beta_a
sigma_t = sigma_s+sigma_a
tau(a,b) = integral_a^b sigma_t ds
T(a,b) = exp(-tau)
```

For a piecewise-constant step:

```text
T_step = exp(-sigma_t*ds)
L_step = (j/sigma_t)*(1-T_step)
L_acc += T_acc*L_step
T_acc *= T_step
```

`j` is source radiance per length. Use `L_step=j*ds` as
`sigma_t -> 0`. Step-partition invariance of a homogeneous slab is the first
gate; brightness that changes with step count exposes mixed source units.

Normalize a phase function over `4*pi`. For Henyey-Greenstein:

```text
p_HG(mu,g) = (1-g^2)/(4*pi*(1+g^2-2*g*mu)^(3/2))
2*pi*integral_-1^1 p_HG(mu,g)dmu = 1
```

Keep `g` strictly inside `(-1,1)`. For a dual lobe, use nonnegative weights
whose sum is one and verify the combined integral. With camera-to-sample
`rayDirection` and sample-to-sun `toSun`,
`mu=dot(toSun,rayDirection)` makes `mu=1` the forward lobe.

## Atmosphere handoff

Consume lighting with:

- sample time and age;
- frame/origin and sample-to-sun direction;
- quantity and unit: directional radiance or normal/hemispherical irradiance;
- spectral or scene-linear basis and conversion error;
- spatial/angular support and filter;
- included attenuation and direct-disc ownership.

Choose one direct-sun form:

```text
A. source outside atmosphere * T_atmosphere(sample->sun)
B. direct source already evaluated at the sample
```

Apply atmosphere attenuation once. Then apply cloud-only transmittance and
opaque visibility as independent factors:

```text
directAtReceiver =
  directAfterAtmosphere * T_cloudOnly * V_opaque
```

Keep water-path extinction separate. Use directional sky radiance for scattering
integrals and normal-dependent sky irradiance for diffuse receiver lighting.
Honor whether either includes the direct solar disc.

## Direct and sky source

For a finite solar disc:

```text
j_direct =
  sigma_s * T_cloudToSun
  * integral_sunDisc p(wi->wo)*L_sun(wi)dOmega
```

For a declared collimated-irradiance convention:

```text
j_direct = sigma_s*p(mu)*E_sun*T_cloudToSun
```

Derive the irradiance convention once and validate it with a homogeneous slab.
Radiance and irradiance differ by angular integration; unit labels do not make
them interchangeable.

For sky illumination:

```text
j_sky = sigma_s * integral_hemisphere p(wi->wo)*L_sky(wi)dOmega
```

Use angular quadrature, a fitted low-order basis, or another approximation with
an explicit radiance error. The visible cloud result remains linear HDR:

```text
j = j_direct + j_sky + j_multiple
C_out = L_cloud + T_cloud*C_scene
```

## Multiple-scattering approximations

Treat powder, silver-lining boosts, simple ground bounce, and octave
multiple-scattering compensation as authored/empirical until a reference solve
admits them. A dimensionally consistent octave form is:

```text
weight = 1
for each octave:
  contribution += weight * sourceScale
                  * exp(-opticalDepth*attenuation)
                  * phase(cosTheta, phaseParameter)
  weight *= weightDecay
```

Constrain the aggregate phase/source boost, retain the extinction/scattering
units, and compare homogeneous slabs plus forward-lobe views with a reference.
Reduce the approximation when current light work dominates; temporal history
does not amortize source evaluations inside the current march.

## Shadow representations

Cloud shadows store cloud optical depth or cloud transmittance. Keep atmosphere,
opaque visibility, exposure, and tone mapping outside the product.

For an opaque receiver behind the complete cloud column:

```text
tauColumn = min(integral sigma_t ds, tauMax)
T_cloud = exp(-tauColumn)
tauMax = -log(T_min)
```

A single-channel R16F/R32F sun-space product is sufficient when its range and
quantization fit the gate.

For an in-cloud receiver, total column depth lacks the receiver position.
Choose:

| Need | Representation |
| --- | --- |
| Local/low-cost query | short sun march from the sample |
| Moderate depth complexity | piecewise front/depth/extinction encoding with a tested decoder |
| Broad/high depth complexity | deep-opacity slices or a light-space transmittance volume |

Generate a shadow product by:

1. Intersecting the sun ray with the same cloud intervals and conservative
   hierarchy as the beauty path.
2. Marching or DDA-skipping toward the sun.
3. Accumulating dimensionless optical depth to `tauMax`.
4. Publishing the product only after its matching density generation completes.

For beauty samples near the receiver, combine a short local sun march with a
far shadow representation only when their intervals meet without overlap or a
gap.

## Filtering and cadence

Declare whether a shadow sample represents:

- point optical depth;
- point transmittance; or
- footprint-average transmittance.

In general:

```text
E[exp(-tau)] != exp(-E[tau])
```

Therefore, an irradiance footprint filters transmittance or sufficient
optical-depth statistics. Bilinear optical depth defines an interpolated point
model; it does not become a footprint average by naming.

Choose update cadence from motion, sun change, receiver footprint, and a bound
on transmittance change. Track density generation, light transform, footprint,
age, and error per tile/cascade. Refresh dirty tiles or lower confidence when
advection or topology outruns the age gate. Use the same conservative density
bound as the beauty pass and count hierarchy traffic in the shadow cost.

Select:

| Evidence | Shadow architecture |
| --- | --- |
| Local bounded cloud | one fitted light-space map or direct sun march |
| Broad coherent cloud | low-rate sun-aligned optical-depth cascades |
| Sparse cloud | light-space DDA with conservative bounds |
| Rapidly changing topology | tile invalidation/partial refresh with a strict age gate |
| In-cloud depth complexity | deep representation or direct local query |

## Verification

Gate:

- homogeneous-slab radiance and zero-extinction behavior;
- phase normalization and forward/back sign;
- finite-disc versus irradiance source consistency;
- atmosphere/cloud/opaque factor trace with each term once;
- ground-column shadow against direct integration;
- in-cloud queries at front, middle, and back of the same column;
- filtered transmittance against supersampled footprint integration;
- moving-density and moving-sun shadow error at the admitted cadence;
- step-halved/high-light-sample linear-HDR radiance and halo error;
- shadow format range, quantization, completion, and retirement.

Completion requires each enabled receiver query to identify its represented
interval, density generation, filter, age, and error, and to fit the declared
transmittance tolerance.
