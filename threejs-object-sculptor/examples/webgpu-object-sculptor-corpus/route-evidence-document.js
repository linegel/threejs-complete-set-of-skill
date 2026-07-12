import {
  CORPUS_IN_APP_ROUTE_PLAN,
  CORPUS_ROUTE_EVIDENCE_FILENAME,
} from "./route-evidence-plan.js";
import {
  CORPUS_CAPTURE_BUILD_REVISION,
  CORPUS_CAPTURE_SOURCE_HASH,
} from "./trusted-runtime-source-manifest.generated.js";

export const CORPUS_ROUTE_EVIDENCE_LAB_ID = "webgpu-object-sculptor-corpus";
export const CORPUS_ROUTE_EVIDENCE_TAR_FILENAME = "route-runtime-evidence.tar";
export const CORPUS_ROUTE_EVIDENCE_MAX_TAR_BYTES = 256 * 1024 * 1024;
const ROUTE_READBACK_PATH_PATTERN = /^route-readbacks\/(?:transport|normalized)\/(?:scenario|mechanism|tier|camera)-[a-z0-9]+(?:-[a-z0-9]+)*\.rgba8unorm\.bin$/;

function requireIdentifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new TypeError(`${label} must be 1-128 portable identifier characters`);
  }
  return value;
}

