# WebGPU shadow pipeline integration

This integration attaches the cached clipmap before graph compilation and uses
one `RenderPipeline`, one `renderOutput` tone-map/output owner, and the child
shadow targets sampled by the receiver graph. It remains incomplete until
native-WebGPU render-target, resource, timing, and lifecycle evidence is
captured on the current adapter.

The browser entry accepts public `scenario`, `mechanism`, `tier`, and `mode`
query keys and exposes the resolved selection through
`labController.getMetrics().routeSelection`.
