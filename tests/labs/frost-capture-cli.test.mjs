import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFrostCaptureOptions, runFrostCapture } from '../../threejs-dynamic-surface-effects/examples/webgpu-touch-history-frost/capture-frost-evidence.mjs';

test('Frost capture validates forwarded options before starting a browser', () => {
  assert.equal(parseFrostCaptureOptions().profile, 'correctness');
  assert.match(parseFrostCaptureOptions(['--profile', 'performance']).outputDir, /performance$/);
  for (const args of [['--profile'], ['--profile', 'other'], ['--unknown', 'value'], ['--profile', 'correctness', '--profile', 'performance']]) {
    assert.throws(() => parseFrostCaptureOptions(args));
  }
});

test('Frost correctness retains its recipes and finalizer', async () => {
  const calls = [];
  const result = await runFrostCapture(['--profile', 'correctness'], {
    capture: async options => { calls.push(options); return { labId: options.labId, profile: options.profile }; },
    finalize: async (session, outputDir) => {
      calls.push({ session, outputDir });
      return { protocol: 'unified-v2', valid: true, manifest: { claimVerdicts: {} }, canonicalAcceptanceEligible: false };
    },
  });
  assert.equal(calls.length, 2);
  assert.match(calls[0].hookPath, /capture-hook\.mjs$/);
  assert.equal(calls[1].outputDir, calls[0].outputDir);
  assert.equal(result.profile, 'correctness');
});

test('Frost performance uses the requested lane without correctness certification', async () => {
  let observed;
  const result = await runFrostCapture(['--profile', 'performance'], {
    capture: async options => { observed = options; return { labId: options.labId, profile: options.profile }; },
    finalize: async () => { throw new Error('Correctness finalizer must not run'); },
  });
  assert.equal(observed.profile, 'performance');
  assert.equal(observed.hookPath, null);
  assert.match(observed.outputDir, /performance$/);
  assert.equal(result.record, 'capture-session');
  assert.equal(result.canonicalAcceptanceEligible, false);
  assert.equal(result.claimVerdicts, undefined);
});

test('Frost capture refuses a substituted profile', async () => {
  await assert.rejects(runFrostCapture(['--profile', 'performance'], {
    capture: async () => ({ profile: 'correctness' }),
    finalize: async () => { throw new Error('Must not finalize'); },
  }), /wrong profile/);
});
