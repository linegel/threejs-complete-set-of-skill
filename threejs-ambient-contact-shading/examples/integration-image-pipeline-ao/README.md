# Image-pipeline AO integration lab

This lab composes the renderer-independent `createGTAOStage(...)` factory with
an image-pipeline host adapter. The image-pipeline host owns the renderer,
`RenderPipeline`, shared depth/normal/velocity prepass, tone mapping, and output
conversion. The AO stage owns GTAO, reconstruction, `builtinAOContext()`, and
the second context-lit scene submission.

The active integrated architecture is exact:

```text
image-pipeline shared gbuffer prepass: output + depth + normal + velocity
  -> stock GTAONode + optional materialized reconstruction
  -> AO-owned context-lit scene pass
  -> host-owned renderOutput
```

`describePipeline()` emits the shared runtime-graph v2 shape. Its validator
rejects a duplicate signal, resource, prepass, lit pass, tone-map owner, or
output-transform owner. Diagnostic modes retain the lit scene dependency with
a dynamic-zero TSL mix, so they inspect the same two-submission integration
instead of switching to a cheaper graph accidentally.

Run the permitted non-browser checks:

```bash
npm --prefix threejs-ambient-contact-shading/examples/integration-image-pipeline-ao run check
npm --prefix threejs-ambient-contact-shading/examples/integration-image-pipeline-ao run validate
```

The manifest remains `incomplete`. Static ownership and graph-construction
tests do not establish WebGPU compilation, pixels, GPU timestamps, or lifecycle
stability.
