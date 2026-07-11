import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import {
  STANDARD_CAPTURE_OUTPUTS,
  assertCaptureArtifactBinding,
  assertCaptureRuntimeProfile,
  assertCaptureState,
  assertNoCaptureFailures,
  assertSymlinkConfinedPath,
  buildCaptureUrl,
  buildCaptureArtifactPayload,
  classifyAdapter,
  capturePixels,
  createCaptureWriteLedger,
  extractCaptureState,
  normalizePixelCapture,
  reconcileControllerNormalizedCapture,
  resolveCaptureSourceClosure,
  runtimeFailureMessages,
  validateCaptureOutputPlan,
  validateHookDerivedOutput,
  waitForPostDisposeObservations,
} from '../../scripts/capture-lab-browser.mjs';
import { encodeRgbaPng } from '../../scripts/lib/png-rgba.mjs';

function completeOutputPlan(overrides = {}) {
  return STANDARD_CAPTURE_OUTPUTS.map((filename) => {
    const id = filename.slice(0, -4);
    if (overrides[filename]) return overrides[filename];
    if (filename === 'final.design.png' || filename === 'diagnostics.mosaic.png') {
      return { id, status: 'CAPTURED', filename };
    }
    return {
      id,
      status: 'NOT_APPLICABLE',
      filename: null,
      reason: `${id} is outside this fixture's graph`,
      graphProof: { reachable: false, owner: 'fixture-pipeline' },
    };
  });
}

test('capture hooks must disposition every standard output without aliases', () => {
  const plan = validateCaptureOutputPlan(completeOutputPlan());
  assert.equal(plan.length, STANDARD_CAPTURE_OUTPUTS.length);
  assert.equal(plan[0].filename, 'final.design.png');
  assert.equal(plan[1].status, 'NOT_APPLICABLE');

  assert.throws(
    () => validateCaptureOutputPlan(completeOutputPlan().slice(0, -1)),
    /omits standard outputs: temporal\.t001\.png/,
  );
  assert.throws(
    () => validateCaptureOutputPlan(completeOutputPlan({
      'camera.near.png': {
        id: 'camera.near',
        status: 'SATISFIED_BY',
        filename: null,
        satisfiedBy: 'final.design.png',
      },
    })),
    /unsupported status SATISFIED_BY/,
  );
  assert.throws(
    () => validateCaptureOutputPlan(completeOutputPlan({
      'camera.near.png': {
        id: 'camera.near',
        status: 'NOT_APPLICABLE',
        filename: null,
        reason: 'fixture omission',
      },
    })),
    /requires graphProof/,
  );
  assert.throws(
    () => validateCaptureOutputPlan(completeOutputPlan({
      'final.design.png': {
        id: 'final.design',
        status: 'NOT_APPLICABLE',
        filename: null,
        reason: 'forged final omission',
        graphProof: { reachable: false },
      },
    })),
    /final\.design\.png is mandatory capture evidence/,
  );
  assert.throws(
    () => validateHookDerivedOutput(
      '/unused-output',
      createCaptureWriteLedger(),
      {
        standardOutputs: [{
          id: 'final.design',
          status: 'CAPTURED',
          filename: 'final.design.png',
          sourceCaptures: ['subject.final.png'],
        }],
      },
      { id: 'final.design', status: 'CAPTURED', filename: 'final.design.png' },
      ['subject.final.png'],
    ),
    /requires hook pixelEvidence with normalized readback derivation/,
  );
});

test('correctness and performance profiles are explicit route inputs', () => {
  assert.equal(
    buildCaptureUrl({ port: 4173, browserEntry: 'skill/examples/lab/index.html', profile: 'correctness' }),
    'http://127.0.0.1:4173/skill/examples/lab/index.html?capture=1&profile=correctness',
  );
  assert.equal(
    buildCaptureUrl({ port: 4173, browserEntry: 'skill/examples/lab/index.html', profile: 'performance' }),
    'http://127.0.0.1:4173/skill/examples/lab/index.html?capture=1&profile=performance',
  );
  assert.throws(
    () => buildCaptureUrl({ port: 4173, browserEntry: 'skill/lab.html', profile: 'invented' }),
    /unknown capture profile/,
  );
});

