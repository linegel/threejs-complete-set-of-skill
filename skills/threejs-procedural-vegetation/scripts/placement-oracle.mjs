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
  tuple.forEach((word, index) => u32(word, `${label}[${index}]`));
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
  return values.map((value, index) => u32(value, `${label}[${index}]`));
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
  return Object.freeze({ priorityHashU32: hashTuple(tuple), tuple });
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

// Higher winner keys win. `conflicts(a, b)` must be symmetric.
export function maternII(candidates, conflicts) {
  candidates.forEach((candidate, index) =>
    assertWinnerKey(candidate.winnerKey, `candidates[${index}].winnerKey`));
  const accepted = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    let wins = true;
    for (let otherIndex = 0; otherIndex < candidates.length; otherIndex += 1) {
      if (index === otherIndex) continue;
      const other = candidates[otherIndex];
      if (compareTuples(candidate.winnerKey.tuple, other.winnerKey.tuple) === 0) {
        throw new Error("duplicate candidate tuple");
      }
      const forward = Boolean(conflicts(candidate, other));
      const reverse = Boolean(conflicts(other, candidate));
      if (forward !== reverse) throw new Error("conflicts(a, b) must be symmetric");
      if (forward && compareWinnerKeys(candidate.winnerKey, other.winnerKey) <= 0) {
        wins = false;
      }
    }
    if (wins) accepted.push(candidate);
  }
  return accepted.sort((left, right) =>
    compareWinnerKeys(right.winnerKey, left.winnerKey));
}

export function nestedLodPrefix(candidates, retainedCount) {
  if (!Number.isInteger(retainedCount) || retainedCount < 0) {
    throw new Error("retainedCount must be a non-negative integer");
  }
  candidates.forEach((candidate, index) =>
    assertWinnerKey(candidate.thinningKey, `candidates[${index}].thinningKey`));
  return [...candidates]
    .sort((left, right) =>
      compareWinnerKeys(right.thinningKey, left.thinningKey))
    .slice(0, retainedCount);
}
