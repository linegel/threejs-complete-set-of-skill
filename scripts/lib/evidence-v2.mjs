import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import {
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';

import { assertLabelledNumerics } from '../../labs/runtime/numeric-evidence.mjs';
import {
  assertEvidenceManifestContract,
} from './evidence-manifest-contract.mjs';
import {
  assertLifecycleClaimEvidence,
  assertPerformanceClaimEvidence,
} from './evidence-runtime-claims.mjs';
import { loadCheckedSchemas, validateCheckedJsonSchema } from './checked-json-schema.mjs';
import { compareRgbaPngs, inspectRgbaPng } from './png-rgba.mjs';
import {
  TRACKED_RELEASE_PROJECTION_FILENAME,
  validateTrackedReleaseProjection,
} from './tracked-release-projection.mjs';

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

const REQUIRED_CLAIMS = Object.freeze([
  'visualCorrectness',
  'mechanismCorrectness',
  'performanceCompliance',
  'gpuAttribution',
  'lifecycleStability',
]);
const VERDICTS = new Set(['PASS', 'FAIL', 'INSUFFICIENT_EVIDENCE', 'NOT_CLAIMED']);
const UNIFIED_V2_BUNDLE_KINDS = new Set([
  'contract-fixture',
  'raw-capture-session',
  'release-bundle',
]);
const UNIFIED_V2_LEDGER_KEYS = Object.freeze([
  'captureSessions',
  'files',
  'images',
  'promotion',
]);
const DISTINCT_IMAGE_PAIRS = Object.freeze([
  ['final.design.png', 'diagnostics.mosaic.png', 0.01],
  ['final.design.png', 'no-post.design.png', 0.001],
  ['seed-0001.final.png', 'seed-9e3779b9.final.png', 0.001],
  ['temporal.t000.png', 'temporal.t001.png', 0.001],
  ['camera.near.png', 'camera.design.png', 0.001],
  ['camera.design.png', 'camera.far.png', 0.001],
  ['camera.near.png', 'camera.far.png', 0.001],
]);

function artifactPath(bundleDir, filename) {
  const direct = join(bundleDir, filename);
  if (existsSync(direct)) return direct;
  const images = join(bundleDir, 'images', filename);
  if (existsSync(images)) return images;
  return direct;
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function hashFile(path) {
  return sha256(readFileSync(path));
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

function appendError(errors, label, error) {
  errors.push(`${label}: ${error.message}`);
  if (error instanceof AggregateError) {
    for (const nested of error.errors ?? []) errors.push(`${label}: ${nested.message}`);
  }
}

function confinedArtifactPath(bundleDir, filename) {
  if (typeof filename !== 'string' || filename.length === 0 || isAbsolute(filename)) {
    throw new Error(`evidence artifact path is invalid: ${filename ?? '<missing>'}`);
  }
  const root = realpathSync(resolve(bundleDir));
  const candidate = resolve(root, filename);
  const lexical = relative(root, candidate);
  if (lexical === '..' || lexical.startsWith(`..${sep}`) || isAbsolute(lexical)) {
    throw new Error(`evidence artifact path escapes its bundle: ${filename}`);
  }
  const actual = realpathSync(candidate);
  const resolvedRelative = relative(root, actual);
  if (resolvedRelative === '..' || resolvedRelative.startsWith(`..${sep}`) || isAbsolute(resolvedRelative)) {
    throw new Error(`evidence artifact realpath escapes its bundle: ${filename}`);
  }
  return actual;
}

function readBoundEntry(bundleDir, entry, label) {
  const path = confinedArtifactPath(bundleDir, entry.path);
  const bytes = readFileSync(path);
  if (bytes.byteLength !== entry.byteLength) throw new Error(`${label} byte length differs from its ledger`);
  if (sha256(bytes) !== entry.sha256) throw new Error(`${label} SHA-256 differs from its ledger`);
  return bytes;
}

function validateClaimVerdicts(manifest, errors, requireRequiredClaimsPass) {
  for (const claim of REQUIRED_CLAIMS) {
    const verdict = manifest?.claimVerdicts?.[claim];
    if (!VERDICTS.has(verdict)) errors.push(`evidence-manifest.json claimVerdicts.${claim} is missing or invalid`);
    else if (requireRequiredClaimsPass && verdict !== 'PASS') {
      errors.push(`evidence-manifest.json claimVerdicts.${claim} must be PASS for accepted coverage; received ${verdict}`);
    }
  }
}

function validateAllVerdicts(json, errors) {
  for (const [filename, contents] of Object.entries(json)) {
    for (const verdict of findVerdicts(contents)) {
      if (!VERDICTS.has(verdict.verdict)) {
        errors.push(`${filename}${verdict.path.slice(1)} has invalid verdict ${verdict.verdict}`);
      }
    }
  }
}

function visitProperties(value, visitor, path = '$') {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((child, index) => visitProperties(child, visitor, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    visitor(key, child, `${path}.${key}`);
    visitProperties(child, visitor, `${path}.${key}`);
  }
}

function validateRuntimeClaims(json, manifest, errors) {
  const rendererInfo = json['renderer-info.json'];
  if (rendererInfo) {
    if (rendererInfo.renderer !== 'WebGPURenderer') errors.push('renderer-info.json must identify WebGPURenderer');
    const backendProven = rendererInfo.backend === 'WebGPU'
      || rendererInfo.backend?.isWebGPUBackend === true;
    if (!backendProven) errors.push('renderer-info.json must prove the WebGPU backend');
    if (rendererInfo.threeRevision !== '185' && rendererInfo.threeRevision !== '0.185.1') {
      errors.push('renderer-info.json must record Three revision 185');
    }
  }

  const performanceClaimed = manifest?.claimVerdicts?.performanceCompliance === 'PASS'
    || manifest?.claimVerdicts?.gpuAttribution === 'PASS';
  const frameTrace = json['frame-trace.json'];
  const performanceEnvelope = json['performance-envelope.json'];
  const qualityGovernor = json['quality-governor.json'];
  if (performanceClaimed) {
    const gpuP95Datum = frameTrace?.gpuP95
      ?? frameTrace?.summary?.gpuP95
      ?? frameTrace?.sustained?.gpuP95
      ?? frameTrace?.renderTimestamp;
    const gpuP95 = datumValue(gpuP95Datum);
    if (gpuP95 === null || gpuP95 <= 0 || !/timestamp/i.test(gpuP95Datum?.source ?? '')) {
      errors.push('performance PASS requires a positive labelled GPU p95 timestamp value');
    }
    const gpuGate = datumValue(performanceEnvelope?.gpuP95Gate);
    if (gpuP95 !== null && gpuGate !== null && gpuP95 > gpuGate) {
      errors.push(`performance GPU p95 ${gpuP95} ms exceeds its ${gpuGate} ms gate`);
    }
    const deadlineMissRatio = datumValue(frameTrace?.sustained?.deadlineMissRatio);
    const deadlineGate = datumValue(performanceEnvelope?.deadlineMissRatioGate);
    if (deadlineMissRatio !== null && deadlineGate !== null && deadlineMissRatio > deadlineGate) {
      errors.push('performance deadline-miss ratio exceeds its declared gate');
    }
    if (qualityGovernor?.verdict !== 'PASS') {
      errors.push('performance PASS requires a passing quality-governor trace');
    }
  }

  const leakLoop = json['leak-loop.json'];
  if (manifest?.claimVerdicts?.lifecycleStability === 'PASS') {
    const cycles = datumValue(leakLoop?.cycles ?? leakLoop?.loopCount);
    if (cycles === null || cycles < 50) errors.push('leak-loop.json requires at least 50 measured lifecycle cycles');
    if (leakLoop?.verdict !== 'PASS') errors.push('lifecycle PASS requires leak-loop.json verdict PASS');
    if (Array.isArray(leakLoop?.cycleSnapshots) && leakLoop.cycleSnapshots.length < cycles) {
      errors.push('leak-loop.json cycle snapshots do not cover every claimed lifecycle cycle');
    }
  }

  const renderTargets = json['render-targets.json'];
  visitProperties(renderTargets, (key, child, path) => {
    if (key !== 'bytesPerRow') return;
    const bytesPerRow = datumValue(child);
    if (!Number.isInteger(bytesPerRow) || bytesPerRow <= 0 || bytesPerRow % 256 !== 0) {
      errors.push(`${path} has an invalid 256-byte-aligned row stride`);
    }
  });
}

function validateLegacyManifestOnly(manifest, requireRequiredClaimsPass) {
  const errors = [];
  if (manifest.schemaVersion !== 1) errors.push('legacy evidence manifest must declare schemaVersion 1');
  for (const verdict of findVerdicts(manifest)) {
    if (!VERDICTS.has(verdict.verdict)) errors.push(`evidence-manifest.json${verdict.path.slice(1)} has invalid verdict ${verdict.verdict}`);
  }
  if (requireRequiredClaimsPass) errors.push('legacy v1 evidence cannot satisfy canonical v2 acceptance');
  return {
    valid: errors.length === 0,
    errors,
    json: { 'evidence-manifest.json': manifest },
    imageHashes: {},
    protocol: 'legacy-v1',
    canonicalAcceptanceEligible: false,
  };
}

function validateLegacyV2Bundle(bundleDir, manifest, requireRequiredClaimsPass) {
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
      const inspection = inspectRgbaPng(readFileSync(path), filename);
      if (inspection.width !== 1200 || inspection.height !== 800) {
        errors.push(`${filename} must be a 1200x800 correctness capture; received ${inspection.width}x${inspection.height}`);
      }
      imageHashes.set(filename, hashFile(path));
    } catch (error) {
      errors.push(error.message);
    }
  }
  validateClaimVerdicts(manifest, errors, false);
  validateAllVerdicts(json, errors);
  validateRuntimeClaims(json, manifest, errors);
  if (requireRequiredClaimsPass) {
    errors.push('pre-unified v2 evidence cannot satisfy canonical acceptance; recapture with a ledgered release bundle');
  }
  return {
    valid: errors.length === 0,
    errors,
    json,
    imageHashes: Object.fromEntries(imageHashes),
    protocol: 'legacy-v2',
    canonicalAcceptanceEligible: false,
  };
}

function validateUnifiedV2Bundle(bundleDir, manifest, requireRequiredClaimsPass) {
  const errors = [];
  const schemas = loadCheckedSchemas();
  const schemaResult = validateCheckedJsonSchema(schemas.evidenceManifest, manifest);
  errors.push(...schemaResult.errors.map((error) => `evidence-manifest.json schema: ${error}`));
  if (schemaResult.valid) {
    try {
      assertEvidenceManifestContract(manifest);
    } catch (error) {
      appendError(errors, 'evidence-manifest.json semantic contract', error);
    }
  }

  const json = { 'evidence-manifest.json': manifest };
  for (const entry of manifest.files ?? []) {
    if (entry.status !== 'captured') continue;
    try {
      const bytes = readBoundEntry(bundleDir, entry, `file ledger entry ${entry.path}`);
      if (['normative-json', 'supplementary-json', 'capture-session-document', 'capture-session-write-ledger'].includes(entry.kind)) {
        const artifact = JSON.parse(bytes.toString('utf8'));
        json[entry.path] = artifact;
        if (entry.kind === 'normative-json') {
          if (artifact === null || typeof artifact !== 'object' || Array.isArray(artifact) || artifact.schemaVersion !== 2) {
            throw new TypeError('captured normative JSON must be an object declaring schemaVersion 2');
          }
          assertLabelledNumerics(artifact);
        }
      }
    } catch (error) {
      errors.push(`${entry.path}: ${error.message}`);
    }
  }
  const pipelineGraph = json['pipeline-graph.json'];
  if (pipelineGraph) {
    const graphResult = validateCheckedJsonSchema(schemas.runtimeGraph, pipelineGraph);
    errors.push(...graphResult.errors.map((error) => `pipeline-graph.json schema: ${error}`));
  }

  const imageBytes = new Map();
  const imageHashes = new Map();
  const correctnessDimensions = manifest.bundleKind === 'release-bundle'
    || (manifest.captureSessions ?? []).some((session) => session.profile === 'correctness');
  for (const image of manifest.images ?? []) {
    if (image.status !== 'captured') continue;
    try {
      const bytes = readBoundEntry(bundleDir, image, `image ledger entry ${image.path}`);
      const inspection = inspectRgbaPng(bytes, image.path);
      if (correctnessDimensions && REQUIRED_EVIDENCE_IMAGES.includes(image.path)
        && (inspection.width !== 1200 || inspection.height !== 800)) {
        errors.push(`${image.path} must be a 1200x800 correctness capture; received ${inspection.width}x${inspection.height}`);
      }
      imageBytes.set(image.path, bytes);
      imageHashes.set(image.path, sha256(bytes));
    } catch (error) {
      errors.push(`${image.path}: ${error.message}`);
    }
  }
  for (const [baselinePath, candidatePath, minimumRatio] of DISTINCT_IMAGE_PAIRS) {
    const baseline = imageBytes.get(baselinePath);
    const candidate = imageBytes.get(candidatePath);
    if (!baseline || !candidate) continue;
    try {
      const comparison = compareRgbaPngs(baseline, candidate);
      if (comparison.ratio < minimumRatio || comparison.maxChannelDelta < 8) {
        errors.push(`${candidatePath} does not differ materially from ${baselinePath}`);
      }
    } catch (error) {
      errors.push(`${baselinePath} vs ${candidatePath}: ${error.message}`);
    }
  }

  validateClaimVerdicts(manifest, errors, requireRequiredClaimsPass);
  validateAllVerdicts(json, errors);
  validateRuntimeClaims(json, manifest, errors);
  try {
    assertPerformanceClaimEvidence(json, manifest);
  } catch (error) {
    appendError(errors, 'performance evidence', error);
  }
  try {
    assertLifecycleClaimEvidence(json, manifest);
  } catch (error) {
    appendError(errors, 'lifecycle evidence', error);
  }
  if (requireRequiredClaimsPass && (
    manifest.bundleKind !== 'release-bundle'
    || manifest.publishable !== true
    || manifest.promotion?.status !== 'APPROVED'
  )) {
    errors.push('accepted coverage requires an approved publishable unified release bundle');
  }
  const canonicalAcceptanceEligible = errors.length === 0
    && manifest.bundleKind === 'release-bundle'
    && manifest.publishable === true
    && manifest.promotion?.status === 'APPROVED';
  return {
    valid: errors.length === 0,
    errors,
    json,
    imageHashes: Object.fromEntries(imageHashes),
    protocol: 'unified-v2',
    canonicalAcceptanceEligible,
    manifest,
  };
}

export function validateEvidenceBundle(bundleDir, {
  requireRequiredClaimsPass = false,
  repositoryRoot = null,
} = {}) {
  if (existsSync(join(bundleDir, TRACKED_RELEASE_PROJECTION_FILENAME))) {
    return validateTrackedReleaseProjection(bundleDir, {
      requireRequiredClaimsPass,
      repositoryRoot,
    });
  }
  const manifestPath = artifactPath(bundleDir, 'evidence-manifest.json');
  if (!existsSync(manifestPath)) {
    return {
      valid: false,
      errors: ['missing evidence-manifest.json'],
      json: {},
      imageHashes: {},
      protocol: 'missing',
      canonicalAcceptanceEligible: false,
    };
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return {
      valid: false,
      errors: [`evidence-manifest.json is not valid JSON: ${error.message}`],
      json: {},
      imageHashes: {},
      protocol: 'invalid',
      canonicalAcceptanceEligible: false,
    };
  }
  if (manifest.schemaVersion === 1) {
    return validateLegacyManifestOnly(manifest, requireRequiredClaimsPass);
  }
  const hasUnifiedLedgerSurface = UNIFIED_V2_LEDGER_KEYS.some((key) => Object.hasOwn(manifest, key));
  if (manifest.schemaVersion === 2
    && !UNIFIED_V2_BUNDLE_KINDS.has(manifest.bundleKind)
    && !hasUnifiedLedgerSurface) {
    return validateLegacyV2Bundle(bundleDir, manifest, requireRequiredClaimsPass);
  }
  if (manifest.schemaVersion !== 2) {
    return {
      valid: false,
      errors: [`unsupported evidence schemaVersion ${manifest.schemaVersion ?? '<missing>'}`],
      json: { 'evidence-manifest.json': manifest },
      imageHashes: {},
      protocol: 'invalid',
      canonicalAcceptanceEligible: false,
    };
  }
  return validateUnifiedV2Bundle(bundleDir, manifest, requireRequiredClaimsPass);
}
