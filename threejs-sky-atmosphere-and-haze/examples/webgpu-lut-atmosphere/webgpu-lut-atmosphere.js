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
  dot,
  exp,
  float,
  instanceIndex,
  length,
  max,
  min,
  mix,
  mrt,
  normalize,
  pass,
  pow,
  renderOutput,
  select,
  sqrt,
  storageTexture,
  storageTexture3D,
  texture,
  texture3D,
  textureStore,
  uvec2,
  uvec3,
  vec2,
  vec3,
  vec4,
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

export const TSL_COMPUTE_SCAFFOLD = Object.freeze({
  transmittance:
    "createTransmittanceLutComputeNode({ target, config, product }) returns Fn(...).compute(count)",
  aerialFroxel:
    "createAerialFroxelComputeNode({ target, transmittance, config, product }) returns Fn(...).compute(count)",
  submit:
    "await renderer.computeAsync(kernel) for each real ComputeNode returned by createAtmosphereComputeKernels()",
});

export const PIPELINE_SCAFFOLD = `
const scenePass = pass(scene, camera);
const gbuffer = mrt({
  color: scenePass,
  depth: scenePass.getLinearDepthNode(),
  viewZ: scenePass.getViewZNode()
});
renderPipeline.outputNode = renderOutput(atmosphereComposite(gbuffer));
renderPipeline.outputColorTransform = false;
`;

const TRANSMITTANCE_SAMPLE_COUNT = 32;
const AERIAL_FROXEL_SAMPLE_COUNT = 24;
const AERIAL_FROXEL_NEAR_KM = 0.05;
const AERIAL_FROXEL_FAR_KM = 160.0;
const AERIAL_FROXEL_CAMERA_ALTITUDE_KM = 2.0;
const AERIAL_FROXEL_TAN_HALF_FOV = 0.7002075382;
const AERIAL_FROXEL_ASPECT = 16 / 9;
const ATMOSPHERE_SUN_DIRECTION = [0.35, 0.72, 0.6];

function vec3FromArray(values) {
  return vec3(values[0], values[1], values[2]);
}

function profileLayerDensity(altitudeKm, layer) {
  return float(layer.expTerm)
    .mul(exp(float(layer.expScalePerKm).mul(altitudeKm)))
    .add(float(layer.linearTermPerKm).mul(altitudeKm))
    .add(float(layer.constantTerm))
    .clamp(0.0, 1.0);
}

function profileDensity(altitudeKm, layers) {
  const first = profileLayerDensity(altitudeKm, layers[0]);
  if (layers.length === 1) return first;

  const second = profileLayerDensity(altitudeKm, layers[1]);
  return select(
    altitudeKm.lessThan(float(layers[0].widthMeters / 1000)),
    first,
    second,
  );
}

function densityTerms(altitudeKm, config) {
  return {
    rayleigh: profileDensity(
      altitudeKm,
      config.densityProfiles.rayleighDensity,
    ),
    mie: profileDensity(altitudeKm, config.densityProfiles.mieDensity),
    absorption: profileDensity(
      altitudeKm,
      config.densityProfiles.absorptionDensity,
    ),
  };
}

function extinctionPerKmAtAltitude(altitudeKm, config) {
  const density = densityTerms(altitudeKm, config);
  return vec3FromArray(config.rayleighScatteringPerKm)
    .mul(density.rayleigh)
    .add(vec3FromArray(config.mieExtinctionPerKm).mul(density.mie))
    .add(vec3FromArray(config.absorptionExtinctionPerKm).mul(density.absorption));
}

