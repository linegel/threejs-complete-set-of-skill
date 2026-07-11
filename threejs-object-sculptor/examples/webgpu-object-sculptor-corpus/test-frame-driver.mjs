import assert from "node:assert/strict";

import {
  CORPUS_ROUTE_LOCKED,
  CORPUS_ROUTE_LOCK_STATE,
  createObjectSculptorCorpusFrameDriver,
  objectSculptorCorpusFrameOwner,
  resolveCorpusFrameDeltaSeconds,
  settleCorpusControlAction,
} from "./frame-driver.js";

assert.equal(objectSculptorCorpusFrameOwner(""), "live-page");
assert.equal(objectSculptorCorpusFrameOwner("?subject=potted-bonsai"), "live-page");
assert.equal(objectSculptorCorpusFrameOwner("?capture=1&subject=ceramic-teapot"), "capture-harness");
assert.equal(objectSculptorCorpusFrameOwner("?capture=0"), "live-page");
for (const invalidSearch of [
  "?capture=0&capture=1",
  "?capture=1&capture=0",
  "?capture=1&capture=1",
  "?capture=0&capture=0",
  "?capture=",
  "?capture=2",
  "?capture=true",
]) {
  assert.throws(
    () => objectSculptorCorpusFrameOwner(invalidSearch),
    /capture frame ownership|Unknown capture frame ownership/,
    `capture ownership must fail closed for ${invalidSearch}`,
  );
}

assert.equal(resolveCorpusFrameDeltaSeconds(99, 100), 0);
assert.equal(resolveCorpusFrameDeltaSeconds(116, 100), 0.016);
assert.equal(resolveCorpusFrameDeltaSeconds(600, 100), 0.1);
assert.equal(resolveCorpusFrameDeltaSeconds(600, 100, 0.05), 0.05);
assert.throws(() => resolveCorpusFrameDeltaSeconds(Number.NaN, 100), /timestamps must be finite/);
assert.throws(() => resolveCorpusFrameDeltaSeconds(100, 90, 0), /cap must be finite and positive/);

function makeMetrics(overrides = {}) {
  return {
    subjectId: "potted-bonsai",
    mode: "action-ready",
    tier: "budgeted",
    camera: "design",
    firstFrameCompleted: false,
    frameErrorCount: 0,
    lifecycleErrorCount: 0,
    ...overrides,
  };
}

function makeController(overrides = {}) {
  let metrics = makeMetrics();
  return {
    async ready() {},
    async setSubject(subjectId) {
      const changed = metrics.subjectId !== subjectId;
      metrics = { ...metrics, subjectId };
      return changed;
    },
    async setScenario(subjectId) {
      return this.setSubject(subjectId);
    },
    async setMode(mode) {
      const changed = metrics.mode !== mode;
      metrics = { ...metrics, mode };
      return changed;
    },
    async setTier(tier) {
      const changed = metrics.tier !== tier;
      metrics = { ...metrics, tier };
      return changed;
    },
    async setSeed() {
      return true;
    },
    async setCamera(camera) {
      const changed = metrics.camera !== camera;
      metrics = { ...metrics, camera };
      return changed;
    },
    async setTime(time) {
      const changed = metrics.time !== time;
      metrics = { ...metrics, time };
      return changed;
    },
    async step() {},
    async resetHistory() {
      metrics = { ...metrics, time: 0 };
      return true;
    },
    async resize() {
      return true;
    },
    async renderOnce() {
      metrics = { ...metrics, firstFrameCompleted: true };
    },
    async capturePixels() {
      return { pixels: [] };
    },
    getRuntimeContract: () => ({ subjectId: metrics.subjectId }),
    getMetrics: () => metrics,
    describePipeline: () => ({ owner: "WebGPURenderer" }),
    describeResources: () => ({ activeTarget: metrics.subjectId }),
    async drain() {},
    async dispose() {
      return true;
    },
    ...overrides,
  };
}

