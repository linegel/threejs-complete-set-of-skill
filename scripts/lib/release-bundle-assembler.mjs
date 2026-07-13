import { createHash } from 'node:crypto';
import {
  existsSync,
} from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  join,
  resolve,
} from 'node:path';

import {
  canonicalSha256,
  createReleasePromotionBinding,
  NORMATIVE_JSON_PATHS,
  routeStateDigest,
  STANDARD_IMAGE_PATHS,
} from './evidence-manifest-contract.mjs';
import { validateEvidenceLaneJoin } from './evidence-lane-join.mjs';
import { validateEvidenceBundle } from './evidence-v2.mjs';
import { validatePhysicalReviewRecord } from './physical-review-record.mjs';

function requireObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function binding(path, bytes, kind) {
  return { kind, path, sha256: sha256(bytes), byteLength: bytes.byteLength };
}

function capturedFile(reference) {
  return { path: reference.path, status: 'captured', kind: reference.kind, sha256: reference.sha256, byteLength: reference.byteLength };
}

function identity(kind, value) {
  return { kind, digest: canonicalSha256(value) };
}

function normalizedSeed(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('physical review seed is not an unsigned 32-bit integer');
  return `0x${(seed >>> 0).toString(16).padStart(8, '0')}`;
}

function validatePhysicalRoute(record, route) {
  const locked = requireObject(record.route?.lockedState, 'physical review locked state');
  const observed = requireObject(record.route?.observedState, 'physical review observed state');
  for (const field of ['scenario', 'mechanism', 'mode', 'tier', 'camera']) {
    if (route[field] !== locked[field] || route[field] !== observed[field]) throw new Error(`physical release route ${field} differs from the reviewed locked state`);
  }
  if (route.seed !== normalizedSeed(locked.seed) || route.seed !== normalizedSeed(observed.seed)) {
    throw new Error('physical release route seed differs from the reviewed locked state');
  }
  if (route.stateDigest !== routeStateDigest(route)) throw new Error('physical release route state digest is invalid');
}

function physicalSessionReference({ wrapper, route, document, writeLedger }) {
  const record = requireObject(wrapper.record, 'physical review record');
  validatePhysicalReviewRecord(record);
  if (wrapper.validation?.valid !== true || wrapper.recordSha256 !== canonicalSha256(record)) throw new Error('physical review wrapper is invalid or stale');
  validatePhysicalRoute(record, route);
  return {
    sessionId: `${record.labId}:physical-route:${record.sourceClosureHash.slice('sha256:'.length, 'sha256:'.length + 16)}`,
    profile: 'physical-route',
    automationSurface: 'codex-in-app-browser',
    adapterClass: record.adapter.adapterClass,
    adapterIdentity: identity('gpu-adapter', record.adapter.identity),
    deviceIdentity: identity('gpu-device', { adapter: record.adapter.identity, backend: record.runtime.backend }),
    browserIdentity: identity('browser', record.browser),
    osIdentity: identity('operating-system', { platform: record.browser.platform }),
    refreshIdentity: identity('display-refresh', { status: 'not-claimed-by-physical-route-review' }),
    colorIdentity: identity('color-pipeline', { status: 'reviewed-presentation-pixels', viewport: record.viewport }),
    limitationsDigest: canonicalSha256(record.limitations),
    threeRevision: record.threeRevision,
    sourceClosureHash: record.sourceClosureHash,
    buildRevision: record.buildRevision,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    routePath: route.path,
    routeDigest: canonicalSha256(route),
    stateDigest: route.stateDigest,
    document,
    writeLedger,
    rendererInitialized: record.runtime.initialized,
    isWebGPUBackend: record.runtime.backend.isWebGPUBackend,
    timestampQuerySupported: false,
  };
}

function pendingSignoff() {
  return {
    status: 'PENDING',
    reviewer: null,
    reviewedAt: null,
    reviewDigest: null,
    reviewedImages: [],
    notes: [],
  };
}

function orderByRequiredPrefix(entries, requiredPaths, label) {
  const index = new Map(entries.map((entry) => [entry.path, entry]));
  const prefix = requiredPaths.map((path) => {
    const entry = index.get(path);
    if (!entry) throw new Error(`${label} is missing required entry ${path}`);
    index.delete(path);
    return entry;
  });
  return [...prefix, ...[...index.values()].sort((left, right) => left.path.localeCompare(right.path))];
}

async function sourceArtifactPath(directory, path) {
  const direct = join(directory, path);
  if (existsSync(direct)) return direct;
  const image = join(directory, 'images', path);
  if (existsSync(image)) return image;
  throw new Error(`source evidence artifact is missing: ${path}`);
}