test('runtime profile and timestamp mode must match the requested capture lane', () => {
  const correctness = {
    metrics: {
      runtimeProfile: 'correctness',
      timestampQueriesRequired: false,
      timestampQueriesRequested: false,
      timestampQueriesActive: false,
    },
    pipeline: {
      runtimeProfile: 'correctness',
      timestampQueriesRequired: false,
      timestampQueriesRequested: false,
      timestampQueriesActive: false,
    },
  };
  assert.doesNotThrow(() => assertCaptureRuntimeProfile(correctness, 'correctness'));
  assert.throws(
    () => assertCaptureRuntimeProfile({
      metrics: { ...correctness.metrics, runtimeProfile: 'performance' },
      pipeline: correctness.pipeline,
    }, 'correctness'),
    /does not match capture profile/,
  );
  assert.throws(
    () => assertCaptureRuntimeProfile({
      metrics: { ...correctness.metrics, timestampQueriesActive: true },
      pipeline: correctness.pipeline,
    }, 'correctness'),
    /must be false for correctness capture/,
  );

  const performance = {
    metrics: {
      runtimeProfile: 'performance',
      performanceTimestampMode: 'auto',
      timestampQueriesRequested: true,
      timestampQueriesActive: true,
    },
    pipeline: {
      runtimeProfile: 'performance',
      performanceTimestampMode: 'auto',
      timestampQueriesRequested: true,
      timestampQueriesActive: true,
    },
  };
  assert.doesNotThrow(() => assertCaptureRuntimeProfile(performance, 'performance'));
  assert.throws(
    () => assertCaptureRuntimeProfile({
      metrics: { ...performance.metrics, timestampQueriesActive: false },
      pipeline: performance.pipeline,
    }, 'performance'),
    /must be true for performance capture/,
  );
  assert.throws(
    () => assertCaptureRuntimeProfile({
      metrics: { ...performance.metrics, performanceTimestampMode: 'disabled-for-cadence' },
      pipeline: performance.pipeline,
    }, 'performance'),
    /must be auto/,
  );
});

