import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateEvidenceBundle } from "../../scripts/lib/evidence-v2.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(root, "../..");
const manifest = JSON.parse(readFileSync(join(root, "lab.manifest.json"), "utf8"));
const operation = process.argv[2];
const sessionDir = join(
  process.env.LAB_ARTIFACT_DIR
    ?? join(repoRoot, "artifacts/visual-validation/relativistic-space-shot/correctness"),
);

function insufficient(reason) {
  console.error(JSON.stringify({
    lab: manifest.id,
    operation,
    verdict: "INSUFFICIENT_EVIDENCE",
    reason,
    syntheticBundleGenerated: false,
  }, null, 2));
  process.exit(2);
}

if (operation === "capture") {
  insufficient("real browser capture must run through the root native-WebGPU capture runner; this local command never fabricates output");
}
if (operation !== "validate-artifacts" && operation !== "validate:artifacts") {
  throw new RangeError(`unknown Relativistic Space Shot evidence operation: ${operation}`);
}

if (manifest.evidenceBundle) {
  const bundlePath = join(root, "../..", manifest.evidenceBundle);
  if (!existsSync(bundlePath)) insufficient(`declared evidence bundle does not exist: ${manifest.evidenceBundle}`);
  const result = validateEvidenceBundle(bundlePath);
  if (!result.valid) {
    console.error(result.errors.join("\n"));
    process.exit(1);
  }
  console.log(`Relativistic Space Shot v2 evidence validated at ${manifest.evidenceBundle}`);
  process.exit(0);
}

const sessionPath = join(sessionDir, "capture-session.json");
if (!existsSync(sessionPath)) {
  insufficient("no native-WebGPU correctness capture-session exists yet");
}
const session = JSON.parse(readFileSync(sessionPath, "utf8"));
const metrics = session.finalRuntime?.metrics ?? session.runtime?.metrics ?? {};
const evidence = metrics.rendererBackendEvidence ?? {};
const errors = [];
if (session.labId !== manifest.id) errors.push("capture-session labId mismatch");
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
  if (!existsSync(join(sessionDir, file))) errors.push(`missing ${file}`);
}
const payload = {
  schemaVersion: 2,
  lab: manifest.id,
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