async function readBoundArtifact(sourceDirectory, entry) {
  const source = await sourceArtifactPath(sourceDirectory, entry.path);
  const bytes = await readFile(source);
  if (bytes.byteLength !== entry.byteLength || sha256(bytes) !== entry.sha256) throw new Error(`source evidence artifact drifted: ${entry.path}`);
  return bytes;
}

async function copyBoundArtifact(sourceDirectory, stagingDirectory, entry, projectedBytes = null) {
  const bytes = projectedBytes ?? await readBoundArtifact(sourceDirectory, entry);
  const destination = join(stagingDirectory, entry.path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes, { flag: 'wx' });
}

async function createArtifactProjections({ correctnessDirectory, rawManifest, laneJoin, projectEvidenceArtifacts }) {
  if (projectEvidenceArtifacts === null) return new Map();
  if (typeof projectEvidenceArtifacts !== 'function') throw new TypeError('projectEvidenceArtifacts must be a function or null');
  const projectablePaths = new Set(NORMATIVE_JSON_PATHS.filter((path) => path !== 'evidence-manifest.json'));
  const capturedFiles = new Map(rawManifest.files
    .filter((entry) => entry.status === 'captured')
    .map((entry) => [entry.path, entry]));
  const artifacts = {};
  const artifactBindings = {};
  for (const path of projectablePaths) {
    const entry = capturedFiles.get(path);
    if (!entry) continue;
    const bytes = await readBoundArtifact(correctnessDirectory, entry);
    try {
      artifacts[path] = JSON.parse(bytes);
    } catch (error) {
      throw new Error(`projectable evidence artifact is not valid JSON: ${path}`, { cause: error });
    }
    artifactBindings[path] = {
      canonicalJson: bytes.toString('utf8'),
      ledgerEntry: structuredClone(entry),
    };
  }
  const projected = await projectEvidenceArtifacts(deepFreeze({
    artifacts,
    artifactBindings,
    rawManifest: structuredClone(rawManifest),
    laneJoin: structuredClone(laneJoin),
  }));
  requireObject(projected, 'projected evidence artifacts');
  const replacements = new Map();
  for (const [path, artifact] of Object.entries(projected)) {
    if (!projectablePaths.has(path)) throw new Error(`evidence projection cannot replace ${path}`);
    const original = capturedFiles.get(path);
    if (!original) throw new Error(`evidence projection cannot create missing artifact ${path}`);
    requireObject(artifact, `projected evidence artifact ${path}`);
    if (artifact.schemaVersion !== 2) throw new Error(`projected evidence artifact ${path} must use schemaVersion 2`);
    const bytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`);
    replacements.set(path, {
      bytes,
      entry: {
        ...structuredClone(original),
        sha256: sha256(bytes),
        byteLength: bytes.byteLength,
      },
    });
  }
  return replacements;
}

export async function assemblePendingReleaseBundle({
  correctnessDirectory,
  physicalReviewPath,
  servedLedgerPath,
  laneJoinPath,
  outputDirectory,
  physicalRoute,
  limitations,
  projectEvidenceArtifacts = null,
}) {
  if (existsSync(outputDirectory)) throw new Error(`release output already exists: ${outputDirectory}`);
  const correctness = validateEvidenceBundle(correctnessDirectory);
  if (!correctness.valid || correctness.manifest?.bundleKind !== 'raw-capture-session') {
    throw new AggregateError(correctness.errors.map((message) => new Error(message)), 'correctness input is not a valid raw capture bundle');
  }
  const raw = correctness.manifest;
  const physicalBytes = await readFile(physicalReviewPath);
  const physicalWrapper = JSON.parse(physicalBytes);
  const servedBytes = await readFile(servedLedgerPath);
  const servedLedger = JSON.parse(servedBytes);
  const laneJoinBytes = await readFile(laneJoinPath);
  const laneJoin = JSON.parse(laneJoinBytes);
  validateEvidenceLaneJoin(laneJoin);
  const { joinSha256, ...laneJoinBody } = laneJoin;
  if (joinSha256 !== canonicalSha256(laneJoinBody)) throw new Error('lane join canonical hash is invalid');
  if (laneJoin.labId !== raw.labId || laneJoin.sourceClosureHash !== raw.sourceClosureHash || laneJoin.buildRevision !== raw.buildRevision) {
    throw new Error('lane join identity differs from the correctness bundle');
  }
  if (physicalWrapper.record?.labId !== raw.labId
    || physicalWrapper.record?.sourceClosureHash !== raw.sourceClosureHash
    || physicalWrapper.record?.buildRevision !== raw.buildRevision) {
    throw new Error('physical review identity differs from the correctness bundle');
  }
  const correctnessSession = raw.captureSessions[0];
  if (laneJoin.lanes.correctness.sessionId !== correctnessSession.sessionId
    || laneJoin.lanes.correctness.documentSha256 !== correctnessSession.document.sha256
    || laneJoin.lanes.correctness.writeLedgerSha256 !== correctnessSession.writeLedger.sha256
    || laneJoin.lanes.correctness.routeDigest !== correctnessSession.routeDigest
    || laneJoin.lanes.correctness.stateDigest !== correctnessSession.stateDigest) {
    throw new Error('lane join correctness reference differs from the raw capture session');
  }
  if (laneJoin.lanes.physicalRoute.recordSha256 !== physicalWrapper.recordSha256
    || laneJoin.lanes.physicalRoute.routeDigest !== canonicalSha256(physicalWrapper.record.route)
    || laneJoin.lanes.physicalRoute.servedLedgerSha256 !== physicalWrapper.record.immutableBuild.servedLedgerHash
    || servedLedger.ledgerSha256 !== physicalWrapper.record.immutableBuild.servedLedgerHash) {
    throw new Error('lane join physical reference differs from the reviewed record or served ledger');
  }
  const artifactProjections = await createArtifactProjections({
    correctnessDirectory,
    rawManifest: raw,
    laneJoin,
    projectEvidenceArtifacts,
  });
  const route = structuredClone(physicalRoute);
  route.stateDigest = routeStateDigest(route);
  const releaseLimitations = structuredClone(limitations);
  const parent = resolve(dirname(outputDirectory));
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, `.${basename(outputDirectory)}.staging-`));

  for (const entry of raw.files) {
    if (entry.status !== 'captured') continue;
    await copyBoundArtifact(correctnessDirectory, staging, entry, artifactProjections.get(entry.path)?.bytes ?? null);
  }
  for (const entry of raw.images) if (entry.status === 'captured') await copyBoundArtifact(correctnessDirectory, staging, entry);

  const physicalDocument = binding('sessions/physical-route.capture-session.json', physicalBytes, 'capture-session-document');
  const physicalLedger = binding('sessions/physical-route.write-ledger.json', servedBytes, 'capture-session-write-ledger');
  const joinedLedger = binding('lane-join.json', laneJoinBytes, 'supplementary-json');
  for (const [reference, bytes] of [[physicalDocument, physicalBytes], [physicalLedger, servedBytes], [joinedLedger, laneJoinBytes]]) {
    const destination = join(staging, reference.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: 'wx' });
  }
  const physicalSession = physicalSessionReference({
    wrapper: physicalWrapper,
    route,
    document: physicalDocument,
    writeLedger: physicalLedger,
  });
  const routeSet = raw.route.path === route.path && raw.route.stateDigest === route.stateDigest
    ? [structuredClone(raw.route)]
    : [structuredClone(raw.route), route];
  const projectedFiles = raw.files.map((entry) => artifactProjections.get(entry.path)?.entry ?? structuredClone(entry));
  const manifest = {
    ...structuredClone(raw),
    bundleId: `${raw.labId}:release:${raw.sourceClosureHash.slice('sha256:'.length, 'sha256:'.length + 16)}:v2`,
    bundleKind: 'release-bundle',
    publishable: false,
    routeSet,
    limitations: releaseLimitations,
    claimVerdicts: structuredClone(laneJoin.claimVerdicts),
    captureSessions: [structuredClone(raw.captureSessions[0]), physicalSession],
    files: orderByRequiredPrefix([
      ...projectedFiles,
      capturedFile(physicalDocument),
      capturedFile(physicalLedger),
      capturedFile(joinedLedger),
    ], NORMATIVE_JSON_PATHS, 'release file ledger'),
    images: orderByRequiredPrefix(structuredClone(raw.images), STANDARD_IMAGE_PATHS, 'release image ledger'),
    promotion: null,
  };
  const bindingValue = createReleasePromotionBinding(manifest);
  manifest.promotion = {
    status: 'PENDING_VISUAL_SIGNOFF',
    binding: bindingValue,
    bindingDigest: canonicalSha256(bindingValue),
    visualSignoff: pendingSignoff(),
  };
  await writeFile(join(staging, 'evidence-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  const validation = validateEvidenceBundle(staging);
  if (!validation.valid) {
    throw new AggregateError(validation.errors.map((message) => new Error(message)), `release candidate validation failed; retained staging directory ${staging}`);
  }
  await rename(staging, outputDirectory);
  return Object.freeze({ outputDirectory, manifest, validation });
}
