import assert from "node:assert/strict";
import * as THREE from "three/webgpu";

import {
  CORPUS_CAMERA_FOCUS_CONTRACTS,
  CORPUS_DIAGNOSTIC_RETENTION_LIMITS,
  CORPUS_DPR_CAPS,
  CORPUS_CONTINUITY_TOKEN,
  CORPUS_RENDER_POLICY,
  CORPUS_RUNTIME_PROFILES,
  CORPUS_PERFORMANCE_TIMESTAMP_MODES,
  CORPUS_SHADOW_POLICIES,
  TARGET_IDS,
  createObjectSculptorCorpusController,
  describeCorpusReadback,
  preserveCorpusReadbackRows,
  resolveCorpusDpr,
  resolveCorpusProjectedBoundsFit,
} from "./lab-controller.js";

assert.deepEqual(CORPUS_DPR_CAPS, { full: 1.5, budgeted: 1.25, minimum: 1 });
assert.equal(CORPUS_CONTINUITY_TOKEN, "active-preview-continuity-v1");
assert.equal(resolveCorpusDpr("full", 3), 1.5);
assert.equal(resolveCorpusDpr("budgeted", 3), 1.25);
assert.equal(resolveCorpusDpr("minimum", 3), 1);
assert.equal(CORPUS_RENDER_POLICY.sceneRendersPerFrame, 1);
assert.equal(CORPUS_RENDER_POLICY.mrt, false);
assert.equal(CORPUS_RENDER_POLICY.postprocessing, false);
assert.equal(CORPUS_RENDER_POLICY.trackTimestamp, false);
assert.deepEqual(CORPUS_RUNTIME_PROFILES, ["correctness", "performance"]);
assert.deepEqual(CORPUS_PERFORMANCE_TIMESTAMP_MODES, ["auto", "disabled-for-cadence"]);
assert.deepEqual(CORPUS_DIAGNOSTIC_RETENTION_LIMITS, {
  cpuRenderSubmissions: 256,
  gpuTimestampSamples: 128,
  gpuTimestampFailures: 128,
  deviceErrors: 32,
  resourceTransitions: 128,
  stateMutations: 64,
  teardownRecords: 64,
  closedResourceIntervals: 128,
});
assert.equal(CORPUS_SHADOW_POLICIES.minimum.mapSize, 256);
assert.equal(CORPUS_SHADOW_POLICIES.minimum.casterLimit, 8);
assert.deepEqual(
  CORPUS_CAMERA_FOCUS_CONTRACTS["ceramic-teapot"].attachment.nodeIds,
  ["spout-root-collar", "lid-joint-pin"],
);

const landscapeFit = resolveCorpusProjectedBoundsFit({
  fovDegrees: 38,
  aspect: 16 / 9,
  direction: [1, 0.6, 1],
  halfExtents: [1, 0.5, 0.4],
});
const portraitFit = resolveCorpusProjectedBoundsFit({
  fovDegrees: 38,
  aspect: 9 / 16,
  direction: [1, 0.6, 1],
  halfExtents: [1, 0.5, 0.4],
});
assert(portraitFit.horizontalHalfFovRadians < portraitFit.verticalHalfFovRadians);
assert.equal(portraitFit.limitingHalfFovRadians, portraitFit.horizontalHalfFovRadians);
assert(portraitFit.distance > landscapeFit.distance, "portrait fitting must retreat for the limiting horizontal FOV");

const oddLayout = describeCorpusReadback(13, 7, "srgb");
assert.deepEqual(oddLayout, {
  width: 13,
  height: 7,
  format: "rgba8unorm",
  bytesPerPixel: 4,
  rowBytes: 52,
  bytesPerRow: 256,
  minimumByteLength: 1588,
  fullyPaddedByteLength: 1792,
  colorManaged: true,
  colorEncoding: "srgb",
  outputColorSpace: "srgb",
});
const compactRows = new Uint8Array(oddLayout.rowBytes * oddLayout.height);
for (let index = 0; index < compactRows.length; index += 1) compactRows[index] = index % 251;
const paddedRows = preserveCorpusReadbackRows(compactRows, oddLayout);
assert.equal(paddedRows.byteLength, oddLayout.fullyPaddedByteLength);
assert.notEqual(paddedRows, compactRows, "normalized readback must always own fresh storage");
for (let y = 0; y < oddLayout.height; y += 1) {
  assert.deepEqual(
    paddedRows.slice(y * oddLayout.bytesPerRow, y * oddLayout.bytesPerRow + oddLayout.rowBytes),
    compactRows.slice(y * oddLayout.rowBytes, (y + 1) * oddLayout.rowBytes),
  );
  assert(
    paddedRows
      .slice(y * oddLayout.bytesPerRow + oddLayout.rowBytes, (y + 1) * oddLayout.bytesPerRow)
      .every((value) => value === 0),
    "CPU-normalized row padding must be zero-filled",
  );
}

const offsetBacking = new Uint8Array(oddLayout.fullyPaddedByteLength + 19);
offsetBacking.fill(0xa5);
const offsetPaddedView = new Uint8Array(
  offsetBacking.buffer,
  11,
  oddLayout.fullyPaddedByteLength,
);
for (let y = 0; y < oddLayout.height; y += 1) {
  offsetPaddedView.fill(
    0x20 + y,
    y * oddLayout.bytesPerRow,
    y * oddLayout.bytesPerRow + oddLayout.rowBytes,
  );
}
const normalizedOffsetRows = preserveCorpusReadbackRows(offsetPaddedView, oddLayout);
assert.notEqual(normalizedOffsetRows.buffer, offsetBacking.buffer);
for (let y = 0; y < oddLayout.height; y += 1) {
  assert(normalizedOffsetRows
    .slice(y * oddLayout.bytesPerRow, y * oddLayout.bytesPerRow + oddLayout.rowBytes)
    .every((value) => value === 0x20 + y));
  assert(normalizedOffsetRows
    .slice(y * oddLayout.bytesPerRow + oddLayout.rowBytes, (y + 1) * oddLayout.bytesPerRow)
    .every((value) => value === 0));
}

