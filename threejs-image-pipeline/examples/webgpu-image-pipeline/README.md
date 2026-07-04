# WebGPU Image Pipeline

This example is the canonical shared-gbuffer frame graph for
`threejs-image-pipeline`. It uses one `WebGPURenderer`, one `RenderPipeline`,
one scene `pass( scene, camera )`, and shared `mrt()` outputs for color,
normal, and emissive contribution.

Run static checks:

```bash
npm --prefix threejs-image-pipeline/examples/webgpu-image-pipeline run check
npm --prefix threejs-image-pipeline/examples/webgpu-image-pipeline run validate
```

## Checkpoint 1 — Scene HDR

Render the `scene HDR` diagnostic. You must see the base lit object before any
AO, bloom, LUT, or output conversion. If it is black while final output is
readable, presentation treatment is hiding missing scene signal.

## Checkpoint 2 — Raw And Linear Depth

Render the depth diagnostic from the scene pass before adding depth consumers.
You must see a stable foreground/background separation. If sky or background is
classified as near geometry, fog, AO, and refraction will all make wrong
decisions.

## Checkpoint 3 — Normal

Render the `normal` MRT. You must see view-space orientation change with the
camera and no color-space conversion. If the channel looks washed or posterized,
the normal signal has been treated as sRGB color.

## Checkpoint 4 — Emissive

Render the `emissive` MRT and `bloom contribution` view. You must see only HDR
emitters and bloom-driving surfaces. If the full beauty image appears in the
emissive view, selective bloom has regressed into a duplicated scene render.

## Checkpoint 5 — AO.r

Render `AO.r`. You must see indirect-visibility structure only. If direct light,
emissive pixels, or UI darken when AO is forced to zero, the graph is applying
AO to final color instead of lighting terms.

The validator also runs the same rule as a numeric contract and prints
`aoComposite.aoForcedZeroPreserves`. A failure here means AO is no longer
limited to indirect visibility.

## Checkpoint 6 — Pre/Post Tone Map

Verify that `renderOutput()` is the only tone-map and output-conversion owner
when `RenderPipeline.outputColorTransform = false`. If both
`outputColorTransform` and a manual output node are active, the image will
double-convert.

## Checkpoint 7 — Final Output

Render `final output`. It must preserve the no-post silhouette, emissive bloom
source, AO contribution, and color domain labels. If disabling bloom or AO
changes the graph shape or creates another scene pass, fix the producer/consumer
table first. Runtime inspection uses `setDebugMode()` against predeclared views;
switching modes must not create or remove pass graph nodes.

## Checkpoint 8 — Disable Paths

Use `validateImagePipelineConfig.js` to assert duplicate tone/output owners,
missing velocity convention, and undeclared MRT consumers fail before rendering:

```bash
node threejs-image-pipeline/examples/webgpu-image-pipeline/validateImagePipelineConfig.js --fixture duplicate-output-owner
node threejs-image-pipeline/examples/webgpu-image-pipeline/validateImagePipelineConfig.js --fixture double-output-transform
node threejs-image-pipeline/examples/webgpu-image-pipeline/validateImagePipelineConfig.js --fixture missing-velocity-convention
node threejs-image-pipeline/examples/webgpu-image-pipeline/validateImagePipelineConfig.js --fixture undeclared-mrt-consumer
```

Each command must exit nonzero. If an invalid graph reaches rendering, the
diagnostics are not trustworthy.
