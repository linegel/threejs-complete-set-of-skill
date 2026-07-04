import {
  Color,
  LinearFilter,
  LinearMipMapLinearFilter,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  NoColorSpace,
  RepeatWrapping,
  StorageInstancedBufferAttribute,
  TextureLoader,
} from "three/webgpu";

import {
  attribute,
  color,
  dFdx,
  dFdy,
  dot,
  float,
  fwidth,
  max,
  min,
  mix,
  mx_noise_float,
  mx_worley_noise_float,
  normalLocal,
  normalView,
  positionLocal,
  positionView,
  positionWorld,
  select,
  smoothstep,
  texture,
  triplanarTexture,
  uniform,
  uv,
  vec2,
  vec3,
} from "three/tsl";

export const TRIPLANAR_COST_NOTE =
  "Full triplanar projection costs 3 texture samples per channel before filtering; reserve it for UV-less or close hero surfaces.";

export const PROCEDURAL_PBR_WEBGPU_REQUIRED_MESSAGE =
  "threejs-procedural-materials requires a native WebGPU backend for canonical compute/storage/MRT material work. If the user explicitly asks how to apply fallback when WebGPU is unavailable, route to ../threejs-compatibility-fallbacks/.";

const disposedProceduralMaterials = new WeakSet();

export const proceduralPbrDebugModes = new Map([
  ["final", 0],
  ["coordinates", 1],
  ["identity", 2],
  ["height", 3],
  ["roughness", 4],
  ["roughness-aa", 5],
  ["normal-variance", 6],
  ["metalness", 7],
  ["clearcoat", 8],
  ["dissolve", 9],
  ["emission", 10],
  ["triplanar-weights", 11],
  ["cause-map", 12],
]);

export const lavaCauseMapPaths = {
  a: new URL("../../assets/generated-variants/lava-cause-a.png", import.meta.url).href,
  b: new URL("../../assets/generated-variants/lava-cause-b.png", import.meta.url).href,
  c: new URL("../../assets/generated-variants/lava-cause-c.png", import.meta.url).href,
};

export const authoredPbrIdentities = {
  walnut: {
    label: "oiled walnut",
    baseColor: 0x5a2814,
    secondaryColor: 0x1f0d07,
    roughnessRange: [0.38, 0.50],
    metalnessRange: [0.00, 0.04],
    clearcoatRange: [0.45, 0.70],
    clearcoatRoughnessRange: [0.22, 0.34],
    heightScaleRange: [0.010, 0.025],
  },
  antiqueGold: {
    label: "antique gold",
    baseColor: 0xd0a448,
    secondaryColor: 0x6c4b1f,
    roughnessRange: [0.20, 0.34],
    metalnessRange: [0.72, 0.90],
    clearcoatRange: [0.10, 0.30],
    clearcoatRoughnessRange: [0.16, 0.28],
    heightScaleRange: [0.004, 0.014],
  },
  ebony: {
    label: "ebony lacquer",
    baseColor: 0x090706,
    secondaryColor: 0x1a1210,
    roughnessRange: [0.30, 0.46],
    metalnessRange: [0.00, 0.05],
    clearcoatRange: [0.55, 0.85],
    clearcoatRoughnessRange: [0.18, 0.32],
    heightScaleRange: [0.006, 0.020],
  },
};

export const authoredLavaIdentity = {
  label: "lava crust and exposed heat",
  lavaHot: 0xff1402,
  lavaCool: 0xb20000,
  emberColor: 0xff5511,
  crustColor: 0x1f1515,
  ashColor: 0x0b0808,
  flowSpeed: 0.1,
  ridgeFrequency: 0.0,
  pulseSpeed: 0.05,
  amplitude: 0.4,
  octaves: 4,
  emissionIntensity: 7.5,
};

function midpoint([minValue, maxValue]) {
  return (minValue + maxValue) * 0.5;
}

function linearColor(hex) {
  return new Color(hex);
}