function createHarness({
  nativeWebGPU = true,
  timestampQuerySupported = false,
  actualTimestampQuerySupported = timestampQuerySupported,
  noOpMotion = false,
  fixedOffsetMotion = false,
  clampControlsDistance = false,
  gpuTimestampMs = 2.5,
  shadowCasterCount = 1,
  readbackLayout = "compact",
  readbackByteOffset = 0,
} = {}) {
  if (!new Set(["compact", "minimum-padded", "fully-padded"]).has(readbackLayout)) {
    throw new RangeError(`Unknown synthetic readback layout "${readbackLayout}"`);
  }
  if (!Number.isInteger(readbackByteOffset) || readbackByteOffset < 0) {
    throw new RangeError("synthetic readback byte offset must be a nonnegative integer");
  }
  const definitions = new Map([
    ["articulated-desk-lamp", {
      id: "articulated-desk-lamp",
      cameraTarget: [0, 0.4, 0],
      boundsMeters: { width: 0.8, height: 1.1, depth: 0.7 },
      contract: { id: "articulated-desk-lamp" },
    }],
    ["potted-bonsai", {
      id: "potted-bonsai",
      cameraTarget: [0, 1.1, 0],
      boundsMeters: { width: 2.1, height: 2.3, depth: 1.6 },
      contract: { id: "potted-bonsai" },
    }],
    ["ceramic-teapot", {
      id: "ceramic-teapot",
      cameraTarget: [0.02, 0.04, 0],
      boundsMeters: { width: 0.7, height: 0.4, depth: 0.4 },
      contract: { id: "ceramic-teapot" },
    }],
  ]);
  const factoryCalls = [];
  const targetDisposals = new Map();
  const targets = [];
  const continuityHistory = new Map();
  let targetLiveCount = 0;
  let peakTargetLiveCount = 0;
  let controlsDisposals = 0;
  let failConfigurationFor = null;
  let configurationFailuresRemaining = 0;
  let rendererOptions = null;
  let controls = null;
  let controlsUpdateFailuresRemaining = 0;
  let controlsDisposeFailuresRemaining = 0;
  let rendererDisposeFailuresRemaining = 0;
  let rendererSetSizeFailuresRemaining = 0;
  let rendererSetPixelRatioFailuresRemaining = 0;
  let rendererRestoreTargetFailuresRemaining = 0;
  let rendererRestoreTargetNoOpRemaining = 0;
  let expectedRendererRestoreTarget = null;
  let readbackFailuresRemaining = 0;
  let deviceLossDuringRenderRemaining = 0;
  let deviceLossDuringTargetTimeRemaining = 0;
  let targetDisposeFailureSubject = null;
  let targetDisposeFailuresRemaining = 0;
  let shadowPreparationFailureSubject = null;
  let shadowPreparationFailuresRemaining = 0;
  let summaryFailureSubject = null;
  let summaryFailuresRemaining = 0;
  let timestampResolveFailuresRemaining = 0;
  let malformedTargetSubject = null;
  let malformedTargetsRemaining = 0;
  let malformedTargetDisposalMode = "succeeds";
  let renderResourceInspectionFailureSubject = null;
  let renderResourceInspectionFailuresRemaining = 0;
  const controlsUpdateBehaviors = [];
  const targetModeBehaviors = [];
  let deferredTargetCreation = null;
  let deferredReadback = null;
  let deferredTimestampResolve = null;
  let pendingShadowMap = null;
  const timestampDurations = [gpuTimestampMs];
  const timestampScopes = [];
  let syntheticNowMs = 0;
  const targetDisposeAttempts = new Map();

  function createDeferredGate() {
    let markEntered;
    let release;
    const entered = new Promise((resolve) => {
      markEntered = resolve;
    });
    const wait = new Promise((resolve) => {
      release = resolve;
    });
    return { entered, wait, markEntered, release };
  }

  class WebGPUTimestampQueryPool {
    constructor(device) {
      this.device = device;
      this.trackTimestamp = true;
      this.maxQueries = 2048;
      this.currentQueryIndex = 0;
      this.queryOffsets = new Map();
      this.isDisposed = false;
      this.lastValue = 0;
      this.frames = [];
      this.pendingResolve = false;
      this.timestamps = new Map();
      this.querySet = {};
      this.resultBuffer = { mapState: "unmapped" };
    }

    getTimestampFrames() {
      return this.frames;
    }

    allocate(uid) {
      this.queryOffsets.set(uid, this.currentQueryIndex);
      this.currentQueryIndex += 2;
    }

    resolve(duration, { stale = false } = {}) {
      const currentIds = [...this.queryOffsets.keys()];
      this.currentQueryIndex = 0;
      this.queryOffsets.clear();
      if (stale) return this.lastValue;
      const perContext = duration / currentIds.length;
      for (const uid of currentIds) this.timestamps.set(uid, perContext);
      this.frames = [...new Set(currentIds.map(
        (uid) => Number.parseInt(uid.match(/:f(\d+)$/)[1], 10),
      ))];
      this.lastValue = duration;
      return duration;
    }
  }

  function createSyntheticDevice(label = "synthetic-corpus-device") {
    return {
      label,
      features: {
        has(name) {
          return name === "timestamp-query" && actualTimestampQuerySupported;
        },
      },
      lost: new Promise(() => {}),
    };
  }

  const device = createSyntheticDevice();

  function continuityRecord(subjectId, options) {
    const registryKey = JSON.stringify([subjectId, options.instanceId]);
    const effectiveToken = JSON.stringify({
      schema: "fake-subject-continuity-v1",
      baseToken: options.continuityToken,
      subjectId,
      sourceRevision: `${subjectId}-source-v1`,
      seed: options.seed,
    });
    const previous = continuityHistory.get(registryKey);
    const preserved = previous?.effectiveToken === effectiveToken;
    const generation = previous ? (preserved ? previous.generation : previous.generation + 1) : 1;
    const status = previous
      ? (preserved ? "explicit-continuity-preserved" : "explicit-continuity-changed-new-generation")
      : "explicit-instance-established";
    continuityHistory.set(registryKey, { effectiveToken, generation });
    return {
      generation,
      status,
      effectiveToken,
      previousGeneration: previous?.generation ?? null,
    };
  }

  const renderer = {
    backend: {
      isWebGPUBackend: nativeWebGPU,
      device,
      trackTimestamp: false,
      timestampQueryPool: { render: null, compute: null },
    },
    shadowMap: {},
    domElement: { width: 1, height: 1 },
    info: {
      render: { calls: 0, triangles: 0, points: 0, lines: 0 },
      memory: { geometries: 0, textures: 0 },
    },
    pixelRatio: 1,
    currentRenderTarget: null,
    initCalls: 0,
    renderCalls: 0,
    disposeCalls: 0,
    failRender: false,
    samples: 0,
    _isDeviceLost: false,
    onDeviceLost(info) {
      this._isDeviceLost = true;
      this.lastSyntheticDeviceLoss = info;
    },
    onError(info) {
      this.lastSyntheticGpuError = info;
    },
    async init() {
      this.initCalls += 1;
      this.backend.trackTimestamp = rendererOptions?.trackTimestamp === true
        && this.backend.device.features.has("timestamp-query");
      if (this.backend.trackTimestamp) {
        this.backend.timestampQueryPool.render = new WebGPUTimestampQueryPool(this.backend.device);
      }
      this.samples = rendererOptions?.antialias === true ? 4 : 0;
    },
    setPixelRatio(value) {
      if (rendererSetPixelRatioFailuresRemaining > 0) {
        rendererSetPixelRatioFailuresRemaining -= 1;
        throw new Error("synthetic renderer setPixelRatio failure");
      }
      this.pixelRatio = value;
    },
    setSize(width, height) {
      if (rendererSetSizeFailuresRemaining > 0) {
        rendererSetSizeFailuresRemaining -= 1;
        throw new Error("synthetic renderer setSize failure");
      }
      this.domElement.width = Math.floor(width * this.pixelRatio);
      this.domElement.height = Math.floor(height * this.pixelRatio);
    },
    async render(scene) {
      if (this.failRender) throw new Error("synthetic native render failure");
      this.renderCalls += 1;
      this.info.render.calls = this.renderCalls;
      this.backend.timestampQueryPool.render?.allocate?.(`r:${this.renderCalls}:1:f0`);
      if (pendingShadowMap) {
        const shadowLight = scene.children.find(
          (object) => object?.isDirectionalLight && object.castShadow === true,
        );
        if (!shadowLight) throw new Error("synthetic shadow light was not found");
        shadowLight.shadow.map = pendingShadowMap;
        pendingShadowMap = null;
      }
      if (deviceLossDuringRenderRemaining > 0) {
        deviceLossDuringRenderRemaining -= 1;
        this.onDeviceLost({
          api: "WebGPU",
          reason: "synthetic-render-race",
          message: "synthetic device loss during render",
        });
      }
    },
    async resolveTimestampsAsync(scope) {
      timestampScopes.push(scope);
      if (deferredTimestampResolve) {
        const gate = deferredTimestampResolve;
        deferredTimestampResolve = null;
        gate.markEntered();
        await gate.wait;
      }
      if (timestampResolveFailuresRemaining > 0) {
        timestampResolveFailuresRemaining -= 1;
        return this.backend.timestampQueryPool.render.resolve(
          this.backend.timestampQueryPool.render.lastValue,
          { stale: true },
        );
      }
      const duration = timestampDurations.length > 0 ? timestampDurations.shift() : gpuTimestampMs;
      return this.backend.timestampQueryPool.render.resolve(duration);
    },
    getRenderTarget() {
      return this.currentRenderTarget;
    },
    setRenderTarget(value) {
      if (
        rendererRestoreTargetFailuresRemaining > 0
        && value === expectedRendererRestoreTarget
        && this.currentRenderTarget !== null
      ) {
        rendererRestoreTargetFailuresRemaining -= 1;
        throw new Error("synthetic render-target restoration failure");
      }
      if (
        rendererRestoreTargetNoOpRemaining > 0
        && value === expectedRendererRestoreTarget
        && this.currentRenderTarget !== value
      ) {
        rendererRestoreTargetNoOpRemaining -= 1;
        return;
      }
      this.currentRenderTarget = value;
    },
    async readRenderTargetPixelsAsync(target) {
      if (deferredReadback) {
        const gate = deferredReadback;
        deferredReadback = null;
        gate.markEntered();
        await gate.wait;
      }
      if (readbackFailuresRemaining > 0) {
        readbackFailuresRemaining -= 1;
        throw new Error("synthetic native readback failure");
      }
      const rowBytes = target.width * 4;
      const bytesPerRow = Math.ceil(rowBytes / 256) * 256;
      const byteLength = readbackLayout === "compact"
        ? rowBytes * target.height
        : readbackLayout === "minimum-padded"
          ? (target.height - 1) * bytesPerRow + rowBytes
          : bytesPerRow * target.height;
      const backing = new Uint8Array(byteLength + readbackByteOffset + 7);
      backing.fill(0xa5);
      const pixels = new Uint8Array(backing.buffer, readbackByteOffset, byteLength);
      const sourceStride = readbackLayout === "compact" ? rowBytes : bytesPerRow;
      for (let y = 0; y < target.height; y += 1) {
        pixels.fill(0x20 + y, y * sourceStride, y * sourceStride + rowBytes);
      }
      return pixels;
    },
    async dispose() {
      this.disposeCalls += 1;
      if (rendererDisposeFailuresRemaining > 0) {
        rendererDisposeFailuresRemaining -= 1;
        throw new Error("synthetic renderer disposal failure");
      }
    },
  };

  function createTarget(subjectId, options, resumedDeferredCreation = false) {
    if (!resumedDeferredCreation) factoryCalls.push({ subjectId, options: { ...options } });
    if (!resumedDeferredCreation && deferredTargetCreation?.subjectId === subjectId) {
      const gate = deferredTargetCreation.gate;
      deferredTargetCreation = null;
      gate.markEntered();
      return gate.wait.then(() => createTarget(subjectId, options, true));
    }
    if (malformedTargetSubject === subjectId && malformedTargetsRemaining > 0) {
      malformedTargetsRemaining -= 1;
      targetLiveCount += 1;
      peakTargetLiveCount = Math.max(peakTargetLiveCount, targetLiveCount);
      const malformed = {
        root: new THREE.Group(),
        runtime: null,
      };
      if (malformedTargetDisposalMode !== "missing") {
        malformed.dispose = async () => {
          const attempts = targetDisposeAttempts.get(malformed) ?? 0;
          assert.equal(attempts, 0, "malformed target teardown may be attempted only once");
          targetDisposeAttempts.set(malformed, attempts + 1);
          if (malformedTargetDisposalMode === "fails") {
            throw new Error(`synthetic ${subjectId} malformed target disposal failure`);
          }
          targetDisposals.set(malformed, 1);
          targetLiveCount -= 1;
        };
      }
      return malformed;
    }
    const continuity = continuityRecord(subjectId, options);
    targetLiveCount += 1;
    peakTargetLiveCount = Math.max(peakTargetLiveCount, targetLiveCount);
    const root = new THREE.Group();
    root.userData.subjectId = subjectId;
    const originalUpdateWorldMatrix = root.updateWorldMatrix.bind(root);
    let boundsPreparationCalls = 0;
    root.updateWorldMatrix = (...args) => {
      boundsPreparationCalls += 1;
      if (
        shadowPreparationFailureSubject === subjectId
        && shadowPreparationFailuresRemaining > 0
        && boundsPreparationCalls === 4
      ) {
        shadowPreparationFailuresRemaining -= 1;
        throw new Error(`synthetic ${subjectId} shadow preparation failure`);
      }
      return originalUpdateWorldMatrix(...args);
    };
    const socket = new THREE.Object3D();
    socket.userData.sculptId = "inspection-socket";
    socket.position.set(0.1, 0.2, 0.3);
    root.add(socket);
    const resourceGeometry = new THREE.BufferGeometry();
    resourceGeometry.setAttribute("position", new THREE.Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ], 3));
    resourceGeometry.setAttribute("normal", new THREE.Float32BufferAttribute([
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
    ], 3));
    resourceGeometry.setIndex([0, 1, 2]);
    const resourceMaterial = new THREE.MeshStandardNodeMaterial();
    const resourceMeshes = new Map();
    for (let index = 0; index < shadowCasterCount; index += 1) {
      const resourceMesh = new THREE.Mesh(resourceGeometry, resourceMaterial);
      resourceMesh.castShadow = true;
      resourceMeshes.set(`resource-mesh-${index}`, resourceMesh);
    }
    if (
      renderResourceInspectionFailureSubject === subjectId
      && renderResourceInspectionFailuresRemaining > 0
    ) {
      renderResourceInspectionFailuresRemaining -= 1;
      const failingMesh = resourceMeshes.values().next().value;
      Object.defineProperty(failingMesh, "geometry", {
        configurable: true,
        get() {
          throw new Error(`synthetic ${subjectId} render-resource inspection failure`);
        },
      });
    }
    const runtime = {
      subjectId,
      instanceId: options.instanceId,
      instanceGeneration: continuity.generation,
      runtimeId: Object.freeze({
        namespace: `${subjectId}.runtime`,
        localId: options.instanceId,
        generation: continuity.generation,
      }),
      continuityToken: continuity.effectiveToken,
      continuityStatus: continuity.status,
      continuity: Object.freeze({
        policy: "same effective token preserves generation; changed seed increments",
        status: continuity.status,
        token: continuity.effectiveToken,
        tokenProvided: true,
        generation: continuity.generation,
        previousGeneration: continuity.previousGeneration,
      }),
      subjectContinuity: Object.freeze({
        baseContinuityToken: options.continuityToken,
        effectiveContinuityToken: continuity.effectiveToken,
        sourceRevision: `${subjectId}-source-v1`,
        seed: options.seed,
        visualTierExcluded: true,
      }),
      tier: options.tier,
      seed: options.seed,
      root,
      mode: "final",
      nodes: new Map([["root", root], ["inspection-socket", socket]]),
      meshes: resourceMeshes,
      sockets: new Map([["inspection-socket", socket]]),
      colliders: new Map([
        ["body", { recordType: "ColliderConstructionInput", id: "body" }],
        ["detail", { recordType: "ColliderConstructionInput", id: "detail" }],
      ]),
      physicsMaterials: new Map([["surface", { recordType: "PhysicsMaterialBindingInput", id: "surface" }]]),
      destructionGroups: new Map([["shell", ["root"]]]),
      setTimeCalls: [],
      setModeCalls: [],
    };
    const target = {
      root,
      runtime,
      contract: definitions.get(subjectId).contract,
      async setMode(nextMode) {
        runtime.setModeCalls.push(nextMode);
        const behavior = targetModeBehaviors.shift() ?? null;
        if (behavior === "mutate-throw") {
          runtime.mode = nextMode;
          throw new Error(`synthetic ${subjectId} partial mode mutation failure`);
        }
        if (behavior === "no-op") return;
        if (failConfigurationFor === subjectId && configurationFailuresRemaining > 0) {
          configurationFailuresRemaining -= 1;
          throw new Error(`synthetic ${subjectId} configuration failure`);
        }
        runtime.mode = nextMode;
      },
      async setTime(seconds, animate) {
        runtime.setTimeCalls.push({ seconds, animate });
        if (deviceLossDuringTargetTimeRemaining > 0) {
          deviceLossDuringTargetTimeRemaining -= 1;
          renderer.onDeviceLost({
            api: "WebGPU",
            reason: "synthetic-target-time-race",
            message: "synthetic device loss during target time update",
          });
        }
        if (fixedOffsetMotion) socket.rotation.z = animate ? 0.1 : 0;
        else if (!noOpMotion) socket.rotation.z = animate ? Math.sin(seconds * 1.1) * 0.1 : 0;
        root.updateMatrixWorld(true);
      },
      async dispose() {
        const attempts = targetDisposeAttempts.get(target) ?? 0;
        assert.equal(attempts, 0, "each target resource teardown may be attempted only once");
        targetDisposeAttempts.set(target, attempts + 1);
        if (targetDisposeFailureSubject === subjectId && targetDisposeFailuresRemaining > 0) {
          targetDisposeFailuresRemaining -= 1;
          throw new Error(`synthetic ${subjectId} target disposal failure`);
        }
        targetDisposals.set(target, 1);
        targetLiveCount -= 1;
        resourceGeometry.dispose();
        resourceMaterial.dispose();
      },
    };
    targets.push(target);
    return target;
  }

  const dependencies = {
    createRenderer: (options) => {
      rendererOptions = { ...options };
      return renderer;
    },
    createControls: (camera) => {
      controls = {
        target: new THREE.Vector3(),
        minDistance: 0,
        maxDistance: Infinity,
        enableDamping: false,
        update() {
          const behavior = controlsUpdateBehaviors.shift() ?? null;
          if (behavior === "throw") {
            throw new Error("synthetic controls update failure");
          }
          if (controlsUpdateFailuresRemaining > 0) {
            controlsUpdateFailuresRemaining -= 1;
            throw new Error("synthetic controls update failure");
          }
          if (clampControlsDistance) {
            const offset = camera.position.clone().sub(this.target);
            const distance = offset.length();
            const clamped = THREE.MathUtils.clamp(distance, this.minDistance, this.maxDistance);
            if (distance > 0 && clamped !== distance) {
              camera.position.copy(this.target).addScaledVector(offset, clamped / distance);
            }
          }
          if (behavior === "mutate") camera.position.x += 0.5;
        },
        dispose() {
          controlsDisposals += 1;
          if (controlsDisposeFailuresRemaining > 0) {
            controlsDisposeFailuresRemaining -= 1;
            throw new Error("synthetic controls disposal failure");
          }
        },
      };
      return controls;
    },
    createTarget,
    getTargetDefinition(id) {
      const definition = definitions.get(id);
      if (!definition) throw new RangeError(`Unknown fake target "${id}"`);
      return definition;
    },
    summarizeTarget(root) {
      const target = targets.find((entry) => entry.root === root);
      if (
        summaryFailureSubject === target.runtime.subjectId
        && summaryFailuresRemaining > 0
      ) {
        summaryFailuresRemaining -= 1;
        throw new Error(`synthetic ${target.runtime.subjectId} summary failure`);
      }
      const tierScale = { full: 3, budgeted: 2, minimum: 1 }[target.runtime.tier];
      return {
        subjectId: target.runtime.subjectId,
        instanceId: target.runtime.instanceId,
        instanceGeneration: target.runtime.instanceGeneration,
        continuityStatus: target.runtime.continuityStatus,
        tier: target.runtime.tier,
        seed: target.runtime.seed,
        mode: target.runtime.mode,
        nodes: target.runtime.nodes.size,
        meshes: 4 * tierScale,
        meshObjects: 4 * tierScale,
        renderItems: 5 * tierScale,
        triangles: 120 * tierScale,
        colliders: target.runtime.colliders.size,
        sockets: target.runtime.sockets.size,
        physicsMaterials: target.runtime.physicsMaterials.size,
        destructionGroups: target.runtime.destructionGroups.size,
      };
    },
    async resolvePreInitCapabilities({ runtimeProfile }) {
      return {
        source: "synthetic-exact-pre-init-capability",
        adapterAvailable: runtimeProfile === "performance",
        timestampQuerySupported: runtimeProfile === "performance" ? timestampQuerySupported : null,
      };
    },
    now() {
      syntheticNowMs += 0.25;
      return syntheticNowMs;
    },
  };

  return {
    dependencies,
    renderer,
    factoryCalls,
    targetDisposals,
    targetDisposeAttempts,
    targets,
    get targetLiveCount() {
      return targetLiveCount;
    },
    get peakTargetLiveCount() {
      return peakTargetLiveCount;
    },
    get controlsDisposals() {
      return controlsDisposals;
    },
    get rendererOptions() {
      return rendererOptions;
    },
    get controls() {
      return controls;
    },
    get timestampScopes() {
      return [...timestampScopes];
    },
    failConfigurationFor(subjectId, times = 1) {
      failConfigurationFor = subjectId;
      configurationFailuresRemaining = times;
    },
    clearConfigurationFailure() {
      failConfigurationFor = null;
      configurationFailuresRemaining = 0;
    },
    failControlsUpdate(times = 1) {
      controlsUpdateFailuresRemaining = times;
    },
    queueControlsUpdateBehaviors(...behaviors) {
      for (const behavior of behaviors) {
        if (!new Set(["throw", "mutate"]).has(behavior)) {
          throw new RangeError(`Unknown controls update behavior "${behavior}"`);
        }
        controlsUpdateBehaviors.push(behavior);
      }
    },
    failControlsDispose(times = 1) {
      controlsDisposeFailuresRemaining = times;
    },
    failRendererDispose(times = 1) {
      rendererDisposeFailuresRemaining = times;
    },
    failRendererSetSize(times = 1) {
      rendererSetSizeFailuresRemaining = times;
    },
    failRendererSetPixelRatio(times = 1) {
      rendererSetPixelRatioFailuresRemaining = times;
    },
    failRenderTargetRestore(times = 1) {
      expectedRendererRestoreTarget = renderer.currentRenderTarget;
      rendererRestoreTargetFailuresRemaining = times;
    },
    silentlyIgnoreRenderTargetRestore(times = 1) {
      expectedRendererRestoreTarget = renderer.currentRenderTarget;
      rendererRestoreTargetNoOpRemaining = times;
    },
    setPriorRenderTarget(value) {
      renderer.currentRenderTarget = value;
    },
    failReadback(times = 1) {
      readbackFailuresRemaining = times;
    },
    loseDeviceDuringRender(times = 1) {
      deviceLossDuringRenderRemaining = times;
    },
    loseDeviceDuringTargetTime(times = 1) {
      deviceLossDuringTargetTimeRemaining = times;
    },
    failTargetDispose(subjectId, times = 1) {
      targetDisposeFailureSubject = subjectId;
      targetDisposeFailuresRemaining = times;
    },
    failShadowPreparation(subjectId, times = 1) {
      shadowPreparationFailureSubject = subjectId;
      shadowPreparationFailuresRemaining = times;
    },
    failSummary(subjectId, times = 1) {
      summaryFailureSubject = subjectId;
      summaryFailuresRemaining = times;
    },
    queueGpuTimestamp(durationMs) {
      timestampDurations.push(durationMs);
    },
    failGpuTimestampResolve(times = 1) {
      timestampResolveFailuresRemaining = times;
    },
    deferTargetCreation(subjectId) {
      const gate = createDeferredGate();
      deferredTargetCreation = { subjectId, gate };
      return gate;
    },
    deferReadback() {
      const gate = createDeferredGate();
      deferredReadback = gate;
      return gate;
    },
    deferTimestampResolve() {
      const gate = createDeferredGate();
      deferredTimestampResolve = gate;
      return gate;
    },
    replaceRendererDeviceSilently(label = "synthetic-replacement-device") {
      renderer.backend.device = createSyntheticDevice(label);
      return renderer.backend.device;
    },
    materializeShadowMapOnNextRender({ disposeFails = false } = {}) {
      const map = {
        disposed: false,
        dispose() {
          this.disposed = true;
          if (disposeFails) throw new Error("synthetic shadow-map disposal failure");
        },
      };
      pendingShadowMap = map;
      return map;
    },
    failRenderResourceInspection(subjectId, times = 1) {
      renderResourceInspectionFailureSubject = subjectId;
      renderResourceInspectionFailuresRemaining = times;
    },
    queueTargetModeBehaviors(...behaviors) {
      for (const behavior of behaviors) {
        if (!new Set(["mutate-throw", "no-op"]).has(behavior)) {
          throw new RangeError(`Unknown target mode behavior "${behavior}"`);
        }
        targetModeBehaviors.push(behavior);
      }
    },
    returnMalformedTarget(subjectId, { times = 1, disposal = "succeeds" } = {}) {
      if (!new Set(["succeeds", "fails", "missing"]).has(disposal)) {
        throw new RangeError(`Unknown malformed target disposal mode "${disposal}"`);
      }
      malformedTargetSubject = subjectId;
      malformedTargetsRemaining = times;
      malformedTargetDisposalMode = disposal;
    },
    emitDeviceLoss(info = { api: "WebGPU", reason: "unknown", message: "synthetic device loss" }) {
      renderer.onDeviceLost(info);
    },
    emitUncapturedGpuError(info = {
      api: "WebGPU",
      type: "GPUValidationError",
      message: "synthetic uncaptured GPU error",
    }) {
      renderer.onError(info);
    },
  };
}

