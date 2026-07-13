#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateEvidenceBundle } from './lib/evidence-v2.mjs';
import { buildDemoRegistry } from './lib/lab-registry.mjs';
import {
  createTrackedReleaseProjectionManifest,
  TRACKED_RELEASE_POLICY_DETAILS,
  TRACKED_RELEASE_PROJECTION_FILENAME,
  validateTrackedReleaseProjection,
} from './lib/tracked-release-projection.mjs';

const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));

function sha256Bytes(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function materializeSourceClosureFiles(sourceClosure, repositoryRoot) {
  if (Array.isArray(sourceClosure?.files) && sourceClosure.files.length > 0) return sourceClosure;
  const roots = sourceClosure?.roots;
  if (!Array.isArray(roots) || roots.length === 0) throw new Error('source closure has no roots to materialize');
  const excludedSegments = new Set(['.git', '.DS_Store', 'artifacts', 'node_modules']);
  const excludedFiles = new Set(['lab.manifest.json', 'lab-manifest.json']);
  const files = [];
  const walk = (absolute) => {
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) return;
    if (stat.isFile()) {
      if (excludedFiles.has(basename(absolute))) return;
      const bytes = readFileSync(absolute);
      files.push({
        repositoryPath: relative(repositoryRoot, absolute).split(sep).join('/'),
        sha256: sha256Bytes(bytes),
        byteLength: bytes.byteLength,
      });
      return;
    }
    if (!stat.isDirectory()) return;
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (excludedSegments.has(entry.name) || excludedFiles.has(entry.name)) continue;
      walk(join(absolute, entry.name));
    }
  };
  for (const root of roots) {
    const absolute = resolve(repositoryRoot, root);
    if (!existsSync(absolute)) throw new Error(`source closure root missing: ${root}`);
    walk(absolute);
  }
  files.sort((left, right) => left.repositoryPath.localeCompare(right.repositoryPath));
  return { ...sourceClosure, files };
}



function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function assertOutside(candidate, root, label) {
  const rel = relative(resolve(root), resolve(candidate));
  if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) {
    throw new Error(`${label} must be outside the repository checkout`);
  }
}

function confinedSourcePath(root, path) {
  if (typeof path !== 'string' || path.length === 0 || isAbsolute(path)) throw new Error(`invalid source path ${path ?? '<missing>'}`);
  const candidate = resolve(root, path);
  const rel = relative(resolve(root), candidate);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`source path escapes candidate: ${path}`);
  const stat = lstatSync(candidate);
  if (stat.isSymbolicLink()) throw new Error(`source path is a symbolic link: ${path}`);
  if (!stat.isFile()) throw new Error(`source path is not a regular file: ${path}`);
  return candidate;
}

async function readBoundSource(candidateDirectory, entry) {
  const bytes = await readFile(confinedSourcePath(candidateDirectory, entry.path));
  if (bytes.byteLength !== entry.byteLength || sha256(bytes) !== entry.sha256) {
    throw new Error(`approved source artifact drifted: ${entry.path}`);
  }
  return bytes;
}

async function writeExclusive(root, path, bytes) {
  const output = resolve(root, path);
  const rel = relative(resolve(root), output);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`output path escapes staging: ${path}`);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, bytes, { flag: 'wx' });
}

const labId = option('--lab');
const candidateOption = option('--candidate');
const expectedBinding = option('--expected-binding');
if (!labId || !candidateOption || !expectedBinding) {
  throw new Error('Usage: node scripts/project-tracked-release.mjs --lab <id> --candidate <absolute-approved-release> --expected-binding <sha256> [--check]');
}
if (!isAbsolute(candidateOption)) throw new Error('--candidate must be an absolute path');
const candidateDirectory = resolve(candidateOption);
assertOutside(candidateDirectory, REPOSITORY_ROOT, 'approved source release');

const registry = buildDemoRegistry();
const lab = registry.demos.find((entry) => entry.id === labId);
if (!lab) throw new Error(`unknown lab ${labId}`);
if (!lab.evidenceBundle) throw new Error(`${labId} has no canonical evidenceBundle path`);
const canonicalEvidenceBundle = `docs/visual-validation/${labId}/bundle`;
if (lab.evidenceBundle !== canonicalEvidenceBundle && !lab.evidenceBundle.endsWith(`/${canonicalEvidenceBundle}`)) {
  throw new Error(`${labId} evidenceBundle does not name its canonical tracked release path`);
}
const outputDirectory = resolve(REPOSITORY_ROOT, canonicalEvidenceBundle);
if (relative(REPOSITORY_ROOT, outputDirectory).startsWith('..')) throw new Error(`${labId} evidenceBundle escapes the repository`);

