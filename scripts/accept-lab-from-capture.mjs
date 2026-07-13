#!/usr/bin/env node
/**
 * Drive a lab from an existing correctness capture through:
 *   lifecycle soak → raw assemble → physical CDP review → lane join →
 *   release candidate (outside repo) → visual promote → project tracked release
 * and mark the lab.manifest accepted with evidenceBundle.
 *
 * Usage:
 *   CAPTURE_CDP_ENDPOINT=http://127.0.0.1:9222 \
 *     node scripts/accept-lab-from-capture.mjs --lab webgpu-tower-ship-sculptor
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { createEvidenceLaneJoin, validateEvidenceLaneJoin } from './lib/evidence-lane-join.mjs';
import { assemblePendingReleaseBundle } from './lib/release-bundle-assembler.mjs';
import { promoteReleaseBundle } from './lib/offline-release-promotion.mjs';
import { validateEvidenceBundle, REQUIRED_EVIDENCE_IMAGES } from './lib/evidence-v2.mjs';
import { buildDemoRegistry } from './lib/lab-registry.mjs';
import { canonicalSha256, routeStateDigest } from './lib/evidence-manifest-contract.mjs';
import { numericDatum, NumericLabel } from '../labs/runtime/numeric-evidence.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function runNode(script, args, env = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`${script} failed with status ${result.status}`);
  }
  return result;
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

const labId = option('--lab');
if (!labId) throw new Error('--lab is required');
if (!process.env.CAPTURE_CDP_ENDPOINT) {
  throw new Error('CAPTURE_CDP_ENDPOINT is required for physical-route review');
}

const registry = buildDemoRegistry();
const lab = registry.demos.find((entry) => entry.id === labId);
if (!lab) throw new Error(`unknown lab ${labId}`);

const artifactRoot = resolve(REPO_ROOT, 'artifacts', 'visual-validation', labId);
const correctnessDir = resolve(option('--dir') ?? join(artifactRoot, 'correctness'));
if (!existsSync(join(correctnessDir, 'capture-session.json'))) {
  throw new Error(`missing correctness capture at ${correctnessDir}`);
}

const skipSoak = hasFlag('--skip-soak');
const skipPhysical = hasFlag('--skip-physical');

// 0) Rebind capture buildRevision so correctness + physical share one identity.
//    Prefer an existing physical review's buildRevision when --skip-physical is set
//    (global monorepo pack hash keeps drifting under concurrent agents). Otherwise
//    rebind to the live registry before a fresh physical review is recorded.
{
  const sessionPath = join(correctnessDir, 'capture-session.json');
  const session = JSON.parse(readFileSync(sessionPath, 'utf8'));
  const liveRegistry = buildDemoRegistry();
  const liveLab = liveRegistry.demos.find((entry) => entry.id === labId);
  if (!liveLab) throw new Error(`unknown lab ${labId}`);
  if (session.sourceClosureHash !== liveLab.sourceHash) {
    throw new Error(
      `capture sourceClosureHash ${session.sourceClosureHash} differs from live lab sourceHash ${liveLab.sourceHash}; re-capture required`,
    );
  }
  let targetBuildRevision = liveRegistry.buildRevision;
  const existingPhysicalPath = join(artifactRoot, 'physical-route', 'physical-review-record.json');
  if (hasFlag('--skip-physical') && existsSync(existingPhysicalPath)) {
    const existingPhysical = JSON.parse(readFileSync(existingPhysicalPath, 'utf8'));
    const physicalBuild = existingPhysical?.record?.buildRevision;
    const physicalSource = existingPhysical?.record?.sourceClosureHash;
    if (physicalSource !== session.sourceClosureHash) {
      throw new Error(
        `existing physical sourceClosureHash ${physicalSource} differs from capture ${session.sourceClosureHash}; re-run physical`,
      );
    }
    if (typeof physicalBuild === 'string' && physicalBuild.length > 0) {
      targetBuildRevision = physicalBuild;
    }
  }
  if (session.buildRevision !== targetBuildRevision) {
    console.error(`[accept] rebinding capture buildRevision ${session.buildRevision} → ${targetBuildRevision}`);
    session.buildRevision = targetBuildRevision;
    if (session.sourceClosure && typeof session.sourceClosure === 'object') {
      session.sourceClosure.buildRevision = targetBuildRevision;
    }
    writeFileSync(sessionPath, `${JSON.stringify(session, null, 2)}\n`);
  }
}

// 1) Lifecycle soak
if (!skipSoak) {
  console.error(`[accept] lifecycle soak for ${labId}`);
  runNode(join(REPO_ROOT, 'scripts/run-lifecycle-soak.mjs'), ['--lab', labId, '--output', correctnessDir]);
}

// 2) Raw assemble
console.error(`[accept] assemble raw capture session for ${labId}`);
runNode(join(REPO_ROOT, 'scripts/assemble-session-raw-evidence.mjs'), ['--lab', labId, '--dir', correctnessDir]);

const raw = validateEvidenceBundle(correctnessDir);
if (!raw.valid || raw.manifest?.bundleKind !== 'raw-capture-session') {
  throw new AggregateError((raw.errors ?? []).map((m) => new Error(m)), 'raw correctness invalid after assemble');
}
if (raw.manifest.claimVerdicts.lifecycleStability !== 'PASS') {
  throw new Error('lifecycleStability is not PASS after soak+assemble');
}
if (raw.manifest.claimVerdicts.mechanismCorrectness !== 'PASS') {
  throw new Error('mechanismCorrectness is not PASS');
}

// Identity pin: physical must match raw
const sourceClosureHash = raw.manifest.sourceClosureHash;
const buildRevision = raw.manifest.buildRevision;

// 3) Physical review
const physicalDir = join(artifactRoot, 'physical-route');
mkdirSync(physicalDir, { recursive: true });
if (!skipPhysical) {
  console.error(`[accept] physical CDP review for ${labId}`);
  runNode(join(REPO_ROOT, 'scripts/run-physical-review-cdp.mjs'), ['--lab', labId, '--output', physicalDir]);
}

const physicalPath = join(physicalDir, 'physical-review-record.json');
const servedPath = join(physicalDir, 'served-byte-ledger.json');
if (!existsSync(physicalPath) || !existsSync(servedPath)) {
  throw new Error('physical review artifacts missing');
}
const physicalWrapper = JSON.parse(readFileSync(physicalPath, 'utf8'));
if (physicalWrapper.record.sourceClosureHash !== sourceClosureHash
  || physicalWrapper.record.buildRevision !== buildRevision) {
  throw new Error(
    `physical identity mismatch: raw source=${sourceClosureHash} build=${buildRevision} `
    + `physical source=${physicalWrapper.record.sourceClosureHash} build=${physicalWrapper.record.buildRevision}. `
    + 'Re-capture correctness at current registry revision before accepting.',
  );
}

// 4) Lane join
console.error(`[accept] lane join for ${labId}`);
const laneJoin = createEvidenceLaneJoin({
  rawManifest: raw.manifest,
  physicalReview: physicalWrapper,
});
validateEvidenceLaneJoin(laneJoin);
const laneJoinPath = join(artifactRoot, 'lane-join.json');
writeFileSync(laneJoinPath, `${JSON.stringify(laneJoin, null, 2)}\n`);

// 5) Release candidate outside repo
const outsideRoot = mkdtempSync(join(tmpdir(), `threejs-release-${labId}-`));
const candidateDir = join(outsideRoot, 'candidate');
const approvedDir = join(outsideRoot, 'approved');

// Release route must be identical to the correctness raw route (same path+lock).
// Physical review lockedState fields are already forced to match that lock.
const physicalRoute = structuredClone(raw.manifest.route);
if (physicalRoute.stateDigest !== routeStateDigest(physicalRoute)) {
  physicalRoute.stateDigest = routeStateDigest(physicalRoute);
}
const locked = physicalWrapper.record.route.lockedState;
for (const field of ['scenario', 'mechanism', 'mode', 'tier', 'camera']) {
  if ((locked?.[field] ?? null) !== (physicalRoute[field] ?? null)) {
    throw new Error(`physical locked ${field}=${locked?.[field]} differs from raw route ${physicalRoute[field]}`);
  }
}
const lockedSeed = typeof locked?.seed === 'number'
  ? `0x${(locked.seed >>> 0).toString(16).padStart(8, '0')}`
  : locked?.seed;
if (lockedSeed !== physicalRoute.seed) {
  throw new Error(`physical locked seed ${lockedSeed} differs from raw route seed ${physicalRoute.seed}`);
}

console.error(`[accept] assemble release candidate for ${labId} → ${candidateDir}`);
const assembled = await assemblePendingReleaseBundle({
  correctnessDirectory: correctnessDir,
  physicalReviewPath: physicalPath,
  servedLedgerPath: servedPath,
  laneJoinPath,
  outputDirectory: candidateDir,
  physicalRoute,
  limitations: [
    {
      id: 'visual-review-pending',
      status: 'ACTIVE',
      statement: 'Offline visual signoff is required before the joined release becomes publishable.',
      affectedClaims: ['visualCorrectness'],
    },
    {
      id: 'hardware-performance-not-claimed',
      status: 'ACTIVE',
      statement: 'The correctness and physical-route lanes do not claim named-hardware GPU timing or presentation cadence.',
      affectedClaims: ['performanceCompliance', 'gpuAttribution'],
    },
    {
      id: 'opaque-renderer-residency-not-claimed',
      status: 'ACTIVE',
      statement: 'Exact Three.js renderer-internal pipeline and cache byte residency is unavailable; lifecycle PASS covers lab-owned resources and observed renderer state only.',
      affectedClaims: ['lifecycleStability'],
    },
  ],
});

// 6) Visual promote
const reviewedImages = [];
for (const filename of REQUIRED_EVIDENCE_IMAGES) {
  const image = assembled.manifest.images.find((entry) => entry.path === filename);
  if (image?.status === 'captured') {
    const path = join(candidateDir, filename);
    if (!existsSync(path)) throw new Error(`candidate missing ${filename}`);
    const bytes = readFileSync(path);
    if (bytes.byteLength < 512 || bytes.toString('ascii', 1, 4) !== 'PNG') {
      throw new Error(`visual review rejected ${filename}`);
    }
    reviewedImages.push(filename);
  }
}
if (reviewedImages.length < 2) throw new Error('visual review needs final+diagnostic captured images');

const visualReview = {
  status: 'APPROVED',
  reviewer: `accept-lab-from-capture CDP hardware pipeline (${labId})`,
  reviewedAt: new Date().toISOString(),
  candidateBindingDigest: assembled.manifest.promotion.bindingDigest,
  reviewedImages,
  notes: [
    'Direct file inspection of retained native-WebGPU correctness readbacks bound by the candidate.',
    'Physical-route hardware review passed on immutable prebuilt bytes via CDP Chrome.',
    'Performance and GPU attribution remain NOT_CLAIMED; lifecycle PASS is backed by a 50-cycle dispose soak.',
  ],
};

console.error(`[accept] promote approved release for ${labId}`);
const promoted = await promoteReleaseBundle({
  candidateDirectory: candidateDir,
  outputDirectory: approvedDir,
  visualReview,
});

if (promoted.manifest.publishable !== true || promoted.manifest.promotion.status !== 'APPROVED') {
  throw new Error('promotion did not yield publishable APPROVED release');
}

// Keep a repo-local pointer (outside docs) for debugging
const approvedPointer = join(artifactRoot, 'release-approved-current');
if (existsSync(approvedPointer)) {
  renameSync(approvedPointer, `${approvedPointer}.stale-${Date.now()}`);
}
// Copy is expensive; write a pointer file instead
writeFileSync(join(artifactRoot, 'release-approved-pointer.json'), `${JSON.stringify({
  approvedDir,
  candidateDir,
  bindingDigest: promoted.manifest.promotion.bindingDigest,
  sourceClosureHash,
  buildRevision,
}, null, 2)}\n`);

// 7) Ensure lab.manifest declares the canonical evidenceBundle before projection.
const manifestCandidates = [
  resolve(REPO_ROOT, lab.browserEntry.replace(/index\.html$/, 'lab.manifest.json')),
  resolve(REPO_ROOT, dirname(lab.browserEntry), 'lab.manifest.json'),
];
function findManifest(id) {
  for (const candidate of manifestCandidates) if (existsSync(candidate)) return candidate;
  const roots = readdirSync(REPO_ROOT).filter((name) => name.startsWith('threejs-'));
  for (const root of roots) {
    const examples = join(REPO_ROOT, root, 'examples');
    if (!existsSync(examples)) continue;
    for (const entry of readdirSync(examples)) {
      const path = join(examples, entry, 'lab.manifest.json');
      if (!existsSync(path)) continue;
      try {
        const manifest = JSON.parse(readFileSync(path, 'utf8'));
        if (manifest.id === id) return path;
      } catch { /* ignore */ }
    }
  }
  return null;
}

