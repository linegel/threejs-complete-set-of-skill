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
import {
  CORPUS_PERFORMANCE_EVIDENCE_LIMITS,
  validateObjectSculptorCorpusPerformanceIdentity,
} from "./frame-driver.js";
import { SCULPT_TARGET_IDS } from "./object-catalog.js";
import {
  CORPUS_CAPTURE_PLAN,
  CORPUS_RASTER_COMPARISON_PLAN,
  CORPUS_RASTER_GATES,
  CORPUS_REPRESENTATIVE_SEED,
  CORPUS_STANDARD_OUTPUT_PLAN,
  CORPUS_STANDARD_RASTER_CONTRACT,
  CORPUS_STRESS_SEED,
  computeCorpusStandardDerivationSha256,
  computeCorpusRasterComparisons,
  validateCorpusStandardDerivation,
} from "./capture-hook.mjs";
import { comparePngRgb, decodePngRaster } from "./png-raster.mjs";
import {
  CORPUS_EXECUTABLE_SOURCE_CLOSURE,
  CORPUS_EXECUTABLE_SOURCE_CLOSURE_SHA256,
  CORPUS_EXECUTABLE_SOURCE_CLOSURE_THREE_REVISION as CORPUS_EXECUTABLE_SOURCE_THREE_REVISION,
} from "./trusted-runtime-source-manifest.generated.js";
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
const CANONICAL_BROWSER_ENTRY = "threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/index.html";
const IN_APP_BROWSER_SURFACE = "codex-in-app-browser";
const PLAYWRIGHT_HEADLESS_SURFACE = "playwright-headless-chromium";
const CLAIM_VERDICTS = Object.freeze([
  "visualCorrectness",
  "mechanismCorrectness",
  "performanceCompliance",
  "gpuAttribution",
  "lifecycleStability",
  "visualError",
]);
const VALID_VERDICTS = new Set(["PASS", "FAIL", "INSUFFICIENT_EVIDENCE", "NOT_CLAIMED"]);
const STANDARD_OUTPUT_IDS = Object.freeze([
  "final.design",
  "no-post.design",
  "diagnostics.mosaic",
  "camera.near",
  "camera.design",
  "camera.far",
  "seed-0001.final",
  "seed-9e3779b9.final",
  "temporal.t000",
  "temporal.t001",
]);

const SCULPT_SPEC_PATH_BY_TARGET = Object.freeze({
  "articulated-desk-lamp": "threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/targets/articulated-desk-lamp/object-sculpt-spec.json",
  "potted-bonsai": "threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/targets/potted-bonsai/object-sculpt-spec.json",
  "ceramic-teapot": "threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/targets/ceramic-teapot/object-sculpt-spec.json",
});

export const CORPUS_TIMING_GATES = Object.freeze({
  minimumSamplesPerWindow: 120,
  coldMinimumDurationMs: 2_000,
  sustainedMinimumDurationMs: 30_000,
  sustainedWindowCount: 2,
  deadlineMisses: 0,
  minimumCoverageRatio: 0.95,
  maximumGapRatio: 0.05,
});

export const CORPUS_CORRECTNESS_CAPTURE_PROFILE = Object.freeze({
  profile: "correctness",
  width: 1200,
  height: 800,
  dpr: 1,
});

export function validateCorpusCorrectnessCaptureProfile(profile, profileConfig) {
  const errors = [];
  if (profile === "contract-fixture") {
    errors.push("contract-fixture capture profile is nonpublishable and cannot support canonical acceptance");
  } else if (profile !== CORPUS_CORRECTNESS_CAPTURE_PROFILE.profile) {
    errors.push("capture session must use the correctness profile");
  }
  if (!profileConfig || typeof profileConfig !== "object" || Array.isArray(profileConfig)) {
    errors.push("capture-session.profileConfig must be an object");
    return Object.freeze(errors);
  }
  if (
    profileConfig.width !== CORPUS_CORRECTNESS_CAPTURE_PROFILE.width
    || profileConfig.height !== CORPUS_CORRECTNESS_CAPTURE_PROFILE.height
    || profileConfig.dpr !== CORPUS_CORRECTNESS_CAPTURE_PROFILE.dpr
  ) {
    errors.push("canonical correctness capture profile must be exactly 1200x800 CSS pixels at DPR 1");
  }
  return Object.freeze(errors);
}

export const CORPUS_RESOURCE_PEAK_GATE_BYTES = 256 * 1024 * 1024;
export const CORPUS_LIFECYCLE_MINIMUM_ITERATIONS = 50;
const CORPUS_CRITICAL_FEATURE_SCORE_GATE = 0.8;

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

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizedSha256(value) {
  return typeof value === "string" && value.startsWith("sha256:") ? value.slice("sha256:".length) : value;
}

function stableSha256(value) {
  return sha256Bytes(Buffer.from(JSON.stringify(value)));
}

export function computeCorpusSourceProvenance() {
  return CORPUS_EXECUTABLE_SOURCE_CLOSURE;
}

function canonicalSculptSpec(subjectId) {
  const repositoryPath = SCULPT_SPEC_PATH_BY_TARGET[subjectId];
  const bytes = readFileSync(resolve(repositoryRoot, repositoryPath));
  const document = JSON.parse(bytes.toString("utf8"));
  const featureGroups = document?.qualityContract?.featureGroups;
  if (document?.targetId !== subjectId || !Array.isArray(featureGroups)) {
    throw new Error(`canonical ObjectSculptSpec feature contract is malformed for ${subjectId}`);
  }
  const requiredFeatures = featureGroups.filter(({ required }) => required === true).map((feature) => Object.freeze({
    id: feature.id,
    sha256: stableSha256(feature),
  }));
  if (requiredFeatures.length < 1 || requiredFeatures.length > 5) {
    throw new Error(`${subjectId} must declare one to five required authored feature groups`);
  }
  return Object.freeze({
    repositoryPath,
    sha256: sha256Bytes(bytes),
    requiredFeatures: Object.freeze(requiredFeatures),
  });
}

const CANONICAL_SOURCE_PROVENANCE = computeCorpusSourceProvenance();
export const CORPUS_SCULPT_SPEC_EVIDENCE = Object.freeze(Object.fromEntries(
  SCULPT_TARGET_IDS.map((subjectId) => [subjectId, canonicalSculptSpec(subjectId)]),
));

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
  if (!SHA256_PATTERN.test(document?.sourceHash ?? "")) errors.push(`${filename}.sourceHash must be lowercase 64-hex`);
  requireText(document?.buildRevision, `${filename}.buildRevision`, errors);
  if (expected?.bundleId && document?.bundleId !== expected.bundleId) errors.push(`${filename}.bundleId does not match evidence-manifest.json`);
  if (expected?.runId && document?.runId !== expected.runId) errors.push(`${filename}.runId does not match its declared profile run`);
  if (expected?.sourceHash && document?.sourceHash !== expected.sourceHash) errors.push(`${filename}.sourceHash does not match the captured canonical source closure`);
  if (expected?.buildRevision && document?.buildRevision !== expected.buildRevision) errors.push(`${filename}.buildRevision does not match the captured content-addressed build`);
  validateBackendRecord(document?.backend, expected?.backend ?? null, `${filename}.backend`, errors);
}

function validateRepositoryFileReference(reference, expected, label, errors) {
  if (!exactKeys(reference, ["repositoryPath", "sha256"], label, errors)) return;
  if (reference.repositoryPath !== expected.repositoryPath) errors.push(`${label}.repositoryPath must identify the canonical ObjectSculptSpec`);
  if (reference.sha256 !== expected.sha256) errors.push(`${label}.sha256 does not match the current canonical ObjectSculptSpec bytes`);
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

function confinedExtendedFileReference(bundleDir, reference, label, errors, options) {
  return confinedFileReference(bundleDir, {
    path: reference?.path,
    sha256: reference?.sha256,
  }, label, errors, options);
}

function confinedFinalizedCaptureSessionReference(bundleDir, reference, label, errors) {
  if (!exactKeys(reference, ["path", "contentBinding", "sha256", "byteLength"], label, errors)) return null;
  if (reference.path !== "capture-session.json") errors.push(`${label}.path must identify capture-session.json`);
  if (reference.contentBinding !== "finalized-file-hash-for-offline-promotion") errors.push(`${label}.contentBinding must identify the finalized offline file hash`);
  if (typeof reference.sha256 !== "string" || !/^sha256:[a-f0-9]{64}$/.test(reference.sha256)) errors.push(`${label}.sha256 must be an exact prefixed lowercase digest`);
  if (!Number.isInteger(reference.byteLength) || reference.byteLength < 0) errors.push(`${label}.byteLength must be an exact nonnegative integer`);
  if (!/^sha256:[a-f0-9]{64}$/.test(reference.sha256 ?? "")) return null;
  const file = confinedFileReference(bundleDir, {
    path: reference.path,
    sha256: normalizedSha256(reference.sha256),
  }, label, errors, { extensions: [".json"] });
  if (file && file.bytes.byteLength !== reference.byteLength) errors.push(`${label}.byteLength does not match the finalized capture-session bytes`);
  return file;
}

function sameFileReference(actual, expected, label, errors) {
  if (
    actual?.path !== expected?.path
    || normalizedSha256(actual?.sha256) !== normalizedSha256(expected?.sha256)
  ) errors.push(`${label} does not match the canonical capture/file reference`);
}

function validatePngCaptureFile(file, width, height, label, errors) {
  if (!file) return null;
  try {
    const decoded = decodePngRaster(file.bytes);
    if (decoded.width !== width || decoded.height !== height) errors.push(`${label} PNG dimensions do not match capture metadata`);
    const unique = new Set();
    for (let offset = 0; offset < decoded.rgba.length; offset += 4) {
      unique.add(`${decoded.rgba[offset]},${decoded.rgba[offset + 1]},${decoded.rgba[offset + 2]},${decoded.rgba[offset + 3]}`);
      if (unique.size > 1) break;
    }
    if (unique.size < 2) errors.push(`${label} decoded pixels are blank or constant`);
    return decoded;
  } catch (error) {
    errors.push(`${label} is not a valid supported PNG: ${error.message}`);
    return null;
  }
}

function validateSourceClosure(actual, label, errors) {
  const expected = CORPUS_EXECUTABLE_SOURCE_CLOSURE;
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
    errors.push(`${label} must contain the canonical executable source closure`);
    return;
  }
  try {
    assert.deepEqual(actual, expected);
  } catch {
    errors.push(`${label} omits, adds, or changes a canonical transitive executable dependency`);
  }
  if (actual.sourceHash !== CORPUS_EXECUTABLE_SOURCE_CLOSURE_SHA256) errors.push(`${label}.sourceHash does not match the canonical executable source closure`);
  if (actual.threeRevision !== CORPUS_EXECUTABLE_SOURCE_THREE_REVISION) errors.push(`${label}.threeRevision does not match the pinned Three revision`);
}

