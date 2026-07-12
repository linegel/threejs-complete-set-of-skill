import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AUTHORITATIVE_COUNT_FIELDS,
  PRIMARY_DEMO_KINDS,
  authoritativePrimaryRoster,
  authoritativeSkillDirs,
  buildDemoRegistry,
  deriveRegistryCounts,
  deriveSkillCoverage,
  loadCanonicalTargets,
  validateCanonicalTargets,
} from '../../scripts/lib/lab-registry.mjs';
import {
  REQUIRED_RENDERING_PROOF_IDS,
  validateRegistry,
} from '../../scripts/lib/lab-validation.mjs';

function primaryDemos(registry) {
  return registry.demos.filter((demo) => PRIMARY_DEMO_KINDS.includes(demo.kind));
}

function acceptRequirement(requirement) {
  return {
    ...requirement,
    status: requirement.required === true ? 'accepted' : requirement.status,
    evidence: requirement.required === true ? (requirement.evidence || `fixture evidence for ${requirement.id}`) : requirement.evidence,
  };
}

function acceptPrimary(demo) {
  const accepted = structuredClone(demo);
  accepted.status = 'accepted';
  accepted.scenarios = accepted.scenarios.map((entry) => ({ ...entry, acceptanceStatus: 'accepted' }));
  accepted.mechanisms = accepted.mechanisms.map((entry) => ({ ...entry, acceptanceStatus: 'accepted' }));
  accepted.tiers = accepted.tiers.map((entry) => ({ ...entry, acceptanceStatus: 'accepted' }));
  accepted.capabilityRequirements = accepted.capabilityRequirements.map(acceptRequirement);
  accepted.runtimeProof = accepted.runtimeProof.map(acceptRequirement);
  if (accepted.executionClass === 'rendering') {
    const proofIds = new Set(accepted.runtimeProof.map((entry) => entry.id));
    for (const id of REQUIRED_RENDERING_PROOF_IDS) {
      if (!proofIds.has(id)) {
        accepted.runtimeProof.push({ id, required: true, evidence: `fixture evidence for ${id}`, status: 'accepted' });
      }
    }
    accepted.evidenceBundle = accepted.canonicalSource[0];
  }
  accepted.validationCommand ||= 'node fixture-validation.mjs';
  return accepted;
}

function refreshDerived(registry) {
  const skills = authoritativeSkillDirs(loadCanonicalTargets());
  registry.counts = deriveRegistryCounts(registry.demos, skills);
  registry.coverage = deriveSkillCoverage(registry.demos, skills);
  return registry;
}

function reconcileSyntheticProofDenominator(registry) {
  const target = loadCanonicalTargets().requiredRuntimeProofsExpected;
  const protectedIds = new Set(REQUIRED_RENDERING_PROOF_IDS);
  const skills = authoritativeSkillDirs(loadCanonicalTargets());
  let excess = deriveRegistryCounts(registry.demos, skills).requiredRuntimeProofs - target;
  for (const demo of primaryDemos(registry)) {
    if (demo.executionClass !== 'rendering') continue;
    for (let index = demo.runtimeProof.length - 1; index >= 0 && excess > 0; index -= 1) {
      const proof = demo.runtimeProof[index];
      if (proof.required === true && !protectedIds.has(proof.id)) {
        demo.runtimeProof.splice(index, 1);
        excess -= 1;
      }
    }
  }
  assert.equal(excess, 0, 'synthetic complete fixture cannot reconcile the authoritative proof denominator');
}

function completeRegistryFixture() {
  const registry = structuredClone(buildDemoRegistry());
  registry.demos = registry.demos.map((demo) => (
    PRIMARY_DEMO_KINDS.includes(demo.kind) ? acceptPrimary(demo) : demo
  ));
  // Current manifests need a later per-lab proof-ID migration. This fixture
  // demonstrates that the frozen global denominator and mandatory rendering
  // proof set are simultaneously satisfiable without weakening either gate.
  reconcileSyntheticProofDenominator(registry);
  return refreshDerived(registry);
}

function errorIncludes(result, fragment, label = fragment) {
  assert.equal(result.valid, false, `mutation unexpectedly passed: ${label}`);
  assert.ok(result.errors.some((error) => error.includes(fragment)), result.errors.join('\n'));
}