assert.deepEqual(TARGET_IDS, ["articulated-desk-lamp", "potted-bonsai", "ceramic-teapot"]);

{
  const harness = createHarness();
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    width: 641,
    height: 359,
    dpr: 3,
    subjectId: "ceramic-teapot",
    mode: "materials",
    tier: "minimum",
    camera: "profile",
    seed: 7,
    dependencies: harness.dependencies,
  });

  assert.deepEqual(harness.factoryCalls, [{
    subjectId: "ceramic-teapot",
    options: {
      tier: "minimum",
      seed: 7,
      instanceId: "active-preview",
      continuityToken: "active-preview-continuity-v1",
    },
  }], "initial route state must drive the first and only target allocation");
  let metrics = controller.getMetrics();
  assert.equal(metrics.labId, "webgpu-object-sculptor-corpus");
  assert.equal(metrics.subjectId, "ceramic-teapot");
  assert.equal(metrics.mode, "materials");
  assert.equal(metrics.tier, "minimum");
  assert.equal(metrics.camera, "profile");
  assert.equal(metrics.dpr, 1);
  assert.equal(metrics.backendKind, "webgpu");
  assert.equal(metrics.nativeWebGPU, true);
  assert.equal(metrics.initialized, true);
  assert.equal(metrics.firstFrameCompleted, false);
  assert.equal(metrics.targetAllocations, 1);
  assert.equal(metrics.targetDisposals, 0);
  assert.equal(metrics.liveTargetCount, 1);
  assert.equal(metrics.peakLiveTargetCount, 1);
  assert.equal(metrics.physicsHandoffCount, 2);
  assert.equal(metrics.physicsHandoffStatus, "blocked-authoring-inputs-only");
  assert.equal(metrics.frameErrorCount, 0);
  assert.equal(metrics.lifecycleErrorCount, 0);
  assert.equal(metrics.runtimeProfile, "correctness");
  assert.equal(metrics.timestampQueriesRequested, false);
  assert.equal(metrics.timingMethod, "correctness-profile-no-timestamp-query");
  assert.equal(metrics.motionWitness.status, "frozen-authored-pose");
  assert.equal(metrics.cameraFraming.camera, "profile");
  assert.equal(metrics.cameraFraming.focusSource, "definition-bounds-fallback");
  assert.equal(metrics.lightShadowPolicy.mapSize, 256);
  assert.equal(metrics.lightShadowPolicy.filter, "basic");
  assert.equal(metrics.lightShadowPolicy.antialiasRequestedAtRendererInit, false);
  assert.equal(harness.rendererOptions.antialias, false);
  assert.equal(harness.rendererOptions.trackTimestamp, false);
  assert.equal(metrics.rendererInfo.render.calls, 0);
  assert.equal(controller.describePipeline().sceneRendersPerFrame, 1);
  assert.deepEqual(controller.describePipeline().passes, ["forward-scene"]);
  assert.equal(controller.describePipeline().mrt, false);
  assert.equal(controller.describePipeline().postprocessing, false);
  let resources = controller.describeResources();
  assert.deepEqual(resources.renderTargets, [], "live initialization must not allocate capture resources");
  assert.equal(resources.activeTarget.renderResources.geometry.attributeLogicalViewBytes, 72);
  assert.equal(resources.activeTarget.renderResources.geometry.indexLogicalViewBytes, 6);
  assert.equal(resources.activeTarget.renderResources.geometry.uniqueBackingStoreBytes, 78);
  assert.equal(resources.activeTarget.renderResources.uniqueMaterialCount, 1);
  assert.equal(resources.pipelineAccounting.forwardMaterialDescriptorCount, 1);
  assert.equal(resources.pipelineAccounting.shadowCasterMaterialDescriptorCount, 1);
  assert.equal(resources.pipelineAccounting.logicalPipelineRequestCount, null);
  assert.match(
    resources.pipelineAccounting.logicalPipelineRequestCountStatus,
    /opaque-renderer-cache-keys/,
  );
  assert.equal(resources.shadow.requestedTexels, 256 * 256);
  assert.equal(resources.shadow.requestedDepthBytesUpperBound, 256 * 256 * 4);
  assert.equal(resources.shadow.physicalGpuResidentBytes, null);
  assert.equal(resources.lifecycle.targetAllocationEquilibrium, true);
  assert.equal(resources.lifecycle.allocationEquilibrium, true);
  assert.deepEqual(
    resources.rawEvidenceDescriptors.map((descriptor) => descriptor.category),
    [
      "renderer",
      "target-geometry",
      "target-materials",
      "shadow",
      "capture-target",
      "readback-staging",
    ],
  );
  assert(resources.rawEvidenceDescriptors.every(
    (descriptor) => descriptor.physicalGpuResidentBytes === null,
  ));
  const geometryDescriptor = resources.rawEvidenceDescriptors.find(
    (descriptor) => descriptor.category === "target-geometry",
  );
  assert(geometryDescriptor.allocationIds.includes("floor-geometry"));
  assert(
    geometryDescriptor.logicalByteLength
      > resources.activeTarget.renderResources.geometry.uniqueBackingStoreBytes,
    "resource evidence must include the controller-static floor geometry",
  );
  const shadowDescriptor = resources.rawEvidenceDescriptors.find(
    (descriptor) => descriptor.category === "shadow",
  );
  assert.deepEqual(shadowDescriptor.allocationIds, []);
  assert.equal(resources.shadow.allocationId, null);
  assert.match(resources.shadow.livenessStatus, /unobservable/);
  assert(resources.rawEvidenceDescriptors.every(
    (descriptor) => descriptor.subjectId === "ceramic-teapot" && descriptor.tier === "minimum",
  ));

  assert.equal(await controller.setSubject("ceramic-teapot"), false);
  assert.equal(await controller.setMode("materials"), false);
  assert.equal(await controller.setTier("minimum"), false);
  assert.equal(await controller.setCamera("profile"), false);
  assert.equal(await controller.setSeed(7), false);
  assert.equal(harness.factoryCalls.length, 1, "same-state setters must not allocate or discard a target");

  await controller.renderOnce();
  metrics = controller.getMetrics();
  assert.equal(metrics.firstFrameCompleted, true);
  assert.equal(metrics.renderSubmissions, 1);
  assert.equal(metrics.completedFrames, 1);
  assert.equal(metrics.rendererInfo.render.calls, 1);

  assert.equal(await controller.setMode("action-ready"), true);
  await controller.step(0.25);
  assert.deepEqual(harness.targets.at(-1).runtime.setTimeCalls.at(-1), { seconds: 0.25, animate: true });
  assert.equal(controller.getMetrics().time, 0.25);
  assert.equal(controller.getMetrics().motionWitness.status, "measured-live-pose-delta");
  assert(controller.getMetrics().motionWitness.activeChannelCount > 0);
  assert(controller.getMetrics().motionWitness.maxRotationDeltaRadians > 0);
  assert.equal(await controller.resetHistory(), true);
  assert.deepEqual(harness.targets.at(-1).runtime.setTimeCalls.at(-1), { seconds: 0, animate: true });
  assert.equal(controller.getMetrics().motionWitness.status, "awaiting-pose-delta");

  const beforeTierRebuild = controller.getRuntimeContract();
  assert.equal(beforeTierRebuild.instanceId, "active-preview");
  assert.equal(beforeTierRebuild.instanceGeneration, 1);
  assert.equal(beforeTierRebuild.continuityStatus, "explicit-instance-established");
  assert.equal(beforeTierRebuild.subjectContinuity.baseContinuityToken, CORPUS_CONTINUITY_TOKEN);
  assert.equal(beforeTierRebuild.subjectContinuity.visualTierExcluded, true);

  assert.equal(await controller.setTier("full"), true);
  metrics = controller.getMetrics();
  assert.equal(metrics.tier, "full");
  assert.equal(metrics.dpr, 1.5);
  assert.equal(metrics.targetAllocations, 2);
  assert.equal(metrics.targetDisposals, 1);
  assert.equal(metrics.liveTargetCount, 1);
  assert.equal(metrics.peakLiveTargetCount, 1, "same-subject stable instance replacement must not overlap live resources");
  assert.equal(metrics.lightShadowPolicy.mapSize, 1024);
  assert.equal(metrics.lightShadowPolicy.filter, "pcf-soft");
  assert.equal(metrics.lightShadowPolicy.antialiasRequestedAtRendererInit, false);
  assert.equal(metrics.lightShadowPolicy.antialiasInvariantAcrossTiers, true);
  assert.equal(
    metrics.lightShadowPolicy.antialiasPolicy,
    "invariant-disabled-across-runtime-tiers",
  );
  assert.equal(metrics.lightShadowPolicy.actualRendererSamples, 0);
  assert.equal(harness.targetDisposals.get(harness.targets[0]), 1);
  const afterTierRebuild = controller.getRuntimeContract();
  assert.equal(afterTierRebuild.instanceId, beforeTierRebuild.instanceId);
  assert.equal(afterTierRebuild.instanceGeneration, beforeTierRebuild.instanceGeneration);
  assert.deepEqual(afterTierRebuild.runtimeId, beforeTierRebuild.runtimeId, "visual tier rebuild must preserve the generation-qualified runtime ID");
  assert.equal(afterTierRebuild.continuityStatus, "explicit-continuity-preserved");
  assert.equal(
    afterTierRebuild.subjectContinuity.effectiveContinuityToken,
    beforeTierRebuild.subjectContinuity.effectiveContinuityToken,
    "factory effective continuity must exclude visual tier",
  );

  assert.equal(await controller.setSeed(8), true);
  metrics = controller.getMetrics();
  assert.equal(metrics.seed, 8);
  assert.equal(metrics.targetAllocations, 3);
  assert.equal(metrics.targetDisposals, 2);
  const afterSeedRebuild = controller.getRuntimeContract();
  assert.equal(afterSeedRebuild.instanceId, beforeTierRebuild.instanceId);
  assert.equal(afterSeedRebuild.instanceGeneration, beforeTierRebuild.instanceGeneration + 1);
  assert.equal(afterSeedRebuild.runtimeId.generation, beforeTierRebuild.runtimeId.generation + 1);
  assert.equal(afterSeedRebuild.continuityStatus, "explicit-continuity-changed-new-generation");
  assert.notEqual(
    afterSeedRebuild.subjectContinuity.effectiveContinuityToken,
    beforeTierRebuild.subjectContinuity.effectiveContinuityToken,
    "seed changes must change the factory-composed continuity signature",
  );

  assert.equal(await controller.setSubject("potted-bonsai"), true);
  metrics = controller.getMetrics();
  assert.equal(metrics.subjectId, "potted-bonsai");
  assert.equal(metrics.targetAllocations, 4);
  assert.equal(metrics.targetDisposals, 3);
  assert.equal(metrics.liveTargetCount, 1);
  assert.equal(metrics.peakLiveTargetCount, 2, "cross-subject transaction may hold old and candidate targets until commit");
  assert.equal(harness.peakTargetLiveCount, 2);

  harness.failConfigurationFor("articulated-desk-lamp");
  await assert.rejects(
    controller.setSubject("articulated-desk-lamp"),
    /synthetic articulated-desk-lamp configuration failure/,
  );
  harness.clearConfigurationFailure();
  metrics = controller.getMetrics();
  assert.equal(metrics.subjectId, "potted-bonsai", "failed cross-subject configuration must preserve the committed target");
  assert.equal(metrics.liveTargetCount, 1);
  assert.equal(harness.targetLiveCount, 1);
  assert.equal(harness.targetDisposals.get(harness.targets.at(-1)), 1, "failed candidate must be disposed exactly once");

  harness.failConfigurationFor("potted-bonsai", 1);
  await assert.rejects(
    controller.setTier("minimum"),
    /synthetic potted-bonsai configuration failure/,
  );
  harness.clearConfigurationFailure();
  metrics = controller.getMetrics();
  assert.equal(metrics.subjectId, "potted-bonsai");
  assert.equal(metrics.tier, "full", "failed same-subject tier rebuild must restore the committed tier");
  assert.equal(metrics.rollbackRebuildCount, 1);
  assert.equal(metrics.liveTargetCount, 1);
  assert.equal(harness.targetLiveCount, 1);

  const landscapeCameraDistance = controller.getMetrics().cameraFraming.framingDistanceMeters;
  await controller.resize(7, 13, 1);
  const portraitCameraFraming = controller.getMetrics().cameraFraming;
  assert.equal(portraitCameraFraming.aspect, 7 / 13);
  assert(portraitCameraFraming.framingDistanceMeters > landscapeCameraDistance, "portrait resize must reframe against horizontal FOV");
  await controller.resize(13, 7, 1);
  const capture = await controller.capturePixels("presentation");
  assert.equal(capture.format, "rgba8unorm");
  assert.equal(capture.outputColorSpace, "srgb");
  assert.equal(capture.colorEncoding, "srgb");
  assert.equal(capture.nativeWebGPU, true);
  assert.equal(capture.origin, "top-left");
  assert.equal(capture.rowBytes, 52);
  assert.equal(capture.bytesPerRow, 256);
  assert.equal(capture.sourceBytesPerRow, 256);
  assert.equal(capture.readbackSourceBytesPerRow, 52);
  assert.equal(capture.sourceByteLength, 1792);
  assert.equal(capture.readbackSourceByteLength, 364);
  assert.equal(capture.pixels.length, 1792);
  assert.equal(capture.transport.layout.padding, "compact");
  assert.equal(capture.transport.layout.bytesPerRow, 52);
  assert.equal(capture.transport.layout.byteLength, 364);
  assert.equal(capture.transport.pixels.length, 364);
  assert.equal(capture.normalized.layout.padding, "cpu-normalized-fully-padded");
  assert.equal(capture.normalized.layout.bytesPerRow, 256);
  assert.equal(capture.normalized.layout.byteLength, 1792);
  assert.equal(capture.normalized.pixels.length, 1792);
  assert.equal(capture.transport.pixels[0], 0x20, "transport row zero is the top row");
  assert.equal(capture.transport.pixels[52], 0x21);
  assert.equal(capture.transport.pixels[52 * 6], 0x26, "transport final row stays last");
  assert.equal(capture.normalized.pixels[0], 0x20);
  assert.equal(capture.normalized.pixels[256], 0x21);
  assert.equal(capture.normalized.pixels[256 * 6], 0x26);
  assert(capture.normalized.pixels.slice(52, 256).every((value) => value === 0));
  assert.notEqual(
    capture.transport.pixels,
    capture.normalized.pixels,
    "transport and normalized readbacks must be independent retained byte arrays",
  );
  assert.equal(controller.describeResources().renderTargets[0].allocation, "lazy-capture-only");
  resources = controller.describeResources();
  assert.equal(resources.renderTargets[0].effectiveSampleCount, 1);
  assert.equal(resources.renderTargets[0].colorLogicalBytes, 13 * 7 * 4);
  assert.equal(resources.renderTargets[0].depthLogicalBytesUpperBound, 13 * 7 * 4);
  assert.equal(resources.readbackStaging.alignedBytesPerRow, 256);
  assert.equal(resources.readbackStaging.fullyPaddedByteLength, 1792);
  assert.equal(resources.lifecycle.captureTargetAllocations, 1);
  assert.equal(resources.lifecycle.captureTargetResizeCount, 1);
  assert.equal(resources.lifecycle.targetAllocationEquilibrium, true);
  assert.equal(resources.lifecycle.allocationEquilibrium, true);
  assert.equal(resources.lifecycle.stateMutationCount > 0, true);

  const runtimeContract = controller.getRuntimeContract();
  assert.equal(runtimeContract.subjectId, "potted-bonsai");
  assert.equal(runtimeContract.instanceId, "active-preview");
  assert.equal(runtimeContract.instanceGeneration, 1);
  assert.equal(runtimeContract.runtimeId.generation, runtimeContract.instanceGeneration);
  assert.equal(runtimeContract.continuity.generation, runtimeContract.instanceGeneration);
  assert.equal(runtimeContract.continuity.tokenProvided, true);
  assert.equal(runtimeContract.subjectContinuity.baseContinuityToken, CORPUS_CONTINUITY_TOKEN);
  assert.equal(runtimeContract.subjectContinuity.visualTierExcluded, true);
  assert.equal(runtimeContract.continuityEvidence.baseToken, CORPUS_CONTINUITY_TOKEN);
  assert.equal(runtimeContract.continuityEvidence.effectiveToken, runtimeContract.continuity.token);
  assert.equal(runtimeContract.continuityEvidence.generation, runtimeContract.instanceGeneration);
  assert.equal(runtimeContract.continuityEvidence.visualTierExcluded, true);
  assert.deepEqual(runtimeContract.nodeIds, ["inspection-socket", "root"]);
  assert.deepEqual(runtimeContract.socketIds, ["inspection-socket"]);
  assert.deepEqual(runtimeContract.colliderIds, ["body", "detail"]);
  assert.deepEqual(runtimeContract.destructionGroupIds, ["shell"]);
  assert.deepEqual(runtimeContract.protectedNodeIds, runtimeContract.nodeIds);
  assert.deepEqual(runtimeContract.protectedSocketIds, runtimeContract.socketIds);
  assert.deepEqual(runtimeContract.protectedColliderIds, runtimeContract.colliderIds);
  assert.deepEqual(runtimeContract.protectedDestructionGroupIds, runtimeContract.destructionGroupIds);
  assert.equal(runtimeContract.colliderConstructionInputs.length, 2);
  assert.equal(runtimeContract.physicsAuthority, "authoring-input-only");
  assert.equal(runtimeContract.motionWitness.status, "awaiting-pose-delta");
  assert.equal(typeof controller.drain, "function");
  await controller.drain();

  harness.renderer.failRender = true;
  await assert.rejects(controller.renderOnce(), /synthetic native render failure/);
  assert.equal(controller.getMetrics().lastFrameError, "synthetic native render failure");
  assert.equal(controller.getMetrics().frameErrorCount, 1);
  harness.renderer.failRender = false;

  assert.equal(await controller.dispose(), true);
  assert.equal(await controller.dispose(), false);
  assert.equal(harness.targetLiveCount, 0);
  assert.equal(harness.renderer.disposeCalls, 1);
  assert.equal(harness.controlsDisposals, 1);
}