function validateCapturePixelEvidence(bundleDir, capture, pngFile, decodedPng, label, errors, { allowDerivedComposite = false } = {}) {
  const evidence = capture?.pixelEvidence;
  if (!exactKeys(evidence, ["transport", "normalized", "png"], `${label}.pixelEvidence`, errors)) return;
  const transport = evidence.transport;
  const normalized = evidence.normalized;
  const png = evidence.png;
  if (!exactKeys(transport, ["width", "height", "format", "origin", "bytesPerPixel", "bytesPerRow", "byteLength", "rawArtifact", "producerOwner", "retentionStatus"], `${label}.pixelEvidence.transport`, errors)) return;
  const derivedComposite = allowDerivedComposite && transport.retentionStatus === "not-applicable-derived-composite";
  if (transport.width !== capture.width || transport.height !== capture.height) errors.push(`${label} transport dimensions drifted from capture dimensions`);
  if (!derivedComposite) {
    if (transport.bytesPerPixel !== 4 || !new Set(["rgba8", "rgba8unorm", "rgba8unorm-srgb"]).has(transport.format)) errors.push(`${label} transport must identify a four-byte RGBA8 renderer return`);
    if (transport.origin !== "top-left") errors.push(`${label} renderer transport origin must match the Three r185 top-left render-target readback contract`);
    if (!Number.isInteger(transport.bytesPerRow) || transport.bytesPerRow < capture.width * 4) errors.push(`${label} transport bytesPerRow must be the actual integer renderer-returned row layout`);
    const minimumTransportLength = transport.bytesPerRow * (capture.height - 1) + capture.width * 4;
    const maximumTransportLength = transport.bytesPerRow * capture.height;
    if (!Number.isInteger(transport.byteLength) || transport.byteLength < minimumTransportLength || transport.byteLength > maximumTransportLength) errors.push(`${label} transport byteLength does not close over its actual renderer-returned layout`);
    if (transport.retentionStatus !== "retained") errors.push(`${label} renderer transport bytes must be retained for acceptance; metadata-only transport is insufficient`);
  } else if (transport.rawArtifact !== null) errors.push(`${label} derived composite must not invent a renderer transport artifact`);
  if (transport.producerOwner !== (derivedComposite ? "not-applicable-derived-output" : "shared-capture-runner")) {
    errors.push(`${label} renderer transport producer ownership is inconsistent with the capture kind`);
  }
  const transportFile = derivedComposite ? null : confinedFileReference(bundleDir, transport.rawArtifact, `${label}.pixelEvidence.transport.rawArtifact`, errors, { extensions: [".bin"] });
  if (transportFile && transportFile.bytes.length !== transport.byteLength) errors.push(`${label} retained renderer transport artifact length drifted`);
  let transportPackedSha256 = null;
  if (transportFile && Number.isInteger(transport.bytesPerRow)) {
    const transportPacked = Buffer.alloc(capture.width * capture.height * 4);
    for (let row = 0; row < capture.height; row += 1) {
      transportFile.bytes.copy(transportPacked, row * capture.width * 4, row * transport.bytesPerRow, row * transport.bytesPerRow + capture.width * 4);
    }
    transportPackedSha256 = sha256Bytes(transportPacked);
  }

  if (!exactKeys(normalized, ["alignmentBytes", "layout", "paddedBytesPerRow", "paddedByteLength", "rawArtifact", "packedArtifact", "producerOwner", "packedArtifactProducerOwner", "packedRgbaSha256", "packedByteLength", "origin", "orientationTransform"], `${label}.pixelEvidence.normalized`, errors)) return;
  const packedBytesPerRow = capture.width * 4;
  const paddedBytesPerRow = Math.ceil(packedBytesPerRow / 256) * 256;
  const paddedByteLength = paddedBytesPerRow * capture.height;
  if (normalized.alignmentBytes !== 256 || normalized.layout !== "cpu-normalized-padded-rgba8") errors.push(`${label} normalized layout must declare the requested 256-byte CPU padding separately from renderer transport`);
  if (normalized.origin !== "top-left" || normalized.orientationTransform !== "none") errors.push(`${label} normalized pixels must preserve the independently retained top-left controller bytes without a hidden origin transform`);
  if (normalized.paddedBytesPerRow !== paddedBytesPerRow || normalized.paddedByteLength !== paddedByteLength) errors.push(`${label} normalized padded layout does not derive from capture dimensions and alignment`);
  if (normalized.packedByteLength !== packedBytesPerRow * capture.height) errors.push(`${label} normalized packed byte length drifted`);
  if (!SHA256_PATTERN.test(normalized.packedRgbaSha256 ?? "")) errors.push(`${label} normalized packed RGBA hash is invalid`);
  const normalizedFile = confinedFileReference(bundleDir, normalized.rawArtifact, `${label}.pixelEvidence.normalized.rawArtifact`, errors, { extensions: [".bin"] });
  const packedFile = confinedFileReference(bundleDir, normalized.packedArtifact, `${label}.pixelEvidence.normalized.packedArtifact`, errors, { extensions: [".bin"] });
  const retainedPaths = [
    pngFile?.path,
    transportFile?.path,
    normalizedFile?.path,
    packedFile?.path,
  ].filter(Boolean);
  if (new Set(retainedPaths).size !== retainedPaths.length) errors.push(`${label} aliases independent PNG, transport, normalized, or packed artifacts`);
  if (normalized.producerOwner !== (derivedComposite ? "object-sculptor-capture-hook" : "shared-capture-runner")) errors.push(`${label} normalized padded artifact producer ownership drifted`);
  if (normalized.packedArtifactProducerOwner !== "object-sculptor-capture-hook") errors.push(`${label} normalized packed artifact must be owned by the Object Sculptor capture hook`);
  if (packedFile && packedFile.bytes.length !== normalized.packedByteLength) errors.push(`${label} normalized packed artifact length drifted`);
  if (packedFile && sha256Bytes(packedFile.bytes) !== normalized.packedRgbaSha256) errors.push(`${label} normalized packed artifact hash does not bind its retained bytes`);
  if (normalizedFile && normalizedFile.bytes.length !== paddedByteLength) errors.push(`${label} normalized padded artifact length drifted`);
  if (normalizedFile) {
    const packed = Buffer.alloc(normalized.packedByteLength);
    for (let row = 0; row < capture.height; row += 1) {
      normalizedFile.bytes.copy(packed, row * packedBytesPerRow, row * paddedBytesPerRow, row * paddedBytesPerRow + packedBytesPerRow);
    }
    if (sha256Bytes(packed) !== normalized.packedRgbaSha256) errors.push(`${label} normalized packed RGBA hash does not derive from retained padded bytes`);
  }
  if (transportPackedSha256 !== null && transportPackedSha256 !== normalized.packedRgbaSha256) errors.push(`${label} normalized pixels do not derive from the retained renderer transport bytes`);

  if (!exactKeys(png, ["path", "sha256", "producerOwner", "decodedRgbaSha256", "derivedFromPackedRgbaSha256"], `${label}.pixelEvidence.png`, errors)) return;
  if (png.producerOwner !== (derivedComposite ? "object-sculptor-capture-hook" : "shared-capture-runner")) errors.push(`${label} PNG producer ownership drifted`);
  sameFileReference(png, capture.file, `${label}.pixelEvidence.png`, errors);
  sameFileReference(png, pngFile, `${label}.pixelEvidence.png`, errors);
  if (png.decodedRgbaSha256 !== decodedPng?.rgbaSha256 || png.derivedFromPackedRgbaSha256 !== normalized.packedRgbaSha256) errors.push(`${label} PNG is not byte-bound to the retained normalized packed RGBA pixels`);
  if (decodedPng?.rgbaSha256 !== normalized.packedRgbaSha256) errors.push(`${label} decoded PNG RGBA does not equal the retained normalized packed RGBA bytes`);
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

function validateStandardDerivationShape(output, label, errors) {
  const derivation = output?.derivation;
  if (!exactKeys(derivation, ["schemaVersion", "kind", "inputs", "layout", "resampling", "output"], `${label}.derivation`, errors)) return;
  if (!Array.isArray(derivation.inputs) || derivation.inputs.length !== CORPUS_STANDARD_RASTER_CONTRACT.panelCount) {
    errors.push(`${label}.derivation.inputs must contain exactly three native source records`);
  } else for (let index = 0; index < derivation.inputs.length; index += 1) {
    const inputLabel = `${label}.derivation.inputs[${index}]`;
    const input = derivation.inputs[index];
    if (!exactKeys(input, [
      "ordinal",
      "subjectId",
      "capturePath",
      "capturePngSha256",
      "capturePngProducer",
      "normalizedPackedRgbaSha256",
      "normalizedRawArtifactPath",
      "normalizedRawArtifactSha256",
      "normalizedRawArtifactProducer",
      "normalizedPackedArtifactPath",
      "normalizedPackedArtifactSha256",
      "normalizedPackedArtifactProducer",
      "rendererTransportArtifactPath",
      "rendererTransportArtifactSha256",
      "rendererTransportArtifactProducer",
      "sourceRect",
      "panelRect",
    ], inputLabel, errors)) continue;
    exactKeys(input.sourceRect, ["x", "y", "width", "height"], `${inputLabel}.sourceRect`, errors);
    exactKeys(input.panelRect, ["x", "y", "width", "height"], `${inputLabel}.panelRect`, errors);
  }
  exactKeys(derivation.layout, [
    "direction",
    "panelCount",
    "equalWidth",
    "panelWidth",
    "panelHeight",
    "gapPixels",
    "syntheticFillPixels",
  ], `${label}.derivation.layout`, errors);
  exactKeys(derivation.resampling, [
    "sourcePolicy",
    "cropPolicy",
    "kernel",
    "coordinateRule",
    "edgeMode",
    "colorDomain",
  ], `${label}.derivation.resampling`, errors);
  exactKeys(derivation.output, [
    "path",
    "width",
    "height",
    "normalizedPackedRgbaSha256",
    "pngSha256",
    "producer",
  ], `${label}.derivation.output`, errors);
}

function validateStandardOutputs(bundleDir, hook, captureFiles, captureRecords, pipeline, errors) {
  const outputs = hook?.standardOutputs;
  const files = new Map();
  const decoded = new Map();
  if (!Array.isArray(outputs) || outputs.length !== STANDARD_OUTPUT_IDS.length) {
    errors.push(`capture hook must publish exactly ${STANDARD_OUTPUT_IDS.length} standard output disposition records`);
    return files;
  }
  for (let index = 0; index < STANDARD_OUTPUT_IDS.length; index += 1) {
    const expectedId = STANDARD_OUTPUT_IDS[index];
    const output = outputs[index];
    const label = `hookResult.standardOutputs[${index}]`;
    if (output?.id !== expectedId) errors.push(`${label}.id expected ${expectedId}`);
    if (output?.status === "CAPTURED") {
      if (!exactKeys(output, ["id", "status", "filename", "file", "sourceCaptures", "composition", "derivation", "derivationSha256", "pixelEvidence"], label, errors)) continue;
      if (output.filename !== `${expectedId}.png`) errors.push(`${label}.filename must equal ${expectedId}.png`);
      const plannedOutput = CORPUS_STANDARD_OUTPUT_PLAN[index];
      try {
        assert.deepEqual(output.sourceCaptures, plannedOutput.sourceCaptures);
      } catch {
        errors.push(`${label}.sourceCaptures must exactly match the canonical three-subject source plan`);
      }
      for (const sourceFilename of output.sourceCaptures ?? []) if (!captureFiles.has(sourceFilename)) errors.push(`${label}.sourceCaptures includes an unknown or unvalidated native capture ${sourceFilename}`);
      if (!exactKeys(output.composition, ["kind", "resampling", "byteForByteNativeBinding", "nativeTransportBinding", "syntheticFillPixels"], `${label}.composition`, errors)) continue;
      if (
        output.composition.kind !== "derived-three-panel-native-readback-contact-sheet"
        || output.composition.resampling !== CORPUS_STANDARD_RASTER_CONTRACT.resamplingKernel
        || output.composition.byteForByteNativeBinding !== false
        || output.composition.nativeTransportBinding !== "not-applicable-derived-output"
        || output.composition.syntheticFillPixels !== 0
      ) errors.push(`${label}.composition must identify deterministic derived output without inventing native transport or fill pixels`);
      validateStandardDerivationShape(output, label, errors);
      if (!SHA256_PATTERN.test(output.derivationSha256 ?? "")) errors.push(`${label}.derivationSha256 must be lowercase SHA-256`);
      else if (output.derivationSha256 !== computeCorpusStandardDerivationSha256(output.derivation)) errors.push(`${label}.derivationSha256 does not bind its canonical derivation graph`);
      try {
        validateCorpusStandardDerivation(output, captureRecords);
      } catch (error) {
        errors.push(`${label}.derivation is invalid: ${error.message}`);
      }
      exactKeys(output.file, ["path", "sha256", "producerOwner", "decodedRgbaSha256", "derivedFromPackedRgbaSha256"], `${label}.file`, errors);
      const file = confinedExtendedFileReference(bundleDir, output.file, `${label}.file`, errors, { extensions: [".png"] });
      if (output.file?.path !== output.filename) errors.push(`${label}.file.path must equal its standard filename`);
      const width = output.pixelEvidence?.transport?.width;
      const height = output.pixelEvidence?.transport?.height;
      if (width !== CORPUS_STANDARD_RASTER_CONTRACT.width || height !== CORPUS_STANDARD_RASTER_CONTRACT.height) {
        errors.push(`${label} must be exactly 1200x800 pixels`);
      }
      const raster = validatePngCaptureFile(file, width, height, `${label}.file`, errors);
      validateCapturePixelEvidence(bundleDir, { ...output, width, height }, file, raster, label, errors, { allowDerivedComposite: true });
      if (file) files.set(expectedId, { path: file.path, sha256: file.sha256 });
      if (raster) decoded.set(expectedId, raster);
    } else if (output?.status === "NOT_APPLICABLE") {
      if (!exactKeys(output, ["id", "status", "filename", "reason", "graphProof"], label, errors)) continue;
      if (output.filename !== null) errors.push(`${label}.filename must be null when structurally inapplicable`);
      requireText(output.reason, `${label}.reason`, errors);
      if (expectedId === "no-post.design") {
        if (!exactKeys(output.graphProof, ["pipelineOwner", "sceneRendersPerFrame", "postProcessPasses"], `${label}.graphProof`, errors)) continue;
        if (output.graphProof.pipelineOwner !== pipeline?.owner || output.graphProof.sceneRendersPerFrame !== 1 || output.graphProof.postProcessPasses !== 0) errors.push(`${label} does not prove a structurally inapplicable no-post output`);
      } else if (expectedId === "camera.far") {
        if (!exactKeys(output.graphProof, ["cameraContractOwner", "availableCameraIds", "omittedCameraId"], `${label}.graphProof`, errors)) continue;
        if (output.graphProof.cameraContractOwner !== "CORPUS_CAMERAS" || output.graphProof.omittedCameraId !== "far") errors.push(`${label} does not prove the authored camera contract omits a far bookmark`);
        try {
          assert.deepEqual(output.graphProof.availableCameraIds, ["design", "profile", "attachment", "close-material"]);
        } catch {
          errors.push(`${label}.graphProof.availableCameraIds drifted from the authored camera contract`);
        }
      } else errors.push(`${label} may not mark an applicable standard output NOT_APPLICABLE`);
    } else {
      errors.push(`${label}.status is invalid`);
    }
  }
  const final = decoded.get("final.design");
  const diagnostic = decoded.get("diagnostics.mosaic");
  if (!final || !diagnostic) errors.push("standard final.design and diagnostics.mosaic must both be captured composites");
  else {
    if (final.rgbaSha256 === diagnostic.rgbaSha256) errors.push("diagnostics.mosaic.png duplicates final.design.png");
    try {
      const delta = comparePngRgb(final, diagnostic);
      if (delta.changedPixelRatio < 0.01 || delta.rgbMaeCodeValues < 0.5) errors.push("diagnostics.mosaic.png does not differ materially from final.design.png");
    } catch (error) {
      errors.push(`standard final/diagnostic comparison failed: ${error.message}`);
    }
  }
  const rasterOwners = new Map();
  for (const [id, raster] of decoded) {
    const key = `${raster.width}x${raster.height}:${raster.rgbaSha256}`;
    if (rasterOwners.has(key)) errors.push(`${id} duplicates standard output ${rasterOwners.get(key)}`);
    rasterOwners.set(key, id);
  }
  return files;
}

function postDisposeValueHasFailure(value) {
  if (value === null || value === undefined || value === false || value === 0 || value === "") return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number" || typeof value === "boolean") return Boolean(value);
  if (Array.isArray(value)) return value.some(postDisposeValueHasFailure);
  if (typeof value === "object") return Object.values(value).some(postDisposeValueHasFailure);
  return true;
}

function validatePostDisposeSnapshot(snapshot, errors) {
  if (!exactKeys(snapshot, [
    "labError",
    "gpuEvents",
    "threeGpuEvents",
    "imagePipelineGpuEvents",
    "deviceErrors",
    "visibilityState",
  ], "capture-session.postDisposeSnapshot", errors)) return;
  for (const field of ["labError", "gpuEvents", "threeGpuEvents", "imagePipelineGpuEvents", "deviceErrors"]) {
    if (postDisposeValueHasFailure(snapshot[field])) errors.push(`capture-session.postDisposeSnapshot.${field} recorded an error after disposal and the two-frame settling barrier`);
  }
  if (snapshot.visibilityState !== "visible") errors.push("capture-session.postDisposeSnapshot must be observed while the capture page remains visible");
}

function validateArtifactWriteLedger(bundleDir, records, errors) {
  const byPath = new Map();
  if (!Array.isArray(records) || records.length === 0) {
    errors.push("capture-session.artifactWrites must be a nonempty fresh-write ledger");
    return byPath;
  }
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const label = `capture-session.artifactWrites[${index}]`;
    if (!exactKeys(record, ["sequence", "path", "kind", "existedBefore", "contentBinding", "sha256", "byteLength"], label, errors)) continue;
    if (record.sequence !== index + 1) errors.push(`${label}.sequence must be contiguous and ordered from one`);
    if (typeof record.path !== "string" || record.path.length === 0 || isAbsolute(record.path) || record.path.split(/[\\/]/).includes("..") || record.path.includes("\\")) {
      errors.push(`${label}.path must be a confined bundle-relative POSIX path`);
    }
    requireText(record.kind, `${label}.kind`, errors);
    if (typeof record.existedBefore !== "boolean") errors.push(`${label}.existedBefore must preserve the observed pre-write state`);
    const selfExcluded = record.contentBinding === "self-excluded-finalized-offline";
    if (selfExcluded) {
      if (
        record.path !== "capture-session.json"
        || record.kind !== "capture-session-record"
        || record.sha256 !== null
        || record.byteLength !== null
      ) errors.push(`${label} is not the exact capture-session self-exclusion record`);
    } else {
      if (record.contentBinding !== "sha256-byte-length-immutable-buffer-v1") errors.push(`${label}.contentBinding does not identify immutable write-bound bytes`);
      if (typeof record.sha256 !== "string" || !/^sha256:[a-f0-9]{64}$/.test(record.sha256)) errors.push(`${label}.sha256 must be an exact prefixed lowercase digest`);
      if (!Number.isInteger(record.byteLength) || record.byteLength < 0) errors.push(`${label}.byteLength must be an exact nonnegative integer`);
      if (/^sha256:[a-f0-9]{64}$/.test(record.sha256 ?? "") && Number.isInteger(record.byteLength) && record.byteLength >= 0) {
        const file = confinedFileReference(bundleDir, {
          path: record.path,
          sha256: normalizedSha256(record.sha256),
        }, `${label}.content`, errors);
        if (file && file.bytes.byteLength !== record.byteLength) errors.push(`${label}.byteLength changed after ledger binding`);
      }
    }
    if (byPath.has(record.path)) errors.push(`${label}.path duplicates an earlier write in the same capture session`);
    byPath.set(record.path, record);
  }
  const finalRecord = records.at(-1);
  if (
    finalRecord?.path !== "capture-session.json"
    || finalRecord?.kind !== "capture-session-record"
    || finalRecord?.contentBinding !== "self-excluded-finalized-offline"
    || finalRecord?.sha256 !== null
    || finalRecord?.byteLength !== null
  ) {
    errors.push("capture-session.json must be the final write-ledger record");
  }
  return byPath;
}

function validateWrittenCaptureRecord(written, capture, label, errors) {
  if (!exactKeys(written, [
    "target",
    "width",
    "height",
    "bytesPerPixel",
    "bytesPerRow",
    "sourceBytesPerRow",
    "sourceByteLength",
    "transportByteLength",
    "sourceLayout",
    "sourceOrigin",
    "origin",
    "orientationTransform",
    "sourceFormat",
    "format",
    "colorEncoding",
    "transport",
    "normalized",
    "controllerNormalized",
    "png",
  ], label, errors)) return;
  if (written.target !== "presentation") errors.push(`${label}.target must identify the presentation readback`);
  if (
    written.width !== capture.width
    || written.height !== capture.height
    || written.bytesPerPixel !== 4
    || written.bytesPerRow !== capture.width * 4
    || written.sourceOrigin !== "top-left"
    || written.origin !== "top-left"
    || written.orientationTransform !== "none"
  ) errors.push(`${label} dimensions or top-left RGBA8 layout drifted from the native capture`);

  if (!exactKeys(written.transport, ["artifact", "layout", "rendererCopy"], `${label}.transport`, errors)) return;
  if (!exactKeys(written.transport.layout, [
    "width",
    "height",
    "format",
    "layout",
    "origin",
    "bytesPerPixel",
    "rowBytes",
    "bytesPerRow",
    "byteLength",
    "paddingKind",
    "paddingBytesPerRow",
  ], `${label}.transport.layout`, errors)) return;
  if (!exactKeys(written.transport.rendererCopy, ["layout", "bytesPerRow", "byteLength", "rawBytesRetained", "requestedLayout"], `${label}.transport.rendererCopy`, errors)) return;
  const transportLayout = written.transport.layout;
  if (
    transportLayout.width !== capture.width
    || transportLayout.height !== capture.height
    || transportLayout.origin !== "top-left"
    || transportLayout.bytesPerPixel !== 4
    || transportLayout.rowBytes !== capture.width * 4
    || transportLayout.bytesPerRow !== capture.pixelEvidence.transport.bytesPerRow
    || transportLayout.byteLength !== capture.pixelEvidence.transport.byteLength
    || transportLayout.paddingBytesPerRow !== transportLayout.bytesPerRow - transportLayout.rowBytes
    || !new Set(["compact", "webgpu-aligned-final-row-unpadded", "webgpu-aligned-fully-padded", "padded"]).has(transportLayout.paddingKind)
  ) errors.push(`${label}.transport.layout does not reconcile the logical row with the retained renderer transport`);
  if (written.transport.rendererCopy.rawBytesRetained !== true) errors.push(`${label}.transport.rendererCopy must retain the actual renderer-returned bytes`);
  sameFileReference(written.transport.artifact, capture.pixelEvidence.transport.rawArtifact, `${label}.transport.artifact`, errors);

  if (!exactKeys(written.normalized, [
    "artifact",
    "layout",
    "alignmentBytes",
    "bytesPerRow",
    "byteLength",
    "origin",
    "orientationTransform",
    "compact",
    "compactRgbaSha256",
    "compactByteLength",
  ], `${label}.normalized`, errors)) return;
  if (!exactKeys(written.normalized.compact, ["layout", "origin", "bytesPerRow", "byteLength", "sha256"], `${label}.normalized.compact`, errors)) return;
  if (
    written.normalized.layout !== "cpu-normalized-padded-rgba8"
    || written.normalized.alignmentBytes !== 256
    || written.normalized.bytesPerRow !== capture.pixelEvidence.normalized.paddedBytesPerRow
    || written.normalized.byteLength !== capture.pixelEvidence.normalized.paddedByteLength
    || written.normalized.origin !== "top-left"
    || written.normalized.orientationTransform !== "none"
    || normalizedSha256(written.normalized.compactRgbaSha256) !== capture.pixelEvidence.normalized.packedRgbaSha256
    || normalizedSha256(written.normalized.compact.sha256) !== capture.pixelEvidence.normalized.packedRgbaSha256
  ) errors.push(`${label}.normalized does not reconcile the shared padded and compact top-left pixels`);
  sameFileReference(written.normalized.artifact, capture.pixelEvidence.normalized.rawArtifact, `${label}.normalized.artifact`, errors);

  if (!exactKeys(written.controllerNormalized, [
    "layout",
    "origin",
    "orientationTransform",
    "byteLength",
    "sha256",
    "compactSha256",
    "independentPaddedSha256",
    "paddingBytesPerRow",
    "paddingVerifiedZero",
    "reconciliationStatus",
  ], `${label}.controllerNormalized`, errors)) return;
  if (!exactKeys(written.controllerNormalized.layout, ["width", "height", "format", "rowBytes", "bytesPerRow", "byteLength", "padding"], `${label}.controllerNormalized.layout`, errors)) return;
  const controllerNormalized = written.controllerNormalized;
  if (
    controllerNormalized.layout.width !== capture.width
    || controllerNormalized.layout.height !== capture.height
    || controllerNormalized.layout.rowBytes !== capture.width * 4
    || controllerNormalized.layout.bytesPerRow !== capture.pixelEvidence.normalized.paddedBytesPerRow
    || controllerNormalized.layout.byteLength !== capture.pixelEvidence.normalized.paddedByteLength
    || controllerNormalized.origin !== "top-left"
    || controllerNormalized.orientationTransform !== "none"
    || normalizedSha256(controllerNormalized.sha256) !== normalizedSha256(written.normalized.artifact.sha256)
    || normalizedSha256(controllerNormalized.compactSha256) !== capture.pixelEvidence.normalized.packedRgbaSha256
    || normalizedSha256(controllerNormalized.independentPaddedSha256) !== normalizedSha256(written.normalized.artifact.sha256)
    || controllerNormalized.paddingVerifiedZero !== true
    || controllerNormalized.reconciliationStatus !== "PASS"
  ) errors.push(`${label}.controllerNormalized does not prove zero-padded reconciliation with the independently normalized pixels`);

  if (!exactKeys(written.png, ["path", "sha256", "byteLength", "encoding", "derivedFromCompactRgbaSha256", "width", "height"], `${label}.png`, errors)) return;
  if (
    written.png.width !== capture.width
    || written.png.height !== capture.height
    || written.png.encoding !== "png-rgba8-srgb"
    || normalizedSha256(written.png.derivedFromCompactRgbaSha256) !== capture.pixelEvidence.normalized.packedRgbaSha256
  ) errors.push(`${label}.png does not bind the independently normalized compact pixels`);
  sameFileReference(written.png, capture.pixelEvidence.png, `${label}.png`, errors);
}

