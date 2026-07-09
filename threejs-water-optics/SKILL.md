---
name: threejs-water-optics
description: Build workload-selected analytic and bounded water in Three.js r185 WebGPU/TSL. Use for StorageTexture heightfield simulation, exact parametric displacement and normals, local disturbances, receiver-space caustics, depth-aware refraction, Beer-Lambert absorption, side-aware Fresnel, filtered normal bands, reflection, and foam.
---

# Water Optics

Use this skill for bounded interactive water, authored analytic surfaces, shallow
transparent volumes, and local optical effects. Use `$threejs-spectral-ocean`
when the required spatial range is a stochastic directional sea synthesized by
FFT cascades.

This is a simulation-and-transport contract, not a blue-material recipe. The
module owns water state, displacement, derivatives, optical evaluation, and
diagnostics. The host owns the renderer, scene partition, camera, lighting,
transparent ordering, and final image pipeline.

## Numeric Provenance

Every quantitative choice must carry one of these tags in implementation notes,
presets, and validation artifacts:

- **[D] Derived**: follows from stated equations, dimensions, resource formats,
  or a reproducible calculation.
- **[G] Gated**: a pass/fail limit selected before measurement.
- **[M] Measured**: captured on a named device, viewport, and workload.
- **[A] Authored**: a visual or application input with no universality claim.

Unlabelled integers inside exact equations, vector dimensions, byte identities,
and API names are [D]. Do not publish an unlabelled resolution, timestep,
coefficient, iteration count, memory limit, or millisecond target.

## Choose The Algorithm First

| Requirement | Surface algorithm | Error and cost boundary |
| --- | --- | --- |
| Small authored wave set; no local disturbance | Parametric Gerstner-style map with exact tangents | Cost is linear in component count; CPU parity requires inversion of horizontal displacement. |
| Bounded local interaction; mild non-breaking waves | GPU linear wave equation in ping-ponged storage textures | CFL-limited; cannot represent overturning, hydraulic jumps, or shoreline topology changes. |
| Flat or distant surface where silhouette motion is sub-pixel | Derivative-filtered normal bands only | Lowest geometry cost; explicitly no geometry/normal parity. |
| Large stochastic sea over decades of wavelength | `$threejs-spectral-ocean` | FFT cascades and spectral derivatives. |

Choose from spatial scale, smallest resolved wavelength, interaction radius,
allowed phase error, and sustained GPU budget. Do not select by visual style.

## Pinned Three.js r185 WebGPU Architecture

The API contract below is verified against the repository's installed
`three@0.185.1` **[G]**:

- `WebGPURenderer`, `RenderPipeline`, `StorageTexture`, and node materials come
  from `three/webgpu`.
- TSL nodes come from `three/tsl`.
- Call `await renderer.init()` before inspecting
  `renderer.backend.isWebGPUBackend` or `renderer.hasFeature()`.
- Build kernels with `Fn(...).compute(...)`; after initialization submit an
  ordered node or node array with `renderer.compute(...)`. `computeAsync()` is
  the initialization-safe wrapper, not a GPU-completion fence.
- Set `StorageTexture.colorSpace = NoColorSpace`,
  `generateMipmaps = false`, and `mipmapsAutoUpdate = false` for simulation
  state unless a compute kernel deliberately writes every sampled mip.
- Use `pass(scene, camera)`, optional `mrt(...)`, and one `RenderPipeline`.
  `PassNode.setResolutionScale()` is current. If `renderOutput()` is explicit,
  set `pipeline.outputColorTransform = false`; otherwise leave the pipeline as
  the sole output-transform owner.

```js
const renderer = new WebGPURenderer( { antialias: false } );
await renderer.init();

if ( renderer.backend.isWebGPUBackend !== true ) {
  throw new Error( 'WebGPU is required for this water system.' );
}

renderer.compute( [ impulseNode, propagateNode, derivativeNode ] );
pipeline.render();
```

The opaque color/depth pass sampled by water must exclude the water surface.
Transparent objects need an explicit ordering policy; do not silently include
them in opaque refraction inputs.

## Scientific Gates

### Bounded heightfield

For cell sizes `dx`, `dz`, wave speed `c`, and fixed step `dt`, the explicit
second-order wave stencil must satisfy the derived stability condition

```text
C_x^2 + C_z^2 <= 1,   C_x = c dt / dx,   C_z = c dt / dz.       [D]
```

For square cells this becomes `c dt / dx <= 1/sqrt(2)` **[D]**. Damping does
not legalize a CFL violation. Record the selected CFL margin **[G]**, phase and
amplitude error against an analytic mode **[M]**, and the boundary reflection
coefficient **[M]**.

Boundary mode is part of the model:

- periodic: wrap neighbors and conserve the periodic mean;
- reflecting: mirrored ghost samples implement zero normal derivative;
- absorbing: use a spatial damping sponge and measure reflection over the
  active frequency band;
- fixed-height: a deliberate phase-inverting wall, never a generic clamp.

### Parametric waves

For each normalized direction `d_i`, amplitude `a_i`, horizontal ratio `Q_i`,
`k_i = 2 pi / wavelength_i`, and phase `theta_i`, use

