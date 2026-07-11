# Native-WebGPU Procedural Field Bake Lab

This is the canonical `threejs-procedural-fields` lab. One deterministic field
algorithm supplies CPU values, analytic gradients, the complete domain-warp
Jacobian, TSL direct evaluation, compute-written storage textures, dependent
dirty mip regions, and structured placement records. The lab rejects a
non-WebGPU backend. Its checked-in Node tests establish algebra and CPU
derivatives; native-WebGPU acceptance remains incomplete until capture produces
direct, storage, mip, and placement readbacks on the current adapter. Filtered
consumption, full-domain parity, dirty-region execution, timing, and lifecycle
evidence remain separate production gates.

CPU and TSL import hash, octave, warp, and derived-channel coefficients from
`field-constants.mjs`; the validator asserts object identity for those
constants before artifact checks run. A multi-channel shader must call
`createFieldNodeBundle()` once. Named `.toVar()` nodes materialize the expensive
core once in generated WGSL. `sampleField()` and `sampleFieldDerived()` are
single-output wrappers for independent passes; calling both in one graph is a
contract violation. If one shader intentionally owns multiple independent
bundles, give each call a distinct WGSL-safe `varPrefix`.

`macroGradient` is expressed in the caller's original coordinate domain. The
stable-field derivative is first composed with the warp Jacobian, then pulled
back through the input transform: `0.125 I` for world coordinates,
`(I - rr^T)/|x|` for spherical normalization, and `I` for object coordinates.
`stableMacroGradient` remains available only as an explicit diagnostic. Slope
is derived from the norm of `macroGradient`, so sphere gradients are tangent
and world slopes retain their declared world-coordinate units.

The value-noise lattice uses an integer `u32` hash, not a transcendental
sin-dot hash. Floored cells are converted through the same i32-to-u32 bit
convention on CPU and GPU, mixed with odd lattice multipliers, then finalized
with lowbias32. CPU uses `Math.imul` and `>>> 0`; TSL uses `uint` bitwise nodes.
Seeds use a `u32` uniform. A float seed is forbidden because f32 cannot preserve
all integer hash identities.

## Strategy Cost Contract

`estimateFieldPathCosts()` evaluates, in one calibrated unit,

```text
Tinline = Qinline Einline
Tlocal  = Qlocal Elocal + Mlocal
Tbake   = [Dbake(Ebake + Wstore) + Tdispatch + Tmips] / U
          + sum_i Qi(Si + Bi / BWeffective,i)
```

`Q`/`D` are invocation counts, `U` is reuse in frames, `S` is texture-sample
cost, and `B/BW` accounts for traffic. Inputs must come from paired timestamp
measurements or a calibrated kernel microbenchmark on the target. The numbers
inside `validateBakePlanning()` test algebra only; they are not crossover
thresholds. Near a tie, `decideBakeStrategy()` prefers the lower-lifecycle path.

`createFieldStorageTexture()` enables automatic mip generation for smooth
sampled fields. In Three.js r185, a compute store marks the chain dirty and the
first later sampled binding generates it. Set `mipmapsAutoUpdate=false` only
with a complete per-level compute implementation and validation.

## Numerical Contract

The CPU golden file is checked at `1e-12` absolute error to detect fixture
changes. Browser readback is a different path: direct WGSL f32, with no storage
quantization or interpolation. Its limits come from
`FIELD_PARITY_ERROR_MANIFEST`:

- Direct per-channel absolute limits and the placement threshold guard are
  explicitly **Gated**, not claimed as a rounded-operation derivation.
- The conditional nearest-rounding bound for normalized `rgba16float` values
  below one is **Derived** from the format.
- Declared stored texels are gated by direct-f32 error plus fp16 rounding; mip
  gates accumulate one fp16 store and a conservative f32 box-filter term per
  level. Filtered interpolation and full-domain stored error remain unvalidated.

Builtins, FMA contraction, reassociation, subnormal handling, storage
quantization, and filtering are not collapsed into one tolerance.

## Checkpoints

Checkpoint `source coordinates`: must show stable sphere, world, or object
coordinates. If noise swims, the coordinate owner is camera-relative.

Checkpoint `warp`: must show tangent-only sphere warp. Radial movement before
height means the warp was applied to results rather than coordinates.

Checkpoint `bands`: must show distinct macro, ridge, cavity, and moisture
fields. One field driving every channel is an unstructured noise stack.

Checkpoint `packed atlas`: the declared layout is `r=macroHeight`, `g=ridge`,
`b=cavity`, `a=moisture`, with `NoColorSpace` data semantics.

Checkpoint `CPU-vs-TSL`: max and mean direct-f32 errors must remain under the
manifest gates. Seed-specific drift indicates constant or wrap divergence.
The GPU artifact must contain the complete
`gpuParityProbes-v3-original-domain-gradients` corpus,
including negative lattice coordinates, large stable coordinates, and
placement values inside and immediately outside the threshold guard band.

Checkpoint `direct-vs-baked`: `createFieldBakeSystem()` writes packed, derived,
and gradient `rgba16float` storage textures with `renderer.compute()` after
renderer initialization. It then writes an explicit mip pyramid. Dirty base
regions propagate to the exact dependent rectangle at every level. Capture
reads every level with the integer 256-byte-aligned WebGPU row stride and keeps
direct-f32 error separate from fp16 storage error.

Checkpoint `structured placement`: a deterministic, strictly ordered integer
index list contains only accepted semantic cells. The compute pass dispatches
that compact list and writes one `vec4` record per accepted cell: world X,
world Z, continuous placement mask, and a validity lane. Rejected cells are not
retained in the runtime record buffer. Fixed coverage tests still require both
accepted and rejected classes in the source corpus.

The tier graphs are mutually exclusive. `gpu-storage` owns the exact odd-size
`641x359` storage/mip graph plus compact placement buffers;
`gpu-direct-evaluate` retains no field textures or storage buffers; and
`precomputed-minimum` owns one immutable `512x512` generated field texture and
no runtime bake resources. Mechanism routes select distinct shader outputs,
and wrapper URLs reject attempts to change their locked mechanism or tier.

## Run

```sh
node threejs-procedural-fields/examples/webgpu-field-bake/validate-field-contract.mjs --allow-missing-gpu
node threejs-procedural-fields/examples/webgpu-field-bake/capture.mjs --artifacts /tmp/webgpu-field-bake
node threejs-procedural-fields/examples/webgpu-field-bake/validate-field-contract.mjs --artifacts /tmp/webgpu-field-bake
```

Without `--artifacts`, the JSON report truthfully records GPU proof as not run.
With artifacts, acceptance additionally requires direct f32, packed storage,
gradient storage, every explicit mip, and the placement buffer to reconcile
against the CPU oracle. GPU performance stays `INSUFFICIENT_EVIDENCE` until a
timestamp profile is captured; CPU intervals are never substituted.
