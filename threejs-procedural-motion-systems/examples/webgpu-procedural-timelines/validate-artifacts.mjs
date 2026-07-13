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
  const defaultCandidate = "artifacts/visual-validation/webgpu-procedural-timelines/correctness";
  const effectiveBundle = bundlePath ?? defaultCandidate;
  const requireAccepted = manifest.status === "accepted";
  if (requireAccepted && (bundlePath === null || bundlePath === undefined)) {
    errors.push("motion evidenceBundle is absent");
  }
  const resolvedBundle = resolve(repositoryRoot, effectiveBundle);
  if (!existsSync(resolvedBundle)) {
    errors.push(`motion evidence bundle does not exist: ${effectiveBundle}`);
  }
  // Incomplete labs validate structural/current-hash candidate bundles without
  // requiring canonical acceptance PASSes. Accepted labs keep the strict gate.
  const shared = validateEvidenceBundle(resolvedBundle, {
    requireRequiredClaimsPass: requireAccepted,
  });
  errors.push(...shared.errors.map((error) => `shared-v2: ${error}`));
  if (requireAccepted && manifest.status !== "accepted") {
    errors.push(`motion manifest status is ${manifest.status}; accepted artifacts cannot be claimed`);
  }
  // Bind source hash when present in assembled evidence-manifest.
  try {
    const evidencePath = join(resolvedBundle, "evidence-manifest.json");
    if (existsSync(evidencePath) && registryLab?.sourceHash) {
      const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
      const hash = evidence.sourceClosureHash ?? evidence.sourceHash ?? null;
      if (hash && hash !== registryLab.sourceHash) {
        errors.push(`stale source hash: evidence ${hash}; canonical ${registryLab.sourceHash}`);
      }
    }
  } catch (error) {
    errors.push(`evidence-manifest source-hash check failed: ${error.message}`);
  }
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    bundlePath: effectiveBundle,
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
