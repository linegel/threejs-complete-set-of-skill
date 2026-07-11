# Native WebGPU FFT-ocean lab — acceptance incomplete

This directory is the canonical browser implementation for
`threejs-spectral-ocean`, but it remains classified as a
`numerical-integration-scaffold`. It does not claim accepted skill coverage
until native-browser evidence, current-adapter timestamps, lifecycle evidence,
and visual review exist under the strict v2 protocol.

The checked implementation proves only:

- [Derived] an explicit positive-exponent, unnormalized inverse-DFT convention
  with CPU fixtures;
- [Derived] dimensional conversion from directional frequency spectra to
  discrete wavevector coefficients;
- [Gated] Three.js r185 `StorageTexture` compute-graph construction;
- [Derived] the exact resolved-band choppy-surface tangent and Jacobian formula;
- [Derived] native-resolution per-cascade displacement, derivative, and
  Lagrangian foam-history ownership.

It explicitly does not prove:

- GPU coefficients equal the CPU mirror within a measured tolerance
- half-float FFT precision is acceptable
- multicascade surface and foam GPU readback matches the CPU oracle
- full scene-depth refraction, receiver caustics, or below-surface volumetric transport
- sustained performance, mobile thermal behavior, or production resource lifetime

CPU tests, source inspection, and capture hooks do not promote those claims.

## Numerical convention

For grid wavevector `k`, the evolution is

```text
H(k,t) = h0(k) exp(-i omega(k)t) + conj(h0(-k)) exp(+i omega(k)t)
```

and the spatial transform is

```text
h(x,t) = sum_k H(k,t) exp(+i k dot x).
```

The inverse transform is intentionally unnormalized. One checkerboard
centring correction is applied after both transform axes. The Box–Muller
complex Gaussian has `E[|xi|^2] = 2`, so
`amplitude^2 = P(k) DeltaK^2 / 4` gives the required half-pair variance under
this convention.

The spectrum uses finite-depth gravity-capillary dispersion, JONSWAP/TMA
lobes, normalized directional spreading, disjoint half-open cascade bands, an
isotropic Nyquist cap, and field-specific odd-derivative masks on self-mirror
Nyquist axes. Seed mixing uses integer `u32` operations.

## Native per-cascade compute graph

Each cascade owns 17 RGBA storage textures:

```text
4 spectrum/debug textures
4 frequency field textures A
4 FFT ping-pong textures B
3 physical outputs: displacement, derivatives, cross/Jacobian
2 temporal foam-history ping-pong textures
```

No world-sized shared displacement or foam atlas exists. Each cascade keeps its
declared period, resolution, and spectral band through rendering and foam
history. Surface foam combines coverage as the union
`1 - product_i(1 - coverage_i)` after sampling every history at its native
period.

Per frame, per cascade:

```text
4 frequency-evolution dispatches
4 packed fields × (bit-reverse X + log2(N) X stages
                 + bit-reverse Y + log2(N) Y stages)
1 fused assembly, or 3 portable assembly dispatches
1 temporal foam reaction dispatch
```

`describePipeline()` exposes every evolution, bit-reversal, FFT-stage,
assembly, and foam node in submission order. `describeResources()` inventories
all storage textures plus the butterfly and bit-reversal `DataTexture`s. The
compiled-layout record changes from initialization-only to
`all-selected-runtime-layouts-submitted-to-webgpu-compiler` only after every
selected runtime node has reached `renderer.compute()`.

Spectrum initialization requires four simultaneous storage textures. Portable
execution therefore requires
`maxStorageTexturesPerShaderStage >= 4`. The split assembly uses at most three;
the optional fused assembly requires seven. Declared layouts are checked
against the initialized adapter before graph construction.

## Geometry and normal bandwidth

`createOceanSurfaceMaterial()` partitions cascades against the actual mesh
Nyquist limit:

```text
k_mesh = pi * segments / sizeMeters
k_safe = geometryNyquistSafety * k_mesh.
```

Only complete cascades whose upper cutoff is at most `k_safe` may displace
vertices. The exact geometric normal and Jacobian use those same resolved
bands. Higher bands may affect only the fragment shading normal, sampled from
their native cascade textures and faded by a derivative-based pixel-footprint
filter before their frequency exceeds fragment support. This prevents an
undersampled atlas or unresolved cascade from entering geometric derivatives.

`createOceanMesh()` requires the same size and segment count used to construct
the material’s band contract. Identity object rotation and scale remain
required because periodic coordinates are authored in the world-aligned XZ
frame.

## Mechanism routes

Every route imports the same canonical controller and selects a distinct fixed
startup state:

- `spectrum-and-fft`: source-spectrum and spatial FFT diagnostic;
- `dispersion-and-cascades`: color-separated native cascade contributions;
- `derivatives-and-jacobian`: exact derivative/Jacobian diagnostic;
- `whitecaps-and-foam`: temporal per-cascade foam coverage and source;
- `above-and-below-surface`: an underwater camera with side-aware dielectric
  Fresnel, total-internal-reflection classification, and Beer attenuation;
- `cpu-query-parity`: visible probes placed by the reduced CPU Eulerian-query
  solver, with residual and truncation metadata.

The optical route is a bounded diagnostic, not a full depth-aware water
composer. It safely handles a zero refracted vector under total internal
reflection and does not claim receiver caustics.

## Deterministic time and CPU queries

`setTime(t)` rebuilds history and replays from zero using fixed 1/60 s steps,
plus one exact remainder. It never advances temporal foam with `dt = 0` at a
nonzero target time. Equal fixed-time captures therefore do not depend on the
presentation cadence that preceded them.

The reduced CPU query sampler retains authored dominant bins and inverts the
horizontal choppy map for Eulerian `(x,z)` queries. Its reported bounds separate
parameter-height, parameter-slope, contraction, and conditional world-height
errors. The browser route displays those probes, but GPU parity remains
insufficient evidence until matching storage readback is captured.

## Authored tiers and storage

With half-float RGBA storage and two foam-history textures per cascade:

| Tier | FFT | Cascades | Storage textures | Derived storage |
|---|---:|---:|---:|---:|
| ultra | 512² | 3 | 51 | 102 MiB |
| high | 256² | 3 | 51 | 25.5 MiB |
| medium | 256² | 2 | 34 | 17 MiB |
| low | 128² | 1 | 17 | 2.125 MiB |

These are derived allocation sizes, not measured residency or performance.
They exclude lookup textures, scene/render targets, geometry, driver
allocations, and pipeline caches. All tier target classes remain
`unmeasured-current-adapter`.

## Validation and capture

Browser-free verification:

```bash
npm --prefix threejs-spectral-ocean/examples/webgpu-fft-ocean run validate:quick
```

The capture adapter imports the repository’s shared self-serving Vite/WebGPU
harness and supplies color-managed RGBA8 render-target readback with explicit
256-byte row alignment. It defines the standard correctness image set, but it
must not be treated as executed evidence until actually run.

The artifact validator delegates to `scripts/lib/evidence-v2.mjs`, requires the
complete v2 file/image set, and compares `evidence-manifest.json.sourceHash`
against the registry hash. The manifest hashes the entire canonical directory,
not a hand-picked source subset. The lab remains `incomplete` after browser-free
checks.
