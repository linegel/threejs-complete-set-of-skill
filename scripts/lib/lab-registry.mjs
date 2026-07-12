import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import {
  dirname,
  extname,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROVIDER_DEMOS } from '../provider-demos.mjs';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const REGISTRY_PATH = join(REPO_ROOT, 'labs', 'demo-registry.json');
export const TARGETS_PATH = join(REPO_ROOT, 'labs', 'canonical-targets.json');

export const DEMO_KINDS = Object.freeze([
  'canonical-lab',
  'mechanism-demo',
  'tier-demo',
  'integration-demo',
  'proxy-demo',
  'generated-asset-demo',
  'legacy-deprecated',
  'contract-fixture',
]);

export const PRIMARY_DEMO_KINDS = Object.freeze([
  'canonical-lab',
  'mechanism-demo',
  'tier-demo',
  'integration-demo',
]);

export const ACCEPTANCE_STATUSES = Object.freeze([
  'accepted',
  'incomplete',
  'blocked',
  'secondary',
  'not-applicable',
]);

export const EXECUTION_CLASSES = Object.freeze([
  'rendering',
  'non-rendering',
]);

export const AUTHORITATIVE_COUNT_FIELDS = Object.freeze({
  fixedRoutes: 'fixedRoutesExpected',
  requiredCapabilities: 'requiredCapabilitiesExpected',
  requiredRuntimeProofs: 'requiredRuntimeProofsExpected',
});

const GENERATED_PROVIDER_IDS = new Set([
  'water-generated-caustics',
  'cloud-generated-weather-maps',
  'fields-generated-biome-maps',
  'frost-generated-crystals',
  'materials-generated-lava-causes',
  'ocean-generated-wave-seeds',
  'space-generated-starfields',
  'vegetation-generated-meadow-density',
  'rain-generated-ripples',
  'planet-generated-craters',
]);

const EXCLUDED_HASH_SEGMENTS = new Set([
  '.git',
  '.DS_Store',
  'artifacts',
  'node_modules',
]);

