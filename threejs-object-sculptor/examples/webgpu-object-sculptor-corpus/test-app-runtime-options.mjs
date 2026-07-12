import assert from "node:assert/strict";

import {
  CORPUS_PERFORMANCE_SESSION_SCHEMA_VERSION,
  CORPUS_PERFORMANCE_SESSION_WITNESS_KEY,
  createPerformanceBoundCorpusController,
  physicalPerformanceCaptureSessionFromWindow,
  runtimeOptionsFromLocation,
} from "./app-runtime-options.js";
import { corpusRouteFromLocation } from "./route-state.js";

const SOURCE_CLOSURE_HASH = "a".repeat(64);
const BUILD_REVISION = `source-sha256:${SOURCE_CLOSURE_HASH}`;

const defaults = runtimeOptionsFromLocation();
assert.deepEqual(defaults, {
  profile: "correctness",
  timestampQueriesRequired: false,
  performanceTimestampMode: "auto",
  performanceLane: null,
  performanceCaptureRequested: false,
  correctnessCaptureRequested: false,
  automationSurface: null,
});
assert.equal(Object.isFrozen(defaults), true);

assert.deepEqual(
  runtimeOptionsFromLocation({
    search: "?profile=performance&timestampQueriesRequired=true&performanceTimestampMode=auto&capture=1&automationSurface=codex-in-app-browser",
  }),
  {
    profile: "performance",
    timestampQueriesRequired: true,
    performanceTimestampMode: "auto",
    performanceLane: "one-shot-gpu",
    performanceCaptureRequested: true,
    correctnessCaptureRequested: false,
    automationSurface: "codex-in-app-browser",
  },
);

const cadenceLocation = {
  pathname: "/scenario/articulated-desk-lamp/",
  search: "?profile=performance&performanceTimestampMode=disabled-for-cadence&capture=1&automationSurface=codex-in-app-browser",
};
const cadenceOptions = runtimeOptionsFromLocation(cadenceLocation);
assert.deepEqual(corpusRouteFromLocation(cadenceLocation), {
  scenario: "articulated-desk-lamp",
  mechanism: null,
  tier: null,
  camera: null,
});
assert.deepEqual(cadenceOptions, {
  profile: "performance",
  timestampQueriesRequired: false,
  performanceTimestampMode: "disabled-for-cadence",
  performanceLane: "sustained-cadence",
  performanceCaptureRequested: true,
  correctnessCaptureRequested: false,
  automationSurface: "codex-in-app-browser",
});

for (const [key, value] of [
  ["profile", "performance"],
  ["timestampQueriesRequired", "false"],
  ["performanceTimestampMode", "auto"],
  ["capture", "1"],
  ["automationSurface", "codex-in-app-browser"],
]) {
  assert.throws(
    () => runtimeOptionsFromLocation({ search: `?${key}=${value}&${key}=${value}` }),
    new RegExp(`Duplicate ${key} query values`),
    `${key} must reject repeated identical values rather than silently collapsing them`,
  );
}

for (const [key, first, second] of [
  ["profile", "correctness", "performance"],
  ["timestampQueriesRequired", "false", "true"],
  ["performanceTimestampMode", "auto", "disabled-for-cadence"],
  ["capture", "0", "1"],
  ["automationSurface", "codex-in-app-browser", "playwright-headless-chromium"],
]) {
  assert.throws(
    () => runtimeOptionsFromLocation({ search: `?${key}=${first}&${key}=${second}` }),
    new RegExp(`Conflicting ${key} query values`),
  );
}

