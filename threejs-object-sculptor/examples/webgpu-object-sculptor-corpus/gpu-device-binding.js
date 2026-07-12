const BINDING_SCHEMA_VERSION = "object-sculptor-retained-gpu-device-binding-v1";

export const CORPUS_GPU_FEATURE_ALLOWLIST = Object.freeze([
  "bgra8unorm-storage",
  "clip-distances",
  "core-features-and-limits",
  "depth-clip-control",
  "depth32float-stencil8",
  "dual-source-blending",
  "float32-blendable",
  "float32-filterable",
  "indirect-first-instance",
  "rg11b10ufloat-renderable",
  "shader-f16",
  "subgroups",
  "texture-compression-astc",
  "texture-compression-astc-sliced-3d",
  "texture-compression-bc",
  "texture-compression-bc-sliced-3d",
  "texture-compression-etc2",
  "texture-formats-tier1",
  "texture-formats-tier2",
  "timestamp-query",
]);

export const CORPUS_GPU_LIMIT_ALLOWLIST = Object.freeze([
  "maxBindGroups",
  "maxBindGroupsPlusVertexBuffers",
  "maxBindingsPerBindGroup",
  "maxBufferSize",
  "maxColorAttachmentBytesPerSample",
  "maxColorAttachments",
  "maxComputeInvocationsPerWorkgroup",
  "maxComputeWorkgroupSizeX",
  "maxComputeWorkgroupSizeY",
  "maxComputeWorkgroupSizeZ",
  "maxComputeWorkgroupsPerDimension",
  "maxComputeWorkgroupStorageSize",
  "maxDynamicStorageBuffersPerPipelineLayout",
  "maxDynamicUniformBuffersPerPipelineLayout",
  "maxInterStageShaderVariables",
  "maxSampledTexturesPerShaderStage",
  "maxSamplersPerShaderStage",
  "maxStorageBufferBindingSize",
  "maxStorageBuffersPerShaderStage",
  "maxStorageTexturesPerShaderStage",
  "maxTextureArrayLayers",
  "maxTextureDimension1D",
  "maxTextureDimension2D",
  "maxTextureDimension3D",
  "maxUniformBufferBindingSize",
  "maxUniformBuffersPerShaderStage",
  "maxVertexAttributes",
  "maxVertexBufferArrayStride",
  "maxVertexBuffers",
  "minStorageBufferOffsetAlignment",
  "minUniformBufferOffsetAlignment",
]);

const ADAPTER_INFO_STRING_FIELDS = Object.freeze([
  "vendor",
  "architecture",
  "device",
  "description",
]);

const ADAPTER_INFO_NUMBER_FIELDS = Object.freeze([
  "subgroupMinSize",
  "subgroupMaxSize",
]);

const SOFTWARE_ADAPTER_PATTERN = /(?:swiftshader|llvmpipe|softpipe|lavapipe|software rasterizer|cpu rasterizer|microsoft basic render|\bwarp\b)/i;
const GENERIC_ADAPTER_NAME_PATTERN = /^(?:unknown|default|webgpu|gpu|graphics adapter|unnamed graphics adapter)$/i;
const bindingRecords = new WeakMap();
const leaseRecords = new WeakMap();

function deepFreezePlain(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreezePlain(child);
  return value;
}

function exactObjectKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length > 0) {
    throw new TypeError(`${label} contains unsupported fields: ${extras.join(", ")}`);
  }
}

function supportedFeatureNames(features) {
  return CORPUS_GPU_FEATURE_ALLOWLIST.filter((name) => features?.has?.(name) === true);
}

function snapshotLimits(limits) {
  const snapshot = {};
  for (const name of CORPUS_GPU_LIMIT_ALLOWLIST) {
    const value = limits?.[name];
    if (Number.isFinite(value) && value >= 0) snapshot[name] = value;
  }
  return snapshot;
}

