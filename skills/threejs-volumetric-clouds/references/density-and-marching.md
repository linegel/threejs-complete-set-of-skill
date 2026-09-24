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

Require finite ordered layer heights, nonnegative optical/density parameters,
and admitted field ranges. A remap whose lower and upper edges coincide needs
an explicit threshold/tie branch, not division by zero. Evaluate the empty
support branch before remapping. Detail remains nonnegative erosion unless its
possible increase is separately included in every continuous majorant.

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

For a translating pattern use `rho(x,t)=rho0(x-macroOffset(t))`; the opposite
coordinate sign reverses the apparent velocity. Preserve the integrated offset
when velocity changes. A single offset represents a uniform macro translation;
spatially varying flow requires an advected coordinate map/trajectories or an
explicit bounded anchor approximation, not one global integral for every point.
Use the same macro cause for weather, shape, detail, and turbulence; relative offsets model
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
and density-increasing remaps. First establish a finest-cell continuous bound:
max reduction of isolated samples does not bound an unsampled procedural peak.
Use interval/analytic or derivative bounds, or maxima of the complete support
of an admitted non-overshooting interpolant. Include filtered/warped support and
quantization error, then max-reduce those already-conservative child bounds.

Skipping a cell is exact when its matching-generation bound proves zero
extinction and zero independent source over the entire swept interval. A zero
density bound alone is insufficient for a separate emitting field. For an
error-bounded nonzero skip:

```text
DeltaTauMax = beta_t * rho_max * DeltaS
DeltaImageMax <= T_acc * (S_eq_max + L_behind_max) * (1-exp(-DeltaTauMax))
```

`S_eq_max` bounds the cell's `j/sigma_t`; `L_behind_max` bounds all incoming
radiance behind it, including bright scene surfaces, sun/discs, and later cloud
contribution. Skipping changes both emission and attenuation. When the source
ratio is unavailable, replace its term by `T_acc*j_max*DeltaS` but retain the
background-attenuation bound, or sample the cell. Admit per-band nonnegative
bounds and accumulate the error budget over all skips and the terminal tail;
a per-cell gate repeated many times is not a ray-level error guarantee. Missing
background/source bounds forbid the claimed radiance-bounded skip.

Traverse sparse cells with DDA to the cell exit. Handle parallel axes with an
explicit inside/outside slab test and infinite next crossing; avoid 0/0 on cell
faces. Define half-open boundary ownership, advance tied axes consistently, and
prove forward progress without stepping over an unvisited cell. Clamp the last
step to the admitted interval and use a separate finite work-limit failure.
Refine the first occupied entry at the cell boundary or with bounded search so a long empty step does not
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
6. Evaluate lighting where extinction or an admitted independent source contributes.
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
tauStep = sigma_t*ds
phi = -expm1(-tauStep)/tauStep   when tauStep > 0
phi = 1                        when tauStep = 0
stepL = j*ds*phi
L_acc += T_acc*stepL
T_acc *= stepT
```

Choose the small-argument limit from dimensionless optical depth `sigma_t*ds`,
not the coefficient alone: a tiny coefficient over a huge step can be opaque.
Use a validated series for `phi` near zero; for large optical depth, the finite
ratio `j/sigma_t` form avoids overflowing `j*ds`. Admit all products and step
lengths before use. Jitter quadrature points inside a complete partition; do not
move the first interval boundary and silently drop its front segment.

Terminate only when the entire remaining image error fits the residual budget:
include remaining source, attenuation of `L_behind_max`, optical-depth error,
and all already spent skip error. A bright background defeats a transmittance-
only or source-only threshold. Otherwise continue, change representation, or
report failure of the quality/work budget.

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
Completion requires the production path to meet every declared error and work
gate. An acceleration claim additionally demonstrates lower complete-branch
cost than its matching unaccelerated reference at equal quality.
