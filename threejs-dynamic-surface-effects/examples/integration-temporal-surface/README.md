# Temporal Surface / Image-Pipeline Integration

This adapter consumes host-owned scene color, depth, velocity, camera, temporal
reset registry, renderer, `RenderPipeline`, and final-output ownership. It owns
only the feature-local frost history and its scene-linear composite. The host
registers that composite before its sole tone map/output transform.

Viewport-locked frost history does not replace or privately clone the host
color history. Camera cuts, resize, DPR changes, projection changes, and other
host discontinuities clear both feature-local history slots through the shared
reset registry.

`index.html` is now a loadable native-WebGPU host for this adapter. A stable
mutable scene-linear node lets the host register the composite without changing
the final output-node identity. Generated scenario/mechanism/tier wrappers are
acknowledged through `getMetrics()`, and capture uses aligned render-target
readback rather than canvas screenshots.

The v2 manifest remains `incomplete` until native-browser readback, visual,
timing, and lifecycle evidence exists.

```bash
npm run validate:quick
```
