import assert from "node:assert/strict";

import {
  assertFrostRecipeCapture,
  composeFrostDiagnosticMosaic,
  outputPlan,
  rgbDifferenceMetrics,
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
      viewport: { width: 1200, height: 800, dpr: 1 },
    },
    execution: {
      pointerSegmentCount: recipe.trace.length,
      computeDispatchDelta: recipe.trace.length,
      renderSubmissionDelta: 1,
      sameFrameComposite: true,
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
