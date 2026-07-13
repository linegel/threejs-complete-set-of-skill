import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';

import { build as viteBuild } from 'vite';

import { buildDemoRegistry, REPO_ROOT } from './lab-registry.mjs';
import { canonicalSha256 } from './evidence-manifest-contract.mjs';

export const IMMUTABLE_LAB_BUILD_MANIFEST = 'immutable-lab-build.json';
export const IMMUTABLE_LAB_BUILD_CONTRACT = 'declared-route-entrypoints-v1';

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function isWithin(path, parent) {
  const candidate = relative(parent, path);
  return candidate === '' || (candidate.startsWith('..') === false && isAbsolute(candidate) === false);
}

async function listOutputFiles(root, directory = root) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`immutable lab build rejects symlink ${path}`);
    if (entry.isDirectory()) files.push(...await listOutputFiles(root, path));
    else if (entry.isFile()) files.push(relative(root, path).replaceAll('\\', '/'));
  }
  return files.sort();
}

async function fileLedger(outputDirectory) {
  const ledger = {};
  for (const path of await listOutputFiles(outputDirectory)) {
    if (path === IMMUTABLE_LAB_BUILD_MANIFEST) continue;
    const bytes = await readFile(join(outputDirectory, path));
    ledger[path] = { sha256: sha256(bytes), byteLength: bytes.byteLength };
  }
  return ledger;
}

function htmlInputs(root, directory = root) {
  const inputs = {};
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`immutable lab build rejects source symlink ${join(directory, entry.name)}`);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      Object.assign(inputs, htmlInputs(root, join(directory, entry.name)));
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.html') {
      const path = join(directory, entry.name);
      const relativePath = relative(root, path).replaceAll('\\', '/');
      inputs[relativePath.slice(0, -'.html'.length)] = path;
    }
  }
  return inputs;
}

function declaredHtmlInputs(root, demo) {
  const available = htmlInputs(root);
  const declaredPaths = new Set([ 'index.html' ]);
  for (const [kind, entries] of [
    [ 'scenario', demo.scenarios ?? [] ],
    [ 'mechanism', demo.mechanisms ?? [] ],
    [ 'tier', demo.tiers ?? [] ],
  ]) {
    for (const entry of entries) declaredPaths.add(`${kind}/${entry.id}/index.html`);
  }
  const selected = {};
  for (const path of [ ...declaredPaths ].sort()) {
    const key = path.slice(0, -'.html'.length);
    if (available[key]) selected[key] = available[key];
  }
  return selected;
}

function resolveLab(labId) {
  const registry = buildDemoRegistry();
  const demo = registry.demos.find((entry) => entry.id === labId);
  if (!demo || typeof demo.browserEntry !== 'string') throw new Error(`immutable lab build cannot resolve browser lab ${labId}`);
  const root = dirname(join(REPO_ROOT, demo.browserEntry));
  if (!isWithin(root, REPO_ROOT) || !existsSync(root) || !lstatSync(root).isDirectory()) {
    throw new Error(`immutable lab root for ${labId} is outside the repository or missing`);
  }
  const sourceClosure = {
    algorithm: 'demo-registry-transitive-source-closure-v2',
    roots: demo.sourceHashInputs,
    files: null,
    sourceHash: demo.sourceHash,
    buildRevision: registry.buildRevision,
    threeRevision: registry.threeRevision,
  };
  return { demo, registry, root, sourceClosure };
}

export async function loadAndValidateImmutableLabBuild(outputDirectory, options = {}) {
  const manifestPath = join(outputDirectory, IMMUTABLE_LAB_BUILD_MANIFEST);
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.schemaVersion !== 1 || manifest.kind !== 'immutable-lab-build-v1' || manifest.immutable !== true) {
    throw new Error('immutable lab build manifest identity is invalid');
  }
  if (options.expectedLabId && manifest.labId !== options.expectedLabId) throw new Error('immutable lab build belongs to another lab');
  if (manifest.viteDevelopmentServer !== false || manifest.transformAtServe !== false
    || manifest.redirects !== false || manifest.spaFallback !== false) {
    throw new Error('immutable lab build enables development transforms, redirects, or fallback');
  }
  if (manifest.threeRevision !== '0.185.1') throw new Error('immutable lab build has the wrong Three revision');
  const expectedContentAddress = canonicalSha256({
    builderContract: manifest.builderContract,
    labId: manifest.labId,
    sourceClosureHash: manifest.sourceClosureHash,
    buildRevision: manifest.buildRevision,
    threeRevision: manifest.threeRevision,
  });
  if (manifest.contentAddress !== expectedContentAddress) throw new Error('immutable lab content address is stale');
  if (manifest.builderContract !== IMMUTABLE_LAB_BUILD_CONTRACT) throw new Error('immutable lab builder contract is stale');
  if (manifest.sourceClosure?.sourceHash !== manifest.sourceClosureHash
    || manifest.sourceClosure?.buildRevision !== manifest.buildRevision
    || manifest.sourceClosure?.threeRevision !== manifest.threeRevision) {
    throw new Error('immutable lab source closure identity is inconsistent');
  }
  const actualFiles = await fileLedger(outputDirectory);
  if (JSON.stringify(actualFiles) !== JSON.stringify(manifest.files)) throw new Error('immutable lab file ledger drifted');
  if (manifest.bundleHash !== canonicalSha256(actualFiles)) throw new Error('immutable lab bundle hash is stale');
  for (const entry of manifest.entrypoints ?? []) {
    if (!actualFiles[entry]) throw new Error(`immutable lab build omitted entrypoint ${entry}`);
  }
  return {
    directory: outputDirectory,
    manifest,
    manifestBytes,
    manifestSha256: sha256(manifestBytes),
  };
}

