import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  NumericLabel,
  assertLabelledNumerics,
  numericArray,
  numericDatum,
  numericValue,
  validateNumericArray,
  validateNumericDatum,
} from '../../labs/runtime/numeric-evidence.mjs';

test('numeric evidence constructors preserve finite values and explicit provenance', () => {
  const measured = numericDatum(8.5, 'ms', NumericLabel.MEASURED, 'timestamp query');
  assert.equal(numericValue(measured), 8.5);
  assert.equal(Object.isFrozen(measured), true);

  const samples = numericArray([1, 2, 3], 'ms', NumericLabel.MEASURED, 'resolved samples');
  assert.equal(validateNumericArray(samples), true);
  assert.equal(Object.isFrozen(samples), true);
  assert.throws(() => numericArray([], 'ms', NumericLabel.MEASURED, 'empty fixture'), /non-empty array/);
  assert.throws(() => validateNumericDatum({ value: 1, unit: '', label: 'Measured', source: 'fixture' }), /non-empty string/);
  assert.throws(() => numericDatum(Number.NaN, 'ms', NumericLabel.MEASURED, 'fixture'), /finite number/);
});

test('recursive provenance rejects every bare normative number except declared metadata', () => {
  const evidence = {
    schemaVersion: 2,
    timing: numericDatum(4.25, 'ms', 'Measured', 'timestamp query'),
    samples: numericArray([4, 4.5], 'ms', 'Measured', 'timestamp query population'),
    nested: [{ gate: numericDatum(16.67, 'ms', 'Gated', '60 Hz target') }],
  };
  assert.equal(assertLabelledNumerics(evidence), true);
  assert.throws(
    () => assertLabelledNumerics({ ...evidence, nested: [{ gate: 16.67 }] }),
    /unlabelled numeric value/,
  );
  assert.equal(assertLabelledNumerics({ revision: 185 }, { allowedBarePaths: ['$.revision'] }), true);
  assert.throws(() => assertLabelledNumerics({
    schemaVersion: 2,
    samples: { values: [], unit: 'ms', label: 'Measured', source: 'fixture' },
  }), /non-empty array/);
});