function normalizeRequiredLimits(limits) {
  if (limits === undefined) return {};
  exactObjectKeys(limits, CORPUS_GPU_LIMIT_ALLOWLIST, "required WebGPU limits");
  const normalized = {};
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError(`required WebGPU limit ${name} must be a nonnegative integer`);
    }
    normalized[name] = value;
  }
  return normalized;
}

function normalizeRequiredFeatures(features, adapterFeatures, requireTimestampQuery) {
  if (features !== undefined && !Array.isArray(features)) {
    throw new TypeError("required WebGPU features must be an array");
  }
  const requested = features === undefined
    ? supportedFeatureNames(adapterFeatures)
    : [...features];
  if (requireTimestampQuery && !requested.includes("timestamp-query")) {
    requested.push("timestamp-query");
  }
  requested.sort();
  if (new Set(requested).size !== requested.length) {
    throw new Error("required WebGPU features contain duplicates");
  }
  for (const name of requested) {
    if (!CORPUS_GPU_FEATURE_ALLOWLIST.includes(name)) {
      throw new RangeError(`required WebGPU feature "${name}" is not allowlisted`);
    }
    if (adapterFeatures?.has?.(name) !== true) {
      throw new Error(`retained GPUAdapter does not support required feature "${name}"`);
    }
  }
  return requested;
}

async function readAdapterInfo(adapter) {
  let value = null;
  let source = "unavailable";
  try {
    if (adapter.info && typeof adapter.info === "object") {
      value = adapter.info;
      source = "GPUAdapter.info";
    } else if (typeof adapter.requestAdapterInfo === "function") {
      value = await adapter.requestAdapterInfo();
      source = "GPUAdapter.requestAdapterInfo()";
    }
  } catch {
    value = null;
    source = "unavailable-adapter-info-read-failed";
  }
  const info = {};
  for (const field of ADAPTER_INFO_STRING_FIELDS) {
    const fieldValue = value?.[field];
    if (typeof fieldValue === "string" && fieldValue.trim().length > 0) {
      info[field] = fieldValue.trim();
    }
  }
  for (const field of ADAPTER_INFO_NUMBER_FIELDS) {
    const fieldValue = value?.[field];
    if (Number.isFinite(fieldValue) && fieldValue >= 0) info[field] = fieldValue;
  }
  return { info, source };
}

function adapterDisplayName(info) {
  for (const field of ["description", "device", "architecture", "vendor"]) {
    if (typeof info[field] === "string" && info[field].length > 0) {
      return { name: info[field], source: `adapter-info.${field}` };
    }
  }
  return { name: null, source: "unavailable" };
}

function strongAdapterName(info) {
  for (const field of ["description", "device"]) {
    const value = info[field];
    if (
      typeof value === "string"
      && value.length > 0
      && !GENERIC_ADAPTER_NAME_PATTERN.test(value)
    ) return value;
  }
  return null;
}

function classifyAdapter(info, isFallbackAdapter) {
  const identityText = ADAPTER_INFO_STRING_FIELDS
    .map((field) => info[field] ?? "")
    .join(" ");
  if (isFallbackAdapter === true || SOFTWARE_ADAPTER_PATTERN.test(identityText)) {
    return "software";
  }
  if (isFallbackAdapter === false && strongAdapterName(info) !== null) {
    return "hardware";
  }
  return "unknown";
}

function requireBindingRecord(binding) {
  if (!binding || typeof binding !== "object") {
    throw new TypeError("retained Object Sculptor GPU device binding is required");
  }
  const record = bindingRecords.get(binding);
  if (!record) {
    throw new TypeError(
      "Object Sculptor GPU device binding was not created by createCorpusGpuDeviceBinding()",
    );
  }
  return record;
}

function bindingEvidence(record) {
  return deepFreezePlain({
    ...record.baseEvidence,
    lifecycle: {
      lossObserverInstalled: true,
      lossStatus: record.lossStatus,
      lossInfo: record.lossInfo,
      activeLease: record.activeLease !== null,
      leaseGeneration: record.leaseGeneration,
      reuseStatus: record.reuseStatus,
      taintReason: record.taintReason,
      disposeStatus: record.disposeStatus,
      disposeAttempts: record.disposeAttempts,
      destroyCallCount: record.destroyCallCount,
    },
  });
}

