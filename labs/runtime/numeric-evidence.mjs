export const NUMERIC_LABELS = Object.freeze([
  'Authored',
  'Derived',
  'Measured',
  'Gated',
]);

export const NumericLabel = Object.freeze({
  AUTHORED: 'Authored',
  DERIVED: 'Derived',
  MEASURED: 'Measured',
  GATED: 'Gated',
});

function requireFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

export function numericDatum(value, unit, label, source, uncertainty) {
  const datum = { value, unit, label, source };
  if (uncertainty !== undefined) {
    datum.uncertainty = uncertainty;
  }
  validateNumericDatum(datum, 'numeric evidence');
  return Object.freeze(datum);
}

export function numericArray(values, unit, label, source, uncertainty) {
  if (!Array.isArray(values)) throw new TypeError('numeric evidence array values must be an array');
  const datum = { values: [...values], unit, label, source };
  if (uncertainty !== undefined) datum.uncertainty = uncertainty;
  validateNumericArray(datum, 'numeric evidence array');
  return Object.freeze(datum);
}

export function isNumericDatum(value) {
  return Boolean(value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.hasOwn(value, 'value')
    && Object.hasOwn(value, 'unit')
    && Object.hasOwn(value, 'label')
    && Object.hasOwn(value, 'source'));
}

export function isNumericArray(value) {
  return Boolean(value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.hasOwn(value, 'values')
    && Object.hasOwn(value, 'unit')
    && Object.hasOwn(value, 'label')
    && Object.hasOwn(value, 'source'));
}

export function validateNumericDatum(datum, path = 'numeric datum') {
  if (!isNumericDatum(datum)) {
    throw new TypeError(`${path} must use { value, unit, label, source } numeric evidence`);
  }
  requireFiniteNumber(datum.value, `${path}.value`);
  requireNonEmptyString(datum.unit, `${path}.unit`);
  requireNonEmptyString(datum.label, `${path}.label`);
  requireNonEmptyString(datum.source, `${path}.source`);
  if (!NUMERIC_LABELS.includes(datum.label)) {
    throw new TypeError(`${path}.label must be Authored, Derived, Measured, or Gated`);
  }
  if (datum.uncertainty !== undefined) {
    requireNonEmptyString(datum.uncertainty, `${path}.uncertainty`);
  }
  return true;
}

export function validateNumericArray(datum, path = 'numeric array') {
  if (!isNumericArray(datum)) {
    throw new TypeError(`${path} must use { values, unit, label, source } numeric evidence`);
  }
  if (!Array.isArray(datum.values) || datum.values.length === 0) {
    throw new TypeError(`${path}.values must be a non-empty array`);
  }
  datum.values.forEach((value, index) => requireFiniteNumber(value, `${path}.values[${index}]`));
  requireNonEmptyString(datum.unit, `${path}.unit`);
  requireNonEmptyString(datum.label, `${path}.label`);
  requireNonEmptyString(datum.source, `${path}.source`);
  if (!NUMERIC_LABELS.includes(datum.label)) {
    throw new TypeError(`${path}.label must be Authored, Derived, Measured, or Gated`);
  }
  if (datum.uncertainty !== undefined) {
    requireNonEmptyString(datum.uncertainty, `${path}.uncertainty`);
  }
  return true;
}

export function assertLabelledNumerics(value, options = {}) {
  const allowedBarePaths = new Set(options.allowedBarePaths ?? ['$.schemaVersion']);

  function visit(entry, path) {
    if (typeof entry === 'number') {
      requireFiniteNumber(entry, path);
      if (!allowedBarePaths.has(path)) {
        throw new TypeError(`${path} is an unlabelled numeric value; use { value, unit, label, source }`);
      }
      return;
    }
    if (entry === null || typeof entry !== 'object') return;
    if (isNumericDatum(entry)) {
      validateNumericDatum(entry, path);
      return;
    }
    if (isNumericArray(entry)) {
      validateNumericArray(entry, path);
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach((child, index) => visit(child, `${path}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(entry)) visit(child, `${path}.${key}`);
  }

  visit(value, '$');
  return true;
}

export function numericValue(datum, path = 'numeric datum') {
  validateNumericDatum(datum, path);
  return datum.value;
}
