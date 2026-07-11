import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DirectionalLight,
  Group,
  PerspectiveCamera,
  Scene,
  Vector3,
} from "three/webgpu";

import {
  CACHED_CLIPMAP_V2_STATUS,
  CachedClipmapShadowNodeV2,
  deriveStableLightBasis,
  worldPositionInParentSpace,
} from "./cached-clipmap-shadow-node-v2.js";
import {
  commitLevelRender,
  createClipmapLevels,
  selectLevelsForUpdateFair,
  validateClipmapConfig,
} from "./clipmap-config.js";
import {
  SHADOW_CASTER_CLASSES,
  compactAlignedRgbaRows,
} from "./canonical-lab.js";
import { validateComparableFrameMetrics } from "./shadow-architectures.js";
import {
  SHADOW_MECHANISM_ROUTES,
  SHADOW_QUALITY_TIERS,
  configForShadowTier,
  mechanismIdForShadowScenario,
  resolveLockedShadowRoute,
  validateMechanismActionContract,
} from "./routes.js";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(here, "lab.manifest.json"), "utf8"));
const canonicalHtml = readFileSync(resolve(here, "canonical.html"), "utf8");
const canonicalSource = readFileSync(resolve(here, "canonical-lab.js"), "utf8");
const packageJson = JSON.parse(readFileSync(resolve(here, "package.json"), "utf8"));

assert.equal(manifest.schemaVersion, 2);
assert.equal(manifest.status, "incomplete");
assert.equal(CACHED_CLIPMAP_V2_STATUS.receiverBlendImplemented, true);
assert.equal(CACHED_CLIPMAP_V2_STATUS.childShadowNodesOwnTargets, true);
assert.equal(
  CACHED_CLIPMAP_V2_STATUS.productionClipmapProof,
  false,
  "static validation must not promote a native-WebGPU evidence claim",
);

for (const tierId of Object.keys(SHADOW_QUALITY_TIERS)) {
  const config = configForShadowTier(tierId);
  const validation = validateClipmapConfig(config);
  assert.equal(validation.ok, true, `${tierId}: ${validation.errors.join("; ")}`);
  assert.deepEqual(config.mapSizes, [...SHADOW_QUALITY_TIERS[tierId].mapSizes]);
  assert.equal(
    SHADOW_QUALITY_TIERS[tierId].performanceStatus,
    "INSUFFICIENT_EVIDENCE",
  );
  const route = resolveLockedShadowRoute(`/demos/lab/tier/${tierId}/`);
  assert.equal(route.tierId, tierId);
  assert.equal(route.kind, "tier-demo");
}

for (const mechanismId of Object.keys(SHADOW_MECHANISM_ROUTES)) {
  const route = resolveLockedShadowRoute(`/demos/lab/mechanism/${mechanismId}/`);
  assert.equal(route.mechanismId, mechanismId);
  assert.equal(route.kind, "mechanism-demo");
  assert.equal(route.scenario, SHADOW_MECHANISM_ROUTES[mechanismId].scenario);
  assert.deepEqual(route.actions, SHADOW_MECHANISM_ROUTES[mechanismId].actions);
  assert.equal(
    mechanismIdForShadowScenario(route.scenario),
    mechanismId,
    `${route.scenario} must resolve to its sole mechanism implementation`,
  );
}
assert.deepEqual(validateMechanismActionContract(), { valid: true, errors: [] });
assert.throws(
  () => resolveLockedShadowRoute("/demos/lab/mechanism/not-real/"),
  /unknown shadow mechanism/,
);
assert.throws(
  () => resolveLockedShadowRoute("/demos/lab/tier/not-real/"),
  /unknown shadow tier/,
);
assert.throws(() => mechanismIdForShadowScenario("not-real"), /unknown shadow scenario/);

