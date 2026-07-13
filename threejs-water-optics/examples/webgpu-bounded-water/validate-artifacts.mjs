/**
 * Bounded-water artifact validator.
 *
 * Incomplete correctness uses structural raw-capture-session validation.
 * Accepted labs keep strict GPU-probe and accepted-coverage gates.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateEvidenceBundle } from "../../../scripts/lib/evidence-v2.mjs";
import { buildDemoRegistry } from "../../../scripts/lib/lab-registry.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const artifactDir = resolve(process.env.LAB_ARTIFACT_DIR ?? resolve(repoRoot, "artifacts/visual-validation/webgpu-bounded-water/correctness"));
const registry = buildDemoRegistry();
const lab = registry.demos.find((entry) => entry.id === "webgpu-bounded-water");
if (!lab) throw new Error("webgpu-bounded-water is absent from the shared demo registry.");

// Primary correctness packages validate structurally even when the lab status
// is later flipped to accepted (full release-bundle gates are a separate path).
const isCorrectnessPackage = /[/\\]correctness[/\\]?$/.test(artifactDir) || artifactDir.endsWith("correctness");
const requireAccepted = lab.status === "accepted" && !isCorrectnessPackage;
const result = validateEvidenceBundle(artifactDir, { requireRequiredClaimsPass: requireAccepted });
const errors = [...result.errors];
const evidence = result.manifest ?? result.json?.["evidence-manifest.json"];

if (evidence?.labId && evidence.labId !== lab.id) errors.push("evidence-manifest.json labId mismatch");
if (evidence?.sourceHash && evidence.sourceHash !== lab.sourceHash) {
  errors.push("evidence-manifest.json sourceHash does not match the shared canonical-source hash");
}
if (requireAccepted && evidence?.status !== "accepted") {
  errors.push("evidence-manifest.json status must be accepted");
}

if (requireAccepted) {
  const pipeline = result.json["pipeline-graph.json"];
  if (pipeline?.schemaVersion !== 2 || !Array.isArray(pipeline?.signals)
      || !Array.isArray(pipeline?.sceneSubmissions) || !Array.isArray(pipeline?.computeDispatches)
      || !Array.isArray(pipeline?.resources)) {
    errors.push("pipeline-graph.json does not satisfy the runtime-graph v2 container contract");
  }
  for (const signal of pipeline?.signals ?? []) {
    if (!signal.id || !signal.producer || !Array.isArray(signal.consumers) || typeof signal.reachable !== "boolean") {
      errors.push(`pipeline signal ${signal.id ?? "(unnamed)"} is missing producer/consumers/reachability`);
    }
  }
  for (const dispatch of pipeline?.computeDispatches ?? []) {
    const group = dispatch.workgroups;
    if (!dispatch.id || !dispatch.owner || group?.label !== "Derived" || group?.unit !== "workgroups"
        || !Array.isArray(group?.values) || group.values.length !== 3 || !group.values.every(Number.isInteger)) {
      errors.push(`pipeline dispatch ${dispatch.id ?? "(unnamed)"} has an invalid labelled workgroup contract`);
    }
  }
  for (const resource of pipeline?.resources ?? []) {
    const bytes = resource.residentBytes;
    if (!resource.id || !resource.owner || !resource.kind || bytes?.unit !== "bytes"
        || !["Derived", "Measured"].includes(bytes?.label) || !Number.isFinite(bytes?.value)) {
      errors.push(`pipeline resource ${resource.id ?? "(unnamed)"} has an invalid resident-byte contract`);
    }
  }
  const submissions = pipeline?.sceneSubmissions ?? [];
  if (!submissions.some((entry) => entry.id === "opaque-without-water" && entry.count === 1)) {
    errors.push("pipeline-graph.json must prove the opaque-without-water color/depth pass");
  }
  if (!submissions.some((entry) => entry.id === "final-water-scene" && entry.count === 1)) {
    errors.push("pipeline-graph.json must prove the final water scene pass");
  }
  if (pipeline?.finalToneMapOwner !== lab.id || pipeline?.finalOutputTransformOwner !== lab.id) {
    errors.push("pipeline-graph.json must prove single final tone/output ownership");
  }

  const mechanisms = result.json["mechanism-metrics.json"];
  for (const id of ["async-impulse-loss", "receiver-energy-closure"]) {
    const probe = mechanisms?.gpuMutationProbes?.[id];
    if (!probe || probe.verdict !== "PASS" || probe.readbackSource !== "GPU storage buffer") {
      errors.push(`mechanism-metrics.json must contain a passing GPU storage-buffer probe for ${id}`);
    }
  }
  const energy = mechanisms?.gpuMutationProbes?.["receiver-energy-closure"];
  if (energy && energy.resolvedPowerUnits !== energy.depositedPowerUnits) {
    errors.push("receiver caustic resolved power does not equal atomically deposited power");
  }

  const storage = result.json["storage-resources.json"];
  for (const required of [
    "bounded-water-state-a",
    "bounded-water-state-b",
    "bounded-water-caustic-atomic-accumulation",
    "bounded-water-event-snapshot",
    "bounded-water-gpu-probes",
  ]) {
    if (!(storage?.resources ?? []).some((resource) => resource.name === required && resource.bytes > 0)) {
      errors.push(`storage-resources.json is missing ${required}`);
    }
  }
}

if (!existsSync(resolve(artifactDir, "capture-session.json"))) errors.push("missing shared capture-session.json");
else {
  const captureSession = JSON.parse(readFileSync(resolve(artifactDir, "capture-session.json"), "utf8"));
  if (captureSession.sourceHash !== lab.sourceHash && captureSession.sourceClosureHash !== lab.sourceHash) {
    errors.push("capture-session.json sourceHash mismatch");
  }
  const metrics = captureSession.runtime?.metrics ?? captureSession.finalRuntime?.metrics ?? {};
  if (metrics.nativeWebGPU !== true && metrics.backendIsWebGPU !== true) {
    errors.push("capture session did not prove native WebGPU");
  }
}

if (errors.length > 0) {
  console.error(JSON.stringify({
    pass: false,
    verdict: "INSUFFICIENT_EVIDENCE",
    labId: lab.id,
    artifactDir,
    sourceHash: lab.sourceHash,
    requireAccepted,
    errors,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  pass: true,
  verdict: requireAccepted ? "PASS" : "STRUCTURAL_PASS",
  labId: lab.id,
  artifactDir,
  sourceHash: lab.sourceHash,
  protocol: result.protocol,
  bundleKind: evidence?.bundleKind ?? null,
}, null, 2));
