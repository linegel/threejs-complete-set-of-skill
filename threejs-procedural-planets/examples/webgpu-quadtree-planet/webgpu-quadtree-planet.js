import {
  HalfFloatType,
  RenderPipeline,
  StorageInstancedBufferAttribute,
  WebGPURenderer,
} from "three/webgpu";
import { mrt, output, packNormalToRGB, pass, renderOutput, velocity } from "three/tsl";
import GTAONode from "three/examples/jsm/tsl/display/GTAONode.js";
import BloomNode from "three/examples/jsm/tsl/display/BloomNode.js";
import TRAANode from "three/examples/jsm/tsl/display/TRAANode.js";
import { CSMShadowNode } from "three/examples/jsm/csm/CSMShadowNode.js";
import { TileShadowNode } from "three/examples/jsm/tsl/shadows/TileShadowNode.js";

import { createPlanetConfig, validatePlanetConfig } from "./planet-config.js";
import { createPlanetDebugRegistry } from "./debug-views.js";
import { createPatchComputeDescriptors } from "./patch-compute.js";
import { createRootPatches } from "./planet-quadtree.js";

export const NODE_POST_IMPORTS = Object.freeze({
  GTAONode: "three/examples/jsm/tsl/display/GTAONode.js",
  BloomNode: "three/examples/jsm/tsl/display/BloomNode.js",
  TRAANode: "three/examples/jsm/tsl/display/TRAANode.js",
  CSMShadowNode: "three/examples/jsm/csm/CSMShadowNode.js",
  TileShadowNode: "three/examples/jsm/tsl/shadows/TileShadowNode.js",
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
    this.disposeCounters = { patchBuffers: 0, pipelines: 0, diagnostics: 0 };
  }

  async initialize(renderer) {
    await renderer.init();
    this.backendTier = renderer.backend?.isWebGPUBackend ? "full" : "reduced";
    this.pipeline = new RenderPipeline(renderer);
    this.pipeline.outputColorTransform = true;
    return this;
  }

  createPassGraph() {
    return {
      renderer: "WebGPURenderer",
      rendererInit: "await renderer.init()",
      scenePass: "pass(scene, camera)",
      mrt: "mrt({ output, normal: packNormalToRGB(normalView), velocity })",
      outputNode: "renderOutput(colorNode)",
      outputOwner: "RenderPipeline.outputColorTransform",
      builtIns: [GTAONode.name, BloomNode.name, TRAANode.name, CSMShadowNode.name, TileShadowNode.name],
      imports: NODE_POST_IMPORTS,
      tsl: { mrt, output, packNormalToRGB, pass, renderOutput, velocity },
    };
  }

  createComputePlan() {
    return createPatchComputeDescriptors(this.patches);
  }

  resize(width, height) {
    this.size = { width, height };
  }

  dispose() {
    this.patchInstances = null;
    this.disposeCounters.patchBuffers += 1;
    if (this.pipeline) {
      this.pipeline.dispose?.();
      this.disposeCounters.pipelines += 1;
    }
  }
}
