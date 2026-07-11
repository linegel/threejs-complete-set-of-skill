const REQUIRED_CONTROLLER_METHODS = Object.freeze([
  "step",
  "renderOnce",
  "getMetrics",
  "drain",
  "dispose",
]);

const PUBLIC_ACTION_METHODS = Object.freeze([
  "ready",
  "setSubject",
  "setScenario",
  "setMode",
  "setTier",
  "setSeed",
  "setCamera",
  "setTime",
  "step",
  "resetHistory",
  "resize",
  "renderOnce",
  "capturePixels",
  "drain",
]);

const PUBLIC_READ_METHODS = Object.freeze([
  "getRuntimeContract",
  "describePipeline",
  "describeResources",
]);

const FRAME_OPERATION_METHODS = new Set(["step", "renderOnce", "capturePixels"]);

const ROUTE_LOCK_SPECS = Object.freeze({
  scenario: Object.freeze({
    selectorId: "subject",
    metricFields: Object.freeze(["subjectId", "scenario"]),
    controllerMethods: Object.freeze(["setSubject", "setScenario"]),
  }),
  mechanism: Object.freeze({
    selectorId: "mode",
    metricFields: Object.freeze(["mode"]),
    controllerMethods: Object.freeze(["setMode"]),
  }),
  tier: Object.freeze({
    selectorId: "tier",
    metricFields: Object.freeze(["tier"]),
    controllerMethods: Object.freeze(["setTier"]),
  }),
  camera: Object.freeze({
    selectorId: "camera",
    metricFields: Object.freeze(["camera"]),
    controllerMethods: Object.freeze(["setCamera"]),
  }),
});

const ROUTE_DIMENSION_BY_METHOD = new Map(Object.entries(ROUTE_LOCK_SPECS).flatMap(
  ([dimension, spec]) => spec.controllerMethods.map((method) => [method, dimension]),
));

export const CORPUS_ROUTE_LOCKED = "CORPUS_ROUTE_LOCKED";
export const CORPUS_ROUTE_LOCK_STATE = "CORPUS_ROUTE_LOCK_STATE";

function asError(value) {
  return value instanceof Error ? value : new Error(String(value));
}

function notAcceptingError(state, failure) {
  const suffix = failure ? ` after ${failure.message}` : "";
  const error = new Error(`Object Sculptor corpus frame driver is ${state}${suffix}`);
  error.name = "InvalidStateError";
  error.code = "CORPUS_FRAME_DRIVER_NOT_ACCEPTING";
  return error;
}

function metricsSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Object Sculptor corpus getMetrics() must return an object");
  }
  return Object.freeze({ ...value });
}

function finiteNonnegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function normalizeRouteLockState(routeLocks, initialMetrics) {
  if (routeLocks === undefined) routeLocks = {};
  if (!routeLocks || typeof routeLocks !== "object" || Array.isArray(routeLocks)) {
    throw new TypeError("Object Sculptor corpus routeLocks must be an object");
  }
  const unknownKeys = Object.keys(routeLocks).filter((key) => !Object.hasOwn(ROUTE_LOCK_SPECS, key));
  if (unknownKeys.length > 0) throw new RangeError(`Unknown corpus route lock dimensions: ${unknownKeys.join(", ")}`);

  const locks = {};
  const disabledSelectorIds = [];
  const enabledSelectorIds = [];
  for (const [dimension, spec] of Object.entries(ROUTE_LOCK_SPECS)) {
    const lockedValue = routeLocks[dimension] ?? null;
    if (lockedValue !== null && (typeof lockedValue !== "string" || lockedValue.length === 0)) {
      throw new TypeError(`${dimension} route lock must be null or a nonempty string`);
    }
    const currentValues = spec.metricFields.map((field) => initialMetrics[field]).filter((value) => value !== undefined);
    if (lockedValue !== null && (currentValues.length === 0 || currentValues.some((value) => value !== lockedValue))) {
      throw new Error(`${dimension} route lock "${lockedValue}" does not match initial controller state`);
    }
    const locked = lockedValue !== null;
    (locked ? disabledSelectorIds : enabledSelectorIds).push(spec.selectorId);
    locks[dimension] = Object.freeze({
      dimension,
      selectorId: spec.selectorId,
      locked,
      lockedValue,
      controllerMethods: spec.controllerMethods,
    });
  }
  const lockedDimensions = Object.keys(locks).filter((dimension) => locks[dimension].locked);
  const singleLock = lockedDimensions.length === 1 ? locks[lockedDimensions[0]] : null;
  return Object.freeze({
    code: CORPUS_ROUTE_LOCK_STATE,
    locks: Object.freeze(locks),
    lockedDimensions: Object.freeze(lockedDimensions),
    lockedDimension: singleLock?.dimension ?? null,
    lockedSelectorId: singleLock?.selectorId ?? null,
    lockedValue: singleLock?.lockedValue ?? null,
    disabledSelectorIds: Object.freeze(disabledSelectorIds),
    enabledSelectorIds: Object.freeze(enabledSelectorIds),
  });
}

