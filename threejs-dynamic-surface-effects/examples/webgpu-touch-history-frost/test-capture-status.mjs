import assert from "node:assert/strict";

import { evaluateFrostCaptureStatus } from "./capture-status.mjs";
import { FROST_ALL_CAPTURE_RECIPES } from "./capture-recipes.js";

const missing = evaluateFrostCaptureStatus();
assert.equal(missing.verdict, "INSUFFICIENT_EVIDENCE");
assert.equal(missing.syntheticEvidenceCreated, false);

const outputPlan = [
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
].map((filename) => ({
  filename,
  status: "CAPTURED",
  artifact: { path: filename, sha256: `sha256:${"0".repeat(64)}` },
  derivation: { validationStatus: "PASS" },
}));
const session = {
  labId: "webgpu-touch-history-frost",
  profile: "correctness",
  automationSurface: "playwright-headless-chromium",
  threeRevision: "0.185.1",
  sourceClosure: { sourceHash: "sha256:source" },
  runtime: { metrics: { nativeWebGPU: true, rendererBackendEvidence: { isWebGPUBackend: true, deviceIdentityVerified: true } } },
  pageErrors: [],
  consoleErrors: [],
  requestErrors: [],
  route: {
    manifestLabId: "webgpu-touch-history-frost",
    observedRuntimeLabId: "webgpu-touch-history-frost",
    lockedState: { tier: "full" },
    finalState: { tier: "full" },
  },
  outputPlan,
  hookResult: {
    captures: FROST_ALL_CAPTURE_RECIPES.map(({ id: recipeId }) => ({ recipeId })),
    visualDifferences: { verdict: "PASS" },
    coverageEvidence: { verdict: "PASS" },
    lifecycleEvidence: {
      verdict: "PASS",
      cycles: { value: 50 },
      cycleSnapshots: Array.from({ length: 50 }, (_, index) => ({ index })),
    },
  },
};
const stale = evaluateFrostCaptureStatus({
  session,
  expectedSourceHash: "sha256:other",
  artifactRoot: "/path/that/must/not/be-read-for-stale-capture",
  bundleValidation: {
    valid: true,
    protocol: "unified-v2",
    manifest: {
      sourceClosureHash: "sha256:source",
      claimVerdicts: { mechanismCorrectness: "PASS", lifecycleStability: "PASS" },
      files: [],
    },
  },
});
assert.equal(stale.verdict, "FAIL");
assert(stale.failures.includes("capture source hash is stale"));
assert.equal(stale.provenClaims.length, 0);

const substituted = structuredClone(session);
substituted.hookResult.captures.at(-1).recipeId = FROST_ALL_CAPTURE_RECIPES[0].id;
const substitutedResult = evaluateFrostCaptureStatus({
  session: substituted,
  expectedSourceHash: "sha256:source",
  artifactRoot: "/path/that-must-not-exist",
  bundleValidation: {
    valid: true,
    protocol: "unified-v2",
    manifest: {
      sourceClosureHash: "sha256:source",
      claimVerdicts: { mechanismCorrectness: "PASS", lifecycleStability: "PASS" },
      files: [],
    },
  },
});
assert(substitutedResult.failures.includes(
  `capture hook recipe set differs from the ${FROST_ALL_CAPTURE_RECIPES.length}-recipe canonical order`,
));

console.log("frost capture status contract passed");
