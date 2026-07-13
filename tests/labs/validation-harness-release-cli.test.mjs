import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { parseValidationHarnessReleaseCli } from '../../scripts/assemble-validation-harness-release.mjs';

const COMPLETE = [
  '--correctness', 'artifacts/correctness',
  '--physical', 'artifacts/physical.json',
  '--performance', 'artifacts/performance.json',
  '--output', 'artifacts/release-candidate',
];

test('validation-harness assembly CLI resolves four explicit immutable inputs', () => {
  const cwd = '/fixture/repository';
  assert.deepEqual(parseValidationHarnessReleaseCli(COMPLETE, cwd), {
    correctnessDirectory: resolve(cwd, 'artifacts/correctness'),
    physicalWrapperPath: resolve(cwd, 'artifacts/physical.json'),
    performanceWrapperPath: resolve(cwd, 'artifacts/performance.json'),
    outputDirectory: resolve(cwd, 'artifacts/release-candidate'),
  });
});

test('validation-harness assembly CLI rejects implicit, ambiguous, or aliased inputs', () => {
  const mutations = [
    ['missing lane', COMPLETE.slice(0, -2), /requires --output/],
    ['unknown argument', [...COMPLETE, '--latest', 'true'], /unknown/],
    ['duplicate argument', [...COMPLETE, '--output', 'other'], /duplicate/],
    ['missing value', [...COMPLETE.slice(0, -1)], /--output requires a path/],
    ['flag as value', [...COMPLETE.slice(0, -1), '--physical'], /--output requires a path/],
    ['same physical records', [
      '--correctness', 'correctness', '--physical', 'same.json', '--performance', 'same.json', '--output', 'release',
    ], /wrapper paths must be distinct/],
  ];
  for (const [name, argv, pattern] of mutations) {
    assert.throws(() => parseValidationHarnessReleaseCli(argv, '/fixture/repository'), pattern, name);
  }
});
