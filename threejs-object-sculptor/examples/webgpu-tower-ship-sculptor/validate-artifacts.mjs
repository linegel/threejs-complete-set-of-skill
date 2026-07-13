import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const bundleDir = resolve(process.env.LAB_ARTIFACT_DIR ?? resolve(root, "artifacts/visual-validation/webgpu-tower-ship-sculptor/correctness"));

if (!existsSync(bundleDir)) {
  console.error(JSON.stringify({
    schemaVersion: 2,
    labId: "webgpu-tower-ship-sculptor",
    verdict: "INSUFFICIENT_EVIDENCE",
    bundleDir,
    reason: "artifact bundle does not exist",
  }, null, 2));
  process.exit(1);
}

const requiredImages = [
  // Normative standard capture outputs
  "final.design.png",
  "diagnostics.mosaic.png",
  "camera.near.png",
  "camera.design.png",
  "camera.far.png",
  "seed-0001.final.png",
  "seed-9e3779b9.final.png",
  "temporal.t000.png",
  "temporal.t001.png",
  // Lab-owned mechanism / tier evidence
  "blockout.design.png",
  "hierarchy.design.png",
  "materials.close.png",
  "interaction.design.t000.png",
  "interaction.design.t120.png",
  "camera.profile.png",
  "camera.bow.png",
  "tier.budgeted.png",
  "tier.minimum.png",
];
const errors = [];
for (const image of requiredImages) {
  if (!existsSync(resolve(bundleDir, image))) errors.push(`missing required image ${image}`);
}

const sessionPath = resolve(bundleDir, "capture-session.json");
if (!existsSync(sessionPath)) {
  errors.push("missing capture-session.json");
} else {
  const session = JSON.parse(readFileSync(sessionPath, "utf8"));
  const metrics = session.runtime?.metrics;
  const pipeline = session.runtime?.pipeline;
  const captures = session.hookResult?.captures ?? [];
  const backend = String(metrics?.backend ?? metrics?.backendKind ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (session.schemaVersion !== 2) errors.push("capture session must use schemaVersion 2");
  if (session.labId !== "webgpu-tower-ship-sculptor") errors.push("capture session labId mismatch");
  if (session.profile !== "correctness") errors.push("capture session must use the correctness profile");
  if (metrics?.nativeWebGPU !== true || !new Set(["webgpu", "webgpubackend"]).has(backend)) {
    errors.push("capture session did not prove native WebGPU");
  }
  if (metrics?.initialized !== true || metrics?.firstFrameCompleted !== true) {
    errors.push("capture session did not complete its first frame");
  }
  if (metrics?.lastFrameError !== null && metrics?.lastFrameError !== undefined) {
    errors.push("capture session recorded a frame error");
  }
  if (pipeline?.owner !== "WebGPURenderer" || pipeline?.sceneRendersPerFrame !== 1) {
    errors.push("capture session did not preserve single-renderer/single-scene ownership");
  }
  if (pipeline?.finalOutputOwner !== "renderer") {
    errors.push("capture session final output owner drifted");
  }
  const colorSpace = String(pipeline?.outputColorSpace ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!new Set(["srgb", "srgbcolorspace"]).has(colorSpace)) {
    errors.push("capture session output color space drifted");
  }
  if (session.hookResult?.evidenceStatus !== "INCOMPLETE") {
    errors.push("capture hook must preserve the incomplete claim boundary");
  }
  if (captures.length !== requiredImages.length) {
    errors.push(`expected ${requiredImages.length} captures, received ${captures.length}`);
  }
  const seen = new Set();
  for (const capture of captures) {
    seen.add(capture.filename);
    if (!requiredImages.includes(capture.filename)) errors.push(`unexpected capture ${capture.filename}`);
    if (capture.format !== "rgba8" || capture.colorEncoding !== "srgb") {
      errors.push(`${capture.filename} is not explicit color-managed RGBA8`);
    }
    if (capture.bytesPerRow !== capture.width * 4) {
      errors.push(`${capture.filename} compact row stride mismatch`);
    }
    if (capture.sourceBytesPerRow < capture.bytesPerRow || capture.sourceBytesPerRow % 256 !== 0) {
      errors.push(`${capture.filename} source row stride is not 256-byte aligned`);
    }
    const shortPaddedByteLength = capture.sourceBytesPerRow * (capture.height - 1) + capture.bytesPerRow;
    const fullyPaddedByteLength = capture.sourceBytesPerRow * capture.height;
    if (capture.sourceByteLength !== shortPaddedByteLength && capture.sourceByteLength !== fullyPaddedByteLength) {
      errors.push(`${capture.filename} source byte length mismatch`);
    }
    if (capture.sourceLayout !== "padded") {
      errors.push(`${capture.filename} did not preserve padded readback evidence`);
    }
  }
  for (const image of requiredImages) {
    if (!seen.has(image)) errors.push(`capture session missing ${image}`);
  }
}

console.log(JSON.stringify({
  schemaVersion: 2,
  labId: "webgpu-tower-ship-sculptor",
  bundleDir,
  structuralVerdict: errors.length ? "FAIL" : "PASS",
  claimVerdict: "INCOMPLETE",
  errors,
}, null, 2));
if (errors.length) process.exitCode = 1;
