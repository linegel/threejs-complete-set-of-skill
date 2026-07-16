import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  loadCheckedSchemas,
  validateCheckedJsonSchema,
} from '../../scripts/lib/checked-json-schema.mjs';
import { validateRawLabManifest } from '../../scripts/lib/lab-validation.mjs';

const debuggingManifest = JSON.parse(readFileSync(
  new URL('../../threejs-debugging/examples/debugging-contract-lab/lab.manifest.json', import.meta.url),
  'utf8',
));

test('shared checked schemas validate the canonical raw manifest and runtime graph surfaces', () => {
  const schemas = loadCheckedSchemas();
  assert.deepEqual(Object.keys(schemas).sort(), [
    'evidenceManifest',
    'labManifest',
    'runtimeGraph',
    'tierVisualEvidence',
    'trackedReleaseProjection',
  ]);
  assert.deepEqual(validateCheckedJsonSchema(schemas.labManifest, debuggingManifest), {
    valid: true,
    errors: [],
  });
  const graph = {
    schemaVersion: 2,
    owners: { renderer: 'fixture', renderPipeline: 'fixture' },
    signals: [{ id: 'sceneLinearHDR', producer: 'scene', consumers: ['present'], reachable: true }],
    sceneSubmissions: [{ id: 'scene', owner: 'fixture', kind: 'lit-scene' }],
    computeDispatches: [],
    resources: [{
      id: 'scene-color',
      owner: 'fixture',
      kind: 'render-target',
      residentBytes: { value: 4096, unit: 'bytes', label: 'Derived', source: 'fixture dimensions' },
    }],
    finalToneMapOwner: 'renderOutput',
    finalOutputTransformOwner: 'renderOutput',
  };
  assert.equal(validateCheckedJsonSchema(schemas.runtimeGraph, graph).valid, true);
});

test('raw manifest validation applies the checked schema before semantic checks', () => {
  const unknown = structuredClone(debuggingManifest);
  unknown.uncheckedClaim = true;
  const unknownResult = validateRawLabManifest(unknown);
  assert.equal(unknownResult.valid, false);
  assert(unknownResult.errors.some((error) => (
    error.includes('lab-manifest.schema.json') && error.includes('unknown property uncheckedClaim')
  )));

  const invalidTier = structuredClone(debuggingManifest);
  invalidTier.tiers = [{
    id: 'bad-tier',
    targetClass: 'fixture',
    frameTargetMs: { value: 16.67, unit: 'ms', label: 'Invented', source: 'fixture' },
    resolutionPolicy: {},
    mechanismLimits: {},
    resourceLimits: {},
    degradationFromPrevious: [],
    preservedInvariants: [],
    acceptanceStatus: 'incomplete',
  }];
  const tierResult = validateRawLabManifest(invalidTier);
  assert.equal(tierResult.valid, false);
  assert(tierResult.errors.some((error) => error.includes('lab-manifest.schema.json')));
  assert(tierResult.errors.some((error) => error.includes('tiers[0].frameTargetMs.label is invalid')));
});
