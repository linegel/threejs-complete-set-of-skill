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

test('offline rejection remains validated and nonpublishable', async () => {
  const candidateDirectory = pendingCandidate();
  const outputDirectory = join(mkdtempSync(join(tmpdir(), 'offline-rejection-test-')), 'rejected');
  const result = await promoteReleaseBundle({ candidateDirectory, outputDirectory, visualReview: review(candidateDirectory, 'REJECTED') });
  assert.equal(result.validation.valid, true, result.validation.errors.join('\n'));
  assert.equal(result.manifest.publishable, false);
  assert.equal(result.manifest.promotion.status, 'REJECTED');
});
