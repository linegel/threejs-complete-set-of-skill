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

export const CORPUS_DPR_CAPS = Object.freeze({
  full: 1.5,
  budgeted: 1.25,
  minimum: 1,
});

export const CORPUS_RENDER_POLICY = Object.freeze({
  sceneRendersPerFrame: 1,
  trackTimestamp: false,
  mrt: false,
  postprocessing: false,
  timingReason: "The live corpus presents one forward scene render and does not claim unmeasured GPU timing.",
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

function defaultDependencies() {
  return {
    createRenderer: (options) => new THREE.WebGPURenderer(options),
    createControls: (camera, canvas) => new OrbitControls(camera, canvas),
    createTarget: createSculptTarget,
    getTargetDefinition: getSculptTargetDefinition,
    summarizeTarget: summarizeSculptRuntime,
    resolvePreInitCapabilities: defaultPreInitCapabilities,
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
  ]) {
    if (typeof dependencies[name] !== "function") {
      throw new TypeError(`controller dependency ${name} must be a function`);
    }
  }
  return dependencies;
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
    peakActiveChannelCount: 0,
    peakTranslationDeltaMeters: 0,
    peakRotationDeltaRadians: 0,
    peakScaleDelta: 0,
  });
}

function measureTargetPose(target, baseline, mode, time, previous = null) {
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
  const priorPeak = previous?.mode === "action-ready" ? previous : null;
  const peakActiveChannelCount = Math.max(priorPeak?.peakActiveChannelCount ?? 0, activeChannels.length);
  const status = mode !== "action-ready"
    ? "frozen-authored-pose"
    : time <= MOTION_WITNESS_GRACE_SECONDS
      ? "awaiting-pose-delta"
      : peakActiveChannelCount > 0
        ? "measured-live-pose-delta"
        : "blocked-no-pose-delta";
  return deepFreezePlain({
    status,
    mode,
    timeSeconds: time,
    measuredNodeCount: baseline.size,
    activeChannelCount: activeChannels.length,
    activeChannels,
    activeNodeIds: [...activeNodeIds].sort(),
    maxTranslationDeltaMeters,
    maxRotationDeltaRadians,
    maxScaleDelta,
    peakActiveChannelCount,
    peakTranslationDeltaMeters: Math.max(priorPeak?.peakTranslationDeltaMeters ?? 0, maxTranslationDeltaMeters),
    peakRotationDeltaRadians: Math.max(priorPeak?.peakRotationDeltaRadians ?? 0, maxRotationDeltaRadians),
    peakScaleDelta: Math.max(priorPeak?.peakScaleDelta ?? 0, maxScaleDelta),
  });
}