test('hook source closure is promoted verbatim and cannot forge Three or revision bindings', () => {
  const registryClosure = {
    algorithm: 'registry',
    threeRevision: '0.185.1',
    sourceHash: 'sha256:registry',
    buildRevision: 'sha256:build-registry',
  };
  const hookClosure = {
    algorithm: 'hook-transitive-closure',
    roots: ['lab/index.html'],
    files: [{ repositoryPath: 'lab/app.js', sha256: 'abc' }],
    threeRevision: '0.185.1',
    sourceHash: 'sha256:hook',
    buildRevision: 'source-sha256:hook',
  };
  assert.equal(resolveCaptureSourceClosure({}, registryClosure), registryClosure);
  assert.throws(
    () => resolveCaptureSourceClosure(
      { sourceClosure: hookClosure },
      registryClosure,
      {
        sourceClosureValidation: {
          recomputeProviderExported: true,
          validatorExported: true,
          preCaptureValidated: true,
          postCaptureValidated: true,
          hookResultValidated: true,
        },
      },
    ),
    /requires pre-capture and post-capture recomputation/,
  );
  assert.equal(resolveCaptureSourceClosure(
    { sourceClosure: hookClosure },
    registryClosure,
    {
      preCaptureSourceClosure: hookClosure,
      recomputedSourceClosure: hookClosure,
      sourceClosureValidation: {
        recomputeProviderExported: true,
        validatorExported: true,
        preCaptureValidated: true,
        postCaptureValidated: true,
        hookResultValidated: true,
      },
    },
  ), hookClosure);
  assert.throws(
    () => resolveCaptureSourceClosure(
      { sourceClosure: hookClosure },
      registryClosure,
      {
        preCaptureSourceClosure: hookClosure,
        recomputedSourceClosure: hookClosure,
        sourceClosureValidation: {
          recomputeProviderExported: true,
          validatorExported: false,
          preCaptureValidated: false,
          postCaptureValidated: false,
          hookResultValidated: false,
        },
      },
    ),
    /requires both recompute and validate providers/,
  );
  assert.throws(
    () => resolveCaptureSourceClosure(
      { sourceClosure: hookClosure },
      registryClosure,
      {
        preCaptureSourceClosure: hookClosure,
        recomputedSourceClosure: hookClosure,
        sourceClosureValidation: {
          recomputeProviderExported: true,
          validatorExported: true,
          preCaptureValidated: true,
          postCaptureValidated: true,
          hookResultValidated: false,
        },
      },
    ),
    /requires successful pre-capture, post-capture, and hook-result validation/,
  );
  assert.throws(
    () => resolveCaptureSourceClosure(
      { sourceClosure: hookClosure },
      registryClosure,
      {
        preCaptureSourceClosure: hookClosure,
        recomputedSourceClosure: { ...hookClosure, roots: ['lab/changed.html'] },
        sourceClosureValidation: {
          recomputeProviderExported: true,
          validatorExported: true,
          preCaptureValidated: true,
          postCaptureValidated: true,
          hookResultValidated: true,
        },
      },
    ),
    /drifted or was forged/,
  );
  assert.throws(
    () => resolveCaptureSourceClosure(
      { sourceClosure: { ...hookClosure, threeRevision: '0.184.0' } },
      registryClosure,
      {
        preCaptureSourceClosure: hookClosure,
        recomputedSourceClosure: hookClosure,
        sourceClosureValidation: {
          recomputeProviderExported: true,
          validatorExported: true,
          preCaptureValidated: true,
          postCaptureValidated: true,
          hookResultValidated: true,
        },
      },
    ),
    /Three revision 0\.184\.0 is not 0\.185\.1/,
  );
  assert.throws(
    () => resolveCaptureSourceClosure(
      { sourceClosure: { ...hookClosure, sourceHash: '' } },
      registryClosure,
      {
        preCaptureSourceClosure: hookClosure,
        recomputedSourceClosure: hookClosure,
        sourceClosureValidation: {
          recomputeProviderExported: true,
          validatorExported: true,
          preCaptureValidated: true,
          postCaptureValidated: true,
          hookResultValidated: true,
        },
      },
    ),
    /must expose sourceHash/,
  );
});

test('artifact write ledger distinguishes fresh session output from stale pre-existing files', () => {
  const ledger = createCaptureWriteLedger();
  assert.equal(ledger.has('final.design.png'), false);
  ledger.record('final.design.png', 'hook-artifact', { existedBefore: true });
  assert.equal(ledger.has('final.design.png'), true);
  assert.deepEqual(ledger.get('final.design.png'), {
    sequence: 1,
    path: 'final.design.png',
    kind: 'hook-artifact',
    existedBefore: true,
  });
  assert.throws(
    () => ledger.record('final.design.png', 'hook-artifact'),
    /more than once/,
  );
  assert.throws(
    () => ledger.record('../escaped.png', 'hook-artifact'),
    /escapes output/,
  );
  assert.equal(ledger.has('diagnostics.mosaic.png'), false, 'a stale file absent from the ledger is not fresh evidence');
});

test('realpath confinement rejects symbolic-link and resolved-path escapes', () => {
  const plainStat = { isSymbolicLink: () => false };
  const symlinkStat = { isSymbolicLink: () => true };
  const symlinkIo = {
    existsSync: (path) => new Set(['/sandbox', '/sandbox/link']).has(path),
    lstatSync: (path) => path === '/sandbox/link' ? symlinkStat : plainStat,
    realpathSync: (path) => path,
  };
  assert.throws(
    () => assertSymlinkConfinedPath('/sandbox/link/final.design.png', '/sandbox', symlinkIo),
    /symbolic-link path component is forbidden/,
  );

  const escapedIo = {
    existsSync: () => true,
    lstatSync: () => plainStat,
    realpathSync: (path) => path === '/sandbox/evidence' ? '/outside/evidence' : path,
  };
  assert.throws(
    () => assertSymlinkConfinedPath('/sandbox/evidence/final.design.png', '/sandbox', escapedIo),
    /real path escapes its confined root/,
  );
});

