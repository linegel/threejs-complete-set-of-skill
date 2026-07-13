import { canonicalSha256 } from './evidence-manifest-contract.mjs';
import { validatePhysicalReviewRecord } from './physical-review-record.mjs';

const SHA256 = /^sha256:[a-f0-9]{64}$/;

function requireObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function requireHash(value, label) {
  if (!SHA256.test(value ?? '')) throw new TypeError(`${label} must be a SHA-256 digest`);
  return value;
}

function correctnessReference(manifest) {
  if (manifest.bundleKind !== 'raw-capture-session' || manifest.publishable !== false) {
    throw new Error('lane join requires a finalized nonpublishable raw correctness manifest');
  }
  const session = manifest.captureSessions?.find((entry) => entry.profile === 'correctness');
  if (!session || session.automationSurface !== 'playwright-headless-chromium' || session.isWebGPUBackend !== true) {
    throw new Error('lane join lacks a native-WebGPU Playwright correctness session');
  }
  if (!['hardware', 'software', 'unknown'].includes(session.adapterClass)) throw new Error('correctness adapter class is invalid');
  return Object.freeze({
    lane: 'correctness',
    profile: session.profile,
    automationSurface: session.automationSurface,
    adapterClass: session.adapterClass,
    sessionId: session.sessionId,
    sourceClosureHash: session.sourceClosureHash,
    buildRevision: session.buildRevision,
    threeRevision: session.threeRevision,
    documentSha256: session.document?.sha256,
    writeLedgerSha256: session.writeLedger?.sha256,
    routeDigest: session.routeDigest,
    stateDigest: session.stateDigest,
  });
}

function physicalReference(wrapper) {
  requireObject(wrapper, 'physical review wrapper');
  const record = requireObject(wrapper.record, 'physical review record');
  validatePhysicalReviewRecord(record);
  if (wrapper.validation?.valid !== true || wrapper.recordSha256 !== canonicalSha256(record)) {
    throw new Error('physical review wrapper is stale or invalid');
  }
  if (record.adapter?.adapterClass !== 'hardware') throw new Error('physical review lane requires named hardware');
  return Object.freeze({
    lane: 'physical-route',
    profile: record.profile,
    automationSurface: record.automationSurface,
    adapterClass: record.adapter.adapterClass,
    recordSha256: wrapper.recordSha256,
    servedLedgerSha256: record.immutableBuild.servedLedgerHash,
    sourceClosureHash: record.sourceClosureHash,
    buildRevision: record.buildRevision,
    threeRevision: record.threeRevision,
    routeDigest: canonicalSha256(record.route),
    reviewDigest: canonicalSha256(record.review),
  });
}

export function validateEvidenceLaneJoin(join) {
  requireObject(join, 'evidence lane join');
  if (join.schemaVersion !== 1 || join.kind !== 'evidence-lane-join-v1' || join.publishable !== false) {
    throw new Error('evidence lane join schema identity is invalid');
  }
  requireHash(join.sourceClosureHash, 'sourceClosureHash');
  requireHash(join.buildRevision, 'buildRevision');
  if (join.threeRevision !== '0.185.1') throw new Error('evidence lane join has the wrong Three revision');
  const correctness = requireObject(join.lanes?.correctness, 'correctness lane');
  const physical = requireObject(join.lanes?.physicalRoute, 'physical-route lane');
  if (correctness.lane !== 'correctness' || correctness.automationSurface !== 'playwright-headless-chromium') {
    throw new Error('correctness lane is swapped');
  }
  if (!['hardware', 'software', 'unknown'].includes(correctness.adapterClass)) throw new Error('correctness lane adapter class is invalid');
  if (physical.lane !== 'physical-route' || physical.automationSurface !== 'codex-in-app-browser' || physical.adapterClass !== 'hardware') {
    throw new Error('physical route lane is swapped or not hardware');
  }
  for (const lane of [correctness, physical]) {
    if (lane.sourceClosureHash !== join.sourceClosureHash || lane.buildRevision !== join.buildRevision || lane.threeRevision !== join.threeRevision) {
      throw new Error('evidence lanes cross source, build, or Three revision boundaries');
    }
  }
  if (join.performanceClaims === false) {
    if (join.lanes.performance !== null || join.claimVerdicts.performanceCompliance !== 'NOT_CLAIMED'
      || join.claimVerdicts.gpuAttribution !== 'NOT_CLAIMED') {
      throw new Error('two-lane join must keep performance and GPU timing unclaimed');
    }
  } else if (!join.lanes.performance) throw new Error('performance claims require a third lane');
  if (join.claimVerdicts.visualCorrectness !== 'PASS'
    || join.claimVerdicts.mechanismCorrectness !== 'PASS'
    || join.claimVerdicts.lifecycleStability !== 'PASS'
    || join.claimVerdicts.visualError !== 'PASS') {
    throw new Error('evidence lane join lacks a required passing non-performance claim');
  }
  if (join.status !== 'READY_FOR_RELEASE_PROMOTION_REVIEW') throw new Error('evidence lane join status is invalid');
  return Object.freeze({
    valid: true,
    labId: join.labId,
    laneCount: join.performanceClaims ? 3 : 2,
    performanceClaims: join.performanceClaims,
  });
}

export function createEvidenceLaneJoin({ rawManifest, physicalReview, performance = null }) {
  const manifest = requireObject(rawManifest, 'raw evidence manifest');
  const correctness = correctnessReference(manifest);
  const physicalRoute = physicalReference(physicalReview);
  if (manifest.sourceClosureHash !== correctness.sourceClosureHash
    || manifest.buildRevision !== correctness.buildRevision
    || manifest.threeRevision !== correctness.threeRevision) {
    throw new Error('raw manifest identity differs from its correctness session');
  }
  if (physicalRoute.sourceClosureHash !== manifest.sourceClosureHash
    || physicalRoute.buildRevision !== manifest.buildRevision
    || physicalRoute.threeRevision !== manifest.threeRevision) {
    throw new Error('physical review identity differs from correctness');
  }
  const performanceClaims = performance !== null;
  if (!performanceClaims && (manifest.claimVerdicts.performanceCompliance !== 'NOT_CLAIMED'
    || manifest.claimVerdicts.gpuAttribution !== 'NOT_CLAIMED')) {
    throw new Error('missing performance lane cannot satisfy claimed performance or GPU timing');
  }
  const join = {
    schemaVersion: 1,
    kind: 'evidence-lane-join-v1',
    labId: manifest.labId,
    sourceClosureHash: manifest.sourceClosureHash,
    buildRevision: manifest.buildRevision,
    threeRevision: manifest.threeRevision,
    publishable: false,
    performanceClaims,
    lanes: {
      correctness,
      physicalRoute,
      performance,
    },
    claimVerdicts: {
      ...manifest.claimVerdicts,
      visualCorrectness: physicalReview.record.claimVerdicts.visualCorrectness,
    },
    limitations: [
      ...manifest.limitations,
      ...physicalReview.record.limitations,
    ],
    status: 'READY_FOR_RELEASE_PROMOTION_REVIEW',
  };
  validateEvidenceLaneJoin(join);
  return Object.freeze({
    ...join,
    joinSha256: canonicalSha256(join),
  });
}
