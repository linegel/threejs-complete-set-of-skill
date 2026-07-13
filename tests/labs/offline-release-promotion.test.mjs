import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  canonicalSha256,
  createReleasePromotionBinding,
  routeSetDigest,
  routeStateDigest,
  STANDARD_IMAGE_PATHS,
  validateEvidenceManifestContract,
  visualReviewDigest,
} from '../../scripts/lib/evidence-manifest-contract.mjs';
import { validateEvidenceBundle } from '../../scripts/lib/evidence-v2.mjs';
import { promoteReleaseBundle } from '../../scripts/lib/offline-release-promotion.mjs';
import {
  createUnifiedReleaseBundleFixture,
  readFixtureManifest,
  writeFixtureManifest,
} from './unified-release-fixture.mjs';

function pendingCandidate() {
  const directory = createUnifiedReleaseBundleFixture();
  const manifest = readFixtureManifest(directory);
  manifest.publishable = false;
  const secondaryRoute = structuredClone(manifest.route);
  secondaryRoute.path = '/demos/webgpu-validation-harness/mechanism/resource-ledger/';
  secondaryRoute.stateDigest = routeStateDigest(secondaryRoute);
  manifest.routeSet = [structuredClone(manifest.route), secondaryRoute];
  const physical = manifest.captureSessions.find((session) => session.profile === 'physical-route');
  physical.routeSetPaths = manifest.routeSet.map((route) => route.path);
  physical.routeSetDigest = routeSetDigest(manifest.routeSet);
  manifest.limitations = [
    {
      id: 'visual-review-pending',
      status: 'ACTIVE',
      statement: 'Offline visual inspection of the release images is pending.',
      affectedClaims: ['visualCorrectness'],
    },
    {
      id: 'opaque-renderer-residency',
      status: 'ACTIVE',
      statement: 'Opaque renderer-internal residency is not claimed.',
      affectedClaims: ['performanceCompliance'],
    },
  ];
  manifest.promotion = null;
  const binding = createReleasePromotionBinding(manifest);
  manifest.promotion = {
    status: 'PENDING_VISUAL_SIGNOFF',
    binding,
    bindingDigest: canonicalSha256(binding),
    visualSignoff: {
      status: 'PENDING', reviewer: null, reviewedAt: null, reviewDigest: null, reviewedImages: [], notes: [],
    },
  };
  writeFixtureManifest(directory, manifest);
  const validation = validateEvidenceBundle(directory);
  assert.equal(validation.valid, true, validation.errors.join('\n'));
  return directory;
}

function review(candidateDirectory, status = 'APPROVED') {
  const manifest = readFixtureManifest(candidateDirectory);
  return {
    status,
    candidateBindingDigest: manifest.promotion.bindingDigest,
    reviewer: 'fixture-direct-reviewer',
    reviewedAt: '2026-07-13T03:00:00Z',
    reviewedImages: [...STANDARD_IMAGE_PATHS],
    notes: ['Direct inspection covered every standard output and the diagnostic image differed from final output.'],
  };
}

test('offline promotion copies a candidate into a validated route-set-bound approved release', async () => {
  const candidateDirectory = pendingCandidate();
  const root = mkdtempSync(join(tmpdir(), 'offline-promotion-test-'));
  const outputDirectory = join(root, 'approved');
  const result = await promoteReleaseBundle({ candidateDirectory, outputDirectory, visualReview: review(candidateDirectory) });
  assert.equal(result.validation.valid, true, result.validation.errors.join('\n'));
  assert.equal(result.manifest.publishable, true);
  assert.equal(result.manifest.promotion.status, 'APPROVED');
  assert.deepEqual(result.manifest.promotion.binding.routeSet, result.manifest.routeSet);
  assert.equal(result.manifest.promotion.binding.routeSetDigest, routeSetDigest(result.manifest.routeSet));
  assert.equal(result.manifest.promotion.visualSignoff.reviewedImages.length, STANDARD_IMAGE_PATHS.length);
  assert.deepEqual(
    result.manifest.promotion.visualSignoff.candidateBinding,
    readFixtureManifest(candidateDirectory).promotion.binding,
  );
  assert.equal(
    result.manifest.promotion.visualSignoff.candidateBindingDigest,
    readFixtureManifest(candidateDirectory).promotion.bindingDigest,
  );
  assert.deepEqual(result.manifest.limitations, [
    {
      id: 'visual-review-pending',
      status: 'RESOLVED',
      statement: 'Offline visual review completed and approved the captured release images at 2026-07-13T03:00:00Z.',
      affectedClaims: ['visualCorrectness'],
    },
    {
      id: 'opaque-renderer-residency',
      status: 'ACTIVE',
      statement: 'Opaque renderer-internal residency is not claimed.',
      affectedClaims: ['performanceCompliance'],
    },
  ]);
  assert.deepEqual(result.manifest.promotion.binding.limitations, result.manifest.limitations);
  await assert.rejects(
    () => promoteReleaseBundle({ candidateDirectory, outputDirectory, visualReview: review(candidateDirectory) }),
    /already exists/,
  );
});

