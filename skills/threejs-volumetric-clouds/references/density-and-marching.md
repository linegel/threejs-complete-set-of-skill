# Cloud Density and Marching

Read this reference when selecting a density topology, volume domain, adaptive
march, or empty-space accelerator.

## Contents

- Representation selection
- Layered density
- Advection and filtering
- Bounded ray intervals
- Conservative skipping
- March policy
- Workload evidence
- Verification

## Representation selection

Choose complete architectures rather than isolated optimizations:

| Evidence | Representation |
| --- | --- |
| Small screen bound and low temporal reuse | full-resolution scissored current march |
| Broad coherent coverage | reduced current march plus cloud-specific reconstruction |
| Mostly occupied volume | bounded adaptive march without a 3D hierarchy |
| Sparse, slowly evolving volume | max-density macrocells plus DDA |
| Only vertical gaps are empty | CPU-merged occupied bands and complementary gaps |
| Multiple independently moving layers | separate density evaluation and temporal histories per layer/depth cluster |

Compare the complete current, temporal, upsample, and shadow costs for each
candidate. A lower primary resolution can lose when history bandwidth and
rejection dominate; a hierarchy can lose when occupancy or divergence is high.

## Layered density

Keep each layer independent through:

- domain and compact altitude/profile support;
- weather channel, coverage response, and broad shape;
- optical coefficients and phase;
- macro and relative motion;
- shadow participation.

Combine layers only after these terms are known. Let weather and base shape
cause the mass:

```text
h = remapClamped(altitude, layerBottom, layerTop)
support = compactProfile(h)                  # zero at both boundaries
weatherMass = coverageRemap(weatherField, coverage)
baseMass = support * weatherMass
rhoBase = remapClamped(baseMass, (1-shapeNoise)*shapeAmount, 1)
```

Let detail erode occupied mass at resolvable scales:

```text
erosion = detailAmount * detailEnvelope(h) * filteredDetail
rho = max(rhoBase - erosion * boundarySensitivity(rhoBase), 0)
```

Use an equivalent bounded remap when it better preserves cloud morphology, but
retain the causal order: weather/profile establishes support, shape forms broad
mass, detail removes or reshapes its boundary. Include every operation that can
increase density in the majorant. A detail operation that creates density
outside the weather/base support invalidates that bound.

Global coverage remaps the weather distribution rather than multiplying final
density. Calibrate the remap from the actual field range or CDF. Treat
thresholds, octave weights, and profile curves as authored controls whose
accepted range is visible in a density diagnostic.

For layers with shared coefficients:

```text
totalDensity = sum(rho_i)
sigma_s = totalDensity * beta_s
sigma_a = totalDensity * beta_a
```

For different droplet/ice properties, form each layer's `sigma_s`,
`sigma_a`, phase, and source before summing. Weight an aggregate phase by
scattering coefficient, not raw density.

## Advection and filtering

Integrate the latched macro velocity over simulation time:

```text
macroOffset(t1) = macroOffset(t0) + integral_t0^t1 u_air(x,t) dt
fieldOffset = macroOffset + boundedRelativeOffset
```

Preserve the integrated offset when the velocity input changes. Use the same
macro cause for weather, shape, detail, and turbulence; relative offsets model
limited internal evolution. Wrap texture coordinates by a continuous period or
rebase them without changing the sampled position.

Map positions through explicit metre-to-field transforms. A turbulence field
warps coordinates inside a bounded height envelope. Expand the majorant by its
maximum displacement.

Filter octaves against the ray/sample footprint. In compute TSL, ordinary
`texture(volume, uvw)` has no fragment derivatives and samples level zero;
select a level explicitly when filtered mips exist. Keep appearance-filtered
mips separate from max-reduction occupancy mips.

## Bounded ray intervals

Transform the ray into a numerically stable local frame and return sorted
occupied intervals in the declared length unit:

| Domain | Intersection | Profile coordinate |
| --- | --- | --- |
| Spherical shell | inner/outer ray-sphere roots around a camera-relative center | radial altitude |
| Planar slab | two planes plus optional horizontal bound | signed slab height |
| AABB/OBB | slab roots in local volume space | local height/texture coordinate |
| Conservative SDF/convex proxy | enclosing bound plus bounded root refinement | declared local field coordinate |
| Sparse bricks | brick bounds/indirection grid | brick-local coordinate |