test('post-dispose observation waits two animation frames before reading error channels', async () => {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    requestAnimationFrame: globalThis.requestAnimationFrame,
  };
  let frames = 0;
  try {
    globalThis.window = {
      __LAB_ERROR__: null,
      __LAB_GPU_EVENTS__: { uncapturedErrors: [] },
      __LAB_DEVICE_ERRORS__: [],
    };
    globalThis.document = { visibilityState: 'visible' };
    globalThis.requestAnimationFrame = (callback) => {
      frames += 1;
      callback(frames);
      return frames;
    };
    const page = { evaluate: async (callback) => callback() };
    const snapshot = await waitForPostDisposeObservations(page);
    assert.equal(frames, 2);
    assert.equal(snapshot.visibilityState, 'visible');
    assert.deepEqual(snapshot.gpuEvents, { uncapturedErrors: [] });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});

test('capture artifacts retain transport bytes while PNG uses independently normalized top-left rows', () => {
  const bottomRow = [255, 0, 0, 255, 0, 255, 0, 255];
  const topRow = [0, 0, 255, 255, 255, 255, 255, 255];
  const source = Uint8Array.from([...bottomRow, ...topRow]);
  const capture = normalizePixelCapture({
    target: 'final',
    width: 2,
    height: 2,
    bytesPerPixel: 4,
    format: 'rgba8unorm',
    outputColorSpace: 'srgb',
    origin: 'bottom-left',
    data: source,
  });
  assert.equal(capture.sourceOrigin, 'bottom-left');
  assert.equal(capture.origin, 'top-left');
  assert.equal(capture.orientationTransform, 'vertical-row-flip');
  assert.deepEqual([...capture.transportData], [...source]);
  assert.deepEqual([...capture.data], [...topRow, ...bottomRow]);

  const topLeftCapture = normalizePixelCapture({
    target: 'final',
    width: 2,
    height: 2,
    bytesPerPixel: 4,
    format: 'rgba8unorm',
    outputColorSpace: 'srgb',
    origin: 'top-left',
    data: Uint8Array.from([...topRow, ...bottomRow]),
  });
  assert.equal(topLeftCapture.orientationTransform, 'none');
  assert.deepEqual([...topLeftCapture.data], [...topRow, ...bottomRow]);

  const payload = buildCaptureArtifactPayload(capture, 'final.design.png');
  assert.equal(payload.transport.layout.origin, 'bottom-left');
  assert.equal(payload.transport.layout.layout, 'compact');
  assert.equal(payload.transport.layout.rowBytes, 8);
  assert.equal(payload.transport.layout.bytesPerRow, 8);
  assert.equal(payload.transport.layout.paddingKind, 'compact');
  assert.equal(payload.transport.layout.paddingBytesPerRow, 0);
  assert.equal(payload.transport.rendererCopy.rawBytesRetained, true);
  assert.equal(payload.normalized.compact.origin, 'top-left');
  assert.equal(payload.normalized.bytesPerRow, 256);
  assert.equal(payload.normalized.byteLength, 512);
  assert.deepEqual([...payload.transport.data], [...source]);
  assert.deepEqual([...payload.normalized.data], [...topRow, ...bottomRow]);
  assert.equal(payload.normalized.paddedData.byteLength, 512);
  assert.doesNotThrow(() => assertCaptureArtifactBinding(payload));

  const serialized = JSON.stringify({
    transport: payload.transport,
    normalized: payload.normalized,
  });
  assert.doesNotMatch(serialized, /"data"|"paddedData"/);
});

