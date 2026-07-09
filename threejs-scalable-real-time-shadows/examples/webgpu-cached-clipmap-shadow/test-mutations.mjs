import assert from "node:assert/strict";
import { Group, Object3D, Vector3 } from "three/webgpu";

import { worldPositionInParentSpace } from "./cached-clipmap-shadow-node-v2.js";
import { validateClipmapConfig } from "./clipmap-config.js";
import { validateComparableFrameMetrics } from "./shadow-architectures.js";
import {
  SHADOW_MECHANISM_ROUTES,
  configForShadowTier,
  resolveLockedShadowRoute,
  validateMechanismActionContract,
} from "./routes.js";

const invalidBudget = configForShadowTier("high");
invalidBudget.updateBudget = 0;
assert.equal(
  validateClipmapConfig(invalidBudget).ok,
  false,
  "zero update budget must not pass the clipmap contract",
);

const impossibleBindingBudget = configForShadowTier("high");
impossibleBindingBudget.sampledTextureLimit = 1;
assert.equal(
  validateClipmapConfig(impossibleBindingBudget).ok,
  false,
  "a sampled-texture limit below the derived level count must be rejected",
);

assert.throws(
  () => resolveLockedShadowRoute("/demos/webgpu-cached-clipmap-shadow/mechanism/generated-ramp/"),
  /unknown shadow mechanism/,
  "a synthetic depth-ramp route must not enter canonical coverage",
);
assert.throws(
  () => resolveLockedShadowRoute("/demos/webgpu-cached-clipmap-shadow/tier/secret-cheaper-tier/"),
  /unknown shadow tier/,
  "undeclared cheaper tiers must not be fabricated",
);

const missingAction = structuredClone(SHADOW_MECHANISM_ROUTES);
missingAction["texel-snap-and-pan"].actions = [];
assert.match(
  validateMechanismActionContract(missingAction).errors.join("; "),
  /at least one executable action/,
  "a label-only mechanism route must fail",
);

const duplicateAction = structuredClone(SHADOW_MECHANISM_ROUTES);
duplicateAction["bias-sweep"].actions = [
  ...duplicateAction["texel-snap-and-pan"].actions,
];
assert.match(
  validateMechanismActionContract(duplicateAction).errors.join("; "),
  /duplicates another mechanism route/,
  "two mechanisms may not silently run the same action sequence",
);

const cumulativeMasqueradingAsFrame = {
  scope: "cumulative-since-create",
  frameId: 4,
  sceneSubmissionCount: 9,
  rendererInvocationCount: 9,
  shadowViewCount: 9,
  backendLayerPassCount: 9,
  resourceTargetCount: 7,
};
assert.match(
  validateComparableFrameMetrics(cumulativeMasqueradingAsFrame).errors.join("; "),
  /single-render-frame/,
  "cumulative counters must not pass as comparable per-frame evidence",
);

const fabricatedZeroCostFrame = {
  scope: "single-render-frame",
  frameId: 5,
  executed: true,
  provenance: "Measured-runtime-counter",
  sceneSubmissionCount: 0,
  rendererInvocationCount: 0,
  shadowViewCount: 0,
  backendLayerPassCount: 0,
  resourceTargetCount: 7,
};
assert.match(
  validateComparableFrameMetrics(fabricatedZeroCostFrame).errors.join("; "),
  /cannot report zero scene submissions/,
  "an executed architecture must not pass with fabricated zero render work",
);

const mismatchedBackendPasses = {
  ...fabricatedZeroCostFrame,
  sceneSubmissionCount: 2,
  rendererInvocationCount: 2,
  shadowViewCount: 2,
  backendLayerPassCount: 1,
};
assert.match(
  validateComparableFrameMetrics(mismatchedBackendPasses).errors.join("; "),
  /must equal backend layer passes/,
  "reported submissions must reconcile with backend layer work",
);

const transformedParent = new Group();
transformedParent.position.set(17, -5, 23);
transformedParent.rotation.set(0.31, -0.47, 0.19);
transformedParent.scale.set(1.7, 0.6, 2.3);
const child = new Object3D();
transformedParent.add(child);
transformedParent.updateMatrixWorld(true);
const requestedWorld = new Vector3(-9, 12, 31);
child.position.copy(requestedWorld);
child.updateMatrixWorld(true);
assert(
  child.getWorldPosition(new Vector3()).distanceTo(requestedWorld) > 1,
  "the raw world-to-local placement mutation unexpectedly survived a transformed parent",
);
child.position.copy(
  worldPositionInParentSpace(transformedParent, requestedWorld),
);
child.updateMatrixWorld(true);
assert(
  child.getWorldPosition(new Vector3()).distanceTo(requestedWorld) < 1e-10,
  "the canonical parent-space conversion did not repair the mutation",
);

console.log("webgpu-cached-clipmap-shadow mutation gates passed");
