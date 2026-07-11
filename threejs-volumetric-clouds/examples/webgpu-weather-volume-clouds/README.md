# Native WebGPU Weather-Volume Cloud Lab

`index.html` and `browser-app.js` are the canonical native-WebGPU entry. The lab
allocates explicit RGBA16F/R32F/RG16F storage, samples the host scene-pass
depth, dispatches bounded beauty, sun-aligned shadow, and split full-low-grid
temporal kernels, displays diagnostics
through one host-owned `RenderPipeline`, and exposes aligned readback via
`__LAB_CONTROLLER__`. The Node validator proves graph construction, oracles,
resource arithmetic, and claim boundaries; it does not claim a GPU run. Browser
execution is blocked in the current validation environment, so
`lab.manifest.json` remains `incomplete`.

The legacy `../deprecated-weather-volume-clouds/` implementation remains
quarantined. Source-level P0s are repaired here; native GPU execution,
readback, oracle comparison, timing, and lifecycle proof are still required
before acceptance.

## What Is Present

| Module | Source status | Claim boundary |
| --- | --- | --- |
| `cloud-config.js` | Asset, layer, interval, optics, workload, and storage validation | Authored presets, not measured performance |
| `cloud-domains.js` | Float64 shell/slab/OBB intersection oracles and scene-depth clamp | GPU-image parity still requires browser readback |
| `cloud-nodes.js` | Bounded shell/slab/OBB Beer/HG transport using real host depth plus split projected-motion auxiliary compute | Fixed authored sun; no conservative 3D macrocell hierarchy |
| `cloud-history.js` | Two portable temporal dispatches with persistent ping-pong, metric-depth/spread rejection, projected velocity, response-time weighting, reset, and five-tap variance clipping | Bilinear-filter behavior and temporal error still require browser proof |
| `cloud-shadows.js` | Sun-aligned R16F optical-depth cascade kernels | Full-column opaque/ground receiver product; not a depth-resolved in-cloud shadow field |
| `cloud-composite.js` | Reusable four-tap depth-aware HDR composite consuming separate cloud optical-depth shadow | GPU edge-error evidence pending |
| `webgpu-weather-volume-clouds.js` | Explicit storage allocation, persistent ordered dispatch, portable binding gate, stage factory, reset, and disposal | Runtime proof pending; non-WebGPU dispatch is rejected |

`node validation.js` verifies these static boundaries. Passing it is not GPU,
visual, radiometric, performance, or temporal-conformance evidence.

## Corrected Numerical Contracts

The authored density amplitude is dimensionless. Optical coefficients are in
inverse meters:

```text
sigma_s = rho * beta_s
sigma_a = rho * beta_a
sigma_t = sigma_s + sigma_a
j_single = sigma_s * integral(p * L_i dOmega)
T_step = exp(-sigma_t * ds)
DeltaL = T_acc * (j / sigma_t) * (1 - T_step)
```

The zero-extinction limit is `T_acc * j * ds`. Validation checks homogeneous
slab partition invariance and numerically integrates the normalized
Henyey-Greenstein phase over solid angle.

Turbulence warps shape coordinates; it is not added to density. The beauty
kernel skips every packed vertical gap in the config, but it still lacks the
reference's conservative 3D macrocell hierarchy.

Representative depth uses opacity-deposition weights and the planned topology
stores it in R32F meters. RG16F stores velocity and depth mean/spread in separate
current/read/write slots. The validator proves the planned format/slot byte
arithmetic, not allocation, filterability, dispatch, or temporal accuracy.

## Temporal Contract

Every low-resolution texel is current each frame. This package does not use a
checkerboard logical grid and does not claim “missing low texels.” Current-frame
weight is derived from real time:

```text
alpha_current = 1 - exp(-dt / responseTime)
```

History UV is rejected outside the viewport before a clamped lookup. Metric
depth rejection expands its threshold by current and history depth spread, and
accepted RGB history is clipped to a five-tap current neighborhood. The source
does not instantiate or validate the sampler filter, so it does not claim proven
bilinear reconstruction. The auxiliary pass projects the representative world
point through current and previous camera bases after inverse wind advection.
It writes velocity and depth moments separately, keeping every compute pipeline
at three or fewer storage bindings. Moving-cloud temporal correctness remains
unproved until fixed-schedule native readbacks are compared.

## Shadow Contract

The shadow target stores one R16F value:

```text
R = integral(sigma_t ds)
T = exp(-R)
```

This total column is valid for an opaque/ground receiver behind the entire
column. It cannot answer transmittance from an interior cloud sample to the sun.
That requires a short sun march, a depth-resolved light-space volume/deep-opacity
representation, or a documented piecewise decoder. The cascade kernels march a
declared sun-aligned light-space axis. Browser evidence is still required for
stable anchoring, update cadence, transition error, and actual receiver use.

## Workload Tuples

Configuration points are expressed as

```text
(linear scale, primary cap, light cap, shadow count, shadow resolution, cadence)
```

The checked-in tuples are Authored. Report whole-frame p50/p95 and paired
marginal p50/p95 with the cloud system enabled/disabled on the same fixture,
including drawing-buffer pixels, occupancy, early exits, bytes/frame, browser,
Three.js revision, hardware, and thermal state. Do not sum independent
percentiles or route quality from device labels.

Worst-case nested work remains explicit:

```text
pixels * primaryCap * lightCap
```

Actual work requires occupied-sample and early-exit histograms.

## Validation

```bash
npm run check
npm run validate
```

Validation covers:

- manifest dimensions, hashes, byte lengths, and `NoColorSpace` data policy;
- occupied-band merging and complementary-gap packing;
- nonnegative inverse-meter optical coefficients;
- workload tuple bounds and exact storage byte arithmetic;
- phase normalization and analytic homogeneous-slab integration;
- metric-depth/spread, viewport rejection, and variance-clip source contracts;
- R16F full-column shadow semantics and receiver limitation;
- scaffold-only beauty, temporal, shadow, and composite claims;
- rejection of non-WebGPU compute dispatch.

Generated weather-map validation remains a separate deterministic asset check.