function validateArtifactWriteClosure(ledgerByPath, hook, errors) {
  const expected = new Map([["capture-session.json", "capture-session-record"]]);
  const addExpected = (path, kind, label) => {
    if (typeof path !== "string" || path.length === 0) {
      errors.push(`${label} has no artifact path for write-ledger closure`);
      return;
    }
    if (expected.has(path)) errors.push(`${label} aliases another expected artifact-write path`);
    expected.set(path, kind);
  };
  for (const capture of hook?.captures ?? []) {
    addExpected(capture?.pixelEvidence?.png?.path, "writeCapture-png", `${capture?.filename ?? "capture"}.png`);
    addExpected(capture?.pixelEvidence?.transport?.rawArtifact?.path, "writeCapture-transport", `${capture?.filename ?? "capture"}.transport`);
    addExpected(capture?.pixelEvidence?.normalized?.rawArtifact?.path, "writeCapture-normalized", `${capture?.filename ?? "capture"}.normalized`);
    addExpected(capture?.pixelEvidence?.normalized?.packedArtifact?.path, "hook-artifact", `${capture?.filename ?? "capture"}.packed`);
  }
  for (const output of hook?.standardOutputs ?? []) {
    if (output?.status !== "CAPTURED") continue;
    addExpected(output?.pixelEvidence?.png?.path, "hook-artifact", `${output?.id ?? "standard"}.png`);
    addExpected(output?.pixelEvidence?.normalized?.rawArtifact?.path, "hook-artifact", `${output?.id ?? "standard"}.normalized`);
    addExpected(output?.pixelEvidence?.normalized?.packedArtifact?.path, "hook-artifact", `${output?.id ?? "standard"}.packed`);
  }
  if (ledgerByPath.size !== expected.size) errors.push(`capture-session.artifactWrites must close over exactly ${expected.size} referenced artifacts, received ${ledgerByPath.size}`);
  for (const [path, kind] of expected) {
    const record = ledgerByPath.get(path);
    if (!record) errors.push(`capture-session.artifactWrites omits freshly written ${path}`);
    else if (record.kind !== kind) errors.push(`capture-session.artifactWrites records ${path} as ${record.kind}, expected ${kind}`);
  }
  for (const path of ledgerByPath.keys()) if (!expected.has(path)) errors.push(`capture-session.artifactWrites contains unreferenced artifact ${path}`);
}

function sharedArtifactMatchesHook(shared, hookReference, label, errors) {
  if (!exactKeys(shared, ["path", "sha256", "byteLength"], label, errors)) return;
  sameFileReference(shared, hookReference, label, errors);
  if (!Number.isInteger(shared.byteLength) || shared.byteLength <= 0) errors.push(`${label}.byteLength must be a positive observed file length`);
}

function validateSharedOutputPlan(outputPlan, hook, errors) {
  if (!Array.isArray(outputPlan) || outputPlan.length !== CORPUS_STANDARD_OUTPUT_PLAN.length) {
    errors.push("capture session outputPlan must close over all standard output dispositions");
    return;
  }
  const hookById = new Map((hook?.standardOutputs ?? []).map((output) => [output?.id, output]));
  for (let index = 0; index < CORPUS_STANDARD_OUTPUT_PLAN.length; index += 1) {
    const planned = CORPUS_STANDARD_OUTPUT_PLAN[index];
    const output = outputPlan[index];
    const hookOutput = hookById.get(planned.id);
    const label = `capture-session.outputPlan[${index}]`;
    if (planned.status === "CAPTURED") {
      if (!exactKeys(output, ["id", "status", "filename", "sourceCaptures", "artifact", "derivation"], label, errors)) continue;
      if (output.id !== planned.id || output.status !== "CAPTURED" || output.filename !== planned.filename) errors.push(`${label} captured output identity drifted`);
      try {
        assert.deepEqual(output.sourceCaptures, planned.sourceCaptures);
      } catch {
        errors.push(`${label}.sourceCaptures drifted from the canonical output plan`);
      }
      sharedArtifactMatchesHook(output.artifact, hookOutput?.pixelEvidence?.png, `${label}.artifact`, errors);
      if (!exactKeys(output.derivation, ["kind", "validationStatus", "sourceCaptures", "outputFile", "normalizedRaw", "normalizedPacked"], `${label}.derivation`, errors)) continue;
      if (output.derivation.kind !== "hook-validated-derived-output" || output.derivation.validationStatus !== "PASS") errors.push(`${label}.derivation was not validated by the hook/shared-runner boundary`);
      try {
        assert.deepEqual(output.derivation.sourceCaptures, planned.sourceCaptures);
      } catch {
        errors.push(`${label}.derivation.sourceCaptures drifted`);
      }
      sharedArtifactMatchesHook(output.derivation.outputFile, hookOutput?.pixelEvidence?.png, `${label}.derivation.outputFile`, errors);
      sharedArtifactMatchesHook(output.derivation.normalizedRaw, hookOutput?.pixelEvidence?.normalized?.rawArtifact, `${label}.derivation.normalizedRaw`, errors);
      sharedArtifactMatchesHook(output.derivation.normalizedPacked, hookOutput?.pixelEvidence?.normalized?.packedArtifact, `${label}.derivation.normalizedPacked`, errors);
    } else {
      if (!exactKeys(output, ["id", "status", "filename", "reason", "graphProof"], label, errors)) continue;
      try {
        assert.deepEqual(output, planned);
      } catch {
        errors.push(`${label} structurally inapplicable disposition drifted from the canonical output plan`);
      }
    }
  }
}

function validateCaptureSession(bundleDir, session, errors) {
  const emptyContext = Object.freeze({ runId: null, backend: null, captureFiles: new Map(), standardOutputFiles: new Map(), rasterComparisons: new Map(), sourceHash: null, buildRevision: null, captureProvenance: null });
  if (!session || typeof session !== "object") return emptyContext;
  exactKeys(session, [
    "schemaVersion",
    "labId",
    "sourceHash",
    "sourceClosureHash",
    "sourceClosure",
    "buildRevision",
    "threeRevision",
    "profile",
    "profileConfig",
    "automationSurface",
    "adapterClass",
    "adapterIdentity",
    "browser",
    "browserEntry",
    "url",
    "finalUrl",
    "route",
    "startedAt",
    "finishedAt",
    "runtime",
    "finalRuntime",
    "postDisposeSnapshot",
    "outputPlan",
    "writtenCaptures",
    "artifactWrites",
    "hookResult",
    "pageErrors",
    "consoleErrors",
    "requestErrors",
    "note",
  ], "capture-session.json", errors);
  validatePostDisposeSnapshot(session.postDisposeSnapshot, errors);
  const artifactWriteByPath = validateArtifactWriteLedger(bundleDir, session.artifactWrites, errors);
  const metrics = session.runtime?.metrics;
  const pipeline = session.runtime?.pipeline;
  const hook = session.hookResult;
  if (session.schemaVersion !== 2) errors.push("capture session must use schemaVersion 2");
  if (session.labId !== LAB_ID) errors.push("capture session labId mismatch");
  if (session.sourceHash !== CANONICAL_SOURCE_PROVENANCE.sourceHash) errors.push("capture session sourceHash does not match the current canonical executable source closure");
  if (session.sourceClosureHash !== CANONICAL_SOURCE_PROVENANCE.sourceHash) errors.push("capture session sourceClosureHash does not match the current canonical executable source closure");
  validateSourceClosure(session.sourceClosure, "capture-session.sourceClosure", errors);
  if (session.buildRevision !== CANONICAL_SOURCE_PROVENANCE.buildRevision) errors.push("capture session buildRevision must be the canonical content-addressed source revision");
  if (session.threeRevision !== CORPUS_EXECUTABLE_SOURCE_THREE_REVISION) errors.push("capture session Three revision drifted from the pinned executable source closure");
  errors.push(...validateCorpusCorrectnessCaptureProfile(session.profile, session.profileConfig));
  if (!exactKeys(session.profileConfig, ["width", "height", "dpr"], "capture-session.profileConfig", errors)) return emptyContext;
  const profileWidth = session.profileConfig.width;
  const profileHeight = session.profileConfig.height;
  const profileDpr = session.profileConfig.dpr;
  if (!Number.isInteger(profileWidth) || profileWidth < 1 || !Number.isInteger(profileHeight) || profileHeight < 1) {
    errors.push("capture-session.profileConfig width/height must be positive integer CSS pixels");
  }
  if (!Number.isFinite(profileDpr) || profileDpr <= 0 || profileDpr > 4) errors.push("capture-session.profileConfig.dpr must be finite in (0, 4]");
  if (!exactKeys(session.browser, ["name", "version", "userAgent", "platform", "automationSurface", "adapterClass", "adapterIdentity"], "capture-session.browser", errors)) return emptyContext;
  for (const field of ["name", "version", "userAgent", "platform"]) requireText(session.browser[field], `capture-session.browser.${field}`, errors);
  if (session.browser.automationSurface !== PLAYWRIGHT_HEADLESS_SURFACE) errors.push("correctness capture session must identify the Playwright headless Chromium collection surface");
  if (!new Set(["hardware", "software", "unknown"]).has(session.browser.adapterClass)) errors.push("capture-session.browser.adapterClass is invalid");
  if (!session.browser.adapterIdentity || typeof session.browser.adapterIdentity !== "object" || Array.isArray(session.browser.adapterIdentity) || Object.keys(session.browser.adapterIdentity).length === 0) errors.push("capture-session.browser.adapterIdentity must record observed adapter identity without inference");
  if (session.automationSurface !== PLAYWRIGHT_HEADLESS_SURFACE || session.automationSurface !== session.browser.automationSurface) errors.push("capture session top-level/browser automation surfaces disagree");
  if (session.adapterClass !== session.browser.adapterClass || JSON.stringify(session.adapterIdentity) !== JSON.stringify(session.browser.adapterIdentity)) errors.push("capture session top-level/browser adapter evidence disagrees");
  if (session.browserEntry !== CANONICAL_BROWSER_ENTRY) errors.push("capture-session.browserEntry drifted from the canonical corpus entry");
  try {
    const url = new URL(session.finalUrl);
    const canonicalDirectory = `/${dirname(CANONICAL_BROWSER_ENTRY)}/`;
    const canonicalFile = `/${CANONICAL_BROWSER_ENTRY}`;
    if (!new Set(["http:", "https:"]).has(url.protocol) || (url.pathname !== canonicalDirectory && url.pathname !== canonicalFile)) {
      errors.push("capture-session.url must navigate the canonical corpus entry over HTTP(S)");
    }
    if (url.username || url.password || url.hash) errors.push("capture-session.url must not contain credentials or a fragment");
    if (url.searchParams.getAll("capture").length !== 1 || url.searchParams.get("capture") !== "1") errors.push("capture-session.url must contain exactly one capture=1 query");
    if (url.searchParams.getAll("profile").length !== 1 || url.searchParams.get("profile") !== "correctness") errors.push("capture-session.url must contain exactly one profile=correctness query");
    if ([...url.searchParams.keys()].some((key) => !new Set(["capture", "profile"]).has(key))) errors.push("capture-session.url contains an undeclared query parameter");
  } catch {
    errors.push("capture-session.finalUrl must be an absolute canonical URL");
  }
  if (session.url !== session.finalUrl) errors.push("capture session correctness route redirected unexpectedly");
  if (!exactKeys(session.route, ["requestedUrl", "finalUrl", "browserEntry", "manifestLabId", "observedRuntimeLabId", "lockedState", "observedState", "finalState"], "capture-session.route", errors)) return emptyContext;
  if (session.route.requestedUrl !== session.url || session.route.finalUrl !== session.finalUrl || session.route.browserEntry !== CANONICAL_BROWSER_ENTRY || session.route.manifestLabId !== LAB_ID || session.route.observedRuntimeLabId !== LAB_ID) errors.push("capture-session.route identity or final URL drifted");
  try {
    assert.deepEqual(session.route.lockedState, session.route.observedState);
  } catch {
    errors.push("capture-session.route did not apply the fixed startup state before capture");
  }
  const finalMetrics = session.finalRuntime?.metrics;
  const expectedFinalState = finalMetrics && {
    scenario: finalMetrics.scenario ?? finalMetrics.subjectId,
    mode: finalMetrics.mode,
    tier: finalMetrics.tier,
    camera: finalMetrics.camera,
    seed: finalMetrics.seed,
    timeSeconds: finalMetrics.timeSeconds ?? finalMetrics.time,
  };
  try {
    assert.deepEqual(session.route.finalState, expectedFinalState);
  } catch {
    errors.push("capture-session.route final state does not match the final post-hook runtime state");
  }
  const startedAt = Date.parse(session.startedAt);
  const finishedAt = Date.parse(session.finishedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt) errors.push("capture-session wall-clock interval is invalid");
  for (const [channel, values] of [["page", session.pageErrors], ["console", session.consoleErrors], ["request", session.requestErrors]]) {
    if (!Array.isArray(values) || values.length !== 0) errors.push(`capture session recorded ${channel} errors`);
  }
  if (metrics?.nativeWebGPU !== true || String(metrics?.backend ?? metrics?.backendKind).toLowerCase() !== "webgpu") {
    errors.push("capture session did not prove native WebGPU");
  }
  if (metrics?.initialized !== true || metrics?.firstFrameCompleted !== true || metrics?.lastFrameError !== null) {
    errors.push("capture session did not record an initialized, completed, error-free frame");
  }
  if (session.finalRuntime?.metrics?.nativeWebGPU !== true || session.finalRuntime?.metrics?.lastFrameError !== null) errors.push("capture session finalRuntime lost native WebGPU/error-free state");
  validateSharedOutputPlan(session.outputPlan, hook, errors);
  if (!Array.isArray(session.writtenCaptures) || session.writtenCaptures.length !== CORPUS_CAPTURE_PLAN.length) errors.push("capture session writtenCaptures must retain exactly every declared native source readback");
  if (
    pipeline?.owner !== "WebGPURenderer"
    || pipeline?.sceneRendersPerFrame !== 1
    || pipeline?.finalOutputOwner !== "renderer"
    || !isSrgb(pipeline?.outputColorSpace)
  ) errors.push("capture session did not preserve one WebGPURenderer scene/output owner");
  if (hook?.schemaVersion !== 2) errors.push("capture hook must use schemaVersion 2");
  validateSourceClosure(hook?.sourceClosure, "capture hook sourceClosure", errors);
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
  const captureRecords = new Map();
  const writtenCaptureByFilename = new Map((session.writtenCaptures ?? []).map((capture) => [capture?.png?.path, capture]));
  let rasterComparisons = new Map();
  if (!Array.isArray(captures)) errors.push("capture hook did not publish captures");
  else {
    if (captures.length !== CORPUS_CAPTURE_PLAN.length) errors.push(`expected ${CORPUS_CAPTURE_PLAN.length} captures, received ${captures.length}`);
    for (const capture of captures) {
      if (captureRecords.has(capture?.filename)) errors.push(`duplicate capture filename ${capture?.filename}`);
      captureRecords.set(capture?.filename, capture);
    }
    for (const planned of CORPUS_CAPTURE_PLAN) {
      const capture = captureRecords.get(planned.filename);
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
      exactKeys(capture.file, ["path", "sha256", "producerOwner", "decodedRgbaSha256", "derivedFromPackedRgbaSha256"], `${planned.filename}.file`, errors);
      const file = confinedExtendedFileReference(bundleDir, capture.file, `${planned.filename}.file`, errors, { extensions: [".png"] });
      const decodedPng = validatePngCaptureFile(file, capture.width, capture.height, `${planned.filename}.file`, errors);
      if (capture.width !== Math.round(profileWidth * profileDpr) || capture.height !== Math.round(profileHeight * profileDpr)) {
        errors.push(`${planned.filename} dimensions do not derive from the captured CSS viewport and DPR`);
      }
      if (capture.file?.path !== planned.filename) errors.push(`${planned.filename}.file.path must equal its canonical filename`);
      if (file) captureFiles.set(planned.filename, Object.freeze({ path: file.path, sha256: file.sha256, bytes: file.bytes }));
      if (capture.captureSource !== "native-webgpu-render-target-readback") errors.push(`${planned.filename} is not native render-target readback`);
      validateCapturePixelEvidence(bundleDir, capture, file, decodedPng, planned.filename, errors);
      const writtenCapture = writtenCaptureByFilename.get(planned.filename);
      if (!writtenCapture) errors.push(`${planned.filename} is absent from the shared runner writtenCaptures ledger`);
      else {
        validateWrittenCaptureRecord(writtenCapture, capture, `${planned.filename}.writtenCapture`, errors);
        sameFileReference(capture.pixelEvidence?.png, writtenCapture.png, `${planned.filename}.writtenCapture.png`, errors);
        sameFileReference(capture.pixelEvidence?.transport?.rawArtifact, writtenCapture.transport?.artifact, `${planned.filename}.writtenCapture.transport`, errors);
        sameFileReference(capture.pixelEvidence?.normalized?.rawArtifact, writtenCapture.normalized?.artifact, `${planned.filename}.writtenCapture.normalized`, errors);
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
        const requiresReplay = caseId === "final-full-design";
        if (!a0 || !b || (requiresReplay && !a1)) {
          errors.push(`${subjectId}/${caseId} is missing ${requiresReplay ? "A0/B/A1" : "A0/B"} capture phases`);
          continue;
        }
        if (a0.state.seed !== CORPUS_REPRESENTATIVE_SEED || b.state.seed !== CORPUS_STRESS_SEED || (requiresReplay && a1.state.seed !== CORPUS_REPRESENTATIVE_SEED)) {
          errors.push(`${subjectId}/${caseId} seed phases do not use the frozen ${requiresReplay ? "A/B/A" : "A/B"} values`);
        }
        if (a0.identityEvidence?.effectiveToken === b.identityEvidence?.effectiveToken) {
          errors.push(`${subjectId}/${caseId} continuity tokens do not distinguish representative A from stress B`);
        }
        if (requiresReplay && a0.identityEvidence?.effectiveToken !== a1.identityEvidence?.effectiveToken) {
          errors.push(`${subjectId}/${caseId} continuity token does not replay representative A`);
        }
        if (
          b.identityEvidence?.instanceGeneration !== a0.identityEvidence?.instanceGeneration + 1
          || b.identityEvidence?.previousGeneration !== a0.identityEvidence?.instanceGeneration
          || (requiresReplay && (
            a1.identityEvidence?.instanceGeneration !== b.identityEvidence?.instanceGeneration + 1
            || a1.identityEvidence?.previousGeneration !== b.identityEvidence?.instanceGeneration
          ))
        ) errors.push(`${subjectId}/${caseId} generation links do not close ${requiresReplay ? "A0 -> B -> A1" : "A0 -> B"}`);
        for (const field of ["nodeIds", "socketIds", "colliderIds", "destructionGroupIds"]) {
          try {
            assert.deepEqual(a0.identityEvidence?.[field], b.identityEvidence?.[field]);
            if (requiresReplay) assert.deepEqual(a0.identityEvidence?.[field], a1.identityEvidence?.[field]);
          } catch {
            errors.push(`${subjectId}/${caseId} ${field} changed across ${requiresReplay ? "A0/B/A1" : "A0/B"}`);
          }
        }
      }
      const tierSequence = ["full", "budgeted", "minimum"].map((tier) => captures.find(({ state }) => (
        state?.subjectId === subjectId
        && state?.mode === "final"
        && state?.tier === tier
        && state?.camera === "design"
        && state?.seed === CORPUS_REPRESENTATIVE_SEED
        && state?.time === 0
        && (tier !== "full" || state?.seedPhase === "A0")
      )));
      if (tierSequence.some((capture) => !capture)) errors.push(`${subjectId} is missing the frozen A0 full -> budgeted -> minimum continuity sequence`);
      else {
        const baselineIdentity = tierSequence[0].identityEvidence;
        for (const capture of tierSequence.slice(1)) {
          const identity = capture.identityEvidence;
          if (
            identity?.instanceId !== baselineIdentity?.instanceId
            || identity?.instanceGeneration !== baselineIdentity?.instanceGeneration
            || identity?.effectiveToken !== baselineIdentity?.effectiveToken
            || identity?.previousGeneration !== baselineIdentity?.instanceGeneration
            || identity?.continuityStatus !== "explicit-continuity-preserved"
          ) errors.push(`${subjectId} tier transition did not preserve the frozen A0 instance generation/token`);
          for (const field of ["protectedNodeIds", "protectedSocketIds", "protectedColliderIds", "protectedDestructionGroupIds"]) {
            try {
              assert.deepEqual(identity?.[field], baselineIdentity?.[field]);
            } catch {
              errors.push(`${subjectId} ${field} changed during the frozen A0 tier sequence`);
            }
          }
        }
      }
    }
    rasterComparisons = validateRasterComparisons(hook, captureFiles, errors);
  }
  const observedSeeds = new Set(CORPUS_CAPTURE_PLAN.map(({ state }) => state.seed));
  if (!observedSeeds.has(CORPUS_REPRESENTATIVE_SEED) || !observedSeeds.has(CORPUS_STRESS_SEED)) {
    errors.push("capture plan must include representative and stress seeds");
  }
  validateTierContracts(hook?.tierContracts, errors);
  const standardOutputFiles = validateStandardOutputs(bundleDir, hook, captureFiles, captureRecords, pipeline, errors);
  validateArtifactWriteClosure(artifactWriteByPath, hook, errors);
  const captureProvenance = Object.freeze({
    sourceHash: session.sourceHash,
    sourceClosureHash: session.sourceClosureHash,
    sourceClosure: session.sourceClosure,
    buildRevision: session.buildRevision,
    threeRevision: session.threeRevision,
    profile: session.profile,
    profileConfig: Object.freeze({ ...session.profileConfig }),
    browser: Object.freeze({ ...session.browser }),
    automationSurface: session.automationSurface,
    adapterClass: session.adapterClass,
    adapterIdentity: session.adapterIdentity,
    browserEntry: session.browserEntry,
    url: session.url,
    finalUrl: session.finalUrl,
    route: session.route,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
  });
  return Object.freeze({ runId, backend, captureFiles, standardOutputFiles, rasterComparisons, sourceHash: session.sourceHash, buildRevision: session.buildRevision, captureProvenance });
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
    records.push(
      { id: `final-authored-contract:${subjectId}`, metricId: "ai-vision-score", domain: "authored-contract-review", statistic: "global-score", comparison: "gte", unit: "score", thresholdValue: 0.8, captureFilenames: [finalFull] },
      { id: `action-motion-delta:${subjectId}`, metricId: "rgb-mae-code-values", domain: "decoded-output-rgb8", statistic: "channel-mae", comparison: "gte", unit: "code-value", thresholdValue: 0.05, captureFilenames: [action0, action2] },
      { id: `tier-visual-error:${subjectId}:budgeted`, metricId: "normalized-visual-error", domain: "decoded-output-rgba8", statistic: "masked-p95", comparison: "lte", unit: "ratio", thresholdValue: 0.25, captureFilenames: [finalFull, finalBudgeted] },
      { id: `tier-visual-error:${subjectId}:minimum`, metricId: "normalized-visual-error", domain: "decoded-output-rgba8", statistic: "masked-p95", comparison: "lte", unit: "ratio", thresholdValue: 0.4, captureFilenames: [finalFull, finalMinimum] },
      { id: `stress-seed-distinctness:${subjectId}`, metricId: "rgb-mae-code-values", domain: "decoded-output-rgb8", statistic: "channel-mae", comparison: "gte", unit: "code-value", thresholdValue: 0.02, captureFilenames: [finalFull, stressFinal] },
      { id: `representative-replay:${subjectId}:final`, metricId: "rgb-mae-code-values", domain: "decoded-output-rgb8", statistic: "channel-mae", comparison: "lte", unit: "code-value", thresholdValue: 0.01, captureFilenames: [finalFull, replayFinal] },
      { id: `stress-action-motion:${subjectId}`, metricId: "rgb-mae-code-values", domain: "decoded-output-rgb8", statistic: "channel-mae", comparison: "gte", unit: "code-value", thresholdValue: 0.05, captureFilenames: [stressAction0, stressAction2] },
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

export function corpusRasterComparisonIdForInvariant(invariantId) {
  const [kind, subjectId, detail] = String(invariantId).split(":");
  if (kind === "action-motion-delta") return `raster-motion:${subjectId}:A0`;
  if (kind === "stress-action-motion") return `raster-motion:${subjectId}:B`;
  if (kind === "stress-seed-distinctness") return `raster-stress:${subjectId}:final-full-design`;
  if (kind === "representative-replay") {
    const suffix = detail === "final" ? "final-full-design" : null;
    return suffix ? `raster-replay:${subjectId}:${suffix}` : null;
  }
  return null;
}

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
  exactKeys(document, ["schemaVersion", "labId", "bundleId", "runId", "sourceHash", "buildRevision", "backend", "contractId", "invariants"], "visual-contract.json", errors);
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

function validateVisualReviews(document, bundleDir, context, header, visualContractRef, visualResultsById, errors) {
  if (!document) return;
  exactKeys(document, ["schemaVersion", "labId", "bundleId", "runId", "sourceHash", "buildRevision", "backend", "reviews"], "visual-reviews.json", errors);
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
      "sculptSpec",
      "invariantResultId",
      "renderImage",
      "contractArtifact",
      "aiVisionScore",
      "acceptanceThreshold",
      "criticalFeatures",
    ], `visual-reviews.reviews[${index}]`, errors)) continue;
    if (review.subjectId !== subjectId || review.mode !== "final" || review.reviewBasis !== "authored-contract") {
      errors.push(`${subjectId} review identity/basis drifted`);
    }
    const canonicalSpec = CORPUS_SCULPT_SPEC_EVIDENCE[subjectId];
    validateRepositoryFileReference(review.sculptSpec, canonicalSpec, `${subjectId}.sculptSpec`, errors);
    const invariantResultId = `final-authored-contract:${subjectId}`;
    if (review.invariantResultId !== invariantResultId) errors.push(`${subjectId}.invariantResultId must cite its frozen authored-contract invariant`);
    const expectedImage = captureByFilenameFragment(subjectId, "final.full.design");
    confinedFileReference(bundleDir, review.renderImage, `${subjectId}.renderImage`, errors, { extensions: [".png"] });
    sameFileReference(review.renderImage, context.captureFiles.get(expectedImage), `${subjectId}.renderImage`, errors);
    confinedFileReference(bundleDir, review.contractArtifact, `${subjectId}.contractArtifact`, errors, { extensions: [".json"] });
    sameFileReference(review.contractArtifact, visualContractRef, `${subjectId}.contractArtifact`, errors);
    const score = evidenceDatum(review.aiVisionScore, "Measured", `${subjectId}.aiVisionScore`, errors, { unit: "score", minimum: 0, maximum: 1 });
    const threshold = evidenceDatum(review.acceptanceThreshold, "Gated", `${subjectId}.acceptanceThreshold`, errors, { unit: "score", minimum: 0, maximum: 1 });
    const invariantResult = visualResultsById.get(invariantResultId);
    if (!invariantResult?.passed) errors.push(`${subjectId} visual review does not resolve to a validated passing invariant result`);
    if (JSON.stringify(review.aiVisionScore) !== JSON.stringify(invariantResult?.measurement)) errors.push(`${subjectId}.aiVisionScore must exactly equal its validated invariant measurement`);
    if (JSON.stringify(review.acceptanceThreshold) !== JSON.stringify(invariantResult?.threshold)) errors.push(`${subjectId}.acceptanceThreshold must exactly equal its frozen invariant gate`);
    if (review.acceptanceThreshold?.source !== `CORPUS_VISUAL_INVARIANT_PLAN:${invariantResultId}`) errors.push(`${subjectId}.acceptanceThreshold source drifted`);
    if (!deriveComparison(score, threshold, "gte")) errors.push(`${subjectId} AI-vision score is below its gate`);
    if (!Array.isArray(review.criticalFeatures) || review.criticalFeatures.length !== canonicalSpec.requiredFeatures.length) {
      errors.push(`${subjectId} must review every required ObjectSculptSpec feature exactly once`);
      continue;
    }
    const featureIds = new Set();
    for (const [featureIndex, feature] of review.criticalFeatures.entries()) {
      if (!exactKeys(feature, ["id", "specFeatureSha256", "score", "threshold"], `${subjectId}.criticalFeatures[${featureIndex}]`, errors)) continue;
      const expectedFeature = canonicalSpec.requiredFeatures[featureIndex];
      requireText(feature.id, `${subjectId}.criticalFeatures[${featureIndex}].id`, errors, ID_PATTERN);
      if (feature.id !== expectedFeature.id || feature.specFeatureSha256 !== expectedFeature.sha256) {
        errors.push(`${subjectId}.criticalFeatures[${featureIndex}] does not bind the ordered canonical ObjectSculptSpec feature bytes`);
      }
      if (featureIds.has(feature.id)) errors.push(`${subjectId} duplicate critical feature ${feature.id}`);
      featureIds.add(feature.id);
      const featureScore = evidenceDatum(feature.score, "Measured", `${subjectId}.${feature.id}.score`, errors, { unit: "score", minimum: 0, maximum: 1 });
      const featureThreshold = evidenceDatum(feature.threshold, "Gated", `${subjectId}.${feature.id}.threshold`, errors, { unit: "score", minimum: 0, maximum: 1 });
      if (featureThreshold !== CORPUS_CRITICAL_FEATURE_SCORE_GATE) errors.push(`${subjectId}/${feature.id} threshold must equal the frozen critical-feature gate`);
      if (feature.threshold?.source !== `ObjectSculptSpec:${subjectId}:${feature.id}:critical-feature-gate`) errors.push(`${subjectId}/${feature.id} threshold source drifted`);
      if (!deriveComparison(featureScore, featureThreshold, "gte")) errors.push(`${subjectId}/${feature.id} score is below its gate`);
    }
  }
}