export function buildRouteEvidenceDocument({
  bundleId,
  runId,
  sourceHash = CORPUS_CAPTURE_SOURCE_HASH,
  buildRevision = CORPUS_CAPTURE_BUILD_REVISION,
  captureSession,
  routes,
} = {}) {
  requireIdentifier(bundleId, "bundleId");
  requireIdentifier(runId, "runId");
  if (typeof sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(sourceHash)) {
    throw new TypeError("sourceHash must be a lowercase SHA-256 digest");
  }
  if (buildRevision !== `source-sha256:${sourceHash}`) {
    throw new Error("buildRevision must bind the canonical capture source hash");
  }
  if (!captureSession || typeof captureSession !== "object" || Array.isArray(captureSession)) {
    throw new TypeError("captureSession must describe the physical-route collection surface");
  }
  if (captureSession.profile !== "physical-route" || captureSession.automationSurface !== "codex-in-app-browser") {
    throw new Error("captureSession must identify the Codex in-app Browser physical-route profile");
  }
  if (!new Set(["hardware", "software", "unknown"]).has(captureSession.adapterClass)) {
    throw new RangeError("captureSession adapterClass is invalid");
  }
  if (!captureSession.adapterIdentity || typeof captureSession.adapterIdentity !== "object") {
    throw new TypeError("captureSession adapterIdentity is required");
  }
  if (!captureSession.browser || typeof captureSession.browser !== "object") {
    throw new TypeError("captureSession browser identity is required");
  }
  if (captureSession.sourceClosureHash !== sourceHash || captureSession.buildRevision !== buildRevision) {
    throw new Error("captureSession source/build identity drifted from the evidence document");
  }
  const monotonic = (value, label) => {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || !Number.isFinite(value.value) || value.value < 0
      || value.unit !== "ms" || value.label !== "Measured"
      || typeof value.source !== "string" || value.source.length === 0) {
      throw new RangeError(`${label} must be a measured millisecond NumericDatum`);
    }
    return value.value;
  };
  const startedAtMonotonicMs = monotonic(captureSession.startedAtMonotonicMs, "captureSession.startedAtMonotonicMs");
  const finishedAtMonotonicMs = monotonic(captureSession.finishedAtMonotonicMs, "captureSession.finishedAtMonotonicMs");
  if (finishedAtMonotonicMs <= startedAtMonotonicMs) {
    throw new RangeError("captureSession monotonic interval is invalid");
  }
  const startedAtMs = Date.parse(captureSession.startedAt);
  const finishedAtMs = Date.parse(captureSession.finishedAt);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(finishedAtMs) || finishedAtMs < startedAtMs) {
    throw new RangeError("captureSession wall-clock interval is invalid");
  }
  if (!Array.isArray(routes) || routes.length !== CORPUS_IN_APP_ROUTE_PLAN.length) {
    throw new Error(`Route evidence requires exactly ${CORPUS_IN_APP_ROUTE_PLAN.length} records`);
  }
  const seen = new Set();
  for (let index = 0; index < CORPUS_IN_APP_ROUTE_PLAN.length; index += 1) {
    const expected = CORPUS_IN_APP_ROUTE_PLAN[index];
    const actual = routes[index];
    if (!actual || actual.routeId !== expected.routeId) {
      throw new Error(`Route evidence record ${index} must be ${expected.routeId}`);
    }
    if (seen.has(actual.routeId)) throw new Error(`Duplicate route evidence record ${actual.routeId}`);
    seen.add(actual.routeId);
    const artifacts = actual.readback?.artifacts;
    if (!artifacts || Object.keys(artifacts).sort().join(",") !== "normalized,transport") {
      throw new Error(`Route ${actual.routeId} must bind transport and normalized readback artifacts`);
    }
    if (artifacts.transport === artifacts.normalized || artifacts.transport.path === artifacts.normalized.path) {
      throw new Error(`Route ${actual.routeId} transport and normalized artifacts must not alias`);
    }
    const stem = `${actual.kind}-${actual.id}.rgba8unorm.bin`;
    const expectedArtifacts = {
      transport: {
        path: `route-readbacks/transport/${stem}`,
        layout: "renderer-transport-rgba8unorm-top-left",
        byteLength: actual.readback?.transportLayout?.byteLength,
        sha256: actual.readback?.transportSha256,
      },
      normalized: {
        path: `route-readbacks/normalized/${stem}`,
        layout: "cpu-normalized-zero-padded-rgba8unorm-top-left",
        byteLength: actual.readback?.normalizedArtifactLayout?.byteLength,
        sha256: actual.readback?.normalizedSha256,
      },
    };
    for (const [kind, expectedArtifact] of Object.entries(expectedArtifacts)) {
      const artifact = artifacts[kind];
      if (!ROUTE_READBACK_PATH_PATTERN.test(artifact.path)
        || artifact.path !== expectedArtifact.path
        || artifact.layout !== expectedArtifact.layout
        || artifact.mediaType !== "application/octet-stream"
        || artifact.byteLength !== expectedArtifact.byteLength
        || artifact.sha256 !== expectedArtifact.sha256
        || !/^[a-f0-9]{64}$/.test(artifact.sha256)) {
        throw new Error(`Route ${actual.routeId} ${kind} artifact identity/layout drifted`);
      }
    }
    if (actual.readback?.transportLayout?.retained !== true
      || actual.readback?.normalizedArtifactLayout?.retained !== true
      || actual.readback?.normalizedArtifactLayout?.independentAllocation !== true
      || actual.readback?.normalizedArtifactLayout?.paddingByteCount
        !== actual.readback?.normalizedArtifactLayout?.zeroPaddingByteCount) {
      throw new Error(`Route ${actual.routeId} did not retain independent transport and zero-padded normalized bytes`);
    }
    if (artifacts.transport.sha256 === artifacts.normalized.sha256
      && (actual.readback.normalizedArtifactLayout.paddingByteCount !== 0
        || artifacts.transport.byteLength !== artifacts.normalized.byteLength)) {
      throw new Error(`Route ${actual.routeId} falsely aliases distinct transport and normalized payloads`);
    }
  }
  const firstRoute = routes[0];
  const backend = Object.freeze({
    kind: firstRoute.runtime?.backend,
    nativeWebGPU: firstRoute.runtime?.nativeWebGPU,
    rendererType: firstRoute.runtime?.rendererType,
    backendType: firstRoute.runtime?.backendType,
    threeRevision: firstRoute.runtime?.threeRevision,
    outputColorSpace: firstRoute.pipeline?.descriptor?.outputColorSpace,
  });
  for (const route of routes) {
    const candidate = {
      kind: route.runtime?.backend,
      nativeWebGPU: route.runtime?.nativeWebGPU,
      rendererType: route.runtime?.rendererType,
      backendType: route.runtime?.backendType,
      threeRevision: route.runtime?.threeRevision,
      outputColorSpace: route.pipeline?.descriptor?.outputColorSpace,
    };
    if (JSON.stringify(candidate) !== JSON.stringify(backend)) {
      throw new Error(`Route ${route.routeId} backend fingerprint drifted within the evidence run`);
    }
  }
  const firstRendererBackend = firstRoute.runtime?.rendererBackendEvidence ?? {};
  const adapterIdentity = {
    source: firstRendererBackend.deviceIdentitySource ?? "renderer.backend.device-after-init",
    backendType: firstRendererBackend.backendType ?? firstRoute.runtime?.backendType ?? null,
    deviceType: firstRendererBackend.deviceType ?? null,
    deviceLabel: firstRendererBackend.deviceLabel ?? "",
    deviceIdentityVerified: firstRendererBackend.deviceIdentityVerified === true,
  };
  if (JSON.stringify(captureSession.adapterIdentity) !== JSON.stringify(adapterIdentity)) {
    throw new Error("captureSession adapter identity does not match the initialized renderer backend");
  }
  for (const route of routes) {
    const evidence = route.runtime?.rendererBackendEvidence ?? {};
    if (evidence.backendType !== adapterIdentity.backendType
      || evidence.deviceType !== adapterIdentity.deviceType
      || (evidence.deviceLabel ?? "") !== adapterIdentity.deviceLabel
      || evidence.deviceIdentityVerified !== true) {
      throw new Error(`Route ${route.routeId} adapter fingerprint drifted within the evidence run`);
    }
  }
  return Object.freeze({
    schemaVersion: 2,
    labId: CORPUS_ROUTE_EVIDENCE_LAB_ID,
    bundleId,
    runId,
    sourceHash,
    buildRevision,
    captureSession: Object.freeze({ ...captureSession }),
    backend,
    routes: Object.freeze([...routes]),
  });
}

