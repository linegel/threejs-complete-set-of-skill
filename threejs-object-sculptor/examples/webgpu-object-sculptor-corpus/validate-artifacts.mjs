import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import {
  dirname,
  extname,
  isAbsolute,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { SCULPT_TIERS } from "../shared/sculpt-runtime.js";
import { SCULPT_TARGET_IDS } from "./object-catalog.js";
import {
  CORPUS_CAPTURE_PLAN,
  CORPUS_RASTER_COMPARISON_PLAN,
  CORPUS_RASTER_GATES,
  CORPUS_REPRESENTATIVE_SEED,
  CORPUS_STRESS_SEED,
  computeCorpusRasterComparisons,
  validateCorpusCaptureMetadata,
} from "./capture-hook.mjs";
import {
  CORPUS_PHYSICAL_ROUTE_PLAN,
  validatePhysicalRouteRuntimeRecords,
} from "./validate-routes.mjs";

const LAB_ID = "webgpu-object-sculptor-corpus";
const VISUAL_CONTRACT_ID = "object-sculptor-corpus-visual-v1";
const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "../../..");
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{7,127}$/;

export const REQUIRED_SUPPLEMENTAL_EVIDENCE = Object.freeze([
  "visual-contract.json",
  "evidence-manifest.json",
  "route-runtime-evidence.json",
  "visual-reviews.json",
  "visual-error-results.json",
  "timing-trace.json",
  "resource-ledger.json",
  "lifecycle-evidence.json",
  "acceptance-summary.json",
]);

export const REQUIRED_ACCEPTANCE_GATES = Object.freeze([
  "native-webgpu",
  "physical-route-matrix",
  "subject-distinctness",
  "authored-contract-visual-review",
  "action-motion-delta",
  "tier-visual-error",
  "sustained-performance",
  "resource-ownership",
  "lifecycle",
]);

const REQUIRED_RESOURCE_CATEGORIES = Object.freeze([
  "renderer",
  "target-geometry",
  "target-materials",
  "shadow",
  "capture-target",
  "readback-staging",
]);

const REQUIRED_LIFECYCLE_CASE_IDS = Object.freeze([
  "resize",
  "dpr-change",
  "tier-change",
  "mode-change",
  "history-reset",
  "subject-replace",
  "dispose-recreate",
  "device-error-recovery",
]);

const ACCEPTANCE_EVIDENCE_BY_GATE = Object.freeze({
  "native-webgpu": Object.freeze(["capture-session.json", "evidence-manifest.json"]),
  "physical-route-matrix": Object.freeze(["route-runtime-evidence.json"]),
  "subject-distinctness": Object.freeze(["visual-contract.json", "visual-error-results.json"]),
  "authored-contract-visual-review": Object.freeze(["visual-contract.json", "visual-reviews.json"]),
  "action-motion-delta": Object.freeze(["visual-contract.json", "visual-error-results.json"]),
  "tier-visual-error": Object.freeze(["visual-contract.json", "visual-error-results.json"]),
  "sustained-performance": Object.freeze(["timing-trace.json"]),
  "resource-ownership": Object.freeze(["resource-ledger.json"]),
  lifecycle: Object.freeze(["lifecycle-evidence.json"]),
});

function readJson(path, errors, label) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`${label} must contain a JSON object`);
      return null;
    }
    return value;
  } catch (error) {
    errors.push(`${label} is not readable JSON: ${error.message}`);
    return null;
  }
}

