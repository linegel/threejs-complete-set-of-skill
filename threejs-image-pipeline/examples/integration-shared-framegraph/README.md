# Wave D Shared Framegraph Contract

This folder is the Phase 2 / Wave D ownership gate for the integration scene.
It is not browser proof by itself. It makes the required single-owner contract
executable while Wave C browser/GPU access is blocked.

Run:

```bash
npm --prefix threejs-image-pipeline/examples/integration-shared-framegraph run check
```

Expected result:

- one `WebGPURenderer`;
- one `RenderPipeline`;
- one scene render;
- one shared `scenePass.setMRT(mrt(...))` gbuffer owner;
- one velocity field owner;
- one weather envelope owner;
- one tone-map owner;
- one output-transform owner;
- no sibling system owns a private post/output pipeline.

The validator rejects duplicate gbuffer writers and private sibling post owners.
Live Phase 2 acceptance still requires the browser/GPU evidence listed in
[../../../artifacts/visual-validation/wave-c-status.md](../../../artifacts/visual-validation/wave-c-status.md).