export function routeEvidenceDownloadName() {
  return CORPUS_ROUTE_EVIDENCE_FILENAME;
}

function tarText(target, offset, length, value) {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength > length) throw new RangeError(`TAR field exceeds ${length} bytes: ${value}`);
  target.set(bytes, offset);
}

function tarOctal(target, offset, length, value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("TAR numeric fields must be nonnegative safe integers");
  const encoded = value.toString(8).padStart(length - 1, "0");
  if (encoded.length > length - 1) throw new RangeError("TAR numeric field overflowed");
  tarText(target, offset, length, `${encoded}\0`);
}

function tarEntry(path, bytes) {
  if (typeof path !== "string" || !/^[a-z0-9][a-z0-9._/-]*$/.test(path) || path.includes("..") || path.length > 99) {
    throw new TypeError(`Unsafe TAR artifact path "${path}"`);
  }
  const body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const paddedLength = Math.ceil(body.byteLength / 512) * 512;
  const entry = new Uint8Array(512 + paddedLength);
  tarText(entry, 0, 100, path);
  tarOctal(entry, 100, 8, 0o644);
  tarOctal(entry, 108, 8, 0);
  tarOctal(entry, 116, 8, 0);
  tarOctal(entry, 124, 12, body.byteLength);
  tarOctal(entry, 136, 12, 0);
  entry.fill(0x20, 148, 156);
  entry[156] = "0".charCodeAt(0);
  tarText(entry, 257, 6, "ustar\0");
  tarText(entry, 263, 2, "00");
  const checksum = entry.subarray(0, 512).reduce((sum, byte) => sum + byte, 0);
  const checksumText = checksum.toString(8).padStart(6, "0");
  tarText(entry, 148, 8, `${checksumText}\0 `);
  entry.set(body, 512);
  return entry;
}

