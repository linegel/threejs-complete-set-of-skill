import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { float, uint, vec3 } from "three/tsl";
import sharp from "sharp";

import {
  CPU_FIELD_ALGORITHM,
  FIELD_ALGORITHM,
  FIELD_CHANNELS,
  FIELD_DERIVED_CHANNELS,
  FIELD_GRADIENT_CHANNELS,
  FIELD_F32_ORACLE_CONTRACT,
  FIELD_INTERFACE_V2,
  FIELD_PARITY_ERROR_MANIFEST,
  FIELD_PARITY_CHANNELS,
  TSL_FIELD_ALGORITHM,
  createFieldCauseBindings,
  createFieldNodeBundle,
  coverage,
  fixedProbes,
  gpuParityProbes,
  invalidFieldProbes,
  sampleFieldCPU,
  sampleFieldF32CPU,
  sampleFieldV2CPU,
  tangentWarp,
  validateWarpFreeFieldNodeBundle,
} from "./field-bundle.mjs";
import {
  FIELD_ALGORITHM as SHARED_FIELD_ALGORITHM,
  FIELD_PARITY_THRESHOLD_ROLES,
} from "./field-constants.mjs";
import {
  buildDirtyDispatchTrace,
  compareFieldStorageMutation,
  createDirtyTileTracker,
  createFieldBakeComputeNode,
  createFieldBakePlan,
  createFieldBakeResources,
  createFieldProbeComputeNode,
  createFieldProbeResources,
  createFieldResourceLedger,
  createStructuredPlacementComputeNode,
  createStructuredPlacementResources,
  decideBakeStrategy,
  estimateFieldPathCosts,
  fieldMipExtents,
  propagateDirtyRegion,
  STORAGE_FORMATS,
  validateFieldDispatchTrace,
  validateFieldResourceLedger,
} from "./field-bake.mjs";
import {
  FIELD_PROBE_CORPUS,
  FIELD_PROBE_CORPUS_COUNTS,
  canonicalProbeCorpusPayload,
  createStressProbeCorpus,
  validateFieldProbeOracleIdentity,
} from "./field-probe-corpus.mjs";
import {
  FIELD_MECHANISM_IDS,
  analyzeFieldMechanismRgba,
  validateReportedFieldMechanismStatistics,
  validateFieldMechanismStatistics,
} from "./mechanism-evidence.mjs";
import {
  CAPTURE_PROFILES,
  DEFAULT_ARTIFACT_DIR,
  parseCaptureArgs,
} from "./capture.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(here, "../../assets/generated-variants/manifest.json");
const manifestDir = dirname(manifestPath);
const fixturePath = resolve(here, "field-golden-fixtures.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const fixtures = JSON.parse(readFileSync(fixturePath, "utf8"));
const fixtureTolerance = 1e-12;

const directF32Contract = FIELD_PARITY_ERROR_MANIFEST.directF32;
const gpuParityTolerances = directF32Contract.absoluteChannelGates;
const placementMaskContract = directF32Contract.thresholdConsumers.placementMask;
const placementMaskThreshold = placementMaskContract.threshold;

function validateToolchainAndF32Oracle() {
  assert.equal(
    process.versions.node,
    FIELD_F32_ORACLE_CONTRACT.nodeRuntime,
    "field f32 oracle must run under the pinned Node runtime",
  );
  assert.equal(FIELD_PROBE_CORPUS.oracleRuntime, `node-${process.versions.node}`);
  assert.equal(FIELD_PROBE_CORPUS.oracleArithmetic, FIELD_F32_ORACLE_CONTRACT.id);
  return {
    pass: true,
    node: process.versions.node,
    oracle: FIELD_F32_ORACLE_CONTRACT,
  };
}

function parseArgs(argv) {
  const options = {
    allowMissingGpu: false,
    artifacts: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--allow-missing-gpu") options.allowMissingGpu = true;
    else if (arg === "--artifacts") options.artifacts = resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function pngDimensions(path) {
  const bytes = readFileSync(path);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

function validateManifest() {
  assert.equal(manifest.colorSpace, "NoColorSpace");
  assert.deepEqual(manifest.channelMeanings, FIELD_CHANNELS);
  for (const channel of Object.values(FIELD_CHANNELS)) {
    assert.equal(typeof manifest.coverage[channel]?.min, "number", `${channel} coverage min`);
    assert.equal(typeof manifest.coverage[channel]?.max, "number", `${channel} coverage max`);
    assert(
      manifest.coverage[channel].min <= manifest.coverage[channel].max,
      `${channel} coverage min must be <= max`,
    );
  }
  const contracts = [];
  for (const asset of manifest.assets) {
    const path = resolve(manifestDir, asset.path);
    assert.equal(statSync(path).size, asset.byteLength, asset.id);
    assert.equal(sha256(path), asset.sha256, asset.id);
    assert.deepEqual(pngDimensions(path), {
      width: asset.width,
      height: asset.height,
    });
    assert.equal(asset.colorSpace, "NoColorSpace");
    assert(Number.isInteger(asset.seed) && asset.seed >= 0 && asset.seed <= 0xffffffff);
    assert.equal(asset.channels, 4);
    const mipExtents = fieldMipExtents(asset.width, asset.height);
    contracts.push({
      id: asset.id,
      seed: asset.seed,
      sourceByteLength: asset.byteLength,
      sourceSha256: asset.sha256,
      decodedBaseBytes: asset.width * asset.height * asset.channels,
      decodedMipChainBytes: mipExtents.reduce(
        (sum, extent) => sum + extent.width * extent.height * asset.channels,
        0,
      ),
      mipLevelCount: mipExtents.length,
      mipExtents,
    });
  }
  assert.equal(new Set(contracts.map(({ seed }) => seed)).size, contracts.length);
  return Object.freeze({
    pass: true,
    manifestId: manifest.id,
    manifestVersion: manifest.version,
    selection: "exact-seed-identity; modulo aliasing forbidden",
    assets: Object.freeze(contracts),
  });
}

function validateBakePlanning() {
  const model = ({ inlineInvocations, localInvocations, reuseFrames, consumerInvocations }) => ({
    inline: { invocationCount: inlineInvocations, costPerInvocation: 5 },
    localBundle: {
      invocationCount: localInvocations,
      costPerInvocation: 5,
      materializationCost: 1,
    },
    bake: {
      invocationCount: 64,
      evaluationCostPerInvocation: 5,
      writeCostPerInvocation: 1,
      dispatchCost: 10,
      mipCost: 20,
      reuseFrames,
      costUnit: "fixture-cost-unit",
    },
    consumers: [{
      invocationCount: consumerInvocations,
      sampleCostPerInvocation: 0.2,
      bytesPerInvocation: 8,
      effectiveBandwidthBytesPerCostUnit: 64,
    }],
  });

  const directModel = model({
    inlineInvocations: 1,
    localInvocations: 1,
    reuseFrames: 1,
    consumerInvocations: 1,
  });
  const localModel = model({
    inlineInvocations: 4,
    localInvocations: 1,
    reuseFrames: 1,
    consumerInvocations: 4,
  });
  const storageModel = model({
    inlineInvocations: 40,
    localInvocations: 10,
    reuseFrames: 100,
    consumerInvocations: 40,
  });

  assert.equal(decideBakeStrategy({ costModel: directModel }).strategy, "direct-evaluate");
  assert.equal(decideBakeStrategy({ costModel: localModel }).strategy, "local-bundle");
  assert.equal(decideBakeStrategy({ costModel: storageModel }).strategy, "StorageTexture");
  const storageCosts = estimateFieldPathCosts(storageModel);
  assert(storageCosts.costs.StorageTexture < storageCosts.costs["local-bundle"]);

  const tracker = createDirtyTileTracker({ tilesX: 8, tilesY: 8 });
  tracker.invalidate(3, 4);
  assert.deepEqual(tracker.allTiles(), ["3:4"]);
  const bakePlan = createFieldBakePlan({
    costModel: storageModel,
    dirtyTile: tracker.allTiles(),
  });
  assert.equal(bakePlan.strategy, "StorageTexture");
  assert.equal(bakePlan.api, "renderer.compute");
  assert.equal(bakePlan.texture.colorSpace, "");
  assert.equal(bakePlan.texture.generateMipmaps, true);
  assert.equal(bakePlan.texture.mipmapsAutoUpdate, true);
  assert.equal(bakePlan.texture.format, STORAGE_FORMATS.smoothRgba.format);
  assert.equal(bakePlan.texture.type, STORAGE_FORMATS.smoothRgba.type);
  assert.match(bakePlan.mipPolicy, /auto-generate/);

  const oddExtents = fieldMipExtents(641, 359);
  assert.deepEqual(oddExtents[0], { width: 641, height: 359 });
  assert.deepEqual(oddExtents.at(-1), { width: 1, height: 1 });
  const dirtyRegions = propagateDirtyRegion(
    { x: 3, y: 5, width: 17, height: 13 },
    oddExtents,
  );
  assert.deepEqual(dirtyRegions[1], { x: 1, y: 2, width: 9, height: 7 });
  const dirtyTrace = buildDirtyDispatchTrace(
    { x: 3, y: 5, width: 17, height: 13 },
    oddExtents,
  );
  let dirtyCells = new Set();
  for (let y = 5; y < 18; y += 1) {
    for (let x = 3; x < 20; x += 1) dirtyCells.add(`${x}:${y}`);
  }
  for (let level = 1; level < dirtyTrace.length; level += 1) {
    dirtyCells = new Set(Array.from(dirtyCells, (cell) => {
      const [x, y] = cell.split(":").map(Number);
      return `${Math.floor(x / 2)}:${Math.floor(y / 2)}`;
    }));
    const cells = Array.from(dirtyCells, (cell) => cell.split(":").map(Number));
    const xs = cells.map(([x]) => x);
    const ys = cells.map(([, y]) => y);
    const independentRegion = {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs) + 1,
      height: Math.max(...ys) - Math.min(...ys) + 1,
    };
    assert.deepEqual(
      dirtyTrace[level].outputRegion,
      independentRegion,
      `dirty mip ${level} must contain exactly the dependent texels`,
    );
    assert.equal(
      dirtyTrace[level].invocationCount,
      independentRegion.width * independentRegion.height,
      `dirty mip ${level} dispatch size`,
    );
  }
  assert(
    dirtyTrace[1].invocationCount < oddExtents[1].width * oddExtents[1].height,
    "dirty mip dispatch must not expand to the full dependent level",
  );

  const resources = createFieldBakeResources(641, 359);
  const baseNode = createFieldBakeComputeNode({
    resources,
    region: { x: 0, y: 0, width: 641, height: 359 },
  });
  assert(baseNode.isComputeNode, "real field bake must construct a ComputeNode");
  assert.equal(resources.packedMipTextures.length, oddExtents.length);
  assert(resources.resourceBytes.packedMipChain > 641 * 359 * 8);
  const placement = createStructuredPlacementResources({ columns: 64, rows: 64 });
  const placementNode = createStructuredPlacementComputeNode({ placement });
  assert(placementNode.isComputeNode, "structured placement must construct a ComputeNode");
  assert(placement.acceptedCount > 0, "structured placement must retain accepted cells");
  assert(placement.rejectedCount > 0, "structured placement corpus must exercise rejection");
  assert.equal(placement.acceptedCount + placement.rejectedCount, placement.cellCount);
  assert.equal(placement.records.count, placement.acceptedCount);
  assert.equal(placement.acceptedIndices.count, placement.acceptedCount);
  assert.equal(
    placement.bytes,
    placement.acceptedCount * (4 * Float32Array.BYTES_PER_ELEMENT + Uint32Array.BYTES_PER_ELEMENT),
  );
  assert(
    placement.acceptedCellIndices.every((cellIndex, index, indices) => (
      index === 0 || cellIndex > indices[index - 1]
    )),
    "accepted placement index list must be deterministic and strictly ordered",
  );
  for (const texture of resources.packedMipTextures) texture.dispose();
  resources.derivedTexture.dispose();
  resources.gradientTexture.dispose();
  placement.records.dispose?.();
  placement.acceptedIndices.dispose?.();
}

function validateSharedAlgorithm() {
  assert.equal(CPU_FIELD_ALGORITHM, SHARED_FIELD_ALGORITHM, "CPU constants must be the shared object");
  assert.equal(TSL_FIELD_ALGORITHM, SHARED_FIELD_ALGORITHM, "TSL constants must be the shared object");
  assert.equal(FIELD_ALGORITHM, SHARED_FIELD_ALGORITHM, "field bundle must re-export shared constants");
  assert.deepEqual(CPU_FIELD_ALGORITHM, TSL_FIELD_ALGORITHM, "CPU and TSL constants must be identical");
  assert.deepEqual(Object.keys(FIELD_CHANNELS), ["r", "g", "b", "a"]);
  assert.deepEqual(Object.keys(FIELD_DERIVED_CHANNELS), ["r", "g", "b", "a"]);
  assert.deepEqual(Object.keys(FIELD_GRADIENT_CHANNELS), ["r", "g", "b", "a"]);

  const thresholdProbes = Object.fromEntries(
    Object.entries(FIELD_PARITY_THRESHOLD_ROLES).map(([position, role]) => {
      const matches = gpuParityProbes.filter((probe) => probe.role === role);
      assert.equal(matches.length, 1, `${role} must identify exactly one GPU parity probe`);
      assert.match(matches[0].id, /^placement-mask-threshold-[a-z]+-v\d+$/);
      return [position, matches[0]];
    }),
  );
  assert.equal(
    new Set(Object.values(thresholdProbes).map((probe) => probe.id)).size,
    Object.keys(FIELD_PARITY_THRESHOLD_ROLES).length,
    "threshold probe IDs must be unique",
  );
  const thresholdSamples = Object.fromEntries(
    Object.entries(thresholdProbes).map(([position, probe]) => [
      position,
      sampleFieldCPU(probe).placementMask,
    ]),
  );
  assert(
    Math.abs(thresholdSamples.center - placementMaskThreshold) <=
      placementMaskContract.outputGuardBand,
    "center threshold probe must remain inside the output guard band",
  );
  assert(
    thresholdSamples.lower < placementMaskThreshold - placementMaskContract.outputGuardBand,
    "lower threshold probe must remain outside the guard band",
  );
  assert(
    thresholdSamples.upper > placementMaskThreshold + placementMaskContract.outputGuardBand,
    "upper threshold probe must remain outside the guard band",
  );

  let accepted = 0;
  let rejected = 0;
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      const sample = sampleFieldCPU({
        domain: "object",
        coordinate: [-4 + x * (8 / 63), 0.37, -4 + y * (8 / 63)],
        seed: FIELD_ALGORITHM.defaultSeed,
      });
      if (sample.placementMask >= placementMaskThreshold) accepted += 1;
      else rejected += 1;
    }
  }
  assert(accepted > 0, "structured placement fixture must contain accepted cells");
  assert(rejected > 0, "structured placement fixture must contain rejected cells");
  for (const probe of invalidFieldProbes) {
    assert.throws(() => sampleFieldCPU(probe), /f32 phase gate/);
  }
}

function validateV2InterfaceAndProbeCorpus() {
  assert.deepEqual(FIELD_INTERFACE_V2, {
    schemaVersion: 2,
    valueChannel: "macroHeight",
    gradientChannel: "macroGradient",
    gradientDomain: "declared input coordinate domain",
    causeOwner: "createFieldNodeBundle",
  });
  const nodeBundle = createFieldNodeBundle({
    coordinate: vec3(0.31, 0.47, 0.83),
    seed: uint(17),
    warpEnabled: false,
    varPrefix: "v2ContractProbe",
  });
  assert.equal(validateWarpFreeFieldNodeBundle(nodeBundle), nodeBundle);
  const causeBindings = createFieldCauseBindings(nodeBundle);
  assert.equal(causeBindings.displacement.height, nodeBundle.macroHeight);
  assert.equal(causeBindings.material.height, nodeBundle.macroHeight);
  assert.equal(causeBindings.material.roughness, nodeBundle.roughness);
  assert.equal(causeBindings.placement.mask, nodeBundle.placementMask);
  assert.equal(causeBindings.diagnostics.gradient, nodeBundle.macroGradient);
  const corpusHash = createHash("sha256")
    .update(JSON.stringify(canonicalProbeCorpusPayload()))
    .digest("hex");
  assert.equal(corpusHash, FIELD_PROBE_CORPUS.expectedSha256, "fixed probe corpus input hash");
  assert.equal(FIELD_PROBE_CORPUS.probes.length, FIELD_PROBE_CORPUS_COUNTS.total);
  assert.deepEqual(FIELD_PROBE_CORPUS_COUNTS, {
    object: 512,
    world: 256,
    sphere: 256,
    total: 1024,
  });
  assert.equal(
    new Set(FIELD_PROBE_CORPUS.probes.map(({ id }) => id)).size,
    FIELD_PROBE_CORPUS_COUNTS.total,
    "fixed probe IDs must be unique",
  );
  assert.equal(
    new Set(FIELD_PROBE_CORPUS.probes
      .filter(({ domain, storageCell }) => domain === "object" && storageCell)
      .map(({ storageCell }) => `${storageCell.x}:${storageCell.y}`)).size,
    FIELD_PROBE_CORPUS_COUNTS.object - 1,
    "object probes must address unique storage texels",
  );

  const oracleRows = [];
  const coverageByDomain = new Map();
  for (const probe of FIELD_PROBE_CORPUS.probes) {
    const v2 = sampleFieldV2CPU(probe);
    const f32Sample = sampleFieldF32CPU(probe);
    assert.equal(v2.schemaVersion, 2);
    assert.equal(v2.value, v2.sample.macroHeight);
    assert.deepEqual(v2.gradient, v2.sample.macroGradient);
    assert.equal(v2.causes.slope, v2.sample.slope);
    assert.equal(v2.causes.placementMask, v2.sample.placementMask);
    for (const value of [v2.value, ...v2.gradient, ...Object.values(v2.causes)]) {
      assert(Number.isFinite(value), `${probe.id} v2 field output must be finite`);
    }
    for (const value of FIELD_PARITY_CHANNELS.map((channel) => f32Sample[channel])) {
      assert(Number.isFinite(value), `${probe.id} f32 field output must be finite`);
    }
    if (probe.id.endsWith("origin-warp-disabled-v1")) {
      assert.equal(f32Sample.warpMode, "disabled");
      assert.deepEqual(f32Sample.tangentWarp, [0, 0, 0]);
      assert.deepEqual(f32Sample.warpJacobian, [[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
    }
    const domainCoverage = coverageByDomain.get(probe.domain) ?? { accepted: 0, rejected: 0 };
    if (v2.causes.placementMask >= placementMaskThreshold) domainCoverage.accepted += 1;
    else domainCoverage.rejected += 1;
    coverageByDomain.set(probe.domain, domainCoverage);
    oracleRows.push([
      probe.id,
      ...FIELD_PARITY_CHANNELS.map((channel) => f32Sample[channel]),
    ]);
  }
  const cpuOracleSha256 = createHash("sha256")
    .update(JSON.stringify(oracleRows))
    .digest("hex");
  assert.equal(
    cpuOracleSha256,
    FIELD_PROBE_CORPUS.expectedCpuOracleSha256,
    "1,024-probe CPU oracle hash drift",
  );
  const oracleIdentity = validateFieldProbeOracleIdentity({
    nodeVersion: process.versions.node,
    inputSha256: corpusHash,
    cpuOracleSha256,
  });
  assert(coverageByDomain.get("object").accepted > 0);
  assert(coverageByDomain.get("object").rejected > 0);

  const stress = createStressProbeCorpus();
  assert.equal(stress.length, FIELD_PROBE_CORPUS_COUNTS.total);
  assert(stress.every((probe, index) => (
    probe.seed !== FIELD_PROBE_CORPUS.probes[index].seed &&
    probe.domain === FIELD_PROBE_CORPUS.probes[index].domain &&
    JSON.stringify(probe.coordinate) === JSON.stringify(FIELD_PROBE_CORPUS.probes[index].coordinate)
  )));

  const probePartitions = [
    FIELD_PROBE_CORPUS.probes.filter(({ domain }) => domain !== "sphere"),
    FIELD_PROBE_CORPUS.probes.filter(({ domain }) => domain === "sphere"),
  ].map((probes) => createFieldProbeResources(probes));
  assert.deepEqual(probePartitions.map(({ warpMode }) => warpMode), ["disabled", "tangential"]);
  for (const resources of probePartitions) {
    assert.equal(resources.attributes.length, 8, "each probe kernel must fit the eight-storage-buffer gate");
    assert(createFieldProbeComputeNode(resources).isComputeNode);
  }
  const probeResourceBytes = probePartitions.reduce((sum, resources) => sum + resources.bytes, 0);
  assert.equal(
    probePartitions.reduce((sum, resources) => sum + resources.inputBytes, 0),
    FIELD_PROBE_CORPUS_COUNTS.total * 80,
  );
  assert.equal(
    probePartitions.reduce((sum, resources) => sum + resources.outputBytes, 0),
    FIELD_PROBE_CORPUS_COUNTS.total * 48,
  );
  assert.equal(probeResourceBytes, FIELD_PROBE_CORPUS_COUNTS.total * 128);
  for (const resources of probePartitions) {
    for (const attribute of resources.attributes) attribute.dispose?.();
  }

  const resources = createFieldBakeResources(641, 359);
  const placement = createStructuredPlacementResources({ columns: 64, rows: 64 });
  const resourceLedger = createFieldResourceLedger(resources, placement);
  assert.equal(validateFieldResourceLedger(resourceLedger), resourceLedger);
  assert.equal(
    resourceLedger.totalBytes,
    Object.values(resources.resourceBytes).reduce((sum, bytes) => sum + bytes, 0) + placement.bytes,
  );
  const region = { x: 71, y: 43, width: 257, height: 181 };
  const dispatchTrace = buildDirtyDispatchTrace(region, resources.mipExtents);
  assert.equal(validateFieldDispatchTrace(dispatchTrace, region, resources.mipExtents), dispatchTrace);
  for (const entry of dispatchTrace) {
    assert.deepEqual(entry.workgroupSize, [64, 1, 1]);
    assert.deepEqual(entry.workgroupCount, [Math.ceil(entry.invocationCount / 64), 1, 1]);
  }
  for (const texture of resources.packedMipTextures) texture.dispose();
  resources.derivedTexture.dispose();
  resources.gradientTexture.dispose();
  placement.records.dispose?.();
  placement.acceptedIndices.dispose?.();

  return {
    pass: true,
    corpusId: FIELD_PROBE_CORPUS.id,
    corpusHash,
    cpuOracleSha256,
    oracleIdentity,
    counts: FIELD_PROBE_CORPUS_COUNTS,
    coverageByDomain: Object.fromEntries(coverageByDomain),
    probeResourceBytes,
    fieldResourceBytes: resourceLedger.totalBytes,
    dirtyDispatchCount: dispatchTrace.length,
    dirtyInvocationCount: dispatchTrace.reduce((sum, entry) => sum + entry.invocationCount, 0),
  };
}

function validateAnalyticGradient() {
  const epsilon = 1e-5;
  const maxErrorGate = 2e-4;
  const tangentGate = 2e-10;
  const scaleInvarianceGate = 2e-10;
  const maxGradientErrorByDomain = { object: 0, world: 0, sphere: 0 };
  let maxWarpJacobianError = 0;
  let maxSphereRadialGradient = 0;
  let maxSphereWarpRadialComponent = 0;
  let maxSphereScaleHeightError = 0;
  let maxSphereScaleGradientError = 0;

  const finiteDifferenceGradient = (probe) => [0, 1, 2].map((axis) => {
    const positive = { ...probe, coordinate: [...probe.coordinate] };
    const negative = { ...probe, coordinate: [...probe.coordinate] };
    positive.coordinate[axis] += epsilon;
    negative.coordinate[axis] -= epsilon;
    return (
      sampleFieldCPU(positive).macroHeight - sampleFieldCPU(negative).macroHeight
    ) / (2 * epsilon);
  });

  const validateProbeGradient = (probe) => {
    const sample = sampleFieldCPU(probe);
    const finiteDifference = finiteDifferenceGradient(probe);
    for (let axis = 0; axis < 3; axis += 1) {
      maxGradientErrorByDomain[probe.domain] = Math.max(
        maxGradientErrorByDomain[probe.domain],
        Math.abs(finiteDifference[axis] - sample.macroGradient[axis]),
      );
    }
    const expectedSlope = Math.min(
      1,
      Math.hypot(...sample.macroGradient) * FIELD_ALGORITHM.derived.slopeScale,
    );
    assertClose(sample.slope, expectedSlope, 1e-14, `${probe.domain} derivative-derived slope`);
    return sample;
  };

  for (let probeIndex = 0; probeIndex < 96; probeIndex += 1) {
    const coordinate = [
      0.213 + probeIndex * 0.0173,
      0.417 - probeIndex * 0.0021,
      0.319 + probeIndex * 0.0067,
    ];
    validateProbeGradient({ domain: "object", coordinate, seed: 17 });
    validateProbeGradient({
      domain: "world",
      coordinate: [
        5.31 + probeIndex * 0.137,
        -3.17 + probeIndex * 0.043,
        8.09 - probeIndex * 0.019,
      ],
      seed: 29,
    });

    const sphereRadius = 0.73 + (probeIndex % 13) * 0.29;
    const sphereCoordinate = [
      (coordinate[0] + 1) * sphereRadius,
      (coordinate[1] + 0.5) * sphereRadius,
      (coordinate[2] + 0.25) * sphereRadius,
    ];
    const sphereProbe = {
      domain: "sphere",
      coordinate: sphereCoordinate,
      seed: 17,
    };
    const sphereSample = validateProbeGradient(sphereProbe);
    const sphereLength = Math.hypot(...sphereCoordinate);
    const sphereRadial = sphereCoordinate.map((component) => component / sphereLength);
    maxSphereRadialGradient = Math.max(
      maxSphereRadialGradient,
      Math.abs(sphereSample.macroGradient.reduce(
        (sum, component, axis) => sum + component * sphereRadial[axis],
        0,
      )),
    );
    maxSphereWarpRadialComponent = Math.max(
      maxSphereWarpRadialComponent,
      Math.abs(sphereSample.tangentWarp.reduce(
        (sum, component, axis) => sum + component * sphereSample.sourceCoordinates[axis],
        0,
      )),
    );

    const scaleFactor = 1.7;
    const scaledSphereSample = sampleFieldCPU({
      ...sphereProbe,
      coordinate: sphereCoordinate.map((component) => component * scaleFactor),
    });
    maxSphereScaleHeightError = Math.max(
      maxSphereScaleHeightError,
      Math.abs(sphereSample.macroHeight - scaledSphereSample.macroHeight),
    );
    for (let axis = 0; axis < 3; axis += 1) {
      maxSphereScaleGradientError = Math.max(
        maxSphereScaleGradientError,
        Math.abs(
          sphereSample.macroGradient[axis] -
          scaledSphereSample.macroGradient[axis] * scaleFactor
        ),
      );
    }

    const stable = sphereSample.sourceCoordinates;
    const stableSphereSample = sampleFieldCPU({ domain: "sphere", coordinate: stable, seed: 17 });
    for (let axis = 0; axis < 3; axis += 1) {
      const positive = [...stable];
      const negative = [...stable];
      positive[axis] += epsilon;
      negative[axis] -= epsilon;
      const positiveWarp = tangentWarp(positive, 17);
      const negativeWarp = tangentWarp(negative, 17);
      for (let component = 0; component < 3; component += 1) {
        const finiteDifference = (positiveWarp[component] - negativeWarp[component]) / (2 * epsilon);
        maxWarpJacobianError = Math.max(
          maxWarpJacobianError,
          Math.abs(finiteDifference - stableSphereSample.warpJacobian[axis][component]),
        );
      }
    }
  }
  for (const [domain, error] of Object.entries(maxGradientErrorByDomain)) {
    assert(error <= maxErrorGate, `${domain} analytic gradient error ${error}`);
  }
  assert(maxWarpJacobianError <= maxErrorGate, `warp Jacobian error ${maxWarpJacobianError}`);
  assert(
    maxSphereRadialGradient <= tangentGate,
    `sphere gradient radial component ${maxSphereRadialGradient}`,
  );
  assert(
    maxSphereWarpRadialComponent <= tangentGate,
    `sphere warp radial component ${maxSphereWarpRadialComponent}`,
  );
  assert(
    maxSphereScaleHeightError <= scaleInvarianceGate,
    `sphere radial scale changed height by ${maxSphereScaleHeightError}`,
  );
  assert(
    maxSphereScaleGradientError <= scaleInvarianceGate,
    `sphere radial scale broke gradient law by ${maxSphereScaleGradientError}`,
  );
  return {
    pass: true,
    probeCountByDomain: { object: 96, world: 96, sphere: 96 },
    maxGradientErrorByDomain,
    maxWarpJacobianError,
    maxSphereRadialGradient,
    maxSphereWarpRadialComponent,
    maxSphereScaleHeightError,
    maxSphereScaleGradientError,
    maxErrorGate,
    tangentGate,
    scaleInvarianceGate,
  };
}

function assertClose(actual, expected, maxError, label) {
  const error = Math.abs(actual - expected);
  assert(
    error <= maxError,
    `${label}: ${actual} differs from ${expected} by ${error}, tolerance ${maxError}`,
  );
  return error;
}

function validateGoldenFixtures() {
  assert.equal(fixtures.version, 2);
  assert.deepEqual(fixtures.channels, FIELD_PARITY_CHANNELS);
  assert.deepEqual(
    fixtures.probes.map((entry) => entry.probe),
    fixedProbes,
    "golden fixture probes must match fixedProbes",
  );

  let maxAbsError = 0;
  const samples = fixtures.probes.map((entry, probeIndex) => {
    const sample = sampleFieldCPU(entry.probe);
    const channelErrors = {};
    for (const channel of fixtures.channels) {
      const error = assertClose(
        sample[channel],
        entry.values[channel],
        fixtureTolerance,
        `fixture probe ${probeIndex} ${channel}`,
      );
      channelErrors[channel] = error;
      maxAbsError = Math.max(maxAbsError, error);
    }
    return {
      probe: entry.probe,
      maxAbsError: Math.max(...Object.values(channelErrors)),
      channelErrors,
      macroHeight: sample.macroHeight,
      moisture: sample.moisture,
    };
  });

  return {
    pass: true,
    fixtureTolerance,
    maxAbsError,
    fixedProbes: samples.length,
    samples,
    coverage: {
      macroHeight: coverage(samples.map((sample) => sample.macroHeight)),
      moisture: coverage(samples.map((sample) => sample.moisture)),
    },
  };
}

function readGpuReadback(artifactDir) {
  const path = resolve(artifactDir, "field-readback.json");
  if (!existsSync(path)) {
    throw new Error(`GPU parity artifact missing: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function validateGpuReadback(artifactDir) {
  const readback = readGpuReadback(artifactDir);
  assert.equal(readback.version, 2);
  assert.equal(readback.contract?.classification, "canonical-lab");
  assert.equal(readback.contract?.path, "direct-wgsl-f32-plus-tier-specific-resources");
  assert.equal(readback.contract?.productionReady, false);
  assert.deepEqual(readback.contract?.artifactBundle, [
    "field-readback.json",
    "field-storage-readback.json",
    "field-placement-readback.json",
    "field-mechanism-diagnostics.json",
    "field-probe-corpus.json",
    "field-dirty-region.json",
  ]);
  assert.equal(readback.contract?.probeSet, "gpuParityProbes-v4-f32-origin-and-threshold-gradients");
  assert.equal(readback.contract?.seedRepresentation, "u32-uniform");
  assert.equal(readback.renderer?.isWebGPUBackend, true);
  assert.equal(readback.renderer?.threePackageVersion, "0.185.1");
  assert.equal(readback.renderer?.threeRevision, "185");
  assert.deepEqual(readback.channels, FIELD_PARITY_CHANNELS);
  assert(Array.isArray(readback.samples), "GPU readback samples must be an array");
  assert.deepEqual(
    readback.samples.map((entry) => entry.probe),
    gpuParityProbes,
    "GPU readback must cover the declared stress/threshold probe set",
  );

  let maxAbsError = 0;
  let meanAbsError = 0;
  let count = 0;
  let placementGuardBandSamples = 0;
  const channelMaxErrors = Object.fromEntries(FIELD_PARITY_CHANNELS.map((channel) => [channel, 0]));
  const samples = readback.samples.map((entry, index) => {
    assert(entry.probe, `GPU readback sample ${index} is missing probe`);
    assert(entry.values, `GPU readback sample ${index} is missing values`);
    const cpu = sampleFieldF32CPU(entry.probe);
    const channelErrors = {};
    for (const channel of FIELD_PARITY_CHANNELS) {
      const actual = Number(entry.values[channel]);
      assert(Number.isFinite(actual), `GPU readback sample ${index} ${channel} is not finite`);
      const error = Math.abs(actual - cpu[channel]);
      channelErrors[channel] = error;
      channelMaxErrors[channel] = Math.max(channelMaxErrors[channel], error);
      maxAbsError = Math.max(maxAbsError, error);
      meanAbsError += error;
      count += 1;
      const tolerance = gpuParityTolerances[channel];
      if (error > tolerance) {
        throw new Error(
          `GPU parity ${channel} sample ${index} absError ${error} exceeds tolerance ${tolerance}`,
        );
      }
      if (channel === "placementMask") {
        const actualBit = actual >= placementMaskThreshold;
        const expectedBit = cpu[channel] >= placementMaskThreshold;
        const inGuardBand =
          Math.abs(cpu[channel] - placementMaskThreshold) <= placementMaskContract.outputGuardBand;
        if (inGuardBand) placementGuardBandSamples += 1;
        assert(
          actualBit === expectedBit || inGuardBand,
          `placementMask threshold mismatch outside guard band at sample ${index}`,
        );
      }
    }
    return {
      probe: entry.probe,
      channelErrors,
      maxAbsError: Math.max(...Object.values(channelErrors)),
    };
  });

  meanAbsError = count === 0 ? 0 : meanAbsError / count;
  assert(placementGuardBandSamples >= 1, "GPU probes must exercise the placement guard band");
  return {
    pass: true,
    status: "passed",
    artifactDir,
    tolerances: gpuParityTolerances,
    errorContract: directF32Contract,
    maxAbsError,
    channelMaxErrors,
    meanAbsError,
    placementMaskThreshold,
    placementGuardBandSamples,
    samples,
  };
}

function validateStorageReadback(artifactDir) {
  const storagePath = resolve(artifactDir, "field-storage-readback.json");
  const placementPath = resolve(artifactDir, "field-placement-readback.json");
  assert(existsSync(storagePath), `storage artifact missing: ${storagePath}`);
  assert(existsSync(placementPath), `placement artifact missing: ${placementPath}`);
  const storageReadback = JSON.parse(readFileSync(storagePath, "utf8"));
  const placementReadback = JSON.parse(readFileSync(placementPath, "utf8"));

  const expectedSampleCoordinates = (width, height) => [
    [0, 0],
    [Math.floor(width / 2), Math.floor(height / 2)],
    [width - 1, height - 1],
  ];
  const expectedLayout = (length, width, height) => {
    const rowBytes = width * 8;
    const alignedRowBytes = Math.ceil(rowBytes / 256) * 256;
    const tightLength = width * height * 4;
    const paddedTailLength = (alignedRowBytes * Math.max(height - 1, 0) + rowBytes) / 2;
    const fullyPaddedLength = alignedRowBytes * height / 2;
    let encoding;
    let elementsPerRow;
    if (length === tightLength) {
      encoding = "tight";
      elementsPerRow = width * 4;
    } else if (length === paddedTailLength || length === fullyPaddedLength) {
      encoding = length === paddedTailLength ? "aligned-tail-tight" : "aligned-full";
      elementsPerRow = alignedRowBytes / 2;
    } else {
      throw new Error(
        `unexpected rgba16float readback length ${length} for ${width}x${height}`,
      );
    }
    return {
      encoding,
      rowBytes,
      alignedRowBytes,
      elementsPerRow,
      tightLength,
      paddedTailLength,
      fullyPaddedLength,
    };
  };
  const validateTextureReadback = (readback, width, height, label) => {
    assert.equal(readback.constructor, "Uint16Array", `${label} readback type`);
    assert.deepEqual(readback.layout, expectedLayout(readback.length, width, height), `${label} layout`);
    assert.deepEqual(
      readback.samples.map(({ x, y }) => [x, y]),
      expectedSampleCoordinates(width, height),
      `${label} sample coordinates`,
    );
    for (const [sampleIndex, sample] of readback.samples.entries()) {
      assert.equal(sample.value.length, 4, `${label} sample ${sampleIndex} lane count`);
      for (const value of sample.value) {
        assert(Number.isFinite(value), `${label} sample ${sampleIndex} must be finite`);
      }
    }
  };
  const coordinateForCell = (x, y, width, height) => [
    -4 + x / Math.max(width - 1, 1) * 8,
    0.37,
    -4 + y / Math.max(height - 1, 1) * 8,
  ];
  const f32GridCoordinate = (index, extent, minimum, range) => {
    const fraction = Math.fround(
      Math.fround(index) / Math.fround(Math.max(extent - 1, 1)),
    );
    return Math.fround(
      Math.fround(minimum) + Math.fround(fraction * Math.fround(range)),
    );
  };
  const coordinateForCellF32 = (x, y, width, height) => [
    f32GridCoordinate(x, width, -4, 8),
    Math.fround(0.37),
    f32GridCoordinate(y, height, -4, 8),
  ];
  const gridCoordinateF32Bound = (value) => (
    (Math.abs(-4) + Math.abs(8) + Math.abs(value)) * 2 ** -23
  );
  const halfRoundingBound = (value) => {
    const magnitude = Math.abs(value);
    assert(magnitude <= 65504, `rgba16float oracle value ${value} is outside the finite range`);
    if (magnitude < 2 ** -14) return 2 ** -25;
    return 2 ** (Math.floor(Math.log2(magnitude)) - 11);
  };
  const normalizedHalfBound = FIELD_PARITY_ERROR_MANIFEST.rgba16floatStorage
    .nearestRoundingBoundBelowOne;
  const mipArithmeticBoundPerLevel = 2 ** -19;
  const storageWidth = 641;
  const storageHeight = 359;
  const validateBaseSamples = ({ label, readback, channelNames, vectorForCpu, normalized }) => {
    let maxAbsError = 0;
    for (const sample of readback.samples) {
      const cpu = sampleFieldF32CPU({
        domain: "object",
        coordinate: coordinateForCell(sample.x, sample.y, storageWidth, storageHeight),
        seed: FIELD_ALGORITHM.defaultSeed,
      });
      const expected = vectorForCpu(cpu);
      assert.equal(expected.length, 4, `${label} CPU vector width`);
      for (let lane = 0; lane < 4; lane += 1) {
        const channel = channelNames[lane];
        const gate = gpuParityTolerances[channel] +
          (normalized ? normalizedHalfBound : halfRoundingBound(expected[lane]));
        const error = assertClose(
          sample.value[lane],
          expected[lane],
          gate,
          `${label} (${sample.x},${sample.y}) ${channel}`,
        );
        maxAbsError = Math.max(maxAbsError, error);
      }
    }
    return maxAbsError;
  };
  const buildPackedMipOracle = (width, height) => {
    const levels = [{
      width,
      height,
      values: Array.from({ length: width * height }, (_, index) => {
        const x = index % width;
        const y = Math.floor(index / width);
        const cpu = sampleFieldF32CPU({
          domain: "object",
          coordinate: coordinateForCell(x, y, width, height),
          seed: FIELD_ALGORITHM.defaultSeed,
        });
        return Object.values(cpu.packedChannels);
      }),
    }];
    while (levels.at(-1).width !== 1 || levels.at(-1).height !== 1) {
      const input = levels.at(-1);
      const widthNext = Math.max(1, Math.ceil(input.width / 2));
      const heightNext = Math.max(1, Math.ceil(input.height / 2));
      const at = (x, y) => input.values[
        Math.min(y, input.height - 1) * input.width + Math.min(x, input.width - 1)
      ];
      const values = Array.from({ length: widthNext * heightNext }, (_, index) => {
        const x = index % widthNext;
        const y = Math.floor(index / widthNext);
        const children = [at(2 * x, 2 * y), at(2 * x + 1, 2 * y), at(2 * x, 2 * y + 1), at(2 * x + 1, 2 * y + 1)];
        return [0, 1, 2, 3].map(
          (lane) => children.reduce((sum, child) => sum + child[lane], 0) * 0.25,
        );
      });
      levels.push({ width: widthNext, height: heightNext, values });
    }
    return levels;
  };

  assert.equal(storageReadback.schemaVersion, 2);
  assert.deepEqual(storageReadback.contract, {
    path: "rgba16float-storage-write-readback-with-explicit-box-mips",
    sampleCoverage: "three declared texels per resource",
    filteredConsumerValidated: false,
    filteredMipReadbackValidated: false,
    dirtyRegionExecutionValidated: false,
    performanceMeasured: false,
    productionReady: false,
  });
  assert.equal(storageReadback.renderer?.isWebGPUBackend, true);
  assert.equal(storageReadback.renderer?.threePackageVersion, "0.185.1");
  assert.equal(storageReadback.renderer?.threeRevision, "185");
  assert.deepEqual(storageReadback.extent, { width: storageWidth, height: storageHeight });
  validateTextureReadback(storageReadback.packed, storageWidth, storageHeight, "packed base");
  validateTextureReadback(storageReadback.derived, storageWidth, storageHeight, "derived base");
  validateTextureReadback(storageReadback.gradient, storageWidth, storageHeight, "gradient base");
  const expectedMipExtents = fieldMipExtents(storageWidth, storageHeight);
  assert.deepEqual(
    storageReadback.mipChain.map(({ extent }) => extent),
    expectedMipExtents,
    "every explicit mip must be read back",
  );
  const baseErrors = {
    packed: validateBaseSamples({
      label: "packed base",
      readback: storageReadback.packed,
      channelNames: Object.values(FIELD_CHANNELS),
      vectorForCpu: (cpu) => Object.values(cpu.packedChannels),
      normalized: true,
    }),
    derived: validateBaseSamples({
      label: "derived base",
      readback: storageReadback.derived,
      channelNames: Object.values(FIELD_DERIVED_CHANNELS),
      vectorForCpu: (cpu) => Object.values(cpu.derivedChannels),
      normalized: true,
    }),
    gradient: validateBaseSamples({
      label: "gradient base",
      readback: storageReadback.gradient,
      channelNames: Object.values(FIELD_GRADIENT_CHANNELS),
      vectorForCpu: (cpu) => Object.values(cpu.gradientChannels),
      normalized: false,
    }),
  };
  const centerCpu = sampleFieldF32CPU({
    domain: "object",
    coordinate: storageReadback.centerCpuReference.coordinate,
    seed: FIELD_ALGORITHM.defaultSeed,
  });
  for (const [label, expected, actual] of [
    ["packed", Object.values(centerCpu.packedChannels), storageReadback.centerCpuReference.packed],
    ["derived", Object.values(centerCpu.derivedChannels), storageReadback.centerCpuReference.derived],
    ["gradient", Object.values(centerCpu.gradientChannels), storageReadback.centerCpuReference.gradient],
  ]) {
    for (let lane = 0; lane < 4; lane += 1) {
      assertClose(actual[lane], expected[lane], fixtureTolerance, `${label} CPU reference lane ${lane}`);
    }
  }

  const mipOracle = buildPackedMipOracle(storageWidth, storageHeight);
  let mipMaxAbsError = 0;
  for (const [level, artifact] of storageReadback.mipChain.entries()) {
    const oracle = mipOracle[level];
    assert.equal(artifact.level, level, `mip ${level} index`);
    validateTextureReadback(artifact.readback, oracle.width, oracle.height, `packed mip ${level}`);
    const gate = Math.max(...Object.values(FIELD_CHANNELS).map(
      (channel) => gpuParityTolerances[channel],
    )) + (level + 1) * normalizedHalfBound + level * mipArithmeticBoundPerLevel;
    for (const sample of artifact.readback.samples) {
      const expected = oracle.values[sample.y * oracle.width + sample.x];
      for (let lane = 0; lane < 4; lane += 1) {
        const error = assertClose(
          sample.value[lane],
          expected[lane],
          gate,
          `packed mip ${level} (${sample.x},${sample.y}) lane ${lane}`,
        );
        mipMaxAbsError = Math.max(mipMaxAbsError, error);
      }
    }
  }

  const packedMipChainBytes = expectedMipExtents.reduce(
    (sum, extent) => sum + extent.width * extent.height * 8,
    0,
  );
  const baseTextureBytes = storageWidth * storageHeight * 8;
  assert.equal(storageReadback.resources.tier, "gpu-storage");
  assert.equal(storageReadback.resources.graph, "runtime-compute-storage-and-explicit-mips");
  assert.equal(storageReadback.resources.textures, expectedMipExtents.length + 2);
  assert.equal(storageReadback.resources.storageBuffers, 2);
  const completeLedger = storageReadback.resources.common.completeResourceLedger;
  validateFieldResourceLedger(completeLedger);
  const completeResourceIds = new Set(completeLedger.resources.map(({ id }) => id));
  for (const id of [
    "display-evidence-target",
    "raw-probe-target",
    "display-readback-request",
    "probe-readback-request",
    "probe-corpus-coordinates",
    "probe-corpus-gradient-output",
    "storage-readback-request",
  ]) assert(completeResourceIds.has(id), `complete resource ledger omitted ${id}`);
  assert(completeLedger.residentBytes > storageReadback.resources.bytes);
  assert(completeLedger.peakTransientBytes > 0);
  assert.equal(
    completeLedger.peakLabOwnedBytes,
    completeLedger.residentBytes + completeLedger.peakTransientBytes,
  );
  assert.deepEqual(storageReadback.resources.resourceBytes, {
    packedMipChain: packedMipChainBytes,
    derivedBase: baseTextureBytes,
    gradientBase: baseTextureBytes,
  });
  assert.deepEqual(
    storageReadback.resources.lastDispatchTrace.map(({ outputRegion }) => outputRegion),
    expectedMipExtents.map(({ width, height }) => ({ x: 0, y: 0, width, height })),
    "full storage initialization must dispatch every declared mip extent",
  );

  assert.equal(placementReadback.schemaVersion, 2);
  assert.deepEqual(placementReadback.contract, {
    path: "raw-gpu-vec4-lane-plus-separate-deterministic-cpu-index-list",
    artifactCoverage: "all-accepted-raw-gpu-records-plus-separate-index-identity",
    rawGpuLaneWMeaning: "authored-live-record-sentinel-one",
    cpuIndexIdentityStoredInGpuRecord: false,
    rejectedRecordsRetained: false,
    performanceMeasured: false,
    productionReady: false,
  });
  assert.equal(placementReadback.cellCount, 4096);
  assert.equal(placementReadback.rawGpuRecords.length, placementReadback.accepted);
  assert.equal(placementReadback.decodedRecords.length, placementReadback.accepted);
  assert.equal(placementReadback.acceptedIndices.length, placementReadback.accepted);
  assert.deepEqual(
    placementReadback.decodedRecords.map((record) => record.cpuAcceptedCellIndex),
    placementReadback.acceptedIndices,
    "CPU cell identity must remain separate from the raw GPU vec4 lanes",
  );
  assert(placementReadback.rawGpuRecords.every((record) => record[3] === 1));
  assert.equal(placementReadback.minRawGpuW, 1);
  assert.equal(placementReadback.maxRawGpuW, 1);
  const expectedAcceptedIndices = [];
  let expectedRejected = 0;
  let expectedMinAcceptedMask = 1;
  let expectedMaxAcceptedMask = 0;
  let placementMaxAbsError = 0;
  let minThresholdDistance = Infinity;
  for (let index = 0; index < placementReadback.cellCount; index += 1) {
    const x = index % 64;
    const y = Math.floor(index / 64);
    const coordinate = coordinateForCell(x, y, 64, 64);
    const expected = sampleFieldF32CPU({
      domain: "object",
      coordinate,
      seed: FIELD_ALGORITHM.defaultSeed,
    });
    const expectedFlag = expected.placementMask >= placementMaskThreshold ? 1 : 0;
    if (expectedFlag) expectedAcceptedIndices.push(index);
    else expectedRejected += 1;
    minThresholdDistance = Math.min(
      minThresholdDistance,
      Math.abs(expected.placementMask - placementMaskThreshold),
    );
  }
  assert.deepEqual(
    placementReadback.acceptedIndices,
    expectedAcceptedIndices,
    "compacted placement index list must contain exactly the accepted cells in deterministic order",
  );
  for (let outputIndex = 0; outputIndex < expectedAcceptedIndices.length; outputIndex += 1) {
    const cellIndex = expectedAcceptedIndices[outputIndex];
    const x = cellIndex % 64;
    const y = Math.floor(cellIndex / 64);
    const coordinate = coordinateForCell(x, y, 64, 64);
    const coordinateF32 = coordinateForCellF32(x, y, 64, 64);
    const expected = sampleFieldF32CPU({
      domain: "object",
      coordinate,
      seed: FIELD_ALGORITHM.defaultSeed,
    });
    const actual = placementReadback.rawGpuRecords[outputIndex];
    const decoded = placementReadback.decodedRecords[outputIndex];
    assert.equal(actual.length, 4, `placement record ${outputIndex} width`);
    // The coordinate path contains one division, multiply, and add. WGSL may
    // fuse/reassociate them. Bound the propagated input/range/output f32
    // rounding terms instead of using the much smaller ULP near a cancellation.
    assertClose(
      actual[0],
      coordinateF32[0],
      gridCoordinateF32Bound(coordinateF32[0]),
      `placement record ${outputIndex} x`,
    );
    assertClose(
      actual[1],
      coordinateF32[2],
      gridCoordinateF32Bound(coordinateF32[2]),
      `placement record ${outputIndex} z`,
    );
    const maskError = assertClose(
      actual[2],
      expected.placementMask,
      gpuParityTolerances.placementMask,
      `placement record ${outputIndex} mask`,
    );
    placementMaxAbsError = Math.max(placementMaxAbsError, maskError);
    assert.equal(actual[3], 1, `placement raw GPU record ${outputIndex} sentinel lane`);
    assert.equal(decoded.outputIndex, outputIndex);
    assert.equal(decoded.cpuAcceptedCellIndex, cellIndex);
    assert.deepEqual(decoded.gpu, actual);
    expectedMinAcceptedMask = Math.min(expectedMinAcceptedMask, expected.placementMask);
    expectedMaxAcceptedMask = Math.max(expectedMaxAcceptedMask, expected.placementMask);
  }
  assert(
    minThresholdDistance > gpuParityTolerances.placementMask,
    "placement fixture requires an explicit threshold guard if any cell enters the direct-f32 error gate",
  );
  assert.equal(placementReadback.accepted, expectedAcceptedIndices.length);
  assert.equal(placementReadback.rejected, expectedRejected);
  assert.equal(expectedAcceptedIndices.length + expectedRejected, placementReadback.cellCount);
  const expectedRecordBytes = expectedAcceptedIndices.length * 4 * Float32Array.BYTES_PER_ELEMENT;
  const expectedIndexBytes = expectedAcceptedIndices.length * Uint32Array.BYTES_PER_ELEMENT;
  assert.equal(placementReadback.recordBytes, expectedRecordBytes);
  assert.equal(placementReadback.indexBytes, expectedIndexBytes);
  assert.equal(placementReadback.storageBytes, expectedRecordBytes + expectedIndexBytes);
  assert.equal(storageReadback.resources.placementBytes, placementReadback.storageBytes);
  assert.equal(
    storageReadback.resources.bytes,
    packedMipChainBytes + 2 * baseTextureBytes + placementReadback.storageBytes,
  );
  assertClose(
    placementReadback.minAcceptedMask,
    expectedMinAcceptedMask,
    gpuParityTolerances.placementMask,
    "accepted placement minimum mask",
  );
  assertClose(
    placementReadback.maxAcceptedMask,
    expectedMaxAcceptedMask,
    gpuParityTolerances.placementMask,
    "accepted placement maximum mask",
  );
  return {
    pass: true,
    status: "passed",
    evidenceScope: {
      baseTexelsPerResource: 3,
      packedTexelsPerMip: 3,
      placementRecords: placementReadback.accepted,
      filteredConsumerValidated: false,
      dirtyRegionExecutionValidated: false,
      performanceMeasured: false,
    },
    baseErrors,
    mipMaxAbsError,
    placementMaxAbsError,
    normalizedHalfBound,
    mipArithmeticBoundPerLevel,
    mipLevels: expectedMipExtents.length,
    placement: {
      accepted: expectedAcceptedIndices.length,
      rejected: expectedRejected,
      minThresholdDistance,
    },
    resources: storageReadback.resources,
  };
}

function validateProbeCorpusReadback(artifactDir) {
  const artifactPath = resolve(artifactDir, "field-probe-corpus.json");
  assert(existsSync(artifactPath), `probe-corpus artifact missing: ${artifactPath}`);
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  assert.equal(artifact.schemaVersion, 2);
  assert.deepEqual(artifact.contract, {
    path: "storage-buffer-tsl-corpus-plus-rgba16float-direct-comparison",
    corpusId: FIELD_PROBE_CORPUS.id,
    corpusSha256: FIELD_PROBE_CORPUS.expectedSha256,
    sameSeedBitwiseStable: true,
    stressSeedHashDistinct: true,
    performanceMeasured: false,
    productionReady: false,
  });
  assert.equal(artifact.renderer?.threeRevision, "185");
  assert.equal(artifact.renderer?.threePackageVersion, "0.185.1");
  assert.equal(artifact.renderer?.isWebGPUBackend, true);
  assert(artifact.renderer.maxStorageBuffersPerShaderStage >= 8);
  assert.deepEqual(artifact.counts, FIELD_PROBE_CORPUS_COUNTS);
  assert.deepEqual(artifact.dispatches, [
    {
      warpMode: "disabled",
      probeCount: FIELD_PROBE_CORPUS_COUNTS.object + FIELD_PROBE_CORPUS_COUNTS.world,
      workgroupSize: [64, 1, 1],
      workgroupCount: [12, 1, 1],
      resourceBytes: (FIELD_PROBE_CORPUS_COUNTS.object + FIELD_PROBE_CORPUS_COUNTS.world) * 128,
    },
    {
      warpMode: "tangential",
      probeCount: FIELD_PROBE_CORPUS_COUNTS.sphere,
      workgroupSize: [64, 1, 1],
      workgroupCount: [4, 1, 1],
      resourceBytes: FIELD_PROBE_CORPUS_COUNTS.sphere * 128,
    },
  ]);
  assert.equal(artifact.inputBytes, FIELD_PROBE_CORPUS_COUNTS.total * 80);
  assert.equal(artifact.outputBytes, FIELD_PROBE_CORPUS_COUNTS.total * 48);
  assert.equal(artifact.resourceBytes, FIELD_PROBE_CORPUS_COUNTS.total * 128);
  for (const [label, hash] of [
    ["baseline", artifact.baselineSha256],
    ["repeated", artifact.repeatedSha256],
    ["stress", artifact.stressSha256],
    ["packed storage", artifact.packedStorageSha256],
  ]) {
    assert.match(hash, /^[0-9a-f]{64}$/, `${label} hash`);
  }
  assert.equal(artifact.baselineSha256, artifact.repeatedSha256);
  assert.notEqual(artifact.baselineSha256, artifact.stressSha256);
  assert.equal(artifact.records.length, FIELD_PROBE_CORPUS_COUNTS.total);

  let maxAbsError = 0;
  let sumAbsError = 0;
  let valueCount = 0;
  for (let index = 0; index < FIELD_PROBE_CORPUS.probes.length; index += 1) {
    const record = artifact.records[index];
    assert.deepEqual(record.probe, FIELD_PROBE_CORPUS.probes[index], `probe record ${index} identity`);
    const cpu = sampleFieldF32CPU(record.probe);
    const vectors = [
      [record.packed, Object.values(cpu.packedChannels), Object.values(FIELD_CHANNELS)],
      [record.derived, Object.values(cpu.derivedChannels), Object.values(FIELD_DERIVED_CHANNELS)],
      [record.gradient, Object.values(cpu.gradientChannels), Object.values(FIELD_GRADIENT_CHANNELS)],
    ];
    for (const [actual, expected, channels] of vectors) {
      assert.equal(actual.length, 4);
      for (let lane = 0; lane < 4; lane += 1) {
        assert(Number.isFinite(actual[lane]), `${record.probe.id} ${channels[lane]} must be finite`);
        const error = assertClose(
          actual[lane],
          expected[lane],
          gpuParityTolerances[channels[lane]],
          `${record.probe.id} ${channels[lane]}`,
        );
        maxAbsError = Math.max(maxAbsError, error);
        sumAbsError += error;
        valueCount += 1;
      }
    }
  }
  assert.deepEqual(artifact.directVsBaked.sampleCount, FIELD_PROBE_CORPUS_COUNTS.object - 1);
  assert.equal(artifact.directVsBaked.valueCount, (FIELD_PROBE_CORPUS_COUNTS.object - 1) * 4);
  assert(Number.isFinite(artifact.directVsBaked.maxAbsError));
  assert(Number.isFinite(artifact.directVsBaked.meanAbsError));
  const directVsBakedGate = Math.max(...Object.values(FIELD_CHANNELS).map(
    (channel) => gpuParityTolerances[channel],
  )) + FIELD_PARITY_ERROR_MANIFEST.rgba16floatStorage.nearestRoundingBoundBelowOne;
  assert(
    artifact.directVsBaked.maxAbsError <= directVsBakedGate,
    `direct-vs-baked error ${artifact.directVsBaked.maxAbsError} exceeded ${directVsBakedGate}`,
  );
  return {
    pass: true,
    status: "passed",
    probeCount: FIELD_PROBE_CORPUS_COUNTS.total,
    valueCount,
    maxAbsError,
    meanAbsError: sumAbsError / valueCount,
    directVsBakedGate,
    directVsBaked: artifact.directVsBaked,
    baselineSha256: artifact.baselineSha256,
    stressSha256: artifact.stressSha256,
  };
}

function validateDirtyRegionReadback(artifactDir) {
  const artifactPath = resolve(artifactDir, "field-dirty-region.json");
  assert(existsSync(artifactPath), `dirty-region artifact missing: ${artifactPath}`);
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  assert.equal(artifact.schemaVersion, 2);
  assert.deepEqual(artifact.contract, {
    path: "bitwise-full-storage-before-after-dirty-update",
    sameSeedBitwiseStable: true,
    stressSeedHashDistinct: true,
    dirtyRegionExecutionValidated: true,
    dependentMipConfinementValidated: true,
    canonicalRestoreBitwiseStable: true,
    performanceMeasured: false,
    productionReady: false,
  });
  assert.equal(artifact.renderer?.threeRevision, "185");
  assert.equal(artifact.renderer?.threePackageVersion, "0.185.1");
  assert.equal(artifact.renderer?.isWebGPUBackend, true);
  assert.deepEqual(artifact.extent, { width: 641, height: 359 });
  assert.deepEqual(artifact.dirtyRegion, { x: 71, y: 43, width: 257, height: 181 });
  assert.equal(artifact.canonicalSeed, FIELD_ALGORITHM.defaultSeed);
  assert.equal(artifact.stressSeed, (FIELD_ALGORITHM.defaultSeed ^ 0x9e3779b9) >>> 0);
  assert.equal(artifact.baselineSha256, artifact.repeatedSha256);
  assert.equal(artifact.baselineSha256, artifact.restoredSha256);
  assert.notEqual(artifact.baselineSha256, artifact.mutatedSha256);
  for (const hash of [
    artifact.baselineSha256,
    artifact.repeatedSha256,
    artifact.mutatedSha256,
    artifact.restoredSha256,
  ]) assert.match(hash, /^[0-9a-f]{64}$/);

  const extents = fieldMipExtents(641, 359);
  const mipRegions = propagateDirtyRegion(artifact.dirtyRegion, extents);
  assert.equal(artifact.comparisons.length, extents.length + 2);
  for (const [index, comparison] of artifact.comparisons.entries()) {
    const expectedId = index < extents.length
      ? `packed-mip-${index}`
      : index === extents.length ? "derived-base" : "gradient-base";
    assert.equal(comparison.id, expectedId);
    const expectedExtent = index < extents.length ? extents[index] : extents[0];
    const expectedRegion = index < extents.length ? mipRegions[index] : artifact.dirtyRegion;
    assert.deepEqual(comparison.extent, expectedExtent);
    assert.deepEqual(comparison.allowedRegion, expectedRegion);
    assert.equal(comparison.changedOutside, 0, `${comparison.id} outside-dirty mutation`);
    assert(comparison.changedInside > 0, `${comparison.id} must change inside the dirty region`);
    assert.equal(comparison.unchanged, false);
    assert.notEqual(comparison.beforeSha256, comparison.afterSha256);
  }
  assert.equal(
    validateFieldDispatchTrace(artifact.dirtyDispatchTrace, artifact.dirtyRegion, extents),
    artifact.dirtyDispatchTrace,
  );
  const fullRegion = { x: 0, y: 0, width: 641, height: 359 };
  validateFieldDispatchTrace(artifact.repeatedDispatchTrace, fullRegion, extents);
  validateFieldDispatchTrace(artifact.restoreDispatchTrace, fullRegion, extents);
  validateFieldResourceLedger(artifact.resourceLedger);
  const placementEntry = artifact.resourceLedger.resources.find(({ id }) => id === "placement-records");
  const fullInvocations = buildDirtyDispatchTrace(fullRegion, extents)
    .reduce((sum, entry) => sum + entry.invocationCount, 0);
  const dirtyInvocations = artifact.dirtyDispatchTrace
    .reduce((sum, entry) => sum + entry.invocationCount, 0);
  assert.deepEqual(artifact.dispatchTotals, {
    computeSubmissions: extents.length * 4 + 1,
    invocations: fullInvocations * 3 + dirtyInvocations + placementEntry.elementCount,
    fieldRegionUpdates: 4,
    placementUpdates: 1,
  });
  return {
    pass: true,
    status: "passed",
    resourceCount: artifact.resourceLedger.resources.length,
    resourceBytes: artifact.resourceLedger.totalBytes,
    comparisonCount: artifact.comparisons.length,
    dirtyInvocationCount: dirtyInvocations,
    dispatchTotals: artifact.dispatchTotals,
  };
}

async function validateMechanismDiagnostics(artifactDir) {
  const artifactPath = resolve(artifactDir, "field-mechanism-diagnostics.json");
  assert(existsSync(artifactPath), `mechanism diagnostic artifact missing: ${artifactPath}`);
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  const expectedIds = FIELD_MECHANISM_IDS;
  assert.equal(artifact.schemaVersion, 2);
  assert.equal(artifact.statisticsSource, "recomputed-from-retained-compact-rgba8");
  assert.deepEqual(artifact.diagnostics.map(({ id }) => id), expectedIds);
  const rawHashes = new Set();
  for (const diagnostic of artifact.diagnostics) {
    assert.equal(diagnostic.source, "render-target-readback");
    assert.match(diagnostic.compactRgbaSha256, /^[0-9a-f]{64}$/);
    assert.match(diagnostic.pngSha256, /^[0-9a-f]{64}$/);
    const pngPath = resolve(artifactDir, diagnostic.filename);
    assert(existsSync(pngPath), `${diagnostic.id} PNG missing`);
    assert.equal(sha256(pngPath), diagnostic.pngSha256);
    const decoded = await sharp(pngPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(decoded.info.width, diagnostic.width);
    assert.equal(decoded.info.height, diagnostic.height);
    assert.equal(decoded.info.channels, 4);
    assert.equal(
      createHash("sha256").update(decoded.data).digest("hex"),
      diagnostic.compactRgbaSha256,
    );
    const recomputedStatistics = analyzeFieldMechanismRgba(
      new Uint8Array(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength),
      decoded.info.width,
      decoded.info.height,
    );
    assert.deepEqual(diagnostic.statistics, recomputedStatistics);
    validateReportedFieldMechanismStatistics(
      diagnostic.id,
      diagnostic.statistics,
      new Uint8Array(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength),
      decoded.info.width,
      decoded.info.height,
    );
    rawHashes.add(diagnostic.compactRgbaSha256);
  }
  assert.equal(rawHashes.size, expectedIds.length, "mechanism diagnostics must be hash-distinct");
  return {
    pass: true,
    status: "passed",
    diagnosticCount: expectedIds.length,
    rawHashes: [...rawHashes],
    statistics: Object.fromEntries(artifact.diagnostics.map(({ id, statistics }) => [id, statistics])),
  };
}

async function validateSharedCaptureSession(artifactDir) {
  const sessionPath = resolve(artifactDir, "capture-session.json");
  assert(existsSync(sessionPath), `shared capture session missing: ${sessionPath}`);
  const session = JSON.parse(readFileSync(sessionPath, "utf8"));
  assert.equal(session.schemaVersion, 2);
  assert.equal(session.labId, "webgpu-field-bake");
  assert.equal(session.profile, "correctness");
  assert.deepEqual(session.profileConfig, { width: 1200, height: 800, dpr: 1 });
  assert.equal(session.automationSurface, "playwright-headless-chromium");
  assert.equal(session.threeRevision, "0.185.1");
  assert.match(session.sourceClosureHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(session.buildRevision, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(session.pageErrors, []);
  assert.deepEqual(session.consoleErrors, []);
  assert.deepEqual(session.requestErrors, []);
  assert.equal(session.runtime?.metrics?.backend, "webgpu");
  assert.equal(session.runtime?.metrics?.rendererType, "WebGPURenderer");
  assert.equal(session.runtime?.metrics?.rendererBackendEvidence?.deviceIdentityVerified, true);
  assert.equal(
    session.runtime?.metrics?.rendererBackendEvidence?.lossPromiseObservedOnActualDevice,
    true,
  );
  assert.equal(session.postDisposeSnapshot?.labError, null);
  assert.equal(session.outputPlan.length, outputPlanExpectedCount());
  const outputById = new Map(session.outputPlan.map((entry) => [entry.id, entry]));
  assert.equal(outputById.get("no-post.design")?.status, "NOT_APPLICABLE");
  for (const filename of [
    "final.design.png",
    "diagnostics.mosaic.png",
    "camera.near.png",
    "camera.design.png",
    "camera.far.png",
    "seed-0001.final.png",
    "seed-9e3779b9.final.png",
    "temporal.t000.png",
    "temporal.t001.png",
  ]) assert(existsSync(resolve(artifactDir, filename)), `standard capture missing: ${filename}`);
  assert.notEqual(
    sha256(resolve(artifactDir, "final.design.png")),
    sha256(resolve(artifactDir, "diagnostics.mosaic.png")),
  );
  assert.notEqual(
    sha256(resolve(artifactDir, "seed-0001.final.png")),
    sha256(resolve(artifactDir, "seed-9e3779b9.final.png")),
  );
  assert.notEqual(
    sha256(resolve(artifactDir, "temporal.t000.png")),
    sha256(resolve(artifactDir, "temporal.t001.png")),
  );
  const expectedWrites = new Set([
    "capture-session.json",
    "field-readback.json",
    "field-storage-readback.json",
    "field-placement-readback.json",
    "field-probe-corpus.json",
    "field-dirty-region.json",
    "field-mechanism-diagnostics.json",
  ]);
  for (const path of expectedWrites) {
    assert(session.artifactWrites.some((entry) => entry.path === path), `capture ledger omitted ${path}`);
  }
  return {
    pass: true,
    profile: session.profile,
    sourceClosureHash: session.sourceClosureHash,
    buildRevision: session.buildRevision,
    standardOutputCount: session.outputPlan.length,
    writtenCaptureCount: session.writtenCaptures.length,
  };
}

function outputPlanExpectedCount() {
  return 10;
}

function validateSourceContract() {
  const files = [
    "README.md",
    "field-constants.mjs",
    "field-probe-corpus.mjs",
    "field-f32-oracle.mjs",
    "mechanism-evidence.mjs",
    "field-bundle.mjs",
    "field-bake.mjs",
    "browser-app.js",
    "capture.mjs",
    "capture-hook.mjs",
    "route-contract.mjs",
    "package.json",
    "validate-field-contract.mjs",
  ];
  const sources = Object.fromEntries(
    files.map((file) => [file, readFileSync(resolve(here, file), "utf8")]),
  );
  const source = Object.values(sources).join("\n");

  for (const required of [
    "Fn(",
    "sampleField",
    "sampleFieldCPU",
    "sampleFieldDerived",
    "sampleFieldGradient",
    "createFieldNodeBundle",
    ".toVar(",
    "FIELD_ALGORITHM",
    "FIELD_PARITY_CHANNELS",
    "trilinear",
    "valueNoise3",
    "valueNoise3Node",
    "tangentWarp",
    "macroGradient",
    "warpJacobian",
    "macroHeight",
    "packedChannels",
    "derivedChannels",
    "slope",
    "biome",
    "roughness",
    "placementMask",
    "StorageTexture",
    "textureStore",
    "estimateFieldPathCosts",
    "effectiveBandwidthBytesPerCostUnit",
    "reuseFrames",
    "dirtyTile",
    "invalidate",
    "renderer.compute",
    "maxAbsError",
    "meanAbsError",
    "coverage",
    "gpuParity",
    "fixedProbes",
    "tolerance",
    "process.exitCode",
    "Checkpoint",
    "CPU-vs-TSL",
    "direct-vs-baked",
    "packed atlas",
    "createFieldBakeSystem",
    "createStructuredPlacementComputeNode",
    "fieldMipExtents",
    "FIELD_INTERFACE_V2",
    "createFieldCauseBindings",
    "field-probe-corpus-v1",
    "compareFieldStorageMutation",
    "validateFieldResourceLedger",
    "validateFieldMechanismStatistics",
  ]) {
    assert(source.includes(required), `missing ${required}`);
  }
  assert(sources["field-bundle.mjs"].includes("export function createFieldNodeBundle"));
  assert(sources["field-bundle.mjs"].includes(".toVar(`${varPrefix}MacroHeight`)"));
  assert(sources["field-bake.mjs"].includes("export function estimateFieldPathCosts"));
  assert(sources["field-bake.mjs"].includes("effectiveBandwidthBytesPerCostUnit"));
  assert(sources["field-bake.mjs"].includes("mipmapsAutoUpdate = format.generateMipmaps"));
  assert(sources["field-bake.mjs"].includes("texture.mipmapsAutoUpdate = false"));
  assert(!/\breadCount\b/.test(sources["field-bake.mjs"]), "read-count strategy heuristic returned");
  assert(sources["browser-app.js"].includes("direct-wgsl-f32-plus-tier-specific-resources"));
  assert(sources["browser-app.js"].includes("resolveHalfReadbackLayout"));
  assert(sources["browser-app.js"].includes(
    'artifactCoverage: "all-accepted-raw-gpu-records-plus-separate-index-identity"',
  ));
  assert(sources["field-bundle.mjs"].includes("fieldInputTransform"));
  assert(sources["field-bundle.mjs"].includes("inputJacobianColumns"));
  assert(sources["field-bake.mjs"].includes("acceptedCellIndices"));
  assert(sources["field-bake.mjs"].includes("buildDirtyDispatchTrace"));
  assert(sources["capture-hook.mjs"].includes('"field-storage-readback.json"'));
  assert(sources["capture-hook.mjs"].includes('"field-placement-readback.json"'));
  assert(sources["capture-hook.mjs"].includes('"field-mechanism-diagnostics.json"'));
  assert(sources["capture-hook.mjs"].includes('"field-probe-corpus.json"'));
  assert(sources["capture-hook.mjs"].includes('"field-dirty-region.json"'));
  assert(sources["capture.mjs"].includes("captureLabBrowser"));
  assert(sources["capture.mjs"].includes(
    "../../../artifacts/visual-validation/webgpu-field-bake/correctness",
  ));
  const packageJson = JSON.parse(sources["package.json"]);
  assert.equal(
    packageJson.scripts.capture,
    "node capture.mjs",
    "the root runner must be able to forward correctness or performance without a package override",
  );
  assert.deepEqual(CAPTURE_PROFILES, ["correctness", "performance"]);
  assert.deepEqual(parseCaptureArgs([]), {
    profile: "correctness",
    outputDir: DEFAULT_ARTIFACT_DIR,
    target: "display",
  });
  assert.equal(parseCaptureArgs(["--profile", "performance"]).profile, "performance");
  assert.throws(
    () => parseCaptureArgs(["--profile", "invented"]),
    /unsupported field capture profile/,
  );
  assert.throws(
    () => parseCaptureArgs(["--profile"]),
    /requires a value/,
  );
  assert(packageJson.scripts["validate:artifacts"].includes(
    "../../../artifacts/visual-validation/webgpu-field-bake/correctness",
  ));
  assert(sources["browser-app.js"].includes('uniform(initialSeed >>> 0, "uint")'));
  assert(sources["field-bundle.mjs"].includes("return uint(seed)"));
  assert(sources["field-bundle.mjs"].includes("if (warpEnabled)"));
  assert(sources["field-bundle.mjs"].includes("WarpDisabledTangent"));
  assert(sources["field-f32-oracle.mjs"].includes("Math.fround"));
  assert(!sources["browser-app.js"].includes("seed % PRECOMPUTED_ASSETS.length"));
  for (const forbidden of [
    ["deepest", "RoundedOps"].join(""),
    ["gamma", "_384"].join(""),
  ]) {
    assert(!source.includes(forbidden), `forbidden stale contract: ${forbidden}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const toolchainAndF32Oracle = validateToolchainAndF32Oracle();
  const precomputedContract = validateManifest();
  validateBakePlanning();
  validateSharedAlgorithm();
  const v2InterfaceAndProbeCorpus = validateV2InterfaceAndProbeCorpus();
  const analyticGradient = validateAnalyticGradient();
  const fixtureParity = validateGoldenFixtures();
  validateSourceContract();

  let gpuParity;
  let gpuStorage;
  let gpuProbeCorpus;
  let gpuDirtyRegion;
  let mechanismDiagnostics;
  let sharedCaptureSession;
  if (options.artifacts) {
    gpuParity = validateGpuReadback(options.artifacts);
    gpuStorage = validateStorageReadback(options.artifacts);
    gpuProbeCorpus = validateProbeCorpusReadback(options.artifacts);
    gpuDirtyRegion = validateDirtyRegionReadback(options.artifacts);
    mechanismDiagnostics = await validateMechanismDiagnostics(options.artifacts);
    sharedCaptureSession = await validateSharedCaptureSession(options.artifacts);
  } else {
    gpuParity = {
      pass: false,
      status: "not-run",
      requiredForBrowserAcceptance: true,
      reason:
        "Run examples/webgpu-field-bake/capture.mjs to generate field-readback.json, or pass --allow-missing-gpu for Layer 1 only.",
    };
    gpuStorage = {
      pass: false,
      status: "not-run",
      requiredForBrowserAcceptance: true,
      reason: "Native-WebGPU storage, mip, and placement readback artifacts are required.",
    };
    gpuProbeCorpus = {
      pass: false,
      status: "not-run",
      requiredForBrowserAcceptance: true,
      reason: "The 1,024-probe TSL compute corpus is required.",
    };
    gpuDirtyRegion = {
      pass: false,
      status: "not-run",
      requiredForBrowserAcceptance: true,
      reason: "Bitwise dirty-region and dependent-mip confinement evidence is required.",
    };
    mechanismDiagnostics = {
      pass: false,
      status: "not-run",
      requiredForBrowserAcceptance: true,
      reason: "All six mechanism render-target diagnostics are required.",
    };
    sharedCaptureSession = {
      pass: false,
      status: "not-run",
      requiredForBrowserAcceptance: true,
      reason: "The shared capture-runner session and standard outputs are required.",
    };
    if (!options.allowMissingGpu) {
      process.exitCode = 1;
    }
  }

  const report = {
    fixtureClassification: {
      classification: "canonical-lab",
      validates: [
        "CPU golden fixtures",
        "analytic value and warp-Jacobian derivatives",
        "direct WGSL f32 readback",
        "1,024-record TSL compute corpus with stable and stress-seed hashes",
        "declared rgba16float base texels and explicit box-filter mip texels",
        "bitwise dirty-region confinement and dependent mip writes",
        "all structured-placement GPU records",
        "cost-model algebra",
      ],
      doesNotValidate: [
        "filtered texture consumption and interpolation error",
        "full-domain storage parity",
        "target performance without GPU timestamps",
      ],
      canonicalArtifactBundlePassed:
        gpuParity.pass && gpuStorage.pass && gpuProbeCorpus.pass && gpuDirtyRegion.pass &&
        mechanismDiagnostics.pass && sharedCaptureSession.pass,
      productionReady: false,
    },
    structuralParity: {
      pass: true,
      sharedConstantsObject: true,
      channelPack: FIELD_CHANNELS,
      derivedChannelPack: FIELD_DERIVED_CHANNELS,
    },
    toolchainAndF32Oracle,
    precomputedContract,
    v2InterfaceAndProbeCorpus,
    analyticGradient,
    fixtureParity,
    gpuParity,
    gpuStorage,
    gpuProbeCorpus,
    gpuDirtyRegion,
    mechanismDiagnostics,
    sharedCaptureSession,
  };

  const reportPath =
    process.env.FIELD_VALIDATION_REPORT ??
    resolve(tmpdir(), "webgpu-field-bake-validation.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  if (process.exitCode) {
    throw new Error(
      `GPU parity ${gpuParity.status}; rerun with --artifacts <dir> or --allow-missing-gpu. Layer 1 report: ${reportPath}`,
    );
  }

  console.log(`webgpu-field-bake validation passed: ${reportPath}`);
}

await main();
