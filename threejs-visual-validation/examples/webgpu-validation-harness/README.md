# WebGPU Validation Harness

This harness turns the validation protocol into a concrete JSON+PNG artifact
bundle. The Node command emits deterministic `node-schema-fixture` evidence for
schema testing; browser integrations replace the synthetic PNGs with real
`WebGPURenderer` canvas captures while keeping the same schema and file names.

Run:

```bash
npm --prefix threejs-visual-validation/examples/webgpu-validation-harness run validate -- --out /tmp/threejs-validation-demo
```

Expected result: `/tmp/threejs-validation-demo` contains
`visual-contract.json`, `evidence-manifest.json`, `renderer-info.json`,
`render-targets.json`, `storage-resources.json`, `timings.json`,
`leak-loop.json`, and `images/final.design.png`.

The validation script runs `src/validate.js`, which writes the bundle and then
executes `src/self-test.js`. The self-test corrupts generated bundles and proves
that final-only contracts, blank no-post PNGs, unlabelled CPU-only GPU timing,
GPU timing without a render timestamp, missing manifest `browser` / `os` /
`assets`, stale reduced-tier labels, manual camera evidence, leak deltas over
threshold, missing lifecycle loops, and fractional WebGPU readback strides are
rejected.

## Step 1 — Backend Manifest

Generate `renderer-info.json`. It must record `WebGPURenderer`, the actual
backend flag, `coordinateSystem`, `initialized`, `getOutputBufferType()` output,
`compatibilityMode`, `trackTimestamp`, nullable `features` and `limits`, and an
`unavailableReason` when a browser GPU device is not present.

Expected: Node fixture output labels the backend fields unavailable instead of
inventing capabilities. If a browser run leaves these fields absent, the
manifest is not valid evidence.

## Step 2 — Visual Contract

Open `visual-contract.json`. Each invariant must bind to `requiredImages`,
`requiredDiagnostics`, `requiredMetrics`, and `blockingFailures`.

Expected: a final-only contract fails validation. If only `images/final.design.png`
is required, the harness rejects the bundle.

## Step 3 — No-Post Capture

Inspect `images/no-post.design.png` and its binding in `visual-contract.json`.

Expected: the no-post image is nonblank and listed as required evidence, and
`evidence-manifest.json.camera` records fixed `matrixWorld` and
`projectionMatrix` arrays. If the capture is blank, missing, or manually
orbited from a different camera, the bundle is not valid.

## Step 4 — Diagnostics

Inspect `images/diagnostics.mosaic.png`, `render-targets.json`, and
`storage-resources.json`.

Expected: the mosaic is nonblank and the inventories name owners, dimensions,
formats, color semantics, lifetimes, memory, and storage/readback policy. If a
diagnostic channel has no owner, fix the pipeline before judging the final
image.

## Step 5 — Seed Sweep

Inspect `images/seed-0001.final.png` and `images/seed-stress.final.png`.

Expected: both are generated from deterministic seed labels. If a procedural
system cannot reproduce the same seed and camera matrices, screenshots are not
regression evidence.

## Step 6 — Temporal Checkpoints

Inspect `images/temporal.t000.png`, `images/temporal.t001.png`, and
`timings.json`.

Expected: timing records either GPU timestamp metrics or the exact label
`CPU-only proxy`. Missing GPU timing is not zero GPU cost.

## Step 7 — Leak Loop

Inspect `leak-loop.json`.

Expected: resize, DPR change, quality-tier switch, debug-mode switch, history
reset, asset reload, scene teardown, and dispose/recreate loops record
before/after resource counts, deltas, thresholds, pass/fail, and allowed cache
notes. A browser integration must replace the Node demo counts with real
`renderer.info` and target/storage inventories.
