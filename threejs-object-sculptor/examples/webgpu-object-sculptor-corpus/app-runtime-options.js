import {
  CORPUS_PERFORMANCE_TIMESTAMP_MODES,
  CORPUS_RUNTIME_PROFILES,
} from "./lab-controller.js";
import { CORPUS_PERFORMANCE_LANES } from "./frame-driver.js";

export const CORPUS_PERFORMANCE_SESSION_WITNESS_KEY =
  "__CORPUS_PHYSICAL_PERFORMANCE_CAPTURE_SESSION__";
export const CORPUS_PERFORMANCE_SESSION_SCHEMA_VERSION =
  "object-sculptor-physical-performance-session-v1";

function oneRuntimeQueryValue(params, key) {
  const values = params.getAll(key);
  if (values.length > 1) {
    const prefix = new Set(values).size === 1 ? "Duplicate" : "Conflicting";
    throw new RangeError(`${prefix} ${key} query values are not allowed: ${values.join(", ")}`);
  }
  return values[0] ?? null;
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label} has an unexpected schema`);
  }
}

function requireText(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a nonempty string`);
  }
  return value;
}

export function physicalPerformanceCaptureSessionFromWindow({
  windowObject,
  runtimeOptions,
  sourceClosureHash,
  buildRevision,
} = {}) {
  if (runtimeOptions?.performanceCaptureRequested !== true) return null;
  if (!windowObject || typeof windowObject !== "object") {
    throw new TypeError("physical performance capture requires a browser window");
  }
  const descriptor = Object.getOwnPropertyDescriptor(
    windowObject,
    CORPUS_PERFORMANCE_SESSION_WITNESS_KEY,
  );
  if (
    !descriptor
    || descriptor.configurable !== false
    || descriptor.enumerable !== false
    || descriptor.writable !== false
    || !("value" in descriptor)
  ) {
    throw new Error(
      "physical performance capture requires a non-writable pre-app session witness",
    );
  }
  const session = descriptor.value;
  exactKeys(session, [
    "schemaVersion",
    "profile",
    "automationSurface",
    "sourceClosureHash",
    "buildRevision",
    "routeHref",
    "sessionId",
    "startedAt",
    "installedAtDocumentReadyState",
  ], "physical performance capture session witness");
  if (!Object.isFrozen(session)) {
    throw new Error("physical performance capture session witness must be frozen");
  }
  if (session.schemaVersion !== CORPUS_PERFORMANCE_SESSION_SCHEMA_VERSION) {
    throw new Error("physical performance capture session witness schema is unsupported");
  }
  if (
    session.profile !== "performance"
    || session.automationSurface !== "codex-in-app-browser"
    || runtimeOptions.automationSurface !== session.automationSurface
  ) {
    throw new Error("physical performance capture session witness has the wrong profile or surface");
  }
  if (
    session.sourceClosureHash !== sourceClosureHash
    || session.buildRevision !== buildRevision
    || buildRevision !== `source-sha256:${sourceClosureHash}`
  ) {
    throw new Error("physical performance capture session witness does not bind current source");
  }
  if (session.routeHref !== windowObject.location?.href) {
    throw new Error("physical performance capture session witness does not bind the executing route");
  }
  requireText(session.sessionId, "physical performance sessionId");
  requireText(session.startedAt, "physical performance startedAt");
  if (!Number.isFinite(Date.parse(session.startedAt))) {
    throw new Error("physical performance startedAt must be an ISO-compatible timestamp");
  }
  if (session.installedAtDocumentReadyState !== "loading") {
    throw new Error("physical performance capture session witness was not installed before app execution");
  }
  return session;
}

function asError(value) {
  return value instanceof Error ? value : new Error(String(value));
}