const direction = new Vector3(-0.31, -0.88, -0.36).normalize();
const basis = deriveStableLightBasis(direction);
for (const vector of [basis.direction, basis.right, basis.up]) {
  assert(Math.abs(vector.length() - 1) < 1e-12);
}
assert(Math.abs(basis.direction.dot(basis.right)) < 1e-12);
assert(Math.abs(basis.direction.dot(basis.up)) < 1e-12);
assert(Math.abs(basis.right.dot(basis.up)) < 1e-12);
assert(
  new Vector3().crossVectors(basis.direction, basis.right).dot(basis.up) > 1 - 1e-12,
  "light basis must be right-handed under the declared direction/right/up convention",
);

const fairConfig = {
  ...configForShadowTier("reduced"),
  dynamicLevels: 0,
  updateBudget: 1,
  correctionBudget: 1,
  maxCacheAge: 0,
};
const fairLevels = createClipmapLevels(fairConfig);
for (const level of fairLevels) {
  level.valid = true;
  level.centerX = 0;
  level.centerY = 0;
  level.centerZ = 0;
  level.age = 0;
}
const schedulerState = { roundRobinCursor: 0 };
const selectedCounts = new Map(fairLevels.map((level) => [level.index, 0]));
for (let frame = 0; frame < fairLevels.length * 2; frame += 1) {
  const selection = selectLevelsForUpdateFair({
    levels: fairLevels,
    cameraLight: { x: 0, y: 0, z: 0 },
    config: fairConfig,
    schedulerState,
    frameId: frame,
  });
  assert.equal(selection.selected.length, 1);
  const selected = selection.selected[0];
  selectedCounts.set(selected.level.index, selectedCounts.get(selected.level.index) + 1);
  commitLevelRender(selected.level, selected.desired);
  selected.level.lastUpdateFrame = frame;
}
assert(
  [...selectedCounts.values()].every((count) => count > 0),
  `age-priority/round-robin scheduler starved a level: ${JSON.stringify([...selectedCounts])}`,
);

fairLevels.at(-1).forceDirty = true;
fairLevels.at(-1).valid = false;
const correction = selectLevelsForUpdateFair({
  levels: fairLevels,
  cameraLight: { x: 0, y: 0, z: 0 },
  config: fairConfig,
  schedulerState,
  frameId: 999,
});
assert.equal(correction.selected[0].level.index, fairLevels.at(-1).index);
assert.equal(correction.selected[0].forced, true);

const transformedParent = new Group();
transformedParent.position.set(17, -5, 23);
transformedParent.rotation.set(0.31, -0.47, 0.19);
transformedParent.scale.set(1.7, 0.6, 2.3);
const runtimeScene = new Scene();
runtimeScene.add(transformedParent);
const light = new DirectionalLight();
light.position.set(5, 17, 9);
light.target.position.set(-2, 1, -3);
transformedParent.add(light, light.target);
runtimeScene.updateMatrixWorld(true);
const runtimeCamera = new PerspectiveCamera();
runtimeCamera.position.set(3, 8, 21);
runtimeCamera.updateMatrixWorld(true);
const node = new CachedClipmapShadowNodeV2(light, configForShadowTier("reduced"));
assert.equal(node.childShadowNodes.length, node.levels.length);
assert.equal(node.levelLights.length, node.levels.length);
assert(
  node.childShadowNodes.every((child, index) => child.shadow === node.levelLights[index].shadow),
  "each receiver child must own the same cloned shadow used for its render target",
);
assert.equal(
  node.describePipeline().receiverTopology,
  "independent-textures-static-loop-frustum-gated",
);
let fakeShadowSubmissionCount = 0;
for (const child of node.childShadowNodes) {
  child.shadowMap = {
    width: child.shadow.mapSize.width,
    height: child.shadow.mapSize.height,
    texture: { name: "", format: 1023 },
    depthTexture: { name: "", format: 1026 },
    dispose() {},
  };
  child.updateShadow = () => {
    fakeShadowSubmissionCount += 1;
    child.shadow.updateMatrices(child.light);
  };
}
const frame = {
  renderer: { backend: { isWebGPUBackend: true } },
  scene: runtimeScene,
  camera: runtimeCamera,
  frameId: 0,
  renderId: 1,
};
node.updateBefore(frame);
const firstFrame = node.describePipeline();
assert.equal(firstFrame.frameMetrics.sceneSubmissionCount, node.levels.length);
assert.equal(firstFrame.frameMetrics.sceneSubmissionCount, firstFrame.selectedUpdates.length);
assert.deepEqual(
  firstFrame.selectedUpdates,
  firstFrame.frameMetrics.selectedLevelIndices,
  "pending work must not alias and erase the committed selection trace",
);
assert.equal(fakeShadowSubmissionCount, node.levels.length);
assert.deepEqual(validateComparableFrameMetrics(firstFrame.frameMetrics), {
  valid: true,
  errors: [],
});

