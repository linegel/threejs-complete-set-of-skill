import { PCFShadowMap, Vector2 } from "three/webgpu";
import { CSMShadowNode } from "three/addons/csm/CSMShadowNode.js";
import { TileShadowNode } from "three/addons/tsl/shadows/TileShadowNode.js";

import { CachedClipmapShadowNodeV2 } from "./cached-clipmap-shadow-node-v2.js";

export const SHADOW_ARCHITECTURES = Object.freeze([
  "bounded",
  "csm",
  "tiled",
  "cached",
]);

export function createShadowArchitectureOwner({ light, architecture, config }) {
  if (!SHADOW_ARCHITECTURES.includes(architecture)) {
    throw new RangeError(`unknown shadow architecture: ${architecture}`);
  }

  light.castShadow = true;
  light.shadow.mapSize.set(config.mapSizes[0], config.mapSizes[0]);
  light.shadow.camera.left = -config.firstRadius;
  light.shadow.camera.right = config.firstRadius;
  light.shadow.camera.top = config.firstRadius;
  light.shadow.camera.bottom = -config.firstRadius;
  light.shadow.camera.near = config.shadowNear;
  light.shadow.camera.far = config.shadowFarCap;
  light.shadow.camera.updateProjectionMatrix();

  if (architecture === "bounded") {
    light.shadow.autoUpdate = true;
    light.shadow.needsUpdate = true;
    return createOwnerRecord({
      architecture,
      node: null,
      light,
      config,
      dispose: () => light.shadow.dispose(),
    });
  }

  let node;
  if (architecture === "csm") {
    node = new CSMShadowNode(light, {
      cascades: Math.min(4, config.levelCount ?? 4),
      maxFar: config.shadowFarCap,
      mode: "practical",
      lightMargin: config.lightMargin,
    });
    node.fade = true;
  } else if (architecture === "tiled") {
    node = new TileShadowNode(light, {
      tilesX: 2,
      tilesY: 2,
      resolution: new Vector2(config.mapSizes[0], config.mapSizes[0]),
      debug: false,
    });
  } else {
    node = new CachedClipmapShadowNodeV2(light, config);
  }

  light.shadow.autoUpdate = architecture !== "cached";
  light.shadow.needsUpdate = architecture !== "cached";
  light.shadow.shadowNode = node;

  return createOwnerRecord({
    architecture,
    node,
    light,
    config,
    dispose: () => {
      if (light.shadow.shadowNode === node) delete light.shadow.shadowNode;
      node.dispose?.();
    },
  });
}

export function configureShadowRenderer(renderer) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.shadowMap.transmitted = false;
  if (renderer.reversedDepthBuffer === true) {
    throw new Error(
      "the canonical architecture comparison uses normal depth; stock r185 TileShadowNode reversed depth is rejected",
    );
  }
}

