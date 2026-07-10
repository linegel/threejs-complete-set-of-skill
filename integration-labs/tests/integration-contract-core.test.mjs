import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  INTEGRATION_REASON,
  createDuplicateOwnerMutation,
  describeRuntimeGraph,
  getLockedTier,
  validateIntegrationContract,
} from '../shared/integration-contract-core.mjs';

const evidence = (value, unit, source) => ({ value, unit, label: 'Authored', source });

function fixtureContract() {
  const owners = [
    ['renderer', 'threejs-image-pipeline'],
    ['final-render-pipeline', 'threejs-image-pipeline'],
    ['tone-map', 'threejs-image-pipeline'],
    ['output-transform', 'threejs-image-pipeline'],
    ['quality-governor', 'fixture-host'],
    ['timebase', 'fixture-host'],
    ['camera-jitter', 'threejs-image-pipeline'],
  ].map(([semantic, owner]) => ({ semantic, owner, exclusive: true }));
  const tier = (id, budget, degradationFromPrevious) => ({
    id,
    targetFrameMs: evidence(16.67, 'ms', `${id} target`),
    stageBudgets: [{ id: 'final-image', budgetMs: evidence(budget, 'ms', `${id} stage budget`) }],
    degradationFromPrevious,
    preservedInvariants: ['one final-image owner'],
  });
  return {
    schemaVersion: 2,
    id: 'fixture-integration',
    status: 'incomplete',
    skills: ['threejs-image-pipeline', 'fixture-host'],
    modes: ['final'],
    cameras: ['design'],
    seeds: [1],
    owners,
    signals: [{ id: 'scene-hdr', producer: 'threejs-image-pipeline', consumers: ['fixture-host'] }],
    sceneSubmissions: [{ id: 'lit', owner: 'threejs-image-pipeline' }],
    computeDispatches: [],
    resources: [],
    tiers: [
      tier('hero', 15, []),
      tier('balanced', 12, ['reduce optional samples']),
      tier('budgeted', 9, ['reduce optional detail']),
    ],
    adapterRequirements: [{
      id: 'fixture-stage',
      skill: 'fixture-host',
      sourceStatus: 'missing',
      requiredExport: 'createFixtureStage',
    }],
    qualityGovernor: {
      performanceBasis: 'sustained-measured-p95-with-hysteresis-and-cooldown',
    },
    runtimeEvidence: {
      nativeWebGPU: 'INSUFFICIENT_EVIDENCE',
      renderTargetReadback: 'INSUFFICIENT_EVIDENCE',
      currentAdapterTiming: 'INSUFFICIENT_EVIDENCE',
    },
  };
}

test('a truthful static flagship contract remains incomplete until runtime proof exists', () => {
  const contract = fixtureContract();
  const result = validateIntegrationContract(contract);
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.code, INTEGRATION_REASON.INCOMPLETE);
  assert.equal(result.details.ready, false);
  assert.deepEqual(result.details.missingAdapters, ['fixture-stage']);
  assert.deepEqual(result.details.tiers.map(({ id }) => id), ['hero', 'balanced', 'budgeted']);
});

test('runtime graph description preserves the exclusive final-image owners', () => {
  const graph = describeRuntimeGraph(fixtureContract(), 'balanced');
  assert.equal(graph.finalToneMapOwner, 'threejs-image-pipeline');
  assert.equal(graph.finalOutputTransformOwner, 'threejs-image-pipeline');
  assert.equal(graph.tier.id, 'balanced');
});

test('duplicate ownership and fabricated over-budget tiers are rejected', () => {
  const duplicate = validateIntegrationContract(
    createDuplicateOwnerMutation(fixtureContract(), 'renderer', 'private-renderer'),
  );
  assert.equal(duplicate.code, INTEGRATION_REASON.DUPLICATE_OWNER);

  const overBudget = fixtureContract();
  overBudget.tiers[0].stageBudgets[0].budgetMs.value = 17.5;
  assert.equal(validateIntegrationContract(overBudget).code, INTEGRATION_REASON.BUDGET);
});

test('unknown locked tiers fail instead of silently selecting another tier', () => {
  assert.throws(
    () => getLockedTier(fixtureContract(), 'mobile'),
    (error) => error.code === INTEGRATION_REASON.UNKNOWN_TIER,
  );
});
