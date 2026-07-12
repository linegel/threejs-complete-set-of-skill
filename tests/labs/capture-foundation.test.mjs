import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import {
  CAPTURE_PROFILES,
  LAB_CONTROLLER_GLOBALS,
  awaitCanonicalReady,
  backendProven,
  captureLabBrowser,
  capturePixels,
  captureRecipePixels,
  controllerCall,
  normalizeCaptureEvidence,
  normalizePixelCapture,
} from '../../scripts/capture-lab-browser.mjs';
import { encodeRgbaPng } from '../../scripts/lib/png-rgba.mjs';

function pngChunks(png) {
  const chunks = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    chunks.push({ type, data: png.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
  }
  return chunks;
}

test('shared capture profiles freeze the prescribed dimensions', () => {
  assert.deepEqual(CAPTURE_PROFILES.correctness, { width: 1200, height: 800, dpr: 1 });
  assert.deepEqual(CAPTURE_PROFILES.performance, { width: 1920, height: 1080, dpr: 1 });
  assert.equal(Object.isFrozen(CAPTURE_PROFILES.correctness), true);
});

test('shared capture requires one consistent initialized native-WebGPU device identity', () => {
  const proof = {
    backend: 'webgpu',
    backendKind: 'webgpu',
    nativeWebGPU: true,
    initialized: true,
    rendererInfo: { rendererType: 'WebGPURenderer', backendType: 'WebGPUBackend' },
    rendererBackendEvidence: {
      backendKind: 'webgpu',
      backendType: 'WebGPUBackend',
      deviceType: 'GPUDevice',
      deviceIdentitySource: 'renderer.backend.device-after-init',
      deviceIdentityVerified: true,
      lossPromiseObservedOnActualDevice: true,
      rendererDeviceGeneration: 1,
    },
    rendererDeviceStatus: 'active',
    rendererDeviceGeneration: 1,
    deviceLossGeneration: 0,
  };
  assert.equal(backendProven(proof), true);
  for (const forged of [
    { backend: 'webgpu' },
    { nativeWebGPU: true },
    { initialized: true },
    { rendererInfo: { rendererType: 'WebGPURenderer', backendType: 'WebGPUBackend' } },
    { rendererBackendEvidence: proof.rendererBackendEvidence },
  ]) assert.equal(backendProven(forged), false);
  assert.equal(backendProven({ ...proof, backend: 'webgl' }), false);
  assert.equal(backendProven({ ...proof, nativeWebGPU: false }), false);
  assert.equal(backendProven({ ...proof, rendererBackendEvidence: { ...proof.rendererBackendEvidence, deviceIdentityVerified: false } }), false);
  assert.equal(backendProven({ ...proof, rendererDeviceGeneration: 2 }), false);
});

test('shared capture rejects unknown profiles before starting a browser', async () => {
  await assert.rejects(
    captureLabBrowser({ labId: 'not-opened', profile: 'invented' }),
    /unknown capture profile: invented/,
  );
});

test('shared capture respects page-owned initialization and never calls ready twice', async () => {
  const previousWindow = globalThis.window;
  let readyCalls = 0;
  const page = { evaluate: async (callback, argument) => callback(argument) };
  try {
    globalThis.window = {
      __LAB_READY__: Promise.resolve(),
      labController: { ready: async () => { readyCalls += 1; } },
    };
    await awaitCanonicalReady(page);
    assert.equal(readyCalls, 0);

    delete globalThis.window.__LAB_READY__;
    await awaitCanonicalReady(page);
    assert.equal(readyCalls, 1);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('shared capture resolves the validation and space LabController aliases', async () => {
  const previousWindow = globalThis.window;
  const page = { evaluate: async (callback, argument) => callback(argument) };
  try {
    assert.ok(LAB_CONTROLLER_GLOBALS.includes('__THREEJS_LAB__'));
    assert.ok(LAB_CONTROLLER_GLOBALS.includes('__THREE_LAB__'));
    for (const alias of ['__THREEJS_LAB__', '__THREE_LAB__']) {
      globalThis.window = {
        [alias]: { identify: async (prefix) => `${prefix}:${alias}` },
      };
      assert.equal(await controllerCall(page, 'identify', ['controller']), `controller:${alias}`);
    }
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('shared capture reads pixels through the space alias and typed-array width inference', async () => {
  const previousWindow = globalThis.window;
  const page = { evaluate: async (callback, argument) => callback(argument) };
  const pixels = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255]);
  try {
    globalThis.window = {
      __THREE_LAB__: {
        capturePixels: async (target) => ({
          target,
          width: 2,
          height: 1,
          bytesPerRow: 256,
          sourceByteLength: 256,
          outputColorSpace: 'srgb',
          pixels,
        }),
      },
    };
    const capture = await capturePixels(page, 'final');
    assert.equal(capture.bytesPerPixel, 4);
    assert.equal(capture.bytesPerRow, 8);
    assert.equal(capture.sourceBytesPerRow, 256);
    assert.equal(capture.sourceByteLength, 256);
    assert.equal(capture.transportByteLength, 8);
    assert.equal(capture.sourceLayout, 'compacted-from-padded');
    assert.deepEqual([...capture.data], [...pixels]);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('shared capture preserves a deeply immutable JSON evidence envelope', async () => {
  const previousWindow = globalThis.window;
  const page = { evaluate: async (callback, argument) => callback(argument) };
  const pixels = Uint8Array.from([12, 34, 56, 255]);
  const evidence = {
    recipe: {
      id: 'final.design',
      schemaVersion: 1,
      digest: `sha256:${'a'.repeat(64)}`,
    },
    effectiveState: {
      tier: 'webgpu-correctness',
      viewport: { width: 1200, height: 800, dpr: 1 },
      passScale: 1,
    },
    resources: { renderTargets: [{ id: 'capture-target', bytes: 3840000 }] },
    restoration: {
      status: 'PASS',
      beforeStateDigest: `sha256:${'b'.repeat(64)}`,
      afterStateDigest: `sha256:${'b'.repeat(64)}`,
    },
  };
  try {
    globalThis.window = {
      __THREEJS_LAB__: {
        capturePixels: async (target) => ({
          target,
          width: 1,
          height: 1,
          bytesPerPixel: 4,
          format: 'rgba8unorm',
          outputColorSpace: 'srgb',
          pixels,
          evidence,
        }),
      },
    };
    const capture = await capturePixels(page, 'final.design');
    assert.deepEqual(capture.evidence, evidence);
    assert.equal(Object.isFrozen(capture.evidence), true);
    assert.equal(Object.isFrozen(capture.evidence.effectiveState.viewport), true);
    assert.equal(Object.isFrozen(capture.evidence.resources.renderTargets), true);
    evidence.effectiveState.tier = 'mutated-after-capture';
    evidence.resources.renderTargets.push({ id: 'late-target', bytes: 4 });
    evidence.restoration.status = 'FAIL';
    assert.equal(capture.evidence.effectiveState.tier, 'webgpu-correctness');
    assert.deepEqual(capture.evidence.resources.renderTargets, [{ id: 'capture-target', bytes: 3840000 }]);
    assert.equal(capture.evidence.restoration.status, 'PASS');
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('recipe capture uses the explicit controller method and enforces recipe identity', async () => {
  const previousWindow = globalThis.window;
  const page = { evaluate: async (callback, argument) => callback(argument) };
  const pixels = Uint8Array.from([21, 43, 65, 255]);
  try {
    globalThis.window = {
      __THREEJS_LAB__: {
        captureRecipe: async (recipeId) => ({
          target: recipeId,
          width: 1,
          height: 1,
          bytesPerPixel: 4,
          format: 'rgba8unorm',
          outputColorSpace: 'srgb',
          pixels,
          evidence: { recipe: { id: recipeId }, restoration: { status: 'PASS' } },
        }),
      },
    };
    const capture = await captureRecipePixels(page, 'camera.near');
    assert.equal(capture.target, 'camera.near');
    assert.equal(capture.evidence.recipe.id, 'camera.near');

    globalThis.window.__THREEJS_LAB__.captureRecipe = async () => ({
      target: 'final.design',
      width: 1,
      height: 1,
      bytesPerPixel: 4,
      format: 'rgba8unorm',
      outputColorSpace: 'srgb',
      pixels,
    });
    await assert.rejects(
      captureRecipePixels(page, 'camera.near'),
      /capture target final\.design for requested recipe camera\.near/,
    );
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('capture evidence rejects non-JSON, lossy, and cyclic values', () => {
  const cyclic = {};
  cyclic.self = cyclic;
  const accessor = {};
  Object.defineProperty(accessor, 'value', { enumerable: true, get: () => 1 });
  const nonEnumerable = {};
  Object.defineProperty(nonEnumerable, 'value', { enumerable: false, value: 1 });
  const symbolKey = { value: 1 };
  symbolKey[Symbol('hidden')] = true;
  const sparseArray = [];
  sparseArray.length = 1;
  const extraArrayProperty = [];
  extraArrayProperty.extra = true;
  const nonPlain = Object.create({ inherited: true });
  nonPlain.value = 1;
  const dangerousKey = {};
  Object.defineProperty(dangerousKey, '__proto__', { enumerable: true, value: 'forbidden' });
  for (const [evidence, message] of [
    [{ value: Number.NaN }, /losslessly serializable JSON numbers/],
    [{ value: -0 }, /losslessly serializable JSON numbers/],
    [{ value: undefined }, /unsupported undefined data/],
    [{ value: Symbol('value') }, /unsupported symbol data/],
    [{ value: () => true }, /unsupported function data/],
    [{ value: 1n }, /unsupported bigint data/],
    [{ bytes: new Uint8Array(4) }, /contains binary data/],
    [{ date: new Date(0) }, /plain JSON objects/],
    [accessor, /must be enumerable plain JSON data/],
    [nonEnumerable, /must be enumerable plain JSON data/],
    [symbolKey, /symbol-keyed property/],
    [{ value: sparseArray }, /sparse array entry at 0/],
    [{ value: extraArrayProperty }, /non-JSON array property/],
    [nonPlain, /plain JSON objects/],
    [dangerousKey, /__proto__ is a forbidden evidence key/],
    [cyclic, /cyclic object reference/],
  ]) assert.throws(() => normalizeCaptureEvidence(evidence), message);
  assert.throws(() => normalizeCaptureEvidence([]), /must be a plain JSON object/);
});

test('compact RGBA8 payload wins over padded-copy metadata without re-unpacking', () => {
  const pixels = Uint8Array.from({ length: 24 }, (_, index) => index);
  const capture = normalizePixelCapture({
    target: 'final',
    width: 3,
    height: 2,
    bytesPerPixel: 4,
    bytesPerRow: 256,
    format: 'rgba8unorm',
    colorSpace: 'srgb',
    data: pixels,
  });
  assert.equal(capture.bytesPerRow, 12);
  assert.equal(capture.sourceBytesPerRow, 256);
  assert.equal(capture.sourceByteLength, null);
  assert.equal(capture.transportByteLength, 24);
  assert.equal(capture.sourceLayout, 'compacted-from-padded');
  assert.deepEqual([...capture.data], [...pixels]);
});

test('compact browser transport preserves the original padded GPU-copy length', () => {
  const pixels = Uint8Array.from({ length: 24 }, (_, index) => index);
  const capture = normalizePixelCapture({
    target: 'final',
    width: 3,
    height: 2,
    bytesPerPixel: 4,
    sourceBytesPerRow: 256,
    sourceByteLength: 268,
    format: 'rgba8unorm',
    colorSpace: 'srgb',
    data: pixels,
  });
  assert.equal(capture.bytesPerRow, 12);
  assert.equal(capture.sourceBytesPerRow, 256);
  assert.equal(capture.sourceByteLength, 268);
  assert.equal(capture.transportByteLength, 24);
  assert.equal(capture.sourceLayout, 'compacted-from-padded');
  assert.deepEqual([...capture.data], [...pixels]);
});

test('real 256-byte padded rows are compacted with the integer source stride', () => {
  const source = new Uint8Array(256 + 12);
  const expected = Uint8Array.from({ length: 24 }, (_, index) => index + 1);
  source.set(expected.subarray(0, 12), 0);
  source.set(expected.subarray(12), 256);
  const capture = normalizePixelCapture({
    target: 'final',
    width: 3,
    height: 2,
    bytesPerTexel: 4,
    sourceBytesPerRow: 256,
    format: 'rgba8',
    colorSpace: 'srgb',
    pixels: source,
  });
  assert.equal(capture.bytesPerRow, 12);
  assert.equal(capture.sourceBytesPerRow, 256);
  assert.equal(capture.sourceByteLength, 268);
  assert.equal(capture.transportByteLength, 268);
  assert.equal(capture.sourceLayout, 'padded');
  assert.deepEqual([...capture.data], [...expected]);
});

test('RGBA byte width is inferred from explicit, row, and typed-array metadata', () => {
  const common = {
    width: 1,
    height: 1,
    outputColorSpace: 'srgb',
    data: Uint8Array.from([1, 2, 3, 255]),
  };
  const variants = [
    { bytesPerPixel: { value: 4 } },
    { bytesPerTexel: 4 },
    { rowBytes: 4 },
    { packedRowBytes: 4 },
    {},
  ];
  for (const variant of variants) {
    assert.equal(normalizePixelCapture({ ...common, ...variant }).bytesPerPixel, 4);
  }
});

test('shared capture rejects inconsistent lengths, strides, formats, and color metadata', () => {
  const color = { outputColorSpace: 'srgb' };
  assert.throws(
    () => normalizePixelCapture({
      width: 3,
      height: 2,
      bytesPerPixel: 4,
      bytesPerRow: 256,
      data: new Uint8Array(25),
      ...color,
    }),
    /expected compact 24, short-padded 268, or full-padded 512/,
  );
  assert.throws(
    () => normalizePixelCapture({
      width: 3,
      height: 2,
      bytesPerPixel: 4,
      bytesPerRow: 20,
      data: new Uint8Array(32),
      ...color,
    }),
    /does not satisfy WebGPU copy alignment/,
  );
  assert.throws(
    () => normalizePixelCapture({
      width: 3,
      height: 2,
      bytesPerPixel: 4,
      bytesPerRow: 256,
      sourceBytesPerRow: 512,
      data: new Uint8Array(24),
      ...color,
    }),
    /conflicting padded source strides/,
  );
  assert.throws(
    () => normalizePixelCapture({
      width: 3,
      height: 2,
      bytesPerPixel: 4,
      sourceBytesPerRow: 256,
      sourceByteLength: 269,
      data: new Uint8Array(24),
      ...color,
    }),
    /sourceByteLength is 269 bytes; expected short-padded 268 or full-padded 512/,
  );
  assert.throws(
    () => normalizePixelCapture({
      width: 3,
      height: 2,
      bytesPerPixel: 4,
      sourceBytesPerRow: 256,
      sourceByteLength: 512,
      data: new Uint8Array(268),
      ...color,
    }),
    /sourceByteLength 512 does not match transported source data 268/,
  );
  assert.throws(
    () => normalizePixelCapture({
      width: 1,
      height: 1,
      bytesPerPixel: 4,
      bytesPerTexel: 8,
      data: new Uint8Array(4),
      ...color,
    }),
    /byte-width metadata is inconsistent/,
  );
  assert.throws(
    () => normalizePixelCapture({
      width: 1,
      height: 1,
      data: new Uint16Array(4),
      ...color,
    }),
    /requires byte-addressed RGBA8 pixels/,
  );
  assert.throws(
    () => normalizePixelCapture({
      width: 1,
      height: 1,
      bytesPerPixel: 4,
      format: 'rgba16float',
      colorManaged: true,
      data: new Uint8Array(4),
    }),
    /requires RGBA8 format/,
  );
  assert.throws(
    () => normalizePixelCapture({
      width: 1,
      height: 1,
      bytesPerPixel: 4,
      data: new Uint8Array(4),
    }),
    /requires explicit color-managed output metadata/,
  );
  assert.throws(
    () => normalizePixelCapture({
      width: 1,
      height: 1,
      bytesPerPixel: 4,
      colorSpace: 'linear-srgb',
      data: new Uint8Array(4),
    }),
    /requires sRGB output/,
  );
});

test('RGBA encoder emits a lossless color-type-6 PNG from readback bytes', () => {
  const pixels = Uint8Array.from([
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 255, 255, 255, 128,
  ]);
  const png = encodeRgbaPng({ width: 2, height: 2, data: pixels });
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const chunks = pngChunks(png);
  const ihdr = chunks.find((chunk) => chunk.type === 'IHDR').data;
  assert.equal(ihdr.readUInt32BE(0), 2);
  assert.equal(ihdr.readUInt32BE(4), 2);
  assert.equal(ihdr[9], 6);
  const scanlines = inflateSync(Buffer.concat(chunks.filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data)));
  assert.deepEqual([...scanlines], [0, ...pixels.slice(0, 8), 0, ...pixels.slice(8)]);
});
