#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { unpackAlignedRows } from '../labs/runtime/aligned-readback.mjs';
import {
  PRIMARY_DEMO_KINDS,
  REPO_ROOT,
  buildDemoRegistry,
} from './lib/lab-registry.mjs';
import { encodeRgbaPng } from './lib/png-rgba.mjs';
import { labViteAliases } from './lib/vite-lab-config.mjs';

export const CAPTURE_PROFILES = Object.freeze({
  correctness: Object.freeze({ width: 1200, height: 800, dpr: 1 }),
  performance: Object.freeze({ width: 1920, height: 1080, dpr: 1 }),
});

export const LAB_CONTROLLER_GLOBALS = Object.freeze([
  'labController',
  '__LAB_CONTROLLER__',
  '__labController',
  '__imagePipelineValidation',
  '__THREEJS_LAB__',
  '__THREE_LAB__',
]);

function optionValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

function parseCli(argv) {
  const allowed = new Set(['--lab', '--profile', '--output', '--hook', '--target']);
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    if (!allowed.has(name)) throw new Error(`unknown capture option: ${name}`);
    if (argv[index + 1] === undefined || argv[index + 1].startsWith('--')) throw new Error(`${name} requires a value`);
  }
  return {
    labId: optionValue(argv, '--lab') ?? process.env.LAB_ID ?? null,
    profile: optionValue(argv, '--profile') ?? 'correctness',
    outputDir: optionValue(argv, '--output'),
    hookPath: optionValue(argv, '--hook'),
    target: optionValue(argv, '--target') ?? 'final',
  };
}

function isWithin(path, parent) {
  const result = relative(parent, path);
  return result === '' || (!result.startsWith(`..${sep}`) && result !== '..' && !isAbsolute(result));
}

function confinedOutput(path) {
  const output = resolve(path);
  if (!isWithin(output, REPO_ROOT) && !isWithin(output, resolve(tmpdir()))) {
    throw new Error(`capture output must remain inside the repository or temporary directory: ${output}`);
  }
  return output;
}

function datumValue(value) {
  return value && typeof value === 'object' && Number.isFinite(value.value) ? value.value : value;
}

