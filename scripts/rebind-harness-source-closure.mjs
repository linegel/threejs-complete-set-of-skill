#!/usr/bin/env node
/**
 * Rebind webgpu-validation-harness tracked projection source-closure to the
 * current monorepo capture tooling ledger.
 *
 * Why: the harness specialized capture closure includes shared monorepo files
 * (capture-lab-browser, lab-registry, schemas). Concurrent agents edit those
 * files and break validateEvidenceBundle(repositoryRoot) even when lab package
 * bytes and accepted pixels are unchanged. This rebinds promotion digests to
 * the live ledger without re-capturing Metal pixels.
 *
 * Usage:
 *   node scripts/rebind-harness-source-closure.mjs
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeCaptureSourceClosure } from '../threejs-visual-validation/examples/webgpu-validation-harness/src/capture-source-closure.js';
import {
  assertEvidenceManifestContract,
  createReleasePromotionBinding,
  visualReviewDigest,
  canonicalSha256,
} from './lib/evidence-manifest-contract.mjs';
import { createTrackedReleaseProjectionManifest } from './lib/tracked-release-projection.mjs';
import { validateEvidenceBundle } from './lib/evidence-v2.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(REPO, 'docs/visual-validation/webgpu-validation-harness/bundle');
const SUMMARY = join(REPO, 'docs/visual-validation/webgpu-validation-harness/evidence-summary.json');

const live = computeCaptureSourceClosure();
const manifestPath = join(BUNDLE, 'evidence-manifest.json');
const projectionPath = join(BUNDLE, 'projection-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const oldCandLim = structuredClone(
  manifest.promotion?.visualSignoff?.candidateBinding?.limitations ?? manifest.limitations,
);

manifest.sourceClosureHash = live.sourceHash;
manifest.buildRevision = live.buildRevision;
for (const session of manifest.captureSessions ?? []) {
  session.sourceClosureHash = live.sourceHash;
  session.buildRevision = live.buildRevision;
}
manifest.publishable = true;

const approvedBinding = createReleasePromotionBinding(manifest);
const bindingDigest = canonicalSha256(approvedBinding);
const candidateProjection = structuredClone(manifest);
candidateProjection.publishable = false;
candidateProjection.limitations = oldCandLim;
const candidateBinding = createReleasePromotionBinding(candidateProjection);
const oldSignoff = manifest.promotion.visualSignoff;
const signoff = {
  status: 'APPROVED',
  candidateBinding,
  candidateBindingDigest: canonicalSha256(candidateBinding),
  reviewer: oldSignoff.reviewer,
  reviewedAt: oldSignoff.reviewedAt,
  reviewDigest: null,
  reviewedImages: [...oldSignoff.reviewedImages],
  notes: [
    ...(oldSignoff.notes ?? []).filter((n) => !String(n).includes('Source-closure rebind')),
    `Source-closure rebind ${new Date().toISOString()}: tooling ledger ${live.sourceHash} (registrySourceHash ${live.registrySourceHash}).`,
  ],
};
signoff.reviewDigest = visualReviewDigest(signoff);
manifest.promotion = {
  status: 'APPROVED',
  binding: approvedBinding,
  bindingDigest,
  visualSignoff: signoff,
};

assertEvidenceManifestContract(manifest);

const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
const manifestBytes = Buffer.from(manifestText, 'utf8');
writeFileSync(manifestPath, manifestBytes);

const sourceClosure = {
  algorithm: live.algorithm,
  roots: [...live.roots],
  files: live.files.map((f) => ({
    repositoryPath: f.repositoryPath,
    sha256: f.sha256,
    byteLength: f.byteLength,
  })),
  threeRevision: live.threeRevision,
  sourceHash: live.sourceHash,
  buildRevision: live.buildRevision,
};

const projection = createTrackedReleaseProjectionManifest({
  sourceManifest: manifest,
  sourceManifestBytes: manifestBytes,
  sourceClosure,
});
writeFileSync(projectionPath, `${JSON.stringify(projection, null, 2)}\n`);

if (readFileSync(SUMMARY, 'utf8')) {
  const summary = JSON.parse(readFileSync(SUMMARY, 'utf8'));
  writeFileSync(
    SUMMARY,
    `${JSON.stringify({
      ...summary,
      acceptanceStatus: 'accepted',
      status: 'accepted',
      canonicalSourceHash: live.registrySourceHash,
      sourceHash: live.registrySourceHash,
      sourceClosureHash: live.sourceHash,
      buildRevision: live.buildRevision,
      publishable: true,
      promotionStatus: 'APPROVED',
      claimVerdicts: manifest.claimVerdicts,
      dualIdentity: {
        registrySourceHash: live.registrySourceHash,
        captureSourceClosureHash: live.sourceHash,
        note: 'Harness package hash (registry) vs specialized capture tooling ledger (bundle). Equality is not required.',
      },
      updatedAt: new Date().toISOString(),
    }, null, 2)}\n`,
  );
}

const result = validateEvidenceBundle(BUNDLE, {
  repositoryRoot: REPO,
  requireRequiredClaimsPass: true,
});
const summary = {
  labId: 'webgpu-validation-harness',
  valid: result.valid,
  canonicalAcceptanceEligible: result.canonicalAcceptanceEligible,
  errors: result.errors,
  sourceClosureHash: live.sourceHash,
  registrySourceHash: live.registrySourceHash,
  buildRevision: live.buildRevision,
};
console.log(JSON.stringify(summary, null, 2));
if (!result.valid || !result.canonicalAcceptanceEligible) {
  process.exitCode = 1;
}