test('offline promotion rejects incomplete signoff and drifted candidate bytes', async () => {
  const candidateDirectory = pendingCandidate();
  const root = mkdtempSync(join(tmpdir(), 'offline-promotion-mutation-'));
  const foreignReview = review(candidateDirectory);
  foreignReview.candidateBindingDigest = canonicalSha256('another release candidate');
  await assert.rejects(
    () => promoteReleaseBundle({ candidateDirectory, outputDirectory: join(root, 'foreign-review'), visualReview: foreignReview }),
    /candidate binding digest does not match/,
  );
  const incomplete = review(candidateDirectory);
  incomplete.reviewedImages = incomplete.reviewedImages.filter((path) => path !== 'temporal.t001.png');
  await assert.rejects(
    () => promoteReleaseBundle({ candidateDirectory, outputDirectory: join(root, 'missing-image'), visualReview: incomplete }),
    /omits captured standard image temporal\.t001\.png/,
  );

  writeFileSync(join(candidateDirectory, 'final.design.png'), 'drifted image bytes');
  await assert.rejects(
    () => promoteReleaseBundle({ candidateDirectory, outputDirectory: join(root, 'drifted'), visualReview: review(candidateDirectory) }),
    /release candidate is invalid/,
  );
});

test('terminal signoff rejects forged candidate lineage', async () => {
  const candidateDirectory = pendingCandidate();
  const outputDirectory = join(mkdtempSync(join(tmpdir(), 'offline-lineage-test-')), 'approved');
  const result = await promoteReleaseBundle({ candidateDirectory, outputDirectory, visualReview: review(candidateDirectory) });

  const forgedDigest = structuredClone(result.manifest);
  forgedDigest.promotion.visualSignoff.candidateBindingDigest = canonicalSha256('another candidate');
  forgedDigest.promotion.visualSignoff.reviewDigest = visualReviewDigest(forgedDigest.promotion.visualSignoff);
  assert.match(
    validateEvidenceManifestContract(forgedDigest).join('\n'),
    /Visual signoff candidate binding does not match/,
  );

  const forgedBinding = structuredClone(result.manifest);
  forgedBinding.promotion.visualSignoff.candidateBinding.imageLedgerDigest = canonicalSha256('forged images');
  forgedBinding.promotion.visualSignoff.reviewDigest = visualReviewDigest(forgedBinding.promotion.visualSignoff);
  assert.match(
    validateEvidenceManifestContract(forgedBinding).join('\n'),
    /Visual signoff candidate binding|candidate image ledger differs/,
  );
});

test('offline rejection remains validated and nonpublishable', async () => {
  const candidateDirectory = pendingCandidate();
  const outputDirectory = join(mkdtempSync(join(tmpdir(), 'offline-rejection-test-')), 'rejected');
  const result = await promoteReleaseBundle({ candidateDirectory, outputDirectory, visualReview: review(candidateDirectory, 'REJECTED') });
  assert.equal(result.validation.valid, true, result.validation.errors.join('\n'));
  assert.equal(result.manifest.publishable, false);
  assert.equal(result.manifest.promotion.status, 'REJECTED');
  const visualReviewLimitation = result.manifest.limitations.find(({ id }) => id === 'visual-review-pending');
  assert.equal(visualReviewLimitation.status, 'RESOLVED');
  assert.match(visualReviewLimitation.statement, /completed and rejected/);
});

test('limitation statuses are descriptive while duplicate ids remain invalid', async () => {
  const candidateDirectory = pendingCandidate();
  const candidate = readFixtureManifest(candidateDirectory);
  candidate.limitations.find(({ id }) => id === 'visual-review-pending').status = 'RESOLVED';
  candidate.promotion.binding = createReleasePromotionBinding(candidate);
  candidate.promotion.bindingDigest = canonicalSha256(candidate.promotion.binding);
  assert.doesNotMatch(validateEvidenceManifestContract(candidate).join('\n'), /Pending visual signoff requires/);

  const outputDirectory = join(mkdtempSync(join(tmpdir(), 'offline-terminal-limitation-')), 'approved');
  const result = await promoteReleaseBundle({ candidateDirectory, outputDirectory, visualReview: review(candidateDirectory) });
  const contradictory = structuredClone(result.manifest);
  contradictory.limitations.find(({ id }) => id === 'visual-review-pending').status = 'ACTIVE';
  contradictory.promotion.binding = createReleasePromotionBinding(contradictory);
  contradictory.promotion.bindingDigest = canonicalSha256(contradictory.promotion.binding);
  assert.doesNotMatch(validateEvidenceManifestContract(contradictory).join('\n'), /Terminal visual signoff requires/);

  const duplicated = structuredClone(result.manifest);
  duplicated.limitations.push({
    ...structuredClone(duplicated.limitations.find(({ id }) => id === 'visual-review-pending')),
    statement: 'A conflicting duplicate limitation.',
  });
  assert.match(validateEvidenceManifestContract(duplicated).join('\n'), /limitations duplicates id "visual-review-pending"/);
});
