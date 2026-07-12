import assert from "node:assert/strict";
import * as THREE from "three/webgpu";

import {
  acquireCorpusGpuDeviceBinding,
  assertCorpusGpuDeviceBindingLeaseMatchesRenderer,
  assertCorpusGpuDeviceBindingMatchesRenderer,
  createCorpusGpuDeviceBinding,
  describeCorpusGpuDeviceBinding,
  disposeCorpusGpuDeviceBinding,
  releaseCorpusGpuDeviceBindingLease,
  rendererDeviceFromCorpusGpuDeviceBinding,
} from "./gpu-device-binding.js";
import { createObjectSculptorCorpusController } from "./lab-controller.js";

function neverLostPromise() {
  return new Promise(() => {});
}

function createFakeDevice({
  label = "bound-test-device",
  features = ["timestamp-query", "shader-f16"],
  limits = {
    maxTextureDimension2D: 8192,
    maxStorageTexturesPerShaderStage: 8,
    secretDriverLimit: 999,
  },
} = {}) {
  let destroyCallCount = 0;
  const device = {
    label,
    features: new Set(features),
    limits,
    lost: neverLostPromise(),
    onuncapturederror: null,
    destroy() {
      destroyCallCount += 1;
    },
  };
  Object.defineProperty(device, "destroyCallCount", {
    get() {
      return destroyCallCount;
    },
  });
  return device;
}

function createFakeAdapter({
  device = createFakeDevice(),
  info = {
    vendor: "Fruit GPU Corp",
    architecture: "Orchard-4",
    device: "Fruit M4 Max",
    description: "Fruit M4 Max",
    subgroupMinSize: 4,
    subgroupMaxSize: 32,
    secretDriverString: "must-not-leak",
  },
  isFallbackAdapter = false,
  features = ["timestamp-query", "shader-f16", "future-unallowlisted-feature"],
  limits = {
    maxTextureDimension2D: 16384,
    maxStorageTexturesPerShaderStage: 8,
    secretDriverLimit: 1234,
  },
} = {}) {
  const requests = [];
  return {
    adapter: {
      info,
      isFallbackAdapter,
      features: new Set(features),
      limits,
      async requestDevice(descriptor) {
        requests.push(descriptor);
        return device;
      },
    },
    device,
    requests,
  };
}

async function createBindingFixture(adapterFixture = createFakeAdapter()) {
  const adapterRequests = [];
  const binding = await createCorpusGpuDeviceBinding({
    requestAdapter: async (options) => {
      adapterRequests.push(options);
      return adapterFixture.adapter;
    },
    powerPreference: "high-performance",
    requireTimestampQuery: true,
  });
  return { ...adapterFixture, adapterRequests, binding };
}

async function createCurrentRealmBindingFixture(adapterFixture = createFakeAdapter()) {
  const adapterRequests = [];
  const gpu = {
    async requestAdapter(options) {
      adapterRequests.push(options);
      return adapterFixture.adapter;
    },
  };
  const priorDescriptor = Object.getOwnPropertyDescriptor(globalThis.navigator, "gpu");
  Object.defineProperty(globalThis.navigator, "gpu", {
    configurable: true,
    value: gpu,
  });
  try {
    const binding = await createCorpusGpuDeviceBinding({
      powerPreference: "high-performance",
      requireTimestampQuery: true,
    });
    return { ...adapterFixture, adapterRequests, binding };
  } finally {
    if (priorDescriptor) {
      Object.defineProperty(globalThis.navigator, "gpu", priorDescriptor);
    } else {
      Reflect.deleteProperty(globalThis.navigator, "gpu");
    }
  }
}

const hardware = await createBindingFixture();
assert.deepEqual(hardware.adapterRequests, [{
  featureLevel: "compatibility",
  powerPreference: "high-performance",
}]);
assert.deepEqual(hardware.requests, [{
  label: "Object Sculptor corpus retained renderer device",
  requiredFeatures: ["shader-f16", "timestamp-query"],
  requiredLimits: {},
}]);
assert.equal(rendererDeviceFromCorpusGpuDeviceBinding(hardware.binding), hardware.device);
assert.equal(
  assertCorpusGpuDeviceBindingMatchesRenderer(hardware.binding, hardware.device).adapter.adapterClass,
  "hardware",
);