function optionalPositiveInteger(value, name) {
  const resolved = datumValue(value);
  if (resolved === undefined || resolved === null) return null;
  if (!Number.isInteger(resolved) || resolved <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return resolved;
}

function bytesFromPayload(payload) {
  if (typeof payload.dataBase64 === 'string') {
    return {
      bytes: new Uint8Array(Buffer.from(payload.dataBase64, 'base64')),
      elementBytes: optionalPositiveInteger(payload.sourceElementBytes, 'sourceElementBytes') ?? 1,
    };
  }
  const source = payload.data ?? payload.pixels;
  if (source instanceof ArrayBuffer) return { bytes: new Uint8Array(source), elementBytes: 1 };
  if (ArrayBuffer.isView(source)) {
    return {
      bytes: new Uint8Array(source.buffer, source.byteOffset, source.byteLength),
      elementBytes: optionalPositiveInteger(payload.sourceElementBytes, 'sourceElementBytes')
        ?? source.BYTES_PER_ELEMENT,
    };
  }
  if (Array.isArray(source)) {
    return {
      bytes: Uint8Array.from(source),
      elementBytes: optionalPositiveInteger(payload.sourceElementBytes, 'sourceElementBytes') ?? 1,
    };
  }
  throw new TypeError('PixelCapture data must be an ArrayBuffer, ArrayBuffer view, or byte array');
}

function dividedRowWidth(value, width, name) {
  const rowWidth = optionalPositiveInteger(value, name);
  if (rowWidth === null) return null;
  if (rowWidth % width !== 0) throw new RangeError(`${name} must be divisible by capture width`);
  return rowWidth / width;
}

function inferBytesPerPixel(payload, width, sourceElementBytes) {
  const candidates = [];
  const add = (name, value) => {
    const resolved = optionalPositiveInteger(value, name);
    if (resolved !== null) candidates.push({ name, value: resolved });
  };
  add('bytesPerPixel', payload.bytesPerPixel);
  add('bytesPerTexel', payload.bytesPerTexel);
  add('rowBytes/width', dividedRowWidth(payload.rowBytes, width, 'rowBytes'));
  add('packedRowBytes/width', dividedRowWidth(payload.packedRowBytes, width, 'packedRowBytes'));
  if (candidates.length === 0) candidates.push({
    name: 'typed-array element width',
    value: sourceElementBytes * 4,
  });
  const bytesPerPixel = candidates[0].value;
  const conflict = candidates.find((candidate) => candidate.value !== bytesPerPixel);
  if (conflict) {
    throw new RangeError(
      `PixelCapture byte-width metadata is inconsistent: ${candidates[0].name}=${bytesPerPixel}, ${conflict.name}=${conflict.value}`,
    );
  }
  return bytesPerPixel;
}

function requireColorManagedRgba8(payload, bytesPerPixel, sourceElementBytes) {
  if (bytesPerPixel !== 4 || sourceElementBytes !== 1) {
    throw new RangeError(
      `standard PNG capture requires byte-addressed RGBA8 pixels; received ${bytesPerPixel} bytes/pixel with ${sourceElementBytes}-byte elements`,
    );
  }
  const format = String(payload.format ?? payload.pixelFormat ?? 'rgba8')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (!new Set(['rgba8', 'rgba8unorm', 'rgba8srgb', 'rgba8unormsrgb']).has(format)) {
    throw new RangeError(`standard PNG capture requires RGBA8 format; received ${payload.format ?? payload.pixelFormat}`);
  }
  if (payload.colorManaged === false) {
    throw new Error('standard PNG capture requires a color-managed presentation result');
  }
  const encoding = payload.outputColorSpace
    ?? payload.colorSpace
    ?? payload.encoding
    ?? payload.transferFunction
    ?? null;
  if (encoding === null && payload.colorManaged !== true) {
    throw new Error('standard PNG capture requires explicit color-managed output metadata');
  }
  if (encoding !== null) {
    const normalized = String(encoding).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!new Set(['srgb', 'srgbcolorspace']).has(normalized)) {
      throw new Error(`standard PNG capture requires sRGB output; received ${encoding}`);
    }
  }
  return encoding ?? 'explicit-color-managed-output';
}

/**
 * Normalize a controller PixelCapture into compact, color-managed RGBA8 rows.
 * `bytesPerRow` on the result is the compact data stride; the original copy
 * stride remains available as `sourceBytesPerRow` for evidence. The serialized
 * payload length and the original GPU-copy length remain distinct because a
 * controller may compact padded rows before crossing the browser boundary.
 */
