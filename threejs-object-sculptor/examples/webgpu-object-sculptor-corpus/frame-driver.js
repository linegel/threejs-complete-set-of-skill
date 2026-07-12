const REQUIRED_CONTROLLER_METHODS = Object.freeze([
  "step",
  "renderOnce",
  "resolveGpuTimestampSample",
  "getMetrics",
  "describePipeline",
  "describeResources",
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
  "resolveGpuTimestampSample",
  "capturePixels",
  "drain",
]);

const PUBLIC_READ_METHODS = Object.freeze([
  "getRuntimeContract",
  "describePipeline",
  "describeResources",
  "getPerformanceEvidence",
]);

const FRAME_OPERATION_METHODS = new Set([
  "step",
  "renderOnce",
  "resolveGpuTimestampSample",
  "capturePixels",
]);

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

const browserGlobalAtModuleEvaluation = globalThis.window === globalThis
  && globalThis.document?.defaultView === globalThis;
const browserNavigatorAtModuleEvaluation = browserGlobalAtModuleEvaluation
  ? globalThis.navigator
  : null;
const browserWebDriverAtModuleEvaluation = browserNavigatorAtModuleEvaluation?.webdriver === true;
const physicalPerformanceSessionWitnessKey =
  "__CORPUS_PHYSICAL_PERFORMANCE_CAPTURE_SESSION__";
const physicalPerformanceSessionDescriptorAtModuleEvaluation = browserGlobalAtModuleEvaluation
  ? Object.getOwnPropertyDescriptor(globalThis, physicalPerformanceSessionWitnessKey)
  : null;
const physicalPerformanceSessionAtModuleEvaluation =
  physicalPerformanceSessionDescriptorAtModuleEvaluation?.configurable === false
  && physicalPerformanceSessionDescriptorAtModuleEvaluation?.enumerable === false
  && physicalPerformanceSessionDescriptorAtModuleEvaluation?.writable === false
  && "value" in physicalPerformanceSessionDescriptorAtModuleEvaluation
    ? physicalPerformanceSessionDescriptorAtModuleEvaluation.value
    : null;
const canonicalBrowserNow = browserGlobalAtModuleEvaluation
  && typeof globalThis.performance?.now === "function"
  ? globalThis.performance.now.bind(globalThis.performance)
  : null;
const canonicalBrowserRequestFrame = browserGlobalAtModuleEvaluation
  && typeof globalThis.requestAnimationFrame === "function"
  ? globalThis.requestAnimationFrame.bind(globalThis)
  : null;
const canonicalBrowserCancelFrame = browserGlobalAtModuleEvaluation
  && typeof globalThis.cancelAnimationFrame === "function"
  ? globalThis.cancelAnimationFrame.bind(globalThis)
  : null;

export const CORPUS_PERFORMANCE_IDENTITY_SCHEMA_VERSION =
  "object-sculptor-performance-identity-v2";
export const CORPUS_PERFORMANCE_EVIDENCE_SCHEMA_VERSION =
  "object-sculptor-frame-performance-evidence-v2";
export const CORPUS_PERFORMANCE_LANES = Object.freeze([
  "one-shot-gpu",
  "sustained-cadence",
]);
export const CORPUS_PERFORMANCE_EVIDENCE_LIMITS = Object.freeze({
  maxWindowCountPerLane: 16,
  maxSampleCountPerLane: 4096,
});
export const CORPUS_CADENCE_WINDOW_LIMITS = Object.freeze({
  minWarmupFrameCount: 8,
  minMeasuredFrameCount: 300,
  minMeasuredDurationMs: 2000,
});

const DEFAULT_CORPUS_CADENCE_CONTRACT = Object.freeze({
  targetFrameMs: 16.67,
  warmupFrameCount: CORPUS_CADENCE_WINDOW_LIMITS.minWarmupFrameCount,
  measuredFrameCount: CORPUS_CADENCE_WINDOW_LIMITS.minMeasuredFrameCount,
  minimumMeasuredDurationMs: CORPUS_CADENCE_WINDOW_LIMITS.minMeasuredDurationMs,
});

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

function frameOwnerConflictError() {
  const error = new Error(
    "Manual frame operations are unavailable while the live requestAnimationFrame owner is running",
  );
  error.name = "InvalidStateError";
  error.code = "CORPUS_FRAME_OWNER_CONFLICT";
  return error;
}

function metricsSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Object Sculptor corpus getMetrics() must return an object");
  }
  return Object.freeze({ ...value });
}

function deepFreezePlain(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreezePlain(child);
  return value;
}

function finiteNonnegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function requireFiniteNonnegative(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be finite and nonnegative`);
  }
  return value;
}

function requireFinite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function requireFinitePositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be finite and positive`);
  }
  return value;
}

function requireNonnegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a nonnegative integer`);
  }
  return value;
}

function requirePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return value;
}

function requireNonemptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a nonempty string`);
  }
  return value;
}

function normalizePerformanceEvidenceLimits(value) {
  exactObjectKeys(value, [
    "maxWindowCountPerLane",
    "maxSampleCountPerLane",
  ], "Object Sculptor corpus performance evidence limits");
  for (const field of ["maxWindowCountPerLane", "maxSampleCountPerLane"]) {
    requirePositiveInteger(value[field], `performance evidence ${field}`);
    if (value[field] > CORPUS_PERFORMANCE_EVIDENCE_LIMITS[field]) {
      throw new RangeError(
        `performance evidence ${field} cannot exceed the canonical bounded limit`,
      );
    }
  }
  return Object.freeze({
    maxWindowCountPerLane: value.maxWindowCountPerLane,
    maxSampleCountPerLane: value.maxSampleCountPerLane,
  });
}

function normalizeCadenceContract(lane, value) {
  if (lane === "one-shot-gpu") {
    if (value !== undefined && value !== null) {
      throw new TypeError("one-shot GPU performance identity cadenceContract must be null");
    }
    return null;
  }
  const contract = value === undefined ? DEFAULT_CORPUS_CADENCE_CONTRACT : value;
  exactObjectKeys(contract, [
    "targetFrameMs",
    "warmupFrameCount",
    "measuredFrameCount",
    "minimumMeasuredDurationMs",
  ], "sustained cadence contract");
  requireFinitePositive(contract.targetFrameMs, "sustained cadence targetFrameMs");
  requirePositiveInteger(contract.warmupFrameCount, "sustained cadence warmupFrameCount");
  requirePositiveInteger(contract.measuredFrameCount, "sustained cadence measuredFrameCount");
  requireFinitePositive(
    contract.minimumMeasuredDurationMs,
    "sustained cadence minimumMeasuredDurationMs",
  );
  if (contract.warmupFrameCount < CORPUS_CADENCE_WINDOW_LIMITS.minWarmupFrameCount) {
    throw new RangeError(
      `sustained cadence requires at least ${CORPUS_CADENCE_WINDOW_LIMITS.minWarmupFrameCount} warmup frames`,
    );
  }
  if (contract.measuredFrameCount < CORPUS_CADENCE_WINDOW_LIMITS.minMeasuredFrameCount) {
    throw new RangeError(
      `sustained cadence requires at least ${CORPUS_CADENCE_WINDOW_LIMITS.minMeasuredFrameCount} measured frames`,
    );
  }
  if (contract.minimumMeasuredDurationMs < CORPUS_CADENCE_WINDOW_LIMITS.minMeasuredDurationMs) {
    throw new RangeError(
      `sustained cadence requires at least ${CORPUS_CADENCE_WINDOW_LIMITS.minMeasuredDurationMs} ms of measured callbacks`,
    );
  }
  return deepFreezePlain({ ...contract });
}

function deriveTimingAuthority(now, requestFrame, cancelFrame) {
  const canonical = browserGlobalAtModuleEvaluation
    && !browserWebDriverAtModuleEvaluation
    && canonicalBrowserNow !== null
    && canonicalBrowserRequestFrame !== null
    && canonicalBrowserCancelFrame !== null
    && now === canonicalBrowserNow
    && requestFrame === canonicalBrowserRequestFrame
    && cancelFrame === canonicalBrowserCancelFrame;
  return deepFreezePlain({
    status: canonical
      ? "canonical-browser-performance-timing"
      : "dependency-injected-diagnostic-timing",
    publishable: canonical,
    nowSource: canonical ? "performance.now" : "dependency-injected",
    requestFrameSource: canonical ? "requestAnimationFrame" : "dependency-injected",
    cancelFrameSource: canonical ? "cancelAnimationFrame" : "dependency-injected",
    browserContextCapturedAtModuleEvaluation: browserGlobalAtModuleEvaluation,
    browserIntrinsicsCapturedAtModuleEvaluation:
      canonicalBrowserNow !== null
      && canonicalBrowserRequestFrame !== null
      && canonicalBrowserCancelFrame !== null,
    navigatorWebDriverAtModuleEvaluation: browserWebDriverAtModuleEvaluation,
    acceptance: canonical
      ? "eligible-physical-browser-timing-authority"
      : "DIAGNOSTIC-nonpublishable-injected-timing-authority",
  });
}

function derivePerformancePublicationAuthority(identity, timingAuthority) {
  const requirements = deepFreezePlain({
    canonicalBrowserTiming: timingAuthority.publishable,
    physicalAutomationSurface:
      identity?.browser?.automationSurface === "codex-in-app-browser",
    physicalCaptureSession:
      identity?.captureSession !== null
      && identity?.captureSession === physicalPerformanceSessionAtModuleEvaluation
      && identity.captureSession.routeHref === globalThis.location?.href
      && identity.captureSession.automationSurface === "codex-in-app-browser"
      && identity.captureSession.sourceClosureHash === identity.source.sourceClosureHash
      && identity.captureSession.buildRevision === identity.source.buildRevision,
    hardwareAdapter: identity?.adapter?.adapterClass === "hardware",
  });
  const missingRequirements = Object.entries(requirements)
    .filter(([, satisfied]) => !satisfied)
    .map(([requirement]) => requirement);
  return deepFreezePlain({
    status: missingRequirements.length === 0
      ? "publishable-physical-hardware-performance"
      : "diagnostic-nonpublishable-performance",
    publishable: missingRequirements.length === 0,
    requirements,
    missingRequirements,
  });
}

function clonePlainJson(value, label, path = label) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must contain only finite JSON numbers`);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => clonePlainJson(entry, label, `${path}[${index}]`));
  }
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${path} must contain only plain JSON values`);
  }
  const clone = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) throw new TypeError(`${path}.${key} must not be undefined`);
    clone[key] = clonePlainJson(entry, label, `${path}.${key}`);
  }
  return clone;
}

function exactObjectKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label} has an unexpected schema`);
  }
  return value;
}

function canonicalPlainJson(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalPlainJson(entry)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalPlainJson(value[key])}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function requireFiniteTuple(value, length, label) {
  if (!Array.isArray(value) || value.length !== length) {
    throw new TypeError(`${label} must be a ${length}-element array`);
  }
  value.forEach((entry, index) => requireFinite(entry, `${label}[${index}]`));
  return value;
}

function performancePipelineDescriptor(value) {
  const pipeline = value;
  if (!pipeline || typeof pipeline !== "object" || Array.isArray(pipeline)) {
    throw new TypeError("performance pipeline descriptor must be an object");
  }
  for (const field of ["owner", "toneMapping", "outputColorSpace", "finalOutputOwner"]) {
    requireNonemptyString(pipeline[field], `performance pipeline ${field}`);
  }
  for (const field of ["runtimeProfile", "performanceTimestampMode"]) {
    requireNonemptyString(pipeline[field], `performance pipeline ${field}`);
  }
  requirePositiveInteger(
    pipeline.sceneRendersPerFrame,
    "performance pipeline sceneRendersPerFrame",
  );
  if (!Array.isArray(pipeline.passes) || pipeline.passes.length === 0) {
    throw new TypeError("performance pipeline passes must be a nonempty array");
  }
  pipeline.passes.forEach((pass, index) => (
    requireNonemptyString(pass, `performance pipeline passes[${index}]`)
  ));
  for (const field of [
    "mrt",
    "postprocessing",
    "timestampQueriesRequired",
    "timestampQueriesRequested",
    "timestampQueriesActive",
  ]) {
    if (typeof pipeline[field] !== "boolean") {
      throw new TypeError(`performance pipeline ${field} must be a boolean`);
    }
  }
  return {
    owner: pipeline.owner,
    sceneRendersPerFrame: pipeline.sceneRendersPerFrame,
    passes: [...pipeline.passes],
    mrt: pipeline.mrt,
    postprocessing: pipeline.postprocessing,
    toneMapping: pipeline.toneMapping,
    outputColorSpace: pipeline.outputColorSpace,
    finalOutputOwner: pipeline.finalOutputOwner,
    runtimeProfile: pipeline.runtimeProfile,
    performanceTimestampMode: pipeline.performanceTimestampMode,
    timestampQueriesRequired: pipeline.timestampQueriesRequired,
    timestampQueriesRequested: pipeline.timestampQueriesRequested,
    timestampQueriesActive: pipeline.timestampQueriesActive,
  };
}

function performanceResourceDescriptor(value) {
  const resources = value;
  if (!resources || typeof resources !== "object" || Array.isArray(resources)) {
    throw new TypeError("performance resource descriptor must be an object");
  }
  requireNonemptyString(resources.schemaVersion, "performance resources schemaVersion");
  requireNonemptyString(resources.subjectId, "performance resources subjectId");
  requireNonemptyString(resources.tier, "performance resources tier");
  if (!resources.activeTarget || typeof resources.activeTarget !== "object") {
    throw new TypeError("performance resources activeTarget must be an object");
  }
  if (!Array.isArray(resources.rawEvidenceDescriptors)) {
    throw new TypeError("performance resources rawEvidenceDescriptors must be an array");
  }
  const stableRawDescriptors = resources.rawEvidenceDescriptors.map((descriptor, index) => {
    if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
      throw new TypeError(`performance resource descriptor ${index} must be an object`);
    }
    for (const field of ["category", "owner", "resourceKind", "accountingStatus"]) {
      requireNonemptyString(descriptor[field], `performance resource descriptor ${index} ${field}`);
    }
    for (const field of [
      "elementCount",
      "bytesPerElement",
      "sampleCount",
      "multiplicity",
      "logicalByteLength",
      "allocationCount",
    ]) requireFiniteNonnegative(descriptor[field], `performance resource descriptor ${index} ${field}`);
    if (typeof descriptor.transient !== "boolean") {
      throw new TypeError(`performance resource descriptor ${index} transient must be a boolean`);
    }
    return {
      category: descriptor.category,
      owner: descriptor.owner,
      resourceKind: descriptor.resourceKind,
      allocationIds: Array.isArray(descriptor.allocationIds)
        ? [...descriptor.allocationIds]
        : [],
      elementCount: descriptor.elementCount,
      bytesPerElement: descriptor.bytesPerElement,
      sampleCount: descriptor.sampleCount,
      multiplicity: descriptor.multiplicity,
      logicalByteLength: descriptor.logicalByteLength,
      transient: descriptor.transient,
      accountingStatus: descriptor.accountingStatus,
      allocationCount: descriptor.allocationCount,
      physicalGpuResidentBytes: descriptor.physicalGpuResidentBytes ?? null,
      physicalGpuResidencyStatus: descriptor.physicalGpuResidencyStatus ?? null,
    };
  });
  const shadow = resources.shadow && typeof resources.shadow === "object"
    ? {
      requestIdentity: resources.shadow.requestIdentity ?? null,
      requestedMapSize: resources.shadow.requestedMapSize ?? null,
      requestedTexels: resources.shadow.requestedTexels ?? null,
      requestedDepthBytesUpperBound: resources.shadow.requestedDepthBytesUpperBound ?? null,
      requestedSampleCount: resources.shadow.requestedSampleCount ?? null,
      physicalGpuResidencyStatus: resources.shadow.physicalGpuResidencyStatus ?? null,
    }
    : null;
  return {
    schemaVersion: resources.schemaVersion,
    subjectId: resources.subjectId,
    tier: resources.tier,
    renderTargets: clonePlainJson(
      Array.isArray(resources.renderTargets) ? resources.renderTargets : [],
      "performance render-target descriptor",
    ),
    activeTarget: clonePlainJson(resources.activeTarget, "performance active-target descriptor"),
    controllerStaticRenderResources: clonePlainJson(
      resources.controllerStaticRenderResources ?? null,
      "performance controller-static descriptor",
    ),
    pipelineAccounting: clonePlainJson(
      resources.pipelineAccounting ?? null,
      "performance pipeline-accounting descriptor",
    ),
    shadow,
    rawEvidenceDescriptors: stableRawDescriptors,
  };
}

function performanceWorkloadBinding(
  metrics,
  measurementClass = "one-shot-gpu",
  pipelineDescriptor,
  resourceDescriptor,
) {
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) {
    throw new TypeError("performance controller metrics must be an object");
  }
  for (const field of ["subjectId", "tier", "mode", "camera", "runtimeProfile", "backendKind", "threeRevision"]) {
    if (typeof metrics[field] !== "string" || metrics[field].length === 0) {
      throw new TypeError(`performance controller metrics ${field} must be a nonempty string`);
    }
  }
  if (!Number.isInteger(metrics.seed)) {
    throw new TypeError("performance controller metrics seed must be an integer");
  }
  requirePositiveInteger(metrics.rendererDeviceGeneration, "renderer device generation");
  requireNonnegativeInteger(metrics.deviceLossGeneration, "device-loss generation");
  requireNonnegativeInteger(metrics.completedFrames, "completed frame count");
  requireNonnegativeInteger(metrics.renderSubmissions, "render submission count");
  if (metrics.rendererDeviceStatus !== "active") {
    throw new Error("performance sampling requires an active renderer device");
  }
  for (const field of ["deviceErrorCount", "frameErrorCount", "lifecycleErrorCount"]) {
    requireNonnegativeInteger(metrics[field], `performance controller metrics ${field}`);
  }
  if (metrics.deviceErrorCount !== 0 || metrics.frameErrorCount !== 0 || metrics.lifecycleErrorCount !== 0) {
    throw new Error("performance sampling requires zero device, frame, and lifecycle errors");
  }
  if (metrics.backendKind !== "webgpu") throw new Error("performance sampling requires native WebGPU");
  if (metrics.nativeWebGPU !== true || metrics.threeRevision !== "185") {
    throw new Error("performance sampling requires the canonical Three r185 native WebGPU runtime");
  }
  if (metrics.rendererBackendEvidence?.deviceIdentityVerified !== true) {
    throw new Error("performance sampling requires the initialized renderer device identity");
  }
  if (metrics.rendererDeviceIdentityStillCurrent !== true) {
    throw new Error("performance sampling requires the renderer device identity to remain current");
  }
  if (measurementClass === "one-shot-gpu") {
    if (
      metrics.runtimeProfile !== "performance"
      || metrics.performanceTimestampMode !== "auto"
      || metrics.timestampQueriesActive !== true
      || metrics.rendererBackendEvidence?.timestampQueryFeatureOnActualDevice !== true
      || metrics.rendererBackendEvidence?.backendTimestampTrackingActive !== true
    ) {
      throw new Error("one-shot GPU sampling requires active timestamps on the initialized device");
    }
  } else if (measurementClass === "sustained-cadence") {
    if (
      metrics.runtimeProfile !== "performance"
      || metrics.performanceTimestampMode !== "disabled-for-cadence"
      || metrics.timestampQueriesActive !== false
      || metrics.rendererBackendEvidence?.backendTimestampTrackingActive !== false
    ) {
      throw new Error(
        "sustained cadence sampling requires timestamp tracking disabled so query readback cannot contaminate cadence",
      );
    }
    for (const field of ["gpuTimestampResolveAttempts", "gpuTimestampResolveFailures"]) {
      requireNonnegativeInteger(metrics[field], `sustained cadence ${field}`);
      if (metrics[field] !== 0) {
        throw new Error(
          "sustained cadence requires zero GPU timestamp resolution attempts and failures",
        );
      }
    }
  } else {
    throw new RangeError(`Unknown performance measurement class "${measurementClass}"`);
  }
  if (metrics.cameraInteractionEnabled !== false) {
    throw new Error("performance sampling requires cameraInteractionEnabled=false");
  }
  const viewport = metrics.viewport;
  exactObjectKeys(viewport, [
    "cssWidth",
    "cssHeight",
    "requestedDpr",
    "appliedDpr",
    "drawingBufferWidth",
    "drawingBufferHeight",
  ], "performance viewport");
  for (const field of ["cssWidth", "cssHeight", "drawingBufferWidth", "drawingBufferHeight"]) {
    requirePositiveInteger(viewport[field], `performance viewport ${field}`);
  }
  for (const field of ["requestedDpr", "appliedDpr"]) {
    requireFinitePositive(viewport[field], `performance viewport ${field}`);
  }
  const actualPose = metrics.cameraFraming?.actualPose;
  if (!actualPose || typeof actualPose !== "object" || Array.isArray(actualPose)) {
    throw new TypeError("performance metrics must expose the actual camera pose and projection");
  }
  requireFiniteTuple(actualPose.positionMeters, 3, "performance camera positionMeters");
  requireFiniteTuple(actualPose.quaternion, 4, "performance camera quaternion");
  const quaternionLength = Math.hypot(...actualPose.quaternion);
  if (Math.abs(quaternionLength - 1) > 1e-5) {
    throw new RangeError("performance camera quaternion must be unit length within 1e-5");
  }
  requireFiniteTuple(actualPose.controlsTargetMeters, 3, "performance camera controlsTargetMeters");
  for (const field of ["fovDegrees", "aspect", "nearMeters", "farMeters"]) {
    requireFinitePositive(actualPose[field], `performance camera ${field}`);
  }
  if (actualPose.farMeters <= actualPose.nearMeters) {
    throw new RangeError("performance camera farMeters must exceed nearMeters");
  }
  requireFiniteNonnegative(metrics.time, "performance fixed time");
  for (const field of [
    "stepCount",
    "stateMutationCount",
    "resourceTransitionCount",
    "rebuildCount",
  ]) requireNonnegativeInteger(metrics[field], `performance controller metrics ${field}`);
  const normalizedPipeline = performancePipelineDescriptor(pipelineDescriptor);
  const normalizedResources = performanceResourceDescriptor(resourceDescriptor);
  if (
    normalizedPipeline.runtimeProfile !== metrics.runtimeProfile
    || normalizedPipeline.performanceTimestampMode !== metrics.performanceTimestampMode
    || normalizedPipeline.timestampQueriesRequired !== metrics.timestampQueriesRequired
    || normalizedPipeline.timestampQueriesActive !== metrics.timestampQueriesActive
  ) {
    throw new Error("performance pipeline descriptor does not match controller timing metrics");
  }
  if (normalizedResources.subjectId !== metrics.subjectId || normalizedResources.tier !== metrics.tier) {
    throw new Error("performance resource descriptor does not match the active subject and tier");
  }
  const cameraProjectionState = canonicalPlainJson({
    camera: metrics.camera,
    framing: metrics.cameraFraming,
  });
  return deepFreezePlain({
    workloadScope: "fixed-time-render-only",
    subjectId: metrics.subjectId,
    tier: metrics.tier,
    mode: metrics.mode,
    seed: metrics.seed,
    timeSeconds: metrics.time,
    historyState: canonicalPlainJson({
      timeSeconds: metrics.time,
      stepCount: metrics.stepCount,
      stateMutationCount: metrics.stateMutationCount,
    }),
    resourceState: canonicalPlainJson({
      resourceTransitionCount: metrics.resourceTransitionCount,
      rebuildCount: metrics.rebuildCount,
      descriptor: normalizedResources,
    }),
    pipelineState: canonicalPlainJson(normalizedPipeline),
    camera: metrics.camera,
    cameraProjectionState,
    viewport: { ...viewport },
    runtimeProfile: metrics.runtimeProfile,
    performanceTimestampMode: metrics.performanceTimestampMode,
    backendKind: metrics.backendKind,
    threeRevision: metrics.threeRevision,
    timestampMode: measurementClass === "sustained-cadence"
      ? "disabled-no-query-readback-cadence-run"
      : metrics.timestampQueriesRequired
        ? "required-active-render-query"
        : "optional-active-render-query",
  });
}

function assertSamePerformanceWorkload(actual, expected, label) {
  for (const field of [
    "workloadScope",
    "subjectId",
    "tier",
    "mode",
    "seed",
    "timeSeconds",
    "historyState",
    "resourceState",
    "pipelineState",
    "camera",
    "cameraProjectionState",
    "runtimeProfile",
    "performanceTimestampMode",
    "backendKind",
    "threeRevision",
    "timestampMode",
  ]) {
    if (actual[field] !== expected[field]) {
      throw new Error(`${label} changed ${field} within one performance window`);
    }
  }
  if (canonicalPlainJson(actual.viewport) !== canonicalPlainJson(expected.viewport)) {
    throw new Error(`${label} changed viewport or DPR within one performance window`);
  }
}

function performanceControllerSnapshot(controller, lane) {
  const metrics = metricsSnapshot(controller.getMetrics());
  const workload = performanceWorkloadBinding(
    metrics,
    lane,
    controller.describePipeline(),
    controller.describeResources(),
  );
  return Object.freeze({ metrics, workload });
}

function rendererDeviceBinding(metrics) {
  const evidence = metrics?.rendererBackendEvidence;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new TypeError("performance metrics must expose rendererBackendEvidence");
  }
  if (evidence.deviceIdentityVerified !== true) {
    throw new Error("performance identity requires the initialized renderer device identity");
  }
  for (const field of ["backendType", "deviceType", "deviceIdentitySource"]) {
    requireNonemptyString(evidence[field], `renderer backend evidence ${field}`);
  }
  if (typeof evidence.deviceLabel !== "string") {
    throw new TypeError("renderer backend evidence deviceLabel must be a string");
  }
  return deepFreezePlain({
    backendType: evidence.backendType,
    deviceType: evidence.deviceType,
    deviceLabel: evidence.deviceLabel,
    deviceIdentitySource: evidence.deviceIdentitySource,
  });
}

function normalizeBrowserIdentity(browser) {
  exactObjectKeys(browser, [
    "name",
    "version",
    "userAgent",
    "platform",
    "automationSurface",
  ], "performance browser identity");
  for (const field of ["name", "version", "userAgent", "platform"]) {
    requireNonemptyString(browser[field], `performance browser ${field}`);
  }
  if (/HeadlessChrome|Playwright/i.test(browser.userAgent)) {
    throw new Error("publishable performance identity rejects headless or Playwright browser runtimes");
  }
  if (browser.automationSurface !== "codex-in-app-browser") {
    throw new RangeError(
      "publishable performance identity requires automationSurface=codex-in-app-browser",
    );
  }
  if (browserGlobalAtModuleEvaluation) {
    if (browser.userAgent !== browserNavigatorAtModuleEvaluation?.userAgent) {
      throw new Error("performance browser userAgent must match the executing browser runtime");
    }
    if (browser.platform !== browserNavigatorAtModuleEvaluation?.platform) {
      throw new Error("performance browser platform must match the executing browser runtime");
    }
  }
  return {
    name: browser.name,
    version: browser.version,
    userAgent: browser.userAgent,
    platform: browser.platform,
    automationSurface: browser.automationSurface,
  };
}

function normalizePerformanceCaptureSession(session, source) {
  if (session === undefined || session === null) return null;
  exactObjectKeys(session, [
    "schemaVersion",
    "profile",
    "automationSurface",
    "sourceClosureHash",
    "buildRevision",
    "routeHref",
    "sessionId",
    "startedAt",
    "installedAtDocumentReadyState",
  ], "performance capture session witness");
  if (!Object.isFrozen(session)) {
    throw new Error("performance capture session witness must be frozen before identity creation");
  }
  if (
    session.schemaVersion !== "object-sculptor-physical-performance-session-v1"
    || session.profile !== "performance"
    || session.automationSurface !== "codex-in-app-browser"
    || session.installedAtDocumentReadyState !== "loading"
  ) {
    throw new Error("performance capture session witness has invalid physical-session semantics");
  }
  for (const field of ["routeHref", "sessionId", "startedAt"]) {
    requireNonemptyString(session[field], `performance capture session ${field}`);
  }
  if (!Number.isFinite(Date.parse(session.startedAt))) {
    throw new Error("performance capture session startedAt must be an ISO-compatible timestamp");
  }
  if (
    session.sourceClosureHash !== source.sourceClosureHash
    || session.buildRevision !== source.buildRevision
  ) {
    throw new Error("performance capture session witness does not bind identity source");
  }
  if (browserGlobalAtModuleEvaluation) {
    if (
      session !== physicalPerformanceSessionAtModuleEvaluation
      || session.routeHref !== globalThis.location?.href
    ) {
      throw new Error(
        "performance capture session witness is not the pre-app executing-window witness",
      );
    }
  }
  return session;
}

function normalizeAdapterIdentity(adapter) {
  exactObjectKeys(adapter, [
    "adapterClass",
    "name",
    "identitySource",
    "details",
  ], "performance adapter identity");
  if (!["hardware", "software"].includes(adapter.adapterClass)) {
    throw new RangeError("performance adapterClass must be hardware or software");
  }
  requireNonemptyString(adapter.name, "performance adapter name");
  requireNonemptyString(adapter.identitySource, "performance adapter identitySource");
  const details = clonePlainJson(adapter.details, "performance adapter details");
  if (!details || typeof details !== "object" || Array.isArray(details) || Object.keys(details).length === 0) {
    throw new TypeError("performance adapter details must be a nonempty plain JSON object");
  }
  return {
    adapterClass: adapter.adapterClass,
    name: adapter.name,
    identitySource: adapter.identitySource,
    details,
  };
}

function retainedAdapterBinding(metrics) {
  if (metrics?.performanceAdapterIdentityStatus !== "verified-exact-renderer-device-binding") {
    throw new Error(
      "performance identity requires a retained adapter bound to the exact initialized renderer device",
    );
  }
  return deepFreezePlain(normalizeAdapterIdentity(metrics.performanceAdapterIdentity));
}

export function validateObjectSculptorCorpusPerformanceIdentity(identity) {
  exactObjectKeys(identity, [
    "schemaVersion",
    "lane",
    "source",
    "browser",
    "captureSession",
    "adapter",
    "rendererDevice",
    "workload",
    "generations",
    "cadenceContract",
  ], "Object Sculptor corpus performance identity");
  if (identity.schemaVersion !== CORPUS_PERFORMANCE_IDENTITY_SCHEMA_VERSION) {
    throw new TypeError("Object Sculptor corpus performance identity schemaVersion is unsupported");
  }
  if (!CORPUS_PERFORMANCE_LANES.includes(identity.lane)) {
    throw new RangeError(`Unknown Object Sculptor corpus performance lane "${identity.lane}"`);
  }

  exactObjectKeys(identity.source, ["sourceClosureHash", "buildRevision"], "performance source identity");
  if (!/^[a-f0-9]{64}$/.test(identity.source.sourceClosureHash ?? "")) {
    throw new TypeError("performance sourceClosureHash must be a lowercase SHA-256 digest");
  }
  const expectedBuildRevision = `source-sha256:${identity.source.sourceClosureHash}`;
  if (identity.source.buildRevision !== expectedBuildRevision) {
    throw new Error("performance buildRevision must bind sourceClosureHash");
  }

  const browser = normalizeBrowserIdentity(identity.browser);
  const captureSession = normalizePerformanceCaptureSession(
    identity.captureSession,
    identity.source,
  );
  const adapter = normalizeAdapterIdentity(identity.adapter);

  exactObjectKeys(identity.rendererDevice, [
    "backendType",
    "deviceType",
    "deviceLabel",
    "deviceIdentitySource",
  ], "performance renderer-device binding");
  for (const field of ["backendType", "deviceType", "deviceIdentitySource"]) {
    requireNonemptyString(identity.rendererDevice[field], `performance rendererDevice ${field}`);
  }
  if (typeof identity.rendererDevice.deviceLabel !== "string") {
    throw new TypeError("performance rendererDevice deviceLabel must be a string");
  }

  exactObjectKeys(identity.workload, [
    "workloadScope",
    "subjectId",
    "tier",
    "mode",
    "seed",
    "timeSeconds",
    "historyState",
    "resourceState",
    "pipelineState",
    "camera",
    "cameraProjectionState",
    "viewport",
    "runtimeProfile",
    "performanceTimestampMode",
    "backendKind",
    "threeRevision",
    "timestampMode",
  ], "performance workload binding");
  for (const field of [
    "workloadScope",
    "subjectId",
    "tier",
    "mode",
    "camera",
    "cameraProjectionState",
    "runtimeProfile",
    "performanceTimestampMode",
    "backendKind",
    "threeRevision",
    "timestampMode",
  ]) requireNonemptyString(identity.workload[field], `performance workload ${field}`);
  if (!Number.isInteger(identity.workload.seed)) {
    throw new TypeError("performance workload seed must be an integer");
  }
  requireFiniteNonnegative(identity.workload.timeSeconds, "performance workload timeSeconds");
  if (identity.workload.workloadScope !== "fixed-time-render-only") {
    throw new Error("performance identity workload must be fixed-time-render-only");
  }
  exactObjectKeys(identity.workload.viewport, [
    "cssWidth",
    "cssHeight",
    "requestedDpr",
    "appliedDpr",
    "drawingBufferWidth",
    "drawingBufferHeight",
  ], "performance identity viewport");
  for (const field of ["cssWidth", "cssHeight", "drawingBufferWidth", "drawingBufferHeight"]) {
    requirePositiveInteger(
      identity.workload.viewport[field],
      `performance identity viewport ${field}`,
    );
  }
  for (const field of ["requestedDpr", "appliedDpr"]) {
    requireFinitePositive(
      identity.workload.viewport[field],
      `performance identity viewport ${field}`,
    );
  }
  if (
    identity.workload.runtimeProfile !== "performance"
    || identity.workload.backendKind !== "webgpu"
    || identity.workload.threeRevision !== "185"
  ) {
    throw new Error("performance identity workload must bind the Three r185 native WebGPU performance profile");
  }
  if (
    identity.lane === "one-shot-gpu"
    && (
      identity.workload.performanceTimestampMode !== "auto"
      || !["required-active-render-query", "optional-active-render-query"].includes(
        identity.workload.timestampMode,
      )
    )
  ) {
    throw new Error("one-shot GPU identity must bind an active render timestamp workload");
  }
  if (
    identity.lane === "sustained-cadence"
    && (
      identity.workload.performanceTimestampMode !== "disabled-for-cadence"
      || identity.workload.timestampMode !== "disabled-no-query-readback-cadence-run"
    )
  ) {
    throw new Error("sustained cadence identity must bind a no-query-readback workload");
  }
  const cadenceContract = normalizeCadenceContract(identity.lane, identity.cadenceContract);

  exactObjectKeys(identity.generations, [
    "rendererDeviceGeneration",
    "deviceLossGeneration",
  ], "performance generation binding");
  requirePositiveInteger(
    identity.generations.rendererDeviceGeneration,
    "performance renderer-device generation",
  );
  requireNonnegativeInteger(
    identity.generations.deviceLossGeneration,
    "performance device-loss generation",
  );

  return deepFreezePlain({
    schemaVersion: identity.schemaVersion,
    lane: identity.lane,
    source: {
      sourceClosureHash: identity.source.sourceClosureHash,
      buildRevision: identity.source.buildRevision,
    },
    browser,
    captureSession,
    adapter,
    rendererDevice: { ...identity.rendererDevice },
    workload: {
      ...identity.workload,
      viewport: { ...identity.workload.viewport },
    },
    generations: { ...identity.generations },
    cadenceContract,
  });
}

export function createObjectSculptorCorpusPerformanceIdentity(options = {}) {
  const baseOptionKeys = [
    "lane",
    "sourceClosureHash",
    "buildRevision",
    "browser",
    "controller",
  ];
  const optionalOptionKeys = ["cadenceContract", "captureSession"];
  const presentOptionalOptionKeys = optionalOptionKeys.filter((key) => Object.hasOwn(options, key));
  exactObjectKeys(
    options,
    [...baseOptionKeys, ...presentOptionalOptionKeys],
    "Object Sculptor corpus performance identity constructor options",
  );
  const {
    lane,
    sourceClosureHash,
    buildRevision,
    browser,
    controller,
    cadenceContract,
    captureSession,
  } = options;
  if (!CORPUS_PERFORMANCE_LANES.includes(lane)) {
    throw new RangeError(`Unknown Object Sculptor corpus performance lane "${lane}"`);
  }
  if (!controller || typeof controller !== "object") {
    throw new TypeError("performance identity constructor requires the initialized controller");
  }
  const { metrics, workload } = performanceControllerSnapshot(controller, lane);
  return validateObjectSculptorCorpusPerformanceIdentity({
    schemaVersion: CORPUS_PERFORMANCE_IDENTITY_SCHEMA_VERSION,
    lane,
    source: { sourceClosureHash, buildRevision },
    browser,
    captureSession: captureSession ?? null,
    adapter: retainedAdapterBinding(metrics),
    rendererDevice: rendererDeviceBinding(metrics),
    workload,
    generations: {
      rendererDeviceGeneration: metrics.rendererDeviceGeneration,
      deviceLossGeneration: metrics.deviceLossGeneration,
    },
    cadenceContract: normalizeCadenceContract(lane, cadenceContract),
  });
}

function assertPerformanceIdentityMatchesController(identity, controller, lane, label) {
  if (!identity) {
    throw new Error(`${label} requires an explicit immutable performanceIdentity`);
  }
  if (identity.lane !== lane) {
    throw new Error(`${label} cannot run on the ${identity.lane} performance lane`);
  }
  const { metrics, workload: actualWorkload } = performanceControllerSnapshot(controller, lane);
  assertSamePerformanceWorkload(actualWorkload, identity.workload, label);
  if (canonicalPlainJson(retainedAdapterBinding(metrics)) !== canonicalPlainJson(identity.adapter)) {
    throw new Error(`${label} changed the retained renderer-device adapter binding`);
  }
  if (canonicalPlainJson(rendererDeviceBinding(metrics)) !== canonicalPlainJson(identity.rendererDevice)) {
    throw new Error(`${label} changed the initialized renderer-device binding`);
  }
  if (
    metrics.rendererDeviceGeneration !== identity.generations.rendererDeviceGeneration
    || metrics.deviceLossGeneration !== identity.generations.deviceLossGeneration
  ) {
    throw new Error(`${label} changed renderer or device-loss generation`);
  }
  return actualWorkload;
}

function assertCadenceWindowMatchesIdentity(config, identity) {
  const contract = identity?.cadenceContract;
  if (!contract) {
    throw new Error("sustained cadence window requires an immutable cadence contract");
  }
  for (const field of ["targetFrameMs", "warmupFrameCount", "measuredFrameCount"]) {
    if (config[field] !== contract[field]) {
      throw new Error(`sustained cadence window ${field} does not match immutable cadence contract`);
    }
  }
  return contract;
}

function validateGpuTimestampSample(
  sample,
  beforeMetrics,
  afterMetrics,
  beforeBinding,
  afterBinding,
) {
  exactObjectKeys(sample, [
    "schemaVersion",
    "status",
    "scope",
    "timingSource",
    "gpuMs",
    "resolveOverheadMs",
    "rendererDeviceGeneration",
    "deviceLossGeneration",
    "frameOrdinal",
    "submissionOrdinal",
    "coveredSubmissionCount",
    "renderPhase",
    "sampleOrdinal",
    "subjectId",
    "tier",
    "mode",
    "seed",
    "queryPoolEvidence",
  ], "GPU timestamp sample");
  if (sample.schemaVersion !== "object-sculptor-gpu-timestamp-sample-v1") {
    throw new TypeError("GPU timestamp sample schemaVersion is unsupported");
  }
  if (sample.status !== "measured") throw new Error("GPU timestamp sample is not measured");
  if (sample.scope !== "render") throw new Error("GPU timestamp sample scope must be render");
  if (sample.timingSource !== "renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER)") {
    throw new Error("GPU timestamp sample timing source is not the render timestamp resolver");
  }
  requireFiniteNonnegative(sample.gpuMs, "GPU timestamp duration");
  requireFiniteNonnegative(sample.resolveOverheadMs, "GPU timestamp resolve overhead");
  requirePositiveInteger(sample.rendererDeviceGeneration, "GPU renderer device generation");
  requireNonnegativeInteger(sample.deviceLossGeneration, "GPU device-loss generation");
  requirePositiveInteger(sample.frameOrdinal, "GPU frame ordinal");
  requirePositiveInteger(sample.submissionOrdinal, "GPU submission ordinal");
  requirePositiveInteger(sample.sampleOrdinal, "GPU sample ordinal");
  if (sample.coveredSubmissionCount !== 1) {
    throw new Error("GPU timestamp sample must cover exactly one render submission");
  }
  if (sample.renderPhase !== "presentation-forward-scene") {
    throw new Error("GPU timestamp sample must cover the presentation forward scene");
  }
  const queryEvidence = exactObjectKeys(sample.queryPoolEvidence, [
    "schemaVersion",
    "freshnessStatus",
    "evidenceSurface",
    "publicApiFreshnessProvable",
    "threeRevision",
    "poolType",
    "pendingContextIds",
    "pendingFrameIds",
    "resolvedFrameIds",
    "resolvedContextDurationsMs",
    "pendingContextCount",
    "pendingQueryCount",
    "currentQueryIndexBefore",
    "currentQueryIndexAfter",
    "lastValueBefore",
    "lastValueAfter",
    "resultBufferMapStateBefore",
    "resultBufferMapStateAfter",
  ], "GPU timestamp query-pool evidence");
  if (
    queryEvidence.schemaVersion !== "three-webgpu-timestamp-freshness-v1"
    || queryEvidence.freshnessStatus !== "verified-current-pending-frame-resolved"
    || queryEvidence.evidenceSurface !== "renderer.backend.timestampQueryPool.render"
    || queryEvidence.publicApiFreshnessProvable !== false
    || queryEvidence.threeRevision !== beforeMetrics.threeRevision
    || queryEvidence.poolType !== "WebGPUTimestampQueryPool"
  ) {
    throw new Error("GPU timestamp query-pool freshness evidence is insufficient");
  }
  if (
    !Array.isArray(queryEvidence.pendingContextIds)
    || queryEvidence.pendingContextIds.length !== queryEvidence.pendingContextCount
    || new Set(queryEvidence.pendingContextIds).size !== queryEvidence.pendingContextIds.length
    || queryEvidence.pendingContextIds.some((uid) => (
      typeof uid !== "string" || !/^r:\d+:\d+:f\d+$/.test(uid)
    ))
    || !Array.isArray(queryEvidence.resolvedContextDurationsMs)
    || queryEvidence.resolvedContextDurationsMs.length !== queryEvidence.pendingContextCount
    || queryEvidence.resolvedContextDurationsMs.some((value) => !Number.isFinite(value) || value < 0)
  ) {
    throw new Error("GPU timestamp query-pool context evidence is incomplete");
  }
  const resolvedDurationSum = queryEvidence.resolvedContextDurationsMs.reduce(
    (sum, value) => sum + value,
    0,
  );
  if (Math.abs(resolvedDurationSum - sample.gpuMs) > Math.max(1e-9, Math.abs(sample.gpuMs) * 1e-9)) {
    throw new Error("GPU timestamp query-pool context durations do not sum to the sample");
  }
  if (
    !Array.isArray(queryEvidence.pendingFrameIds)
    || queryEvidence.pendingFrameIds.length !== 1
    || !Array.isArray(queryEvidence.resolvedFrameIds)
    || queryEvidence.resolvedFrameIds.length !== 1
    || queryEvidence.pendingFrameIds[0] !== queryEvidence.resolvedFrameIds[0]
  ) {
    throw new Error("GPU timestamp query-pool frame evidence is not one fresh frame");
  }
  if (queryEvidence.pendingContextIds.some(
    (uid) => Number.parseInt(uid.match(/:f(\d+)$/)[1], 10) !== queryEvidence.pendingFrameIds[0],
  )) {
    throw new Error("GPU timestamp query-pool context UIDs do not bind the resolved frame");
  }
  requirePositiveInteger(queryEvidence.pendingContextCount, "GPU timestamp pending context count");
  requirePositiveInteger(queryEvidence.pendingQueryCount, "GPU timestamp pending query count");
  if (queryEvidence.pendingQueryCount !== queryEvidence.pendingContextCount * 2) {
    throw new Error("GPU timestamp query-pool query count does not match its contexts");
  }
  if (
    queryEvidence.currentQueryIndexBefore !== queryEvidence.pendingQueryCount
    || queryEvidence.currentQueryIndexAfter !== 0
    || queryEvidence.lastValueAfter !== sample.gpuMs
    || queryEvidence.resultBufferMapStateBefore !== "unmapped"
    || queryEvidence.resultBufferMapStateAfter !== "unmapped"
  ) {
    throw new Error("GPU timestamp query-pool resolve state is inconsistent");
  }

  assertSamePerformanceWorkload(afterBinding, beforeBinding, "controller snapshot");
  for (const field of ["subjectId", "tier", "mode", "seed"]) {
    if (sample[field] !== beforeBinding[field]) {
      throw new Error(`GPU timestamp sample changed ${field} within one performance sample`);
    }
  }
  for (const field of ["rendererDeviceGeneration", "deviceLossGeneration"]) {
    if (sample[field] !== beforeMetrics[field]) {
      throw new Error(`GPU timestamp sample changed ${field} within one performance sample`);
    }
  }
  if (
    afterMetrics.completedFrames !== beforeMetrics.completedFrames + 1
    || afterMetrics.renderSubmissions !== beforeMetrics.renderSubmissions + 1
    || sample.frameOrdinal !== afterMetrics.completedFrames
    || sample.submissionOrdinal !== afterMetrics.renderSubmissions
  ) {
    throw new Error("GPU timestamp ordinals do not bind the one submitted frame");
  }
  return sample;
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
  if (lockedDimensions.length > 0 && initialMetrics.cameraInteractionEnabled !== false) {
    throw new Error(
      "Locked corpus routes require controller metrics cameraInteractionEnabled=false",
    );
  }
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
  now = canonicalBrowserNow,
  requestFrame = canonicalBrowserRequestFrame,
  cancelFrame = canonicalBrowserCancelFrame,
  onMetrics,
  onError,
  hudIntervalMs = 240,
  deltaCapSeconds = 0.1,
  routeLocks,
  performanceIdentity = null,
  performanceEvidenceLimits = CORPUS_PERFORMANCE_EVIDENCE_LIMITS,
  ...unknownOptions
} = {}) {
  if (Object.keys(unknownOptions).length > 0) {
    throw new TypeError(
      `Unknown Object Sculptor corpus frame-driver options: ${Object.keys(unknownOptions).join(", ")}`,
    );
  }
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
  const timingAuthority = deriveTimingAuthority(now, requestFrame, cancelFrame);
  const boundedPerformanceEvidenceLimits = normalizePerformanceEvidenceLimits(
    performanceEvidenceLimits,
  );
  const oneShotGpuSamplesByWindow = new Map();
  const sustainedCadenceSamplesByWindow = new Map();
  const sustainedCadenceOutcomes = new Map();
  let oneShotGpuObservedSampleCount = 0;
  let oneShotGpuRetainedSampleCount = 0;
  let oneShotGpuLimitRejectionCount = 0;
  let sustainedCadenceObservedSampleCount = 0;
  let sustainedCadenceRetainedSampleCount = 0;
  let sustainedCadenceLimitRejectionCount = 0;
  let lastOneShotGpuSample = null;
  let lastSustainedCadenceSample = null;
  const oneShotGpuLastRafCallbackMs = new Map();
  const oneShotGpuBindings = new Map();
  const oneShotGpuContinuity = new Map();
  const sustainedCadenceBindings = new Map();
  let manualPerformanceOperationPending = false;
  let pendingManualFrame = null;
  let controllerMetrics = metricsSnapshot(controller.getMetrics());
  const immutablePerformanceIdentity = performanceIdentity === null
    ? null
    : validateObjectSculptorCorpusPerformanceIdentity(performanceIdentity);
  const performancePublicationAuthority = derivePerformancePublicationAuthority(
    immutablePerformanceIdentity,
    timingAuthority,
  );
  if (immutablePerformanceIdentity) {
    assertPerformanceIdentityMatchesController(
      immutablePerformanceIdentity,
      controller,
      immutablePerformanceIdentity.lane,
      "performance driver construction",
    );
  }
  const routeLockState = normalizeRouteLockState(routeLocks, controllerMetrics);
  let latestMetrics = null;

  function decorateMetrics() {
    const controllerFrameErrorCount = requireNonnegativeInteger(
      controllerMetrics.frameErrorCount,
      "controller frameErrorCount",
    );
    const controllerLifecycleErrorCount = requireNonnegativeInteger(
      controllerMetrics.lifecycleErrorCount,
      "controller lifecycleErrorCount",
    );
    latestMetrics = Object.freeze({
      ...controllerMetrics,
      frameErrorCount: controllerFrameErrorCount + driverFrameErrorCount,
      lifecycleErrorCount: controllerLifecycleErrorCount + driverLifecycleErrorCount,
      routeLockState,
      routeLockRejectCount,
      lastRouteLockResult,
      frameDriverState: state,
      performanceIdentity: immutablePerformanceIdentity,
      timingAuthority,
      performancePublicationAuthority,
      performanceEvidenceLaneCounts: Object.freeze({
        limits: boundedPerformanceEvidenceLimits,
        oneShotGpu: Object.freeze({
          observedSampleCount: oneShotGpuObservedSampleCount,
          retainedSampleCount: oneShotGpuRetainedSampleCount,
          retainedWindowCount: oneShotGpuSamplesByWindow.size,
          limitRejectionCount: oneShotGpuLimitRejectionCount,
        }),
        sustainedCadence: Object.freeze({
          observedSampleCount: sustainedCadenceObservedSampleCount,
          retainedSampleCount: sustainedCadenceRetainedSampleCount,
          retainedWindowCount: sustainedCadenceSamplesByWindow.size,
          limitRejectionCount: sustainedCadenceLimitRejectionCount,
        }),
      }),
      lastOneShotGpuSample,
      lastSustainedCadenceSample,
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

  function cancelManualScheduledFrame(reason = "Manual performance frame was cancelled") {
    const ticket = pendingManualFrame;
    if (!ticket) return false;
    pendingManualFrame = null;
    ticket.cancelled = true;
    let cancellationError = null;
    if (ticket.handle !== undefined && ticket.handle !== null) {
      try {
        cancelFrame(ticket.handle);
      } catch (value) {
        cancellationError = asError(value);
      }
    }
    const error = cancellationError ?? new Error(reason);
    error.name = cancellationError?.name ?? "AbortError";
    if (!error.code) {
      error.code = cancellationError
        ? "CORPUS_MANUAL_FRAME_CANCEL_FAILURE"
        : "CORPUS_MANUAL_FRAME_CANCELLED";
    }
    ticket.reject(error);
    return true;
  }

  function requestManualFrameTimestamp() {
    if (pendingManualFrame) return Promise.reject(frameOwnerConflictError());
    return new Promise((resolve, reject) => {
      const ticket = { cancelled: false, handle: null, reject };
      pendingManualFrame = ticket;
      try {
        ticket.handle = requestFrame((timestamp) => {
          if (pendingManualFrame === ticket) pendingManualFrame = null;
          if (ticket.cancelled) return false;
          if (state === "closing" || state === "closed" || state === "failed") {
            const error = notAcceptingError(state, lastFailure);
            reject(error);
            return false;
          }
          try {
            resolve(requireFiniteNonnegative(timestamp, "performance rAF callback timestamp"));
          } catch (error) {
            reject(error);
          }
          return true;
        });
      } catch (value) {
        if (pendingManualFrame === ticket) pendingManualFrame = null;
        ticket.cancelled = true;
        reject(asError(value));
      }
    });
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
        if (error.code === "CORPUS_MANUAL_FRAME_CANCELLED" && state === "closing") {
          throw error;
        }
        if (error.code !== "CORPUS_FRAME_DRIVER_NOT_ACCEPTING") {
          fail(
            error,
            error.code === "CORPUS_MANUAL_FRAME_CANCEL_FAILURE" ? "lifecycle" : errorKind,
          );
        }
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
    if (state === "running" && FRAME_OPERATION_METHODS.has(method)) {
      driverFrameErrorCount += 1;
      decorateMetrics();
      return Promise.reject(frameOwnerConflictError());
    }
    if (routeLockResult(method, args)) return Promise.resolve(false);
    return invokeController(method, args);
  }

  function performanceHealthSnapshot(label) {
    try {
      if (!immutablePerformanceIdentity) {
        throw new Error("performance evidence has no immutable performance identity");
      }
      const metrics = metricsSnapshot(controller.getMetrics());
      for (const field of ["deviceErrorCount", "frameErrorCount", "lifecycleErrorCount"]) {
        requireNonnegativeInteger(metrics[field], `performance health ${field}`);
      }
      if (
        metrics.deviceErrorCount !== 0
        || metrics.frameErrorCount !== 0
        || metrics.lifecycleErrorCount !== 0
        || driverFrameErrorCount !== 0
        || driverLifecycleErrorCount !== 0
      ) throw new Error("performance evidence health contains runtime errors");
      if (
        metrics.rendererDeviceStatus !== "active"
        || metrics.rendererDeviceIdentityStillCurrent !== true
      ) throw new Error("performance evidence renderer device is not active and current");
      if (metrics.acceptingControllerOperations !== true) {
        throw new Error("performance evidence controller is not accepting operations");
      }
      if (metrics.lifecycleAcceptanceStatus?.startsWith?.("invalid-")) {
        throw new Error(`performance evidence lifecycle is ${metrics.lifecycleAcceptanceStatus}`);
      }
      assertPerformanceIdentityMatchesController(
        immutablePerformanceIdentity,
        controller,
        immutablePerformanceIdentity.lane,
        label,
      );
      return deepFreezePlain({
        status: performancePublicationAuthority.publishable ? "PASS" : "DIAGNOSTIC",
        reason: performancePublicationAuthority.publishable
          ? null
          : `nonpublishable performance requirements: ${performancePublicationAuthority.missingRequirements.join(", ")}`,
        timingAuthority,
        performancePublicationAuthority,
        rendererDeviceGeneration: metrics.rendererDeviceGeneration,
        deviceLossGeneration: metrics.deviceLossGeneration,
        rendererDeviceStatus: metrics.rendererDeviceStatus,
        rendererDeviceIdentityStillCurrent: metrics.rendererDeviceIdentityStillCurrent,
        deviceErrorCount: metrics.deviceErrorCount,
        frameErrorCount: metrics.frameErrorCount,
        lifecycleErrorCount: metrics.lifecycleErrorCount,
        driverFrameErrorCount,
        driverLifecycleErrorCount,
        lifecycleAcceptanceStatus: metrics.lifecycleAcceptanceStatus ?? null,
      });
    } catch (value) {
      const error = asError(value);
      return deepFreezePlain({
        status: "INVALID",
        reason: error.message,
        timingAuthority,
        performancePublicationAuthority,
        rendererDeviceGeneration: null,
        deviceLossGeneration: null,
        rendererDeviceStatus: null,
        rendererDeviceIdentityStillCurrent: null,
        deviceErrorCount: null,
        frameErrorCount: null,
        lifecycleErrorCount: null,
        driverFrameErrorCount,
        driverLifecycleErrorCount,
        lifecycleAcceptanceStatus: null,
      });
    }
  }

  function quantile(values, probability) {
    if (!Array.isArray(values) || values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const position = (sorted.length - 1) * probability;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sorted[lower];
    const weight = position - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  function controllerPerformanceSummary(value) {
    if (value === null) return null;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("controller performance evidence must be an object");
    }
    return {
      schemaVersion: value.schemaVersion ?? null,
      runtimeProfile: value.runtimeProfile ?? null,
      performanceTimestampMode: value.performanceTimestampMode ?? null,
      subjectId: value.subjectId ?? null,
      tier: value.tier ?? null,
      timestampQueriesRequired: value.timestampQueriesRequired ?? null,
      timestampQueriesRequested: value.timestampQueriesRequested ?? null,
      timestampQueriesActive: value.timestampQueriesActive ?? null,
      timingMethod: value.timingMethod ?? null,
      status: value.status ?? null,
      rendererDeviceGeneration: value.rendererDeviceGeneration ?? null,
      deviceLossGeneration: value.deviceLossGeneration ?? null,
      resolveAttemptCount: value.resolveAttemptCount ?? null,
      resolveFailureCount: value.resolveFailureCount ?? null,
      retention: clonePlainJson(value.retention ?? null, "controller performance retention"),
      rawSamplePayloadsExcluded: true,
      exclusionReason: "driver evidence retains lane-bound populations; controller raw arrays are not acceptance populations",
    };
  }

  function performanceWindowEvidence(controllerEvidence = null) {
    const finalHealth = performanceHealthSnapshot("performance evidence readout");
    const cadenceStatuses = [...sustainedCadenceOutcomes.values()].map(({ status }) => status);
    const sustainedCadenceAcceptance = cadenceStatuses.length === 0
      ? "NOT_CLAIMED-no-sustained-cadence-window"
      : cadenceStatuses.every((status) => status === "measured-continuous")
        ? "PASS-all-windows-meet-duration-p95-and-publication-gates"
        : cadenceStatuses.some((status) => ["failed", "insufficient-duration", "over-budget"].includes(status))
          ? "FAIL-one-or-more-windows-missed-runtime-duration-or-p95-gates"
          : cadenceStatuses.every((status) => status === "diagnostic-continuous")
            ? "DIAGNOSTIC-all-windows-use-nonpublishable-performance-authority"
            : "INSUFFICIENT_EVIDENCE-window-not-completely-and-uniformly-sealed";
    return deepFreezePlain({
      schemaVersion: CORPUS_PERFORMANCE_EVIDENCE_SCHEMA_VERSION,
      frameOwner: "serialized-frame-driver-requestAnimationFrame",
      liveFrameOwnerState: state,
      performanceIdentity: immutablePerformanceIdentity,
      timingAuthority,
      performancePublicationAuthority,
      retention: {
        limits: boundedPerformanceEvidenceLimits,
        oneShotGpu: {
          observedSampleCount: oneShotGpuObservedSampleCount,
          retainedSampleCount: oneShotGpuRetainedSampleCount,
          retainedWindowCount: oneShotGpuSamplesByWindow.size,
          limitRejectionCount: oneShotGpuLimitRejectionCount,
        },
        sustainedCadence: {
          observedSampleCount: sustainedCadenceObservedSampleCount,
          retainedSampleCount: sustainedCadenceRetainedSampleCount,
          retainedWindowCount: sustainedCadenceSamplesByWindow.size,
          limitRejectionCount: sustainedCadenceLimitRejectionCount,
        },
      },
      gpuTimestampPopulations: [...oneShotGpuSamplesByWindow.entries()].map(
        ([windowId, samples]) => gpuTimestampPopulationEvidence(windowId, samples),
      ),
      sustainedCadenceWindows: [...sustainedCadenceSamplesByWindow.entries()].map(
        ([windowId, samples]) => sustainedCadenceWindowEvidence(windowId, samples),
      ),
      finalHealth,
      presentationTiming: {
        verdict: "NOT_CLAIMED",
        presentationTimestampMs: null,
        presentationIntervalMs: null,
        reason: "no-compositor-presentation-feedback-api",
      },
      controller: controllerPerformanceSummary(controllerEvidence),
      acceptance: {
        evidenceHealth: finalHealth.status === "PASS"
          ? "PASS-current-controller-health-workload-and-physical-browser-timing-binding"
          : finalHealth.status === "DIAGNOSTIC"
            ? `DIAGNOSTIC-${finalHealth.reason}`
            : `INVALID-${finalHealth.reason}`,
        sustainedCadence: sustainedCadenceAcceptance,
        sustainedGpu: "INSUFFICIENT_EVIDENCE-no-uncontaminated-batched-gpu-window",
        thermal: "INSUFFICIENT_EVIDENCE-no-uncontaminated-sustained-gpu-window",
        compositorPresentation: "NOT_CLAIMED-no-presentation-feedback-api",
        separationRule: "gpuTimestampPopulations and sustainedCadenceWindows are disjoint and have no combined sample population",
      },
    });
  }

  function gpuTimestampPopulationEvidence(windowId, samples) {
    return {
      schemaVersion: "object-sculptor-gpu-timestamp-population-v1",
      status: performancePublicationAuthority.publishable
        ? "measured-one-shot-scopes"
        : "diagnostic-one-shot-scopes",
      lane: "one-shot-gpu",
      populationId: windowId,
      performanceIdentity: immutablePerformanceIdentity,
      timingAuthority,
      performancePublicationAuthority,
      workloadBinding: oneShotGpuBindings.get(windowId),
      observedSampleCount: samples.length,
      retainedSampleCount: samples.length,
      sampleCount: samples.length,
      samples: samples.map((sample) => ({ ...sample })),
      cadenceEligibility: "ineligible-query-resolution-between-one-shot-scopes",
      presentationTimingVerdict: "NOT_CLAIMED",
    };
  }

  function sustainedCadenceWindowEvidence(windowId, samples) {
    const outcome = sustainedCadenceOutcomes.get(windowId) ?? null;
    const warmupFrameCount = outcome?.warmupFrameCount ?? 0;
    const measuredSamples = samples.slice(warmupFrameCount);
    const callbackIntervals = measuredSamples.map((sample) => sample.rafCallbackIntervalMs);
    const cpuSceneSubmitDurations = measuredSamples.map((sample) => sample.cpuSceneSubmitMs);
    const targetFrameMs = outcome?.targetFrameMs ?? null;
    const deadlineMissCount = targetFrameMs === null
      ? null
      : callbackIntervals.filter((value) => value > targetFrameMs + 1e-6).length;
    const completedContinuously = outcome?.failure === null
      && outcome?.completedCallbackCount === outcome?.requestedCallbackCount;
    const windowAcceptance = outcome?.status === "measured-continuous"
      ? "PASS"
      : outcome?.status === "diagnostic-continuous"
        ? "DIAGNOSTIC-nonpublishable-performance-authority"
        : outcome?.status === "insufficient-duration"
          ? "FAIL-minimum-measured-duration"
          : outcome?.status === "over-budget"
            ? "FAIL-p95-frame-budget"
            : "NOT_ACCEPTED-window-not-complete";
    return {
      schemaVersion: "object-sculptor-sustained-cadence-window-v1",
      status: outcome?.status ?? "unsealed",
      lane: "sustained-cadence",
      windowId,
      performanceIdentity: immutablePerformanceIdentity,
      timingAuthority,
      performancePublicationAuthority,
      cadenceContract: immutablePerformanceIdentity?.cadenceContract ?? null,
      workloadBinding: sustainedCadenceBindings.get(windowId),
      requestedWarmupFrameCount: outcome?.warmupFrameCount ?? null,
      requestedMeasuredFrameCount: outcome?.measuredFrameCount ?? null,
      targetFrameMs,
      windowAcceptance,
      warmupSamples: samples.slice(0, warmupFrameCount).map((sample) => ({ ...sample })),
      samples: measuredSamples.map((sample) => ({ ...sample })),
      observedSampleCount: samples.length,
      retainedSampleCount: samples.length,
      rawSampleCount: samples.length,
      measuredSampleCount: measuredSamples.length,
      continuity: {
        status: completedContinuously
          ? "driver-owned-back-to-back-raf-and-consecutive-controller-ordinals"
          : "not-proven",
        requestedCallbackCount: outcome?.requestedCallbackCount ?? null,
        completedCallbackCount: outcome?.completedCallbackCount ?? samples.length,
        gpuTimestampResolutionCalls: 0,
      },
      summary: {
        callbackIntervalP50Ms: quantile(callbackIntervals, 0.5),
        callbackIntervalP95Ms: quantile(callbackIntervals, 0.95),
        cpuSceneSubmitP50Ms: quantile(cpuSceneSubmitDurations, 0.5),
        cpuSceneSubmitP95Ms: quantile(cpuSceneSubmitDurations, 0.95),
        deadlineMissCount,
        deadlineMissRate: deadlineMissCount === null || measuredSamples.length === 0
          ? null
          : deadlineMissCount / measuredSamples.length,
        measuredDurationMs: callbackIntervals.reduce((sum, value) => sum + value, 0),
        minimumMeasuredDurationMs:
          immutablePerformanceIdentity?.cadenceContract?.minimumMeasuredDurationMs ?? null,
        p95BudgetSatisfied: outcome?.p95BudgetSatisfied ?? null,
      },
      finalHealth: outcome?.finalHealth ?? null,
      failure: outcome?.failure ?? null,
      presentationTimingVerdict: "NOT_CLAIMED",
    };
  }

  function recordPerformanceEvidenceLimitRejection(lane, reason) {
    if (lane === "one-shot-gpu") oneShotGpuLimitRejectionCount += 1;
    else sustainedCadenceLimitRejectionCount += 1;
    decorateMetrics();
    const error = new RangeError(reason);
    error.code = "CORPUS_PERFORMANCE_EVIDENCE_LIMIT";
    return error;
  }

  function requirePerformanceEvidenceCapacity(lane, windowId, requestedSampleCount = 1) {
    requirePositiveInteger(requestedSampleCount, "requested performance sample count");
    const windows = lane === "one-shot-gpu"
      ? oneShotGpuSamplesByWindow
      : sustainedCadenceSamplesByWindow;
    const retainedSampleCount = lane === "one-shot-gpu"
      ? oneShotGpuRetainedSampleCount
      : sustainedCadenceRetainedSampleCount;
    if (
      !windows.has(windowId)
      && windows.size >= boundedPerformanceEvidenceLimits.maxWindowCountPerLane
    ) {
      throw recordPerformanceEvidenceLimitRejection(
        lane,
        `${lane} performance evidence reached its bounded window-count limit`,
      );
    }
    if (
      retainedSampleCount + requestedSampleCount
      > boundedPerformanceEvidenceLimits.maxSampleCountPerLane
    ) {
      throw recordPerformanceEvidenceLimitRejection(
        lane,
        `${lane} performance evidence reached its bounded per-lane sample-count limit`,
      );
    }
  }

  function retainOneShotGpuSample(windowId, sample) {
    let samples = oneShotGpuSamplesByWindow.get(windowId);
    if (!samples) {
      samples = [];
      oneShotGpuSamplesByWindow.set(windowId, samples);
    }
    samples.push(sample);
    oneShotGpuObservedSampleCount += 1;
    oneShotGpuRetainedSampleCount += 1;
    lastOneShotGpuSample = sample;
  }

  function retainSustainedCadenceSample(windowId, sample) {
    let samples = sustainedCadenceSamplesByWindow.get(windowId);
    if (!samples) {
      samples = [];
      sustainedCadenceSamplesByWindow.set(windowId, samples);
    }
    samples.push(sample);
    sustainedCadenceObservedSampleCount += 1;
    sustainedCadenceRetainedSampleCount += 1;
    lastSustainedCadenceSample = sample;
  }

  function requirePerformanceSampleWindow(options) {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("performance sample options must be an object");
    }
    const optionKeys = Object.keys(options);
    if (optionKeys.length !== 1 || optionKeys[0] !== "windowId") {
      throw new TypeError(
        "performance samples accept only windowId; rAF callback time and delta are observed by the driver",
      );
    }
    if (typeof options.windowId !== "string" || options.windowId.length === 0) {
      throw new TypeError("performance windowId must be a nonempty string");
    }
    return options.windowId;
  }

  function requireCadenceWindowOptions(options) {
    exactObjectKeys(options, [
      "windowId",
      "warmupFrameCount",
      "measuredFrameCount",
      "targetFrameMs",
    ], "sustained cadence window options");
    requireNonemptyString(options.windowId, "sustained cadence windowId");
    requirePositiveInteger(options.warmupFrameCount, "sustained cadence warmupFrameCount");
    requirePositiveInteger(options.measuredFrameCount, "sustained cadence measuredFrameCount");
    requireFinitePositive(options.targetFrameMs, "sustained cadence targetFrameMs");
    if (options.warmupFrameCount < CORPUS_CADENCE_WINDOW_LIMITS.minWarmupFrameCount) {
      throw new RangeError(
        `sustained cadence requires at least ${CORPUS_CADENCE_WINDOW_LIMITS.minWarmupFrameCount} warmup frames`,
      );
    }
    if (options.measuredFrameCount < CORPUS_CADENCE_WINDOW_LIMITS.minMeasuredFrameCount) {
      throw new RangeError(
        `sustained cadence requires at least ${CORPUS_CADENCE_WINDOW_LIMITS.minMeasuredFrameCount} measured frames`,
      );
    }
    return Object.freeze({ ...options });
  }

  function samplePerformanceFrame(options = {}) {
    let windowId;
    try {
      windowId = requirePerformanceSampleWindow(options);
      assertPerformanceIdentityMatchesController(
        immutablePerformanceIdentity,
        controller,
        "one-shot-gpu",
        `GPU timestamp population ${windowId}`,
      );
      requirePerformanceEvidenceCapacity("one-shot-gpu", windowId);
    } catch (error) {
      return Promise.reject(error);
    }
    if (state === "running" || manualPerformanceOperationPending) {
      driverFrameErrorCount += 1;
      decorateMetrics();
      return Promise.reject(frameOwnerConflictError());
    }

    manualPerformanceOperationPending = true;
    const operation = enqueue(async () => {
      if (!acceptingActions()) throw notAcceptingError(state, lastFailure);
      if (state === "running") throw frameOwnerConflictError();
      const beforeSnapshot = performanceControllerSnapshot(controller, "one-shot-gpu");
      const beforeMetrics = beforeSnapshot.metrics;
      const beforeBinding = assertPerformanceIdentityMatchesController(
        immutablePerformanceIdentity,
        controller,
        "one-shot-gpu",
        `GPU timestamp population ${windowId}`,
      );
      const existingBinding = oneShotGpuBindings.get(windowId) ?? null;
      if (existingBinding) {
        assertSamePerformanceWorkload(beforeBinding, existingBinding, `performance window ${windowId}`);
      }
      const previousContinuity = oneShotGpuContinuity.get(windowId) ?? null;
      if (
        previousContinuity
        && (
          beforeMetrics.completedFrames !== previousContinuity.completedFrames
          || beforeMetrics.renderSubmissions !== previousContinuity.renderSubmissions
        )
      ) {
        throw new Error(`GPU timestamp population ${windowId} is discontinuous between samples`);
      }
      const rafCallbackTimestampMs = await requestManualFrameTimestamp();
      const previousRafCallbackMs = oneShotGpuLastRafCallbackMs.get(windowId) ?? null;
      const rafCallbackIntervalMs = previousRafCallbackMs === null
        ? null
        : rafCallbackTimestampMs - previousRafCallbackMs;
      if (rafCallbackIntervalMs !== null && rafCallbackIntervalMs <= 0) {
        throw new RangeError(
          "performance requestAnimationFrame callback timestamps must increase strictly within a window",
        );
      }
      const startedAtMs = now();
      requireFiniteNonnegative(startedAtMs, "performance CPU sample start");
      await controller.renderOnce();
      const finishedAtMs = now();
      const cpuSceneSubmitMs = finishedAtMs - startedAtMs;
      requireFiniteNonnegative(finishedAtMs, "performance CPU sample finish");
      requireFiniteNonnegative(cpuSceneSubmitMs, "performance CPU scene-submit duration");
      const gpuTimestampSample = await controller.resolveGpuTimestampSample();
      const afterSnapshot = performanceControllerSnapshot(controller, "one-shot-gpu");
      const afterMetrics = afterSnapshot.metrics;
      const afterBinding = assertPerformanceIdentityMatchesController(
        immutablePerformanceIdentity,
        controller,
        "one-shot-gpu",
        `GPU timestamp population ${windowId}`,
      );
      validateGpuTimestampSample(
        gpuTimestampSample,
        beforeMetrics,
        afterMetrics,
        beforeBinding,
        afterBinding,
      );
      assertSamePerformanceWorkload(afterBinding, beforeBinding, `performance window ${windowId}`);
      if (!existingBinding) oneShotGpuBindings.set(windowId, beforeBinding);
      const sample = deepFreezePlain({
        schemaVersion: "object-sculptor-frame-performance-sample-v1",
        status: performancePublicationAuthority.publishable ? "measured" : "diagnostic",
        measurementClass: "one-shot-gpu",
        workloadScope: "fixed-time-render-only",
        windowId,
        windowSampleOrdinal: (oneShotGpuSamplesByWindow.get(windowId)?.length ?? 0) + 1,
        globalSampleOrdinal: oneShotGpuObservedSampleCount + 1,
        deltaSeconds: 0,
        fixedTimeSeconds: beforeBinding.timeSeconds,
        cpuSceneSubmitMs,
        rafCallbackTimestampMs,
        rafCallbackIntervalMs,
        rafCallbackTimestampSource: "requestAnimationFrame callback argument",
        rafCallbackIntervalInterpretation: "diagnostic-only; the prior blocking timestamp resolve can delay this callback",
        cadenceAcceptance: "ineligible-blocking-gpu-timestamp-resolution-between-callbacks",
        thermalAcceptance: "ineligible-one-shot-gpu-path",
        presentationTimestampMs: null,
        presentationIntervalMs: null,
        presentationTimingStatus: "unavailable-no-compositor-presentation-feedback",
        rendererDeviceGeneration: gpuTimestampSample.rendererDeviceGeneration,
        deviceLossGeneration: gpuTimestampSample.deviceLossGeneration,
        frameOrdinal: gpuTimestampSample.frameOrdinal,
        submissionOrdinal: gpuTimestampSample.submissionOrdinal,
        gpuMs: gpuTimestampSample.gpuMs,
        gpuResolveOverheadMs: gpuTimestampSample.resolveOverheadMs,
        gpuScope: gpuTimestampSample.scope,
        subjectId: gpuTimestampSample.subjectId,
        tier: gpuTimestampSample.tier,
        mode: gpuTimestampSample.mode,
        seed: gpuTimestampSample.seed,
        performanceIdentity: immutablePerformanceIdentity,
        timingAuthority,
        performancePublicationAuthority,
        workloadBinding: beforeBinding,
        controllerBefore: {
          completedFrames: beforeMetrics.completedFrames,
          renderSubmissions: beforeMetrics.renderSubmissions,
          rendererDeviceStatus: beforeMetrics.rendererDeviceStatus,
        },
        controllerAfter: {
          completedFrames: afterMetrics.completedFrames,
          renderSubmissions: afterMetrics.renderSubmissions,
          rendererDeviceStatus: afterMetrics.rendererDeviceStatus,
        },
        gpuTimestampSample,
      });
      retainOneShotGpuSample(windowId, sample);
      oneShotGpuLastRafCallbackMs.set(windowId, rafCallbackTimestampMs);
      oneShotGpuContinuity.set(windowId, deepFreezePlain({
        completedFrames: afterMetrics.completedFrames,
        renderSubmissions: afterMetrics.renderSubmissions,
      }));
      publishMetrics();
      return sample;
    }, { errorKind: "frame" });
    return operation.finally(() => {
      manualPerformanceOperationPending = false;
    });
  }

  function runCadenceWindow(options = {}) {
    let config;
    let totalFrameCount;
    try {
      config = requireCadenceWindowOptions(options);
      totalFrameCount = config.warmupFrameCount + config.measuredFrameCount;
      assertPerformanceIdentityMatchesController(
        immutablePerformanceIdentity,
        controller,
        "sustained-cadence",
        `sustained cadence window ${config.windowId}`,
      );
      assertCadenceWindowMatchesIdentity(config, immutablePerformanceIdentity);
      if (sustainedCadenceSamplesByWindow.has(config.windowId)) {
        throw new Error(`sustained cadence window ${config.windowId} already exists`);
      }
      requirePerformanceEvidenceCapacity(
        "sustained-cadence",
        config.windowId,
        totalFrameCount,
      );
    } catch (error) {
      return Promise.reject(error);
    }
    if (state === "running" || manualPerformanceOperationPending) {
      driverFrameErrorCount += 1;
      decorateMetrics();
      return Promise.reject(frameOwnerConflictError());
    }

    manualPerformanceOperationPending = true;
    const operation = enqueue(async () => {
      if (!acceptingActions()) throw notAcceptingError(state, lastFailure);
      if (state === "running") throw frameOwnerConflictError();
      const initialSnapshot = performanceControllerSnapshot(controller, "sustained-cadence");
      const workloadBinding = assertPerformanceIdentityMatchesController(
        immutablePerformanceIdentity,
        controller,
        "sustained-cadence",
        `sustained cadence window ${config.windowId}`,
      );
      const cadenceContract = assertCadenceWindowMatchesIdentity(
        config,
        immutablePerformanceIdentity,
      );
      sustainedCadenceBindings.set(config.windowId, workloadBinding);
      sustainedCadenceSamplesByWindow.set(config.windowId, []);
      sustainedCadenceOutcomes.set(config.windowId, deepFreezePlain({
        status: "running",
        warmupFrameCount: config.warmupFrameCount,
        measuredFrameCount: config.measuredFrameCount,
        targetFrameMs: config.targetFrameMs,
        minimumMeasuredDurationMs: cadenceContract.minimumMeasuredDurationMs,
        requestedCallbackCount: totalFrameCount,
        completedCallbackCount: 0,
        finalHealth: null,
        failure: null,
      }));

      let beforeMetrics = initialSnapshot.metrics;
      let previousRafCallbackMs = null;
      let completedCallbackCount = 0;
      try {
        for (let index = 0; index < totalFrameCount; index += 1) {
          const rafCallbackTimestampMs = await requestManualFrameTimestamp();
          const rafCallbackIntervalMs = previousRafCallbackMs === null
            ? null
            : rafCallbackTimestampMs - previousRafCallbackMs;
          if (rafCallbackIntervalMs !== null && rafCallbackIntervalMs <= 0) {
            throw new RangeError(
              "cadence requestAnimationFrame callback timestamps must increase strictly within a window",
            );
          }
          const startedAtMs = requireFiniteNonnegative(now(), "cadence CPU sample start");
          await controller.renderOnce();
          const finishedAtMs = requireFiniteNonnegative(now(), "cadence CPU sample finish");
          const cpuSceneSubmitMs = requireFiniteNonnegative(
            finishedAtMs - startedAtMs,
            "cadence CPU scene-submit duration",
          );
          const afterSnapshot = performanceControllerSnapshot(controller, "sustained-cadence");
          const afterMetrics = afterSnapshot.metrics;
          assertPerformanceIdentityMatchesController(
            immutablePerformanceIdentity,
            controller,
            "sustained-cadence",
            `sustained cadence window ${config.windowId}`,
          );
          assertSamePerformanceWorkload(
            afterSnapshot.workload,
            workloadBinding,
            `cadence window ${config.windowId}`,
          );
          if (
            afterMetrics.completedFrames !== beforeMetrics.completedFrames + 1
            || afterMetrics.renderSubmissions !== beforeMetrics.renderSubmissions + 1
          ) {
            throw new Error("cadence frame did not submit exactly one completed frame");
          }
          const phase = index < config.warmupFrameCount ? "warmup" : "measured";
          const sample = deepFreezePlain({
            schemaVersion: "object-sculptor-frame-cadence-sample-v1",
            status: performancePublicationAuthority.publishable ? "measured" : "diagnostic",
            measurementClass: "sustained-cadence",
            workloadScope: "fixed-time-render-only",
            phase,
            windowId: config.windowId,
            windowSampleOrdinal: index + 1,
            phaseSampleOrdinal: phase === "warmup"
              ? index + 1
              : index - config.warmupFrameCount + 1,
            globalSampleOrdinal: sustainedCadenceObservedSampleCount + 1,
            deltaSeconds: 0,
            fixedTimeSeconds: workloadBinding.timeSeconds,
            cpuSceneSubmitMs,
            rafCallbackTimestampMs,
            rafCallbackIntervalMs,
            rafCallbackTimestampSource: "requestAnimationFrame callback argument",
            cadenceAcceptance: phase === "warmup"
              ? "excluded-explicit-warmup"
              : performancePublicationAuthority.publishable
                ? "candidate-driver-owned-no-gpu-query-resolution-window-pending-duration-and-p95-gates"
                : "diagnostic-dependency-injected-timing-not-publishable",
            gpuTimestampResolutionCalls: 0,
            presentationTimestampMs: null,
            presentationIntervalMs: null,
            presentationTimingStatus: "unavailable-no-compositor-presentation-feedback",
            performanceIdentity: immutablePerformanceIdentity,
            timingAuthority,
            performancePublicationAuthority,
            cadenceContract,
            workloadBinding,
            controllerBefore: {
              completedFrames: beforeMetrics.completedFrames,
              renderSubmissions: beforeMetrics.renderSubmissions,
              rendererDeviceStatus: beforeMetrics.rendererDeviceStatus,
            },
            controllerAfter: {
              completedFrames: afterMetrics.completedFrames,
              renderSubmissions: afterMetrics.renderSubmissions,
              rendererDeviceStatus: afterMetrics.rendererDeviceStatus,
            },
          });
          retainSustainedCadenceSample(config.windowId, sample);
          completedCallbackCount += 1;
          previousRafCallbackMs = rafCallbackTimestampMs;
          beforeMetrics = afterMetrics;
        }

        publishMetrics();
        const finalHealth = performanceHealthSnapshot(
          `sustained cadence window ${config.windowId} final seal`,
        );
        if (finalHealth.status === "INVALID") {
          throw new Error(`sustained cadence final health failed: ${finalHealth.reason}`);
        }
        const measuredSamples = sustainedCadenceSamplesByWindow
          .get(config.windowId)
          .slice(config.warmupFrameCount);
        const measuredDurationMs = measuredSamples.reduce(
          (sum, sample) => sum + (sample.rafCallbackIntervalMs ?? 0),
          0,
        );
        const measuredCallbackIntervals = measuredSamples.map(
          (sample) => sample.rafCallbackIntervalMs,
        );
        const callbackIntervalP95Ms = quantile(measuredCallbackIntervals, 0.95);
        const durationSatisfied = measuredDurationMs >= cadenceContract.minimumMeasuredDurationMs;
        const p95BudgetSatisfied = callbackIntervalP95Ms !== null
          && callbackIntervalP95Ms <= cadenceContract.targetFrameMs + 1e-6;
        sustainedCadenceOutcomes.set(config.windowId, deepFreezePlain({
          status: !durationSatisfied
            ? "insufficient-duration"
            : !p95BudgetSatisfied
              ? "over-budget"
              : performancePublicationAuthority.publishable
                ? "measured-continuous"
                : "diagnostic-continuous",
          warmupFrameCount: config.warmupFrameCount,
          measuredFrameCount: config.measuredFrameCount,
          targetFrameMs: config.targetFrameMs,
          minimumMeasuredDurationMs: cadenceContract.minimumMeasuredDurationMs,
          measuredDurationMs,
          callbackIntervalP95Ms,
          p95BudgetSatisfied,
          requestedCallbackCount: totalFrameCount,
          completedCallbackCount,
          finalHealth,
          failure: null,
        }));
        return sustainedCadenceWindowEvidence(
          config.windowId,
          sustainedCadenceSamplesByWindow.get(config.windowId),
        );
      } catch (value) {
        const error = asError(value);
        const cancelled = error.code === "CORPUS_MANUAL_FRAME_CANCELLED" && state === "closing";
        sustainedCadenceOutcomes.set(config.windowId, deepFreezePlain({
          status: cancelled ? "cancelled-by-close" : "failed",
          warmupFrameCount: config.warmupFrameCount,
          measuredFrameCount: config.measuredFrameCount,
          targetFrameMs: config.targetFrameMs,
          minimumMeasuredDurationMs: cadenceContract.minimumMeasuredDurationMs,
          requestedCallbackCount: totalFrameCount,
          completedCallbackCount,
          finalHealth: performanceHealthSnapshot(
            `sustained cadence window ${config.windowId} failure seal`,
          ),
          failure: {
            name: error.name,
            message: error.message,
            code: error.code ?? null,
          },
        }));
        throw error;
      }
    }, { errorKind: "frame" });
    return operation.finally(() => {
      manualPerformanceOperationPending = false;
    });
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
    if (
      state === "running"
      || state === "closing"
      || state === "closed"
      || state === "failed"
      || manualPerformanceOperationPending
    ) return false;
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
    cancelManualScheduledFrame("Manual performance frame was cancelled by driver close");
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
  publicController.getMetrics = () => refreshMetrics();
  publicController.getRouteLockState = () => routeLockState;
  for (const method of PUBLIC_READ_METHODS) {
    publicController[method] = (...args) => invokeReadController(method, args);
  }
  publicController.getPerformanceEvidence = (...args) => invokeReadController(
    "getPerformanceEvidence",
    args,
  ).then((controllerEvidence) => performanceWindowEvidence(controllerEvidence));
  publicController.getPerformanceWindowEvidence = () => performanceWindowEvidence();
  publicController.samplePerformanceFrame = (options) => samplePerformanceFrame(options);
  publicController.runCadenceWindow = (options) => runCadenceWindow(options);
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
