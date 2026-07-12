import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateEvidenceBundle } from "../../../scripts/lib/evidence-v2.mjs";
import { buildDemoRegistry } from "../../../scripts/lib/lab-registry.mjs";

const labDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(labDirectory, "../../..");
const manifest = JSON.parse(readFileSync(join(labDirectory, "lab.manifest.json"), "utf8"));

export function validateMotionArtifacts(bundlePath = manifest.evidenceBundle) {
  const errors = [];
  const registryLab = buildDemoRegistry().demos.find((entry) => entry.id === manifest.id);
  if (!registryLab) errors.push(`registry does not contain ${manifest.id}`);
  if (manifest.status !== "accepted") {
    errors.push(`motion manifest status is ${manifest.status}; accepted artifacts cannot be claimed`);
  }
  if (bundlePath === null || bundlePath === undefined) {
    errors.push("motion evidenceBundle is absent");
  }
  const resolvedBundle = bundlePath
    ? resolve(repositoryRoot, bundlePath)
    : labDirectory;
  if (bundlePath && !existsSync(resolvedBundle)) {
    errors.push(`motion evidence bundle does not exist: ${bundlePath}`);
  }
  const shared = validateEvidenceBundle(resolvedBundle, {
    requireRequiredClaimsPass: true,
  });
  errors.push(...shared.errors.map((error) => `shared-v2: ${error}`));
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    bundlePath: bundlePath ?? null,
    resolvedBundle,
    sourceHash: registryLab?.sourceHash ?? null,
    shared,
  });
}

const result = validateMotionArtifacts();
if (!result.valid) {
  console.error(result.errors.join("\n"));
  process.exitCode = 2;
} else {
  console.log(JSON.stringify({
    labId: manifest.id,
    bundlePath: result.bundlePath,
    sourceHash: result.sourceHash,
    status: "PASS",
  }, null, 2));
}
