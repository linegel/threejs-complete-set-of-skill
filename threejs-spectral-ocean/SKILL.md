---
name: threejs-spectral-ocean
description: Build broad-band offshore procedural oceans in Three.js r185 WebGPU/TSL using dimensioned directional spectra, compute FFT cascades, StorageTexture ping-pongs, exact spectral derivatives, displaced-surface Jacobians, transported foam, water optics, CPU query bounds, falsifiable GPU evidence, and phase-resolved or phase-averaged handoff to a separate bathymetry-aware coastal owner.
---

# Spectral Ocean

Use this skill when a large, unbounded-looking water surface must span several
wavelength scales with directional wind sea or swell. The canonical state is a
sampled random field in wavevector space, evolved by dispersion and transformed
on the GPU. It assumes a horizontally homogeneous, periodic patch with one
dispersion relation per cascade. It is not a coastline, bathymetry, inundation,
or obstacle-flow solver. Use `$threejs-water-optics` for bounded interaction
grids, coastal coupling, or a small authored wave set.

Read
[references/spectral-cascade-ocean-system.md](references/spectral-cascade-ocean-system.md)
before implementation or review. For any island, coast, shoal, reef, harbor, or
moving waterline, also read the
[coastal archipelago contract](../threejs-water-optics/references/coastal-archipelago-system.md).

## Numeric Provenance

Every quantitative statement uses one tag:

- **[D] Derived** from equations, dimensions, formats, or reproducible counts;
- **[G] Gated** as a predeclared pass/fail limit;
- **[M] Measured** on a named device, viewport, and workload;
- **[A] Authored** as a visual/application input.

Unlabelled integers inside exact equations, tensor dimensions, byte identities,
and API names are [D]. Resolutions, patch lengths, sea-state constants,
thresholds, format choices, timings, and memory limits must be tagged.

## Algorithm Gate

Choose FFT cascades only when the visible band contains enough independent
modes that direct summation is more expensive or visibly repetitive. The
decision variables are visible wavelength interval, directional statistics,
periodic-repeat distance, tolerated phase/slope error, interaction needs, and
sustained storage bandwidth.

| Requirement | Algorithm | Boundary |
| --- | --- | --- |
| Few art-directed modes or exact cheap CPU queries | Parametric waves in `$threejs-water-optics` | Cost grows with component count. |
| Bounded disturbances | Compute heightfield in `$threejs-water-optics` | CFL and domain-boundary error. |
| Broad stochastic directional sea | Multi-cascade FFT | Periodic patches, spectral quadrature, FFT precision. |
| Spatially varying depth; phase-resolved shoaling/refraction matters | Coastal dispersive or phase-resolving solver selected by `$threejs-water-optics` | Local depth, boundary, and breaking-model error; FFT is only the offshore forcing. |
| Wet/dry fronts, run-up, bores, or hydraulic jumps matter | Positivity-preserving depth-averaged coastal solver selected by `$threejs-water-optics` | Conservation, wet/dry, and numerical-dissipation error; a heightfield or FFT is invalid. |
| Shoreline motion is sub-pixel and only wave statistics matter | Phase-averaged wave-action transport plus analytic display bands | No instantaneous phase contract; validate action/energy and image error. |

Do not disguise scrolling normals or a wave pile as a low FFT tier.

### Offshore/coastal handoff

A spatially varying bottom destroys the global Fourier diagonalization used by
the FFT. The spectral patch cannot, without a different solver, produce
bathymetric refraction, shoaling, depth-induced breaking, diffraction around
islands, reflection from cliffs, porous-reef loss, wave setup, run-up, or
wetting/drying. Do not fade an unchanged deep-water FFT through the beach and
label the result coastal simulation.

Choose exactly one handoff semantics:

