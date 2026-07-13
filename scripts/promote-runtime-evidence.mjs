#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PRIMARY_DEMO_KINDS, REPO_ROOT, buildDemoRegistry } from './lib/lab-registry.mjs';
import { encodeRgbaPng } from './lib/png-rgba.mjs';

const DEFAULT_CONFIG = join(REPO_ROOT, 'labs', 'runtime-evidence-previews.json');
const DOCS_EVIDENCE_ROOT = join(REPO_ROOT, 'docs', 'visual-validation');

export function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function resolveWithin(base, candidate, label = 'path') {
  if (typeof candidate !== 'string' || candidate.length === 0 || isAbsolute(candidate)) {
    throw new Error(`${label} must be a non-empty relative path`);
  }
  const resolvedBase = resolve(base);
  const resolved = resolve(resolvedBase, candidate);
  const relativePath = relative(resolvedBase, resolved);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`${label} escapes its allowed root: ${candidate}`);
  }
  return resolved;
}

export function halfFloatToNumber(bits) {
  const sign = (bits & 0x8000) ? -1 : 1;
  const exponent = (bits >>> 10) & 0x1f;
  const fraction = bits & 0x03ff;
  if (exponent === 0) return sign * (fraction === 0 ? 0 : 2 ** -14 * (fraction / 1024));
  if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : Number.NaN;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

function linearToSrgb(value) {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}

export function visualizeRgba16Float(bytes, width, height) {
  const expected = width * height * 8;
  if (bytes.byteLength !== expected) throw new Error(`rgba16float readback has ${bytes.byteLength} bytes; expected ${expected}`);
  const output = new Uint8Array(width * height * 4);
  let nonFiniteValues = 0;
  let negativeValues = 0;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      const value = halfFloatToNumber(bytes.readUInt16LE((pixel * 4 + channel) * 2));
      if (!Number.isFinite(value)) nonFiniteValues += 1;
      if (value < 0) negativeValues += 1;
      const linear = Number.isFinite(value) ? Math.max(0, value) : 0;
      const mapped = linear / (1 + linear);
      output[pixel * 4 + channel] = Math.round(Math.min(1, Math.max(0, linearToSrgb(mapped))) * 255);
    }
    output[pixel * 4 + 3] = 255;
  }
  return { pixels: output, nonFiniteValues, negativeValues };
}