function validateVisualErrors(document, bundleDir, context, header, contractById, errors) {
  const byId = new Map();
  if (!document) return byId;
  exactKeys(document, ["schemaVersion", "labId", "bundleId", "runId", "sourceHash", "buildRevision", "backend", "contractId", "results"], "visual-error-results.json", errors);
  validateDocumentHeader(document, "visual-error-results.json", { ...header, runId: header.runBindings.correctness, backend: context.backend }, errors);
  if (document.contractId !== VISUAL_CONTRACT_ID) errors.push("visual-error-results contractId drifted");
  if (!Array.isArray(document.results) || document.results.length !== CORPUS_VISUAL_INVARIANT_PLAN.length) {
    errors.push(`visual-error-results.json must contain exactly ${CORPUS_VISUAL_INVARIANT_PLAN.length} results`);
    return byId;
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
    const rasterComparisonId = corpusRasterComparisonIdForInvariant(expected.id);
    if (rasterComparisonId !== null) {
      const rasterComparison = context.rasterComparisons.get(rasterComparisonId);
      if (!rasterComparison || !almostEqual(measured, rasterComparison.rgbMaeCodeValues, 1e-12)) {
        errors.push(`${expected.id} measurement must equal the independently decoded PNG raster comparison`);
      }
      if (result.measurement?.source !== `capture-session.rasterComparisons:${rasterComparisonId}:rgbMaeCodeValues`) {
        errors.push(`${expected.id} measurement source does not bind the decoded PNG comparison`);
      }
    }
    if (!deriveComparison(measured, threshold, expected.comparison)) errors.push(`${expected.id} measured value failed its frozen gate`);
    validateFileReferenceSequence(bundleDir, result.captureFiles, expected.captureFilenames, context, `${expected.id}.captureFiles`, errors);
    byId.set(expected.id, Object.freeze({
      passed: deriveComparison(measured, threshold, expected.comparison),
      measurement: result.measurement,
      threshold: result.threshold,
      captureFiles: result.captureFiles,
    }));
  }
  return byId;
}

function nearestRank(values, probability) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(probability * ordered.length) - 1)];
}

export function computeCorpusTimingDeviceBinding({ sourceHash, buildRevision, targetDevice, viewport, backend, rendererDeviceGeneration, deviceLossGeneration }) {
  return stableSha256({ sourceHash, buildRevision, targetDevice, viewport, backend, rendererDeviceGeneration, deviceLossGeneration });
}

function performanceIdentityDigest(identity) {
  return stableSha256(identity);
}

function commonPerformanceIdentity(identity) {
  const copy = structuredClone(identity);
  delete copy.lane;
  delete copy.cadenceContract;
  delete copy.workload.performanceTimestampMode;
  delete copy.workload.timestampMode;
  try {
    const pipelineState = JSON.parse(copy.workload.pipelineState);
    for (const field of ["performanceTimestampMode", "timestampQueriesRequired", "timestampQueriesRequested", "timestampQueriesActive"]) delete pipelineState[field];
    copy.workload.pipelineState = JSON.stringify(pipelineState);
  } catch {}
  return copy;
}

function validatePerformanceIdentity(identity, lane, subjectId, tier, header, errors, label) {
  let normalized = null;
  try {
    const serializedIdentity = structuredClone(identity);
    if (serializedIdentity?.captureSession && typeof serializedIdentity.captureSession === "object") {
      Object.freeze(serializedIdentity.captureSession);
    }
    normalized = validateObjectSculptorCorpusPerformanceIdentity(serializedIdentity);
  } catch (error) {
    errors.push(`${label}: ${error.message}`);
    return null;
  }
  if (normalized.lane !== lane) errors.push(`${label}.lane expected ${lane}`);
  if (normalized.source.sourceClosureHash !== header.sourceHash || normalized.source.buildRevision !== header.buildRevision) errors.push(`${label} does not bind the accepted executable source closure`);
  if (normalized.browser.automationSurface !== IN_APP_BROWSER_SURFACE) errors.push(`${label} must be collected through the physical Codex in-app Browser`);
  if (normalized.adapter.adapterClass !== "hardware") errors.push(`${label} hardware performance acceptance requires a positively identified hardware adapter`);
  if (normalized.workload.subjectId !== subjectId || normalized.workload.tier !== tier) errors.push(`${label} subject/tier workload drifted`);
  for (const field of ["historyState", "resourceState", "pipelineState", "cameraProjectionState"]) {
    try {
      JSON.parse(normalized.workload[field]);
    } catch {
      errors.push(`${label}.workload.${field} must be canonical JSON text`);
    }
  }
  return normalized;
}