{
  const harness = createHarness({ clampControlsDistance: true });
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    width: 1600,
    height: 900,
    subjectId: "potted-bonsai",
    cameraInteractionEnabled: false,
    dependencies: harness.dependencies,
  });
  await controller.resize(1, 100, 1);
  const framing = controller.getMetrics().cameraFraming;
  assert.equal(framing.aspect, 0.01);
  assert.equal(framing.interactionEnabled, false);
  assert.equal(controller.getMetrics().cameraInteractionEnabled, false);
  assert.equal(harness.controls.enabled, false);
  assert.equal(framing.actualFramingDistanceMeters, framing.requestedFramingDistanceMeters);
  assert.equal(framing.distanceClampResidualMeters, 0);
  assert(framing.controlsMaxDistanceMeters > framing.requestedFramingDistanceMeters);
  assert.deepEqual(
    framing.actualPose.controlsTargetMeters,
    framing.targetMeters,
    "published camera evidence must record the actual controls target",
  );
  assert.equal(framing.actualPose.positionMeters.length, 3);
  assert.equal(framing.actualPose.quaternion.length, 4);
  assert(framing.actualPose.positionMeters.every(Number.isFinite));
  assert(framing.actualPose.quaternion.every(Number.isFinite));
  await controller.dispose();
}

{
  const harness = createHarness({
    readbackLayout: "fully-padded",
    readbackByteOffset: 9,
  });
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    width: 13,
    height: 7,
    dpr: 1,
    subjectId: "ceramic-teapot",
    dependencies: harness.dependencies,
  });
  const capture = await controller.capturePixels("presentation");
  assert.equal(capture.transport.layout.padding, "webgpu-aligned-fully-padded");
  assert.equal(capture.transport.layout.byteLength, 1792);
  assert.equal(capture.transport.pixels[52], 0xa5, "transport retains renderer padding bytes");
  assert.equal(capture.normalized.layout.byteLength, 1792);
  assert.equal(capture.normalized.pixels[52], 0, "normalization zeroes row padding");
  assert.equal(capture.transport.pixels[0], 0x20);
  assert.equal(capture.transport.pixels[256], 0x21);
  assert.equal(capture.normalized.pixels[256 * 6], 0x26);
  await controller.dispose();
}