function createOwnerRecord({ architecture, node, light, config, dispose }) {
  let disposed = false;
  let lastFrameMetrics = emptyArchitectureFrameMetrics(architecture, -1);
  return {
    architecture,
    node,
    light,
    recordFrame(frameId) {
      lastFrameMetrics = measureArchitectureFrame({
        architecture,
        node,
        light,
        frameId,
      });
      return lastFrameMetrics;
    },
    describe() {
      const description = describeNodeArchitecture(
        node,
        architecture,
        light,
        config,
      );
      return {
        ...description,
        frameMetrics: { ...lastFrameMetrics },
        sceneSubmissionCount: lastFrameMetrics.sceneSubmissionCount,
        rendererInvocationCount: lastFrameMetrics.rendererInvocationCount,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      dispose();
    },
  };
}

function describeDefaultShadow(shadow, config) {
  const target = shadow.map ?? null;
  const width = target?.width ?? shadow.mapSize.width;
  const height = target?.height ?? shadow.mapSize.height;
  return [{
    level: 0,
    resident: target !== null,
    layers: 1,
    mapSize: [width, height],
    colorAttachment: target?.texture?.name ?? null,
    depthAttachment: target?.depthTexture?.name ?? null,
    colorFormat: target?.texture?.format ?? null,
    depthFormat: target?.depthTexture?.format ?? null,
    nominalBytes:
      width * height *
      (config.bytesPerColorTexel + config.bytesPerDepthTexel),
  }];
}

function describeNodeArchitecture(node, architecture, light, config) {
  if (architecture === "bounded") {
    const resources = describeDefaultShadow(light.shadow, config);
    return withResourceTotals({
      architecture,
      shadowViewCount: 1,
      backendLayerPassCount: 1,
      resources,
    });
  }
  if (architecture === "cached") {
    return {
      architecture,
      ...node.describePipeline(),
    };
  }
  if (architecture === "csm") {
    const resources = node._shadowNodes.map((child, level) => {
      const target = child.shadowMap ?? null;
      const width = target?.width ?? child.shadow.mapSize.width;
      const height = target?.height ?? child.shadow.mapSize.height;
      return {
        level,
        resident: target !== null,
        layers: 1,
        colorAttachment: target?.texture?.name ?? null,
        depthAttachment: target?.depthTexture?.name ?? null,
        colorFormat: target?.texture?.format ?? null,
        depthFormat: target?.depthTexture?.format ?? null,
        mapSize: [width, height],
        nominalBytes:
          width * height *
          (config.bytesPerColorTexel + config.bytesPerDepthTexel),
      };
    });
    return withResourceTotals({
      architecture,
      shadowViewCount: node._shadowNodes.length,
      backendLayerPassCount: node._shadowNodes.length,
      resources,
    });
  }
  const target = node.shadowMap ?? null;
  const layers = node.tiles.length;
  const width = target?.width ?? node.resolution?.x ?? config.mapSizes[0];
  const height = target?.height ?? node.resolution?.y ?? config.mapSizes[0];
  const resources = [{
    level: 0,
    resident: target !== null,
    layers,
    mapSize: [width, height],
    colorAttachment: target?.texture?.name ?? null,
    depthAttachment: target?.depthTexture?.name ?? null,
    colorFormat: target?.texture?.format ?? null,
    depthFormat: target?.depthTexture?.format ?? null,
    nominalBytes:
      width * height * layers *
      (config.bytesPerColorTexel + config.bytesPerDepthTexel),
  }];
  return withResourceTotals({
    architecture,
    tileCount: layers,
    shadowViewCount: layers,
    backendLayerPassCount: layers,
    resources,
  });
}

function withResourceTotals(description) {
  return {
    ...description,
    resourceTotals: {
      targetCount: description.resources.length,
      residentTargetCount: description.resources.filter(
        (resource) => resource.resident,
      ).length,
      nominalBytes: description.resources.reduce(
        (sum, resource) => sum + resource.nominalBytes,
        0,
      ),
      transientAndStagingBytes: null,
      transientAndStagingVerdict: "INSUFFICIENT_EVIDENCE",
    },
  };
}

function emptyArchitectureFrameMetrics(architecture, frameId) {
  return Object.freeze({
    scope: "single-render-frame",
    architecture,
    frameId,
    executed: false,
    provenance: "runtime-target-observation",
    sceneSubmissionCount: 0,
    rendererInvocationCount: 0,
    shadowViewCount: 0,
    backendLayerPassCount: 0,
    resourceTargetCount: 0,
    selectedLevelIndices: Object.freeze([]),
  });
}

function measureArchitectureFrame({ architecture, node, light, frameId }) {
  if (!Number.isInteger(frameId)) {
    throw new TypeError("architecture frame id must be an integer");
  }
  if (architecture === "cached") {
    const measured = node.lastFrameMetrics;
    return Object.freeze({
      ...measured,
      architecture,
      frameId,
      nodeRenderSerial: measured.frameId,
      nodeFrameId: measured.nodeFrameId,
      renderId: measured.renderId,
      selectedLevelIndices: Object.freeze([
        ...measured.selectedLevelIndices,
      ]),
    });
  }

  let residentTargetCount = 0;
  let shadowViewCount = 0;
  let rendererInvocationCount = 0;
  let backendLayerPassCount = 0;
  if (architecture === "bounded") {
    residentTargetCount = light.shadow.map ? 1 : 0;
    shadowViewCount = residentTargetCount;
    rendererInvocationCount = residentTargetCount;
    backendLayerPassCount = residentTargetCount;
  } else if (architecture === "csm") {
    residentTargetCount = node._shadowNodes.filter(
      (child) => child.shadowMap !== null,
    ).length;
    shadowViewCount = residentTargetCount;
    rendererInvocationCount = residentTargetCount;
    backendLayerPassCount = residentTargetCount;
  } else {
    residentTargetCount = node.shadowMap ? 1 : 0;
    shadowViewCount = node.shadowMap ? node.tiles.length : 0;
    rendererInvocationCount = node.shadowMap ? 1 : 0;
    backendLayerPassCount = shadowViewCount;
  }
  return Object.freeze({
    scope: "single-render-frame",
    architecture,
    frameId,
    executed: residentTargetCount > 0,
    provenance:
      "Derived-from-live-r185-shadow-targets-and-autoUpdate=true",
    sceneSubmissionCount: backendLayerPassCount,
    rendererInvocationCount,
    shadowViewCount,
    backendLayerPassCount,
    resourceTargetCount: residentTargetCount,
    selectedLevelIndices: Object.freeze([]),
  });
}

export function validateComparableFrameMetrics(metrics) {
  const errors = [];
  if (metrics?.scope !== "single-render-frame") {
    errors.push("frame metrics must use single-render-frame scope");
  }
  if (!Number.isInteger(metrics?.frameId)) {
    errors.push("frame metrics require an integer frameId");
  }
  if (typeof metrics?.executed !== "boolean") {
    errors.push("frame metrics require an executed boolean");
  }
  if (!/^(Authored|Derived|Measured|Gated)/.test(metrics?.provenance ?? "")) {
    errors.push("frame metrics require numeric provenance");
  }
  for (const field of [
    "sceneSubmissionCount",
    "rendererInvocationCount",
    "shadowViewCount",
    "backendLayerPassCount",
    "resourceTargetCount",
  ]) {
    if (!Number.isInteger(metrics?.[field]) || metrics[field] < 0) {
      errors.push(`${field} must be a nonnegative integer`);
    }
  }
  if (
    Number.isInteger(metrics?.sceneSubmissionCount) &&
    Number.isInteger(metrics?.backendLayerPassCount) &&
    metrics.sceneSubmissionCount !== metrics.backendLayerPassCount
  ) {
    errors.push("scene submissions must equal backend layer passes");
  }
  if (metrics?.executed === true && metrics?.sceneSubmissionCount === 0) {
    errors.push("an executed shadow frame cannot report zero scene submissions");
  }
  if (metrics?.executed === false && metrics?.sceneSubmissionCount > 0) {
    errors.push("a non-executed shadow frame cannot report scene submissions");
  }
  return { valid: errors.length === 0, errors };
}