export async function settleCorpusControlAction(action, {
  onApplied = () => {},
  onRestore = () => {},
} = {}) {
  if (!action || typeof action.then !== "function") throw new TypeError("corpus control action must be promise-like");
  if (typeof onApplied !== "function" || typeof onRestore !== "function") {
    throw new TypeError("corpus control action observers must be functions");
  }
  let changed;
  try {
    changed = await action;
  } catch (error) {
    onRestore();
    throw error;
  }
  if (changed === false) {
    onRestore();
    return false;
  }
  try {
    onApplied(changed);
    return changed;
  } catch (error) {
    onRestore();
    throw error;
  }
}

export function resolveCorpusFrameDeltaSeconds(nowMs, previousMs, capSeconds = 0.1) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(previousMs)) {
    throw new RangeError("frame timestamps must be finite");
  }
  if (!Number.isFinite(capSeconds) || capSeconds <= 0) {
    throw new RangeError("frame delta cap must be finite and positive");
  }
  return Math.min(Math.max((nowMs - previousMs) / 1000, 0), capSeconds);
}

export function objectSculptorCorpusFrameOwner(search = "") {
  const values = new URLSearchParams(search).getAll("capture");
  if (values.length === 0) return "live-page";
  if (values.length !== 1) {
    throw new RangeError("capture frame ownership requires exactly one query value");
  }
  if (values[0] === "1") return "capture-harness";
  if (values[0] === "0") return "live-page";
  throw new RangeError(`Unknown capture frame ownership value "${values[0]}"`);
}

