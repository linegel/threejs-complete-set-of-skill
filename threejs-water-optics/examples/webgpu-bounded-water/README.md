# Native WebGPU bounded-water lab — acceptance incomplete

This directory is the canonical r185 implementation for bounded interactive
water. It is not accepted evidence yet. `lab.manifest.json` remains
`incomplete` until the current adapter supplies native-WebGPU captures, GPU
storage readbacks, timestamps, a 50-cycle lifecycle run, and manual visual
inspection.

## Implemented graph

The host graph has two truthful scene submissions:

```text
opaque scene without water
  -> opaque color + depth
  -> water refraction / foreground / ray-residual validation

final scene with receiver caustics + water
  -> renderOutput(final color)
  -> one final output transform owner
```

The opaque input contains the receiver, submerged fixtures, and the active
buoyancy subject. Water is absent from that pass. `renderOutput(...)` owns
presentation, so `RenderPipeline.outputColorTransform = false`.

The node-centred simulation uses [D] `dx=Lx/(N-1)`, `dz=Lz/(N-1)` and the
symplectic damped update documented by the skill. Every canonical tier must
satisfy the reserved [G] margin

```text
sqrt((c dt/dx)^2 + (c dt/dz)^2) <= 0.85.
```

Each fixed step executes:

```text
immutable 4×vec4 event snapshot upload                         [D]
propagation A->B or B->A                                      [1 dispatch/fixed step, D]
combined analytic+heightfield differential                    [1 dispatch/update, D]
atomic caustic accumulator clear, when enabled                [1 dispatch/update, D]
source-driven four-tap receiver deposition, when enabled      [1 dispatch/update, D]
receiver irradiance resolve, when enabled                     [1 dispatch/update, D]
```

Drop, object, and mask data are snapshotted before command encoding. Pending
CPU values can be cleared only after the storage upload is fixed. The browser
controller splits a presentation delta into bounded chunks, so equal-real-time
30/60/120 Hz browser-free oracle replays execute the same fixed steps and
produce the same f32 state hash. Direct `heightfield.step()` still reports
dropped catch-up time rather than hiding it.

## One surface cause

Visible displacement is

```text
authored exact parametric waves + live GPU heightfield.
```

Visible normals and caustic rays use the same authored tangents plus live
heightfield derivatives. The caustic receiver is not a source-grid display.
Each source texel traces to the receiver and atomically deposits four bilinear
power contributions. The uint quantization contract derives a per-source cap
from the tier's source count so even the adversarial all-sources-to-one-pixel
case cannot overflow `uint32`. Readback records source units, out-of-domain
units, deposited units, resolved units, saturation count, invalid/TIR sources,
and the derived rounding-loss bound. No bounded gather or unreported gather
loss remains.

Caustic radiance is applied to the receiver material. The water material only
uses the receiver texture in its explicit diagnostic view.

## Optical transport

Exact side-aware dielectric Fresnel classifies total internal reflection
before any `refract`, normalization, projection, or scene sampling. A
transmission branch then:

1. builds a finite nonzero refracted direction;
2. projects a view-space probe;
3. rejects off-viewport coordinates;
4. reconstructs opaque view position from the water-free depth pass;
5. rejects foreground and behind-ray points;
6. gates cross-track residual;
7. uses the accepted ray distance for Beer–Lambert transport.

Without both host color and depth nodes, optical transport cannot be enabled.
There is no fallback renderer.

## Mechanism routes

Every route imports this implementation but locks a distinct runtime profile:

- `heightfield-simulation`: propagation and differential only;
- `drops-and-object-ripples`: immutable drop plus object events;
- `differential-caustics`: source deposition and receiver material;
- `refraction-and-absorption`: water-free opaque color/depth transport;
- `fresnel-and-tir`: exact interface classification diagnostic;
- `buoyancy-spray-and-masks`: analytic CPU buoyancy query, object impulse,
  deterministic instanced spray, and a GPU event mask.

Unknown mechanisms, modes, cameras, tiers, seeds, negative time, non-finite
physics inputs, out-of-domain events, and unsafe CFL configurations throw.

## Exact tiers and persistent resources

Only these tiers exist:

| Tier | Grid | Mesh | Fixed step | Max substeps | Analytic / micro bands | Persistent GPU bytes [D] |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ultra | 512² | 192² | 1/240 s | 4 | 5 / 4 | 9,437,344 |
| high | 256² | 128² | 1/120 s | 3 | 4 / 3 | 2,359,456 |
| medium | 192² | 96² | 1/120 s | 3 | 3 / 2 | 1,327,264 |
| low | 96² | 48² | 1/60 s | 2 | 2 / 0 | 331,936 |

Persistent bytes include four `RGBA16F` textures, the uint caustic accumulator,
event snapshot, diagnostics, and GPU probe buffer. Geometry and the two host
pass color/depth allocations are reported separately at runtime. Tier routes
do not invent device-performance claims; all hardware rows remain
`INSUFFICIENT_EVIDENCE`.

## Capture and evidence

`capture.mjs` delegates to the repository shared Vite/Playwright wrapper and a
lab hook. The controller returns RGBA8 render-target readback with the shared
256-byte aligned row-stride contract. The hook also requests actual storage
readback for the impulse-consumption and receiver-energy mutations. It does not
manufacture a complete evidence bundle.

`validate-artifacts.mjs` uses the shared strict v2 validator, requires every
claim verdict to pass, checks the canonical whole-directory source hash, and
adds water-specific owner, resource, and GPU-readback gates.

Browser-free checks:

```bash
npm --prefix threejs-water-optics/examples/webgpu-bounded-water run validate:quick
```

Still required before acceptance:

- current-adapter native-WebGPU execution and aligned PNG captures;
- GPU state and caustic-energy readback reconciliation;
- depth-refraction and TIR fixed-view inspection;
- positive GPU timestamps and sustained p50/p95 traces;
- 50–100 create/render/resize/mode/tier/dispose cycles;
- the complete non-duplicated schema-v2 image and JSON set.

The generated Canvas2D caustics page remains an asset-only preview. It cannot
satisfy any canonical runtime claim.
