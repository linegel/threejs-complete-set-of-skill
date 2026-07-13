import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
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
  artifactLedgerDigest,
  canonicalSha256,
  NORMATIVE_JSON_PATHS,
  STANDARD_IMAGE_PATHS,
} from './evidence-manifest-contract.mjs';
import { assertEvidenceManifestContract } from './evidence-manifest-contract.mjs';
import {
  assertLifecycleClaimEvidence,
  assertPerformanceClaimEvidence,
} from './evidence-runtime-claims.mjs';
import { loadCheckedSchemas, validateCheckedJsonSchema } from './checked-json-schema.mjs';
import { compareRgbaPngs, inspectRgbaPng } from './png-rgba.mjs';

export const TRACKED_RELEASE_PROJECTION_FILENAME = 'projection-manifest.json';
export const TRACKED_RELEASE_POLICY_DETAILS = Object.freeze({
  id: 'native-webgpu-tracked-release-v1',
  retainedFileKinds: Object.freeze(['normative-json', 'capture-session-write-ledger']),
  retainedSupplementaryPaths: Object.freeze(['strict-lane-join.json', 'tier-visual-evidence.json']),
  retainedImages: 'all-captured-images',
  sourceManifest: 'exact-approved-evidence-manifest-bytes',
  sourceClosure: 'embedded-path-hash-length-ledger',
  omittedPayloads: 'commitment-only',
  maximumTrackedPayloadBytes: 16 * 1024 * 1024,
});
export const TRACKED_RELEASE_POLICY = Object.freeze({
  id: TRACKED_RELEASE_POLICY_DETAILS.id,
  digest: canonicalSha256(TRACKED_RELEASE_POLICY_DETAILS),
});

const REQUIRED_CLAIMS = Object.freeze([
  'visualCorrectness',
  'mechanismCorrectness',
  'performanceCompliance',
  'gpuAttribution',
  'lifecycleStability',
  'visualError',
]);
const VERDICTS = new Set(['PASS', 'FAIL', 'INSUFFICIENT_EVIDENCE', 'NOT_CLAIMED']);
const DISTINCT_IMAGE_PAIRS = Object.freeze([
  ['final.design.png', 'diagnostics.mosaic.png', 0.01],
  ['final.design.png', 'no-post.design.png', 0.001],
  ['seed-0001.final.png', 'seed-9e3779b9.final.png', 0.001],
  ['temporal.t000.png', 'temporal.t001.png', 0.001],
  ['camera.near.png', 'camera.design.png', 0.001],
  ['camera.design.png', 'camera.far.png', 0.001],
]);

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function sameCanonicalValue(left, right) {
  try {
    return canonicalSha256(left) === canonicalSha256(right);
  } catch {
    return false;
  }
}

function projectionDigest(projection) {
  const { projectionDigest: ignored, ...payload } = projection ?? {};
  return canonicalSha256(payload);
}

