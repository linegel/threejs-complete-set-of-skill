import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateEvidenceBundle } from "../../scripts/lib/evidence-v2.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "lab.manifest.json"), "utf8"));
const operation = process.argv[2];

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

if (operation !== "validate-artifacts") throw new RangeError(`unknown Final Image Flight evidence operation: ${operation}`);
if (manifest.evidenceBundle === null) insufficient("lab.manifest.json declares no v2 evidenceBundle");

const bundlePath = join(root, "../..", manifest.evidenceBundle);
if (!existsSync(bundlePath)) insufficient(`declared evidence bundle does not exist: ${manifest.evidenceBundle}`);
const result = validateEvidenceBundle(bundlePath);
if (!result.valid) {
  console.error(result.errors.join("\n"));
  process.exit(1);
}
console.log(`Final Image Flight v2 evidence validated at ${manifest.evidenceBundle}`);