export function buildRouteEvidenceTar({ evidenceJson, artifacts, maxBytes = CORPUS_ROUTE_EVIDENCE_MAX_TAR_BYTES } = {}) {
  if (typeof evidenceJson !== "string" || evidenceJson.length === 0) throw new TypeError("Evidence JSON is required for TAR export");
  if (!(artifacts instanceof Map)) throw new TypeError("Evidence TAR artifacts must be a Map");
  for (const [path, bytes] of artifacts) {
    if (!ROUTE_READBACK_PATH_PATTERN.test(path)) throw new TypeError(`Artifact path is outside the confined route-readback namespace: ${path}`);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new TypeError(`Artifact ${path} must contain byte data`);
  }
  let evidenceDocument;
  try {
    evidenceDocument = JSON.parse(evidenceJson);
  } catch (error) {
    throw new TypeError(`Evidence JSON cannot be parsed for TAR validation: ${error.message}`);
  }
  if (evidenceDocument?.schemaVersion !== 2
    || evidenceDocument.labId !== CORPUS_ROUTE_EVIDENCE_LAB_ID
    || !Array.isArray(evidenceDocument.routes)
    || evidenceDocument.routes.length !== CORPUS_IN_APP_ROUTE_PLAN.length) {
    throw new Error("Evidence TAR requires one validated schema-v2 record for every physical route");
  }
  const referencedArtifacts = new Map();
  for (const [index, route] of evidenceDocument.routes.entries()) {
    const expectedRoute = CORPUS_IN_APP_ROUTE_PLAN[index];
    if (route?.routeId !== expectedRoute.routeId
      || !route.readback?.artifacts
      || Object.keys(route.readback.artifacts).sort().join(",") !== "normalized,transport") {
      throw new Error(`Evidence TAR route ${index} does not bind the exact transport/normalized artifact pair`);
    }
    for (const representation of ["transport", "normalized"]) {
      const artifact = route.readback.artifacts[representation];
      if (!ROUTE_READBACK_PATH_PATTERN.test(artifact?.path)
        || !Number.isSafeInteger(artifact.byteLength)
        || artifact.byteLength <= 0
        || referencedArtifacts.has(artifact.path)) {
        throw new Error(`Evidence TAR ${route.routeId} ${representation} artifact reference is invalid or duplicated`);
      }
      referencedArtifacts.set(artifact.path, artifact);
    }
  }
  if (referencedArtifacts.size !== CORPUS_IN_APP_ROUTE_PLAN.length * 2
    || artifacts.size !== referencedArtifacts.size) {
    throw new Error(`Evidence TAR requires exactly ${CORPUS_IN_APP_ROUTE_PLAN.length * 2} referenced readback artifacts`);
  }
  for (const [path, reference] of referencedArtifacts) {
    const bytes = artifacts.get(path);
    if (!bytes || bytes.byteLength !== reference.byteLength) {
      throw new Error(`Evidence TAR artifact ${path} is missing or has the wrong byte length`);
    }
  }
  const entries = [tarEntry(CORPUS_ROUTE_EVIDENCE_FILENAME, new TextEncoder().encode(evidenceJson))];
  for (const [path, bytes] of [...artifacts.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    entries.push(tarEntry(path, bytes));
  }
  const totalBytes = entries.reduce((sum, entry) => sum + entry.byteLength, 1024);
  if (totalBytes > maxBytes) throw new RangeError(`Evidence TAR would exceed the ${maxBytes}-byte safety bound`);
  const tar = new Uint8Array(totalBytes);
  let offset = 0;
  for (const entry of entries) {
    tar.set(entry, offset);
    offset += entry.byteLength;
  }
  return tar;
}