export function normalizePixelCapture(payload) {
  if (!payload || typeof payload !== 'object') throw new TypeError('PixelCapture must be an object');
  const width = optionalPositiveInteger(payload.width, 'width');
  const height = optionalPositiveInteger(payload.height, 'height');
  if (width === null || height === null) throw new RangeError('PixelCapture width and height are required');
  const { bytes: source, elementBytes } = bytesFromPayload(payload);
  const bytesPerPixel = inferBytesPerPixel(payload, width, elementBytes);
  const colorEncoding = requireColorManagedRgba8(payload, bytesPerPixel, elementBytes);
  const logicalBytesPerRow = width * bytesPerPixel;
  const compactByteLength = logicalBytesPerRow * height;
  const reportedBytesPerRow = optionalPositiveInteger(payload.bytesPerRow, 'bytesPerRow');
  const reportedSourceBytesPerRow = optionalPositiveInteger(payload.sourceBytesPerRow, 'sourceBytesPerRow');
  const reportedSourceByteLength = optionalPositiveInteger(payload.sourceByteLength, 'sourceByteLength');
  for (const [name, stride] of [
    ['bytesPerRow', reportedBytesPerRow],
    ['sourceBytesPerRow', reportedSourceBytesPerRow],
  ]) {
    if (stride !== null && stride < logicalBytesPerRow) {
      throw new RangeError(`${name} is smaller than the logical RGBA8 row`);
    }
  }

  let data;
  let sourceBytesPerRow;
  let sourceLayout;
  if (source.byteLength === compactByteLength) {
    if (
      reportedBytesPerRow !== null
      && reportedSourceBytesPerRow !== null
      && reportedBytesPerRow !== reportedSourceBytesPerRow
      && reportedBytesPerRow !== logicalBytesPerRow
      && reportedSourceBytesPerRow !== logicalBytesPerRow
    ) {
      throw new RangeError('compact PixelCapture reports conflicting padded source strides');
    }
    data = new Uint8Array(source);
    sourceBytesPerRow = reportedSourceBytesPerRow ?? reportedBytesPerRow ?? logicalBytesPerRow;
    sourceLayout = sourceBytesPerRow === logicalBytesPerRow ? 'compact' : 'compacted-from-padded';
  } else {
    if (
      reportedBytesPerRow !== null
      && reportedSourceBytesPerRow !== null
      && reportedBytesPerRow !== reportedSourceBytesPerRow
    ) {
      throw new RangeError('padded PixelCapture reports conflicting source strides');
    }
    sourceBytesPerRow = reportedSourceBytesPerRow ?? reportedBytesPerRow;
    if (sourceBytesPerRow === null) {
      throw new RangeError('padded PixelCapture must report bytesPerRow or sourceBytesPerRow');
    }
    const shortPaddedLength = sourceBytesPerRow * (height - 1) + logicalBytesPerRow;
    const fullPaddedLength = sourceBytesPerRow * height;
    if (source.byteLength !== shortPaddedLength && source.byteLength !== fullPaddedLength) {
      throw new RangeError(
        `PixelCapture buffer is ${source.byteLength} bytes; expected compact ${compactByteLength}, short-padded ${shortPaddedLength}, or full-padded ${fullPaddedLength}`,
      );
    }
    data = unpackAlignedRows({
      width,
      height,
      bytesPerPixel,
      bytesPerRow: sourceBytesPerRow,
      source,
    });
    sourceLayout = 'padded';
  }

  const shortSourceByteLength = sourceBytesPerRow * (height - 1) + logicalBytesPerRow;
  const fullSourceByteLength = sourceBytesPerRow * height;
  if (
    reportedSourceByteLength !== null
    && reportedSourceByteLength !== shortSourceByteLength
    && reportedSourceByteLength !== fullSourceByteLength
  ) {
    throw new RangeError(
      `sourceByteLength is ${reportedSourceByteLength} bytes; expected short-padded ${shortSourceByteLength} or full-padded ${fullSourceByteLength}`,
    );
  }
  if (
    sourceLayout === 'padded'
    && reportedSourceByteLength !== null
    && reportedSourceByteLength !== source.byteLength
  ) {
    throw new RangeError(
      `padded PixelCapture sourceByteLength ${reportedSourceByteLength} does not match transported source data ${source.byteLength}`,
    );
  }
  const sourceByteLength = reportedSourceByteLength
    ?? (sourceLayout === 'compacted-from-padded' ? null : source.byteLength);

  return {
    target: payload.target ?? 'final',
    width,
    height,
    bytesPerPixel,
    bytesPerRow: logicalBytesPerRow,
    sourceBytesPerRow,
    sourceByteLength,
    transportByteLength: source.byteLength,
    sourceLayout,
    format: 'rgba8',
    colorEncoding,
    data,
  };
}

export async function controllerCall(page, method, args = []) {
  return page.evaluate(async ({ methodName, methodArgs, controllerGlobals }) => {
    let candidate = null;
    for (const name of controllerGlobals) {
      if (window[name] !== undefined && window[name] !== null) {
        candidate = window[name];
        break;
      }
    }
    const controller = await Promise.resolve(candidate);
    if (!controller) throw new Error('canonical page did not expose a LabController');
    if (typeof controller[methodName] !== 'function') throw new Error(`LabController has no ${methodName}() method`);
    return controller[methodName](...methodArgs);
  }, { methodName: method, methodArgs: args, controllerGlobals: LAB_CONTROLLER_GLOBALS });
}

export async function awaitCanonicalReady(page) {
  const pageOwnsInitialization = await page.evaluate(() => window.__LAB_READY__ !== undefined);
  if (pageOwnsInitialization) {
    await page.evaluate(async () => {
      await Promise.resolve(window.__LAB_READY__);
    });
    return;
  }
  await controllerCall(page, 'ready');
}