function createFrameScheduler() {
  let nextHandle = 1;
  const callbacks = new Map();
  const cancellations = [];
  return {
    callbacks,
    cancellations,
    requestFrame(callback) {
      const handle = nextHandle;
      nextHandle += 1;
      callbacks.set(handle, callback);
      return handle;
    },
    cancelFrame(handle) {
      cancellations.push(handle);
      callbacks.delete(handle);
    },
    take() {
      const entry = callbacks.entries().next().value;
      assert.ok(entry, "expected one scheduled frame callback");
      callbacks.delete(entry[0]);
      return { handle: entry[0], callback: entry[1] };
    },
  };
}

assert.throws(() => createObjectSculptorCorpusFrameDriver({
  controller: makeController(),
  routeLocks: { scenario: "ceramic-teapot" },
  now: () => 0,
  requestFrame: () => 1,
  cancelFrame: () => {},
  onMetrics: () => {},
  onError: () => {},
}), /does not match initial controller state/);

{
  const errors = [];
  let rawSubjectCalls = 0;
  let rawScenarioCalls = 0;
  const controller = makeController();
  const rawSetSubject = controller.setSubject.bind(controller);
  controller.setSubject = async (id) => {
    rawSubjectCalls += 1;
    return rawSetSubject(id);
  };
  controller.setScenario = async (id) => {
    rawScenarioCalls += 1;
    return rawSetSubject(id);
  };
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    routeLocks: { scenario: "potted-bonsai" },
    now: () => 0,
    requestFrame: () => 1,
    cancelFrame: () => {},
    onMetrics: () => {},
    onError: (error) => errors.push(error.message),
  });
  const facade = driver.publicController;

  const lockState = facade.getRouteLockState();
  assert.equal(lockState.code, CORPUS_ROUTE_LOCK_STATE);
  assert.deepEqual(lockState.disabledSelectorIds, ["subject"]);
  assert.deepEqual(lockState.enabledSelectorIds, ["mode", "tier", "camera"]);
  assert.deepEqual(lockState.lockedDimensions, ["scenario"]);
  assert.equal(lockState.lockedDimension, "scenario");
  assert.equal(lockState.lockedSelectorId, "subject");
  assert.equal(lockState.lockedValue, "potted-bonsai");

  let programmaticSubjectValue = "ceramic-teapot";
  assert.equal(await settleCorpusControlAction(facade.setSubject(programmaticSubjectValue), {
    onApplied: () => assert.fail("a disabled subject selector must not apply"),
    onRestore: () => {
      programmaticSubjectValue = facade.getMetrics().subjectId;
    },
  }), false);
  assert.equal(programmaticSubjectValue, "potted-bonsai", "a programmatic disabled-selector change must restore its route value");
  assert.equal(await facade.setScenario("articulated-desk-lamp"), false, "setScenario must not bypass a scenario lock");
  assert.equal(rawSubjectCalls, 0);
  assert.equal(rawScenarioCalls, 0);

  let metrics = facade.getMetrics();
  assert.equal(metrics.routeLockRejectCount, 2);
  assert.equal(metrics.lastRouteLockResult.code, CORPUS_ROUTE_LOCKED);
  assert.equal(metrics.lastRouteLockResult.dimension, "scenario");
  assert.equal(metrics.lastRouteLockResult.method, "setScenario");
  assert.equal(metrics.lastRouteLockResult.stateChanged, false);
  assert.equal(metrics.frameErrorCount, 0);
  assert.equal(metrics.lifecycleErrorCount, 0);
  assert.equal(driver.getState(), "idle", "route rejection must not poison the serialized lane");

  for (const [method, changedValue, baselineValue] of [
    ["setMode", "materials", "action-ready"],
    ["setTier", "minimum", "budgeted"],
    ["setCamera", "profile", "design"],
  ]) {
    let controlValue = changedValue;
    assert.equal(await settleCorpusControlAction(facade[method](changedValue), {
      onApplied: () => {},
      onRestore: () => assert.fail(`${method} unexpectedly restored an enabled change`),
    }), true, `${method} must remain enabled on a scenario route`);
    controlValue = baselineValue;
    assert.equal(await settleCorpusControlAction(facade[method](baselineValue), {
      onApplied: () => {},
      onRestore: () => assert.fail(`${method} unexpectedly rejected an enabled restore`),
    }), true, `${method} must restore its baseline on a scenario route`);
    assert.equal(controlValue, baselineValue);
  }
  metrics = facade.getMetrics();
  assert.equal(metrics.subjectId, "potted-bonsai");
  assert.equal(metrics.mode, "action-ready");
  assert.equal(metrics.tier, "budgeted");
  assert.equal(metrics.camera, "design");
  assert.equal(metrics.frameErrorCount, 0);
  assert.equal(metrics.lifecycleErrorCount, 0);
  assert.deepEqual(errors, []);
  await facade.dispose();
}

