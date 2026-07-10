import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const REQUIRED_EVIDENCE_JSON = Object.freeze([
  'visual-contract.json',
  'evidence-manifest.json',
  'renderer-info.json',
  'pipeline-graph.json',
  'performance-envelope.json',
  'frame-trace.json',
  'quality-governor.json',
  'render-targets.json',
  'storage-resources.json',
  'resident-resources.json',
  'bandwidth-model.json',
  'visual-errors.json',
  'leak-loop.json',
  'mechanism-metrics.json',
]);

export const REQUIRED_EVIDENCE_IMAGES = Object.freeze([
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

const VERDICTS = new Set(['PASS', 'FAIL', 'INSUFFICIENT_EVIDENCE', 'NOT_CLAIMED']);

function artifactPath(bundleDir, filename) {
  const direct = join(bundleDir, filename);
  if (existsSync(direct)) return direct;
  const images = join(bundleDir, 'images', filename);
  if (existsSync(images)) return images;
  return direct;
}

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function pngDimensions(path) {
  const bytes = readFileSync(path);
  const signature = '89504e470d0a1a0a';
  if (bytes.byteLength < 24 || bytes.subarray(0, 8).toString('hex') !== signature) {
    throw new Error(`${path} is not a PNG`);
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function datumValue(value) {
  return value && typeof value === 'object' && Number.isFinite(value.value) ? value.value : null;
}

function findVerdicts(value, path = '$', output = []) {
  if (!value || typeof value !== 'object') return output;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (/verdict$/i.test(key) && typeof child === 'string') output.push({ path: childPath, verdict: child });
    else findVerdicts(child, childPath, output);
  }
  return output;
}

export function validateEvidenceBundle(bundleDir, { requireRequiredClaimsPass = false } = {}) {
  const errors = [];
  const json = {};
  for (const filename of REQUIRED_EVIDENCE_JSON) {
    const path = artifactPath(bundleDir, filename);
    if (!existsSync(path)) {
      errors.push(`missing ${filename}`);
      continue;
    }
    try {
      json[filename] = JSON.parse(readFileSync(path, 'utf8'));
      if (json[filename].schemaVersion !== 2) errors.push(`${filename} must declare schemaVersion 2`);
    } catch (error) {
      errors.push(`${filename} is not valid JSON: ${error.message}`);
    }
  }

  const imageHashes = new Map();
  for (const filename of REQUIRED_EVIDENCE_IMAGES) {
    const path = artifactPath(bundleDir, filename);
    if (!existsSync(path)) {
      errors.push(`missing ${filename}`);
      continue;
    }
    try {
      const dimensions = pngDimensions(path);
      if (dimensions.width !== 1200 || dimensions.height !== 800) {
        errors.push(`${filename} must be a 1200x800 correctness capture; received ${dimensions.width}x${dimensions.height}`);
      }
      imageHashes.set(filename, hashFile(path));
    } catch (error) {
      errors.push(error.message);
    }
  }

  const finalHash = imageHashes.get('final.design.png');
  if (finalHash && finalHash === imageHashes.get('diagnostics.mosaic.png')) {
    errors.push('diagnostics.mosaic.png duplicates final.design.png');
  }
  if (finalHash && finalHash === imageHashes.get('no-post.design.png')) {
    errors.push('no-post.design.png duplicates final.design.png');
  }

  const manifest = json['evidence-manifest.json'];
  if (manifest) {
    const claims = manifest.claimVerdicts;
    const requiredClaims = ['visualCorrectness', 'mechanismCorrectness', 'performanceCompliance', 'gpuAttribution', 'lifecycleStability'];
    for (const claim of requiredClaims) {
      if (!VERDICTS.has(claims?.[claim])) errors.push(`evidence-manifest.json claimVerdicts.${claim} is missing or invalid`);
      else if (requireRequiredClaimsPass && claims[claim] !== 'PASS') {
        errors.push(`evidence-manifest.json claimVerdicts.${claim} must be PASS for accepted coverage; received ${claims[claim]}`);
      }
    }
  }

  for (const [filename, contents] of Object.entries(json)) {
    for (const verdict of findVerdicts(contents)) {
      if (!VERDICTS.has(verdict.verdict)) errors.push(`${filename}${verdict.path.slice(1)} has invalid verdict ${verdict.verdict}`);
    }
  }

  const rendererInfo = json['renderer-info.json'];
  if (rendererInfo) {
    if (rendererInfo.renderer !== 'WebGPURenderer') errors.push('renderer-info.json must identify WebGPURenderer');
    if (rendererInfo.backend?.isWebGPUBackend !== true) errors.push('renderer-info.json must prove backend.isWebGPUBackend === true');
    if (rendererInfo.threeRevision !== '185' && rendererInfo.threeRevision !== '0.185.1') {
      errors.push('renderer-info.json must record Three revision 185');
    }
  }

  const frameTrace = json['frame-trace.json'];
  const performanceClaimed = manifest?.claimVerdicts?.performanceCompliance === 'PASS'
    || manifest?.claimVerdicts?.gpuAttribution === 'PASS';
  if (performanceClaimed) {
    const gpuP95 = datumValue(frameTrace?.summary?.gpuP95 ?? frameTrace?.gpuP95);
    if (gpuP95 === null || gpuP95 <= 0) errors.push('performance PASS requires a positive labelled GPU p95 timestamp value');
  }

  const leakLoop = json['leak-loop.json'];
  if (leakLoop) {
    const cycles = datumValue(leakLoop.cycles ?? leakLoop.loopCount);
    if (cycles === null || cycles < 50) errors.push('leak-loop.json requires at least 50 measured lifecycle cycles');
  }

  const readbacks = json['render-targets.json']?.readbacks ?? [];
  for (const readback of readbacks) {
    const bytesPerRow = datumValue(readback.bytesPerRow);
    if (!Number.isInteger(bytesPerRow) || bytesPerRow <= 0 || bytesPerRow % 256 !== 0) {
      errors.push(`render-target readback ${readback.id ?? '(unnamed)'} has an invalid 256-byte-aligned row stride`);
    }
  }

  return { valid: errors.length === 0, errors, json, imageHashes: Object.fromEntries(imageHashes) };
}