export function pngDimensions(bytes) {
  if (bytes.byteLength < 24 || bytes.toString('ascii', 1, 4) !== 'PNG') throw new Error('source is not a PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function extractRuntimeBackendProof(document) {
  const captureMetrics = document.runtime?.metrics ?? document.finalRuntime?.metrics ?? null;
  const backendEvidence = captureMetrics?.rendererBackendEvidence ?? null;
  const backend = document.backend ?? document.rendererInfo?.backend ?? captureMetrics?.backend ?? null;
  const isWebGPUBackend = backend?.isWebGPUBackend
    ?? document.isWebGPUBackend
    ?? document.rendererInfo?.isWebGPUBackend
    ?? backendEvidence?.isWebGPUBackend
    ?? captureMetrics?.backendIsWebGPU
    ?? (typeof backend === 'string' && /webgpu/i.test(backend))
    ?? (typeof document.backend === 'string' && /webgpu/i.test(document.backend))
    ?? false;
  const name = typeof backend === 'string'
    ? backend
    : backend?.name
      ?? document.rendererInfo?.backend
      ?? captureMetrics?.rendererBackend
      ?? (backendEvidence?.backendType === 'WebGPUBackend' ? 'WebGPUBackend' : null)
      ?? (backend?.isWebGPUBackend === true ? 'WebGPUBackend' : 'unknown');
  // Prefer device-identity proof from rendererBackendEvidence over the weaker
  // browser.adapterIdentity snapshot (which often reports verified:false while
  // the retained GPUDevice proof is true).
  const rawAdapter = document.adapterIdentity ?? document.browser?.adapterIdentity ?? null;
  const adapterIdentity = backendEvidence
    ? {
      ...(rawAdapter && typeof rawAdapter === 'object' ? rawAdapter : {}),
      source: backendEvidence.deviceIdentitySource ?? rawAdapter?.source ?? 'capture-session.rendererBackendEvidence',
      backendType: backendEvidence.backendType ?? backendEvidence.backendKind ?? rawAdapter?.backendType ?? name,
      deviceType: backendEvidence.deviceType ?? rawAdapter?.deviceType ?? null,
      deviceIdentityVerified: backendEvidence.deviceIdentityVerified === true,
      lossPromiseObservedOnActualDevice: backendEvidence.lossPromiseObservedOnActualDevice === true,
      rendererDeviceGeneration: backendEvidence.rendererDeviceGeneration ?? captureMetrics?.rendererDeviceGeneration ?? null,
    }
    : rawAdapter;
  const webgpuProven = isWebGPUBackend === true;
  // Coherence: if the proof document only serializes backend name/isWebGPUBackend
  // (mechanism-metrics / renderer-info without full capture metrics), still mark
  // nativeWebGPU/initialized when WebGPU is proven so published summaries are not
  // half-true (isWebGPUBackend true, nativeWebGPU false).
  return {
    renderer: document.renderer ?? captureMetrics?.rendererInfo?.rendererType ?? (name === 'WebGPUBackend' || webgpuProven ? 'WebGPURenderer' : 'unknown'),
    backend: name === 'unknown' && webgpuProven ? 'WebGPUBackend' : name,
    isWebGPUBackend: webgpuProven,
    threeRevision: document.threeRevision ?? captureMetrics?.threeRevision ?? null,
    nativeWebGPU: captureMetrics?.nativeWebGPU === true || document.nativeWebGPU === true || webgpuProven,
    initialized: captureMetrics?.initialized === true || document.initialized === true || webgpuProven,
    adapterClass: document.adapterClass ?? document.browser?.adapterClass ?? (webgpuProven ? 'unknown' : null),
    adapterIdentity,
    deviceIdentity: backendEvidence
      ? {
        verified: backendEvidence.deviceIdentityVerified === true,
        source: backendEvidence.deviceIdentitySource ?? null,
        deviceType: backendEvidence.deviceType ?? null,
        generation: backendEvidence.rendererDeviceGeneration ?? captureMetrics?.rendererDeviceGeneration ?? null,
      }
      : null,
  };
}

export function isThreeR185Revision(revision) {
  return revision === '185' || revision === '0.185.1';
}

export function normalizedPreviewClaimVerdicts(document) {
  // Prefer unified raw-capture-session / release claim ledger when present.
  if (document.claimVerdicts && typeof document.claimVerdicts === 'object'
    && Object.keys(document.claimVerdicts).length > 0) {
    return document.claimVerdicts;
  }
  if (document.hookResult?.visualDifferences?.verdict === 'PASS'
    && document.hookResult?.coverageEvidence?.verdict === 'PASS') {
    return {
      visualCorrectness: 'PASS',
      mechanismCorrectness: 'PASS',
      performanceCompliance: 'NOT_CLAIMED',
      gpuAttribution: 'INSUFFICIENT_EVIDENCE',
      lifecycleStability: document.hookResult?.lifecycleEvidence?.verdict === 'PASS'
        ? 'PASS'
        : 'INSUFFICIENT_EVIDENCE',
    };
  }
  return {
    mechanismCorrectness: document.verdict ?? 'INSUFFICIENT_EVIDENCE',
    performanceCompliance: document.performanceVerdict ?? document.verdict ?? 'INSUFFICIENT_EVIDENCE',
    lifecycleStability: document.lifecycleVerdict ?? 'INSUFFICIENT_EVIDENCE',
  };
}

function readbackById(artifactDirectory, id) {
  if (!id) return null;
  const manifestPath = join(artifactDirectory, 'render-targets.json');
  if (!existsSync(manifestPath)) throw new Error(`readback ${id} requires render-targets.json`);
  const entry = readJson(manifestPath).readbacks?.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`readback metadata is missing ${id}`);
  return entry;
}

