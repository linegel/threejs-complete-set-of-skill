import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

import {
  CLIPMAP_IMPLEMENTATION_STATUS,
  DEFAULT_CLIPMAP_CONFIG,
  DEFAULT_CLIPMAP_CONFIG_EVIDENCE,
  DIRTY_REASON_BITS,
  SHADOW_ARCHITECTURE_DECISIONS,
  clampClipmapConfig,
  commitLevelRender,
  computeLevelCount,
  computeSelectionWeights,
  createClipmapLevels,
  directionChanged,
  estimateShadowMemoryBytes,
  invalidateSphere,
  inverseMapSize,
  selectLevelsForUpdate,
  snapLightSpaceCenter,
  validateClipmapConfig,
  validateClipmapProofClaim,
} from "./clipmap-config.js";
import {
  CachedClipmapShadowNode,
  createBiasNodePlan,
  createStaticChildSamplingPlan,
  validateDisposeCounters,
} from "./clipmap-shadow-node.js";
import {
  createCachedClipmapShadowSystem,
  createSharedDisplacedCaster,
  createShadowArchitectureDecisionRecord,
} from "./main.js";

const here = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const claimBoundary = validateClipmapProofClaim(args.claim);
assert.equal(claimBoundary.ok, true, claimBoundary.reason);
assert.equal(CLIPMAP_IMPLEMENTATION_STATUS.productionClipmapProof, false);
assert.equal(CLIPMAP_IMPLEMENTATION_STATUS.receiverBlendImplemented, false);
assert(DEFAULT_CLIPMAP_CONFIG_EVIDENCE.Authored.length > 0);
assert(DEFAULT_CLIPMAP_CONFIG_EVIDENCE.Derived.length > 0);
assert(DEFAULT_CLIPMAP_CONFIG_EVIDENCE.Gated.length > 0);
assert.equal(
  validateClipmapProofClaim("production-clipmap").ok,
  false,
  "the Phase-1 validator must reject a production clipmap proof claim",
);

const config = clampClipmapConfig(DEFAULT_CLIPMAP_CONFIG);
assert.equal(
  config.levelCount,
  computeLevelCount(config),
  "level-count formula must match default config",
);

const validation = validateClipmapConfig(config);
assert.equal(validation.ok, true, validation.errors.join("\n"));
assert(validation.levels.length >= 3);

for (const invalidConfig of [
  { firstRadius: 12, maxDistance: 1 },
  { mapSizes: [0] },
  { bytesPerDepthTexel: -1 },
  { dynamicLevels: 999 },
  { firstRadius: 10, scaleFactor: 2, maxDistance: 21 },
  { firstRadius: 10, scaleFactor: 2, maxDistance: 40, mapSizes: [1] },
]) {
  assert.equal(
    validateClipmapConfig(invalidConfig).ok,
    false,
    `invalid config must fail: ${JSON.stringify(invalidConfig)}`,
  );
}
assert(
  estimateShadowMemoryBytes(
    validation.levels,
    config.bytesPerDepthTexel,
    config.bytesPerColorTexel,
  ) <= config.memoryBudgetBytes,
);

const levels = createClipmapLevels(config);
assert(levels.every((level) => level.valid === false));
assert(levels.every((level) => Math.abs(level.centerX) === 1e9));

for (const level of levels) {
  assert.equal(inverseMapSize(level), 1 / level.mapSize);
  assert.equal(level.inverseMapSize, 1 / level.mapSize);
}

const desired = snapLightSpaceCenter({ x: 13.2, y: -9.7, z: 51 }, levels[0]);
assert.equal(desired.x % levels[0].texelWidth, 0);
assert.equal(
  desired.z,
  51,
  "Phase 1 must carry light-space Z unchanged instead of quantizing it from XY half-width",
);
commitLevelRender(levels[0], desired);
assert.equal(levels[0].valid, true);
assert.equal(levels[0].centerX, desired.x);

const desiredButNotCommitted = snapLightSpaceCenter(
  { x: 100, y: 200, z: 300 },
  levels[1],
);
assert.notEqual(levels[1].centerX, desiredButNotCommitted.x);

const selection = selectLevelsForUpdate({
  levels,
  cameraLight: { x: 250, y: -100, z: 20 },
  config,
});
assert(selection.selected.some((item) => item.dynamic));
assert(selection.budgetAfter >= 0);

