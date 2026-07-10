#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  PRIMARY_DEMO_KINDS,
  REPO_ROOT,
  TARGETS_PATH,
  buildDemoRegistry,
  readJson,
} from './lib/lab-registry.mjs';
import { validateRawLabManifest } from './lib/lab-validation.mjs';
import {
  browserDependencyDrift,
  expandLocalPackageScript,
  manifestCommandPrefixDrift,
  obviousNoOpCommand,
  quickCommandStartsBrowser,
  rootBrowserToolchainDrift,
} from './lib/lab-command-policy.mjs';
import { plannedPublishedRoutes } from './lib/page-routes.mjs';

const STANDARD_SCRIPTS = Object.freeze([
  'check',
  'validate:unit',
  'test:mutations',
  'capture',
  'validate:artifacts',
  'validate:quick',
  'validate:full',
]);
const ROOT_PACKAGE = readJson(join(REPO_ROOT, 'package.json'));
const ROOT_PACKAGE_LOCK = readJson(join(REPO_ROOT, 'package-lock.json'));
const ROOT_BROWSER_TOOLCHAIN = Object.freeze({
  three: '0.185.1',
  playwright: '1.61.1',
  vite: '8.1.3',
});

function ids(records) {
  return (records ?? []).map((record) => (typeof record === 'string' ? record : record.id));
}

