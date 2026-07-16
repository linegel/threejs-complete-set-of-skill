---
name: threejs-procedural-fields
description: Procedural fields for coherent scalar and vector causes in Three.js WebGPU/TSL. Use when a task needs shared causes across materials, geometry, or compute; must choose direct evaluation versus a baked field; needs deterministic CPU/TSL parity and footprint filtering; or needs metric signed-distance terrain and coast analysis.
---

# Procedural Fields

Author one deterministic field bundle, then adapt it to each shader stage and
consumer. Coordinates, seed, causes, derivatives, and output meanings belong to
the field; fragment footprints, vertex LOD, storage, and diagnostics are
consumer adapters.

For multi-system work, `$threejs-choose-skills` is an optional coordinator.
Materials own PBR response, geometry owns topology, water owns free-surface
state, and the final-image skill owns tone mapping and output conversion.
Publish each cross-system field output with units, coordinate/frame convention,
producer and consumer owners, revision, spatial/temporal support and filter,
validity domain, error bound, update cadence, and staleness rule. Keep GPU
resource layout and render LOD private to the consuming adapter.

## 1. Freeze the field contract

Record before implementation:

```text
coordinate domain and units
seed owner, hash/noise family, and wrapping convention
primary fields -> derived causes -> named outputs
consumer, filter, precision, update cadence, and validity per output
direct-versus-bake decision inputs
debug view and invalidation key per output
```

Choose coordinates from the cause: world/tile-local for terrain and weather,
undeformed radial physical coordinates for planets, object/local coordinates
for ornament, or a declared generated-texture domain. Large domains use an
integer tile plus local float (or another split representation) before f32
phase error changes the field.

This step is complete when every output has one coordinate/seed owner, units,
consumer, filter, precision, update rule, invalid state, and diagnostic.

## 2. Author one stage-portable core

Implement the shared causes as a deterministic TSL `Fn`. Keep the core free of
fragment-only derivatives, vertex camera policy, storage layout, and dispatch
state. Materialize common intermediates once with `.toVar()` or an equivalent
local; inspect generated WGSL when separate outputs might rebuild the same
warp, hash, or octave chain.

Use `WebGPURenderer` and verify `renderer.backend.isWebGPUBackend === true`
after `await renderer.init()`. `renderer.compute()` submits ordinary compute
work. In r185, `computeAsync()` initializes before enqueueing but is not a GPU
completion fence; completion evidence needs timestamps or an actual map/readback.

Carry parity-critical seeds as `u32`, not f32. Gate floored lattice coordinates
to the i32 domain before bit reinterpretation. Apply a domain warp once to the
coordinates, propagate its Jacobian into analytic gradients, and keep spherical
warps tangent before renormalization.

Before implementing an integer-lattice CPU/TSL parity branch, read
[the canonical parity core](examples/cpu-tsl-field-parity.mjs). It shows the
signed-i32 gate, wrapping `Math.imul`/TSL `uint` hash, explicit f32 normalization,
and one shared `.toVar()` bundle without prescribing a field spectrum. CPU
callers reject `valid === false`; TSL callers route the `valid` node into an
explicit mask, select, or invalid-state diagnostic before consuming hash/value.

This step is complete when all consumers call the same cause graph, each shared
intermediate is evaluated once per invocation, and every stage restriction is
isolated in an adapter.

## 3. Select direct evaluation or storage

Compare one amortization interval:

```text
Tdirect = sum_i(Q_i * E_i)

Tbake = (D * (E_bake + Wstore) + Tdispatch + Tmips) / U
      + sum_i(Q_i * (S_i + B_i / BW_effective))
```

`Q_i` is the actual workload of consumer `i`; fragment workload is measured or
modeled from resolution, coverage, MSAA/helpers, and overdraw. `D` is dirty
texels, `U` reuse frames, and the remaining terms come from controlled target
measurements. Choose the lower path subject to latency, memory, and error gates.
Read count or octave count alone is not a decision.

For a bake, pack only channels sharing coordinates, precision, filter, cadence,
and consumer locality. Use separate storage and sampling usage scopes; ping-pong
when an update reads and writes the same logical field. `RGBAFormat +
HalfFloatType` is the portable r185 `rgba16float` writable baseline
(`8 B/texel`). Gate narrower/float32 formats and filtering against actual WebGPU
features. Store local/normalized values rather than large absolute coordinates.

Read
[storage, precision, and invalidation](references/field-stack-recipes.md#storage-precision-and-invalidation)
before adding a `StorageTexture`, mip chain, dirty-tile updater, or category ID
texture.

This step is complete when the chosen representation has measured cost inputs,
exact bytes and simultaneous resource lifetime, a propagated per-channel error,
and one explicit owner for creation, update, invalidation, and disposal.

## 4. Filter each consumer and add CPU parity only where needed

For post-warp footprint `J'` and a band's effective support frequency
`f_support`, use

```text
q = f_support * sigmaMax(J')
```

and require `q <= 0.5` cycles/sample. Fade or prefilter before the bound, and
transfer removed slope/normal energy to the material's variance/roughness path.
Geometry displacement also obeys its mesh sampling bound. Fragment derivatives
belong only to derivative-uniform fragment adapters; vertex and compute users
need analytic, symbolic, supplied-footprint, or stored derivatives.

Create a CPU port only for geometry/offline generation, precomputed native
tiers, or parity evidence. It imports the same constants, seed wrapping,
normalization, and remaps as TSL. Compare direct f32, sampled/interpolated, and
stored/quantized error separately; threshold decisions use a guard band rather
than a global image tolerance.

Read
[filtering and parity](references/field-stack-recipes.md#filtering-derivatives-and-parity)
when the field drives displacement, classification, a stored sample, or a CPU
consumer.

This step is complete when every active frequency band passes the relevant
screen/mesh footprint gate and every CPU/storage comparison states the error
source, bound, and threshold behavior.

## 5. Wire consumers, invalidation, and diagnostics

Use NodeMaterial slots or geometry/compute inputs without recreating causes.
Data fields use linear/`NoColorSpace` handling; authored color textures use
`SRGBColorSpace`. Keep HDR buffers linear until the single output owner.

A field revision changes when its seed, coordinates, algorithm, source data,
encoding, or accepted values change. Propagate that revision to dependent mips,
contours, anchors, caches, and diagnostics. Static fields build once, slow
fields update on cadence, edited fields invalidate dirty regions plus every
filter/derivative halo, and all resources have a disposal owner. Frame-critical
consumers stay on GPU or use an explicit asynchronous mirror; diagnostics may
read back outside the render loop.

Expose source coordinates, each cause/band, derivatives or frames, packed
channels, selected mip/footprint, validity, direct-versus-stored error, and the
final consumer result. Use `mrt()` when views share the scene pass.

For metric signed distance, shorelines, cross-shore profiles, drainage, or
contour-driving classifications, first read
[metric signed distance and coastal analysis](references/field-stack-recipes.md#metric-signed-distance-and-coastal-analysis).

This step is complete when changing any field input invalidates every dependent
consumer, diagnostics expose every named output and failure state, and rebuilds
produce the same values and identities for the same contract.

## Completion

The field system is complete when one stage-portable cause graph accounts for
every output; direct/baked and filtering choices are evidence-backed; CPU,
storage, and threshold errors are explicit where those branches exist; all
cross-system consumers receive versioned valid data in declared units; and
coordinates, identities, mips, dirty regions, and resources remain stable
through rebuild, LOD, resize, and disposal.
