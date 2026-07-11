import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FALLBACK_CAPTURE_POLICY_MARKER,
  NON_RENDERING_CAPTURE_POLICY,
  auditCaptureWiring,
  checkCaptureImplementation,
} from '../../scripts/check-capture-wiring.mjs';

const SHARED_SOURCE = `
  import { captureLabBrowser } from '../../../scripts/capture-lab-browser.mjs';
  const index = process.argv.indexOf('--profile');
  await captureLabBrowser({ labId: 'fixture', profile: index >= 0 ? process.argv[index + 1] : 'correctness' });
`;

test('shared wrappers accept forwarded profiles and rely on the shared final PNG', () => {
  assert.deepEqual(checkCaptureImplementation({
    id: 'fixture',
    packageCapture: 'node capture.mjs',
    captureSource: SHARED_SOURCE,
    captureProgramPath: '/repo/fixture/capture.mjs',
  }), []);
});

test('direct shared commands cannot hard-code correctness over the requested profile', () => {
  const errors = checkCaptureImplementation({
    id: 'fixture',
    packageCapture: 'node ../../../scripts/capture-lab-browser.mjs --lab fixture --profile correctness',
    captureSource: 'export async function captureLabBrowser() {}',
    captureProgramPath: '/repo/scripts/capture-lab-browser.mjs',
  });
  assert.match(errors.join('\n'), /hard-codes a profile/);
});

test('shared hooks must exist and emit the standard final image', () => {
  const missingFinal = checkCaptureImplementation({
    id: 'fixture',
    packageCapture: 'node capture.mjs',
    captureSource: `${SHARED_SOURCE}\nconst hookPath = './capture-hook.mjs';`,
    captureProgramPath: '/repo/fixture/capture.mjs',
    hookSourceRecords: [{ path: '/repo/fixture/capture-hook.mjs', source: 'export function captureLab() {}' }],
  });
  assert.match(missingFinal.join('\n'), /does not write final\.design\.png/);

  const valid = checkCaptureImplementation({
    id: 'fixture',
    packageCapture: 'node capture.mjs',
    captureSource: `${SHARED_SOURCE}\nconst hookPath = './capture-hook.mjs';`,
    captureProgramPath: '/repo/fixture/capture.mjs',
    hookSourceRecords: [{
      path: '/repo/fixture/capture-hook.mjs',
      source: `export async function captureLab(session) { await session.writeCapture('final.design.png', 'final'); }`,
    }],
  });
  assert.deepEqual(valid, []);
});

test('status-only, external-server, and cross-package capture commands are rejected', () => {
  const status = checkCaptureImplementation({
    id: 'fixture',
    packageCapture: 'node capture-status.mjs',
    captureSource: `console.error('INSUFFICIENT_EVIDENCE: no current adapter capture');`,
    captureProgramPath: '/repo/fixture/capture-status.mjs',
  });
  assert.match(status.join('\n'), /status-only/);

  const external = checkCaptureImplementation({
    id: 'fixture',
    packageCapture: 'node capture.mjs',
    captureSource: `if (!process.env.LAB_URL) throw new Error('set LAB_URL');`,
    captureProgramPath: '/repo/fixture/capture.mjs',
  });
  assert.match(external.join('\n'), /LAB_URL/);

  const delegated = checkCaptureImplementation({
    id: 'fixture',
    packageCapture: 'npm --prefix ../other-lab run capture',
  });
  assert.match(delegated.join('\n'), /another npm package/);
});

test('bespoke capture policy requires server, profiles, readback stride, and PNG output', () => {
  const incomplete = checkCaptureImplementation({
    id: 'fixture',
    packageCapture: 'node capture.mjs',
    captureSource: `import { chromium } from 'playwright'; const profile = '--profile';`,
    captureProgramPath: '/repo/fixture/capture.mjs',
  });
  const message = incomplete.join('\n');
  assert.match(message, /does not self-serve/);
  assert.match(message, /1200x800 and 1920x1080/);
  assert.match(message, /final\.design\.png/);
  assert.match(message, /render-target readback/);
});

test('fixture-driven non-rendering suites and fallback harness use explicit exceptional policies', () => {
  assert.deepEqual(checkCaptureImplementation({
    id: 'router-manifest-lab',
    nonRendering: true,
    packageCapture: 'node router-manifest.test.mjs',
    captureSource: 'fixture driven router-manifest test',
  }), []);
  assert.deepEqual(checkCaptureImplementation({
    id: 'debugging-contract-lab',
    nonRendering: true,
    packageCapture: 'node contract-lab.test.mjs',
    captureSource: 'fixture driven debugging contract test',
  }), []);

  const fallbackSource = `
    const FALLBACK_CAPTURE_POLICY = '${FALLBACK_CAPTURE_POLICY_MARKER}';
    const profileFlag = '--profile';
    const server = createServer({});
    await server.listen();
  `;
  assert.deepEqual(checkCaptureImplementation({
    id: 'browser-fallback-harness',
    packageCapture: 'node capture.mjs',
    captureSource: fallbackSource,
    captureProgramPath: '/repo/fallback/capture.mjs',
  }), []);

  const invalid = checkCaptureImplementation({
    id: 'empty-non-rendering-lab',
    nonRendering: true,
  });
  assert.match(invalid.join('\n'), /no executable capture command/);
});

test('the live registry has one statically auditable capture policy per primary demo', () => {
  const result = auditCaptureWiring();
  assert.equal(result.primaryCount, 40);
  assert.deepEqual(result.records.map(({ id }) => id).sort(), [...new Set(result.records.map(({ id }) => id))].sort());
  assert.deepEqual(result.errors, []);
  assert.equal(result.records.filter(({ policy }) => policy === NON_RENDERING_CAPTURE_POLICY).length, 2);
});