export async function capturePixels(page, target) {
  const serialized = await page.evaluate(async ({ captureTarget, controllerGlobals }) => {
    let candidate = null;
    for (const name of controllerGlobals) {
      if (window[name] !== undefined && window[name] !== null) {
        candidate = window[name];
        break;
      }
    }
    const controller = await Promise.resolve(candidate);
    if (!controller || typeof controller.capturePixels !== 'function') throw new Error('LabController has no capturePixels() method');
    const capture = await controller.capturePixels(captureTarget);
    const source = capture?.data ?? capture?.pixels;
    let bytes;
    if (source instanceof ArrayBuffer) bytes = new Uint8Array(source);
    else if (ArrayBuffer.isView(source)) bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    else if (Array.isArray(source)) bytes = Uint8Array.from(source);
    else throw new Error('PixelCapture data must be an ArrayBuffer, ArrayBuffer view, or byte array');
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return {
      target: capture.target ?? captureTarget,
      width: capture.width,
      height: capture.height,
      bytesPerPixel: capture.bytesPerPixel,
      bytesPerTexel: capture.bytesPerTexel,
      bytesPerRow: capture.bytesPerRow,
      sourceBytesPerRow: capture.sourceBytesPerRow,
      sourceByteLength: capture.sourceByteLength,
      rowBytes: capture.rowBytes,
      packedRowBytes: capture.packedRowBytes,
      sourceElementBytes: ArrayBuffer.isView(source) ? source.BYTES_PER_ELEMENT : 1,
      format: capture.format,
      pixelFormat: capture.pixelFormat,
      colorManaged: capture.colorManaged,
      colorSpace: capture.colorSpace,
      outputColorSpace: capture.outputColorSpace,
      encoding: capture.encoding,
      transferFunction: capture.transferFunction,
      dataBase64: btoa(binary),
    };
  }, { captureTarget: target, controllerGlobals: LAB_CONTROLLER_GLOBALS });

  return normalizePixelCapture(serialized);
}

export function backendProven(metrics) {
  return String(metrics?.backend ?? '').toLowerCase() === 'webgpu'
    || String(metrics?.rendererBackend ?? '').toLowerCase() === 'webgpu'
    || metrics?.backend?.isWebGPUBackend === true
    || metrics?.isWebGPUBackend === true
    || metrics?.backendIsWebGPU === true
    || metrics?.nativeWebGPU === true
    || metrics?.renderer?.isWebGPUBackend === true
    || metrics?.rendererInfo?.backend?.isWebGPUBackend === true;
}