function scatteringPerKmAtAltitude(altitudeKm, config, viewRay, sunDirection) {
  const density = densityTerms(altitudeKm, config);
  const cosTheta = dot(viewRay, sunDirection);
  const cosTheta2 = cosTheta.mul(cosTheta);
  const g = float(config.miePhaseG);
  const g2 = g.mul(g);
  const rayleighPhase = float(3 / (16 * Math.PI)).mul(cosTheta2.add(1.0));
  const mieDenominator = pow(
    g2.add(1.0).sub(g.mul(2.0).mul(cosTheta)),
    1.5,
  );
  const miePhase = float(3 / (8 * Math.PI))
    .mul(float(1.0).sub(g2))
    .mul(cosTheta2.add(1.0))
    .div(g2.add(2.0).mul(max(mieDenominator, 1e-4)));

  return vec3FromArray(config.rayleighScatteringPerKm)
    .mul(density.rayleigh)
    .mul(rayleighPhase)
    .add(vec3FromArray(config.mieScatteringPerKm).mul(density.mie).mul(miePhase));
}

function transmittanceDistanceToTop(radiusKm, mu, topRadiusKm) {
  const discriminant = radiusKm
    .mul(radiusKm)
    .mul(mu.mul(mu).sub(1.0))
    .add(topRadiusKm.mul(topRadiusKm));
  return radiusKm.mul(mu).negate().add(sqrt(max(discriminant, 0.0)));
}

function distanceToBottom(radiusKm, mu, bottomRadiusKm) {
  const discriminant = radiusKm
    .mul(radiusKm)
    .mul(mu.mul(mu).sub(1.0))
    .add(bottomRadiusKm.mul(bottomRadiusKm));
  return radiusKm.mul(mu).negate().sub(sqrt(max(discriminant, 0.0)));
}

function integrateTransmittance(radiusKm, mu, maxDistanceKm, config, sampleCount) {
  const bottomRadiusKm = float(config.radiiMeters.bottom / 1000);
  const position = vec3(0.0, radiusKm, 0.0);
  const horizontal = sqrt(max(float(1.0).sub(mu.mul(mu)), 0.0));
  const ray = normalize(vec3(horizontal, mu, 0.0));
  const stepKm = maxDistanceKm.div(sampleCount);
  const opticalDepth = vec3(0.0).toVar();

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const distanceKm = stepKm.mul(sample + 0.5);
    const samplePosition = position.add(ray.mul(distanceKm));
    const altitudeKm = max(length(samplePosition).sub(bottomRadiusKm), 0.0);
    opticalDepth.assign(
      opticalDepth.add(extinctionPerKmAtAltitude(altitudeKm, config).mul(stepKm)),
    );
  }

  return exp(opticalDepth.negate()).clamp(0.0, 1.0);
}

function cell2DFromIndex(dimensions) {
  const width = dimensions.width;
  const x = instanceIndex.mod(width);
  const y = instanceIndex.div(width);
  return uvec2(x, y);
}

function cell3DFromIndex(dimensions) {
  const sliceSize = dimensions.width * dimensions.height;
  const z = instanceIndex.div(sliceSize);
  const sliceIndex = instanceIndex.sub(z.mul(sliceSize));
  const x = sliceIndex.mod(dimensions.width);
  const y = sliceIndex.div(dimensions.width);
  return uvec3(x, y, z);
}

function transmittanceLookupCell(radiusKm, mu, config, dimensions) {
  const bottomRadiusKm = float(config.radiiMeters.bottom / 1000);
  const topRadiusKm = float(config.radiiMeters.top / 1000);
  const x = mu
    .mul(0.5)
    .add(0.5)
    .clamp(0.0, 1.0)
    .mul(dimensions.width - 1)
    .round()
    .toUint();
  const y = radiusKm
    .sub(bottomRadiusKm)
    .div(topRadiusKm.sub(bottomRadiusKm))
    .clamp(0.0, 1.0)
    .mul(dimensions.height - 1)
    .round()
    .toUint();
  return uvec2(x, y);
}