function sameSet(actual, expected) {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

function resolveRepoOrLocal(path, manifestDir) {
  const repositoryPath = resolve(REPO_ROOT, path);
  if (existsSync(repositoryPath)) return repositoryPath;
  return resolve(manifestDir, path);
}

function expectedRecord(target, integration) {
  return {
    mechanisms: target.mechanisms ?? (integration ? target.skills.map((skill) => skill.replace(/^threejs-/, '')) : []),
    tiers: target.tiers ?? [],
    scenarios: target.scenarios,
    modes: target.modes,
  };
}

function checkCommandRecursion(targetId, raw, packageJson, packageDir, errors) {
  const rootDispatchPattern = /\blabs:(?:capture|validate(?::(?:quick|full))?)\b/;
  for (const script of ['capture', 'validate:artifacts', 'validate:full']) {
    const expanded = expandLocalPackageScript(packageJson, script, packageDir);
    if (rootDispatchPattern.test(expanded)) {
      errors.push(`${targetId}: local ${script} calls the root lab dispatcher and would recurse`);
    }
    if (/\[recursive-script:/.test(expanded)) errors.push(`${targetId}: local ${script} contains a package-script cycle`);
  }
  for (const key of ['capture', 'validateArtifacts', 'validateFull']) {
    if (rootDispatchPattern.test(raw.commands?.[key] ?? '')) {
      errors.push(`${targetId}: manifest commands.${key} points back to the root lab dispatcher`);
    }
  }

  const quick = expandLocalPackageScript(packageJson, 'validate:quick', packageDir);
  if (quickCommandStartsBrowser(quick)) {
    errors.push(`${targetId}: validate:quick must remain browser-free`);
  }
  if (!raw.nonRenderingScenarioSuite) {
    const full = expandLocalPackageScript(packageJson, 'validate:full', packageDir);
    const invokesArtifactAlias = /\bnpm\s+(?:(?:--[a-z0-9-]+(?:=|\s+)[^\s]+)\s+)*run\s+validate:artifacts\b/i.test(full);
    const invokesArtifactProgram = /\bnode\s+(?:--[^\s;&|()]+\s+)*(?!-)[^\s;&|()]*(?:validate-artifacts|evidence-status)[^\s;&|()]*\b/i.test(full);
    if (!invokesArtifactAlias && !invokesArtifactProgram) {
      errors.push(`${targetId}: validate:full must execute artifact/evidence validation`);
    }
  }
}

function checkLockedStartup(targetId, raw, routes, errors) {
  const allowedKeys = new Set(['scenario', 'mode', 'tier', 'seed', 'camera', 'time']);
  const sets = {
    scenario: new Set(ids(raw.scenarios)),
    mode: new Set(raw.modes ?? []),
    tier: new Set(ids(raw.tiers)),
    camera: new Set(raw.cameras ?? []),
    seed: new Set(raw.seeds ?? []),
  };
  for (const route of routes) {
    const startup = route.startup ?? {};
    const unknown = Object.keys(startup).filter((key) => !allowedKeys.has(key));
    if (unknown.length > 0) errors.push(`${targetId}: ${route.kind}/${route.id} has unsupported startup keys ${unknown.join(', ')}`);
    for (const key of ['scenario', 'mode', 'tier', 'camera', 'seed']) {
      if (startup[key] !== undefined && !sets[key].has(startup[key])) {
        errors.push(`${targetId}: ${route.kind}/${route.id} startup.${key} is not declared by the manifest`);
      }
    }
    if (startup.time !== undefined && (!Number.isFinite(startup.time) || startup.time < 0)) {
      errors.push(`${targetId}: ${route.kind}/${route.id} startup.time must be finite and nonnegative`);
    }
  }
}

function verifyTarget(target, { integration = false } = {}) {
  const errors = [];
  const manifestPath = join(REPO_ROOT, target.canonicalDir, 'lab.manifest.json');
  if (!existsSync(manifestPath)) return [`${target.id}: missing ${target.canonicalDir}/lab.manifest.json`];
  let raw;
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return [`${target.id}: raw manifest is invalid JSON: ${error.message}`];
  }
  const strict = validateRawLabManifest(raw);
  errors.push(...strict.errors.map((error) => `${target.id}: raw manifest: ${error}`));
  const manifestDir = dirname(manifestPath);
  if (raw.id !== target.id) errors.push(`${target.id}: manifest id must remain ${target.id}`);
  if (integration) {
    if (raw.kind !== 'integration-demo') errors.push(`${target.id}: frozen integration must remain kind integration-demo`);
  } else {
    if (raw.kind !== 'canonical-lab') errors.push(`${target.id}: frozen target must remain kind canonical-lab`);
    if (raw.skill !== target.skill) errors.push(`${target.id}: manifest skill must remain ${target.skill}`);
  }
  if (!['accepted', 'incomplete', 'blocked'].includes(raw.status)) {
    errors.push(`${target.id}: frozen target status cannot be ${raw.status}`);
  }
  errors.push(...manifestCommandPrefixDrift(raw.commands, target.canonicalDir)
    .map((error) => `${target.id}: ${error}`));
  for (const [name, command] of Object.entries(raw.commands ?? {})) {
    if (obviousNoOpCommand(command)) errors.push(`${target.id}: commands.${name} is an obvious no-op`);
  }

  if (raw.id !== target.id) errors.push(`${target.id}: manifest id differs; received ${raw.id}`);
  if (target.skill !== undefined && raw.skill !== target.skill) {
    errors.push(`${target.id}: manifest skill differs; expected ${target.skill}, received ${raw.skill}`);
  }
  if (raw.publishPath !== `/demos/${target.id}/`) {
    errors.push(`${target.id}: publishPath must equal /demos/${target.id}/`);
  }

  if (!raw.browserEntry) errors.push(`${target.id}: browserEntry is required for implemented coverage`);
  else if (!existsSync(resolveRepoOrLocal(raw.browserEntry, manifestDir))) errors.push(`${target.id}: browserEntry does not exist: ${raw.browserEntry}`);
  for (const source of raw.canonicalSource ?? []) {
    if (!existsSync(resolveRepoOrLocal(source, manifestDir))) errors.push(`${target.id}: canonical source does not exist: ${source}`);
  }

  const expected = expectedRecord(target, integration);
  if (!sameSet(ids(raw.mechanisms), expected.mechanisms)) {
    errors.push(`${target.id}: mechanism ids differ; expected [${expected.mechanisms.join(', ')}], received [${ids(raw.mechanisms).join(', ')}]`);
  }
  if (!sameSet(ids(raw.tiers), expected.tiers)) {
    errors.push(`${target.id}: tier ids differ; expected [${expected.tiers.join(', ')}], received [${ids(raw.tiers).join(', ')}]`);
  }
  if (expected.scenarios !== undefined && !sameSet(ids(raw.scenarios), expected.scenarios)) {
    errors.push(`${target.id}: scenario ids differ; expected [${expected.scenarios.join(', ')}], received [${ids(raw.scenarios).join(', ')}]`);
  }
  if (expected.modes !== undefined && !sameSet(raw.modes ?? [], expected.modes)) {
    errors.push(`${target.id}: mode ids differ; expected [${expected.modes.join(', ')}], received [${(raw.modes ?? []).join(', ')}]`);
  }

  const packagePath = join(REPO_ROOT, target.canonicalDir, 'package.json');
  if (!existsSync(packagePath)) {
    errors.push(`${target.id}: missing local package.json with standard lab scripts`);
  } else {
    const packageJson = readJson(packagePath);
    for (const script of STANDARD_SCRIPTS) {
      if (typeof packageJson.scripts?.[script] !== 'string' || packageJson.scripts[script].length === 0) {
        errors.push(`${target.id}: package.json missing script ${script}`);
      } else if (obviousNoOpCommand(packageJson.scripts[script])) {
        errors.push(`${target.id}: package.json script ${script} is an obvious no-op`);
      }
    }
    errors.push(...browserDependencyDrift(packageJson, ROOT_BROWSER_TOOLCHAIN)
      .map((error) => `${target.id}: package.json ${error}`));
    checkCommandRecursion(target.id, raw, packageJson, manifestDir, errors);
  }

  try {
    const planned = plannedPublishedRoutes(raw);
    const expectedCount = ids(raw.scenarios).length + ids(raw.mechanisms).length + ids(raw.tiers).length;
    if (planned.length !== expectedCount) errors.push(`${target.id}: generated wrapper contract omitted routes`);
    const uniquePaths = new Set(planned.map((route) => route.path));
    if (uniquePaths.size !== planned.length) errors.push(`${target.id}: generated wrapper contract contains duplicate paths`);
    checkLockedStartup(target.id, raw, planned, errors);
  } catch (error) {
    errors.push(`${target.id}: generated wrapper contract invalid: ${error.message}`);
  }
  return errors;
}

const targetData = readJson(TARGETS_PATH);
const errors = rootBrowserToolchainDrift(ROOT_PACKAGE, ROOT_PACKAGE_LOCK, ROOT_BROWSER_TOOLCHAIN);
for (const target of targetData.targets) errors.push(...verifyTarget(target));
for (const target of targetData.integrations ?? []) errors.push(...verifyTarget(target, { integration: true }));

const frozenDirectories = new Set([
  ...targetData.targets.map((target) => target.canonicalDir),
  ...(targetData.integrations ?? []).map((target) => target.canonicalDir),
]);
const registry = buildDemoRegistry();
for (const demo of registry.demos.filter((entry) => PRIMARY_DEMO_KINDS.includes(entry.kind))) {
  const canonicalDir = registry.origins?.[demo.id]?.canonicalDir;
  if (!canonicalDir || frozenDirectories.has(canonicalDir)) continue;
  if (!demo.browserEntry || !existsSync(join(REPO_ROOT, demo.browserEntry))) {
    errors.push(`${demo.id}: primary support demo requires an existing browserEntry`);
  }
  if (demo.publishPath !== `/demos/${demo.id}/`) {
    errors.push(`${demo.id}: primary support demo requires publishPath /demos/${demo.id}/`);
  }
  try {
    const routes = plannedPublishedRoutes(demo);
    checkLockedStartup(demo.id, demo, routes, errors);
  } catch (error) {
    errors.push(`${demo.id}: generated wrapper contract invalid: ${error.message}`);
  }
  const packagePath = join(REPO_ROOT, canonicalDir, 'package.json');
  if (!existsSync(packagePath)) {
    errors.push(`${demo.id}: primary support demo is missing ${canonicalDir}/package.json with standard lab scripts`);
    continue;
  }
  const packageJson = readJson(packagePath);
  for (const script of STANDARD_SCRIPTS) {
    if (typeof packageJson.scripts?.[script] !== 'string' || packageJson.scripts[script].length === 0) {
      errors.push(`${demo.id}: primary support package.json missing script ${script}`);
    } else if (obviousNoOpCommand(packageJson.scripts[script])) {
      errors.push(`${demo.id}: primary support package.json script ${script} is an obvious no-op`);
    }
  }
  errors.push(...browserDependencyDrift(packageJson, ROOT_BROWSER_TOOLCHAIN)
    .map((error) => `${demo.id}: package.json ${error}`));
  checkCommandRecursion(demo.id, demo, packageJson, join(REPO_ROOT, canonicalDir), errors);
}

if (!String(ROOT_PACKAGE.scripts?.['pages:build'] ?? '').includes('build-lab-pages.mjs')) {
  errors.push('root pages:build does not invoke the generated wrapper builder');
}

if (errors.length > 0) {
  console.error(`lab implementation matrix incomplete (${errors.length} errors):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`Implemented ${targetData.targets.length} canonical targets and ${(targetData.integrations ?? []).length} integration flagships with strict raw manifests, browser entries, scripts, and generated route contracts.`);
