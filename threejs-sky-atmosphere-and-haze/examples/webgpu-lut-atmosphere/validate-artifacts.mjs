import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outputAt = process.argv.indexOf("--output");
const output = resolve(outputAt >= 0 ? process.argv[outputAt + 1] : resolve(here, "../../../artifacts/visual-validation/webgpu-lut-atmosphere/correctness"));
for (const path of [
  "pipeline-graph.json", "storage-resources.json", "renderer-info.json",
  "mechanism-metrics.json", "evidence-manifest.json", "images/final.design.png",
  "images/no-post.design.png", "images/diagnostics.mosaic.png",
]) await access(resolve(output, path));
const renderer = JSON.parse(await readFile(resolve(output, "renderer-info.json"), "utf8"));
const evidence = JSON.parse(await readFile(resolve(output, "evidence-manifest.json"), "utf8"));
if (renderer.backendIsWebGPU !== true) throw new Error("Artifact renderer is not native WebGPU");
if (evidence.schemaVersion !== 2) throw new Error("Atmosphere artifacts require evidence schema v2");
if (!Array.isArray(evidence.claims)) throw new Error("Atmosphere evidence requires claim-specific verdicts");
const allowedVerdicts = new Set(["PASS", "FAIL", "INSUFFICIENT_EVIDENCE", "NOT_CLAIMED"]);
const requiredIds = new Set([
  "native-webgpu-runtime",
  "aligned-render-target-readback",
  "five-stage-compute-dispatch",
  "live-camera-body-depth-composition",
  "cumulative-aerial-xy-rays",
  "current-adapter-gpu-timing",
  "reference-radiance-and-energy",
  "lifecycle-stability",
]);
const claims = new Map();
for (const claim of evidence.claims) {
  if (!claim?.id || claims.has(claim.id)) throw new Error(`Invalid or duplicate evidence claim ${claim?.id}`);
  if (!allowedVerdicts.has(claim.verdict)) throw new Error(`Invalid claim verdict ${claim.id}:${claim.verdict}`);
  claims.set(claim.id, claim);
}
for (const id of requiredIds) {
  const claim = claims.get(id);
  if (!claim || claim.required !== true) throw new Error(`Missing required evidence claim ${id}`);
  if (claim.verdict === "PASS") {
    if (!claim.evidence) throw new Error(`Required PASS claim ${id} has no evidence path`);
    await access(resolve(output, claim.evidence));
  }
}

const dispatchClaim = claims.get("five-stage-compute-dispatch");
if (dispatchClaim.verdict === "PASS") {
  const metrics = JSON.parse(await readFile(resolve(output, dispatchClaim.evidence), "utf8"));
  if (!((metrics.rendererInfo?.compute?.calls ?? 0) >= 5)) throw new Error("Five-stage dispatch claim lacks five recorded compute calls");
}
const hostCompositionClaim = claims.get("live-camera-body-depth-composition");
if (hostCompositionClaim.verdict === "PASS") {
  const graph = JSON.parse(
    await readFile(resolve(output, hostCompositionClaim.evidence), "utf8"),
  );
  if (
    graph.owners?.sceneDepth !== "browser host PassNode depth" ||
    graph.owners?.bodyTransform !== "planet.matrixWorld" ||
    !graph.finalComposition?.includes("aerialOpticalDepth")
  ) {
    throw new Error("Live host composition PASS lacks actual depth/body/final graph ownership");
  }
}
const cumulativeClaim = claims.get("cumulative-aerial-xy-rays");
if (cumulativeClaim.verdict === "PASS") {
  const resources = JSON.parse(
    await readFile(resolve(output, cumulativeClaim.evidence), "utf8"),
  );
  const aerial = resources.products?.find(
    (product) => product.kernelId === "aerial-products",
  );
  if (
    aerial?.invocationTopology !==
      "one invocation per XY ray; cumulative Z loop inside the kernel" ||
    aerial.invocationCount !== aerial.dimensions.width * aerial.dimensions.height
  ) {
    throw new Error("Cumulative aerial PASS lacks one-invocation-per-XY topology");
  }
}
const timingClaim = claims.get("current-adapter-gpu-timing");
if (timingClaim.verdict === "PASS") {
  if (!timingClaim.evidence) throw new Error("GPU timing PASS requires performance-envelope evidence");
  const timing = JSON.parse(await readFile(resolve(output, timingClaim.evidence), "utf8"));
  const gpu = timing.gpuFrameMs;
  if (!(gpu?.source === "timestamp-query" && Number.isFinite(gpu.p50) && Number.isFinite(gpu.p95) && gpu.samples >= 60)) {
    throw new Error("GPU timing PASS requires timestamp-query p50/p95 with at least 60 samples");
  }
}
const lifecycleClaim = claims.get("lifecycle-stability");
if (lifecycleClaim.verdict === "PASS") {
  if (!lifecycleClaim.evidence) throw new Error("Lifecycle PASS requires leak-loop evidence");
  const lifecycle = JSON.parse(await readFile(resolve(output, lifecycleClaim.evidence), "utf8"));
  if (!(lifecycle.verdict === "PASS" && lifecycle.cycles >= 50)) throw new Error("Lifecycle PASS requires at least 50 measured cycles");
}
// Correctness claims that a native browser capture can honestly settle must PASS.
// Timing, reference-radiance, and lifecycle remain residual until hardware/lifecycle
// suites are bound — those may stay INSUFFICIENT_EVIDENCE without failing the
// structural correctness gate.
const correctnessMustPass = [
  "native-webgpu-runtime",
  "aligned-render-target-readback",
  "five-stage-compute-dispatch",
  "live-camera-body-depth-composition",
  "cumulative-aerial-xy-rays",
];
const residualAllowed = new Set([
  "current-adapter-gpu-timing",
  "reference-radiance-and-energy",
  "lifecycle-stability",
]);
const unresolved = correctnessMustPass
  .map((id) => claims.get(id))
  .filter((claim) => claim.verdict !== "PASS");
if (unresolved.length > 0) {
  throw new Error(`Required atmosphere correctness evidence is not passing:\n${unresolved.map((claim) => `${claim.id}: ${claim.verdict}`).join("\n")}`);
}
for (const id of residualAllowed) {
  const claim = claims.get(id);
  if (claim.verdict === "PASS") {
    // Residual PASS still requires the dedicated evidence checks above.
    continue;
  }
  if (claim.verdict !== "INSUFFICIENT_EVIDENCE" && claim.verdict !== "NOT_CLAIMED") {
    throw new Error(`Residual claim ${id} has unexpected verdict ${claim.verdict}`);
  }
}
console.log(JSON.stringify({
  pass: true,
  output,
  requiredClaims: [...requiredIds],
  correctnessPass: correctnessMustPass,
  residualIncomplete: [...residualAllowed].filter((id) => claims.get(id).verdict !== "PASS"),
}, null, 2));