function validateRange(name, range, {
  minValue = 0,
  maxValue = 1,
  allowEqual = false,
} = {}) {
  const [low, high] = range ?? [];
  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    return `${name} must contain finite min/max values`;
  }
  if (low < minValue || high > maxValue) {
    return `${name} must stay inside [${minValue}, ${maxValue}]`;
  }
  if (allowEqual ? low > high : low >= high) {
    return `${name} must be ordered low < high`;
  }
  return null;
}

export function validateProceduralPbrConfig({
  identity = authoredPbrIdentities.walnut,
  coordinateScale = 1,
  seed = 1,
  emissionIntensity = 0,
  causeMaps = [],
  roughnessRange = identity?.roughnessRange,
  metalnessRange = identity?.metalnessRange,
  clearcoatRange = identity?.clearcoatRange ?? [0, 0],
  clearcoatRoughnessRange = identity?.clearcoatRoughnessRange ?? [0, 0],
  heightScaleRange = identity?.heightScaleRange ?? [0, 0],
} = {}) {
  const errors = [];
  for (const rangeError of [
    validateRange("roughnessRange", roughnessRange),
    validateRange("metalnessRange", metalnessRange, { allowEqual: true }),
    validateRange("clearcoatRange", clearcoatRange, { allowEqual: true }),
    validateRange("clearcoatRoughnessRange", clearcoatRoughnessRange, { allowEqual: true }),
    validateRange("heightScaleRange", heightScaleRange, { minValue: 0, maxValue: 1, allowEqual: true }),
  ]) {
    if (rangeError) errors.push(rangeError);
  }

  if (!Number.isFinite(coordinateScale) || coordinateScale <= 0) {
    errors.push("coordinateScale must be positive and finite");
  }
  if (!Number.isFinite(seed)) {
    errors.push("seed must be finite");
  }
  if (!Number.isFinite(emissionIntensity) || emissionIntensity < 0 || emissionIntensity > 64) {
    errors.push("emissionIntensity must be finite and in [0, 64] scene-linear units");
  }
  for (const [index, causeMap] of causeMaps.entries()) {
    if (causeMap?.colorSpace !== NoColorSpace) {
      errors.push(`causeMaps[${index}] must declare NoColorSpace`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid procedural PBR config:\n- ${errors.join("\n- ")}`);
  }

  return {
    pass: true,
    coordinateScale,
    seed,
    emissionIntensity,
    causeMapCount: causeMaps.length,
  };
}

function createMaterialUniforms({
  seed = 1,
  coordinateScale = 1,
  debugMode = "final",
  specularAAStrength = 0.7,
  normalStrength = 1,
  flowTime = 0,
} = {}) {
  return {
    seed: uniform(seed),
    coordinateScale: uniform(coordinateScale),
    debugMode: uniform(proceduralPbrDebugModes.get(debugMode) ?? 0, "int"),
    specularAAStrength: uniform(specularAAStrength),
    normalStrength: uniform(normalStrength),
    flowTime: uniform(flowTime),
  };
}

// Build order 1: choose stable coordinates before any channel samples a field.
function createStableCoordinates(uniforms, {
  coordinateMode = "object",
  flow = vec2(0, 0),
} = {}) {
  const base = coordinateMode === "world" ? positionWorld : positionLocal;
  const seedOffset = vec3(
    uniforms.seed.mul(0.113),
    uniforms.seed.mul(0.271),
    uniforms.seed.mul(0.619),
  );
  const p = base.mul(uniforms.coordinateScale).add(seedOffset);
  const uvCoord = uv().mul(uniforms.coordinateScale).add(vec2(uniforms.seed.mul(0.071)));

  return {
    p: p.add(vec3(flow.x, 0, flow.y)),
    uv: uvCoord.add(flow),
    coordinateDebug: p.mul(0.08).add(vec3(0.5)),
  };
}

// Build order 2-4: one structural field cache feeds identity weights,
// causal modifiers, height, roughness, normals, and debug outputs.
function createStructuralFields(coords, {
  fiberFrequency = 11.5,
  macroFrequency = 0.75,
  ridgeFrequency = 2.7,
  cavityFrequency = 5.25,
  heightScale = 0.014,
} = {}) {
  const macro = mx_noise_float(coords.p.mul(macroFrequency)).mul(0.5).add(0.5);
  const grain = mx_noise_float(coords.p.mul(fiberFrequency)).mul(0.5).add(0.5);
  const ridge = mx_worley_noise_float(coords.p.mul(ridgeFrequency)).oneMinus();
  const cavity = mx_worley_noise_float(coords.p.mul(cavityFrequency));
  const filteredGrain = grain.mul(smoothstep(0.004, 0.055, fwidth(grain).oneMinus()));
  const height = macro.mul(0.38)
    .add(filteredGrain.mul(0.44))
    .add(ridge.mul(0.18))
    .sub(cavity.mul(0.08))
    .mul(heightScale);

  return {
    macro,
    grain,
    ridge,
    cavity,
    height,
    identityWeight: smoothstep(0.25, 0.88, macro.add(ridge.mul(0.35))),
  };
}

// Build order 9: variants and dissolve come from instanced attributes, not
// cloned materials. Missing attributes compile to zero, which is the intact
// default.
function createPerInstanceDissolve(fields) {
  const instanceDissolve = attribute("instanceDissolve", "float");
  const instanceVariant = attribute("instanceVariant", "float");
  const dissolveCause = fields.macro.mul(0.45)
    .add(fields.ridge.mul(0.35))
    .add(instanceVariant.mul(0.20));
  const filterWidth = max(fwidth(dissolveCause), float(0.002));
  const mask = smoothstep(instanceDissolve, instanceDissolve.add(filterWidth), dissolveCause);

  return {
    instanceDissolve,
    instanceVariant,
    dissolveCause,
    mask,
  };
}

// The built-in texture bump node resamples height at offset UVs. Scalar procedural
// height is already evaluated, so feed its screen-space derivatives directly.
function createDerivativeNormalFromHeight(height, strength = float(1)) {
  const scaledHeight = height.mul(strength);
  const dpdx = positionView.dFdx();
  const dpdy = positionView.dFdy();
  const r1 = dpdy.cross(normalView);
  const r2 = normalView.cross(dpdx);
  const det = dpdx.dot(r1);
  const grad = det.sign().mul(scaledHeight.dFdx().mul(r1).add(scaledHeight.dFdy().mul(r2)));

  return det.abs().mul(normalView).sub(grad).normalize();
}

// Build order 6: widen roughness from shared-height derivatives before the
// value reaches the PBR slot.
function createSpecularAA(roughness, finalNormalNode, {
  specularAAStrength,
  roughnessRange,
}) {
  const dx = dFdx(finalNormalNode);
  const dy = dFdy(finalNormalNode);
  const normalVariance = max(dot(dx, dx), dot(dy, dy));
  const widened = roughness.mul(roughness)
    .add(normalVariance.mul(specularAAStrength))
    .sqrt();
  return {
    normalVariance,
    filteredRoughness: min(float(roughnessRange[1]), max(float(roughnessRange[0]), widened)),
  };
}

// Build order diagnostics: every debug view is exposed through colorNode while
// preserving the material lighting path.
function applyDebugModes(baseColor, {
  uniforms,
  coords,
  fields,
  roughness,
  filteredRoughness,
  normalVariance,
  metalness,
  clearcoat = float(0),
  dissolve,
  emission = vec3(0),
  triplanarWeights = vec3(0),
  causeMapDebug = vec3(0),
}) {
  let debug = baseColor;
  debug = select(uniforms.debugMode.equal(12), causeMapDebug, debug);
  debug = select(uniforms.debugMode.equal(11), triplanarWeights, debug);
  debug = select(uniforms.debugMode.equal(10), emission.mul(0.08), debug);
  debug = select(uniforms.debugMode.equal(9), vec3(dissolve.mask), debug);
  debug = select(uniforms.debugMode.equal(8), vec3(clearcoat), debug);
  debug = select(uniforms.debugMode.equal(7), vec3(metalness), debug);
  debug = select(uniforms.debugMode.equal(6), vec3(normalVariance.mul(96)), debug);
  debug = select(uniforms.debugMode.equal(5), vec3(filteredRoughness), debug);
  debug = select(uniforms.debugMode.equal(4), vec3(roughness), debug);
  debug = select(uniforms.debugMode.equal(3), vec3(fields.height.mul(24).add(0.5)), debug);
  debug = select(uniforms.debugMode.equal(2), vec3(fields.identityWeight), debug);
  debug = select(uniforms.debugMode.equal(1), coords.coordinateDebug, debug);
  return debug;
}

// Build order 7: assign only NodeMaterial PBR slots; do not replace lighting.
function finalizePhysicalMaterial({
  name,
  identity,
  uniforms,
  coords,
  fields,
  colorNode,
  roughnessNode,
  metalnessNode,
  clearcoatNode,
  clearcoatRoughnessNode,
  normalNode,
  dissolve,
  specular,
  triplanarWeights,
}) {
  const material = new MeshPhysicalNodeMaterial({
    name,
    color: linearColor(identity.baseColor),
    roughness: midpoint(identity.roughnessRange),
    metalness: midpoint(identity.metalnessRange),
    clearcoat: midpoint(identity.clearcoatRange),
    clearcoatRoughness: midpoint(identity.clearcoatRoughnessRange),
  });

  material.colorNode = applyDebugModes(colorNode, {
    uniforms,
    coords,
    fields,
    roughness: roughnessNode,
    filteredRoughness: specular.filteredRoughness,
    normalVariance: specular.normalVariance,
    metalness: metalnessNode,
    clearcoat: clearcoatNode,
    dissolve,
    triplanarWeights,
  });
  material.roughnessNode = specular.filteredRoughness;
  material.metalnessNode = metalnessNode;
  material.clearcoatNode = clearcoatNode;
  material.clearcoatRoughnessNode = clearcoatRoughnessNode;
  material.normalNode = normalNode;
  material.opacityNode = dissolve.mask;
  material.alphaTestNode = float(0.5);
  material.maskShadowNode = dissolve.mask.greaterThan(0.5);
  material.userData.proceduralPbr = {
    uniforms,
    disposeTextures: [],
    normalVarianceSource: "normalNode",
    responseBundle: identity.label,
  };

  return material;
}

function createWoodLikeMaterial(identity, {
  seed = 17,
  coordinateScale = 1.35,
  coordinateMode = "object",
  debugMode = "final",
  specularAAStrength = 0.75,
  normalStrength = 1,
  triplanarMap = null,
} = {}) {
  const uniforms = createMaterialUniforms({
    seed,
    coordinateScale,
    debugMode,
    specularAAStrength,
    normalStrength,
  });
  const coords = createStableCoordinates(uniforms, { coordinateMode });
  const fields = createStructuralFields(coords, {
    fiberFrequency: 16,
    macroFrequency: 0.52,
    ridgeFrequency: 1.8,
    cavityFrequency: 9.5,
    heightScale: midpoint(identity.heightScaleRange),
  });
  const dissolve = createPerInstanceDissolve(fields);
  const grainColor = mix(color(identity.secondaryColor), color(identity.baseColor), fields.identityWeight);
  const colorNode = triplanarMap
    ? mix(grainColor, createTriplanarProjectionNode(triplanarMap, { scale: 1.2 }).node.rgb, 0.22)
    : grainColor.mul(fields.grain.mul(0.18).add(0.9));
  const roughness = mix(float(identity.roughnessRange[0]), float(identity.roughnessRange[1]), fields.cavity);
  const normalNode = createDerivativeNormalFromHeight(fields.height, float(1.0).mul(uniforms.normalStrength));
  const specular = createSpecularAA(roughness, normalNode, {
    specularAAStrength: uniforms.specularAAStrength,
    roughnessRange: identity.roughnessRange,
  });

  return finalizePhysicalMaterial({
    name: identity.label,
    identity,
    uniforms,
    coords,
    fields,
    colorNode,
    roughnessNode: roughness,
    metalnessNode: mix(float(identity.metalnessRange[0]), float(identity.metalnessRange[1]), fields.ridge.mul(0.25)),
    clearcoatNode: mix(float(identity.clearcoatRange[0]), float(identity.clearcoatRange[1]), fields.grain),
    clearcoatRoughnessNode: mix(float(identity.clearcoatRoughnessRange[0]), float(identity.clearcoatRoughnessRange[1]), fields.cavity),
    normalNode,
    dissolve,
    specular,
    triplanarWeights: createTriplanarWeights(normalLocal),
  });
}

export function createWalnutPbrMaterial(options = {}) {
  return createWoodLikeMaterial(authoredPbrIdentities.walnut, options);
}

export function createEbonyFramePbrMaterial(options = {}) {
  const material = createWoodLikeMaterial(authoredPbrIdentities.ebony, {
    seed: 29,
    coordinateScale: 1.8,
    specularAAStrength: 0.9,
    ...options,
  });
  material.name = "ebony lacquer frame";
  return material;
}

export function createAntiqueGoldPbrMaterial({
  seed = 23,
  coordinateScale = 2.2,
  coordinateMode = "object",
  debugMode = "final",
  specularAAStrength = 1.0,
  normalStrength = 0.75,
} = {}) {
  const identity = authoredPbrIdentities.antiqueGold;
  const uniforms = createMaterialUniforms({
    seed,
    coordinateScale,
    debugMode,
    specularAAStrength,
    normalStrength,
  });
  const coords = createStableCoordinates(uniforms, { coordinateMode });
  const fields = createStructuralFields(coords, {
    fiberFrequency: 5.0,
    macroFrequency: 1.05,
    ridgeFrequency: 5.5,
    cavityFrequency: 12.0,
    heightScale: midpoint(identity.heightScaleRange),
  });
  const dissolve = createPerInstanceDissolve(fields);
  const tarnish = smoothstep(0.42, 0.82, fields.cavity);
  const wornEdge = smoothstep(0.45, 0.86, fields.ridge);
  const base = mix(color(identity.secondaryColor), color(identity.baseColor), wornEdge);
  const colorNode = mix(base, color(0x2c3324), tarnish.mul(0.28));
  const roughness = mix(float(identity.roughnessRange[0]), float(identity.roughnessRange[1]), tarnish);
  const normalNode = createDerivativeNormalFromHeight(fields.height, float(0.65).mul(uniforms.normalStrength));
  const specular = createSpecularAA(roughness, normalNode, {
    specularAAStrength: uniforms.specularAAStrength,
    roughnessRange: identity.roughnessRange,
  });

  return finalizePhysicalMaterial({
    name: identity.label,
    identity,
    uniforms,
    coords,
    fields,
    colorNode,
    roughnessNode: roughness,
    metalnessNode: mix(float(identity.metalnessRange[0]), float(identity.metalnessRange[1]), wornEdge),
    clearcoatNode: mix(float(identity.clearcoatRange[0]), float(identity.clearcoatRange[1]), tarnish.oneMinus()),
    clearcoatRoughnessNode: mix(float(identity.clearcoatRoughnessRange[0]), float(identity.clearcoatRoughnessRange[1]), tarnish),
    normalNode,
    dissolve,
    specular,
    triplanarWeights: createTriplanarWeights(normalLocal),
  });
}

function createLavaCauseNodes(causeMap, coords, fields) {
  if (!causeMap) {
    return {
      crust: fields.cavity,
      fracture: fields.ridge,
      exposure: smoothstep(0.48, 0.88, fields.ridge.add(fields.macro.mul(0.35))),
      heat: smoothstep(0.36, 0.82, fields.ridge),
      debug: vec3(fields.cavity, fields.ridge, fields.macro),
    };
  }

  causeMap.colorSpace = NoColorSpace;
  const sample = texture(causeMap, coords.uv);
  return {
    crust: sample.r,
    fracture: sample.g,
    exposure: sample.b,
    heat: sample.a,
    debug: sample.rgb,
  };
}

export function createLavaEmissivePbrMaterial({
  seed = 41,
  coordinateScale = 1.25,
  coordinateMode = "object",
  debugMode = "final",
  specularAAStrength = 0.65,
  normalStrength = 1,
  flowTime = 0,
  flowSpeed = authoredLavaIdentity.flowSpeed,
  causeMap = null,
  emissionIntensity = authoredLavaIdentity.emissionIntensity,
} = {}) {
  const uniforms = createMaterialUniforms({
    seed,
    coordinateScale,
    debugMode,
    specularAAStrength,
    normalStrength,
    flowTime,
  });
  const flow = vec2(uniforms.flowTime.mul(flowSpeed), uniforms.flowTime.mul(flowSpeed * 1.5));
  const coords = createStableCoordinates(uniforms, { coordinateMode, flow });
  const fields = createStructuralFields(coords, {
    fiberFrequency: 7.0,
    macroFrequency: 0.7,
    ridgeFrequency: 3.6,
    cavityFrequency: 8.5,
    heightScale: 0.032,
  });
  const cause = createLavaCauseNodes(causeMap, coords, fields);
  const dissolve = createPerInstanceDissolve(fields);
  const crustMask = smoothstep(0.35, 0.74, cause.crust);
  const exposure = smoothstep(0.42, 0.92, cause.exposure.add(cause.fracture.mul(0.28)));
  const heat = exposure.mul(smoothstep(0.26, 0.86, cause.heat));
  const crust = mix(color(authoredLavaIdentity.ashColor), color(authoredLavaIdentity.crustColor), crustMask);
  const lava = mix(color(authoredLavaIdentity.lavaCool), color(authoredLavaIdentity.lavaHot), heat);
  const colorNode = mix(crust, lava, heat.mul(0.35));
  const roughness = mix(float(0.74), float(0.28), heat);
  const normalNode = createDerivativeNormalFromHeight(fields.height.add(heat.mul(0.012)), uniforms.normalStrength);
  const specular = createSpecularAA(roughness, normalNode, {
    specularAAStrength: uniforms.specularAAStrength,
    roughnessRange: [0.28, 0.82],
  });
  const emission = mix(color(authoredLavaIdentity.lavaCool), color(authoredLavaIdentity.lavaHot), heat)
    .mul(heat.mul(emissionIntensity));

  const material = new MeshStandardNodeMaterial({
    name: authoredLavaIdentity.label,
    color: linearColor(authoredLavaIdentity.crustColor),
    roughness: 0.62,
    metalness: 0,
  });
  material.colorNode = applyDebugModes(colorNode, {
    uniforms,
    coords,
    fields,
    roughness,
    filteredRoughness: specular.filteredRoughness,
    normalVariance: specular.normalVariance,
    metalness: float(0),
    dissolve,
    emission,
    triplanarWeights: createTriplanarWeights(normalLocal),
    causeMapDebug: cause.debug,
  });
  material.roughnessNode = specular.filteredRoughness;
  material.metalnessNode = float(0);
  material.normalNode = normalNode;
  material.emissiveNode = emission;
  material.opacityNode = dissolve.mask;
  material.alphaTestNode = float(0.5);
  material.maskShadowNode = dissolve.mask.greaterThan(0.5);
  material.userData.proceduralPbr = {
    uniforms,
    disposeTextures: causeMap ? [causeMap] : [],
    normalVarianceSource: "normalNode",
    responseBundle: authoredLavaIdentity.label,
  };

  return material;
}

export function createTriplanarProjectionNode(textureSource, {
  scale = 1,
  positionNode = positionLocal,
  normalNode = normalLocal,
} = {}) {
  return {
    node: triplanarTexture(texture(textureSource), null, null, float(scale), positionNode, normalNode),
    costNote: TRIPLANAR_COST_NOTE,
  };
}

function createTriplanarWeights(normalNode) {
  let weights = normalNode.abs().normalize();
  weights = weights.div(weights.dot(vec3(1)));
  return weights;
}

export function createInstancedDissolveAttributes(instanceCount, {
  initialDissolve = 0,
  variantSeed = 1,
} = {}) {
  const dissolve = new StorageInstancedBufferAttribute(instanceCount, 1);
  const variant = new StorageInstancedBufferAttribute(instanceCount, 1);

  for (let i = 0; i < instanceCount; i++) {
    dissolve.array[i] = initialDissolve;
    variant.array[i] = (((i + 1) * 1103515245 + variantSeed * 12345) >>> 0) / 4294967295;
  }

  return {
    dissolve,
    variant,
    attachTo(geometry) {
      geometry.setAttribute("instanceDissolve", dissolve);
      geometry.setAttribute("instanceVariant", variant);
      return geometry;
    },
  };
}

export async function loadLavaCauseMaps({
  textureLoader = new TextureLoader(),
  paths = lavaCauseMapPaths,
} = {}) {
  const entries = await Promise.all(
    Object.entries(paths).map(async ([key, path]) => {
      const map = await textureLoader.loadAsync(path);
      map.colorSpace = NoColorSpace;
      map.wrapS = RepeatWrapping;
      map.wrapT = RepeatWrapping;
      map.minFilter = LinearMipMapLinearFilter;
      map.magFilter = LinearFilter;
      map.generateMipmaps = true;
      return [key, map];
    }),
  );
  return Object.fromEntries(entries);
}

export function setProceduralPbrDebugMode(material, debugMode) {
  const state = material.userData.proceduralPbr;
  if (!state) return false;

  state.uniforms.debugMode.value = proceduralPbrDebugModes.get(debugMode) ?? 0;
  material.needsUpdate = true;
  return true;
}

export function setLavaFlowTime(material, elapsedSeconds) {
  const state = material.userData.proceduralPbr;
  if (!state?.uniforms.flowTime) return false;

  state.uniforms.flowTime.value = elapsedSeconds;
  return true;
}

// The default example has no mandatory compute kernel: analytic TSL fields and
// optional data maps are cheaper for these hero identities. This helper exists
// for callers that add generated cause maps or storage-backed instance state.
export async function initializeProceduralPbrMaterialData(renderer, {
  computeNodes = [],
} = {}) {
  const previousRenderTarget = renderer.getRenderTarget?.();

  try {
    await renderer.init();
    const isWebGPUBackend = renderer.backend?.isWebGPUBackend === true;
    if (!isWebGPUBackend) {
      throw new Error(PROCEDURAL_PBR_WEBGPU_REQUIRED_MESSAGE);
    }
    if (computeNodes.length > 0) {
      await renderer.computeAsync(computeNodes);
    }
    return { isWebGPUBackend, computeNodeCount: computeNodes.length };
  } finally {
    if (renderer.setRenderTarget && previousRenderTarget !== undefined) {
      renderer.setRenderTarget(previousRenderTarget);
    }
  }
}

export function disposeProceduralPbrMaterial(material) {
  if (!material || disposedProceduralMaterials.has(material)) return false;

  const state = material.userData.proceduralPbr;
  if (state?.disposeTextures) {
    for (const textureToDispose of state.disposeTextures) {
      textureToDispose.dispose?.();
    }
    state.disposeTextures.length = 0;
  }
  material.dispose?.();
  disposedProceduralMaterials.add(material);
  return true;
}

export function disposeTextureSet(textureSet) {
  if (!textureSet || typeof textureSet !== "object") return 0;

  let disposedCount = 0;
  for (const [key, textureToDispose] of Object.entries(textureSet)) {
    textureToDispose?.dispose?.();
    if (textureToDispose?.dispose) disposedCount += 1;
    delete textureSet[key];
  }
  return disposedCount;
}
