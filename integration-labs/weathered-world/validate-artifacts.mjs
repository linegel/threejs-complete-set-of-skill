/**
 * Weathered World artifact validator.
 *
 * Incomplete labs validate structural/current-hash raw-capture-session bundles
 * without requiring full acceptance PASSes (GPU timestamps, 50-cycle soak).
 * Accepted labs keep the strict requireRequiredClaimsPass gate.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateEvidenceBundle } from "../../scripts/lib/evidence-v2.mjs";
import { buildDemoRegistry } from "../../scripts/lib/lab-registry.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
let output = resolve(repoRoot, "artifacts/visual-validation/weathered-world/correctness");
for (let index = 2; index < process.argv.length; index += 1) {
  if (process.argv[index] === "--output") output = resolve(process.argv[++index]);
  else throw new Error(`Unknown artifact-validation argument "${process.argv[index]}"`);
}

const registry = buildDemoRegistry();
const lab = registry.demos.find((entry) => entry.id === "weathered-world");
if (!lab) throw new Error("weathered-world is absent from the shared demo registry.");

const requireAccepted = lab.status === "accepted";
const result = validateEvidenceBundle(output, { requireRequiredClaimsPass: requireAccepted });
const errors = [...(result.errors ?? [])];

if (!existsSync(resolve(output, "capture-session.json"))) {
  errors.push("missing capture-session.json");
} else {
  const session = JSON.parse(readFileSync(resolve(output, "capture-session.json"), "utf8"));
  if (session.labId !== lab.id) errors.push("capture-session.json labId mismatch");
  if (session.sourceHash !== lab.sourceHash && session.sourceClosureHash !== lab.sourceHash) {
    errors.push("capture-session source hash does not match registry sourceHash");
  }
  const metrics = session.finalRuntime?.metrics ?? session.runtime?.metrics ?? {};
  if (metrics.nativeWebGPU !== true && metrics.backendIsWebGPU !== true) {
    errors.push("capture-session did not prove native WebGPU");
  }
  const backendEvidence = metrics.rendererBackendEvidence ?? {};
  if (backendEvidence.isWebGPUBackend !== true && metrics.backendIsWebGPU !== true) {
    errors.push("capture-session missing WebGPUBackend identity proof");
  }
}

const evidence = result.manifest ?? result.json?.["evidence-manifest.json"];
if (evidence?.labId && evidence.labId !== lab.id) {
  errors.push("evidence-manifest.json labId mismatch");
}
if (evidence?.sourceHash && evidence.sourceHash !== lab.sourceHash) {
  errors.push("evidence-manifest.json sourceHash does not match registry");
}

if (errors.length > 0) {
  console.error(`Weathered World artifact validation failed (${errors.length} blockers):\n- ${errors.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    pass: true,
    labId: lab.id,
    output,
    protocol: result.protocol,
    bundleKind: evidence?.bundleKind ?? null,
    requireAccepted,
    claimVerdicts: evidence?.claimVerdicts ?? null,
  }, null, 2));
}
