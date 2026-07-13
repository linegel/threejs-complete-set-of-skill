import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PRIMARY_DEMO_KINDS,
  authoritativeSkillDirs,
  buildDemoRegistry,
  deriveRegistryCounts,
  deriveSkillCoverage,
  loadCanonicalTargets,
  validateCanonicalTargets,
} from '../../scripts/lib/lab-registry.mjs';
import { validateRegistry } from '../../scripts/lib/lab-validation.mjs';

function primaryDemos(registry) {
  return registry.demos.filter((demo) => PRIMARY_DEMO_KINDS.includes(demo.kind));
}

function refreshDerived(registry) {
  const skills = authoritativeSkillDirs();
  registry.counts = deriveRegistryCounts(registry.demos, skills);
  registry.coverage = deriveSkillCoverage(registry.demos, skills);
  return registry;
}

function errorIncludes(result, fragment, label = fragment) {
  assert.equal(result.valid, false, `mutation unexpectedly passed: ${label}`);
  assert.ok(result.errors.some((error) => error.includes(fragment)), result.errors.join('\n'));
}

test('canonical demo targets have structural identity without frozen counters', () => {
  const targets = loadCanonicalTargets();
  const result = validateCanonicalTargets(targets);
  assert.equal(result.valid, true, result.errors.join('\n'));
  for (const removed of [
    'skillsExpected',
    'primaryExpected',
    'integrationsExpected',
    'flagshipsExpected',
    'fixedRoutesExpected',
    'requiredCapabilitiesExpected',
    'requiredRuntimeProofsExpected',
  ]) {
    assert.equal(Object.hasOwn(targets, removed), false, `${removed} must not return as a frozen denominator`);
  }
});

test('canonical target validation keeps uniqueness, partition, and cycle checks', () => {
  const duplicate = structuredClone(loadCanonicalTargets());
  duplicate.primaryRoster.push(structuredClone(duplicate.primaryRoster[0]));
  errorIncludes(validateCanonicalTargets(duplicate), 'primaryRoster has duplicate ids');

  const cyclic = structuredClone(loadCanonicalTargets());
  const integration = cyclic.primaryRoster.find((entry) => entry.kind === 'integration-demo');
  const dependency = cyclic.primaryRoster.find((entry) => entry.id === integration.dependencyLabIds[0]);
  dependency.kind = 'integration-demo';
  dependency.dependencyLabIds = [integration.id];
  errorIncludes(validateCanonicalTargets(cyclic), 'primaryRoster dependency cycle');

  const incompletePartition = structuredClone(loadCanonicalTargets());
  incompletePartition.targets.shift();
  errorIncludes(validateCanonicalTargets(incompletePartition), 'canonical targets declarations must exactly cover');
});

test('registry counts and coverage are derived rather than trusted', () => {
  const forgedCounts = buildDemoRegistry();
  forgedCounts.counts.primary -= 1;
  errorIncludes(validateRegistry(forgedCounts), 'registry counts are forged or stale');

  const forgedCoverage = buildDemoRegistry();
  forgedCoverage.coverage[0].primaryLabIds.push('not-a-real-demo');
  errorIncludes(validateRegistry(forgedCoverage), 'registry coverage is forged or stale');
});

test('demo acceptance and evidence metadata do not create a completion gate', () => {
  const registry = structuredClone(buildDemoRegistry());
  const demo = primaryDemos(registry).find((entry) => entry.executionClass === 'rendering');
  demo.status = 'accepted';
  demo.evidenceContract = 'none';
  demo.evidenceBundle = null;
  demo.validationCommand = null;
  demo.scenarios = demo.scenarios.map((entry) => ({ ...entry, acceptanceStatus: 'incomplete' }));
  demo.mechanisms = demo.mechanisms.map((entry) => ({ ...entry, acceptanceStatus: 'incomplete' }));
  demo.tiers = demo.tiers.map((entry) => ({ ...entry, acceptanceStatus: 'incomplete' }));
  demo.capabilityRequirements = demo.capabilityRequirements.map((entry) => ({ ...entry, status: 'incomplete', evidence: null }));
  demo.runtimeProof = demo.runtimeProof.map((entry) => ({ ...entry, status: 'incomplete', evidence: null }));
  refreshDerived(registry);
  const result = validateRegistry(registry);
  assert.equal(result.valid, true, result.errors.join('\n'));
});

test('changing or removing route and proof records does not hit a global denominator', () => {
  const registry = structuredClone(buildDemoRegistry());
  const demo = primaryDemos(registry).find((entry) => entry.scenarios.length > 0 && entry.runtimeProof.length > 0);
  demo.scenarios.pop();
  demo.runtimeProof.pop();
  refreshDerived(registry);
  const result = validateRegistry(registry);
  assert.equal(result.valid, true, result.errors.join('\n'));
});

test('dependency validation is structural and does not propagate acceptance', () => {
  const independentStatus = structuredClone(buildDemoRegistry());
  const integration = primaryDemos(independentStatus).find((demo) => demo.kind === 'integration-demo');
  integration.status = 'accepted';
  independentStatus.demos.find((demo) => demo.id === integration.dependencyLabIds[0]).status = 'incomplete';
  refreshDerived(independentStatus);
  assert.equal(validateRegistry(independentStatus).valid, true);

  for (const [label, mutate, expected] of [
    ['missing', (registry, demo) => { demo.dependencyLabIds = ['does-not-exist']; }, 'dependency does-not-exist is missing'],
    ['self', (registry, demo) => { demo.dependencyLabIds = [demo.id]; }, 'cannot reference itself'],
    ['cycle', (registry, demo) => {
      const other = primaryDemos(registry).find((entry) => entry.kind === 'integration-demo' && entry.id !== demo.id);
      demo.dependencyLabIds = [other.id];
      other.dependencyLabIds = [demo.id];
    }, 'integration dependency cycle'],
  ]) {
    const registry = structuredClone(buildDemoRegistry());
    const demo = primaryDemos(registry).find((entry) => entry.kind === 'integration-demo');
    mutate(registry, demo);
    refreshDerived(registry);
    errorIncludes(validateRegistry(registry), expected, label);
  }
});

test('duplicate route, capability, and proof ids remain invalid', () => {
  for (const key of ['scenarios', 'mechanisms', 'tiers', 'capabilityRequirements', 'runtimeProof']) {
    const registry = structuredClone(buildDemoRegistry());
    const demo = primaryDemos(registry).find((entry) => entry[key].length > 0);
    demo[key].push(structuredClone(demo[key][0]));
    refreshDerived(registry);
    errorIncludes(validateRegistry(registry), `${key} has duplicate ids`, key);
  }
});
