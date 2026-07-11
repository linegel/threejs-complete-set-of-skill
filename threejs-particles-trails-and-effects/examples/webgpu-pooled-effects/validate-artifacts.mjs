import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateEvidenceBundle } from "../../../scripts/lib/evidence-v2.mjs";
import { buildDemoRegistry } from "../../../scripts/lib/lab-registry.mjs";
import { POOLED_EFFECT_MECHANISM_CLAIMS } from "./lab.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const bundleFlag = process.argv.indexOf("--bundle");
const bundleDir = resolve(
  here,
  bundleFlag >= 0 ? process.argv[bundleFlag + 1] : "../../../artifacts/visual-validation/webgpu-pooled-effects/correctness",
);
if (!existsSync(bundleDir)) {
  console.error(`webgpu-pooled-effects evidence is absent: ${bundleDir}`);
  process.exit(1);
}
const result = validateEvidenceBundle(bundleDir);
const registry = buildDemoRegistry();
const lab = registry.demos.find(({ id }) => id === "webgpu-pooled-effects");
const evidencePath = resolve(bundleDir, "evidence-manifest.json");
const errors = [...result.errors];
const pipelinePath = resolve(bundleDir, "pipeline-graph.json");
if (existsSync(pipelinePath)) {
  const pipeline = JSON.parse(readFileSync(pipelinePath, "utf8"));
  for (const key of ["owners", "signals", "sceneSubmissions", "computeDispatches", "resources", "finalToneMapOwner", "finalOutputTransformOwner"]) {
    if (!(key in pipeline)) errors.push(`pipeline-graph.json missing ${key}`);
  }
  if (pipeline.owners?.toneMap !== pipeline.finalToneMapOwner) errors.push("tone-map ownership mismatch");
  if (pipeline.owners?.outputColorTransform !== pipeline.finalOutputTransformOwner) {
    errors.push("output-color-transform ownership mismatch");
  }
}
const mechanismPath = resolve(bundleDir, "mechanism-metrics.json");
if (!existsSync(mechanismPath)) errors.push("missing mechanism-metrics.json GPU compaction readback");
else {
  const mechanism = JSON.parse(readFileSync(mechanismPath, "utf8"));
  if (mechanism.gpuReadback?.allValid !== true) {
    errors.push("GPU compaction identity/indirect readback is absent or invalid");
  }
  for (const claim of POOLED_EFFECT_MECHANISM_CLAIMS) {
    if (!["PASS", "FAIL", "INSUFFICIENT_EVIDENCE", "NOT_CLAIMED"].includes(mechanism.claimVerdicts?.[claim])) {
      errors.push(`mechanism-metrics.json missing claim-specific verdict ${claim}`);
    }
  }
  const allMechanismsPass = POOLED_EFFECT_MECHANISM_CLAIMS
    .every((claim) => mechanism.claimVerdicts?.[claim] === "PASS");
  if (mechanism.overallVerdict === "PASS" && !allMechanismsPass) {
    errors.push("mechanism-metrics.json globally passes while one or more mechanism claims lack PASS evidence");
  }
}
if (!existsSync(evidencePath)) errors.push("missing evidence-manifest.json for source-hash validation");
else {
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
  if (evidence.sourceHash !== lab?.sourceHash) {
    errors.push(`stale source hash: evidence ${evidence.sourceHash ?? "(missing)"}; canonical ${lab?.sourceHash ?? "(missing)"}`);
  }
  if (evidence.labId !== "webgpu-pooled-effects") errors.push("evidence labId mismatch");
  if (existsSync(mechanismPath)) {
    const mechanism = JSON.parse(readFileSync(mechanismPath, "utf8"));
    if (evidence.claimVerdicts?.mechanismCorrectness !== mechanism.overallVerdict) {
      errors.push("evidence mechanismCorrectness does not match mechanism-metrics overallVerdict");
    }
  }
}
if (errors.length > 0) {
  console.error(`webgpu-pooled-effects artifact validation failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`webgpu-pooled-effects evidence v2 passed: ${bundleDir}`);
