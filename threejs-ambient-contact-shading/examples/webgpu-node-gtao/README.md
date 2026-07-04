# WebGPU Node GTAO Example

This folder is the Phase 1 executable contract for ambient contact shading.
It uses `WebGPURenderer`, `RenderPipeline`, `pass()`, `mrt({ output, normal:
normalView })`, built-in `ao()`, optional `denoise()`, optional `traa()`, and
`builtinAOContext()` for material-context AO application.

Run:

```bash
npm --prefix threejs-ambient-contact-shading/examples/webgpu-node-gtao run check
npm --prefix threejs-ambient-contact-shading/examples/webgpu-node-gtao run validate
```

The validator is intentionally CPU/static. Browser WebGPU capture, screenshots,
GPU timings, and one-wall bent-normal visual proof remain Wave C work.

## Checkpoints

1. Checkpoint: MRT normal and pass depth.
   Expected: debug normals are stable and view-Z/depth separates sky from geometry.
   If you see black normals or inverted depth, fix `pass()`/`mrt()` ownership.
2. Checkpoint: raw `GTAONode` visibility.
   Expected: contact appears near receiver/wall and block/ground intersections.
   If you see whole-frame gray, radius units or depth mode are wrong.
3. Checkpoint: denoised visibility.
   Expected: thin silhouettes keep edge separation.
   If you see broad halos, lower thickness or add stronger normal-aware filtering.
4. Checkpoint: temporal mode.
   Expected: temporal AO requires velocity and camera-cut reset.
   If you see ghosting, disable temporal AO until velocity/rejection passes.
5. Checkpoint: material-context AO.
   Expected: indirect grounding changes while hard sun and emissive geometry stay bright.
   If you see sunlit or emissive surfaces gray out, a final-color darken path is active.
6. Checkpoint: disabled bypass.
   Expected: disabled AO uses the unmodified scene output and removes AO work from the pipeline.
   If you see unchanged pass cost, the pass was left active with zero intensity.