{
  const harness = createHarness();
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    width: 640,
    height: 360,
    dpr: 2,
    subjectId: "potted-bonsai",
    tier: "budgeted",
    dependencies: harness.dependencies,
  });
  const committed = controller.getMetrics();
  harness.failRendererSetSize();
  await assert.rejects(controller.setTier("full"), /synthetic renderer setSize failure/);
  let metrics = controller.getMetrics();
  assert.equal(metrics.tier, committed.tier);
  assert.equal(metrics.dpr, committed.dpr);
  assert.deepEqual(metrics.viewport, committed.viewport);
  assert.equal(harness.factoryCalls.length, 1, "resolution failure must precede tier target replacement");
  assert.equal(metrics.acceptingControllerOperations, true);

  harness.failRendererSetPixelRatio();
  await assert.rejects(controller.resize(500, 500, 1), /synthetic renderer setPixelRatio failure/);
  metrics = controller.getMetrics();
  assert.deepEqual(metrics.viewport, committed.viewport);
  assert.equal(metrics.acceptingControllerOperations, true);

  const committedFraming = metrics.cameraFraming;
  harness.failControlsUpdate();
  await assert.rejects(controller.resize(321, 777, 1.1), /synthetic controls update failure/);
  metrics = controller.getMetrics();
  assert.deepEqual(metrics.viewport, committed.viewport);
  assert.deepEqual(metrics.cameraFraming, committedFraming);
  assert.equal(harness.renderer.pixelRatio, committed.dpr);
  assert.equal(harness.renderer.domElement.width, committed.viewport.drawingBufferWidth);
  assert.equal(harness.renderer.domElement.height, committed.viewport.drawingBufferHeight);
  assert.equal(metrics.acceptingControllerOperations, true);
  await controller.dispose();
}

{
  const harness = createHarness();
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    subjectId: "ceramic-teapot",
    tier: "budgeted",
    dependencies: harness.dependencies,
  });
  harness.failRendererSetSize(2);
  await assert.rejects(
    controller.setTier("minimum"),
    (error) => error instanceof AggregateError
      && /restore the prior resolution transaction/.test(error.message),
  );
  const metrics = controller.getMetrics();
  assert.equal(metrics.tier, "budgeted");
  assert.equal(metrics.lifecycleAcceptanceStatus, "invalid-resolution-transaction-rollback");
  assert.equal(metrics.acceptingControllerOperations, false);
  await assert.rejects(controller.setCamera("profile"), /resolution transaction rollback/);
  await controller.dispose();
}

{
  const harness = createHarness();
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    subjectId: "potted-bonsai",
    tier: "budgeted",
    dependencies: harness.dependencies,
  });
  const invalidatedMap = harness.materializeShadowMapOnNextRender({ disposeFails: true });
  await controller.renderOnce();
  assert.equal(controller.describeResources().shadow.mapMaterializedByRenderer, true);
  await assert.rejects(
    controller.setTier("full"),
    /synthetic shadow-map disposal failure/,
  );
  const metrics = controller.getMetrics();
  assert.equal(metrics.tier, "budgeted");
  assert.equal(metrics.acceptingControllerOperations, true);
  assert.equal(invalidatedMap.disposed, true);
  assert.equal(
    controller.describeResources().shadow.mapMaterializedByRenderer,
    false,
    "outer tier rollback must not resurrect a disposed invalidated shadow map",
  );
  await controller.dispose();
}

{
  const harness = createHarness({ readbackLayout: "minimum-padded" });
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    width: 13,
    height: 7,
    dpr: 1,
    subjectId: "ceramic-teapot",
    dependencies: harness.dependencies,
  });
  const capture = await controller.capturePixels("presentation");
  assert.equal(capture.readbackSourceByteLength, 1588);
  assert.equal(capture.sourceByteLength, 1792);
  assert.equal(capture.transport.layout.padding, "webgpu-aligned-final-row-unpadded");
  assert.equal(capture.transport.layout.bytesPerRow, 256);
  assert.equal(capture.transport.layout.byteLength, 1588);
  assert.equal(capture.transport.pixels.length, 1588);
  assert.equal(capture.normalized.layout.padding, "cpu-normalized-fully-padded");
  assert.equal(capture.normalized.layout.byteLength, 1792);
  assert.equal(capture.normalized.pixels.length, 1792);
  assert.equal(capture.origin, "top-left");
  assert.equal(capture.transport.pixels[0], 0x20);
  assert.equal(capture.transport.pixels[256], 0x21);
  assert.equal(capture.normalized.pixels[256 * 6], 0x26);
  const resources = controller.describeResources();
  assert.equal(resources.readbackStaging.logicalStagingByteLength, 1588);
  assert.equal(resources.readbackStaging.normalizedCpuFullPaddingByteLength, 1792);
  assert.equal(resources.readbackStaging.transportByteLength, 1588);
  assert.equal(resources.readbackStaging.normalizedByteLength, 1792);
  const stagingDescriptor = resources.rawEvidenceDescriptors.find(
    (descriptor) => descriptor.category === "readback-staging",
  );
  assert.equal(stagingDescriptor.logicalByteLength, 1588);
  const stagingTransitions = resources.lifecycle.resourceTransitions.filter(
    (transition) => transition.resourceKind === "readback-staging-request",
  );
  assert.deepEqual(stagingTransitions.map((transition) => transition.logicalByteLength), [1588, 1588]);
  await controller.dispose();
}

{
  const harness = createHarness();
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    width: 13,
    height: 7,
    subjectId: "ceramic-teapot",
    dependencies: harness.dependencies,
  });
  await controller.capturePixels("presentation");
  harness.failReadback();
  harness.failRenderTargetRestore();
  await assert.rejects(
    controller.capturePixels("presentation"),
    (error) => {
      assert(error instanceof AggregateError);
      assert.equal(error.errors.length, 2);
      assert.match(error.errors[0].message, /synthetic native readback failure/);
      assert.match(error.errors[1].message, /synthetic render-target restoration failure/);
      assert.match(error.message, /capture failed and its prior render target could not be restored/);
      return true;
    },
  );
  const metrics = controller.getMetrics();
  assert.equal(metrics.lifecycleAcceptanceStatus, "invalid-capture-target-restoration");
  assert.equal(metrics.acceptingControllerOperations, false);
  assert.equal(metrics.captureTargetRestoreAttempts, 2);
  assert.equal(metrics.captureTargetRestoreFailures, 1);
  assert.equal(metrics.lastCaptureTargetRestoreError, "synthetic render-target restoration failure");
  assert.equal(metrics.lifecycleErrorCount, 1);
  assert.equal(
    controller.describeResources().readbackStaging.allocationId,
    "capture-readback-staging-request-1",
    "a failed capture transaction must not replace the last committed readback identity",
  );
  await assert.rejects(controller.setCamera("profile"), /capture target restoration/);
  assert.equal(await controller.dispose(), true);
}

{
  const harness = createHarness();
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    subjectId: "ceramic-teapot",
    dependencies: harness.dependencies,
  });
  harness.replaceRendererDeviceSilently("replacement-before-queued-operation");
  await assert.rejects(
    controller.setCamera("profile"),
    /renderer backend device identity changed/,
  );
  assert.equal(controller.getMetrics().rendererDeviceGeneration, 1);
  assert.equal(controller.getMetrics().deviceLossGeneration, 0);
  assert.equal(controller.getMetrics().rendererDeviceIdentityStillCurrent, false);
  assert.equal(
    controller.getMetrics().lifecycleAcceptanceStatus,
    "invalid-renderer-device-generation-change",
  );
  assert.equal(await controller.dispose(), true);
}

{
  const harness = createHarness();
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    width: 13,
    height: 7,
    subjectId: "ceramic-teapot",
    dependencies: harness.dependencies,
  });
  const priorTarget = { id: "synthetic-prior-render-target" };
  harness.setPriorRenderTarget(priorTarget);
  await controller.capturePixels("presentation");
  assert.equal(
    harness.renderer.getRenderTarget(),
    priorTarget,
    "capture must restore the exact non-null prior target identity",
  );
  assert.equal(controller.getMetrics().captureTargetRestoreFailures, 0);
  await controller.dispose();
}

{
  const harness = createHarness();
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    width: 13,
    height: 7,
    subjectId: "ceramic-teapot",
    dependencies: harness.dependencies,
  });
  const priorTarget = { id: "synthetic-silently-unrestored-target" };
  harness.setPriorRenderTarget(priorTarget);
  harness.silentlyIgnoreRenderTargetRestore();
  await assert.rejects(
    controller.capturePixels("presentation"),
    (error) => error instanceof AggregateError
      && error.errors.length === 1
      && /exact prior Object Sculptor render target identity/.test(error.errors[0].message),
  );
  assert.notEqual(harness.renderer.getRenderTarget(), priorTarget);
  assert.equal(controller.getMetrics().captureTargetRestoreFailures, 1);
  assert.equal(
    controller.getMetrics().lifecycleAcceptanceStatus,
    "invalid-capture-target-restoration",
  );
  assert.equal(await controller.dispose(), true);
}

{
  const harness = createHarness();
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    subjectId: "potted-bonsai",
    dependencies: harness.dependencies,
  });
  harness.returnMalformedTarget("articulated-desk-lamp", { disposal: "succeeds" });
  await assert.rejects(
    controller.setSubject("articulated-desk-lamp"),
    /runtime must own its root/,
  );
  let resources = controller.describeResources();
  assert.equal(resources.lifecycle.untrackedCandidateAllocations, 1);
  assert.equal(resources.lifecycle.untrackedCandidateDisposals, 1);
  assert.equal(resources.lifecycle.untrackedCandidateDisposeUncertain, 0);
  assert.equal(resources.lifecycle.liveUntrackedCandidateCount, 0);
  assert.equal(resources.lifecycle.untrackedCandidateAllocationEquilibrium, true);
  assert.equal(resources.lifecycle.targetAllocationEquilibrium, true);
  assert.equal(resources.lifecycle.allocationEquilibrium, true);
  assert.equal(controller.getMetrics().acceptingControllerOperations, true);

  harness.returnMalformedTarget("articulated-desk-lamp", { disposal: "missing" });
  await assert.rejects(
    controller.setSubject("articulated-desk-lamp"),
    (error) => error instanceof AggregateError
      && /candidate teardown was uncertain/.test(error.message),
  );
  resources = controller.describeResources();
  assert.equal(resources.lifecycle.untrackedCandidateAllocations, 2);
  assert.equal(resources.lifecycle.untrackedCandidateDisposals, 1);
  assert.equal(resources.lifecycle.untrackedCandidateDisposeUncertain, 1);
  assert.equal(resources.lifecycle.knownLiveUntrackedCandidateCount, 0);
  assert.equal(resources.lifecycle.liveUntrackedCandidateCount, 1);
  assert.equal(resources.lifecycle.possiblyLiveUntrackedCandidateCount, 1);
  assert.equal(resources.lifecycle.untrackedCandidateAllocationReconciled, true);
  assert.equal(resources.lifecycle.untrackedCandidateLeakFree, false);
  assert.equal(resources.lifecycle.untrackedCandidateAllocationEquilibrium, false);
  assert.equal(resources.lifecycle.targetAllocationReconciled, true);
  assert.equal(resources.lifecycle.targetLeakFree, false);
  assert.equal(resources.lifecycle.targetAllocationEquilibrium, false);
  assert.equal(resources.lifecycle.allocationReconciled, true);
  assert.equal(resources.lifecycle.allocationLeakFree, false);
  assert.equal(resources.lifecycle.allocationEquilibrium, false);
  assert.equal(controller.getMetrics().lifecycleAcceptanceStatus, "invalid-uncertain-teardown");
  assert.equal(controller.getMetrics().acceptingControllerOperations, false);
  await assert.rejects(controller.dispose(), /teardown completed with uncertain resources/);
}

{
  const harness = createHarness();
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    subjectId: "potted-bonsai",
    dependencies: harness.dependencies,
  });
  harness.returnMalformedTarget("articulated-desk-lamp", { disposal: "fails" });
  await assert.rejects(
    controller.setSubject("articulated-desk-lamp"),
    (error) => error instanceof AggregateError
      && /malformed target disposal failure/.test(error.errors[1]?.message ?? ""),
  );
  const resources = controller.describeResources();
  const transitions = resources.lifecycle.resourceTransitions.filter(
    (transition) => transition.resourceKind === "untracked-sculpt-target",
  );
  assert.equal(transitions.length, 2);
  assert.equal(transitions[0].allocationId, transitions[1].allocationId);
  assert.deepEqual(
    transitions.map((transition) => [transition.action, transition.status]),
    [["allocate", "succeeded"], ["dispose", "uncertain"]],
  );
  assert.equal(resources.lifecycle.untrackedCandidateAllocationReconciled, true);
  assert.equal(resources.lifecycle.untrackedCandidateLeakFree, false);
  assert.equal(resources.lifecycle.untrackedCandidateAllocationEquilibrium, false);
  assert.equal(resources.lifecycle.liveUntrackedCandidateCount, 1);
  assert.equal(resources.lifecycle.allocationReconciled, true);
  assert.equal(resources.lifecycle.allocationLeakFree, false);
  assert.equal(resources.lifecycle.allocationEquilibrium, false);
  await assert.rejects(controller.dispose(), /teardown completed with uncertain resources/);
}

