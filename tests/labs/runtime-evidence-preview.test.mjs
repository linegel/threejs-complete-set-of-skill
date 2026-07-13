import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  extractRuntimeBackendProof,
  halfFloatToNumber,
  isThreeR185Revision,
  normalizedPreviewClaimVerdicts,
  pngDimensions,
  resolveWithin,
  selectRuntimeEvidencePreviews,
  visualizeRgba16Float,
} from '../../scripts/promote-runtime-evidence.mjs';
import { encodeRgbaPng } from '../../scripts/lib/png-rgba.mjs';

test('half-float decoder handles finite, subnormal, and non-finite values', () => {
  assert.equal(halfFloatToNumber(0x0000), 0);
  assert.equal(halfFloatToNumber(0x3c00), 1);
  assert.equal(halfFloatToNumber(0xc000), -2);
  assert.ok(halfFloatToNumber(0x0001) > 0);
  assert.equal(halfFloatToNumber(0x7c00), Infinity);
  assert.ok(Number.isNaN(halfFloatToNumber(0x7e00)));
});

test('rgba16float visualization reports invalid and clamped values', () => {
  const bytes = Buffer.alloc(16);
  [0x3c00, 0x3800, 0x0000, 0x3c00, 0xbc00, 0x7c00, 0x0000, 0x3c00]
    .forEach((value, index) => bytes.writeUInt16LE(value, index * 2));
  const result = visualizeRgba16Float(bytes, 2, 1);
  assert.equal(result.pixels.byteLength, 8);
  assert.equal(result.negativeValues, 1);
  assert.equal(result.nonFiniteValues, 1);
  assert.equal(result.pixels[3], 255);
  assert.equal(result.pixels[7], 255);
});

test('evidence promotion confines source and output paths', () => {
  assert.equal(resolveWithin('/tmp/evidence-root', 'nested/image.png'), '/tmp/evidence-root/nested/image.png');
  assert.throws(() => resolveWithin('/tmp/evidence-root', '../escape.png'), /escapes its allowed root/);
  assert.throws(() => resolveWithin('/tmp/evidence-root', '/absolute.png'), /relative path/);
});

test('promoted PNG dimensions come from the encoded image header', () => {
  const png = encodeRgbaPng({ width: 2, height: 3, data: new Uint8Array(24) });
  assert.deepEqual(pngDimensions(png), { width: 2, height: 3 });
  assert.throws(() => pngDimensions(Buffer.from('not-png')), /not a PNG/);
});

test('runtime evidence accepts both Three revision spellings used by r185 artifacts', () => {
  assert.equal(isThreeR185Revision('185'), true);
  assert.equal(isThreeR185Revision('0.185.1'), true);
  assert.equal(isThreeR185Revision('184'), false);
  assert.equal(isThreeR185Revision('0.186.0'), false);
});

test('runtime evidence extracts native backend and bounded claims from capture sessions', () => {
  const session = {
    threeRevision: '0.185.1',
    runtime: {
      metrics: {
        rendererBackend: 'WebGPUBackend',
        rendererInfo: { rendererType: 'WebGPURenderer' },
        rendererBackendEvidence: { isWebGPUBackend: true },
      },
    },
    hookResult: {
      visualDifferences: { verdict: 'PASS' },
      coverageEvidence: { verdict: 'PASS' },
      lifecycleEvidence: { verdict: 'PASS' },
    },
  };
  assert.deepEqual(extractRuntimeBackendProof(session), {
    renderer: 'WebGPURenderer',
    backend: 'WebGPUBackend',
    isWebGPUBackend: true,
    threeRevision: '0.185.1',
  });
  assert.deepEqual(normalizedPreviewClaimVerdicts(session), {
    visualCorrectness: 'PASS',
    mechanismCorrectness: 'PASS',
    performanceCompliance: 'NOT_CLAIMED',
    gpuAttribution: 'INSUFFICIENT_EVIDENCE',
    lifecycleStability: 'PASS',
  });
  delete session.hookResult.lifecycleEvidence;
  assert.equal(normalizedPreviewClaimVerdicts(session).lifecycleStability, 'INSUFFICIENT_EVIDENCE');
});

test('runtime evidence promotion selects explicit labs and rejects filter drift', () => {
  const config = { schemaVersion: 1, previews: [ { labId: 'alpha' }, { labId: 'beta' } ] };
  assert.deepEqual(selectRuntimeEvidencePreviews(config, ['beta']), [{ labId: 'beta' }]);
  assert.deepEqual(selectRuntimeEvidencePreviews(config), config.previews);
  assert.throws(() => selectRuntimeEvidencePreviews(config, ['missing']), /has no labs/);
  assert.throws(() => selectRuntimeEvidencePreviews(config, ['alpha', 'alpha']), /duplicates/);
});
