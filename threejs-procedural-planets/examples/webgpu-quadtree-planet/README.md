# WebGPU Quadtree Planet

Canonical Phase 1 planet contract: one shared `planetFields()` schema feeds
cube-sphere quadtree displacement, material causes, patch bounds, diagnostics,
and atmosphere handoff.

## Checkpoints

Checkpoint `cube-face seam`: render debug `patch-level`. Expected adjacent
faces and same-face neighbors differ by at most one level. Wrong if a cube-face
seam or LOD crack appears between overlapping edges.

Checkpoint `pole singularity`: render debug `tangential-warp`. Expected smooth
warp magnitude over all six cube faces. Wrong if a pole swirl appears, because
that indicates latitude/longitude coordinates leaked into solid terrain.

Checkpoint `CPU/GPU drift`: render debug `parity-error`. Expected max and mean
error below the validator tolerance for three seeds. Wrong if macro ridges cross
geometry valleys.

Checkpoint `crater topology`: render debug `crater-channels`. Expected visible
craterFloor, craterWall, craterRim, and ejectaStrength separation. Wrong if
craters read as dark circles or color-only stains.

Checkpoint `sRGB-as-data`: render debug `biome-weights` and `atmosphere-masks`.
Expected data masks sampled as `NoColorSpace`. Wrong if reduced-tier crater
masks shift contrast after output conversion.

Checkpoint `double output conversion`: render final through the host pipeline.
Expected one `RenderPipeline.outputColorTransform` owner. Wrong if the planet
material applies a local display conversion.

## Validation

Run:

```sh
node threejs-procedural-planets/examples/webgpu-quadtree-planet/validate-planet.mjs
```

The command writes a JSON summary with `maxError`, `meanError`,
`worstDirection`, `seed`, and `preset`, and validates schema keys, crater
outputs, quadtree neighbor levels, dirty patch bounds, debug registry coverage,
asset ledger hashes, and WebGPU/TSL source sentinels.