{
  const authoredCasterCount = 12;
  const harness = createHarness({ shadowCasterCount: authoredCasterCount });
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    subjectId: "potted-bonsai",
    tier: "minimum",
    dependencies: harness.dependencies,
  });
  let shadowPolicy = controller.getMetrics().lightShadowPolicy;
  assert.equal(shadowPolicy.authoredCasterCount, authoredCasterCount);
  assert.equal(shadowPolicy.enabledCasterCount, CORPUS_SHADOW_POLICIES.minimum.casterLimit);
  assert.equal(
    shadowPolicy.disabledCasterIds.length,
    authoredCasterCount - CORPUS_SHADOW_POLICIES.minimum.casterLimit,
  );

  await controller.setMode("action-ready");
  await controller.setTime(0.25);
  await controller.resetHistory();
  shadowPolicy = controller.getMetrics().lightShadowPolicy;
  assert.equal(
    shadowPolicy.authoredCasterCount,
    authoredCasterCount,
    "repeated minimum-tier policy application must retain the immutable authored caster inventory",
  );
  assert.equal(shadowPolicy.enabledCasterCount, CORPUS_SHADOW_POLICIES.minimum.casterLimit);
  assert.equal(
    shadowPolicy.disabledCasterIds.length,
    authoredCasterCount - CORPUS_SHADOW_POLICIES.minimum.casterLimit,
  );
  assert.equal(
    [...harness.targets.at(-1).runtime.meshes.values()].filter((mesh) => mesh.castShadow).length,
    CORPUS_SHADOW_POLICIES.minimum.casterLimit,
    "effective caster visibility may change without erasing authored eligibility",
  );
  await controller.dispose();
}

{
  const harness = createHarness();
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    subjectId: "potted-bonsai",
    mode: "materials",
    dependencies: harness.dependencies,
  });
  const committed = controller.getMetrics();

  harness.failSummary("articulated-desk-lamp");
  await assert.rejects(
    controller.setSubject("articulated-desk-lamp"),
    /synthetic articulated-desk-lamp summary failure/,
  );
  let metrics = controller.getMetrics();
  assert.equal(metrics.subjectId, committed.subjectId);
  assert.equal(metrics.rebuildCount, committed.rebuildCount);
  assert.equal(metrics.triangles, committed.triangles, "failed summary must never replace the committed summary");

  harness.failControlsUpdate();
  await assert.rejects(
    controller.setSubject("articulated-desk-lamp"),
    /synthetic controls update failure/,
  );
  metrics = controller.getMetrics();
  assert.equal(metrics.subjectId, committed.subjectId);
  assert.equal(metrics.rebuildCount, committed.rebuildCount);
  assert.equal(metrics.cameraFraming.subjectId, committed.cameraFraming.subjectId);
  assert.equal(metrics.lightShadowPolicy.tier, committed.lightShadowPolicy.tier);

  harness.failShadowPreparation("articulated-desk-lamp");
  await assert.rejects(
    controller.setSubject("articulated-desk-lamp"),
    /synthetic articulated-desk-lamp shadow preparation failure/,
  );
  metrics = controller.getMetrics();
  assert.equal(metrics.subjectId, committed.subjectId);
  assert.equal(metrics.rebuildCount, committed.rebuildCount);
  assert.equal(metrics.liveTargetCount, 1);
  assert.equal(metrics.lifecycleAcceptanceStatus, "provisional-no-uncertain-teardown");
  assert.equal(metrics.acceptingControllerOperations, true);

  harness.failRenderResourceInspection("articulated-desk-lamp");
  await assert.rejects(
    controller.setSubject("articulated-desk-lamp"),
    /synthetic articulated-desk-lamp render-resource inspection failure/,
  );
  const resourcesAfterInspectionFailure = controller.describeResources();
  const failedInspectionTransitions = resourcesAfterInspectionFailure.lifecycle.resourceTransitions
    .filter((transition) => (
      transition.resourceKind === "sculpt-target"
      && transition.allocationId.includes("articulated-desk-lamp")
    ));
  const failedAllocationId = failedInspectionTransitions.at(-1)?.allocationId;
  assert(failedAllocationId);
  assert.deepEqual(
    failedInspectionTransitions
      .filter((transition) => transition.allocationId === failedAllocationId)
      .map((transition) => [transition.action, transition.status]),
    [["allocate", "succeeded"], ["dispose", "succeeded"]],
    "target allocation must be recorded before fallible render-resource inspection",
  );
  assert.equal(resourcesAfterInspectionFailure.lifecycle.targetAllocationReconciled, true);
  assert.equal(resourcesAfterInspectionFailure.lifecycle.targetAllocationEquilibrium, true);
  assert.equal(resourcesAfterInspectionFailure.lifecycle.allocationReconciled, true);
  assert.equal(resourcesAfterInspectionFailure.lifecycle.allocationEquilibrium, true);
  await controller.dispose();
}

{
  const harness = createHarness();
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    subjectId: "potted-bonsai",
    dependencies: harness.dependencies,
  });
  const committed = controller.getMetrics();
  harness.failTargetDispose("potted-bonsai");
  await assert.rejects(
    controller.setSubject("articulated-desk-lamp"),
    /synthetic potted-bonsai target disposal failure/,
  );
  const metrics = controller.getMetrics();
  assert.equal(metrics.subjectId, committed.subjectId);
  assert.equal(metrics.rebuildCount, committed.rebuildCount);
  assert.equal(metrics.lifecycleAcceptanceStatus, "invalid-uncertain-teardown");
  assert.equal(metrics.acceptingControllerOperations, false);
  assert.equal(metrics.targetDisposeUncertain, 1);
  assert.equal(metrics.knownLiveTargetCount, 0, "the uncommitted candidate is cleaned up");
  assert.equal(metrics.possiblyLiveUncertainTargetCount, 1);
  assert.equal(metrics.liveTargetCount, 1, "uncertain retired target remains conservatively live");
  assert.equal(metrics.targetLeakFree, false);
  assert.equal(metrics.teardown.uncertain, 1);
  const resources = controller.describeResources();
  assert.equal(resources.lifecycle.trackedTargetAllocationReconciled, true);
  assert.equal(resources.lifecycle.trackedTargetLeakFree, false);
  assert.equal(resources.lifecycle.trackedTargetAllocationEquilibrium, false);
  assert.equal(resources.lifecycle.allocationReconciled, true);
  assert.equal(resources.lifecycle.allocationLeakFree, false);
  assert.equal(resources.lifecycle.allocationEquilibrium, false);
  await assert.rejects(controller.setCamera("profile"), /uncertain resource teardown/);
  await assert.rejects(controller.dispose(), /teardown completed with uncertain resources/);
  assert.equal(harness.controlsDisposals, 1, "uncertain target disposal must not suppress controls teardown");
  assert.equal(harness.renderer.disposeCalls, 1, "uncertain target disposal must not suppress renderer teardown");
}

{
  const harness = createHarness();
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    subjectId: "potted-bonsai",
    mode: "action-ready",
    dependencies: harness.dependencies,
  });
  harness.failConfigurationFor("potted-bonsai", 2);
  await assert.rejects(
    controller.setMode("materials"),
    (error) => {
      assert(error instanceof AggregateError);
      assert.equal(error.errors.length, 2);
      assert.match(error.errors[0].message, /synthetic potted-bonsai configuration failure/);
      assert.match(error.errors[1].message, /synthetic potted-bonsai configuration failure/);
      assert.match(error.message, /restore "action-ready"/);
      return true;
    },
  );
  const metrics = controller.getMetrics();
  assert.equal(metrics.mode, "action-ready", "failed mode transaction must not publish the candidate mode");
  assert.equal(metrics.lifecycleAcceptanceStatus, "invalid-mode-transaction-rollback");
  assert.equal(metrics.acceptingControllerOperations, false);
  assert.equal(metrics.lifecycleErrorCount, 1);
  await assert.rejects(controller.setCamera("profile"), /mode transaction rollback/);
  assert.equal(await controller.dispose(), true);
}

{
  const harness = createHarness();
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    subjectId: "potted-bonsai",
    mode: "action-ready",
    dependencies: harness.dependencies,
  });
  harness.queueTargetModeBehaviors("mutate-throw", "no-op");
  await assert.rejects(
    controller.setMode("materials"),
    (error) => {
      assert(error instanceof AggregateError);
      assert.match(error.errors[0].message, /partial mode mutation failure/);
      assert(error.errors.some((entry) => /mode rollback postcondition mismatch/.test(entry.message)));
      return true;
    },
  );
  assert.equal(controller.getMetrics().mode, "action-ready");
  assert.equal(controller.getMetrics().lifecycleAcceptanceStatus, "invalid-mode-transaction-rollback");
  assert.equal(controller.getMetrics().acceptingControllerOperations, false);
  assert.equal(await controller.dispose(), true);
}

{
  const harness = createHarness();
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    subjectId: "ceramic-teapot",
    camera: "design",
    dependencies: harness.dependencies,
  });
  harness.queueControlsUpdateBehaviors("throw", "mutate");
  await assert.rejects(
    controller.setCamera("profile"),
    (error) => {
      assert(error instanceof AggregateError);
      assert.match(error.errors[0].message, /synthetic controls update failure/);
      assert(error.errors.some(
        (entry) => /presentation rollback postcondition mismatch/.test(entry.message),
      ));
      return true;
    },
  );
  assert.equal(controller.getMetrics().camera, "design");
  assert.equal(controller.getMetrics().lifecycleAcceptanceStatus, "invalid-camera-transaction-rollback");
  assert.equal(controller.getMetrics().acceptingControllerOperations, false);
  assert.equal(await controller.dispose(), true);
}

{
  const harness = createHarness({ timestampQuerySupported: true });
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    subjectId: "articulated-desk-lamp",
    mode: "action-ready",
    tier: "budgeted",
    camera: "attachment",
    profile: "performance",
    timestampQueriesRequired: true,
    dependencies: harness.dependencies,
  });
  const metrics = controller.getMetrics();
  assert.equal(harness.rendererOptions.trackTimestamp, true);
  assert.equal(harness.rendererOptions.antialias, false);
  assert.equal(metrics.runtimeProfile, "performance");
  assert.equal(metrics.preInitCapabilities.timestampQuerySupported, true);
  assert.equal(metrics.timestampQueriesRequired, true);
  assert.equal(metrics.timestampQueriesRequested, true);
  assert.match(metrics.timingMethod, /timestamp-query-active-on-verified-renderer-device/);
  assert.equal(metrics.timestampQueriesActive, true);
  assert.equal(metrics.rendererBackendEvidence.deviceIdentityVerified, true);
  assert.equal(metrics.rendererBackendEvidence.monitoringInstalledBeforeRendererInit, true);
  assert.equal(metrics.rendererBackendEvidence.timestampQueryFeatureOnActualDevice, true);
  assert.equal(metrics.rendererBackendEvidence.backendTimestampTrackingActive, true);
  assert.equal(metrics.sustainedGpuTimingAvailable, false);
  assert.equal(
    controller.describePipeline().timingEvidenceStatus,
    "insufficient-required-gpu-timestamp-samples",
  );
  assert.equal(controller.getMetrics().cameraFraming.focusSource, "definition-bounds-fallback");
  assert.deepEqual(
    controller.getMetrics().cameraFraming.missingNodeIds,
    [...CORPUS_CAMERA_FOCUS_CONTRACTS["articulated-desk-lamp"].attachment.nodeIds],
  );
  await controller.renderOnce();
  const sample = await controller.resolveGpuTimestampSample();
  assert.equal(sample.schemaVersion, "object-sculptor-gpu-timestamp-sample-v1");
  assert.equal(sample.status, "measured");
  assert.equal(sample.scope, THREE.TimestampQuery.RENDER);
  assert.equal(sample.gpuMs, 2.5);
  assert.equal(sample.resolveOverheadMs, 0.25);
  assert.equal(sample.rendererDeviceGeneration, 1);
  assert.equal(sample.deviceLossGeneration, 0);
  assert.equal(sample.frameOrdinal, 1);
  assert.equal(sample.submissionOrdinal, 1);
  assert.equal(sample.coveredSubmissionCount, 1);
  assert.equal(sample.renderPhase, "presentation-forward-scene");
  assert.equal(sample.subjectId, "articulated-desk-lamp");
  assert.equal(sample.tier, "budgeted");
  assert.equal(
    sample.queryPoolEvidence.freshnessStatus,
    "verified-current-pending-frame-resolved",
  );
  assert.deepEqual(sample.queryPoolEvidence.pendingContextIds, ["r:1:1:f0"]);
  assert.deepEqual(sample.queryPoolEvidence.resolvedContextDurationsMs, [2.5]);
  assert.equal(sample.queryPoolEvidence.publicApiFreshnessProvable, false);
  assert.deepEqual(harness.timestampScopes, [THREE.TimestampQuery.RENDER]);
  const performanceEvidence = controller.getPerformanceEvidence();
  assert.equal(performanceEvidence.resolveAttemptCount, 1);
  assert.equal(performanceEvidence.resolveFailureCount, 0);
  assert.equal(performanceEvidence.samples.length, 1);
  assert.equal(performanceEvidence.cpuRenderSubmissions.length, 1);
  assert.equal(
    controller.getMetrics().performanceAcceptance,
    "measured-not-accepted-pending-sustained-windows",
  );
  assert.equal(
    controller.describePipeline().timingEvidenceStatus,
    "measured-not-accepted-pending-sustained-windows",
  );
  await controller.dispose();
}