levels.at(-1).valid = true;
levels.at(-1).centerX = 0;
levels.at(-1).centerY = 0;
levels.at(-1).centerZ = 0;
levels.at(-1).forceDirty = true;
const forcedSelection = selectLevelsForUpdate({
  levels,
  cameraLight: { x: 0, y: 0, z: 0 },
  config: { ...config, updateBudget: 1, dynamicLevels: 0 },
});
assert(
  forcedSelection.selected.some((item) => item.forced && !item.budgeted),
  "forced invalidation must bypass ordinary cached budget",
);

const refreshedAll = selectLevelsForUpdate({
  levels: createClipmapLevels(config),
  cameraLight: { x: 0, y: 0, z: 0 },
  config,
  lightDirectionChanged: directionChanged(Math.cos(config.directionEpsilon * 2), config.directionEpsilon),
});
assert.equal(refreshedAll.budgetBefore, config.levelCount);

const staggeredAges = createClipmapLevels(config).map((level) => level.age);
assert(new Set(staggeredAges).size > 1, "initial ages must be staggered");

const touched = invalidateSphere(levels, {
  x: levels[0].centerX,
  y: levels[0].centerY,
  radius: 1,
});
assert(touched.length >= 1);

const invalidWeights = computeSelectionWeights(createClipmapLevels(config), { x: 0, y: 0 }, config.blendRatio);
assert.equal(
  invalidWeights.weights.some((weight) => weight.weight > 0),
  false,
  "invalid sentinel levels must never win selection",
);

const samplingPlan = createStaticChildSamplingPlan(levels);
assert.equal(samplingPlan.length, levels.length);
assert(
  samplingPlan.every((entry) => entry.sample.includes("statically reachable")),
  "every child comparison node must remain statically reachable before weighting",
);
assert(
  createBiasNodePlan(levels).every(
    (entry) =>
      entry.status === "unwired-hypothesis" &&
      entry.normalBias === null &&
      entry.biasNode === null,
  ),
  "Phase 1 must not present an unwired linear bias hypothesis as validated bias",
);

const architecture = createShadowArchitectureDecisionRecord({
  receiverBounded: false,
  persistentLocalizedCoverage: true,
});
assert.equal(
  architecture.selected.use,
  "CSMShadowNode",
  "an incomplete custom receiver must not replace the selected built-in path",
);
assert.equal(architecture.customCandidate.use, "custom cached clipmap");
assert.equal(architecture.productionClipmapProof, false);
assert(architecture.requirement.includes("complete receiver implementation"));
assert(
  architecture.compared.every((entry) => entry.measurementEvidence === null),
  "missing measurements must remain missing rather than synthetic",
);
assert(
  SHADOW_ARCHITECTURE_DECISIONS[2].cost.includes("one ArrayCamera renderer invocation") &&
    SHADOW_ARCHITECTURE_DECISIONS[2].cost.includes("N = tilesX * tilesY backend layer render passes"),
  "TileShadowNode cost must distinguish one renderer invocation from N backend layer passes",
);

const detachedByDefault = createCachedClipmapShadowSystem({ config });
assert.equal(
  detachedByDefault.attachedToLight,
  false,
  "the incomplete Phase-1 receiver node must remain detached by default",
);
detachedByDefault.dispose();
assert.equal(detachedByDefault.node.disposeCounters.attachmentDetaches, 0);

const system = createCachedClipmapShadowSystem({
  config,
  attachPhase1Scaffold: true,
});
assert.equal(system.light.shadow.shadowNode, system.node);
assert.equal(system.attachedToLight, true);
assert.equal(system.implementationStatus.phase, "phase-1-scaffold");
assert.equal(system.node.implementationStatus.productionClipmapProof, false);
const firstRenderer = createMockRenderer();
await system.update(
  { x: 4, y: 8, z: 12 },
  {
    renderer: firstRenderer,
    frameId: 1,
    deformationTime: 0,
    deformationBoundsLightSpace: { x: -20, y: 0, radius: 1 },
  },
);
const selectedCount = system.node.lastSelection.selected.length;
assert(selectedCount > 0, "scheduler must select at least one level for initial render");
assert.equal(
  firstRenderer.renderCalls.length,
  selectedCount,
  "renderShadow must issue one caster draw per selected level",
);
assert.equal(
  firstRenderer.renderCalls.every((call) => call.autoClear === true),
  true,
  "each Phase-1 target render must use one render-owned auto clear",
);
assert.equal(firstRenderer.autoClear, false, "renderer autoClear must restore");
assert.equal(firstRenderer.currentTarget, null, "renderer target must restore");
assert.equal(
  firstRenderer.renderCalls.every((call) => call.scene === system.casterScene),
  true,
  "renderShadow must draw the caster scene passed in the frame",
);
assert.equal(
  firstRenderer.renderCalls.every((call) => call.target?.depthTexture),
  true,
  "each scheduled level render must bind a target with a DepthTexture",
);
assert.equal(
  firstRenderer.renderCalls.every((call) => call.camera?.isOrthographicCamera),
  true,
  "each scheduled level render must use a fitted OrthographicCamera",
);
assert.equal(
  system.node.lastSelection.selected.every((item) => item.level.renderCount > 0),
  true,
  "renderShadow must commit only after selected levels are rendered",
);
const debugSnapshot = system.debugSnapshot();
assert(debugSnapshot.levelCount > 0);
assert.equal(debugSnapshot.targetCount, system.levels.length);
assert.equal(debugSnapshot.colorAttachmentCount, system.levels.length);
assert.equal(debugSnapshot.depthAttachmentCount, system.levels.length);
assert.equal(debugSnapshot.receiverSampledTextureCount, 0);
assert(debugSnapshot.nominalTargetBytes > 0);

