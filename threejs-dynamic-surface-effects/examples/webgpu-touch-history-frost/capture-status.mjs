import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildDemoRegistry } from "../../../scripts/lib/lab-registry.mjs";

const LAB_ID = "webgpu-touch-history-frost";
const here = dirname(fileURLToPath(import.meta.url));
const defaultSessionPath = resolve(here, `../../../artifacts/visual-validation/${LAB_ID}/correctness/capture-session.json`);

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function requiredStandardOutputs(session) {
  return new Map((session.outputPlan ?? []).map((entry) => [entry.filename, entry]));
}

export function evaluateFrostCaptureStatus({ session, expectedSourceHash, artifactRoot } = {}) {
  const failures = [];
  const missingAcceptanceEvidence = [
    "50-cycle create/render/resize/mode/tier/dispose lifecycle trace",
    "14-file unified v2 evidence bundle",
    "approved tracked release subset",
  ];
  if (!session) {
    return Object.freeze({
      lab: LAB_ID,
      verdict: "INSUFFICIENT_EVIDENCE",
      reason: "No correctness capture session exists.",
      provenClaims: Object.freeze([]),
      missingAcceptanceEvidence: Object.freeze(missingAcceptanceEvidence),
      syntheticEvidenceCreated: false,
    });
  }

  if (session.labId !== LAB_ID) failures.push(`capture session belongs to ${session.labId ?? "<missing>"}`);
  if (session.profile !== "correctness") failures.push(`capture profile is ${session.profile ?? "<missing>"}`);
  if (session.automationSurface !== "playwright-headless-chromium") failures.push("capture automation surface drifted");
  if (session.threeRevision !== "0.185.1") failures.push(`capture used Three ${session.threeRevision ?? "<missing>"}`);
  if (session.sourceClosure?.sourceHash !== expectedSourceHash) failures.push("capture source hash is stale");
  if (session.runtime?.metrics?.nativeWebGPU !== true
    || session.runtime?.metrics?.rendererBackendEvidence?.isWebGPUBackend !== true
    || session.runtime?.metrics?.rendererBackendEvidence?.deviceIdentityVerified !== true) {
    failures.push("native WebGPU backend/device identity is not proven");
  }
  for (const [channel, errors] of [["page", session.pageErrors], ["console", session.consoleErrors], ["request", session.requestErrors]]) {
    if (!Array.isArray(errors) || errors.length > 0) failures.push(`${channel} error ledger is not empty`);
  }
  if (session.route?.manifestLabId !== LAB_ID
    || session.route?.observedRuntimeLabId !== LAB_ID
    || JSON.stringify(session.route?.lockedState) !== JSON.stringify(session.route?.finalState)) {
    failures.push("locked route identity was not restored exactly");
  }

  const outputs = requiredStandardOutputs(session);
  for (const filename of [
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
    const entry = outputs.get(filename);
    if (entry?.status !== "CAPTURED" || entry?.derivation?.validationStatus !== "PASS") {
      failures.push(`${filename} is not a validated captured output`);
      continue;
    }
    const path = resolve(artifactRoot, entry.artifact.path);
    if (!existsSync(path)) failures.push(`${filename} artifact is missing`);
    else if (sha256(readFileSync(path)) !== entry.artifact.sha256) failures.push(`${filename} artifact hash drifted`);
  }
  if (session.hookResult?.captures?.length !== 17) failures.push("capture hook did not retain all 17 standard and coverage recipes");
  if (session.hookResult?.visualDifferences?.verdict !== "PASS") failures.push("visual-difference gates did not pass");
  if (session.hookResult?.coverageEvidence?.verdict !== "PASS") failures.push("odd-size and DPR coverage gates did not pass");

  const currentCapture = failures.length === 0;
  return Object.freeze({
    lab: LAB_ID,
    verdict: currentCapture ? "INSUFFICIENT_EVIDENCE" : "FAIL",
    reason: currentCapture
      ? "Current-source native-WebGPU correctness and extent recipes pass, but lifecycle, unified v2, and promotion evidence remain incomplete."
      : "The available correctness capture cannot support a current-source claim.",
    captureSession: Object.freeze({
      currentSource: currentCapture,
      sourceHash: session.sourceClosure?.sourceHash ?? null,
      adapterClass: session.adapterClass ?? "unknown",
      standardOutputs: outputs.size,
      frozenRecipes: session.hookResult?.captures?.length ?? 0,
      visualDifferenceVerdict: session.hookResult?.visualDifferences?.verdict ?? "INSUFFICIENT_EVIDENCE",
      coverageVerdict: session.hookResult?.coverageEvidence?.verdict ?? "INSUFFICIENT_EVIDENCE",
    }),
    provenClaims: Object.freeze(currentCapture ? [
      "native WebGPU renderer/device identity",
      "17 transactionally isolated Frost correctness and coverage recipes",
      "10 standard 1200x800 outputs from retained readbacks",
      "hash-bound four-source diagnostic mosaic",
      "camera, seed, temporal, and final/no-post difference gates",
      "full-tier 641x359 bounded dispatch and aligned readback",
      "DPR 1/1.5/2 logical-to-physical extent sweep",
    ] : []),
    failures: Object.freeze(failures),
    missingAcceptanceEvidence: Object.freeze(missingAcceptanceEvidence),
    syntheticEvidenceCreated: false,
  });
}

export function readFrostCaptureStatus({ sessionPath = defaultSessionPath } = {}) {
  const registry = buildDemoRegistry();
  const lab = registry.demos.find((entry) => entry.id === LAB_ID);
  if (!lab) throw new Error(`${LAB_ID} is absent from the demo registry`);
  const artifactRoot = dirname(sessionPath);
  const session = existsSync(sessionPath) ? JSON.parse(readFileSync(sessionPath, "utf8")) : null;
  return evaluateFrostCaptureStatus({ session, expectedSourceHash: lab.sourceHash, artifactRoot });
}

function main() {
  const result = readFrostCaptureStatus();
  console.error(JSON.stringify(result, null, 2));
  process.exitCode = result.verdict === "FAIL" ? 1 : (result.verdict === "INSUFFICIENT_EVIDENCE" ? 2 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
