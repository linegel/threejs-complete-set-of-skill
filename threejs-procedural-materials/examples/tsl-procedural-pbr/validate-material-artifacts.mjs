import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import {
  DETERMINISTIC_REPLAY_GROUP,
  EXPECTED_MATERIAL_CAPTURES,
  assertBytesEqual,
  assertCaptureState,
  assertCoveredMaterialNormals,
  assertCurrentSourceIdentity,
  assertMaterialImageSemantics,
  assertRawAttachmentVisualization,
  compactCaptureTransport,
} from "./material-artifact-contract.mjs";
import { recomputeCaptureSourceClosure } from "./capture-hook.mjs";
import { unpackReadbackRows } from "./pbr-oracles.mjs";

const index = process.argv.indexOf("--artifacts");
const here = dirname(fileURLToPath(import.meta.url));
const artifacts = resolve(index >= 0
  ? process.argv[index + 1]
  : resolve(here, "../../../artifacts/visual-validation/tsl-procedural-pbr/correctness"));
const artifactsReal = realpathSync(artifacts);

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function artifactPath(relativePath) {
  assert.equal(typeof relativePath, "string", "artifact path must be a string");
  assert(!isAbsolute(relativePath), `artifact path must be relative: ${relativePath}`);
  const path = resolve(artifacts, relativePath);
  assert(path === artifacts || path.startsWith(`${artifacts}${sep}`), `artifact path escaped bundle: ${relativePath}`);
  assert(existsSync(path), `missing artifact ${relativePath}`);
  assert(!lstatSync(path).isSymbolicLink(), `artifact path is a symlink: ${relativePath}`);
  const real = realpathSync(path);
  assert(real === artifactsReal || real.startsWith(`${artifactsReal}${sep}`), `artifact realpath escaped bundle: ${relativePath}`);
  return path;
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(artifactPath(relativePath), "utf8"));
}

