#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { platform } from 'node:os';
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import {
  WEBGPU_COPY_BYTES_PER_ROW_ALIGNMENT,
  alignedBytesPerRow,
  unpackAlignedRows,
} from '../labs/runtime/aligned-readback.mjs';
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

export const STANDARD_CAPTURE_OUTPUTS = Object.freeze([
  'final.design.png',
  'no-post.design.png',
  'diagnostics.mosaic.png',
  'camera.near.png',
  'camera.design.png',
  'camera.far.png',
  'seed-0001.final.png',
  'seed-9e3779b9.final.png',
  'temporal.t000.png',
  'temporal.t001.png',
]);

const CAPTURED_OUTPUT = 'CAPTURED';
const NOT_APPLICABLE_OUTPUT = 'NOT_APPLICABLE';
const CAPTURE_OUTPUT_STATUSES = new Set([CAPTURED_OUTPUT, NOT_APPLICABLE_OUTPUT]);
const STANDARD_CAPTURE_OUTPUT_SET = new Set(STANDARD_CAPTURE_OUTPUTS);
const EXPECTED_THREE_PACKAGE_REVISION = '0.185.1';
const EXPECTED_THREE_RUNTIME_REVISION = '185';

export function chromiumWebGpuLaunchArgs() {
  const args = ['--enable-unsafe-webgpu', '--disable-gpu-sandbox'];
  if (platform() !== 'darwin') args.splice(1, 0, '--enable-features=Vulkan,UseSkiaRenderer');
  return args;
}

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

export function buildCaptureUrl({ port, browserEntry, profile }) {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new RangeError('capture server port is invalid');
  if (typeof browserEntry !== 'string' || browserEntry.length === 0) throw new TypeError('capture browserEntry is required');
  if (!CAPTURE_PROFILES[profile]) throw new Error(`unknown capture profile: ${profile}`);
  const browserPath = browserEntry.split('/').map(encodeURIComponent).join('/');
  return `http://127.0.0.1:${port}/${browserPath}?capture=1&profile=${encodeURIComponent(profile)}`;
}

function isWithin(path, parent) {
  const result = relative(parent, path);
  return result === '' || (!result.startsWith(`..${sep}`) && result !== '..' && !isAbsolute(result));
}

export function assertSymlinkConfinedPath(candidatePath, rootPath, io = {
  existsSync,
  lstatSync,
  realpathSync,
}) {
  const root = resolve(rootPath);
  const candidate = resolve(candidatePath);
  if (!isWithin(candidate, root)) throw new Error(`path escapes its confined root: ${candidate}`);
  if (!io.existsSync(root)) throw new Error(`confined root does not exist: ${root}`);
  if (io.lstatSync(root).isSymbolicLink()) throw new Error(`confined root is a symbolic link: ${root}`);
  const realRoot = io.realpathSync(root);
  let current = root;
  const components = relative(root, candidate).split(sep).filter(Boolean);
  for (const component of components) {
    current = join(current, component);
    if (!io.existsSync(current)) continue;
    if (io.lstatSync(current).isSymbolicLink()) {
      throw new Error(`symbolic-link path component is forbidden: ${current}`);
    }
    const realCurrent = io.realpathSync(current);
    if (!isWithin(realCurrent, realRoot)) throw new Error(`real path escapes its confined root: ${current}`);
  }
  return candidate;
}

function confinedOutput(path) {
  const output = resolve(path);
  const temporaryRoot = resolve(tmpdir());
  const allowedRoot = isWithin(output, REPO_ROOT)
    ? REPO_ROOT
    : (isWithin(output, temporaryRoot) ? temporaryRoot : null);
  if (!allowedRoot) {
    throw new Error(`capture output must remain inside the repository or temporary directory: ${output}`);
  }
  assertSymlinkConfinedPath(output, allowedRoot);
  return output;
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function immutableBufferCopy(bytes, label = 'capture artifact bytes') {
  if (typeof bytes === 'string') return Buffer.from(bytes, 'utf8');
  if (bytes instanceof ArrayBuffer) return Buffer.from(new Uint8Array(bytes));
  if (ArrayBuffer.isView(bytes)) {
    return Buffer.from(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  }
  throw new TypeError(`${label} must be an exact string, ArrayBuffer, or ArrayBuffer view`);
}

const FORBIDDEN_EVIDENCE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function cloneJsonEvidenceValue(value, path, seen) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError(`${path} must contain only losslessly serializable JSON numbers`);
    }
    return value;
  }
  if (typeof value !== 'object') {
    throw new TypeError(`${path} contains unsupported ${typeof value} data`);
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    throw new TypeError(`${path} contains binary data; retain bytes as capture artifacts instead`);
  }
  if (seen.has(value)) throw new TypeError(`${path} contains a cyclic object reference`);
  seen.add(value);
  if (Array.isArray(value)) {
    const keys = Reflect.ownKeys(value);
    for (const key of keys) {
      if (key === 'length') continue;
      if (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) {
        throw new TypeError(`${path} contains a non-JSON array property`);
      }
      if (Object.getOwnPropertyDescriptor(value, key)?.enumerable !== true) {
        throw new TypeError(`${path}[${key}] must be enumerable JSON data`);
      }
    }
    const clone = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw new TypeError(`${path} contains a sparse array entry at ${index}`);
      clone.push(cloneJsonEvidenceValue(value[index], `${path}[${index}]`, seen));
    }
    seen.delete(value);
    return Object.freeze(clone);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must contain only plain JSON objects`);
  }
  const clone = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw new TypeError(`${path} contains a symbol-keyed property`);
    if (FORBIDDEN_EVIDENCE_KEYS.has(key)) throw new TypeError(`${path}.${key} is a forbidden evidence key`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${path}.${key} must be enumerable plain JSON data`);
    }
    Object.defineProperty(clone, key, {
      configurable: false,
      enumerable: true,
      writable: false,
      value: cloneJsonEvidenceValue(descriptor.value, `${path}.${key}`, seen),
    });
  }
  seen.delete(value);
  return Object.freeze(clone);
}

export function normalizeCaptureEvidence(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('PixelCapture.evidence must be a plain JSON object');
  }
  return cloneJsonEvidenceValue(value, 'PixelCapture.evidence', new WeakSet());
}