function validateCadenceWindow(window, index, kind, gates, workload, identity, errors) {
  const label = `${workload.label}.${kind}CadenceWindows[${index}]`;
  if (!exactKeys(window, [
    "id", "kind", "workloadBinding", "identitySha256", "startedAtMonotonicMs", "endedAtMonotonicMs",
    "durationMs", "minimumDurationMs", "sampleCount", "rawSamples", "cpuP50Ms", "cpuP95Ms",
    "rafIntervalP50Ms", "rafIntervalP95Ms", "coverageRatio", "minimumCoverageRatio", "maximumGapRatio",
    "maximumGapRatioGate", "deadlineMisses",
  ], label, errors)) return null;
  requireText(window.id, `${label}.id`, errors, ID_PATTERN);
  if (window.kind !== kind) errors.push(`${label}.kind expected ${kind}`);
  if (window.workloadBinding !== workload.binding || window.identitySha256 !== workload.cadenceIdentitySha256) errors.push(`${label} mixes or changes the immutable sustained-cadence identity`);
  const start = evidenceDatum(window.startedAtMonotonicMs, "Measured", `${label}.startedAtMonotonicMs`, errors, { unit: "ms", minimum: 0 });
  const end = evidenceDatum(window.endedAtMonotonicMs, "Measured", `${label}.endedAtMonotonicMs`, errors, { unit: "ms", minimum: 0 });
  const duration = evidenceDatum(window.durationMs, "Derived", `${label}.durationMs`, errors, { unit: "ms", minimum: 0 });
  const minimumDuration = evidenceDatum(window.minimumDurationMs, "Gated", `${label}.minimumDurationMs`, errors, { unit: "ms", minimum: 0 });
  const expectedMinimumDuration = kind === "cold" ? CORPUS_TIMING_GATES.coldMinimumDurationMs : CORPUS_TIMING_GATES.sustainedMinimumDurationMs;
  if (!almostEqual(duration, end - start) || window.durationMs?.source !== "endedAtMonotonicMs - startedAtMonotonicMs") errors.push(`${label}.durationMs does not derive from its monotonic endpoints`);
  if (minimumDuration !== expectedMinimumDuration || window.minimumDurationMs?.source !== `CORPUS_TIMING_GATES.${kind}MinimumDurationMs`) errors.push(`${label}.minimumDurationMs drifted from the frozen duration gate`);
  if (duration < minimumDuration) errors.push(`${label} did not reside for its gated minimum duration`);
  const sampleCount = evidenceDatum(window.sampleCount, "Measured", `${label}.sampleCount`, errors, { unit: "sample", integer: true, minimum: 1 });
  if (!Array.isArray(window.rawSamples) || window.rawSamples.length !== sampleCount) {
    errors.push(`${label}.rawSamples must exactly close over sampleCount`);
    return { id: window.id, start, end, lastFrameOrdinal: null, lastSubmissionOrdinal: null };
  }
  if (sampleCount < gates.minimumSamples) errors.push(`${label} has fewer than the gated minimum samples`);
  const samples = [];
  const sampleIds = new Set();
  let previousCapture = Number.NEGATIVE_INFINITY;
  let firstCapture = null;
  let maximumGap = 0;
  let previousFrame = 0;
  let previousSubmission = 0;
  for (let sampleIndex = 0; sampleIndex < window.rawSamples.length; sampleIndex += 1) {
    const sample = window.rawSamples[sampleIndex];
    const sampleLabel = `${label}.rawSamples[${sampleIndex}]`;
    if (!exactKeys(sample, [
      "id", "sequence", "capturedAtMonotonicMs", "cpuMs", "rafIntervalMs", "deadlineMiss", "workloadBinding",
      "identitySha256", "rendererDeviceGeneration", "deviceLossGeneration", "frameOrdinal", "submissionOrdinal",
    ], sampleLabel, errors)) continue;
    requireText(sample.id, `${sampleLabel}.id`, errors, ID_PATTERN);
    if (sampleIds.has(sample.id)) errors.push(`${label} contains duplicate cadence sample ${sample.id}`);
    sampleIds.add(sample.id);
    const sequence = evidenceDatum(sample.sequence, "Measured", `${sampleLabel}.sequence`, errors, { unit: "ordinal", integer: true, minimum: 0 });
    const capturedAt = evidenceDatum(sample.capturedAtMonotonicMs, "Measured", `${sampleLabel}.capturedAtMonotonicMs`, errors, { unit: "ms", minimum: 0 });
    const cpuMs = evidenceDatum(sample.cpuMs, "Measured", `${sampleLabel}.cpuMs`, errors, { unit: "ms", minimum: 0 });
    const rafIntervalMs = evidenceDatum(sample.rafIntervalMs, "Measured", `${sampleLabel}.rafIntervalMs`, errors, { unit: "ms", minimum: 0 });
    const rendererGeneration = evidenceDatum(sample.rendererDeviceGeneration, "Measured", `${sampleLabel}.rendererDeviceGeneration`, errors, { unit: "generation", integer: true, minimum: 1 });
    const lossGeneration = evidenceDatum(sample.deviceLossGeneration, "Measured", `${sampleLabel}.deviceLossGeneration`, errors, { unit: "generation", integer: true, minimum: 0 });
    const frameOrdinal = evidenceDatum(sample.frameOrdinal, "Measured", `${sampleLabel}.frameOrdinal`, errors, { unit: "ordinal", integer: true, minimum: 1 });
    const submissionOrdinal = evidenceDatum(sample.submissionOrdinal, "Measured", `${sampleLabel}.submissionOrdinal`, errors, { unit: "ordinal", integer: true, minimum: 1 });
    if (sequence !== sampleIndex || capturedAt <= previousCapture || capturedAt < start || capturedAt > end) errors.push(`${sampleLabel} is discontinuous or outside its monotonic cadence window`);
    if (firstCapture === null) firstCapture = capturedAt;
    else maximumGap = Math.max(maximumGap, capturedAt - previousCapture);
    if (frameOrdinal <= previousFrame || submissionOrdinal <= previousSubmission) errors.push(`${sampleLabel} frame/submission ordinals must increase strictly`);
    if (sample.workloadBinding !== workload.binding || sample.identitySha256 !== workload.cadenceIdentitySha256) errors.push(`${sampleLabel} mixes a different workload or timing lane`);
    if (rendererGeneration !== identity.generations.rendererDeviceGeneration || lossGeneration !== identity.generations.deviceLossGeneration) errors.push(`${sampleLabel} crosses the immutable renderer/device-loss generation`);
    if (typeof sample.deadlineMiss !== "boolean") errors.push(`${sampleLabel}.deadlineMiss must be boolean`);
    previousCapture = capturedAt;
    previousFrame = frameOrdinal;
    previousSubmission = submissionOrdinal;
    samples.push({ cpuMs, rafIntervalMs, deadlineMiss: sample.deadlineMiss });
  }
  const cpu50 = evidenceDatum(window.cpuP50Ms, "Measured", `${label}.cpuP50Ms`, errors, { unit: "ms", minimum: 0 });
  const cpu95 = evidenceDatum(window.cpuP95Ms, "Measured", `${label}.cpuP95Ms`, errors, { unit: "ms", minimum: 0 });
  const raf50 = evidenceDatum(window.rafIntervalP50Ms, "Measured", `${label}.rafIntervalP50Ms`, errors, { unit: "ms", minimum: 0 });
  const raf95 = evidenceDatum(window.rafIntervalP95Ms, "Measured", `${label}.rafIntervalP95Ms`, errors, { unit: "ms", minimum: 0 });
  const coverageRatio = evidenceDatum(window.coverageRatio, "Measured", `${label}.coverageRatio`, errors, { unit: "ratio", minimum: 0, maximum: 1 });
  const minimumCoverageRatio = evidenceDatum(window.minimumCoverageRatio, "Gated", `${label}.minimumCoverageRatio`, errors, { unit: "ratio", minimum: 0, maximum: 1 });
  const maximumGapRatio = evidenceDatum(window.maximumGapRatio, "Measured", `${label}.maximumGapRatio`, errors, { unit: "ratio", minimum: 0, maximum: 1 });
  const maximumGapRatioGate = evidenceDatum(window.maximumGapRatioGate, "Gated", `${label}.maximumGapRatioGate`, errors, { unit: "ratio", minimum: 0, maximum: 1 });
  const misses = evidenceDatum(window.deadlineMisses, "Measured", `${label}.deadlineMisses`, errors, { unit: "count", integer: true, minimum: 0 });
  for (const [actual, expected, datumRecord, source] of [
    [cpu50, nearestRank(samples.map(({ cpuMs }) => cpuMs), 0.5), window.cpuP50Ms, "nearest-rank(rawSamples.cpuMs,0.5)"],
    [cpu95, nearestRank(samples.map(({ cpuMs }) => cpuMs), 0.95), window.cpuP95Ms, "nearest-rank(rawSamples.cpuMs,0.95)"],
    [raf50, nearestRank(samples.map(({ rafIntervalMs }) => rafIntervalMs), 0.5), window.rafIntervalP50Ms, "nearest-rank(rawSamples.rafIntervalMs,0.5)"],
    [raf95, nearestRank(samples.map(({ rafIntervalMs }) => rafIntervalMs), 0.95), window.rafIntervalP95Ms, "nearest-rank(rawSamples.rafIntervalMs,0.95)"],
    [misses, samples.filter(({ deadlineMiss }) => deadlineMiss).length, window.deadlineMisses, "count(rawSamples.deadlineMiss)"],
  ]) if (!almostEqual(actual, expected) || datumRecord?.source !== source) errors.push(`${label} cadence summary does not recompute exactly from raw samples`);
  const expectedCoverageRatio = duration > 0 && firstCapture !== null ? (previousCapture - firstCapture) / duration : 0;
  const expectedMaximumGapRatio = duration > 0 ? maximumGap / duration : 1;
  if (!almostEqual(coverageRatio, expectedCoverageRatio) || window.coverageRatio?.source !== "(last(rawSamples.capturedAtMonotonicMs) - first(rawSamples.capturedAtMonotonicMs)) / durationMs") errors.push(`${label}.coverageRatio does not derive from the retained cadence population`);
  if (!almostEqual(maximumGapRatio, expectedMaximumGapRatio) || window.maximumGapRatio?.source !== "max(adjacent rawSamples capturedAt delta) / durationMs") errors.push(`${label}.maximumGapRatio does not derive from the retained cadence population`);
  if (minimumCoverageRatio !== CORPUS_TIMING_GATES.minimumCoverageRatio || maximumGapRatioGate !== CORPUS_TIMING_GATES.maximumGapRatio) errors.push(`${label} coverage/gap gates drifted from CORPUS_TIMING_GATES`);
  if (coverageRatio < minimumCoverageRatio || maximumGapRatio > maximumGapRatioGate) errors.push(`${label} retained timing samples do not continuously cover the declared window`);
  if (cpu50 > cpu95 || raf50 > raf95) errors.push(`${label} p50 must not exceed p95`);
  if (cpu95 > gates.cpuP95 || raf95 > gates.rafP95 || misses > gates.deadlineMisses) errors.push(`${label} exceeded a frozen sustained cadence gate`);
  return { id: window.id, start, end, lastFrameOrdinal: previousFrame, lastSubmissionOrdinal: previousSubmission };
}

function validateGpuTimestampPopulation(population, index, gates, workload, identity, errors) {
  const label = `${workload.label}.gpuTimestampPopulations[${index}]`;
  if (!exactKeys(population, [
    "id", "scopeId", "kind", "resolved", "workloadBinding", "identitySha256", "startedAtMonotonicMs",
    "endedAtMonotonicMs", "sampleCount", "rawSamples", "gpuP50Ms", "gpuP95Ms", "resolveOverheadP95Ms",
    "coverageRatio", "minimumCoverageRatio", "maximumGapRatio", "maximumGapRatioGate",
  ], label, errors)) return;
  requireText(population.id, `${label}.id`, errors, ID_PATTERN);
  if (population.scopeId !== "forward-scene" || population.kind !== "render" || population.resolved !== true) errors.push(`${label} must contain resolved forward-scene render timestamps`);
  if (population.workloadBinding !== workload.binding || population.identitySha256 !== workload.gpuIdentitySha256) errors.push(`${label} mixes or changes the immutable one-shot GPU identity`);
  const start = evidenceDatum(population.startedAtMonotonicMs, "Measured", `${label}.startedAtMonotonicMs`, errors, { unit: "ms", minimum: 0 });
  const end = evidenceDatum(population.endedAtMonotonicMs, "Measured", `${label}.endedAtMonotonicMs`, errors, { unit: "ms", minimum: 0 });
  if (!(end > start)) errors.push(`${label} monotonic bounds are invalid`);
  const sampleCount = evidenceDatum(population.sampleCount, "Measured", `${label}.sampleCount`, errors, { unit: "sample", integer: true, minimum: 1 });
  if (!Array.isArray(population.rawSamples) || population.rawSamples.length !== sampleCount) {
    errors.push(`${label}.rawSamples must exactly close over sampleCount`);
    return;
  }
  if (sampleCount < gates.minimumSamples) errors.push(`${label} has fewer than the gated minimum GPU timestamp samples`);
  let previousCapture = Number.NEGATIVE_INFINITY;
  let firstCapture = null;
  let maximumGap = 0;
  let previousFrame = 0;
  let previousSubmission = 0;
  const samples = [];
  for (let sampleIndex = 0; sampleIndex < population.rawSamples.length; sampleIndex += 1) {
    const sample = population.rawSamples[sampleIndex];
    const sampleLabel = `${label}.rawSamples[${sampleIndex}]`;
    if (!exactKeys(sample, [
      "id", "sequence", "capturedAtMonotonicMs", "gpuMs", "resolveOverheadMs", "workloadBinding", "identitySha256",
      "rendererDeviceGeneration", "deviceLossGeneration", "frameOrdinal", "submissionOrdinal",
    ], sampleLabel, errors)) continue;
    requireText(sample.id, `${sampleLabel}.id`, errors, ID_PATTERN);
    const sequence = evidenceDatum(sample.sequence, "Measured", `${sampleLabel}.sequence`, errors, { unit: "ordinal", integer: true, minimum: 0 });
    const capturedAt = evidenceDatum(sample.capturedAtMonotonicMs, "Measured", `${sampleLabel}.capturedAtMonotonicMs`, errors, { unit: "ms", minimum: 0 });
    const gpuMs = evidenceDatum(sample.gpuMs, "Measured", `${sampleLabel}.gpuMs`, errors, { unit: "ms", minimum: 0 });
    const overheadMs = evidenceDatum(sample.resolveOverheadMs, "Measured", `${sampleLabel}.resolveOverheadMs`, errors, { unit: "ms", minimum: 0 });
    const rendererGeneration = evidenceDatum(sample.rendererDeviceGeneration, "Measured", `${sampleLabel}.rendererDeviceGeneration`, errors, { unit: "generation", integer: true, minimum: 1 });
    const lossGeneration = evidenceDatum(sample.deviceLossGeneration, "Measured", `${sampleLabel}.deviceLossGeneration`, errors, { unit: "generation", integer: true, minimum: 0 });
    const frameOrdinal = evidenceDatum(sample.frameOrdinal, "Measured", `${sampleLabel}.frameOrdinal`, errors, { unit: "ordinal", integer: true, minimum: 1 });
    const submissionOrdinal = evidenceDatum(sample.submissionOrdinal, "Measured", `${sampleLabel}.submissionOrdinal`, errors, { unit: "ordinal", integer: true, minimum: 1 });
    if (sequence !== sampleIndex || capturedAt <= previousCapture || capturedAt < start || capturedAt > end) errors.push(`${sampleLabel} is discontinuous or outside its GPU collection interval`);
    if (firstCapture === null) firstCapture = capturedAt;
    else maximumGap = Math.max(maximumGap, capturedAt - previousCapture);
    if (frameOrdinal <= previousFrame || submissionOrdinal <= previousSubmission) errors.push(`${sampleLabel} frame/submission ordinals must increase strictly`);
    if (sample.workloadBinding !== workload.binding || sample.identitySha256 !== workload.gpuIdentitySha256) errors.push(`${sampleLabel} mixes the sustained cadence lane or a different workload`);
    if (rendererGeneration !== identity.generations.rendererDeviceGeneration || lossGeneration !== identity.generations.deviceLossGeneration) errors.push(`${sampleLabel} crosses the immutable renderer/device-loss generation`);
    previousCapture = capturedAt;
    previousFrame = frameOrdinal;
    previousSubmission = submissionOrdinal;
    samples.push({ gpuMs, overheadMs });
  }
  const gpu50 = evidenceDatum(population.gpuP50Ms, "Measured", `${label}.gpuP50Ms`, errors, { unit: "ms", minimum: 0 });
  const gpu95 = evidenceDatum(population.gpuP95Ms, "Measured", `${label}.gpuP95Ms`, errors, { unit: "ms", minimum: 0 });
  const overhead95 = evidenceDatum(population.resolveOverheadP95Ms, "Measured", `${label}.resolveOverheadP95Ms`, errors, { unit: "ms", minimum: 0 });
  const coverageRatio = evidenceDatum(population.coverageRatio, "Measured", `${label}.coverageRatio`, errors, { unit: "ratio", minimum: 0, maximum: 1 });
  const minimumCoverageRatio = evidenceDatum(population.minimumCoverageRatio, "Gated", `${label}.minimumCoverageRatio`, errors, { unit: "ratio", minimum: 0, maximum: 1 });
  const maximumGapRatio = evidenceDatum(population.maximumGapRatio, "Measured", `${label}.maximumGapRatio`, errors, { unit: "ratio", minimum: 0, maximum: 1 });
  const maximumGapRatioGate = evidenceDatum(population.maximumGapRatioGate, "Gated", `${label}.maximumGapRatioGate`, errors, { unit: "ratio", minimum: 0, maximum: 1 });
  for (const [actual, expected, datumRecord, source] of [
    [gpu50, nearestRank(samples.map(({ gpuMs }) => gpuMs), 0.5), population.gpuP50Ms, "nearest-rank(rawSamples.gpuMs,0.5)"],
    [gpu95, nearestRank(samples.map(({ gpuMs }) => gpuMs), 0.95), population.gpuP95Ms, "nearest-rank(rawSamples.gpuMs,0.95)"],
    [overhead95, nearestRank(samples.map(({ overheadMs }) => overheadMs), 0.95), population.resolveOverheadP95Ms, "nearest-rank(rawSamples.resolveOverheadMs,0.95)"],
  ]) if (!almostEqual(actual, expected) || datumRecord?.source !== source) errors.push(`${label} GPU summary does not recompute exactly from its one-shot timestamp population`);
  const duration = end - start;
  const expectedCoverageRatio = duration > 0 && firstCapture !== null ? (previousCapture - firstCapture) / duration : 0;
  const expectedMaximumGapRatio = duration > 0 ? maximumGap / duration : 1;
  if (!almostEqual(coverageRatio, expectedCoverageRatio) || population.coverageRatio?.source !== "(last(rawSamples.capturedAtMonotonicMs) - first(rawSamples.capturedAtMonotonicMs)) / collectionDurationMs") errors.push(`${label}.coverageRatio does not derive from the retained GPU population`);
  if (!almostEqual(maximumGapRatio, expectedMaximumGapRatio) || population.maximumGapRatio?.source !== "max(adjacent rawSamples capturedAt delta) / collectionDurationMs") errors.push(`${label}.maximumGapRatio does not derive from the retained GPU population`);
  if (minimumCoverageRatio !== CORPUS_TIMING_GATES.minimumCoverageRatio || maximumGapRatioGate !== CORPUS_TIMING_GATES.maximumGapRatio) errors.push(`${label} coverage/gap gates drifted from CORPUS_TIMING_GATES`);
  if (coverageRatio < minimumCoverageRatio || maximumGapRatio > maximumGapRatioGate) errors.push(`${label} retained GPU timestamps do not continuously cover the declared population interval`);
  if (gpu50 > gpu95 || gpu95 > gates.gpuP95) errors.push(`${label} exceeded the frozen GPU timestamp gate`);
}

function validatePerformanceRetention(retention, workloadCase, label, errors) {
  if (!exactKeys(retention, ["limits", "oneShotGpu", "sustainedCadence"], `${label}.retention`, errors)) return;
  if (!exactKeys(retention.limits, ["maxWindowCountPerLane", "maxSampleCountPerLane"], `${label}.retention.limits`, errors)) return;
  const maxWindows = evidenceDatum(retention.limits.maxWindowCountPerLane, "Gated", `${label}.retention.limits.maxWindowCountPerLane`, errors, { unit: "window", integer: true, minimum: 1 });
  const maxSamples = evidenceDatum(retention.limits.maxSampleCountPerLane, "Gated", `${label}.retention.limits.maxSampleCountPerLane`, errors, { unit: "sample", integer: true, minimum: 1 });
  if (maxWindows !== CORPUS_PERFORMANCE_EVIDENCE_LIMITS.maxWindowCountPerLane || maxSamples !== CORPUS_PERFORMANCE_EVIDENCE_LIMITS.maxSampleCountPerLane) errors.push(`${label}.retention limits drifted from the bounded frame-driver contract`);
  for (const [field, windows] of [
    ["oneShotGpu", workloadCase.gpuTimestampPopulations],
    ["sustainedCadence", [...workloadCase.coldCadenceWindows, ...workloadCase.sustainedCadenceWindows]],
  ]) {
    const record = retention[field];
    const recordLabel = `${label}.retention.${field}`;
    if (!exactKeys(record, ["observedSampleCount", "retainedSampleCount", "retainedWindowCount", "limitRejectionCount"], recordLabel, errors)) continue;
    const observed = evidenceDatum(record.observedSampleCount, "Measured", `${recordLabel}.observedSampleCount`, errors, { unit: "sample", integer: true, minimum: 0 });
    const retained = evidenceDatum(record.retainedSampleCount, "Measured", `${recordLabel}.retainedSampleCount`, errors, { unit: "sample", integer: true, minimum: 0 });
    const retainedWindows = evidenceDatum(record.retainedWindowCount, "Measured", `${recordLabel}.retainedWindowCount`, errors, { unit: "window", integer: true, minimum: 0 });
    const rejections = evidenceDatum(record.limitRejectionCount, "Measured", `${recordLabel}.limitRejectionCount`, errors, { unit: "count", integer: true, minimum: 0 });
    const rawCount = windows.reduce((total, window) => total + (window.rawSamples?.length ?? 0), 0);
    if (observed !== rawCount || retained !== rawCount || retainedWindows !== windows.length || rejections !== 0) errors.push(`${recordLabel} does not close over the retained evidence windows and samples`);
    if (retained > maxSamples || retainedWindows > maxWindows) errors.push(`${recordLabel} exceeded the bounded frame-driver retention contract`);
  }
}

