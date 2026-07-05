# WebGPU Field Bake

Canonical Phase 1 field contract: one deterministic field bundle has a CPU
parity port, a TSL `Fn` owner, direct material reuse, and a `StorageTexture`
bake path when read count makes baking cheaper. CPU and TSL import hash,
octave, warp, and derived-channel coefficients from `field-constants.mjs`; the
validator asserts object identity for those constants before any artifact
checks run.

The value-noise lattice uses an integer `u32` hash, not a transcendental
sin-dot hash: `floor`ed cell coordinates are converted through an i32-to-u32
bit convention, mixed with odd lattice multipliers, then finalized with the
lowbias32 integer mixer. CPU uses `Math.imul` and `>>> 0`; TSL uses `uint`
bitwise node math. Hash corners are identical by construction, so the remaining
CPU-vs-GPU error budget is only f32-vs-f64 arithmetic in coordinate scaling,
smoothstep weights, trilinear lerps, octave accumulation, warp, and channel
mapping.

## Checkpoints

Checkpoint `source coordinates`: must see stable sphere, world, or object
coordinates. if you see swimming noise, the coordinate owner is camera-relative.

Checkpoint `warp`: must see tangent-only sphere warp. if you see radial bulges
before height is applied, the warp was applied to results instead of
coordinates.

Checkpoint `bands`: must see separate macro, ridge, cavity, and moisture
fields. if you see one texture driving everything, the stack has collapsed into
noise soup.

Checkpoint `packed atlas`: must see `r=macroHeight`, `g=ridge`, `b=cavity`,
`a=moisture`. if you see color-managed masks, the atlas is not `NoColorSpace`.

Checkpoint `direct-vs-baked`: must see the same values from inline evaluation
and the compute atlas. if you see stale tiles, dirty-tile invalidation is
missing.

Checkpoint `CPU-vs-TSL`: must see max and mean errors under tolerance. if you
see seed-specific drift, constants or seed wrapping diverged. Layer 1 is the
CPU golden fixture in `field-golden-fixtures.json`, checked at `1e-12` absolute
error by `validate-field-contract.mjs`. Layer 2 is browser WebGPU readback in
`field-readback.json`, checked per channel at `1e-4`. Derivation: f32 unit
roundoff is `u=2^-24`; the deepest chain is bounded by <=384 rounded ops, so
`gamma_384 ~= 2.29e-5`; a 4.4x margin covers warp Lipschitz amplification and
driver pow decomposition. Placement-mask threshold consumers use a `1e-4`
guard band around threshold `0.5`; outside that band the thresholded bit must
match.

Checkpoint `material consumer`: must see color, roughness, normals,
displacement, and placement masks sharing the named fields. if you see
unrelated channels, the material skipped the field contract.

Run:

```sh
node threejs-procedural-fields/examples/webgpu-field-bake/validate-field-contract.mjs --allow-missing-gpu
node threejs-procedural-fields/examples/webgpu-field-bake/capture.mjs --artifacts /tmp/webgpu-field-bake
node threejs-procedural-fields/examples/webgpu-field-bake/validate-field-contract.mjs --artifacts /tmp/webgpu-field-bake
```
