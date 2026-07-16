import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  articleDependencyHash,
  manifestOwnedOutputPaths,
  ownerIdForResponsiveSource,
  ownerIdForSiteImageUrl,
  responsiveDependencyHash,
  staleManifestOwnedOutputPaths,
} from '../../scripts/lib/generated-asset-ledger.mjs';

const SITE = 'https://threejs-skills.com/';
const DOCS = '/workspace/docs';

function record(ownerId, sourceSha256, formats) {
  const value = {
    ownerId,
    sourceSha256,
    bytes: 100,
    formats,
  };
  value.dependencyClosureHash = responsiveDependencyHash('visual-validation/lab/final.design.png', value);
  return value;
}

test('responsive sources receive stable owners from their provenance path', () => {
  assert.equal(ownerIdForResponsiveSource('visual-validation/webgpu-ocean/final.design.png'), 'webgpu-ocean');
  assert.equal(ownerIdForResponsiveSource('previews/primary/node-selective-bloom.png'), 'node-selective-bloom');
  assert.equal(ownerIdForResponsiveSource('previews/provider/legacy-water.png'), 'legacy-water');
  assert.equal(ownerIdForResponsiveSource('generated-asset-contact-sheet.png'), 'generated-asset-archive');
  assert.equal(ownerIdForResponsiveSource('misc/site.png'), 'site');
});

test('dependency hashes are format-order independent and bind source plus outputs', () => {
  const avif = { url: `${SITE}visual-validation/lab/final.design.avif`, bytes: 40, sha256: 'sha256:avif' };
  const webp = { url: `${SITE}visual-validation/lab/final.design.webp`, bytes: 45, sha256: 'sha256:webp' };
  const left = record('lab', 'sha256:source', { avif, webp });
  const right = record('lab', 'sha256:source', { webp, avif });
  assert.equal(left.dependencyClosureHash, right.dependencyClosureHash);
  const mutated = record('lab', 'sha256:changed', { avif, webp });
  assert.notEqual(left.dependencyClosureHash, mutated.dependencyClosureHash);
});

test('article owners accept primary evidence and reject secondary or generic media', () => {
  assert.equal(
    ownerIdForSiteImageUrl(`${SITE}visual-validation/webgpu-ocean/final.design.png`, SITE),
    'webgpu-ocean',
  );
  assert.equal(
    ownerIdForSiteImageUrl(`${SITE}previews/primary/node-selective-bloom.png`, SITE),
    'node-selective-bloom',
  );
  for (const url of [
    'https://cdn.example/evidence.png',
    `${SITE}previews/provider/legacy-water.png`,
    `${SITE}generated-asset-contact-sheet.png`,
  ]) {
    assert.throws(() => ownerIdForSiteImageUrl(url, SITE));
  }
});

test('article dependency hashes bind source and all ratio crops', () => {
  const record = {
    ownerId: 'lab',
    source: `${SITE}visual-validation/lab/final.design.png`,
    sourceSha256: 'sha256:source',
    sourceWidth: 1200,
    sourceHeight: 800,
    images: {
      '16x9': { url: `${SITE}seo/article/lab-16x9.png`, bytes: 30, sha256: 'sha256:wide' },
      '1x1': { url: `${SITE}seo/article/lab-1x1.png`, bytes: 40, sha256: 'sha256:square' },
    },
  };
  const baseline = articleDependencyHash('lab', record);
  assert.equal(baseline, articleDependencyHash('lab', { ...record, images: { '1x1': record.images['1x1'], '16x9': record.images['16x9'] } }));
  assert.notEqual(baseline, articleDependencyHash('lab', { ...record, sourceSha256: 'sha256:mutated' }));
});

test('stale output selection is confined to prior manifest ownership', () => {
  const retained = { url: `${SITE}previews/primary/one.avif` };
  const stale = { url: `${SITE}previews/primary/old.webp` };
  const previous = { sources: { one: { formats: { avif: retained, webp: stale } } } };
  const current = { sources: { one: { formats: { avif: retained } } } };
  assert.deepEqual(
    [...staleManifestOwnedOutputPaths([previous], current, DOCS, SITE)],
    ['/workspace/docs/previews/primary/old.webp'],
  );
  assert.equal(manifestOwnedOutputPaths(current, DOCS, SITE).has('/workspace/docs/unregistered.webp'), false);
});

test('foreign, escaping, and unsupported manifest outputs fail closed', () => {
  for (const url of [
    'https://cdn.example/output.avif',
    'https://threejs-skills.com/%2e%2e%2foutside.avif',
    'https://threejs-skills.com/output.png',
  ]) {
    assert.throws(() => manifestOwnedOutputPaths({ sources: { one: { formats: { avif: { url } } } } }, DOCS, SITE));
  }
});