function imageOutput(config, artifactDirectory, outputDirectory) {
  const sourcePath = resolveWithin(artifactDirectory, config.source, 'image source');
  const outputPath = resolveWithin(outputDirectory, config.output, 'image output');
  const source = readFileSync(sourcePath);
  const readback = readbackById(artifactDirectory, config.readback);
  if (readback) {
    if (readback.file !== config.source) throw new Error(`${config.readback} source drift: ${readback.file} !== ${config.source}`);
    if (readback.sha256 !== sha256(source)) throw new Error(`${config.readback} source hash does not match render-target metadata`);
    if (readback.byteLength?.value !== source.byteLength) throw new Error(`${config.readback} byte length does not match render-target metadata`);
  }

  let output;
  let width;
  let height;
  let visualization = null;
  if (config.encoding === 'png-copy') {
    ({ width, height } = pngDimensions(source));
    output = source;
  } else if (config.encoding === 'rgba8') {
    if (!readback) throw new Error(`rgba8 image ${config.source} requires readback metadata`);
    ({ width, height } = readback);
    if (source.byteLength !== width * height * 4) throw new Error(`${config.source} is not packed RGBA8`);
    output = encodeRgbaPng({ width, height, data: source });
  } else if (config.encoding === 'rgba16float-reinhard-srgb') {
    if (!readback) throw new Error(`rgba16float image ${config.source} requires readback metadata`);
    ({ width, height } = readback);
    const result = visualizeRgba16Float(source, width, height);
    if (result.nonFiniteValues > 0) throw new Error(`${config.source} contains ${result.nonFiniteValues} non-finite color values`);
    visualization = {
      transfer: 'max(0, linear) / (1 + max(0, linear)), then linear-sRGB transfer',
      nonFiniteValues: result.nonFiniteValues,
      negativeValuesClamped: result.negativeValues,
    };
    output = encodeRgbaPng({ width, height, data: result.pixels });
  } else {
    throw new Error(`unsupported evidence-preview encoding: ${config.encoding}`);
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, output);
  return {
    file: config.output,
    meaning: config.meaning,
    source: config.source,
    sourceSha256: sha256(source),
    outputSha256: sha256(output),
    width,
    height,
    encoding: config.encoding,
    ...(readback ? { readbackId: readback.id, readbackRoute: readback.readbackRoute ?? null } : {}),
    ...(visualization ? { visualization } : {}),
  };
}

export function selectRuntimeEvidencePreviews(config, labIds = []) {
	if ( config?.schemaVersion !== 1 || ! Array.isArray( config.previews ) ) throw new Error( 'runtime evidence preview config must use schemaVersion 1' );
	if ( ! Array.isArray( labIds ) ) throw new TypeError( 'runtime evidence lab filter must be an array' );
	if ( labIds.length === 0 ) return config.previews;
	const requested = new Set( labIds );
	if ( requested.size !== labIds.length ) throw new Error( 'runtime evidence lab filter contains duplicates' );
	const selected = config.previews.filter( ( preview ) => requested.has( preview.labId ) );
	const found = new Set( selected.map( ( preview ) => preview.labId ) );
	const missing = labIds.filter( ( labId ) => found.has( labId ) === false );
	if ( missing.length > 0 ) throw new Error( `runtime evidence preview config has no labs: ${ missing.join( ', ' ) }` );
	return selected;
}

