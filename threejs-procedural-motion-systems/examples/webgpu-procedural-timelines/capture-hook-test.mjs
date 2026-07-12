import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { validateCaptureOutputPlan } from "../../../scripts/capture-lab-browser.mjs";
import {
  MOTION_DIAGNOSTIC_CAPTURE_MODES,
  MOTION_DIAGNOSTIC_SOURCE_CAPTURES,
  MOTION_MECHANISM_CAPTURE_STATES,
  MOTION_STORAGE_READBACK_FIELDS,
  MOTION_STORAGE_PARITY_CHECKPOINTS,
  MOTION_STANDARD_OUTPUT_PLAN,
  analyzeMotionDiagnosticRaster,
  assertMotionCaptureState,
  composeMotionDiagnosticMosaic,
  evaluateMotionStorageParity,
  requireDistinctMotionDiagnosticHashes,
  requireUsefulMotionDiagnosticRaster,
  requireUsefulMotionStandardRaster,
} from "./capture-hook.mjs";
import { MOTION_MODES } from "./route-state.js";

const manifest = JSON.parse(readFileSync(new URL("./lab.manifest.json", import.meta.url), "utf8"));
const validatedPlan = validateCaptureOutputPlan(MOTION_STANDARD_OUTPUT_PLAN);
assert.equal(validatedPlan.length, 10);
assert.deepEqual(MOTION_DIAGNOSTIC_CAPTURE_MODES, ["final", "normal", "emissive", "velocity"]);
assert.deepEqual([...MOTION_DIAGNOSTIC_CAPTURE_MODES].sort(), [...MOTION_MODES].sort());
assert.deepEqual([...MOTION_DIAGNOSTIC_CAPTURE_MODES].sort(), [...manifest.modes].sort());
assert.deepEqual(
  validatedPlan.find(({ id }) => id === "diagnostics.mosaic").sourceCaptures,
  MOTION_DIAGNOSTIC_SOURCE_CAPTURES,
);

const noPost = validatedPlan.find(({ id }) => id === "no-post.design");
assert.equal(noPost.status, "NOT_APPLICABLE");
assert.equal(noPost.graphProof.presentationGraphKind, "direct-render-output");
assert.deepEqual(noPost.graphProof.postProcessingStages, []);
assert.equal(noPost.graphProof.finalToneMapOwner, "renderOutput");
assert.equal(noPost.graphProof.finalOutputTransformOwner, "renderOutput");

function solid(width, height, rgba) {
  const data = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) data.set(rgba, offset);
  return { width, height, data };
}

const colors = [
  [11, 12, 13, 255],
  [21, 22, 23, 255],
  [31, 32, 33, 255],
  [41, 42, 43, 255],
];
const mosaic = composeMotionDiagnosticMosaic(colors.map((rgba) => solid(4, 4, rgba)));
assert.equal(mosaic.width, 4);
assert.equal(mosaic.height, 4);
const pixel = (x, y) => [...mosaic.data.subarray((y * mosaic.width + x) * 4, (y * mosaic.width + x + 1) * 4)];
assert.deepEqual(pixel(0, 0), colors[0]);
assert.deepEqual(pixel(3, 0), colors[1]);
assert.deepEqual(pixel(0, 3), colors[2]);
assert.deepEqual(pixel(3, 3), colors[3]);
assert.throws(
  () => composeMotionDiagnosticMosaic([solid(4, 4, colors[0])]),
  /requires final, normal, emissive, and velocity/,
);
assert.throws(
  () => composeMotionDiagnosticMosaic([
    solid(4, 4, colors[0]),
    solid(2, 4, colors[1]),
    solid(4, 4, colors[2]),
    solid(4, 4, colors[3]),
  ]),
  /dimensions must agree/,
);
const hashes = ["1", "2", "3", "4"].map((digit) => `sha256:${digit.repeat(64)}`);
assert.deepEqual(requireDistinctMotionDiagnosticHashes(hashes), hashes);
assert.throws(
  () => requireDistinctMotionDiagnosticHashes([hashes[0], hashes[0], hashes[2], hashes[3]]),
  /duplicate retained pixels/,
);
const useful = solid(20, 20, colors[0]);
for (let y = 5; y < 15; y += 1) {
  for (let x = 5; x < 15; x += 1) {
    useful.data.set(colors[1], (y * useful.width + x) * 4);
  }
}
assert.deepEqual(analyzeMotionDiagnosticRaster(useful), {
  pixelCount: 400,
  uniqueColorCount: 2,
  dominantPixelCount: 300,
  nonDominantPixelCount: 100,
  nonDominantFraction: 0.25,
});
assert.equal(requireUsefulMotionDiagnosticRaster(useful, "velocity").uniqueColorCount, 2);
assert.throws(
  () => requireUsefulMotionDiagnosticRaster(solid(20, 20, colors[0]), "velocity"),
  /constant diagnostic/,
);
assert.throws(
  () => requireUsefulMotionStandardRaster(solid(20, 20, [0, 0, 0, 255]), "final.design.png"),
  /blank or constant/,
  "blank standard output is rejected before its capture record can be retained",
);
assert.equal(requireUsefulMotionStandardRaster(useful, "camera.design.png").uniqueColorCount, 2);
const onePixel = solid(100, 100, colors[0]);
onePixel.data.set(colors[1], 0);
assert.throws(
  () => requireUsefulMotionDiagnosticRaster(onePixel, "velocity"),
  /occupancy/,
);

