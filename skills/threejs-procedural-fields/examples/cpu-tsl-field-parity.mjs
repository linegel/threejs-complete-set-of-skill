import {
  bitcast,
  clamp,
  float,
  floor,
  int,
  uint,
} from "three/tsl";

// Largest positive i32 exactly representable by f32. Reject coordinates outside
// this interval before conversion; the clamped path is only a defined sentinel.
const I32_F32_MIN = -2147483648;
const I32_F32_MAX = 2147483520;
// Shift before float conversion: every retained integer and scaled value is exact.
const U24_TO_UNIT_F32 = 1 / 16777216;

const HASH = Object.freeze({
  lattice: Object.freeze([0x8da6b343, 0xd8163841, 0xcb1ab31f]),
  seed: 0x9e3779b9,
  mix: Object.freeze([0x21f0aaad, 0x735a2d97]),
});

function mixU32CPU(value) {
  let h = value >>> 0;
  h = Math.imul(h ^ (h >>> 16), HASH.mix[0]) >>> 0;
  h = Math.imul(h ^ (h >>> 15), HASH.mix[1]) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

export function sampleLatticeCPU(coordinate, seed) {
  if (
    !Array.isArray(coordinate) ||
    coordinate.length !== 3 ||
    [0, 1, 2].some((index) => !Object.hasOwn(coordinate, index) || !Number.isFinite(coordinate[index]))
  ) {
    throw new TypeError("coordinate must contain three finite values");
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError("seed must be a uint32 integer");
  }

  const cell = coordinate.map((value) => Math.floor(Math.fround(value)));
  const valid = cell.every(
    (value) => value >= I32_F32_MIN && value <= I32_F32_MAX,
  );
  if (!valid) {
    return Object.freeze({
      cell: Object.freeze(cell),
      valid: false,
      hash: null,
      value: null,
    });
  }

  const lane = cell.map((value) => (value | 0) >>> 0);
  const hash = mixU32CPU(
    Math.imul(lane[0], HASH.lattice[0]) ^
    Math.imul(lane[1], HASH.lattice[1]) ^
    Math.imul(lane[2], HASH.lattice[2]) ^
    Math.imul(seed, HASH.seed),
  );
  const value = (hash >>> 8) * U24_TO_UNIT_F32;
  return Object.freeze({ cell: Object.freeze(cell), valid: true, hash, value });
}

function mixU32Node(value) {
  let h = uint(value);
  h = h.bitXor(h.shiftRight(uint(16))).mul(uint(HASH.mix[0]));
  h = h.bitXor(h.shiftRight(uint(15))).mul(uint(HASH.mix[1]));
  return h.bitXor(h.shiftRight(uint(15)));
}

function gatedI32Bits(value) {
  return bitcast(
    int(clamp(value, float(I32_F32_MIN), float(I32_F32_MAX))),
    "uint",
  );
}

export function createLatticeParityBundle({ coordinate, seed, prefix = "field" }) {
  if (typeof prefix !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(prefix) || prefix.startsWith("__")) {
    throw new TypeError("prefix must be a nonreserved shader identifier prefix");
  }
  if (typeof seed === "number") {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      throw new RangeError("seed must be a uint32 integer or a u32 node");
    }
  } else if (seed?.isNode !== true) {
    throw new TypeError("seed must be a uint32 integer or a u32 node");
  }
  const cell = floor(coordinate).toVar(`${prefix}Cell`);
  const valid = cell.x.greaterThanEqual(I32_F32_MIN)
    .and(cell.x.lessThanEqual(I32_F32_MAX))
    .and(cell.y.greaterThanEqual(I32_F32_MIN))
    .and(cell.y.lessThanEqual(I32_F32_MAX))
    .and(cell.z.greaterThanEqual(I32_F32_MIN))
    .and(cell.z.lessThanEqual(I32_F32_MAX))
    .toVar(`${prefix}LatticeValid`);

  const hash = mixU32Node(
    gatedI32Bits(cell.x).mul(uint(HASH.lattice[0]))
      .bitXor(gatedI32Bits(cell.y).mul(uint(HASH.lattice[1])))
      .bitXor(gatedI32Bits(cell.z).mul(uint(HASH.lattice[2])))
      .bitXor(uint(seed).mul(uint(HASH.seed))),
  ).toVar(`${prefix}Hash`);
  const value = float(hash.shiftRight(uint(8))).mul(U24_TO_UNIT_F32).toVar(`${prefix}Value`);

  return Object.freeze({ cell, valid, hash, value });
}
