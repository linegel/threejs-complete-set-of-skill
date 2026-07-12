import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertPhysicsContext,
  createEnvironmentForcingSnapshot,
  createPhysicsContext,
  createPhysicsGraph,
  createPhysicsStateSnapshot,
} from '../../labs/runtime/physics-integration-contracts.mjs';
import { immutablePlainCopy } from '../../labs/runtime/runtime-contract-values.mjs';
import {
  loadCheckedSchemas,
  validateCheckedJsonSchema,
} from '../../scripts/lib/checked-json-schema.mjs';

function fixture() {
  const fixedStepSeconds = 0.5;
  const previousState = createPhysicsStateSnapshot({
    tick: 1,
    fixedStepSeconds,
    state: { waterHeight: 0.1, velocity: [0, 0.02, 0] },
    stateUnits: { waterHeight: 'meter', velocity: 'meter-per-second' },
  });
  const currentState = createPhysicsStateSnapshot({
    tick: 2,
    fixedStepSeconds,
    state: { waterHeight: 0.12, velocity: [0, 0.03, 0] },
    stateUnits: { waterHeight: 'meter', velocity: 'meter-per-second' },
  });
  const forcing = createEnvironmentForcingSnapshot({
    source: 'authored schema fixture',
    seed: 1,
    timeSeconds: 1,
    wind: [2, 0, 1],
    temperatureK: 289,
    precipitationRate: 0.001,
    cloudForcing: 0.4,
    waterForcing: 0.25,
  });
  const context = createPhysicsContext({
    worldUnitsPerMeter: 10,
    fixedStepSeconds,
    currentTick: 2,
    previousState,
    currentState,
    forcing,
  });
  const graph = createPhysicsGraph({
    context,
    producers: { committedWater: 'water' },
    consumers: { committedWater: ['present-water'] },
    coordination: [],
    commits: [{
      id: 'commit-water',
      owner: 'water',
      reads: [],
      writes: ['committedWater'],
      costId: 'cost-commit-water',
    }],
    presentation: [{
      id: 'present-water',
      owner: 'presentation',
      reads: ['committedWater'],
      writes: [],
      costId: 'cost-present-water',
    }],
    costs: [
      {
        id: 'cost-commit-water',
        owner: 'water',
        scope: 'commit',
        accounting: 'unmeasured-contract',
        includes: ['commit-water'],
      },
      {
        id: 'cost-present-water',
        owner: 'presentation',
        scope: 'presentation',
        accounting: 'unmeasured-contract',
        includes: ['present-water'],
      },
    ],
  });
  return {
    forcing,
    previousState,
    currentState,
    context,
    graph,
  };
}

function assertSchemaPasses(value) {
  const result = validateCheckedJsonSchema(loadCheckedSchemas().physicsIntegration, value);
  assert.equal(result.valid, true, result.errors.join('\n'));
}

function assertSchemaRejects(value, fragment) {
  const result = validateCheckedJsonSchema(loadCheckedSchemas().physicsIntegration, value);
  assert.equal(result.valid, false, 'physics integration schema mutation unexpectedly passed');
  assert(result.errors.some((error) => error.includes(fragment)), result.errors.join('\n'));
}

test('checked physics schema accepts every canonical shared integration record', () => {
  const records = fixture();
  for (const record of Object.values(records)) assertSchemaPasses(record);
});

test('checked physics schema rejects unknown fields and opaque state payloads', () => {
  const records = fixture();

  const fallback = structuredClone(records.forcing);
  fallback.automaticFallback = true;
  assertSchemaRejects(fallback, 'must match exactly one schema branch');

  const opaqueState = structuredClone(records.currentState);
  opaqueState.state.waterHeight = { meters: 0.12 };
  assertSchemaRejects(opaqueState, 'must match exactly one schema branch');

  const wrongConvention = structuredClone(records.context);
  wrongConvention.unitConvention = 'meters-per-world-unit';
  assertSchemaRejects(wrongConvention, 'must match exactly one schema branch');

  const privateReplacement = structuredClone(records.graph);
  privateReplacement.commits[0].privateInputs = ['private-water'];
  assertSchemaRejects(privateReplacement, 'must match exactly one schema branch');
});

test('runtime semantics remain stricter than structural schema where values must reconcile', () => {
  const { context } = fixture();
  const staleTick = structuredClone(context);
  staleTick.currentTick = 3;
  assertSchemaPasses(staleTick);
  assert.throws(
    () => assertPhysicsContext(immutablePlainCopy(staleTick, 'stale tick schema fixture')),
    /exactly bracket currentTick/,
  );

  const missingUnit = structuredClone(context);
  delete missingUnit.currentState.stateUnits.velocity;
  assertSchemaPasses(missingUnit);
  assert.throws(
    () => assertPhysicsContext(immutablePlainCopy(missingUnit, 'missing unit schema fixture')),
    /exact state payload key set/,
  );
});