const requestedState = {
  scenario: "spin-docking",
  tier: "full",
  mode: "final",
  camera: "design",
  seed: 1,
  time: 5,
};
assert.deepEqual(assertMotionCaptureState(requestedState, {
  ...requestedState,
  timeSeconds: 5,
}), {
  scenario: "spin-docking",
  tier: "full",
  mode: "final",
  camera: "design",
  seed: 1,
  timeSeconds: 5,
});
for (const [field, value] of [
  ["scenario", "debris-release"],
  ["tier", "balanced"],
  ["mode", "normal"],
  ["camera", "near"],
  ["seed", 2],
  ["timeSeconds", 5.25],
]) {
  assert.throws(
    () => assertMotionCaptureState(requestedState, { ...requestedState, timeSeconds: 5, [field]: value }),
    new RegExp(field === "timeSeconds" ? "time" : field),
  );
}

assert.deepEqual(
  MOTION_STORAGE_PARITY_CHECKPOINTS.map(({ id, scenario, timeSeconds }) => [id, scenario, timeSeconds]),
  [
    ["launch-mid", "launch-and-staging", 12],
    ["launch-stage-event", "launch-and-staging", 24],
    ["docking-capture-event", "spin-docking", 6],
    ["docking-mid", "spin-docking", 7.5],
    ["docking-terminal-event", "spin-docking", 10],
    ["debris-release-event", "debris-release", 2],
    ["debris-mid", "debris-release", 3.25],
    ["quaternion-antiparallel", "quaternion-and-reparent", 4],
    ["compute-storage-live", "compute-storage", 2.75],
    ["interpolation-velocity-live", "interpolation-and-velocity", 3.5],
  ],
);
assert.deepEqual(
  MOTION_MECHANISM_CAPTURE_STATES.map(({ scenario }) => scenario),
  [
    "launch-and-staging",
    "spin-docking",
    "debris-release",
    "quaternion-and-reparent",
    "compute-storage",
    "interpolation-and-velocity",
  ],
);
assert.equal(MOTION_STORAGE_READBACK_FIELDS.length, 13);
assert.deepEqual(
  MOTION_STORAGE_READBACK_FIELDS.filter(({ type }) => type === "u32").map(({ id }) => id),
  ["seedFlags"],
);
const parityFixture = {
  previousPose: [1, 2, 3, 0],
  currentPose: [1, 2, 3, 0],
  velocity: [4, 5, 6, 0],
  previousQuaternion: [0, 0, 0, 1],
  currentQuaternion: [0, 0, 0, 1],
  angularVelocity: [0, 0, 0, 0],
  previousPresentedPose: [1, 2, 3, 0],
  currentPresentedPose: [1, 2, 3, 0],
  previousPresentedQuaternion: [0, 0, 0, 1],
  currentPresentedQuaternion: [0, 0, 0, 1],
  anchorFrequency: [0, 0, 0, 0],
  axisPhase: [0, 1, 0, 0],
  seedFlags: [17, 3, 0, 1],
  previousStateVersion: 7,
  currentStateVersion: 7,
  readbackConfirmedStateVersion: 7,
};
const parity = evaluateMotionStorageParity({
  scenario: "spin-docking",
  timeSeconds: 7.5,
  gpu: parityFixture,
  oracle: {
    positionPhase: [1, 2, 3, 0],
    velocityFlags: [4, 5, 6, 0],
    quaternion: [0, 0, 0, 1],
    angularVelocitySpin: [0, 0, 0, 0],
    anchorFrequency: [0, 0, 0, 0],
    axisPhase: [0, 1, 0, 0],
    seedFlags: [17, 3, 0, 1],
    eventFlags: {},
  },
});
assert.equal(parity.verdict, "PASS");
assert.throws(
  () => evaluateMotionStorageParity({
    scenario: "spin-docking",
    timeSeconds: 7.5,
    gpu: { ...parityFixture, currentPose: [2, 2, 3, 0] },
    oracle: {
      positionPhase: [1, 2, 3, 0],
      velocityFlags: [4, 5, 6, 0],
      quaternion: [0, 0, 0, 1],
      angularVelocitySpin: [0, 0, 0, 0],
      anchorFrequency: [0, 0, 0, 0],
      axisPhase: [0, 1, 0, 0],
      seedFlags: [17, 3, 0, 1],
      eventFlags: {},
    },
  }),
  /position parity/,
);

console.log("motion capture plan uses real diagnostic routes and a graph-backed no-post disposition");