const hardwareEvidence = describeCorpusGpuDeviceBinding(hardware.binding);
assert.equal(hardwareEvidence.adapterRequest.authority, "dependency-injected-untrusted");
assert.equal(hardwareEvidence.adapter.adapterClass, "hardware");
assert.equal(hardwareEvidence.adapter.name, "Fruit M4 Max");
assert.equal(hardwareEvidence.adapter.nameSource, "adapter-info.description");
assert.equal(hardwareEvidence.adapter.info.secretDriverString, undefined);
assert.equal(hardwareEvidence.adapter.limits.secretDriverLimit, undefined);
assert.equal(hardwareEvidence.device.limits.secretDriverLimit, undefined);
assert.deepEqual(hardwareEvidence.adapter.features, ["shader-f16", "timestamp-query"]);
assert.equal(Object.isFrozen(hardware.binding), true);
assert.equal(Object.isFrozen(hardwareEvidence), true);
assert.equal(Object.isFrozen(hardwareEvidence.adapter.info), true);

const forgedBinding = { ...hardware.binding };
assert.throws(
  () => describeCorpusGpuDeviceBinding(forgedBinding),
  /was not created by createCorpusGpuDeviceBinding/,
);
assert.throws(
  () => assertCorpusGpuDeviceBindingMatchesRenderer(hardware.binding, createFakeDevice()),
  (error) => error?.code === "CORPUS_RETAINED_GPU_DEVICE_MISMATCH",
);

for (const [field, value] of [
  ["adapterClass", "hardware"],
  ["name", "Forged GPU"],
  ["adapterInfo", { description: "Forged GPU" }],
]) {
  await assert.rejects(
    createCorpusGpuDeviceBinding({
      requestAdapter: async () => hardware.adapter,
      [field]: value,
    }),
    new RegExp(`unsupported fields: ${field}`),
  );
}

await assert.rejects(
  createCorpusGpuDeviceBinding({
    requestAdapter: async () => hardware.adapter,
    requiredFeatures: ["forged-feature"],
  }),
  /not allowlisted/,
);
await assert.rejects(
  createCorpusGpuDeviceBinding({
    requestAdapter: async () => hardware.adapter,
    requiredFeatures: ["shader-f16", "shader-f16"],
  }),
  /contain duplicates/,
);

const swiftShader = await createBindingFixture(createFakeAdapter({
  info: {
    vendor: "Google",
    architecture: "SwiftShader",
    device: "SwiftShader Device (Subzero)",
    description: "SwiftShader",
  },
  isFallbackAdapter: false,
}));
assert.equal(describeCorpusGpuDeviceBinding(swiftShader.binding).adapter.adapterClass, "software");
const lavaPipe = await createBindingFixture(createFakeAdapter({
  info: {
    vendor: "Mesa",
    architecture: "CPU",
    device: "llvmpipe-compatible",
    description: "Lavapipe Vulkan software adapter",
  },
  isFallbackAdapter: false,
}));
assert.equal(describeCorpusGpuDeviceBinding(lavaPipe.binding).adapter.adapterClass, "software");

const unknown = await createBindingFixture(createFakeAdapter({
  info: {
    vendor: "Unknown Vendor",
    description: "Unnamed Graphics Adapter",
  },
  isFallbackAdapter: null,
}));
assert.equal(describeCorpusGpuDeviceBinding(unknown.binding).adapter.adapterClass, "unknown");

const trustedHardware = await createCurrentRealmBindingFixture();
assert.equal(
  describeCorpusGpuDeviceBinding(trustedHardware.binding).adapterRequest.authority,
  "navigator.gpu-current-realm",
);
const trustedUnknown = await createCurrentRealmBindingFixture(createFakeAdapter({
  info: {
    vendor: "Unknown Vendor",
    description: "Unnamed Graphics Adapter",
  },
  isFallbackAdapter: null,
}));