Clamp every interval to the nearest opaque scene distance. Decode that distance
from the active projection/depth convention; raw perspective depth is not a
metric ray length. Report the bound type, near/far distance, opaque clamp, and
camera region in diagnostics.

For vertical layers:

1. Sort lower/upper endpoints.
2. Merge overlapping occupied bands.
3. Form their complementary empty gaps.
4. Upload occupied bounds and skip gaps.
5. Verify gap and occupied-band diagnostics against the active layer set.

Packed gaps accelerate altitude only; they say nothing about horizontal holes.

## Conservative skipping

Build each macrocell upper bound from every term that can increase density:
weather, compact profile, base shape, warp reach, relative advection uncertainty,
and density-increasing remaps. Generate it with max reduction.

Skipping a cell of length `Delta s` is exact when `rho_max=0`. For an
error-bounded nonzero skip:

```text
DeltaTauMax = beta_t * rho_max * DeltaS
DeltaLMax <= T_acc * S_eq_max * (1-exp(-DeltaTauMax))
```

`S_eq_max` bounds `j/sigma_t`. When that bound is unavailable, use
`DeltaLMax <= T_acc*j_max*DeltaS`, or sample the cell. Admit the skip only
when both omitted optical depth and HDR radiance fit their gates.

Traverse sparse cells with DDA to the cell exit. Refine the first occupied
entry at the cell boundary or with bounded search so a long empty step does not
shift the visible silhouette. Rebuild or dilate affected cells after advection,
warp, or topology changes; sample directly while the matching majorant
generation is unavailable.

Use the measured break-even condition:

```text
C_build/reuseFrames + C_traverse + p_occupied*N*C_fine
  < N*C_fine
```

Include hierarchy bandwidth and divergence in `C_traverse`.

## March policy

At each ray:

1. Intersect the cloud domain and opaque-depth clamp.
2. Offset the first sample with the deterministic temporal pattern.
3. Skip proven empty gaps/cells.
4. Sample the weather/base majorant.
5. Evaluate shape, turbulence, and detail only where admitted.
6. Evaluate lighting where extinction can contribute.
7. Integrate front-to-back and terminate on a bound for remaining HDR
   contribution.

Choose the step upper bound from all active causes:

```text
dsTau = tauStepMax / max(sigmaTMajorant, epsilon)
dsSignal <= nyquistFactor / max(resolvedSpatialFrequency, epsilon)
ds = min(dsTau, dsSignal, distanceToCellExit, distanceToLayerBoundary,
         rayFar-s, authoredMaxStep)
```

An authored minimum step cannot exceed this error-limited upper bound. When the
budget cannot afford the required step, filter more field bandwidth, change the
representation, or fail the error gate.

Use analytic piecewise-constant transfer:

```text
stepT = exp(-sigma_t*ds)
stepL = (j/sigma_t)*(1-stepT)
L_acc += T_acc*stepL
T_acc *= stepT
```

Use `stepL=j*ds` near zero extinction. Terminate when a maximum possible
remaining source contribution, not transmittance alone, fits the HDR error
budget.

## Workload evidence

Derive current work and storage from the selected representation:

    currentPixels = ceil(width*scale)*ceil(height*scale)
    primarySamples = sum(samples over occupied current pixels)
    lightSamples = sum(light evaluations over occupied primary samples)
    payloadBytes =
      sum(width*height*depth*bytesPerTexel*residentCopies)

Record complete-branch dispatches/passes, field and hierarchy reads, history
and upsample traffic, peak live generations, full-frame cost, and paired
cloud-on/off cost on the named renderer/device. Compare dense and sparse
representations at equal image gates; allocation size alone omits bandwidth,
divergence, and rejection cost.

## Verification

Compare the chosen path with a smaller-step, unskipped reference across fixed
seeds and camera intervals. Record:

- transmittance and linear-HDR radiance error;
- first-contribution depth and silhouette displacement;
- occupied fraction, hierarchy lookups, skipped distance, and error bounds;
- field octave/sample counts and aliasing under motion;
- interval/depth-clamp diagnostics;
- advection continuity across update cadence and velocity changes.

Negative controls must make an averaged occupancy mip, stale majorant,
occupied-gap swap, missing warp dilation, and raw-depth clamp visibly fail.
Completion requires the production path to stay within every declared error
gate while its measured work is lower than the rejected representation.
