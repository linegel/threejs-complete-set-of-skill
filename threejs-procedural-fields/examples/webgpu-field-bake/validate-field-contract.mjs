import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CPU_FIELD_ALGORITHM,
  FIELD_ALGORITHM,
  FIELD_CHANNELS,
  FIELD_DERIVED_CHANNELS,
  FIELD_GRADIENT_CHANNELS,
  FIELD_PARITY_ERROR_MANIFEST,
  FIELD_PARITY_CHANNELS,
  TSL_FIELD_ALGORITHM,
  coverage,
  fixedProbes,
  gpuParityProbes,
  sampleFieldCPU,
  tangentWarp,
} from "./field-bundle.mjs";
import {
  FIELD_ALGORITHM as SHARED_FIELD_ALGORITHM,
  FIELD_PARITY_THRESHOLD_ROLES,
} from "./field-constants.mjs";
import {
  buildDirtyDispatchTrace,
  createDirtyTileTracker,
  createFieldBakeComputeNode,
  createFieldBakePlan,
  createFieldBakeResources,
  createStructuredPlacementComputeNode,
  createStructuredPlacementResources,
  decideBakeStrategy,
  estimateFieldPathCosts,
  fieldMipExtents,
  propagateDirtyRegion,
  STORAGE_FORMATS,
} from "./field-bake.mjs";

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
  for (const asset of manifest.assets) {
    const path = resolve(manifestDir, asset.path);
    assert.equal(statSync(path).size, asset.byteLength, asset.id);
    assert.equal(sha256(path), asset.sha256, asset.id);
    assert.deepEqual(pngDimensions(path), {
      width: asset.width,
      height: asset.height,
    });
    assert.equal(asset.colorSpace, "NoColorSpace");
  }
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
  ]);
  assert.equal(readback.contract?.probeSet, "gpuParityProbes-v3-original-domain-gradients");
  assert.equal(readback.contract?.seedRepresentation, "u32-uniform");
  assert.equal(readback.renderer?.isWebGPUBackend, true);
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
    const cpu = sampleFieldCPU(entry.probe);
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
      const cpu = sampleFieldCPU({
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
        const cpu = sampleFieldCPU({
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
  const centerCpu = sampleFieldCPU({
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
    path: "deterministic-index-list-plus-storage-buffer-write-readback",
    artifactCoverage: "all-accepted-compacted-records-plus-index-list",
    rejectedRecordsRetained: false,
    performanceMeasured: false,
    productionReady: false,
  });
  assert.equal(placementReadback.cellCount, 4096);
  assert.equal(placementReadback.records.length, placementReadback.accepted);
  assert.equal(placementReadback.acceptedIndices.length, placementReadback.accepted);
  assert.deepEqual(
    placementReadback.records.map((record) => record[3]),
    placementReadback.acceptedIndices,
    "record identity must come from the compacted integer index list",
  );
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
    const expected = sampleFieldCPU({
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
    const expected = sampleFieldCPU({
      domain: "object",
      coordinate,
      seed: FIELD_ALGORITHM.defaultSeed,
    });
    const actual = placementReadback.records[outputIndex];
    assert.equal(actual.length, 4, `placement record ${outputIndex} width`);
    assertClose(actual[0], coordinate[0], 2 ** -21, `placement record ${outputIndex} x`);
    assertClose(actual[1], coordinate[2], 2 ** -21, `placement record ${outputIndex} z`);
    const maskError = assertClose(
      actual[2],
      expected.placementMask,
      gpuParityTolerances.placementMask,
      `placement record ${outputIndex} mask`,
    );
    placementMaxAbsError = Math.max(placementMaxAbsError, maskError);
    assert.equal(actual[3], cellIndex, `placement record ${outputIndex} cell index`);
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

function validateSourceContract() {
  const files = [
    "README.md",
    "field-constants.mjs",
    "field-bundle.mjs",
    "field-bake.mjs",
    "browser-app.js",
    "capture.mjs",
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
    'artifactCoverage: "all-accepted-compacted-records-plus-index-list"',
  ));
  assert(sources["field-bundle.mjs"].includes("fieldInputTransform"));
  assert(sources["field-bundle.mjs"].includes("inputJacobianColumns"));
  assert(sources["field-bake.mjs"].includes("acceptedCellIndices"));
  assert(sources["field-bake.mjs"].includes("buildDirtyDispatchTrace"));
  assert(sources["capture.mjs"].includes('"field-storage-readback.json"'));
  assert(sources["capture.mjs"].includes('"field-placement-readback.json"'));
  assert(sources["browser-app.js"].includes('uniform(FIELD_ALGORITHM.defaultSeed >>> 0, "uint")'));
  assert(sources["field-bundle.mjs"].includes("return uint(seed)"));
  for (const forbidden of [
    ["deepest", "RoundedOps"].join(""),
    ["gamma", "_384"].join(""),
  ]) {
    assert(!source.includes(forbidden), `forbidden stale contract: ${forbidden}`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  validateManifest();
  validateBakePlanning();
  validateSharedAlgorithm();
  const analyticGradient = validateAnalyticGradient();
  const fixtureParity = validateGoldenFixtures();
  validateSourceContract();

  let gpuParity;
  let gpuStorage;
  if (options.artifacts) {
    gpuParity = validateGpuReadback(options.artifacts);
    gpuStorage = validateStorageReadback(options.artifacts);
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
        "declared rgba16float base texels and explicit box-filter mip texels",
        "all structured-placement GPU records",
        "cost-model algebra",
      ],
      doesNotValidate: [
        "filtered texture consumption and interpolation error",
        "full-domain storage parity",
        "dirty-region GPU execution",
        "target performance without GPU timestamps",
      ],
      canonicalArtifactBundlePassed: gpuParity.pass && gpuStorage.pass,
      productionReady: false,
    },
    structuralParity: {
      pass: true,
      sharedConstantsObject: true,
      channelPack: FIELD_CHANNELS,
      derivedChannelPack: FIELD_DERIVED_CHANNELS,
    },
    analyticGradient,
    fixtureParity,
    gpuParity,
    gpuStorage,
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

main();
