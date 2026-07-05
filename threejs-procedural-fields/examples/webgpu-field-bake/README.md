# WebGPU Field Bake

Canonical Phase 1 field contract: one deterministic field bundle has a CPU
parity port, a TSL `Fn` owner, direct material reuse, and a `StorageTexture`
bake path when read count makes baking cheaper. CPU and TSL import hash,
octave, warp, and derived-channel coefficients from `field-constants.mjs`; the
validator asserts object identity for those constants before any artifact
checks run.

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
`field-readback.json`, checked at manifest `parityTolerance` (`0.001` in
`assets/generated-variants/manifest.json`).

Checkpoint `material consumer`: must see color, roughness, normals,
displacement, and placement masks sharing the named fields. if you see
unrelated channels, the material skipped the field contract.

Run:

```sh
node threejs-procedural-fields/examples/webgpu-field-bake/validate-field-contract.mjs --allow-missing-gpu
node threejs-procedural-fields/examples/webgpu-field-bake/capture.mjs --artifacts /tmp/webgpu-field-bake
node threejs-procedural-fields/examples/webgpu-field-bake/validate-field-contract.mjs --artifacts /tmp/webgpu-field-bake
```