for (const routeCase of [
  { dimension: "mechanism", lockedValue: "action-ready", selectorId: "mode", method: "setMode", attemptedValue: "final" },
  { dimension: "tier", lockedValue: "budgeted", selectorId: "tier", method: "setTier", attemptedValue: "full" },
  { dimension: "camera", lockedValue: "design", selectorId: "camera", method: "setCamera", attemptedValue: "profile" },
]) {
  const controller = makeController();
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    routeLocks: { [routeCase.dimension]: routeCase.lockedValue },
    now: () => 0,
    requestFrame: () => 1,
    cancelFrame: () => {},
    onMetrics: () => {},
    onError: (error) => assert.fail(`unexpected route-lock error: ${error.message}`),
  });
  const facade = driver.publicController;
  assert.equal(await facade[routeCase.method](routeCase.attemptedValue), false);
  assert.deepEqual(facade.getRouteLockState().disabledSelectorIds, [routeCase.selectorId]);
  assert.equal(facade.getMetrics().lastRouteLockResult.code, CORPUS_ROUTE_LOCKED);
  assert.equal(await facade.setSubject("ceramic-teapot"), true, "an unlocked subject must change");
  assert.equal(await facade.setSubject("potted-bonsai"), true, "an unlocked subject must restore");
  assert.equal(driver.getState(), "idle");
  await facade.dispose();
}

{
  let releaseDispose;
  const disposeGate = new Promise((resolve) => {
    releaseDispose = resolve;
  });
  let rawSubjectCalls = 0;
  const controller = makeController({
    async setSubject() {
      rawSubjectCalls += 1;
      return true;
    },
    async dispose() {
      await disposeGate;
      return true;
    },
  });
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    routeLocks: { scenario: "potted-bonsai" },
    now: () => 0,
    requestFrame: () => 1,
    cancelFrame: () => {},
    onMetrics: () => {},
    onError: (error) => assert.fail(`unexpected terminal-state route error: ${error.message}`),
  });
  const facade = driver.publicController;

  const closePromise = facade.dispose();
  assert.equal(driver.getState(), "closing");
  await assert.rejects(facade.setSubject("ceramic-teapot"), /frame driver is closing/);
  assert.equal(facade.getMetrics().routeLockRejectCount, 0, "closing admission must run before route-lock semantics");
  assert.equal(facade.getMetrics().lastRouteLockResult, null);
  releaseDispose();
  await closePromise;
  await assert.rejects(facade.setScenario("articulated-desk-lamp"), /frame driver is closed/);
  assert.equal(facade.getMetrics().routeLockRejectCount, 0, "closed admission must run before route-lock semantics");
  assert.equal(rawSubjectCalls, 0);
}

{
  let rawSubjectCalls = 0;
  const errors = [];
  const controller = makeController({
    async setSubject() {
      rawSubjectCalls += 1;
      return true;
    },
    async renderOnce() {
      throw new Error("synthetic terminal-state render failure");
    },
  });
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    routeLocks: { scenario: "potted-bonsai" },
    now: () => 0,
    requestFrame: () => 1,
    cancelFrame: () => {},
    onMetrics: () => {},
    onError: (error) => errors.push(error.message),
  });
  const facade = driver.publicController;

  await assert.rejects(facade.renderOnce(), /synthetic terminal-state render failure/);
  assert.equal(driver.getState(), "failed");
  await assert.rejects(facade.setSubject("ceramic-teapot"), /frame driver is failed/);
  assert.equal(facade.getMetrics().routeLockRejectCount, 0, "failed admission must run before route-lock semantics");
  assert.equal(facade.getMetrics().lastRouteLockResult, null);
  assert.equal(rawSubjectCalls, 0);
  assert.deepEqual(errors, ["synthetic terminal-state render failure"]);
  await facade.dispose();
}