function sourceClosureDigest(files) {
  const hash = createHash('sha256');
  for (const file of [...files].sort((left, right) => left.repositoryPath.localeCompare(right.repositoryPath))) {
    hash.update(file.repositoryPath);
    hash.update('\0');
    hash.update(file.sha256);
    hash.update('\0');
    hash.update(String(file.byteLength));
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

function retainedFileTuple(entry) {
  return {
    path: entry.path,
    status: entry.status,
    kind: entry.kind,
    sha256: entry.sha256,
    byteLength: entry.byteLength,
  };
}

function shouldRetainFile(entry) {
  if (entry?.status !== 'captured') return false;
  if (TRACKED_RELEASE_POLICY_DETAILS.retainedFileKinds.includes(entry.kind)) return true;
  return entry.kind === 'supplementary-json'
    && TRACKED_RELEASE_POLICY_DETAILS.retainedSupplementaryPaths.includes(entry.path);
}

function expectedRetainedFiles(sourceManifest) {
  return sourceManifest.files.filter(shouldRetainFile).map(retainedFileTuple);
}

function expectedRetainedImages(sourceManifest) {
  return sourceManifest.images
    .filter((image) => image.status === 'captured')
    .map((image) => structuredClone(image));
}

function expectedOmittedFiles(sourceManifest) {
  return sourceManifest.files.filter((entry) => entry.status === 'captured' && !shouldRetainFile(entry));
}

function omittedSummary(entries) {
  const byKind = new Map();
  for (const entry of entries) {
    const summary = byKind.get(entry.kind) ?? { kind: entry.kind, count: 0, byteLength: 0 };
    summary.count += 1;
    summary.byteLength += entry.byteLength;
    byKind.set(entry.kind, summary);
  }
  return {
    ledgerDigest: artifactLedgerDigest(entries),
    count: entries.length,
    byteLength: entries.reduce((total, entry) => total + entry.byteLength, 0),
    byKind: [...byKind.values()].sort((left, right) => left.kind.localeCompare(right.kind)),
  };
}

export function createTrackedReleaseProjectionManifest({ sourceManifest, sourceManifestBytes, sourceClosure }) {
  const retainedFiles = expectedRetainedFiles(sourceManifest);
  const retainedImages = expectedRetainedImages(sourceManifest);
  const omittedFiles = expectedOmittedFiles(sourceManifest);
  const projection = {
    schemaVersion: 1,
    projectionKind: 'tracked-release-projection-v1',
    policy: structuredClone(TRACKED_RELEASE_POLICY),
    labId: sourceManifest.labId,
    skill: sourceManifest.skill,
    threeRevision: sourceManifest.threeRevision,
    sourceClosureHash: sourceManifest.sourceClosureHash,
    buildRevision: sourceManifest.buildRevision,
    sourceRelease: {
      path: 'evidence-manifest.json',
      sha256: sha256(sourceManifestBytes),
      byteLength: sourceManifestBytes.byteLength,
      promotionBindingDigest: sourceManifest.promotion.bindingDigest,
      candidateBindingDigest: sourceManifest.promotion.visualSignoff.candidateBindingDigest,
      artifactLedgerDigest: sourceManifest.promotion.binding.artifactLedgerDigest,
      imageLedgerDigest: sourceManifest.promotion.binding.imageLedgerDigest,
    },
    sourceClosure: structuredClone(sourceClosure),
    retainedFiles,
    retainedImages,
    omittedFiles: omittedSummary(omittedFiles),
    checkoutLimitations: [{
      id: 'detached-source-payloads',
      status: 'ACTIVE',
      statement: 'Raw readbacks and capture-session transcript bytes are omitted from the tracked projection. Checkout validation verifies their approved hash and byte-length commitments, not the detached bytes themselves.',
      affectedClaims: [],
    }],
    projectionDigest: null,
  };
  projection.projectionDigest = projectionDigest(projection);
  return projection;
}

function confinedPath(rootDirectory, relativePath, { mustExist = true } = {}) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || isAbsolute(relativePath)) {
    throw new Error(`invalid projection path ${relativePath ?? '<missing>'}`);
  }
  const root = realpathSync(resolve(rootDirectory));
  const candidate = resolve(root, relativePath);
  const lexical = relative(root, candidate);
  if (lexical === '..' || lexical.startsWith(`..${sep}`) || isAbsolute(lexical)) {
    throw new Error(`projection path escapes its bundle: ${relativePath}`);
  }
  if (!mustExist) return candidate;
  const stat = lstatSync(candidate);
  if (stat.isSymbolicLink()) throw new Error(`projection path is a symbolic link: ${relativePath}`);
  const actual = realpathSync(candidate);
  const resolvedRelative = relative(root, actual);
  if (resolvedRelative === '..' || resolvedRelative.startsWith(`..${sep}`) || isAbsolute(resolvedRelative)) {
    throw new Error(`projection path resolves outside its bundle: ${relativePath}`);
  }
  return actual;
}

function readBoundFile(bundleDirectory, entry, label) {
  const bytes = readFileSync(confinedPath(bundleDirectory, entry.path));
  if (bytes.byteLength !== entry.byteLength) throw new Error(`${label} byte length differs from its projection ledger`);
  if (sha256(bytes) !== entry.sha256) throw new Error(`${label} SHA-256 differs from its projection ledger`);
  return bytes;
}