let resolveObservedLoss;
const observedLossDevice = createFakeDevice({ label: "direct-loss-observer-device" });
observedLossDevice.lost = new Promise((resolve) => {
  resolveObservedLoss = resolve;
});
const priorUncapturedErrorHandler = () => {};
observedLossDevice.onuncapturederror = priorUncapturedErrorHandler;
const observedLossBinding = await createBindingFixture(createFakeAdapter({
  device: observedLossDevice,
}));
let observedLossInfo = null;
const observedLossLease = acquireCorpusGpuDeviceBinding(observedLossBinding.binding, {
  owner: "direct-loss-test",
  onDeviceLost(info) {
    observedLossInfo = info;
  },
});
assert.equal(
  assertCorpusGpuDeviceBindingLeaseMatchesRenderer(
    observedLossLease,
    observedLossDevice,
  ).lifecycle.activeLease,
  true,
);
observedLossDevice.onuncapturederror = () => {};
resolveObservedLoss({ reason: "unknown", message: "synthetic direct loss" });
await Promise.resolve();
await Promise.resolve();
assert.deepEqual(observedLossInfo, {
  reason: "unknown",
  message: "synthetic direct loss",
});
assert.equal(
  describeCorpusGpuDeviceBinding(observedLossBinding.binding).lifecycle.lossStatus,
  "resolved",
);
assert.equal(releaseCorpusGpuDeviceBindingLease(observedLossLease), true);
assert.equal(observedLossDevice.onuncapturederror, priorUncapturedErrorHandler);
assert.equal(disposeCorpusGpuDeviceBinding(observedLossBinding.binding), true);
assert.equal(observedLossDevice.destroyCallCount, 1);

let resolveControllerDeviceLoss;
const controllerLossDevice = createFakeDevice({ label: "controller-direct-loss-device" });
controllerLossDevice.lost = new Promise((resolve) => {
  resolveControllerDeviceLoss = resolve;
});
const controllerLossBinding = await createCurrentRealmBindingFixture(createFakeAdapter({
  device: controllerLossDevice,
}));

