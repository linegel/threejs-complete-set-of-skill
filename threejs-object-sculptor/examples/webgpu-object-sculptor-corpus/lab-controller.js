import * as THREE from "three/webgpu";
import { color } from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import {
  SCULPT_MODES,
  SCULPT_TIERS,
  summarizeSculptRuntime,
} from "../shared/sculpt-runtime.js";
import {
  SCULPT_TARGET_IDS,
  createSculptTarget,
  getSculptTargetDefinition,
} from "./object-catalog.js";
import { CORPUS_CAMERAS, corpusStateChanged } from "./route-state.js";
import {
  alignedBytesPerRow,
  requiredPaddedByteLength,
} from "../../../labs/runtime/aligned-readback.mjs";
import {
  acquireCorpusGpuDeviceBinding,
  assertCorpusGpuDeviceBindingLeaseMatchesRenderer,
  describeCorpusGpuDeviceBinding,
  releaseCorpusGpuDeviceBindingLease,
} from "./gpu-device-binding.js";

export {
  createObjectSculptorCorpusFrameDriver,
  objectSculptorCorpusFrameOwner,
  resolveCorpusFrameDeltaSeconds,
} from "./frame-driver.js";
export { CORPUS_CAMERAS, SCULPT_MODES, SCULPT_TIERS };
export const TARGET_IDS = SCULPT_TARGET_IDS;
export const CORPUS_CONTINUITY_TOKEN = "active-preview-continuity-v1";

export const CORPUS_RUNTIME_PROFILES = Object.freeze([
  "correctness",
  "performance",
]);

export const CORPUS_PERFORMANCE_TIMESTAMP_MODES = Object.freeze([
  "auto",
  "disabled-for-cadence",
]);

export const CORPUS_DIAGNOSTIC_RETENTION_LIMITS = Object.freeze({
  cpuRenderSubmissions: 256,
  gpuTimestampSamples: 128,
  gpuTimestampFailures: 128,
  deviceErrors: 32,
  resourceTransitions: 128,
  stateMutations: 64,
  teardownRecords: 64,
  closedResourceIntervals: 128,
});

export const CORPUS_DPR_CAPS = Object.freeze({
  full: 1.5,
  budgeted: 1.25,
  minimum: 1,
});

export const CORPUS_RENDER_POLICY = Object.freeze({
  sceneRendersPerFrame: 1,
  trackTimestamp: false,
  antialias: false,
  antialiasPolicy: "invariant-disabled-across-runtime-tiers",
  mrt: false,
  postprocessing: false,
  timingReason: "Correctness uses no timestamp tracking. Performance either requests verified renderer-device timestamps for one-shot GPU samples or explicitly disables timestamp tracking for uncontaminated rAF cadence; no lane alone proves sustained GPU or compositor presentation timing.",
});

export const CORPUS_SHADOW_POLICIES = Object.freeze({
  full: Object.freeze({ mapSize: 1024, casterLimit: 65_535, filter: "pcf-soft" }),
  budgeted: Object.freeze({ mapSize: 512, casterLimit: 16, filter: "pcf" }),
  minimum: Object.freeze({ mapSize: 256, casterLimit: 8, filter: "basic" }),
});

const CAMERA_SETTINGS = Object.freeze({
  design: Object.freeze({ direction: [1.35, 0.82, 1.55], fov: 38, distanceScale: 1.3 }),
  profile: Object.freeze({ direction: [0, 0.58, 1], fov: 36, distanceScale: 1.35 }),
  attachment: Object.freeze({ direction: [-1.18, 0.48, 1.05], fov: 34, distanceScale: 1.05 }),
  "close-material": Object.freeze({ direction: [0.95, 0.34, 1.18], fov: 30, distanceScale: 1.08 }),
});

export const CORPUS_CAMERA_FOCUS_CONTRACTS = Object.freeze({
  "articulated-desk-lamp": Object.freeze({
    attachment: Object.freeze({
      nodeIds: Object.freeze([
        "lower-spring-start-collar",
        "lower-spring-end-collar",
        "upper-spring-start-collar",
        "upper-spring-end-collar",
      ]),
      minimumExtentFraction: 0.2,
      paddingScale: 1.35,
    }),
    "close-material": Object.freeze({
      nodeIds: Object.freeze(["shade-shell", "reflector-shell"]),
      minimumExtentFraction: 0.18,
      paddingScale: 1.25,
    }),
  }),
  "potted-bonsai": Object.freeze({
    attachment: Object.freeze({
      nodeIds: Object.freeze(["root-flare", "branch-left"]),
      minimumExtentFraction: 0.2,
      paddingScale: 1.35,
    }),
    "close-material": Object.freeze({
      nodeIds: Object.freeze(["pot-body", "pot-rim"]),
      minimumExtentFraction: 0.18,
      paddingScale: 1.3,
    }),
  }),
  "ceramic-teapot": Object.freeze({
    attachment: Object.freeze({
      nodeIds: Object.freeze(["spout-root-collar", "lid-joint-pin"]),
      minimumExtentFraction: 0.22,
      paddingScale: 1.4,
    }),
    "close-material": Object.freeze({
      nodeIds: Object.freeze(["body-shell", "neck-band"]),
      minimumExtentFraction: 0.2,
      paddingScale: 1.28,
    }),
  }),
});

const MOTION_TRANSLATION_EPSILON_METERS = 1e-8;
const MOTION_ROTATION_EPSILON_RADIANS = 1e-7;
const MOTION_SCALE_EPSILON = 1e-8;
const MOTION_WITNESS_GRACE_SECONDS = 1e-4;
const GPU_TIMESTAMP_SAMPLE_SCHEMA_VERSION = "object-sculptor-gpu-timestamp-sample-v1";
const RESOURCE_INVENTORY_SCHEMA_VERSION = "object-sculptor-resource-inventory-v1";
const DEVICE_GENERATION_CHANGED_ERROR_CODE = "CORPUS_DEVICE_GENERATION_CHANGED";

function deepFreezePlain(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreezePlain(child);
  return value;
}

function requireRuntimeProfile(value) {
  if (!CORPUS_RUNTIME_PROFILES.includes(value)) {
    throw new RangeError(`Unknown corpus runtime profile "${value}"`);
  }
  return value;
}

function requirePerformanceTimestampMode(value) {
  if (!CORPUS_PERFORMANCE_TIMESTAMP_MODES.includes(value)) {
    throw new RangeError(`Unknown corpus performance timestamp mode "${value}"`);
  }
  return value;
}

async function defaultPreInitCapabilities({ runtimeProfile }) {
  if (runtimeProfile !== "performance") {
    return {
      source: "not-probed-correctness-profile",
      adapterAvailable: null,
      timestampQuerySupported: null,
    };
  }
  const gpu = globalThis.navigator?.gpu;
  if (!gpu || typeof gpu.requestAdapter !== "function") {
    return {
      source: "navigator.gpu-unavailable",
      adapterAvailable: false,
      timestampQuerySupported: false,
    };
  }
  try {
    const adapter = await gpu.requestAdapter();
    return {
      source: "navigator.gpu-preflight-adapter",
      adapterAvailable: adapter !== null,
      timestampQuerySupported: adapter?.features?.has?.("timestamp-query") === true,
      failureReason: adapter === null ? "adapter-unavailable" : null,
    };
  } catch (error) {
    return {
      source: "navigator.gpu-preflight-failed",
      adapterAvailable: false,
      timestampQuerySupported: false,
      failureReason: error instanceof Error ? error.name : "unknown-preflight-error",
    };
  }
}

function normalizePreInitCapabilities(value, runtimeProfile) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("pre-init renderer capabilities must be an object");
  }
  const timestampQuerySupported = value.timestampQuerySupported;
  if (![true, false, null].includes(timestampQuerySupported)) {
    throw new TypeError("timestampQuerySupported must be true, false, or null");
  }
  return deepFreezePlain({
    source: typeof value.source === "string" && value.source.length > 0
      ? value.source
      : "unspecified-preflight",
    runtimeProfile,
    adapterAvailable: [true, false, null].includes(value.adapterAvailable)
      ? value.adapterAvailable
      : null,
    timestampQuerySupported,
    failureReason: typeof value.failureReason === "string" ? value.failureReason : null,
    rendererDeviceMatch: "unverified-until-renderer-initialization",
  });
}

function requirePositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be finite and positive`);
  }
  return value;
}

function requireInteger(value, label) {
  if (!Number.isInteger(value)) throw new TypeError(`${label} must be an integer`);
  return value;
}

function requireFiniteNonnegative(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be finite and nonnegative`);
  }
  return value;
}

function gpuTimestampUnavailableError(message) {
  const error = new Error(message);
  error.name = "NotSupportedError";
  error.code = "CORPUS_GPU_TIMESTAMP_UNAVAILABLE";
  return error;
}

function requireControllerTarget(target, subjectId) {
  if (!target || typeof target !== "object" || !target.root?.isObject3D) {
    throw new TypeError(`Target "${subjectId}" must expose a Three.js root`);
  }
  if (!target.runtime || target.runtime.root !== target.root) {
    throw new TypeError(`Target "${subjectId}" runtime must own its root`);
  }
  for (const method of ["setMode", "setTime", "dispose"]) {
    if (typeof target[method] !== "function") {
      throw new TypeError(`Target "${subjectId}" must expose ${method}()`);
    }
  }
  return target;
}

function protectedRuntimeIds(contract, primaryField, fallbackField, runtimeMap, label) {
  const authored = contract?.[primaryField] ?? contract?.[fallbackField] ?? [...(runtimeMap?.keys?.() ?? [])];
  if (!Array.isArray(authored)) {
    throw new TypeError(`${label} protected identity inventory must be an array`);
  }
  const ids = [...authored];
  for (const id of ids) {
    if (typeof id !== "string" || id.length === 0) {
      throw new TypeError(`${label} protected identity contains an invalid ID`);
    }
    if (!runtimeMap?.has?.(id)) {
      throw new Error(`${label} protected identity "${id}" is missing from the active runtime`);
    }
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${label} protected identity inventory contains duplicate IDs`);
  }
  return ids.sort((a, b) => a.localeCompare(b));
}

function floorMaterial() {
  const material = new THREE.MeshStandardNodeMaterial();
  material.colorNode = color(0x171b1d);
  material.roughness = 0.92;
  material.metalness = 0;
  return material;
}

function binaryTargetMaskMaterial() {
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = color(0xffffff);
  material.side = THREE.DoubleSide;
  material.depthTest = true;
  material.depthWrite = true;
  material.toneMapped = false;
  return material;
}

function movingSemanticRoots(target) {
  const runtime = target?.runtime;
  const roots = [];
  if (runtime?.motionPreviewBindings instanceof Map) {
    for (const binding of runtime.motionPreviewBindings.values()) {
      const node = runtime.nodes?.get(binding.nodeId);
      if (node) roots.push(node);
    }
  }
  if (Array.isArray(runtime?.previewMotionBindings)) {
    for (const binding of runtime.previewMotionBindings) if (binding?.node) roots.push(binding.node);
  }
  if (runtime?.subjectId === "ceramic-teapot") {
    const lid = runtime.nodes?.get("lid-pivot");
    if (lid) roots.push(lid);
  }
  const unique = [...new Set(roots)];
  if (unique.length === 0) throw new Error(`Subject ${runtime?.subjectId ?? "unknown"} has no named moving semantic roots`);
  return unique;
}

export function corpusMovingSemanticNodeIds(target) {
  return Object.freeze(movingSemanticRoots(target).map((node) => node.userData?.sculptId ?? node.name).sort());
}

function defaultDependencies() {
  return {
    createRenderer: (options) => new THREE.WebGPURenderer(options),
    createControls: (camera, canvas) => new OrbitControls(camera, canvas),
    createTarget: createSculptTarget,
    getTargetDefinition: getSculptTargetDefinition,
    summarizeTarget: summarizeSculptRuntime,
    resolvePreInitCapabilities: defaultPreInitCapabilities,
    now: () => performance.now(),
  };
}

function resolveDependencies(overrides) {
  if (overrides === undefined) return defaultDependencies();
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new TypeError("controller dependencies must be an object");
  }
  const dependencies = { ...defaultDependencies(), ...overrides };
  for (const name of [
    "createRenderer",
    "createControls",
    "createTarget",
    "getTargetDefinition",
    "summarizeTarget",
    "resolvePreInitCapabilities",
    "now",
  ]) {
    if (typeof dependencies[name] !== "function") {
      throw new TypeError(`controller dependency ${name} must be a function`);
    }
  }
  return dependencies;
}

function geometryAttributeArray(attribute) {
  if (attribute?.isInterleavedBufferAttribute) return attribute.data?.array ?? null;
  return attribute?.array ?? null;
}

function collectGeometryAttributes(geometry) {
  const records = [];
  for (const [name, attribute] of Object.entries(geometry.attributes ?? {})) {
    records.push({ role: `attribute:${name}`, attribute });
  }
  for (const [name, attributes] of Object.entries(geometry.morphAttributes ?? {})) {
    for (let index = 0; index < attributes.length; index += 1) {
      records.push({ role: `morph:${name}:${index}`, attribute: attributes[index] });
    }
  }
  if (geometry.index) records.push({ role: "index", attribute: geometry.index });
  return records;
}

function describeTargetRenderResources(target) {
  const meshIds = new Map();
  for (const [id, mesh] of target?.runtime?.meshes?.entries?.() ?? []) {
    if (mesh?.isMesh && !meshIds.has(mesh)) meshIds.set(mesh, id);
  }
  let fallbackMeshOrdinal = 0;
  target?.root?.traverse?.((object) => {
    if (!object?.isMesh || meshIds.has(object)) return;
    fallbackMeshOrdinal += 1;
    const semanticId = typeof object.userData?.sculptId === "string"
      && object.userData.sculptId.length > 0
      ? object.userData.sculptId
      : typeof object.name === "string" && object.name.length > 0
        ? object.name
        : `traversal-mesh-${fallbackMeshOrdinal}`;
    meshIds.set(
      object,
      semanticId,
    );
  });

  const geometries = new Set();
  const geometryIds = new Map();
  const materials = new Set();
  const shadowCasterMaterials = new Set();
  for (const [mesh, meshId] of meshIds) {
    if (mesh.geometry?.isBufferGeometry) {
      geometries.add(mesh.geometry);
      if (!geometryIds.has(mesh.geometry)) geometryIds.set(mesh.geometry, `geometry:${meshId}`);
    }
    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of meshMaterials) {
      if (!material?.isMaterial) continue;
      materials.add(material);
      if (mesh.castShadow === true) shadowCasterMaterials.add(material);
    }
  }

  const uniqueAttributeViews = new Set();
  const uniqueIndexViews = new Set();
  const backingStores = new Map();
  const geometryRecords = [];
  let geometryOrdinal = 0;
  let attributeLogicalViewBytes = 0;
  let indexLogicalViewBytes = 0;
  for (const geometry of geometries) {
    geometryOrdinal += 1;
    const allocations = [];
    for (const { role, attribute } of collectGeometryAttributes(geometry)) {
      const array = geometryAttributeArray(attribute);
      if (!ArrayBuffer.isView(array)) continue;
      const viewSet = role === "index" ? uniqueIndexViews : uniqueAttributeViews;
      if (!viewSet.has(array)) {
        viewSet.add(array);
        if (role === "index") indexLogicalViewBytes += array.byteLength;
        else attributeLogicalViewBytes += array.byteLength;
      }
      const store = array.buffer;
      let storeRecord = backingStores.get(store);
      if (!storeRecord) {
        storeRecord = { byteLength: store.byteLength, roles: new Set() };
        backingStores.set(store, storeRecord);
      }
      storeRecord.roles.add(role === "index" ? "index" : "attribute");
      allocations.push({
        role,
        arrayType: array.constructor?.name ?? "TypedArray",
        byteOffset: array.byteOffset,
        byteLength: array.byteLength,
        count: Number.isFinite(attribute.count) ? attribute.count : null,
        itemSize: Number.isFinite(attribute.itemSize) ? attribute.itemSize : null,
      });
    }
    geometryRecords.push({
      allocationId: `${geometryIds.get(geometry)}#${geometryOrdinal}`,
      geometryType: geometry.type ?? "BufferGeometry",
      allocations,
    });
  }

  const uniqueBackingStoreBytes = [...backingStores.values()]
    .reduce((total, record) => total + record.byteLength, 0);
  const attributeBackingStoreBytes = [...backingStores.values()]
    .filter((record) => record.roles.has("attribute"))
    .reduce((total, record) => total + record.byteLength, 0);
  const indexBackingStoreBytes = [...backingStores.values()]
    .filter((record) => record.roles.has("index"))
    .reduce((total, record) => total + record.byteLength, 0);

  return deepFreezePlain({
    schemaVersion: RESOURCE_INVENTORY_SCHEMA_VERSION,
    subjectId: target?.runtime?.subjectId ?? null,
    meshCount: meshIds.size,
    uniqueGeometryCount: geometries.size,
    uniqueMaterialCount: materials.size,
    shadowCasterMaterialCount: shadowCasterMaterials.size,
    geometry: {
      attributeLogicalViewBytes,
      indexLogicalViewBytes,
      uniqueBackingStoreBytes,
      attributeBackingStoreBytes,
      indexBackingStoreBytes,
      backingStoreOverlapPolicy: "uniqueBackingStoreBytes counts each ArrayBuffer once; role subtotals may overlap when one backing store serves both roles",
      logicalViewFormula: "sum(byteLength of each distinct typed-array view by attribute/index role)",
      backingStoreFormula: "sum(byteLength of each distinct ArrayBuffer referenced by geometry attributes, morph attributes, or indices)",
      allocations: geometryRecords,
    },
    pipelines: {
      forwardMaterialDescriptorCount: materials.size,
      shadowCasterMaterialDescriptorCount: shadowCasterMaterials.size,
      logicalPipelineRequestCount: null,
      logicalPipelineRequestCountStatus: "opaque-renderer-cache-keys-and-pass-variants-not-observed",
      formula: null,
      physicalGpuPipelineCount: null,
      physicalGpuPipelineCountStatus: "opaque-driver-owned-not-claimed",
    },
    residency: {
      physicalGpuResidentBytes: null,
      status: "opaque-driver-residency-not-claimed",
    },
  });
}

function rendererRenderInfo(renderer) {
  const render = renderer.info?.render;
  const memory = renderer.info?.memory;
  const numberOrNull = (value) => Number.isFinite(value) ? value : null;
  return Object.freeze({
    rendererType: renderer.constructor?.name ?? "unknown",
    backendType: renderer.backend?.constructor?.name ?? "unknown",
    threeRevision: THREE.REVISION,
    render: Object.freeze({
      calls: numberOrNull(render?.calls),
      triangles: numberOrNull(render?.triangles),
      points: numberOrNull(render?.points),
      lines: numberOrNull(render?.lines),
    }),
    memory: Object.freeze({
      geometries: numberOrNull(memory?.geometries),
      textures: numberOrNull(memory?.textures),
    }),
  });
}

function backendKind(renderer) {
  return renderer.backend?.isWebGPUBackend === true ? "webgpu" : "unsupported";
}

function inspectRenderTimestampQueryPool(renderer) {
  const pool = renderer.backend?.timestampQueryPool?.[THREE.TimestampQuery.RENDER] ?? null;
  if (!pool) {
    return {
      inspectable: false,
      reason: "renderer backend does not expose its render timestamp query pool",
    };
  }
  const queryOffsets = pool.queryOffsets;
  const frames = typeof pool.getTimestampFrames === "function"
    ? pool.getTimestampFrames()
    : pool.frames;
  if (
    pool.constructor?.name !== "WebGPUTimestampQueryPool"
    || !(queryOffsets instanceof Map)
    || !Array.isArray(frames)
    || !Number.isInteger(pool.currentQueryIndex)
    || pool.currentQueryIndex < 0
    || !Number.isFinite(pool.lastValue)
    || pool.lastValue < 0
  ) {
    return {
      inspectable: false,
      reason: "render timestamp query pool does not expose the expected Three r185 state",
    };
  }
  const contextIds = [...queryOffsets.keys()];
  const frameIds = [];
  for (const uid of contextIds) {
    const match = typeof uid === "string" ? uid.match(/:f(\d+)$/) : null;
    if (!match) {
      return {
        inspectable: false,
        reason: "render timestamp query pool contains an unparseable context frame ID",
      };
    }
    frameIds.push(Number.parseInt(match[1], 10));
  }
  const uniqueFrameIds = [...new Set(frameIds)].sort((a, b) => a - b);
  const timestamps = pool.timestamps;
  if (!(timestamps instanceof Map)) {
    return {
      inspectable: false,
      reason: "render timestamp query pool does not expose its context timestamp map",
    };
  }
  return {
    inspectable: true,
    pool,
    poolType: pool.constructor.name,
    trackTimestamp: pool.trackTimestamp === true,
    isDisposed: pool.isDisposed === true,
    pendingResolve: pool.pendingResolve !== false && pool.pendingResolve !== null,
    currentQueryIndex: pool.currentQueryIndex,
    pendingContextCount: queryOffsets.size,
    pendingQueryCount: pool.currentQueryIndex,
    contextIds: [...contextIds].sort(),
    frameIds: uniqueFrameIds,
    resolvedFrameIds: [...frames],
    timestamps: new Map(timestamps),
    lastValue: pool.lastValue,
    resultBufferMapState: pool.resultBuffer?.mapState ?? null,
    querySetAvailable: pool.querySet !== null && pool.querySet !== undefined,
    deviceIdentityVerified: pool.device === renderer.backend?.device,
  };
}

