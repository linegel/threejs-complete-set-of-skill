(() => {
  "use strict";

  const BOOTSTRAP_KEY = "__CORPUS_ROUTE_EVIDENCE_BOOTSTRAP__";
  const CONFLICT_KEY = "__CORPUS_ROUTE_EVIDENCE_BOOTSTRAP_CONFLICT__";
  const ORIGIN = "http://127.0.0.1:4174";
  const BASE_PATH = "/threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/";
  const RUNNER_PATH = `${BASE_PATH}in-app-evidence.html`;
  const CORRECTNESS_PATH = `${BASE_PATH}index.html`;
  const ROUTE_PATH = new RegExp(`^${BASE_PATH}(?:scenario|mechanism|tier|camera)/[a-z0-9]+(?:-[a-z0-9]+)*/$`);
  const currentScript = document.currentScript;

  if (Object.hasOwn(window, BOOTSTRAP_KEY)) {
    try {
      Object.defineProperty(window, CONFLICT_KEY, {
        configurable: false,
        enumerable: false,
        writable: false,
        value: true,
      });
    } finally {
      throw new Error("Route evidence bootstrap existed before its trusted head script executed");
    }
  }

  function hasExactRunnerQuery() {
    const params = new URLSearchParams(location.search);
    const allowed = new Set(["capture", "bundleId", "runId", "autostart"]);
    for (const key of params.keys()) if (!allowed.has(key)) return false;
    return params.getAll("capture").length === 1 && params.get("capture") === "1"
      && params.getAll("bundleId").length <= 1
      && params.getAll("runId").length <= 1
      && params.getAll("autostart").length <= 1;
  }

  function hasExactCorrectnessQuery() {
    const params = new URLSearchParams(location.search);
    const allowed = new Set(["capture", "profile", "automationSurface", "subjectSegment", "autostart"]);
    for (const key of params.keys()) if (!allowed.has(key)) return false;
    const one = (key, value) => params.getAll(key).length === 1 && params.get(key) === value;
    const subject = params.get("subjectSegment");
    return one("capture", "1")
      && one("profile", "correctness")
      && one("automationSurface", "codex-in-app-browser")
      && (subject === null || (
        params.getAll("subjectSegment").length === 1
        && new Set(["articulated-desk-lamp", "potted-bonsai", "ceramic-teapot"]).has(subject)
        && one("autostart", "1")
      ))
      && (subject !== null || params.getAll("autostart").length === 0);
  }

  const requestedSurface = currentScript?.dataset?.surface ?? null;
  const enabled = location.origin === ORIGIN && (
    (requestedSurface === "route" && ROUTE_PATH.test(location.pathname) && location.search === "?capture=1")
    || (requestedSurface === "runner" && location.pathname === RUNNER_PATH && hasExactRunnerQuery())
    || (requestedSurface === "correctness" && location.pathname === CORRECTNESS_PATH && hasExactCorrectnessQuery())
  );
  const configuration = Object.freeze({
    enabled,
    requestedSurface,
    origin: location.origin,
    pathname: location.pathname,
    search: location.search,
    canonicalOrigin: ORIGIN,
  });

  if (!enabled) {
    Object.defineProperty(window, BOOTSTRAP_KEY, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: Object.freeze({
        enabled: false,
        surface: requestedSurface,
        snapshot: () => Object.freeze({ schemaVersion: 2, configuration }),
      }),
    });
    return;
  }

  const pageErrors = [];
  const consoleErrors = [];
  const unhandledRejections = [];
  const requestFailures = [];
  const gpuErrors = [];
  const deviceLossEvents = [];
  const expectedDeviceDestructionHistory = [];
  const setupFailures = [];
  const instrumentedAdapters = new WeakSet();
  const monitoredDevices = new Map();
  let monitoredDeviceCount = 0;
  let monitoredDeviceGeneration = 0;
  let expectedDeviceDestructionEverArmed = false;
  let activeExpectedDeviceDestruction = null;
  let expectedDeviceDestructionObserved = 0;

  function valueRecord(value) {
    if (value instanceof Error) {
      return Object.freeze({ name: value.name || "Error", message: value.message || String(value) });
    }
    if (value && typeof value === "object") {
      try {
        return JSON.parse(JSON.stringify(value));
      } catch {
        return String(value);
      }
    }
    return String(value);
  }

  function setupFailure(channel, value) {
    setupFailures.push(Object.freeze({ channel, error: valueRecord(value) }));
  }

  window.addEventListener("error", (event) => {
    const target = event.target;
    if (target && target !== window) {
      requestFailures.push(Object.freeze({
        kind: "resource-error",
        tagName: target.tagName ?? null,
        url: target.currentSrc ?? target.src ?? target.href ?? null,
      }));
      return;
    }
    pageErrors.push(Object.freeze({
      kind: "page-error",
      message: event.message || "Unknown page error",
      source: event.filename || null,
      line: Number.isInteger(event.lineno) ? event.lineno : null,
      column: Number.isInteger(event.colno) ? event.colno : null,
      error: event.error ? valueRecord(event.error) : null,
    }));
  }, true);

  window.addEventListener("unhandledrejection", (event) => {
    unhandledRejections.push(Object.freeze({
      kind: "unhandled-rejection",
      reason: valueRecord(event.reason),
    }));
  });

  const originalConsoleError = console.error.bind(console);
  console.error = (...values) => {
    consoleErrors.push(Object.freeze({ kind: "console-error", values: values.map(valueRecord) }));
    originalConsoleError(...values);
  };

  function monitorDevice(device) {
    if (!device || monitoredDevices.has(device)) return;
    const deviceState = { device, generation: ++monitoredDeviceGeneration };
    monitoredDevices.set(device, deviceState);
    monitoredDeviceCount += 1;
    try {
      device.addEventListener("uncapturederror", (event) => {
        gpuErrors.push(Object.freeze({ kind: "uncaptured-gpu-error", error: valueRecord(event.error) }));
      });
    } catch (error) {
      setupFailure("gpu-uncapturederror", error);
    }
    try {
      Promise.resolve(device.lost).then((info) => {
        const token = activeExpectedDeviceDestruction;
        if (token?.armed === true && token.device === device && token.deviceGeneration === deviceState.generation) {
          token.armed = false;
          activeExpectedDeviceDestruction = null;
          const observed = info?.reason === "destroyed";
          const outcome = Object.freeze({
            tokenId: token.tokenId,
            deviceGeneration: token.deviceGeneration,
            observed,
            reason: info?.reason ?? null,
            message: info?.message ?? null,
            status: observed ? "observed-exact-destroyed-device" : "failed-unexpected-device-loss-reason",
          });
          expectedDeviceDestructionHistory.push(outcome);
          token.resolve(outcome);
          if (!observed) {
            deviceLossEvents.push(Object.freeze({
              kind: "device-lost",
              deviceGeneration: deviceState.generation,
              reason: info?.reason ?? null,
              message: info?.message ?? null,
            }));
            return;
          }
          expectedDeviceDestructionObserved += 1;
          return;
        }
        deviceLossEvents.push(Object.freeze({
          kind: "device-lost",
          deviceGeneration: deviceState.generation,
          reason: info?.reason ?? null,
          message: info?.message ?? null,
        }));
      }, (error) => {
        deviceLossEvents.push(Object.freeze({ kind: "device-lost-rejection", error: valueRecord(error) }));
      });
    } catch (error) {
      setupFailure("gpu-device-lost", error);
    }
  }

  function instrumentAdapter(adapter) {
    if (!adapter || instrumentedAdapters.has(adapter)) return adapter;
    instrumentedAdapters.add(adapter);
    const originalRequestDevice = adapter.requestDevice?.bind(adapter);
    if (typeof originalRequestDevice !== "function") {
      setupFailure("gpu-request-device", new TypeError("GPUAdapter.requestDevice is unavailable"));
      return adapter;
    }
    try {
      Object.defineProperty(adapter, "requestDevice", {
        configurable: true,
        value: async (...args) => {
          const device = await originalRequestDevice(...args);
          monitorDevice(device);
          return device;
        },
      });
    } catch (error) {
      setupFailure("gpu-request-device-hook", error);
    }
    return adapter;
  }

  let gpuRequestHookInstalled = false;
  if (requestedSurface === "route" || requestedSurface === "correctness") {
    try {
      const gpu = navigator.gpu;
      const originalRequestAdapter = gpu?.requestAdapter?.bind(gpu);
      if (typeof originalRequestAdapter !== "function") {
        throw new TypeError("navigator.gpu.requestAdapter is unavailable");
      }
      Object.defineProperty(gpu, "requestAdapter", {
        configurable: true,
        value: async (...args) => instrumentAdapter(await originalRequestAdapter(...args)),
      });
      gpuRequestHookInstalled = true;
    } catch (error) {
      setupFailure("gpu-request-adapter-hook", error);
    }
  }

  const installed = Object.freeze({
    readyState: document.readyState,
    installedInHead: document.head?.contains(currentScript) === true,
    appModulePresentAtInstall: [...document.scripts].some((script) => /(?:^|\/)app\.js(?:$|\?)/.test(script.src)),
    runnerModulePresentAtInstall: [...document.scripts].some((script) => /(?:^|\/)in-app-evidence-runner\.js(?:$|\?)/.test(script.src)),
    performanceTimeOriginMs: Number.isFinite(performance.timeOrigin) ? performance.timeOrigin : null,
    performanceNowMs: Number.isFinite(performance.now()) ? performance.now() : null,
  });

  function eventChannel(events, provenance, observerInstalled = true) {
    return Object.freeze({
      observerInstalled,
      provenance,
      events: Object.freeze([...events]),
    });
  }

  function snapshot() {
    return Object.freeze({
      schemaVersion: 2,
      configuration,
      installed,
      setupFailures: Object.freeze([...setupFailures]),
      pageErrors: eventChannel(pageErrors, "capturing window.error listener installed by route-evidence-bootstrap.js"),
      consoleErrors: eventChannel(consoleErrors, "console.error wrapper installed by route-evidence-bootstrap.js"),
      unhandledRejections: eventChannel(unhandledRejections, "window.unhandledrejection listener installed by route-evidence-bootstrap.js"),
      requestFailures: eventChannel(requestFailures, "capturing window.error listener for document subresource failures"),
      gpuErrors: eventChannel(
        gpuErrors,
        requestedSurface === "route" || requestedSurface === "correctness"
          ? "GPU requestAdapter/requestDevice interception plus device uncapturederror listener"
          : "not applicable on the non-rendering runner surface",
        (requestedSurface === "route" || requestedSurface === "correctness") && gpuRequestHookInstalled,
      ),
      deviceLost: Object.freeze({
        monitorAttached: monitoredDeviceCount > 0,
        monitoredDeviceCount,
        provenance: requestedSurface === "route" || requestedSurface === "correctness"
          ? "GPUDevice.lost promise attached before the device is returned to WebGPURenderer"
          : "not applicable on the non-rendering runner surface",
        events: Object.freeze([...deviceLossEvents]),
      }),
      expectedDeviceDestruction: Object.freeze({
        everArmed: expectedDeviceDestructionEverArmed,
        activeTokenId: activeExpectedDeviceDestruction?.tokenId ?? null,
        activeDeviceGeneration: activeExpectedDeviceDestruction?.deviceGeneration ?? null,
        observedCount: expectedDeviceDestructionObserved,
        history: Object.freeze([...expectedDeviceDestructionHistory]),
      }),
    });
  }

  function beginExpectedDeviceDestruction() {
    if (requestedSurface !== "route") throw new Error("Expected GPU device destruction is route-disposal-only");
    if (expectedDeviceDestructionEverArmed) throw new Error("Expected GPU device destruction is a one-shot route token and was already armed");
    if (monitoredDeviceCount < 1) throw new Error("Expected GPU device destruction requires an observed renderer device");
    if (deviceLossEvents.length > 0) throw new Error("Cannot arm expected GPU device destruction after a device failure");
    const deviceState = [...monitoredDevices.values()].at(-1);
    let resolveOutcome;
    const outcome = new Promise((resolve) => { resolveOutcome = resolve; });
    const token = {
      tokenId: `expected-renderer-destroy:${deviceState.generation}:1`,
      device: deviceState.device,
      deviceGeneration: deviceState.generation,
      armed: true,
      resolve: resolveOutcome,
      outcome,
    };
    expectedDeviceDestructionEverArmed = true;
    activeExpectedDeviceDestruction = token;
    const settleWithoutObservation = (status) => {
      if (!token.armed) return false;
      token.armed = false;
      activeExpectedDeviceDestruction = null;
      const record = Object.freeze({
        tokenId: token.tokenId,
        deviceGeneration: token.deviceGeneration,
        observed: false,
        reason: null,
        message: null,
        status,
      });
      expectedDeviceDestructionHistory.push(record);
      token.resolve(record);
      return true;
    };
    return Object.freeze({
      armed: true,
      phase: "after-successful-readback-before-explicit-renderer-dispose",
      monitoredDeviceCount,
      tokenId: token.tokenId,
      deviceGeneration: token.deviceGeneration,
      observedAtArm: expectedDeviceDestructionObserved,
      async waitForObserved(timeoutMilliseconds = 1000) {
        if (!Number.isFinite(timeoutMilliseconds) || timeoutMilliseconds <= 0) throw new RangeError("Expected device destruction timeout must be positive");
        let timeout;
        try {
          return await Promise.race([
            token.outcome,
            new Promise((resolve) => {
              timeout = setTimeout(() => {
                settleWithoutObservation("failed-timeout-without-device-destroyed-event");
                resolve(expectedDeviceDestructionHistory.at(-1));
              }, timeoutMilliseconds);
            }),
          ]);
        } finally {
          clearTimeout(timeout);
        }
      },
      cancel: () => settleWithoutObservation("cancelled-before-explicit-renderer-dispose-completed"),
    });
  }

  Object.defineProperty(window, BOOTSTRAP_KEY, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({ enabled: true, surface: requestedSurface, snapshot, beginExpectedDeviceDestruction }),
  });
})();
