import { readFileSync } from 'node:fs';

const SCHEMA_URLS = Object.freeze({
  evidenceManifest: new URL('../../labs/schema/evidence-bundle-v2.schema.json', import.meta.url),
  labManifest: new URL('../../labs/schema/lab-manifest.schema.json', import.meta.url),
  physicsIntegration: new URL('../../labs/schema/physics-integration.schema.json', import.meta.url),
  runtimeGraph: new URL('../../labs/schema/runtime-graph.schema.json', import.meta.url),
  tierVisualEvidence: new URL('../../labs/schema/tier-visual-evidence.schema.json', import.meta.url),
});

function typeMatches(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

function sameJsonValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function resolveLocalReference(rootSchema, reference) {
  if (typeof reference !== 'string' || !reference.startsWith('#/')) {
    throw new Error(`Unsupported JSON Schema reference ${reference}.`);
  }
  let current = rootSchema;
  for (const encoded of reference.slice(2).split('/')) {
    const key = encoded.replaceAll('~1', '/').replaceAll('~0', '~');
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, key)) {
      throw new Error(`Unresolved JSON Schema reference ${reference}.`);
    }
    current = current[key];
  }
  return current;
}

function validateBranch(value, schema, rootSchema, path, errors) {
  if (schema === true) return;
  if (schema === false) {
    errors.push(`${path} is forbidden by schema.`);
    return;
  }
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new TypeError(`${path} schema must be an object or boolean.`);
  }
  if (schema.$ref !== undefined) {
    validateBranch(value, resolveLocalReference(rootSchema, schema.$ref), rootSchema, path, errors);
  }
  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) validateBranch(value, branch, rootSchema, path, errors);
  }
  if (Array.isArray(schema.anyOf)) {
    const branchErrors = schema.anyOf.map((branch) => {
      const output = [];
      validateBranch(value, branch, rootSchema, path, output);
      return output;
    });
    if (branchErrors.every((output) => output.length > 0)) {
      errors.push(`${path} does not match any allowed schema branch.`);
    }
  }
  if (Array.isArray(schema.oneOf)) {
    let matches = 0;
    for (const branch of schema.oneOf) {
      const output = [];
      validateBranch(value, branch, rootSchema, path, output);
      if (output.length === 0) matches += 1;
    }
    if (matches !== 1) errors.push(`${path} must match exactly one schema branch; matched ${matches}.`);
  }
  if (schema.not !== undefined) {
    const output = [];
    validateBranch(value, schema.not, rootSchema, path, output);
    if (output.length === 0) errors.push(`${path} matches a forbidden schema branch.`);
  }
  if (schema.if !== undefined) {
    const conditionErrors = [];
    validateBranch(value, schema.if, rootSchema, path, conditionErrors);
    if (conditionErrors.length === 0 && schema.then !== undefined) {
      validateBranch(value, schema.then, rootSchema, path, errors);
    }
    if (conditionErrors.length > 0 && schema.else !== undefined) {
      validateBranch(value, schema.else, rootSchema, path, errors);
    }
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => typeMatches(value, type))) {
      errors.push(`${path} must have type ${types.join(' or ')}.`);
      return;
    }
  }
  if (schema.const !== undefined && !sameJsonValue(value, schema.const)) {
    errors.push(`${path} must equal ${JSON.stringify(schema.const)}.`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => sameJsonValue(value, entry))) {
    errors.push(`${path} is not an allowed enum value.`);
  }

  if (typeof value === 'string') {
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) {
      errors.push(`${path} is shorter than ${schema.minLength} characters.`);
    }
    if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) {
      errors.push(`${path} is longer than ${schema.maxLength} characters.`);
    }
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value)) {
      errors.push(`${path} does not match ${schema.pattern}.`);
    }
    if (schema.format === 'date-time' && !Number.isFinite(Date.parse(value))) {
      errors.push(`${path} is not an ISO date-time.`);
    }
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Number.isFinite(schema.minimum) && value < schema.minimum) {
      errors.push(`${path} is below ${schema.minimum}.`);
    }
    if (Number.isFinite(schema.maximum) && value > schema.maximum) {
      errors.push(`${path} exceeds ${schema.maximum}.`);
    }
    if (Number.isFinite(schema.exclusiveMinimum) && value <= schema.exclusiveMinimum) {
      errors.push(`${path} must exceed ${schema.exclusiveMinimum}.`);
    }
    if (Number.isFinite(schema.exclusiveMaximum) && value >= schema.exclusiveMaximum) {
      errors.push(`${path} must be below ${schema.exclusiveMaximum}.`);
    }
    if (Number.isFinite(schema.multipleOf)
      && Math.abs(value / schema.multipleOf - Math.round(value / schema.multipleOf)) > 1e-12) {
      errors.push(`${path} is not a multiple of ${schema.multipleOf}.`);
    }
  }
  if (Array.isArray(value)) {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) {
      errors.push(`${path} requires at least ${schema.minItems} items.`);
    }
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) {
      errors.push(`${path} allows at most ${schema.maxItems} items.`);
    }
    if (schema.uniqueItems === true) {
      const keys = value.map((entry) => JSON.stringify(entry));
      if (new Set(keys).size !== keys.length) errors.push(`${path} must contain unique items.`);
    }
    const prefixLength = Array.isArray(schema.prefixItems) ? schema.prefixItems.length : 0;
    if (Array.isArray(schema.prefixItems)) {
      schema.prefixItems.forEach((itemSchema, index) => {
        if (index < value.length) {
          validateBranch(value[index], itemSchema, rootSchema, `${path}[${index}]`, errors);
        }
      });
    }
    if (schema.items !== undefined) {
      for (let index = prefixLength; index < value.length; index += 1) {
        validateBranch(value[index], schema.items, rootSchema, `${path}[${index}]`, errors);
      }
    }
    if (schema.contains !== undefined) {
      let matches = 0;
      for (const entry of value) {
        const output = [];
        validateBranch(entry, schema.contains, rootSchema, path, output);
        if (output.length === 0) matches += 1;
      }
      const minimum = Number.isInteger(schema.minContains) ? schema.minContains : 1;
      if (matches < minimum) {
        errors.push(`${path} requires at least ${minimum} items matching contains; matched ${matches}.`);
      }
      if (Number.isInteger(schema.maxContains) && matches > schema.maxContains) {
        errors.push(`${path} allows at most ${schema.maxContains} items matching contains; matched ${matches}.`);
      }
    }
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties ?? {};
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) errors.push(`${path} is missing required property ${required}.`);
    }
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) {
        validateBranch(child, properties[key], rootSchema, `${path}.${key}`, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${path} has unknown property ${key}.`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        validateBranch(child, schema.additionalProperties, rootSchema, `${path}.${key}`, errors);
      }
    }
  }
}

export function validateCheckedJsonSchema(schema, value) {
  const errors = [];
  validateBranch(value, schema, schema, '$', errors);
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function assertCheckedJsonSchema(schema, value, label) {
  const result = validateCheckedJsonSchema(schema, value);
  if (!result.valid) {
    throw new Error(`${label} failed checked-in JSON Schema:\n- ${result.errors.join('\n- ')}`);
  }
  return value;
}

let checkedSchemas = null;

export function loadCheckedSchemas() {
  checkedSchemas ??= Object.freeze(Object.fromEntries(
    Object.entries(SCHEMA_URLS).map(([id, url]) => [id, JSON.parse(readFileSync(url, 'utf8'))]),
  ));
  return checkedSchemas;
}