export async function captureLabBrowser({
  labId,
  profile = 'correctness',
  outputDir = null,
  hookPath = null,
  target = 'final',
} = {}) {
  if (!labId) throw new Error('--lab is required (or set LAB_ID)');
  const profileConfig = CAPTURE_PROFILES[profile];
  if (!profileConfig) throw new Error(`unknown capture profile: ${profile}; expected correctness or performance`);
  const registry = buildDemoRegistry();
  const lab = registry.demos.find((entry) => entry.id === labId);
  if (!lab || !PRIMARY_DEMO_KINDS.includes(lab.kind)) throw new Error(`unknown primary lab: ${labId}`);
  if (!lab.browserEntry || !existsSync(join(REPO_ROOT, lab.browserEntry))) throw new Error(`${labId} has no executable browserEntry`);
  const output = confinedOutput(outputDir ?? join(REPO_ROOT, 'artifacts', 'visual-validation', labId, profile));
  mkdirSync(output, { recursive: true });

  const vite = await createServer({
    root: REPO_ROOT,
    appType: 'mpa',
    logLevel: 'error',
    resolve: { alias: labViteAliases(REPO_ROOT) },
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  let browser = null;
  let page = null;
  const pageErrors = [];
  try {
    await vite.listen();
    const address = vite.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Vite did not expose a TCP capture address');
    const browserPath = lab.browserEntry.split('/').map(encodeURIComponent).join('/');
    const url = `http://127.0.0.1:${address.port}/${browserPath}?capture=1&profile=${encodeURIComponent(profile)}`;
    browser = await chromium.launch({
      headless: true,
      args: [
        '--enable-unsafe-webgpu',
        '--enable-features=Vulkan,UseSkiaRenderer',
        '--disable-gpu-sandbox',
      ],
    });
    const context = await browser.newContext({
      viewport: { width: profileConfig.width, height: profileConfig.height },
      deviceScaleFactor: profileConfig.dpr,
    });
    page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(String(error.stack ?? error)));
    await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForFunction((controllerGlobals) => (
      controllerGlobals.some((name) => window[name] !== undefined && window[name] !== null)
      || window.__LAB_ERROR__
    ), LAB_CONTROLLER_GLOBALS, { timeout: 60_000 });
    const blocker = await page.evaluate(() => window.__LAB_ERROR__ ?? null);
    if (blocker) throw new Error(`canonical lab blocker: ${blocker}`);
    await awaitCanonicalReady(page);
    await controllerCall(page, 'resize', [profileConfig.width, profileConfig.height, profileConfig.dpr]);
    if (lab.cameras.some((camera) => camera === 'design')) await controllerCall(page, 'setCamera', ['design']);
    if (lab.seeds.includes(1)) await controllerCall(page, 'setSeed', [1]);
    await controllerCall(page, 'setTime', [0]);
    await controllerCall(page, 'renderOnce');

    const runtime = {
      metrics: await controllerCall(page, 'getMetrics'),
      pipeline: await controllerCall(page, 'describePipeline'),
      resources: await controllerCall(page, 'describeResources'),
    };
    if (!backendProven(runtime.metrics)) {
      throw new Error('LabController metrics did not prove backend.isWebGPUBackend === true');
    }

    const session = {
      page,
      lab,
      profile,
      profileConfig,
      outputDir: output,
      url,
      runtime,
      controllerCall: (method, ...args) => controllerCall(page, method, args),
      capturePixels: (captureTarget) => capturePixels(page, captureTarget),
      async writeCapture(filename, captureTarget) {
        const capture = await capturePixels(page, captureTarget);
        writeFileSync(join(output, filename), encodeRgbaPng(capture));
        return {
          target: capture.target,
          width: capture.width,
          height: capture.height,
          bytesPerPixel: capture.bytesPerPixel,
          bytesPerRow: capture.bytesPerRow,
          sourceBytesPerRow: capture.sourceBytesPerRow,
          sourceByteLength: capture.sourceByteLength,
          transportByteLength: capture.transportByteLength,
          sourceLayout: capture.sourceLayout,
          format: capture.format,
          colorEncoding: capture.colorEncoding,
        };
      },
    };

    let hookResult;
    if (hookPath) {
      const hookAbsolute = resolve(hookPath);
      if (!existsSync(hookAbsolute)) throw new Error(`capture hook does not exist: ${hookAbsolute}`);
      const hook = await import(pathToFileURL(hookAbsolute));
      const captureHook = hook.captureLab ?? hook.default;
      if (typeof captureHook !== 'function') throw new Error('capture hook must export captureLab() or default function');
      hookResult = await captureHook(session);
    } else {
      hookResult = { captures: [await session.writeCapture('final.design.png', target)] };
    }

    const record = {
      schemaVersion: 2,
      labId,
      sourceHash: lab.sourceHash,
      buildRevision: registry.buildRevision,
      profile,
      profileConfig,
      browserEntry: lab.browserEntry,
      url,
      runtime,
      hookResult: hookResult ?? null,
      pageErrors,
      note: 'Capture-session record only; it is not a complete v2 evidence bundle.',
    };
    writeFileSync(join(output, 'capture-session.json'), `${JSON.stringify(record, null, 2)}\n`);
    return record;
  } finally {
    if (page) {
      try { await controllerCall(page, 'dispose'); } catch { /* page may already be closed or blocked */ }
    }
    if (browser) await browser.close();
    await vite.close();
  }
}

async function main() {
  const result = await captureLabBrowser(parseCli(process.argv.slice(2)));
  console.log(JSON.stringify({
    labId: result.labId,
    profile: result.profile,
    output: result.hookResult,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
