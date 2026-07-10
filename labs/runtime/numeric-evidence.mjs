export const NUMERIC_LABELS = Object.freeze([
  'Authored',
  'Derived',
  'Measured',
  'Gated',
]);

export function numericDatum(value, unit, label, source, uncertainty) {
  if (!Number.isFinite(value)) throw new TypeError('numeric evidence value must be finite');
  if (typeof unit !== 'string' || unit.length === 0) throw new TypeError('numeric evidence unit is required');
  if (!NUMERIC_LABELS.includes(label)) throw new TypeError(`unknown numeric evidence label: ${label}`);
  if (typeof source !== 'string' || source.length === 0) throw new TypeError('numeric evidence source is required');

  const datum = { value, unit, label, source };
  if (uncertainty !== undefined) {
    if (typeof uncertainty !== 'string' || uncertainty.length === 0) {
      throw new TypeError('numeric evidence uncertainty must be a non-empty string');
    }
    datum.uncertainty = uncertainty;
  }
  return Object.freeze(datum);
}

export function numericArray(values, unit, label, source, uncertainty) {
  if (!Array.isArray(values) || values.some((value) => !Number.isFinite(value))) {
    throw new TypeError('numeric evidence array values must all be finite');
  }
  const datum = { ...numericDatum(0, unit, label, source, uncertainty), values: [...values] };
  delete datum.value;
  return Object.freeze(datum);
}

export function isNumericDatum(value) {
  return Boolean(
    value
      && typeof value === 'object'
      && Number.isFinite(value.value)
      && typeof value.unit === 'string'
      && NUMERIC_LABELS.includes(value.label)
      && typeof value.source === 'string',
  );
}
