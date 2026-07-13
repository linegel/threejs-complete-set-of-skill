import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateEvidenceBundle } from "../../../scripts/lib/evidence-v2.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const index = process.argv.indexOf("--artifacts");
const bundleDir = resolve(
  index >= 0
    ? process.argv[index + 1]
    : (process.env.LAB_ARTIFACT_DIR ?? resolve(root, "artifacts/visual-validation/webgpu-quadtree-planet/correctness")),
);
const requireAllClaims = process.argv.includes("--require-all-claims");

if (!existsSync(bundleDir)) {
  console.error(JSON.stringify({
    schemaVersion: 2,
    labId: "webgpu-quadtree-planet",
    verdict: "INSUFFICIENT_EVIDENCE",
    bundleDir,
    reason: "artifact bundle does not exist",
  }, null, 2));
  process.exit(1);
}

const result = validateEvidenceBundle(bundleDir);
const errors = [...result.errors];
if (requireAllClaims && result.json["evidence-manifest.json"]) {
  for (const [claim, verdict] of Object.entries(result.json["evidence-manifest.json"].claimVerdicts ?? {})) {
    if (verdict !== "PASS") errors.push(`full acceptance requires ${claim}=PASS; received ${verdict}`);
  }
}
if (requireAllClaims && !result.json["evidence-manifest.json"]) {
  errors.push("full acceptance requires evidence-manifest.json");
}

console.log(JSON.stringify({
  schemaVersion: 2,
  labId: "webgpu-quadtree-planet",
  bundleDir,
  structuralVerdict: errors.length === 0 ? "PASS" : "FAIL",
  requireAllClaims,
  errors,
}, null, 2));
if (errors.length > 0) process.exitCode = 1;