export async function buildImmutableLabSurface(options = {}) {
  const labId = options.labId;
  if (typeof labId !== 'string' || labId.length === 0) throw new Error('immutable lab build requires labId');
  const { demo, root, sourceClosure } = resolveLab(labId);
  const inputs = declaredHtmlInputs(root, demo);
  const entrypoints = Object.keys(inputs).map((path) => `${path}.html`).sort();
  if (!entrypoints.includes('index.html')) throw new Error(`immutable lab ${labId} has no index.html entrypoint`);
  const contentAddress = canonicalSha256({
    builderContract: IMMUTABLE_LAB_BUILD_CONTRACT,
    labId,
    sourceClosureHash: sourceClosure.sourceHash,
    buildRevision: sourceClosure.buildRevision,
    threeRevision: sourceClosure.threeRevision,
  });
  const outputRoot = resolve(options.outputRoot ?? join(tmpdir(), 'threejs-immutable-lab-builds'));
  if (isWithin(outputRoot, REPO_ROOT)) throw new Error('immutable lab builds must remain outside the repository');
  const outputDirectory = join(outputRoot, `${labId}-${contentAddress.slice('sha256:'.length)}`);
  const manifestPath = join(outputDirectory, IMMUTABLE_LAB_BUILD_MANIFEST);
  if (existsSync(manifestPath)) return loadAndValidateImmutableLabBuild(outputDirectory, { expectedLabId: labId });
  await mkdir(outputRoot, { recursive: true });
  if (existsSync(outputDirectory)) throw new Error(`refusing to overwrite incomplete immutable lab build ${outputDirectory}`);
  const stagingDirectory = join(outputRoot, `.${basename(outputDirectory)}.staging-${process.pid}-${randomUUID()}`);
  await mkdir(stagingDirectory);

  await viteBuild({
    root,
    publicDir: false,
    logLevel: options.logLevel ?? 'warn',
    base: './',
    build: {
      outDir: stagingDirectory,
      emptyOutDir: false,
      assetsDir: 'assets',
      sourcemap: false,
      manifest: false,
      rollupOptions: { input: inputs },
    },
  });

  const files = await fileLedger(stagingDirectory);
  for (const entrypoint of entrypoints) {
    if (!files[entrypoint]) throw new Error(`immutable lab build omitted ${entrypoint}`);
  }
  const manifest = {
    schemaVersion: 1,
    kind: 'immutable-lab-build-v1',
    builderContract: IMMUTABLE_LAB_BUILD_CONTRACT,
    labId,
    immutable: true,
    viteDevelopmentServer: false,
    transformAtServe: false,
    redirects: false,
    spaFallback: false,
    contentAddress,
    sourceClosureHash: sourceClosure.sourceHash,
    buildRevision: sourceClosure.buildRevision,
    sourceClosure,
    threeRevision: sourceClosure.threeRevision,
    bundleHash: canonicalSha256(files),
    entrypoints,
    files,
  };
  await writeFile(join(stagingDirectory, IMMUTABLE_LAB_BUILD_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  await loadAndValidateImmutableLabBuild(stagingDirectory, { expectedLabId: labId });
  try {
    await rename(stagingDirectory, outputDirectory);
  } catch (error) {
    if ((error.code === 'EEXIST' || error.code === 'ENOTEMPTY') && existsSync(manifestPath)) {
      return loadAndValidateImmutableLabBuild(outputDirectory, { expectedLabId: labId });
    }
    error.message = `${error.message} Staged immutable bytes remain at ${stagingDirectory}; no deletion was attempted.`;
    throw error;
  }
  return loadAndValidateImmutableLabBuild(outputDirectory, { expectedLabId: labId });
}