async function decodePng(relativePath, width, height) {
  const { data, info } = await sharp(artifactPath(relativePath))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.width, width, `${relativePath} decoded width mismatch`);
  assert.equal(info.height, height, `${relativePath} decoded height mismatch`);
  assert.equal(info.channels, 4, `${relativePath} must decode to RGBA8`);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function verifyHashedArtifact(reference, label) {
  assert(reference && typeof reference.path === "string" && typeof reference.sha256 === "string", `${label} reference is incomplete`);
  const bytes = readFileSync(artifactPath(reference.path));
  assert.equal(bytes.byteLength, reference.byteLength, `${label} byte length mismatch`);
  assert.equal(sha256(bytes), reference.sha256, `${label} hash mismatch`);
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

const session = readJson("capture-session.json");
const boundary = readJson("evidence-manifest.incomplete.json");
const currentClosure = recomputeCaptureSourceClosure();

assert.equal(session.schemaVersion, 2);
assert.equal(session.labId, "tsl-procedural-pbr");
assert.equal(session.profile, "correctness");
assert.equal(session.automationSurface, "playwright-headless-chromium");
assertCurrentSourceIdentity(session, boundary, currentClosure);
assert.equal(session.runtime?.metrics?.backendKind, "WebGPU");
assert.equal(session.runtime?.metrics?.nativeWebGPU, true);
assert.equal(session.runtime?.metrics?.initialized, true);
assert.equal(session.runtime?.metrics?.rendererType, "WebGPURenderer");
assert.equal(session.runtime?.metrics?.rendererBackendEvidence?.deviceIdentityVerified, true);
assert.equal(session.runtime?.metrics?.rendererBackendEvidence?.lossPromiseObservedOnActualDevice, true);
assert.equal(session.runtime?.metrics?.rendererDeviceStatus, "active");
assert.equal(session.finalRuntime?.pipeline?.finalToneMapOwner, "renderOutput");
assert.equal(session.finalRuntime?.pipeline?.finalOutputTransformOwner, "renderOutput");
assert.equal(session.finalRuntime?.pipeline?.outputColorTransformDisabledOnPipeline, true);
assert.equal(boundary.schemaVersion, 2);
assert.equal(boundary.status, "incomplete");
assert.equal(boundary.publishable, false);
assert(Object.values(boundary.claims).every((verdict) => verdict === "INSUFFICIENT_EVIDENCE"));
assert.deepEqual(boundary.deterministicReplayGroups, [DETERMINISTIC_REPLAY_GROUP]);

const expectedNames = Object.keys(EXPECTED_MATERIAL_CAPTURES);
assert.equal(boundary.captures.length, expectedNames.length, "capture count drifted");
assert.deepEqual(boundary.captures.map(({ filename }) => filename), expectedNames, "capture order or names drifted");

const decodedByName = new Map();
const compactHashByName = new Map();
for (const [sequenceIndex, capture] of boundary.captures.entries()) {
  assert.equal(capture.sequenceIndex, sequenceIndex, `${capture.filename} sequence index drifted`);
  assertCaptureState(capture);
  assert.equal(capture.bytesPerPixel, 4);
  const compactBytesPerRow = capture.width * capture.bytesPerPixel;
  assert.equal(capture.bytesPerRow, compactBytesPerRow, `${capture.filename} compact row mismatch`);
  assert(Number.isInteger(capture.sourceBytesPerRow) && capture.sourceBytesPerRow >= compactBytesPerRow);
  if (capture.sourceBytesPerRow !== compactBytesPerRow) {
    assert.equal(capture.sourceBytesPerRow % 256, 0, `${capture.filename} padded transport is not WebGPU aligned`);
  }
  const shortTransportBytes = capture.sourceBytesPerRow * (capture.height - 1) + compactBytesPerRow;
  const fullTransportBytes = capture.sourceBytesPerRow * capture.height;
  assert(
    capture.sourceByteLength === shortTransportBytes || capture.sourceByteLength === fullTransportBytes,
    `${capture.filename} source byte length is inconsistent`,
  );
  assert.equal(capture.transportByteLength, capture.sourceByteLength);
  assert.equal(capture.transport?.layout?.rowBytes, compactBytesPerRow);
  assert.equal(capture.transport?.layout?.bytesPerRow, capture.sourceBytesPerRow);
  assert.equal(capture.transport?.layout?.byteLength, capture.sourceByteLength);
  assert.equal(capture.transport?.rendererCopy?.rawBytesRetained, true);
  assert.equal(capture.transport?.rendererCopy?.requestedLayout?.alignmentBytes, 256);

  const transportBytes = verifyHashedArtifact(capture.transport.artifact, `${capture.filename} transport`);
  const compact = compactCaptureTransport(capture, transportBytes);
  assert.equal(sha256(compact), capture.normalized?.compactRgbaSha256, `${capture.filename} compact hash mismatch`);
  const normalizedBytes = verifyHashedArtifact(capture.normalized.artifact, `${capture.filename} normalized padded`);
  assert.equal(capture.normalized.bytesPerRow % 256, 0);
  assert.equal(capture.normalized.byteLength, capture.normalized.bytesPerRow * capture.height);
  const normalizedCompact = unpackReadbackRows({
    bytes: normalizedBytes,
    width: capture.width,
    height: capture.height,
    bytesPerPixel: 4,
    bytesPerRow: capture.normalized.bytesPerRow,
  });
  assertBytesEqual(normalizedCompact, compact, `${capture.filename} normalized/transport pixels`);

  const pngBytes = readFileSync(artifactPath(capture.filename));
  assert.equal(sha256(pngBytes), capture.png?.sha256, `${capture.filename} PNG hash mismatch`);
  const decoded = await decodePng(capture.filename, capture.width, capture.height);
  assertBytesEqual(decoded, compact, `${capture.filename} PNG/retained pixels`);
  assert.equal(capture.png?.derivedFromCompactRgbaSha256, sha256(decoded), `${capture.filename} PNG derivation hash mismatch`);
  assertMaterialImageSemantics(capture.filename, decoded, capture.width, capture.height);

  const expectsRaw = new Set([
    "material-albedo",
    "material-params",
    "material-normal",
    "material-footprint",
    "material-normal-variance",
    "raw-emissive",
  ]).has(capture.target);
  assert.equal(Boolean(capture.rawAttachment), expectsRaw, `${capture.filename} raw attachment classification drifted`);
  if (capture.rawAttachment) {
    const rawBytes = verifyHashedArtifact(capture.rawAttachment.artifact, `${capture.filename} raw MRT`);
    assert.equal(capture.rawAttachment.textureName.length > 0, true);
    assert.equal(capture.rawAttachment.textureUuid.length > 0, true);
    assertRawAttachmentVisualization(capture, rawBytes, decoded);
  }

  decodedByName.set(capture.filename, decoded);
  compactHashByName.set(capture.filename, sha256(compact));
}

const replayHash = compactHashByName.get(DETERMINISTIC_REPLAY_GROUP[0]);
for (const filename of DETERMINISTIC_REPLAY_GROUP.slice(1)) {
  assert.equal(compactHashByName.get(filename), replayHash, `${filename} failed deterministic replay equivalence`);
}
for (const [left, right] of [
  ["final.design.png", "no-post.design.png"],
  ["final.design.png", "diagnostics.mosaic.png"],
  ["material-albedo.png", "material-params.png"],
  ["material-normal.png", "material-normal-variance.png"],
  ["seed-0001.final.png", "seed-9e3779b9.final.png"],
  ["temporal.t000.png", "temporal.t001.png"],
]) {
  assert.notEqual(compactHashByName.get(left), compactHashByName.get(right), `${left} must differ from ${right}`);
}

assertCoveredMaterialNormals({
  normalPixels: decodedByName.get("material-normal.png"),
  albedoPixels: decodedByName.get("material-albedo.png"),
  width: boundary.captures[0].width,
  height: boundary.captures[0].height,
});

const resources = session.finalRuntime?.resources;
assert(resources, "final runtime resource inventory is missing");
const resourceIds = new Set(resources.resources.map(({ id }) => id));
for (const id of [
  "material-color-atlas",
  "material-color-array",
  "material-triplanar-map",
  "scene-mrt-0",
  "scene-mrt-1",
  "scene-depth",
  "diagnostic-identity-depth",
  "diagnostic-surface-depth",
  "instance-dissolve",
  "instance-variant",
  "directional-shadow-color",
  "directional-shadow-depth",
]) assert(resourceIds.has(id), `runtime resource inventory omitted ${id}`);
assert.equal(resources.diagnosticMrtPasses.find(({ id }) => id === "identity")?.attachmentCount, 3);
assert.equal(resources.diagnosticMrtPasses.find(({ id }) => id === "surface")?.attachmentCount, 4);
assert.equal(resources.passDepthTargets.length, 3);
assert.equal(resources.storageAllocations.length, 2);
assert.equal(resources.activeStorageBindingBytes, 0);
assert(resources.storageAllocations.every(({ runtimeIdentity, byteCount }) => runtimeIdentity && byteCount > 0));
assert(resources.captureTransientSummary.createdCount > 0);
assert.equal(resources.captureTransientSummary.activeCount, 0);
assert.equal(resources.captureTransientSummary.createdCount, resources.captureTransientSummary.disposedCount);
assert(resources.captureTransients.every(({ targetUuid, textureUuid, active, disposedAtFrame }) => (
  targetUuid && textureUuid && active === false && Number.isInteger(disposedAtFrame)
)));
assert.equal(resources.physicalResidencyVerdict, "INSUFFICIENT_EVIDENCE");

assert.equal(session.postDisposeSnapshot?.labError ?? null, null, "post-disposal lab error was recorded");
assert.equal(session.pageErrors.length, 0);
assert.equal(session.consoleErrors.length, 0);
assert.equal(session.requestErrors.length, 0);

console.log(JSON.stringify({
  pass: true,
  status: "incomplete",
  publishable: false,
  sourceHash: currentClosure.sourceHash,
  buildRevision: currentClosure.buildRevision,
  captureCount: boundary.captures.length,
  rawAttachmentCount: boundary.captures.filter(({ rawAttachment }) => rawAttachment).length,
  reason: boundary.reason,
}, null, 2));
