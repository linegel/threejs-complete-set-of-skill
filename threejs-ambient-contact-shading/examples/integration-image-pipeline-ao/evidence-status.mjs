import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateEvidenceBundle } from "../../../scripts/lib/evidence-v2.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "lab.manifest.json"), "utf8"));
const operation = process.argv[2] ?? "capture";

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

if (operation !== "validate:artifacts" && operation !== "validate-artifacts" && operation !== "capture") {
  throw new RangeError(`unknown AO evidence operation: ${operation}`);
}
if (operation === "capture") {
  // capture status only — point at lab-owned capture command
  if (!manifest.evidenceBundle) insufficient("no accepted evidenceBundle declared; run capture against browserEntry demo first");
  console.log(JSON.stringify({ lab: manifest.id, operation, verdict: "READY", evidenceBundle: manifest.evidenceBundle }, null, 2));
  process.exit(0);
}
if (manifest.evidenceBundle === null || manifest.evidenceBundle === undefined) {
  insufficient("lab.manifest.json declares no v2 evidenceBundle");
}
const bundlePath = join(root, "../../..", manifest.evidenceBundle);
if (!existsSync(bundlePath)) insufficient(`declared evidence bundle does not exist: ${manifest.evidenceBundle}`);
const result = validateEvidenceBundle(bundlePath);
if (!result.valid) {
  console.error(result.errors.join("\n"));
  process.exit(1);
}
console.log(`integration-image-pipeline-ao v2 evidence validated at ${manifest.evidenceBundle}`);