test('authoritative primary roster freezes the complete denominator and all integration metadata', () => {
  const targetData = loadCanonicalTargets();
  const result = validateCanonicalTargets(targetData);
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(targetData.primaryRoster.length, targetData.primaryExpected);
  assert.equal(targetData.primaryRoster.filter((entry) => entry.kind === 'integration-demo').length, targetData.integrationsExpected);
  assert.equal(targetData.primaryRoster.filter((entry) => entry.flagship).length, targetData.flagshipsExpected);
  assert.equal(targetData.primaryRoster.filter((entry) => entry.executionClass === 'non-rendering').length, 2);
  assert.ok(targetData.primaryRoster
    .filter((entry) => entry.kind === 'integration-demo')
    .every((entry) => entry.dependencyLabIds.length > 0));
  const registry = buildDemoRegistry();
  for (const [countKey, expectedKey] of Object.entries(AUTHORITATIVE_COUNT_FIELDS)) {
    assert.equal(registry.counts[countKey], targetData[expectedKey]);
  }
});

test('canonical target validation rejects denominator drift and dependency cycles', () => {
  const wrongDenominator = structuredClone(loadCanonicalTargets());
  wrongDenominator.primaryExpected -= 1;
  errorIncludes(
    validateCanonicalTargets(wrongDenominator),
    `primaryRoster contains ${wrongDenominator.primaryRoster.length} records; primaryExpected is ${wrongDenominator.primaryExpected}`,
    'wrong primary denominator',
  );

  const cyclic = structuredClone(loadCanonicalTargets());
  const integration = cyclic.primaryRoster.find((entry) => entry.kind === 'integration-demo');
  const dependency = cyclic.primaryRoster.find((entry) => entry.id === integration.dependencyLabIds[0]);
  dependency.kind = 'integration-demo';
  dependency.dependencyLabIds = [integration.id];
  cyclic.integrationsExpected += 1;
  errorIncludes(
    validateCanonicalTargets(cyclic),
    'primaryRoster dependency cycle',
    'cyclic primary dependency graph',
  );

  const incompletePartition = structuredClone(loadCanonicalTargets());
  incompletePartition.targets.shift();
  errorIncludes(
    validateCanonicalTargets(incompletePartition),
    'canonical targets declarations must exactly cover every canonical-lab primaryRoster entry',
    'incomplete canonical target partition',
  );
});

test('generated registry primary ids and derived totals equal the authoritative roster', () => {
  const registry = buildDemoRegistry();
  const targetData = loadCanonicalTargets();
  const expectedIds = authoritativePrimaryRoster(targetData).map((entry) => entry.id);
  assert.deepEqual(registry.primaryIds, expectedIds);
  assert.equal(registry.counts.primary, targetData.primaryExpected);
  assert.equal(registry.counts.integrations, targetData.integrationsExpected);
  assert.equal(registry.counts.flagships, targetData.flagshipsExpected);
  assert.equal(validateRegistry(registry, { validateEvidence: false }).valid, true);
});

test('a fully reconciled fixture can satisfy the exhaustive completion gate', () => {
  const result = validateRegistry(completeRegistryFixture(), {
    requireComplete: true,
    validateEvidence: false,
  });
  assert.equal(result.valid, true, result.errors.join('\n'));
});

test('the former one-accepted-primary-per-skill shortcut cannot pass with a partial matrix', () => {
  const registry = completeRegistryFixture();
  for (const demo of primaryDemos(registry)) demo.status = 'incomplete';
  const selected = new Set(registry.flagshipIds);
  for (const coverage of deriveSkillCoverage(
    registry.demos,
    authoritativeSkillDirs(loadCanonicalTargets()),
  )) {
    if (coverage.primaryLabIds[0]) selected.add(coverage.primaryLabIds[0]);
  }
  for (const demo of primaryDemos(registry)) {
    if (selected.has(demo.id)) demo.status = 'accepted';
  }
  refreshDerived(registry);
  assert.ok(registry.counts.acceptedPrimary < registry.counts.primary);
  errorIncludes(
    validateRegistry(registry, { requireComplete: true, validateEvidence: false }),
    'primary status is incomplete, not accepted',
  );
});