assert.throws(
  () => runtimeOptionsFromLocation({ search: "?profile=benchmark" }),
  /Unknown corpus runtime profile/,
);
assert.throws(
  () => runtimeOptionsFromLocation({ search: "?timestampQueriesRequired=maybe" }),
  /must be true, false, 1, or 0/,
);
assert.throws(
  () => runtimeOptionsFromLocation({ search: "?performanceTimestampMode=disabled" }),
  /Unknown corpus performance timestamp mode/,
);
assert.throws(
  () => runtimeOptionsFromLocation({ search: "?timestampQueriesRequired=true" }),
  /only valid with profile=performance/,
);
assert.throws(
  () => runtimeOptionsFromLocation({ search: "?performanceTimestampMode=disabled-for-cadence" }),
  /only configurable with profile=performance/,
);
assert.throws(
  () => runtimeOptionsFromLocation({
    search: "?profile=performance&timestampQueriesRequired=true&performanceTimestampMode=disabled-for-cadence",
  }),
  /conflicts with disabled-for-cadence/,
);
assert.throws(
  () => runtimeOptionsFromLocation({ search: "?profile=performance" }),
  /requires explicit capture=1/,
);
assert.throws(
  () => runtimeOptionsFromLocation({ search: "?profile=performance&capture=1" }),
  /requires automationSurface=codex-in-app-browser/,
);
assert.throws(
  () => runtimeOptionsFromLocation({
    search: "?profile=performance&capture=1&automationSurface=playwright-headless-chromium",
  }),
  /requires automationSurface=codex-in-app-browser/,
);
assert.throws(
  () => runtimeOptionsFromLocation({
    search: "?automationSurface=codex-in-app-browser",
  }),
  /requires capture=1 and codex-in-app-browser/,
);

assert.deepEqual(runtimeOptionsFromLocation({
  search: "?capture=1&profile=correctness&automationSurface=codex-in-app-browser",
}), {
  ...defaults,
  correctnessCaptureRequested: true,
  automationSurface: "codex-in-app-browser",
});
assert.throws(
  () => runtimeOptionsFromLocation({
    search: "?capture=1&profile=correctness&automationSurface=playwright-headless-chromium",
  }),
  /requires capture=1 and codex-in-app-browser/,
);

assert.deepEqual(runtimeOptionsFromLocation({ search: "?capture=1" }), {
  ...defaults,
  performanceCaptureRequested: false,
});

function windowWithPerformanceWitness(overrides = {}, descriptorOverrides = {}) {
  const windowObject = {
    location: {
      href: "https://threejs-skills.com/demos/webgpu-object-sculptor-corpus/?profile=performance&capture=1&automationSurface=codex-in-app-browser",
    },
  };
  const witness = Object.freeze({
    schemaVersion: CORPUS_PERFORMANCE_SESSION_SCHEMA_VERSION,
    profile: "performance",
    automationSurface: "codex-in-app-browser",
    sourceClosureHash: SOURCE_CLOSURE_HASH,
    buildRevision: BUILD_REVISION,
    routeHref: windowObject.location.href,
    sessionId: "physical-session-001",
    startedAt: "2026-07-12T12:00:00.000Z",
    installedAtDocumentReadyState: "loading",
    ...overrides,
  });
  Object.defineProperty(windowObject, CORPUS_PERFORMANCE_SESSION_WITNESS_KEY, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: witness,
    ...descriptorOverrides,
  });
  return { windowObject, witness };
}

{
  const { windowObject, witness } = windowWithPerformanceWitness();
  assert.equal(physicalPerformanceCaptureSessionFromWindow({
    windowObject,
    runtimeOptions: runtimeOptionsFromLocation({
      search: "?profile=performance&capture=1&automationSurface=codex-in-app-browser",
    }),
    sourceClosureHash: SOURCE_CLOSURE_HASH,
    buildRevision: BUILD_REVISION,
  }), witness);
  assert.equal(physicalPerformanceCaptureSessionFromWindow({
    windowObject: {},
    runtimeOptions: defaults,
    sourceClosureHash: SOURCE_CLOSURE_HASH,
    buildRevision: BUILD_REVISION,
  }), null);
}

for (const witnessCase of [
  {
    name: "missing witness",
    create: () => ({ windowObject: { location: { href: "missing" } } }),
    pattern: /requires a non-writable pre-app session witness/,
  },
  {
    name: "configurable witness",
    create: () => windowWithPerformanceWitness({}, { configurable: true }),
    pattern: /requires a non-writable pre-app session witness/,
  },
  {
    name: "wrong surface",
    create: () => windowWithPerformanceWitness({ automationSurface: "playwright-headless-chromium" }),
    pattern: /wrong profile or surface/,
  },
  {
    name: "stale source",
    create: () => windowWithPerformanceWitness({ sourceClosureHash: "b".repeat(64) }),
    pattern: /does not bind current source/,
  },
  {
    name: "wrong route",
    create: () => windowWithPerformanceWitness({ routeHref: "https://example.invalid/" }),
    pattern: /does not bind the executing route/,
  },
  {
    name: "late installation",
    create: () => windowWithPerformanceWitness({ installedAtDocumentReadyState: "interactive" }),
    pattern: /not installed before app execution/,
  },
]) {
  const { windowObject } = witnessCase.create();
  assert.throws(
    () => physicalPerformanceCaptureSessionFromWindow({
      windowObject,
      runtimeOptions: runtimeOptionsFromLocation({
        search: "?profile=performance&capture=1&automationSurface=codex-in-app-browser",
      }),
      sourceClosureHash: SOURCE_CLOSURE_HASH,
      buildRevision: BUILD_REVISION,
    }),
    witnessCase.pattern,
    witnessCase.name,
  );
}