const firstLevel = node.levels[0];
const expectedTargetWorld = node.basis.anchor
  .clone()
  .addScaledVector(node.basis.right, firstLevel.centerX)
  .addScaledVector(node.basis.up, firstLevel.centerY)
  .addScaledVector(node.basis.direction, firstLevel.centerZ);
const actualTargetWorld = firstLevel.levelLight.target.getWorldPosition(new Vector3());
const expectedLightWorld = expectedTargetWorld
  .clone()
  .addScaledVector(node.basis.direction, -node.config.lightMargin);
const actualLightWorld = firstLevel.levelLight.getWorldPosition(new Vector3());
assert(actualTargetWorld.distanceTo(expectedTargetWorld) < 1e-10);
assert(actualLightWorld.distanceTo(expectedLightWorld) < 1e-10);
const projectedTarget = expectedTargetWorld.clone().applyMatrix4(firstLevel.levelLight.shadow.matrix);
assert(Math.abs(projectedTarget.x - 0.5) < 1e-10);
assert(Math.abs(projectedTarget.y - 0.5) < 1e-10);

frame.renderId = 2;
node.updateBefore(frame);
const secondFrame = node.describePipeline();
assert.equal(secondFrame.frameMetrics.sceneSubmissionCount, node.config.dynamicLevels);
assert.equal(secondFrame.cumulativeMetrics.sceneSubmissionCount, node.levels.length + node.config.dynamicLevels);
assert.equal(secondFrame.frameMetrics.frameId, firstFrame.frameMetrics.frameId + 1);
assert.equal(secondFrame.frameMetrics.nodeFrameId, 0);
assert.equal(secondFrame.frameMetrics.renderId, 2);
assert.equal(fakeShadowSubmissionCount, node.levels.length + node.config.dynamicLevels);

const singularParent = new Group();
singularParent.scale.set(0, 1, 1);
singularParent.updateMatrixWorld(true);
assert.throws(
  () => worldPositionInParentSpace(singularParent, new Vector3(1, 2, 3)),
  /finite and invertible/,
);
node.levels[0].valid = true;
node.setLevelSamplingEnabled(0, false);
assert.equal(node.levelUniforms[0].valid.value, 0);
node.setLevelSamplingEnabled(0, true);
assert.equal(node.levelUniforms[0].valid.value, 1);
node.setLevelBias(0, { bias: -0.0001, normalBias: 0.01 });
assert.equal(node.levelLights[0].shadow.bias, -0.0001);
assert.equal(node.levelLights[0].shadow.normalBias, 0.01);
assert.throws(
  () => node.setLevelBias(0, { bias: 0, normalBias: 1e6 }),
  /contact-detachment gate/,
);
const contentEpochsBeforeAddedCaster = node.levels.map((level) => level.contentEpoch);
node.notifyCasterBounds({
  id: "new-runtime-caster",
  version: 1,
  centerWorld: node.basis.anchor,
  radius: 1e6,
});
frame.renderId = 3;
node.updateBefore(frame);
const addedCasterInvalidation = node.lastSelection.deformationInvalidations.find(
  (entry) => entry.id === "new-runtime-caster",
);
assert.equal(addedCasterInvalidation.change, "added");
assert.equal(addedCasterInvalidation.touched.length, node.levels.length);
assert(
  node.levels.every(
    (level, index) => level.contentEpoch > contentEpochsBeforeAddedCaster[index],
  ),
  "a newly observed caster must invalidate previously committed coverage",
);
const removedCasterInvalidations = node.removeCasterBounds("new-runtime-caster");
assert.equal(
  removedCasterInvalidations.length,
  node.levels.length,
  "removing a caster must invalidate its previous committed footprint",
);
node.attachToLight();
assert.equal(light.shadow.shadowNode, node);
node.dispose();
assert.equal(light.shadow.shadowNode, undefined);
assert(node.levels.every((level) => level.disposed));
assert(node.levels.every((level) => level.shadowTarget === null));

