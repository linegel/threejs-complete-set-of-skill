# WebGPU Rain, Snow, And Wet Surfaces

Native-WebGPU canonical lab for `threejs-rain-snow-and-wet-surfaces`.

The lab now has a browser entrypoint, a strict route parser, immutable analytic
rain/snow seed storage, camera-centred presentation wrapping, an optional
recurrent compute path, one instanced draw per precipitation family, and a
bounded storage-backed impact/splash ring. Physical impacts are generated from
camera-independent world cells and must pass a live receiver registry before
they enter GPU candidate storage. Wetness, puddle fill, and snow coverage are
integrated response states. The snow fixture is a multi-face model with
world-up and explicit occlusion rejection rather than an unconditional flat
plane. The generated ripple page remains an asset preview and is not canonical
runtime proof.

Every mechanism route applies a distinct runtime profile: it changes visible
stages, reachable analytic/recurrent position graphs, receiver work, and
compute dispatches. `setSeed()` replaces the actual seed, recurrent, impact,
and scheduler resources. Diagnostics come from the live scene/MRT, material
nodes, precipitation storage, and impact storage; there is no fullscreen
constant diagnostic table.

The manifest deliberately remains `incomplete` until the root capture runner
produces v2 native-WebGPU readback, timing, and lifecycle evidence. No synthetic
timing or screenshots are substituted.

Run static and numeric validation:

```bash
npm run validate:quick
```

Serve the repository root and open
`/threejs-rain-snow-and-wet-surfaces/examples/webgpu-rain-snow-and-wet-surfaces/`.
Mechanism and tier wrappers select fixed states through
`/mechanism/<id>/` and `/tier/<id>/`; the same implementation parses both.

## Checkpointed Build Order

1. Weather debug: one shared weather envelope feeds particles and surfaces. You
   must see identical `time`, `deltaTime`, `wind`, and `progress`; if you see
   drift, the likely mistake is separate clocks.
2. Storage buffer debug: immutable analytic seeds and optional recurrent
   offsets are storage-owned. You must see zero dynamic CPU instance-matrix
   uploads; if you see per-frame matrix mutation, the likely mistake is a CPU
   particle loop.
3. Camera-wrap edge test: rain and snow remain inside the camera-wrapped volume.
   If emitter bounds enter the shot, inspect seed-space wrap math.
4. Wetness mask: roughness changes before ripple normals. If ripples appear on
   dry asphalt, inspect progress bands.
5. Normals: snow displacement and normal use one height field; ripple normals
   come from dynamic fields or `ripple-normal-a/b/c` variants.
6. Impact occupancy: splash storage carries impact position, normal/tangent
   frame, progress/lifetime, atlas tile, and opacity.
7. Final: one `RenderPipeline` owns tone mapping and output conversion.

## Named Traps

- Trap: camera volume in world space, not screen space.
- Trap: model snow must be model locked and upward-normal gated.
- Trap: splash normals are world-space normals, not local untransformed normals.
- Trap: roughness response is tied to wetness before the ripple mask.
- Trap: sRGB-as-data breaks generated normal maps.
- Trap: output conversion belongs to the shared image pipeline.
- Trap: CPU matrix upload breaks the storage-instance budget.