{
  const scheduler = createFrameScheduler();
  const deltas = [];
  const publishedMetrics = [];
  let completedFrames = 0;
  let disposeCalls = 0;
  const controller = makeController({
    async step(deltaSeconds) {
      deltas.push(deltaSeconds);
    },
    async renderOnce() {
      completedFrames += 1;
    },
    getMetrics() {
      return makeMetrics({
        firstFrameCompleted: completedFrames > 0,
        completedFrames,
      });
    },
    async dispose() {
      disposeCalls += 1;
      return true;
    },
  });
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    now: () => 100,
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: (value) => publishedMetrics.push(value),
    onError: (error) => assert.fail(`unexpected frame error: ${error.message}`),
  });

  assert.equal(driver.start(), true);
  assert.equal(driver.start(), false, "starting an active driver must be idempotent");
  assert.equal(publishedMetrics.length, 1, "HUD metrics must publish before the first render");
  assert.equal(publishedMetrics[0].firstFrameCompleted, false);
  const first = scheduler.take();
  await first.callback(99);
  assert.deepEqual(deltas, [0], "a rAF timestamp before performance.now() must clamp to zero");
  assert.equal(completedFrames, 1, "one driver frame must issue exactly one scene render");
  assert.equal(publishedMetrics.at(-1).firstFrameCompleted, true);
  assert.equal(scheduler.callbacks.size, 1, "a successful live frame must schedule one successor");
  const stale = scheduler.take();
  assert.equal(driver.suspend(), true);
  assert.equal(driver.suspend(), false, "suspending an inactive driver must be idempotent");
  assert.deepEqual(scheduler.cancellations, [stale.handle], "suspending must invalidate the owned rAF handle");
  await stale.callback(116);
  assert.equal(completedFrames, 1, "a suspended driver must ignore an already queued callback");
  assert.equal(driver.resume(), true, "a persisted pageshow can resume a suspended driver");
  const restored = scheduler.take();
  await restored.callback(132);
  assert.equal(completedFrames, 2, "the restored frame owner must render again");
  assert.equal(driver.stop(), true);
  assert.equal(scheduler.cancellations.length, 2, "each suspension must cancel its pending successor rAF");
  await driver.close();
  assert.equal(disposeCalls, 1);
  assert.equal(driver.getState(), "closed");
}

{
  const scheduler = createFrameScheduler();
  const events = [];
  const errors = [];
  let releaseStep;
  const stepGate = new Promise((resolve) => {
    releaseStep = resolve;
  });
  const controller = makeController({
    async step() {
      events.push("step:start");
      await stepGate;
      events.push("step:end");
    },
    async renderOnce() {
      events.push("render");
    },
    async setMode(mode) {
      events.push(`mode:${mode}`);
      return true;
    },
  });
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    now: () => 0,
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: () => {},
    onError: (error) => errors.push(error.message),
  });
  const facade = driver.publicController;

  assert.notEqual(facade, controller, "the page must never publish the raw controller");
  assert.equal(Object.isFrozen(facade), true);
  assert.equal("controller" in facade, false);
  assert.equal("mutate" in facade, false);
  assert.equal("mutate" in driver, false, "the driver must expose only explicit lifecycle and controller actions");
  assert.equal("close" in facade, false);
  assert.equal(Object.isFrozen(facade.getMetrics()), true, "public metrics must be a read-only driver snapshot");

  driver.start();
  const framePromise = scheduler.take().callback(16);
  const mutationPromise = facade.setMode("materials");
  await Promise.resolve();
  assert.deepEqual(events, ["step:start"], "the frame operation must hold the serialized lane");
  releaseStep();
  await Promise.all([framePromise, mutationPromise]);
  assert.deepEqual(events, ["step:start", "step:end", "render", "mode:materials"]);
  assert.deepEqual(errors, []);
  driver.suspend();
  await driver.close();
}

