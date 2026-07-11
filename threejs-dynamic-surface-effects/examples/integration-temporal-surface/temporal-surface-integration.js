import {
  FROST_QUALITY_TIERS,
  createTouchHistoryFrostCompositeNode,
  createTouchHistoryFrostComputeStage,
} from "../webgpu-touch-history-frost/frost-surface-effect.js";

const REQUIRED_OWNER_KEYS = Object.freeze([
  "renderer",
  "scenePass",
  "temporalHistory",
  "jitter",
  "toneMap",
  "outputTransform",
]);

function validateHost(host) {
  if (!host || typeof host !== "object") throw new TypeError("a temporal image-pipeline host is required");
  if (!host.ownerId || typeof host.ownerId !== "string") throw new TypeError("host.ownerId is required");
  if (host.renderer?.backend?.isWebGPUBackend !== true) {
    throw new Error("the host must provide an initialized native-WebGPU renderer");
  }
  if (!host.renderPipeline || host.renderPipeline.renderer !== host.renderer) {
    throw new Error("the host must own one RenderPipeline bound to its renderer");
  }
  if (!host.scenePass || host.sceneSubmissionCount !== 1) {
    throw new Error("temporal-surface integration requires exactly one host scene submission");
  }
  if (!host.signals?.sceneColor || !host.signals?.depth || !host.signals?.velocity || !host.signals?.camera) {
    throw new Error("host scene color, depth, velocity, and camera signal identities are required");
  }
  if (host.scenePass.getTextureNode?.("output") !== host.signals.sceneColor
    || host.scenePass.getTextureNode?.("depth") !== host.signals.depth
    || host.scenePass.getTextureNode?.("velocity") !== host.signals.velocity) {
    throw new Error("temporal-surface consumers must use the host scene-pass signal identities");
  }
  if (host.scenePass.camera !== host.signals.camera) {
    throw new Error("temporal-surface camera identity must match the host scene pass");
  }
  if (!host.resetRegistry || typeof host.resetRegistry.record !== "function") {
    throw new Error("the host temporal reset registry is required");
  }
  if (typeof host.registerSceneLinearStage !== "function") {
    throw new Error("the host must install scene-linear stages through its own graph owner");
  }
  for (const key of REQUIRED_OWNER_KEYS) {
    if (host.owners?.[key] !== host.ownerId) throw new Error(`host must be the sole ${key} owner`);
  }
  if (host.finalToneMapOwner !== host.ownerId || host.finalOutputTransformOwner !== host.ownerId) {
    throw new Error("tone-map and output-transform ownership must remain with the temporal host");
  }
  if (!Number.isInteger(host.physicalWidth) || !Number.isInteger(host.physicalHeight)
    || host.physicalWidth <= 0 || host.physicalHeight <= 0) {
    throw new RangeError("host physical dimensions must be positive integers");
  }
  return host;
}

function ownershipSnapshot(host) {
  return Object.freeze({
    renderer: host.renderer,
    renderPipeline: host.renderPipeline,
    outputNode: host.renderPipeline.outputNode,
    outputColorTransform: host.renderPipeline.outputColorTransform,
    finalToneMapOwner: host.finalToneMapOwner,
    finalOutputTransformOwner: host.finalOutputTransformOwner,
    resetRegistry: host.resetRegistry,
  });
}

function assertOwnershipStable(host, snapshot) {
  if (host.renderer !== snapshot.renderer || host.renderPipeline !== snapshot.renderPipeline) {
    throw new Error("renderer or RenderPipeline owner changed after temporal-surface integration");
  }
  if (host.renderPipeline.outputNode !== snapshot.outputNode
    || host.renderPipeline.outputColorTransform !== snapshot.outputColorTransform) {
    throw new Error("temporal-surface integration must not mutate the host output graph");
  }
  if (host.finalToneMapOwner !== snapshot.finalToneMapOwner
    || host.finalOutputTransformOwner !== snapshot.finalOutputTransformOwner) {
    throw new Error("temporal-surface integration must not mutate final color ownership");
  }
  if (host.resetRegistry !== snapshot.resetRegistry) {
    throw new Error("temporal-surface integration must use the host reset registry identity");
  }
}