function validateTiming(document, header, context, errors) {
  if (!document) return;
  exactKeys(document, [
    "schemaVersion",
    "labId",
    "bundleId",
    "runId",
    "sourceHash",
    "buildRevision",
    "backend",
    "targetDevice",
    "viewport",
    "deviceBinding",
    "displayRefreshHz",
    "targetPresentationRateHz",
    "refreshPeriodMs",
    "browserMainThreadReserveMs",
    "compositorGpuReserveMs",
    "cpuSafetyReserveMs",
    "gpuSafetyReserveMs",
    "cpuSceneEnvelopeMs",
    "gpuSceneEnvelopeMs",
    "cpuP95GateMs",
    "gpuP95GateMs",
    "rafIntervalP95GateMs",
    "deadlineMissGate",
    "minimumSamplesPerWindow",
    "gpuTimingRequirement",
    "timestampTrackingEnabled",
    "gpuTimestampSupport",
    "presentationTiming",
    "workloadCases",
  ], "timing-trace.json", errors);
  validateDocumentHeader(document, "timing-trace.json", { ...header, runId: header.runBindings.performance, backend: context.backend }, errors);
  if (!exactKeys(document.targetDevice, ["id", "kind", "device", "os", "browser", "adapter"], "timing.targetDevice", errors)) return;
  requireText(document.targetDevice.id, "timing.targetDevice.id", errors, ID_PATTERN);
  if (document.targetDevice.kind !== "physical") errors.push("timing target must be a named physical device");
  for (const field of ["device", "os"]) requireText(document.targetDevice[field], `timing.targetDevice.${field}`, errors);
  if (!document.targetDevice.browser || typeof document.targetDevice.browser !== "object") errors.push("timing target browser identity is required");
  if (!document.targetDevice.adapter || typeof document.targetDevice.adapter !== "object") errors.push("timing target adapter identity is required");
  if (!exactKeys(document.viewport, ["cssWidth", "cssHeight", "dpr", "physicalWidth", "physicalHeight"], "timing.viewport", errors)) return;
  const cssWidth = evidenceDatum(document.viewport.cssWidth, "Measured", "timing.viewport.cssWidth", errors, { unit: "CSS px", integer: true, minimum: 1 });
  const cssHeight = evidenceDatum(document.viewport.cssHeight, "Measured", "timing.viewport.cssHeight", errors, { unit: "CSS px", integer: true, minimum: 1 });
  const dpr = evidenceDatum(document.viewport.dpr, "Measured", "timing.viewport.dpr", errors, { unit: "ratio", minimum: Number.EPSILON, maximum: 4 });
  const physicalWidth = evidenceDatum(document.viewport.physicalWidth, "Derived", "timing.viewport.physicalWidth", errors, { unit: "physical px", integer: true, minimum: 1 });
  const physicalHeight = evidenceDatum(document.viewport.physicalHeight, "Derived", "timing.viewport.physicalHeight", errors, { unit: "physical px", integer: true, minimum: 1 });
  if (physicalWidth !== Math.round(cssWidth * dpr) || physicalHeight !== Math.round(cssHeight * dpr)) errors.push("timing physical viewport does not derive from CSS pixels and DPR");
  const expectedBinding = computeCorpusTimingDeviceBinding({
    sourceHash: document.sourceHash,
    buildRevision: document.buildRevision,
    targetDevice: document.targetDevice,
    viewport: document.viewport,
    backend: document.backend,
    rendererDeviceGeneration: null,
    deviceLossGeneration: null,
  });
  if (document.deviceBinding !== expectedBinding) errors.push("timing.deviceBinding does not match the source/device/browser/viewport/backend/generation closure");
  const refresh = evidenceDatum(document.displayRefreshHz, "Measured", "timing.displayRefreshHz", errors, { unit: "Hz", minimum: Number.EPSILON });
  const targetRate = evidenceDatum(document.targetPresentationRateHz, "Gated", "timing.targetPresentationRateHz", errors, { unit: "Hz", minimum: Number.EPSILON });
  const period = evidenceDatum(document.refreshPeriodMs, "Derived", "timing.refreshPeriodMs", errors, { unit: "ms", minimum: Number.EPSILON });
  const browserReserve = evidenceDatum(document.browserMainThreadReserveMs, "Measured", "timing.browserMainThreadReserveMs", errors, { unit: "ms", minimum: 0 });
  const compositorReserve = evidenceDatum(document.compositorGpuReserveMs, "Authored", "timing.compositorGpuReserveMs", errors, { unit: "ms", minimum: 0 });
  const cpuSafetyReserve = evidenceDatum(document.cpuSafetyReserveMs, "Authored", "timing.cpuSafetyReserveMs", errors, { unit: "ms", minimum: 0 });
  const gpuSafetyReserve = evidenceDatum(document.gpuSafetyReserveMs, "Authored", "timing.gpuSafetyReserveMs", errors, { unit: "ms", minimum: 0 });
  const cpuEnvelope = evidenceDatum(document.cpuSceneEnvelopeMs, "Derived", "timing.cpuSceneEnvelopeMs", errors, { unit: "ms", minimum: Number.EPSILON });
  const gpuEnvelope = evidenceDatum(document.gpuSceneEnvelopeMs, "Derived", "timing.gpuSceneEnvelopeMs", errors, { unit: "ms", minimum: Number.EPSILON });
  const cpuP95 = evidenceDatum(document.cpuP95GateMs, "Gated", "timing.cpuP95GateMs", errors, { unit: "ms", minimum: 0 });
  const gpuP95 = evidenceDatum(document.gpuP95GateMs, "Gated", "timing.gpuP95GateMs", errors, { unit: "ms", minimum: 0 });
  const rafP95 = evidenceDatum(document.rafIntervalP95GateMs, "Gated", "timing.rafIntervalP95GateMs", errors, { unit: "ms", minimum: 0 });
  const deadlineMisses = evidenceDatum(document.deadlineMissGate, "Gated", "timing.deadlineMissGate", errors, { unit: "count", integer: true, minimum: 0 });
  const minimumSamples = evidenceDatum(document.minimumSamplesPerWindow, "Gated", "timing.minimumSamplesPerWindow", errors, { unit: "sample", integer: true, minimum: 2 });
  if (targetRate > refresh) errors.push("timing target presentation rate exceeds measured display refresh");
  if (!almostEqual(period, 1000 / targetRate, 1e-6) || document.refreshPeriodMs?.source !== "1000 / targetPresentationRateHz") errors.push("timing refresh period does not derive from the gated target rate");
  if (!almostEqual(cpuEnvelope, period - browserReserve - cpuSafetyReserve) || document.cpuSceneEnvelopeMs?.source !== "refreshPeriodMs - browserMainThreadReserveMs - cpuSafetyReserveMs") errors.push("timing CPU envelope does not derive from the frozen reserve model");
  if (!almostEqual(gpuEnvelope, period - compositorReserve - gpuSafetyReserve) || document.gpuSceneEnvelopeMs?.source !== "refreshPeriodMs - compositorGpuReserveMs - gpuSafetyReserveMs") errors.push("timing GPU envelope does not derive from the frozen reserve model");
  if (!almostEqual(cpuP95, cpuEnvelope) || document.cpuP95GateMs?.source !== "cpuSceneEnvelopeMs") errors.push("timing CPU p95 gate must freeze the derived CPU scene envelope");
  if (!almostEqual(gpuP95, gpuEnvelope) || document.gpuP95GateMs?.source !== "gpuSceneEnvelopeMs") errors.push("timing GPU p95 gate must freeze the derived GPU scene envelope");
  if (!almostEqual(rafP95, period) || document.rafIntervalP95GateMs?.source !== "refreshPeriodMs") errors.push("timing rAF interval p95 gate must freeze the refresh period");
  if (deadlineMisses !== CORPUS_TIMING_GATES.deadlineMisses || document.deadlineMissGate?.source !== "CORPUS_TIMING_GATES.deadlineMisses") errors.push("timing deadline gate drifted from the checked-in gate");
  if (minimumSamples !== CORPUS_TIMING_GATES.minimumSamplesPerWindow || document.minimumSamplesPerWindow?.source !== "CORPUS_TIMING_GATES.minimumSamplesPerWindow") errors.push("timing sample gate drifted from the checked-in gate");
  if (cpuEnvelope > period || gpuEnvelope > period || cpuP95 > cpuEnvelope || gpuP95 > gpuEnvelope || rafP95 > period) {
    errors.push("timing envelopes/gates do not close under the refresh period");
  }
  if (document.gpuTimingRequirement !== "required" || document.timestampTrackingEnabled !== true || document.gpuTimestampSupport !== true) {
    errors.push("GPU timing acceptance requires pre-init timestamp tracking and available timestamp support");
  }
  if (!exactKeys(document.presentationTiming, ["verdict", "api", "reason"], "timing.presentationTiming", errors)) return;
  if (document.presentationTiming.verdict !== "NOT_CLAIMED" || document.presentationTiming.api !== null) errors.push("presentation/compositor timing must remain NOT_CLAIMED unless a real timing API supplies it");
  requireText(document.presentationTiming.reason, "timing.presentationTiming.reason", errors);
  const gates = { minimumSamples, cpuP95, gpuP95, rafP95, deadlineMisses };
  const workloadPlan = SCULPT_TARGET_IDS.flatMap((subjectId) => SCULPT_TIERS.map((tier) => Object.freeze({
    id: `${subjectId}:${tier}`,
    subjectId,
    tier,
  })));
  if (!Array.isArray(document.workloadCases) || document.workloadCases.length !== workloadPlan.length) {
    errors.push(`timing trace must contain exactly ${workloadPlan.length} subject/tier workload cases`);
    return;
  }
  for (let caseIndex = 0; caseIndex < workloadPlan.length; caseIndex += 1) {
    const expectedWorkload = workloadPlan[caseIndex];
    const workloadCase = document.workloadCases[caseIndex];
    const caseLabel = `timing.workloadCases[${caseIndex}]`;
    if (!exactKeys(workloadCase, [
      "id", "subjectId", "tier", "workloadBinding", "sustainedCadenceIdentity", "oneShotGpuIdentity",
      "coldCadenceWindows", "sustainedCadenceWindows", "gpuTimestampPopulations", "retention", "finalStableWindowId",
    ], caseLabel, errors)) continue;
    if (workloadCase.id !== expectedWorkload.id || workloadCase.subjectId !== expectedWorkload.subjectId || workloadCase.tier !== expectedWorkload.tier) errors.push(`${caseLabel} identity/order drifted`);
    const cadenceIdentity = validatePerformanceIdentity(workloadCase.sustainedCadenceIdentity, "sustained-cadence", expectedWorkload.subjectId, expectedWorkload.tier, header, errors, `${caseLabel}.sustainedCadenceIdentity`);
    const gpuIdentity = validatePerformanceIdentity(workloadCase.oneShotGpuIdentity, "one-shot-gpu", expectedWorkload.subjectId, expectedWorkload.tier, header, errors, `${caseLabel}.oneShotGpuIdentity`);
    if (!cadenceIdentity || !gpuIdentity) continue;
    try {
      assert.deepEqual(commonPerformanceIdentity(cadenceIdentity), commonPerformanceIdentity(gpuIdentity));
    } catch {
      errors.push(`${caseLabel} timing populations do not bind one immutable workload/device/source/generation definition`);
    }
    try {
      assert.deepEqual(cadenceIdentity.browser, document.targetDevice.browser);
      assert.deepEqual(cadenceIdentity.adapter, document.targetDevice.adapter);
    } catch {
      errors.push(`${caseLabel} performance identities do not match the named target browser/adapter`);
    }
    const workloadBinding = stableSha256({ deviceBinding: expectedBinding, commonIdentity: commonPerformanceIdentity(cadenceIdentity) });
    if (workloadCase.workloadBinding !== workloadBinding) errors.push(`${caseLabel}.workloadBinding does not bind the exact device and subject/tier`);
    const workload = Object.freeze({
      ...expectedWorkload,
      binding: workloadBinding,
      label: caseLabel,
      cadenceIdentitySha256: performanceIdentityDigest(cadenceIdentity),
      gpuIdentitySha256: performanceIdentityDigest(gpuIdentity),
    });
    const orderedWindows = [];
    if (!Array.isArray(workloadCase.coldCadenceWindows) || workloadCase.coldCadenceWindows.length !== 1) errors.push(`${caseLabel} must contain exactly one cold cadence window`);
    else workloadCase.coldCadenceWindows.forEach((window, index) => orderedWindows.push(validateCadenceWindow(window, index, "cold", gates, workload, cadenceIdentity, errors)));
    if (!Array.isArray(workloadCase.sustainedCadenceWindows) || workloadCase.sustainedCadenceWindows.length !== CORPUS_TIMING_GATES.sustainedWindowCount) errors.push(`${caseLabel} requires exactly ${CORPUS_TIMING_GATES.sustainedWindowCount} sustained cadence windows`);
    else {
      workloadCase.sustainedCadenceWindows.forEach((window, index) => orderedWindows.push(validateCadenceWindow(window, index, "sustained", gates, workload, cadenceIdentity, errors)));
      if (workloadCase.finalStableWindowId !== workloadCase.sustainedCadenceWindows.at(-1)?.id) errors.push(`${caseLabel}.finalStableWindowId must name its final sustained cadence window`);
    }
    for (let windowIndex = 1; windowIndex < orderedWindows.length; windowIndex += 1) {
      const previous = orderedWindows[windowIndex - 1];
      const current = orderedWindows[windowIndex];
      if (previous && current && current.start <= previous.end) errors.push(`${caseLabel} cadence windows overlap or run out of order`);
    }
    if (!Array.isArray(workloadCase.gpuTimestampPopulations) || workloadCase.gpuTimestampPopulations.length !== 1) errors.push(`${caseLabel} must contain exactly one independent one-shot GPU timestamp population`);
    else workloadCase.gpuTimestampPopulations.forEach((population, index) => validateGpuTimestampPopulation(population, index, gates, workload, gpuIdentity, errors));
    validatePerformanceRetention(workloadCase.retention, workloadCase, caseLabel, errors);
  }
}