function requireLeaseRecord(lease) {
  if (!lease || typeof lease !== "object") {
    throw new TypeError("retained Object Sculptor GPU device binding lease is required");
  }
  const record = leaseRecords.get(lease);
  if (!record) throw new TypeError("Object Sculptor GPU device binding lease is invalid");
  return record;
}

export async function createCorpusGpuDeviceBinding(options = {}) {
  exactObjectKeys(options, [
    "gpu",
    "requestAdapter",
    "powerPreference",
    "requiredFeatures",
    "requiredLimits",
    "requireTimestampQuery",
  ], "Object Sculptor GPU device binding options");
  const {
    gpu = globalThis.navigator?.gpu,
    requestAdapter: injectedRequestAdapter,
    powerPreference,
    requiredFeatures,
    requiredLimits,
    requireTimestampQuery = false,
  } = options;
  if (typeof requireTimestampQuery !== "boolean") {
    throw new TypeError("requireTimestampQuery must be a boolean");
  }
  if (
    powerPreference !== undefined
    && !["low-power", "high-performance"].includes(powerPreference)
  ) {
    throw new RangeError(`Unknown WebGPU powerPreference "${powerPreference}"`);
  }
  if (injectedRequestAdapter !== undefined && typeof injectedRequestAdapter !== "function") {
    throw new TypeError("requestAdapter dependency must be a function");
  }
  if (injectedRequestAdapter !== undefined && options.gpu !== undefined) {
    throw new Error("Provide either gpu or requestAdapter, not both");
  }
  const requestAdapter = injectedRequestAdapter ?? gpu?.requestAdapter?.bind(gpu);
  if (typeof requestAdapter !== "function") {
    throw new TypeError("navigator.gpu.requestAdapter is unavailable");
  }

  const adapterOptions = {
    featureLevel: "compatibility",
  };
  if (powerPreference !== undefined) adapterOptions.powerPreference = powerPreference;
  const adapter = await requestAdapter(adapterOptions);
  if (!adapter || typeof adapter !== "object") {
    throw new Error("Unable to acquire a native WebGPU adapter for the Object Sculptor corpus");
  }
  if (typeof adapter.requestDevice !== "function") {
    throw new TypeError("retained GPUAdapter does not expose requestDevice()");
  }

  const normalizedRequiredLimits = normalizeRequiredLimits(requiredLimits);
  const normalizedRequiredFeatures = normalizeRequiredFeatures(
    requiredFeatures,
    adapter.features,
    requireTimestampQuery,
  );
  const deviceDescriptor = {
    label: "Object Sculptor corpus retained renderer device",
    requiredFeatures: normalizedRequiredFeatures,
    requiredLimits: normalizedRequiredLimits,
  };
  const device = await adapter.requestDevice(deviceDescriptor);
  if (!device || typeof device !== "object") {
    throw new Error("retained GPUAdapter did not return a GPUDevice");
  }
  if (!device.lost || typeof device.lost.then !== "function") {
    throw new TypeError("retained GPUDevice does not expose its loss promise");
  }
  for (const feature of normalizedRequiredFeatures) {
    if (device.features?.has?.(feature) !== true) {
      throw new Error(`retained GPUDevice did not enable required feature "${feature}"`);
    }
  }

  const { info, source: adapterInfoSource } = await readAdapterInfo(adapter);
  const fallbackState = typeof adapter.isFallbackAdapter === "boolean"
    ? adapter.isFallbackAdapter
    : null;
  const displayName = adapterDisplayName(info);
  const adapterClass = classifyAdapter(info, fallbackState);
  const globalGpu = globalThis.navigator?.gpu ?? null;
  const adapterRequestAuthority = injectedRequestAdapter !== undefined
    ? "dependency-injected-untrusted"
    : gpu !== null && gpu !== undefined && gpu === globalGpu
      ? "navigator.gpu-current-realm"
      : "gpu-object-untrusted";
  const baseEvidence = deepFreezePlain({
    schemaVersion: BINDING_SCHEMA_VERSION,
    source: "retained-GPUAdapter-requestDevice",
    adapterRequest: {
      options: { ...adapterOptions },
      infoSource: adapterInfoSource,
      authority: adapterRequestAuthority,
    },
    deviceRequest: {
      descriptor: {
        label: deviceDescriptor.label,
        requiredFeatures: [...normalizedRequiredFeatures],
        requiredLimits: { ...normalizedRequiredLimits },
      },
    },
    adapter: {
      adapterClass,
      name: displayName.name,
      nameSource: displayName.source,
      identitySource: `${adapterInfoSource}+GPUAdapter.isFallbackAdapter`,
      isFallbackAdapter: fallbackState,
      info,
      features: supportedFeatureNames(adapter.features),
      limits: snapshotLimits(adapter.limits),
    },
    device: {
      type: device.constructor?.name ?? "unknown",
      label: typeof device.label === "string" ? device.label : "",
      features: supportedFeatureNames(device.features),
      limits: snapshotLimits(device.limits),
      lossPromisePresent: true,
    },
    rendererBindingStatus: "pending-renderer-initialization",
  });
  const binding = Object.freeze({
    schemaVersion: BINDING_SCHEMA_VERSION,
    device,
  });
  const record = {
    adapter,
    device,
    baseEvidence,
    activeLease: null,
    leaseGeneration: 0,
    reuseStatus: "available",
    taintReason: null,
    lossStatus: "pending",
    lossInfo: null,
    disposeStatus: "active",
    disposeAttempts: 0,
    destroyCallCount: 0,
  };
  bindingRecords.set(binding, record);
  void Promise.resolve(device.lost).then(
    (info) => {
      record.lossStatus = "resolved";
      record.lossInfo = deepFreezePlain({
        reason: typeof info?.reason === "string" ? info.reason : null,
        message: typeof info?.message === "string" ? info.message : "",
      });
      const activeLease = record.activeLease;
      if (activeLease?.onDeviceLost) activeLease.onDeviceLost(record.lossInfo);
    },
    (error) => {
      record.lossStatus = "rejected";
      record.lossInfo = deepFreezePlain({
        reason: "loss-promise-rejected",
        message: error instanceof Error ? error.message : String(error),
      });
      const activeLease = record.activeLease;
      if (activeLease?.onDeviceLost) activeLease.onDeviceLost(record.lossInfo);
    },
  );
  return binding;
}

