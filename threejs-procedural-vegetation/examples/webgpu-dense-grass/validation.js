import { readFile } from "node:fs/promises";

import {
  DENSE_GRASS_HASH_CONTRACT,
  DenseGrassSystem,
  buildDenseGrassBladeSeedCPU,
  buildDenseGrassClumpSeedCPU,
  denseGrassQualityTiers,
  denseGrassSpatialGridSlot,
  denseGrassSpatialPermutationStep,
  evaluateDenseGrassRootedDeformationCPU,
  hashDenseGrassLaneCPU,
  hashDenseGrassUintCPU,
  validateDenseGrassCapabilities,
  validateDenseGrassConfig,
  validateDenseGrassSystem,
} from "./dense-grass-system.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeFakeNonWebGPURenderer() {
  return {
    initialized: true,
    backend: { isWebGPUBackend: false },
    compute: () => {},
  };
}

function makeFakeNativeRenderer(counter) {
  return {
    initialized: true,
    backend: { isWebGPUBackend: true },
    getRenderTarget: () => null,
    setRenderTarget: () => {},
    compute: () => {
      counter.count += 1;
    },
  };
}

function validateHashContract() {
  const uintVectors = [
    [0, 0],
    [1, 1753845952],
    [0xffffffff, 1734902346],
    [0x12345678, 4125564054],
  ];
  const laneVectors = [
    [0, 0, 0.0077651143074035645],
    [7331, 1, 0.3342937231063843],
    [0xffffffff, 17, 0.7666576504707336],
  ];
  const bladeVectors = [
    [123, 0, 91508032],
    [0xdeadbeef, 11999, 1889912164],
  ];
  const clumpVectors = [
    [7331, 0, 0, 3978617649],
    [7331, -9, 17, 3536026877],
    [0xffffffff, 12345, -6789, 1169015645],
  ];

  for (const [input, expected] of uintVectors) {
    assert(hashDenseGrassUintCPU(input) === expected, `u32 mixer vector failed for ${input}`);
  }
  for (const [seed, lane, expected] of laneVectors) {
    const actual = hashDenseGrassLaneCPU(seed, lane);
    assert(actual === expected, `u32 lane vector failed for seed=${seed}, lane=${lane}`);
    assert(actual >= 0 && actual < 1, `u32 lane escaped [0, 1) for seed=${seed}, lane=${lane}`);
  }
  for (const [patchSeed, index, expected] of bladeVectors) {
    assert(buildDenseGrassBladeSeedCPU(patchSeed, index) === expected, `blade seed vector failed for index=${index}`);
  }
  for (const [seed, x, z, expected] of clumpVectors) {
    assert(buildDenseGrassClumpSeedCPU(seed, x, z) === expected, `clump seed vector failed for (${x}, ${z})`);
  }

  return {
    contract: DENSE_GRASS_HASH_CONTRACT,
    uintVectors,
    laneVectors,
    bladeVectors,
    clumpVectors,
  };
}

function validateSpatialRanking() {
  const blades = denseGrassQualityTiers.high.bladesPerPatch;
  const columns = Math.ceil(Math.sqrt(blades));
  const inspectPrefix = (retained, label) => {
    const quadrants = [0, 0, 0, 0];
    const seen = new Set();
    for (let index = 0; index < retained; index += 1) {
      const slot = denseGrassSpatialGridSlot(index, columns);
      assert(!seen.has(slot), `spatial rank repeats slot ${slot}`);
      seen.add(slot);
      const x = slot % columns;
      const z = Math.floor(slot / columns);
      quadrants[(x >= columns / 2 ? 1 : 0) + (z >= columns / 2 ? 2 : 0)] += 1;
    }
    const minimumExpected = retained * 0.18;
    assert(quadrants.every((count) => count >= minimumExpected),
      `${label} LOD must cover every quadrant: ${quadrants.join(",")}`);
    return { retained, quadrants };
  };
  const mid = inspectPrefix(Math.floor(blades * denseGrassQualityTiers.high.midDensity), "mid");
  const far = inspectPrefix(Math.floor(blades * 0.08), "far");
  return {
    columns,
    spatialStep: denseGrassSpatialPermutationStep(columns),
    mid,
    far,
  };
}