const secondRenderer = createMockRenderer();
const validLevelIndicesBeforeDeformation = system.levels
  .filter((level) => level.valid)
  .map((level) => level.index);
await system.update(
  { x: 4, y: 8, z: 12 },
  {
    renderer: secondRenderer,
    frameId: 2,
    deformationTime: 1,
    deformationBoundsLightSpace: { x: 20, y: 0, radius: 1 },
  },
);
assert.equal(
  system.node.lastSelection.deformationInvalidations.length,
  1,
  "changing the displacement field time must invalidate cached shadow levels",
);
assert.equal(
  system.node.lastSelection.deformationInvalidations[0].touched.length,
  validLevelIndicesBeforeDeformation.length,
  "the swept bound must invalidate every previously committed intersecting level",
);
assert.deepEqual(
  system.node.lastSelection.deformationInvalidations[0].touched.map((entry) => entry.index),
  validLevelIndicesBeforeDeformation,
);
assert(
  system.node.lastSelection.deformationInvalidations[0].sweptBounds.radius > 1,
  "deformation invalidation must enclose motion between previous/current bounds",
);
assert(
  system.node.lastSelection.selected.some((item) => item.forced),
  "deformation dirty bits must force at least one cached level through scheduling",
);
assert.equal(
  system.node.lastSelection.selected.filter((item) => item.forced).length,
  config.correctionBudget,
  "content repair must obey its separate correction-queue cap",
);
assert.equal(
  secondRenderer.renderCalls.length,
  system.node.lastSelection.selected.length,
  "ordinary never-rendered fills and correction repairs must each match one target render",
);
assert(
  system.levels.some((level) => level.valid === false),
  "unrepaired content-invalid levels must remain excluded from receiver weights",
);
let geometryDisposeEvents = 0;
let materialDisposeEvents = 0;
system.displacedCaster.mesh.geometry.addEventListener("dispose", () => {
  geometryDisposeEvents += 1;
});
system.displacedCaster.material.addEventListener("dispose", () => {
  materialDisposeEvents += 1;
});
system.dispose();
assert.equal(validateDisposeCounters(system.node).ok, true);
assert.equal(geometryDisposeEvents, 1);
assert.equal(materialDisposeEvents, 1);
const disposalSnapshot = { ...system.node.disposeCounters };
system.dispose();
assert.deepEqual(system.node.disposeCounters, disposalSnapshot, "system disposal must be idempotent");
assert.equal(system.disposed, true);

const parity = createSharedDisplacedCaster();
assert.equal(
  parity.material.positionNode,
  parity.material.castShadowPositionNode,
  "visible positionNode and castShadowPositionNode must be the same node object",
);
assert.equal(
  parity.material.receivedShadowPositionNode,
  null,
  "receivedShadowPositionNode must preserve the default world-space positionWorld path",
);
assert.notEqual(
  parity.material.receivedShadowPositionNode,
  parity.material.positionNode,
  "a local-space displacement node must never be assigned to receivedShadowPositionNode",
);
assert.equal(
  parity.mesh.userData.shadowCasterParity.sharedPositionNode,
  parity.material.positionNode,
  "the example must expose the shared displacement node identity for validation",
);
parity.mesh.geometry.dispose();
parity.material.dispose();

const directNode = Object.create(CachedClipmapShadowNode.prototype);
directNode.light = { shadow: {} };
directNode.config = config;
directNode.implementationStatus = CLIPMAP_IMPLEMENTATION_STATUS;
directNode.levels = createClipmapLevels(config);
directNode.disposeCounters = {
  attachmentDetaches: 0,
  levelTargets: 0,
};
assert.equal(directNode.setupShadowCoord(null, "shadowPositionWorld").hook, "setupShadowCoord");
assert.equal(directNode.setupShadowFilter(null, {}).length, directNode.levels.length);
assert.throws(
  () => directNode.setup({ renderer: {} }),
  /Phase-1 scheduler scaffold/,
  "a real builder must fail fast until production receiver blending exists",
);