{
  const harness = createHarness({ timestampQuerySupported: true });
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    subjectId: "potted-bonsai",
    runtimeProfile: "performance",
    timestampQueriesRequired: true,
    dependencies: harness.dependencies,
  });
  const observedFailures = CORPUS_DIAGNOSTIC_RETENTION_LIMITS.gpuTimestampFailures + 1;
  harness.failGpuTimestampResolve(observedFailures);
  for (let index = 0; index < observedFailures; index += 1) {
    await controller.renderOnce();
    await assert.rejects(
      controller.resolveGpuTimestampSample(),
      /timestamp freshness is unverified/,
    );
  }
  const evidence = controller.getPerformanceEvidence();
  assert.equal(evidence.retention.gpuTimestampFailures.observed, observedFailures);
  assert.equal(
    evidence.retention.gpuTimestampFailures.retained,
    CORPUS_DIAGNOSTIC_RETENTION_LIMITS.gpuTimestampFailures,
  );
  assert.equal(evidence.retention.gpuTimestampFailures.dropped, 1);
  assert.equal(evidence.failures[0].resolveAttemptOrdinal, 2);
  assert.equal(evidence.failures.at(-1).resolveAttemptOrdinal, observedFailures);
  await controller.dispose();
}

{
  const harness = createHarness();
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    width: 1,
    height: 1,
    subjectId: "potted-bonsai",
    dependencies: harness.dependencies,
  });
  for (
    let index = 0;
    index < CORPUS_DIAGNOSTIC_RETENTION_LIMITS.stateMutations + 1;
    index += 1
  ) {
    await controller.setCamera(index % 2 === 0 ? "profile" : "design");
  }
  while (
    controller.getMetrics().resourceTransitionCount
    <= CORPUS_DIAGNOSTIC_RETENTION_LIMITS.resourceTransitions + 3
  ) {
    await controller.capturePixels("presentation");
  }
  for (
    let index = 0;
    index < CORPUS_DIAGNOSTIC_RETENTION_LIMITS.deviceErrors + 1;
    index += 1
  ) harness.emitUncapturedGpuError();
  harness.returnMalformedTarget("articulated-desk-lamp", {
    times: CORPUS_DIAGNOSTIC_RETENTION_LIMITS.teardownRecords + 1,
    disposal: "succeeds",
  });
  for (
    let index = 0;
    index < CORPUS_DIAGNOSTIC_RETENTION_LIMITS.teardownRecords + 1;
    index += 1
  ) {
    await assert.rejects(
      controller.setSubject("articulated-desk-lamp"),
      /runtime must own its root/,
    );
  }

  const metrics = controller.getMetrics();
  assert.equal(
    metrics.stateMutationCount,
    CORPUS_DIAGNOSTIC_RETENTION_LIMITS.stateMutations + 1,
  );
  assert.equal(metrics.stateMutationsRetained, CORPUS_DIAGNOSTIC_RETENTION_LIMITS.stateMutations);
  assert.equal(metrics.stateMutationsDropped, 1);
  assert.equal(metrics.deviceErrorCount, CORPUS_DIAGNOSTIC_RETENTION_LIMITS.deviceErrors + 1);
  assert.equal(metrics.deviceErrorsRetained, CORPUS_DIAGNOSTIC_RETENTION_LIMITS.deviceErrors);
  assert.equal(metrics.deviceErrorsDropped, 1);
  assert.equal(metrics.deviceErrors[0].sequence, 2);
  assert.equal(metrics.deviceErrors.at(-1).sequence, metrics.deviceErrorCount);
  assert.equal(metrics.resourceTransitionsRetained, CORPUS_DIAGNOSTIC_RETENTION_LIMITS.resourceTransitions);
  assert(metrics.resourceTransitionsDropped > 0);

  const resources = controller.describeResources();
  assert.equal(
    resources.lifecycle.stateMutationRetention.retained,
    CORPUS_DIAGNOSTIC_RETENTION_LIMITS.stateMutations,
  );
  assert.equal(resources.lifecycle.stateMutations[0].sequence, 2);
  assert.equal(
    resources.lifecycle.stateMutations.at(-1).sequence,
    resources.lifecycle.stateMutationCount,
  );
  assert.equal(
    resources.lifecycle.resourceTransitionRetention.retained,
    CORPUS_DIAGNOSTIC_RETENTION_LIMITS.resourceTransitions,
  );
  assert.equal(
    resources.lifecycle.resourceTransitions[0].sequence,
    resources.lifecycle.resourceTransitionRetention.dropped + 1,
  );
  assert.equal(
    resources.lifecycle.resourceTransitions.at(-1).sequence,
    resources.lifecycle.resourceTransitionSequence,
  );
  assert.equal(resources.lifecycle.allocationReconciled, true);
  assert.equal(resources.lifecycle.allocationLeakFree, true);
  assert.equal(resources.lifecycle.allocationEquilibrium, true);
  let teardown = controller.getTeardownReport();
  assert.equal(teardown.attempted, CORPUS_DIAGNOSTIC_RETENTION_LIMITS.teardownRecords + 1);
  assert.equal(teardown.retention.retained, CORPUS_DIAGNOSTIC_RETENTION_LIMITS.teardownRecords);
  assert.equal(teardown.retention.dropped, 1);
  assert.equal(teardown.records[0].sequence, 2);
  assert.equal(teardown.records.at(-1).sequence, teardown.attempted);
  assert.equal(await controller.dispose(), true);
  teardown = controller.getTeardownReport();
  assert.equal(teardown.retention.retained, CORPUS_DIAGNOSTIC_RETENTION_LIMITS.teardownRecords);
  assert.equal(teardown.records[0].sequence, teardown.retention.dropped + 1);
  assert.equal(teardown.records.at(-1).sequence, teardown.attempted);
}

{
  const harness = createHarness({ timestampQuerySupported: true });
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    subjectId: "articulated-desk-lamp",
    runtimeProfile: "performance",
    timestampQueriesRequired: true,
    dependencies: harness.dependencies,
  });
  const gpuObserved = CORPUS_DIAGNOSTIC_RETENTION_LIMITS.gpuTimestampSamples + 1;
  for (let index = 0; index < gpuObserved; index += 1) {
    await controller.renderOnce();
    await controller.resolveGpuTimestampSample();
  }
  const cpuObserved = CORPUS_DIAGNOSTIC_RETENTION_LIMITS.cpuRenderSubmissions + 5;
  for (let index = gpuObserved; index < cpuObserved; index += 1) {
    await controller.renderOnce();
  }
  const metrics = controller.getMetrics();
  assert.equal(metrics.gpuTimestampSampleCount, gpuObserved);
  assert.equal(
    metrics.gpuTimestampSamplesRetained,
    CORPUS_DIAGNOSTIC_RETENTION_LIMITS.gpuTimestampSamples,
  );
  assert.equal(metrics.gpuTimestampSamplesDropped, 1);
  assert.equal(metrics.lastGpuTimestampSample.sampleOrdinal, gpuObserved);
  assert.equal(metrics.cpuRenderSubmissionSampleCount, cpuObserved);
  assert.equal(
    metrics.cpuRenderSubmissionSamplesRetained,
    CORPUS_DIAGNOSTIC_RETENTION_LIMITS.cpuRenderSubmissions,
  );
  assert.equal(metrics.cpuRenderSubmissionSamplesDropped, 5);
  assert.equal(metrics.lastCpuRenderSubmissionSample.sampleOrdinal, cpuObserved);
  const evidence = controller.getPerformanceEvidence();
  assert.equal(evidence.samples.length, CORPUS_DIAGNOSTIC_RETENTION_LIMITS.gpuTimestampSamples);
  assert.equal(evidence.cpuRenderSubmissions.length, CORPUS_DIAGNOSTIC_RETENTION_LIMITS.cpuRenderSubmissions);
  assert.deepEqual(evidence.retention.gpuTimestampSamples, {
    limit: CORPUS_DIAGNOSTIC_RETENTION_LIMITS.gpuTimestampSamples,
    observed: gpuObserved,
    retained: CORPUS_DIAGNOSTIC_RETENTION_LIMITS.gpuTimestampSamples,
    dropped: 1,
  });
  assert.deepEqual(evidence.retention.cpuRenderSubmissions, {
    limit: CORPUS_DIAGNOSTIC_RETENTION_LIMITS.cpuRenderSubmissions,
    observed: cpuObserved,
    retained: CORPUS_DIAGNOSTIC_RETENTION_LIMITS.cpuRenderSubmissions,
    dropped: 5,
  });
  await controller.dispose();
}

{
  const harness = createHarness({
    timestampQuerySupported: true,
    actualTimestampQuerySupported: false,
  });
  await assert.rejects(
    createObjectSculptorCorpusController({
      canvas: {},
      subjectId: "potted-bonsai",
      runtimeProfile: "performance",
      timestampQueriesRequired: true,
      dependencies: harness.dependencies,
    }),
    /not realized on the initialized renderer backend device/,
  );
  assert.equal(harness.renderer.initCalls, 1);
  assert.equal(harness.renderer.disposeCalls, 1);
}

{
  const harness = createHarness({ timestampQuerySupported: true, gpuTimestampMs: Number.NaN });
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    subjectId: "potted-bonsai",
    runtimeProfile: "performance",
    timestampQueriesRequired: true,
    dependencies: harness.dependencies,
  });
  await controller.renderOnce();
  await assert.rejects(
    controller.resolveGpuTimestampSample(),
    (error) => (
      error.code === "CORPUS_GPU_TIMESTAMP_UNAVAILABLE"
      && /non-finite or negative duration/.test(error.message)
    ),
  );
  const evidence = controller.getPerformanceEvidence();
  assert.equal(evidence.samples.length, 0);
  assert.equal(evidence.failures.length, 1);
  assert.equal(evidence.failures[0].submissionOrdinal, 1);
  assert.equal(evidence.failures[0].rendererDeviceGeneration, 1);
  assert.equal(
    controller.getMetrics().performanceAcceptance,
    "insufficient-required-gpu-timestamp-resolution",
  );
  await controller.dispose();
}

{
  const harness = createHarness({ timestampQuerySupported: true });
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    subjectId: "ceramic-teapot",
    runtimeProfile: "performance",
    timestampQueriesRequired: true,
    dependencies: harness.dependencies,
  });
  harness.failGpuTimestampResolve();
  await controller.renderOnce();
  await assert.rejects(
    controller.resolveGpuTimestampSample(),
    /timestamp freshness is unverified/,
  );
  assert.equal(controller.getMetrics().gpuTimestampResolveFailures, 1);
  assert.equal(controller.getMetrics().gpuTimestampSampleCount, 0);
  assert.equal(controller.getPerformanceEvidence().failures[0].coveredSubmissionCount, 1);
  assert.equal(
    controller.getPerformanceEvidence().failures[0].queryPoolEvidence.freshnessStatus,
    "unverified-insufficient-query-pool-evidence",
    "a caught Three r185 resolve failure returning cached lastValue must never become measured",
  );
  await controller.dispose();
}

{
  const harness = createHarness({ timestampQuerySupported: true });
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    subjectId: "articulated-desk-lamp",
    runtimeProfile: "performance",
    timestampQueriesRequired: true,
    dependencies: harness.dependencies,
  });
  await controller.renderOnce();
  await controller.renderOnce();
  await assert.rejects(
    controller.resolveGpuTimestampSample(),
    /covered 2 render submissions; exactly one is required/,
  );
  assert.equal(controller.getPerformanceEvidence().failures[0].coveredSubmissionCount, 2);
  assert.equal(harness.timestampScopes.length, 1, "aggregate scopes must still be drained before rejection");
  await controller.dispose();
}

{
  const harness = createHarness({ timestampQuerySupported: false });
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    subjectId: "potted-bonsai",
    runtimeProfile: "performance",
    dependencies: harness.dependencies,
  });
  assert.equal(harness.rendererOptions.trackTimestamp, false);
  assert.equal(controller.getMetrics().timestampQueriesRequested, false);
  assert.match(controller.getMetrics().timingMethod, /no-gpu-duration/);
  await controller.dispose();
}

{
  const harness = createHarness({ timestampQuerySupported: true });
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    width: 16,
    height: 16,
    subjectId: "ceramic-teapot",
    runtimeProfile: "performance",
    timestampQueriesRequired: true,
    dependencies: harness.dependencies,
  });
  await controller.capturePixels("presentation");
  await assert.rejects(
    controller.resolveGpuTimestampSample(),
    /requires presentation-forward-scene, received capture-forward-scene/,
  );
  assert.equal(controller.getMetrics().gpuTimestampSampleCount, 0);
  assert.equal(controller.getPerformanceEvidence().failures[0].renderPhase, "capture-forward-scene");
  await controller.dispose();
}

{
  const harness = createHarness({ timestampQuerySupported: false });
  await assert.rejects(
    createObjectSculptorCorpusController({
      canvas: {},
      subjectId: "potted-bonsai",
      runtimeProfile: "performance",
      timestampQueriesRequired: true,
      dependencies: harness.dependencies,
    }),
    /requires WebGPU timestamp-query support/,
  );
  assert.equal(harness.renderer.initCalls, 0, "required timestamp capability failure must occur before renderer initialization");
}