test('controller-normalized bytes must exactly reconcile with independent transport normalization', () => {
  const compactPixels = Uint8Array.from([
    1, 2, 3, 255, 4, 5, 6, 255,
    7, 8, 9, 255, 10, 11, 12, 255,
  ]);
  const capture = normalizePixelCapture({
    width: 2,
    height: 2,
    bytesPerPixel: 4,
    format: 'rgba8unorm',
    outputColorSpace: 'srgb',
    origin: 'top-left',
    data: compactPixels,
  });
  const padded = new Uint8Array(512);
  padded.set(compactPixels.subarray(0, 8), 0);
  padded.set(compactPixels.subarray(8), 256);
  const controller = {
    layout: {
      width: 2,
      height: 2,
      format: 'rgba8unorm',
      origin: 'top-left',
      rowBytes: 8,
      bytesPerRow: 256,
      byteLength: 512,
    },
    sourceElementBytes: 1,
    data: padded,
  };
  const reconciled = reconcileControllerNormalizedCapture(capture, controller);
  assert.equal(reconciled.reconciliationStatus, 'PASS');
  assert.equal(reconciled.paddingVerifiedZero, true);
  assert.equal(reconciled.paddingBytesPerRow, 248);
  assert.deepEqual([...reconciled.data], [...compactPixels]);

  const wrongPixel = Uint8Array.from(padded);
  wrongPixel[256] ^= 1;
  assert.throws(
    () => reconcileControllerNormalizedCapture(capture, { ...controller, data: wrongPixel }),
    /pixels differ from independent transport normalization/,
  );
  const nonzeroPadding = Uint8Array.from(padded);
  nonzeroPadding[8] = 1;
  assert.throws(
    () => reconcileControllerNormalizedCapture(capture, { ...controller, data: nonzeroPadding }),
    /padding is nonzero/,
  );
  assert.throws(
    () => reconcileControllerNormalizedCapture(capture, {
      ...controller,
      layout: { ...controller.layout, origin: 'bottom-left' },
    }),
    /pixels differ from independent transport normalization/,
  );
});