- **Phase-resolved.** At an offshore coupling curve, evaluate the same seeded
  spectral coefficients into surface elevation `eta_b` in metres and
  depth-integrated wave-discharge perturbation `q'_b` in square metres per
  second **[D]**; mean-current discharge remains a separate signal.
  For a matching finite-depth Airy mode,
  `q'_hat=(omega_int/|k|^2) k eta_hat` **[D]**, from linearized continuity
  `-i omega_int eta_hat+i k dot q'_hat=0` **[D]**. With uniform current,
  `omega_abs=omega_int+k dot U` **[D]**: intrinsic frequency owns orbital
  flux; absolute frequency owns the shared phase clock. The coastal boundary
  injects only the incoming characteristic and retains the outgoing one. Record
  phase, elevation, discharge, and reflected-wave residuals **[M]**.
- **Phase-averaged.** Convert height-variance density `P_eta(k)` to physical
  wavevector energy density
  `E(k)=[rho g+sigma_surface |k|^2]P_eta(k)`, where
  `sigma_surface` is surface tension, and
  transport wave action `N=E/omega_int` when currents vary **[D]**. Transfer
  `N`, intrinsic frequency, group velocity, mean current, and dimensioned band
  quadrature. The near-shore model owns refraction, shoaling, breaking loss,
  and local phase synthesis. It makes no instantaneous phase-parity claim.
  Record incoming, dissipated, reflected, and transmitted band energy/action
  in one unit convention **[M]**.

A one-way FFT donor cannot display coastal reflection that propagates back
through the coupling curve. If that outgoing field is observable, extend the
phase-resolving domain or implement an explicit two-way modal projection with
phase, energy, localization, and periodic-copy residuals **[G,M]**. An
absorbing layer is valid only when the rejected reflection is below its gate.

Both modes use one world frame, water datum, bathymetry convention, seed or
band identity, and monotonic timebase. A current `U` changes absolute frequency
by `k dot U` **[D]**; if `U` varies materially within a periodic patch, route
that region out of the FFT instead of freezing an inconsistent dispersion.

Partition ownership in every transition band. Only disjoint Fourier bins or
fields proven to have zero cross-covariance may use power windows that sum to
one **[D,G]** and square-root amplitude weights. Coherent offshore/coastal
copies have a covariance cross-term: a phase-resolved wave crosses the coupling
curve at full amplitude and has one spatial render owner. If a render-only
spatial blend is unavoidable, its coherent amplitude weights sum to one and
displacement, tangents, normals, and velocity come from the same phase-matched
composite field, including blend-weight gradients. Independently lerping final
normals or adding both foam histories violates parity.

Foam crosses the handoff as one declared coverage/source transport contract:
coverage, carrier velocity, source rate, decay state, coordinate space, and
timestamp. Attribute whitecap and depth-breaking dissipation to exactly one
owner, combine the disjoint dissipation terms, then map them once into one foam
source/history. Never partition or saturated-add evolved coverage histories.
Conservative remap or measured coverage loss is required when atlas or solver
coordinates change.

## Pinned Three.js r185 Architecture

The API contract is verified against installed `three@0.185.1` **[G]**:

- `WebGPURenderer`, `RenderPipeline`, `StorageTexture`, and node materials come
  from `three/webgpu`; TSL comes from `three/tsl`.
- Initialize before checking `renderer.backend.isWebGPUBackend`, device limits,
  or `renderer.hasFeature()`.
- Build compute with `Fn(...).compute(...)`. After initialization,
  `renderer.compute(nodeOrArray)` records ordered dispatches.
  `computeAsync()` is initialization-safe but is not a GPU-completion fence.
- `StorageTexture` simulation data uses `NoColorSpace`, no generated mipmaps,
  and explicit `HalfFloatType` or `FloatType` selected by validation.
- Gate each kernel against the initialized device's
  `maxStorageTexturesPerShaderStage` and compiled binding layout. The reference
  fused physical assembly requires seven storage-texture bindings; use its
  ordered split path with at most three per dispatch on portable four-binding
  targets. Never allocate or compile the fused path before this gate.
- Use `pass()`, optional `mrt()`, and one `RenderPipeline`; use
  `PassNode.setResolutionScale()`. Use exactly one output transform.

