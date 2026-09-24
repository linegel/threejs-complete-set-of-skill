const U32_MAX_PLUS_ONE = 0x1_0000_0000;

export const PLACEMENT_TUPLE_LAYOUT = Object.freeze({
  generatorSchemaVersion: 1,
  globalSeedWords: 2,
  stableSpeciesIdWords: 2,
  biasedWorldCellWords: 3,
  candidateOrdinal: 1,
});

const PLACEMENT_TUPLE_WORDS = 9;

function u32(value, label) {
  if (!Number.isInteger(value) || value < 0 || value >= U32_MAX_PLUS_ONE) {
    throw new Error(`${label} must be a u32`);
  }
  return value >>> 0;
}

function assertPlacementTuple(tuple, label) {
  if (!Array.isArray(tuple) || tuple.length !== PLACEMENT_TUPLE_WORDS) {
    throw new Error(`${label} must contain exactly ${PLACEMENT_TUPLE_WORDS} u32 words`);
  }
  for (let index = 0; index < tuple.length; index += 1) {
    if (!Object.hasOwn(tuple, index)) throw new Error(`${label}[${index}] must be an own u32 word`);
    u32(tuple[index], `${label}[${index}]`);
  }
  return tuple;
}

function assertWinnerKey(key, label) {
  if (key === null || typeof key !== "object" || Array.isArray(key)) {
    throw new Error(`${label} must be a winner-key record`);
  }
  u32(key.priorityHashU32, `${label}.priorityHashU32`);
  assertPlacementTuple(key.tuple, `${label}.tuple`);
  return key;
}

export function biasI32(value) {
  if (!Number.isInteger(value) || value < -0x8000_0000 || value > 0x7fff_ffff) {
    throw new Error("world-cell coordinate must be an i32");
  }
  return (value + 0x8000_0000) >>> 0;
}

function words(values, label, expectedLength) {
  if (!Array.isArray(values) || values.length !== expectedLength) {
    throw new Error(`${label} must contain exactly ${expectedLength} u32 words`);
  }
  return Array.from({length:expectedLength}, (_, index) => {
    if (!Object.hasOwn(values, index)) throw new Error(`${label}[${index}] must be an own u32 word`);
    return u32(values[index], `${label}[${index}]`);
  });
}

export function candidateTuple({
  generatorSchemaVersion,
  globalSeedWords,
  stableSpeciesIdWords,
  biasedWorldCellWords,
  candidateOrdinal,
}) {
  const tuple = [
    u32(generatorSchemaVersion, "generatorSchemaVersion"),
    ...words(globalSeedWords, "globalSeedWords", PLACEMENT_TUPLE_LAYOUT.globalSeedWords),
    ...words(
      stableSpeciesIdWords,
      "stableSpeciesIdWords",
      PLACEMENT_TUPLE_LAYOUT.stableSpeciesIdWords,
    ),
    ...words(
      biasedWorldCellWords,
      "biasedWorldCellWords",
      PLACEMENT_TUPLE_LAYOUT.biasedWorldCellWords,
    ),
    u32(candidateOrdinal, "candidateOrdinal"),
  ];
  assertPlacementTuple(tuple, "candidate tuple");
  return Object.freeze(tuple);
}

export function compareTuples(left, right) {
  assertPlacementTuple(left, "left candidate tuple");
  assertPlacementTuple(right, "right candidate tuple");
  for (let index = 0; index < left.length; index += 1) {
    const delta = left[index] - right[index];
    if (delta !== 0) return Math.sign(delta);
  }
  return 0;
}

export function hashTuple(tuple) {
  assertPlacementTuple(tuple, "candidate tuple");
  let hash = 0x811c9dc5;
  for (const word of tuple) {
    hash ^= word;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function winnerKey(tuple) {
  assertPlacementTuple(tuple, "candidate tuple");
  const retainedTuple = Object.freeze([...tuple]);
  return Object.freeze({ priorityHashU32: hashTuple(retainedTuple), tuple:retainedTuple });
}

export function compareWinnerKeys(left, right) {
  assertWinnerKey(left, "left winner key");
  assertWinnerKey(right, "right winner key");
  const priority = left.priorityHashU32 - right.priorityHashU32;
  return priority === 0 ? compareTuples(left.tuple, right.tuple) : Math.sign(priority);
}

export function ownsHalfOpen(position, minimum, maximum) {
  if (!Array.isArray(position) || !Array.isArray(minimum) || !Array.isArray(maximum) ||
      position.length === 0 ||
      position.length !== minimum.length ||
      position.length !== maximum.length) {
    throw new Error("position and chunk bounds must have equal nonzero dimensions");
  }
  for (let axis = 0; axis < position.length; axis += 1) {
    if (![position[axis], minimum[axis], maximum[axis]].every(Number.isFinite) ||
        minimum[axis] >= maximum[axis]) {
      throw new Error(`invalid half-open bounds on axis ${axis}`);
    }
  }
  return position.every((value, axis) =>
    minimum[axis] <= value && value < maximum[axis]);
}

function assertCandidates(candidates, keyField) {
  if (!Array.isArray(candidates)) throw new Error("candidates must be a dense array");
  const seen = new Set();
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (!Object.hasOwn(candidates, index) || candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error(`candidates[${index}] must be a candidate record`);
    }
    const key = assertWinnerKey(candidate[keyField], `candidates[${index}].${keyField}`);
    const identity = key.tuple.join(",");
    if (seen.has(identity)) throw new Error("duplicate candidate tuple");
    seen.add(identity);
  }
}

// Higher keys win. The callback and candidate records must remain pure/stable.
// This is a quadratic offline oracle, not a production spatial index.
export function maternII(candidates, conflicts) {
  if (typeof conflicts !== "function") throw new TypeError("conflicts must be a function");
  assertCandidates(candidates, "winnerKey");
  const wins = candidates.map(() => true);
  for (let index = 0; index < candidates.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < candidates.length; otherIndex += 1) {
      const candidate = candidates[index], other = candidates[otherIndex];
      const forward = conflicts(candidate, other), reverse = conflicts(other, candidate);
      if (typeof forward !== "boolean" || typeof reverse !== "boolean") {
        throw new TypeError("conflicts must return a synchronous boolean");
      }
      if (forward !== reverse) throw new Error("conflicts(a, b) must be symmetric");
      if (forward) {
        const lower = compareWinnerKeys(candidate.winnerKey, other.winnerKey) < 0 ? index : otherIndex;
        wins[lower] = false;
      }
    }
  }
  return candidates.filter((_, index) => wins[index]).sort((left, right) =>
    compareWinnerKeys(right.winnerKey, left.winnerKey));
}

export function nestedLodPrefix(candidates, retainedCount) {
  assertCandidates(candidates, "thinningKey");
  if (!Number.isSafeInteger(retainedCount) || retainedCount < 0 || retainedCount > candidates.length) {
    throw new RangeError("retainedCount must be a safe integer from zero to candidate count");
  }
  return [...candidates]
    .sort((left, right) => compareWinnerKeys(right.thinningKey, left.thinningKey))
    .slice(0, retainedCount);
}