test('all seven formerly opportunistic support primaries remain in the frozen denominator', () => {
  const registry = completeRegistryFixture();
  const targetData = loadCanonicalTargets();
  const explicitlyDeclared = new Set([
    ...targetData.targets.map((entry) => entry.id),
    ...targetData.integrations.map((entry) => entry.id),
  ]);
  const supportIds = targetData.primaryRoster.map((entry) => entry.id).filter((id) => !explicitlyDeclared.has(id));
  assert.equal(supportIds.length, targetData.primaryExpected - explicitlyDeclared.size);
  registry.demos = registry.demos.filter((demo) => !supportIds.includes(demo.id));
  for (const id of supportIds) delete registry.origins[id];
  refreshDerived(registry);
  errorIncludes(
    validateRegistry(registry, { validateEvidence: false }),
    `primary roster is missing demos: ${supportIds.join(', ')}`,
  );
});

test('registry counts and coverage are recomputed rather than trusted', () => {
  const forgedCounts = completeRegistryFixture();
  forgedCounts.counts.primary -= 1;
  errorIncludes(validateRegistry(forgedCounts, { validateEvidence: false }), 'registry counts are forged or stale');

  const forgedCoverage = completeRegistryFixture();
  forgedCoverage.coverage[0].acceptedPrimaryLabIds.push(
    forgedCoverage.demos.find((demo) => demo.status === 'secondary').id,
  );
  errorIncludes(validateRegistry(forgedCoverage, { validateEvidence: false }), 'registry coverage is forged or stale');
});

test('fixed-route, capability, and runtime-proof denominators cannot shrink', () => {
  for (const [label, countKey, expectedKey, mutate] of [
    ['fixed route', 'fixedRoutes', 'fixedRoutesExpected', (demo) => {
      for (const key of ['scenarios', 'mechanisms', 'tiers']) {
        if (demo[key].length > 0) {
          demo[key].pop();
          return;
        }
      }
    }],
    ['required capability', 'requiredCapabilities', 'requiredCapabilitiesExpected', (demo) => {
      const index = demo.capabilityRequirements.findIndex((entry) => entry.required === true);
      demo.capabilityRequirements.splice(index, 1);
    }],
    ['required runtime proof', 'requiredRuntimeProofs', 'requiredRuntimeProofsExpected', (demo) => {
      const index = demo.runtimeProof.findIndex((entry) => entry.required === true);
      demo.runtimeProof.splice(index, 1);
    }],
  ]) {
    const registry = completeRegistryFixture();
    const demo = primaryDemos(registry).find((entry) => (
      countKey === 'fixedRoutes'
        ? entry.scenarios.length + entry.mechanisms.length + entry.tiers.length > 0
        : countKey === 'requiredCapabilities'
          ? entry.capabilityRequirements.some((item) => item.required === true)
          : entry.runtimeProof.some((item) => item.required === true)
    ));
    mutate(demo);
    refreshDerived(registry);
    assert.equal(registry.counts[countKey], loadCanonicalTargets()[expectedKey] - 1);
    errorIncludes(
      validateRegistry(registry, { validateEvidence: false }),
      `registry ${countKey} denominator drift`,
      `deleted ${label}`,
    );
  }
});

test('accepted primaries require accepted routes, capabilities, and runtime proofs with evidence', () => {
  for (const [label, mutate, expected] of [
    ['scenario', (demo) => { demo.scenarios[0].acceptanceStatus = 'incomplete'; }, 'every declared scenario'],
    ['mechanism', (demo) => { demo.mechanisms[0].acceptanceStatus = 'incomplete'; }, 'every declared mechanism'],
    ['tier', (demo) => { demo.tiers[0].acceptanceStatus = 'incomplete'; }, 'every declared tier'],
    ['capability', (demo) => { demo.capabilityRequirements.find((entry) => entry.required).status = 'incomplete'; }, 'capabilityRequirements'],
    ['proof', (demo) => { demo.runtimeProof.find((entry) => entry.required).status = 'incomplete'; }, 'runtimeProof'],
    ['proof evidence', (demo) => { demo.runtimeProof.find((entry) => entry.required).evidence = '   '; }, 'nonempty evidence'],
  ]) {
    const registry = completeRegistryFixture();
    const demo = primaryDemos(registry).find((entry) => (
      entry.scenarios.length > 0 && entry.mechanisms.length > 0 && entry.tiers.length > 0
      && entry.capabilityRequirements.some((item) => item.required)
      && entry.runtimeProof.some((item) => item.required)
    ));
    mutate(demo);
    refreshDerived(registry);
    errorIncludes(validateRegistry(registry, { validateEvidence: false }), expected, label);
  }
});

