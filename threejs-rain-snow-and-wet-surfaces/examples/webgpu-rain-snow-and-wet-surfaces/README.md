# WebGPU Rain, Snow, And Wet Surfaces

Canonical Phase 1 contract for `threejs-rain-snow-and-wet-surfaces`.

## Checkpointed Build Order

1. Weather debug: one shared weather envelope feeds particles and surfaces. You
   must see identical `time`, `deltaTime`, `wind`, and `progress`; if you see
   drift, the likely mistake is separate clocks.
2. Storage buffer debug: position/life, velocity/life, and seed/flags records
   are storage-owned. You must see zero CPU instance-matrix uploads; if you see
   per-frame matrix mutation, the likely mistake is a CPU particle loop.
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