export function createTransmittanceLutComputeNode({ target, config, product }) {
  const dimensions = product.dimensions;
  const bottomRadiusKm = float(config.radiiMeters.bottom / 1000);
  const topRadiusKm = float(config.radiiMeters.top / 1000);

  const kernel = Fn(({ outputTex }) => {
    const cell = cell2DFromIndex(dimensions);
    const uv = vec2(cell)
      .add(0.5)
      .div(vec2(dimensions.width, dimensions.height));
    const radiusKm = mix(bottomRadiusKm, topRadiusKm, uv.y);
    const mu = uv.x.mul(2.0).sub(1.0);
    const topDistanceKm = transmittanceDistanceToTop(
      radiusKm,
      mu,
      topRadiusKm,
    );
    const bottomDistanceKm = distanceToBottom(radiusKm, mu, bottomRadiusKm);
    const hitsGround = bottomDistanceKm
      .greaterThan(0.0)
      .and(bottomDistanceKm.lessThan(topDistanceKm));
    const integrated = integrateTransmittance(
      radiusKm,
      mu,
      topDistanceKm,
      config,
      TRANSMITTANCE_SAMPLE_COUNT,
    );
    const transmittance = select(hitsGround, vec3(0.0), integrated);

    textureStore(outputTex, cell, vec4(transmittance, 1.0)).toWriteOnly();
  });

  return kernel({ outputTex: target })
    .compute(dimensions.width * dimensions.height, product.workgroup)
    .setName("atmosphere:transmittance-lut");
}

export function createAerialFroxelComputeNode({
  target,
  transmittance,
  config,
  product,
  transmittanceProduct,
}) {
  const dimensions = product.dimensions;
  const bottomRadiusKm = float(config.radiiMeters.bottom / 1000);
  const topRadiusKm = float(config.radiiMeters.top / 1000);
  const sunDirection = normalize(vec3FromArray(ATMOSPHERE_SUN_DIRECTION));
  const solarIrradiance = vec3FromArray(config.solarIrradiance);

  const kernel = Fn(({ outputTex, transmittanceTex }) => {
    const cell = cell3DFromIndex(dimensions);
    const uv = vec3(cell)
      .add(0.5)
      .div(vec3(dimensions.width, dimensions.height, dimensions.depth));
    const ndc = uv.xy.mul(2.0).sub(1.0);
    const viewRay = normalize(
      vec3(
        ndc.x.mul(AERIAL_FROXEL_TAN_HALF_FOV * AERIAL_FROXEL_ASPECT),
        ndc.y.mul(AERIAL_FROXEL_TAN_HALF_FOV),
        1.0,
      ),
    );
    const cameraRadiusKm = bottomRadiusKm.add(AERIAL_FROXEL_CAMERA_ALTITUDE_KM);
    const cameraPosition = vec3(0.0, cameraRadiusKm, 0.0);
    const viewMu = viewRay.y;
    const topDistanceKm = transmittanceDistanceToTop(
      cameraRadiusKm,
      viewMu,
      topRadiusKm,
    );
    const depthKm = float(AERIAL_FROXEL_NEAR_KM).mul(
      pow(AERIAL_FROXEL_FAR_KM / AERIAL_FROXEL_NEAR_KM, uv.z),
    );
    const segmentKm = min(depthKm, topDistanceKm);
    const stepKm = segmentKm.div(AERIAL_FROXEL_SAMPLE_COUNT);
    const opticalDepth = vec3(0.0).toVar();
    const singleScattering = vec3(0.0).toVar();

    for (let sample = 0; sample < AERIAL_FROXEL_SAMPLE_COUNT; sample += 1) {
      const distanceKm = stepKm.mul(sample + 0.5);
      const samplePosition = cameraPosition.add(viewRay.mul(distanceKm));
      const radiusKm = length(samplePosition);
      const altitudeKm = max(radiusKm.sub(bottomRadiusKm), 0.0);
      const extinction = extinctionPerKmAtAltitude(altitudeKm, config);
      opticalDepth.assign(opticalDepth.add(extinction.mul(stepKm)));

      const normal = normalize(samplePosition);
      const sunMu = dot(normal, sunDirection);
      const transmittanceCell = transmittanceLookupCell(
        radiusKm,
        sunMu,
        config,
        transmittanceProduct.dimensions,
      );
      const sunTransmittance = storageTexture(
        transmittanceTex,
        transmittanceCell,
      ).toReadOnly().rgb;
      const viewTransmittance = exp(opticalDepth.negate()).clamp(0.0, 1.0);
      const scattering = scatteringPerKmAtAltitude(
        altitudeKm,
        config,
        viewRay,
        sunDirection,
      );
      singleScattering.assign(
        singleScattering.add(
          viewTransmittance
            .mul(sunTransmittance)
            .mul(scattering)
            .mul(solarIrradiance)
            .mul(stepKm),
        ),
      );
    }

    const segmentTransmittance = exp(opticalDepth.negate()).clamp(0.0, 1.0);
    const inscatterLuminance = dot(
      singleScattering,
      vec3(0.2126, 0.7152, 0.0722),
    );
    textureStore(
      outputTex,
      cell,
      vec4(segmentTransmittance, inscatterLuminance),
    ).toWriteOnly();
  });

  return kernel({ outputTex: target, transmittanceTex: transmittance })
    .compute(dimensions.width * dimensions.height * dimensions.depth, product.workgroup)
    .setName("atmosphere:aerial-froxel-single-scattering");
}

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
    implemented:
      product.id === "transmittance" || product.id === "aerial-froxel",
  }));
}

