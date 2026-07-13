import assert from "node:assert/strict";

import {
  assertFrostRecipeCapture,
  composeFrostDiagnosticMosaic,
  outputPlan,
  rgbDifferenceMetrics,
  validateFrostCoverageEvidence,
  validateFrostLifecycleEvidence,
} from "./capture-hook.mjs";
import { FROST_CAPTURE_RECIPES } from "./capture-recipes.js";

assert.equal(outputPlan.length, 10);
assert.deepEqual(outputPlan.map(({ filename }) => filename), [
  "final.design.png",
  "no-post.design.png",
  "diagnostics.mosaic.png",
  "camera.near.png",
  "camera.design.png",
  "camera.far.png",
  "seed-0001.final.png",
  "seed-9e3779b9.final.png",
  "temporal.t000.png",
  "temporal.t001.png",
]);
assert.deepEqual(outputPlan[2].sourceCaptures, [
  "diagnostic.previous-history-ra.png",
  "diagnostic.deposit-ra.png",
  "diagnostic.next-history-ra.png",
  "diagnostic.frost-mask-after-pointer.png",
]);

function source(r, a) {
  return { width: 2, height: 2, data: new Uint8Array([
    r, r, r, a, r, r, r, a,
    r, r, r, a, r, r, r, a,
  ]) };
}

const mosaic = composeFrostDiagnosticMosaic([
  source(10, 4),
  source(20, 6),
  source(30, 8),
  source(40, 255),
]);
assert.equal(mosaic.width, 2);
assert.equal(mosaic.height, 2);
assert.deepEqual([...mosaic.data], [
  30, 36, 12, 255,
  60, 84, 18, 255,
  90, 132, 24, 255,
  60, 60, 60, 255,
]);
assert.deepEqual(mosaic.recipe.panelOrder, [
  "diagnostic.previous-history-ra",
  "diagnostic.deposit-ra",
  "diagnostic.next-history-ra",
  "diagnostic.frost-mask-after-pointer",
]);
assert.throws(() => composeFrostDiagnosticMosaic([source(1, 1)]), /requires four/);
assert.deepEqual(rgbDifferenceMetrics(source(10, 4), source(20, 4)), {
  meanRgbBytes: 10,
  maxRgbBytes: 10,
  changedPixels: 4,
  changedFraction: 1,
});
assert.throws(() => rgbDifferenceMetrics(source(1, 1), { width: 1, height: 1, data: new Uint8Array(4) }), /equal dimensions/);
assert.throws(() => validateFrostCoverageEvidence(new Map()), /omits probe.odd-size.final/);

function lifecycleSnapshot(cycle) {
  const digest = `sha256:${String(cycle % 10).repeat(64)}`;
  return {
    rowType: "settled-lifecycle-cycle-v2",
    cycle,
    beforeDispose: { storageBytes: 1024, deviceErrors: [] },
    afterDispose: { disposed: true, storageBytes: 0, labOwnedListenerCount: 0, deviceLostObserved: false, deviceErrors: [] },
    resourcesBeforeDispose: { residentStorageBytes: 1024, opaqueRendererInternalResidency: "NOT_CLAIMED" },
    resourcesAfterDispose: {
      retainedTargetBytes: 0,
      retainedStorageBytes: 0,
      retainedMaterialCount: 0,
      retainedControlCount: 0,
      retainedListenerCount: 0,
      opaqueRendererInternalResidency: "NOT_CLAIMED",
    },
    dispose: {
      status: "PASS",
      completed: true,
      evidence: {
        status: "PASS",
        rendererStateDisposition: "OWNED_RENDERER_DISPOSED",
        rendererStateBeforeDigest: digest,
        rendererStateAfterDigest: digest,
      },
    },
    settle: { status: "PASS", observedAnimationFrames: 2, queueSettled: true, delayedErrors: [] },
  };
}

const lifecycle = validateFrostLifecycleEvidence({
  cycles: 50,
  snapshots: Array.from({ length: 50 }, (_, cycle) => lifecycleSnapshot(cycle)),
});
assert.equal(lifecycle.verdict, "PASS");
assert.equal(lifecycle.cycleSnapshots.length, 50);
assert.equal(lifecycle.cycleSnapshots[0].disposeStatus, "PASS");
assert.equal(lifecycle.cycleSnapshots[0].retainedStorageBytes.value, 0);
const lifecycleLeak = { cycles: 50, snapshots: Array.from({ length: 50 }, (_, cycle) => lifecycleSnapshot(cycle)) };
lifecycleLeak.snapshots[12].settle.delayedErrors.push("late device error");
assert.throws(() => validateFrostLifecycleEvidence(lifecycleLeak), /did not settle/);

const recipe = FROST_CAPTURE_RECIPES[0];
const digest = `sha256:${"1".repeat(64)}`;
const stateDigest = `sha256:${"2".repeat(64)}`;
const capture = {
  target: recipe.id,
  captureMode: recipe.target,
  width: 1200,
  height: 800,
  evidence: {
    recipe: { id: recipe.id, target: recipe.target, digest, setDigest: digest },
    effectiveState: {
      scenario: recipe.scenario,
      mechanism: recipe.mechanism,
      tier: recipe.tier,
      mode: recipe.target,
      camera: recipe.camera,
      seed: recipe.seed,
      timeSeconds: recipe.expectedTimeSeconds,
      viewport: { width: 1200, height: 800, dpr: 1, physicalWidth: 1200, physicalHeight: 800 },
    },
    execution: {
      pointerSegmentCount: recipe.trace.length,
      computeDispatchDelta: recipe.trace.length,
      renderSubmissionDelta: 1,
      sameFrameComposite: true,
      historyExtent: { width: 600, height: 400 },
      workgroupSize: [8, 8, 1],
      workgroupCount: [75, 50, 1],
      coveredExtent: { width: 600, height: 400 },
      boundsChecked: true,
    },
    artifactTarget: {
      kind: "render-target",
      rendererDeviceGeneration: 1,
      captureTargetId: "frost-capture-target-1",
      colorTextureUuid: "texture-uuid",
      width: 1200,
      height: 800,
      format: "rgba8unorm",
      depthBuffer: false,
      stencilBuffer: false,
    },
    transaction: {
      status: "COMMITTED",
      recipeId: recipe.id,
      restorationVerdict: "PASS",
      entryStateDigest: stateDigest,
      effectiveStateDigest: digest,
      restoredStateDigest: stateDigest,
    },
  },
};
assert.equal(assertFrostRecipeCapture(recipe, capture, digest), true);
assert.throws(() => assertFrostRecipeCapture(recipe, {
  ...structuredClone(capture),
  captureMode: "scene-color",
}, digest), /capture mode drifted/);
const forged = structuredClone(capture);
forged.evidence.transaction.restoredStateDigest = digest;
assert.throws(() => assertFrostRecipeCapture(recipe, forged, digest), /did not restore/);

console.log("frost capture hook contract passed");