{
  const events = [];
  const errors = [];
  let releaseMode;
  const modeGate = new Promise((resolve) => {
    releaseMode = resolve;
  });
  const controller = makeController({
    async setMode(mode) {
      events.push(`mode:start:${mode}`);
      await modeGate;
      events.push(`mode:end:${mode}`);
      return true;
    },
    async renderOnce() {
      events.push("render");
    },
    async capturePixels() {
      events.push("capture");
      return { pixels: [1, 2, 3, 4] };
    },
    describeResources() {
      events.push("read:resources");
      return { activeTarget: "potted-bonsai" };
    },
    async dispose() {
      events.push("dispose");
      return true;
    },
  });
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    now: () => 0,
    requestFrame: () => 1,
    cancelFrame: () => {},
    onMetrics: () => {},
    onError: (error) => errors.push(error.message),
  });
  const facade = driver.publicController;

  const modePromise = facade.setMode("hierarchy");
  const renderPromise = facade.renderOnce();
  const capturePromise = facade.capturePixels("presentation");
  const readPromise = facade.describeResources();
  await Promise.resolve();
  assert.deepEqual(events, ["mode:start:hierarchy"]);
  releaseMode();
  const [, , capture, resources] = await Promise.all([modePromise, renderPromise, capturePromise, readPromise]);
  assert.deepEqual(capture.pixels, [1, 2, 3, 4]);
  assert.equal(resources.activeTarget, "potted-bonsai");
  assert.deepEqual(events, ["mode:start:hierarchy", "mode:end:hierarchy", "render", "capture", "read:resources"]);
  assert.deepEqual(errors, []);
  await facade.drain();
  await driver.close();
  assert.equal(events.at(-1), "dispose");
}

{
  const scheduler = createFrameScheduler();
  const events = [];
  const errors = [];
  let releaseStep;
  const stepGate = new Promise((resolve) => {
    releaseStep = resolve;
  });
  const controller = makeController({
    async step() {
      events.push("step:start");
      await stepGate;
      events.push("step:end");
    },
    async renderOnce() {
      events.push("render");
    },
    async dispose() {
      events.push("dispose");
      return true;
    },
  });
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    now: () => 0,
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: () => {},
    onError: (error) => errors.push(error.message),
  });

  driver.start();
  const framePromise = scheduler.take().callback(16);
  await Promise.resolve();
  assert.deepEqual(events, ["step:start"]);
  const firstClose = driver.publicController.dispose();
  const secondClose = driver.publicController.dispose();
  assert.equal(firstClose, secondClose, "double close must share one terminal promise");
  assert.equal(driver.getState(), "closing");
  assert.deepEqual(events, ["step:start"], "close must drain rather than dispose across an in-flight step");
  await assert.rejects(driver.publicController.setMode("final"), /frame driver is closing/);
  releaseStep();
  await framePromise;
  await firstClose;
  assert.deepEqual(events, ["step:start", "step:end", "render", "dispose"]);
  assert.equal(driver.getState(), "closed");
  assert.deepEqual(errors, []);
}