function createTarget(subjectId) {
  const root = new THREE.Group();
  root.name = `${subjectId}-root`;
  const geometry = new THREE.BoxGeometry(0.4, 0.6, 0.3);
  const material = new THREE.MeshBasicMaterial({ color: 0x778899 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "body";
  mesh.userData.sculptId = "body";
  mesh.castShadow = true;
  root.add(mesh);
  const runtime = {
    root,
    subjectId,
    instanceId: "active-preview",
    instanceGeneration: 1,
    runtimeId: { subjectId, instanceId: "active-preview", generation: 1 },
    mode: "final",
    seed: 1,
    nodes: new Map([["body", mesh]]),
    meshes: new Map([["body", mesh]]),
    sockets: new Map(),
    colliders: new Map(),
    physicsMaterials: new Map(),
    destructionGroups: new Map(),
  };
  return {
    root,
    runtime,
    contract: {
      id: subjectId,
      protectedNodeIds: ["body"],
      protectedSocketIds: [],
      protectedColliderIds: [],
      protectedDestructionGroupIds: [],
    },
    async setMode(mode) {
      runtime.mode = mode;
    },
    async setTime() {},
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

function controllerHarness({
  ignoreBoundDevice = false,
  rendererDisposeThrows = false,
} = {}) {
  const rendererOptions = [];
  let rendererDisposals = 0;
  let capabilityProbeCount = 0;
  const mismatchedDevice = createFakeDevice({ label: "mismatched-device" });
  const dependencies = {
    createRenderer(options) {
      rendererOptions.push(options);
      let pixelRatio = 1;
      const domElement = { width: 1, height: 1 };
      return {
        backend: {
          isWebGPUBackend: true,
          trackTimestamp: options.trackTimestamp === true,
          device: ignoreBoundDevice ? mismatchedDevice : options.device,
        },
        domElement,
        info: {
          render: { calls: 0, triangles: 0, points: 0, lines: 0 },
          memory: { geometries: 0, textures: 0 },
        },
        shadowMap: { enabled: false, type: null },
        samples: 0,
        async init() {},
        async render() {},
        setPixelRatio(value) {
          pixelRatio = value;
        },
        getPixelRatio() {
          return pixelRatio;
        },
        setSize(width, height) {
          domElement.width = Math.round(width * pixelRatio);
          domElement.height = Math.round(height * pixelRatio);
        },
        dispose() {
          rendererDisposals += 1;
          if (rendererDisposeThrows) {
            throw new Error("synthetic renderer disposal failure");
          }
        },
      };
    },
    createControls() {
      return {
        target: new THREE.Vector3(),
        enableDamping: false,
        dampingFactor: 0,
        maxPolarAngle: Math.PI,
        minDistance: 0,
        maxDistance: Infinity,
        enabled: false,
        update() {},
        dispose() {},
      };
    },
    createTarget,
    getTargetDefinition(subjectId) {
      return {
        id: subjectId,
        cameraTarget: [0, 0.3, 0],
        boundsMeters: { width: 0.4, height: 0.6, depth: 0.3 },
        contract: { id: subjectId },
      };
    },
    summarizeTarget(targetRoot) {
      let meshes = 0;
      targetRoot.traverse((object) => {
        if (object.isMesh) meshes += 1;
      });
      return {
        nodes: targetRoot.children.length,
        meshes,
        triangles: 12,
        sockets: 0,
        colliders: 0,
        physicsMaterials: 0,
        destructionGroups: 0,
      };
    },
    async resolvePreInitCapabilities() {
      capabilityProbeCount += 1;
      return {
        source: "test-preflight",
        adapterAvailable: true,
        timestampQuerySupported: true,
      };
    },
    now: () => 1,
  };
  return {
    dependencies,
    rendererOptions,
    get rendererDisposals() {
      return rendererDisposals;
    },
    get capabilityProbeCount() {
      return capabilityProbeCount;
    },
  };
}

const exactHarness = controllerHarness();
const controller = await createObjectSculptorCorpusController({
  canvas: {},
  width: 640,
  height: 400,
  dpr: 1,
  subjectId: "potted-bonsai",
  mode: "final",
  tier: "budgeted",
  camera: "design",
  runtimeProfile: "performance",
  timestampQueriesRequired: true,
  gpuDeviceBinding: trustedHardware.binding,
  dependencies: exactHarness.dependencies,
});
assert.equal(exactHarness.capabilityProbeCount, 0, "retained binding must replace unrelated preflight adapter probing");
assert.equal(exactHarness.rendererOptions.length, 1);
assert.equal(exactHarness.rendererOptions[0].device, trustedHardware.device);
const metrics = controller.getMetrics();
assert.equal(metrics.performanceAdapterIdentityStatus, "verified-exact-renderer-device-binding");
assert.equal(metrics.performanceAdapterIdentity.adapterClass, "hardware");
assert.equal(metrics.performanceAdapterIdentity.name, "Fruit M4 Max");
assert.equal(
  metrics.rendererBackendEvidence.adapterDeviceIdentityVerified,
  true,
);
assert.equal(
  metrics.rendererBackendEvidence.retainedAdapterDeviceBinding.adapter.info.secretDriverString,
  undefined,
);

const concurrentHarness = controllerHarness();
await assert.rejects(
  createObjectSculptorCorpusController({
    canvas: {},
    width: 320,
    height: 200,
    dpr: 1,
    subjectId: "potted-bonsai",
    mode: "final",
    tier: "minimum",
    camera: "design",
    runtimeProfile: "performance",
    timestampQueriesRequired: true,
    gpuDeviceBinding: trustedHardware.binding,
    dependencies: concurrentHarness.dependencies,
  }),
  /already has an active controller lease/,
);
await controller.dispose();
assert.equal(
  trustedHardware.device.destroyCallCount,
  0,
  "controller disposal must release but not destroy the caller-owned GPUDevice",
);

const sequentialHarness = controllerHarness();
const sequentialController = await createObjectSculptorCorpusController({
  canvas: {},
  width: 320,
  height: 200,
  dpr: 1,
  subjectId: "potted-bonsai",
  mode: "final",
  tier: "minimum",
  camera: "design",
  runtimeProfile: "performance",
  timestampQueriesRequired: true,
  gpuDeviceBinding: trustedHardware.binding,
  dependencies: sequentialHarness.dependencies,
});
assert.equal(
  sequentialController.getMetrics().performanceAdapterIdentityStatus,
  "verified-exact-renderer-device-binding",
);
await sequentialController.dispose();

const controllerLossHarness = controllerHarness();
const lossAwareController = await createObjectSculptorCorpusController({
  canvas: {},
  width: 320,
  height: 200,
  dpr: 1,
  subjectId: "potted-bonsai",
  mode: "final",
  tier: "minimum",
  camera: "design",
  runtimeProfile: "performance",
  timestampQueriesRequired: true,
  gpuDeviceBinding: controllerLossBinding.binding,
  dependencies: controllerLossHarness.dependencies,
});
resolveControllerDeviceLoss({ reason: "unknown", message: "controller device lost" });
await Promise.resolve();
await Promise.resolve();
assert.equal(lossAwareController.getMetrics().rendererDeviceStatus, "lost");
assert.equal(lossAwareController.getMetrics().deviceLossGeneration, 1);
await assert.rejects(lossAwareController.renderOnce(), /stopped after WebGPU device loss/);
await lossAwareController.dispose();
assert.equal(disposeCorpusGpuDeviceBinding(controllerLossBinding.binding), true);
assert.equal(controllerLossDevice.destroyCallCount, 1);

const unknownIdentityHarness = controllerHarness();
const unknownIdentityController = await createObjectSculptorCorpusController({
  canvas: {},
  width: 320,
  height: 200,
  dpr: 1,
  subjectId: "potted-bonsai",
  mode: "final",
  tier: "minimum",
  camera: "design",
  runtimeProfile: "performance",
  timestampQueriesRequired: true,
  gpuDeviceBinding: trustedUnknown.binding,
  dependencies: unknownIdentityHarness.dependencies,
});
assert.equal(
  unknownIdentityController.getMetrics().performanceAdapterIdentityStatus,
  "insufficient-adapter-class-unresolved",
);
assert.equal(unknownIdentityController.getMetrics().performanceAdapterIdentity, null);
await unknownIdentityController.dispose();

const untrustedIdentityHarness = controllerHarness();
const untrustedIdentityController = await createObjectSculptorCorpusController({
  canvas: {},
  width: 320,
  height: 200,
  dpr: 1,
  subjectId: "potted-bonsai",
  mode: "final",
  tier: "minimum",
  camera: "design",
  runtimeProfile: "performance",
  timestampQueriesRequired: true,
  gpuDeviceBinding: hardware.binding,
  dependencies: untrustedIdentityHarness.dependencies,
});
assert.equal(
  untrustedIdentityController.getMetrics().performanceAdapterIdentityStatus,
  "insufficient-untrusted-adapter-request-source",
);
assert.equal(untrustedIdentityController.getMetrics().performanceAdapterIdentity, null);
await untrustedIdentityController.dispose();

const mismatchHarness = controllerHarness({ ignoreBoundDevice: true });
await assert.rejects(
  createObjectSculptorCorpusController({
    canvas: {},
    width: 640,
    height: 400,
    dpr: 1,
    subjectId: "potted-bonsai",
    mode: "final",
    tier: "budgeted",
    camera: "design",
    runtimeProfile: "performance",
    timestampQueriesRequired: true,
    gpuDeviceBinding: trustedHardware.binding,
    dependencies: mismatchHarness.dependencies,
  }),
  (error) => error?.code === "CORPUS_RETAINED_GPU_DEVICE_MISMATCH",
);
assert.equal(mismatchHarness.rendererOptions[0].device, trustedHardware.device);
assert.equal(mismatchHarness.rendererDisposals, 1, "device mismatch must close the rejected renderer");

const failedInitCleanupBinding = await createCurrentRealmBindingFixture();
const failedInitCleanupHarness = controllerHarness({
  ignoreBoundDevice: true,
  rendererDisposeThrows: true,
});
await assert.rejects(
  createObjectSculptorCorpusController({
    canvas: {},
    width: 320,
    height: 200,
    dpr: 1,
    subjectId: "potted-bonsai",
    mode: "final",
    tier: "minimum",
    camera: "design",
    runtimeProfile: "performance",
    timestampQueriesRequired: true,
    gpuDeviceBinding: failedInitCleanupBinding.binding,
    dependencies: failedInitCleanupHarness.dependencies,
  }),
  (error) => error instanceof AggregateError
    && error.errors.some((entry) => /synthetic renderer disposal failure/.test(entry.message)),
);
const failedInitLifecycle = describeCorpusGpuDeviceBinding(
  failedInitCleanupBinding.binding,
).lifecycle;
assert.equal(failedInitLifecycle.activeLease, false);
assert.equal(failedInitLifecycle.reuseStatus, "tainted-uncertain-teardown");
assert.throws(
  () => acquireCorpusGpuDeviceBinding(failedInitCleanupBinding.binding),
  /is not reusable/,
);
assert.equal(disposeCorpusGpuDeviceBinding(failedInitCleanupBinding.binding), true);
assert.equal(failedInitCleanupBinding.device.destroyCallCount, 1);

const failedDisposeBinding = await createCurrentRealmBindingFixture();
const failedDisposeHarness = controllerHarness({ rendererDisposeThrows: true });
const failedDisposeController = await createObjectSculptorCorpusController({
  canvas: {},
  width: 320,
  height: 200,
  dpr: 1,
  subjectId: "potted-bonsai",
  mode: "final",
  tier: "minimum",
  camera: "design",
  runtimeProfile: "performance",
  timestampQueriesRequired: true,
  gpuDeviceBinding: failedDisposeBinding.binding,
  dependencies: failedDisposeHarness.dependencies,
});
await assert.rejects(
  failedDisposeController.dispose(),
  (error) => error instanceof AggregateError
    && error.errors.some((entry) => /synthetic renderer disposal failure/.test(entry.message)),
);
const failedDisposeLifecycle = describeCorpusGpuDeviceBinding(failedDisposeBinding.binding).lifecycle;
assert.equal(failedDisposeLifecycle.activeLease, false);
assert.equal(failedDisposeLifecycle.reuseStatus, "tainted-uncertain-teardown");
assert.equal(disposeCorpusGpuDeviceBinding(failedDisposeBinding.binding), true);
assert.equal(failedDisposeBinding.device.destroyCallCount, 1);

const correctnessHarness = controllerHarness();
correctnessHarness.dependencies.createRenderer = (options) => {
  const renderer = controllerHarness().dependencies.createRenderer({
    ...options,
    device: createFakeDevice({ label: "renderer-managed-correctness-device", features: [] }),
  });
  return renderer;
};
const correctnessController = await createObjectSculptorCorpusController({
  canvas: {},
  width: 320,
  height: 200,
  dpr: 1,
  subjectId: "potted-bonsai",
  mode: "final",
  tier: "minimum",
  camera: "design",
  dependencies: correctnessHarness.dependencies,
});
assert.equal(
  correctnessController.getMetrics().performanceAdapterIdentityStatus,
  "not-claimed-correctness-profile",
);
assert.equal(correctnessController.getMetrics().performanceAdapterIdentity, null);
assert.equal(correctnessHarness.capabilityProbeCount, 1);
await correctnessController.dispose();

const unboundPerformanceHarness = controllerHarness();
const unboundPerformanceRendererHarness = controllerHarness();
const unboundPerformanceDevice = createFakeDevice({
  label: "renderer-managed-unbound-performance-device",
  features: [],
});
unboundPerformanceHarness.dependencies.createRenderer = (options) => (
  unboundPerformanceRendererHarness.dependencies.createRenderer({
    ...options,
    device: unboundPerformanceDevice,
  })
);
const unboundPerformanceController = await createObjectSculptorCorpusController({
  canvas: {},
  width: 320,
  height: 200,
  dpr: 1,
  subjectId: "potted-bonsai",
  mode: "final",
  tier: "minimum",
  camera: "design",
  runtimeProfile: "performance",
  performanceTimestampMode: "disabled-for-cadence",
  dependencies: unboundPerformanceHarness.dependencies,
});
assert.equal(
  unboundPerformanceController.getMetrics().performanceAdapterIdentityStatus,
  "insufficient-no-retained-adapter-device-binding",
);
assert.equal(unboundPerformanceController.getMetrics().performanceAdapterIdentity, null);
await unboundPerformanceController.dispose();

for (const fixture of [
  trustedHardware,
  trustedUnknown,
  hardware,
  swiftShader,
  lavaPipe,
  unknown,
]) {
  assert.equal(disposeCorpusGpuDeviceBinding(fixture.binding), true);
  assert.equal(fixture.device.destroyCallCount, 1);
  assert.equal(disposeCorpusGpuDeviceBinding(fixture.binding), false);
  assert.equal(fixture.device.destroyCallCount, 1);
}

console.log(JSON.stringify({
  ok: true,
  hardwareAdapter: hardwareEvidence.adapter.name,
  softwareAdapter: describeCorpusGpuDeviceBinding(swiftShader.binding).adapter.name,
  forgedIdentityFieldsRejected: 3,
  rendererDeviceMismatchRejected: true,
  correctnessProfilePreserved: true,
  unboundPerformanceIdentityRejected: true,
  injectedPerformanceIdentityRejected: true,
  directDeviceLossObserved: true,
  exclusiveLeaseVerified: true,
  bindingDestroyedExactlyOnce: true,
}, null, 2));
