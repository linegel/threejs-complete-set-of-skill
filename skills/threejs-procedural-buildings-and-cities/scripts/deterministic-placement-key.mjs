const UINT32_MAX = 0xffffffff;
const textEncoder = new TextEncoder();

function canonicalString(value, label) {
  if (typeof value !== "string" || value.length === 0 || value !== value.normalize("NFC")) {
    throw new TypeError(`${label} must be a nonempty NFC string`);
  }
  return value;
}

function uint32(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > UINT32_MAX) {
    throw new TypeError(`${label} must be a uint32`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function finiteRank(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return Object.is(value, -0) ? 0 : value;
}

export function candidateTuple(candidate) {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new TypeError("candidate must be an object");
  }
  return Object.freeze([
    canonicalString(candidate.generatorSchemaVersion, "generatorSchemaVersion"),
    uint32(candidate.stableSeed, "stableSeed"),
    canonicalString(candidate.familyId, "familyId"),
    canonicalString(candidate.sourceCellId, "sourceCellId"),
    uint32(candidate.candidateOrdinal, "candidateOrdinal"),
  ]);
}

export function canonicalCandidateKey(candidate) {
  return JSON.stringify(candidateTuple(candidate));
}

export function placementId(candidate) {
  return `placement:${canonicalCandidateKey(candidate)}`;
}

function hash32(value) {
  let hash = 0x811c9dc5;
  for (const byte of textEncoder.encode(value)) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

export function randomLane01(candidate, lane) {
  const key = canonicalCandidateKey(candidate);
  return hash32(`${key}\u0000${uint32(lane, "lane")}`) / 0x100000000;
}

export function winnerKey(candidate, { priorityRank, scoreRank }) {
  return Object.freeze({
    priorityRank: finiteRank(priorityRank, "priorityRank"),
    scoreRank: finiteRank(scoreRank, "scoreRank"),
    candidateTuple: candidateTuple(candidate),
  });
}

function compareLane(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareWinnerKeys(left, right) {
  const duplicateIdentity = left.candidateTuple.every(
    (lane, index) => compareLane(lane, right.candidateTuple[index]) === 0,
  );
  if (duplicateIdentity) throw new Error("duplicate candidate identity");

  for (const [a, b] of [
    [left.priorityRank, right.priorityRank],
    [left.scoreRank, right.scoreRank],
    ...left.candidateTuple.map((lane, index) => [lane, right.candidateTuple[index]]),
  ]) {
    const order = compareLane(a, b);
    if (order !== 0) return order;
  }
  return 0;
}