const sourceValidation = validateEvidenceBundle(candidateDirectory, { requireRequiredClaimsPass: true });
if (!sourceValidation.valid || sourceValidation.protocol !== 'unified-v2') {
  throw new AggregateError(sourceValidation.errors.map((message) => new Error(message)), 'approved source release is not a valid full unified-v2 bundle');
}
const sourceManifest = sourceValidation.manifest;
if (sourceManifest.labId !== labId) throw new Error(`approved source release belongs to ${sourceManifest.labId}, not ${labId}`);
if (sourceManifest.promotion.bindingDigest !== expectedBinding) throw new Error('approved source release binding differs from --expected-binding');
const sourceManifestBytes = await readFile(confinedSourcePath(candidateDirectory, 'evidence-manifest.json'));

const correctness = sourceManifest.captureSessions.find((session) => session.profile === 'correctness');
if (!correctness) throw new Error('approved source release has no correctness capture session');
const correctnessDocument = JSON.parse((await readBoundSource(candidateDirectory, {
  path: correctness.document.path,
  sha256: correctness.document.sha256,
  byteLength: correctness.document.byteLength,
})).toString('utf8'));
if (!correctnessDocument.sourceClosure) throw new Error('correctness capture session omits its transitive source closure');

const projection = createTrackedReleaseProjectionManifest({
  sourceManifest,
  sourceManifestBytes,
  sourceClosure: materializeSourceClosureFiles(correctnessDocument.sourceClosure, REPOSITORY_ROOT),
});
const retainedBytes = projection.retainedFiles.reduce((total, entry) => total + entry.byteLength, 0)
  + projection.retainedImages.reduce((total, entry) => total + entry.byteLength, 0)
  + sourceManifestBytes.byteLength
  + Buffer.byteLength(`${JSON.stringify(projection, null, 2)}\n`);
if (retainedBytes > TRACKED_RELEASE_POLICY_DETAILS.maximumTrackedPayloadBytes) {
  throw new Error(`tracked projection would retain ${retainedBytes} bytes, above the ${TRACKED_RELEASE_POLICY_DETAILS.maximumTrackedPayloadBytes}-byte policy gate`);
}

const summary = {
  labId,
  sourceBinding: expectedBinding,
  projectionDigest: projection.projectionDigest,
  retainedCount: projection.retainedFiles.length + projection.retainedImages.length + 2,
  retainedBytes,
  omittedCount: projection.omittedFiles.count,
  omittedBytes: projection.omittedFiles.byteLength,
  outputDirectory,
  checkOnly: hasFlag('--check'),
};
if (hasFlag('--check')) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}
if (existsSync(outputDirectory)) throw new Error(`tracked projection output already exists: ${outputDirectory}`);

await mkdir(dirname(outputDirectory), { recursive: true });
const stagingDirectory = await mkdtemp(join(dirname(outputDirectory), `.${labId}.projection-staging-`));
try {
  await writeExclusive(stagingDirectory, 'evidence-manifest.json', sourceManifestBytes);
  for (const entry of [...projection.retainedFiles, ...projection.retainedImages]) {
    await writeExclusive(stagingDirectory, entry.path, await readBoundSource(candidateDirectory, entry));
  }
  await writeExclusive(stagingDirectory, TRACKED_RELEASE_PROJECTION_FILENAME, Buffer.from(`${JSON.stringify(projection, null, 2)}\n`));
  const validation = validateTrackedReleaseProjection(stagingDirectory, {
    requireRequiredClaimsPass: true,
    repositoryRoot: REPOSITORY_ROOT,
  });
  if (!validation.valid) {
    throw new AggregateError(validation.errors.map((message) => new Error(message)), `tracked projection validation failed; staging retained at ${stagingDirectory}`);
  }
  await rename(stagingDirectory, outputDirectory);
} catch (error) {
  error.message = `${error.message}; staging retained at ${stagingDirectory}`;
  throw error;
}

console.log(JSON.stringify(summary, null, 2));