function validateRootedDeformation() {
  const root = evaluateDenseGrassRootedDeformationCPU({
    t: 0,
    height: 0.8,
    forward: 0.3,
    touchX: 0.4,
    touchZ: -0.2,
    terrainTiltX: 0.1,
    terrainTiltZ: 0.05,
  });
  const tip = evaluateDenseGrassRootedDeformationCPU({
    t: 1,
    height: 0.8,
    forward: 0.3,
    touchX: 0.4,
    touchZ: -0.2,
    terrainTiltX: 0.1,
    terrainTiltZ: 0.05,
  });
  assert(root.rootWeight === 0, "blade root weight must be exactly zero");
  assert(root.offset.every((value) => Math.abs(value) <= 1e-12), "blade root must not translate");
  assert(Math.hypot(...tip.offset) > 0, "blade tip must respond to wind/touch fields");
  assert(Math.abs(root.normalLength - 1) < 1e-12 && Math.abs(tip.normalLength - 1) < 1e-12,
    "deformed normal oracle must remain unit length");
  return { root, tip };
}

async function validateSourceContract() {
  const source = await readFile(new URL("./dense-grass-system.js", import.meta.url), "utf8");
  for (const token of [
    "const hashDenseGrassUintNode",
    ".bitXor(",
    ".shiftRight(",
    'uniform(patch.seed >>> 0, "uint")',
    "new InstancedBufferGeometry()",
    "geometry.instanceCount",
    "renderer.compute(patch.initCompute)",
  ]) {
    assert(source.includes(token), `dense-grass source missing ${token}`);
  }
  assert(!source.includes("const hash11"), "float sin/fract hash11 must not return");
  assert(!source.includes("const hash21"), "float sin/fract hash21 must not return");
  assert(!source.includes("new InstancedMesh"), "storage-owned placement must not allocate unused instance matrices");
  assert(!source.includes("computeAsync"), "computeAsync must not be presented as a completion fence");
  assert(!source.includes("explicitFallback"), "canonical example must not embed a missing-WebGPU fallback path");

  return {
    kind: "source-static",
    gpuStorageReadbackParity: "not-captured",
  };
}