export function createObjectSculptorCorpusFrameDriver({
  controller,
  now = () => performance.now(),
  requestFrame = (callback) => requestAnimationFrame(callback),
  cancelFrame = (handle) => {
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
  },
  onMetrics,
  onError,
  hudIntervalMs = 240,
  deltaCapSeconds = 0.1,
  routeLocks,
} = {}) {
  if (!controller) throw new TypeError("Object Sculptor corpus frame driver requires a controller");
  for (const method of REQUIRED_CONTROLLER_METHODS) {
    if (typeof controller[method] !== "function") {
      throw new TypeError(`Object Sculptor corpus controller requires ${method}()`);
    }
  }
  if (typeof now !== "function" || typeof requestFrame !== "function" || typeof cancelFrame !== "function") {
    throw new TypeError("Object Sculptor corpus frame timing callbacks are required");
  }
  if (typeof onMetrics !== "function" || typeof onError !== "function") {
    throw new TypeError("Object Sculptor corpus frame observers are required");
  }
  if (!Number.isFinite(hudIntervalMs) || hudIntervalMs < 0) {
    throw new RangeError("HUD interval must be finite and nonnegative");
  }
  if (!Number.isFinite(deltaCapSeconds) || deltaCapSeconds <= 0) {
    throw new RangeError("frame delta cap must be finite and positive");
  }

  let state = "idle";
  let previous = now();
  let lastHudUpdate = previous;
  let operationTail = Promise.resolve();
  let pendingFrame = null;
  let closePromise = null;
  let lastFailure = null;
  let operationFailure = false;
  let observerFailure = null;
  let routeLockRejectCount = 0;
  let lastRouteLockResult = null;
  let driverFrameErrorCount = 0;
  let driverLifecycleErrorCount = 0;
  let controllerMetrics = metricsSnapshot(controller.getMetrics());
  const routeLockState = normalizeRouteLockState(routeLocks, controllerMetrics);
  let latestMetrics = null;

  function decorateMetrics() {
    const controllerFrameErrorCount = finiteNonnegativeInteger(controllerMetrics.frameErrorCount);
    const controllerLifecycleErrorCount = finiteNonnegativeInteger(controllerMetrics.lifecycleErrorCount);
    latestMetrics = Object.freeze({
      ...controllerMetrics,
      frameErrorCount: controllerFrameErrorCount + driverFrameErrorCount,
      lifecycleErrorCount: controllerLifecycleErrorCount + driverLifecycleErrorCount,
      routeLockState,
      routeLockRejectCount,
      lastRouteLockResult,
      frameDriverState: state,
      errorCountEvidence: Object.freeze({
        controllerFrameErrorCount,
        controllerLifecycleErrorCount,
        driverFrameErrorCount,
        driverLifecycleErrorCount,
        frameErrorCount: controllerFrameErrorCount + driverFrameErrorCount,
        lifecycleErrorCount: controllerLifecycleErrorCount + driverLifecycleErrorCount,
      }),
    });
    return latestMetrics;
  }

  decorateMetrics();

  function notifyError(value) {
    const error = asError(value);
    try {
      onError(error);
    } catch (observerError) {
      observerFailure = asError(observerError);
      driverLifecycleErrorCount += 1;
      decorateMetrics();
    }
    return error;
  }

  function refreshMetrics() {
    controllerMetrics = metricsSnapshot(controller.getMetrics());
    return decorateMetrics();
  }

  function publishMetrics() {
    const value = refreshMetrics();
    onMetrics(value);
    return value;
  }

  function recordErrorEvidence(kind) {
    const field = kind === "frame" ? "frameErrorCount" : "lifecycleErrorCount";
    const before = finiteNonnegativeInteger(controllerMetrics[field]);
    let after = before;
    try {
      controllerMetrics = metricsSnapshot(controller.getMetrics());
      after = finiteNonnegativeInteger(controllerMetrics[field]);
    } catch {
      // The driver-owned counter below preserves the error when controller metrics are unavailable.
    }
    if (after <= before) {
      if (kind === "frame") driverFrameErrorCount += 1;
      else driverLifecycleErrorCount += 1;
    }
    decorateMetrics();
  }

  function recordRejectedOperation(kind) {
    if (kind === "frame") driverFrameErrorCount += 1;
    else driverLifecycleErrorCount += 1;
    decorateMetrics();
  }

  function cancelScheduledFrame() {
    const ticket = pendingFrame;
    if (!ticket) return false;
    pendingFrame = null;
    ticket.cancelled = true;
    if (ticket.handle !== undefined && ticket.handle !== null) {
      try {
        cancelFrame(ticket.handle);
      } catch (value) {
        const error = asError(value);
        lastFailure = error;
        operationFailure = true;
        recordErrorEvidence("lifecycle");
        if (state !== "closing" && state !== "closed") state = "failed";
        decorateMetrics();
        notifyError(error);
        return false;
      }
    }
    return true;
  }

  function fail(value, kind = "lifecycle") {
    const error = asError(value);
    lastFailure = error;
    operationFailure = true;
    recordErrorEvidence(kind);
    cancelScheduledFrame();
    if (state !== "closing" && state !== "closed") state = "failed";
    decorateMetrics();
    notifyError(error);
    return error;
  }

  function acceptingActions() {
    return state !== "closing" && state !== "closed" && state !== "failed" && !operationFailure;
  }

  function enqueue(operation, { errorKind = "lifecycle" } = {}) {
    if (typeof operation !== "function") {
      return Promise.reject(new TypeError("Object Sculptor corpus serialized operation must be a function"));
    }
    if (!acceptingActions()) {
      recordRejectedOperation(errorKind);
      return Promise.reject(notAcceptingError(state, lastFailure));
    }
    const current = operationTail.then(async () => {
      if (operationFailure) {
        recordRejectedOperation(errorKind);
        throw notAcceptingError("failed", lastFailure);
      }
      try {
        return await operation();
      } catch (value) {
        const error = asError(value);
        if (error.code !== "CORPUS_FRAME_DRIVER_NOT_ACCEPTING") fail(error, errorKind);
        throw error;
      }
    });
    operationTail = current.catch(() => {});
    return current;
  }

  function requireControllerMethod(method) {
    const operation = controller[method];
    if (typeof operation !== "function") {
      throw new TypeError(`Object Sculptor corpus controller does not expose ${method}()`);
    }
    return operation;
  }

  function invokeController(method, args) {
    return enqueue(async () => {
      const result = await requireControllerMethod(method).apply(controller, args);
      publishMetrics();
      return result;
    }, { errorKind: FRAME_OPERATION_METHODS.has(method) ? "frame" : "lifecycle" })
      .catch((value) => {
        throw asError(value);
      });
  }

  function invokeReadController(method, args) {
    return enqueue(() => requireControllerMethod(method).apply(controller, args), { errorKind: "lifecycle" });
  }

  function routeLockResult(method, args) {
    const dimension = ROUTE_DIMENSION_BY_METHOD.get(method);
    if (!dimension) return null;
    const lock = routeLockState.locks[dimension];
    if (!lock.locked) return null;
    routeLockRejectCount += 1;
    const currentValue = ROUTE_LOCK_SPECS[dimension].metricFields
      .map((field) => controllerMetrics[field])
      .find((value) => value !== undefined) ?? null;
    lastRouteLockResult = Object.freeze({
      code: CORPUS_ROUTE_LOCKED,
      status: "rejected",
      reason: "route-dimension-immutable",
      dimension,
      selectorId: lock.selectorId,
      method,
      lockedValue: lock.lockedValue,
      requestedValue: args[0] ?? null,
      currentValue,
      stateChanged: false,
      fulfilled: true,
      returnValue: false,
      rejectionOrdinal: routeLockRejectCount,
    });
    decorateMetrics();
    return lastRouteLockResult;
  }

  function invokePublicController(method, args) {
    if (!acceptingActions()) return invokeController(method, args);
    if (routeLockResult(method, args)) return Promise.resolve(false);
    return invokeController(method, args);
  }

  async function runFrame(timestamp, ticket) {
    if (ticket.cancelled || state !== "running") return false;
    try {
      const publishAfterRender = timestamp - lastHudUpdate >= hudIntervalMs
        || latestMetrics.firstFrameCompleted !== true;
      await enqueue(async () => {
        const deltaSeconds = resolveCorpusFrameDeltaSeconds(timestamp, previous, deltaCapSeconds);
        previous = timestamp;
        await controller.step(deltaSeconds);
        await controller.renderOnce();
        const value = refreshMetrics();
        if (publishAfterRender) onMetrics(value);
      }, { errorKind: "frame" });
      if (publishAfterRender) lastHudUpdate = timestamp;
      if (state !== "running") return true;
    } catch (error) {
      return false;
    }
    scheduleFrame();
    return true;
  }

  function scheduleFrame() {
    if (state !== "running" || pendingFrame) return false;
    const ticket = { cancelled: false, handle: null };
    pendingFrame = ticket;
    try {
      ticket.handle = requestFrame((timestamp) => {
        if (pendingFrame === ticket) pendingFrame = null;
        return runFrame(timestamp, ticket);
      });
      return true;
    } catch (error) {
      pendingFrame = null;
      ticket.cancelled = true;
      fail(error, "frame");
      return false;
    }
  }

  function start() {
    if (state === "running" || state === "closing" || state === "closed" || state === "failed") return false;
    state = "running";
    previous = now();
    lastHudUpdate = previous;
    try {
      publishMetrics();
      if (!scheduleFrame()) return false;
      return true;
    } catch (error) {
      fail(error, "lifecycle");
      return false;
    }
  }

  function suspend() {
    if (state !== "running") return false;
    state = "suspended";
    cancelScheduledFrame();
    decorateMetrics();
    return true;
  }

  function close() {
    if (closePromise) return closePromise;
    state = "closing";
    cancelScheduledFrame();
    decorateMetrics();
    const drain = operationTail;
    closePromise = (async () => {
      await drain;
      try {
        const result = await controller.dispose();
        try {
          refreshMetrics();
        } catch {
          // Preserve the successful terminal disposal when post-dispose diagnostics are unavailable.
        }
        return result;
      } catch (error) {
        fail(error, "lifecycle");
        throw error;
      } finally {
        state = "closed";
        decorateMetrics();
      }
    })();
    operationTail = closePromise.catch(() => {});
    return closePromise;
  }

  const publicController = {};
  for (const method of PUBLIC_ACTION_METHODS) {
    publicController[method] = (...args) => invokePublicController(method, args);
  }
  publicController.getMetrics = () => latestMetrics;
  publicController.getRouteLockState = () => routeLockState;
  for (const method of PUBLIC_READ_METHODS) {
    publicController[method] = (...args) => invokeReadController(method, args);
  }
  publicController.dispose = () => close();
  Object.freeze(publicController);

  return Object.freeze({
    publicController,
    start,
    resume: start,
    suspend,
    stop: suspend,
    close,
    getState: () => state,
    getObserverFailure: () => observerFailure,
  });
}