function assertMotionWitness(witness) {
  if (witness.status === "blocked-no-pose-delta") {
    throw new Error("Action-ready target produced no measured rest-to-current transform delta");
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
  if (source.byteLength === layout.minimumByteLength || source.byteLength === layout.fullyPaddedByteLength) {
    return source;
  }
  if (source.byteLength !== compactByteLength) {
    throw new RangeError(`unexpected capture byte length ${source.byteLength}`);
  }
  const padded = new Uint8Array(layout.fullyPaddedByteLength);
  for (let y = 0; y < layout.height; y += 1) {
    const sourceOffset = y * layout.rowBytes;
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
  if (typeof timestampQueriesRequired !== "boolean") {
    throw new TypeError("timestampQueriesRequired must be a boolean");
  }
  if (timestampQueriesRequired && runtimeProfile !== "performance") {
    throw new Error("timestampQueriesRequired is only valid for the performance runtime profile");
  }

  const dependencies = resolveDependencies(dependencyOverrides);
  const initialDefinition = dependencies.getTargetDefinition(initialSubjectId);
  if (initialDefinition?.id !== initialSubjectId) {
    throw new Error(`Target definition for "${initialSubjectId}" has a mismatched ID`);
  }
  const preInitCapabilities = normalizePreInitCapabilities(
    await dependencies.resolvePreInitCapabilities({ runtimeProfile, timestampQueriesRequired }),
    runtimeProfile,
  );
  if (timestampQueriesRequired && preInitCapabilities.timestampQuerySupported !== true) {
    throw new Error("The performance profile requires WebGPU timestamp-query support, but pre-init capability evidence did not prove it");
  }
  const timestampTrackingRequested = runtimeProfile === "performance"
    && preInitCapabilities.timestampQuerySupported === true;
  const timingMethod = timestampTrackingRequested
    ? "webgpu-timestamp-query-requested-awaiting-backend-and-sustained-evidence"
    : runtimeProfile === "performance"
      ? "cpu-submit-count-and-presentation-observation-no-gpu-duration"
      : "correctness-profile-no-timestamp-query";
  const initialAntialiasRequested = tier !== "minimum";

  let renderer = null;
  let controls = null;
  let floor = null;
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
  let rebuildCount = 0;
  let rollbackRebuildCount = 0;
  let targetAllocations = 0;
  let targetDisposals = 0;
  let liveTargetCount = 0;
  let peakLiveTargetCount = 0;
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
  const disposedTargets = new WeakSet();

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

  function refreshSummary() {
    summary = Object.freeze({ ...dependencies.summarizeTarget(activeTarget.root) });
  }

  function enqueueControllerOperation(label, operation) {
    if (!acceptingControllerOperations) {
      return Promise.reject(new Error(`Object Sculptor corpus controller is closing; rejected ${label}`));
    }
    pendingControllerOperations += 1;
    const execute = async () => {
      try {
        return await operation();
      } finally {
        pendingControllerOperations -= 1;
      }
    };
    const current = controllerOperationTail.then(execute, execute);
    controllerOperationTail = current.catch(() => {});
    return current;
  }

  function applyCamera() {
    const settings = CAMERA_SETTINGS[currentCamera];
    const focus = resolveCameraFocusBounds(activeTarget, activeDefinition, currentCamera);
    const target = focus.bounds.getCenter(new THREE.Vector3());
    const size = focus.bounds.getSize(new THREE.Vector3());
    const halfExtents = size.multiplyScalar(0.5);
    const radius = Math.max(halfExtents.length(), 0.01);
    const direction = new THREE.Vector3(...settings.direction).normalize();
    const fit = resolveCorpusProjectedBoundsFit({
      fovDegrees: settings.fov,
      aspect: width / height,
      direction: settings.direction,
      halfExtents: halfExtents.toArray(),
      distanceScale: settings.distanceScale,
    });
    const framingDistance = fit.distance;

    perspectiveCamera.fov = settings.fov;
    perspectiveCamera.near = Math.max(radius / 500, 0.002);
    perspectiveCamera.far = Math.max(framingDistance * 12, radius * 20);
    perspectiveCamera.position.copy(target).addScaledVector(direction, framingDistance);
    perspectiveCamera.updateProjectionMatrix();
    controls.target.copy(target);
    controls.minDistance = Math.max(radius * 0.45, 0.025);
    controls.maxDistance = Math.max(radius * 8, controls.minDistance * 2);
    controls.update();
    perspectiveCamera.updateMatrixWorld(true);

    cameraFraming = deepFreezePlain({
      camera: currentCamera,
      subjectId: activeDefinition.id,
      focusSource: focus.source,
      requestedNodeIds: focus.requestedNodeIds,
      resolvedNodeIds: focus.resolvedNodeIds,
      missingNodeIds: focus.missingNodeIds,
      focusCoverageStatus: focus.coverageStatus,
      fallbackReason: focus.fallbackReason,
      targetMeters: target.toArray(),
      focusSizeMeters: halfExtents.clone().multiplyScalar(2).toArray(),
      framingDistanceMeters: framingDistance,
      ...fit,
    });

    const supportScale = Math.max(activeDefinition.boundsMeters.width, activeDefinition.boundsMeters.depth) * 3.5;
    floor.scale.setScalar(Math.max(supportScale, 0.75));
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

  function applyLightShadowPolicy(tierId = currentTier) {
    const policy = CORPUS_SHADOW_POLICIES[tierId];
    const shadowType = {
      "pcf-soft": THREE.PCFSoftShadowMap,
      pcf: THREE.PCFShadowMap,
      basic: THREE.BasicShadowMap,
    }[policy.filter];
    const targetBounds = finiteObjectBounds(activeTarget.root) ?? definitionBounds(activeDefinition);
    const center = targetBounds.getCenter(new THREE.Vector3());
    const size = targetBounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.5, targetRadius(activeDefinition), 0.05);
    const frustumExtent = radius * 1.25;
    const lightDirection = new THREE.Vector3(-4, 8, 6).normalize();
    const lightDistance = radius * 4;

    const authoredCasters = [...(activeTarget.runtime.meshes?.entries?.() ?? [])]
      .filter(([, mesh]) => mesh?.isMesh && mesh.castShadow === true)
      .map(casterImportance)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const enabledCasters = authoredCasters.slice(0, policy.casterLimit);
    const enabledMeshes = new Set(enabledCasters.map(({ mesh }) => mesh));
    for (const { mesh } of authoredCasters) mesh.castShadow = enabledMeshes.has(mesh);

    const previousMapSize = keyLight.shadow.mapSize.x;
    const previousShadowType = renderer.shadowMap?.type;
    if (
      (previousMapSize !== policy.mapSize || previousShadowType !== shadowType)
      && keyLight.shadow.map
    ) {
      keyLight.shadow.map.dispose();
      keyLight.shadow.map = null;
    }
    if (renderer.shadowMap) renderer.shadowMap.type = shadowType;
    keyLight.shadow.mapSize.set(policy.mapSize, policy.mapSize);
    keyLight.position.copy(center).addScaledVector(lightDirection, lightDistance);
    keyLight.target.position.copy(center);
    keyLight.target.updateMatrixWorld(true);
    keyLight.shadow.camera.left = -frustumExtent;
    keyLight.shadow.camera.right = frustumExtent;
    keyLight.shadow.camera.top = frustumExtent;
    keyLight.shadow.camera.bottom = -frustumExtent;
    keyLight.shadow.camera.near = Math.max(radius * 0.05, 0.01);
    keyLight.shadow.camera.far = lightDistance + radius * 2.5;
    keyLight.shadow.camera.updateProjectionMatrix();
    const worldTexelMeters = frustumExtent * 2 / policy.mapSize;
    keyLight.shadow.bias = -THREE.MathUtils.clamp(worldTexelMeters * 0.04, 0.00002, 0.002);
    keyLight.shadow.normalBias = THREE.MathUtils.clamp(worldTexelMeters * 0.9, 0.0001, 0.025);

    const desiredAntialias = tierId !== "minimum";
    lightShadowPolicy = deepFreezePlain({
      tier: tierId,
      boundsSource: finiteObjectBounds(activeTarget.root)
        ? "active-target-world-bounds"
        : "definition-bounds-fallback",
      subjectRadiusMeters: radius,
      frustumExtentMeters: frustumExtent,
      mapSize: policy.mapSize,
      filter: policy.filter,
      worldTexelMeters,
      authoredCasterCount: authoredCasters.length,
      enabledCasterCount: enabledCasters.length,
      disabledCasterIds: authoredCasters.slice(policy.casterLimit).map(({ id }) => id).sort(),
      estimatedDepthBytesAt32Bit: policy.mapSize * policy.mapSize * 4,
      antialiasRequestedAtRendererInit: initialAntialiasRequested,
      desiredAntialiasForCurrentTier: desiredAntialias,
      antialiasMatchesCurrentTier: initialAntialiasRequested === desiredAntialias,
      antialiasDynamic: false,
      rendererRecreationRequiredForExactAntialiasTier: initialAntialiasRequested !== desiredAntialias,
    });
  }

  function applyResolutionPolicy(tierId = currentTier) {
    appliedDpr = resolveCorpusDpr(tierId, requestedDpr);
    renderer.setPixelRatio(appliedDpr);
    renderer.setSize(width, height, false);
    perspectiveCamera.aspect = width / height;
    perspectiveCamera.updateProjectionMatrix();
    if (captureTarget) captureTarget.setSize(renderer.domElement.width, renderer.domElement.height);
  }

  function ensureCaptureTarget() {
    if (!captureTarget) {
      captureTarget = new THREE.RenderTarget(1, 1, {
        type: THREE.UnsignedByteType,
        depthBuffer: true,
      });
      captureTarget.texture.colorSpace = renderer.outputColorSpace;
    }
    captureTarget.setSize(renderer.domElement.width, renderer.domElement.height);
    return captureTarget;
  }

  async function disposeTargetOnce(target) {
    if (!target || disposedTargets.has(target)) return false;
    disposedTargets.add(target);
    contentRoot.remove(target.root);
    try {
      await target.dispose();
    } finally {
      targetDisposals += 1;
      liveTargetCount = Math.max(0, liveTargetCount - 1);
    }
    return true;
  }

  async function allocateConfiguredTarget(subjectIdValue, tierValue, seedValue) {
    let candidate = null;
    let tracked = false;
    try {
      candidate = await dependencies.createTarget(subjectIdValue, {
        tier: tierValue,
        seed: seedValue,
        instanceId: "active-preview",
        continuityToken: CORPUS_CONTINUITY_TOKEN,
      });
      requireControllerTarget(candidate, subjectIdValue);
      targetAllocations += 1;
      liveTargetCount += 1;
      tracked = true;
      peakLiveTargetCount = Math.max(peakLiveTargetCount, liveTargetCount);
      const candidateMotionBaseline = captureTargetPose(candidate);
      await candidate.setMode(currentMode);
      await candidate.setTime(currentTime, currentMode === "action-ready");
      candidate.root.updateMatrixWorld(true);
      const candidateMotionWitness = measureTargetPose(
        candidate,
        candidateMotionBaseline,
        currentMode,
        currentTime,
      );
      assertMotionWitness(candidateMotionWitness);
      return {
        candidate,
        candidateSummary: Object.freeze({ ...dependencies.summarizeTarget(candidate.root) }),
        candidateMotionBaseline,
        candidateMotionWitness,
      };
    } catch (error) {
      if (candidate?.dispose && !disposedTargets.has(candidate)) {
        if (tracked) {
          try {
            await disposeTargetOnce(candidate);
          } catch {
            // Preserve the original construction/configuration failure.
          }
        } else {
          try {
            await candidate.dispose();
          } catch {
            // Preserve the original construction/configuration failure.
          }
        }
      }
      throw error;
    }
  }

  async function rebuildTarget({
    subjectIdValue = currentSubjectId,
    tierValue = currentTier,
    seedValue = currentSeed,
  } = {}) {
    requireLive();
    const previousTarget = activeTarget;
    const previousState = previousTarget ? {
      subjectId: previousTarget.runtime.subjectId ?? currentSubjectId,
      tier: previousTarget.runtime.tier ?? currentTier,
      seed: previousTarget.runtime.seed ?? currentSeed,
    } : null;
    const definition = dependencies.getTargetDefinition(subjectIdValue);
    if (definition?.id !== subjectIdValue) {
      throw new Error(`Target definition for "${subjectIdValue}" has a mismatched ID`);
    }
    const replacesSameInstance = previousState?.subjectId === subjectIdValue;

    try {
      if (replacesSameInstance) {
        await disposeTargetOnce(previousTarget);
        activeTarget = null;
        activeDefinition = null;
        summary = null;
      }
      const {
        candidate,
        candidateSummary,
        candidateMotionBaseline,
        candidateMotionWitness,
      } = await allocateConfiguredTarget(
        subjectIdValue,
        tierValue,
        seedValue,
      );

      contentRoot.add(candidate.root);
      activeTarget = candidate;
      activeDefinition = definition;
      summary = candidateSummary;
      motionBaseline = candidateMotionBaseline;
      motionWitness = candidateMotionWitness;
      rebuildCount += 1;
      applyCamera();
      applyLightShadowPolicy(tierValue);

      if (previousTarget && !replacesSameInstance) await disposeTargetOnce(previousTarget);
    } catch (error) {
      lastLifecycleError = error instanceof Error ? error.message : String(error);
      lifecycleErrorCount += 1;
      if (replacesSameInstance && previousState && activeTarget === null) {
        try {
          const previousDefinition = dependencies.getTargetDefinition(previousState.subjectId);
          const restored = await allocateConfiguredTarget(
            previousState.subjectId,
            previousState.tier,
            previousState.seed,
          );
          contentRoot.add(restored.candidate.root);
          activeTarget = restored.candidate;
          activeDefinition = previousDefinition;
          summary = restored.candidateSummary;
          motionBaseline = restored.candidateMotionBaseline;
          motionWitness = restored.candidateMotionWitness;
          rollbackRebuildCount += 1;
          applyCamera();
          applyLightShadowPolicy(previousState.tier);
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            `Failed to rebuild "${subjectIdValue}" and restore the prior active target`,
          );
        }
      }
      throw error;
    }
  }

  try {
    renderer = dependencies.createRenderer({
      canvas,
      antialias: initialAntialiasRequested,
      trackTimestamp: timestampTrackingRequested,
    });
    if (!renderer || typeof renderer.init !== "function" || typeof renderer.render !== "function") {
      throw new TypeError("renderer dependency must provide init() and render()");
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    if (renderer.shadowMap) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    await renderer.init();
    if (renderer.backend?.isWebGPUBackend !== true) {
      throw new Error("Native WebGPU is required for the Object Sculptor corpus; no fallback was activated.");
    }

    controls = dependencies.createControls(perspectiveCamera, canvas);
    if (!controls?.target?.isVector3 || typeof controls.update !== "function" || typeof controls.dispose !== "function") {
      throw new TypeError("controls dependency must provide a Vector3 target, update(), and dispose()");
    }
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.maxPolarAngle = Math.PI * 0.495;

    floor = new THREE.Mesh(new THREE.CircleGeometry(1, 64), floorMaterial());
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.006;
    floor.receiveShadow = true;
    scene.add(floor);

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

    applyResolutionPolicy();
    await rebuildTarget();
    initialized = true;
  } catch (error) {
    if (activeTarget) {
      try {
        await disposeTargetOnce(activeTarget);
      } catch {
        // Preserve the initialization error.
      }
    }
    controls?.dispose?.();
    floor?.geometry?.dispose?.();
    floor?.material?.dispose?.();
    captureTarget?.dispose?.();
    await renderer?.dispose?.();
    throw error;
  }

  const controller = {
    async ready() {
      await controllerOperationTail;
      requireLive();
    },
    async setSubject(id) {
      return enqueueControllerOperation("setSubject", async () => {
        requireLive();
        if (!corpusStateChanged(currentSubjectId, id, SCULPT_TARGET_IDS, "subject")) return false;
        await rebuildTarget({ subjectIdValue: id });
        currentSubjectId = id;
        return true;
      });
    },
    async setScenario(id) {
      return controller.setSubject(id);
    },
    async setMode(id) {
      return enqueueControllerOperation("setMode", async () => {
        requireLive();
        if (!corpusStateChanged(currentMode, id, SCULPT_MODES, "mode")) return false;
        const previousMode = currentMode;
        const previousWitness = motionWitness;
        try {
          await activeTarget.setMode(id);
          await activeTarget.setTime(currentTime, id === "action-ready");
          const nextWitness = measureTargetPose(
            activeTarget,
            motionBaseline,
            id,
            currentTime,
            id === "action-ready" ? emptyMotionWitness(id, currentTime) : null,
          );
          assertMotionWitness(nextWitness);
          currentMode = id;
          motionWitness = nextWitness;
          refreshSummary();
          applyCamera();
          applyLightShadowPolicy(currentTier);
          return true;
        } catch (error) {
          try {
            await activeTarget.setMode(previousMode);
            await activeTarget.setTime(currentTime, previousMode === "action-ready");
            currentMode = previousMode;
            motionWitness = measureTargetPose(
              activeTarget,
              motionBaseline,
              previousMode,
              currentTime,
              previousWitness,
            );
            refreshSummary();
            applyCamera();
            applyLightShadowPolicy(currentTier);
          } catch (rollbackError) {
            throw new AggregateError([error, rollbackError], `Failed to set mode "${id}" and restore "${previousMode}"`);
          }
          throw error;
        }
      });
    },
    async setTier(id) {
      return enqueueControllerOperation("setTier", async () => {
        requireLive();
        if (!corpusStateChanged(currentTier, id, SCULPT_TIERS, "tier")) return false;
        await rebuildTarget({ tierValue: id });
        currentTier = id;
        applyResolutionPolicy();
        return true;
      });
    },
    async setSeed(value) {
      return enqueueControllerOperation("setSeed", async () => {
        requireLive();
        requireInteger(value, "seed");
        if (currentSeed === value) return false;
        await rebuildTarget({ seedValue: value });
        currentSeed = value;
        return true;
      });
    },
    async setCamera(id) {
      return enqueueControllerOperation("setCamera", async () => {
        requireLive();
        if (!corpusStateChanged(currentCamera, id, CORPUS_CAMERAS, "camera")) return false;
        const previousCamera = currentCamera;
        currentCamera = id;
        try {
          applyCamera();
          return true;
        } catch (error) {
          currentCamera = previousCamera;
          applyCamera();
          throw error;
        }
      });
    },
    async setTime(seconds) {
      return enqueueControllerOperation("setTime", async () => {
        requireLive();
        if (!Number.isFinite(seconds) || seconds < 0) {
          throw new RangeError("time must be finite and nonnegative");
        }
        if (seconds === currentTime) return false;
        const previousTime = currentTime;
        const previousWitness = motionWitness;
        try {
          await activeTarget.setTime(seconds, currentMode === "action-ready");
          const nextWitness = measureTargetPose(
            activeTarget,
            motionBaseline,
            currentMode,
            seconds,
            previousWitness,
          );
          assertMotionWitness(nextWitness);
          currentTime = seconds;
          motionWitness = nextWitness;
          applyCamera();
          applyLightShadowPolicy(currentTier);
          return true;
        } catch (error) {
          try {
            await activeTarget.setTime(previousTime, currentMode === "action-ready");
            currentTime = previousTime;
            motionWitness = previousWitness;
            applyCamera();
            applyLightShadowPolicy(currentTier);
          } catch (rollbackError) {
            throw new AggregateError([error, rollbackError], `Failed to set time ${seconds} and restore ${previousTime}`);
          }
          throw error;
        }
      });
    },
    async step(deltaSeconds) {
      return enqueueControllerOperation("step", async () => {
        requireLive();
        if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
          throw new RangeError("deltaSeconds must be finite and nonnegative");
        }
        controls.update();
        const previousTime = currentTime;
        const previousWitness = motionWitness;
        const nextTime = currentTime + deltaSeconds;
        try {
          await activeTarget.setTime(nextTime, currentMode === "action-ready");
          const nextWitness = measureTargetPose(
            activeTarget,
            motionBaseline,
            currentMode,
            nextTime,
            previousWitness,
          );
          assertMotionWitness(nextWitness);
          currentTime = nextTime;
          motionWitness = nextWitness;
          stepCount += 1;
        } catch (error) {
          try {
            await activeTarget.setTime(previousTime, currentMode === "action-ready");
            motionWitness = previousWitness;
          } catch (rollbackError) {
            throw new AggregateError([error, rollbackError], `Failed to step to ${nextTime} and restore ${previousTime}`);
          }
          throw error;
        }
      });
    },
    async resetHistory() {
      return enqueueControllerOperation("resetHistory", async () => {
        requireLive();
        const changed = currentTime !== 0;
        const previousTime = currentTime;
        const previousWitness = motionWitness;
        try {
          await activeTarget.setTime(0, currentMode === "action-ready");
          currentTime = 0;
          motionWitness = measureTargetPose(
            activeTarget,
            motionBaseline,
            currentMode,
            currentTime,
            emptyMotionWitness(currentMode, currentTime),
          );
          applyCamera();
          applyLightShadowPolicy(currentTier);
          return changed;
        } catch (error) {
          try {
            await activeTarget.setTime(previousTime, currentMode === "action-ready");
            currentTime = previousTime;
            motionWitness = previousWitness;
            applyCamera();
            applyLightShadowPolicy(currentTier);
          } catch (rollbackError) {
            throw new AggregateError([error, rollbackError], `Failed to reset history and restore ${previousTime}`);
          }
          throw error;
        }
      });
    },
    async resize(nextWidth, nextHeight, nextDpr = 1) {
      return enqueueControllerOperation("resize", async () => {
        requireLive();
        nextWidth = Math.floor(requirePositive(nextWidth, "resize width"));
        nextHeight = Math.floor(requirePositive(nextHeight, "resize height"));
        nextDpr = requirePositive(nextDpr, "resize DPR");
        if (nextWidth === width && nextHeight === height && nextDpr === requestedDpr) return false;
        width = nextWidth;
        height = nextHeight;
        requestedDpr = nextDpr;
        applyResolutionPolicy();
        applyCamera();
        return true;
      });
    },
    async renderOnce() {
      return enqueueControllerOperation("renderOnce", async () => {
        requireLive();
        renderSubmissions += 1;
        try {
          await renderer.render(scene, perspectiveCamera);
          completedFrames += 1;
          lastFrameError = null;
        } catch (error) {
          lastFrameError = error instanceof Error ? error.message : String(error);
          frameErrorCount += 1;
          throw error;
        }
      });
    },
    async capturePixels(target = "presentation") {
      return enqueueControllerOperation("capturePixels", async () => {
        requireLive();
        if (!new Set(["presentation", "output"]).has(target)) {
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
        const previous = renderer.getRenderTarget();
        renderSubmissions += 1;
        try {
          renderer.setRenderTarget(output);
          await renderer.render(scene, perspectiveCamera);
          completedFrames += 1;
          lastFrameError = null;
          const value = await renderer.readRenderTargetPixelsAsync(
            output,
            0,
            0,
            output.width,
            output.height,
          );
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
          const pixels = preserveCorpusReadbackRows(readback, layout);
          return {
            target,
            ...layout,
            sourceBytesPerRow: layout.bytesPerRow,
            sourceByteLength: pixels.byteLength,
            readbackSourceBytesPerRow,
            readbackSourceByteLength: readback.byteLength,
            origin: "bottom-left",
            backendKind: backendKind(renderer),
            nativeWebGPU: renderer.backend?.isWebGPUBackend === true,
            pixels: Array.from(pixels),
          };
        } catch (error) {
          lastFrameError = error instanceof Error ? error.message : String(error);
          frameErrorCount += 1;
          throw error;
        } finally {
          renderer.setRenderTarget(previous);
        }
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
        canonicalPhysicsProxyStatus: "blocked pending a route-owned PhysicsContext and pose publication",
        motionOwner: currentMode === "action-ready" ? "target procedural transform timeline" : "frozen authored pose",
        motionWitness,
        cameraFraming,
      };
    },
    getMetrics() {
      const physicsHandoffCount = activeTarget.runtime.colliders?.size ?? summary.colliders ?? 0;
      return {
        ...summary,
        subjectId: currentSubjectId,
        scenario: currentSubjectId,
        mode: currentMode,
        tier: currentTier,
        seed: currentSeed,
        camera: currentCamera,
        time: currentTime,
        dpr: appliedDpr,
        backend: backendKind(renderer),
        backendKind: backendKind(renderer),
        nativeWebGPU: renderer.backend?.isWebGPUBackend === true,
        rendererInfo: rendererRenderInfo(renderer),
        initialized,
        firstFrameCompleted: completedFrames > 0,
        stepCount,
        renderSubmissions,
        completedFrames,
        rebuildCount,
        rollbackRebuildCount,
        targetAllocations,
        targetDisposals,
        liveTargetCount,
        peakLiveTargetCount,
        physicsHandoffCount,
        physicsHandoffStatus: physicsHandoffCount > 0
          ? "blocked-authoring-inputs-only"
          : "no-collider-inputs",
        runtimeProfile,
        preInitCapabilities,
        timestampQueriesRequired,
        timestampQueriesRequested: timestampTrackingRequested,
        timingMethod,
        sustainedGpuTimingAvailable: false,
        performanceAcceptance: "insufficient-evidence",
        motionWitness,
        cameraFraming,
        lightShadowPolicy,
        pendingControllerOperations,
        acceptingControllerOperations,
        frameErrorCount,
        lifecycleErrorCount,
        lastFrameError,
        lastLifecycleError,
      };
    },
    describePipeline() {
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
        timestampQueriesRequired,
        timestampQueriesRequested: timestampTrackingRequested,
        timestampQueryCapability: preInitCapabilities,
        timingMethod,
        timingEvidenceStatus: timestampTrackingRequested
          ? "requested-awaiting-renderer-device-and-sustained-evidence"
          : "no-gpu-duration-claim",
      };
    },
    describeResources() {
      return {
        renderTargets: captureTarget ? [{
          id: "capture",
          format: "rgba8unorm",
          width: captureTarget.width,
          height: captureTarget.height,
          allocation: "lazy-capture-only",
        }] : [],
        activeTarget: {
          subjectId: currentSubjectId,
          nodes: activeTarget.runtime.nodes?.size ?? summary.nodes ?? null,
          meshes: activeTarget.runtime.meshes?.size ?? summary.meshes ?? null,
          sockets: activeTarget.runtime.sockets?.size ?? summary.sockets ?? null,
          colliderConstructionInputs: activeTarget.runtime.colliders?.size ?? summary.colliders ?? null,
          physicsMaterials: activeTarget.runtime.physicsMaterials?.size ?? summary.physicsMaterials ?? null,
          destructionGroups: activeTarget.runtime.destructionGroups?.size ?? summary.destructionGroups ?? null,
        },
        lifecycle: {
          liveTargetCount,
          peakLiveTargetCount,
          targetAllocations,
          targetDisposals,
          rollbackRebuildCount,
          pendingControllerOperations,
          acceptingControllerOperations,
        },
        cameraFraming,
        lightShadowPolicy,
        rendererCreationPolicy: {
          runtimeProfile,
          antialiasRequested: initialAntialiasRequested,
          timestampQueriesRequired,
          timestampQueriesRequested: timestampTrackingRequested,
          preInitCapabilities,
          timingMethod,
        },
        motionWitness,
        preservedInvariants: [
          "stable semantic IDs across visual tiers",
          "physics collider construction inputs independent of visual LOD",
          "one active target and one scene render per frame",
        ],
      };
    },
    async drain() {
      await controllerOperationTail;
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
        let firstError = null;
        try {
          await disposeTargetOnce(activeTarget);
        } catch (error) {
          firstError = error;
        }
        try {
          controls.dispose();
          floor.geometry.dispose();
          floor.material.dispose();
          captureTarget?.dispose();
          await renderer.dispose();
        } catch (error) {
          firstError ??= error;
        }
        if (firstError) throw firstError;
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