function validateResourceLedger(document, header, context, errors) {
  const empty = Object.freeze({ inventorySha256: null, workloadCases: new Map() });
  if (!document) return empty;
  exactKeys(document, [
    "schemaVersion",
    "labId",
    "bundleId",
    "runId",
    "sourceHash",
    "buildRevision",
    "backend",
    "inventorySha256",
    "rows",
    "caseTotals",
    "peakRequestedLiveBytesGate",
  ], "resource-ledger.json", errors);
  validateDocumentHeader(document, "resource-ledger.json", { ...header, runId: header.runBindings.performance, backend: context.backend }, errors);
  const workloadPlan = SCULPT_TARGET_IDS.flatMap((subjectId) => SCULPT_TIERS.map((tier) => Object.freeze({ id: `${subjectId}:${tier}`, subjectId, tier })));
  const requiredRowCount = workloadPlan.length * REQUIRED_RESOURCE_CATEGORIES.length;
  if (!Array.isArray(document.rows) || document.rows.length !== requiredRowCount) {
    errors.push(`resource ledger must contain exactly ${requiredRowCount} subject/tier/category rows`);
    return empty;
  }
  let logical = 0;
  const allocationIds = new Set();
  const normalizedInventory = [];
  const caseAccumulators = new Map(workloadPlan.map((workload) => [workload.id, {
    ...workload,
    logical: 0,
    requested: 0,
    reads: 0,
    writes: 0,
    peakRequestedLive: 0,
    peakTransient: 0,
    persistentAllocationIds: [],
  }]));
  for (let index = 0; index < requiredRowCount; index += 1) {
    const workload = workloadPlan[Math.floor(index / REQUIRED_RESOURCE_CATEGORIES.length)];
    const category = REQUIRED_RESOURCE_CATEGORIES[index % REQUIRED_RESOURCE_CATEGORIES.length];
    const caseAccumulator = caseAccumulators.get(workload.id);
    const row = document.rows[index];
    const label = `resources.rows[${index}]`;
    if (!exactKeys(row, [
      "id",
      "workloadCaseId",
      "subjectId",
      "tier",
      "category",
      "owner",
      "ownershipClass",
      "resourceKind",
      "formulaId",
      "descriptorSource",
      "elementCount",
      "bytesPerElement",
      "sampleCount",
      "multiplicity",
      "logicalBytes",
      "requestedAllocationBytes",
      "peakRequestedLiveBytes",
      "physicalResidency",
      "readExecutionsPerFrame",
      "writeExecutionsPerFrame",
      "readFraction",
      "writeFraction",
      "readBytesPerFrame",
      "writeBytesPerFrame",
      "allocationCount",
      "allocationIds",
      "livenessIntervals",
      "transient",
    ], label, errors)) continue;
    requireText(row.id, `${label}.id`, errors, ID_PATTERN);
    requireText(row.owner, `${label}.owner`, errors, ID_PATTERN);
    if (!new Set(["app-owned", "shared-external", "renderer-opaque"]).has(row.ownershipClass)) errors.push(`${label}.ownershipClass is invalid`);
    requireText(row.resourceKind, `${label}.resourceKind`, errors, ID_PATTERN);
    requireText(row.descriptorSource, `${label}.descriptorSource`, errors);
    if (row.category !== category) errors.push(`${label}.category expected ${category}`);
    if (row.workloadCaseId !== workload.id || row.subjectId !== workload.subjectId || row.tier !== workload.tier) errors.push(`${label} workload identity/order drifted`);
    if (row.formulaId !== "resource-product-and-traffic-v1") errors.push(`${label}.formulaId drifted`);
    const opaque = row.ownershipClass === "renderer-opaque";
    const elementCount = evidenceDatum(row.elementCount, "Measured", `${label}.elementCount`, errors, { unit: "element", integer: true, minimum: opaque ? 0 : 1 });
    const bytesPerElement = evidenceDatum(row.bytesPerElement, "Measured", `${label}.bytesPerElement`, errors, { unit: "byte/element", integer: true, minimum: opaque ? 0 : 1 });
    const sampleCount = evidenceDatum(row.sampleCount, "Measured", `${label}.sampleCount`, errors, { unit: "sample", integer: true, minimum: opaque ? 0 : 1 });
    const multiplicity = evidenceDatum(row.multiplicity, "Measured", `${label}.multiplicity`, errors, { unit: "allocation", integer: true, minimum: opaque ? 0 : 1 });
    const rowLogical = evidenceDatum(row.logicalBytes, "Derived", `${label}.logicalBytes`, errors, { unit: "byte", minimum: 0 });
    const rowRequested = evidenceDatum(row.requestedAllocationBytes, "Derived", `${label}.requestedAllocationBytes`, errors, { unit: "byte", minimum: 0 });
    const rowPeak = evidenceDatum(row.peakRequestedLiveBytes, "Derived", `${label}.peakRequestedLiveBytes`, errors, { unit: "byte", minimum: 0 });
    const rowReads = evidenceDatum(row.readBytesPerFrame, "Derived", `${label}.readBytesPerFrame`, errors, { unit: "byte/frame", minimum: 0 });
    const rowWrites = evidenceDatum(row.writeBytesPerFrame, "Derived", `${label}.writeBytesPerFrame`, errors, { unit: "byte/frame", minimum: 0 });
    const readExecutions = evidenceDatum(row.readExecutionsPerFrame, "Authored", `${label}.readExecutionsPerFrame`, errors, { unit: "execution/frame", integer: true, minimum: 0 });
    const writeExecutions = evidenceDatum(row.writeExecutionsPerFrame, "Authored", `${label}.writeExecutionsPerFrame`, errors, { unit: "execution/frame", integer: true, minimum: 0 });
    const readFraction = evidenceDatum(row.readFraction, "Authored", `${label}.readFraction`, errors, { unit: "ratio", minimum: 0, maximum: 1 });
    const writeFraction = evidenceDatum(row.writeFraction, "Authored", `${label}.writeFraction`, errors, { unit: "ratio", minimum: 0, maximum: 1 });
    const measuredAllocationCount = evidenceDatum(row.allocationCount, "Measured", `${label}.allocationCount`, errors, { unit: "count", integer: true, minimum: 0 });
    if (opaque && (!Array.isArray(row.allocationIds) || row.allocationIds.length !== 0)) errors.push(`${label} renderer-opaque resources must not invent allocation IDs`);
    else if (!opaque) requireUniqueSortedIds(row.allocationIds, `${label}.allocationIds`, errors);
    if (row.allocationIds?.length !== measuredAllocationCount || measuredAllocationCount !== multiplicity) errors.push(`${label} allocation IDs/count/multiplicity do not close`);
    for (const id of row.allocationIds ?? []) {
      if (allocationIds.has(id)) errors.push(`duplicate resource allocation ID ${id}`);
      allocationIds.add(id);
    }
    if (!Array.isArray(row.livenessIntervals) || (!opaque && row.livenessIntervals.length === 0) || (opaque && row.livenessIntervals.length !== 0)) errors.push(`${label}.livenessIntervals must reflect only observed app-owned/shared allocations`);
    let overlapsPeak = false;
    const intervalIds = new Set();
    for (const [intervalIndex, interval] of (row.livenessIntervals ?? []).entries()) {
      const intervalLabel = `${label}.livenessIntervals[${intervalIndex}]`;
      if (!exactKeys(interval, ["id", "startEvent", "endEvent", "overlapsPeak"], intervalLabel, errors)) continue;
      requireText(interval.id, `${intervalLabel}.id`, errors, ID_PATTERN);
      requireText(interval.startEvent, `${intervalLabel}.startEvent`, errors);
      requireText(interval.endEvent, `${intervalLabel}.endEvent`, errors);
      if (interval.startEvent === interval.endEvent) errors.push(`${intervalLabel} must span two distinct lifecycle events`);
      if (intervalIds.has(interval.id)) errors.push(`${label} duplicate liveness interval ${interval.id}`);
      intervalIds.add(interval.id);
      if (typeof interval.overlapsPeak !== "boolean") errors.push(`${intervalLabel}.overlapsPeak must be boolean`);
      overlapsPeak ||= interval.overlapsPeak === true;
    }
    if (typeof row.transient !== "boolean") errors.push(`${label}.transient must be boolean`);
    const expectedLogical = elementCount * bytesPerElement * sampleCount * multiplicity;
    const expectedReads = expectedLogical * readExecutions * readFraction;
    const expectedWrites = expectedLogical * writeExecutions * writeFraction;
    const expectedPeak = overlapsPeak ? rowRequested : 0;
    if (!almostEqual(rowLogical, expectedLogical) || row.logicalBytes?.source !== "product(elementCount,bytesPerElement,sampleCount,multiplicity)") errors.push(`${label}.logicalBytes does not close over its exact descriptor factors`);
    if (!almostEqual(rowRequested, rowLogical) || row.requestedAllocationBytes?.source !== "logicalBytes exact app-requested allocation bytes") errors.push(`${label}.requestedAllocationBytes must preserve only exact app-requested bytes`);
    if (!almostEqual(rowReads, expectedReads) || row.readBytesPerFrame?.source !== "logicalBytes * readExecutionsPerFrame * readFraction") errors.push(`${label}.readBytesPerFrame formula drifted`);
    if (!almostEqual(rowWrites, expectedWrites) || row.writeBytesPerFrame?.source !== "logicalBytes * writeExecutionsPerFrame * writeFraction") errors.push(`${label}.writeBytesPerFrame formula drifted`);
    if (!almostEqual(rowPeak, expectedPeak) || row.peakRequestedLiveBytes?.source !== "requestedAllocationBytes when observed liveness overlaps peak") errors.push(`${label}.peakRequestedLiveBytes does not close over observed liveness`);
    if (!exactKeys(row.physicalResidency, ["verdict", "bytes", "method", "reason"], `${label}.physicalResidency`, errors)) continue;
    if (row.physicalResidency.verdict !== "NOT_CLAIMED" || row.physicalResidency.bytes !== null || row.physicalResidency.method !== null) errors.push(`${label}.physicalResidency must remain explicitly NOT_CLAIMED; requested/logical bytes are not physical residency`);
    requireText(row.physicalResidency.reason, `${label}.physicalResidency.reason`, errors);
    logical += rowLogical ?? 0;
    caseAccumulator.logical += rowLogical ?? 0;
    caseAccumulator.requested += rowRequested ?? 0;
    caseAccumulator.reads += rowReads ?? 0;
    caseAccumulator.writes += rowWrites ?? 0;
    caseAccumulator.peakRequestedLive += rowPeak ?? 0;
    if (row.transient) caseAccumulator.peakTransient += rowPeak ?? 0;
    else caseAccumulator.persistentAllocationIds.push(...(row.allocationIds ?? []));
    normalizedInventory.push({
      id: row.id,
      workloadCaseId: row.workloadCaseId,
      subjectId: row.subjectId,
      tier: row.tier,
      category: row.category,
      owner: row.owner,
      ownershipClass: row.ownershipClass,
      resourceKind: row.resourceKind,
      allocationIds: row.allocationIds,
      transient: row.transient,
      logicalBytes: rowLogical,
      requestedAllocationBytes: rowRequested,
      physicalResidencyVerdict: row.physicalResidency.verdict,
    });
  }
  const peakGate = evidenceDatum(document.peakRequestedLiveBytesGate, "Gated", "resources.peakRequestedLiveBytesGate", errors, { unit: "byte", minimum: 0 });
  if (peakGate !== CORPUS_RESOURCE_PEAK_GATE_BYTES || document.peakRequestedLiveBytesGate?.source !== "CORPUS_RESOURCE_PEAK_GATE_BYTES") errors.push("resource requested-byte peak gate drifted from the checked-in low-end ceiling");
  const workloadCases = new Map();
  if (!Array.isArray(document.caseTotals) || document.caseTotals.length !== workloadPlan.length) errors.push(`resource ledger must contain exactly ${workloadPlan.length} workload case totals`);
  else for (let caseIndex = 0; caseIndex < workloadPlan.length; caseIndex += 1) {
    const expected = workloadPlan[caseIndex];
    const totals = document.caseTotals[caseIndex];
    const label = `resources.caseTotals[${caseIndex}]`;
    if (!exactKeys(totals, ["id", "subjectId", "tier", "inventorySha256", "logicalBytes", "requestedAllocationBytes", "peakRequestedLiveBytes", "peakTransientRequestedBytes", "readBytesPerFrame", "writeBytesPerFrame", "physicalResidency"], label, errors)) continue;
    if (totals.id !== expected.id || totals.subjectId !== expected.subjectId || totals.tier !== expected.tier) errors.push(`${label} workload identity/order drifted`);
    const accumulator = caseAccumulators.get(expected.id);
    const caseRows = normalizedInventory.filter(({ workloadCaseId }) => workloadCaseId === expected.id);
    const caseInventorySha256 = stableSha256(caseRows);
    if (totals.inventorySha256 !== caseInventorySha256) errors.push(`${label}.inventorySha256 does not bind its exact six resource rows`);
    const totalLogical = evidenceDatum(totals.logicalBytes, "Derived", `${label}.logicalBytes`, errors, { unit: "byte", minimum: 0 });
    const totalRequested = evidenceDatum(totals.requestedAllocationBytes, "Derived", `${label}.requestedAllocationBytes`, errors, { unit: "byte", minimum: 0 });
    const peakLive = evidenceDatum(totals.peakRequestedLiveBytes, "Derived", `${label}.peakRequestedLiveBytes`, errors, { unit: "byte", minimum: 0 });
    const peakTransient = evidenceDatum(totals.peakTransientRequestedBytes, "Derived", `${label}.peakTransientRequestedBytes`, errors, { unit: "byte", minimum: 0 });
    const totalReads = evidenceDatum(totals.readBytesPerFrame, "Derived", `${label}.readBytesPerFrame`, errors, { unit: "byte/frame", minimum: 0 });
    const totalWrites = evidenceDatum(totals.writeBytesPerFrame, "Derived", `${label}.writeBytesPerFrame`, errors, { unit: "byte/frame", minimum: 0 });
    if (!almostEqual(totalLogical, accumulator.logical) || !almostEqual(totalRequested, accumulator.requested) || !almostEqual(totalReads, accumulator.reads) || !almostEqual(totalWrites, accumulator.writes)) errors.push(`${label} does not close over its exact six rows`);
    if (!almostEqual(peakLive, accumulator.peakRequestedLive) || !almostEqual(peakTransient, accumulator.peakTransient) || peakTransient > peakLive || peakLive > peakGate) errors.push(`${label} failed exact requested-byte simultaneous-liveness/gate closure`);
    if (totals.peakRequestedLiveBytes?.source !== "sum(case rows.peakRequestedLiveBytes)" || totals.peakTransientRequestedBytes?.source !== "sum(transient case rows.peakRequestedLiveBytes)") errors.push(`${label} requested-byte peak formulas drifted`);
    if (!exactKeys(totals.physicalResidency, ["verdict", "bytes", "method", "reason"], `${label}.physicalResidency`, errors)) continue;
    if (totals.physicalResidency.verdict !== "NOT_CLAIMED" || totals.physicalResidency.bytes !== null || totals.physicalResidency.method !== null) errors.push(`${label}.physicalResidency guesses opaque renderer residency`);
    requireText(totals.physicalResidency.reason, `${label}.physicalResidency.reason`, errors);
    workloadCases.set(expected.id, Object.freeze({
      inventorySha256: caseInventorySha256,
      persistentAllocationIds: Object.freeze(accumulator.persistentAllocationIds.sort((a, b) => a.localeCompare(b))),
    }));
  }
  const inventorySha256 = stableSha256(normalizedInventory);
  if (document.inventorySha256 !== inventorySha256) errors.push("resource inventorySha256 does not bind the exact row descriptors and allocation IDs");
  return Object.freeze({ inventorySha256, workloadCases });
}

function validateLifecycleSnapshot(snapshot, label, persistentAllocationIds, errors) {
  if (!exactKeys(snapshot, [
    "snapshotId",
    "capturedAtMonotonicMs",
    "snapshotSource",
    "liveResourceIds",
    "uncertainResourceIds",
    "possiblyLiveResourceIds",
    "disposalClosureStatus",
    "allocationCounter",
    "disposalCounter",
    "rendererDeviceGeneration",
    "deviceLossGeneration",
    "historyEpoch",
    "viewport",
    "dpr",
    "tier",
    "mode",
    "subjectId",
    "snapshotSha256",
  ], label, errors)) return null;
  requireText(snapshot.snapshotId, `${label}.snapshotId`, errors, ID_PATTERN);
  const capturedAtMonotonicMs = evidenceDatum(snapshot.capturedAtMonotonicMs, "Measured", `${label}.capturedAtMonotonicMs`, errors, { unit: "ms", minimum: 0 });
  if (snapshot.snapshotSource !== "lab-controller.getMetrics") errors.push(`${label}.snapshotSource must identify the runtime metrics snapshot producer`);
  requireUniqueSortedIds(snapshot.liveResourceIds, `${label}.liveResourceIds`, errors);
  if (!Array.isArray(snapshot.uncertainResourceIds) || snapshot.uncertainResourceIds.length !== 0) errors.push(`${label}.uncertainResourceIds must be an observed empty set for lifecycle acceptance`);
  if (!Array.isArray(snapshot.possiblyLiveResourceIds) || snapshot.possiblyLiveResourceIds.length !== 0) errors.push(`${label}.possiblyLiveResourceIds must be an observed empty set for lifecycle acceptance`);
  if (snapshot.disposalClosureStatus !== "certain") errors.push(`${label}.disposalClosureStatus must be certain; accounting reconciliation cannot prove uncertain teardown leak-free`);
  if (persistentAllocationIds !== null) {
    try {
      assert.deepEqual(snapshot.liveResourceIds, persistentAllocationIds);
    } catch {
      errors.push(`${label}.liveResourceIds does not equal the resource ledger's persistent allocation inventory`);
    }
  }
  const allocationCounter = evidenceDatum(snapshot.allocationCounter, "Measured", `${label}.allocationCounter`, errors, { unit: "count", integer: true, minimum: 0 });
  const disposalCounter = evidenceDatum(snapshot.disposalCounter, "Measured", `${label}.disposalCounter`, errors, { unit: "count", integer: true, minimum: 0 });
  const rendererDeviceGeneration = evidenceDatum(snapshot.rendererDeviceGeneration, "Measured", `${label}.rendererDeviceGeneration`, errors, { unit: "generation", integer: true, minimum: 1 });
  const deviceLossGeneration = evidenceDatum(snapshot.deviceLossGeneration, "Measured", `${label}.deviceLossGeneration`, errors, { unit: "generation", integer: true, minimum: 0 });
  const historyEpoch = evidenceDatum(snapshot.historyEpoch, "Measured", `${label}.historyEpoch`, errors, { unit: "epoch", integer: true, minimum: 0 });
  const dpr = evidenceDatum(snapshot.dpr, "Measured", `${label}.dpr`, errors, { unit: "ratio", minimum: Number.EPSILON, maximum: 4 });
  if (!/^\d+x\d+$/.test(snapshot.viewport ?? "")) errors.push(`${label}.viewport must be a widthxheight CSS-pixel key`);
  if (!SCULPT_TIERS.includes(snapshot.tier)) errors.push(`${label}.tier is not canonical`);
  if (!new Set(["final", "blockout", "hierarchy", "materials", "action-ready"]).has(snapshot.mode)) errors.push(`${label}.mode is not canonical`);
  if (!SCULPT_TARGET_IDS.includes(snapshot.subjectId)) errors.push(`${label}.subjectId is not canonical`);
  const digestInput = { ...snapshot };
  delete digestInput.snapshotSha256;
  if (snapshot.snapshotSha256 !== stableSha256(digestInput)) errors.push(`${label}.snapshotSha256 does not bind the exact runtime snapshot`);
  return Object.freeze({
    snapshotId: snapshot.snapshotId,
    capturedAtMonotonicMs,
    allocationCounter,
    disposalCounter,
    rendererDeviceGeneration,
    deviceLossGeneration,
    historyEpoch,
    viewport: snapshot.viewport,
    dpr,
    tier: snapshot.tier,
    mode: snapshot.mode,
    subjectId: snapshot.subjectId,
    liveResourceIds: snapshot.liveResourceIds,
  });
}

function lifecycleObservedValue(id, snapshot) {
  if (id === "resize") return snapshot.viewport;
  if (id === "dpr-change") return String(snapshot.dpr);
  if (id === "tier-change") return snapshot.tier;
  if (id === "mode-change") return snapshot.mode;
  if (id === "history-reset") return String(snapshot.historyEpoch);
  if (id === "subject-replace") return snapshot.subjectId;
  if (id === "dispose-recreate") return String(snapshot.rendererDeviceGeneration);
  if (id === "device-error-recovery") return String(snapshot.deviceLossGeneration);
  return null;
}

function lifecycleActionApplied(id, before, after) {
  if (!before || !after) return false;
  if (id === "resize") return before.viewport !== after.viewport;
  if (id === "dpr-change") return before.dpr !== after.dpr;
  if (id === "tier-change") return before.tier !== after.tier;
  if (id === "mode-change") return before.mode !== after.mode;
  if (id === "history-reset") return after.historyEpoch === before.historyEpoch + 1;
  if (id === "subject-replace") return before.subjectId !== after.subjectId;
  if (id === "dispose-recreate") return after.rendererDeviceGeneration === before.rendererDeviceGeneration + 1;
  if (id === "device-error-recovery") {
    return after.rendererDeviceGeneration === before.rendererDeviceGeneration + 1
      && after.deviceLossGeneration === before.deviceLossGeneration + 1;
  }
  return false;
}

