import { FIELD_ALGORITHM } from "./field-constants.mjs";

function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const STORAGE_EXTENT = Object.freeze({ width: 641, height: 359 });
const OBJECT_PROBE_COUNT = 512;
const WORLD_PROBE_COUNT = 256;
const SPHERE_PROBE_COUNT = 256;

function coordinateForStorageCell(x, y) {
  return [
    -4 + x / (STORAGE_EXTENT.width - 1) * 8,
    0.37,
    -4 + y / (STORAGE_EXTENT.height - 1) * 8,
  ];
}

function createObjectProbes() {
  return Array.from({ length: OBJECT_PROBE_COUNT }, (_, index) => {
    if (index === 0) {
      return {
        id: "object-origin-warp-disabled-v1",
        domain: "object",
        coordinate: [0, 0, 0],
        seed: FIELD_ALGORITHM.defaultSeed,
        storageCell: null,
      };
    }
    // Both multipliers are coprime with their respective odd extents. The
    // remaining 511 pairs are therefore unique and spatially distributed.
    const storageIndex = index - 1;
    const x = (19 + storageIndex * 73) % STORAGE_EXTENT.width;
    const y = (7 + storageIndex * 151) % STORAGE_EXTENT.height;
    return {
      id: `object-storage-${String(index).padStart(4, "0")}`,
      domain: "object",
      coordinate: coordinateForStorageCell(x, y),
      seed: FIELD_ALGORITHM.defaultSeed,
      storageCell: { x, y },
    };
  });
}

function createWorldProbes() {
  return Array.from({ length: WORLD_PROBE_COUNT }, (_, index) => {
    if (index === 0) {
      return {
        id: "world-origin-warp-disabled-v1",
        domain: "world",
        coordinate: [0, 0, 0],
        seed: FIELD_ALGORITHM.defaultSeed,
      };
    }
    const generatedIndex = index - 1;
    return {
      id: `world-${String(generatedIndex).padStart(4, "0")}`,
      domain: "world",
      coordinate: [
        -48.03125 + ((generatedIndex * 37 + 11) % 509) * (96 / 508),
        -12.015625 + ((generatedIndex * 83 + 17) % 503) * (24 / 502),
        -63.0078125 + ((generatedIndex * 149 + 23) % 499) * (126 / 498),
      ],
      seed: (29 + Math.imul(generatedIndex, 0x6d2b79f5)) >>> 0,
    };
  });
}

function createSphereProbes() {
  return Array.from({ length: SPHERE_PROBE_COUNT }, (_, index) => {
    const radius = 0.73 + (index % 17) * 0.19;
    const direction = [
      -0.93 + ((index * 41 + 5) % 251) * (1.86 / 250),
      -0.87 + ((index * 97 + 13) % 241) * (1.74 / 240),
      0.31 + ((index * 157 + 29) % 239) * (1.38 / 238),
    ];
    return {
      id: `sphere-${String(index).padStart(4, "0")}`,
      domain: "sphere",
      coordinate: direction.map((component) => component * radius),
      seed: (17 + Math.imul(index, 0x9e3779b9)) >>> 0,
    };
  });
}

export const FIELD_PROBE_CORPUS = deepFreeze({
  schemaVersion: 1,
  id: "field-probe-corpus-v1",
  generator: "checked-in modular coordinates; no random state",
  storageExtent: STORAGE_EXTENT,
  expectedSha256: "c90ce2f8431dd703b06984344c2a15147d93a458784c65dc0841312184392977",
  expectedCpuOracleSha256: "748c46f69b115933b60f53b7d9728fe887eb4c7b2effbb76860ec34d6b808380",
  oracleRuntime: "node-22.22.0",
  oracleArithmetic: "explicit-wgsl-f32-operation-mirror-v1",
  probes: [
    ...createObjectProbes(),
    ...createWorldProbes(),
    ...createSphereProbes(),
  ],
});

export const FIELD_PROBE_CORPUS_COUNTS = deepFreeze({
  object: OBJECT_PROBE_COUNT,
  world: WORLD_PROBE_COUNT,
  sphere: SPHERE_PROBE_COUNT,
  total: OBJECT_PROBE_COUNT + WORLD_PROBE_COUNT + SPHERE_PROBE_COUNT,
});

export function canonicalProbeCorpusPayload(corpus = FIELD_PROBE_CORPUS) {
  return {
    schemaVersion: corpus.schemaVersion,
    id: corpus.id,
    generator: corpus.generator,
    storageExtent: corpus.storageExtent,
    probes: corpus.probes,
  };
}

export function validateFieldProbeOracleIdentity({
  nodeVersion,
  inputSha256,
  cpuOracleSha256,
  corpus = FIELD_PROBE_CORPUS,
}) {
  if (`node-${nodeVersion}` !== corpus.oracleRuntime) {
    throw new Error(`field probe oracle requires ${corpus.oracleRuntime}; received node-${nodeVersion}`);
  }
  if (inputSha256 !== corpus.expectedSha256) {
    throw new Error("field probe corpus input hash drifted");
  }
  if (cpuOracleSha256 !== corpus.expectedCpuOracleSha256) {
    throw new Error("field f32 CPU oracle hash drifted");
  }
  if (corpus.oracleArithmetic !== "explicit-wgsl-f32-operation-mirror-v1") {
    throw new Error("field probe corpus named an unsupported arithmetic oracle");
  }
  return Object.freeze({
    nodeVersion,
    inputSha256,
    cpuOracleSha256,
    arithmetic: corpus.oracleArithmetic,
  });
}

export function createStressProbeCorpus(seedXor = 0x9e3779b9) {
  if (!Number.isInteger(seedXor) || seedXor < 0 || seedXor > 0xffffffff) {
    throw new Error("seedXor must be a u32 integer");
  }
  return FIELD_PROBE_CORPUS.probes.map((probe) => Object.freeze({
    ...probe,
    id: `${probe.id}:stress`,
    seed: (probe.seed ^ seedXor) >>> 0,
  }));
}