assert.deepEqual(SHADOW_CASTER_CLASSES, [
  "alpha-tested",
  "shared-wind-displacement",
  "instanced",
  "morph-target",
  "skinned-two-bone",
]);
assert.match(canonicalSource, /new SkinnedMesh\(/);
assert.match(canonicalHtml, /\.\.\/\.\.\/\.\.\/node_modules\/three\/build\/three\.webgpu\.js/);
assert.doesNotMatch(canonicalHtml, /"\.\/node_modules\//);
assert.match(canonicalHtml, /globalThis\.__LAB_CONTROLLER__ = controller/);
assert.match(canonicalHtml, /locked route rejects tier override/);
assert.match(canonicalHtml, /mechanismIdForShadowScenario\(requestedScenario\)/);
assert.match(canonicalHtml, /controller\.setCamera\(requestedCamera\)/);
assert.match(canonicalHtml, /removeEventListener\("resize", onResize\)/);
assert.equal(
  packageJson.scripts.capture,
  "node ../../../scripts/capture-lab-browser.mjs --lab webgpu-cached-clipmap-shadow --target final",
  "canonical capture must use the root self-serving browser harness for this lab",
);
assert.equal(packageJson.scripts["capture:evidence"], "node capture-canonical.mjs");

const oddWidth = 641;
const oddHeight = 359;
const rowBytes = oddWidth * 4;
const alignedStride = Math.ceil(rowBytes / 256) * 256;
const padded = new Uint8Array(alignedStride * (oddHeight - 1) + rowBytes);
for (let y = 0; y < oddHeight; y += 1) {
  padded.fill(y & 0xff, y * alignedStride, y * alignedStride + rowBytes);
}
const packed = compactAlignedRgbaRows(padded, oddWidth, oddHeight);
assert.equal(packed.length, rowBytes * oddHeight);
for (let y = 0; y < oddHeight; y += 1) {
  assert.equal(packed[y * rowBytes], y & 0xff);
  assert.equal(packed[(y + 1) * rowBytes - 1], y & 0xff);
}
assert.throws(
  () => compactAlignedRgbaRows(new Uint8Array(rowBytes * oddHeight - 1), oddWidth, oddHeight),
  /invalid WebGPU RGBA row layout/,
);

const source = readFileSync(resolve(here, "cached-clipmap-shadow-node-v2.js"), "utf8");
assert.match(source, /this\.childShadowNodes\[index\]\.mul\(weight\)/);
assert.match(source, /child\.updateShadow\(frame\)/);
assert.doesNotMatch(source, /renderer\.render\(casterScene/);
assert.match(source, /levelUniform\.valid/);
assert.match(source, /renderedContentEpoch/);

console.log("webgpu-cached-clipmap-shadow v2 static/runtime-contract validation passed");
console.log("native-WebGPU acceptance verdict: INSUFFICIENT_EVIDENCE (full v2 bundle not promoted)");
