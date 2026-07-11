# Precipitation / Image-Pipeline Integration

This integration adapter consumes a host-owned native-WebGPU renderer,
`RenderPipeline`, primary scene pass, output graph, and shared weather/image
signals. It adds precipitation, wet/snow response, and impact resources to the
host scene without creating a renderer, scene pass, tone map, output transform,
or render call.

`index.html` is now a loadable native-WebGPU host for the adapter. It owns one
MRT scene pass and a stable `renderOutput` graph, exposes the standard lab
controller, acknowledges scenario/mechanism/tier wrapper queries, and captures
aligned render-target readback. Camera wrapping remains presentation-only;
accepted splash events originate from the world-cell receiver scheduler.

The v2 manifest remains `incomplete`: Node ownership and mutation tests pass,
but current-adapter browser readback, timing, visual, and lifecycle evidence has
not been captured. The browser route therefore proves an executable path, not
acceptance or a measured performance claim.

```bash
npm run validate:quick
```
