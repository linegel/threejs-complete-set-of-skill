import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  alignedBytesPerRow,
  requiredPaddedByteLength,
  unpackAlignedRows,
} from '../../labs/runtime/aligned-readback.mjs';
import { createStrictLabController } from '../../labs/runtime/strict-lab-controller.mjs';
import { assertRuntimeOwnership } from '../../labs/runtime/ownership.mjs';

test('WebGPU readback uses an integer 256-byte-aligned stride', () => {
  assert.equal(alignedBytesPerRow(1200, 4), 4864);
  assert.equal(alignedBytesPerRow(641, 4), 2816);
  const bytesPerRow = alignedBytesPerRow(3, 4);
  const required = requiredPaddedByteLength(3, 2, 4, bytesPerRow);
  const source = new Uint8Array(required);
  source.fill(7, 0, 12);
  source.fill(9, bytesPerRow, bytesPerRow + 12);
  const unpacked = unpackAlignedRows({ source, width: 3, height: 2, bytesPerPixel: 4, bytesPerRow });
  assert.deepEqual([...unpacked.slice(0, 12)], Array(12).fill(7));
  assert.deepEqual([...unpacked.slice(12)], Array(12).fill(9));
  assert.throws(
    () => unpackAlignedRows({ source, width: 3, height: 2, bytesPerPixel: 4, bytesPerRow: 12 }),
    /alignment/,
  );
});

test('unknown controller routes throw instead of falling back', () => {
  const implementation = Object.fromEntries([
    'ready', 'setScenario', 'setMode', 'setTier', 'setSeed', 'setCamera', 'setTime', 'step',
    'resetHistory', 'resize', 'renderOnce', 'capturePixels', 'dispose',
  ].map((name) => [name, async () => {}]));
  implementation.describePipeline = () => ({});
  implementation.describeResources = () => ({});
  implementation.getMetrics = () => ({});
  const controller = createStrictLabController({
    schemaVersion: 2,
    scenarios: [{ id: 'known' }],
    modes: ['final'],
    tiers: [{ id: 'full' }],
    cameras: ['design'],
    seeds: [1],
  }, implementation);
  assert.throws(() => controller.setScenario('missing'), /unknown scenario/);
  assert.throws(() => controller.setTier('cheaper-invented-tier'), /unknown tier/);
});

test('duplicate semantic producers and ambiguous owners are rejected', () => {
  assert.throws(() => assertRuntimeOwnership({
    owners: { renderer: 'one,two' },
    signals: [
      { id: 'velocity', producer: 'camera' },
      { id: 'velocity', producer: 'motion' },
    ],
    finalToneMapOwner: 'pipeline',
    finalOutputTransformOwner: 'pipeline',
  }), /duplicate producers/);
});