export async function validateDenseGrassContracts() {
  const hashContract = validateHashContract();
  const spatialRanking = validateSpatialRanking();
  const rootedDeformation = validateRootedDeformation();
  const sourceContract = await validateSourceContract();
  const highConfig = validateDenseGrassConfig({ tier: "high" });
  assert(highConfig.patchCount === 49, `high tier patchCount expected 49, got ${highConfig.patchCount}`);
  assert(highConfig.bladesPerPatch === 12000, `high tier bladesPerPatch expected 12000, got ${highConfig.bladesPerPatch}`);
  assert(highConfig.storageBytesPerBlade === 64, "storage byte estimate must stay at 64 bytes/blade");
  assert(highConfig.perFrameComputeDispatches === 0, "vertex-wind mode must use zero per-frame compute dispatches");
  assert(highConfig.allocatedDrawObjectCount === 98, "high tier must allocate two representation objects per patch");
  assert(highConfig.visibleDrawObjectCeiling === 49, "blade/card mutual exclusion must gate one submitted representation per patch");
  assert(highConfig.dprCap === 1.5, "dense/high must lock DPR to 1.5");
  const scaledConfig = validateDenseGrassConfig({ tier: "high", worldUnitsPerMeter: 2 });
  assert(scaledConfig.patchSizeMeters === 20 && scaledConfig.patchSize === 40,
    "worldUnitsPerMeter must scale authored patch coordinates exactly once");

  const missingWebGPUCapabilities = validateDenseGrassCapabilities(makeFakeNonWebGPURenderer(), { tier: "high" });
  assert(missingWebGPUCapabilities.nativeStorage === false, "fake missing-WebGPU renderer must not pass native storage");
  assert(missingWebGPUCapabilities.hasCompute === true, "capability gate should distinguish compute API from backend identity");

  const nativeCounter = { count: 0 };
  const nativeCapabilities = validateDenseGrassCapabilities(makeFakeNativeRenderer(nativeCounter), { tier: "high" });
  assert(nativeCapabilities.nativeStorage === true, "fake native renderer should pass native storage");

  let rejectedNonWebGPU = false;
  try {
    await new DenseGrassSystem(makeFakeNonWebGPURenderer(), { tier: "high" }).initialize();
  } catch (error) {
    rejectedNonWebGPU = error instanceof Error &&
      error.message.includes("requires initialized WebGPU storage/compute");
  }
  assert(rejectedNonWebGPU, "canonical example must reject non-WebGPU backends");

  const nativeSystem = await new DenseGrassSystem(makeFakeNativeRenderer(nativeCounter), { tier: "low" }).initialize();
  const expectedLowPatchCount = (denseGrassQualityTiers.low.patchGridRadius * 2 + 1) ** 2;
  assert(nativeCounter.count === expectedLowPatchCount, `native compute calls expected ${expectedLowPatchCount}, got ${nativeCounter.count}`);
  const native = validateDenseGrassSystem(nativeSystem);
  assert(native.diagnostics.initDispatches === native.diagnostics.patchCount, "native init dispatches must equal patch count");
  nativeSystem.setWind({ direction: { x: 0, y: 1 }, strength: 0.62, speed: 1.4 });
  nativeSystem.setTouches([{ x: 2, z: -3, radius: 1.5, weight: 0.8 }]);
  const grassUniforms = nativeSystem.patches[0].bladeMaterials[0].userData.grassUniforms;
  assert(grassUniforms.windDirNode.value.x === 0 && grassUniforms.windDirNode.value.y === 1,
    "setWind must update live direction uniforms");
  assert(grassUniforms.windStrengthNode.value === 0.62, "setWind must update live strength uniforms");
  assert(grassUniforms.windSpeedNode.value === 1.4, "setWind must update live speed uniforms");
  assert(grassUniforms.touchNodes[0].value.w === 0.8, "touch channel must update live compact uniforms");
  const immutableIdentity = nativeSystem.getDiagnostics().staticStorageIdentity;
  const immutableRevision = nativeSystem.getDiagnostics().staticStorageRevision;
  nativeSystem.update({ elapsed: 5 });
  assert(nativeSystem.getDiagnostics().staticStorageIdentity === immutableIdentity,
    "dynamic wind updates must not rewrite static placement identity");
  assert(nativeSystem.getDiagnostics().staticStorageRevision === immutableRevision,
    "dynamic wind updates must not advance static placement revision");
  assert(nativeSystem.getDiagnostics().staticStorageImmutable,
    "dynamic updates must preserve static storage backing arrays");
  const beforeStreamingCompute = nativeCounter.count;
  assert(nativeSystem.recenterAround({ x: 40, z: -40 }) === true, "streaming recenter must report a changed page");
  assert(nativeCounter.count - beforeStreamingCompute === expectedLowPatchCount,
    "streaming recenter must refill each recycled patch exactly once");
  let rejectedUnknownMode = false;
  try {
    nativeSystem.setDebugMode("not-a-mode");
  } catch (error) {
    rejectedUnknownMode = error.message.includes("unknown dense-grass debug mode");
  }
  assert(rejectedUnknownMode, "unknown dense-grass debug modes must throw");
  nativeSystem.dispose();

  return {
    pass: true,
    evidenceClass: "source-static; no GPU storage readback or visual acceptance evidence",
    hashContract,
    spatialRanking,
    rootedDeformation,
    sourceContract,
    highConfig,
    scaledConfig,
    capabilities: {
      missingWebGPU: missingWebGPUCapabilities,
      native: nativeCapabilities,
    },
    rejectedNonWebGPU,
    nativeSystem: {
      patchCount: native.diagnostics.patchCount,
      initDispatches: native.diagnostics.initDispatches,
      computeCalls: nativeCounter.count,
      liveWindAndTouchUniforms: true,
      streamingRecomputeCount: expectedLowPatchCount,
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await validateDenseGrassContracts(), null, 2));
}
