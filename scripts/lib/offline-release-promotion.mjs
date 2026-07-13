import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import {
  canonicalSha256,
  createReleasePromotionBinding,
  STANDARD_IMAGE_PATHS,
  visualReviewDigest,
} from './evidence-manifest-contract.mjs';
import { validateEvidenceBundle } from './evidence-v2.mjs';

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function requireVisualReview(review) {
  if (review === null || typeof review !== 'object' || Array.isArray(review)) {
    throw new TypeError('offline visual review must be an object');
  }
  if (!['APPROVED', 'REJECTED'].includes(review.status)) {
    throw new Error('offline visual review must decide APPROVED or REJECTED');
  }
  if (typeof review.reviewer !== 'string' || review.reviewer.trim().length === 0) {
    throw new Error('offline visual review requires a reviewer');
  }
  if (typeof review.reviewedAt !== 'string' || !Number.isFinite(Date.parse(review.reviewedAt))) {
    throw new Error('offline visual review requires a valid reviewedAt timestamp');
  }
  if (!Array.isArray(review.reviewedImages) || new Set(review.reviewedImages).size !== review.reviewedImages.length
    || review.reviewedImages.some((path) => typeof path !== 'string' || path.length === 0)) {
    throw new Error('offline visual review requires unique image paths');
  }
  if (!Array.isArray(review.notes) || review.notes.some((note) => typeof note !== 'string' || note.trim().length === 0)) {
    throw new Error('offline visual review notes must be nonempty strings');
  }
  return {
    status: review.status,
    reviewer: review.reviewer.trim(),
    reviewedAt: review.reviewedAt,
    reviewDigest: null,
    reviewedImages: [...review.reviewedImages],
    notes: [...review.notes],
  };
}

async function copyBoundArtifact(sourceDirectory, stagingDirectory, entry) {
  const source = join(sourceDirectory, entry.path);
  if (!existsSync(source)) throw new Error(`release candidate artifact is missing: ${entry.path}`);
  const bytes = await readFile(source);
  if (bytes.byteLength !== entry.byteLength || sha256(bytes) !== entry.sha256) {
    throw new Error(`release candidate artifact drifted: ${entry.path}`);
  }
  const destination = join(stagingDirectory, entry.path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes, { flag: 'wx' });
}

export async function promoteReleaseBundle({ candidateDirectory, outputDirectory, visualReview }) {
  if (existsSync(outputDirectory)) throw new Error(`promoted release output already exists: ${outputDirectory}`);
  const candidate = validateEvidenceBundle(candidateDirectory);
  if (!candidate.valid) {
    throw new AggregateError(candidate.errors.map((message) => new Error(message)), 'release candidate is invalid');
  }
  const sourceManifest = candidate.manifest;
  if (sourceManifest.bundleKind !== 'release-bundle' || sourceManifest.publishable !== false
    || sourceManifest.promotion?.status !== 'PENDING_VISUAL_SIGNOFF') {
    throw new Error('offline promotion requires a nonpublishable release bundle awaiting visual signoff');
  }
  if (visualReview?.candidateBindingDigest !== sourceManifest.promotion.bindingDigest) {
    throw new Error('offline visual review candidate binding digest does not match the pending release');
  }
  const review = requireVisualReview(visualReview);
  const imageIndex = new Map(sourceManifest.images.map((image) => [image.path, image]));
  for (const path of review.reviewedImages) {
    if (imageIndex.get(path)?.status !== 'captured') throw new Error(`offline visual review references uncaptured image ${path}`);
  }
  if (review.status === 'APPROVED') {
    for (const path of STANDARD_IMAGE_PATHS) {
      if (imageIndex.get(path)?.status === 'captured' && !review.reviewedImages.includes(path)) {
        throw new Error(`approved visual review omits captured standard image ${path}`);
      }
    }
    for (const claim of ['visualCorrectness', 'mechanismCorrectness', 'lifecycleStability']) {
      if (sourceManifest.claimVerdicts?.[claim] !== 'PASS') throw new Error(`approved release requires ${claim}=PASS`);
    }
  }
  review.reviewDigest = visualReviewDigest(review);
  const manifest = structuredClone(sourceManifest);
  manifest.publishable = review.status === 'APPROVED';
  manifest.promotion = null;
  const binding = createReleasePromotionBinding(manifest);
  manifest.promotion = {
    status: review.status,
    binding,
    bindingDigest: canonicalSha256(binding),
    visualSignoff: review,
  };

  const parent = resolve(dirname(outputDirectory));
  await mkdir(parent, { recursive: true });
  const stagingDirectory = await mkdtemp(join(parent, `.${basename(outputDirectory)}.staging-`));
  const copied = new Set();
  for (const entry of [...sourceManifest.files, ...sourceManifest.images]) {
    if (entry.status !== 'captured' || copied.has(entry.path)) continue;
    await copyBoundArtifact(candidateDirectory, stagingDirectory, entry);
    copied.add(entry.path);
  }
  await writeFile(join(stagingDirectory, 'evidence-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  const validation = validateEvidenceBundle(stagingDirectory);
  if (!validation.valid) {
    throw new AggregateError(validation.errors.map((message) => new Error(message)), `promoted release validation failed; retained staging directory ${stagingDirectory}`);
  }
  await rename(stagingDirectory, outputDirectory);
  return Object.freeze({ outputDirectory, manifest, validation });
}