{
  const errors = [];
  let disposeCalls = 0;
  let renderAttempts = 0;
  let controllerFrameErrors = 0;
  const controller = makeController({
    async renderOnce() {
      renderAttempts += 1;
      controllerFrameErrors += 1;
      throw new Error("synthetic corpus render failure");
    },
    getMetrics: () => makeMetrics({ frameErrorCount: controllerFrameErrors }),
    async setMode() {
      assert.fail("work queued behind a rejected render must not reach the controller");
    },
    async dispose() {
      disposeCalls += 1;
      return true;
    },
  });
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    now: () => 100,
    requestFrame: () => 1,
    cancelFrame: () => {},
    onMetrics: () => {},
    onError: (error) => errors.push(error.message),
  });

  const rejectedRender = driver.publicController.renderOnce();
  const rejectedFrameFollower = driver.publicController.renderOnce();
  const rejectedLifecycleFollower = driver.publicController.setMode("materials");
  await assert.rejects(rejectedRender, /synthetic corpus render failure/);
  await assert.rejects(rejectedFrameFollower, /frame driver is failed/);
  await assert.rejects(rejectedLifecycleFollower, /frame driver is failed/);
  assert.equal(driver.getState(), "failed");
  assert.equal(renderAttempts, 1, "the second queued frame must fail before reaching the controller");
  assert.deepEqual(errors, ["synthetic corpus render failure"]);
  let metrics = driver.publicController.getMetrics();
  assert.equal(metrics.frameErrorCount, 2, "primary and suppressed back-to-back frame failures must remain cumulative");
  assert.equal(metrics.lifecycleErrorCount, 1, "a suppressed queued lifecycle action must remain cumulative");
  assert.deepEqual(metrics.errorCountEvidence, {
    controllerFrameErrorCount: 1,
    controllerLifecycleErrorCount: 0,
    driverFrameErrorCount: 1,
    driverLifecycleErrorCount: 1,
    frameErrorCount: 2,
    lifecycleErrorCount: 1,
  });
  await assert.rejects(driver.publicController.capturePixels(), /frame driver is failed/);
  metrics = driver.publicController.getMetrics();
  assert.equal(metrics.frameErrorCount, 3);
  const closeA = driver.close();
  const closeB = driver.close();
  assert.equal(closeA, closeB);
  await closeA;
  assert.equal(disposeCalls, 1, "a rejected render must still permit one drained terminal disposal");
  assert.equal(driver.getState(), "closed");
}

{
  const reported = [];
  const controller = makeController({
    async setMode() {
      return true;
    },
  });
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    now: () => 0,
    requestFrame: () => 1,
    cancelFrame: () => {},
    onMetrics: () => {
      throw new Error("synthetic metrics observer failure");
    },
    onError: (error) => reported.push(error.message),
  });

  await assert.rejects(driver.publicController.setMode("final"), /synthetic metrics observer failure/);
  assert.equal(driver.getState(), "failed");
  assert.deepEqual(reported, ["synthetic metrics observer failure"]);
  assert.equal(driver.publicController.getMetrics().lifecycleErrorCount, 1);
  await driver.close();
}

{
  const scheduler = createFrameScheduler();
  const controller = makeController({
    async renderOnce() {
      throw new Error("synthetic primary render failure");
    },
  });
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    now: () => 0,
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: () => {},
    onError: () => {
      throw new Error("synthetic error observer failure");
    },
  });

  assert.equal(driver.start(), true);
  assert.equal(await scheduler.take().callback(16), false, "a rejected rAF render must terminate without an unhandled rejection");
  assert.equal(driver.getState(), "failed");
  assert.match(driver.getObserverFailure()?.message ?? "", /synthetic error observer failure/);
  assert.equal(driver.publicController.getMetrics().frameErrorCount, 1);
  assert.equal(driver.publicController.getMetrics().lifecycleErrorCount, 1);
  await driver.close();
}

console.log(JSON.stringify({
  ok: true,
  lifecycleCases: [
    "capture-owner",
    "duplicate-capture-query-rejection",
    "conflicting-capture-query-rejection",
    "route-lock-state",
    "scenario-alias-lock",
    "programmatic-disabled-control-restore",
    "unlocked-change-and-restore",
    "route-lock-does-not-poison-lane",
    "terminal-state-before-route-lock",
    "delta-cap",
    "single-render-per-frame",
    "serialized-public-facade",
    "serialized-render-and-capture",
    "bfcache-suspend-restore",
    "in-flight-close-drain",
    "double-close",
    "rejected-render",
    "queued-work-rejected-after-failure",
    "cumulative-frame-and-lifecycle-errors",
    "serialized-diagnostic-read",
    "observer-failure-boundaries",
  ],
}, null, 2));
