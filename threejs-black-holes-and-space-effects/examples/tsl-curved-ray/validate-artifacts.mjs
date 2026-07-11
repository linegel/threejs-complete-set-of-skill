import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateEvidenceBundle } from "../../../scripts/lib/evidence-v2.mjs";
import { buildDemoRegistry } from "../../../scripts/lib/lab-registry.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const bundleFlag = process.argv.indexOf("--bundle");
const bundleDir = resolve(
  here,
  bundleFlag >= 0 ? process.argv[bundleFlag + 1] : "../../../artifacts/visual-validation/tsl-curved-ray/correctness",
);
if (!existsSync(bundleDir)) {
  console.error(`tsl-curved-ray evidence is absent: ${bundleDir}`);
  process.exit(1);
}
const result = validateEvidenceBundle(bundleDir);
const registry = buildDemoRegistry();
const lab = registry.demos.find(({ id }) => id === "tsl-curved-ray");
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
if (!existsSync(mechanismPath)) errors.push("missing mechanism-metrics.json direct metric readback");
else {
  const mechanism = JSON.parse(readFileSync(mechanismPath, "utf8"));
  if (mechanism.gpuReadback?.model !== "schwarzschild-convergence" ||
      mechanism.gpuReadback?.allValid !== true ||
      mechanism.gpuReadback?.probes?.length !== 3) {
    errors.push("three-level direct Schwarzschild GPU convergence readback is absent or invalid");
  }
}
if (!existsSync(evidencePath)) errors.push("missing evidence-manifest.json for source-hash validation");
else {
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
  if (evidence.sourceHash !== lab?.sourceHash) {
    errors.push(`stale source hash: evidence ${evidence.sourceHash ?? "(missing)"}; canonical ${lab?.sourceHash ?? "(missing)"}`);
  }
  if (evidence.labId !== "tsl-curved-ray") errors.push("evidence labId mismatch");
}
if (errors.length > 0) {
  console.error(`tsl-curved-ray artifact validation failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`tsl-curved-ray evidence v2 passed: ${bundleDir}`);