{
  const binding = Object.freeze({ id: "retained-binding" });
  const events = [];
  let releaseControllerDispose;
  const controllerDisposeGate = new Promise((resolve) => {
    releaseControllerDispose = resolve;
  });
  const ownedController = await createPerformanceBoundCorpusController({
    runtimeOptions: cadenceOptions,
    performanceCaptureSession: windowWithPerformanceWitness().witness,
    controllerOptions: { subjectId: "potted-bonsai" },
    createGpuDeviceBinding: async (options) => {
      events.push(["binding:create", options]);
      return binding;
    },
    createController: async (options) => {
      events.push(["controller:create", options]);
      return {
        getMetrics: () => ({ subjectId: options.subjectId }),
        async dispose() {
          events.push(["controller:dispose:start"]);
          await controllerDisposeGate;
          events.push(["controller:dispose:end"]);
          return true;
        },
      };
    },
    disposeGpuDeviceBinding: (value) => {
      events.push(["binding:dispose", value]);
      return true;
    },
  });
  assert.equal(ownedController.getMetrics().subjectId, "potted-bonsai");
  assert.deepEqual(events.slice(0, 2), [
    ["binding:create", {
      powerPreference: "high-performance",
      requireTimestampQuery: false,
    }],
    ["controller:create", {
      subjectId: "potted-bonsai",
      gpuDeviceBinding: binding,
    }],
  ]);
  const closeA = ownedController.dispose();
  const closeB = ownedController.dispose();
  assert.equal(closeA, closeB, "performance controller owner must share one disposal promise");
  assert.deepEqual(events.at(-1), ["controller:dispose:start"]);
  releaseControllerDispose();
  assert.equal(await closeA, true);
  assert.deepEqual(events.slice(-2), [
    ["controller:dispose:end"],
    ["binding:dispose", binding],
  ]);
}

{
  const binding = Object.freeze({ id: "failed-controller-binding" });
  const events = [];
  await assert.rejects(
    createPerformanceBoundCorpusController({
      runtimeOptions: {
        ...cadenceOptions,
        performanceLane: "one-shot-gpu",
      },
      performanceCaptureSession: windowWithPerformanceWitness().witness,
      controllerOptions: {},
      createGpuDeviceBinding: async (options) => {
        events.push(["binding:create", options]);
        return binding;
      },
      createController: async (options) => {
        events.push(["controller:create", options]);
        throw new Error("synthetic controller initialization failure");
      },
      disposeGpuDeviceBinding: (value) => {
        events.push(["binding:dispose", value]);
      },
    }),
    /synthetic controller initialization failure/,
  );
  assert.deepEqual(events, [
    ["binding:create", {
      powerPreference: "high-performance",
      requireTimestampQuery: true,
    }],
    ["controller:create", { gpuDeviceBinding: binding }],
    ["binding:dispose", binding],
  ]);
}

{
  let bindingCreated = false;
  const correctnessController = { dispose: async () => true };
  assert.equal(await createPerformanceBoundCorpusController({
    runtimeOptions: defaults,
    performanceCaptureSession: null,
    controllerOptions: { subjectId: "ceramic-teapot" },
    createController: async (options) => {
      assert.equal(options.gpuDeviceBinding, null);
      return correctnessController;
    },
    createGpuDeviceBinding: async () => {
      bindingCreated = true;
    },
    disposeGpuDeviceBinding: () => {},
  }), correctnessController);
  assert.equal(bindingCreated, false, "ordinary correctness routes must not acquire a performance device");
}

console.log(JSON.stringify({
  ok: true,
  defaults,
  cadenceRoute: corpusRouteFromLocation(cadenceLocation),
  cadenceOptions,
  duplicateKeysRejected: 5,
  conflictingKeysRejected: 5,
  performanceBootstrapNegatives: 4,
  performanceSessionWitnessNegatives: 6,
  retainedGpuBindingOwnershipCases: 3,
}, null, 2));