export function describeCorpusGpuDeviceBinding(binding) {
  return bindingEvidence(requireBindingRecord(binding));
}

export function rendererDeviceFromCorpusGpuDeviceBinding(binding) {
  return requireBindingRecord(binding).device;
}

export function assertCorpusGpuDeviceBindingMatchesRenderer(binding, rendererDevice) {
  const record = requireBindingRecord(binding);
  if (rendererDevice !== record.device) {
    const error = new Error(
      "Initialized Object Sculptor renderer backend device does not match the retained GPUAdapter requestDevice() result",
    );
    error.name = "SecurityError";
    error.code = "CORPUS_RETAINED_GPU_DEVICE_MISMATCH";
    throw error;
  }
  return bindingEvidence(record);
}

export function acquireCorpusGpuDeviceBinding(binding, options = {}) {
  exactObjectKeys(options, ["owner", "onDeviceLost"], "GPU device binding lease options");
  const record = requireBindingRecord(binding);
  if (record.disposeStatus !== "active") {
    throw new Error(`Object Sculptor GPU device binding is ${record.disposeStatus}`);
  }
  if (record.reuseStatus !== "available") {
    throw new Error(
      `Object Sculptor GPU device binding is not reusable: ${record.taintReason ?? record.reuseStatus}`,
    );
  }
  if (record.lossStatus !== "pending") {
    throw new Error("Object Sculptor GPU device binding cannot be leased after device loss");
  }
  if (record.activeLease !== null) {
    throw new Error("Object Sculptor GPU device binding already has an active controller lease");
  }
  const owner = options.owner ?? "object-sculptor-controller";
  if (typeof owner !== "string" || owner.length === 0) {
    throw new TypeError("GPU device binding lease owner must be a nonempty string");
  }
  if (options.onDeviceLost !== undefined && typeof options.onDeviceLost !== "function") {
    throw new TypeError("GPU device binding onDeviceLost must be a function");
  }
  const lease = Object.freeze({
    schemaVersion: "object-sculptor-gpu-device-binding-lease-v1",
    device: record.device,
  });
  const leaseRecord = {
    binding,
    bindingRecord: record,
    owner,
    generation: record.leaseGeneration + 1,
    onDeviceLost: options.onDeviceLost ?? null,
    priorUncapturedErrorHandler: record.device.onuncapturederror ?? null,
    active: true,
  };
  record.leaseGeneration = leaseRecord.generation;
  record.activeLease = leaseRecord;
  leaseRecords.set(lease, leaseRecord);
  return lease;
}

