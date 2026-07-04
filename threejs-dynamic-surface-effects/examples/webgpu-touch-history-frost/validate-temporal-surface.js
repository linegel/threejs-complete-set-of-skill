import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_FROST_SETTINGS,
  FROST_DEBUG_VIEWS,
  clampDeltaSeconds,
  computeDispatchSize,
  createHistoryStorageDescriptor,
  createStaticTextureDescriptor,
  createTwoScaleRefractionContract,
  createWebGPUTouchHistoryFrostEffect,
  depositScale,
  estimateHistoryStorageBytes,
  laplacianDiffusion,
  simulateHeldPointer,
  survivalFactor,
  updateHistorySample,
} from "./frost-surface-effect.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const manifestPath = resolve(root, "assets/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assertManifest() {
  for (const asset of manifest.assets) {
    const path = resolve(root, "assets", asset.path);
    assert.equal(statSync(path).size, asset.byteLength, asset.id);
    assert.equal(sha256(path), asset.sha256, asset.id);
    assert.equal(asset.colorSpace, "NoColorSpace", asset.id);
    assert(asset.wrap === "MirroredRepeatWrapping", asset.id);
    assert.equal(asset.mipmap, false, asset.id);
  }
}

assertManifest();

assert.equal(clampDeltaSeconds(Number.NaN), 0);
assert.equal(clampDeltaSeconds(-1), 0);
assert.equal(clampDeltaSeconds(2), DEFAULT_FROST_SETTINGS.maxDeltaSeconds);
assert.equal(survivalFactor(0.92, 0), 1);
assert(depositScale(0.94, 1 / 60) > 0);

const fps30 = simulateHeldPointer({ fps: 30, seconds: 1 });
const fps60 = simulateHeldPointer({ fps: 60, seconds: 1 });
const fps120 = simulateHeldPointer({ fps: 120, seconds: 1 });
assert(Math.abs(fps30.r - fps60.r) < 0.015, "30/60 FPS visible mask mismatch");
assert(Math.abs(fps120.r - fps60.r) < 0.015, "120/60 FPS visible mask mismatch");
assert(Math.abs(fps30.a - fps120.a) < 0.015, "30/120 FPS tilt mask mismatch");

const held = updateHistorySample({
  previousR: 0.5,
  previousA: 0.25,
  deltaSeconds: 1 / 60,
});
assert(held.r > 0.5);
assert(held.a > 0.25);
assert.deepEqual([held.r, held.g, held.b], [held.r, held.r, held.r]);

const diffused = laplacianDiffusion({
  center: 0.5,
  left: 1,
  right: 1,
  up: 0,
  down: 0,
  deltaSeconds: 1 / 60,
});
assert(Number.isFinite(diffused));

const dispatch = computeDispatchSize(1920, 1080);
assert.deepEqual(dispatch, { x: 240, y: 135, count: 32400, tileSize: 8 });

const storage = estimateHistoryStorageBytes(1920, 1080);
assert.equal(storage.total, 33177600);

const descriptor = createHistoryStorageDescriptor(640, 360);
assert.equal(descriptor.width, 640);
assert.equal(descriptor.height, 360);
assert.equal(descriptor.generateMipmaps, false);

const textureDescriptor = createStaticTextureDescriptor({ id: "main-normal" });
assert.equal(textureDescriptor.colorSpace, "NoColorSpace");
assert.equal(textureDescriptor.generateMipmaps, false);

const refraction = createTwoScaleRefractionContract();
assert.equal(refraction.mainScreenPeriod, 1200);
assert.equal(refraction.detailScreenPeriod, 350);
assert(refraction.heightWeight.includes("height"));
assert(refraction.Fresnel.includes("sourceInset"));

const effect = createWebGPUTouchHistoryFrostEffect({ width: 320, height: 180 });
assert(effect.createFrameGraph().some((step) => step.includes("RenderPipeline.render")));
assert(effect.createResourcePlan().debugViews.includes("singleStep"));
effect.setSize(800, 600);
assert.equal(effect.historyRead.width, 800);
assert.equal(effect.historyClearedOnResize, true);
effect.dispose();
assert.equal(effect.historyRead.disposed, true);
assert.equal(effect.historyWrite.disposed, true);

for (const required of [
  "previous history R/A",
  "deposit R/A",
  "next history R/A",
  "vertical blur",
  "detail refraction offset",
  "pause",
  "singleStep",
]) {
  assert(FROST_DEBUG_VIEWS.includes(required), `missing debug view ${required}`);
}

const source = readFileSync(resolve(here, "frost-surface-effect.js"), "utf8");
for (const token of [
  "WebGPURenderer",
  "RenderPipeline",
  "StorageTexture",
  "Fn",
  "textureStore",
  "setResolutionScale",
  "outputNode",
  "HalfFloatType",
  "RGBAFormat",
  "NoColorSpace",
  "generateMipmaps",
  "setSize(",
  "dispose(",
  "computeAsync",
  "compute(",
  "mainScreenPeriod",
  "detailScreenPeriod",
  "MirroredRepeatWrapping",
  "Fresnel",
  "sourceInset",
  "heightWeight",
  "getRenderTarget",
  "getViewport",
  "getScissor",
  "getClearColor",
  "autoClear",
  "xr.enabled",
]) {
  assert(source.includes(token), `missing source token ${token}`);
}

console.log("webgpu-touch-history-frost validation passed");
