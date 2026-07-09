import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertNonBlankGeneratedPng,
  compareGeneratedRgbaPngs,
  decodeGeneratedRgbaPixels,
} from "../../../threejs-visual-validation/examples/webgpu-validation-harness/src/png.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const outputIndex = process.argv.indexOf("--output");
const output = resolve(
  outputIndex >= 0
    ? process.argv[outputIndex + 1]
    : process.env.LAB_ARTIFACT_DIR ??
      resolve(repoRoot, "artifacts/visual-validation/webgpu-cached-clipmap-shadow"),
);
const requireAllClaims = process.argv.includes("--require-all-claims");
const verdicts = new Set(["PASS", "FAIL", "INSUFFICIENT_EVIDENCE", "NOT_CLAIMED"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function channelRange(image, channel) {
  let minimum = 255;
  let maximum = 0;
  for (let index = channel; index < image.pixels.length; index += 4) {
    minimum = Math.min(minimum, image.pixels[index]);
    maximum = Math.max(maximum, image.pixels[index]);
  }
  return maximum - minimum;
}

async function json(filename) {
  return JSON.parse(await readFile(resolve(output, filename), "utf8"));
}

const requiredJson = [
  "evidence-manifest.json",
  "renderer-info.json",
  "pipeline-graph.json",
  "resident-resources.json",
  "render-targets.json",
  "mechanism-metrics.json",
  "capture-status.json",
];
const requiredImages = [
  "final.design.png",
  "shadow-contribution.png",
  "shadow-depth.png",
  "level-centers.png",
  "level-validity.png",
  "scheduler.png",
  "silhouette-parity.png",
  "owner-graph.png",
  "odd-641x359.shadow-depth.png",
];

try {
  for (const filename of requiredJson) await access(resolve(output, filename));
  for (const filename of requiredImages) {
    await access(resolve(output, "images", filename));
  }
} catch (error) {
  console.error(JSON.stringify({
    schemaVersion: 2,
    labId: "webgpu-cached-clipmap-shadow",
    verdict: "INSUFFICIENT_EVIDENCE",
    output,
    reason: error.message,
  }, null, 2));
  process.exit(2);
}

const manifest = await json("evidence-manifest.json");
const renderer = await json("renderer-info.json");
const pipeline = await json("pipeline-graph.json");
const resources = await json("resident-resources.json");
const targets = await json("render-targets.json");
const metrics = await json("mechanism-metrics.json");
const status = await json("capture-status.json");
assert(["correctness", "performance"].includes(status.profile), `unknown capture profile ${status.profile}`);
const primaryExtent = status.profile === "performance" ? [1920, 1080] : [1200, 800];
for (const [filename, value] of [
  ["evidence-manifest.json", manifest],
  ["renderer-info.json", renderer],
  ["pipeline-graph.json", pipeline],
  ["resident-resources.json", resources],
  ["render-targets.json", targets],
  ["mechanism-metrics.json", metrics],
  ["capture-status.json", status],
]) {
  assert(value.schemaVersion === 2, `${filename} must declare schemaVersion 2`);
}

assert(renderer.renderer === "WebGPURenderer", "capture did not use WebGPURenderer");
assert(renderer.backend?.isWebGPUBackend === true, "capture did not prove a native WebGPU backend");
assert(["185", "0.185.1"].includes(renderer.threeRevision), "capture used the wrong Three revision");
assert(status.browserErrors.length === 0, `browser emitted errors: ${status.browserErrors.join("\n")}`);
assert(pipeline.owners?.renderer === "canonical-shadow-lab", "renderer ownership drifted");
assert(pipeline.owners?.finalRenderPipeline === "canonical-shadow-lab", "RenderPipeline ownership drifted");
assert(pipeline.finalToneMapOwner === "renderOutput", "tone-map owner drifted");
assert(pipeline.finalOutputTransformOwner === "renderOutput", "output-transform owner drifted");
assert(pipeline.renderPipelineOutputColorTransform === false, "RenderPipeline output transform must be disabled when renderOutput owns presentation");
assert(pipeline.routeSelection?.mechanism === "cached-clipmap", "capture did not select the cached-clipmap mechanism");
assert(metrics.parityCasterClasses?.includes("skinned-two-bone"), "representative skinned caster is absent");
assert(resources.transientAndStagingVerdict === "INSUFFICIENT_EVIDENCE", "unknown transient residency was promoted as measured");

const readbacks = targets.readbacks ?? [];
assert(readbacks.length === requiredImages.length, "render-target inventory does not match captured images");
for (const readback of readbacks) {
  const rowBytes = readback.rowBytes?.value;
  const bytesPerRow = readback.bytesPerRow?.value;
  const sourceBytesPerRow = readback.sourceBytesPerRow?.value;
  assert(Number.isInteger(rowBytes) && rowBytes === readback.width * 4, `${readback.id} has an invalid packed row size`);
  assert(Number.isInteger(bytesPerRow) && bytesPerRow >= rowBytes && bytesPerRow % 256 === 0, `${readback.id} has an invalid aligned copy stride`);
  assert(Number.isInteger(sourceBytesPerRow) && sourceBytesPerRow >= rowBytes, `${readback.id} has an invalid measured source stride`);
  assert(readback.byteLength === rowBytes * readback.height, `${readback.id} packed byte length does not reconcile`);
  const validSourceLengths = new Set([
    sourceBytesPerRow * readback.height,
    sourceBytesPerRow * (readback.height - 1) + rowBytes,
  ]);
  assert(validSourceLengths.has(readback.sourceByteLength), `${readback.id} source byte length does not reconcile with its measured stride`);
  assert(readback.bytesPerRow.label === "Derived", `${readback.id} aligned stride lacks numeric provenance`);
  assert(readback.sourceBytesPerRow.label === "Measured", `${readback.id} source stride lacks numeric provenance`);
}

const decoded = new Map();
for (const filename of requiredImages) {
  const buffer = await readFile(resolve(output, "images", filename));
  const image = decodeGeneratedRgbaPixels(buffer);
  decoded.set(filename, { buffer, ...image });
  assertNonBlankGeneratedPng(buffer, filename);
  const expected = filename.startsWith("odd-") ? [641, 359] : primaryExtent;
  assert(image.width === expected[0] && image.height === expected[1], `${filename} has the wrong dimensions`);
}
assert(channelRange(decoded.get("shadow-depth.png"), 0) > 8, "actual shadow-depth diagnostic is constant");
assert(channelRange(decoded.get("shadow-contribution.png"), 0) > 8, "shadow-contribution diagnostic is constant");
const parity = decoded.get("silhouette-parity.png");
let visibleParityPixels = 0;
for (let index = 1; index < parity.pixels.length; index += 4) {
  if (parity.pixels[index] > 16) visibleParityPixels += 1;
}
assert(visibleParityPixels >= 100, "caster-parity diagnostic contains no representative caster coverage");
assert(visibleParityPixels < parity.width * parity.height * 0.5, "caster-parity diagnostic is an unbounded full-frame mask");
for (const readback of readbacks) {
  const image = decoded.get(readback.file.replace(/^images\//, ""));
  if (!image) continue;
  const pixelHash = `sha256:${createHash("sha256").update(image.pixels).digest("hex")}`;
  assert(readback.sha256 === pixelHash, `${readback.id} recorded pixel hash does not match its PNG`);
}
for (const filename of requiredImages.filter((name) => name !== "final.design.png" && !name.startsWith("odd-"))) {
  const difference = compareGeneratedRgbaPngs(
    decoded.get("final.design.png").buffer,
    decoded.get(filename).buffer,
  );
  assert(
    difference.ratio > 0.001 && difference.maxChannelDelta > 4,
    `${filename} duplicates or negligibly differs from final.design.png`,
  );
}

for (const [claim, verdict] of Object.entries(manifest.claimVerdicts ?? {})) {
  assert(verdicts.has(verdict), `claim ${claim} has invalid verdict ${verdict}`);
  if (requireAllClaims) assert(verdict === "PASS", `full acceptance requires ${claim}=PASS; received ${verdict}`);
}
assert(
  Object.values(manifest.claimVerdicts ?? {}).every((value) => value === "INSUFFICIENT_EVIDENCE"),
  "candidate capture silently promoted an unvalidated acceptance claim",
);

console.log(JSON.stringify({
  schemaVersion: 2,
  labId: "webgpu-cached-clipmap-shadow",
  structuralVerdict: "PASS",
  acceptanceVerdict: "INSUFFICIENT_EVIDENCE",
  requireAllClaims,
  output,
  readbacks: readbacks.length,
  note: "Real candidate evidence is structurally sound; numeric ROI, GPU timing, lifecycle, and full v2 bundle gates remain pending.",
}, null, 2));
