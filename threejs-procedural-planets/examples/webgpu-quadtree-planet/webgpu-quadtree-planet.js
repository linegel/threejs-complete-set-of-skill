import {
  HalfFloatType,
  RenderPipeline,
  StorageInstancedBufferAttribute,
  WebGPURenderer,
} from "three/webgpu";
import { mrt, output, packNormalToRGB, pass, renderOutput, velocity } from "three/tsl";
import GTAONode from "three/addons/tsl/display/GTAONode.js";
import BloomNode from "three/addons/tsl/display/BloomNode.js";
import TRAANode from "three/addons/tsl/display/TRAANode.js";
import { CSMShadowNode } from "three/addons/csm/CSMShadowNode.js";
import { TileShadowNode } from "three/addons/tsl/shadows/TileShadowNode.js";

import { createPlanetConfig, validatePlanetConfig } from "./planet-config.js";
import { createPlanetDebugRegistry } from "./debug-views.js";
import { createPatchComputeDescriptors } from "./patch-compute.js";
import { createRootPatches } from "./planet-quadtree.js";

export const NODE_POST_IMPORTS = Object.freeze({
  GTAONode: "three/addons/tsl/display/GTAONode.js",
  BloomNode: "three/addons/tsl/display/BloomNode.js",
  TRAANode: "three/addons/tsl/display/TRAANode.js",
  CSMShadowNode: "three/addons/csm/CSMShadowNode.js",
  TileShadowNode: "three/addons/tsl/shadows/TileShadowNode.js",
});

export function createPlanetRenderer({ canvas } = {}) {
  return new WebGPURenderer({
    canvas,
    antialias: false,
    outputBufferType: HalfFloatType,
  });
}

export class WebGPUQuadtreePlanet {
  constructor({ config = createPlanetConfig() } = {}) {
    const validation = validatePlanetConfig(config);
    if (!validation.ok) {
      throw new Error(validation.errors.join("\n"));
    }
    this.config = config;
    this.patches = createRootPatches();
    this.debugRegistry = createPlanetDebugRegistry();
    this.patchInstances = new StorageInstancedBufferAttribute(6 * 4, 4);
    this.patchSubmissionStatus = "storage allocation only; no draw or indirect submission";
    this.disposeCounters = { patchBuffers: 0, pipelines: 0, diagnostics: 0 };
  }

  async initialize(renderer) {
    await renderer.init();
    if (renderer.backend?.isWebGPUBackend !== true) {
      throw new Error("Canonical quadtree planet requires the native WebGPU backend");
    }
    this.backendTier = "native-webgpu";
    this.pipeline = new RenderPipeline(renderer);
    // renderOutput owns tone mapping and output conversion in the intended graph.
    this.pipeline.outputColorTransform = false;
    return this;
  }

  createPassGraph() {
    return {
      implementationStatus: "descriptor-only-not-rendered",
      renderer: "WebGPURenderer",
      rendererInit: "await renderer.init()",
      scenePass: "pass(scene, camera)",
      mrtDefault: "mrt({ output })",
      optionalAttachments: {
        normal:
          "packNormalToRGB(normalView), only after a proven downstream consumer and measured attachment cost",
        velocity:
          "velocity, only after a temporal consumer and reset/reprojection contract are implemented",
      },
      outputNode: "renderOutput(colorNode)",
      outputOwner: "renderOutput; RenderPipeline.outputColorTransform=false",
      builtIns: [GTAONode.name, BloomNode.name, TRAANode.name, CSMShadowNode.name, TileShadowNode.name],
      imports: NODE_POST_IMPORTS,
      tsl: { mrt, output, packNormalToRGB, pass, renderOutput, velocity },
      proofExclusions: [
        "no pass(scene,camera), MRT, post node, outputNode, or render call is constructed here",
        "normal and velocity attachments are optional descriptors, not default allocations",
        "import availability does not prove integration or visual correctness",
      ],
    };
  }

  createComputePlan() {
    return createPatchComputeDescriptors(this.patches);
  }

  resize(width, height) {
    this.size = { width, height };
  }

  dispose() {
    this.patchInstances?.dispose();
    this.patchInstances = null;
    this.disposeCounters.patchBuffers += 1;
    if (this.pipeline) {
      this.pipeline.dispose?.();
      this.disposeCounters.pipelines += 1;
    }
  }
}