test('nested controller transport wins over compatibility pixels and remains independently auditable', async () => {
  const previousWindow = globalThis.window;
  const page = { evaluate: async (callback, argument) => callback(argument) };
  const transport = Uint8Array.from([10, 20, 30, 255, 40, 50, 60, 255]);
  const controllerNormalized = Uint8Array.from([10, 20, 30, 255, 40, 50, 60, 255]);
  try {
    globalThis.window = {
      __THREE_LAB__: {
        capturePixels: async (target) => ({
          target,
          width: 2,
          height: 1,
          bytesPerPixel: 4,
          outputColorSpace: 'srgb',
          origin: 'top-left',
          pixels: [1, 1, 1, 255, 2, 2, 2, 255],
          transport: {
            layout: {
              width: 2,
              height: 1,
              format: 'rgba8unorm',
              rowBytes: 8,
              bytesPerRow: 8,
              byteLength: 8,
              padding: 'compact',
            },
            pixels: transport,
          },
          normalized: {
            layout: {
              width: 2,
              height: 1,
              format: 'rgba8unorm',
              rowBytes: 8,
              bytesPerRow: 8,
              byteLength: 8,
            },
            pixels: controllerNormalized,
          },
        }),
      },
    };
    const capture = await capturePixels(page, 'final');
    assert.deepEqual([...capture.transportData], [...transport]);
    assert.deepEqual([...capture.data], [...transport]);
    assert.deepEqual([...capture.controllerNormalized.data], [...controllerNormalized]);
    assert.equal(capture.controllerNormalized.reconciliationStatus, 'PASS');
    assert.equal(capture.transportPadding, 'compact');
    assert.equal(capture.transportLayout, 'compact');
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('forged PNG and normalized readback bytes fail their independent binding', () => {
  const capture = normalizePixelCapture({
    target: 'final',
    width: 2,
    height: 1,
    bytesPerPixel: 4,
    format: 'rgba8',
    colorSpace: 'srgb',
    data: Uint8Array.from([12, 34, 56, 255, 210, 180, 90, 255]),
  });
  const payload = buildCaptureArtifactPayload(capture, 'final.design.png');
  const forgedPng = Uint8Array.from(payload.bytes.png);
  forgedPng[forgedPng.length - 1] ^= 1;
  assert.throws(
    () => assertCaptureArtifactBinding(payload, { pngBytes: forgedPng }),
    /PNG hash does not match capture metadata/,
  );

  const validButWrongPng = encodeRgbaPng({
    width: 2,
    height: 1,
    data: Uint8Array.from([90, 10, 200, 255, 20, 220, 40, 255]),
  });
  assert.throws(
    () => assertCaptureArtifactBinding(payload, { pngBytes: validButWrongPng }),
    /PNG hash does not match capture metadata/,
  );
  const selfConsistentForgedPayload = {
    ...payload,
    png: {
      ...payload.png,
      byteLength: validButWrongPng.byteLength,
      sha256: `sha256:${createHash('sha256').update(validButWrongPng).digest('hex')}`,
    },
    bytes: { ...payload.bytes, png: validButWrongPng },
  };
  assert.throws(
    () => assertCaptureArtifactBinding(selfConsistentForgedPayload),
    /PNG is not derived byte-for-byte from the normalized compact readback/,
  );

  const forgedNormalized = Uint8Array.from(payload.bytes.normalized);
  forgedNormalized[0] ^= 1;
  assert.throws(
    () => assertCaptureArtifactBinding(payload, { normalizedBytes: forgedNormalized }),
    /normalized padded readback hash does not match capture metadata/,
  );
});

test('capture state extraction freezes canonical route fields and rejects silent fallback', () => {
  const metrics = {
    routeSelection: {
      scenario: 'wall',
      mode: 'final',
      tier: 'high',
      camera: 'design',
      seed: 1,
      timeSeconds: 0,
    },
  };
  const state = extractCaptureState(metrics);
  assert.deepEqual(state, {
    scenario: 'wall',
    mode: 'final',
    tier: 'high',
    camera: 'design',
    seed: 1,
    timeSeconds: 0,
  });
  assert.doesNotThrow(() => assertCaptureState(state, state));
  assert.throws(
    () => assertCaptureState({ ...state, tier: 'mobile' }, state),
    /tier=mobile does not match locked high/,
  );
  assert.throws(
    () => assertCaptureState({ ...state, camera: null }, state),
    /omitted locked capture state camera/,
  );
});

test('browser, request, and device failures remain independent blocking channels', () => {
  const runtime = {
    metrics: {
      rendererInfo: {
        backend: {
          uncapturedErrors: [{ message: 'validation error' }],
          deviceLostObserved: false,
        },
      },
      deviceErrorCount: 1,
      frameErrorCount: 1,
      lifecycleErrorCount: 1,
      lastLifecycleError: { message: 'teardown uncertainty' },
      diagnosticRetentionLimits: { deviceErrors: 32, frameErrors: 64 },
    },
  };
  const failures = runtimeFailureMessages(runtime);
  assert.equal(failures.length, 5);
  assert.ok(failures.some((message) => message.includes('uncapturedErrors')));
  assert.ok(failures.some((message) => message.includes('deviceErrorCount')));
  assert.ok(failures.some((message) => message.includes('frameErrorCount')));
  assert.ok(failures.some((message) => message.includes('lastLifecycleError')));
  assert.ok(!failures.some((message) => message.includes('diagnosticRetentionLimits')));
  assert.throws(
    () => assertNoCaptureFailures({
      pageErrors: ['page exception'],
      consoleErrors: ['console exception'],
      requestErrors: ['500 GET /broken'],
      runtime,
    }),
    /page exception[\s\S]*console exception[\s\S]*500 GET \/broken[\s\S]*deviceErrorCount/,
  );
  assert.doesNotThrow(() => assertNoCaptureFailures({
    runtime: {
      metrics: {
        deviceErrorCount: 0,
        frameErrorCount: 0,
        lifecycleErrorCount: 0,
        uncapturedErrors: [],
        deviceLostObserved: false,
        diagnosticRetentionLimits: { deviceErrors: 32, frameErrors: 64 },
      },
    },
  }));
});

test('software adapters are identified without inventing a hardware label', () => {
  assert.equal(classifyAdapter({ adapterClass: 'hardware' }), 'hardware');
  assert.equal(classifyAdapter({ adapterIdentity: { description: 'Google SwiftShader' } }), 'software');
  assert.equal(classifyAdapter({ adapterIdentity: { description: 'Unexposed adapter' } }), 'unknown');
});