function validateLifecycle(document, header, context, resourceContext, errors) {
  if (!document) return;
  exactKeys(document, [
    "schemaVersion",
    "labId",
    "bundleId",
    "runId",
    "sourceHash",
    "buildRevision",
    "backend",
    "resourceWorkloadCaseId",
    "resourceInventorySha256",
    "collectionMethod",
    "minimumIterations",
    "cases",
    "trendAnalysis",
  ], "lifecycle-evidence.json", errors);
  validateDocumentHeader(document, "lifecycle-evidence.json", { ...header, runId: header.runBindings.lifecycle, backend: context.backend }, errors);
  if (document.collectionMethod !== "lab-controller-runtime-snapshots-and-transitions-v1") errors.push("lifecycle collectionMethod must identify real runtime snapshots and transitions");
  const minimumIterations = evidenceDatum(document.minimumIterations, "Gated", "lifecycle.minimumIterations", errors, { unit: "iteration", integer: true, minimum: 1 });
  if (minimumIterations !== CORPUS_LIFECYCLE_MINIMUM_ITERATIONS || document.minimumIterations?.source !== "CORPUS_LIFECYCLE_MINIMUM_ITERATIONS") errors.push("lifecycle minimum iteration gate drifted from the checked-in requirement");
  const resourceWorkload = resourceContext.workloadCases.get(document.resourceWorkloadCaseId);
  if (!resourceWorkload) errors.push("lifecycle resourceWorkloadCaseId does not identify a validated subject/tier resource case");
  if (document.resourceInventorySha256 !== resourceWorkload?.inventorySha256) errors.push("lifecycle resource inventory does not bind its selected resource-ledger subject/tier case");
  const persistentAllocationIds = resourceWorkload?.persistentAllocationIds ?? [];
  const [resourceSubjectId, resourceTier] = String(document.resourceWorkloadCaseId ?? "").split(":");
  if (!Array.isArray(document.cases) || document.cases.length !== REQUIRED_LIFECYCLE_CASE_IDS.length) {
    errors.push(`lifecycle evidence must contain exactly ${REQUIRED_LIFECYCLE_CASE_IDS.length} cases`);
    return;
  }
  const derivedTrends = [];
  for (let index = 0; index < REQUIRED_LIFECYCLE_CASE_IDS.length; index += 1) {
    const id = REQUIRED_LIFECYCLE_CASE_IDS[index];
    const lifecycleCase = document.cases[index];
    const label = `lifecycle.cases[${index}]`;
    if (!exactKeys(lifecycleCase, [
      "id",
      "iterations",
      "witnesses",
    ], label, errors)) continue;
    if (lifecycleCase.id !== id) errors.push(`${label}.id expected ${id}`);
    const iterations = evidenceDatum(lifecycleCase.iterations, "Measured", `${label}.iterations`, errors, { unit: "iteration", integer: true, minimum: 1 });
    if (iterations < minimumIterations || !Array.isArray(lifecycleCase.witnesses) || lifecycleCase.witnesses.length !== iterations) {
      errors.push(`${label}.witnesses must exactly close over the gated iteration count`);
      continue;
    }
    let previousAfterDocument = null;
    let firstBefore = null;
    let finalAfter = null;
    let previousFinishedAt = Number.NEGATIVE_INFINITY;
    for (let witnessIndex = 0; witnessIndex < lifecycleCase.witnesses.length; witnessIndex += 1) {
      const witness = lifecycleCase.witnesses[witnessIndex];
      const witnessLabel = `${label}.witnesses[${witnessIndex}]`;
      if (!exactKeys(witness, ["iteration", "before", "action", "afterAction", "after", "resourceDisposition", "counters", "invariantResults", "errorEvents", "postDisposeErrorEvents"], witnessLabel, errors)) continue;
      const iteration = evidenceDatum(witness.iteration, "Measured", `${witnessLabel}.iteration`, errors, { unit: "ordinal", integer: true, minimum: 0 });
      if (iteration !== witnessIndex) errors.push(`${witnessLabel}.iteration must match its zero-based order`);
      if (previousAfterDocument !== null) {
        try {
          assert.deepEqual(witness.before, previousAfterDocument);
        } catch {
          errors.push(`${witnessLabel}.before does not continue the prior iteration's exact after snapshot`);
        }
      }
      const before = validateLifecycleSnapshot(witness.before, `${witnessLabel}.before`, persistentAllocationIds, errors);
      const afterAction = validateLifecycleSnapshot(witness.afterAction, `${witnessLabel}.afterAction`, null, errors);
      const after = validateLifecycleSnapshot(witness.after, `${witnessLabel}.after`, persistentAllocationIds, errors);
      firstBefore ??= before;
      finalAfter = after;
      if (before && afterAction && after && (!(afterAction.capturedAtMonotonicMs > before.capturedAtMonotonicMs) || !(after.capturedAtMonotonicMs > afterAction.capturedAtMonotonicMs) || before.capturedAtMonotonicMs <= previousFinishedAt)) errors.push(`${witnessLabel} runtime snapshots are discontinuous or out of order`);
      if (witnessIndex === 0 && (before?.subjectId !== resourceSubjectId || before?.tier !== resourceTier)) errors.push(`${witnessLabel}.before does not start from the selected resource workload case`);
      previousAfterDocument = witness.after;
      if (!exactKeys(witness.action, ["id", "transitionId", "status", "requestedValue", "observedValue", "startedAtMonotonicMs", "finishedAtMonotonicMs", "controllerReceipt"], `${witnessLabel}.action`, errors)) continue;
      if (witness.action.id !== id || witness.action.status !== "completed") errors.push(`${witnessLabel}.action identity/status drifted`);
      requireText(witness.action.transitionId, `${witnessLabel}.action.transitionId`, errors, ID_PATTERN);
      const actionStarted = evidenceDatum(witness.action.startedAtMonotonicMs, "Measured", `${witnessLabel}.action.startedAtMonotonicMs`, errors, { unit: "ms", minimum: 0 });
      const actionFinished = evidenceDatum(witness.action.finishedAtMonotonicMs, "Measured", `${witnessLabel}.action.finishedAtMonotonicMs`, errors, { unit: "ms", minimum: 0 });
      if (!(actionStarted >= before?.capturedAtMonotonicMs && actionFinished > actionStarted && actionFinished <= afterAction?.capturedAtMonotonicMs)) errors.push(`${witnessLabel}.action timestamps do not fall between the before/afterAction runtime snapshots`);
      previousFinishedAt = actionFinished;
      if (!exactKeys(witness.action.controllerReceipt, ["operationId", "generationBefore", "generationAfter", "status"], `${witnessLabel}.action.controllerReceipt`, errors)) continue;
      requireText(witness.action.controllerReceipt.operationId, `${witnessLabel}.action.controllerReceipt.operationId`, errors, ID_PATTERN);
      if (witness.action.controllerReceipt.status !== "committed") errors.push(`${witnessLabel}.action.controllerReceipt must prove a committed runtime transition`);
      const receiptGenerationBefore = evidenceDatum(witness.action.controllerReceipt.generationBefore, "Measured", `${witnessLabel}.action.controllerReceipt.generationBefore`, errors, { unit: "generation", integer: true, minimum: 1 });
      const receiptGenerationAfter = evidenceDatum(witness.action.controllerReceipt.generationAfter, "Measured", `${witnessLabel}.action.controllerReceipt.generationAfter`, errors, { unit: "generation", integer: true, minimum: 1 });
      if (receiptGenerationBefore !== before?.rendererDeviceGeneration || receiptGenerationAfter !== afterAction?.rendererDeviceGeneration) errors.push(`${witnessLabel}.action.controllerReceipt generation binding drifted`);
      requireText(witness.action.requestedValue, `${witnessLabel}.action.requestedValue`, errors);
      requireText(witness.action.observedValue, `${witnessLabel}.action.observedValue`, errors);
      const actionApplied = lifecycleActionApplied(id, before, afterAction);
      const observedValue = lifecycleObservedValue(id, afterAction);
      if (witness.action.requestedValue !== observedValue || witness.action.observedValue !== observedValue) errors.push(`${witnessLabel}.action request/observation does not bind the after snapshot`);
      if (!exactKeys(witness.resourceDisposition, ["status", "uncertainResourceIds", "possiblyLiveResourceIds"], `${witnessLabel}.resourceDisposition`, errors)) continue;
      if (witness.resourceDisposition.status !== "closed" || !Array.isArray(witness.resourceDisposition.uncertainResourceIds) || witness.resourceDisposition.uncertainResourceIds.length !== 0 || !Array.isArray(witness.resourceDisposition.possiblyLiveResourceIds) || witness.resourceDisposition.possiblyLiveResourceIds.length !== 0) errors.push(`${witnessLabel}.resourceDisposition must prove certain closure with no possibly-live resources`);
      if (!exactKeys(witness.counters, ["allocationsDelta", "disposalsDelta", "frameErrorDelta", "lifecycleErrorDelta", "deviceErrorDelta"], `${witnessLabel}.counters`, errors)) continue;
      const allocationsDelta = evidenceDatum(witness.counters.allocationsDelta, "Measured", `${witnessLabel}.counters.allocationsDelta`, errors, { unit: "count", integer: true, minimum: 0 });
      const disposalsDelta = evidenceDatum(witness.counters.disposalsDelta, "Measured", `${witnessLabel}.counters.disposalsDelta`, errors, { unit: "count", integer: true, minimum: 0 });
      const frameErrorDelta = evidenceDatum(witness.counters.frameErrorDelta, "Measured", `${witnessLabel}.counters.frameErrorDelta`, errors, { unit: "count", integer: true, minimum: 0 });
      const lifecycleErrorDelta = evidenceDatum(witness.counters.lifecycleErrorDelta, "Measured", `${witnessLabel}.counters.lifecycleErrorDelta`, errors, { unit: "count", integer: true, minimum: 0 });
      const deviceErrorDelta = evidenceDatum(witness.counters.deviceErrorDelta, "Measured", `${witnessLabel}.counters.deviceErrorDelta`, errors, { unit: "count", integer: true, minimum: 0 });
      const countersClose = before && after
        && after.allocationCounter - before.allocationCounter === allocationsDelta
        && after.disposalCounter - before.disposalCounter === disposalsDelta
        && allocationsDelta === disposalsDelta
        && frameErrorDelta === 0
        && lifecycleErrorDelta === 0
        && deviceErrorDelta === (id === "device-error-recovery" ? 1 : 0)
        && (!new Set(["dispose-recreate", "device-error-recovery"]).has(id) || allocationsDelta >= 1);
      const resourceEquilibrium = before && after && JSON.stringify(before.liveResourceIds) === JSON.stringify(after.liveResourceIds) && allocationsDelta === disposalsDelta;
      const noUnhandledErrors = Array.isArray(witness.errorEvents) && witness.errorEvents.length === 0
        && Array.isArray(witness.postDisposeErrorEvents) && witness.postDisposeErrorEvents.length === 0
        && frameErrorDelta === 0 && lifecycleErrorDelta === 0;
      if (!Array.isArray(witness.errorEvents)) errors.push(`${witnessLabel}.errorEvents must be an array`);
      if (!Array.isArray(witness.postDisposeErrorEvents)) errors.push(`${witnessLabel}.postDisposeErrorEvents must be an array`);
      if (!Array.isArray(witness.invariantResults) || witness.invariantResults.length !== 3) {
        errors.push(`${witnessLabel}.invariantResults must contain exactly the three derived lifecycle gates`);
      } else {
        const expectedInvariants = [
          [`${id}:action-applied`, actionApplied],
          [`${id}:resource-equilibrium`, resourceEquilibrium],
          [`${id}:no-unhandled-errors`, noUnhandledErrors],
        ];
        for (let invariantIndex = 0; invariantIndex < expectedInvariants.length; invariantIndex += 1) {
          const invariant = witness.invariantResults[invariantIndex];
          const invariantLabel = `${witnessLabel}.invariantResults[${invariantIndex}]`;
          if (!exactKeys(invariant, ["id", "passed", "witness"], invariantLabel, errors)) continue;
          const [expectedId, derivedPass] = expectedInvariants[invariantIndex];
          if (invariant.id !== expectedId || invariant.passed !== derivedPass || invariant.passed !== true) errors.push(`${invariantLabel} contradicts the validator-derived lifecycle result`);
          requireText(invariant.witness, `${invariantLabel}.witness`, errors);
        }
      }
      if (!actionApplied || !countersClose || !resourceEquilibrium || !noUnhandledErrors) {
        errors.push(`${witnessLabel} failed action/counter/resource/error closure`);
      }
    }
    derivedTrends.push(Object.freeze({
      caseId: id,
      sampleCount: lifecycleCase.witnesses.length,
      netLiveResourceDelta: (finalAfter?.liveResourceIds?.length ?? 0) - (firstBefore?.liveResourceIds?.length ?? 0),
      netAllocationMinusDisposalDelta: ((finalAfter?.allocationCounter ?? 0) - (firstBefore?.allocationCounter ?? 0))
        - ((finalAfter?.disposalCounter ?? 0) - (firstBefore?.disposalCounter ?? 0)),
      verdict: "PASS",
    }));
  }
  try {
    assert.deepEqual(document.trendAnalysis, derivedTrends);
  } catch {
    errors.push("lifecycle trendAnalysis must derive from the full runtime snapshot/transition population; synthetic aggregate counters are rejected");
  }
}

function validatePhysicalRouteCaptureSession(session, header, errors) {
  if (!exactKeys(session, [
    "profile", "automationSurface", "adapterClass", "adapterIdentity", "browser", "sourceClosureHash", "buildRevision",
    "runnerHref", "startedAt", "finishedAt", "startedAtMonotonicMs", "finishedAtMonotonicMs",
  ], "route-runtime-evidence.captureSession", errors)) return;
  if (session.profile !== "physical-route" || session.automationSurface !== IN_APP_BROWSER_SURFACE) errors.push("route evidence must identify the distinct Codex in-app Browser physical-route surface");
  if (!new Set(["hardware", "software", "unknown"]).has(session.adapterClass)) errors.push("route capture adapterClass is invalid");
  if (!exactKeys(session.adapterIdentity, ["source", "backendType", "deviceType", "deviceLabel", "deviceIdentityVerified"], "route capture adapterIdentity", errors)) return;
  for (const field of ["source", "backendType", "deviceType"]) requireText(session.adapterIdentity[field], `route capture adapterIdentity.${field}`, errors);
  if (typeof session.adapterIdentity.deviceLabel !== "string") errors.push("route capture adapterIdentity.deviceLabel must be a string");
  if (session.adapterIdentity.deviceIdentityVerified !== true) errors.push("route capture must bind the initialized renderer device identity");
  if (!exactKeys(session.browser, ["userAgent", "platform", "userAgentData"], "route capture browser", errors)) return;
  requireText(session.browser.userAgent, "route capture browser.userAgent", errors);
  requireText(session.browser.platform, "route capture browser.platform", errors);
  if (session.browser.userAgentData !== null && (typeof session.browser.userAgentData !== "object" || Array.isArray(session.browser.userAgentData))) errors.push("route capture browser.userAgentData must be null or an observed object");
  if (session.sourceClosureHash !== header.sourceHash || session.buildRevision !== header.buildRevision) errors.push("route capture session does not bind the accepted canonical executable source closure");
  try {
    const runnerUrl = new URL(session.runnerHref);
    if (!new Set(["http:", "https:"]).has(runnerUrl.protocol)) throw new Error("unsupported protocol");
  } catch {
    errors.push("route capture runnerHref must be an absolute HTTP(S) URL");
  }
  const startedAt = Date.parse(session.startedAt);
  const finishedAt = Date.parse(session.finishedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt) errors.push("route capture wall-clock interval is invalid");
  const monotonicStart = evidenceDatum(session.startedAtMonotonicMs, "Measured", "route capture startedAtMonotonicMs", errors, { unit: "ms", minimum: 0 });
  const monotonicFinish = evidenceDatum(session.finishedAtMonotonicMs, "Measured", "route capture finishedAtMonotonicMs", errors, { unit: "ms", minimum: 0 });
  if (!(monotonicFinish > monotonicStart)) errors.push("route capture monotonic interval is invalid");
}

function validateRouteEvidence(document, bundleDir, header, context, errors) {
  if (!document) return;
  exactKeys(document, ["schemaVersion", "labId", "bundleId", "runId", "sourceHash", "buildRevision", "captureSession", "backend", "routes"], "route-runtime-evidence.json", errors);
  validateDocumentHeader(document, "route-runtime-evidence.json", { ...header, runId: header.runBindings.routes, backend: context.backend }, errors);
  validatePhysicalRouteCaptureSession(document.captureSession, header, errors);
  try {
    validatePhysicalRouteRuntimeRecords(document.routes, {
      readArtifact(reference, record) {
        const file = confinedFileReference(bundleDir, { path: reference?.path, sha256: reference?.sha256 }, `${record.routeId}.readback.artifact`, errors, { extensions: [".bin"] });
        return file?.bytes ?? new Uint8Array();
      },
    });
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
    "sourceHash",
    "buildRevision",
    "backend",
    "claimVerdicts",
    "profile",
    "captureProvenance",
    "runBindings",
    "captureSession",
    "routeRuntimeEvidence",
    "visualContract",
    "captures",
    "standardOutputs",
  ], "evidence-manifest.json", errors);
  if (document.schemaVersion !== 2 || document.labId !== LAB_ID) errors.push("evidence-manifest identity drifted");
  const bundleId = requireText(document.bundleId, "evidence-manifest.bundleId", errors, ID_PATTERN);
  requireText(document.runId, "evidence-manifest.runId", errors, ID_PATTERN);
  validateBackendRecord(document.backend, context.backend, "evidence-manifest.backend", errors);
  if (!exactKeys(document.claimVerdicts, CLAIM_VERDICTS, "evidence-manifest.claimVerdicts", errors)) return null;
  for (const claim of CLAIM_VERDICTS) {
    if (!VALID_VERDICTS.has(document.claimVerdicts[claim])) errors.push(`evidence-manifest.claimVerdicts.${claim} is invalid`);
    if (document.claimVerdicts[claim] !== "PASS") errors.push(`evidence-manifest.claimVerdicts.${claim} must be PASS for accepted Object Sculptor coverage`);
  }
  if (document.sourceHash !== context.sourceHash) errors.push("evidence-manifest.sourceHash does not match capture-session.json");
  if (document.buildRevision !== context.buildRevision) errors.push("evidence-manifest.buildRevision does not match capture-session.json");
  try {
    assert.deepEqual(document.captureProvenance, context.captureProvenance);
  } catch {
    errors.push("evidence-manifest.captureProvenance does not exactly bind the capture source/browser/URL/profile/viewport/DPR");
  }
  if (document.profile !== "correctness") errors.push("evidence-manifest.profile must be correctness");
  if (!exactKeys(document.runBindings, ["correctness", "routes", "performance", "lifecycle"], "evidence-manifest.runBindings", errors)) return null;
  for (const [profile, runId] of Object.entries(document.runBindings)) requireText(runId, `evidence-manifest.runBindings.${profile}`, errors, ID_PATTERN);
  if (new Set(Object.values(document.runBindings)).size !== 4) errors.push("evidence profile run IDs must be distinct");
  if (document.runBindings.correctness !== context.runId || document.runId !== context.runId) errors.push("evidence-manifest correctness run does not match capture hook run ID");
  const captureSession = confinedFinalizedCaptureSessionReference(bundleDir, document.captureSession, "evidence-manifest.captureSession", errors);
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
  if (!Array.isArray(document.standardOutputs) || document.standardOutputs.length !== STANDARD_OUTPUT_IDS.length) {
    errors.push(`evidence-manifest must contain exactly ${STANDARD_OUTPUT_IDS.length} standard output records`);
  } else for (let index = 0; index < STANDARD_OUTPUT_IDS.length; index += 1) {
    const id = STANDARD_OUTPUT_IDS[index];
    const output = document.standardOutputs[index];
    if (!exactKeys(output, ["id", "status", "file"], `evidence-manifest.standardOutputs[${index}]`, errors)) continue;
    if (output.id !== id) errors.push(`evidence-manifest standard output ${index} expected ${id}`);
    const expectedCaptured = !new Set(["no-post.design", "camera.far"]).has(id);
    const expectedStatus = expectedCaptured ? "CAPTURED" : "NOT_APPLICABLE";
    if (output.status !== expectedStatus) errors.push(`evidence-manifest ${id} status expected ${expectedStatus}`);
    if (expectedCaptured) {
      confinedFileReference(bundleDir, output.file, `evidence-manifest.${id}.file`, errors, { extensions: [".png"] });
      sameFileReference(output.file, context.standardOutputFiles.get(id), `evidence-manifest.${id}.file`, errors);
    } else if (output.file !== null) errors.push(`evidence-manifest ${id}.file must be null for ${expectedStatus}`);
  }
  return Object.freeze({
    bundleId,
    sourceHash: context.sourceHash,
    buildRevision: context.buildRevision,
    runBindings: Object.freeze({ ...document.runBindings }),
    backend: context.backend,
    captureSession: captureSession && { path: captureSession.path, sha256: captureSession.sha256 },
    routeRuntimeEvidence: routeRuntimeEvidence && { path: routeRuntimeEvidence.path, sha256: routeRuntimeEvidence.sha256 },
    visualContract: visualContract && { path: visualContract.path, sha256: visualContract.sha256 },
  });
}

function validateAcceptanceSummary(document, bundleDir, context, header, errors) {
  if (!document) return;
  exactKeys(document, ["schemaVersion", "labId", "bundleId", "runId", "sourceHash", "buildRevision", "backend", "runBindings", "gates"], "acceptance-summary.json", errors);
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
  const header = Object.freeze({
    bundleId: manifest.bundleId,
    runBindings: manifest.runBindings,
    backend: context.backend,
    sourceHash: manifest.sourceHash,
    buildRevision: manifest.buildRevision,
  });
  validateRouteEvidence(documents.get("route-runtime-evidence.json"), bundleDir, header, context, errors);
  const contractById = validateVisualContract(documents.get("visual-contract.json"), bundleDir, context, header, errors);
  const visualResultsById = validateVisualErrors(documents.get("visual-error-results.json"), bundleDir, context, header, contractById, errors);
  validateVisualReviews(documents.get("visual-reviews.json"), bundleDir, context, header, manifest.visualContract, visualResultsById, errors);
  validateTiming(documents.get("timing-trace.json"), header, context, errors);
  const resourceContext = validateResourceLedger(documents.get("resource-ledger.json"), header, context, errors);
  validateLifecycle(documents.get("lifecycle-evidence.json"), header, context, resourceContext, errors);
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
  let context = Object.freeze({
    runId: null,
    backend: null,
    captureFiles: new Map(),
    standardOutputFiles: new Map(),
    rasterComparisons: new Map(),
    sourceHash: null,
    buildRevision: null,
    captureProvenance: null,
  });

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