{
  const harness = createHarness({ noOpMotion: true });
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    subjectId: "potted-bonsai",
    mode: "action-ready",
    dependencies: harness.dependencies,
  });
  await assert.rejects(
    controller.step(0.25),
    /no measured rest-to-current transform delta/,
    "a no-op action-ready target must fail the runtime motion witness",
  );
  assert.equal(controller.getMetrics().time, 0);
  assert.equal(controller.getMetrics().motionWitness.status, "awaiting-pose-delta");
  await controller.dispose();
}

{
  const harness = createHarness({ fixedOffsetMotion: true });
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    subjectId: "articulated-desk-lamp",
    mode: "action-ready",
    dependencies: harness.dependencies,
  });
  await assert.rejects(
    controller.step(0.25),
    /rest offset but no adjacent-time transform delta/,
    "a fixed authored offset must not masquerade as live animation",
  );
  assert.equal(controller.getMetrics().time, 0);
  assert.equal(controller.getMetrics().motionWitness.status, "awaiting-pose-delta");
  await controller.dispose();
}

{
  const harness = createHarness();
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    subjectId: "potted-bonsai",
    dependencies: harness.dependencies,
  });
  const gate = harness.deferTargetCreation("articulated-desk-lamp");
  const operation = controller.setSubject("articulated-desk-lamp");
  await gate.entered;
  harness.replaceRendererDeviceSilently("replacement-during-target-create");
  gate.release();
  await assert.rejects(
    operation,
    (error) => error.code === "CORPUS_DEVICE_GENERATION_CHANGED"
      && error.rendererDeviceIdentityMatched === false,
  );
  const metrics = controller.getMetrics();
  assert.equal(metrics.subjectId, "potted-bonsai");
  assert.equal(metrics.rendererDeviceGeneration, 1);
  assert.equal(metrics.deviceLossGeneration, 0);
  assert.equal(metrics.lifecycleAcceptanceStatus, "invalid-renderer-device-generation-change");
  assert.equal(metrics.untrackedCandidateAllocations, 1);
  assert.equal(metrics.untrackedCandidateDisposals, 1);
  assert.equal(harness.targetLiveCount, 1, "deferred uncommitted candidate must be cleaned up");
  assert.equal(await controller.dispose(), true);
}

{
  const harness = createHarness();
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    width: 13,
    height: 7,
    subjectId: "ceramic-teapot",
    dependencies: harness.dependencies,
  });
  const gate = harness.deferReadback();
  const operation = controller.capturePixels("presentation");
  await gate.entered;
  harness.replaceRendererDeviceSilently("replacement-during-readback");
  gate.release();
  await assert.rejects(
    operation,
    (error) => error.code === "CORPUS_DEVICE_GENERATION_CHANGED"
      && /capture-readback-result/.test(error.message),
  );
  assert.equal(controller.describeResources().readbackStaging, null);
  assert.equal(controller.getMetrics().completedFrames, 1);
  assert.equal(controller.getMetrics().captureTargetRestoreFailures, 0);
  assert.equal(controller.getMetrics().acceptingControllerOperations, false);
  assert.equal(await controller.dispose(), true);
}

{
  const harness = createHarness({ timestampQuerySupported: true });
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    subjectId: "articulated-desk-lamp",
    runtimeProfile: "performance",
    timestampQueriesRequired: true,
    cameraInteractionEnabled: false,
    dependencies: harness.dependencies,
  });
  await controller.renderOnce();
  const gate = harness.deferTimestampResolve();
  const operation = controller.resolveGpuTimestampSample();
  await gate.entered;
  harness.replaceRendererDeviceSilently("replacement-during-timestamp-resolve");
  gate.release();
  await assert.rejects(
    operation,
    (error) => error.code === "CORPUS_DEVICE_GENERATION_CHANGED"
      && /timestamp-resolve-result/.test(error.message),
  );
  assert.equal(controller.getMetrics().gpuTimestampSampleCount, 0);
  assert.equal(controller.getMetrics().gpuTimestampResolveAttempts, 1);
  assert.equal(controller.getMetrics().acceptingControllerOperations, false);
  assert.equal(await controller.dispose(), true);
}

{
  const harness = createHarness();
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    subjectId: "potted-bonsai",
    mode: "action-ready",
    dependencies: harness.dependencies,
  });
  harness.loseDeviceDuringTargetTime();
  await assert.rejects(
    controller.setTime(0.25),
    (error) => error.code === "CORPUS_DEVICE_GENERATION_CHANGED"
      && /time-target-time/.test(error.message),
  );
  const metrics = controller.getMetrics();
  assert.equal(metrics.time, 0, "device loss during target mutation must not commit controller time");
  assert.equal(metrics.rendererDeviceStatus, "lost");
  assert.equal(metrics.deviceLossGeneration, 1);
  assert.equal(metrics.acceptingControllerOperations, false);
  await assert.rejects(controller.setCamera("profile"), /stopped after WebGPU device loss/);
  assert.equal(await controller.dispose(), true);
}

{
  const harness = createHarness();
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    subjectId: "ceramic-teapot",
    dependencies: harness.dependencies,
  });
  harness.loseDeviceDuringRender();
  await assert.rejects(
    controller.renderOnce(),
    (error) => error.code === "CORPUS_DEVICE_GENERATION_CHANGED"
      && /render-completion-commit/.test(error.message),
  );
  const metrics = controller.getMetrics();
  assert.equal(metrics.renderSubmissions, 1);
  assert.equal(metrics.completedFrames, 0, "device loss during render must not publish a completed frame");
  assert.equal(metrics.cpuRenderSubmissionSampleCount, 1);
  assert.equal(metrics.lastCpuRenderSubmissionSample.status, "invalid-device-generation-changed");
  assert.equal(metrics.rendererDeviceStatus, "lost");
  assert.equal(await controller.dispose(), true);
}

{
  const harness = createHarness();
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    subjectId: "ceramic-teapot",
    dependencies: harness.dependencies,
  });
  harness.emitUncapturedGpuError();
  let metrics = controller.getMetrics();
  assert.equal(metrics.rendererDeviceStatus, "active");
  assert.equal(metrics.deviceErrorCount, 1);
  assert.equal(metrics.lastDeviceError.kind, "uncaptured-gpu-error");
  assert.equal(metrics.performanceAcceptance, "invalid-uncaptured-gpu-error");
  assert.equal(await controller.setCamera("profile"), true, "uncaptured error is recorded without inventing device loss");

  harness.emitDeviceLoss();
  metrics = controller.getMetrics();
  assert.equal(metrics.rendererDeviceStatus, "lost");
  assert.equal(metrics.deviceLossGeneration, 1);
  assert.equal(metrics.lastDeviceError.kind, "device-lost");
  assert.equal(metrics.lastDeviceError.deviceLossGeneration, 1);
  assert.equal(metrics.frameOwnerStatus, "stopped-device-lost");
  assert.equal(metrics.performanceAcceptance, "invalid-device-lost");
  assert.equal(metrics.acceptingControllerOperations, false);
  await assert.rejects(controller.renderOnce(), /stopped after WebGPU device loss/);
  assert.equal(await controller.dispose(), true);
}

{
  const harness = createHarness();
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    subjectId: "potted-bonsai",
    dependencies: harness.dependencies,
  });
  harness.failTargetDispose("potted-bonsai");
  harness.failControlsDispose();
  harness.failRendererDispose();
  await assert.rejects(
    controller.dispose(),
    (error) => {
      assert(error instanceof AggregateError);
      assert.equal(error.errors.length, 3);
      assert.match(error.message, /teardown completed with uncertain resources/);
      return true;
    },
  );
  const report = controller.getTeardownReport();
  assert.equal(report.attempted, 5);
  assert.equal(report.succeeded, 2);
  assert.equal(report.uncertain, 3);
  assert.deepEqual(
    report.records.filter((record) => record.status === "uncertain").map((record) => record.resourceId),
    ["potted-bonsai/active-preview", "orbit-controls", "renderer"],
  );
  assert.equal(harness.controlsDisposals, 1);
  assert.equal(harness.renderer.disposeCalls, 1);
}

{
  const harness = createHarness();
  let releaseRender;
  let enterRender;
  const renderEntered = new Promise((resolve) => {
    enterRender = resolve;
  });
  const renderGate = new Promise((resolve) => {
    releaseRender = resolve;
  });
  harness.renderer.render = async () => {
    enterRender();
    await renderGate;
    harness.renderer.renderCalls += 1;
  };
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    subjectId: "ceramic-teapot",
    dependencies: harness.dependencies,
  });
  const renderPromise = controller.renderOnce();
  await renderEntered;
  const disposePromise = controller.dispose();
  assert.equal(harness.renderer.disposeCalls, 0, "dispose must wait for the in-flight render lane");
  await assert.rejects(controller.setCamera("attachment"), /controller is closing/);
  releaseRender();
  await renderPromise;
  assert.equal(await disposePromise, true);
  assert.equal(harness.renderer.disposeCalls, 1);
  assert.equal(harness.targetLiveCount, 0);
}

{
  const harness = createHarness();
  await assert.rejects(
    createObjectSculptorCorpusController({
      canvas: {},
      runtimeProfile: "unknown",
      dependencies: harness.dependencies,
    }),
    /Unknown corpus runtime profile/,
  );
}

{
  const harness = createHarness({ timestampQuerySupported: true });
  await assert.rejects(
    createObjectSculptorCorpusController({
      canvas: {},
      runtimeProfile: "correctness",
      performanceTimestampMode: "disabled-for-cadence",
      dependencies: harness.dependencies,
    }),
    /only configurable for the performance runtime profile/,
  );
  await assert.rejects(
    createObjectSculptorCorpusController({
      canvas: {},
      runtimeProfile: "performance",
      performanceTimestampMode: "disabled-for-cadence",
      timestampQueriesRequired: true,
      dependencies: harness.dependencies,
    }),
    /conflicts with disabled-for-cadence/,
  );
}

{
  const harness = createHarness({ nativeWebGPU: false });
  await assert.rejects(
    createObjectSculptorCorpusController({
      canvas: {},
      subjectId: "potted-bonsai",
      mode: "action-ready",
      tier: "budgeted",
      camera: "design",
      dependencies: harness.dependencies,
    }),
    /Native WebGPU is required/,
  );
  assert.equal(harness.factoryCalls.length, 0, "backend failure must occur before any target allocation");
  assert.equal(harness.renderer.disposeCalls, 1);
}

console.log(JSON.stringify({
  ok: true,
  lifecycleCases: [
    "initial-state-before-allocation",
    "same-state-idempotence",
    "stable-instance-tier-rebuild",
    "tier-continuity-generation-preserved",
    "seed-continuity-generation-incremented",
    "cross-subject-transaction",
    "same-subject-reconstructive-rollback",
    "failed-candidate-disposal",
    "malformed-candidate-successful-and-uncertain-teardown-ledger",
    "failing-malformed-candidate-exact-allocation-transitions",
    "pre-inspection-target-allocation-transition",
    "prepare-commit-publication-gates",
    "camera-plan-failure-rollback",
    "shadow-plan-failure-rollback",
    "prior-dispose-uncertainty-stops-owner",
    "rollback-failure-aggregation-and-fail-closed-owner",
    "silent-partial-target-and-presentation-rollback-postconditions",
    "one-render-submission",
    "aligned-native-readback",
    "distinct-transport-and-normalized-readback-bytes",
    "top-left-asymmetric-row-order",
    "fresh-zero-padded-offset-and-fully-padded-normalization",
    "minimum-padded-webgpu-readback-accounting",
    "capture-target-restoration-failure-aggregation",
    "nonnull-and-silent-noop-render-target-restoration-identity",
    "aspect-safe-semantic-camera-framing",
    "unclamped-portrait-camera-actual-pose",
    "fixed-route-controls-disabled",
    "immutable-authored-shadow-caster-inventory",
    "measured-motion-witness-no-op-and-fixed-offset-negative-controls",
    "tiered-shadow-and-invariant-antialias-policy",
    "pre-init-and-initialized-device-performance-profiles",
    "serialized-render-timestamp-samples",
    "bounded-cpu-and-gpu-diagnostic-retention",
    "bounded-device-resource-state-teardown-and-gpu-failure-retention",
    "query-pool-context-uid-freshness-proof",
    "cached-stale-timestamp-negative-control",
    "timestamp-nonfinite-throw-and-aggregate-negative-controls",
    "exact-logical-resource-inventory-and-equilibrium",
    "transactional-tier-and-resize-resolution-rollback",
    "tier-shadow-invalidation-never-resurrects-disposed-map",
    "resolution-rollback-failure-stops-owner",
    "device-loss-and-uncaptured-error-monitoring",
    "device-loss-generation-races-block-state-and-frame-commits",
    "deferred-create-readback-timestamp-actual-device-identity-races",
    "preoperation-backend-device-identity-drift-rejection",
    "reconciled-versus-leak-free-uncertain-resource-accounting",
    "all-resource-teardown-ledger",
    "serialized-controller-close-drain",
    "native-backend-failure",
  ],
}, null, 2));