function verifyFreshRenderTimestampQueryPool(before, after, gpuMs) {
  const unavailable = (reason) => ({
    verified: false,
    reason,
    evidence: deepFreezePlain({
      schemaVersion: "three-webgpu-timestamp-freshness-v1",
      freshnessStatus: "unverified-insufficient-query-pool-evidence",
      evidenceSurface: "renderer.backend.timestampQueryPool.render",
      publicApiFreshnessProvable: false,
      threeRevision: THREE.REVISION,
      reason,
    }),
  });
  if (!before.inspectable || !after.inspectable) {
    return unavailable(before.reason ?? after.reason ?? "timestamp query pool is not inspectable");
  }
  if (
    before.pool !== after.pool
    || before.poolType !== "WebGPUTimestampQueryPool"
    || !before.trackTimestamp
    || before.isDisposed
    || before.pendingResolve
    || before.resultBufferMapState !== "unmapped"
    || !before.querySetAvailable
    || !before.deviceIdentityVerified
  ) {
    return unavailable("timestamp query pool was not ready on the verified renderer device");
  }
  if (
    before.currentQueryIndex <= 0
    || before.currentQueryIndex % 2 !== 0
    || before.pendingContextCount <= 0
    || before.pendingQueryCount !== before.pendingContextCount * 2
    || before.frameIds.length !== 1
  ) {
    return unavailable("timestamp query pool did not contain exactly one pending render frame");
  }
  if (before.contextIds.some((uid) => before.timestamps.has(uid))) {
    return unavailable("timestamp query pool already contained a timestamp for a pending context UID");
  }
  const resolvedContextDurationsMs = before.contextIds.map((uid) => after.timestamps.get(uid));
  const resolvedDurationSum = resolvedContextDurationsMs.reduce(
    (sum, value) => sum + (Number.isFinite(value) ? value : 0),
    0,
  );
  if (
    after.poolType !== "WebGPUTimestampQueryPool"
    || after.currentQueryIndex !== 0
    || after.pendingContextCount !== 0
    || after.pendingResolve
    || after.resultBufferMapState !== "unmapped"
    || after.resolvedFrameIds.length !== 1
    || after.resolvedFrameIds[0] !== before.frameIds[0]
    || after.lastValue !== gpuMs
    || resolvedContextDurationsMs.some((value) => !Number.isFinite(value) || value < 0)
    || Math.abs(resolvedDurationSum - gpuMs) > Math.max(1e-9, Math.abs(gpuMs) * 1e-9)
    || !after.deviceIdentityVerified
  ) {
    return unavailable(
      "timestamp resolver returned a value without proving that the pending frame was resolved",
    );
  }
  return {
    verified: true,
    reason: null,
    evidence: deepFreezePlain({
      schemaVersion: "three-webgpu-timestamp-freshness-v1",
      freshnessStatus: "verified-current-pending-frame-resolved",
      evidenceSurface: "renderer.backend.timestampQueryPool.render",
      publicApiFreshnessProvable: false,
      threeRevision: THREE.REVISION,
      poolType: before.poolType,
      pendingContextIds: [...before.contextIds],
      pendingFrameIds: [...before.frameIds],
      resolvedFrameIds: [...after.resolvedFrameIds],
      resolvedContextDurationsMs,
      pendingContextCount: before.pendingContextCount,
      pendingQueryCount: before.pendingQueryCount,
      currentQueryIndexBefore: before.currentQueryIndex,
      currentQueryIndexAfter: after.currentQueryIndex,
      lastValueBefore: before.lastValue,
      lastValueAfter: after.lastValue,
      resultBufferMapStateBefore: before.resultBufferMapState,
      resultBufferMapStateAfter: after.resultBufferMapState,
    }),
  };
}

function targetRadius(definition) {
  const { width, height, depth } = definition.boundsMeters;
  return Math.max(Math.hypot(width, height, depth) * 0.5, 0.05);
}

function definitionBounds(definition) {
  const center = new THREE.Vector3(...definition.cameraTarget);
  const size = new THREE.Vector3(
    definition.boundsMeters.width,
    definition.boundsMeters.height,
    definition.boundsMeters.depth,
  );
  return new THREE.Box3().setFromCenterAndSize(center, size);
}

function finiteObjectBounds(object) {
  if (!object?.isObject3D) return null;
  object.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(object, true);
  if (bounds.isEmpty()) return null;
  const values = [...bounds.min.toArray(), ...bounds.max.toArray()];
  return values.every(Number.isFinite) ? bounds : null;
}

function paddedFocusBounds(bounds, definition, contract) {
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const minimumFraction = contract?.minimumExtentFraction ?? 1;
  const paddingScale = contract?.paddingScale ?? 1;
  const minimumSize = new THREE.Vector3(
    definition.boundsMeters.width,
    definition.boundsMeters.height,
    definition.boundsMeters.depth,
  ).multiplyScalar(minimumFraction);
  size.multiplyScalar(paddingScale);
  size.set(
    Math.max(size.x, minimumSize.x, 0.01),
    Math.max(size.y, minimumSize.y, 0.01),
    Math.max(size.z, minimumSize.z, 0.01),
  );
  return new THREE.Box3().setFromCenterAndSize(center, size);
}

function resolveCameraFocusBounds(target, definition, cameraId) {
  const contract = CORPUS_CAMERA_FOCUS_CONTRACTS[definition.id]?.[cameraId] ?? null;
  if (!contract) {
    const actual = finiteObjectBounds(target.root);
    return {
      bounds: actual ?? definitionBounds(definition),
      source: actual ? "active-target-world-bounds" : "definition-bounds-fallback",
      requestedNodeIds: [],
      resolvedNodeIds: [],
      missingNodeIds: [],
      coverageStatus: actual ? "whole-target" : "fallback",
      fallbackReason: actual ? null : "active target did not expose finite renderable bounds",
    };
  }

  const semanticBounds = new THREE.Box3();
  const resolvedNodeIds = [];
  const missingNodeIds = [];
  for (const id of contract.nodeIds) {
    const node = target.runtime.nodes?.get?.(id);
    const nodeBounds = finiteObjectBounds(node);
    if (!nodeBounds) {
      missingNodeIds.push(id);
      continue;
    }
    semanticBounds.union(nodeBounds);
    resolvedNodeIds.push(id);
  }
  if (resolvedNodeIds.length > 0 && !semanticBounds.isEmpty()) {
    return {
      bounds: paddedFocusBounds(semanticBounds, definition, contract),
      source: "subject-semantic-node-bounds",
      requestedNodeIds: [...contract.nodeIds],
      resolvedNodeIds,
      missingNodeIds,
      coverageStatus: missingNodeIds.length > 0 ? "partial-semantic" : "complete-semantic",
      fallbackReason: null,
    };
  }

  const actual = finiteObjectBounds(target.root);
  return {
    bounds: actual ?? definitionBounds(definition),
    source: actual ? "active-target-world-bounds-fallback" : "definition-bounds-fallback",
    requestedNodeIds: [...contract.nodeIds],
    resolvedNodeIds,
    missingNodeIds,
    coverageStatus: "fallback",
    fallbackReason: "semantic focus nodes did not expose finite renderable bounds",
  };
}

export function resolveCorpusProjectedBoundsFit({
  fovDegrees,
  aspect,
  direction,
  halfExtents,
  distanceScale = 1,
} = {}) {
  requirePositive(fovDegrees, "camera FOV");
  if (fovDegrees >= 179) throw new RangeError("camera FOV must be less than 179 degrees");
  requirePositive(aspect, "camera aspect");
  requirePositive(distanceScale, "camera distance scale");
  if (!Array.isArray(direction) || direction.length !== 3 || direction.some((value) => !Number.isFinite(value))) {
    throw new TypeError("camera direction must contain three finite values");
  }
  if (!Array.isArray(halfExtents) || halfExtents.length !== 3 || halfExtents.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new TypeError("camera halfExtents must contain three positive finite values");
  }

  const verticalHalfFovRadians = THREE.MathUtils.degToRad(fovDegrees * 0.5);
  const horizontalHalfFovRadians = Math.atan(Math.tan(verticalHalfFovRadians) * aspect);
  const limitingHalfFovRadians = Math.min(verticalHalfFovRadians, horizontalHalfFovRadians);
  const viewDirection = new THREE.Vector3(...direction);
  if (viewDirection.lengthSq() < 1e-12) throw new RangeError("camera direction must be nonzero");
  viewDirection.normalize().negate();
  let right = new THREE.Vector3().crossVectors(viewDirection, new THREE.Vector3(0, 1, 0));
  if (right.lengthSq() < 1e-12) right = new THREE.Vector3(1, 0, 0);
  else right.normalize();
  const cameraUp = new THREE.Vector3().crossVectors(right, viewDirection).normalize();
  const half = new THREE.Vector3(...halfExtents);
  const projected = (axis) => (
    Math.abs(axis.x) * half.x
    + Math.abs(axis.y) * half.y
    + Math.abs(axis.z) * half.z
  );
  const projectedHalfWidth = projected(right);
  const projectedHalfHeight = projected(cameraUp);
  const projectedHalfDepth = projected(viewDirection);
  const limitingProjectedRadius = Math.max(projectedHalfWidth, projectedHalfHeight);
  const axisFitDistance = Math.max(
    projectedHalfWidth / Math.tan(horizontalHalfFovRadians),
    projectedHalfHeight / Math.tan(verticalHalfFovRadians),
  ) + projectedHalfDepth;
  const limitingFitDistance = limitingProjectedRadius / Math.tan(limitingHalfFovRadians)
    + projectedHalfDepth;
  const distance = Math.max(axisFitDistance, limitingFitDistance, 0.01) * distanceScale;

  return deepFreezePlain({
    aspect,
    verticalHalfFovRadians,
    horizontalHalfFovRadians,
    limitingHalfFovRadians,
    projectedHalfWidth,
    projectedHalfHeight,
    projectedHalfDepth,
    distance,
  });
}

function captureTargetPose(target) {
  const pose = new Map();
  for (const [id, node] of target.runtime.nodes?.entries?.() ?? []) {
    if (!node?.isObject3D || pose.has(id)) continue;
    pose.set(id, {
      position: node.position.clone(),
      quaternion: node.quaternion.clone(),
      scale: node.scale.clone(),
    });
  }
  return pose;
}

function captureTargetRollbackState(target) {
  return {
    runtimeMode: target?.runtime?.mode,
    pose: captureTargetPose(target),
  };
}

function assertTargetRollbackState(target, snapshot, label) {
  const mismatches = [];
  if (snapshot.runtimeMode !== undefined && target?.runtime?.mode !== snapshot.runtimeMode) {
    mismatches.push("runtime.mode");
  }
  const currentIds = [...(target?.runtime?.nodes?.keys?.() ?? [])].sort();
  const expectedIds = [...snapshot.pose.keys()].sort();
  if (
    currentIds.length !== expectedIds.length
    || currentIds.some((id, index) => id !== expectedIds[index])
  ) mismatches.push("node IDs");
  for (const [id, expected] of snapshot.pose) {
    const node = target?.runtime?.nodes?.get?.(id);
    if (!node?.isObject3D) {
      mismatches.push(`${id}.missing`);
      continue;
    }
    if (!node.position.equals(expected.position)) mismatches.push(`${id}.position`);
    if (!node.quaternion.equals(expected.quaternion)) mismatches.push(`${id}.quaternion`);
    if (!node.scale.equals(expected.scale)) mismatches.push(`${id}.scale`);
  }
  if (mismatches.length > 0) {
    throw new Error(`${label} postcondition mismatch: ${mismatches.join(", ")}`);
  }
}

function emptyMotionWitness(mode, time) {
  return deepFreezePlain({
    status: mode === "action-ready" ? "awaiting-pose-delta" : "frozen-authored-pose",
    mode,
    timeSeconds: time,
    measuredNodeCount: 0,
    activeChannelCount: 0,
    activeChannels: [],
    activeNodeIds: [],
    maxTranslationDeltaMeters: 0,
    maxRotationDeltaRadians: 0,
    maxScaleDelta: 0,
    adjacentTimeDeltaSeconds: 0,
    adjacentActiveChannelCount: 0,
    adjacentActiveChannels: [],
    adjacentActiveNodeIds: [],
    maxAdjacentTranslationDeltaMeters: 0,
    maxAdjacentRotationDeltaRadians: 0,
    maxAdjacentScaleDelta: 0,
    peakActiveChannelCount: 0,
    peakAdjacentActiveChannelCount: 0,
    peakTranslationDeltaMeters: 0,
    peakRotationDeltaRadians: 0,
    peakScaleDelta: 0,
    peakAdjacentTranslationDeltaMeters: 0,
    peakAdjacentRotationDeltaRadians: 0,
    peakAdjacentScaleDelta: 0,
  });
}

function measurePoseDelta(target, baseline) {
  const activeChannels = [];
  const activeNodeIds = new Set();
  let maxTranslationDeltaMeters = 0;
  let maxRotationDeltaRadians = 0;
  let maxScaleDelta = 0;
  for (const [id, rest] of baseline) {
    const node = target.runtime.nodes?.get?.(id);
    if (!node?.isObject3D) continue;
    const translation = node.position.distanceTo(rest.position);
    const quaternionDot = THREE.MathUtils.clamp(Math.abs(node.quaternion.dot(rest.quaternion)), 0, 1);
    const rotation = 2 * Math.acos(quaternionDot);
    const scale = Math.max(
      Math.abs(node.scale.x - rest.scale.x),
      Math.abs(node.scale.y - rest.scale.y),
      Math.abs(node.scale.z - rest.scale.z),
    );
    maxTranslationDeltaMeters = Math.max(maxTranslationDeltaMeters, translation);
    maxRotationDeltaRadians = Math.max(maxRotationDeltaRadians, rotation);
    maxScaleDelta = Math.max(maxScaleDelta, scale);
    if (translation > MOTION_TRANSLATION_EPSILON_METERS) {
      activeChannels.push(`${id}.translation`);
      activeNodeIds.add(id);
    }
    if (rotation > MOTION_ROTATION_EPSILON_RADIANS) {
      activeChannels.push(`${id}.rotation`);
      activeNodeIds.add(id);
    }
    if (scale > MOTION_SCALE_EPSILON) {
      activeChannels.push(`${id}.scale`);
      activeNodeIds.add(id);
    }
  }
  activeChannels.sort();
  return {
    measuredNodeCount: baseline.size,
    activeChannelCount: activeChannels.length,
    activeChannels,
    activeNodeIds: [...activeNodeIds].sort(),
    maxTranslationDeltaMeters,
    maxRotationDeltaRadians,
    maxScaleDelta,
  };
}

function measureTargetPose(
  target,
  baseline,
  mode,
  time,
  previous = null,
  adjacentBaseline = null,
  adjacentTimeSeconds = time,
) {
  const restDelta = measurePoseDelta(target, baseline);
  const adjacentDelta = adjacentBaseline
    ? measurePoseDelta(target, adjacentBaseline)
    : {
        measuredNodeCount: 0,
        activeChannelCount: 0,
        activeChannels: [],
        activeNodeIds: [],
        maxTranslationDeltaMeters: 0,
        maxRotationDeltaRadians: 0,
        maxScaleDelta: 0,
      };
  const adjacentTimeDeltaSeconds = Math.abs(time - adjacentTimeSeconds);
  const priorPeak = previous?.mode === "action-ready" ? previous : null;
  const peakActiveChannelCount = Math.max(
    priorPeak?.peakActiveChannelCount ?? 0,
    restDelta.activeChannelCount,
  );
  const peakAdjacentActiveChannelCount = Math.max(
    priorPeak?.peakAdjacentActiveChannelCount ?? 0,
    adjacentDelta.activeChannelCount,
  );
  const status = mode !== "action-ready"
    ? "frozen-authored-pose"
    : time <= MOTION_WITNESS_GRACE_SECONDS
      ? "awaiting-pose-delta"
      : adjacentTimeDeltaSeconds <= MOTION_WITNESS_GRACE_SECONDS
        ? "awaiting-adjacent-time-sample"
        : restDelta.activeChannelCount === 0 && peakActiveChannelCount === 0
          ? "blocked-no-rest-pose-delta"
          : adjacentDelta.activeChannelCount === 0
            ? "blocked-no-adjacent-pose-delta"
            : "measured-live-pose-delta";
  return deepFreezePlain({
    status,
    mode,
    timeSeconds: time,
    ...restDelta,
    adjacentTimeDeltaSeconds,
    adjacentActiveChannelCount: adjacentDelta.activeChannelCount,
    adjacentActiveChannels: adjacentDelta.activeChannels,
    adjacentActiveNodeIds: adjacentDelta.activeNodeIds,
    maxAdjacentTranslationDeltaMeters: adjacentDelta.maxTranslationDeltaMeters,
    maxAdjacentRotationDeltaRadians: adjacentDelta.maxRotationDeltaRadians,
    maxAdjacentScaleDelta: adjacentDelta.maxScaleDelta,
    peakActiveChannelCount,
    peakAdjacentActiveChannelCount,
    peakTranslationDeltaMeters: Math.max(
      priorPeak?.peakTranslationDeltaMeters ?? 0,
      restDelta.maxTranslationDeltaMeters,
    ),
    peakRotationDeltaRadians: Math.max(
      priorPeak?.peakRotationDeltaRadians ?? 0,
      restDelta.maxRotationDeltaRadians,
    ),
    peakScaleDelta: Math.max(priorPeak?.peakScaleDelta ?? 0, restDelta.maxScaleDelta),
    peakAdjacentTranslationDeltaMeters: Math.max(
      priorPeak?.peakAdjacentTranslationDeltaMeters ?? 0,
      adjacentDelta.maxTranslationDeltaMeters,
    ),
    peakAdjacentRotationDeltaRadians: Math.max(
      priorPeak?.peakAdjacentRotationDeltaRadians ?? 0,
      adjacentDelta.maxRotationDeltaRadians,
    ),
    peakAdjacentScaleDelta: Math.max(
      priorPeak?.peakAdjacentScaleDelta ?? 0,
      adjacentDelta.maxScaleDelta,
    ),
  });
}

function assertMotionWitness(witness) {
  if (witness.status === "blocked-no-rest-pose-delta") {
    throw new Error("Action-ready target produced no measured rest-to-current transform delta");
  }
  if (witness.status === "blocked-no-adjacent-pose-delta") {
    throw new Error("Action-ready target produced a rest offset but no adjacent-time transform delta");
  }
}

export function resolveCorpusDpr(tier, requestedDpr) {
  corpusStateChanged(tier, tier, SCULPT_TIERS, "tier");
  requirePositive(requestedDpr, "requested DPR");
  return Math.min(requestedDpr, CORPUS_DPR_CAPS[tier]);
}

export function describeCorpusReadback(width, height, outputColorSpace) {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new RangeError("capture dimensions must be positive integers");
  }
  if (typeof outputColorSpace !== "string" || outputColorSpace.length === 0) {
    throw new TypeError("capture output color space is required");
  }
  const bytesPerPixel = 4;
  const rowBytes = width * bytesPerPixel;
  const bytesPerRow = alignedBytesPerRow(width, bytesPerPixel);
  return Object.freeze({
    width,
    height,
    format: "rgba8unorm",
    bytesPerPixel,
    rowBytes,
    bytesPerRow,
    minimumByteLength: requiredPaddedByteLength(width, height, bytesPerPixel, bytesPerRow),
    fullyPaddedByteLength: bytesPerRow * height,
    colorManaged: true,
    colorEncoding: "srgb",
    outputColorSpace,
  });
}

export function preserveCorpusReadbackRows(source, layout) {
  if (!(source instanceof Uint8Array)) throw new TypeError("capture readback must be a Uint8Array");
  const compactByteLength = layout.rowBytes * layout.height;
  if (
    source.byteLength !== compactByteLength
    && source.byteLength !== layout.minimumByteLength
    && source.byteLength !== layout.fullyPaddedByteLength
  ) {
    throw new RangeError(`unexpected capture byte length ${source.byteLength}`);
  }
  const sourceBytesPerRow = source.byteLength === compactByteLength
    ? layout.rowBytes
    : layout.bytesPerRow;
  const padded = new Uint8Array(layout.fullyPaddedByteLength);
  for (let y = 0; y < layout.height; y += 1) {
    const sourceOffset = y * sourceBytesPerRow;
    padded.set(source.subarray(sourceOffset, sourceOffset + layout.rowBytes), y * layout.bytesPerRow);
  }
  return padded;
}