function exactKeys(value, expected, label, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${label} must be an object`);
    return false;
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    errors.push(`${label} schema keys must be exactly: ${wanted.join(", ")}`);
    return false;
  }
  return true;
}

function requireText(value, label, errors, pattern = null) {
  if (typeof value !== "string" || value.length === 0 || (pattern && !pattern.test(value))) {
    errors.push(`${label} must be a valid nonempty string`);
    return null;
  }
  return value;
}

function normalizedColorSpace(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSrgb(value) {
  return new Set(["srgb", "srgbcolorspace"]).has(normalizedColorSpace(value));
}

function almostEqual(a, b, tolerance = 1e-9) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));
}

function evidenceDatum(value, expectedLabel, label, errors, {
  unit = null,
  integer = false,
  minimum = Number.NEGATIVE_INFINITY,
  maximum = Number.POSITIVE_INFINITY,
} = {}) {
  if (!exactKeys(value, ["value", "unit", "label", "source"], label, errors)) return null;
  if (!Number.isFinite(value.value)) errors.push(`${label}.value must be finite`);
  if (integer && !Number.isInteger(value.value)) errors.push(`${label}.value must be an integer`);
  if (Number.isFinite(value.value) && (value.value < minimum || value.value > maximum)) {
    errors.push(`${label}.value must be in [${minimum}, ${maximum}]`);
  }
  if (typeof value.unit !== "string" || value.unit.length === 0) errors.push(`${label}.unit is required`);
  if (unit !== null && value.unit !== unit) errors.push(`${label}.unit expected ${unit}, received ${value.unit}`);
  if (value.label !== expectedLabel) errors.push(`${label}.label expected ${expectedLabel}, received ${value.label}`);
  if (typeof value.source !== "string" || value.source.length === 0) errors.push(`${label}.source is required`);
  return Number.isFinite(value.value) ? value.value : null;
}

function backendRecordFromCapture(session) {
  const proof = session?.hookResult?.backendProof;
  return Object.freeze({
    kind: String(proof?.backend ?? "").toLowerCase(),
    nativeWebGPU: proof?.nativeWebGPU,
    rendererType: proof?.rendererType,
    backendType: proof?.backendType,
    threeRevision: proof?.threeRevision,
    outputColorSpace: proof?.outputColorSpace,
  });
}

function validateBackendRecord(record, expected, label, errors) {
  if (!exactKeys(record, [
    "kind",
    "nativeWebGPU",
    "rendererType",
    "backendType",
    "threeRevision",
    "outputColorSpace",
  ], label, errors)) return false;
  if (record.kind !== "webgpu" || record.nativeWebGPU !== true) errors.push(`${label} must prove native WebGPU`);
  if (record.rendererType !== "WebGPURenderer") errors.push(`${label}.rendererType must be WebGPURenderer`);
  if (record.backendType !== "WebGPUBackend") errors.push(`${label}.backendType must be WebGPUBackend`);
  requireText(String(record.threeRevision ?? ""), `${label}.threeRevision`, errors);
  if (!isSrgb(record.outputColorSpace)) errors.push(`${label}.outputColorSpace must be sRGB`);
  if (expected && JSON.stringify(record) !== JSON.stringify(expected)) errors.push(`${label} does not match the correctness-run backend fingerprint`);
  return true;
}

function validateDocumentHeader(document, filename, expected, errors) {
  if (document?.schemaVersion !== 2) errors.push(`${filename}.schemaVersion must be 2`);
  if (document?.labId !== LAB_ID) errors.push(`${filename}.labId mismatch`);
  requireText(document?.bundleId, `${filename}.bundleId`, errors, ID_PATTERN);
  requireText(document?.runId, `${filename}.runId`, errors, ID_PATTERN);
  if (expected?.bundleId && document?.bundleId !== expected.bundleId) errors.push(`${filename}.bundleId does not match evidence-manifest.json`);
  if (expected?.runId && document?.runId !== expected.runId) errors.push(`${filename}.runId does not match its declared profile run`);
  validateBackendRecord(document?.backend, expected?.backend ?? null, `${filename}.backend`, errors);
}

function confinedFileReference(bundleDir, reference, label, errors, { extensions = [] } = {}) {
  if (!exactKeys(reference, ["path", "sha256"], label, errors)) return null;
  const path = reference.path;
  if (
    typeof path !== "string"
    || path.length === 0
    || path.includes("\\")
    || path.includes("\0")
    || isAbsolute(path)
    || posix.normalize(path) !== path
    || path === "."
    || path === ".."
    || path.startsWith("../")
    || path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    errors.push(`${label}.path must be a canonical bundle-relative POSIX path`);
    return null;
  }
  if (!SHA256_PATTERN.test(reference.sha256 ?? "")) errors.push(`${label}.sha256 must be lowercase 64-hex`);
  if (extensions.length > 0 && !extensions.includes(extname(path).toLowerCase())) {
    errors.push(`${label}.path must use one of: ${extensions.join(", ")}`);
  }
  const absolute = resolve(bundleDir, path);
  const fromBundle = relative(bundleDir, absolute);
  if (fromBundle === "" || fromBundle === ".." || fromBundle.startsWith(`..${sep}`) || isAbsolute(fromBundle)) {
    errors.push(`${label}.path escapes the evidence bundle`);
    return null;
  }
  if (!existsSync(absolute)) {
    errors.push(`${label}.path is missing: ${path}`);
    return null;
  }
  try {
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      errors.push(`${label}.path must identify a regular non-symlink file`);
      return null;
    }
    const realBundle = realpathSync(bundleDir);
    const realFile = realpathSync(absolute);
    const realRelative = relative(realBundle, realFile);
    if (realRelative === "" || realRelative === ".." || realRelative.startsWith(`..${sep}`) || isAbsolute(realRelative)) {
      errors.push(`${label}.path resolves outside the evidence bundle`);
      return null;
    }
    const bytes = readFileSync(realFile);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== reference.sha256) errors.push(`${label}.sha256 does not match file bytes`);
    return Object.freeze({ path, sha256: digest, absolute: realFile, bytes });
  } catch (error) {
    errors.push(`${label}.path could not be opened and hashed: ${error.message}`);
    return null;
  }
}

function sameFileReference(actual, expected, label, errors) {
  if (actual?.path !== expected?.path || actual?.sha256 !== expected?.sha256) errors.push(`${label} does not match the canonical capture/file reference`);
}

function validatePngCaptureFile(file, width, height, label, errors) {
  if (!file) return;
  const signature = Buffer.from("89504e470d0a1a0a", "hex");
  if (file.bytes.length < 24 || !file.bytes.subarray(0, 8).equals(signature) || file.bytes.toString("ascii", 12, 16) !== "IHDR") {
    errors.push(`${label} is not a PNG with an IHDR header`);
    return;
  }
  if (file.bytes.readUInt32BE(16) !== width || file.bytes.readUInt32BE(20) !== height) {
    errors.push(`${label} PNG dimensions do not match capture metadata`);
  }
}

function exactObjectSubset(actual, expected, label, errors) {
  for (const [key, value] of Object.entries(expected)) {
    if (actual?.[key] !== value) errors.push(`${label}.${key} expected ${value}, received ${actual?.[key]}`);
  }
}

function requireUniqueSortedIds(values, label, errors) {
  if (!Array.isArray(values) || values.length === 0) {
    errors.push(`${label} must be a nonempty ID array`);
    return;
  }
  if (values.some((value) => typeof value !== "string" || value.length === 0)) errors.push(`${label} contains an invalid ID`);
  if (new Set(values).size !== values.length) errors.push(`${label} contains duplicate IDs`);
  const sorted = [...values].sort((a, b) => a.localeCompare(b));
  if (values.some((value, index) => value !== sorted[index])) errors.push(`${label} must be sorted deterministically`);
}

function validateTierContracts(tierContracts, errors) {
  if (!tierContracts || typeof tierContracts !== "object" || Array.isArray(tierContracts)) {
    errors.push("capture hook did not publish tierContracts");
    return;
  }
  const completeIdentityFields = ["nodeIds", "socketIds", "colliderIds", "destructionGroupIds"];
  const protectedIdentityFields = [
    "protectedNodeIds",
    "protectedSocketIds",
    "protectedColliderIds",
    "protectedDestructionGroupIds",
  ];
  for (const subjectId of SCULPT_TARGET_IDS) {
    const byTier = tierContracts[subjectId];
    if (!byTier || typeof byTier !== "object") {
      errors.push(`missing tier contracts for ${subjectId}`);
      continue;
    }
    let baseline = null;
    for (const tier of SCULPT_TIERS) {
      const contract = byTier[tier];
      if (!contract || typeof contract !== "object") {
        errors.push(`missing ${subjectId} ${tier} runtime contract`);
        continue;
      }
      if (contract.subjectId !== subjectId || contract.targetContractId !== subjectId || contract.tier !== tier) {
        errors.push(`${subjectId} ${tier} runtime contract identity drifted`);
      }
      for (const field of [...completeIdentityFields, ...protectedIdentityFields]) {
        requireUniqueSortedIds(contract[field], `${subjectId}.${tier}.${field}`, errors);
      }
      for (let index = 0; index < protectedIdentityFields.length; index += 1) {
        const protectedField = protectedIdentityFields[index];
        const completeField = completeIdentityFields[index];
        const completeIds = new Set(contract[completeField]);
        if (contract[protectedField]?.some((id) => !completeIds.has(id))) {
          errors.push(`${subjectId}.${tier}.${protectedField} is not a subset of ${completeField}`);
        }
      }
      if (!Array.isArray(contract.colliderConstructionInputs) || contract.colliderConstructionInputs.length !== contract.colliderIds?.length) {
        errors.push(`${subjectId}.${tier} collider construction inputs do not close over collider IDs`);
      }
      if (!String(contract.canonicalPhysicsProxyStatus ?? "").startsWith("blocked")) {
        errors.push(`${subjectId}.${tier} must keep canonical physics proxy authority blocked`);
      }
      if (baseline === null) baseline = contract;
      else for (const field of protectedIdentityFields) {
        try {
          assert.deepEqual(contract[field], baseline[field]);
        } catch {
          errors.push(`${subjectId} ${field} changed across visual tiers`);
        }
      }
    }
  }
}

function validateRasterComparisons(hook, captureFiles, errors) {
  try {
    assert.deepEqual(hook?.rasterComparisonPlan, CORPUS_RASTER_COMPARISON_PLAN);
  } catch {
    errors.push("capture hook raster comparison plan drifted");
  }
  let recomputed = [];
  try {
    recomputed = computeCorpusRasterComparisons((filename) => {
      const file = captureFiles.get(filename);
      if (!file?.bytes) throw new Error(`missing confined PNG bytes for ${filename}`);
      return file.bytes;
    });
  } catch (error) {
    errors.push(`capture raster comparison decode failed: ${error.message}`);
    return new Map();
  }
  if (!Array.isArray(hook?.rasterComparisons) || hook.rasterComparisons.length !== recomputed.length) {
    errors.push(`capture hook must store exactly ${recomputed.length} raster comparisons`);
  }
  const byId = new Map();
  for (let index = 0; index < recomputed.length; index += 1) {
    const actual = hook?.rasterComparisons?.[index];
    const measured = recomputed[index];
    const label = `rasterComparisons[${index}]`;
    if (!exactKeys(actual, [
      "id",
      "kind",
      "leftFilename",
      "rightFilename",
      "leftRgbSha256",
      "rightRgbSha256",
      "rgbMaeCodeValues",
      "changedPixelRatio",
      "maxChannelDelta",
    ], label, errors)) continue;
    for (const field of ["id", "kind", "leftFilename", "rightFilename", "leftRgbSha256", "rightRgbSha256"]) {
      if (actual[field] !== measured[field]) errors.push(`${label}.${field} does not match decoded PNG evidence`);
    }
    for (const field of ["rgbMaeCodeValues", "changedPixelRatio", "maxChannelDelta"]) {
      if (!Number.isFinite(actual[field]) || !almostEqual(actual[field], measured[field], 1e-12)) {
        errors.push(`${label}.${field} does not match recomputed decoded RGB metrics`);
      }
    }
    if (measured.kind === "replay") {
      const gate = CORPUS_RASTER_GATES.replay;
      if (
        measured.rgbMaeCodeValues > gate.rgbMaeMaximum
        || measured.changedPixelRatio > gate.changedPixelRatioMaximum
        || measured.maxChannelDelta > gate.maxChannelDeltaMaximum
      ) errors.push(`${measured.id} failed the conservative replay raster gate`);
    } else {
      const gate = CORPUS_RASTER_GATES[measured.kind];
      if (measured.rgbMaeCodeValues < gate.rgbMaeMinimum || measured.changedPixelRatio < gate.changedPixelRatioMinimum) {
        errors.push(`${measured.id} failed the ${measured.kind} raster delta gate`);
      }
    }
    byId.set(measured.id, measured);
  }
  return byId;
}

function validateCaptureSession(bundleDir, session, errors) {
  const emptyContext = Object.freeze({ runId: null, backend: null, captureFiles: new Map() });
  if (!session || typeof session !== "object") return emptyContext;
  exactKeys(session, [
    "schemaVersion",
    "labId",
    "sourceHash",
    "buildRevision",
    "profile",
    "profileConfig",
    "browserEntry",
    "url",
    "runtime",
    "hookResult",
    "pageErrors",
    "note",
  ], "capture-session.json", errors);
  const metrics = session.runtime?.metrics;
  const pipeline = session.runtime?.pipeline;
  const hook = session.hookResult;
  if (session.schemaVersion !== 2) errors.push("capture session must use schemaVersion 2");
  if (session.labId !== LAB_ID) errors.push("capture session labId mismatch");
  if (session.profile !== "correctness") errors.push("capture session must use the correctness profile");
  if (!Array.isArray(session.pageErrors) || session.pageErrors.length !== 0) errors.push("capture session recorded browser page errors");
  if (metrics?.nativeWebGPU !== true || String(metrics?.backend ?? metrics?.backendKind).toLowerCase() !== "webgpu") {
    errors.push("capture session did not prove native WebGPU");
  }
  if (metrics?.initialized !== true || metrics?.firstFrameCompleted !== true || metrics?.lastFrameError !== null) {
    errors.push("capture session did not record an initialized, completed, error-free frame");
  }
  if (
    pipeline?.owner !== "WebGPURenderer"
    || pipeline?.sceneRendersPerFrame !== 1
    || pipeline?.finalOutputOwner !== "renderer"
    || !isSrgb(pipeline?.outputColorSpace)
  ) errors.push("capture session did not preserve one WebGPURenderer scene/output owner");
  if (hook?.schemaVersion !== 2) errors.push("capture hook must use schemaVersion 2");
  const runId = requireText(hook?.evidenceRunId, "capture hook evidenceRunId", errors, ID_PATTERN);
  if (hook?.evidenceStatus !== "INSUFFICIENT_EVIDENCE") errors.push("capture hook must not promote captures into acceptance");
  if (
    hook?.frameOwnership?.owner !== "capture-harness"
    || hook?.frameOwnership?.livePageFrameLoop !== "disabled-by-capture-route"
    || hook?.frameOwnership?.captureQuery !== "1"
  ) errors.push("capture hook did not prove exclusive capture-frame ownership");
  try {
    assert.deepEqual(hook?.physicalRoutePlan, CORPUS_PHYSICAL_ROUTE_PLAN);
  } catch {
    errors.push("capture hook physical route plan drifted");
  }
  exactObjectSubset(hook?.backendProof, {
    backend: "webgpu",
    nativeWebGPU: true,
    initialized: true,
    firstFrameCompleted: true,
    rendererType: "WebGPURenderer",
    pipelineOwner: "WebGPURenderer",
    sceneRendersPerFrame: 1,
    finalOutputOwner: "renderer",
  }, "hookResult.backendProof", errors);
  const backend = backendRecordFromCapture(session);
  validateBackendRecord(backend, null, "capture-session backend", errors);

  const captures = hook?.captures;
  const captureFiles = new Map();
  if (!Array.isArray(captures)) errors.push("capture hook did not publish captures");
  else {
    if (captures.length !== CORPUS_CAPTURE_PLAN.length) errors.push(`expected ${CORPUS_CAPTURE_PLAN.length} captures, received ${captures.length}`);
    const byFilename = new Map();
    for (const capture of captures) {
      if (byFilename.has(capture?.filename)) errors.push(`duplicate capture filename ${capture?.filename}`);
      byFilename.set(capture?.filename, capture);
    }
    for (const planned of CORPUS_CAPTURE_PLAN) {
      const capture = byFilename.get(planned.filename);
      if (!capture) {
        errors.push(`missing capture metadata ${planned.filename}`);
        continue;
      }
      exactObjectSubset(capture.state, planned.state, `${planned.filename}.state`, errors);
      exactObjectSubset(capture.runtimeState, {
        subjectId: planned.state.subjectId,
        mode: planned.state.mode,
        tier: planned.state.tier,
        camera: planned.state.camera,
        seed: planned.state.seed,
        time: planned.state.time,
        backend: "webgpu",
        nativeWebGPU: true,
        initialized: true,
        firstFrameCompleted: true,
        lastFrameError: null,
      }, `${planned.filename}.runtimeState`, errors);
      if (!exactKeys(capture.identityEvidence, [
        "instanceId",
        "instanceGeneration",
        "previousGeneration",
        "continuityStatus",
        "effectiveToken",
        "nodeIds",
        "socketIds",
        "colliderIds",
        "destructionGroupIds",
        "protectedNodeIds",
        "protectedSocketIds",
        "protectedColliderIds",
        "protectedDestructionGroupIds",
      ], `${planned.filename}.identityEvidence`, errors)) continue;
      requireText(capture.identityEvidence.instanceId, `${planned.filename}.identityEvidence.instanceId`, errors);
      requireText(capture.identityEvidence.continuityStatus, `${planned.filename}.identityEvidence.continuityStatus`, errors);
      requireText(capture.identityEvidence.effectiveToken, `${planned.filename}.identityEvidence.effectiveToken`, errors);
      if (!Number.isInteger(capture.identityEvidence.instanceGeneration) || capture.identityEvidence.instanceGeneration < 1) {
        errors.push(`${planned.filename}.identityEvidence.instanceGeneration must be a positive integer`);
      }
      if (capture.identityEvidence.previousGeneration !== null && (!Number.isInteger(capture.identityEvidence.previousGeneration) || capture.identityEvidence.previousGeneration < 1)) {
        errors.push(`${planned.filename}.identityEvidence.previousGeneration must be null or a positive integer`);
      }
      for (const field of [
        "nodeIds",
        "socketIds",
        "colliderIds",
        "destructionGroupIds",
        "protectedNodeIds",
        "protectedSocketIds",
        "protectedColliderIds",
        "protectedDestructionGroupIds",
      ]) {
        requireUniqueSortedIds(capture.identityEvidence[field], `${planned.filename}.identityEvidence.${field}`, errors);
      }
      const file = confinedFileReference(bundleDir, capture.file, `${planned.filename}.file`, errors, { extensions: [".png"] });
      validatePngCaptureFile(file, capture.width, capture.height, `${planned.filename}.file`, errors);
      if (capture.file?.path !== planned.filename) errors.push(`${planned.filename}.file.path must equal its canonical filename`);
      if (file) captureFiles.set(planned.filename, Object.freeze({ path: file.path, sha256: file.sha256, bytes: file.bytes }));
      if (capture.sourceRowStride !== capture.sourceBytesPerRow) errors.push(`${planned.filename} source-row aliases disagree`);
      if (capture.captureSource !== "native-webgpu-render-target-readback") errors.push(`${planned.filename} is not native render-target readback`);
      try {
        validateCorpusCaptureMetadata(capture, pipeline);
      } catch (error) {
        errors.push(`${planned.filename}: ${error.message}`);
      }
    }
    for (let index = 1; index < captures.length; index += 1) {
      const previous = captures[index - 1]?.runtimeState;
      const current = captures[index]?.runtimeState;
      if (
        !Number.isInteger(previous?.completedFrames)
        || !Number.isInteger(current?.completedFrames)
        || current.completedFrames !== previous.completedFrames + 1
        || !Number.isInteger(previous?.renderSubmissions)
        || !Number.isInteger(current?.renderSubmissions)
        || current.renderSubmissions !== previous.renderSubmissions + 1
      ) errors.push(`capture ${index} did not advance completed-frame and render-submission counters exactly once`);
    }
    for (const subjectId of SCULPT_TARGET_IDS) {
      const byCaseAndPhase = new Map();
      for (const capture of captures.filter(({ state }) => state?.subjectId === subjectId && new Set(["A0", "B", "A1"]).has(state?.seedPhase))) {
        byCaseAndPhase.set(`${capture.state.seedCaseId}:${capture.state.seedPhase}`, capture);
      }
      for (const caseId of ["final-full-design", "action-ready-t000", "action-ready-t200"]) {
        const a0 = byCaseAndPhase.get(`${caseId}:A0`);
        const b = byCaseAndPhase.get(`${caseId}:B`);
        const a1 = byCaseAndPhase.get(`${caseId}:A1`);
        if (!a0 || !b || !a1) {
          errors.push(`${subjectId}/${caseId} is missing A0/B/A1 capture phases`);
          continue;
        }
        if (a0.state.seed !== CORPUS_REPRESENTATIVE_SEED || b.state.seed !== CORPUS_STRESS_SEED || a1.state.seed !== CORPUS_REPRESENTATIVE_SEED) {
          errors.push(`${subjectId}/${caseId} seed phases do not use the frozen A/B/A values`);
        }
        if (a0.identityEvidence?.effectiveToken !== a1.identityEvidence?.effectiveToken || a0.identityEvidence?.effectiveToken === b.identityEvidence?.effectiveToken) {
          errors.push(`${subjectId}/${caseId} continuity tokens do not replay A and distinguish B`);
        }
        if (
          b.identityEvidence?.instanceGeneration !== a0.identityEvidence?.instanceGeneration + 1
          || b.identityEvidence?.previousGeneration !== a0.identityEvidence?.instanceGeneration
          || a1.identityEvidence?.instanceGeneration !== b.identityEvidence?.instanceGeneration + 1
          || a1.identityEvidence?.previousGeneration !== b.identityEvidence?.instanceGeneration
        ) errors.push(`${subjectId}/${caseId} generation links do not close A0 -> B -> A1`);
        for (const field of ["nodeIds", "socketIds", "colliderIds", "destructionGroupIds"]) {
          try {
            assert.deepEqual(a0.identityEvidence?.[field], b.identityEvidence?.[field]);
            assert.deepEqual(a0.identityEvidence?.[field], a1.identityEvidence?.[field]);
          } catch {
            errors.push(`${subjectId}/${caseId} ${field} changed across A0/B/A1`);
          }
        }
      }
    }
    validateRasterComparisons(hook, captureFiles, errors);
  }
  const observedSeeds = new Set(CORPUS_CAPTURE_PLAN.map(({ state }) => state.seed));
  if (!observedSeeds.has(CORPUS_REPRESENTATIVE_SEED) || !observedSeeds.has(CORPUS_STRESS_SEED)) {
    errors.push("capture plan must include representative and stress seeds");
  }
  validateTierContracts(hook?.tierContracts, errors);
  return Object.freeze({ runId, backend, captureFiles });
}

function plannedCapture(subjectId, mode, tier, camera, seed, time, label) {
  const matches = CORPUS_CAPTURE_PLAN.filter(({ state }) => (
    state.subjectId === subjectId
    && state.mode === mode
    && state.tier === tier
    && state.camera === camera
    && state.seed === seed
    && state.time === time
    && (!label || state.label === label)
  ));
  if (matches.length !== 1) throw new Error(`capture plan does not contain one ${subjectId}/${mode}/${tier}/${camera}/${seed}/${time} record`);
  return matches[0].filename;
}

function captureByFilenameFragment(subjectId, fragment) {
  const matches = CORPUS_CAPTURE_PLAN.filter(({ filename }) => filename === `${subjectId}.${fragment}.png`);
  if (matches.length !== 1) throw new Error(`capture plan does not contain ${subjectId}.${fragment}.png`);
  return matches[0].filename;
}

function buildVisualInvariantPlan() {
  const records = [];
  for (const subjectId of SCULPT_TARGET_IDS) {
    const finalFull = captureByFilenameFragment(subjectId, "final.full.design");
    const finalBudgeted = captureByFilenameFragment(subjectId, "final.budgeted.design");
    const finalMinimum = captureByFilenameFragment(subjectId, "final.minimum.design");
    const action0 = captureByFilenameFragment(subjectId, "action-ready.full.design.t000");
    const action2 = captureByFilenameFragment(subjectId, "action-ready.full.design.t200");
    const stressFinal = captureByFilenameFragment(subjectId, "final.full.design.stress-seed");
    const replayFinal = captureByFilenameFragment(subjectId, "final.full.design.representative-replay");
    const stressAction0 = captureByFilenameFragment(subjectId, "action-ready.full.design.stress-seed.t000");
    const stressAction2 = captureByFilenameFragment(subjectId, "action-ready.full.design.stress-seed.t200");
    const replayAction0 = captureByFilenameFragment(subjectId, "action-ready.full.design.representative-replay.t000");
    const replayAction2 = captureByFilenameFragment(subjectId, "action-ready.full.design.representative-replay.t200");
    records.push(
      { id: `final-authored-contract:${subjectId}`, metricId: "ai-vision-score", domain: "authored-contract-review", statistic: "global-score", comparison: "gte", unit: "score", thresholdValue: 0.8, captureFilenames: [finalFull] },
      { id: `action-motion-delta:${subjectId}`, metricId: "rgb-mae-code-values", domain: "decoded-output-rgb8", statistic: "channel-mae", comparison: "gte", unit: "code-value", thresholdValue: 0.05, captureFilenames: [action0, action2] },
      { id: `tier-visual-error:${subjectId}:budgeted`, metricId: "normalized-visual-error", domain: "decoded-output-rgba8", statistic: "masked-p95", comparison: "lte", unit: "ratio", thresholdValue: 0.25, captureFilenames: [finalFull, finalBudgeted] },
      { id: `tier-visual-error:${subjectId}:minimum`, metricId: "normalized-visual-error", domain: "decoded-output-rgba8", statistic: "masked-p95", comparison: "lte", unit: "ratio", thresholdValue: 0.4, captureFilenames: [finalFull, finalMinimum] },
      { id: `stress-seed-distinctness:${subjectId}`, metricId: "rgb-mae-code-values", domain: "decoded-output-rgb8", statistic: "channel-mae", comparison: "gte", unit: "code-value", thresholdValue: 0.02, captureFilenames: [finalFull, stressFinal] },
      { id: `representative-replay:${subjectId}:final`, metricId: "rgb-mae-code-values", domain: "decoded-output-rgb8", statistic: "channel-mae", comparison: "lte", unit: "code-value", thresholdValue: 0.01, captureFilenames: [finalFull, replayFinal] },
      { id: `stress-action-motion:${subjectId}`, metricId: "rgb-mae-code-values", domain: "decoded-output-rgb8", statistic: "channel-mae", comparison: "gte", unit: "code-value", thresholdValue: 0.05, captureFilenames: [stressAction0, stressAction2] },
      { id: `representative-replay:${subjectId}:action-t0`, metricId: "rgb-mae-code-values", domain: "decoded-output-rgb8", statistic: "channel-mae", comparison: "lte", unit: "code-value", thresholdValue: 0.01, captureFilenames: [action0, replayAction0] },
      { id: `representative-replay:${subjectId}:action-t2`, metricId: "rgb-mae-code-values", domain: "decoded-output-rgb8", statistic: "channel-mae", comparison: "lte", unit: "code-value", thresholdValue: 0.01, captureFilenames: [action2, replayAction2] },
    );
  }
  for (let left = 0; left < SCULPT_TARGET_IDS.length; left += 1) {
    for (let right = left + 1; right < SCULPT_TARGET_IDS.length; right += 1) {
      const a = SCULPT_TARGET_IDS[left];
      const b = SCULPT_TARGET_IDS[right];
      records.push({
        id: `subject-distinctness:${a}:${b}`,
        metricId: "silhouette-distance",
        domain: "decoded-output-silhouette-mask",
        statistic: "symmetric-boundary-distance-ratio",
        comparison: "gte",
        unit: "ratio",
        thresholdValue: 0.1,
        captureFilenames: [captureByFilenameFragment(a, "final.full.design"), captureByFilenameFragment(b, "final.full.design")],
      });
    }
  }
  return records.map((record) => Object.freeze({ ...record, captureFilenames: Object.freeze(record.captureFilenames) }));
}

export const CORPUS_VISUAL_INVARIANT_PLAN = Object.freeze(buildVisualInvariantPlan());

function validateFileReferenceSequence(bundleDir, actual, filenames, context, label, errors) {
  if (!Array.isArray(actual) || actual.length !== filenames.length) {
    errors.push(`${label} must contain ${filenames.length} file references`);
    return;
  }
  for (let index = 0; index < filenames.length; index += 1) {
    const filename = filenames[index];
    confinedFileReference(bundleDir, actual[index], `${label}[${index}]`, errors, { extensions: [".png"] });
    if (actual[index]?.path !== filename) errors.push(`${label}[${index}].path expected ${filename}`);
    sameFileReference(actual[index], context.captureFiles.get(filename), `${label}[${index}]`, errors);
  }
}

function validateVisualContract(document, bundleDir, context, header, errors) {
  if (!document) return new Map();
  exactKeys(document, ["schemaVersion", "labId", "bundleId", "runId", "backend", "contractId", "invariants"], "visual-contract.json", errors);
  validateDocumentHeader(document, "visual-contract.json", { ...header, runId: header.runBindings.correctness, backend: context.backend }, errors);
  if (document.contractId !== VISUAL_CONTRACT_ID) errors.push(`visual-contract.json.contractId must be ${VISUAL_CONTRACT_ID}`);
  const byId = new Map();
  if (!Array.isArray(document.invariants) || document.invariants.length !== CORPUS_VISUAL_INVARIANT_PLAN.length) {
    errors.push(`visual-contract.json must contain exactly ${CORPUS_VISUAL_INVARIANT_PLAN.length} invariants`);
    return byId;
  }
  for (let index = 0; index < CORPUS_VISUAL_INVARIANT_PLAN.length; index += 1) {
    const expected = CORPUS_VISUAL_INVARIANT_PLAN[index];
    const invariant = document.invariants[index];
    if (!exactKeys(invariant, ["id", "metricId", "domain", "statistic", "comparison", "threshold", "captureFiles"], `visual-contract.invariants[${index}]`, errors)) continue;
    if (byId.has(invariant.id)) errors.push(`visual-contract duplicate invariant ${invariant.id}`);
    byId.set(invariant.id, invariant);
    if (invariant.id !== expected.id) errors.push(`visual-contract invariant ${index} expected ${expected.id}`);
    if (invariant.metricId !== expected.metricId) errors.push(`${expected.id} metricId drifted`);
    if (invariant.comparison !== expected.comparison) errors.push(`${expected.id} comparison drifted`);
    if (invariant.domain !== expected.domain) errors.push(`${expected.id} domain drifted`);
    if (invariant.statistic !== expected.statistic) errors.push(`${expected.id} statistic drifted`);
    const threshold = evidenceDatum(invariant.threshold, "Gated", `${expected.id}.threshold`, errors, { unit: expected.unit, minimum: 0 });
    if (threshold !== expected.thresholdValue) errors.push(`${expected.id} threshold must equal the checked-in frozen gate ${expected.thresholdValue}`);
    if (invariant.threshold?.source !== `CORPUS_VISUAL_INVARIANT_PLAN:${expected.id}`) errors.push(`${expected.id} threshold source drifted`);
    validateFileReferenceSequence(bundleDir, invariant.captureFiles, expected.captureFilenames, context, `${expected.id}.captureFiles`, errors);
  }
  return byId;
}

function deriveComparison(measured, threshold, comparison) {
  if (!Number.isFinite(measured) || !Number.isFinite(threshold)) return false;
  if (comparison === "gte") return measured >= threshold;
  if (comparison === "lte") return measured <= threshold;
  return false;
}

function validateVisualReviews(document, bundleDir, context, header, visualContractRef, errors) {
  if (!document) return;
  exactKeys(document, ["schemaVersion", "labId", "bundleId", "runId", "backend", "reviews"], "visual-reviews.json", errors);
  validateDocumentHeader(document, "visual-reviews.json", { ...header, runId: header.runBindings.correctness, backend: context.backend }, errors);
  if (!Array.isArray(document.reviews) || document.reviews.length !== SCULPT_TARGET_IDS.length) {
    errors.push(`visual-reviews.json must contain exactly ${SCULPT_TARGET_IDS.length} reviews`);
    return;
  }
  for (let index = 0; index < SCULPT_TARGET_IDS.length; index += 1) {
    const subjectId = SCULPT_TARGET_IDS[index];
    const review = document.reviews[index];
    if (!exactKeys(review, [
      "subjectId",
      "mode",
      "reviewBasis",
      "renderImage",
      "contractArtifact",
      "aiVisionScore",
      "acceptanceThreshold",
      "criticalFeatures",
    ], `visual-reviews.reviews[${index}]`, errors)) continue;
    if (review.subjectId !== subjectId || review.mode !== "final" || review.reviewBasis !== "authored-contract") {
      errors.push(`${subjectId} review identity/basis drifted`);
    }
    const expectedImage = captureByFilenameFragment(subjectId, "final.full.design");
    confinedFileReference(bundleDir, review.renderImage, `${subjectId}.renderImage`, errors, { extensions: [".png"] });
    sameFileReference(review.renderImage, context.captureFiles.get(expectedImage), `${subjectId}.renderImage`, errors);
    confinedFileReference(bundleDir, review.contractArtifact, `${subjectId}.contractArtifact`, errors, { extensions: [".json"] });
    sameFileReference(review.contractArtifact, visualContractRef, `${subjectId}.contractArtifact`, errors);
    const score = evidenceDatum(review.aiVisionScore, "Measured", `${subjectId}.aiVisionScore`, errors, { unit: "score", minimum: 0, maximum: 1 });
    const threshold = evidenceDatum(review.acceptanceThreshold, "Gated", `${subjectId}.acceptanceThreshold`, errors, { unit: "score", minimum: 0, maximum: 1 });
    if (!deriveComparison(score, threshold, "gte")) errors.push(`${subjectId} AI-vision score is below its gate`);
    if (!Array.isArray(review.criticalFeatures) || review.criticalFeatures.length < 1 || review.criticalFeatures.length > 5) {
      errors.push(`${subjectId} must contain one to five critical feature results`);
      continue;
    }
    const featureIds = new Set();
    for (const [featureIndex, feature] of review.criticalFeatures.entries()) {
      if (!exactKeys(feature, ["id", "score", "threshold"], `${subjectId}.criticalFeatures[${featureIndex}]`, errors)) continue;
      requireText(feature.id, `${subjectId}.criticalFeatures[${featureIndex}].id`, errors, ID_PATTERN);
      if (featureIds.has(feature.id)) errors.push(`${subjectId} duplicate critical feature ${feature.id}`);
      featureIds.add(feature.id);
      const featureScore = evidenceDatum(feature.score, "Measured", `${subjectId}.${feature.id}.score`, errors, { unit: "score", minimum: 0, maximum: 1 });
      const featureThreshold = evidenceDatum(feature.threshold, "Gated", `${subjectId}.${feature.id}.threshold`, errors, { unit: "score", minimum: 0, maximum: 1 });
      if (!deriveComparison(featureScore, featureThreshold, "gte")) errors.push(`${subjectId}/${feature.id} score is below its gate`);
    }
  }
}

function validateVisualErrors(document, bundleDir, context, header, contractById, errors) {
  if (!document) return;
  exactKeys(document, ["schemaVersion", "labId", "bundleId", "runId", "backend", "contractId", "results"], "visual-error-results.json", errors);
  validateDocumentHeader(document, "visual-error-results.json", { ...header, runId: header.runBindings.correctness, backend: context.backend }, errors);
  if (document.contractId !== VISUAL_CONTRACT_ID) errors.push("visual-error-results contractId drifted");
  if (!Array.isArray(document.results) || document.results.length !== CORPUS_VISUAL_INVARIANT_PLAN.length) {
    errors.push(`visual-error-results.json must contain exactly ${CORPUS_VISUAL_INVARIANT_PLAN.length} results`);
    return;
  }
  for (let index = 0; index < CORPUS_VISUAL_INVARIANT_PLAN.length; index += 1) {
    const expected = CORPUS_VISUAL_INVARIANT_PLAN[index];
    const result = document.results[index];
    if (!exactKeys(result, ["id", "metricId", "comparison", "measurement", "threshold", "captureFiles"], `visual-error-results.results[${index}]`, errors)) continue;
    if (result.id !== expected.id || result.metricId !== expected.metricId || result.comparison !== expected.comparison) {
      errors.push(`visual result ${index} identity/metric/comparison drifted`);
    }
    const measured = evidenceDatum(result.measurement, "Measured", `${expected.id}.measurement`, errors, { unit: expected.unit, minimum: 0 });
    const threshold = evidenceDatum(result.threshold, "Gated", `${expected.id}.threshold`, errors, { unit: expected.unit, minimum: 0 });
    const contract = contractById.get(expected.id);
    if (!contract || JSON.stringify(result.threshold) !== JSON.stringify(contract.threshold)) {
      errors.push(`${expected.id} result threshold must exactly match the frozen visual contract`);
    }
    if (!deriveComparison(measured, threshold, expected.comparison)) errors.push(`${expected.id} measured value failed its frozen gate`);
    validateFileReferenceSequence(bundleDir, result.captureFiles, expected.captureFilenames, context, `${expected.id}.captureFiles`, errors);
  }
}

function validateTimingWindow(window, index, kind, gates, errors) {
  const label = `timing.${kind}Windows[${index}]`;
  if (!exactKeys(window, [
    "id",
    "sampleCount",
    "cpuP50Ms",
    "cpuP95Ms",
    "gpuP50Ms",
    "gpuP95Ms",
    "presentationP95Ms",
    "deadlineMisses",
  ], label, errors)) return;
  requireText(window.id, `${label}.id`, errors, ID_PATTERN);
  const samples = evidenceDatum(window.sampleCount, "Measured", `${label}.sampleCount`, errors, { unit: "sample", integer: true, minimum: 1 });
  const cpu50 = evidenceDatum(window.cpuP50Ms, "Measured", `${label}.cpuP50Ms`, errors, { unit: "ms", minimum: 0 });
  const cpu95 = evidenceDatum(window.cpuP95Ms, "Measured", `${label}.cpuP95Ms`, errors, { unit: "ms", minimum: 0 });
  const gpu50 = evidenceDatum(window.gpuP50Ms, "Measured", `${label}.gpuP50Ms`, errors, { unit: "ms", minimum: 0 });
  const gpu95 = evidenceDatum(window.gpuP95Ms, "Measured", `${label}.gpuP95Ms`, errors, { unit: "ms", minimum: 0 });
  const presentation95 = evidenceDatum(window.presentationP95Ms, "Measured", `${label}.presentationP95Ms`, errors, { unit: "ms", minimum: 0 });
  const misses = evidenceDatum(window.deadlineMisses, "Measured", `${label}.deadlineMisses`, errors, { unit: "count", integer: true, minimum: 0 });
  if (samples < gates.minimumSamples) errors.push(`${label} has fewer than the gated minimum samples`);
  if (cpu50 > cpu95 || gpu50 > gpu95) errors.push(`${label} p50 must not exceed p95`);
  if (cpu95 > gates.cpuP95 || gpu95 > gates.gpuP95 || presentation95 > gates.presentationP95 || misses > gates.deadlineMisses) {
    errors.push(`${label} exceeded a frozen timing/deadline gate`);
  }
}

function validateTiming(document, header, context, errors) {
  if (!document) return;
  exactKeys(document, [
    "schemaVersion",
    "labId",
    "bundleId",
    "runId",
    "backend",
    "targetDevice",
    "displayRefreshHz",
    "targetPresentationRateHz",
    "refreshPeriodMs",
    "cpuSceneEnvelopeMs",
    "gpuSceneEnvelopeMs",
    "cpuP95GateMs",
    "gpuP95GateMs",
    "presentationP95GateMs",
    "deadlineMissGate",
    "minimumSamplesPerWindow",
    "gpuTimingRequirement",
    "timestampTrackingEnabled",
    "gpuTimestampSupport",
    "gpuTimestampScopes",
    "coldWindows",
    "sustainedWindows",
    "finalStableWindowId",
  ], "timing-trace.json", errors);
  validateDocumentHeader(document, "timing-trace.json", { ...header, runId: header.runBindings.performance, backend: context.backend }, errors);
  if (!exactKeys(document.targetDevice, ["id", "kind", "device", "os", "browser", "adapter"], "timing.targetDevice", errors)) return;
  requireText(document.targetDevice.id, "timing.targetDevice.id", errors, ID_PATTERN);
  if (document.targetDevice.kind !== "physical") errors.push("timing target must be a named physical device");
  for (const field of ["device", "os", "browser"]) requireText(document.targetDevice[field], `timing.targetDevice.${field}`, errors);
  if (document.targetDevice.adapter !== null) requireText(document.targetDevice.adapter, "timing.targetDevice.adapter", errors);
  const refresh = evidenceDatum(document.displayRefreshHz, "Measured", "timing.displayRefreshHz", errors, { unit: "Hz", minimum: Number.EPSILON });
  const targetRate = evidenceDatum(document.targetPresentationRateHz, "Gated", "timing.targetPresentationRateHz", errors, { unit: "Hz", minimum: Number.EPSILON });
  const period = evidenceDatum(document.refreshPeriodMs, "Derived", "timing.refreshPeriodMs", errors, { unit: "ms", minimum: Number.EPSILON });
  const cpuEnvelope = evidenceDatum(document.cpuSceneEnvelopeMs, "Derived", "timing.cpuSceneEnvelopeMs", errors, { unit: "ms", minimum: Number.EPSILON });
  const gpuEnvelope = evidenceDatum(document.gpuSceneEnvelopeMs, "Derived", "timing.gpuSceneEnvelopeMs", errors, { unit: "ms", minimum: Number.EPSILON });
  const cpuP95 = evidenceDatum(document.cpuP95GateMs, "Gated", "timing.cpuP95GateMs", errors, { unit: "ms", minimum: 0 });
  const gpuP95 = evidenceDatum(document.gpuP95GateMs, "Gated", "timing.gpuP95GateMs", errors, { unit: "ms", minimum: 0 });
  const presentationP95 = evidenceDatum(document.presentationP95GateMs, "Gated", "timing.presentationP95GateMs", errors, { unit: "ms", minimum: 0 });
  const deadlineMisses = evidenceDatum(document.deadlineMissGate, "Gated", "timing.deadlineMissGate", errors, { unit: "count", integer: true, minimum: 0 });
  const minimumSamples = evidenceDatum(document.minimumSamplesPerWindow, "Gated", "timing.minimumSamplesPerWindow", errors, { unit: "sample", integer: true, minimum: 2 });
  if (targetRate > refresh) errors.push("timing target presentation rate exceeds measured display refresh");
  if (!almostEqual(period, 1000 / targetRate, 1e-6)) errors.push("timing refresh period does not derive from the gated target rate");
  if (cpuEnvelope > period || gpuEnvelope > period || cpuP95 > cpuEnvelope || gpuP95 > gpuEnvelope || presentationP95 > period) {
    errors.push("timing envelopes/gates do not close under the refresh period");
  }
  if (document.gpuTimingRequirement !== "required" || document.timestampTrackingEnabled !== true || document.gpuTimestampSupport !== true) {
    errors.push("GPU timing acceptance requires pre-init timestamp tracking and available timestamp support");
  }
  if (!Array.isArray(document.gpuTimestampScopes) || document.gpuTimestampScopes.length === 0) errors.push("timing trace is missing GPU timestamp scopes");
  else {
    const ids = new Set();
    for (const [index, scope] of document.gpuTimestampScopes.entries()) {
      const label = `timing.gpuTimestampScopes[${index}]`;
      if (!exactKeys(scope, ["id", "kind", "resolved", "sampleCount", "p50Ms", "p95Ms"], label, errors)) continue;
      requireText(scope.id, `${label}.id`, errors, ID_PATTERN);
      if (ids.has(scope.id)) errors.push(`duplicate GPU timestamp scope ${scope.id}`);
      ids.add(scope.id);
      if (scope.kind !== "render") errors.push(`${label}.kind must be render for this no-compute corpus`);
      if (scope.resolved !== true) errors.push(`${label} is unresolved`);
      const samples = evidenceDatum(scope.sampleCount, "Measured", `${label}.sampleCount`, errors, { unit: "sample", integer: true, minimum: 1 });
      const p50 = evidenceDatum(scope.p50Ms, "Measured", `${label}.p50Ms`, errors, { unit: "ms", minimum: 0 });
      const p95 = evidenceDatum(scope.p95Ms, "Measured", `${label}.p95Ms`, errors, { unit: "ms", minimum: 0 });
      if (samples < minimumSamples || p50 > p95 || p95 > gpuP95) errors.push(`${label} failed sample/order/GPU gate closure`);
    }
    if (!ids.has("forward-scene")) errors.push("timing trace must resolve the forward-scene GPU scope");
  }
  const gates = { minimumSamples, cpuP95, gpuP95, presentationP95, deadlineMisses };
  if (!Array.isArray(document.coldWindows) || document.coldWindows.length === 0) errors.push("timing trace is missing cold windows");
  else document.coldWindows.forEach((window, index) => validateTimingWindow(window, index, "cold", gates, errors));
  if (!Array.isArray(document.sustainedWindows) || document.sustainedWindows.length < 2) errors.push("timing trace requires at least two sustained windows");
  else {
    document.sustainedWindows.forEach((window, index) => validateTimingWindow(window, index, "sustained", gates, errors));
    if (document.finalStableWindowId !== document.sustainedWindows.at(-1)?.id) errors.push("finalStableWindowId must name the final sustained window");
  }
}

function validateResourceLedger(document, header, context, errors) {
  if (!document) return;
  exactKeys(document, [
    "schemaVersion",
    "labId",
    "bundleId",
    "runId",
    "backend",
    "rows",
    "totals",
    "peakLiveBytesGate",
  ], "resource-ledger.json", errors);
  validateDocumentHeader(document, "resource-ledger.json", { ...header, runId: header.runBindings.performance, backend: context.backend }, errors);
  if (!Array.isArray(document.rows) || document.rows.length !== REQUIRED_RESOURCE_CATEGORIES.length) {
    errors.push(`resource ledger must contain exactly ${REQUIRED_RESOURCE_CATEGORIES.length} required rows`);
    return;
  }
  let logical = 0;
  let resident = 0;
  let reads = 0;
  let writes = 0;
  let maximumRowPeak = 0;
  for (let index = 0; index < REQUIRED_RESOURCE_CATEGORIES.length; index += 1) {
    const category = REQUIRED_RESOURCE_CATEGORIES[index];
    const row = document.rows[index];
    const label = `resources.rows[${index}]`;
    if (!exactKeys(row, [
      "id",
      "category",
      "owner",
      "logicalBytes",
      "residentBytes",
      "peakLiveBytes",
      "readBytesPerFrame",
      "writeBytesPerFrame",
      "allocationCount",
      "transient",
    ], label, errors)) continue;
    requireText(row.id, `${label}.id`, errors, ID_PATTERN);
    requireText(row.owner, `${label}.owner`, errors, ID_PATTERN);
    if (row.category !== category) errors.push(`${label}.category expected ${category}`);
    const rowLogical = evidenceDatum(row.logicalBytes, "Derived", `${label}.logicalBytes`, errors, { unit: "byte", minimum: 0 });
    const rowResident = evidenceDatum(row.residentBytes, "Derived", `${label}.residentBytes`, errors, { unit: "byte", minimum: 0 });
    const rowPeak = evidenceDatum(row.peakLiveBytes, "Derived", `${label}.peakLiveBytes`, errors, { unit: "byte", minimum: 0 });
    const rowReads = evidenceDatum(row.readBytesPerFrame, "Derived", `${label}.readBytesPerFrame`, errors, { unit: "byte/frame", minimum: 0 });
    const rowWrites = evidenceDatum(row.writeBytesPerFrame, "Derived", `${label}.writeBytesPerFrame`, errors, { unit: "byte/frame", minimum: 0 });
    evidenceDatum(row.allocationCount, "Measured", `${label}.allocationCount`, errors, { unit: "count", integer: true, minimum: 1 });
    if (typeof row.transient !== "boolean") errors.push(`${label}.transient must be boolean`);
    logical += rowLogical ?? 0;
    resident += rowResident ?? 0;
    reads += rowReads ?? 0;
    writes += rowWrites ?? 0;
    maximumRowPeak = Math.max(maximumRowPeak, rowPeak ?? 0);
  }
  if (!exactKeys(document.totals, [
    "logicalBytes",
    "residentBytes",
    "peakLiveBytes",
    "peakTransientBytes",
    "readBytesPerFrame",
    "writeBytesPerFrame",
  ], "resources.totals", errors)) return;
  const totalLogical = evidenceDatum(document.totals.logicalBytes, "Derived", "resources.totals.logicalBytes", errors, { unit: "byte", minimum: 0 });
  const totalResident = evidenceDatum(document.totals.residentBytes, "Derived", "resources.totals.residentBytes", errors, { unit: "byte", minimum: 0 });
  const peakLive = evidenceDatum(document.totals.peakLiveBytes, "Measured", "resources.totals.peakLiveBytes", errors, { unit: "byte", minimum: 0 });
  const peakTransient = evidenceDatum(document.totals.peakTransientBytes, "Measured", "resources.totals.peakTransientBytes", errors, { unit: "byte", minimum: 0 });
  const totalReads = evidenceDatum(document.totals.readBytesPerFrame, "Derived", "resources.totals.readBytesPerFrame", errors, { unit: "byte/frame", minimum: 0 });
  const totalWrites = evidenceDatum(document.totals.writeBytesPerFrame, "Derived", "resources.totals.writeBytesPerFrame", errors, { unit: "byte/frame", minimum: 0 });
  const peakGate = evidenceDatum(document.peakLiveBytesGate, "Gated", "resources.peakLiveBytesGate", errors, { unit: "byte", minimum: 0 });
  if (!almostEqual(totalLogical, logical) || !almostEqual(totalResident, resident) || !almostEqual(totalReads, reads) || !almostEqual(totalWrites, writes)) {
    errors.push("resource totals do not close over their exact rows");
  }
  if (peakLive < maximumRowPeak || peakTransient > peakLive || peakLive > peakGate) errors.push("resource peak values failed liveness/gate closure");
}

function validateLifecycle(document, header, context, errors) {
  if (!document) return;
  exactKeys(document, [
    "schemaVersion",
    "labId",
    "bundleId",
    "runId",
    "backend",
    "minimumIterations",
    "cases",
  ], "lifecycle-evidence.json", errors);
  validateDocumentHeader(document, "lifecycle-evidence.json", { ...header, runId: header.runBindings.lifecycle, backend: context.backend }, errors);
  const minimumIterations = evidenceDatum(document.minimumIterations, "Gated", "lifecycle.minimumIterations", errors, { unit: "iteration", integer: true, minimum: 1 });
  if (!Array.isArray(document.cases) || document.cases.length !== REQUIRED_LIFECYCLE_CASE_IDS.length) {
    errors.push(`lifecycle evidence must contain exactly ${REQUIRED_LIFECYCLE_CASE_IDS.length} cases`);
    return;
  }
  for (let index = 0; index < REQUIRED_LIFECYCLE_CASE_IDS.length; index += 1) {
    const id = REQUIRED_LIFECYCLE_CASE_IDS[index];
    const lifecycleCase = document.cases[index];
    const label = `lifecycle.cases[${index}]`;
    if (!exactKeys(lifecycleCase, [
      "id",
      "iterations",
      "equilibriumBefore",
      "equilibriumAfter",
      "peakLiveResources",
      "unhandledErrors",
      "requiredInvariantCount",
      "observedInvariantCount",
    ], label, errors)) continue;
    if (lifecycleCase.id !== id) errors.push(`${label}.id expected ${id}`);
    const iterations = evidenceDatum(lifecycleCase.iterations, "Measured", `${label}.iterations`, errors, { unit: "iteration", integer: true, minimum: 1 });
    const before = evidenceDatum(lifecycleCase.equilibriumBefore, "Measured", `${label}.equilibriumBefore`, errors, { unit: "resource", integer: true, minimum: 0 });
    const after = evidenceDatum(lifecycleCase.equilibriumAfter, "Measured", `${label}.equilibriumAfter`, errors, { unit: "resource", integer: true, minimum: 0 });
    const peak = evidenceDatum(lifecycleCase.peakLiveResources, "Measured", `${label}.peakLiveResources`, errors, { unit: "resource", integer: true, minimum: 0 });
    const unhandled = evidenceDatum(lifecycleCase.unhandledErrors, "Measured", `${label}.unhandledErrors`, errors, { unit: "count", integer: true, minimum: 0 });
    const required = evidenceDatum(lifecycleCase.requiredInvariantCount, "Gated", `${label}.requiredInvariantCount`, errors, { unit: "invariant", integer: true, minimum: 1 });
    const observed = evidenceDatum(lifecycleCase.observedInvariantCount, "Measured", `${label}.observedInvariantCount`, errors, { unit: "invariant", integer: true, minimum: 0 });
    if (iterations < minimumIterations || before !== after || peak < before || unhandled !== 0 || observed < required) {
      errors.push(`${label} failed iteration/equilibrium/error/invariant closure`);
    }
  }
}

function validateRouteEvidence(document, header, context, errors) {
  if (!document) return;
  exactKeys(document, ["schemaVersion", "labId", "bundleId", "runId", "backend", "routes"], "route-runtime-evidence.json", errors);
  validateDocumentHeader(document, "route-runtime-evidence.json", { ...header, runId: header.runBindings.routes, backend: context.backend }, errors);
  try {
    validatePhysicalRouteRuntimeRecords(document.routes);
  } catch (error) {
    errors.push(`route-runtime-evidence.json: ${error.message}`);
  }
}

function validateEvidenceManifest(document, bundleDir, context, errors) {
  if (!document) return null;
  exactKeys(document, [
    "schemaVersion",
    "labId",
    "bundleId",
    "runId",
    "backend",
    "profile",
    "runBindings",
    "captureSession",
    "routeRuntimeEvidence",
    "visualContract",
    "captures",
  ], "evidence-manifest.json", errors);
  if (document.schemaVersion !== 2 || document.labId !== LAB_ID) errors.push("evidence-manifest identity drifted");
  const bundleId = requireText(document.bundleId, "evidence-manifest.bundleId", errors, ID_PATTERN);
  requireText(document.runId, "evidence-manifest.runId", errors, ID_PATTERN);
  validateBackendRecord(document.backend, context.backend, "evidence-manifest.backend", errors);
  if (document.profile !== "correctness") errors.push("evidence-manifest.profile must be correctness");
  if (!exactKeys(document.runBindings, ["correctness", "routes", "performance", "lifecycle"], "evidence-manifest.runBindings", errors)) return null;
  for (const [profile, runId] of Object.entries(document.runBindings)) requireText(runId, `evidence-manifest.runBindings.${profile}`, errors, ID_PATTERN);
  if (new Set(Object.values(document.runBindings)).size !== 4) errors.push("evidence profile run IDs must be distinct");
  if (document.runBindings.correctness !== context.runId || document.runId !== context.runId) errors.push("evidence-manifest correctness run does not match capture hook run ID");
  const captureSession = confinedFileReference(bundleDir, document.captureSession, "evidence-manifest.captureSession", errors, { extensions: [".json"] });
  const routeRuntimeEvidence = confinedFileReference(bundleDir, document.routeRuntimeEvidence, "evidence-manifest.routeRuntimeEvidence", errors, { extensions: [".json"] });
  const visualContract = confinedFileReference(bundleDir, document.visualContract, "evidence-manifest.visualContract", errors, { extensions: [".json"] });
  if (document.captureSession?.path !== "capture-session.json") errors.push("evidence-manifest.captureSession path drifted");
  if (document.routeRuntimeEvidence?.path !== "route-runtime-evidence.json") errors.push("evidence-manifest.routeRuntimeEvidence path drifted");
  if (document.visualContract?.path !== "visual-contract.json") errors.push("evidence-manifest.visualContract path drifted");
  if (!Array.isArray(document.captures) || document.captures.length !== CORPUS_CAPTURE_PLAN.length) {
    errors.push(`evidence-manifest must contain exactly ${CORPUS_CAPTURE_PLAN.length} capture rows`);
  } else for (let index = 0; index < CORPUS_CAPTURE_PLAN.length; index += 1) {
    const planned = CORPUS_CAPTURE_PLAN[index];
    const capture = document.captures[index];
    if (!exactKeys(capture, ["filename", "state", "file"], `evidence-manifest.captures[${index}]`, errors)) continue;
    if (capture.filename !== planned.filename) errors.push(`evidence-manifest capture ${index} filename drifted`);
    try {
      assert.deepEqual(capture.state, planned.state);
    } catch {
      errors.push(`${planned.filename} evidence-manifest state drifted`);
    }
    confinedFileReference(bundleDir, capture.file, `${planned.filename}.manifestFile`, errors, { extensions: [".png"] });
    sameFileReference(capture.file, context.captureFiles.get(planned.filename), `${planned.filename}.manifestFile`, errors);
  }
  return Object.freeze({
    bundleId,
    runBindings: Object.freeze({ ...document.runBindings }),
    backend: context.backend,
    captureSession: captureSession && { path: captureSession.path, sha256: captureSession.sha256 },
    routeRuntimeEvidence: routeRuntimeEvidence && { path: routeRuntimeEvidence.path, sha256: routeRuntimeEvidence.sha256 },
    visualContract: visualContract && { path: visualContract.path, sha256: visualContract.sha256 },
  });
}

function validateAcceptanceSummary(document, bundleDir, context, header, errors) {
  if (!document) return;
  exactKeys(document, ["schemaVersion", "labId", "bundleId", "runId", "backend", "runBindings", "gates"], "acceptance-summary.json", errors);
  validateDocumentHeader(document, "acceptance-summary.json", { ...header, runId: header.runBindings.correctness, backend: context.backend }, errors);
  try {
    assert.deepEqual(document.runBindings, header.runBindings);
  } catch {
    errors.push("acceptance-summary runBindings drifted");
  }
  if (!Array.isArray(document.gates) || document.gates.length !== REQUIRED_ACCEPTANCE_GATES.length) {
    errors.push(`acceptance-summary must contain exactly ${REQUIRED_ACCEPTANCE_GATES.length} gates`);
    return;
  }
  for (let index = 0; index < REQUIRED_ACCEPTANCE_GATES.length; index += 1) {
    const gateId = REQUIRED_ACCEPTANCE_GATES[index];
    const gate = document.gates[index];
    if (!exactKeys(gate, ["id", "evidenceFiles"], `acceptance-summary.gates[${index}]`, errors)) continue;
    if (gate.id !== gateId) errors.push(`acceptance gate ${index} expected ${gateId}`);
    const expectedFiles = ACCEPTANCE_EVIDENCE_BY_GATE[gateId];
    if (!Array.isArray(gate.evidenceFiles) || gate.evidenceFiles.length !== expectedFiles.length) {
      errors.push(`${gateId} must cite exactly ${expectedFiles.length} validated evidence files`);
      continue;
    }
    for (let fileIndex = 0; fileIndex < expectedFiles.length; fileIndex += 1) {
      const expectedPath = expectedFiles[fileIndex];
      confinedFileReference(bundleDir, gate.evidenceFiles[fileIndex], `${gateId}.evidenceFiles[${fileIndex}]`, errors, { extensions: [".json"] });
      if (gate.evidenceFiles[fileIndex]?.path !== expectedPath) errors.push(`${gateId} cites an irrelevant evidence file at index ${fileIndex}`);
    }
  }
}

function validateSupplementalEvidence(bundleDir, context, missingEvidence, errors) {
  const documents = new Map();
  for (const filename of REQUIRED_SUPPLEMENTAL_EVIDENCE) {
    const path = resolve(bundleDir, filename);
    if (!existsSync(path)) {
      missingEvidence.push(filename);
      continue;
    }
    documents.set(filename, readJson(path, errors, filename));
  }
  if (missingEvidence.length > 0) return;

  const manifest = validateEvidenceManifest(documents.get("evidence-manifest.json"), bundleDir, context, errors);
  if (!manifest) {
    errors.push("supplemental evidence cannot bind without a valid evidence manifest");
    return;
  }
  const header = Object.freeze({ bundleId: manifest.bundleId, runBindings: manifest.runBindings, backend: context.backend });
  validateRouteEvidence(documents.get("route-runtime-evidence.json"), header, context, errors);
  const contractById = validateVisualContract(documents.get("visual-contract.json"), bundleDir, context, header, errors);
  validateVisualReviews(documents.get("visual-reviews.json"), bundleDir, context, header, manifest.visualContract, errors);
  validateVisualErrors(documents.get("visual-error-results.json"), bundleDir, context, header, contractById, errors);
  validateTiming(documents.get("timing-trace.json"), header, context, errors);
  validateResourceLedger(documents.get("resource-ledger.json"), header, context, errors);
  validateLifecycle(documents.get("lifecycle-evidence.json"), header, context, errors);
  validateAcceptanceSummary(documents.get("acceptance-summary.json"), bundleDir, context, header, errors);
}

export function validateCorpusArtifacts({ bundleDirectory } = {}) {
  const bundleDir = resolve(bundleDirectory ?? process.env.LAB_ARTIFACT_DIR ?? resolve(
    repositoryRoot,
    "artifacts/visual-validation/webgpu-object-sculptor-corpus/correctness",
  ));
  const structuralErrors = [];
  const evidenceErrors = [];
  const missingEvidence = [];
  let context = Object.freeze({ runId: null, backend: null, captureFiles: new Map() });

  if (!existsSync(bundleDir)) structuralErrors.push("artifact bundle does not exist");
  else {
    const sessionPath = resolve(bundleDir, "capture-session.json");
    if (!existsSync(sessionPath)) structuralErrors.push("missing capture-session.json");
    else context = validateCaptureSession(bundleDir, readJson(sessionPath, structuralErrors, "capture-session.json"), structuralErrors);
    validateSupplementalEvidence(bundleDir, context, missingEvidence, evidenceErrors);
  }

  const structuralVerdict = structuralErrors.length === 0 ? "PASS" : "FAIL";
  const completeAndValid = structuralVerdict === "PASS" && missingEvidence.length === 0 && evidenceErrors.length === 0;
  const missingPrerequisite = !existsSync(bundleDir)
    || structuralErrors.includes("missing capture-session.json")
    || missingEvidence.length > 0;
  const claimVerdict = completeAndValid ? "PASS" : missingPrerequisite ? "INSUFFICIENT_EVIDENCE" : "FAIL";
  return Object.freeze({
    schemaVersion: 2,
    labId: LAB_ID,
    bundleDir,
    evidenceRunId: context.runId,
    structuralVerdict,
    claimVerdict,
    captureCountRequired: CORPUS_CAPTURE_PLAN.length,
    physicalRouteRecordsRequired: CORPUS_PHYSICAL_ROUTE_PLAN.length,
    visualInvariantResultsRequired: CORPUS_VISUAL_INVARIANT_PLAN.length,
    structuralErrors: Object.freeze(structuralErrors),
    missingEvidence: Object.freeze(missingEvidence),
    evidenceErrors: Object.freeze(evidenceErrors),
    note: claimVerdict === "PASS"
      ? "Every exact schema, digest-bound file, profile run, route lock, visual threshold, timestamp, resource, lifecycle, and acceptance closure passed."
      : claimVerdict === "FAIL"
        ? "The supplied bundle is malformed, tampered, contradictory, or outside a frozen gate; declared PASS strings cannot override derived failure."
        : "Required capture, route, visual, timing, resource, or lifecycle evidence is absent; render-target captures alone are not acceptance.",
  });
}

function isMainModule() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMainModule()) {
  const result = validateCorpusArtifacts();
  console.log(JSON.stringify(result, null, 2));
  if (result.claimVerdict !== "PASS") process.exitCode = 1;
}
