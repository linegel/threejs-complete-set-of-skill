import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentSitePreviewManifest } from '../../scripts/lib/site-preview-manifest.mjs';

test('publication drops retired owners without altering retained capture evidence', () => {
  const kept = { id: 'current', verdict: 'PREVIEW_CAPTURED', ready: { nativeWebGPU: false } };
  const failed = { id: 'failed', verdict: 'PREVIEW_FAILED', error: 'original failure' };
  const manifest = { schemaVersion: 1, canonicalEvidence: false, results: [kept, { id: 'retired' }, failed] };
  const result = currentSitePreviewManifest(manifest, new Set(['current', 'failed']));
  assert.deepEqual(result, { ...manifest, results: [kept, failed] });
  assert.equal(result.results[0], kept);
  assert.equal(manifest.results.length, 3);
});

test('malformed preview manifests fail instead of erasing capture records', () => {
  assert.throws(() => currentSitePreviewManifest({}, new Set()), /results/);
});
