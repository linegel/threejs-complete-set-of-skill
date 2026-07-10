# Native WebGPU Validation Harness

This directory contains two deliberately separate surfaces:

- `index.html` is the canonical native-WebGPU subject. It initializes
  `WebGPURenderer`, rejects a non-WebGPU backend, renders a real NodeMaterial
  scene through one `RenderPipeline` and an `output + normal + emissive` MRT,
  and exposes the required `LabController` as `window.__THREEJS_LAB__`.
- the Node generators are **contract fixtures**. They test schema transport and
  mutations. Their synthetic images, authored timing sentinels, and one-cycle
  lifecycle records are permanently `bundleKind: "contract-fixture"`,
  `publishable: false`, and all claim verdicts are `NOT_CLAIMED`.

The fixture can never satisfy canonical acceptance. Only evidence captured
from the browser subject's render targets can do that.

## Commands

```bash
npm --prefix threejs-visual-validation/examples/webgpu-validation-harness run check
npm --prefix threejs-visual-validation/examples/webgpu-validation-harness run validate:v1
npm --prefix threejs-visual-validation/examples/webgpu-validation-harness run validate:v2
npm --prefix threejs-visual-validation/examples/webgpu-validation-harness run test:routes
npm --prefix threejs-visual-validation/examples/webgpu-validation-harness run test:mutations
npm --prefix threejs-visual-validation/examples/webgpu-validation-harness run validate:full
```

`validate:v1` retains the migration reader for old bundles. A v1 result is
always returned as non-publishable fixture evidence by
`src/schema/dispatcher.js`.

`validate:v2` writes a fixture under `/tmp`, validates all fourteen v2 JSON
artifacts and standard images, then runs the blocking mutation suite.

`validate:artifacts` and `validate:full` require a native browser bundle at
`artifacts/visual-validation/webgpu-validation-harness/current` (or
`LAB_EVIDENCE_DIR`). They intentionally exit nonzero with
`INSUFFICIENT_EVIDENCE` while only fixtures exist. `validate:quick` remains
browser-free.

## Browser subject

Serve the repository through the root Vite toolchain and open this directory's
`index.html`. The URL accepts fixed startup controls:

```text
?scenario=browser-capture&tier=webgpu-correctness&mode=final&camera=design&seed=1
```

Valid scenarios are:

```text
browser-capture
pipeline-graph-inspector
resource-ledger
timing-and-governor
lifecycle-and-leaks
visual-error-metrics
mutation-gallery
artifact-inspector
```

Valid modes are `final`, `no-post`, `normal`, and `emissive`. The debug modes
replace the actual `RenderPipeline.outputNode` and set
`renderPipeline.needsUpdate = true`; they are not labels over the final image.

The controller supports deterministic camera, tier, seed, time, step, resize,
history-reset, render, readback, pipeline-description, resource-description,
metrics, and disposal operations. Unknown scenario, mode, tier, seed, or camera
values throw.

Every declared mechanism and tier also has a physical wrapper under
`mechanism/<id>/index.html` or `tier/<id>/index.html`. Wrappers import the same
canonical subject through `src/locked-route.js`; their exposed controller
rejects attempts to change the locked scenario, mode, or tier.

## Capture invariants

- correctness: 1200×800 at DPR 1;
- odd-size readback: 641×359;
- fixed seeds: `0x00000001` and `0x9e3779b9`;
- render-target pixels, never a page screenshot, prove WebGPU output;
- row pitch is an integer aligned to 256 bytes and is unpacked explicitly;
- final, no-post, normal, and emissive are distinct graph routes;
- GPU timestamp failure is `INSUFFICIENT_EVIDENCE`, never zero or `SKIP`;
- lifecycle evidence requires 50–100 fresh create/render/resize/mode/tier/
  dispose cycles.

The current manifest stays `incomplete` until the browser capture, timestamp
sufficiency decision, and lifecycle run have produced a real v2 bundle on the
current adapter. Static and fixture tests do not change that status.

## Blocking mutations

`src/v2-self-test.js` proves rejection of:

```text
missing-label
final-only-evidence
false-diagnostic-route
stale-pipeline-graph
missing-timestamp
p95-overrun
governor-oscillation
visual-error-overrun
target-leak
storage-leak
unconfined-path
bad-padded-stride
duplicate-output-owner
baseline-equals-candidate
```