export function createAtmosphereComputeKernels(resources, config, products) {
  const productById = new Map(products.map((product) => [product.id, product]));
  const transmittanceProduct = productById.get("transmittance");
  const aerialFroxelProduct = productById.get("aerial-froxel");
  const transmittance = resources.get("transmittance");
  const aerialFroxel = resources.get("aerial-froxel");

  if (!transmittance || !aerialFroxel) {
    throw new Error(
      "createAtmosphereComputeKernels requires transmittance and aerial-froxel storage resources",
    );
  }

  return {
    transmittance: createTransmittanceLutComputeNode({
      target: transmittance,
      config,
      product: transmittanceProduct,
    }),
    aerialFroxel: createAerialFroxelComputeNode({
      target: aerialFroxel,
      transmittance,
      config,
      product: aerialFroxelProduct,
      transmittanceProduct,
    }),
    omissions: [
      "Multiscatter, irradiance, and sky-view kernels remain explicit out-of-scope work; this example executes transmittance plus single-scattering aerial froxels.",
      "Aerial froxel alpha stores scalar single-scattering luminance; full spectral inscattering needs an additional RGBA target or packing contract.",
    ],
  };
}

export function createAtmospherePipelineContract() {
  return {
    renderer: "WebGPURenderer",
    rendererInit: "await renderer.init()",
    capabilityGate: "renderer.backend.isWebGPUBackend",
    reducedTier:
      "unsupported in this flagship example; use threejs-compatibility-fallbacks to teach fallback routing",
    pipeline: "RenderPipeline",
    scenePass: "pass(scene, camera)",
    gbuffer: "mrt({ color, depth, normal, velocity }) only when the host needs shared signals",
    depthOwner:
      "host scene pass; atmosphere reads PassNode.getLinearDepthNode() or PassNode.getViewZNode()",
    output:
      "renderOutput owns final presentation; RenderPipeline.outputColorTransform is false",
    outputColorTransform: false,
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
    if (renderer.backend?.isWebGPUBackend !== true) {
      throw new Error(
        "threejs-sky-atmosphere-and-haze requires WebGPU for the flagship live LUT path; use threejs-compatibility-fallbacks when teaching how to apply fallback when WebGPU is unavailable.",
      );
    }
    this.backendTier = "full";
    this.pipeline = new RenderPipeline(renderer);
    this.pipeline.outputColorTransform = false;
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

  createComputeKernels() {
    if (this.resources.size === 0) {
      this.createStorageResources();
    }
    return createAtmosphereComputeKernels(this.resources, this.config, this.products);
  }

  async computeAtmosphereLuts(renderer) {
    const kernels = this.createComputeKernels();
    await renderer.computeAsync(kernels.transmittance);
    await renderer.computeAsync(kernels.aerialFroxel);
    return kernels;
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