export async function createObjectSculptorCorpusController({
  canvas,
  width = 1280,
  height = 800,
  dpr = 1,
  subjectId,
  scenario,
  mode = "action-ready",
  tier = "budgeted",
  camera = "design",
  seed = 1,
  profile,
  runtimeProfile,
  timestampQueriesRequired = false,
  performanceTimestampMode = "auto",
  cameraInteractionEnabled = true,
  gpuDeviceBinding = null,
  dependencies: dependencyOverrides,
} = {}) {
  if (subjectId !== undefined && scenario !== undefined && subjectId !== scenario) {
    throw new RangeError(`Conflicting subjectId "${subjectId}" and scenario "${scenario}"`);
  }
  const initialSubjectId = subjectId ?? scenario ?? "potted-bonsai";

  corpusStateChanged(initialSubjectId, initialSubjectId, SCULPT_TARGET_IDS, "subject");
  corpusStateChanged(mode, mode, SCULPT_MODES, "mode");
  corpusStateChanged(tier, tier, SCULPT_TIERS, "tier");
  corpusStateChanged(camera, camera, CORPUS_CAMERAS, "camera");
  width = Math.floor(requirePositive(width, "width"));
  height = Math.floor(requirePositive(height, "height"));
  let requestedDpr = requirePositive(dpr, "DPR");
  requireInteger(seed, "seed");
  if (profile !== undefined && runtimeProfile !== undefined && profile !== runtimeProfile) {
    throw new RangeError(`Conflicting profile "${profile}" and runtimeProfile "${runtimeProfile}"`);
  }
  runtimeProfile = requireRuntimeProfile(profile ?? runtimeProfile ?? "correctness");
  performanceTimestampMode = requirePerformanceTimestampMode(performanceTimestampMode);
  if (typeof timestampQueriesRequired !== "boolean") {
    throw new TypeError("timestampQueriesRequired must be a boolean");
  }
  if (typeof cameraInteractionEnabled !== "boolean") {
    throw new TypeError("cameraInteractionEnabled must be a boolean");
  }
  if (timestampQueriesRequired && runtimeProfile !== "performance") {
    throw new Error("timestampQueriesRequired is only valid for the performance runtime profile");
  }
  if (performanceTimestampMode !== "auto" && runtimeProfile !== "performance") {
    throw new Error("performanceTimestampMode is only configurable for the performance runtime profile");
  }
  if (timestampQueriesRequired && performanceTimestampMode !== "auto") {
    throw new Error("timestampQueriesRequired conflicts with disabled-for-cadence timestamp mode");
  }

  const retainedGpuDeviceBinding = gpuDeviceBinding === null
    ? null
    : gpuDeviceBinding;
  const retainedGpuDeviceBindingEvidence = retainedGpuDeviceBinding === null
    ? null
    : describeCorpusGpuDeviceBinding(retainedGpuDeviceBinding);

  const dependencies = resolveDependencies(dependencyOverrides);
  const initialDefinition = dependencies.getTargetDefinition(initialSubjectId);
  if (initialDefinition?.id !== initialSubjectId) {
    throw new Error(`Target definition for "${initialSubjectId}" has a mismatched ID`);
  }
  const preInitCapabilities = normalizePreInitCapabilities(
    retainedGpuDeviceBindingEvidence
      ? {
          source: "retained-gpu-adapter-device-binding",
          adapterAvailable: true,
          timestampQuerySupported: retainedGpuDeviceBindingEvidence.device.features
            .includes("timestamp-query"),
        }
      : await dependencies.resolvePreInitCapabilities({
          runtimeProfile,
          timestampQueriesRequired,
        }),
    runtimeProfile,
  );
  if (timestampQueriesRequired && preInitCapabilities.timestampQuerySupported !== true) {
    throw new Error("The performance profile requires WebGPU timestamp-query support, but pre-init capability evidence did not prove it");
  }
  const timestampTrackingRequested = runtimeProfile === "performance"
    && performanceTimestampMode === "auto"
    && preInitCapabilities.timestampQuerySupported === true;
  let timestampTrackingActive = false;
  let timingMethod = timestampTrackingRequested
    ? "webgpu-timestamp-query-requested-awaiting-initialized-backend-verification"
    : runtimeProfile === "performance"
      ? performanceTimestampMode === "disabled-for-cadence"
        ? "performance-cadence-no-timestamp-query-readback"
        : "cpu-submit-count-and-raf-observation-no-gpu-duration"
      : "correctness-profile-no-timestamp-query";
  const antialiasRequested = CORPUS_RENDER_POLICY.antialias;

  let renderer = null;
  let controls = null;
  let floor = null;
  let targetMaskMaterial = null;
  let keyLight = null;
  let captureTarget = null;
  let activeTarget = null;
  let activeDefinition = null;
  let summary = null;
  let disposed = false;
  let initialized = false;
  let currentSubjectId = initialSubjectId;
  let currentMode = mode;
  let currentTier = tier;
  let currentCamera = camera;
  let currentSeed = seed;
  let currentTime = 0;
  let appliedDpr = 1;
  let stepCount = 0;
  let renderSubmissions = 0;
  let completedFrames = 0;
  let lastCompletedSubmissionOrdinal = 0;
  let lastCompletedSubmissionPhase = null;
  let lastCompletedSceneDrawCalls = null;
  let gpuTimestampResolveAttempts = 0;
  let gpuTimestampResolveFailures = 0;
  let lastTimestampResolvedSubmissionOrdinal = 0;
  let lastGpuTimestampFailure = null;
  const gpuTimestampSamples = [];
  const gpuTimestampFailures = [];
  const cpuRenderSubmissionSamples = [];
  let gpuTimestampSampleCount = 0;
  let gpuTimestampSamplesDropped = 0;
  let gpuTimestampFailureCount = 0;
  let gpuTimestampFailuresDropped = 0;
  let cpuRenderSubmissionSampleCount = 0;
  let cpuRenderSubmissionSamplesDropped = 0;
  let rebuildCount = 0;
  let rollbackRebuildCount = 0;
  let targetAllocationAttempts = 0;
  let targetAllocations = 0;
  let targetDisposeAttempts = 0;
  let targetDisposals = 0;
  let targetDisposeUncertain = 0;
  let knownLiveTargetCount = 0;
  let peakLiveTargetCount = 0;
  let untrackedCandidateAllocations = 0;
  let untrackedCandidateDisposals = 0;
  let untrackedCandidateDisposeUncertain = 0;
  let knownLiveUntrackedCandidateCount = 0;
  let peakLiveUntrackedCandidateCount = 0;
  let captureTargetAllocationAttempts = 0;
  let captureTargetAllocations = 0;
  let captureTargetResizeCount = 0;
  let captureTargetDisposals = 0;
  let lastReadbackLayout = null;
  let readbackRequestCount = 0;
  let lastReadbackAllocationId = null;
  let captureTargetRestoreAttempts = 0;
  let captureTargetRestoreFailures = 0;
  let lastCaptureTargetRestoreError = null;
  let shadowPolicyApplicationCount = 0;
  let shadowMapInvalidationCount = 0;
  let resourceTransitionSequence = 0;
  let resourceTransitionsDropped = 0;
  const resourceTransitions = [];
  let resourceAllocationCount = 0;
  let resourceSuccessfulDisposalCount = 0;
  let resourceUncertainDisposalCount = 0;
  let resourceOrphanDisposalCount = 0;
  let peakKnownLiveResourceCount = 0;
  let peakResourceTransitionSequence = null;
  const knownLiveResourceIntervals = new Map();
  const uncertainResourceIntervals = new Map();
  const closedResourceIntervals = new Map();
  const closedResourceIntervalOrder = [];
  let closedResourceIntervalsDropped = 0;
  let stateMutationSequence = 0;
  let stateMutationsDropped = 0;
  const stateMutations = [];
  let lastFrameError = null;
  let lastLifecycleError = null;
  let frameErrorCount = 0;
  let lifecycleErrorCount = 0;
  let cameraFraming = null;
  let lightShadowPolicy = null;
  let motionBaseline = new Map();
  let motionWitness = emptyMotionWitness(currentMode, currentTime);
  let acceptingControllerOperations = true;
  let controllerOperationTail = Promise.resolve();
  let pendingControllerOperations = 0;
  let disposalPromise = null;
  let lifecycleAcceptanceStatus = "provisional-no-uncertain-teardown";
  let rendererMonitoringInstalledBeforeInit = false;
  let rendererBackendEvidence = null;
  let verifiedGpuDeviceBindingEvidence = null;
  let immutablePerformanceAdapterIdentity = null;
  let gpuDeviceBindingLease = null;
  let initializedRendererDevice = null;
  let rendererDeviceGeneration = 0;
  let deviceLossGeneration = 0;
  let rendererDeviceStatus = "uninitialized";
  let deviceErrorCount = 0;
  let deviceErrorsDropped = 0;
  let lastDeviceError = null;
  const deviceErrors = [];
  let teardownSequence = 0;
  let teardownRecordsDropped = 0;
  let teardownSucceededCount = 0;
  let teardownUncertainCount = 0;
  const teardownRecords = [];
  const disposedTargets = new WeakMap();
  const targetAllocationIds = new WeakMap();
  const targetRenderAllocationIds = new WeakMap();
  const targetAuthoredShadowCasters = new WeakMap();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x091012);
  scene.fog = new THREE.Fog(0x091012, 10, 80);
  const perspectiveCamera = new THREE.PerspectiveCamera(38, width / height, 0.005, 200);
  const contentRoot = new THREE.Group();
  contentRoot.name = "object-sculptor-corpus-content";
  scene.add(contentRoot);

  function requireLive() {
    if (disposed) throw new Error("Object Sculptor corpus controller is disposed");
  }

  function lifecycleStopReason() {
    if (lifecycleAcceptanceStatus === "invalid-uncertain-teardown") {
      return "uncertain resource teardown";
    }
    return lifecycleAcceptanceStatus.slice("invalid-".length).replaceAll("-", " ");
  }

  function requireOperational() {
    requireLive();
    if (
      initializedRendererDevice
      && renderer?.backend?.device !== initializedRendererDevice
    ) {
      lifecycleAcceptanceStatus = "invalid-renderer-device-generation-change";
      acceptingControllerOperations = false;
      throw new Error(
        "Object Sculptor corpus controller stopped after renderer backend device identity changed",
      );
    }
    if (rendererDeviceStatus === "lost") {
      throw new Error("Object Sculptor corpus controller stopped after WebGPU device loss");
    }
    if (lifecycleAcceptanceStatus.startsWith("invalid-")) {
      throw new Error(
        `Object Sculptor corpus controller stopped after ${lifecycleStopReason()}`,
      );
    }
  }

  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }

  function recordLifecycleFailure(error) {
    lastLifecycleError = errorMessage(error);
    lifecycleErrorCount += 1;
  }

  function appendBoundedDiagnostic(buffer, value, limit) {
    let dropped = 0;
    if (buffer.length >= limit) {
      buffer.shift();
      dropped = 1;
    }
    buffer.push(value);
    return dropped;
  }

  function captureDeviceGenerationSnapshot(label) {
    return Object.freeze({
      label,
      rendererDeviceGeneration,
      deviceLossGeneration,
      rendererDeviceStatus,
      rendererDevice: renderer?.backend?.device ?? null,
    });
  }

  function deviceGenerationChangedError(snapshot, phase) {
    const error = new Error(
      `Object Sculptor corpus ${snapshot.label} cannot commit during ${phase}: `
      + `renderer/device generation changed from ${snapshot.rendererDeviceGeneration}/${snapshot.deviceLossGeneration} `
      + `to ${rendererDeviceGeneration}/${deviceLossGeneration} (${rendererDeviceStatus}); `
      + `backend device identity ${renderer?.backend?.device === snapshot.rendererDevice ? "matched" : "changed"}`,
    );
    error.name = "AbortError";
    error.code = DEVICE_GENERATION_CHANGED_ERROR_CODE;
    error.operation = snapshot.label;
    error.phase = phase;
    error.startedRendererDeviceGeneration = snapshot.rendererDeviceGeneration;
    error.startedDeviceLossGeneration = snapshot.deviceLossGeneration;
    error.currentRendererDeviceGeneration = rendererDeviceGeneration;
    error.currentDeviceLossGeneration = deviceLossGeneration;
    error.rendererDeviceIdentityMatched = renderer?.backend?.device === snapshot.rendererDevice;
    return error;
  }

  function assertDeviceGeneration(snapshot, phase) {
    if (
      rendererDeviceStatus !== "active"
      || rendererDeviceGeneration !== snapshot.rendererDeviceGeneration
      || deviceLossGeneration !== snapshot.deviceLossGeneration
      || renderer?.backend?.device !== snapshot.rendererDevice
      || (initializedRendererDevice && snapshot.rendererDevice !== initializedRendererDevice)
    ) {
      if (rendererDeviceStatus !== "lost") {
        lifecycleAcceptanceStatus = "invalid-renderer-device-generation-change";
        acceptingControllerOperations = false;
      }
      throw deviceGenerationChangedError(snapshot, phase);
    }
  }

  function createOperationGenerationGuard(label) {
    const snapshot = captureDeviceGenerationSnapshot(label);
    return Object.freeze({
      snapshot,
      assert(phase) {
        assertDeviceGeneration(snapshot, phase);
      },
    });
  }

  function invalidateRollback(kind) {
    if (lifecycleAcceptanceStatus !== "invalid-uncertain-teardown") {
      lifecycleAcceptanceStatus = `invalid-${kind}-transaction-rollback`;
    }
    acceptingControllerOperations = false;
  }

  async function collectRollbackError(errors, operation) {
    try {
      await operation();
    } catch (error) {
      errors.push(error);
    }
  }

  function throwRollbackFailure(error, rollbackErrors, message, kind) {
    if (rollbackErrors.length === 0) throw error;
    invalidateRollback(kind);
    const aggregate = new AggregateError([error, ...rollbackErrors], message);
    recordLifecycleFailure(aggregate);
    throw aggregate;
  }

  function potentiallyLiveTargetCount() {
    return knownLiveTargetCount + targetDisposeUncertain;
  }

  function potentiallyLiveUntrackedCandidateCount() {
    return knownLiveUntrackedCandidateCount + untrackedCandidateDisposeUncertain;
  }

  function rememberClosedResourceInterval(interval) {
    if (closedResourceIntervals.has(interval.id)) {
      const existingIndex = closedResourceIntervalOrder.indexOf(interval.id);
      if (existingIndex >= 0) closedResourceIntervalOrder.splice(existingIndex, 1);
    }
    closedResourceIntervals.set(interval.id, interval);
    closedResourceIntervalOrder.push(interval.id);
    while (
      closedResourceIntervalOrder.length
      > CORPUS_DIAGNOSTIC_RETENTION_LIMITS.closedResourceIntervals
    ) {
      const droppedId = closedResourceIntervalOrder.shift();
      closedResourceIntervals.delete(droppedId);
      closedResourceIntervalsDropped += 1;
    }
  }

  function updateResourceLedger(record) {
    if (record.action === "allocate" && record.status === "succeeded") {
      resourceAllocationCount += 1;
      const interval = {
        id: record.allocationId,
        startEvent: record.sequence,
        endEvent: null,
        status: "known-live",
      };
      knownLiveResourceIntervals.set(record.allocationId, interval);
      uncertainResourceIntervals.delete(record.allocationId);
      if (knownLiveResourceIntervals.size > peakKnownLiveResourceCount) {
        peakKnownLiveResourceCount = knownLiveResourceIntervals.size;
        peakResourceTransitionSequence = record.sequence;
      }
      return;
    }
    if (record.action !== "dispose") return;
    const liveInterval = knownLiveResourceIntervals.get(record.allocationId) ?? null;
    if (!liveInterval) resourceOrphanDisposalCount += 1;
    knownLiveResourceIntervals.delete(record.allocationId);
    const closed = {
      id: record.allocationId,
      startEvent: liveInterval?.startEvent ?? null,
      endEvent: record.sequence,
      status: record.status === "uncertain" ? "possibly-live-uncertain" : "closed",
    };
    if (record.status === "uncertain") {
      resourceUncertainDisposalCount += 1;
      uncertainResourceIntervals.set(record.allocationId, closed);
    } else if (record.status === "succeeded") {
      resourceSuccessfulDisposalCount += 1;
      uncertainResourceIntervals.delete(record.allocationId);
      rememberClosedResourceInterval(closed);
    }
  }

  function recordResourceTransition({
    allocationId,
    resourceKind,
    action,
    status = "succeeded",
    phase,
    logicalByteLength = null,
  }) {
    const record = deepFreezePlain({
      sequence: ++resourceTransitionSequence,
      allocationId,
      resourceKind,
      action,
      status,
      phase,
      logicalByteLength,
      rendererDeviceGeneration,
      deviceLossGeneration,
      frameOrdinal: completedFrames,
      submissionOrdinal: renderSubmissions,
    });
    updateResourceLedger(record);
    resourceTransitionsDropped += appendBoundedDiagnostic(
      resourceTransitions,
      record,
      CORPUS_DIAGNOSTIC_RETENTION_LIMITS.resourceTransitions,
    );
    return record;
  }

  function recordStateMutation(kind, before, after) {
    const record = deepFreezePlain({
      sequence: ++stateMutationSequence,
      kind,
      before,
      after,
      targetAllocations,
      targetDisposals,
      liveTargetCount: potentiallyLiveTargetCount(),
      knownLiveTargetCount,
      resourceTransitionSequence,
      frameOrdinal: completedFrames,
      submissionOrdinal: renderSubmissions,
    });
    stateMutationsDropped += appendBoundedDiagnostic(
      stateMutations,
      record,
      CORPUS_DIAGNOSTIC_RETENTION_LIMITS.stateMutations,
    );
    return record;
  }

  function timestampEvidenceStatus() {
    if (rendererDeviceStatus === "lost") return "invalid-device-lost";
    if (deviceErrorCount > 0) return "invalid-uncaptured-gpu-error";
    if (!timestampTrackingActive) {
      return timestampQueriesRequired
        ? "insufficient-required-gpu-timestamp-unavailable"
        : "no-gpu-duration-claim";
    }
    if (gpuTimestampResolveFailures > 0) {
      return timestampQueriesRequired
        ? "insufficient-required-gpu-timestamp-resolution"
        : "gpu-timestamp-resolution-failed";
    }
    if (gpuTimestampSampleCount === 0) {
      return timestampQueriesRequired
        ? "insufficient-required-gpu-timestamp-samples"
        : "active-awaiting-resolved-samples";
    }
    return "measured-not-accepted-pending-sustained-windows";
  }

  function recordGpuTimestampFailure(message, snapshot = {}) {
    const failure = deepFreezePlain({
      schemaVersion: GPU_TIMESTAMP_SAMPLE_SCHEMA_VERSION,
      status: "unavailable",
      reason: message,
      resolveAttemptOrdinal: gpuTimestampResolveAttempts,
      rendererDeviceGeneration,
      deviceLossGeneration,
      frameOrdinal: snapshot.frameOrdinal ?? completedFrames,
      submissionOrdinal: snapshot.submissionOrdinal ?? renderSubmissions,
      coveredSubmissionCount: snapshot.coveredSubmissionCount ?? null,
      renderPhase: snapshot.renderPhase ?? null,
      queryPoolEvidence: snapshot.queryPoolEvidence ?? null,
    });
    gpuTimestampResolveFailures += 1;
    gpuTimestampFailureCount += 1;
    lastGpuTimestampFailure = failure;
    gpuTimestampFailuresDropped += appendBoundedDiagnostic(
      gpuTimestampFailures,
      failure,
      CORPUS_DIAGNOSTIC_RETENTION_LIMITS.gpuTimestampFailures,
    );
    return failure;
  }

  function performanceEvidence() {
    const adapterIdentity = performanceAdapterIdentity();
    return deepFreezePlain({
      schemaVersion: "object-sculptor-performance-evidence-v1",
      runtimeProfile,
      performanceTimestampMode,
      subjectId: currentSubjectId,
      tier: currentTier,
      timestampQueriesRequired,
      timestampQueriesRequested: timestampTrackingRequested,
      timestampQueriesActive: timestampTrackingActive,
      timingMethod,
      performanceAdapterIdentityStatus: adapterIdentity.status,
      performanceAdapterIdentity: adapterIdentity.identity,
      status: timestampEvidenceStatus(),
      rendererDeviceGeneration,
      deviceLossGeneration,
      resolveAttemptCount: gpuTimestampResolveAttempts,
      resolveFailureCount: gpuTimestampResolveFailures,
      retention: {
        gpuTimestampSamples: {
          limit: CORPUS_DIAGNOSTIC_RETENTION_LIMITS.gpuTimestampSamples,
          observed: gpuTimestampSampleCount,
          retained: gpuTimestampSamples.length,
          dropped: gpuTimestampSamplesDropped,
        },
        gpuTimestampFailures: {
          limit: CORPUS_DIAGNOSTIC_RETENTION_LIMITS.gpuTimestampFailures,
          observed: gpuTimestampFailureCount,
          retained: gpuTimestampFailures.length,
          dropped: gpuTimestampFailuresDropped,
        },
        cpuRenderSubmissions: {
          limit: CORPUS_DIAGNOSTIC_RETENTION_LIMITS.cpuRenderSubmissions,
          observed: cpuRenderSubmissionSampleCount,
          retained: cpuRenderSubmissionSamples.length,
          dropped: cpuRenderSubmissionSamplesDropped,
        },
      },
      samples: gpuTimestampSamples.map((sample) => ({ ...sample })),
      failures: gpuTimestampFailures.map((failure) => ({ ...failure })),
      cpuRenderSubmissions: cpuRenderSubmissionSamples.map((sample) => ({ ...sample })),
      sustainedAcceptance: "not-evaluated-controller-exposes-raw-samples-only",
    });
  }

  function performanceAdapterIdentity() {
    if (immutablePerformanceAdapterIdentity) return immutablePerformanceAdapterIdentity;
    if (runtimeProfile !== "performance") {
      immutablePerformanceAdapterIdentity = deepFreezePlain({
        status: "not-claimed-correctness-profile",
        identity: null,
      });
      return immutablePerformanceAdapterIdentity;
    }
    if (!verifiedGpuDeviceBindingEvidence) {
      immutablePerformanceAdapterIdentity = deepFreezePlain({
        status: "insufficient-no-retained-adapter-device-binding",
        identity: null,
      });
      return immutablePerformanceAdapterIdentity;
    }
    if (
      verifiedGpuDeviceBindingEvidence.adapterRequest.authority
      !== "navigator.gpu-current-realm"
    ) {
      immutablePerformanceAdapterIdentity = deepFreezePlain({
        status: "insufficient-untrusted-adapter-request-source",
        identity: null,
      });
      return immutablePerformanceAdapterIdentity;
    }
    const adapter = verifiedGpuDeviceBindingEvidence.adapter;
    if (!new Set(["hardware", "software"]).has(adapter.adapterClass)) {
      immutablePerformanceAdapterIdentity = deepFreezePlain({
        status: "insufficient-adapter-class-unresolved",
        identity: null,
      });
      return immutablePerformanceAdapterIdentity;
    }
    if (typeof adapter.name !== "string" || adapter.name.length === 0) {
      immutablePerformanceAdapterIdentity = deepFreezePlain({
        status: "insufficient-adapter-name-unavailable",
        identity: null,
      });
      return immutablePerformanceAdapterIdentity;
    }
    immutablePerformanceAdapterIdentity = deepFreezePlain({
      status: "verified-exact-renderer-device-binding",
      identity: {
        adapterClass: adapter.adapterClass,
        name: adapter.name,
        identitySource: adapter.identitySource,
        details: {
          nameSource: adapter.nameSource,
          isFallbackAdapter: adapter.isFallbackAdapter,
          info: adapter.info,
          adapterFeatures: adapter.features,
          adapterLimits: adapter.limits,
          deviceFeatures: verifiedGpuDeviceBindingEvidence.device.features,
          deviceLimits: verifiedGpuDeviceBindingEvidence.device.limits,
          rendererBindingStatus: verifiedGpuDeviceBindingEvidence.rendererBindingStatus,
        },
      },
    });
    return immutablePerformanceAdapterIdentity;
  }

  function recordDeviceEvent(kind, info = {}) {
    const eventDeviceLossGeneration = kind === "device-lost"
      ? deviceLossGeneration + 1
      : deviceLossGeneration;
    const entry = deepFreezePlain({
      sequence: deviceErrorCount + 1,
      kind,
      rendererDeviceGeneration: rendererDeviceGeneration || 1,
      deviceLossGeneration: eventDeviceLossGeneration,
      api: typeof info.api === "string" ? info.api : "WebGPU",
      type: typeof info.type === "string" ? info.type : null,
      reason: typeof info.reason === "string" ? info.reason : null,
      message: typeof info.message === "string" && info.message.length > 0
        ? info.message
        : kind === "device-lost"
          ? "WebGPU device lost without a message"
          : "Uncaptured WebGPU error without a message",
    });
    deviceErrorCount += 1;
    deviceErrorsDropped += appendBoundedDiagnostic(
      deviceErrors,
      entry,
      CORPUS_DIAGNOSTIC_RETENTION_LIMITS.deviceErrors,
    );
    lastDeviceError = entry;
    if (kind === "device-lost") {
      deviceLossGeneration = eventDeviceLossGeneration;
      rendererDeviceStatus = "lost";
      acceptingControllerOperations = false;
    }
  }

  function installRendererMonitoringBeforeInit() {
    const previousDeviceLost = typeof renderer.onDeviceLost === "function"
      ? renderer.onDeviceLost
      : null;
    const previousError = typeof renderer.onError === "function"
      ? renderer.onError
      : null;
    renderer.onDeviceLost = function onCorpusRendererDeviceLost(info) {
      try {
        previousDeviceLost?.call(renderer, info);
      } finally {
        if (!retainedGpuDeviceBinding) recordDeviceEvent("device-lost", info);
      }
    };
    renderer.onError = function onCorpusRendererError(info) {
      try {
        previousError?.call(renderer, info);
      } finally {
        recordDeviceEvent("uncaptured-gpu-error", info);
      }
    };
    rendererMonitoringInstalledBeforeInit = true;
  }

  function verifyInitializedRendererBackend() {
    const backend = renderer.backend;
    const device = backend?.device;
    if (backend?.isWebGPUBackend !== true) {
      throw new Error("Native WebGPU is required for the Object Sculptor corpus; no fallback was activated.");
    }
    if (!device || typeof device !== "object") {
      throw new Error("Initialized WebGPU renderer did not expose its actual backend device");
    }
    if (!device.lost || typeof device.lost.then !== "function") {
      throw new Error("Initialized WebGPU renderer device does not expose the required loss monitor promise");
    }
    if (gpuDeviceBindingLease) {
      const bindingEvidence = assertCorpusGpuDeviceBindingLeaseMatchesRenderer(
        gpuDeviceBindingLease,
        device,
      );
      verifiedGpuDeviceBindingEvidence = deepFreezePlain({
        ...bindingEvidence,
        rendererBindingStatus: "verified-exact-renderer-backend-device",
      });
    }
    rendererDeviceGeneration = 1;
    initializedRendererDevice = device;
    if (rendererDeviceStatus !== "lost") rendererDeviceStatus = "active";
    const actualTimestampFeature = device.features?.has?.("timestamp-query") === true;
    timestampTrackingActive = backend.trackTimestamp === true && actualTimestampFeature;
    rendererBackendEvidence = deepFreezePlain({
      backendKind: "webgpu",
      backendType: backend.constructor?.name ?? "unknown",
      deviceType: device.constructor?.name ?? "unknown",
      deviceLabel: typeof device.label === "string" ? device.label : "",
      rendererDeviceGeneration,
      deviceIdentitySource: verifiedGpuDeviceBindingEvidence
        ? "retained-GPUAdapter-requestDevice-bound-to-renderer.backend.device"
        : "renderer.backend.device-after-init",
      deviceIdentityVerified: renderer.backend?.device === device,
      retainedAdapterDeviceBinding: verifiedGpuDeviceBindingEvidence,
      adapterDeviceIdentityVerified: verifiedGpuDeviceBindingEvidence !== null,
      directRetainedDeviceLossObserverInstalled: gpuDeviceBindingLease !== null,
      monitoringInstalledBeforeRendererInit: rendererMonitoringInstalledBeforeInit,
      lossPromiseObservedOnActualDevice: true,
      timestampQueryFeatureOnActualDevice: actualTimestampFeature,
      backendTimestampTrackingActive: backend.trackTimestamp === true,
      timestampRequestMatchedActualBackend: timestampTrackingRequested === timestampTrackingActive,
      preflightDeviceIdentityClaim: verifiedGpuDeviceBindingEvidence
        ? "retained-adapter-request-produced-the-exact-renderer-device"
        : "none-preflight-adapter-is-not-renderer-device-evidence",
    });
    if (rendererDeviceStatus === "lost") {
      throw new Error("WebGPU device was lost during renderer initialization");
    }
    if (timestampQueriesRequired && timestampTrackingActive !== true) {
      throw new Error(
        "The timestamp-required performance profile was not realized on the initialized renderer backend device",
      );
    }
    timingMethod = timestampTrackingActive
      ? "webgpu-timestamp-query-active-on-verified-renderer-device-awaiting-resolve-and-sustained-evidence"
      : runtimeProfile === "performance"
        ? performanceTimestampMode === "disabled-for-cadence"
          ? "performance-cadence-no-timestamp-query-readback"
          : "cpu-submit-count-and-raf-observation-no-gpu-duration"
        : "correctness-profile-no-timestamp-query";
  }

  function appendTeardownRecord({ resourceId, resourceKind, phase, status, message = null }) {
    const record = deepFreezePlain({
      sequence: ++teardownSequence,
      resourceId,
      resourceKind,
      phase,
      status,
      message,
    });
    if (status === "succeeded") teardownSucceededCount += 1;
    else if (status === "uncertain") teardownUncertainCount += 1;
    teardownRecordsDropped += appendBoundedDiagnostic(
      teardownRecords,
      record,
      CORPUS_DIAGNOSTIC_RETENTION_LIMITS.teardownRecords,
    );
    return record;
  }

  async function attemptResourceTeardown(
    resourceId,
    resourceKind,
    phase,
    operation,
    transitionAllocationId = resourceId,
  ) {
    try {
      await operation();
      appendTeardownRecord({ resourceId, resourceKind, phase, status: "succeeded" });
      recordResourceTransition({
        allocationId: transitionAllocationId,
        resourceKind,
        action: "dispose",
        status: "succeeded",
        phase,
      });
      if (resourceId === "capture-target") captureTargetDisposals += 1;
      return { status: "succeeded", error: null };
    } catch (error) {
      appendTeardownRecord({
        resourceId,
        resourceKind,
        phase,
        status: "uncertain",
        message: errorMessage(error),
      });
      lifecycleAcceptanceStatus = "invalid-uncertain-teardown";
      acceptingControllerOperations = false;
      recordResourceTransition({
        allocationId: transitionAllocationId,
        resourceKind,
        action: "dispose",
        status: "uncertain",
        phase,
      });
      return { status: "uncertain", error };
    }
  }

  function teardownReport() {
    return deepFreezePlain({
      attempted: teardownSequence,
      succeeded: teardownSucceededCount,
      uncertain: teardownUncertainCount,
      status: teardownUncertainCount > 0 ? "uncertain" : "closed-for-recorded-attempts",
      retention: {
        limit: CORPUS_DIAGNOSTIC_RETENTION_LIMITS.teardownRecords,
        observed: teardownSequence,
        retained: teardownRecords.length,
        dropped: teardownRecordsDropped,
      },
      records: teardownRecords.map((record) => ({ ...record })),
    });
  }

  function refreshSummary() {
    summary = Object.freeze({ ...dependencies.summarizeTarget(activeTarget.root) });
  }

  function enqueueControllerOperation(label, operation) {
    if (!acceptingControllerOperations) {
      const reason = rendererDeviceStatus === "lost"
        ? "stopped after WebGPU device loss"
        : lifecycleAcceptanceStatus.startsWith("invalid-")
          ? `stopped after ${lifecycleStopReason()}`
          : "closing";
      return Promise.reject(new Error(`Object Sculptor corpus controller is ${reason}; rejected ${label}`));
    }
    pendingControllerOperations += 1;
    const execute = async () => {
      const generationGuard = createOperationGenerationGuard(label);
      try {
        requireOperational();
        return await operation(generationGuard);
      } finally {
        pendingControllerOperations -= 1;
      }
    };
    const current = controllerOperationTail.then(execute, execute);
    controllerOperationTail = current.catch(() => {});
    return current;
  }

  function prepareCameraPlan(
    targetObject,
    definition,
    cameraId = currentCamera,
    viewportWidth = width,
    viewportHeight = height,
  ) {
    const settings = CAMERA_SETTINGS[cameraId];
    const focus = resolveCameraFocusBounds(targetObject, definition, cameraId);
    const target = focus.bounds.getCenter(new THREE.Vector3());
    const size = focus.bounds.getSize(new THREE.Vector3());
    const halfExtents = size.multiplyScalar(0.5);
    const radius = Math.max(halfExtents.length(), 0.01);
    const direction = new THREE.Vector3(...settings.direction).normalize();
    const fit = resolveCorpusProjectedBoundsFit({
      fovDegrees: settings.fov,
      aspect: viewportWidth / viewportHeight,
      direction: settings.direction,
      halfExtents: halfExtents.toArray(),
      distanceScale: settings.distanceScale,
    });
    const framingDistance = fit.distance;
    const supportScale = Math.max(definition.boundsMeters.width, definition.boundsMeters.depth) * 3.5;

    return {
      cameraId,
      subjectId: definition.id,
      settings,
      focus,
      target,
      halfExtents,
      radius,
      direction,
      fit,
      framingDistance,
      near: Math.max(radius / 500, 0.002),
      far: Math.max(framingDistance * 12, radius * 20),
      controlsMinDistance: Math.min(
        Math.max(radius * 0.45, 0.025),
        framingDistance * 0.5,
      ),
      controlsMaxDistance: Math.max(radius * 8, framingDistance * 2, 0.05),
      floorScale: Math.max(supportScale, 0.75),
    };
  }

  function applyCameraPlan(plan) {
    perspectiveCamera.fov = plan.settings.fov;
    perspectiveCamera.near = plan.near;
    perspectiveCamera.far = plan.far;
    perspectiveCamera.position.copy(plan.target).addScaledVector(plan.direction, plan.framingDistance);
    perspectiveCamera.lookAt(plan.target);
    perspectiveCamera.updateProjectionMatrix();
    controls.target.copy(plan.target);
    controls.minDistance = plan.controlsMinDistance;
    controls.maxDistance = plan.controlsMaxDistance;
    const priorDamping = controls.enableDamping;
    controls.enableDamping = false;
    try {
      controls.update();
    } finally {
      controls.enableDamping = priorDamping;
    }
    perspectiveCamera.updateMatrixWorld(true);

    const actualTarget = controls.target.clone();
    const actualDistance = perspectiveCamera.position.distanceTo(actualTarget);
    const allowedDistanceError = Math.max(1e-7, plan.framingDistance * 1e-7);
    const distanceError = Math.abs(actualDistance - plan.framingDistance);
    const targetError = actualTarget.distanceTo(plan.target);
    if (distanceError > allowedDistanceError) {
      throw new Error(
        `Camera controls clamped the requested bounds fit by ${distanceError} metres`,
      );
    }
    if (targetError > allowedDistanceError) {
      throw new Error(`Camera controls moved the requested bounds target by ${targetError} metres`);
    }
    floor.scale.setScalar(plan.floorScale);

    return deepFreezePlain({
      camera: plan.cameraId,
      subjectId: plan.subjectId,
      focusSource: plan.focus.source,
      requestedNodeIds: plan.focus.requestedNodeIds,
      resolvedNodeIds: plan.focus.resolvedNodeIds,
      missingNodeIds: plan.focus.missingNodeIds,
      focusCoverageStatus: plan.focus.coverageStatus,
      fallbackReason: plan.focus.fallbackReason,
      targetMeters: plan.target.toArray(),
      focusSizeMeters: plan.halfExtents.clone().multiplyScalar(2).toArray(),
      requestedFramingDistanceMeters: plan.framingDistance,
      framingDistanceMeters: actualDistance,
      actualFramingDistanceMeters: actualDistance,
      distanceClampResidualMeters: distanceError,
      targetClampResidualMeters: targetError,
      controlsMinDistanceMeters: controls.minDistance,
      controlsMaxDistanceMeters: controls.maxDistance,
      interactionEnabled: cameraInteractionEnabled,
      actualPose: {
        positionMeters: perspectiveCamera.position.toArray(),
        quaternion: perspectiveCamera.quaternion.toArray(),
        up: perspectiveCamera.up.toArray(),
        controlsTargetMeters: actualTarget.toArray(),
        fovDegrees: perspectiveCamera.fov,
        aspect: perspectiveCamera.aspect,
        nearMeters: perspectiveCamera.near,
        farMeters: perspectiveCamera.far,
      },
      ...plan.fit,
    });
  }

  function casterImportance([id, mesh]) {
    const positionCount = mesh.geometry?.attributes?.position?.count ?? 0;
    mesh.geometry?.computeBoundingSphere?.();
    const radius = mesh.geometry?.boundingSphere?.radius ?? 0;
    const worldScale = mesh.getWorldScale?.(new THREE.Vector3()) ?? new THREE.Vector3(1, 1, 1);
    return {
      id,
      mesh,
      score: radius * Math.max(worldScale.x, worldScale.y, worldScale.z) * 1e6 + positionCount,
    };
  }

  function authoredShadowCasters(targetObject) {
    let authored = targetAuthoredShadowCasters.get(targetObject);
    if (!authored) {
      authored = [...(targetObject.runtime.meshes?.entries?.() ?? [])]
        .filter(([, mesh]) => mesh?.isMesh && mesh.castShadow === true)
        .map(([id, mesh]) => Object.freeze({ id, mesh }));
      targetAuthoredShadowCasters.set(targetObject, authored);
    }
    return authored;
  }

  function prepareLightShadowPlan(targetObject, definition, tierId = currentTier) {
    const policy = CORPUS_SHADOW_POLICIES[tierId];
    const shadowType = {
      "pcf-soft": THREE.PCFSoftShadowMap,
      pcf: THREE.PCFShadowMap,
      basic: THREE.BasicShadowMap,
    }[policy.filter];
    const measuredBounds = finiteObjectBounds(targetObject.root);
    const targetBounds = measuredBounds ?? definitionBounds(definition);
    const center = targetBounds.getCenter(new THREE.Vector3());
    const size = targetBounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.5, targetRadius(definition), 0.05);
    const frustumExtent = radius * 1.25;
    const lightDirection = new THREE.Vector3(-4, 8, 6).normalize();
    const lightDistance = radius * 4;

    const authoredCasters = authoredShadowCasters(targetObject)
      .map(({ id, mesh }) => casterImportance([id, mesh]))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const enabledCasters = authoredCasters.slice(0, policy.casterLimit);
    const worldTexelMeters = frustumExtent * 2 / policy.mapSize;

    return {
      tierId,
      policy,
      shadowType,
      boundsSource: measuredBounds
        ? "active-target-world-bounds"
        : "definition-bounds-fallback",
      center,
      radius,
      frustumExtent,
      lightDirection,
      lightDistance,
      authoredCasters,
      enabledCasters,
      worldTexelMeters,
    };
  }

  function applyLightShadowPlan(plan, transactionState = { shadowMapInvalidated: false }) {
    shadowPolicyApplicationCount += 1;
    const enabledMeshes = new Set(plan.enabledCasters.map(({ mesh }) => mesh));
    for (const { mesh } of plan.authoredCasters) mesh.castShadow = enabledMeshes.has(mesh);

    const previousMapSize = keyLight.shadow.mapSize.x;
    const previousShadowType = renderer.shadowMap?.type;
    if (
      (previousMapSize !== plan.policy.mapSize || previousShadowType !== plan.shadowType)
      && keyLight.shadow.map
    ) {
      transactionState.shadowMapInvalidated = true;
      shadowMapInvalidationCount += 1;
      keyLight.shadow.map.dispose();
      keyLight.shadow.map = null;
    }
    if (renderer.shadowMap) renderer.shadowMap.type = plan.shadowType;
    keyLight.shadow.mapSize.set(plan.policy.mapSize, plan.policy.mapSize);
    keyLight.position.copy(plan.center).addScaledVector(plan.lightDirection, plan.lightDistance);
    keyLight.target.position.copy(plan.center);
    keyLight.target.updateMatrixWorld(true);
    keyLight.shadow.camera.left = -plan.frustumExtent;
    keyLight.shadow.camera.right = plan.frustumExtent;
    keyLight.shadow.camera.top = plan.frustumExtent;
    keyLight.shadow.camera.bottom = -plan.frustumExtent;
    keyLight.shadow.camera.near = Math.max(plan.radius * 0.05, 0.01);
    keyLight.shadow.camera.far = plan.lightDistance + plan.radius * 2.5;
    keyLight.shadow.camera.updateProjectionMatrix();
    keyLight.shadow.bias = -THREE.MathUtils.clamp(plan.worldTexelMeters * 0.04, 0.00002, 0.002);
    keyLight.shadow.normalBias = THREE.MathUtils.clamp(plan.worldTexelMeters * 0.9, 0.0001, 0.025);

    return deepFreezePlain({
      tier: plan.tierId,
      boundsSource: plan.boundsSource,
      subjectRadiusMeters: plan.radius,
      frustumExtentMeters: plan.frustumExtent,
      mapSize: plan.policy.mapSize,
      filter: plan.policy.filter,
      worldTexelMeters: plan.worldTexelMeters,
      authoredCasterCount: plan.authoredCasters.length,
      enabledCasterCount: plan.enabledCasters.length,
      disabledCasterIds: plan.authoredCasters
        .slice(plan.policy.casterLimit)
        .map(({ id }) => id)
        .sort(),
      estimatedDepthBytesAt32Bit: plan.policy.mapSize * plan.policy.mapSize * 4,
      antialiasRequestedAtRendererInit: antialiasRequested,
      antialiasPolicy: CORPUS_RENDER_POLICY.antialiasPolicy,
      antialiasInvariantAcrossTiers: true,
      actualRendererSamples: Number.isFinite(renderer.samples) ? renderer.samples : null,
    });
  }

  function capturePresentationState() {
    return {
      camera: {
        fov: perspectiveCamera.fov,
        near: perspectiveCamera.near,
        far: perspectiveCamera.far,
        aspect: perspectiveCamera.aspect,
        position: perspectiveCamera.position.clone(),
        quaternion: perspectiveCamera.quaternion.clone(),
        up: perspectiveCamera.up.clone(),
      },
      controls: {
        target: controls.target.clone(),
        minDistance: controls.minDistance,
        maxDistance: controls.maxDistance,
        enableDamping: controls.enableDamping,
      },
      floorScale: floor.scale.clone(),
      rendererShadowType: renderer.shadowMap?.type,
      light: {
        position: keyLight.position.clone(),
        targetPosition: keyLight.target.position.clone(),
        mapSize: keyLight.shadow.mapSize.clone(),
        map: keyLight.shadow.map,
        bias: keyLight.shadow.bias,
        normalBias: keyLight.shadow.normalBias,
        camera: {
          left: keyLight.shadow.camera.left,
          right: keyLight.shadow.camera.right,
          top: keyLight.shadow.camera.top,
          bottom: keyLight.shadow.camera.bottom,
          near: keyLight.shadow.camera.near,
          far: keyLight.shadow.camera.far,
        },
      },
    };
  }

  function assertPresentationStateEquals(snapshot, transactionState, label) {
    const mismatches = [];
    const compareNumber = (field, actual, expected, epsilon = 1e-10) => {
      if (!Number.isFinite(actual) || Math.abs(actual - expected) > epsilon) {
        mismatches.push(field);
      }
    };
    const compareVector = (field, actual, expected, epsilon = 1e-10) => {
      const actualValues = actual.toArray();
      const expectedValues = expected.toArray();
      if (
        actualValues.length !== expectedValues.length
        || actualValues.some(
          (value, index) => !Number.isFinite(value)
            || Math.abs(value - expectedValues[index]) > epsilon,
        )
      ) mismatches.push(field);
    };
    for (const field of ["fov", "near", "far", "aspect"]) {
      compareNumber(`camera.${field}`, perspectiveCamera[field], snapshot.camera[field]);
    }
    compareVector("camera.position", perspectiveCamera.position, snapshot.camera.position);
    compareVector("camera.quaternion", perspectiveCamera.quaternion, snapshot.camera.quaternion);
    compareVector("camera.up", perspectiveCamera.up, snapshot.camera.up);
    compareVector("controls.target", controls.target, snapshot.controls.target);
    compareNumber("controls.minDistance", controls.minDistance, snapshot.controls.minDistance);
    compareNumber("controls.maxDistance", controls.maxDistance, snapshot.controls.maxDistance);
    if (controls.enableDamping !== snapshot.controls.enableDamping) {
      mismatches.push("controls.enableDamping");
    }
    compareVector("floor.scale", floor.scale, snapshot.floorScale);
    if (renderer.shadowMap?.type !== snapshot.rendererShadowType) {
      mismatches.push("renderer.shadowMap.type");
    }
    compareVector("light.position", keyLight.position, snapshot.light.position);
    compareVector(
      "light.target.position",
      keyLight.target.position,
      snapshot.light.targetPosition,
    );
    compareVector("light.shadow.mapSize", keyLight.shadow.mapSize, snapshot.light.mapSize);
    compareNumber("light.shadow.bias", keyLight.shadow.bias, snapshot.light.bias);
    compareNumber("light.shadow.normalBias", keyLight.shadow.normalBias, snapshot.light.normalBias);
    for (const field of ["left", "right", "top", "bottom", "near", "far"]) {
      compareNumber(
        `light.shadow.camera.${field}`,
        keyLight.shadow.camera[field],
        snapshot.light.camera[field],
      );
    }
    const expectedShadowMap = transactionState.shadowMapInvalidated
      ? null
      : snapshot.light.map;
    if (keyLight.shadow.map !== expectedShadowMap) mismatches.push("light.shadow.map");
    if (mismatches.length > 0) {
      throw new Error(
        `${label} postcondition mismatch: ${mismatches.join(", ")}`,
      );
    }
  }

  function restorePresentationState(snapshot, transactionState = {}) {
    perspectiveCamera.fov = snapshot.camera.fov;
    perspectiveCamera.near = snapshot.camera.near;
    perspectiveCamera.far = snapshot.camera.far;
    perspectiveCamera.aspect = snapshot.camera.aspect;
    perspectiveCamera.position.copy(snapshot.camera.position);
    perspectiveCamera.quaternion.copy(snapshot.camera.quaternion);
    perspectiveCamera.up.copy(snapshot.camera.up);
    perspectiveCamera.updateProjectionMatrix();
    controls.target.copy(snapshot.controls.target);
    controls.minDistance = snapshot.controls.minDistance;
    controls.maxDistance = snapshot.controls.maxDistance;
    const priorDamping = controls.enableDamping;
    controls.enableDamping = false;
    try {
      controls.update();
    } finally {
      controls.enableDamping = snapshot.controls.enableDamping ?? priorDamping;
    }
    perspectiveCamera.updateMatrixWorld(true);
    floor.scale.copy(snapshot.floorScale);
    if (renderer.shadowMap) renderer.shadowMap.type = snapshot.rendererShadowType;
    keyLight.position.copy(snapshot.light.position);
    keyLight.target.position.copy(snapshot.light.targetPosition);
    keyLight.target.updateMatrixWorld(true);
    keyLight.shadow.mapSize.copy(snapshot.light.mapSize);
    keyLight.shadow.bias = snapshot.light.bias;
    keyLight.shadow.normalBias = snapshot.light.normalBias;
    Object.assign(keyLight.shadow.camera, snapshot.light.camera);
    keyLight.shadow.camera.updateProjectionMatrix();
    keyLight.shadow.map = transactionState.shadowMapInvalidated
      ? null
      : snapshot.light.map;
    assertPresentationStateEquals(snapshot, transactionState, "presentation rollback");
  }

  function resizeCaptureTarget(nextWidth, nextHeight, phase) {
    if (!captureTarget) return false;
    if (captureTarget.width === nextWidth && captureTarget.height === nextHeight) return false;
    captureTarget.setSize(nextWidth, nextHeight);
    captureTargetResizeCount += 1;
    const layout = describeCorpusReadback(nextWidth, nextHeight, renderer.outputColorSpace);
    recordResourceTransition({
      allocationId: "capture-target",
      resourceKind: "render-target",
      action: "resize",
      status: "succeeded",
      phase,
      logicalByteLength: layout.width * layout.height * 8,
    });
    return true;
  }

  function captureResolutionState() {
    return {
      width,
      height,
      requestedDpr,
      appliedDpr,
      cameraAspect: perspectiveCamera.aspect,
      drawingBufferWidth: renderer.domElement.width,
      drawingBufferHeight: renderer.domElement.height,
      rendererPixelRatio: typeof renderer.getPixelRatio === "function"
        ? renderer.getPixelRatio()
        : Number.isFinite(renderer.pixelRatio)
          ? renderer.pixelRatio
          : appliedDpr,
      captureWidth: captureTarget?.width ?? null,
      captureHeight: captureTarget?.height ?? null,
    };
  }

  function applyResolutionPolicy(
    tierId = currentTier,
    policyWidth = width,
    policyHeight = height,
    policyRequestedDpr = requestedDpr,
  ) {
    const nextAppliedDpr = resolveCorpusDpr(tierId, policyRequestedDpr);
    renderer.setPixelRatio(nextAppliedDpr);
    renderer.setSize(policyWidth, policyHeight, false);
    perspectiveCamera.aspect = policyWidth / policyHeight;
    perspectiveCamera.updateProjectionMatrix();
    resizeCaptureTarget(renderer.domElement.width, renderer.domElement.height, "resolution-policy");
    return nextAppliedDpr;
  }

  function restoreResolutionState(snapshot, phase) {
    renderer.setPixelRatio(snapshot.appliedDpr);
    renderer.setSize(snapshot.width, snapshot.height, false);
    perspectiveCamera.aspect = snapshot.cameraAspect;
    perspectiveCamera.updateProjectionMatrix();
    if (captureTarget && snapshot.captureWidth !== null && snapshot.captureHeight !== null) {
      resizeCaptureTarget(snapshot.captureWidth, snapshot.captureHeight, phase);
    }
    appliedDpr = snapshot.appliedDpr;
    const actualPixelRatio = typeof renderer.getPixelRatio === "function"
      ? renderer.getPixelRatio()
      : Number.isFinite(renderer.pixelRatio)
        ? renderer.pixelRatio
        : appliedDpr;
    const mismatches = [];
    if (Math.abs(actualPixelRatio - snapshot.rendererPixelRatio) > 1e-12) {
      mismatches.push("renderer pixel ratio");
    }
    if (renderer.domElement.width !== snapshot.drawingBufferWidth) {
      mismatches.push("drawing-buffer width");
    }
    if (renderer.domElement.height !== snapshot.drawingBufferHeight) {
      mismatches.push("drawing-buffer height");
    }
    if (Math.abs(perspectiveCamera.aspect - snapshot.cameraAspect) > 1e-12) {
      mismatches.push("camera aspect");
    }
    if (
      captureTarget
      && (
        captureTarget.width !== snapshot.captureWidth
        || captureTarget.height !== snapshot.captureHeight
      )
    ) mismatches.push("capture-target dimensions");
    if (mismatches.length > 0) {
      throw new Error(`resolution rollback postcondition mismatch: ${mismatches.join(", ")}`);
    }
  }

  function invalidateResolutionRollback() {
    lifecycleAcceptanceStatus = "invalid-resolution-transaction-rollback";
    acceptingControllerOperations = false;
  }

  function ensureCaptureTarget() {
    if (!captureTarget) {
      captureTargetAllocationAttempts += 1;
      captureTarget = new THREE.RenderTarget(1, 1, {
        type: THREE.UnsignedByteType,
        depthBuffer: true,
      });
      captureTarget.texture.colorSpace = renderer.outputColorSpace;
      captureTargetAllocations += 1;
      recordResourceTransition({
        allocationId: "capture-target",
        resourceKind: "render-target",
        action: "allocate",
        status: "succeeded",
        phase: "lazy-capture-allocation",
        logicalByteLength: 8,
      });
    }
    resizeCaptureTarget(renderer.domElement.width, renderer.domElement.height, "capture-size-sync");
    return captureTarget;
  }

  function beginTargetMaskRenderState() {
    if (!activeTarget?.root || !targetMaskMaterial) throw new Error("target-mask capture requires an active subject and mask material");
    const visibility = [];
    activeTarget.root.traverse((object) => visibility.push([object, object.visible]));
    const movingRoots = currentMode === "action-ready" ? movingSemanticRoots(activeTarget) : [];
    const selectedMeshes = new Set();
    if (movingRoots.length > 0) for (const root of movingRoots) root.traverse((object) => {
      if (object.isMesh) selectedMeshes.add(object);
    });
    if (movingRoots.length > 0) activeTarget.root.traverse((object) => {
      if (object.isMesh) object.visible = object.visible && selectedMeshes.has(object);
    });
    const snapshot = {
      background: scene.background,
      fog: scene.fog,
      overrideMaterial: scene.overrideMaterial,
      floorVisible: floor.visible,
      toneMapping: renderer.toneMapping,
      toneMappingExposure: renderer.toneMappingExposure,
    };
    scene.background = new THREE.Color(0x000000);
    scene.fog = null;
    scene.overrideMaterial = targetMaskMaterial;
    floor.visible = false;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1;
    return Object.freeze({
      maskKind: movingRoots.length > 0 ? "named-moving-semantic-regions" : "subject-silhouette",
      semanticNodeIds: movingRoots.length > 0 ? corpusMovingSemanticNodeIds(activeTarget) : Object.freeze([]),
      restore() {
        for (const [object, visible] of visibility) object.visible = visible;
        scene.background = snapshot.background;
        scene.fog = snapshot.fog;
        scene.overrideMaterial = snapshot.overrideMaterial;
        floor.visible = snapshot.floorVisible;
        renderer.toneMapping = snapshot.toneMapping;
        renderer.toneMappingExposure = snapshot.toneMappingExposure;
      },
    });
  }

  async function disposeTargetOnce(target, phase = "target-retirement") {
    if (!target || disposedTargets.has(target)) return false;
    disposedTargets.set(target, "attempting");
    contentRoot.remove(target.root);
    targetDisposeAttempts += 1;
    const result = await attemptResourceTeardown(
      `${target.runtime?.subjectId ?? "unknown"}/${target.runtime?.instanceId ?? "unknown"}`,
      "sculpt-target",
      phase,
      () => target.dispose(),
      targetAllocationIds.get(target),
    );
    const renderAllocationIds = targetRenderAllocationIds.get(target);
    if (renderAllocationIds) {
      recordResourceTransition({
        allocationId: renderAllocationIds.geometry,
        resourceKind: "target-geometry-backing-stores",
        action: "dispose",
        status: result.status,
        phase,
      });
      recordResourceTransition({
        allocationId: renderAllocationIds.materials,
        resourceKind: "target-material-descriptors",
        action: "dispose",
        status: result.status,
        phase,
      });
    }
    knownLiveTargetCount = Math.max(0, knownLiveTargetCount - 1);
    if (result.status === "succeeded") {
      targetDisposals += 1;
      disposedTargets.set(target, "succeeded");
      return true;
    }
    targetDisposeUncertain += 1;
    disposedTargets.set(target, "uncertain");
    throw result.error;
  }

  async function allocateConfiguredTarget(
    subjectIdValue,
    tierValue,
    seedValue,
    generationGuard,
  ) {
    let candidate = null;
    let tracked = false;
    let untrackedAllocationId = null;
    targetAllocationAttempts += 1;
    try {
      generationGuard.assert("configured-target-allocation-start");
      candidate = await dependencies.createTarget(subjectIdValue, {
        tier: tierValue,
        seed: seedValue,
        instanceId: "active-preview",
        continuityToken: CORPUS_CONTINUITY_TOKEN,
      });
      generationGuard.assert("configured-target-factory-result");
      requireControllerTarget(candidate, subjectIdValue);
      targetAllocations += 1;
      knownLiveTargetCount += 1;
      peakLiveTargetCount = Math.max(peakLiveTargetCount, potentiallyLiveTargetCount());
      tracked = true;
      const targetAllocationId = `${subjectIdValue}/${candidate.runtime?.instanceId ?? "unknown"}/generation-${candidate.runtime?.instanceGeneration ?? candidate.runtime?.runtimeId?.generation ?? "unknown"}/allocation-${targetAllocations}`;
      targetAllocationIds.set(candidate, targetAllocationId);
      recordResourceTransition({
        allocationId: targetAllocationId,
        resourceKind: "sculpt-target",
        action: "allocate",
        status: "succeeded",
        phase: "configured-target-candidate",
      });
      const targetRenderResources = describeTargetRenderResources(candidate);
      const renderAllocationIds = {
        geometry: `${targetAllocationId}/geometry`,
        materials: `${targetAllocationId}/materials`,
      };
      targetRenderAllocationIds.set(candidate, renderAllocationIds);
      recordResourceTransition({
        allocationId: renderAllocationIds.geometry,
        resourceKind: "target-geometry-backing-stores",
        action: "allocate",
        status: "succeeded",
        phase: "configured-target-candidate",
        logicalByteLength: targetRenderResources.geometry.uniqueBackingStoreBytes,
      });
      recordResourceTransition({
        allocationId: renderAllocationIds.materials,
        resourceKind: "target-material-descriptors",
        action: "allocate",
        status: "succeeded",
        phase: "configured-target-candidate",
        logicalByteLength: null,
      });
      const candidateMotionBaseline = captureTargetPose(candidate);
      const candidateAdjacentBaseline = captureTargetPose(candidate);
      await candidate.setMode(currentMode);
      generationGuard.assert("configured-target-mode");
      await candidate.setTime(currentTime, currentMode === "action-ready");
      generationGuard.assert("configured-target-time");
      candidate.root.updateMatrixWorld(true);
      const candidateMotionWitness = measureTargetPose(
        candidate,
        candidateMotionBaseline,
        currentMode,
        currentTime,
        null,
        candidateAdjacentBaseline,
        0,
      );
      assertMotionWitness(candidateMotionWitness);
      return {
        candidate,
        candidateSummary: Object.freeze({ ...dependencies.summarizeTarget(candidate.root) }),
        candidateMotionBaseline,
        candidateMotionWitness,
      };
    } catch (error) {
      const cleanupErrors = [];
      if (candidate && !disposedTargets.has(candidate)) {
        if (tracked) {
          try {
            await disposeTargetOnce(candidate, "failed-candidate-cleanup");
          } catch (cleanupError) {
            cleanupErrors.push(cleanupError);
          }
        } else {
          untrackedCandidateAllocations += 1;
          knownLiveUntrackedCandidateCount += 1;
          peakLiveUntrackedCandidateCount = Math.max(
            peakLiveUntrackedCandidateCount,
            potentiallyLiveUntrackedCandidateCount(),
          );
          untrackedAllocationId = `${subjectIdValue}/untracked-candidate/allocation-attempt-${targetAllocationAttempts}`;
          recordResourceTransition({
            allocationId: untrackedAllocationId,
            resourceKind: "untracked-sculpt-target",
            action: "allocate",
            status: "succeeded",
            phase: "untracked-candidate-factory-result",
          });
          const disposeOperation = typeof candidate.dispose === "function"
            ? () => candidate.dispose()
            : () => {
                throw new TypeError(
                  `Malformed target "${subjectIdValue}" does not expose dispose(); resource state is uncertain`,
                );
              };
          const result = await attemptResourceTeardown(
            untrackedAllocationId,
            "untracked-sculpt-target",
            "failed-candidate-cleanup",
            disposeOperation,
            untrackedAllocationId,
          );
          knownLiveUntrackedCandidateCount = Math.max(
            0,
            knownLiveUntrackedCandidateCount - 1,
          );
          if (result.status === "succeeded") {
            untrackedCandidateDisposals += 1;
          } else {
            untrackedCandidateDisposeUncertain += 1;
            cleanupErrors.push(result.error);
          }
        }
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [error, ...cleanupErrors],
          `Failed to prepare "${subjectIdValue}" and candidate teardown was uncertain`,
        );
      }
      throw error;
    }
  }

  async function prepareTargetTransaction(
    subjectIdValue,
    tierValue,
    seedValue,
    generationGuard,
  ) {
    const definition = dependencies.getTargetDefinition(subjectIdValue);
    if (definition?.id !== subjectIdValue) {
      throw new Error(`Target definition for "${subjectIdValue}" has a mismatched ID`);
    }
    const prepared = await allocateConfiguredTarget(
      subjectIdValue,
      tierValue,
      seedValue,
      generationGuard,
    );
    try {
      generationGuard.assert("prepared-target-allocation");
      const cameraPlan = prepareCameraPlan(prepared.candidate, definition, currentCamera);
      const shadowPlan = prepareLightShadowPlan(prepared.candidate, definition, tierValue);
      generationGuard.assert("prepared-target-presentation-plans");
      return {
        ...prepared,
        definition,
        cameraPlan,
        shadowPlan,
      };
    } catch (error) {
      try {
        await disposeTargetOnce(prepared.candidate, "failed-plan-preparation-cleanup");
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          `Failed to prepare presentation plans for "${subjectIdValue}" and candidate teardown was uncertain`,
        );
      }
      throw error;
    }
  }

  async function restoreRetiredTarget(previousState, generationGuard) {
    let restored = null;
    const restorationSnapshot = capturePresentationState();
    const transactionState = { shadowMapInvalidated: false };
    try {
      restored = await prepareTargetTransaction(
        previousState.subjectId,
        previousState.tier,
        previousState.seed,
        generationGuard,
      );
      generationGuard.assert("retired-target-restoration-pre-presentation");
      const restoredCameraFraming = applyCameraPlan(restored.cameraPlan);
      const restoredLightShadowPolicy = applyLightShadowPlan(restored.shadowPlan, transactionState);
      generationGuard.assert("retired-target-restoration-commit");
      contentRoot.add(restored.candidate.root);
      activeTarget = restored.candidate;
      activeDefinition = restored.definition;
      summary = restored.candidateSummary;
      motionBaseline = restored.candidateMotionBaseline;
      motionWitness = restored.candidateMotionWitness;
      cameraFraming = restoredCameraFraming;
      lightShadowPolicy = restoredLightShadowPolicy;
      rollbackRebuildCount += 1;
    } catch (error) {
      const errors = [error];
      if (restored?.candidate && !disposedTargets.has(restored.candidate)) {
        try {
          await disposeTargetOnce(restored.candidate, "failed-restoration-candidate-cleanup");
        } catch (cleanupError) {
          errors.push(cleanupError);
        }
      }
      try {
        restorePresentationState(restorationSnapshot, transactionState);
      } catch (presentationError) {
        errors.push(presentationError);
      }
      throw errors.length === 1
        ? error
        : new AggregateError(errors, `Failed to restore prior target "${previousState.subjectId}"`);
    }
  }

  async function rebuildTarget({
    subjectIdValue = currentSubjectId,
    tierValue = currentTier,
    seedValue = currentSeed,
  } = {}, generationGuard = createOperationGenerationGuard("rebuildTarget"),
  outerPresentationTransactionState = null) {
    requireLive();
    generationGuard.assert("target-rebuild-start");
    const previousTarget = activeTarget;
    const previousState = previousTarget ? {
      subjectId: currentSubjectId,
      tier: currentTier,
      seed: currentSeed,
    } : null;
    const replacesSameInstance = previousState?.subjectId === subjectIdValue;
    const presentationSnapshot = previousTarget ? capturePresentationState() : null;
    const transactionState = outerPresentationTransactionState
      ?? { shadowMapInvalidated: false };
    let previousRetired = false;
    let prepared = null;
    let presentationApplied = false;

    try {
      if (replacesSameInstance) {
        await disposeTargetOnce(previousTarget, "same-instance-prior-retirement");
        previousRetired = true;
        generationGuard.assert("same-instance-prior-retirement");
      }
      prepared = await prepareTargetTransaction(
        subjectIdValue,
        tierValue,
        seedValue,
        generationGuard,
      );
      generationGuard.assert("target-rebuild-pre-presentation");
      presentationApplied = true;
      const preparedCameraFraming = applyCameraPlan(prepared.cameraPlan);
      const preparedLightShadowPolicy = applyLightShadowPlan(
        prepared.shadowPlan,
        transactionState,
      );

      if (previousTarget && !replacesSameInstance) {
        await disposeTargetOnce(previousTarget, "cross-subject-prior-retirement");
        previousRetired = true;
        generationGuard.assert("cross-subject-prior-retirement");
      }

      generationGuard.assert("target-rebuild-commit");
      contentRoot.add(prepared.candidate.root);
      activeTarget = prepared.candidate;
      activeDefinition = prepared.definition;
      summary = prepared.candidateSummary;
      motionBaseline = prepared.candidateMotionBaseline;
      motionWitness = prepared.candidateMotionWitness;
      cameraFraming = preparedCameraFraming;
      lightShadowPolicy = preparedLightShadowPolicy;
      currentSubjectId = subjectIdValue;
      currentTier = tierValue;
      currentSeed = seedValue;
      rebuildCount += 1;
    } catch (error) {
      const rollbackErrors = [];
      if (presentationApplied && presentationSnapshot) {
        try {
          restorePresentationState(presentationSnapshot, transactionState);
        } catch (restorePresentationError) {
          rollbackErrors.push(restorePresentationError);
        }
      }
      if (prepared?.candidate && !disposedTargets.has(prepared.candidate)) {
        try {
          await disposeTargetOnce(prepared.candidate, "uncommitted-candidate-rollback");
        } catch (candidateDisposeError) {
          rollbackErrors.push(candidateDisposeError);
        }
      }
      if (previousRetired && previousState) {
        try {
          await restoreRetiredTarget(previousState, generationGuard);
        } catch (restoreTargetError) {
          rollbackErrors.push(restoreTargetError);
        }
      }
      if (disposedTargets.get(previousTarget) === "uncertain") {
        lifecycleAcceptanceStatus = "invalid-uncertain-teardown";
        acceptingControllerOperations = false;
      }
      if (rollbackErrors.length > 0) {
        throwRollbackFailure(
          error,
          rollbackErrors,
          `Failed to rebuild "${subjectIdValue}" and close its rollback transaction`,
          "rebuild",
        );
      }
      recordLifecycleFailure(error);
      throw error;
    }
  }

  try {
    const rendererOptions = {
      canvas,
      antialias: antialiasRequested,
      trackTimestamp: timestampTrackingRequested,
    };
    if (retainedGpuDeviceBinding) {
      gpuDeviceBindingLease = acquireCorpusGpuDeviceBinding(
        retainedGpuDeviceBinding,
        {
          owner: "webgpu-object-sculptor-corpus-controller",
          onDeviceLost(info) {
            recordDeviceEvent("device-lost", {
              api: "WebGPU",
              reason: info.reason,
              message: info.message,
            });
          },
        },
      );
      rendererOptions.device = gpuDeviceBindingLease.device;
    }
    renderer = dependencies.createRenderer(rendererOptions);
    if (!renderer || typeof renderer.init !== "function" || typeof renderer.render !== "function") {
      throw new TypeError("renderer dependency must provide init() and render()");
    }
    recordResourceTransition({
      allocationId: "renderer",
      resourceKind: "renderer",
      action: "allocate",
      phase: "controller-initialization",
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    if (renderer.shadowMap) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    installRendererMonitoringBeforeInit();
    await renderer.init();
    verifyInitializedRendererBackend();

    controls = dependencies.createControls(perspectiveCamera, canvas);
    if (!controls?.target?.isVector3 || typeof controls.update !== "function" || typeof controls.dispose !== "function") {
      throw new TypeError("controls dependency must provide a Vector3 target, update(), and dispose()");
    }
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.enabled = cameraInteractionEnabled;
    recordResourceTransition({
      allocationId: "orbit-controls",
      resourceKind: "controls",
      action: "allocate",
      phase: "controller-initialization",
    });

    floor = new THREE.Mesh(new THREE.CircleGeometry(1, 64), floorMaterial());
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.006;
    floor.receiveShadow = true;
    scene.add(floor);
    targetMaskMaterial = binaryTargetMaskMaterial();
    recordResourceTransition({
      allocationId: "floor-geometry",
      resourceKind: "geometry",
      action: "allocate",
      phase: "controller-initialization",
      logicalByteLength: describeTargetRenderResources({
        runtime: { subjectId: "controller-floor", meshes: new Map([["floor", floor]]) },
        root: floor,
      }).geometry.uniqueBackingStoreBytes,
    });
    recordResourceTransition({
      allocationId: "floor-material",
      resourceKind: "material",
      action: "allocate",
      phase: "controller-initialization",
    });
    recordResourceTransition({
      allocationId: "target-mask-material",
      resourceKind: "material",
      action: "allocate",
      phase: "controller-initialization",
    });

    scene.add(new THREE.HemisphereLight(0xbad5df, 0x24130e, 1.65));
    keyLight = new THREE.DirectionalLight(0xffe5c3, 4.2);
    keyLight.position.set(-4, 8, 6);
    keyLight.castShadow = true;
    scene.add(keyLight, keyLight.target);
    const rim = new THREE.DirectionalLight(0xff9c56, 2.2);
    rim.position.set(5, 5, -6);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0x8ebbd1, 1.05);
    fill.position.set(3, 2, 5);
    scene.add(fill);

    appliedDpr = applyResolutionPolicy();
    await rebuildTarget();
    initialized = true;
  } catch (error) {
    const cleanupErrors = [];
    if (activeTarget) {
      try {
        await disposeTargetOnce(activeTarget, "initialization-failure-target-cleanup");
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    for (const [resourceId, resourceKind, resource, operation] of [
      ["orbit-controls", "controls", controls, () => controls.dispose()],
      ["floor-geometry", "geometry", floor?.geometry, () => floor.geometry.dispose()],
      ["floor-material", "material", floor?.material, () => floor.material.dispose()],
      ["target-mask-material", "material", targetMaskMaterial, () => targetMaskMaterial.dispose()],
      ["capture-target", "render-target", captureTarget, () => captureTarget.dispose()],
      ["renderer", "renderer", renderer, () => renderer.dispose()],
    ]) {
      if (!resource) continue;
      const result = await attemptResourceTeardown(
        resourceId,
        resourceKind,
        "initialization-failure-cleanup",
        operation,
      );
      if (result.error) cleanupErrors.push(result.error);
    }
    if (gpuDeviceBindingLease) {
      try {
        releaseCorpusGpuDeviceBindingLease(gpuDeviceBindingLease, {
          reusable: cleanupErrors.length === 0,
          reason: cleanupErrors.length > 0
            ? `initialization cleanup was uncertain: ${cleanupErrors.map(errorMessage).join("; ")}`
            : undefined,
        });
      } catch (releaseError) {
        cleanupErrors.push(releaseError);
      } finally {
        gpuDeviceBindingLease = null;
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "Object Sculptor corpus initialization failed and teardown was uncertain",
      );
    }
    throw error;
  }

  async function submitSceneRender(phase, parentGenerationGuard = null) {
    const renderGenerationGuard = createOperationGenerationGuard(`render:${phase}`);
    parentGenerationGuard?.assert(`${phase}-render-start`);
    renderGenerationGuard.assert("render-start");
    const submissionOrdinal = ++renderSubmissions;
    const startedAtMs = requireFiniteNonnegative(dependencies.now(), "CPU render submit start time");
    const drawCallsBefore = Number.isFinite(renderer.info?.render?.calls)
      ? renderer.info.render.calls
      : null;
    let status = "failed";
    try {
      await renderer.render(scene, perspectiveCamera);
      renderGenerationGuard.assert("render-completion-commit");
      parentGenerationGuard?.assert(`${phase}-render-completion-commit`);
      completedFrames += 1;
      lastCompletedSubmissionOrdinal = submissionOrdinal;
      lastCompletedSubmissionPhase = phase;
      const drawCallsAfter = Number.isFinite(renderer.info?.render?.calls)
        ? renderer.info.render.calls
        : null;
      lastCompletedSceneDrawCalls = drawCallsAfter === null
        ? null
        : drawCallsBefore === null || drawCallsAfter <= drawCallsBefore
          ? drawCallsAfter
          : drawCallsAfter - drawCallsBefore;
      lastFrameError = null;
      status = "completed";
      return {
        frameOrdinal: completedFrames,
        submissionOrdinal,
      };
    } catch (error) {
      if (error?.code === DEVICE_GENERATION_CHANGED_ERROR_CODE) {
        status = "invalid-device-generation-changed";
      }
      lastFrameError = errorMessage(error);
      frameErrorCount += 1;
      throw error;
    } finally {
      const finishedAtMs = requireFiniteNonnegative(dependencies.now(), "CPU render submit end time");
      const durationMs = finishedAtMs - startedAtMs;
      if (!Number.isFinite(durationMs) || durationMs < 0) {
        throw new RangeError("CPU render submit duration must be finite and nonnegative");
      }
      cpuRenderSubmissionSampleCount += 1;
      cpuRenderSubmissionSamplesDropped += appendBoundedDiagnostic(
        cpuRenderSubmissionSamples,
        deepFreezePlain({
          schemaVersion: "object-sculptor-cpu-render-submission-v1",
          phase,
          status,
          durationMs,
          startedAtMs,
          finishedAtMs,
          rendererDeviceGeneration: renderGenerationGuard.snapshot.rendererDeviceGeneration,
          deviceLossGeneration: renderGenerationGuard.snapshot.deviceLossGeneration,
          completedRendererDeviceGeneration: rendererDeviceGeneration,
          completedDeviceLossGeneration: deviceLossGeneration,
          frameOrdinal: status === "completed" ? completedFrames : null,
          submissionOrdinal,
          sceneDrawCalls: status === "completed" ? lastCompletedSceneDrawCalls : null,
          sampleOrdinal: cpuRenderSubmissionSampleCount,
        }),
        CORPUS_DIAGNOSTIC_RETENTION_LIMITS.cpuRenderSubmissions,
      );
    }
  }

  const controller = {
    async ready() {
      await controllerOperationTail;
      requireOperational();
    },
    async setSubject(id) {
      return enqueueControllerOperation("setSubject", async (generationGuard) => {
        if (!corpusStateChanged(currentSubjectId, id, SCULPT_TARGET_IDS, "subject")) return false;
        const previousSubjectId = currentSubjectId;
        await rebuildTarget({ subjectIdValue: id }, generationGuard);
        recordStateMutation("subject", previousSubjectId, currentSubjectId);
        return true;
      });
    },
    async setScenario(id) {
      return controller.setSubject(id);
    },
    async setMode(id) {
      return enqueueControllerOperation("setMode", async (generationGuard) => {
        if (!corpusStateChanged(currentMode, id, SCULPT_MODES, "mode")) return false;
        const previousMode = currentMode;
        const previousWitness = motionWitness;
        const targetRollbackSnapshot = captureTargetRollbackState(activeTarget);
        const adjacentBaseline = captureTargetPose(activeTarget);
        const presentationSnapshot = capturePresentationState();
        const transactionState = { shadowMapInvalidated: false };
        try {
          await activeTarget.setMode(id);
          generationGuard.assert("mode-target-mode");
          await activeTarget.setTime(currentTime, id === "action-ready");
          generationGuard.assert("mode-target-time");
          const nextWitness = measureTargetPose(
            activeTarget,
            motionBaseline,
            id,
            currentTime,
            id === "action-ready" ? emptyMotionWitness(id, currentTime) : null,
            adjacentBaseline,
            currentTime,
          );
          assertMotionWitness(nextWitness);
          const nextSummary = Object.freeze({ ...dependencies.summarizeTarget(activeTarget.root) });
          const cameraPlan = prepareCameraPlan(activeTarget, activeDefinition, currentCamera);
          const shadowPlan = prepareLightShadowPlan(activeTarget, activeDefinition, currentTier);
          const nextCameraFraming = applyCameraPlan(cameraPlan);
          const nextLightShadowPolicy = applyLightShadowPlan(shadowPlan, transactionState);
          generationGuard.assert("mode-commit");
          currentMode = id;
          motionWitness = nextWitness;
          summary = nextSummary;
          cameraFraming = nextCameraFraming;
          lightShadowPolicy = nextLightShadowPolicy;
          recordStateMutation("mode", previousMode, currentMode);
          return true;
        } catch (error) {
          const rollbackErrors = [];
          await collectRollbackError(rollbackErrors, () => activeTarget.setMode(previousMode));
          await collectRollbackError(
            rollbackErrors,
            () => activeTarget.setTime(currentTime, previousMode === "action-ready"),
          );
          currentMode = previousMode;
          motionWitness = previousWitness;
          await collectRollbackError(rollbackErrors, () => refreshSummary());
          await collectRollbackError(
            rollbackErrors,
            () => restorePresentationState(presentationSnapshot, transactionState),
          );
          await collectRollbackError(
            rollbackErrors,
            () => assertTargetRollbackState(
              activeTarget,
              targetRollbackSnapshot,
              "mode rollback",
            ),
          );
          throwRollbackFailure(
            error,
            rollbackErrors,
            `Failed to set mode "${id}" and restore "${previousMode}"`,
            "mode",
          );
          throw error;
        }
      });
    },
    async setTier(id) {
      return enqueueControllerOperation("setTier", async (generationGuard) => {
        if (!corpusStateChanged(currentTier, id, SCULPT_TIERS, "tier")) return false;
        const previousTier = currentTier;
        const resolutionSnapshot = captureResolutionState();
        const presentationSnapshot = capturePresentationState();
        const presentationTransactionState = { shadowMapInvalidated: false };
        let rebuildStarted = false;
        try {
          const nextAppliedDpr = applyResolutionPolicy(id);
          generationGuard.assert("tier-resolution-policy");
          rebuildStarted = true;
          await rebuildTarget(
            { tierValue: id },
            generationGuard,
            presentationTransactionState,
          );
          appliedDpr = nextAppliedDpr;
          recordStateMutation("tier", previousTier, currentTier);
          return true;
        } catch (error) {
          const rollbackErrors = [];
          try {
            restoreResolutionState(resolutionSnapshot, "tier-resolution-rollback");
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError);
          }
          try {
            restorePresentationState(presentationSnapshot, presentationTransactionState);
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError);
          }
          if (rollbackErrors.length > 0) {
            invalidateResolutionRollback();
            throwRollbackFailure(
              error,
              rollbackErrors,
              `Failed to set tier "${id}" and restore the prior resolution transaction`,
              "resolution",
            );
          }
          if (!rebuildStarted) recordLifecycleFailure(error);
          throw error;
        }
      });
    },
    async setSeed(value) {
      return enqueueControllerOperation("setSeed", async (generationGuard) => {
        requireInteger(value, "seed");
        if (currentSeed === value) return false;
        const previousSeed = currentSeed;
        await rebuildTarget({ seedValue: value }, generationGuard);
        recordStateMutation("seed", previousSeed, currentSeed);
        return true;
      });
    },
    async setCamera(id) {
      return enqueueControllerOperation("setCamera", async (generationGuard) => {
        if (!corpusStateChanged(currentCamera, id, CORPUS_CAMERAS, "camera")) return false;
        const previousCamera = currentCamera;
        const presentationSnapshot = capturePresentationState();
        try {
          const plan = prepareCameraPlan(activeTarget, activeDefinition, id);
          const nextCameraFraming = applyCameraPlan(plan);
          generationGuard.assert("camera-commit");
          currentCamera = id;
          cameraFraming = nextCameraFraming;
          recordStateMutation("camera", previousCamera, currentCamera);
          return true;
        } catch (error) {
          const rollbackErrors = [];
          await collectRollbackError(
            rollbackErrors,
            () => restorePresentationState(presentationSnapshot),
          );
          throwRollbackFailure(
            error,
            rollbackErrors,
            `Failed to set camera "${id}" and restore "${previousCamera}"`,
            "camera",
          );
          throw error;
        }
      });
    },
    async setTime(seconds) {
      return enqueueControllerOperation("setTime", async (generationGuard) => {
        if (!Number.isFinite(seconds) || seconds < 0) {
          throw new RangeError("time must be finite and nonnegative");
        }
        if (seconds === currentTime) return false;
        const previousTime = currentTime;
        const previousWitness = motionWitness;
        const targetRollbackSnapshot = captureTargetRollbackState(activeTarget);
        const adjacentBaseline = captureTargetPose(activeTarget);
        const presentationSnapshot = capturePresentationState();
        const transactionState = { shadowMapInvalidated: false };
        try {
          await activeTarget.setTime(seconds, currentMode === "action-ready");
          generationGuard.assert("time-target-time");
          const nextWitness = measureTargetPose(
            activeTarget,
            motionBaseline,
            currentMode,
            seconds,
            previousWitness,
            adjacentBaseline,
            previousTime,
          );
          assertMotionWitness(nextWitness);
          const cameraPlan = prepareCameraPlan(activeTarget, activeDefinition, currentCamera);
          const shadowPlan = prepareLightShadowPlan(activeTarget, activeDefinition, currentTier);
          const nextCameraFraming = applyCameraPlan(cameraPlan);
          const nextLightShadowPolicy = applyLightShadowPlan(shadowPlan, transactionState);
          generationGuard.assert("time-commit");
          currentTime = seconds;
          motionWitness = nextWitness;
          cameraFraming = nextCameraFraming;
          lightShadowPolicy = nextLightShadowPolicy;
          recordStateMutation("time", previousTime, currentTime);
          return true;
        } catch (error) {
          const rollbackErrors = [];
          await collectRollbackError(
            rollbackErrors,
            () => activeTarget.setTime(previousTime, currentMode === "action-ready"),
          );
          currentTime = previousTime;
          motionWitness = previousWitness;
          await collectRollbackError(
            rollbackErrors,
            () => restorePresentationState(presentationSnapshot, transactionState),
          );
          await collectRollbackError(
            rollbackErrors,
            () => assertTargetRollbackState(
              activeTarget,
              targetRollbackSnapshot,
              "time rollback",
            ),
          );
          throwRollbackFailure(
            error,
            rollbackErrors,
            `Failed to set time ${seconds} and restore ${previousTime}`,
            "time",
          );
          throw error;
        }
      });
    },
    async step(deltaSeconds) {
      return enqueueControllerOperation("step", async (generationGuard) => {
        if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
          throw new RangeError("deltaSeconds must be finite and nonnegative");
        }
        controls.update();
        generationGuard.assert("step-controls-update");
        const previousTime = currentTime;
        const previousWitness = motionWitness;
        const nextTime = currentTime + deltaSeconds;
        const targetRollbackSnapshot = captureTargetRollbackState(activeTarget);
        const adjacentBaseline = captureTargetPose(activeTarget);
        try {
          await activeTarget.setTime(nextTime, currentMode === "action-ready");
          generationGuard.assert("step-target-time");
          const nextWitness = measureTargetPose(
            activeTarget,
            motionBaseline,
            currentMode,
            nextTime,
            previousWitness,
            adjacentBaseline,
            previousTime,
          );
          assertMotionWitness(nextWitness);
          generationGuard.assert("step-commit");
          currentTime = nextTime;
          motionWitness = nextWitness;
          stepCount += 1;
        } catch (error) {
          const rollbackErrors = [];
          await collectRollbackError(
            rollbackErrors,
            () => activeTarget.setTime(previousTime, currentMode === "action-ready"),
          );
          motionWitness = previousWitness;
          await collectRollbackError(
            rollbackErrors,
            () => assertTargetRollbackState(
              activeTarget,
              targetRollbackSnapshot,
              "step rollback",
            ),
          );
          throwRollbackFailure(
            error,
            rollbackErrors,
            `Failed to step to ${nextTime} and restore ${previousTime}`,
            "step",
          );
          throw error;
        }
      });
    },
    async resetHistory() {
      return enqueueControllerOperation("resetHistory", async (generationGuard) => {
        const changed = currentTime !== 0;
        const previousTime = currentTime;
        const previousWitness = motionWitness;
        const targetRollbackSnapshot = captureTargetRollbackState(activeTarget);
        const adjacentBaseline = captureTargetPose(activeTarget);
        const presentationSnapshot = capturePresentationState();
        const transactionState = { shadowMapInvalidated: false };
        try {
          await activeTarget.setTime(0, currentMode === "action-ready");
          generationGuard.assert("history-reset-target-time");
          const nextWitness = measureTargetPose(
            activeTarget,
            motionBaseline,
            currentMode,
            0,
            emptyMotionWitness(currentMode, currentTime),
            adjacentBaseline,
            previousTime,
          );
          const cameraPlan = prepareCameraPlan(activeTarget, activeDefinition, currentCamera);
          const shadowPlan = prepareLightShadowPlan(activeTarget, activeDefinition, currentTier);
          const nextCameraFraming = applyCameraPlan(cameraPlan);
          const nextLightShadowPolicy = applyLightShadowPlan(shadowPlan, transactionState);
          generationGuard.assert("history-reset-commit");
          currentTime = 0;
          motionWitness = nextWitness;
          cameraFraming = nextCameraFraming;
          lightShadowPolicy = nextLightShadowPolicy;
          if (changed) recordStateMutation("history-reset-time", previousTime, currentTime);
          return changed;
        } catch (error) {
          const rollbackErrors = [];
          await collectRollbackError(
            rollbackErrors,
            () => activeTarget.setTime(previousTime, currentMode === "action-ready"),
          );
          currentTime = previousTime;
          motionWitness = previousWitness;
          await collectRollbackError(
            rollbackErrors,
            () => restorePresentationState(presentationSnapshot, transactionState),
          );
          await collectRollbackError(
            rollbackErrors,
            () => assertTargetRollbackState(
              activeTarget,
              targetRollbackSnapshot,
              "history-reset rollback",
            ),
          );
          throwRollbackFailure(
            error,
            rollbackErrors,
            `Failed to reset history and restore ${previousTime}`,
            "history-reset",
          );
          throw error;
        }
      });
    },
    async resize(nextWidth, nextHeight, nextDpr = 1) {
      return enqueueControllerOperation("resize", async (generationGuard) => {
        nextWidth = Math.floor(requirePositive(nextWidth, "resize width"));
        nextHeight = Math.floor(requirePositive(nextHeight, "resize height"));
        nextDpr = requirePositive(nextDpr, "resize DPR");
        if (nextWidth === width && nextHeight === height && nextDpr === requestedDpr) return false;
        const previousViewport = { width, height, requestedDpr };
        const resolutionSnapshot = captureResolutionState();
        const presentationSnapshot = capturePresentationState();
        try {
          const nextAppliedDpr = applyResolutionPolicy(
            currentTier,
            nextWidth,
            nextHeight,
            nextDpr,
          );
          generationGuard.assert("resize-resolution-policy");
          const nextCameraFraming = applyCameraPlan(
            prepareCameraPlan(
              activeTarget,
              activeDefinition,
              currentCamera,
              nextWidth,
              nextHeight,
            ),
          );
          generationGuard.assert("resize-commit");
          width = nextWidth;
          height = nextHeight;
          requestedDpr = nextDpr;
          appliedDpr = nextAppliedDpr;
          cameraFraming = nextCameraFraming;
          recordStateMutation("viewport", previousViewport, { width, height, requestedDpr });
          return true;
        } catch (error) {
          const rollbackErrors = [];
          try {
            restoreResolutionState(resolutionSnapshot, "viewport-resolution-rollback");
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError);
          }
          try {
            restorePresentationState(presentationSnapshot);
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError);
          }
          if (rollbackErrors.length > 0) {
            invalidateResolutionRollback();
            throwRollbackFailure(
              error,
              rollbackErrors,
              "Failed to resize and restore the prior resolution transaction",
              "resolution",
            );
          }
          recordLifecycleFailure(error);
          throw error;
        }
      });
    },
    async renderOnce() {
      return enqueueControllerOperation("renderOnce", async (generationGuard) => {
        await submitSceneRender("presentation-forward-scene", generationGuard);
      });
    },
    async resolveGpuTimestampSample() {
      return enqueueControllerOperation("resolveGpuTimestampSample", async (generationGuard) => {
        generationGuard.assert("timestamp-resolve-start");
        gpuTimestampResolveAttempts += 1;
        const snapshot = {
          rendererDeviceGeneration,
          deviceLossGeneration,
          frameOrdinal: completedFrames,
          submissionOrdinal: renderSubmissions,
          coveredSubmissionCount: renderSubmissions - lastTimestampResolvedSubmissionOrdinal,
          renderPhase: lastCompletedSubmissionPhase,
        };
        const rejectUnavailable = (message) => {
          recordGpuTimestampFailure(message, snapshot);
          throw gpuTimestampUnavailableError(message);
        };
        if (timestampTrackingActive !== true) {
          return rejectUnavailable(
            "GPU timestamp resolution requires trackTimestamp on the initialized WebGPU renderer device",
          );
        }
        if (typeof renderer.resolveTimestampsAsync !== "function") {
          return rejectUnavailable("Initialized renderer does not expose resolveTimestampsAsync() ");
        }
        if (snapshot.coveredSubmissionCount === 0) {
          return rejectUnavailable("GPU timestamp resolution requires one new render submission");
        }

        const resolveStartedAtMs = requireFiniteNonnegative(
          dependencies.now(),
          "GPU timestamp resolve start time",
        );
        const timestampQueryPoolBefore = inspectRenderTimestampQueryPool(renderer);
        let gpuMs;
        try {
          gpuMs = await renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER);
        } catch (error) {
          lastTimestampResolvedSubmissionOrdinal = snapshot.submissionOrdinal;
          return rejectUnavailable(`GPU render timestamp resolution failed: ${errorMessage(error)}`);
        }
        generationGuard.assert("timestamp-resolve-result");
        const timestampQueryPoolAfter = inspectRenderTimestampQueryPool(renderer);
        const resolveFinishedAtMs = requireFiniteNonnegative(
          dependencies.now(),
          "GPU timestamp resolve end time",
        );
        lastTimestampResolvedSubmissionOrdinal = snapshot.submissionOrdinal;
        const resolveOverheadMs = resolveFinishedAtMs - resolveStartedAtMs;

        if (!Number.isFinite(gpuMs) || gpuMs < 0) {
          return rejectUnavailable("GPU render timestamp resolution returned a non-finite or negative duration");
        }
        if (!Number.isFinite(resolveOverheadMs) || resolveOverheadMs < 0) {
          return rejectUnavailable("GPU timestamp resolve overhead was non-finite or negative");
        }
        const freshness = verifyFreshRenderTimestampQueryPool(
          timestampQueryPoolBefore,
          timestampQueryPoolAfter,
          gpuMs,
        );
        snapshot.queryPoolEvidence = freshness.evidence;
        if (!freshness.verified) {
          return rejectUnavailable(
            `GPU render timestamp freshness is unverified: ${freshness.reason}`,
          );
        }
        if (snapshot.coveredSubmissionCount !== 1) {
          return rejectUnavailable(
            `GPU timestamp scope covered ${snapshot.coveredSubmissionCount} render submissions; exactly one is required`,
          );
        }
        if (lastCompletedSubmissionOrdinal !== snapshot.submissionOrdinal) {
          return rejectUnavailable("GPU timestamp scope does not end at a completed render submission");
        }
        if (snapshot.renderPhase !== "presentation-forward-scene") {
          return rejectUnavailable(
            `GPU timestamp performance scope requires presentation-forward-scene, received ${snapshot.renderPhase ?? "unknown"}`,
          );
        }
        if (
          rendererDeviceStatus !== "active"
          || rendererDeviceGeneration !== snapshot.rendererDeviceGeneration
          || deviceLossGeneration !== snapshot.deviceLossGeneration
        ) {
          return rejectUnavailable("GPU device generation changed during timestamp resolution");
        }

        generationGuard.assert("timestamp-sample-commit");
        gpuTimestampSampleCount += 1;
        const sample = deepFreezePlain({
          schemaVersion: GPU_TIMESTAMP_SAMPLE_SCHEMA_VERSION,
          status: "measured",
          scope: THREE.TimestampQuery.RENDER,
          timingSource: "renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER)",
          gpuMs,
          resolveOverheadMs,
          rendererDeviceGeneration: snapshot.rendererDeviceGeneration,
          deviceLossGeneration: snapshot.deviceLossGeneration,
          frameOrdinal: snapshot.frameOrdinal,
          submissionOrdinal: snapshot.submissionOrdinal,
          coveredSubmissionCount: snapshot.coveredSubmissionCount,
          renderPhase: snapshot.renderPhase,
          sampleOrdinal: gpuTimestampSampleCount,
          subjectId: currentSubjectId,
          tier: currentTier,
          mode: currentMode,
          seed: currentSeed,
          queryPoolEvidence: freshness.evidence,
        });
        gpuTimestampSamplesDropped += appendBoundedDiagnostic(
          gpuTimestampSamples,
          sample,
          CORPUS_DIAGNOSTIC_RETENTION_LIMITS.gpuTimestampSamples,
        );
        lastGpuTimestampFailure = null;
        timingMethod = "webgpu-timestamp-query-resolved-render-samples-on-verified-renderer-device";
        return sample;
      });
    },
    async capturePixels(target = "presentation") {
      return enqueueControllerOperation("capturePixels", async (generationGuard) => {
        if (!new Set(["presentation", "output", "target-mask"]).has(target)) {
          throw new RangeError(`Unknown capture target "${target}"`);
        }
        if (
          typeof renderer.getRenderTarget !== "function"
          || typeof renderer.setRenderTarget !== "function"
          || typeof renderer.readRenderTargetPixelsAsync !== "function"
        ) {
          throw new Error("renderer does not expose native WebGPU render-target readback");
        }

        const output = ensureCaptureTarget();
        generationGuard.assert("capture-target-ready");
        const previous = renderer.getRenderTarget();
        let readbackAllocationId = null;
        let readbackStatus = "not-requested";
        let readbackLogicalByteLength = null;
        let result = null;
        let pendingReadbackLayout = null;
        let operationError = null;
        let targetMaskState = null;
        try {
          renderer.setRenderTarget(output);
          if (renderer.getRenderTarget() !== output) {
            throw new Error("renderer did not bind the requested Object Sculptor capture target");
          }
          generationGuard.assert("capture-target-bound");
          if (target === "target-mask") targetMaskState = beginTargetMaskRenderState();
          try {
            await submitSceneRender(target === "target-mask" ? "capture-target-mask" : "capture-forward-scene", generationGuard);
          } finally {
            targetMaskState?.restore();
          }
          const requestedLayout = describeCorpusReadback(
            output.width,
            output.height,
            renderer.outputColorSpace,
          );
          readbackRequestCount += 1;
          readbackAllocationId = `capture-readback-staging-request-${readbackRequestCount}`;
          readbackStatus = "pending";
          readbackLogicalByteLength = requestedLayout.minimumByteLength;
          recordResourceTransition({
            allocationId: readbackAllocationId,
            resourceKind: "readback-staging-request",
            action: "allocate",
            status: "succeeded",
            phase: "native-readback-request",
            logicalByteLength: requestedLayout.minimumByteLength,
          });
          const value = await renderer.readRenderTargetPixelsAsync(
            output,
            0,
            0,
            output.width,
            output.height,
          );
          generationGuard.assert("capture-readback-result");
          if (!ArrayBuffer.isView(value)) {
            throw new TypeError("native WebGPU readback must return an ArrayBuffer view");
          }
          const readback = value instanceof Uint8Array
            ? value
            : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
          const layout = describeCorpusReadback(output.width, output.height, renderer.outputColorSpace);
          const readbackSourceBytesPerRow = readback.byteLength === layout.rowBytes * layout.height
            ? layout.rowBytes
            : layout.bytesPerRow;
          const normalizedReadback = preserveCorpusReadbackRows(readback, layout);
          const transportPixels = Array.from(readback);
          const normalizedPixels = Array.from(normalizedReadback);
          generationGuard.assert("capture-readback-commit");
          readbackStatus = "completed";
          pendingReadbackLayout = deepFreezePlain({
            ...layout,
            transportBytesPerRow: readbackSourceBytesPerRow,
            transportByteLength: readback.byteLength,
            normalizedBytesPerRow: layout.bytesPerRow,
            normalizedByteLength: normalizedReadback.byteLength,
            frameOrdinal: completedFrames,
            submissionOrdinal: lastCompletedSubmissionOrdinal,
          });
          result = {
            target,
            maskKind: targetMaskState?.maskKind ?? null,
            semanticNodeIds: targetMaskState?.semanticNodeIds ?? Object.freeze([]),
            ...layout,
            sourceBytesPerRow: layout.bytesPerRow,
            sourceByteLength: normalizedReadback.byteLength,
            readbackSourceBytesPerRow,
            readbackSourceByteLength: readback.byteLength,
            transport: {
              layout: {
                width: layout.width,
                height: layout.height,
                format: layout.format,
                rowBytes: layout.rowBytes,
                bytesPerRow: readbackSourceBytesPerRow,
                byteLength: readback.byteLength,
                padding: readbackSourceBytesPerRow === layout.rowBytes
                  ? "compact"
                  : readback.byteLength === layout.minimumByteLength
                    ? "webgpu-aligned-final-row-unpadded"
                    : "webgpu-aligned-fully-padded",
              },
              pixels: transportPixels,
            },
            normalized: {
              layout: {
                width: layout.width,
                height: layout.height,
                format: layout.format,
                rowBytes: layout.rowBytes,
                bytesPerRow: layout.bytesPerRow,
                byteLength: normalizedReadback.byteLength,
                padding: "cpu-normalized-fully-padded",
              },
              pixels: normalizedPixels,
            },
            origin: "top-left",
            backendKind: backendKind(renderer),
            nativeWebGPU: renderer.backend?.isWebGPUBackend === true,
            pixels: normalizedPixels,
          };
        } catch (error) {
          operationError = error;
          if (readbackAllocationId) readbackStatus = "failed";
          if (lastFrameError !== errorMessage(error)) {
            lastFrameError = errorMessage(error);
            frameErrorCount += 1;
          }
        }
        if (readbackAllocationId) {
          recordResourceTransition({
            allocationId: readbackAllocationId,
            resourceKind: "readback-staging-request",
            action: "dispose",
            status: "succeeded",
            phase: `native-readback-${readbackStatus}`,
            logicalByteLength: readbackLogicalByteLength,
          });
        }

        captureTargetRestoreAttempts += 1;
        let restorationError = null;
        try {
          renderer.setRenderTarget(previous);
          if (renderer.getRenderTarget() !== previous) {
            throw new Error(
              "renderer did not restore the exact prior Object Sculptor render target identity",
            );
          }
        } catch (error) {
          restorationError = error;
          captureTargetRestoreFailures += 1;
          lastCaptureTargetRestoreError = errorMessage(error);
          lifecycleAcceptanceStatus = "invalid-capture-target-restoration";
          acceptingControllerOperations = false;
        }
        if (!restorationError) {
          try {
            generationGuard.assert("capture-target-restored");
          } catch (error) {
            operationError ??= error;
          }
        }
        if (restorationError) {
          const aggregate = new AggregateError(
            operationError ? [operationError, restorationError] : [restorationError],
            operationError
              ? "Object Sculptor capture failed and its prior render target could not be restored"
              : "Object Sculptor capture completed but its prior render target could not be restored",
          );
          recordLifecycleFailure(aggregate);
          throw aggregate;
        }
        if (operationError) throw operationError;
        generationGuard.assert("capture-result-commit");
        lastReadbackLayout = pendingReadbackLayout;
        lastReadbackAllocationId = readbackAllocationId;
        return result;
      });
    },
    getRuntimeContract() {
      requireLive();
      const runtime = activeTarget.runtime;
      const targetContract = activeTarget.contract ?? activeDefinition.contract ?? {};
      const subjectContinuity = runtime.subjectContinuity ?? runtime.identityContinuity ?? null;
      return {
        subjectId: currentSubjectId,
        targetContractId: activeTarget.contract?.id ?? activeDefinition.contract?.id ?? currentSubjectId,
        mode: currentMode,
        tier: currentTier,
        instanceId: runtime.instanceId ?? null,
        instanceGeneration: runtime.instanceGeneration ?? runtime.runtimeId?.generation ?? null,
        runtimeId: runtime.runtimeId ?? null,
        continuityStatus: runtime.continuityStatus ?? runtime.continuity?.status ?? null,
        continuity: runtime.continuity ?? null,
        subjectContinuity,
        continuityEvidence: {
          baseToken: CORPUS_CONTINUITY_TOKEN,
          effectiveToken: runtime.continuity?.token ?? runtime.continuityToken ?? null,
          generation: runtime.instanceGeneration ?? runtime.runtimeId?.generation ?? null,
          previousGeneration: runtime.continuity?.previousGeneration ?? null,
          status: runtime.continuityStatus ?? runtime.continuity?.status ?? null,
          tokenProvided: runtime.continuityTokenProvided ?? runtime.continuity?.tokenProvided ?? false,
          seed: runtime.seed ?? currentSeed,
          visualTierExcluded: subjectContinuity?.visualTierExcluded
            ?? (subjectContinuity?.visualTierAffectsGeneration === undefined
              ? null
              : subjectContinuity.visualTierAffectsGeneration === false),
        },
        nodeIds: [...(runtime.nodes?.keys?.() ?? [])].sort(),
        socketIds: [...(runtime.sockets?.keys?.() ?? [])].sort(),
        colliderIds: [...(runtime.colliders?.keys?.() ?? [])].sort(),
        destructionGroupIds: [...(runtime.destructionGroups?.keys?.() ?? [])].sort(),
        protectedNodeIds: protectedRuntimeIds(
          targetContract,
          "protectedNodeIds",
          "protectedComponentIds",
          runtime.nodes,
          `${currentSubjectId} nodes`,
        ),
        protectedSocketIds: protectedRuntimeIds(
          targetContract,
          "protectedSocketIds",
          "socketIds",
          runtime.sockets,
          `${currentSubjectId} sockets`,
        ),
        protectedColliderIds: protectedRuntimeIds(
          targetContract,
          "protectedColliderIds",
          "colliderIds",
          runtime.colliders,
          `${currentSubjectId} colliders`,
        ),
        protectedDestructionGroupIds: protectedRuntimeIds(
          targetContract,
          "protectedDestructionGroupIds",
          "destructionGroupIds",
          runtime.destructionGroups,
          `${currentSubjectId} destruction groups`,
        ),
        socketBindings: [...(runtime.sockets?.entries?.() ?? [])].map(([id, value]) => ({
          id,
          parentId: value.parent?.userData?.sculptId ?? value.parent?.name ?? null,
          localPositionMeters: value.position.toArray(),
        })).sort((a, b) => a.id.localeCompare(b.id)),
        colliderConstructionInputs: [...(runtime.colliders?.values?.() ?? [])],
        physicsMaterialBindings: [...(runtime.physicsMaterials?.values?.() ?? [])],
        destructionGroupRecords: [...(runtime.destructionGroups?.entries?.() ?? [])].map(([id, members]) => ({
          id,
          members: [...members].sort(),
        })).sort((a, b) => a.id.localeCompare(b.id)),
        physicsAuthority: "authoring-input-only",
        physicsHandoffStatus: "blocked-authoring-inputs-only",
        motionOwner: currentMode === "action-ready" ? "target procedural transform timeline" : "frozen authored pose",
        motionWitness,
        cameraFraming,
        cameraInteractionEnabled,
      };
    },
    getPerformanceEvidence() {
      return performanceEvidence();
    },
    getMetrics() {
      const physicsHandoffCount = activeTarget.runtime.colliders?.size ?? summary.colliders ?? 0;
      const adapterIdentity = performanceAdapterIdentity();
      return {
        ...summary,
        labId: "webgpu-object-sculptor-corpus",
        subjectId: currentSubjectId,
        scenario: currentSubjectId,
        mode: currentMode,
        tier: currentTier,
        seed: currentSeed,
        camera: currentCamera,
        time: currentTime,
        dpr: appliedDpr,
        viewport: deepFreezePlain({
          cssWidth: width,
          cssHeight: height,
          requestedDpr,
          appliedDpr,
          drawingBufferWidth: renderer.domElement.width,
          drawingBufferHeight: renderer.domElement.height,
        }),
        backend: backendKind(renderer),
        backendKind: backendKind(renderer),
        threeRevision: THREE.REVISION,
        nativeWebGPU: renderer.backend?.isWebGPUBackend === true,
        rendererInfo: rendererRenderInfo(renderer),
        initialized,
        firstFrameCompleted: completedFrames > 0,
        stepCount,
        renderSubmissions,
        completedFrames,
        drawCalls: lastCompletedSceneDrawCalls,
        drawCallMetric: "last-completed-app-owned-scene-submission-delta",
        rebuildCount,
        rollbackRebuildCount,
        targetAllocationAttempts,
        targetAllocations,
        targetDisposeAttempts,
        targetDisposals,
        targetDisposeUncertain,
        liveTargetCount: potentiallyLiveTargetCount(),
        knownLiveTargetCount,
        possiblyLiveUncertainTargetCount: targetDisposeUncertain,
        targetLeakFree: targetDisposeUncertain === 0,
        peakLiveTargetCount,
        untrackedCandidateAllocations,
        untrackedCandidateDisposals,
        untrackedCandidateDisposeUncertain,
        liveUntrackedCandidateCount: potentiallyLiveUntrackedCandidateCount(),
        knownLiveUntrackedCandidateCount,
        possiblyLiveUntrackedCandidateCount: untrackedCandidateDisposeUncertain,
        untrackedCandidateLeakFree: untrackedCandidateDisposeUncertain === 0,
        peakLiveUntrackedCandidateCount,
        physicsHandoffCount,
        physicsHandoffStatus: physicsHandoffCount > 0
          ? "blocked-authoring-inputs-only"
          : "no-collider-inputs",
        runtimeProfile,
        performanceTimestampMode,
        preInitCapabilities,
        timestampQueriesRequired,
        timestampQueriesRequested: timestampTrackingRequested,
        timestampQueriesActive: timestampTrackingActive,
        rendererBackendEvidence,
        gpuDeviceBindingLifecycle: retainedGpuDeviceBinding
          ? describeCorpusGpuDeviceBinding(retainedGpuDeviceBinding).lifecycle
          : null,
        performanceAdapterIdentityStatus: adapterIdentity.status,
        performanceAdapterIdentity: adapterIdentity.identity,
        timingMethod,
        gpuTimestampResolveAttempts,
        gpuTimestampResolveFailures,
        gpuTimestampSampleCount,
        gpuTimestampSamplesRetained: gpuTimestampSamples.length,
        gpuTimestampSamplesDropped,
        lastGpuTimestampSample: gpuTimestampSamples.at(-1) ?? null,
        lastGpuTimestampFailure,
        gpuTimestampFailureCount,
        gpuTimestampFailuresRetained: gpuTimestampFailures.length,
        gpuTimestampFailuresDropped,
        cpuRenderSubmissionSampleCount,
        cpuRenderSubmissionSamplesRetained: cpuRenderSubmissionSamples.length,
        cpuRenderSubmissionSamplesDropped,
        diagnosticRetentionLimits: CORPUS_DIAGNOSTIC_RETENTION_LIMITS,
        lastCpuRenderSubmissionSample: cpuRenderSubmissionSamples.at(-1) ?? null,
        sustainedGpuTimingAvailable: false,
        performanceAcceptance: timestampEvidenceStatus(),
        frameOwnerStatus: rendererDeviceStatus === "lost"
          ? "stopped-device-lost"
          : acceptingControllerOperations
            ? "accepting"
            : "closing-or-stopped",
        rendererDeviceGeneration,
        deviceLossGeneration,
        rendererDeviceStatus,
        rendererDeviceIdentityStillCurrent: renderer.backend?.device === initializedRendererDevice,
        deviceErrorCount,
        deviceErrorsRetained: deviceErrors.length,
        deviceErrorsDropped,
        lastDeviceError,
        deviceErrors: [...deviceErrors],
        lifecycleAcceptanceStatus,
        teardown: teardownReport(),
        motionWitness,
        cameraFraming,
        cameraInteractionEnabled,
        lightShadowPolicy,
        pendingControllerOperations,
        acceptingControllerOperations,
        frameErrorCount,
        lifecycleErrorCount,
        stateMutationCount: stateMutationSequence,
        stateMutationsRetained: stateMutations.length,
        stateMutationsDropped,
        lastStateMutation: stateMutations.at(-1) ?? null,
        resourceTransitionCount: resourceTransitionSequence,
        resourceTransitionsRetained: resourceTransitions.length,
        resourceTransitionsDropped,
        lastResourceTransition: resourceTransitions.at(-1) ?? null,
        lastFrameError,
        lastLifecycleError,
        captureTargetRestoreAttempts,
        captureTargetRestoreFailures,
        lastCaptureTargetRestoreError,
      };
    },
    describePipeline() {
      const adapterIdentity = performanceAdapterIdentity();
      return {
        owner: "WebGPURenderer",
        sceneRendersPerFrame: CORPUS_RENDER_POLICY.sceneRendersPerFrame,
        passes: ["forward-scene"],
        mrt: CORPUS_RENDER_POLICY.mrt,
        postprocessing: CORPUS_RENDER_POLICY.postprocessing,
        toneMapping: "ACESFilmicToneMapping",
        outputColorSpace: renderer.outputColorSpace,
        finalOutputOwner: "renderer",
        runtimeProfile,
        performanceTimestampMode,
        timestampQueriesRequired,
        timestampQueriesRequested: timestampTrackingRequested,
        timestampQueriesActive: timestampTrackingActive,
        timestampQueryCapability: {
          preInit: preInitCapabilities,
          initializedBackend: rendererBackendEvidence,
        },
        timingMethod,
        performanceAdapterIdentityStatus: adapterIdentity.status,
        performanceAdapterIdentity: adapterIdentity.identity,
        timingEvidenceStatus: timestampEvidenceStatus(),
        gpuTimestampSampleCount,
        gpuTimestampSamplesRetained: gpuTimestampSamples.length,
        gpuTimestampSamplesDropped,
        gpuTimestampResolveFailures,
        rendererDeviceStatus,
        rendererDeviceGeneration,
        deviceLossGeneration,
        rendererDeviceIdentityStillCurrent: renderer.backend?.device === initializedRendererDevice,
      };
    },
    describeResources() {
      const adapterIdentity = performanceAdapterIdentity();
      const targetRenderResources = describeTargetRenderResources(activeTarget);
      const floorRenderResources = describeTargetRenderResources({
        runtime: { subjectId: "controller-floor", meshes: new Map([["floor", floor]]) },
        root: floor,
      });
      const captureSamplesRequested = Number.isInteger(captureTarget?.samples)
        ? captureTarget.samples
        : 0;
      const captureEffectiveSampleCount = captureSamplesRequested > 0
        ? captureSamplesRequested
        : 1;
      const capturePixelCount = captureTarget ? captureTarget.width * captureTarget.height : 0;
      const captureColorBytes = capturePixelCount * 4 * captureEffectiveSampleCount;
      const captureDepthBytesUpperBound = capturePixelCount * 4 * captureEffectiveSampleCount;
      const shadowRequestedTexels = lightShadowPolicy?.mapSize
        ? lightShadowPolicy.mapSize * lightShadowPolicy.mapSize
        : 0;
      const shadowDepthBytesUpperBound = shadowRequestedTexels * 4;

      const retainedAllocationIds = new Set([
        ...knownLiveResourceIntervals.keys(),
        ...uncertainResourceIntervals.keys(),
        ...closedResourceIntervals.keys(),
      ]);
      const targetGeometryIds = targetRenderResources.geometry.allocations
        .map((allocation) => allocation.allocationId)
        .sort();
      const activeRenderAllocationIds = targetRenderAllocationIds.get(activeTarget) ?? {
        geometry: `target-geometry:${currentSubjectId}:untracked`,
        materials: `target-materials:${currentSubjectId}:untracked`,
      };
      const targetAndFloorGeometryBytes = targetRenderResources.geometry.uniqueBackingStoreBytes
        + floorRenderResources.geometry.uniqueBackingStoreBytes;
      const targetAndFloorMaterialCount = targetRenderResources.uniqueMaterialCount
        + floorRenderResources.uniqueMaterialCount
        + 1;
      const livenessIntervalsFor = (ids) => ids.map((id) => {
        const interval = knownLiveResourceIntervals.get(id)
          ?? uncertainResourceIntervals.get(id)
          ?? closedResourceIntervals.get(id)
          ?? null;
        return {
          id,
          startEvent: interval?.startEvent ?? null,
          endEvent: interval?.endEvent ?? null,
          status: interval?.status ?? "not-retained",
          overlapsPeak: peakResourceTransitionSequence !== null
            && (interval?.startEvent ?? Number.POSITIVE_INFINITY)
              <= peakResourceTransitionSequence
            && (interval?.endEvent ?? Number.POSITIVE_INFINITY)
              >= peakResourceTransitionSequence,
        };
      });
      const rawEvidenceDescriptors = [
        {
          category: "renderer",
          owner: "Object Sculptor corpus controller",
          resourceKind: "WebGPURenderer logical owner",
          allocationIds: ["renderer"],
          elementCount: 0,
          bytesPerElement: 0,
          sampleCount: 1,
          multiplicity: 1,
          logicalByteLength: 0,
          transient: false,
          accountingStatus: "renderer and driver allocation bytes are opaque and not claimed",
        },
        {
          category: "target-geometry",
          owner: `${currentSubjectId}+controller-static-floor`,
          resourceKind: "subject and controller-static BufferGeometry backing stores",
          allocationIds: [activeRenderAllocationIds.geometry, "floor-geometry"],
          sourceGeometryAllocationIds: targetGeometryIds,
          elementCount: targetAndFloorGeometryBytes,
          bytesPerElement: 1,
          sampleCount: 1,
          multiplicity: 1,
          logicalByteLength: targetAndFloorGeometryBytes,
          transient: false,
          accountingStatus: "exact subject plus floor JavaScript ArrayBuffer backing-store bytes; other renderer-owned static allocations are opaque",
        },
        {
          category: "target-materials",
          owner: `${currentSubjectId}+controller-static-materials`,
          resourceKind: "subject, floor, and target-mask Three.js material descriptors",
          allocationIds: [activeRenderAllocationIds.materials, "floor-material", "target-mask-material"],
          elementCount: targetAndFloorMaterialCount,
          bytesPerElement: 0,
          sampleCount: 1,
          multiplicity: 1,
          logicalByteLength: 0,
          transient: false,
          accountingStatus: "subject plus floor and target-mask material descriptor count is exact; light/backend state, driver pipelines, and residency bytes are opaque",
        },
        {
          category: "shadow",
          owner: "directional-key-light",
          resourceKind: "requested depth shadow map",
          allocationIds: [],
          elementCount: shadowRequestedTexels,
          bytesPerElement: 4,
          sampleCount: 1,
          multiplicity: 1,
          logicalByteLength: shadowDepthBytesUpperBound,
          transient: false,
          accountingStatus: "requested uncompressed depth32 upper bound only; renderer-owned allocation identity, format, compression, residency, and liveness are opaque",
        },
        {
          category: "capture-target",
          owner: "Object Sculptor corpus capture",
          resourceKind: "requested RGBA8 plus depth32 render target",
          allocationIds: captureTarget ? ["capture-target"] : [],
          elementCount: capturePixelCount,
          bytesPerElement: 8,
          sampleCount: captureEffectiveSampleCount,
          multiplicity: captureTarget ? 1 : 0,
          logicalByteLength: captureColorBytes + captureDepthBytesUpperBound,
          transient: false,
          accountingStatus: "requested uncompressed color plus depth upper bound",
        },
        {
          category: "readback-staging",
          owner: "Object Sculptor corpus capture",
          resourceKind: "256-byte-aligned RGBA8 staging request",
          allocationIds: lastReadbackLayout && lastReadbackAllocationId
            ? [lastReadbackAllocationId]
            : [],
          elementCount: lastReadbackLayout?.minimumByteLength ?? 0,
          bytesPerElement: 1,
          sampleCount: 1,
          multiplicity: lastReadbackLayout ? 1 : 0,
          logicalByteLength: lastReadbackLayout?.minimumByteLength ?? 0,
          transient: true,
          accountingStatus: "exact minimum WebGPU staging span ((height - 1) * alignedBytesPerRow + rowBytes); renderer internal allocation and residency opaque",
        },
      ].map((descriptor) => ({
        formulaId: "resource-product-and-traffic-v1",
        subjectId: currentSubjectId,
        tier: currentTier,
        ...descriptor,
        allocationCount: descriptor.allocationIds.length,
        livenessIntervals: livenessIntervalsFor(descriptor.allocationIds),
        physicalGpuResidentBytes: null,
        physicalGpuResidencyStatus: "opaque-driver-owned-not-claimed",
      }));

      return deepFreezePlain({
        schemaVersion: RESOURCE_INVENTORY_SCHEMA_VERSION,
        subjectId: currentSubjectId,
        tier: currentTier,
        renderTargets: captureTarget ? [{
          id: "capture",
          allocationId: "capture-target",
          format: "rgba8unorm",
          width: captureTarget.width,
          height: captureTarget.height,
          allocation: "lazy-capture-only",
          requestedSamples: captureSamplesRequested,
          effectiveSampleCount: captureEffectiveSampleCount,
          colorLogicalBytes: captureColorBytes,
          depthLogicalBytesUpperBound: captureDepthBytesUpperBound,
          totalLogicalBytesUpperBound: captureColorBytes + captureDepthBytesUpperBound,
          formula: "width * height * effectiveSampleCount * (4 RGBA8 bytes + 4 depth32 upper-bound bytes)",
        }] : [],
        activeTarget: {
          subjectId: currentSubjectId,
          nodes: activeTarget.runtime.nodes?.size ?? summary.nodes ?? null,
          meshes: activeTarget.runtime.meshes?.size ?? summary.meshes ?? null,
          sockets: activeTarget.runtime.sockets?.size ?? summary.sockets ?? null,
          colliderConstructionInputs: activeTarget.runtime.colliders?.size ?? summary.colliders ?? null,
          physicsMaterials: activeTarget.runtime.physicsMaterials?.size ?? summary.physicsMaterials ?? null,
          destructionGroups: activeTarget.runtime.destructionGroups?.size ?? summary.destructionGroups ?? null,
          renderResources: targetRenderResources,
        },
        controllerStaticRenderResources: floorRenderResources,
        pipelineAccounting: targetRenderResources.pipelines,
        shadow: {
          allocationId: null,
          requestIdentity: "directional-key-shadow-map-request",
          requestedMapSize: lightShadowPolicy?.mapSize ?? null,
          requestedTexels: shadowRequestedTexels,
          requestedDepthBytesUpperBound: shadowDepthBytesUpperBound,
          requestedSampleCount: 1,
          formula: "mapSize * mapSize * 4 depth32 upper-bound bytes",
          mapMaterializedByRenderer: keyLight.shadow.map !== null,
          physicalGpuResidentBytes: null,
          physicalGpuResidencyStatus: "opaque-driver-owned-not-claimed",
          livenessStatus: "renderer-owned-allocation-identity-and-liveness-unobservable",
          policyApplicationCount: shadowPolicyApplicationCount,
          mapInvalidationCount: shadowMapInvalidationCount,
        },
        readbackStaging: lastReadbackLayout ? {
          allocationId: lastReadbackAllocationId,
          width: lastReadbackLayout.width,
          height: lastReadbackLayout.height,
          rowBytes: lastReadbackLayout.rowBytes,
          alignedBytesPerRow: lastReadbackLayout.bytesPerRow,
          minimumByteLength: lastReadbackLayout.minimumByteLength,
          fullyPaddedByteLength: lastReadbackLayout.fullyPaddedByteLength,
          logicalStagingByteLength: lastReadbackLayout.minimumByteLength,
          normalizedCpuFullPaddingByteLength: lastReadbackLayout.fullyPaddedByteLength,
          transportBytesPerRow: lastReadbackLayout.transportBytesPerRow,
          transportByteLength: lastReadbackLayout.transportByteLength,
          normalizedBytesPerRow: lastReadbackLayout.normalizedBytesPerRow,
          normalizedByteLength: lastReadbackLayout.normalizedByteLength,
          alignmentBytes: 256,
          formula: "(height - 1) * alignedBytesPerRow + rowBytes",
          physicalGpuResidentBytes: null,
          physicalGpuResidencyStatus: "renderer internal staging allocation opaque",
        } : null,
        rawEvidenceDescriptors,
        lifecycle: {
          liveTargetCount: potentiallyLiveTargetCount(),
          knownLiveTargetCount,
          possiblyLiveUncertainTargetCount: targetDisposeUncertain,
          peakLiveTargetCount,
          targetAllocationAttempts,
          targetAllocations,
          targetDisposeAttempts,
          targetDisposals,
          targetDisposeUncertain,
          untrackedCandidateAllocations,
          untrackedCandidateDisposals,
          untrackedCandidateDisposeUncertain,
          liveUntrackedCandidateCount: potentiallyLiveUntrackedCandidateCount(),
          knownLiveUntrackedCandidateCount,
          possiblyLiveUntrackedCandidateCount: untrackedCandidateDisposeUncertain,
          peakLiveUntrackedCandidateCount,
          rollbackRebuildCount,
          pendingControllerOperations,
          acceptingControllerOperations,
          lifecycleAcceptanceStatus,
          teardown: teardownReport(),
          captureTargetAllocationAttempts,
          captureTargetAllocations,
          captureTargetResizeCount,
          captureTargetDisposals,
          captureTargetRestoreAttempts,
          captureTargetRestoreFailures,
          lastCaptureTargetRestoreError,
          resourceTransitionSequence,
          resourceTransitionRetention: {
            limit: CORPUS_DIAGNOSTIC_RETENTION_LIMITS.resourceTransitions,
            observed: resourceTransitionSequence,
            retained: resourceTransitions.length,
            dropped: resourceTransitionsDropped,
          },
          resourceTransitions: resourceTransitions.map((record) => ({ ...record })),
          allocationCount: resourceAllocationCount,
          retainedAllocationIds: [...retainedAllocationIds].sort(),
          successfulDisposalCount: resourceSuccessfulDisposalCount,
          uncertainDisposalCount: resourceUncertainDisposalCount,
          orphanDisposalCount: resourceOrphanDisposalCount,
          knownLiveAllocationIds: [...knownLiveResourceIntervals.keys()].sort(),
          uncertainAllocationIds: [...uncertainResourceIntervals.keys()].sort(),
          peakKnownLiveCount: peakKnownLiveResourceCount,
          allocationReconciled: resourceAllocationCount
            === resourceSuccessfulDisposalCount
              + resourceUncertainDisposalCount
              + knownLiveResourceIntervals.size,
          allocationLeakFree: resourceUncertainDisposalCount === 0
            && resourceOrphanDisposalCount === 0,
          allocationEquilibrium: resourceAllocationCount
              === resourceSuccessfulDisposalCount
                + resourceUncertainDisposalCount
                + knownLiveResourceIntervals.size
            && resourceUncertainDisposalCount === 0
            && resourceOrphanDisposalCount === 0,
          closedResourceIntervalRetention: {
            limit: CORPUS_DIAGNOSTIC_RETENTION_LIMITS.closedResourceIntervals,
            retained: closedResourceIntervals.size,
            dropped: closedResourceIntervalsDropped,
          },
          trackedTargetAllocationReconciled: targetAllocations
            === targetDisposals + targetDisposeUncertain + knownLiveTargetCount,
          trackedTargetLeakFree: targetDisposeUncertain === 0,
          trackedTargetAllocationEquilibrium: targetAllocations
              === targetDisposals + targetDisposeUncertain + knownLiveTargetCount
            && targetDisposeUncertain === 0,
          untrackedCandidateAllocationReconciled: untrackedCandidateAllocations
            === untrackedCandidateDisposals
              + untrackedCandidateDisposeUncertain
              + knownLiveUntrackedCandidateCount,
          untrackedCandidateLeakFree: untrackedCandidateDisposeUncertain === 0,
          untrackedCandidateAllocationEquilibrium: untrackedCandidateAllocations
              === untrackedCandidateDisposals
                + untrackedCandidateDisposeUncertain
                + knownLiveUntrackedCandidateCount
            && untrackedCandidateDisposeUncertain === 0,
          targetAllocationReconciled: (
            targetAllocations + untrackedCandidateAllocations
          ) === (
            targetDisposals
              + targetDisposeUncertain
              + knownLiveTargetCount
              + untrackedCandidateDisposals
              + untrackedCandidateDisposeUncertain
              + knownLiveUntrackedCandidateCount
          ),
          targetLeakFree: targetDisposeUncertain === 0
            && untrackedCandidateDisposeUncertain === 0,
          targetAllocationEquilibrium: (
            targetAllocations + untrackedCandidateAllocations
          ) === (
            targetDisposals
              + targetDisposeUncertain
              + knownLiveTargetCount
              + untrackedCandidateDisposals
              + untrackedCandidateDisposeUncertain
              + knownLiveUntrackedCandidateCount
          ) && targetDisposeUncertain === 0
            && untrackedCandidateDisposeUncertain === 0,
          stateMutationCount: stateMutationSequence,
          stateMutationRetention: {
            limit: CORPUS_DIAGNOSTIC_RETENTION_LIMITS.stateMutations,
            observed: stateMutationSequence,
            retained: stateMutations.length,
            dropped: stateMutationsDropped,
          },
          stateMutations: stateMutations.map((record) => ({ ...record })),
        },
        cameraFraming,
        cameraInteractionEnabled,
        lightShadowPolicy,
        rendererCreationPolicy: {
          runtimeProfile,
          performanceTimestampMode,
          antialiasRequested,
          antialiasPolicy: CORPUS_RENDER_POLICY.antialiasPolicy,
          actualRendererSamples: Number.isFinite(renderer.samples) ? renderer.samples : null,
          timestampQueriesRequired,
          timestampQueriesRequested: timestampTrackingRequested,
          timestampQueriesActive: timestampTrackingActive,
          preInitCapabilities,
          initializedBackend: rendererBackendEvidence,
          performanceAdapterIdentityStatus: adapterIdentity.status,
          performanceAdapterIdentity: adapterIdentity.identity,
          timingMethod,
        },
        device: {
          rendererDeviceStatus,
          rendererDeviceGeneration,
          deviceLossGeneration,
          deviceErrorCount,
          rendererDeviceIdentityStillCurrent: renderer.backend?.device === initializedRendererDevice,
          deviceErrorRetention: {
            limit: CORPUS_DIAGNOSTIC_RETENTION_LIMITS.deviceErrors,
            observed: deviceErrorCount,
            retained: deviceErrors.length,
            dropped: deviceErrorsDropped,
          },
          lastDeviceError,
          gpuDeviceBindingLifecycle: retainedGpuDeviceBinding
            ? describeCorpusGpuDeviceBinding(retainedGpuDeviceBinding).lifecycle
            : null,
        },
        motionWitness,
        performanceEvidence: performanceEvidence(),
        residencyClaim: "logical/requested app-owned bytes only; no physical GPU residency claim",
        preservedInvariants: [
          "stable semantic IDs across visual tiers",
          "physics collider construction inputs independent of visual LOD",
          "one active target and one scene render per frame",
        ],
      });
    },
    async drain() {
      await controllerOperationTail;
    },
    getTeardownReport() {
      return teardownReport();
    },
    async dispose() {
      if (disposalPromise) {
        await disposalPromise;
        return false;
      }
      acceptingControllerOperations = false;
      const disposeAfterPriorOperations = async () => {
        if (disposed) return false;
        disposed = true;
        const errors = [];
        try {
          await disposeTargetOnce(activeTarget, "controller-dispose");
        } catch (error) {
          errors.push(error);
        }
        const resources = [
          ["orbit-controls", "controls", controls, () => controls.dispose()],
          ["floor-geometry", "geometry", floor?.geometry, () => floor.geometry.dispose()],
          ["floor-material", "material", floor?.material, () => floor.material.dispose()],
          ["target-mask-material", "material", targetMaskMaterial, () => targetMaskMaterial.dispose()],
          ["capture-target", "render-target", captureTarget, () => captureTarget.dispose()],
          ["renderer", "renderer", renderer, () => renderer.dispose()],
        ];
        for (const [resourceId, resourceKind, resource, operation] of resources) {
          if (!resource) continue;
          const result = await attemptResourceTeardown(
            resourceId,
            resourceKind,
            "controller-dispose",
            operation,
          );
          if (result.error) errors.push(result.error);
        }
        if (errors.length === 0 && teardownReport().uncertain > 0) {
          errors.push(new Error("Controller teardown includes a resource with uncertain prior disposal"));
        }
        if (gpuDeviceBindingLease) {
          try {
            releaseCorpusGpuDeviceBindingLease(gpuDeviceBindingLease, {
              reusable: errors.length === 0,
              reason: errors.length > 0
                ? `controller teardown was uncertain: ${errors.map(errorMessage).join("; ")}`
                : undefined,
            });
          } catch (error) {
            errors.push(error);
          } finally {
            gpuDeviceBindingLease = null;
          }
        }
        if (errors.length > 0) {
          const aggregate = new AggregateError(
            errors,
            "Object Sculptor corpus controller teardown completed with uncertain resources",
          );
          recordLifecycleFailure(aggregate);
          throw aggregate;
        }
        return true;
      };
      disposalPromise = controllerOperationTail.then(disposeAfterPriorOperations, disposeAfterPriorOperations);
      controllerOperationTail = disposalPromise.catch(() => {});
      return disposalPromise;
    },
  };

  return controller;
}

export const createObjectSculptorCorpusLabController = createObjectSculptorCorpusController;