assert.equal(
  Boolean(DIRTY_REASON_BITS.forceDirty),
  true,
  "dirty reason bits must expose forced invalidation",
);
assert.equal(
  Boolean(DIRTY_REASON_BITS.deformationChanged),
  true,
  "dirty reason bits must expose deformation-aware invalidation",
);

const artifactStatus = validateArtifacts(args);
if (artifactStatus.ok) {
  console.log(`gpu artifact validation: ${artifactStatus.status}`);
  console.log("webgpu-cached-clipmap-shadow Phase-1 scaffold validation passed");
} else if (args.allowMissingGpu) {
  console.log(`gpu artifact validation: not-run (${artifactStatus.reason})`);
  console.log("webgpu-cached-clipmap-shadow Phase-1 scaffold validation passed");
} else {
  console.error(`gpu artifact validation: not-run (${artifactStatus.reason})`);
  process.exitCode = 1;
}

function createMockRenderer() {
  return {
    toneMapping: 0,
    toneMappingExposure: 1,
    outputColorSpace: "srgb",
    autoClear: false,
    currentTarget: null,
    activeCubeFace: 3,
    activeMipmapLevel: 2,
    renderObjectFunction: () => {},
    pixelRatio: 1,
    mrt: { fixture: true },
    clearColor: 0x123456,
    clearAlpha: 0.25,
    scissorTest: true,
    renderCalls: [],
    setRenderTargetCalls: [],
    getRenderTarget() {
      return this.currentTarget;
    },
    getActiveCubeFace() {
      return this.activeCubeFace;
    },
    getActiveMipmapLevel() {
      return this.activeMipmapLevel;
    },
    setRenderTarget(target, activeCubeFace = 0, activeMipmapLevel = 0) {
      this.currentTarget = target;
      this.activeCubeFace = activeCubeFace;
      this.activeMipmapLevel = activeMipmapLevel;
      this.setRenderTargetCalls.push(target);
    },
    getRenderObjectFunction() {
      return this.renderObjectFunction;
    },
    setRenderObjectFunction(value) {
      this.renderObjectFunction = value;
    },
    getPixelRatio() {
      return this.pixelRatio;
    },
    setPixelRatio(value) {
      this.pixelRatio = value;
    },
    getMRT() {
      return this.mrt;
    },
    setMRT(value) {
      this.mrt = value;
    },
    getClearColor(target) {
      return target.set(this.clearColor);
    },
    getClearAlpha() {
      return this.clearAlpha;
    },
    setClearColor(value, alpha = 1) {
      this.clearColor = value;
      this.clearAlpha = alpha;
    },
    getScissorTest() {
      return this.scissorTest;
    },
    setScissorTest(value) {
      this.scissorTest = value;
    },
    render(scene, camera) {
      this.renderCalls.push({
        scene,
        camera,
        target: this.currentTarget,
        autoClear: this.autoClear,
      });
    },
  };
}