function walkProjectionFiles(directory, root = directory, output = []) {
  const rootReal = realpathSync(root);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    const stat = lstatSync(absolute);
    const relativePath = relative(rootReal, absolute).split(sep).join('/');
    if (stat.isSymbolicLink()) throw new Error(`projection contains symbolic link ${relativePath}`);
    if (stat.isDirectory()) walkProjectionFiles(absolute, root, output);
    else if (stat.isFile()) output.push(relativePath);
    else throw new Error(`projection contains unsupported filesystem entry ${relativePath}`);
  }
  return output;
}

function appendError(errors, label, error) {
  errors.push(`${label}: ${error.message}`);
  if (error instanceof AggregateError) {
    for (const nested of error.errors ?? []) errors.push(`${label}: ${nested.message}`);
  }
}

function validateSourceClosure(projection, repositoryRoot, errors) {
  const closure = projection.sourceClosure;
  const files = Array.isArray(closure?.files) ? closure.files : [];
  const paths = files.map((file) => file.repositoryPath);
  if (new Set(paths).size !== paths.length) errors.push('source closure duplicates repository paths');
  if (sourceClosureDigest(files) !== closure?.sourceHash) errors.push('source closure hash does not reconcile with its path/hash/length ledger');
  if (closure?.sourceHash !== projection.sourceClosureHash) errors.push('source closure hash differs from the projection sourceClosureHash');
  if (closure?.buildRevision !== projection.buildRevision) errors.push('source closure build revision differs from the projection buildRevision');
  if (closure?.threeRevision !== projection.threeRevision) errors.push('source closure Three.js revision differs from the projection');
  if (repositoryRoot === null || repositoryRoot === undefined) return false;
  for (const file of files) {
    try {
      const absolute = confinedPath(repositoryRoot, file.repositoryPath);
      const bytes = readFileSync(absolute);
      if (bytes.byteLength !== file.byteLength) errors.push(`source closure byte length drifted for ${file.repositoryPath}`);
      if (sha256(bytes) !== file.sha256) errors.push(`source closure SHA-256 drifted for ${file.repositoryPath}`);
    } catch (error) {
      errors.push(`source closure ${file.repositoryPath}: ${error.message}`);
    }
  }
  return true;
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

function validateRetainedPayloads(bundleDirectory, projection, sourceManifest, schemas, errors) {
  const json = { 'evidence-manifest.json': sourceManifest };
  for (const entry of projection.retainedFiles) {
    try {
      const bytes = readBoundFile(bundleDirectory, entry, `retained file ${entry.path}`);
      const artifact = JSON.parse(bytes.toString('utf8'));
      json[entry.path] = artifact;
      if (entry.kind === 'normative-json') {
        if (artifact === null || typeof artifact !== 'object' || Array.isArray(artifact) || artifact.schemaVersion !== 2) {
          throw new TypeError('normative JSON must be an object declaring schemaVersion 2');
        }
        assertLabelledNumerics(artifact);
      }
    } catch (error) {
      errors.push(`${entry.path}: ${error.message}`);
    }
  }
  if (json['pipeline-graph.json']) {
    const graphResult = validateCheckedJsonSchema(schemas.runtimeGraph, json['pipeline-graph.json']);
    errors.push(...graphResult.errors.map((error) => `pipeline-graph.json schema: ${error}`));
  }
  for (const [filename, artifact] of Object.entries(json)) {
    for (const verdict of findVerdicts(artifact)) {
      if (!VERDICTS.has(verdict.verdict)) errors.push(`${filename}${verdict.path.slice(1)} has invalid verdict ${verdict.verdict}`);
    }
  }
  try {
    assertPerformanceClaimEvidence(json, sourceManifest);
  } catch (error) {
    appendError(errors, 'performance evidence', error);
  }
  try {
    assertLifecycleClaimEvidence(json, sourceManifest);
  } catch (error) {
    appendError(errors, 'lifecycle evidence', error);
  }
  return json;
}

function validateRetainedImages(bundleDirectory, projection, errors) {
  const imageBytes = new Map();
  for (const image of projection.retainedImages) {
    try {
      const bytes = readBoundFile(bundleDirectory, image, `retained image ${image.path}`);
      const inspection = inspectRgbaPng(bytes, image.path);
      if (STANDARD_IMAGE_PATHS.includes(image.path) && (inspection.width !== 1200 || inspection.height !== 800)) {
        errors.push(`${image.path} must be a 1200x800 correctness capture; received ${inspection.width}x${inspection.height}`);
      }
      imageBytes.set(image.path, bytes);
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
}

function validateRawCommitments(bundleDirectory, projection, sourceManifest, errors) {
  const ledgerEntries = new Map();
  for (const retained of projection.retainedFiles.filter((entry) => entry.kind === 'capture-session-write-ledger')) {
    try {
      const ledger = JSON.parse(readBoundFile(bundleDirectory, retained, `write ledger ${retained.path}`).toString('utf8'));
      if (!Array.isArray(ledger.entries)) continue;
      for (const entry of ledger.entries) {
        if (typeof entry?.path !== 'string') continue;
        const existing = ledgerEntries.get(entry.path);
        if (existing && (existing.sha256 !== entry.sha256 || existing.byteLength !== entry.byteLength)) {
          errors.push(`write ledgers contradict one another for ${entry.path}`);
        } else ledgerEntries.set(entry.path, entry);
      }
    } catch (error) {
      errors.push(`${retained.path}: ${error.message}`);
    }
  }
  for (const entry of sourceManifest.files.filter((file) => file.status === 'captured' && file.kind === 'raw-readback')) {
    const ledger = ledgerEntries.get(entry.path);
    if (!ledger) errors.push(`detached raw readback ${entry.path} lacks a retained write-ledger commitment`);
    else if (ledger.sha256 !== entry.sha256 || ledger.byteLength !== entry.byteLength) {
      errors.push(`detached raw readback ${entry.path} conflicts with its retained write-ledger commitment`);
    }
  }
}

export function validateTrackedReleaseProjection(bundleDirectory, {
  requireRequiredClaimsPass = false,
  repositoryRoot = null,
} = {}) {
  const errors = [];
  const projectionPath = join(bundleDirectory, TRACKED_RELEASE_PROJECTION_FILENAME);
  if (!existsSync(projectionPath)) {
    return {
      valid: false,
      errors: [`missing ${TRACKED_RELEASE_PROJECTION_FILENAME}`],
      protocol: 'missing',
      canonicalAcceptanceEligible: false,
    };
  }
  let projection;
  try {
    projection = JSON.parse(readFileSync(confinedPath(bundleDirectory, TRACKED_RELEASE_PROJECTION_FILENAME), 'utf8'));
  } catch (error) {
    return {
      valid: false,
      errors: [`${TRACKED_RELEASE_PROJECTION_FILENAME}: ${error.message}`],
      protocol: 'invalid',
      canonicalAcceptanceEligible: false,
    };
  }
  const schemas = loadCheckedSchemas();
  const schemaResult = validateCheckedJsonSchema(schemas.trackedReleaseProjection, projection);
  errors.push(...schemaResult.errors.map((error) => `${TRACKED_RELEASE_PROJECTION_FILENAME} schema: ${error}`));
  if (!sameCanonicalValue(projection.policy, TRACKED_RELEASE_POLICY)) errors.push('projection policy differs from the built-in tracked release policy');
  if (projection.projectionDigest !== projectionDigest(projection)) errors.push('projection digest does not match the canonical projection payload');

  let sourceManifest = null;
  try {
    const sourceBytes = readBoundFile(bundleDirectory, projection.sourceRelease, 'approved source release manifest');
    sourceManifest = JSON.parse(sourceBytes.toString('utf8'));
    const sourceSchema = validateCheckedJsonSchema(schemas.evidenceManifest, sourceManifest);
    errors.push(...sourceSchema.errors.map((error) => `evidence-manifest.json schema: ${error}`));
    if (sourceSchema.valid) assertEvidenceManifestContract(sourceManifest);
  } catch (error) {
    appendError(errors, 'evidence-manifest.json', error);
  }

  let sourceClosureVerified = false;
  if (sourceManifest) {
    if (sourceManifest.bundleKind !== 'release-bundle' || sourceManifest.publishable !== true || sourceManifest.promotion?.status !== 'APPROVED') {
      errors.push('tracked projection requires an approved publishable source release');
    }
    if (projection.labId !== sourceManifest.labId || projection.skill !== sourceManifest.skill) errors.push('projection identity differs from its source release');
    if (projection.threeRevision !== sourceManifest.threeRevision) errors.push('projection Three.js revision differs from its source release');
    if (projection.sourceClosureHash !== sourceManifest.sourceClosureHash) errors.push('projection source closure differs from its source release');
    if (projection.buildRevision !== sourceManifest.buildRevision) errors.push('projection build revision differs from its source release');
    if (projection.sourceRelease.promotionBindingDigest !== sourceManifest.promotion?.bindingDigest) errors.push('projection source promotion binding digest drifted');
    if (projection.sourceRelease.candidateBindingDigest !== sourceManifest.promotion?.visualSignoff?.candidateBindingDigest) errors.push('projection source candidate binding digest drifted');
    if (projection.sourceRelease.artifactLedgerDigest !== sourceManifest.promotion?.binding?.artifactLedgerDigest) errors.push('projection source artifact ledger digest drifted');
    if (projection.sourceRelease.imageLedgerDigest !== sourceManifest.promotion?.binding?.imageLedgerDigest) errors.push('projection source image ledger digest drifted');
    if (!sameCanonicalValue(projection.retainedFiles, expectedRetainedFiles(sourceManifest))) errors.push('retained file ledger differs from the fixed projection policy');
    if (!sameCanonicalValue(projection.retainedImages, expectedRetainedImages(sourceManifest))) errors.push('retained image ledger differs from the fixed projection policy');
    if (!sameCanonicalValue(projection.omittedFiles, omittedSummary(expectedOmittedFiles(sourceManifest)))) errors.push('omitted file summary differs from the approved source ledger');
    const optionalUnclaimed = new Set(['performanceCompliance', 'gpuAttribution']);
    for (const claim of REQUIRED_CLAIMS) {
      const verdict = sourceManifest.claimVerdicts?.[claim];
      if (!VERDICTS.has(verdict)) errors.push(`source release claimVerdicts.${claim} is missing or invalid`);
      else if (requireRequiredClaimsPass) {
        if (optionalUnclaimed.has(claim)) {
          if (verdict !== 'PASS' && verdict !== 'NOT_CLAIMED') {
            errors.push(`source release claimVerdicts.${claim} must be PASS or NOT_CLAIMED; received ${verdict}`);
          }
        } else if (verdict !== 'PASS') {
          errors.push(`source release claimVerdicts.${claim} must be PASS; received ${verdict}`);
        }
      }
    }
    sourceClosureVerified = validateSourceClosure(projection, repositoryRoot, errors);
    validateRetainedPayloads(bundleDirectory, projection, sourceManifest, schemas, errors);
    validateRetainedImages(bundleDirectory, projection, errors);
    validateRawCommitments(bundleDirectory, projection, sourceManifest, errors);
  }

  try {
    const expectedPaths = new Set([
      TRACKED_RELEASE_PROJECTION_FILENAME,
      'evidence-manifest.json',
      ...(projection.retainedFiles ?? []).map((entry) => entry.path),
      ...(projection.retainedImages ?? []).map((entry) => entry.path),
    ]);
    const actualPaths = walkProjectionFiles(realpathSync(resolve(bundleDirectory))).sort();
    const expectedSorted = [...expectedPaths].sort();
    if (!sameCanonicalValue(actualPaths, expectedSorted)) errors.push('tracked projection directory contains missing or unledgered files');
  } catch (error) {
    errors.push(`projection directory closure: ${error.message}`);
  }
  if (requireRequiredClaimsPass && !sourceClosureVerified) errors.push('accepted tracked projection requires current-checkout source-closure verification');
  const canonicalAcceptanceEligible = errors.length === 0
    && sourceManifest?.publishable === true
    && sourceManifest?.promotion?.status === 'APPROVED'
    && sourceClosureVerified;
  return {
    valid: errors.length === 0,
    errors,
    protocol: 'tracked-release-projection-v1',
    canonicalAcceptanceEligible,
    projection,
    manifest: sourceManifest,
    json: sourceManifest ? { 'evidence-manifest.json': sourceManifest } : {},
    imageHashes: Object.fromEntries((projection.retainedImages ?? []).map((image) => [image.path, image.sha256])),
    sourceClosureVerified,
  };
}
