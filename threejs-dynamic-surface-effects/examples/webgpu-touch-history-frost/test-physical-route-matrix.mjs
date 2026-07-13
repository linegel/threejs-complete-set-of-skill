import assert from "node:assert/strict";

import {
  FROST_PHYSICAL_ROUTE_MATRIX,
  validateFrostPhysicalRouteMatrix,
  validateFrostPhysicalRouteObservation,
} from "./physical-route-matrix.js";

const digest = `sha256:${"1".repeat(64)}`;

function observation(route, index) {
  return {
    recipeId: route.recipeId,
    staticPath: route.staticPath,
    finalUrl: `http://127.0.0.1:4323${route.staticPath}?physicalReview=1&route=${index}`,
    controllerReady: true,
    nativeWebGPU: true,
    deviceIdentityVerified: true,
    adapterClass: "hardware",
    mechanismControlLocked: route.locks.mechanism,
    tierControlLocked: route.locks.tier,
    observedState: structuredClone(route.startup),
    finalPixelHash: digest,
    disposeEvidence: { status: "PASS", retainedStorageBytes: 0, retainedTargetBytes: 0 },
    errors: { page: [], console: [], request: [], device: [], postDisposal: [] },
  };
}

assert.equal(FROST_PHYSICAL_ROUTE_MATRIX.length, 10);
assert.deepEqual(FROST_PHYSICAL_ROUTE_MATRIX.map(({ staticPath }) => staticPath), [
  "/index.html",
  "/mechanism/history-and-deposit/index.html",
  "/mechanism/diffusion/index.html",
  "/mechanism/blur-and-reconstruction/index.html",
  "/mechanism/crystal-field-and-normals/index.html",
  "/mechanism/refraction-and-fresnel/index.html",
  "/mechanism/full-vs-dirty-vs-idle/index.html",
  "/tier/full/index.html",
  "/tier/balanced/index.html",
  "/tier/budgeted/index.html",
]);

const observations = FROST_PHYSICAL_ROUTE_MATRIX.map(observation);
assert.equal(validateFrostPhysicalRouteMatrix(observations).verdict, "PASS");
assert.equal(validateFrostPhysicalRouteObservation(FROST_PHYSICAL_ROUTE_MATRIX[0], observations[0]), true);

for (const [name, mutate, pattern] of [
  ["missing-route", (rows) => { rows.pop(); }, /all ten/],
  ["state-drift", (rows) => { rows[2].observedState.mechanism = "history-and-deposit"; }, /startup state drifted/],
  ["lock-drift", (rows) => { rows[1].mechanismControlLocked = false; }, /lock/],
  ["software-adapter", (rows) => { rows[3].adapterClass = "software"; }, /backend/],
  ["fallback-url", (rows) => { rows[4].finalUrl = "http://127.0.0.1:4323/index.html?physicalReview=1"; }, /final URL drifted/],
  ["missing-pixels", (rows) => { rows[5].finalPixelHash = null; }, /pixel hash/],
  ["retained-storage", (rows) => { rows[6].disposeEvidence.retainedStorageBytes = 8; }, /dispose cleanly/],
  ["post-disposal-error", (rows) => { rows[7].errors.postDisposal.push("late error"); }, /postDisposal errors/],
]) {
  const rows = structuredClone(observations);
  mutate(rows);
  assert.throws(() => validateFrostPhysicalRouteMatrix(rows), pattern, `${name} mutation must fail`);
}

console.log("frost immutable physical route matrix contract passed");