```js
const renderer = new WebGPURenderer( { antialias: false } );
await renderer.init();

if ( renderer.backend.isWebGPUBackend !== true ) {
  throw new Error( 'WebGPU is required for the spectral ocean.' );
}

renderer.compute( orderedOceanNodes );
pipeline.render();
```

## Non-Negotiable Numerical Contract

### Spectrum dimensions and cascades

Start from a directional angular-frequency variance density
`S_omega(omega,theta)` with units `m^2 s` **[D]**, normalized directional
distribution, and finite-depth capillary-gravity dispersion. Convert it to the
two-dimensional wavevector density

```text
P(k_x,k_z) = S_omega(omega(k),theta)
             |d omega/d k| / k,        [P] = m^4.              [D]
```

Discrete coefficient variance includes `Delta k_x Delta k_z` **[D]**. A
missing Jacobian, cell area, or Gaussian normalization invalidates sea-state
amplitude.

Cascade power windows must satisfy `sum_i w_i(k)=1` over the represented band
**[D,G]**. Hard half-open bands are valid; smooth overlap uses amplitude
`sqrt(w_i)` so expected power is not doubled. Each cascade declares patch
length, grid spacing in `k`, isotropic upper cutoff, and repeat distance.

### Transform convention

Write the transform pair in code and tests. This skill uses the unnormalized
inverse convention

```text
f[j] = sum_n F[n] exp(+i 2 pi n dot j / N).                     [D]
```

With this convention a unit DC coefficient produces a unit constant field.
Any normalized IFFT must rescale initial coefficients consistently. Never tune
spectrum amplitude around an undocumented FFT scale.

Pack the eight real fields required for height, horizontal displacement,
slopes, and horizontal derivatives into four complex transforms, preferably as
two complex lanes in each of two RGBA textures **[D]**. Validate the algebra
`G=A+iB`, not component interleaving.

### Hermitian and Nyquist rules

The evolved height spectrum must satisfy
`H(-k)=conjugate(H(k))` **[D]**. DC and self-conjugate Nyquist cells are real.
Derivative multipliers receive parity-specific masks:

- fields odd in `k_x` are zero on the `k_x` Nyquist line;
- fields odd in `k_z` are zero on the `k_z` Nyquist line;
- the mixed derivative is zero on either Nyquist line;
- even second derivatives need no blanket Nyquist removal, but the final
  spectrum must still pass Hermitian projection and imaginary-leakage gates.

Zero `k=0` before every division by `|k|`. Do not multiply a singular result by
a zero mask and call it safe.

### Exact choppy geometry

For the declared inverse-transform sign, choose the horizontal displacement
sign by a one-mode test. This skill defines positive choppiness `chi` so
`h=a cos(kx)` maps to `X=x-chi a sin(kx)`, compressing the crest **[D]**.

Sum displacement and derivatives across cascades before forming the horizontal
Jacobian. For

```text
P(q) = (q_x + chi D_x, h, q_z + chi D_z),
```

compute `P_qx`, `P_qz`, the determinant, and
`normalize(cross(P_qz,P_qx))` exactly. Do not divide each height slope by only
its same-axis stretch; that omits cross coupling. A nonpositive determinant is
a fold, not a normal-map detail.

### Foam state

Compression may source foam, but a thresholded Jacobian is not persistent foam.
Use a bounded, timestep-correct source/decay update and declare whether the
history lives in Lagrangian parameter coordinates or is advected in an
Eulerian/world atlas. Include transport, dissipation, and source terms in
diagnostics. Display thresholding is separate from state evolution.

## CPU Coupling Contract

Expose parametric sampling separately from world-horizontal sampling. A
dominant-bin CPU sum approximates the same seeded coefficients and dispersion;
its omitted-coefficient triangle bound applies at fixed parameter coordinate.
When choppy horizontal displacement is nonzero, a world `(x,z)` query must also
invert the horizontal map. The reference derives the additional inversion
error and the condition under which it is bounded.

Return:

```ts
{
  height,
  normal,
  horizontalResidual,
  omittedCoefficientBound,
  numericalErrorMeasured,
  status,
}
```

The omitted bound **[D]**, solver tolerance **[G]**, and GPU-versus-CPU probe
error **[M]** are distinct fields. Do not read the full FFT maps back in the
frame path.

## Sustained Performance Contract

Do not publish generic mobile/integrated/discrete timing tables. For each named
target, declare the scene, viewport, DPR, resolution, cascade bands, precision
placement, active foam/optics, warm-up, sample window, power state, and
pass/fail threshold **[G]** before measuring **[M]**.

Keep a complete resource ledger and report warm percentile timings, per-stage
bandwidth, peak live bytes, allocation churn, and thermal drift **[M]**. One
`RGBA16F` texture consumes `8 N^2` bytes **[D]** and one `RGBA32F` texture
consumes `16 N^2` bytes **[D]**. Derive quality tiers only from named-target
measurements.

For bandwidth-constrained tile GPUs, prefer a workgroup-resident one-dimensional FFT plus
transpose when device workgroup storage and invocation limits admit the chosen
row representation. Otherwise use the global Stockham reference path. The
accepted kernel is the fastest one that passes the same transform, precision,
and occupancy gates; algorithm names alone are not evidence.

Resolved display maps may use half-float only after comparison with the float
FFT reference **[M]**. Repeated half-float quantization at every FFT stage is a
different and stricter error case than storing only resolved maps in half-float.

## Required Evidence

- dimensional spectrum integral and target-versus-realized variance **[M]**;
- cascade power-sum, holes/overlap, and repeat-distance diagnostics;
- DC, axis-frequency, oblique-frequency, partner-pair, and Nyquist FFT tests;
- maximum transform error, imaginary leakage, and Parseval error **[M]**;
- one-mode propagation direction, displacement sign, every derivative sign,
  exact normal, and determinant;
- per-cascade and combined displacement/slope/Jacobian views;
- foam source, transported state, decay, and display coverage over time;
- CPU omitted bound, inversion residual, and GPU probe error;
- allocation ledger, dispatch inventory, warm sustained timings, and mobile
  thermal behavior;
- fixed-camera multi-time captures, no-foam/no-detail/no-post baselines, and
  one final output transform.

For every coastal composition also require:

- bathymetry, wet mask, coast distance/frame, obstacle, current, and coupling-
  band diagnostics with units and owners;
- single-mode normal- and oblique-incidence tests measuring elevation,
  discharge, phase, transmitted power, and reflection across the handoff;
- bidirectional spectral continuity residual, omitted elevation/discharge
  bounds, incoming-characteristic proof, and discharge-producer cost;
- outgoing absorption or two-way modal-projection phase/energy/localization
  residuals whenever reflected waves cross the coupling curve;
- no-breaking/no-current conservation, breaking-loss accounting, and foam-
  source closure **[M]**;
- overlap-band variance/power closure and composite tangent-normal parity;
- fixed-flight seam captures over seed, tide/datum, time, and quality-tier
  sweeps; and
- sustained composed-frame, live-memory, and thermal evidence on each named
  low-end/mobile target **[M]**.

Fail the implementation if any coefficient has ambiguous units, FFT
normalization is implicit, a Nyquist parity rule is missing, half precision is
assumed accurate, the normal is not the cross product of displaced tangents,
foam has no transport semantics, a homogeneous periodic FFT is treated as a
coastal solver, handoff power is double-counted, coherent copies are square-
root weighted as if independent, or a performance number lacks provenance.

## Routing Boundary

This skill owns offshore homogeneous spectral synthesis, exact spectral
derivatives, displaced-surface geometry, and deep-water whitecap state. The
coastal owner supplies bathymetry-aware propagation, boundaries, interaction,
breaking, wet/dry state, and shore foam. The spectral implementation remains a
forcing producer and render contributor outside that domain; it does not gain
coastal ownership by sampling a depth texture in its material.
