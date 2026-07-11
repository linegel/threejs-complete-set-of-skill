# Native WebGPU LUT Atmosphere Lab

`index.html` and `browser-app.js` are the canonical native-WebGPU entry. They
initialize and gate `WebGPURenderer`, allocate all LUT/froxel resources,
bind a real host scene/camera/body transform and `PassNode` depth, dispatch the
selectively invalidated five-stage dependency chain, expose live controls and
fixed diagnostic modes, and
provide aligned render-target readback through `__LAB_CONTROLLER__`.
`validation.js` is intentionally narrower: it proves source graphs and float64
oracles without claiming that a GPU run occurred. Browser execution is blocked
in the current validation environment, so `lab.manifest.json` remains
`incomplete`.

## Claim Matrix

| product/owner | Phase 1 implementation | what the validator proves | what remains unproved |
| --- | --- | --- | --- |
| transmittance | real TSL `ComputeNode`; inverse Bruneton-style `(xMu,xR)` map; fixed-step RGB transmittance integration | graph construction, dispatch shape, CPU forward/inverse-map fixtures, homogeneous-medium units | GPU execution/readback, reference-integrator error, adaptive quadrature |
| multiscatter | real TSL graph with a compact authored closure | graph construction and r185 dispatch accounting | GPU output, reference radiance, and energy closure; status is `reference-ungated` |
| irradiance | imported manifest asset plus real TSL quadrature graph | asset bytes/hash/model metadata, graph construction, and dispatch accounting | imported reference-error evidence, GPU output, quadrature convergence, and material-lighting integration |
| sky-view | real TSL line-integral response graph with live camera radius and local sun zenith | graph construction, dispatch accounting, homogeneous-radiometry units, and body-frame dependency metadata | GPU output, horizon/seam error, and reference radiance; status is `reference-ungated` |
| aerial inscattering | one real live-camera TSL kernel per XY ray, cumulatively writing every Z slice with optical depth | graph/payload wiring, linear-in-depth CPU topology oracle, unjittered inverse-view-projection/body bindings | GPU output, multiple-scattering accuracy, and temporal amortization |
| aerial optical depth | same cumulative XY-ray dispatch; RGB cumulative dimensionless `tau` | monotonic CPU oracle and shared-freshness structure | GPU output and depth-composite image accuracy |
| scene/depth/pipeline | real sphere/PBR host scene, actual `PassNode` color/depth, metric off-axis reconstruction, ECEF/body diagnostics, and reusable `createAtmosphereCompositeNode()` | single-owner source wiring, control-to-invalidation mutations, and browser-safe controller surface | current-adapter readback, projection-specific depth images, and reference error |

`createAtmosphereComputeKernels()` returns five real compute graphs in the
declared dependency order, but only an
application or browser harness that calls `computeAtmosphereLuts(renderer)` on
an initialized native WebGPU backend executes them. Node graph construction is
not GPU evidence. The method uses `renderer.compute()` after initialization;
submission is queued and neither `compute()` nor r185 `computeAsync()` is a
CPU-visible GPU-completion/readback fence. Later GPU submissions are
queue-ordered; readback, timestamp resolution, reuse, or disposal based on
completion needs an explicit completion/readback mechanism.

## Units And Transport

The live integrator uses kilometers internally and coefficients in
`km^-1`; their product is dimensionless optical depth. The model declares this
boundary explicitly. The three solar/coefficient channels are an authored
linear transport basis, not display sRGB. The solar vector is explicitly an
authored relative **normal irradiance**, never claimed as SI watts or as disc
radiance. Compute products store transport response per unit normal irradiance;
composition applies that vector once. The analytic disc conversion is
`Ldisc = Enormal / (pi*sin(alpha)^2)`, so source quantity and output radiance
units are not silently interchanged.

