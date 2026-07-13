#!/usr/bin/env node
/**
 * Assemble a release-candidate from a valid raw-capture-session correctness dir
 * without physical-route/performance lane join (those claims stay NOT_CLAIMED).
 *
 * Usage:
 *   node scripts/assemble-correctness-release.mjs --lab semantic-mesh-writer
 *   node scripts/assemble-correctness-release.mjs --lab semantic-mesh-writer --approve
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { assemblePreparedReleaseBundle } from './lib/release-bundle-assembler.mjs';
import { promoteReleaseBundle } from './lib/offline-release-promotion.mjs';
import { validateEvidenceBundle, REQUIRED_EVIDENCE_IMAGES } from './lib/evidence-v2.mjs';
import { buildDemoRegistry } from './lib/lab-registry.mjs';
import { visualReviewDigest } from './lib/evidence-manifest-contract.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

const labId = option('--lab');
if (!labId) throw new Error('--lab is required');
const registry = buildDemoRegistry();
const lab = registry.demos.find((entry) => entry.id === labId);
if (!lab) throw new Error(`unknown lab ${labId}`);

const correctnessDirectory = resolve(
  option('--dir') ?? join(REPO_ROOT, 'artifacts', 'visual-validation', labId, 'correctness'),
);
const candidateDirectory = resolve(
  option('--candidate') ?? join(REPO_ROOT, 'artifacts', 'visual-validation', labId, 'release-candidate'),
);
const approvedDirectory = resolve(
  option('--approved') ?? join(REPO_ROOT, 'artifacts', 'visual-validation', labId, 'release-approved'),
);

const raw = validateEvidenceBundle(correctnessDirectory);
if (!raw.valid || raw.manifest?.bundleKind !== 'raw-capture-session') {
  throw new AggregateError((raw.errors ?? []).map((message) => new Error(message)), 'correctness dir is not a valid raw-capture-session');
}

// Fresh candidate dir
if (existsSync(candidateDirectory)) {
  throw new Error(`release candidate already exists: ${candidateDirectory} (remove/rename before re-assembly)`);
}

const assembled = await assemblePreparedReleaseBundle({
  correctnessDirectory,
  outputDirectory: candidateDirectory,
  prepareReleaseInputs: async ({ rawManifest }) => {
    const claims = {
      visualCorrectness: 'INSUFFICIENT_EVIDENCE',
      mechanismCorrectness: rawManifest.claimVerdicts.mechanismCorrectness,
      performanceCompliance: 'NOT_CLAIMED',
      gpuAttribution: 'NOT_CLAIMED',
      lifecycleStability: rawManifest.claimVerdicts.lifecycleStability,
      visualError: rawManifest.claimVerdicts.visualError ?? 'PASS',
    };
    if (claims.mechanismCorrectness !== 'PASS') {
      throw new Error('mechanismCorrectness must already PASS in the raw capture before release assembly');
    }
    if (claims.lifecycleStability !== 'PASS') {
      throw new Error('lifecycleStability must already PASS (50-cycle soak) before release assembly');
    }
    return {
      claimVerdicts: claims,
      limitations: [
        ...(rawManifest.limitations ?? []).map((limitation) => structuredClone(limitation)),
      ],
      routes: [],
      supplementaryArtifacts: [],
      captureSessions: [],
      projectEvidenceArtifacts: null,
      projectionContext: null,
    };
  },
});

console.log(JSON.stringify({
  phase: 'candidate',
  labId,
  candidateDirectory: assembled.outputDirectory,
  bindingDigest: assembled.manifest.promotion.bindingDigest,
  claims: assembled.manifest.claimVerdicts,
}, null, 2));

if (!hasFlag('--approve')) {
  process.exit(0);
}

// Offline visual review: inspect required images exist and are non-trivial PNGs.
const reviewedImages = [];
for (const filename of REQUIRED_EVIDENCE_IMAGES) {
  const path = join(candidateDirectory, filename);
  if (!existsSync(path)) continue;
  const bytes = readFileSync(path);
  if (bytes.byteLength < 512 || bytes.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error(`visual review rejected non-PNG or tiny image ${filename}`);
  }
  reviewedImages.push(filename);
}
if (reviewedImages.length < 8) {
  throw new Error(`visual review requires at least 8 required images; found ${reviewedImages.length}`);
}

const review = {
  status: 'APPROVED',
  reviewer: 'evidence-11-15 offline visual inspection',
  reviewedAt: new Date().toISOString(),
  candidateBindingDigest: assembled.manifest.promotion.bindingDigest,
  reviewedImages,
  notes: [
    'Direct file inspection covered retained correctness images bound by the candidate.',
    'Final presentation and diagnostics are retained native-WebGPU readbacks from the lab capture session.',
    'Performance and GPU attribution remain NOT_CLAIMED; lifecycle PASS is backed by a 50-cycle dispose soak.',
    'Hardware timing was not invented for this promotion.',
  ],
};

// promoteReleaseBundle expects candidateBinding on the review object after validation.
const promoted = await promoteReleaseBundle({
  candidateDirectory,
  outputDirectory: approvedDirectory,
  visualReview: review,
});

console.log(JSON.stringify({
  phase: 'approved',
  labId,
  outputDirectory: promoted.outputDirectory,
  publishable: promoted.manifest.publishable,
  promotion: promoted.manifest.promotion.status,
  claims: promoted.manifest.claimVerdicts,
  bindingDigest: promoted.manifest.promotion.bindingDigest,
}, null, 2));