function requireCaptureMode(value, label = 'PixelCapture.captureMode') {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a known nonempty string`);
  }
  return value;
}

/**
 * Bind a recipe capture's public recipe identity to the render mode that was
 * actually selected for its readback. The recipe id remains `target`; the
 * underlying output-node mode is carried separately as `captureMode`.
 */
export function assertRecipeCaptureMode(capture, recipeId, knownModes = null) {
  if (!capture || typeof capture !== 'object' || Array.isArray(capture)) {
    throw new TypeError('recipe PixelCapture metadata must be an object');
  }
  if (typeof recipeId !== 'string' || recipeId.trim().length === 0) {
    throw new TypeError('recipeId must be a nonempty string');
  }
  if (capture.target !== recipeId) {
    throw new Error(`recipe PixelCapture target ${capture.target ?? '<missing>'} does not match ${recipeId}`);
  }
  if (!Object.hasOwn(capture, 'captureMode')) {
    throw new Error(`recipe PixelCapture ${recipeId} omitted captureMode`);
  }
  const captureMode = requireCaptureMode(capture.captureMode);
  const recipe = capture.evidence?.recipe;
  const effectiveState = capture.evidence?.effectiveState;
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) {
    throw new Error(`recipe PixelCapture ${recipeId} omitted evidence.recipe`);
  }
  if (recipe.id !== recipeId) {
    throw new Error(
      `recipe PixelCapture ${recipeId} evidence recipe id ${recipe.id ?? '<missing>'} does not match its requested recipe`,
    );
  }
  if (!effectiveState || typeof effectiveState !== 'object' || Array.isArray(effectiveState)) {
    throw new Error(`recipe PixelCapture ${recipeId} omitted evidence.effectiveState`);
  }
  const declaredTarget = requireCaptureMode(
    recipe.target,
    `recipe PixelCapture ${recipeId} evidence.recipe.target`,
  );
  const effectiveMode = requireCaptureMode(
    effectiveState.mode,
    `recipe PixelCapture ${recipeId} evidence.effectiveState.mode`,
  );
  if (captureMode !== declaredTarget || captureMode !== effectiveMode) {
    throw new Error(
      `recipe PixelCapture ${recipeId} captureMode ${captureMode} does not match evidence recipe target ${declaredTarget} and effective mode ${effectiveMode}`,
    );
  }
  if (knownModes !== null) {
    if (!Array.isArray(knownModes) || knownModes.some((mode) => typeof mode !== 'string' || mode.trim().length === 0)) {
      throw new TypeError('known recipe capture modes must be an array of nonempty strings');
    }
    if (!knownModes.includes(captureMode)) {
      throw new Error(`recipe PixelCapture ${recipeId} captureMode ${captureMode} is not a known lab mode`);
    }
  }
  return captureMode;
}

function requireCaptureFilename(filename, label = 'capture filename') {
  if (typeof filename !== 'string' || !/^[a-z0-9][a-z0-9._-]*\.png$/.test(filename)) {
    throw new Error(`${label} must be a confined lowercase PNG filename`);
  }
  return filename;
}

function captureArtifactPath(outputDir, filename) {
  if (typeof filename !== 'string' || filename.length === 0 || isAbsolute(filename)) {
    throw new Error('capture artifact path must be a non-empty relative path');
  }
  const path = resolve(outputDir, filename);
  if (!isWithin(path, outputDir)) throw new Error(`capture artifact escapes the output directory: ${filename}`);
  assertSymlinkConfinedPath(path, outputDir);
  return path;
}

function prepareArtifactWrite(outputDir, relativePath) {
  const path = captureArtifactPath(outputDir, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  assertSymlinkConfinedPath(path, outputDir);
  return path;
}

function normalizedArtifactRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || isAbsolute(value)) {
    throw new Error('artifact ledger paths must be non-empty and relative');
  }
  const normalized = value.split('\\').join('/');
  if (normalized.split('/').includes('..')) throw new Error(`artifact ledger path escapes output: ${value}`);
  return normalized.replace(/^\.\//, '');
}

export function createCaptureWriteLedger() {
  const writes = new Map();
  let sequence = 0;
  const assertFreshPath = (path) => {
    const normalized = normalizedArtifactRelativePath(path);
    if (writes.has(normalized)) throw new Error(`capture session wrote ${normalized} more than once`);
    return normalized;
  };
  return Object.freeze({
    record(path, kind, bytes, { existedBefore = false } = {}) {
      const normalized = assertFreshPath(path);
      const immutableBytes = immutableBufferCopy(bytes, `capture ledger bytes for ${normalized}`);
      let written = false;
      const record = {
        sequence: ++sequence,
        path: normalized,
        kind,
        existedBefore: existedBefore === true,
        contentBinding: 'sha256-byte-length-immutable-buffer-v1',
        sha256: sha256(immutableBytes),
        byteLength: immutableBytes.byteLength,
      };
      Object.defineProperty(record, 'writeBoundBytes', {
        configurable: false,
        enumerable: false,
        writable: false,
        value(writer) {
          if (typeof writer !== 'function') throw new TypeError('capture ledger writer must be a function');
          if (written) throw new Error(`capture session already committed ${normalized}`);
          written = true;
          return writer(immutableBytes);
        },
      });
      Object.freeze(record);
      writes.set(normalized, record);
      return record;
    },
    recordSelfExcluded(path, kind, { existedBefore = false } = {}) {
      const normalized = assertFreshPath(path);
      const record = Object.freeze({
        sequence: ++sequence,
        path: normalized,
        kind,
        existedBefore: existedBefore === true,
        contentBinding: 'self-excluded-finalized-offline',
        sha256: null,
        byteLength: null,
      });
      writes.set(normalized, record);
      return record;
    },
    has(path) {
      return writes.has(normalizedArtifactRelativePath(path));
    },
    get(path) {
      return writes.get(normalizedArtifactRelativePath(path)) ?? null;
    },
    snapshot() {
      return Object.freeze([...writes.values()]);
    },
  });
}

function verifyFileBindingOnDisk(outputDir, binding, label) {
  if (!binding || typeof binding !== 'object') throw new TypeError(`${label} binding is required`);
  if (typeof binding.sha256 !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(binding.sha256)) {
    throw new Error(`${label} must contain an exact sha256 binding`);
  }
  if (!Number.isInteger(binding.byteLength) || binding.byteLength < 0) {
    throw new Error(`${label} must contain an exact byteLength binding`);
  }
  const bytes = readFileSync(captureArtifactPath(outputDir, binding.path));
  if (bytes.byteLength !== binding.byteLength) {
    throw new Error(`${label} byte length changed after ledger binding`);
  }
  if (sha256(bytes) !== binding.sha256) {
    throw new Error(`${label} sha256 changed after ledger binding`);
  }
  return Object.freeze({
    path: binding.path,
    sha256: binding.sha256,
    byteLength: binding.byteLength,
  });
}

export function verifyCaptureWriteOnDisk(outputDir, record) {
  if (record?.contentBinding !== 'sha256-byte-length-immutable-buffer-v1') {
    throw new Error(`capture write ${record?.path ?? '<unknown>'} is not content-bound`);
  }
  return verifyFileBindingOnDisk(outputDir, record, `capture write ${record.path}`);
}

export function verifyCaptureWriteLedgerOnDisk(outputDir, writeLedger) {
  if (!writeLedger || typeof writeLedger.snapshot !== 'function') {
    throw new TypeError('capture write ledger with snapshot() is required');
  }
  const verified = [];
  for (const record of writeLedger.snapshot()) {
    if (record.contentBinding === 'self-excluded-finalized-offline') {
      if (
        record.path !== 'capture-session.json'
        || record.kind !== 'capture-session-record'
        || record.sha256 !== null
        || record.byteLength !== null
      ) {
        throw new Error('capture-session self-exclusion record is invalid');
      }
      continue;
    }
    verified.push(verifyCaptureWriteOnDisk(outputDir, record));
  }
  return Object.freeze(verified);
}

function writeLedgerBoundArtifact(outputDir, writeLedger, relativePath, kind, bytes) {
  if (writeLedger.has(relativePath)) throw new Error(`capture session wrote ${relativePath} more than once`);
  const path = prepareArtifactWrite(outputDir, relativePath);
  const existedBefore = existsSync(path);
  const record = writeLedger.record(relativePath, kind, bytes, { existedBefore });
  record.writeBoundBytes((immutableBytes) => writeFileSync(path, immutableBytes));
  verifyCaptureWriteOnDisk(outputDir, record);
  return record;
}

function graphProofPresent(value) {
  if (typeof value === 'string') return value.trim().length > 0;
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length > 0;
}

function standardOutputId(filename) {
  return filename.replace(/\.png$/, '');
}

/**
 * Validate the hook's predeclared standard-output contract. Every normative
 * output is either captured under its exact filename or structurally
 * inapplicable with both a reason and graph proof. Aliases and copied evidence
 * are deliberately not statuses in this contract.
 */
export function validateCaptureOutputPlan(plan) {
  if (!Array.isArray(plan)) throw new TypeError('capture hook must export an outputPlan array');
  const normalized = [];
  const seen = new Set();
  for (const raw of plan) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new TypeError('capture output-plan entries must be objects');
    }
    const status = raw.status;
    if (!CAPTURE_OUTPUT_STATUSES.has(status)) {
      throw new Error(`capture output ${raw.id ?? raw.filename ?? '<unknown>'} has unsupported status ${status}`);
    }
    const filenameFromId = typeof raw.id === 'string' ? `${raw.id}.png` : null;
    const standardFilename = status === CAPTURED_OUTPUT
      ? requireCaptureFilename(raw.filename, `capture output ${raw.id ?? '<unknown>'} filename`)
      : (raw.filename === null || raw.filename === undefined ? filenameFromId : raw.filename);
    const identityFilename = standardFilename ?? filenameFromId;
    if (!identityFilename || !STANDARD_CAPTURE_OUTPUT_SET.has(identityFilename)) {
      throw new Error(`capture output ${raw.id ?? raw.filename ?? '<unknown>'} is not a normative standard output`);
    }
    const expectedId = standardOutputId(identityFilename);
    if (raw.id !== undefined && raw.id !== expectedId) {
      throw new Error(`capture output id ${raw.id} does not match ${identityFilename}`);
    }
    if (seen.has(identityFilename)) throw new Error(`capture output plan duplicates ${identityFilename}`);
    seen.add(identityFilename);
    if (status === NOT_APPLICABLE_OUTPUT) {
      if (raw.filename !== null && raw.filename !== undefined) {
        throw new Error(`NOT_APPLICABLE output ${identityFilename} must not name an image file`);
      }
      if (typeof raw.reason !== 'string' || raw.reason.trim().length === 0) {
        throw new Error(`NOT_APPLICABLE output ${identityFilename} requires a reason`);
      }
      if (!graphProofPresent(raw.graphProof)) {
        throw new Error(`NOT_APPLICABLE output ${identityFilename} requires graphProof`);
      }
    }
    if (raw.sourceCaptures !== undefined && !Array.isArray(raw.sourceCaptures)) {
      throw new TypeError(`${identityFilename} sourceCaptures must be an array`);
    }
    const sourceCaptures = raw.sourceCaptures === undefined
      ? []
      : raw.sourceCaptures.map((filename) => requireCaptureFilename(filename, `${identityFilename} source capture`));
    normalized.push(Object.freeze({
      id: expectedId,
      status,
      filename: status === CAPTURED_OUTPUT ? identityFilename : null,
      ...(status === NOT_APPLICABLE_OUTPUT ? { reason: raw.reason, graphProof: raw.graphProof } : {}),
      ...(sourceCaptures.length > 0 ? { sourceCaptures: Object.freeze(sourceCaptures) } : {}),
    }));
  }
  const missing = STANDARD_CAPTURE_OUTPUTS.filter((filename) => !seen.has(filename));
  if (missing.length > 0) throw new Error(`capture output plan omits standard outputs: ${missing.join(', ')}`);
  for (const required of ['final.design.png', 'diagnostics.mosaic.png']) {
    const entry = normalized.find((candidate) => candidate.filename === required || candidate.id === standardOutputId(required));
    if (entry?.status !== CAPTURED_OUTPUT) throw new Error(`${required} is mandatory capture evidence`);
  }
  return Object.freeze(normalized);
}

function declaredHookOutputPlan(hook) {
  const candidates = [hook.outputPlan, hook.CAPTURE_OUTPUT_PLAN];
  for (const [name, value] of Object.entries(hook)) {
    if (/_STANDARD_OUTPUT_PLAN$/.test(name)) candidates.push(value);
  }
  const plan = candidates.find((value) => value !== undefined);
  return validateCaptureOutputPlan(plan);
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

function normalizeOrigin(value) {
  if (value === undefined || value === null || value === '') return 'top-left';
  const normalized = String(value).toLowerCase().replace(/[^a-z]/g, '');
  if (normalized === 'topleft') return 'top-left';
  if (normalized === 'bottomleft') return 'bottom-left';
  throw new Error(`PixelCapture origin must be top-left or bottom-left; received ${value}`);
}

function orientRowsTopLeft(data, width, height, bytesPerPixel, sourceOrigin) {
  if (sourceOrigin === 'top-left') return new Uint8Array(data);
  const bytesPerRow = width * bytesPerPixel;
  const oriented = new Uint8Array(data.byteLength);
  for (let row = 0; row < height; row += 1) {
    const sourceRow = height - row - 1;
    oriented.set(
      data.subarray(sourceRow * bytesPerRow, (sourceRow + 1) * bytesPerRow),
      row * bytesPerRow,
    );
  }
  return oriented;
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
  const captureMode = Object.hasOwn(payload, 'captureMode')
    ? requireCaptureMode(payload.captureMode)
    : null;
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

  const transportLayout = source.byteLength === compactByteLength ? 'compact' : 'padded';
  const transportBytesPerRow = transportLayout === 'padded'
    ? sourceBytesPerRow
    : logicalBytesPerRow;

  const sourceOrigin = normalizeOrigin(payload.origin ?? payload.rowOrigin);
  const normalizedData = orientRowsTopLeft(data, width, height, bytesPerPixel, sourceOrigin);
  const sourceFormat = payload.format ?? payload.pixelFormat ?? 'rgba8';

  return {
    target: payload.target ?? 'final',
    ...(captureMode === null ? {} : { captureMode }),
    width,
    height,
    bytesPerPixel,
    bytesPerRow: logicalBytesPerRow,
    sourceBytesPerRow,
    sourceByteLength,
    transportByteLength: source.byteLength,
    transportBytesPerRow,
    transportLayout,
    transportData: new Uint8Array(source),
    sourceLayout,
    sourceOrigin,
    origin: 'top-left',
    orientationTransform: sourceOrigin === 'bottom-left' ? 'vertical-row-flip' : 'none',
    sourceFormat,
    format: 'rgba8',
    colorEncoding,
    data: normalizedData,
    ...(Object.hasOwn(payload, 'evidence')
      ? { evidence: normalizeCaptureEvidence(payload.evidence) }
      : {}),
  };
}

function alignNormalizedRows(capture) {
  const paddedBytesPerRow = alignedBytesPerRow(
    capture.width,
    capture.bytesPerPixel,
    WEBGPU_COPY_BYTES_PER_ROW_ALIGNMENT,
  );
  const padded = new Uint8Array(paddedBytesPerRow * capture.height);
  for (let row = 0; row < capture.height; row += 1) {
    const sourceStart = row * capture.bytesPerRow;
    const destinationStart = row * paddedBytesPerRow;
    padded.set(
      capture.data.subarray(sourceStart, sourceStart + capture.bytesPerRow),
      destinationStart,
    );
  }
  return {
    alignmentBytes: WEBGPU_COPY_BYTES_PER_ROW_ALIGNMENT,
    layout: 'cpu-normalized-padded-rgba8',
    bytesPerRow: paddedBytesPerRow,
    byteLength: padded.byteLength,
    data: padded,
  };
}

function rgba8Format(value) {
  return new Set(['rgba8', 'rgba8unorm', 'rgba8srgb', 'rgba8unormsrgb'])
    .has(String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''));
}

export function reconcileControllerNormalizedCapture(capture, controllerNormalized) {
  if (!controllerNormalized || typeof controllerNormalized !== 'object') {
    throw new TypeError('controller-normalized capture record is required');
  }
  const layout = controllerNormalized.layout;
  const raw = controllerNormalized.data;
  if (!layout || typeof layout !== 'object' || !ArrayBuffer.isView(raw)) {
    throw new TypeError('controller-normalized layout and bytes are required');
  }
  const width = optionalPositiveInteger(layout.width, 'controller-normalized width');
  const height = optionalPositiveInteger(layout.height, 'controller-normalized height');
  if (width !== capture.width || height !== capture.height) {
    throw new Error('controller-normalized dimensions do not match renderer transport');
  }
  if (!rgba8Format(layout.format ?? capture.sourceFormat)) {
    throw new Error(`controller-normalized format ${layout.format ?? '<missing>'} is not RGBA8`);
  }
  if ((controllerNormalized.sourceElementBytes ?? 1) !== 1) {
    throw new Error('controller-normalized bytes must be byte-addressed RGBA8');
  }
  const logicalBytesPerRow = width * 4;
  const rowBytes = optionalPositiveInteger(layout.rowBytes, 'controller-normalized rowBytes');
  const bytesPerRow = optionalPositiveInteger(layout.bytesPerRow, 'controller-normalized bytesPerRow');
  const declaredByteLength = optionalPositiveInteger(layout.byteLength, 'controller-normalized byteLength');
  if (rowBytes !== logicalBytesPerRow) {
    throw new Error('controller-normalized rowBytes does not match the logical RGBA8 row');
  }
  if (bytesPerRow < logicalBytesPerRow) {
    throw new Error('controller-normalized bytesPerRow is smaller than the logical row');
  }
  if (bytesPerRow !== logicalBytesPerRow && bytesPerRow % WEBGPU_COPY_BYTES_PER_ROW_ALIGNMENT !== 0) {
    throw new Error('controller-normalized padded rows do not satisfy 256-byte alignment');
  }
  const expectedByteLength = bytesPerRow * height;
  if (declaredByteLength !== expectedByteLength || raw.byteLength !== expectedByteLength) {
    throw new Error(`controller-normalized byte length must be exactly ${expectedByteLength}`);
  }
  const compact = new Uint8Array(logicalBytesPerRow * height);
  for (let row = 0; row < height; row += 1) {
    const sourceStart = row * bytesPerRow;
    compact.set(raw.subarray(sourceStart, sourceStart + logicalBytesPerRow), row * logicalBytesPerRow);
    for (let index = sourceStart + logicalBytesPerRow; index < sourceStart + bytesPerRow; index += 1) {
      if (raw[index] !== 0) throw new Error(`controller-normalized padding is nonzero at byte ${index}`);
    }
  }
  const controllerOrigin = normalizeOrigin(layout.origin ?? capture.sourceOrigin);
  const topLeftCompact = orientRowsTopLeft(compact, width, height, 4, controllerOrigin);
  if (topLeftCompact.byteLength !== capture.data.byteLength) {
    throw new Error('controller-normalized compact byte length differs from independent normalization');
  }
  for (let index = 0; index < topLeftCompact.byteLength; index += 1) {
    if (topLeftCompact[index] !== capture.data[index]) {
      throw new Error(`controller-normalized pixels differ from independent transport normalization at byte ${index}`);
    }
  }
  const independentPadded = alignNormalizedRows(capture);
  const record = {
    layout: Object.freeze(structuredClone(layout)),
    origin: controllerOrigin,
    orientationTransform: controllerOrigin === 'bottom-left' ? 'vertical-row-flip' : 'none',
    byteLength: raw.byteLength,
    sha256: sha256(raw),
    compactSha256: sha256(topLeftCompact),
    independentPaddedSha256: sha256(independentPadded.data),
    paddingBytesPerRow: bytesPerRow - logicalBytesPerRow,
    paddingVerifiedZero: true,
    reconciliationStatus: 'PASS',
  };
  Object.defineProperties(record, {
    rawData: {
      configurable: false,
      enumerable: false,
      writable: false,
      value: raw,
    },
    data: {
      configurable: false,
      enumerable: false,
      writable: false,
      value: topLeftCompact,
    },
  });
  return Object.freeze(record);
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

async function capturePixelsThroughController(page, method, target) {
  const serialized = await page.evaluate(async ({ captureTarget, captureMethod, controllerGlobals }) => {
    let candidate = null;
    for (const name of controllerGlobals) {
      if (window[name] !== undefined && window[name] !== null) {
        candidate = window[name];
        break;
      }
    }
    const controller = await Promise.resolve(candidate);
    if (!controller || typeof controller[captureMethod] !== 'function') {
      throw new Error(`LabController has no ${captureMethod}() method`);
    }
    const capture = await controller[captureMethod](captureTarget);
    const bytesOf = (source, label) => {
      if (source instanceof ArrayBuffer) return { bytes: new Uint8Array(source), elementBytes: 1 };
      if (ArrayBuffer.isView(source)) {
        return {
          bytes: new Uint8Array(source.buffer, source.byteOffset, source.byteLength),
          elementBytes: source.BYTES_PER_ELEMENT,
        };
      }
      if (Array.isArray(source)) return { bytes: Uint8Array.from(source), elementBytes: 1 };
      throw new Error(`${label} must be an ArrayBuffer, ArrayBuffer view, or byte array`);
    };
    const base64Of = (bytes) => {
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      return btoa(binary);
    };
    const assertJsonEvidence = (value, path, seen) => {
      if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
      if (typeof value === 'number') {
        if (!Number.isFinite(value) || Object.is(value, -0)) {
          throw new TypeError(`${path} must contain only losslessly serializable JSON numbers`);
        }
        return;
      }
      if (typeof value !== 'object') throw new TypeError(`${path} contains unsupported ${typeof value} data`);
      if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
        throw new TypeError(`${path} contains binary data; retain bytes as capture artifacts instead`);
      }
      if (seen.has(value)) throw new TypeError(`${path} contains a cyclic object reference`);
      seen.add(value);
      if (Array.isArray(value)) {
        for (const key of Reflect.ownKeys(value)) {
          if (key === 'length') continue;
          if (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) {
            throw new TypeError(`${path} contains a non-JSON array property`);
          }
          if (Object.getOwnPropertyDescriptor(value, key)?.enumerable !== true) {
            throw new TypeError(`${path}[${key}] must be enumerable JSON data`);
          }
        }
        for (let index = 0; index < value.length; index += 1) {
          if (!Object.hasOwn(value, index)) throw new TypeError(`${path} contains a sparse array entry at ${index}`);
          assertJsonEvidence(value[index], `${path}[${index}]`, seen);
        }
        seen.delete(value);
        return;
      }
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`${path} must contain only plain JSON objects`);
      }
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string') throw new TypeError(`${path} contains a symbol-keyed property`);
        if (new Set(['__proto__', 'constructor', 'prototype']).has(key)) {
          throw new TypeError(`${path}.${key} is a forbidden evidence key`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
          throw new TypeError(`${path}.${key} must be enumerable plain JSON data`);
        }
        assertJsonEvidence(descriptor.value, `${path}.${key}`, seen);
      }
      seen.delete(value);
    };
    const transportLayout = capture?.transport?.layout ?? null;
    const transportSource = capture?.transport?.data
      ?? capture?.transport?.pixels
      ?? capture?.data
      ?? capture?.pixels;
    const transport = bytesOf(transportSource, 'PixelCapture transport data');
    const controllerNormalizedLayout = capture?.normalized?.layout ?? null;
    const controllerNormalizedSource = capture?.normalized?.data ?? capture?.normalized?.pixels ?? null;
    const controllerNormalized = controllerNormalizedSource === null
      ? null
      : bytesOf(controllerNormalizedSource, 'PixelCapture controller-normalized data');
    if (Object.hasOwn(capture, 'evidence')) {
      if (capture.evidence === null || typeof capture.evidence !== 'object' || Array.isArray(capture.evidence)) {
        throw new TypeError('PixelCapture.evidence must be a plain JSON object');
      }
      assertJsonEvidence(capture.evidence, 'PixelCapture.evidence', new WeakSet());
    }
    if (Object.hasOwn(capture, 'captureMode')) {
      if (typeof capture.captureMode !== 'string' || capture.captureMode.trim().length === 0) {
        throw new TypeError('PixelCapture.captureMode must be a known nonempty string');
      }
    }
    return {
      target: capture.target ?? captureTarget,
      ...(Object.hasOwn(capture, 'captureMode') ? { captureMode: capture.captureMode } : {}),
      width: transportLayout?.width ?? capture.width,
      height: transportLayout?.height ?? capture.height,
      bytesPerPixel: capture.bytesPerPixel,
      bytesPerTexel: capture.bytesPerTexel,
      bytesPerRow: transportLayout?.bytesPerRow
        ?? capture.readbackSourceBytesPerRow
        ?? capture.bytesPerRow,
      sourceBytesPerRow: transportLayout?.bytesPerRow
        ?? capture.readbackSourceBytesPerRow
        ?? capture.sourceBytesPerRow,
      sourceByteLength: transportLayout?.byteLength
        ?? capture.readbackSourceByteLength
        ?? capture.sourceByteLength,
      rowBytes: transportLayout?.rowBytes ?? capture.rowBytes,
      packedRowBytes: capture.packedRowBytes,
      sourceElementBytes: transport.elementBytes,
      format: transportLayout?.format ?? capture.format,
      pixelFormat: capture.pixelFormat,
      colorManaged: capture.colorManaged,
      colorSpace: capture.colorSpace,
      outputColorSpace: capture.outputColorSpace,
      encoding: capture.encoding,
      transferFunction: capture.transferFunction,
      origin: capture.origin,
      rowOrigin: capture.rowOrigin,
      transportPadding: transportLayout?.padding ?? null,
      requestedLayout: {
        width: capture.width,
        height: capture.height,
        rowBytes: capture.rowBytes,
        bytesPerRow: capture.bytesPerRow,
        byteLength: capture.sourceByteLength,
        alignmentBytes: capture.alignmentBytes ?? 256,
      },
      dataBase64: base64Of(transport.bytes),
      controllerNormalized: controllerNormalized === null ? null : {
        layout: controllerNormalizedLayout,
        sourceElementBytes: controllerNormalized.elementBytes,
        dataBase64: base64Of(controllerNormalized.bytes),
      },
      ...(Object.hasOwn(capture, 'evidence') ? { evidence: capture.evidence } : {}),
    };
  }, { captureTarget: target, captureMethod: method, controllerGlobals: LAB_CONTROLLER_GLOBALS });

  const capture = normalizePixelCapture(serialized);
  if (serialized.controllerNormalized !== null) {
    const controllerBytes = new Uint8Array(Buffer.from(serialized.controllerNormalized.dataBase64, 'base64'));
    capture.controllerNormalized = reconcileControllerNormalizedCapture(capture, {
      layout: structuredClone(serialized.controllerNormalized.layout),
      sourceElementBytes: serialized.controllerNormalized.sourceElementBytes,
      data: controllerBytes,
    });
  }
  capture.transportPadding = serialized.transportPadding;
  capture.requestedLayout = Object.freeze(structuredClone(serialized.requestedLayout));
  return capture;
}

export async function capturePixels(page, target) {
  return capturePixelsThroughController(page, 'capturePixels', target);
}

export async function captureRecipePixels(page, recipeId) {
  const capture = await capturePixelsThroughController(page, 'captureRecipe', recipeId);
  if (capture.target !== recipeId) throw new Error(`LabController returned capture target ${capture.target} for requested recipe ${recipeId}`);
  assertRecipeCaptureMode(capture, recipeId);
  return capture;
}

export function backendProven(metrics) {
  if (!metrics || typeof metrics !== 'object') return false;
  const backendEvidence = metrics.rendererBackendEvidence
    ?? metrics.backendEvidence
    ?? metrics.rendererInfo?.backendEvidence
    ?? null;
  const backendSignals = [
    metrics.backend,
    metrics.backendKind,
    metrics.rendererBackend,
    metrics.rendererInfo?.backendType,
    backendEvidence?.backendKind,
    backendEvidence?.backendType,
  ].filter((value) => value !== undefined && value !== null)
    .map((value) => String(value).toLowerCase().replace(/[^a-z0-9]/g, ''));
  if (backendSignals.length === 0 || backendSignals.some((value) => !new Set(['webgpu', 'webgpubackend']).has(value))) {
    return false;
  }
  const rendererType = String(metrics.rendererInfo?.rendererType ?? metrics.rendererType ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return metrics.nativeWebGPU === true
    && metrics.initialized === true
    && rendererType === 'webgpurenderer'
    && backendEvidence !== null
    && backendEvidence.deviceIdentityVerified === true
    && typeof backendEvidence.deviceIdentitySource === 'string'
    && backendEvidence.deviceIdentitySource.length > 0
    && typeof backendEvidence.deviceType === 'string'
    && backendEvidence.deviceType.length > 0
    && backendEvidence.lossPromiseObservedOnActualDevice === true
    && Number.isInteger(backendEvidence.rendererDeviceGeneration)
    && backendEvidence.rendererDeviceGeneration > 0
    && metrics.rendererDeviceStatus === 'active'
    && metrics.rendererDeviceGeneration === backendEvidence.rendererDeviceGeneration
    && metrics.deviceLossGeneration === 0;
}

export function assertCaptureRuntimeProfile(runtime, profile) {
  const metrics = runtime?.metrics;
  const pipeline = runtime?.pipeline;
  if (!metrics || !pipeline) throw new Error('capture runtime profile proof requires metrics and pipeline');
  for (const [label, record] of [['metrics', metrics], ['pipeline', pipeline]]) {
    if (record.runtimeProfile !== profile) {
      throw new Error(`${label}.runtimeProfile ${record.runtimeProfile ?? '<missing>'} does not match capture profile ${profile}`);
    }
  }
  if (profile === 'correctness') {
    for (const [label, value] of [
      ['metrics.timestampQueriesRequired', metrics.timestampQueriesRequired],
      ['metrics.timestampQueriesRequested', metrics.timestampQueriesRequested],
      ['metrics.timestampQueriesActive', metrics.timestampQueriesActive],
      ['pipeline.timestampQueriesRequired', pipeline.timestampQueriesRequired],
      ['pipeline.timestampQueriesRequested', pipeline.timestampQueriesRequested],
      ['pipeline.timestampQueriesActive', pipeline.timestampQueriesActive],
    ]) {
      if (value !== false) throw new Error(`${label} must be false for correctness capture`);
    }
    return;
  }
  if (profile !== 'performance') throw new Error(`unsupported capture runtime profile ${profile}`);
  for (const [label, value] of [
    ['metrics.performanceTimestampMode', metrics.performanceTimestampMode],
    ['pipeline.performanceTimestampMode', pipeline.performanceTimestampMode],
  ]) {
    if (value !== 'auto') throw new Error(`${label} must be auto for timestamp-attributed performance capture`);
  }
  for (const [label, value] of [
    ['metrics.timestampQueriesRequested', metrics.timestampQueriesRequested],
    ['metrics.timestampQueriesActive', metrics.timestampQueriesActive],
    ['pipeline.timestampQueriesRequested', pipeline.timestampQueriesRequested],
    ['pipeline.timestampQueriesActive', pipeline.timestampQueriesActive],
  ]) {
    if (value !== true) throw new Error(`${label} must be true for performance capture`);
  }
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function scalarTime(value) {
  if (Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object') return value;
  return firstDefined(value.seconds, value.timeSeconds, value.value, value.current);
}

export function extractCaptureState(metrics) {
  const route = metrics?.routeSelection ?? metrics?.routeState ?? metrics?.startup ?? {};
  return Object.freeze({
    scenario: firstDefined(metrics?.scenarioId, metrics?.scenario, metrics?.subjectId, route.scenario, route.subjectId),
    mode: firstDefined(metrics?.modeId, metrics?.mode, metrics?.activeMode, route.mode),
    tier: firstDefined(metrics?.tierId, metrics?.tier, metrics?.activeTier, route.tier, route.tierId),
    camera: firstDefined(metrics?.cameraId, metrics?.camera, metrics?.activeCamera, route.camera, route.cameraId),
    seed: firstDefined(metrics?.seed, route.seed),
    timeSeconds: scalarTime(firstDefined(metrics?.timeSeconds, metrics?.time, route.timeSeconds, route.time)),
  });
}

function defaultCaptureState(lab, target) {
  const scenario = lab.scenarios[0]?.id ?? null;
  const mode = lab.modes.includes(target)
    ? target
    : (lab.modes.includes('final') ? 'final' : (lab.modes[0] ?? null));
  const tier = lab.tiers[0]?.id ?? null;
  const camera = lab.cameras.includes('design') ? 'design' : (lab.cameras[0] ?? null);
  const seed = lab.seeds.includes(1) ? 1 : (lab.seeds[0] ?? null);
  return Object.freeze({ scenario, mode, tier, camera, seed, timeSeconds: 0 });
}

export function resolveCaptureState(lab, target, requestedState = null) {
  const fallback = defaultCaptureState(lab, target);
  if (requestedState === null || requestedState === undefined) return fallback;
  if (typeof requestedState !== 'object' || Array.isArray(requestedState)) {
    throw new TypeError('explicit captureState must be an object');
  }
  const fields = ['scenario', 'mode', 'tier', 'camera', 'seed', 'timeSeconds'];
  const unknown = Object.keys(requestedState).filter((key) => !fields.includes(key));
  const missing = fields.filter((key) => !(key in requestedState));
  if (unknown.length > 0) throw new Error(`explicit captureState has unknown fields: ${unknown.join(', ')}`);
  if (missing.length > 0) throw new Error(`explicit captureState omits fields: ${missing.join(', ')}`);
  const scenarioIds = (lab.scenarios ?? []).map((scenario) => scenario.id);
  for (const [field, choices] of [
    ['scenario', scenarioIds],
    ['mode', lab.modes ?? []],
    ['tier', (lab.tiers ?? []).map((tier) => tier.id)],
    ['camera', lab.cameras ?? []],
  ]) {
    const value = requestedState[field];
    if (choices.length === 0 ? value !== null : !choices.includes(value)) {
      throw new Error(`explicit captureState ${field}=${value} is not declared by ${lab.id}`);
    }
  }
  if (!Number.isInteger(requestedState.seed) || requestedState.seed < 0 || requestedState.seed > 0xffffffff
      || !(lab.seeds ?? []).includes(requestedState.seed)) {
    throw new Error(`explicit captureState seed=${requestedState.seed} is not a declared uint32 seed for ${lab.id}`);
  }
  if (!Number.isFinite(requestedState.timeSeconds) || requestedState.timeSeconds < 0) {
    throw new Error('explicit captureState timeSeconds must be a finite nonnegative number');
  }
  return Object.freeze(Object.fromEntries(fields.map((field) => [field, requestedState[field]])));
}

export async function applyControllerCaptureState(invokeController, state) {
  if (typeof invokeController !== 'function') {
    throw new TypeError('capture-state controller invoker must be a function');
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('capture state must be an object');
  }
  for (const [method, value] of [
    ['setScenario', state.scenario],
    ['setMode', state.mode],
    ['setTier', state.tier],
    ['setSeed', state.seed],
    ['setCamera', state.camera],
    ['setTime', state.timeSeconds],
  ]) {
    if (value !== null) await invokeController(method, value);
  }
  await invokeController('renderOnce');
}

async function applyCaptureState(page, state) {
  await applyControllerCaptureState(
    (method, ...args) => controllerCall(page, method, args),
    state,
  );
}

function equalStateValue(actual, expected) {
  if (typeof actual === 'number' && typeof expected === 'number') return Object.is(actual, expected);
  return String(actual) === String(expected);
}

export function assertCaptureState(actual, expected) {
  for (const [name, expectedValue] of Object.entries(expected)) {
    if (expectedValue === null) continue;
    const actualValue = actual[name];
    if (actualValue === undefined || actualValue === null) {
      throw new Error(`LabController metrics omitted locked capture state ${name}`);
    }
    if (!equalStateValue(actualValue, expectedValue)) {
      throw new Error(`LabController capture state ${name}=${actualValue} does not match locked ${expectedValue}`);
    }
  }
}

export function assertFinalCaptureState(finalRuntime, lockedState, profileConfig) {
  const metrics = finalRuntime?.metrics;
  if (!metrics || typeof metrics !== 'object') {
    throw new TypeError('final capture runtime metrics are required');
  }
  const state = extractCaptureState(metrics);
  assertCaptureState(state, lockedState);
  const viewport = metrics.viewport;
  if (!viewport || typeof viewport !== 'object' || Array.isArray(viewport)) {
    throw new Error('LabController final metrics omitted locked capture viewport');
  }
  const normalizedViewport = {};
  for (const field of ['width', 'height', 'dpr']) {
    const expectedValue = profileConfig?.[field];
    const actualValue = datumValue(viewport[field]);
    if (!Number.isFinite(expectedValue) || !Number.isFinite(actualValue)) {
      throw new Error(`LabController final capture viewport ${field} must be finite`);
    }
    if (!Object.is(actualValue, expectedValue)) {
      throw new Error(`LabController final capture viewport ${field}=${actualValue} does not match locked ${expectedValue}`);
    }
    normalizedViewport[field] = actualValue;
  }
  return Object.freeze({
    state,
    viewport: Object.freeze(normalizedViewport),
  });
}

function runtimeThreeRevision(metrics) {
  return firstDefined(
    metrics?.threeRevision,
    metrics?.renderer?.threeRevision,
    metrics?.rendererInfo?.threeRevision,
    metrics?.rendererInfo?.renderer?.threeRevision,
    metrics?.routeSelection?.threeRevision,
  );
}

function explicitAdapterClass(metrics) {
  return firstDefined(
    metrics?.adapterClass,
    metrics?.adapterIdentity?.adapterClass,
    metrics?.rendererInfo?.adapterClass,
    metrics?.rendererInfo?.adapterIdentity?.adapterClass,
  );
}

function observedAdapterIdentity(metrics) {
  const observed = firstDefined(
    metrics?.adapterIdentity,
    metrics?.adapterInfo,
    metrics?.rendererInfo?.adapterIdentity,
    metrics?.rendererInfo?.adapterInfo,
    metrics?.renderer?.adapterIdentity,
  );
  if (observed && typeof observed === 'object' && !Array.isArray(observed)) {
    return structuredClone(observed);
  }
  const backendType = firstDefined(
    metrics?.backend,
    metrics?.rendererBackend,
    metrics?.rendererInfo?.backendType,
    metrics?.rendererInfo?.backend?.type,
    'WebGPU',
  );
  return {
    source: 'LabController.getMetrics',
    backendType: String(backendType),
    deviceType: 'unknown',
    deviceLabel: typeof observed === 'string' ? observed : '',
    deviceIdentityVerified: false,
  };
}

export function classifyAdapter(metrics) {
  const explicit = String(explicitAdapterClass(metrics) ?? '').toLowerCase();
  if (explicit === 'hardware' || explicit === 'software') return explicit;
  const identity = JSON.stringify(observedAdapterIdentity(metrics)).toLowerCase();
  if (/swiftshader|llvmpipe|software|lavapipe/.test(identity)) return 'software';
  return 'unknown';
}

function errorValuePresent(value) {
  if (value === null || value === undefined || value === false || value === 0 || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') {
    if (Array.isArray(value.events)) return value.events.length > 0;
    if ('observed' in value) return value.observed === true;
    if ('lost' in value) return value.lost === true;
    if ('error' in value) return errorValuePresent(value.error);
    if ('reason' in value) return errorValuePresent(value.reason);
    if ('message' in value) return errorValuePresent(value.message);
    if ('errors' in value) return errorValuePresent(value.errors);
    if ('failure' in value) return errorValuePresent(value.failure);
    return false;
  }
  return true;
}

const RUNTIME_ERROR_FIELDS = new Set([
  'deviceErrors',
  'deviceErrorCount',
  'deviceErrorsRetained',
  'deviceErrorsDropped',
  'deviceLost',
  'deviceLostObserved',
  'deviceLoss',
  'deviceLossGeneration',
  'uncapturedErrors',
  'uncapturedErrorCount',
  'frameErrors',
  'frameErrorCount',
  'lastFrameError',
  'lifecycleErrors',
  'lifecycleErrorCount',
  'lastLifecycleError',
  'lastDeviceError',
  'captureTargetRestoreFailures',
  'lastCaptureTargetRestoreError',
  'targetDisposeUncertain',
  'untrackedCandidateDisposeUncertain',
  'teardownUncertainCount',
  'resourceUncertainDisposalCount',
  'resourceOrphanDisposalCount',
  'gpuTimestampResolveFailures',
  'gpuTimestampFailureCount',
  'lastGpuTimestampFailure',
  'runtimeErrors',
  'labError',
]);

export function runtimeFailureMessages(root) {
  const failures = [];
  const visited = new Set();
  const inspect = (value, path) => {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      const capacityMetadata = path.split('.').some((segment) => /(?:limits?|capacities|thresholds?)$/i.test(segment));
      if (!capacityMetadata && RUNTIME_ERROR_FIELDS.has(key) && errorValuePresent(child)) {
        failures.push(`${childPath}: ${JSON.stringify(child)}`);
      }
      inspect(child, childPath);
    }
  };
  inspect(root, 'runtime');
  return failures;
}

export function assertNoCaptureFailures({ pageErrors = [], consoleErrors = [], requestErrors = [], runtime = null } = {}) {
  const failures = [
    ...pageErrors.map((value) => `page: ${value}`),
    ...consoleErrors.map((value) => `console: ${value}`),
    ...requestErrors.map((value) => `request: ${value}`),
    ...runtimeFailureMessages(runtime),
  ];
  if (failures.length > 0) {
    throw new Error(`capture observed runtime failures:\n${failures.join('\n')}`);
  }
}

async function collectBrowserRecord(browser, page, metrics) {
  const navigatorRecord = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
  }));
  return Object.freeze({
    name: 'Chromium',
    version: browser.version(),
    userAgent: navigatorRecord.userAgent,
    platform: navigatorRecord.platform,
    automationSurface: 'playwright-headless-chromium',
    adapterClass: classifyAdapter(metrics),
    adapterIdentity: observedAdapterIdentity(metrics),
  });
}

export async function waitForPostDisposeObservations(page) {
  return page.evaluate(async () => {
    await new Promise((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
    await new Promise((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
    const safeClone = (value) => {
      if (value === undefined) return null;
      try { return JSON.parse(JSON.stringify(value)); } catch { return String(value); }
    };
    return {
      labError: safeClone(window.__LAB_ERROR__),
      gpuEvents: safeClone(window.__LAB_GPU_EVENTS__),
      threeGpuEvents: safeClone(window.__THREEJS_GPU_EVENTS__),
      imagePipelineGpuEvents: safeClone(window.__imagePipelineGpuEvents),
      deviceErrors: safeClone(window.__LAB_DEVICE_ERRORS__),
      visibilityState: document.visibilityState,
    };
  });
}

function artifactStem(filename) {
  return requireCaptureFilename(filename).slice(0, -4);
}

export function buildCaptureArtifactPayload(capture, filename) {
  const stem = artifactStem(filename);
  const normalized = alignNormalizedRows(capture);
  const pngBytes = encodeRgbaPng(capture);
  const transportPath = `transport-readbacks/${stem}.rgba8.bin`;
  const normalizedPath = `normalized-readbacks/${stem}.rgba8.padded.bin`;
  const pngSha256 = sha256(pngBytes);
  const transportSha256 = sha256(capture.transportData);
  const normalizedSha256 = sha256(normalized.data);
  const compactRgbaSha256 = sha256(capture.data);
  const transport = {
    artifact: Object.freeze({
      path: transportPath,
      sha256: transportSha256,
      byteLength: capture.transportData.byteLength,
    }),
    layout: Object.freeze({
      width: capture.width,
      height: capture.height,
      format: capture.sourceFormat,
      layout: capture.transportLayout,
      origin: capture.sourceOrigin,
      bytesPerPixel: capture.bytesPerPixel,
      rowBytes: capture.bytesPerRow,
      bytesPerRow: capture.transportBytesPerRow,
      byteLength: capture.transportByteLength,
      paddingKind: typeof capture.transportPadding === 'string'
        ? capture.transportPadding
        : (capture.transportBytesPerRow === capture.bytesPerRow ? 'compact' : 'padded'),
      paddingBytesPerRow: capture.transportBytesPerRow - capture.bytesPerRow,
    }),
    rendererCopy: Object.freeze({
      layout: capture.sourceLayout,
      bytesPerRow: capture.sourceBytesPerRow,
      byteLength: capture.sourceByteLength,
      rawBytesRetained: true,
      requestedLayout: capture.requestedLayout ?? null,
    }),
  };
  Object.defineProperty(transport, 'data', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: capture.transportData,
  });
  const normalizedRecord = {
    artifact: Object.freeze({
      path: normalizedPath,
      sha256: normalizedSha256,
      byteLength: normalized.byteLength,
    }),
    layout: normalized.layout,
    alignmentBytes: normalized.alignmentBytes,
    bytesPerRow: normalized.bytesPerRow,
    byteLength: normalized.byteLength,
    origin: capture.origin,
    orientationTransform: capture.orientationTransform,
    compact: Object.freeze({
      layout: 'compact-rgba8',
      origin: capture.origin,
      bytesPerRow: capture.bytesPerRow,
      byteLength: capture.data.byteLength,
      sha256: compactRgbaSha256,
    }),
    compactRgbaSha256,
    compactByteLength: capture.data.byteLength,
  };
  Object.defineProperties(normalizedRecord, {
    data: {
      configurable: false,
      enumerable: false,
      writable: false,
      value: capture.data,
    },
    paddedData: {
      configurable: false,
      enumerable: false,
      writable: false,
      value: normalized.data,
    },
  });
  return Object.freeze({
    target: capture.target,
    ...(Object.hasOwn(capture, 'captureMode')
      ? { captureMode: requireCaptureMode(capture.captureMode) }
      : {}),
    width: capture.width,
    height: capture.height,
    bytesPerPixel: capture.bytesPerPixel,
    bytesPerRow: capture.bytesPerRow,
    sourceBytesPerRow: capture.sourceBytesPerRow,
    sourceByteLength: capture.sourceByteLength,
    transportByteLength: capture.transportByteLength,
    sourceLayout: capture.sourceLayout,
    sourceOrigin: capture.sourceOrigin,
    origin: capture.origin,
    orientationTransform: capture.orientationTransform,
    sourceFormat: capture.sourceFormat,
    format: capture.format,
    colorEncoding: capture.colorEncoding,
    ...(Object.hasOwn(capture, 'evidence') ? { evidence: capture.evidence } : {}),
    transport: Object.freeze(transport),
    normalized: Object.freeze(normalizedRecord),
    ...(capture.controllerNormalized ? { controllerNormalized: capture.controllerNormalized } : {}),
    png: Object.freeze({
      path: filename,
      sha256: pngSha256,
      byteLength: pngBytes.byteLength,
      encoding: 'png-rgba8-srgb',
      derivedFromCompactRgbaSha256: compactRgbaSha256,
      width: capture.width,
      height: capture.height,
    }),
    bytes: Object.freeze({
      transport: capture.transportData,
      normalized: normalized.data,
      png: pngBytes,
    }),
  });
}

export function captureMetadataOnly(payload) {
  const { bytes, ...metadata } = payload;
  return metadata;
}

export function assertCaptureArtifactBinding(payload, {
  pngBytes = payload?.bytes?.png,
  transportBytes = payload?.bytes?.transport,
  normalizedBytes = payload?.bytes?.normalized,
} = {}) {
  if (!payload || typeof payload !== 'object') throw new TypeError('capture payload is required');
  for (const [label, bytes, expected] of [
    ['PNG', pngBytes, payload.png],
    ['transport readback', transportBytes, payload.transport?.artifact],
    ['normalized padded readback', normalizedBytes, payload.normalized?.artifact],
  ]) {
    if (!ArrayBuffer.isView(bytes) && !Buffer.isBuffer(bytes)) throw new TypeError(`${label} bytes are required`);
    if (bytes.byteLength !== expected.byteLength) {
      throw new Error(`${label} byte length ${bytes.byteLength} does not match ${expected.byteLength}`);
    }
    if (sha256(bytes) !== expected.sha256) throw new Error(`${label} hash does not match capture metadata`);
  }
  const compact = payload.normalized?.data;
  if (!ArrayBuffer.isView(compact)) throw new TypeError('normalized compact readback bytes are required');
  if (sha256(compact) !== payload.normalized.compactRgbaSha256) {
    throw new Error('normalized compact readback hash does not match capture metadata');
  }
  const expectedPng = encodeRgbaPng({
    width: payload.width,
    height: payload.height,
    data: compact,
  });
  if (sha256(expectedPng) !== sha256(pngBytes)) {
    throw new Error('PNG is not derived byte-for-byte from the normalized compact readback');
  }
}

function writeCapturePayload(outputDir, payload, writeLedger) {
  assertCaptureArtifactBinding(payload);
  const paths = [
    [payload.png.path, payload.bytes.png, 'writeCapture-png'],
    [payload.transport.artifact.path, payload.bytes.transport, 'writeCapture-transport'],
    [payload.normalized.artifact.path, payload.bytes.normalized, 'writeCapture-normalized'],
  ];
  for (const [relativePath, bytes, kind] of paths) {
    writeLedgerBoundArtifact(outputDir, writeLedger, relativePath, kind, bytes);
  }
}


function assertWrittenCaptureFiles(outputDir, capture) {
  assertCaptureArtifactBinding(capture, {
    pngBytes: readFileSync(captureArtifactPath(outputDir, capture.png.path)),
    transportBytes: readFileSync(captureArtifactPath(outputDir, capture.transport.artifact.path)),
    normalizedBytes: readFileSync(captureArtifactPath(outputDir, capture.normalized.artifact.path)),
  });
}

function normalizedSha256(value) {
  return String(value ?? '').replace(/^sha256:/, '').toLowerCase();
}

function validateHookFileReference(outputDir, writeLedger, reference, label) {
  if (!reference || typeof reference.path !== 'string' || typeof reference.sha256 !== 'string') {
    throw new Error(`${label} must contain a path and sha256`);
  }
  if (!writeLedger.has(reference.path)) throw new Error(`${label} was not written during this capture session`);
  const bytes = readFileSync(captureArtifactPath(outputDir, reference.path));
  if (normalizedSha256(sha256(bytes)) !== normalizedSha256(reference.sha256)) {
    throw new Error(`${label} hash does not match its fresh artifact`);
  }
  return Object.freeze({ path: reference.path, sha256: sha256(bytes), byteLength: bytes.byteLength });
}

export function validateHookDerivedOutput(outputDir, writeLedger, hookResult, entry, sourceCaptures) {
  const hookOutput = hookResult?.standardOutputs?.find?.((candidate) => (
    candidate?.id === entry.id || candidate?.filename === entry.filename
  ));
  if (!hookOutput?.pixelEvidence) {
    throw new Error(
      `${entry.filename} is derived rather than a direct capture and requires hook pixelEvidence with normalized readback derivation`,
    );
  }
  if (hookOutput.status !== CAPTURED_OUTPUT || hookOutput.filename !== entry.filename) {
    throw new Error(`hook derivation record for ${entry.filename} has inconsistent identity`);
  }
  if (JSON.stringify(hookOutput.sourceCaptures ?? []) !== JSON.stringify(sourceCaptures)) {
    throw new Error(`hook derivation record for ${entry.filename} changed sourceCaptures`);
  }
  const outputFile = validateHookFileReference(
    outputDir,
    writeLedger,
    hookOutput.file ?? hookOutput.pixelEvidence.png,
    `${entry.filename} hook PNG`,
  );
  const pngEvidence = hookOutput.pixelEvidence.png;
  if (pngEvidence) validateHookFileReference(outputDir, writeLedger, pngEvidence, `${entry.filename} pixelEvidence.png`);
  const normalizedEvidence = hookOutput.pixelEvidence.normalized ?? null;
  if (!normalizedEvidence?.rawArtifact) {
    throw new Error(`${entry.filename} hook derivation omits its normalized raw artifact`);
  }
  const normalizedRaw = validateHookFileReference(
    outputDir,
    writeLedger,
    normalizedEvidence.rawArtifact,
    `${entry.filename} normalized raw artifact`,
  );
  const normalizedRawBytes = readFileSync(captureArtifactPath(outputDir, normalizedRaw.path));
  const width = optionalPositiveInteger(
    hookOutput.width ?? hookOutput.derivation?.output?.width,
    `${entry.filename} width`,
  );
  const height = optionalPositiveInteger(
    hookOutput.height ?? hookOutput.derivation?.output?.height,
    `${entry.filename} height`,
  );
  const paddedBytesPerRow = optionalPositiveInteger(
    normalizedEvidence.paddedBytesPerRow,
    `${entry.filename} normalized paddedBytesPerRow`,
  );
  const normalizedCompact = unpackAlignedRows({
    source: normalizedRawBytes,
    width,
    height,
    bytesPerPixel: 4,
    bytesPerRow: paddedBytesPerRow,
  });
  if (
    normalizedEvidence.packedByteLength !== normalizedCompact.byteLength
    || normalizedSha256(normalizedEvidence.packedRgbaSha256) !== normalizedSha256(sha256(normalizedCompact))
  ) {
    throw new Error(`${entry.filename} normalized packed derivation does not match its retained padded bytes`);
  }
  const expectedPng = encodeRgbaPng({ width, height, data: normalizedCompact });
  const actualPng = readFileSync(captureArtifactPath(outputDir, outputFile.path));
  if (sha256(expectedPng) !== sha256(actualPng)) {
    throw new Error(`${entry.filename} PNG is not byte-derived from its retained normalized pixels`);
  }
  const normalizedPacked = normalizedEvidence.packedArtifact
    ? validateHookFileReference(
      outputDir,
      writeLedger,
      normalizedEvidence.packedArtifact,
      `${entry.filename} normalized packed artifact`,
    )
    : Object.freeze({
      path: null,
      sha256: sha256(normalizedCompact),
      byteLength: normalizedCompact.byteLength,
      retention: 'derived-on-validation-from-normalized-padded-artifact',
    });
  if (
    pngEvidence?.derivedFromPackedRgbaSha256
    && normalizedEvidence.packedRgbaSha256
    && normalizedSha256(pngEvidence.derivedFromPackedRgbaSha256)
      !== normalizedSha256(normalizedEvidence.packedRgbaSha256)
  ) {
    throw new Error(`${entry.filename} PNG derivation hash disagrees with normalized packed evidence`);
  }
  return Object.freeze({
    kind: 'hook-validated-derived-output',
    validationStatus: 'PASS',
    sourceCaptures: Object.freeze([...sourceCaptures]),
    outputFile,
    normalizedRaw,
    normalizedPacked,
  });
}

function validateCapturedOutputs(outputDir, plan, writtenCaptures, writeLedger, hookResult) {
  if (new Set(writtenCaptures.map((capture) => capture.png.path)).size !== writtenCaptures.length) {
    throw new Error('capture hook overwrote a filename through multiple writeCapture() calls');
  }
  for (const capture of writtenCaptures) assertWrittenCaptureFiles(outputDir, capture);
  const writtenByFilename = new Map(writtenCaptures.map((capture) => [capture.png.path, capture]));
  const result = [];
  for (const entry of plan) {
    if (entry.status === NOT_APPLICABLE_OUTPUT) {
      result.push(entry);
      continue;
    }
    const path = captureArtifactPath(outputDir, entry.filename);
    if (!existsSync(path)) throw new Error(`capture hook did not emit declared output ${entry.filename}`);
    if (!writeLedger.has(entry.filename)) {
      throw new Error(`declared output ${entry.filename} is stale or was not written during this capture session`);
    }
    const sourceCaptures = entry.sourceCaptures ?? [];
    const direct = writtenByFilename.get(entry.filename) ?? null;
    if (!direct && sourceCaptures.length === 0) {
      throw new Error(`declared output ${entry.filename} has neither direct readback metadata nor sourceCaptures`);
    }
    for (const sourceFilename of sourceCaptures) {
      if (!writtenByFilename.has(sourceFilename)) {
        throw new Error(`${entry.filename} references unretained source capture ${sourceFilename}`);
      }
    }
    const bytes = readFileSync(path);
    const derivation = direct
      ? Object.freeze({ kind: 'direct-render-target-readback', validationStatus: 'PASS', pixelEvidence: direct.png })
      : validateHookDerivedOutput(outputDir, writeLedger, hookResult, entry, sourceCaptures);
    result.push(Object.freeze({
      ...entry,
      artifact: Object.freeze({ path: entry.filename, sha256: sha256(bytes), byteLength: bytes.byteLength }),
      derivation,
    }));
  }
  const final = result.find((entry) => entry.filename === 'final.design.png');
  const diagnostics = result.find((entry) => entry.filename === 'diagnostics.mosaic.png');
  if (
    final?.status === CAPTURED_OUTPUT
    && diagnostics?.status === CAPTURED_OUTPUT
    && final.artifact.sha256 === diagnostics.artifact.sha256
  ) {
    throw new Error('diagnostics.mosaic.png is byte-identical to final.design.png');
  }
  return Object.freeze(result);
}

const BUILTIN_OUTPUT_PLAN = validateCaptureOutputPlan(STANDARD_CAPTURE_OUTPUTS.map((filename) => ({
  id: standardOutputId(filename),
  status: CAPTURED_OUTPUT,
  filename,
})));

async function runBuiltinCapture(session, target) {
  const representativeSeed = session.lab.seeds.includes(1) ? 1 : session.lab.seeds[0];
  const stressSeed = session.lab.seeds.includes(0x9e3779b9) ? 0x9e3779b9 : session.lab.seeds.at(-1);
  const designCamera = session.lab.cameras.includes('design') ? 'design' : session.lab.cameras[0];
  const captures = [];
  const capture = async (filename, { mode = 'final', camera = designCamera, seed = representativeSeed, time = 0 } = {}) => {
    if (mode !== null) await session.controllerCall('setMode', mode);
    if (camera !== null) await session.controllerCall('setCamera', camera);
    if (seed !== null && seed !== undefined) await session.controllerCall('setSeed', seed);
    await session.controllerCall('setTime', time);
    await session.controllerCall('renderOnce');
    captures.push(await session.writeCapture(filename, target));
  };
  await capture('final.design.png');
  await capture('no-post.design.png', { mode: 'no-post' });
  await capture('diagnostics.mosaic.png', { mode: 'diagnostics' });
  await capture('camera.near.png', { camera: session.lab.cameras.includes('near') ? 'near' : designCamera });
  await capture('camera.design.png');
  await capture('camera.far.png', { camera: session.lab.cameras.includes('far') ? 'far' : designCamera });
  await capture('seed-0001.final.png', { seed: representativeSeed });
  await capture('seed-9e3779b9.final.png', { seed: stressSeed });
  await capture('temporal.t000.png', { time: 0 });
  await capture('temporal.t001.png', { time: 1 / 60 });
  await applyControllerCaptureState(session.controllerCall, session.lockedState);
  return Object.freeze({ captures: Object.freeze(captures) });
}

function canonicalJsonValue(value) {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJsonValue(value[key])]));
}

function sourceClosureDigest(value) {
  return sha256(Buffer.from(JSON.stringify(canonicalJsonValue(value))));
}

export function resolveCaptureSourceClosure(hookResult, registrySourceClosure, {
  preCaptureSourceClosure = null,
  recomputedSourceClosure = null,
  sourceClosureValidation = null,
} = {}) {
  const hookSourceClosure = hookResult?.sourceClosure;
  const sourceClosure = hookSourceClosure && typeof hookSourceClosure === 'object'
    ? hookSourceClosure
    : registrySourceClosure;
  if (!sourceClosure || typeof sourceClosure !== 'object' || Array.isArray(sourceClosure)) {
    throw new TypeError('capture source closure is required');
  }
  if (sourceClosure.threeRevision !== EXPECTED_THREE_PACKAGE_REVISION) {
    throw new Error(`capture source closure Three revision ${sourceClosure.threeRevision ?? '<missing>'} is not ${EXPECTED_THREE_PACKAGE_REVISION}`);
  }
  if (typeof sourceClosure.sourceHash !== 'string' || sourceClosure.sourceHash.length === 0) {
    throw new Error('capture source closure must expose sourceHash');
  }
  if (typeof sourceClosure.buildRevision !== 'string' || sourceClosure.buildRevision.length === 0) {
    throw new Error('capture source closure must expose buildRevision');
  }
  const customClosure = sourceClosureDigest(sourceClosure) !== sourceClosureDigest(registrySourceClosure);
  if (customClosure) {
    if (
      sourceClosureValidation?.recomputeProviderExported !== true
      || sourceClosureValidation?.validatorExported !== true
    ) {
      throw new Error('custom capture source closure requires both recompute and validate providers');
    }
    if (
      sourceClosureValidation.preCaptureValidated !== true
      || sourceClosureValidation.postCaptureValidated !== true
      || sourceClosureValidation.hookResultValidated !== true
    ) {
      throw new Error('custom capture source closure requires successful pre-capture, post-capture, and hook-result validation');
    }
    if (!preCaptureSourceClosure || !recomputedSourceClosure) {
      throw new Error('custom capture source closure requires pre-capture and post-capture recomputation');
    }
    for (const [label, candidate] of [
      ['pre-capture', preCaptureSourceClosure],
      ['post-capture', recomputedSourceClosure],
    ]) {
      if (candidate?.threeRevision !== EXPECTED_THREE_PACKAGE_REVISION) {
        throw new Error(`${label} source closure has the wrong Three revision`);
      }
      if (typeof candidate?.sourceHash !== 'string' || typeof candidate?.buildRevision !== 'string') {
        throw new Error(`${label} source closure is incomplete`);
      }
    }
    const declaredDigest = sourceClosureDigest(sourceClosure);
    const preCaptureDigest = sourceClosureDigest(preCaptureSourceClosure);
    const postCaptureDigest = sourceClosureDigest(recomputedSourceClosure);
    if (declaredDigest !== preCaptureDigest || declaredDigest !== postCaptureDigest) {
      throw new Error('custom capture source closure drifted or was forged during capture');
    }
  }
  return sourceClosure;
}

async function validateCaptureSourceClosureCandidate(validator, candidate, label) {
  if (typeof validator !== 'function') return false;
  const verdict = await validator(candidate);
  if (verdict === false) throw new Error(`${label} source-closure validator rejected the candidate`);
  return true;
}

export async function captureLabBrowser({
  labId,
  profile = 'correctness',
  outputDir = null,
  hookPath = null,
  target = 'final',
  browserEntryOverride = null,
  captureState = null,
} = {}) {
  if (!labId) throw new Error('--lab is required (or set LAB_ID)');
  const profileConfig = CAPTURE_PROFILES[profile];
  if (!profileConfig) throw new Error(`unknown capture profile: ${profile}; expected correctness or performance`);
  const registry = buildDemoRegistry();
  const lab = registry.demos.find((entry) => entry.id === labId);
  if (!lab || !PRIMARY_DEMO_KINDS.includes(lab.kind)) throw new Error(`unknown primary lab: ${labId}`);
  const browserEntry = browserEntryOverride ?? lab.browserEntry;
  if (typeof browserEntry !== 'string' || browserEntry.length === 0) throw new Error(`${labId} has no executable browserEntry`);
  const browserEntryPath = resolve(REPO_ROOT, browserEntry);
  if (!isWithin(browserEntryPath, REPO_ROOT) || !existsSync(browserEntryPath)) throw new Error(`${labId} capture browserEntry is missing or escapes the repository: ${browserEntry}`);
  const canonicalRoots = lab.canonicalSource.map((sourcePath) => resolve(REPO_ROOT, sourcePath));
  if (!canonicalRoots.some((sourceRoot) => isWithin(browserEntryPath, sourceRoot))) throw new Error(`${labId} capture browserEntry is outside its canonical source closure: ${browserEntry}`);
  assertSymlinkConfinedPath(browserEntryPath, REPO_ROOT);
  if (lab.threeRevision !== EXPECTED_THREE_PACKAGE_REVISION) {
    throw new Error(`${labId} manifest requires Three ${lab.threeRevision}; expected ${EXPECTED_THREE_PACKAGE_REVISION}`);
  }
  const installedThree = JSON.parse(readFileSync(join(REPO_ROOT, 'node_modules', 'three', 'package.json'), 'utf8')).version;
  if (installedThree !== EXPECTED_THREE_PACKAGE_REVISION) {
    throw new Error(`installed Three revision ${installedThree} does not match ${EXPECTED_THREE_PACKAGE_REVISION}`);
  }
  const output = confinedOutput(outputDir ?? join(REPO_ROOT, 'artifacts', 'visual-validation', labId, profile));
  mkdirSync(output, { recursive: true });
  confinedOutput(output);
  const writeLedger = createCaptureWriteLedger();
  const registrySourceClosure = Object.freeze({
    algorithm: 'demo-registry-transitive-source-closure-v2',
    roots: Object.freeze([...(lab.sourceHashInputs ?? lab.canonicalSource)]),
    files: null,
    threeRevision: EXPECTED_THREE_PACKAGE_REVISION,
    sourceHash: lab.sourceHash,
    buildRevision: registry.buildRevision,
  });

  let captureHook = null;
  let outputPlan = BUILTIN_OUTPUT_PLAN;
  let sourceClosureProvider = null;
  let sourceClosureValidator = null;
  let preCaptureSourceClosure = null;
  let preCaptureSourceClosureValidated = false;
  if (hookPath) {
    const hookAbsolute = resolve(hookPath);
    if (!existsSync(hookAbsolute)) throw new Error(`capture hook does not exist: ${hookAbsolute}`);
    const hook = await import(pathToFileURL(hookAbsolute));
    captureHook = hook.captureLab ?? hook.default;
    if (typeof captureHook !== 'function') throw new Error('capture hook must export captureLab() or default function');
    outputPlan = declaredHookOutputPlan(hook);
    sourceClosureProvider = hook.recomputeCaptureSourceClosure ?? hook.computeCaptureSourceClosure ?? null;
    sourceClosureValidator = hook.validateCaptureSourceClosure ?? null;
    if (sourceClosureProvider !== null && typeof sourceClosureProvider !== 'function') {
      throw new TypeError('capture source-closure provider must be a function');
    }
    if (sourceClosureValidator !== null && typeof sourceClosureValidator !== 'function') {
      throw new TypeError('capture source-closure validator must be a function');
    }
    if (sourceClosureProvider) {
      preCaptureSourceClosure = await sourceClosureProvider();
      preCaptureSourceClosureValidated = await validateCaptureSourceClosureCandidate(
        sourceClosureValidator,
        preCaptureSourceClosure,
        'pre-capture',
      );
    }
  }

  const vite = await createServer({
    root: REPO_ROOT,
    appType: 'mpa',
    logLevel: 'error',
    resolve: { alias: labViteAliases(REPO_ROOT) },
    optimizeDeps: { noDiscovery: true },
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  let browser = null;
  let page = null;
  let controllerDisposed = false;
  const pageErrors = [];
  const consoleErrors = [];
  const requestErrors = [];
  const writtenCaptures = [];
  const recipeCaptureBindings = [];
  const startedAt = new Date().toISOString();
  try {
    await vite.listen();
    const address = vite.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Vite did not expose a TCP capture address');
    const url = buildCaptureUrl({ port: address.port, browserEntry, profile });
    browser = await chromium.launch({
      headless: true,
      args: chromiumWebGpuLaunchArgs(),
    });
    const context = await browser.newContext({
      viewport: { width: profileConfig.width, height: profileConfig.height },
      deviceScaleFactor: profileConfig.dpr,
    });
    page = await context.newPage();
    await page.addInitScript(({ captureProfile, expectedLabId }) => {
      Object.defineProperty(window, '__LAB_CAPTURE_PROFILE__', {
        configurable: false,
        enumerable: true,
        writable: false,
        value: Object.freeze({ id: captureProfile, labId: expectedLabId }),
      });
    }, { captureProfile: profile, expectedLabId: labId });
    page.on('pageerror', (error) => pageErrors.push(String(error.stack ?? error)));
    page.on('console', (message) => {
      if (message.type() === 'error') {
        const location = message.location();
        consoleErrors.push(`${message.text()}${location.url ? ` (${location.url}:${location.lineNumber}:${location.columnNumber})` : ''}`);
      }
    });
    page.on('requestfailed', (request) => {
      requestErrors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'request failed'}`);
    });
    page.on('response', (response) => {
      if (response.status() >= 400) requestErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    });
    page.on('crash', () => pageErrors.push('page crashed'));
    await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
    const finalUrl = page.url();
    const requested = new URL(url);
    const navigated = new URL(finalUrl);
    if (navigated.origin !== requested.origin || navigated.pathname !== requested.pathname) {
      throw new Error(`capture route changed from ${url} to ${finalUrl}`);
    }
    if (
      navigated.searchParams.getAll('capture').length !== 1
      || navigated.searchParams.get('capture') !== '1'
      || navigated.searchParams.getAll('profile').length !== 1
      || navigated.searchParams.get('profile') !== profile
      || [...navigated.searchParams.keys()].some((key) => !new Set(['capture', 'profile']).has(key))
    ) {
      throw new Error(`capture route did not preserve its exact profile query: ${finalUrl}`);
    }
    await page.waitForFunction((controllerGlobals) => (
      controllerGlobals.some((name) => window[name] !== undefined && window[name] !== null)
      || window.__LAB_ERROR__
    ), LAB_CONTROLLER_GLOBALS, { timeout: 60_000 });
    const blocker = await page.evaluate(() => window.__LAB_ERROR__ ?? null);
    if (blocker) throw new Error(`canonical lab blocker: ${blocker}`);
    await awaitCanonicalReady(page);
    await controllerCall(page, 'resize', [profileConfig.width, profileConfig.height, profileConfig.dpr]);
    const lockedState = resolveCaptureState(lab, target, captureState);
    await applyCaptureState(page, lockedState);

    const runtime = {
      metrics: await controllerCall(page, 'getMetrics'),
      pipeline: await controllerCall(page, 'describePipeline'),
      resources: await controllerCall(page, 'describeResources'),
    };
    if (!backendProven(runtime.metrics)) {
      throw new Error('LabController metrics did not prove one initialized native-WebGPU renderer device identity');
    }
    assertCaptureRuntimeProfile(runtime, profile);
    const observedRevision = String(runtimeThreeRevision(runtime.metrics) ?? '');
    if (![EXPECTED_THREE_RUNTIME_REVISION, EXPECTED_THREE_PACKAGE_REVISION].includes(observedRevision)) {
      throw new Error(`LabController metrics reported Three ${observedRevision || '<missing>'}; expected r${EXPECTED_THREE_RUNTIME_REVISION}`);
    }
    const observedLabId = firstDefined(
      runtime.metrics?.labId,
      runtime.metrics?.sceneId,
      runtime.metrics?.routeSelection?.labId,
    );
    if (observedLabId !== undefined && observedLabId !== labId) {
      throw new Error(`LabController runtime lab ID ${observedLabId} does not match ${labId}`);
    }
    const observedState = extractCaptureState(runtime.metrics);
    assertCaptureState(observedState, lockedState);
    assertNoCaptureFailures({ pageErrors, consoleErrors, requestErrors, runtime });
    const browserRecord = await collectBrowserRecord(browser, page, runtime.metrics);
    const persistCapture = async (filename, captureTarget, readCapture, recipeId = null) => {
      const capture = await readCapture();
      if (capture.target !== captureTarget) {
        throw new Error(`LabController returned capture target ${capture.target} for requested ${captureTarget}`);
      }
      if (recipeId !== null) assertRecipeCaptureMode(capture, recipeId, lab.modes);
      const payload = buildCaptureArtifactPayload(capture, filename);
      if (recipeId !== null) assertRecipeCaptureMode(payload, recipeId, lab.modes);
      writeCapturePayload(output, payload, writeLedger);
      const metadata = captureMetadataOnly(payload);
      writtenCaptures.push(metadata);
      if (recipeId !== null) recipeCaptureBindings.push(Object.freeze({ recipeId, metadata }));
      return metadata;
    };
    const session = {
      page,
      lab,
      profile,
      profileConfig,
      outputDir: output,
      url,
      finalUrl,
      requestedUrl: url,
      captureProfile: Object.freeze({ id: profile, ...profileConfig }),
      automationSurface: 'playwright-headless-chromium',
      sourceClosure: registrySourceClosure,
      sourceClosureHash: registrySourceClosure.sourceHash,
      buildRevision: registrySourceClosure.buildRevision,
      threeRevision: EXPECTED_THREE_PACKAGE_REVISION,
      lockedState,
      observedState,
      outputPlan,
      runtime,
      controllerCall: (method, ...args) => controllerCall(page, method, args),
      capturePixels: (captureTarget) => capturePixels(page, captureTarget),
      captureRecipePixels: (recipeId) => captureRecipePixels(page, recipeId),
      async readArtifact(relativePath) {
        return readFileSync(captureArtifactPath(output, relativePath));
      },
      async writeArtifact(relativePath, bytes) {
        writeLedgerBoundArtifact(output, writeLedger, relativePath, 'hook-artifact', bytes);
      },
      async writeCapture(filename, captureTarget) {
        return persistCapture(filename, captureTarget, () => capturePixels(page, captureTarget));
      },
      async writeRecipeCapture(filename, recipeId) {
        return persistCapture(filename, recipeId, () => captureRecipePixels(page, recipeId), recipeId);
      },
    };

    const hookResult = captureHook
      ? await captureHook(session)
      : await runBuiltinCapture(session, target);
    for (const { recipeId, metadata } of recipeCaptureBindings) {
      assertRecipeCaptureMode(metadata, recipeId, lab.modes);
    }
    const verifiedOutputs = validateCapturedOutputs(
      output,
      outputPlan,
      writtenCaptures,
      writeLedger,
      hookResult,
    );
    const finalRuntime = {
      metrics: await controllerCall(page, 'getMetrics'),
      pipeline: await controllerCall(page, 'describePipeline'),
      resources: await controllerCall(page, 'describeResources'),
    };
    const finalCaptureState = assertFinalCaptureState(finalRuntime, lockedState, profileConfig);
    const closingRegistry = buildDemoRegistry();
    const closingLab = closingRegistry.demos.find((entry) => entry.id === labId);
    if (
      closingLab?.sourceHash !== lab.sourceHash
      || closingRegistry.buildRevision !== registry.buildRevision
    ) {
      throw new Error('canonical source or build revision changed during capture');
    }
    if (!backendProven(finalRuntime.metrics)) {
      throw new Error('final LabController metrics lost native WebGPU backend proof');
    }
    assertCaptureRuntimeProfile(finalRuntime, profile);
    assertNoCaptureFailures({ pageErrors, consoleErrors, requestErrors, runtime: finalRuntime });
    await controllerCall(page, 'dispose');
    controllerDisposed = true;
    const postDisposeSnapshot = await waitForPostDisposeObservations(page);
    assertNoCaptureFailures({
      pageErrors,
      consoleErrors,
      requestErrors,
      runtime: { finalRuntime, postDisposeSnapshot },
    });

    const recomputedSourceClosure = sourceClosureProvider
      ? await sourceClosureProvider()
      : null;
    const postCaptureSourceClosureValidated = recomputedSourceClosure
      ? await validateCaptureSourceClosureCandidate(
        sourceClosureValidator,
        recomputedSourceClosure,
        'post-capture',
      )
      : false;
    const hookResultSourceClosureValidated = hookResult?.sourceClosure
      ? await validateCaptureSourceClosureCandidate(
        sourceClosureValidator,
        hookResult.sourceClosure,
        'hook-result',
      )
      : false;
    const sourceClosure = resolveCaptureSourceClosure(hookResult, registrySourceClosure, {
      preCaptureSourceClosure,
      recomputedSourceClosure,
      sourceClosureValidation: Object.freeze({
        recomputeProviderExported: typeof sourceClosureProvider === 'function',
        validatorExported: typeof sourceClosureValidator === 'function',
        preCaptureValidated: preCaptureSourceClosureValidated,
        postCaptureValidated: postCaptureSourceClosureValidated,
        hookResultValidated: hookResultSourceClosureValidated,
      }),
    });

    for (const { recipeId, metadata } of recipeCaptureBindings) {
      assertRecipeCaptureMode(metadata, recipeId, lab.modes);
      Object.freeze(metadata);
    }

    verifyCaptureWriteLedgerOnDisk(output, writeLedger);
    const captureSessionPath = prepareArtifactWrite(output, 'capture-session.json');
    const captureSessionExisted = existsSync(captureSessionPath);
    writeLedger.recordSelfExcluded('capture-session.json', 'capture-session-record', {
      existedBefore: captureSessionExisted,
    });
    const record = {
      schemaVersion: 2,
      labId,
      sourceHash: sourceClosure.sourceHash,
      sourceClosureHash: sourceClosure.sourceHash,
      sourceClosure,
      buildRevision: sourceClosure.buildRevision,
      threeRevision: EXPECTED_THREE_PACKAGE_REVISION,
      profile,
      profileConfig,
      automationSurface: 'playwright-headless-chromium',
      adapterClass: browserRecord.adapterClass,
      adapterIdentity: browserRecord.adapterIdentity,
      browser: browserRecord,
      browserEntry,
      url,
      finalUrl,
      route: Object.freeze({
        requestedUrl: url,
        finalUrl,
        browserEntry,
        manifestLabId: labId,
        observedRuntimeLabId: observedLabId ?? null,
        lockedState,
        observedState,
        finalState: finalCaptureState.state,
      }),
      startedAt,
      finishedAt: new Date().toISOString(),
      runtime,
      finalRuntime,
      postDisposeSnapshot,
      outputPlan: verifiedOutputs,
      writtenCaptures: Object.freeze(writtenCaptures),
      artifactWrites: writeLedger.snapshot(),
      hookResult: hookResult ?? null,
      pageErrors,
      consoleErrors,
      requestErrors,
      note: 'Capture-session record only; it is not a complete v2 evidence bundle.',
    };
    const captureSessionBytes = immutableBufferCopy(`${JSON.stringify(record, null, 2)}\n`);
    writeFileSync(captureSessionPath, captureSessionBytes);
    const finalizedCaptureSessionFile = Object.freeze({
      path: 'capture-session.json',
      contentBinding: 'finalized-file-hash-for-offline-promotion',
      sha256: sha256(captureSessionBytes),
      byteLength: captureSessionBytes.byteLength,
    });
    verifyFileBindingOnDisk(
      output,
      finalizedCaptureSessionFile,
      'finalized capture-session file',
    );
    Object.defineProperty(record, 'finalizedCaptureSessionFile', {
      configurable: false,
      enumerable: false,
      writable: false,
      value: finalizedCaptureSessionFile,
    });
    return record;
  } finally {
    if (page && !controllerDisposed) {
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
