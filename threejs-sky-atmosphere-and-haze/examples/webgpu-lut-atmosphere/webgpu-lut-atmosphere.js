import {
  HalfFloatType,
  NoColorSpace,
  RGBAFormat,
  RenderPipeline,
  Storage3DTexture,
  StorageTexture,
  WebGPURenderer,
} from "three/webgpu";
import {
  Fn,
  mrt,
  pass,
  renderOutput,
  storageTexture,
  storageTexture3D,
  texture,
  texture3D,
  textureStore,
} from "three/tsl";

import {
  createAtmosphereConfig,
  createProductSchedule,
  estimateAtmosphereMemoryBytes,
  validateAtmosphereConfig,
} from "./atmosphere-config.js";

export const WEBGPU_IMPORT_CONTRACT = Object.freeze({
  renderer: "WebGPURenderer",
  pipeline: "RenderPipeline",
  storage2D: "StorageTexture",
  storage3D: "Storage3DTexture",
  outputBufferType: "HalfFloatType",
  lutColorSpace: "NoColorSpace",
});

export const TSL_IMPORT_CONTRACT = Object.freeze({
  compute: "Fn().compute(count)",
  store: "textureStore(storageTexture, coords, value)",
  storage2D: "storageTexture",
  storage3D: "storageTexture3D",
  sample2D: "texture",
  sample3D: "texture3D",
  scenePass: "pass(scene, camera)",
  sharedTargets: "mrt",
  output: "renderOutput",
});

export const TSL_COMPUTE_SCAFFOLD = `
const transmittanceCompute = Fn(() => {
  textureStore(transmittanceStorage, workgroupId.xy, vec4(transmittance, 1)).toWriteOnly();
}).compute(dispatchCount);

const aerialFroxelCompute = Fn(() => {
  textureStore(aerialFroxelStorage, workgroupId.xyz, vec4(segmentTransmittance, segmentInscatter));
}).compute(dispatchCount);

await renderer.computeAsync(transmittanceCompute);
await renderer.computeAsync(aerialFroxelCompute);
`;

export const PIPELINE_SCAFFOLD = `
const scenePass = pass(scene, camera);
const gbuffer = mrt({
  color: scenePass,
  depth: scenePass.getLinearDepthNode(),
  viewZ: scenePass.getViewZNode()
});
renderPipeline.outputNode = renderOutput(atmosphereComposite(gbuffer));
renderPipeline.outputColorTransform = true;
`;

function createStorageResource(product) {
  const { width, height, depth } = product.dimensions;
  const textureResource =
    product.kind === "Storage3DTexture"
      ? new Storage3DTexture(width, height, depth)
      : new StorageTexture(width, height);
  textureResource.name = `atmosphere-${product.id}`;
  textureResource.format = RGBAFormat;
  textureResource.type = HalfFloatType;
  textureResource.colorSpace = NoColorSpace;
  textureResource.mipmapsAutoUpdate = false;
  return textureResource;
}

export function createAtmosphereRenderer({ canvas } = {}) {
  return new WebGPURenderer({
    canvas,
    antialias: false,
    outputBufferType: HalfFloatType,
  });
}

export function createAtmosphereComputeDescriptors(schedule) {
  return schedule.map((product) => ({
    product: product.id,
    label: product.label,
    api: "Fn().compute(count)",
    submit: "renderer.computeAsync",
    write:
      product.kind === "Storage3DTexture"
        ? "textureStore(Storage3DTexture, xyz, RGBA16F)"
        : "textureStore(StorageTexture, xy, RGBA16F)",
    sample:
      product.kind === "Storage3DTexture"
        ? "texture3D(aerialFroxel)"
        : "texture(lut)",
    dispatch: product.dispatch,
    workgroup: product.workgroup,
    invalidation: product.invalidation,
    cadence: product.cadence,
  }));
}

export function createAtmospherePipelineContract() {
  return {
    renderer: "WebGPURenderer",
    rendererInit: "await renderer.init()",
    capabilityGate: "renderer.backend.isWebGPUBackend",
    reducedTier:
      "same node composition with manifest-loaded LUTs and fewer aerial froxel slices",
    pipeline: "RenderPipeline",
    scenePass: "pass(scene, camera)",
    gbuffer: "mrt({ color, depth, normal, velocity }) only when the host needs shared signals",
    depthOwner:
      "host scene pass; atmosphere reads PassNode.getLinearDepthNode() or PassNode.getViewZNode()",
    output:
      "scene-linear HDR radiance into one RenderPipeline.outputColorTransform owner",
    materialIrradiance:
      "disabled until a host MeshStandardNodeMaterial or MeshPhysicalNodeMaterial lighting integration consumes the validated irradiance LUT",
  };
}

export class WebGPULutAtmosphere {
  constructor({ config = createAtmosphereConfig(), lutTextures = null } = {}) {
    const validation = validateAtmosphereConfig(config);
    if (!validation.ok) {
      throw new Error(validation.errors.join("\n"));
    }
    this.config = config;
    this.lutTextures = lutTextures;
    this.products = createProductSchedule(config.tier);
    this.resources = new Map();
    this.disposeCounters = {
      storageTextures: 0,
      pipelines: 0,
      diagnosticTextures: 0,
    };
    this.size = { width: 1, height: 1 };
    this.backendTier = "uninitialized";
  }

  async initialize(renderer) {
    await renderer.init();
    this.backendTier = renderer.backend?.isWebGPUBackend ? "full" : "reduced";
    this.pipeline = new RenderPipeline(renderer);
    this.pipeline.outputColorTransform = true;
    return this;
  }

  createResourcePlan() {
    return {
      renderer: WEBGPU_IMPORT_CONTRACT,
      tsl: TSL_IMPORT_CONTRACT,
      products: this.products,
      bytes: estimateAtmosphereMemoryBytes(this.config.tier),
    };
  }

  createStorageResources() {
    for (const product of this.products) {
      this.resources.set(product.id, createStorageResource(product));
    }
    return this.resources;
  }

  createComputeDispatchDescriptors() {
    return createAtmosphereComputeDescriptors(this.products);
  }

  createPassGraph() {
    return createAtmospherePipelineContract();
  }

  resize(width, height) {
    this.size = { width, height };
    const froxel = this.resources.get("aerial-froxel");
    if (froxel) {
      const product = this.products.find((item) => item.id === "aerial-froxel");
      froxel.setSize(
        product.dimensions.width,
        product.dimensions.height,
        product.dimensions.depth,
      );
    }
    const skyView = this.resources.get("sky-view");
    if (skyView) {
      const product = this.products.find((item) => item.id === "sky-view");
      skyView.setSize(product.dimensions.width, product.dimensions.height);
    }
  }

  dispose() {
    for (const textureResource of this.resources.values()) {
      textureResource.dispose();
      this.disposeCounters.storageTextures += 1;
    }
    this.resources.clear();
    if (this.pipeline) {
      this.pipeline.dispose?.();
      this.disposeCounters.pipelines += 1;
    }
  }
}

export function createNodeApiSentinel() {
  return {
    Fn,
    mrt,
    pass,
    renderOutput,
    storageTexture,
    storageTexture3D,
    texture,
    texture3D,
    textureStore,
  };
}