The executed single-scatter phase functions are normalized Rayleigh and
Henyey-Greenstein. `omega` points from camera into the scene, `s` points from a
sample to the sun, and `mu=dot(omega,s)`, so positive Mie `g` peaks toward the
sun. The fixture gates `|g| <= 0.99`, evaluates the denominator with a
cancellation-resistant sign branch, and tests normalization and peak direction
at both allowed extremes.

Imported assets are accepted only when their manifest radii, coefficients,
density layers, units, phase convention, solar quantity, and spectral basis
match the live config. This is metadata compatibility, not proof of the source
transport error because the imported bundle contains no reference-error report.

## Authored Workload Trials

`QUALITY_TIERS` exposes canonical `ultra`, `high`, and `mobile` trials. The old
`full`, `budgeted`, and `minimum` keys remain aliases for compatibility. These
are authored workloads, not device classes or timing claims. Derive work from
the selected schedule:

```text
payloadBytes = sum(width*height*depth*bytesPerTexel*residentCopies)
invocations = width*height*depth
workgroupInvocations = wgX*wgY*wgZ
r185FlattenedGroups = ceil(invocations/workgroupInvocations)
integratorSamples = sum(updatedTexels*samplesPerTexel)
```

Numeric r185 `Fn().compute(invocations, workgroup)` dispatches
`[r185FlattenedGroups,1,1]` for these trial sizes. Count the shared aerial
kernel once even though it writes two storage volumes.

Product acceptance requires named full-frame GPU/CPU/presentation p50/p95 and
peak-live-byte budgets, then contemporaneous captures of the complete pass
graph. The validator reports only derived payload bytes.

## Required Future Browser Evidence

Before calling the system production-ready, add fixed-view browser evidence for
sea level, mountain altitude, horizon, terminator, night side, low/high orbit,
and shell entry. Required diagnostics include:

- body/ECEF altitude and top/bottom intersections;
- density and view/sun optical depth;
- sun visibility and ground occlusion;
- RGB segment transmittance and RGB inscattering separately;
- sky/surface coverage and projection-specific depth reconstruction;
- LUT forward/inverse coordinates, seam, and froxel-depth distribution;
- invalidation hash, update reason, history age, disocclusion, and resource
  lifetime;
- reference `tau`, radiance, phase-normalization, and energy residuals.

The pipeline must clip ray segments geometrically against the shell. It must
not use fixed-altitude shell/post blend constants.

The aerial graph uses the host's unjittered inverse view-projection, world-to-
body matrix, camera body position, body-space sun direction, viewport, and
exponential far distance. `resize()` keeps authored tier dimensions fixed but
invalidates aerial rays; camera altitude invalidates sky-view and aerial,
camera yaw invalidates only aerial, and solar magnitude invalidates neither
because it is factored into the final composite. All base-only
`StorageTexture` and `Storage3DTexture` resources set
`generateMipmaps=false`; 2D storage also disables `mipmapsAutoUpdate`.

## Validation

Run:

```sh
node threejs-sky-atmosphere-and-haze/examples/webgpu-lut-atmosphere/validation.js
```

Passing means:

- imported LUT integrity and upload policy pass;
- model units and coefficient inequalities pass;
- manifest/live-model physical metadata equality passes;
- CPU spherical intersection, LUT map, phase-extreme, projection-depth, and
  nearest-covered-sample MSAA resolve equations pass;
- all five TSL compute graphs build as `ComputeNode`s, with the aerial graph
  cumulatively writing both volumes from one invocation per XY ray;
- live controls, actual scene depth/body transform source structure, and
  dependency-specific invalidation mutations pass;
- the homogeneous-medium float64 oracle reconciles `km^-1 * km`, cumulative
  optical depth, and relative radiance response per steradian;
- approximation kernels remain labeled `reference-ungated`;
- native-WebGPU capability failure throws;
- r185 flattened dispatch accounting, base-only mip policy, fixed-grid resize
  non-applicability, resource disposal, and output-owner metadata pass.

Passing does **not** mean GPU compute, reference-correct
sky/multiscatter/irradiance transport, depth composition, image quality,
performance, or energy conservation passed.
