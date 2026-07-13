import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const operation = process.argv[2] ?? "capture";
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const sessionDir = resolve(
  process.env.LAB_ARTIFACT_DIR
    ?? resolve(root, "artifacts/visual-validation/integration-temporal-surface/correctness"),
);
const labId = "integration-temporal-surface";

if (operation === "capture") {
  console.error(JSON.stringify({
    verdict: "INSUFFICIENT_EVIDENCE",
    operation,
    lab: labId,
    reason: "real browser capture must run through npm run capture / capture-lab-browser; this local command never fabricates output",
  }, null, 2));
  process.exit(2);
}

if (operation !== "validate:artifacts" && operation !== "validate-artifacts") {
  throw new RangeError(`unknown temporal-surface integration evidence operation: ${operation}`);
}

const sessionPath = resolve(sessionDir, "capture-session.json");
if (!existsSync(sessionPath)) {
  console.error(JSON.stringify({
    verdict: "INSUFFICIENT_EVIDENCE",
    operation,
    lab: labId,
    reason: "no native-WebGPU v2 correctness capture-session exists yet",
    sessionDir,
  }, null, 2));
  process.exit(2);
}

const session = JSON.parse(readFileSync(sessionPath, "utf8"));
const metrics = session.finalRuntime?.metrics ?? session.runtime?.metrics ?? {};
const evidence = metrics.rendererBackendEvidence ?? {};
const errors = [];
if (session.labId !== labId) errors.push("capture-session labId mismatch");
if (metrics.nativeWebGPU !== true || evidence.isWebGPUBackend !== true) {
  errors.push("capture-session does not prove native WebGPU backend identity");
}
for (const file of [
  "final.design.png",
  "no-post.design.png",
  "diagnostics.mosaic.png",
  "camera.near.png",
  "camera.design.png",
  "camera.far.png",
  "seed-0001.final.png",
  "seed-9e3779b9.final.png",
  "temporal.t000.png",
  "temporal.t001.png",
]) {
  if (!existsSync(resolve(sessionDir, file))) errors.push(`missing ${file}`);
}

const payload = {
  schemaVersion: 2,
  lab: labId,
  operation,
  structuralVerdict: errors.length === 0 ? "PASS" : "FAIL",
  protocol: "correctness-capture-session",
  sourceHash: session.sourceHash ?? session.sourceClosureHash ?? null,
  nativeWebGPU: metrics.nativeWebGPU === true && evidence.isWebGPUBackend === true,
  claimVerdicts: {
    visualCorrectness: "INSUFFICIENT_EVIDENCE",
    mechanismCorrectness: "INSUFFICIENT_EVIDENCE",
    performanceCompliance: "NOT_CLAIMED",
    gpuAttribution: "NOT_CLAIMED",
    lifecycleStability: "INSUFFICIENT_EVIDENCE",
  },
  errors,
};
if (errors.length) {
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(payload, null, 2));