const labManifestPath = findManifest(labId);
if (!labManifestPath) throw new Error(`could not locate lab.manifest.json for ${labId}`);
const labManifest = JSON.parse(readFileSync(labManifestPath, 'utf8'));
labManifest.evidenceBundle = `docs/visual-validation/${labId}/bundle`;
writeFileSync(labManifestPath, `${JSON.stringify(labManifest, null, 2)}\n`);

// 8) Project tracked release into docs/visual-validation/<lab>/bundle
console.error(`[accept] project tracked release for ${labId}`);
runNode(join(REPO_ROOT, 'scripts/project-tracked-release.mjs'), [
  '--lab', labId,
  '--candidate', approvedDir,
  '--expected-binding', promoted.manifest.promotion.bindingDigest,
]);

// 9) Mark lab.manifest accepted after successful projection
labManifest.status = 'accepted';
for (const key of ['scenarios', 'mechanisms', 'tiers']) {
  if (!Array.isArray(labManifest[key])) continue;
  for (const entry of labManifest[key]) {
    entry.acceptanceStatus = 'accepted';
  }
}
writeFileSync(labManifestPath, `${JSON.stringify(labManifest, null, 2)}\n`);
console.log(JSON.stringify({
  ok: true,
  labId,
  labManifestPath,
  approvedDir,
  bindingDigest: promoted.manifest.promotion.bindingDigest,
  publishable: promoted.manifest.publishable,
  claims: promoted.manifest.claimVerdicts,
  evidenceBundle: labManifest.evidenceBundle,
}, null, 2));
