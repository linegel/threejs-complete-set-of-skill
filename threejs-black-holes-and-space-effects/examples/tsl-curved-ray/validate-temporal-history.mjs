import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CurvedRayTemporalHistory,
  TSLCurvedRayAccretionEffect,
  configureColorTexture,
  createCurvedRayTemporalHistoryStoreNode,
  createSeededNoiseTexture,
  estimateCurvedRayTemporalHistoryBytes,
} from "./curved-ray-accretion.js";
import {
  DataTexture,
  HalfFloatType,
  RGBAFormat,
  StorageTexture,
  UnsignedByteType,
} from "three/webgpu";

function makeTexture() {
  return configureColorTexture(
    new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat, UnsignedByteType),
    { mipmaps: false },
  );
}

const history = new CurvedRayTemporalHistory({
  width: 1920,
  height: 1080,
  resolutionScale: 0.5,
  depthThreshold: 0.02,
  velocityThreshold: 0.1,
  cameraCutThreshold: 0.5,
});

assert.equal(history.width, 960);
assert.equal(history.height, 540);
assert(history.historyRead instanceof StorageTexture);
assert(history.historyWrite instanceof StorageTexture);
assert.equal(history.historyRead.type, HalfFloatType);
assert.equal(history.historyWrite.image.width, 960);
assert.equal(history.historyWrite.image.height, 540);

const bytes = estimateCurvedRayTemporalHistoryBytes(history.width, history.height);
assert.equal(bytes.total, 960 * 540 * 8 * 2);

const first = history.accumulate({ depthDelta: 0, velocityError: 0 });
assert.equal(first.acceptedHistory, false);
assert(first.rejectionReasons.includes("initial-history"));
assert(first.rejectionReasons.includes("resolve-not-implemented"));
assert.equal(first.storageTexture, "StorageTexture");
assert(first.textureStoreContract.includes("textureStore"));
assert.equal(first.executedDispatches, 0);
assert.equal(first.plannedDispatches, 1);
assert(first.implementationStatus.includes("no temporal resolve dispatch"));

history.historyValid = true;
const second = history.accumulate({ depthDelta: 0.001, velocityError: 0.02 });
assert.equal(second.acceptedHistory, false);
assert.equal(second.wouldAcceptHistory, true);
assert.deepEqual(second.rejectionReasons, ["resolve-not-implemented"]);
assert.equal(history.historyRead, second.readHistory);
assert.equal(history.historyWrite, second.writeHistory);

const cameraCut = history.accumulate({ cameraCut: true });
assert.equal(cameraCut.acceptedHistory, false);
assert(cameraCut.rejectionReasons.includes("camera-cut"));

const depthDisocclusion = history.accumulate({ depthDelta: 0.25 });
assert.equal(depthDisocclusion.acceptedHistory, false);
assert(depthDisocclusion.rejectionReasons.includes("depth-disocclusion"));

const velocityMismatch = history.accumulate({ velocityError: 0.5 });
assert.equal(velocityMismatch.acceptedHistory, false);
assert(velocityMismatch.rejectionReasons.includes("velocity-mismatch"));

const lensDiscontinuity = history.accumulate({
  terminationChanged: true,
  bentDirectionError: 0.2,
  diskStateChanged: true,
  criticalReactive: true,
});
assert.equal(lensDiscontinuity.acceptedHistory, false);
for (const reason of [
  "termination-change",
  "bent-direction-mismatch",
  "disk-state-change",
  "critical-reactive",
]) {
  assert(lensDiscontinuity.rejectionReasons.includes(reason));
}

const resized = history.setSize(1280, 720);
assert.equal(resized, true);
assert.equal(history.width, 640);
assert.equal(history.height, 360);
assert.equal(history.historyValid, false);
assert.equal(history.historyClearedOnResize, true);

const resourcePlan = history.createResourcePlan();
assert.equal(resourcePlan.history.className, "StorageTexture");
assert.equal(resourcePlan.history.colorSpace, "NoColorSpace");
assert(resourcePlan.rejectionInputs.includes("velocity"));
assert(resourcePlan.rejectionInputs.includes("depth"));
assert(resourcePlan.rejectionInputs.includes("terminationChanged"));
assert(resourcePlan.rejectionInputs.includes("bentDirectionError"));
assert(resourcePlan.computeWrite.includes("textureStore"));
assert(resourcePlan.implementationStatus.includes("not dispatched"));

const effect = new TSLCurvedRayAccretionEffect({
  noiseTexture: createSeededNoiseTexture({ size: 1 }),
  starTexture: makeTexture(),
  temporalHistory: true,
  width: 800,
  height: 600,
});
assert(effect.temporalHistory instanceof CurvedRayTemporalHistory);
assert.equal(effect.temporalAccumulator, effect.temporalHistory);
assert.equal(effect.metrics().dispatches, 0);
assert.equal(effect.metrics().plannedTemporalDispatches, 1);
assert.equal(effect.metrics().storage.history.className, "StorageTexture");
effect.dispose();
effect.dispose();
assert.equal(effect.disposed, true);
assert.equal(effect.temporalHistory.disposed, true);

history.dispose();
history.dispose();
assert.equal(history.disposed, true);
assert.equal(history.historyRead.userData.disposed, true);
assert.equal(history.historyWrite.userData.disposed, true);

assert.equal(typeof createCurvedRayTemporalHistoryStoreNode, "function");

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "curved-ray-accretion.js"), "utf8");
for (const required of [
  "StorageTexture",
  "textureStore",
  "velocity",
  "depth",
  "historyRead",
  "historyWrite",
  "camera-cut",
  "depth-disocclusion",
  "velocity-mismatch",
]) {
  assert(source.includes(required), `missing temporal implementation token: ${required}`);
}

console.log(JSON.stringify({
  classification: "contract-fixture",
  canonicalAcceptance: false,
  verdict: "NOT_CLAIMED",
  limitation: "CurvedRayTemporalHistory is the retained undispatched scaffold; the canonical temporal route is SpaceTemporalDirectionHistory.",
  storage: {
    width: 960,
    height: 540,
    bytes,
  },
  rejection: {
    first: first.rejectionReasons,
    cameraCut: cameraCut.rejectionReasons,
    depthDisocclusion: depthDisocclusion.rejectionReasons,
    velocityMismatch: velocityMismatch.rejectionReasons,
    lensDiscontinuity: lensDiscontinuity.rejectionReasons,
  },
  resized: {
    width: history.width,
    height: history.height,
    historyCleared: history.historyClearedOnResize,
  },
}, null, 2));