function parseArgs(argv) {
  const parsed = {
    allowMissingGpu: false,
    artifactsDir: null,
    claim: CLIPMAP_IMPLEMENTATION_STATUS.phase,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--allow-missing-gpu") {
      parsed.allowMissingGpu = true;
    } else if (arg === "--artifacts") {
      parsed.artifactsDir = argv[index + 1] ? resolve(argv[index + 1]) : null;
      index += 1;
    } else if (arg === "--claim") {
      parsed.claim = argv[index + 1] ?? "";
      index += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function validateArtifacts({ artifactsDir }) {
  if (!artifactsDir) {
    return { ok: false, reason: "missing --artifacts <dir>" };
  }

  const shadowMapPath = resolve(artifactsDir, "shadow-map.png");
  const silhouettePath = resolve(artifactsDir, "silhouette.png");
  const metadataPath = resolve(artifactsDir, "shadow-capture.json");
  if (!existsSync(shadowMapPath) || !existsSync(silhouettePath) || !existsSync(metadataPath)) {
    return {
      ok: false,
      reason: `expected ${shadowMapPath}, ${silhouettePath}, and ${metadataPath}`,
    };
  }

  const shadowMap = readFileSync(shadowMapPath);
  const silhouette = readFileSync(silhouettePath);
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  assert.equal(metadata.threeRevision, "185");
  assert.equal(metadata.isWebGPUBackend, true);
  assert.equal(metadata.implementationPhase, CLIPMAP_IMPLEMENTATION_STATUS.phase);
  assert.equal(
    metadata.productionClipmapProof,
    false,
    "artifact metadata must not claim production receiver proof",
  );
  assert.equal(
    metadata.attachedToLight,
    false,
    "the browser scaffold must leave its incomplete receiver node detached",
  );
  assert.equal(metadata.receiverBlendImplemented, false);
  assert.equal(metadata.sharedPositionNode, true);
  assert(Number.isInteger(metadata.renderedLevels) && metadata.renderedLevels > 0);
  assert.match(metadata.firstDepthTexture, /^cached-clipmap-shadow-depth-\d+$/);

  const depthPng = decodeRgba8Png(shadowMap, "shadow-map.png");
  const maskPng = decodeRgba8Png(silhouette, "silhouette.png");
  assert.equal(depthPng.width, maskPng.width);
  assert.equal(depthPng.height, maskPng.height);
  assert.equal(depthPng.width, metadata.captureSize);
  assert.equal(depthPng.height, metadata.captureSize);

  const pixelCount = depthPng.width * depthPng.height;
  let depthCovered = 0;
  let depthMinimum = 255;
  let depthMaximum = 0;
  let maskCovered = 0;
  let differingCoveredPixels = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    const depthValue = depthPng.data[offset];
    const maskValue = maskPng.data[offset];
    assert.equal(depthPng.data[offset + 3], 255, "depth PNG must be opaque");
    assert.equal(maskPng.data[offset + 3], 255, "mask PNG must be opaque");
    assert(
      maskValue === 0 || maskValue === 255,
      "silhouette PNG must remain binary",
    );
    if (depthValue > 0) {
      depthCovered += 1;
      depthMinimum = Math.min(depthMinimum, depthValue);
      depthMaximum = Math.max(depthMaximum, depthValue);
    }
    if (maskValue === 255) {
      maskCovered += 1;
      if (depthValue !== maskValue) differingCoveredPixels += 1;
    }
  }
  assert(depthCovered > 0 && depthCovered < pixelCount, "depth PNG needs foreground and background");
  assert(maskCovered > 0 && maskCovered < pixelCount, "silhouette PNG needs foreground and background");
  assert(depthMaximum > depthMinimum, "depth PNG needs a non-constant rendered depth ramp");
  const minimumDifferingCoverage = Math.ceil(maskCovered / 2); // Gated fixture evidence threshold.
  assert(
    differingCoveredPixels >= minimumDifferingCoverage,
    "at least half the silhouette coverage must differ from its depth visualization",
  );

  return { ok: true, status: `diffed ${shadowMapPath} against ${silhouettePath}` };
}

function decodeRgba8Png(buffer, label) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert(buffer.subarray(0, 8).equals(signature), `${label} has an invalid PNG signature`);
  let offset = 8;
  let width;
  let height;
  const idat = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    assert(dataEnd + 4 <= buffer.length, `${label} has a truncated ${type} chunk`);
    if (type === "IHDR") {
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);
      assert.equal(buffer[dataStart + 8], 8, `${label} must be 8-bit`);
      assert.equal(buffer[dataStart + 9], 6, `${label} must be RGBA`);
      assert.equal(buffer[dataStart + 12], 0, `${label} must be non-interlaced`);
    } else if (type === "IDAT") {
      idat.push(buffer.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }
  assert(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0);
  assert(idat.length > 0, `${label} has no IDAT data`);

  const bytesPerPixel = 4; // Derived from RGBA8.
  const rowBytes = width * bytesPerPixel;
  const inflated = inflateSync(Buffer.concat(idat));
  assert.equal(inflated.length, height * (rowBytes + 1));
  const data = Buffer.alloc(width * height * bytesPerPixel);
  let source = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[source++];
    const row = y * rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = inflated[source++];
      const left = x >= bytesPerPixel ? data[row + x - bytesPerPixel] : 0;
      const up = y > 0 ? data[row - rowBytes + x] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel
        ? data[row - rowBytes + x - bytesPerPixel]
        : 0;
      let reconstructed;
      if (filter === 0) reconstructed = raw;
      else if (filter === 1) reconstructed = raw + left;
      else if (filter === 2) reconstructed = raw + up;
      else if (filter === 3) reconstructed = raw + Math.floor((left + up) / 2);
      else if (filter === 4) reconstructed = raw + paeth(left, up, upLeft);
      else assert.fail(`${label} uses unsupported PNG filter ${filter}`);
      data[row + x] = reconstructed & 0xff;
    }
  }
  return { width, height, data };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}