export async function createPerformanceBoundCorpusController({
  runtimeOptions,
  performanceCaptureSession,
  controllerOptions,
  createController,
  createGpuDeviceBinding,
  disposeGpuDeviceBinding,
} = {}) {
  if (typeof createController !== "function") {
    throw new TypeError("createPerformanceBoundCorpusController requires createController");
  }
  if (!controllerOptions || typeof controllerOptions !== "object" || Array.isArray(controllerOptions)) {
    throw new TypeError("createPerformanceBoundCorpusController requires controllerOptions");
  }
  const performanceLane = runtimeOptions?.performanceLane ?? null;
  if (performanceLane === null) {
    return createController({ ...controllerOptions, gpuDeviceBinding: null });
  }
  if (!performanceCaptureSession) {
    throw new Error("performance controller creation requires its physical capture session witness");
  }
  if (typeof createGpuDeviceBinding !== "function" || typeof disposeGpuDeviceBinding !== "function") {
    throw new TypeError("performance controller creation requires retained GPU binding ownership");
  }
  const gpuDeviceBinding = await createGpuDeviceBinding({
    powerPreference: "high-performance",
    requireTimestampQuery: performanceLane === "one-shot-gpu",
  });
  let controller;
  try {
    controller = await createController({ ...controllerOptions, gpuDeviceBinding });
    if (!controller || typeof controller !== "object" || typeof controller.dispose !== "function") {
      throw new TypeError("performance controller must expose dispose()");
    }
  } catch (value) {
    const error = asError(value);
    try {
      disposeGpuDeviceBinding(gpuDeviceBinding);
    } catch (disposeValue) {
      throw new AggregateError(
        [error, asError(disposeValue)],
        "Failed to initialize the performance controller and dispose its retained GPU binding",
      );
    }
    throw error;
  }
  let ownedDisposalPromise = null;
  return Object.freeze({
    ...controller,
    dispose() {
      if (ownedDisposalPromise) return ownedDisposalPromise;
      ownedDisposalPromise = (async () => {
        const errors = [];
        let result = null;
        try {
          result = await controller.dispose();
        } catch (value) {
          errors.push(asError(value));
        }
        try {
          disposeGpuDeviceBinding(gpuDeviceBinding);
        } catch (value) {
          errors.push(asError(value));
        }
        if (errors.length > 0) {
          throw new AggregateError(
            errors,
            "Object Sculptor performance controller or retained GPU binding disposal failed",
          );
        }
        return result;
      })();
      return ownedDisposalPromise;
    },
  });
}

export function runtimeOptionsFromLocation({ search = "" } = {}) {
  const params = new URLSearchParams(search);
  const profile = oneRuntimeQueryValue(params, "profile") ?? "correctness";
  if (!CORPUS_RUNTIME_PROFILES.includes(profile)) {
    throw new RangeError(`Unknown corpus runtime profile "${profile}"`);
  }

  const timestampValue = oneRuntimeQueryValue(params, "timestampQueriesRequired");
  const normalizedTimestamp = timestampValue?.toLowerCase() ?? null;
  if (normalizedTimestamp !== null && !["1", "0", "true", "false"].includes(normalizedTimestamp)) {
    throw new RangeError("timestampQueriesRequired must be true, false, 1, or 0");
  }
  const timestampQueriesRequired = normalizedTimestamp === "1" || normalizedTimestamp === "true";

  const performanceTimestampMode = oneRuntimeQueryValue(params, "performanceTimestampMode") ?? "auto";
  if (!CORPUS_PERFORMANCE_TIMESTAMP_MODES.includes(performanceTimestampMode)) {
    throw new RangeError(`Unknown corpus performance timestamp mode "${performanceTimestampMode}"`);
  }
  if (timestampQueriesRequired && profile !== "performance") {
    throw new Error("timestampQueriesRequired is only valid with profile=performance");
  }
  if (performanceTimestampMode !== "auto" && profile !== "performance") {
    throw new Error("performanceTimestampMode is only configurable with profile=performance");
  }
  if (timestampQueriesRequired && performanceTimestampMode !== "auto") {
    throw new Error("timestampQueriesRequired conflicts with disabled-for-cadence timestamp mode");
  }

  const captureValue = oneRuntimeQueryValue(params, "capture");
  const automationSurface = oneRuntimeQueryValue(params, "automationSurface");
  if (profile === "performance") {
    if (captureValue !== "1") {
      throw new Error("performance profile requires explicit capture=1");
    }
    if (automationSurface !== "codex-in-app-browser") {
      throw new Error(
        "performance profile requires automationSurface=codex-in-app-browser",
      );
    }
  } else if (automationSurface !== null) {
    if (captureValue !== "1" || automationSurface !== "codex-in-app-browser") {
      throw new Error("correctness automationSurface requires capture=1 and codex-in-app-browser");
    }
  }

  const performanceLane = profile !== "performance"
    ? null
    : performanceTimestampMode === "disabled-for-cadence"
      ? "sustained-cadence"
      : "one-shot-gpu";
  if (performanceLane !== null && !CORPUS_PERFORMANCE_LANES.includes(performanceLane)) {
    throw new Error("runtime options selected an unsupported performance lane");
  }

  return Object.freeze({
    profile,
    timestampQueriesRequired,
    performanceTimestampMode,
    performanceLane,
    performanceCaptureRequested: profile === "performance",
    correctnessCaptureRequested: profile === "correctness"
      && captureValue === "1"
      && automationSurface === "codex-in-app-browser",
    automationSurface,
  });
}