export async function createTemporalSurfaceIntegration({ host, tier = "balanced" } = {}) {
  validateHost(host);
  const tierConfig = FROST_QUALITY_TIERS[tier];
  if (!tierConfig) throw new RangeError(`unknown frost tier "${tier}"`);
  const snapshot = ownershipSnapshot(host);
  const computeStage = await createTouchHistoryFrostComputeStage({
    renderer: host.renderer,
    width: host.physicalWidth,
    height: host.physicalHeight,
    tier,
  });
  const compositeStage = createTouchHistoryFrostCompositeNode({
    sceneColorNode: host.signals.sceneColor,
    historyNode: computeStage.historyNode,
    width: host.physicalWidth,
    height: host.physicalHeight,
    tier,
  });
  const registration = host.registerSceneLinearStage({
    id: "integration-temporal-surface",
    owner: host.ownerId,
    inputNode: host.signals.sceneColor,
    outputNode: compositeStage.outputNode,
    order: "after-host-scene-radiance-before-host-tone-map",
    featureLocalHistory: computeStage.historyNode,
    hostDepth: host.signals.depth,
    hostVelocity: host.signals.velocity,
    hostCamera: host.signals.camera,
  });
  if (!registration || typeof registration.dispose !== "function") {
    compositeStage.dispose();
    computeStage.dispose();
    throw new Error("host stage registration must return a disposable registration");
  }
  assertOwnershipStable(host, snapshot);

  let disposed = false;
  let resetCount = 0;
  const metrics = {
    computeUpdates: 0,
    hostRenderCalls: 0,
    privateScenePasses: 0,
    outputMutations: 0,
  };

  function update({
    deltaSeconds,
    segmentStart = { x: 0.5, y: 0.5 },
    segmentEnd = segmentStart,
    pressure = 0,
    active = false,
  } = {}) {
    if (disposed) throw new Error("temporal-surface integration is disposed");
    assertOwnershipStable(host, snapshot);
    const result = computeStage.update({
      deltaSeconds,
      segmentStart,
      segmentEnd,
      pressure,
      active,
      render: false,
    });
    metrics.computeUpdates += deltaSeconds > 0 ? 1 : 0;
    assertOwnershipStable(host, snapshot);
    return { ...result, ...getMetrics() };
  }

  function resetHistory(cause) {
    if (disposed) throw new Error("temporal-surface integration is disposed");
    if (!cause || typeof cause !== "string") throw new TypeError("history reset cause is required");
    assertOwnershipStable(host, snapshot);
    computeStage.effect.setSize(
      computeStage.effect.displayWidth,
      computeStage.effect.displayHeight,
      { clearHistory: true },
    );
    host.resetRegistry.record({
      consumer: "integration-temporal-surface",
      cause,
      policy: "clear-both-feature-local-history-slots",
    });
    resetCount += 1;
    assertOwnershipStable(host, snapshot);
  }

  function resize(physicalWidth, physicalHeight) {
    if (!Number.isInteger(physicalWidth) || !Number.isInteger(physicalHeight)
      || physicalWidth <= 0 || physicalHeight <= 0) {
      throw new RangeError("physical dimensions must be positive integers");
    }
    assertOwnershipStable(host, snapshot);
    computeStage.resize(physicalWidth, physicalHeight);
    compositeStage.setSize(physicalWidth, physicalHeight);
    host.resetRegistry.record({
      consumer: "integration-temporal-surface",
      cause: "resize",
      policy: "clear-both-feature-local-history-slots",
    });
    resetCount += 1;
    assertOwnershipStable(host, snapshot);
  }

  function describePipeline() {
    return {
      owners: {
        ...host.owners,
        surfaceHistory: "integration-temporal-surface",
      },
      sharedSignalIdentity: {
        sceneColor: registration.inputNode === host.signals.sceneColor,
        depth: registration.hostDepth === host.signals.depth,
        velocity: registration.hostVelocity === host.signals.velocity,
        camera: registration.hostCamera === host.signals.camera,
        resetRegistry: host.resetRegistry === snapshot.resetRegistry,
      },
      sceneSubmissions: [{ id: "host-primary-scene-pass", owner: host.ownerId, count: 1 }],
      computeDispatches: [{ id: "feature-local-frost-history", owner: "integration-temporal-surface" }],
      finalToneMapOwner: host.finalToneMapOwner,
      finalOutputTransformOwner: host.finalOutputTransformOwner,
      adapterOwnership: { renderer: false, renderPipeline: false, scenePass: false, output: false },
      temporalPolicy: "viewport-locked feature history resets on host discontinuities; it does not replace host color history",
    };
  }

  function getMetrics() {
    return {
      ...metrics,
      resetCount,
      tier: tierConfig.id,
      hostOutputStable: host.renderPipeline.outputNode === snapshot.outputNode,
      storageBytes: computeStage.effect.createResourcePlan().storageBytes.total,
    };
  }

  function dispose() {
    if (disposed) return;
    assertOwnershipStable(host, snapshot);
    registration.dispose();
    compositeStage.dispose();
    computeStage.dispose();
    disposed = true;
    assertOwnershipStable(host, snapshot);
  }

  return {
    id: "integration-temporal-surface",
    host,
    computeStage,
    compositeStage,
    registration,
    ownership: Object.freeze({ renderer: false, renderPipeline: false, scenePass: false, output: false }),
    update,
    resetHistory,
    resize,
    describePipeline,
    getMetrics,
    dispose,
  };
}