test('duplicate capability and runtime-proof ids are rejected', () => {
  for (const key of ['capabilityRequirements', 'runtimeProof']) {
    const registry = completeRegistryFixture();
    const demo = primaryDemos(registry).find((entry) => entry[key].length > 0);
    demo[key].push(structuredClone(demo[key][0]));
    refreshDerived(registry);
    errorIncludes(
      validateRegistry(registry, { validateEvidence: false }),
      `${key} has duplicate ids`,
      `duplicate ${key}`,
    );
  }
});

test('duplicate fixed-route ids and missing acceptance verdicts are rejected', () => {
  for (const key of ['scenarios', 'mechanisms', 'tiers']) {
    const duplicateRegistry = completeRegistryFixture();
    const duplicateDemo = primaryDemos(duplicateRegistry).find((entry) => entry[key].length > 0);
    duplicateDemo[key].push(structuredClone(duplicateDemo[key][0]));
    refreshDerived(duplicateRegistry);
    errorIncludes(
      validateRegistry(duplicateRegistry, { validateEvidence: false }),
      `${key} has duplicate ids`,
      `duplicate ${key}`,
    );

    const missingVerdictRegistry = completeRegistryFixture();
    const missingVerdictDemo = primaryDemos(missingVerdictRegistry).find((entry) => entry[key].length > 0);
    delete missingVerdictDemo[key][0].acceptanceStatus;
    refreshDerived(missingVerdictRegistry);
    errorIncludes(
      validateRegistry(missingVerdictRegistry, { requireComplete: true, validateEvidence: false }),
      `${key}/${missingVerdictDemo[key][0].id} is missing-status, not accepted`,
      `missing ${key} acceptance verdict`,
    );
  }
});

test('integration dependency validation rejects missing, secondary, self, cyclic, and incomplete dependencies', () => {
  const cases = [
    ['missing', (registry, integration) => { integration.dependencyLabIds = ['does-not-exist']; }, 'dependency does-not-exist is missing'],
    ['secondary', (registry, integration) => {
      integration.dependencyLabIds = [registry.demos.find((demo) => demo.status === 'secondary').id];
    }, 'is secondary, not primary coverage'],
    ['self', (registry, integration) => { integration.dependencyLabIds = [integration.id]; }, 'cannot reference itself'],
    ['cycle', (registry, integration) => {
      const other = primaryDemos(registry).find((demo) => demo.kind === 'integration-demo' && demo.id !== integration.id);
      integration.dependencyLabIds = [other.id];
      other.dependencyLabIds = [integration.id];
    }, 'integration dependency cycle'],
    ['incomplete', (registry, integration) => {
      const dependency = registry.demos.find((demo) => demo.id === integration.dependencyLabIds[0]);
      dependency.status = 'incomplete';
    }, 'accepted integration dependency'],
  ];
  for (const [label, mutate, expected] of cases) {
    const registry = completeRegistryFixture();
    const integration = primaryDemos(registry).find((demo) => demo.kind === 'integration-demo');
    mutate(registry, integration);
    refreshDerived(registry);
    errorIncludes(validateRegistry(registry, { validateEvidence: false }), expected, label);
  }
});

test('a rendering primary cannot forge the non-rendering evidence exemption', () => {
  const registry = buildDemoRegistry();
  const rendering = primaryDemos(registry).find((demo) => demo.executionClass === 'rendering');
  rendering.nonRenderingScenarioSuite = true;
  errorIncludes(
    validateRegistry(registry, { validateEvidence: false }),
    'nonRenderingScenarioSuite disagrees with authoritative executionClass rendering',
  );
});