```text
P(q,t) = (q_x, 0, q_z)
       + sum_i (Q_i a_i d_ix cos(theta_i),
                a_i sin(theta_i),
                Q_i a_i d_iz cos(theta_i)).                    [D]
```

Compute both parametric tangents by differentiation and the upward normal as
`normalize(cross(P_qz, P_qx))`. The shortcut
`normalize((-height_x, 1, -height_z))` is exact only when horizontal
displacement is absent. Require positive horizontal Jacobian for a
single-valued surface. The conservative no-fold gate
`sum_i abs(Q_i a_i k_i) < 1` is **[D]**; the actual minimum determinant over the
authored domain is **[M]**.

### CPU surface queries

`getWaterHeight(x,z,t)` cannot obtain Eulerian parity by evaluating analytic
phases directly at `(x,z)` when horizontal displacement is nonzero. It must
invert the horizontal map with a bounded fixed-point or Newton solve, then
evaluate height at the recovered parameter coordinate. Report iteration limit
**[G]**, residual tolerance **[G]**, and observed residual **[M]**.

The GPU heightfield residual is not bounded by the sum of impulse controls.
Choose one honest contract:

- enforce a hard height envelope `H_grid` **[G]**, giving a derived analytic-
  only query interval of `+/- H_grid` **[D]**;
- maintain a CPU surrogate and report convergence/probe error **[M]**; or
- declare the query analytic-only and unbounded with respect to live GPU
  disturbances.

Never hide readback latency in a per-frame query.

### Caustics

Map each surface differential through Snell refraction to a stated receiver.
For receiver-plane coordinates `F(q)`, use

```text
A_receiver = abs(det(dF/dq)) dq_x dq_z                       [D]
P_cell = E_incident max(0, -l dot n) A_surface
         (1 - F_dielectric) T_light                         [D]
E_receiver = P_cell / max(A_receiver, A_epsilon).            [D]
```

`length(dFdx) * length(dFdy)` is not an area; it omits the sine of the angle
between derivatives. Use a determinant in a receiver basis or a cross-product
magnitude. Deposit energy conservatively into receiver texels or solve an
inverse map; merely displaying the ratio at source texels misplaces light.
Clamp only after recording pre-clamp energy and invalid/TIR counts.

### Optical transport

Classify the incident medium before evaluating Snell and Fresnel. Use exact
unpolarized dielectric Fresnel near total internal reflection; Schlick is
allowed only behind a recorded error gate **[G]** and comparison **[M]**.

```text
T_rgb = exp(-sigma_a_rgb * pathLengthMeters)                  [D]
L = F L_reflected + (1 - F) (T L_refracted + L_scatter)       [D]
```

`sigma_a` has units `m^-1` **[D]**. Reconstruct positions from scene depth,
reject foreground/off-viewport samples, and validate that the reconstructed
point lies on the forward refracted ray before calling its distance a path
length. A specular BRDF already contains the sun glint; do not add a second
unbudgeted glint lobe. Foam replaces an energy-conserving fraction of the water
response instead of adding white radiance.

## Sustained Performance Contract

Quality is a target-specific measured envelope, not a device-class label. Do
not publish generic mobile/integrated/discrete timing tables. For each named
target, declare the scene, viewport, DPR, grid, fixed cadence, precision,
active effects, warm-up, sample window, power state, and pass/fail threshold
**[G]** before measuring **[M]**.

An `RGBA16F` texture consumes `8 N^2` bytes **[D]**; enumerate every
persistent, ping-pong, transient, scene-color, depth, geometry, and pipeline
allocation. Measure warm percentile frame time, each bandwidth-sensitive pass,
peak live bytes, allocation churn, and thermal drift on the named target
**[M]**. Derive tiers only from those measurements.

For tile/mobile GPUs:

- keep simulation resolution independent of viewport resolution;
- fuse kernels only when read/write hazards remain explicit;
- prefer `textureLoad` for stencil state and filtered sampling only for resolved
  display fields;
- reduce storage traffic before reducing arithmetic;
- update caustics less often only if reprojection error remains below a stated
  screen-space gate **[G]**;
- exclude diagnostic textures and timestamp queries from production budgets,
  but include their separate measured overhead **[M]**.

## Required Evidence

Read [references/water-surface-system.md](references/water-surface-system.md)
before implementation. Validation must include:

- analytic single-mode phase/amplitude error and the CFL margin;
- boundary reflection and mean/volume drift;
- finite-value scan of all state and derivative outputs;
- exact tangent-normal versus finite-difference normal error;
- minimum horizontal Jacobian and fold count;
- CPU query residual plus its declared live-grid error contract;
- receiver-space caustic energy before/after deposition and clamp;
- exact Fresnel versus approximation error, TIR classification, refraction-ray
  residual, and invalid-sample fraction;
- final/no-optics/no-caustics/no-foam fixed views;
- renderer info, allocation ledger, dispatch count, and sustained GPU timings.

Fail the build on an unstable stencil, stale derivative state, invalid values,
double output conversion, source-space caustics presented as receiver-space
light, or any unlabeled quantitative claim.

## Routing Boundary

This skill owns bounded wave grids, exact small-wave parametric surfaces,
depth-aware refraction, water-volume attenuation, and bounded caustics. Use
`$threejs-spectral-ocean` for directional spectra and FFT cascades; use the
weather-water skill for precipitation-driven surface accumulation.