export function assertCorpusGpuDeviceBindingLeaseMatchesRenderer(lease, rendererDevice) {
  const leaseRecord = requireLeaseRecord(lease);
  if (!leaseRecord.active || leaseRecord.bindingRecord.activeLease !== leaseRecord) {
    throw new Error("Object Sculptor GPU device binding lease is not active");
  }
  return assertCorpusGpuDeviceBindingMatchesRenderer(
    leaseRecord.binding,
    rendererDevice,
  );
}

export function releaseCorpusGpuDeviceBindingLease(lease, options = {}) {
  exactObjectKeys(options, ["reusable", "reason"], "GPU device binding lease release options");
  const leaseRecord = requireLeaseRecord(lease);
  if (!leaseRecord.active) return false;
  if (leaseRecord.bindingRecord.activeLease !== leaseRecord) {
    throw new Error("Object Sculptor GPU device binding lease ownership drifted");
  }
  const reusable = options.reusable ?? true;
  if (typeof reusable !== "boolean") {
    throw new TypeError("GPU device binding lease reusable flag must be a boolean");
  }
  if (
    options.reason !== undefined
    && (typeof options.reason !== "string" || options.reason.length === 0)
  ) {
    throw new TypeError("GPU device binding lease release reason must be a nonempty string");
  }
  let restorationError = null;
  try {
    leaseRecord.bindingRecord.device.onuncapturederror
      = leaseRecord.priorUncapturedErrorHandler;
  } catch (error) {
    restorationError = error;
  }
  leaseRecord.active = false;
  leaseRecord.onDeviceLost = null;
  leaseRecord.bindingRecord.activeLease = null;
  if (!reusable || restorationError) {
    leaseRecord.bindingRecord.reuseStatus = "tainted-uncertain-teardown";
    leaseRecord.bindingRecord.taintReason = restorationError
      ? `uncaptured-error-handler restoration failed: ${restorationError instanceof Error ? restorationError.message : String(restorationError)}`
      : options.reason ?? "controller teardown was uncertain";
  }
  if (restorationError) throw restorationError;
  return true;
}

export function disposeCorpusGpuDeviceBinding(binding) {
  const record = requireBindingRecord(binding);
  if (record.activeLease !== null) {
    throw new Error("Cannot dispose an Object Sculptor GPU device binding with an active lease");
  }
  if (record.disposeStatus === "disposed") return false;
  if (record.disposeStatus === "uncertain") {
    throw new Error("Object Sculptor GPU device binding disposal is uncertain");
  }
  if (typeof record.device.destroy !== "function") {
    record.disposeStatus = "uncertain";
    throw new TypeError("retained GPUDevice does not expose destroy()");
  }
  record.disposeAttempts += 1;
  record.disposeStatus = "disposing";
  try {
    record.device.destroy();
    record.destroyCallCount += 1;
    record.disposeStatus = "disposed";
    return true;
  } catch (error) {
    record.disposeStatus = "uncertain";
    throw error;
  }
}
