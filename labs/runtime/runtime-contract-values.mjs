const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

export function assertPlainRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain record`);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain record`);
  }

  return value;
}

export function assertKnownKeys(value, allowedKeys, label) {
  assertPlainRecord(value, label);
  const allowed = new Set(allowedKeys);
  const unknown = Reflect.ownKeys(value).filter((key) => (
    typeof key !== 'string' || !allowed.has(key)
  ));

  if (unknown.length > 0) {
    throw new TypeError(`${label} contains unsupported keys: ${unknown.map(String).join(', ')}`);
  }
}

export function assertIdentifier(value, label) {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    throw new TypeError(`${label} must be one unambiguous identifier`);
  }
  return value;
}

export function assertFiniteNumber(value, label, { minimum = -Infinity, maximum = Infinity } = {}) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be finite and within [${minimum}, ${maximum}]`);
  }
  return value;
}

export function assertSafeInteger(value, label, { minimum = Number.MIN_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be a safe integer within [${minimum}, ${maximum}]`);
  }
  return value;
}

export function assertIdentifierArray(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new TypeError(`${label} must be ${allowEmpty ? 'an' : 'a non-empty'} identifier array`);
  }

  const seen = new Set();
  for (const [index, entry] of value.entries()) {
    assertIdentifier(entry, `${label}[${index}]`);
    if (seen.has(entry)) throw new TypeError(`${label} contains duplicate identifier ${entry}`);
    seen.add(entry);
  }

  return value;
}

export function immutablePlainCopy(value, label = 'contract value') {
  const ancestors = new WeakSet();

  function copy(input, path) {
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) throw new TypeError(`${path} contains a non-finite number`);
      return input;
    }
    if (typeof input !== 'object') {
      throw new TypeError(`${path} contains a non-serializable ${typeof input}`);
    }
    if (ancestors.has(input)) throw new TypeError(`${path} contains a cycle`);

    const prototype = Object.getPrototypeOf(input);
    if (!Array.isArray(input) && prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} contains a non-plain object`);
    }

    const symbols = Object.getOwnPropertySymbols(input);
    if (symbols.length > 0) throw new TypeError(`${path} contains symbol keys`);

    const descriptors = Object.getOwnPropertyDescriptors(input);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(input) && key === 'length') continue;
      if ('get' in descriptor || 'set' in descriptor) {
        throw new TypeError(`${path}.${key} must not be an accessor`);
      }
      if (!descriptor.enumerable) {
        throw new TypeError(`${path}.${key} must be enumerable`);
      }
    }

    ancestors.add(input);
    const output = Array.isArray(input) ? [] : {};
    for (const [key, entry] of Object.entries(input)) {
      Object.defineProperty(output, key, {
        value: copy(entry, `${path}.${key}`),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    ancestors.delete(input);
    return Object.freeze(output);
  }

  return copy(value, label);
}

export function isDeeplyFrozen(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return true;
  if (seen.has(value)) return true;
  seen.add(value);
  if (!Object.isFrozen(value)) return false;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || 'get' in descriptor || 'set' in descriptor) return false;
    if (!isDeeplyFrozen(descriptor.value, seen)) return false;
  }
  return true;
}