const DEFAULT_SEEDS = Object.freeze([1, 0x9e3779b9]);
const DEFAULT_CAMERAS = Object.freeze(['near', 'design', 'far']);
const DEFAULT_MODES = Object.freeze(['final', 'no-post', 'diagnostics']);

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sameValues(actual, expected) {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

function duplicateValues(values) {
  const seen = new Set();
  return values.filter((value) => {
    const duplicate = seen.has(value);
    seen.add(value);
    return duplicate;
  });
}

export function validateCanonicalTargets(targetData) {
  const errors = [];
  const roster = targetData?.primaryRoster;
  const targets = Array.isArray(targetData?.targets) ? targetData.targets : [];
  const integrations = Array.isArray(targetData?.integrations) ? targetData.integrations : [];
  if (targetData?.schemaVersion !== 2) errors.push('canonical targets schemaVersion must be 2');
  if (targetData?.threeRevision !== '0.185.1') errors.push('canonical targets Three revision must be 0.185.1');
  if (!Array.isArray(targetData?.targets)) errors.push('canonical targets targets must be an array');
  if (!Array.isArray(targetData?.integrations)) errors.push('canonical targets integrations must be an array');
  for (const key of [
    'skillsExpected',
    'primaryExpected',
    'integrationsExpected',
    'flagshipsExpected',
    ...Object.values(AUTHORITATIVE_COUNT_FIELDS),
  ]) {
    if (!Number.isInteger(targetData?.[key]) || targetData[key] <= 0) {
      errors.push(`canonical targets ${key} must be a positive integer`);
    }
  }
  if (!Array.isArray(roster) || roster.length === 0) {
    errors.push('canonical targets primaryRoster must be a non-empty array');
    return { valid: false, errors };
  }
  if (roster.length !== targetData.primaryExpected) {
    errors.push(`primaryRoster contains ${roster.length} records; primaryExpected is ${targetData.primaryExpected}`);
  }

  const allowedKeys = new Set([
    'id', 'kind', 'canonicalDir', 'executionClass', 'flagship', 'dependencyLabIds',
  ]);
  const rosterIds = roster.map((entry) => entry?.id);
  const rosterIdSet = new Set(rosterIds);
  const duplicateIds = duplicateValues(rosterIds);
  if (duplicateIds.length > 0) errors.push(`primaryRoster has duplicate ids: ${[...new Set(duplicateIds)].join(', ')}`);
  const directories = roster.map((entry) => entry?.canonicalDir);
  const duplicateDirectories = duplicateValues(directories);
  if (duplicateDirectories.length > 0) {
    errors.push(`primaryRoster has duplicate canonical directories: ${[...new Set(duplicateDirectories)].join(', ')}`);
  }

  for (const [index, entry] of roster.entries()) {
    const path = `primaryRoster[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${path} must be an object`);
      continue;
    }
    const extras = Object.keys(entry).filter((key) => !allowedKeys.has(key));
    if (extras.length > 0) errors.push(`${path} has unknown properties: ${extras.join(', ')}`);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(entry.id ?? '')) errors.push(`${path}.id is invalid`);
    if (!PRIMARY_DEMO_KINDS.includes(entry.kind)) errors.push(`${path}.kind is not a primary demo kind`);
    if (typeof entry.canonicalDir !== 'string' || entry.canonicalDir.length === 0
        || entry.canonicalDir.startsWith('/') || entry.canonicalDir.split('/').includes('..')) {
      errors.push(`${path}.canonicalDir must be a confined repository path`);
    }
    if (!EXECUTION_CLASSES.includes(entry.executionClass)) errors.push(`${path}.executionClass is invalid`);
    if (typeof entry.flagship !== 'boolean') errors.push(`${path}.flagship must be boolean`);
    if (!Array.isArray(entry.dependencyLabIds)
        || entry.dependencyLabIds.some((id) => !/^[a-z0-9][a-z0-9-]*$/.test(id))) {
      errors.push(`${path}.dependencyLabIds must be an id array`);
      continue;
    }
    const duplicateDependencies = duplicateValues(entry.dependencyLabIds);
    if (duplicateDependencies.length > 0) {
      errors.push(`${path}.dependencyLabIds has duplicates: ${[...new Set(duplicateDependencies)].join(', ')}`);
    }
    if (entry.kind === 'integration-demo' && entry.dependencyLabIds.length === 0) {
      errors.push(`${path} integration demos require at least one dependency`);
    }
    if (entry.kind !== 'integration-demo' && entry.dependencyLabIds.length > 0) {
      errors.push(`${path} non-integration primaries cannot declare integration dependencies`);
    }
    if (entry.flagship && entry.kind !== 'integration-demo') errors.push(`${path} flagships must be integration demos`);
    if (entry.dependencyLabIds.includes(entry.id)) errors.push(`${path} cannot depend on itself`);
    for (const dependencyId of entry.dependencyLabIds) {
      if (!rosterIdSet.has(dependencyId)) errors.push(`${path} depends on missing primary ${dependencyId}`);
    }
  }

  const integrationCount = roster.filter((entry) => entry.kind === 'integration-demo').length;
  if (integrationCount !== targetData.integrationsExpected) {
    errors.push(`primaryRoster contains ${integrationCount} integrations; integrationsExpected is ${targetData.integrationsExpected}`);
  }
  const flagshipCount = roster.filter((entry) => entry.flagship === true).length;
  if (flagshipCount !== targetData.flagshipsExpected) {
    errors.push(`primaryRoster contains ${flagshipCount} flagships; flagshipsExpected is ${targetData.flagshipsExpected}`);
  }

  const declaredTargets = [...targets, ...integrations];
  const duplicateTargetIds = duplicateValues(declaredTargets.map((entry) => entry.id));
  if (duplicateTargetIds.length > 0) {
    errors.push(`canonical target declarations have duplicate ids: ${[...new Set(duplicateTargetIds)].join(', ')}`);
  }
  const rosterById = new Map(roster.map((entry) => [entry.id, entry]));
  for (const target of targets) {
    const entry = rosterById.get(target.id);
    if (!entry) errors.push(`target ${target.id} is absent from primaryRoster`);
    else if (entry.kind !== 'canonical-lab' || entry.canonicalDir !== target.canonicalDir) {
      errors.push(`target ${target.id} disagrees with its primaryRoster kind or canonicalDir`);
    }
  }
  for (const target of integrations) {
    const entry = rosterById.get(target.id);
    if (!entry) errors.push(`flagship target ${target.id} is absent from primaryRoster`);
    else if (entry.kind !== 'integration-demo' || entry.flagship !== true || entry.canonicalDir !== target.canonicalDir) {
      errors.push(`flagship target ${target.id} disagrees with its primaryRoster metadata`);
    }
  }
  const expectedTargetIds = roster.filter((entry) => entry.kind === 'canonical-lab').map((entry) => entry.id);
  const declaredTargetIds = targets.map((entry) => entry.id);
  if (!sameValues(declaredTargetIds, expectedTargetIds)) {
    errors.push('canonical targets declarations must exactly cover every canonical-lab primaryRoster entry');
  }
  const expectedFlagshipIds = roster.filter((entry) => entry.flagship === true).map((entry) => entry.id);
  const declaredFlagshipIds = integrations.map((entry) => entry.id);
  if (!sameValues(declaredFlagshipIds, expectedFlagshipIds)) {
    errors.push('canonical integration declarations must exactly cover every flagship primaryRoster entry');
  }
  if (integrations.length !== targetData.flagshipsExpected) {
    errors.push(`canonical flagship declarations contain ${integrations.length} records; flagshipsExpected is ${targetData.flagshipsExpected}`);
  }

  const visiting = new Set();
  const visited = new Set();
  const visit = (id, stack) => {
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      errors.push(`primaryRoster dependency cycle: ${[...stack.slice(start), id].join(' -> ')}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const nextStack = [...stack, id];
    for (const dependencyId of rosterById.get(id)?.dependencyLabIds ?? []) visit(dependencyId, nextStack);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of rosterIds) visit(id, []);

  return { valid: errors.length === 0, errors };
}

export function loadCanonicalTargets() {
  const targetData = readJson(TARGETS_PATH);
  const result = validateCanonicalTargets(targetData);
  if (!result.valid) throw new Error(`canonical targets invalid:\n- ${result.errors.join('\n- ')}`);
  return targetData;
}

export function authoritativePrimaryRoster(targetData = loadCanonicalTargets()) {
  return targetData.primaryRoster.map((entry) => ({
    ...entry,
    dependencyLabIds: [...entry.dependencyLabIds],
  }));
}

function toPosix(path) {
  return path.split(sep).join('/');
}

function repoRelative(path) {
  return toPosix(relative(REPO_ROOT, path));
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9./-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizePublishPath(value, id) {
  if (value === null) return null;
  const candidate = value || `/demos/${id}/`;
  return `/${candidate.replace(/^\/+/, '').replace(/\/?$/, '/')}`;
}

function normalizeRepoPath(value, manifestDir) {
  if (value === null || value === undefined) return null;
  const raw = String(value).replaceAll('\\', '/');
  if (raw.startsWith('/')) throw new Error(`absolute repository path is forbidden: ${raw}`);
  if (raw.split('/').includes('..')) throw new Error(`path traversal is forbidden: ${raw}`);

  const rootCandidate = resolve(REPO_ROOT, raw);
  if (existsSync(rootCandidate)) return repoRelative(rootCandidate);
  const localCandidate = resolve(manifestDir, raw);
  return repoRelative(localCandidate);
}

function normalizeRoute(value) {
  if (typeof value === 'string') return { id: value };
  if (!value || typeof value !== 'object') throw new TypeError('route entries must be strings or objects');
  const route = { id: value.id };
  if (value.title) route.title = value.title;
  if (value.route || value.path) route.route = value.route ?? value.path;
  if (value.startup && typeof value.startup === 'object') route.startup = value.startup;
  const acceptanceStatus = value.acceptanceStatus ?? value.status;
  if (ACCEPTANCE_STATUSES.includes(acceptanceStatus)) route.acceptanceStatus = acceptanceStatus;
  return route;
}

function normalizeFrameTarget(value, tierId) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  if (!Number.isFinite(value)) throw new TypeError(`tier ${tierId} frameTargetMs must be finite or null`);
  return {
    value,
    unit: 'ms',
    label: 'Gated',
    source: `quality tier ${tierId} frame target`,
  };
}

function normalizeTier(value, labStatus = 'incomplete') {
  if (typeof value === 'string') {
    return {
      id: value,
      targetClass: 'unmeasured-target',
      frameTargetMs: null,
      resolutionPolicy: {},
      mechanismLimits: {},
      resourceLimits: {},
      degradationFromPrevious: [],
      preservedInvariants: [],
      acceptanceStatus: labStatus === 'accepted' ? 'incomplete' : labStatus,
    };
  }
  if (!value || typeof value !== 'object') throw new TypeError('tier entries must be strings or objects');
  return {
    id: value.id,
    targetClass: value.targetClass ?? 'unmeasured-target',
    frameTargetMs: normalizeFrameTarget(value.frameTargetMs, value.id),
    resolutionPolicy: value.resolutionPolicy ?? {},
    mechanismLimits: value.mechanismLimits ?? {},
    resourceLimits: value.resourceLimits ?? {},
    degradationFromPrevious: value.degradationFromPrevious ?? [],
    preservedInvariants: value.preservedInvariants ?? [],
    acceptanceStatus: value.acceptanceStatus ?? value.status ?? 'incomplete',
  };
}

function normalizeRequirement(value, defaultStatus = 'incomplete') {
  if (typeof value === 'string') {
    return { id: slug(value), required: true, evidence: value, status: defaultStatus };
  }
  if (!value || typeof value !== 'object') throw new TypeError('requirements must be strings or objects');
  const evidence = value.evidence
    ?? value.reason
    ?? (value.requiredFor ? `required for ${value.requiredFor.join(', ')}` : null)
    ?? (value.verdict ? `verdict: ${value.verdict}` : null);
  return {
    id: slug(value.id),
    required: value.required ?? true,
    evidence,
    status: ACCEPTANCE_STATUSES.includes(value.status) ? value.status : defaultStatus,
  };
}

function inferBrowserEntry(canonicalDir) {
  for (const name of ['index.html', 'canonical.html', 'browser.html']) {
    const candidate = join(REPO_ROOT, canonicalDir, name);
    if (existsSync(candidate)) return repoRelative(candidate);
  }
  return null;
}

function normalizedEvidenceContract(value, nonRenderingScenarioSuite) {
  if (nonRenderingScenarioSuite) return 'v2';
  if (typeof value === 'string' && /v2$/i.test(value)) return 'v2';
  return value === 'none' ? 'none' : 'v2';
}

function normalizeSourceManifest(raw, manifestPath) {
  const manifestDir = dirname(manifestPath);
  const defaultCanonicalSource = [repoRelative(manifestDir)];
  const status = raw.status ?? 'incomplete';
  const nonRenderingScenarioSuite = raw.nonRenderingScenarioSuite === true
    || /non-rendering/i.test(raw.evidenceContract ?? '');
  const notes = [...(raw.notes ?? [])];
  if (raw.statusReason) notes.push(raw.statusReason);

  return {
    schemaVersion: 2,
    id: raw.id,
    ...(raw.title ? { title: raw.title } : {}),
    skill: raw.skill,
    threeRevision: raw.threeRevision,
    kind: raw.kind,
    status,
    canonicalSource: (raw.canonicalSource?.length ? raw.canonicalSource : defaultCanonicalSource)
      .map((path) => normalizeRepoPath(path, manifestDir)),
    browserEntry: normalizeRepoPath(raw.browserEntry, manifestDir),
    publishPath: normalizePublishPath(raw.publishPath, raw.id),
    scenarios: (raw.scenarios ?? []).map(normalizeRoute),
    mechanisms: (raw.mechanisms ?? []).map(normalizeRoute),
    tiers: (raw.tiers ?? []).map((tier) => normalizeTier(tier, status)),
    modes: raw.modes ?? [],
    cameras: raw.cameras ?? [],
    seeds: raw.seeds ?? [],
    capabilityRequirements: (raw.capabilityRequirements ?? []).map((entry) => normalizeRequirement(entry, status)),
    runtimeProof: (raw.runtimeProof ?? []).map((entry) => normalizeRequirement(entry, status)),
    evidenceContract: normalizedEvidenceContract(raw.evidenceContract, nonRenderingScenarioSuite),
    evidenceBundle: normalizeRepoPath(raw.evidenceBundle, manifestDir),
    validationCommand: raw.validationCommand ?? null,
    ...(raw.commands ? { commands: raw.commands } : {}),
    sourceHash: raw.sourceHash ?? null,
    proxyStatus: raw.proxyStatus ?? null,
    ...(nonRenderingScenarioSuite ? { nonRenderingScenarioSuite: true } : {}),
    ...(notes.length > 0 ? { notes } : {}),
  };
}

function attachRosterMetadata(manifest, rosterById) {
  const roster = rosterById.get(manifest.id);
  if (!roster) return manifest;
  return {
    ...manifest,
    executionClass: roster.executionClass,
    flagship: roster.flagship,
    dependencyLabIds: [...roster.dependencyLabIds],
  };
}

function targetManifest(target) {
  const rendering = target.nonRenderingScenarioSuite !== true;
  return {
    schemaVersion: 2,
    id: target.id,
    skill: target.skill,
    threeRevision: '0.185.1',
    kind: 'canonical-lab',
    status: 'incomplete',
    canonicalSource: [target.canonicalDir],
    browserEntry: inferBrowserEntry(target.canonicalDir),
    publishPath: `/demos/${target.id}/`,
    scenarios: (target.scenarios ?? []).map(normalizeRoute),
    mechanisms: (target.mechanisms ?? []).map(normalizeRoute),
    tiers: (target.tiers ?? []).map((tier) => normalizeTier(tier)),
    modes: rendering ? [...DEFAULT_MODES] : ['route'],
    cameras: rendering ? [...DEFAULT_CAMERAS] : ['manifest'],
    seeds: rendering ? [...DEFAULT_SEEDS] : [0],
    capabilityRequirements: rendering
      ? [{ id: 'native-webgpu', required: true, evidence: null, status: 'incomplete' }]
      : [{ id: 'webgpu-requirement-declaration', required: true, evidence: null, status: 'incomplete' }],
    runtimeProof: (rendering
      ? ['renderer-init', 'backend-is-webgpu', 'mechanism-reachable', 'render-or-compute-work', 'aligned-readback', 'evidence-v2', 'pages-source-hash']
      : ['fixture-driven-ui', 'stable-machine-readable-verdicts', 'negative-route-rejection'])
      .map((id) => ({ id, required: true, evidence: null, status: 'incomplete' })),
    evidenceContract: 'v2',
    evidenceBundle: null,
    validationCommand: null,
    sourceHash: null,
    proxyStatus: null,
    ...(target.nonRenderingScenarioSuite ? { nonRenderingScenarioSuite: true } : {}),
  };
}

function integrationTargetManifest(target) {
  return {
    schemaVersion: 2,
    id: target.id,
    title: target.id.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join(' '),
    skill: 'threejs-visual-validation',
    threeRevision: '0.185.1',
    kind: 'integration-demo',
    status: 'incomplete',
    canonicalSource: [target.canonicalDir],
    browserEntry: inferBrowserEntry(target.canonicalDir),
    publishPath: `/demos/${target.id}/`,
    scenarios: [],
    mechanisms: target.skills.map((skill) => ({ id: skill.replace(/^threejs-/, '') })),
    tiers: target.tiers.map((tier) => normalizeTier(tier)),
    modes: [...target.modes],
    cameras: [...DEFAULT_CAMERAS],
    seeds: [...DEFAULT_SEEDS],
    capabilityRequirements: [{ id: 'native-webgpu', required: true, evidence: null, status: 'incomplete' }],
    runtimeProof: ['exclusive-owners', 'stage-budget-sum', 'current-adapter-timing', 'resource-ledger', 'v2-evidence']
      .map((id) => ({ id, required: true, evidence: null, status: 'incomplete' })),
    evidenceContract: 'v2',
    evidenceBundle: null,
    validationCommand: null,
    sourceHash: null,
    proxyStatus: null,
    notes: [`Integration owners: ${target.skills.join(', ')}`],
  };
}

function walkSourceFiles(path) {
  if (!existsSync(path)) return [];
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return [];
  if (stat.isFile()) return [path];
  if (!stat.isDirectory()) return [];
  const files = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (EXCLUDED_HASH_SEGMENTS.has(entry.name)) continue;
    files.push(...walkSourceFiles(join(path, entry.name)));
  }
  return files;
}

export function computeSourceHash(canonicalSource) {
  const files = [...new Set(canonicalSource
    .flatMap((path) => walkSourceFiles(join(REPO_ROOT, path))))]
    .sort((a, b) => repoRelative(a).localeCompare(repoRelative(b)));
  if (files.length === 0) return null;
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(repoRelative(file));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

function browserEntryDependencies(browserEntry) {
  if (!browserEntry || !existsSync(join(REPO_ROOT, browserEntry)) || extname(browserEntry) !== '.html') return [];
  const htmlPath = join(REPO_ROOT, browserEntry);
  const html = readFileSync(htmlPath, 'utf8');
  const dependencies = [browserEntry];
  for (const match of html.matchAll(/\b(?:src|href)=(?:['"])([^'"]+)(?:['"])/g)) {
    const value = match[1];
    if (/^(?:[a-z]+:|\/\/|#)/i.test(value)) continue;
    const path = resolve(dirname(htmlPath), value.split(/[?#]/, 1)[0]);
    if (existsSync(path)) dependencies.push(repoRelative(path));
  }
  return dependencies;
}

const IMPORTABLE_EXTENSIONS = Object.freeze([
  '', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.css', '.html',
]);
const INDEX_FILES = Object.freeze([
  'index.js', 'index.mjs', 'index.cjs', 'index.ts', 'index.tsx', 'index.jsx', 'index.json', 'index.css', 'index.html',
]);

function relativeReferences(path) {
  const extension = extname(path).toLowerCase();
  if (!['.html', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.css'].includes(extension)) return [];
  const source = readFileSync(path, 'utf8');
  const references = [];
  const patterns = [
    /\b(?:src|href)\s*=\s*['"](\.\.?\/[^'"#]+)['"]/gi,
    /\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"](\.\.?\/[^'"]+)['"]/g,
    /\bimport\s*\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g,
    /\bnew\s+URL\s*\(\s*['"](\.\.?\/[^'"]+)['"]/g,
    /@import\s+(?:url\(\s*)?['"]?(\.\.?\/[^'"\s)]+)/gi,
    /\burl\(\s*['"]?(\.\.?\/[^'"\s)]+)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) references.push(match[1]);
  }
  return [...new Set(references)];
}

function resolveRelativeReference(importer, reference) {
  const clean = reference.split(/[?#]/, 1)[0];
  const base = resolve(dirname(importer), clean);
  const candidates = IMPORTABLE_EXTENSIONS.map((extension) => `${base}${extension}`);
  for (const candidate of candidates) {
    if (existsSync(candidate) && lstatSync(candidate).isFile()) return candidate;
  }
  if (existsSync(base) && lstatSync(base).isDirectory()) {
    for (const filename of INDEX_FILES) {
      const candidate = join(base, filename);
      if (existsSync(candidate) && lstatSync(candidate).isFile()) return candidate;
    }
  }
  return null;
}

function discoverTransitiveRepoDependencies(roots) {
  const queue = roots
    .filter(Boolean)
    .flatMap((path) => walkSourceFiles(join(REPO_ROOT, path)));
  const visited = new Set();
  const dependencies = new Set();
  while (queue.length > 0) {
    const importer = queue.pop();
    if (visited.has(importer)) continue;
    visited.add(importer);
    for (const reference of relativeReferences(importer)) {
      const dependency = resolveRelativeReference(importer, reference);
      if (!dependency) continue;
      const relativeDependency = relative(REPO_ROOT, dependency);
      if (relativeDependency.startsWith(`..${sep}`) || relativeDependency === '..') continue;
      dependencies.add(repoRelative(dependency));
      if (!visited.has(dependency)) queue.push(dependency);
    }
  }
  return [...dependencies].sort((a, b) => a.localeCompare(b));
}

function pathIsWithin(path, directory) {
  const candidate = String(path).replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
  const parent = String(directory).replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
  return candidate === parent || candidate.startsWith(`${parent}/`);
}

function minimalHashInputs(inputs) {
  const unique = [...new Set(inputs.filter(Boolean).map((path) => String(path).replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '')))]
    .sort((a, b) => a.localeCompare(b));
  return unique.filter((candidate) => !unique.some((parent) => parent !== candidate && pathIsWithin(candidate, parent)));
}

/**
 * Return the auditable roots used for source hashing.
 *
 * Frozen completion targets deliberately hash their entire canonical directory,
 * not only the selected files named in canonicalSource. That conservative rule
 * catches transitive browser imports without maintaining a second dependency
 * graph in the registry. Explicit sources and browser entry dependencies that
 * live outside the canonical directory remain additional hash roots.
 */
export function computeManifestSourceHashInputs(manifest, { canonicalDir = null } = {}) {
  if (canonicalDir) {
    const externalSources = (manifest.canonicalSource ?? [])
      .filter((path) => !pathIsWithin(path, canonicalDir));
    const externalBrowserInputs = browserEntryDependencies(manifest.browserEntry)
      .filter((path) => !pathIsWithin(path, canonicalDir));
    const externalTransitiveInputs = discoverTransitiveRepoDependencies([
      manifest.browserEntry,
      ...externalSources,
    ]).filter((path) => !pathIsWithin(path, canonicalDir));
    return minimalHashInputs([
      canonicalDir,
      ...externalSources,
      ...externalBrowserInputs,
      ...externalTransitiveInputs,
    ]);
  }
  return minimalHashInputs([
    ...(manifest.sourceHashInputs ?? []),
    ...(manifest.sourceHashInputs?.length ? [] : (manifest.canonicalSource ?? [])),
    ...(manifest.sourceHashInputs?.length ? [] : browserEntryDependencies(manifest.browserEntry)),
  ]);
}

export function computeManifestSourceHash(manifest) {
  return computeSourceHash(computeManifestSourceHashInputs(manifest));
}

export function listRawLabManifestPaths() {
  const paths = [];
  for (const skill of listSkillDirs()) {
    const examplesDir = join(REPO_ROOT, skill, 'examples');
    if (!existsSync(examplesDir)) continue;
    for (const entry of readdirSync(examplesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const exampleDir = join(examplesDir, entry.name);
      for (const filename of ['lab.manifest.json', 'lab-manifest.json']) {
        const candidate = join(exampleDir, filename);
        if (existsSync(candidate)) paths.push(candidate);
      }
    }
  }

  const integrationsDir = join(REPO_ROOT, 'integration-labs');
  if (existsSync(integrationsDir)) {
    for (const entry of readdirSync(integrationsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const filename of ['lab.manifest.json', 'lab-manifest.json']) {
        const candidate = join(integrationsDir, entry.name, filename);
        if (existsSync(candidate)) paths.push(candidate);
      }
    }
  }
  return paths.sort();
}

export function listSkillDirs() {
  return readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('threejs-'))
    .filter((entry) => existsSync(join(REPO_ROOT, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
}

function exampleDirs() {
  const paths = [];
  for (const skill of listSkillDirs()) {
    const examplesDir = join(REPO_ROOT, skill, 'examples');
    if (!existsSync(examplesDir)) continue;
    for (const entry of readdirSync(examplesDir, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        paths.push(repoRelative(join(examplesDir, entry.name)));
      }
    }
  }
  return paths.sort();
}

function secondaryExampleManifest(path) {
  const [skill, , example] = path.split('/');
  const legacy = /deprecated|legacy/i.test(path);
  return {
    schemaVersion: 2,
    id: `${skill.replace(/^threejs-/, '')}-${slug(example)}-fixture`,
    skill,
    threeRevision: '0.185.1',
    kind: legacy ? 'legacy-deprecated' : 'contract-fixture',
    status: 'secondary',
    canonicalSource: [path],
    browserEntry: null,
    publishPath: null,
    scenarios: [],
    mechanisms: [],
    tiers: [],
    modes: [],
    cameras: [],
    seeds: [],
    capabilityRequirements: [],
    runtimeProof: [],
    evidenceContract: 'none',
    evidenceBundle: null,
    validationCommand: null,
    sourceHash: null,
    proxyStatus: {
      limitation: legacy
        ? 'Legacy or deprecated source retained for reference; it cannot satisfy canonical acceptance.'
        : 'Source or contract fixture without an accepted native-WebGPU browser/evidence contract.',
      canonicalLabId: null,
    },
  };
}

function providerManifest(provider, canonicalLabId) {
  const generated = GENERATED_PROVIDER_IDS.has(provider.id);
  const source = provider.sourceExample && !provider.sourceExample.startsWith('/')
    ? provider.sourceExample
    : provider.skill;
  return {
    schemaVersion: 2,
    id: provider.id,
    title: provider.title,
    skill: provider.skill,
    threeRevision: '0.185.1',
    kind: generated ? 'generated-asset-demo' : 'proxy-demo',
    status: 'secondary',
    canonicalSource: [
      source,
      'scripts/provider-demos.mjs',
      'labs/provider-proxies/provider-demo.mjs',
      'labs/provider-proxies/provider-demo.css',
      'labs/provider-proxies/generated-variants',
    ],
    browserEntry: null,
    publishPath: normalizePublishPath(provider.livePath, provider.id),
    scenarios: [],
    mechanisms: [],
    tiers: [],
    modes: provider.debugModes ?? [],
    cameras: [],
    seeds: [],
    capabilityRequirements: [],
    runtimeProof: [],
    evidenceContract: 'none',
    evidenceBundle: null,
    validationCommand: provider.validationCommand ?? null,
    sourceHash: null,
    proxyStatus: {
      limitation: (provider.limitations ?? ['Secondary provider surface; not canonical mechanism proof.']).join(' '),
      canonicalLabId,
    },
  };
}

export function deriveRegistryPrimaryIds(demos) {
  return demos
    .filter((demo) => PRIMARY_DEMO_KINDS.includes(demo.kind))
    .map((demo) => demo.id)
    .sort((a, b) => a.localeCompare(b));
}

export function deriveSkillCoverage(demos, skills) {
  return [...skills].sort((a, b) => a.localeCompare(b)).map((skill) => {
    const primary = demos
      .filter((demo) => demo.skill === skill && PRIMARY_DEMO_KINDS.includes(demo.kind))
      .sort((a, b) => a.id.localeCompare(b.id));
    const accepted = primary.filter((demo) => demo.status === 'accepted');
    return {
      skill,
      primaryLabIds: primary.map((demo) => demo.id),
      acceptedPrimaryLabIds: accepted.map((demo) => demo.id),
      status: accepted.length > 0
        ? 'accepted'
        : primary.some((demo) => demo.status === 'blocked') ? 'blocked' : 'incomplete',
    };
  });
}

export function deriveRegistryCounts(demos, skills) {
  const primary = demos.filter((demo) => PRIMARY_DEMO_KINDS.includes(demo.kind));
  const requiredCapabilities = primary.flatMap((demo) => demo.capabilityRequirements ?? [])
    .filter((entry) => entry.required === true);
  const requiredRuntimeProofs = primary.flatMap((demo) => demo.runtimeProof ?? [])
    .filter((entry) => entry.required === true);
  return {
    skills: skills.length,
    demos: demos.length,
    primary: primary.length,
    acceptedPrimary: primary.filter((demo) => demo.status === 'accepted').length,
    secondary: demos.filter((demo) => demo.status === 'secondary').length,
    integrations: primary.filter((demo) => demo.kind === 'integration-demo').length,
    flagships: primary.filter((demo) => demo.flagship === true).length,
    fixedRoutes: primary.reduce(
      (sum, demo) => sum + (demo.scenarios?.length ?? 0) + (demo.mechanisms?.length ?? 0) + (demo.tiers?.length ?? 0),
      0,
    ),
    requiredCapabilities: requiredCapabilities.length,
    requiredRuntimeProofs: requiredRuntimeProofs.length,
  };
}

export function validatePrimaryRosterClosure(demos, origins, targetData = loadCanonicalTargets()) {
  const errors = [];
  const roster = authoritativePrimaryRoster(targetData);
  const rosterById = new Map(roster.map((entry) => [entry.id, entry]));
  const primary = demos.filter((demo) => PRIMARY_DEMO_KINDS.includes(demo.kind));
  const actualIds = primary.map((demo) => demo.id);
  const expectedIds = roster.map((entry) => entry.id);
  const missing = expectedIds.filter((id) => !actualIds.includes(id));
  const extra = actualIds.filter((id) => !rosterById.has(id));
  if (missing.length > 0) errors.push(`primary roster is missing demos: ${missing.join(', ')}`);
  if (extra.length > 0) errors.push(`unrostered primary demos are forbidden: ${extra.join(', ')}`);
  if (!sameValues(actualIds, expectedIds)) {
    errors.push(`primary demo set does not equal the authoritative ${targetData.primaryExpected}-entry roster`);
  }

  const primaryById = new Map(primary.map((demo) => [demo.id, demo]));
  for (const rosterEntry of roster) {
    const demo = primaryById.get(rosterEntry.id);
    if (!demo) continue;
    if (demo.kind !== rosterEntry.kind) {
      errors.push(`${demo.id}: kind ${demo.kind} disagrees with primaryRoster ${rosterEntry.kind}`);
    }
    if (demo.executionClass !== rosterEntry.executionClass) {
      errors.push(`${demo.id}: executionClass ${demo.executionClass ?? '(missing)'} disagrees with primaryRoster ${rosterEntry.executionClass}`);
    }
    if (demo.flagship !== rosterEntry.flagship) {
      errors.push(`${demo.id}: flagship ${String(demo.flagship)} disagrees with primaryRoster ${String(rosterEntry.flagship)}`);
    }
    if (!sameValues(demo.dependencyLabIds ?? [], rosterEntry.dependencyLabIds)) {
      errors.push(`${demo.id}: dependencyLabIds disagree with primaryRoster`);
    }
    if (origins?.[demo.id]?.canonicalDir !== rosterEntry.canonicalDir) {
      errors.push(`${demo.id}: canonicalDir ${origins?.[demo.id]?.canonicalDir ?? '(missing)'} disagrees with primaryRoster ${rosterEntry.canonicalDir}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function computeBuildRevision(demos, lockfile = readFileSync(join(REPO_ROOT, 'package-lock.json'))) {
  const primarySources = demos
    .filter((demo) => PRIMARY_DEMO_KINDS.includes(demo.kind))
    .map((demo) => ({
      id: demo.id,
      kind: demo.kind,
      status: demo.status,
      sourceHash: demo.sourceHash,
      sourceHashInputs: demo.sourceHashInputs,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const hash = createHash('sha256');
  hash.update('threejs-lab-build-revision-v2\0');
  hash.update(lockfile);
  hash.update('\0');
  hash.update(JSON.stringify(primarySources));
  return `sha256:${hash.digest('hex')}`;
}

function finalizeManifest(manifest, { canonicalDir = null } = {}) {
  const sourceHashInputs = computeManifestSourceHashInputs(manifest, { canonicalDir });
  const finalized = { ...manifest, sourceHashInputs };
  return {
    ...finalized,
    sourceHash: computeManifestSourceHash(finalized),
  };
}

export function buildDemoRegistry() {
  const targetData = loadCanonicalTargets();
  const roster = authoritativePrimaryRoster(targetData);
  const rosterById = new Map(roster.map((entry) => [entry.id, entry]));
  const skills = listSkillDirs();
  const sourceManifests = listRawLabManifestPaths().map((path) => ({
    path: repoRelative(path),
    directory: repoRelative(dirname(path)),
    manifest: normalizeSourceManifest(readJson(path), path),
  }));
  const sourceByDirectory = new Map();
  for (const source of sourceManifests) {
    if (sourceByDirectory.has(source.directory)) {
      throw new Error(`multiple lab manifests in ${source.directory}`);
    }
    sourceByDirectory.set(source.directory, source);
  }

  const demos = [];
  const origins = {};
  const coveredExampleDirs = new Set();

  for (const target of targetData.targets) {
    const source = sourceByDirectory.get(target.canonicalDir);
    const manifest = attachRosterMetadata(source?.manifest ?? targetManifest(target), rosterById);
    demos.push(finalizeManifest(manifest, { canonicalDir: target.canonicalDir }));
    origins[manifest.id] = {
      type: source ? 'source-manifest' : 'completion-target',
      path: source?.path ?? 'labs/canonical-targets.json',
      canonicalDir: target.canonicalDir,
    };
    if (target.canonicalDir.includes('/examples/')) coveredExampleDirs.add(target.canonicalDir);
  }

  for (const target of targetData.integrations ?? []) {
    const source = sourceByDirectory.get(target.canonicalDir);
    const manifest = attachRosterMetadata(source?.manifest ?? integrationTargetManifest(target), rosterById);
    demos.push(finalizeManifest(manifest, { canonicalDir: target.canonicalDir }));
    origins[manifest.id] = {
      type: source ? 'source-manifest' : 'integration-target',
      path: source?.path ?? 'labs/canonical-targets.json',
      canonicalDir: target.canonicalDir,
      ownerSkills: target.skills,
    };
  }

  for (const source of sourceManifests) {
    if (sourceByDirectory.get(source.directory) !== source) continue;
    const knownTarget = [...targetData.targets, ...(targetData.integrations ?? [])]
      .some((target) => target.canonicalDir === source.directory);
    if (knownTarget) continue;
    const manifest = attachRosterMetadata(source.manifest, rosterById);
    demos.push(finalizeManifest(manifest, {
      canonicalDir: PRIMARY_DEMO_KINDS.includes(source.manifest.kind) ? source.directory : null,
    }));
    origins[manifest.id] = { type: 'source-manifest', path: source.path, canonicalDir: source.directory };
    if (source.directory.includes('/examples/')) coveredExampleDirs.add(source.directory);
  }

  for (const path of exampleDirs()) {
    if (coveredExampleDirs.has(path)) continue;
    const manifest = secondaryExampleManifest(path);
    demos.push(finalizeManifest(manifest));
    origins[manifest.id] = { type: 'inferred-secondary', path, canonicalDir: path };
  }

  const primaryBySkill = new Map();
  for (const demo of demos) {
    if (!PRIMARY_DEMO_KINDS.includes(demo.kind)) continue;
    const values = primaryBySkill.get(demo.skill) ?? [];
    values.push(demo.id);
    primaryBySkill.set(demo.skill, values);
  }

  for (const provider of PROVIDER_DEMOS) {
    const canonicalLabId = primaryBySkill.get(provider.skill)?.[0] ?? null;
    const manifest = providerManifest(provider, canonicalLabId);
    demos.push(finalizeManifest(manifest));
    origins[manifest.id] = { type: 'provider-registry', path: 'scripts/provider-demos.mjs' };
  }

  demos.sort((a, b) => a.id.localeCompare(b.id));
  const duplicateIds = demos.filter((demo, index) => demos.findIndex((entry) => entry.id === demo.id) !== index);
  if (duplicateIds.length > 0) throw new Error(`duplicate demo ids: ${[...new Set(duplicateIds.map((demo) => demo.id))].join(', ')}`);
  const closure = validatePrimaryRosterClosure(demos, origins, targetData);
  if (!closure.valid) throw new Error(`primary roster closure invalid:\n- ${closure.errors.join('\n- ')}`);

  const skillCoverage = deriveSkillCoverage(demos, skills);
  const counts = deriveRegistryCounts(demos, skills);
  for (const [countKey, expectedKey] of Object.entries(AUTHORITATIVE_COUNT_FIELDS)) {
    if (counts[countKey] !== targetData[expectedKey]) {
      throw new Error(
        `authoritative ${countKey} denominator drift: derived ${counts[countKey]}, expected ${targetData[expectedKey]}`,
      );
    }
  }
  const primaryIds = roster.map((entry) => entry.id);
  const integrationPrimaryIds = roster.filter((entry) => entry.kind === 'integration-demo').map((entry) => entry.id);
  const flagshipIds = roster.filter((entry) => entry.flagship).map((entry) => entry.id);

  return {
    schemaVersion: 2,
    threeRevision: '0.185.1',
    buildRevision: computeBuildRevision(demos),
    demoKinds: [...DEMO_KINDS],
    primaryDemoKinds: [...PRIMARY_DEMO_KINDS],
    acceptanceStatuses: [...ACCEPTANCE_STATUSES],
    skillsExpected: targetData.skillsExpected,
    primaryIds,
    integrationPrimaryIds,
    flagshipIds,
    integrationIds: [...flagshipIds],
    coverage: skillCoverage,
    counts,
    demos,
    origins,
  };
}

export function loadCheckedRegistry() {
  return readJson(REGISTRY_PATH);
}

export function registryJson(registry) {
  return `${JSON.stringify(registry, null, 2)}\n`;
}

export function manifestSourceDirectory(manifest, registry) {
  const origin = registry.origins?.[manifest.id];
  if (origin?.canonicalDir) return join(REPO_ROOT, origin.canonicalDir);
  const first = manifest.canonicalSource?.[0];
  if (!first) return REPO_ROOT;
  const path = join(REPO_ROOT, first);
  return extname(path) ? dirname(path) : path;
}
