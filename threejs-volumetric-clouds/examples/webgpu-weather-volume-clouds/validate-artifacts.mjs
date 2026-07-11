import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outputAt = process.argv.indexOf("--output");
const output = resolve(outputAt >= 0 ? process.argv[outputAt + 1] : resolve(here, "../../../artifacts/visual-validation/webgpu-weather-volume-clouds"));
for (const path of [
  "pipeline-graph.json", "storage-resources.json", "renderer-info.json",
  "mechanism-metrics.json", "evidence-manifest.json", "images/final.design.png",
  "images/no-post.design.png", "images/diagnostics.mosaic.png",
]) await access(resolve(output, path));
const renderer = JSON.parse(await readFile(resolve(output, "renderer-info.json"), "utf8"));
const resources = JSON.parse(await readFile(resolve(output, "storage-resources.json"), "utf8"));
const evidence = JSON.parse(await readFile(resolve(output, "evidence-manifest.json"), "utf8"));
if (renderer.backendIsWebGPU !== true) throw new Error("Cloud artifact renderer is not native WebGPU");
if (resources.representativeDepthFormat !== "R32F meters") throw new Error("Cloud artifact omitted metric R32F representative depth");
if (evidence.schemaVersion !== 2) throw new Error("Cloud artifacts require evidence schema v2");
if (!Array.isArray(evidence.claims)) throw new Error("Cloud evidence requires claim-specific verdicts");
const allowedVerdicts = new Set(["PASS", "FAIL", "INSUFFICIENT_EVIDENCE", "NOT_CLAIMED"]);
const requiredIds = new Set([
  "native-webgpu-runtime",
  "aligned-render-target-readback",
  "bounded-compute-dispatch",
  "metric-r32f-depth-resource",
  "current-adapter-gpu-timing",
  "temporal-disocclusion-error",
  "high-step-transport-reference",
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

const dispatchClaim = claims.get("bounded-compute-dispatch");
if (dispatchClaim.verdict === "PASS") {
  const metrics = JSON.parse(await readFile(resolve(output, dispatchClaim.evidence), "utf8"));
  if (!((metrics.rendererInfo?.compute?.calls ?? 0) >= 3)) throw new Error("Cloud dispatch PASS lacks recorded shadow, beauty, and temporal compute calls");
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
const temporalClaim = claims.get("temporal-disocclusion-error");
if (temporalClaim.verdict === "PASS") {
  if (!temporalClaim.evidence) throw new Error("Temporal PASS requires visual-error evidence");
  const temporal = JSON.parse(await readFile(resolve(output, temporalClaim.evidence), "utf8"));
  if (!(temporal.verdict === "PASS" && temporal.disocclusionRejectedFraction >= 0.9)) {
    throw new Error("Temporal PASS requires at least 90% measured disocclusion rejection");
  }
}
const lifecycleClaim = claims.get("lifecycle-stability");
if (lifecycleClaim.verdict === "PASS") {
  if (!lifecycleClaim.evidence) throw new Error("Lifecycle PASS requires leak-loop evidence");
  const lifecycle = JSON.parse(await readFile(resolve(output, lifecycleClaim.evidence), "utf8"));
  if (!(lifecycle.verdict === "PASS" && lifecycle.cycles >= 50)) throw new Error("Lifecycle PASS requires at least 50 measured cycles");
}
const unresolved = [...requiredIds]
  .map((id) => claims.get(id))
  .filter((claim) => claim.verdict !== "PASS");
if (unresolved.length > 0) {
  throw new Error(`Required cloud evidence is not passing:\n${unresolved.map((claim) => `${claim.id}: ${claim.verdict}`).join("\n")}`);
}
console.log(JSON.stringify({ pass: true, output, requiredClaims: [...requiredIds] }, null, 2));
