import assert from "node:assert/strict";

import { createTowerShipFrameDriver, towerShipFrameOwner } from "./frame-driver.js";

assert.equal(towerShipFrameOwner(""), "live-page");
assert.equal(towerShipFrameOwner("?profile=correctness"), "live-page");
assert.equal(towerShipFrameOwner("?capture=1&profile=correctness"), "capture-harness");
assert.equal(towerShipFrameOwner("?capture=0"), "live-page");

function makeMetrics(overrides = {}) {
  return {
    mode: "final",
    tier: "minimum",
    nodes: 216,
    triangles: 4634,
    oars: 24,
    firstFrameCompleted: false,
    ...overrides,
  };
}

{
  const frames = [];
  const deltas = [];
  const metrics = [];
  let completedFrames = 0;
  const controller = {
    async step(deltaSeconds) {
      deltas.push(deltaSeconds);
    },
    async renderOnce() {
      completedFrames += 1;
    },
    getMetrics() {
      return makeMetrics({ firstFrameCompleted: completedFrames > 0, completedFrames });
    },
  };
  const driver = createTowerShipFrameDriver({
    controller,
    now: () => 100,
    requestFrame: (callback) => frames.push(callback),
    onMetrics: (value) => metrics.push(value),
    onError: (error) => assert.fail(`unexpected frame error: ${error.message}`),
  });
  driver.start();
  assert.equal(metrics.length, 1, "HUD metrics must publish before the first render");
  assert.equal(metrics[0].firstFrameCompleted, false);
  assert.equal(frames.length, 1, "driver must schedule the first frame");
  await frames.shift()(99);
  assert.deepEqual(deltas, [0], "a rAF timestamp before performance.now() must clamp to zero");
  assert.equal(completedFrames, 1);
  assert.equal(metrics.at(-1).firstFrameCompleted, true, "first completed render must publish readiness");
  assert.equal(frames.length, 1, "a successful render must schedule the next frame");
  driver.stop();
  await frames.shift()(116);
  assert.equal(completedFrames, 1, "a stopped driver must ignore queued callbacks");
}

{
  const frames = [];
  const errors = [];
  const controller = {
    async step() {},
    async renderOnce() {
      throw new Error("synthetic render failure");
    },
    getMetrics: () => makeMetrics(),
  };
  const driver = createTowerShipFrameDriver({
    controller,
    now: () => 100,
    requestFrame: (callback) => frames.push(callback),
    onMetrics: () => {},
    onError: (error) => errors.push(error.message),
  });
  driver.start();
  await frames.shift()(116);
  assert.deepEqual(errors, ["synthetic render failure"], "render failures must reach the visible error observer");
  assert.equal(frames.length, 0, "a failed frame must not silently continue scheduling");
}

console.log(JSON.stringify({ ok: true, lifecycleCases: ["initial-readiness", "negative-first-delta", "fatal-render-error"] }, null, 2));