export function promoteRuntimeEvidence(configPath = DEFAULT_CONFIG, { labIds = [] } = {}) {
  const config = readJson(configPath);
  const registry = buildDemoRegistry();
  const demos = new Map(registry.demos.map((demo) => [demo.id, demo]));
  const summaries = [];

  for (const preview of selectRuntimeEvidencePreviews(config, labIds)) {
    const demo = demos.get(preview.labId);
    if (!demo || !PRIMARY_DEMO_KINDS.includes(demo.kind)) throw new Error(`${preview.labId} is not a primary demo`);
    if (demo.status !== preview.expectedAcceptanceStatus) throw new Error(`${preview.labId} status drift: ${demo.status} !== ${preview.expectedAcceptanceStatus}`);
    if (demo.threeRevision !== '0.185.1') throw new Error(`${preview.labId} is not locked to Three.js 0.185.1`);

    const artifactDirectory = resolveWithin(REPO_ROOT, preview.artifactDirectory, 'artifact directory');
    const proofDocument = readJson(resolveWithin(artifactDirectory, preview.backendProof, 'backend proof'));
    const runtime = extractRuntimeBackendProof(proofDocument);
    if (!runtime.isWebGPUBackend) throw new Error(`${preview.labId} does not serialize renderer.backend.isWebGPUBackend === true`);
    if (runtime.threeRevision && !isThreeR185Revision(runtime.threeRevision)) {
      throw new Error(`${preview.labId} capture used Three.js ${runtime.threeRevision}`);
    }
    if (proofDocument.sourceClosure?.sourceHash) {
      if (proofDocument.labId !== preview.labId) throw new Error(`${preview.labId} capture-session lab identity drifted`);
      if (proofDocument.profile !== 'correctness') throw new Error(`${preview.labId} preview requires a correctness capture session`);
      if (proofDocument.sourceClosure.sourceHash !== demo.sourceHash) throw new Error(`${preview.labId} capture-session source hash is stale`);
      for (const [channel, errors] of [['page', proofDocument.pageErrors], ['console', proofDocument.consoleErrors], ['request', proofDocument.requestErrors]]) {
        if (!Array.isArray(errors) || errors.length > 0) throw new Error(`${preview.labId} ${channel} error ledger is not empty`);
      }
    }

    const claimDocument = readJson(resolveWithin(artifactDirectory, preview.claimVerdicts, 'claim verdicts'));
    // Prefer assembled unified evidence-manifest claim ledger when present.
    let claimSource = claimDocument;
    const evidenceManifestPath = join(artifactDirectory, 'evidence-manifest.json');
    if (existsSync(evidenceManifestPath)) {
      try {
        const evidenceManifest = readJson(evidenceManifestPath);
        if (evidenceManifest?.claimVerdicts && typeof evidenceManifest.claimVerdicts === 'object') {
          claimSource = evidenceManifest;
        }
      } catch {
        // keep preview.claimVerdicts document
      }
    }
    const outputDirectory = join(DOCS_EVIDENCE_ROOT, preview.labId);
    mkdirSync(outputDirectory, { recursive: true });
    const images = preview.images.map((image) => imageOutput(image, artifactDirectory, outputDirectory));
    if (!images.some((image) => image.file === preview.primaryImage)) throw new Error(`${preview.labId} primaryImage is not declared in images`);

    const summary = {
      schemaVersion: 1,
      labId: preview.labId,
      classification: 'inspected-runtime-evidence-preview',
      acceptanceStatus: demo.status,
      evidenceBundleId: preview.artifactDirectory.split('/').at(-1),
      canonicalSource: demo.canonicalSource,
      canonicalSourceHash: demo.sourceHash,
      threeRevision: demo.threeRevision,
      runtime,
      claimVerdicts: normalizedPreviewClaimVerdicts(claimSource),
      primaryImage: preview.primaryImage,
      primaryImageLabel: preview.primaryImageLabel,
      images,
      limitations: preview.limitations,
    };
    writeFileSync(join(outputDirectory, 'evidence-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    summaries.push(summary);
  }
  return summaries;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const labIds = [];
  let configPath = DEFAULT_CONFIG;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--lab') {
      const labId = args[index + 1];
      if (!labId || labId.startsWith('--')) throw new Error('--lab requires a lab ID');
      labIds.push(labId);
      index += 1;
    } else if (configPath === DEFAULT_CONFIG) configPath = resolve(args[index]);
    else throw new Error(`unexpected runtime evidence promotion argument ${args[index]}`);
  }
  const summaries = promoteRuntimeEvidence(configPath, { labIds });
  console.log(`Promoted ${summaries.length} inspected runtime evidence preview bundle(s).`);
}
