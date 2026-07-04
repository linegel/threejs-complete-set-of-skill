import {
  Fn,
  float,
  mrt,
  pass,
  storageTexture,
  storageTexture3D,
  textureStore,
  vec3,
} from "three/tsl";

const tslSymbols = {
  Fn,
  float,
  vec3,
  storageTexture,
  storageTexture3D,
  textureStore,
  pass,
  mrt,
};

void tslSymbols;

export const LIGHTING_DEBUG_CHANNELS = Object.freeze([
  "weatherRGBA",
  "perLayerHeightFraction",
  "packedEmptyIntervals",
  "coverageRemappedDensity",
  "baseShape",
  "detailModifier",
  "turbulenceDisplacement",
  "finalDensityVector",
  "totalScatteringExtinction",
  "sunOpticalDepth",
  "cloudShadowCascade",
  "opticalDepth",
  "transmittance",
  "representativeDepth",
]);

export function henyeyGreenstein(cosTheta, g) {
  const gg = g * g;
  const denominator = Math.pow(Math.max(1 + gg - 2 * g * cosTheta, 1e-6), 1.5);
  return (1 - gg) / (4 * Math.PI * denominator);
}

export function dualHenyeyGreenstein(cosTheta, forwardG = 0.72, backG = -0.25) {
  return (
    0.82 * henyeyGreenstein(cosTheta, forwardG) +
    0.18 * henyeyGreenstein(cosTheta, backG)
  );
}

export function stepTransmittance(extinction, stepLengthMeters) {
  return Math.exp(-Math.max(0, extinction) * Math.max(0, stepLengthMeters));
}

export function multiScattering({
  opticalDepth,
  cosTheta,
  octaves = 4,
  attenuationA = 1,
  attenuationB = 0.55,
  attenuationC = 0.35,
}) {
  let contribution = 0;
  let attenuation = 1;

  for (let octave = 0; octave < octaves; octave += 1) {
    const phaseG = Math.min(0.9, attenuationC + octave * 0.08);
    contribution +=
      attenuation *
      attenuationA *
      Math.exp(-opticalDepth * attenuationB * (octave + 1)) *
      henyeyGreenstein(cosTheta, phaseG);
    attenuation *= 0.5;
  }

  return contribution;
}

export function groundBounce({
  cloudHeightFraction,
  groundAlbedo = 0.18,
  accumulatedTransmittance = 1,
}) {
  const lowCloudWeight = Math.max(0, 1 - cloudHeightFraction);
  return groundAlbedo * lowCloudWeight * accumulatedTransmittance;
}

export function integrateCloudStep({
  radiance,
  extinction,
  stepLengthMeters,
  accumulatedTransmittance,
}) {
  const stepT = stepTransmittance(extinction, stepLengthMeters);
  const stepScatter =
    extinction <= 1e-6 ? radiance * stepLengthMeters : (radiance - radiance * stepT) / extinction;
  return {
    radiance: accumulatedTransmittance * stepScatter,
    transmittance: accumulatedTransmittance * stepT,
    stepTransmittance: stepT,
  };
}

export function representativeDepth(previousDepth, distance, sampleWeight) {
  const previousWeight = previousDepth.weight ?? 0;
  const nextWeight = previousWeight + sampleWeight;
  if (nextWeight <= 1e-6) {
    return { meters: previousDepth.meters ?? 0, weight: 0 };
  }

  return {
    meters:
      ((previousDepth.meters ?? 0) * previousWeight + distance * sampleWeight) /
      nextWeight,
    weight: nextWeight,
  };
}

export function createCloudBeautyNodeContract({
  qualityTier = "default",
  shadowProduct = "cloudShadowCascade",
} = {}) {
  return {
    name: "webgpuWeatherVolumeCloudBeauty",
    rendererPath: "WebGPURenderer + TSL Fn().compute(count)",
    qualityTier,
    writes: [
      "cloudRadianceTransmittance RGBA16F StorageTexture",
      "representativeDepthVelocity RGBA16F StorageTexture",
      "historyRejection R16 StorageTexture",
    ],
    reads: [
      "localWeather NoColorSpace texture",
      "shape Data3DTexture or Storage3DTexture",
      "shapeDetail Data3DTexture or Storage3DTexture",
      "turbulence NoColorSpace texture",
      "stbn NoColorSpace texture",
      shadowProduct,
      "sceneDepth",
      "hostVelocity",
    ],
    lighting: {
      phase: "dual henyeyGreenstein",
      shadow: "short sun march + cloudShadowCascade opticalDepth lookup",
      multiScattering: "4-8 octave multiScattering",
      groundBounce: "optional groundBounce",
      integration: "stepTransmittance energy-conserving front-to-back",
    },
    temporalOutputs: {
      representativeDepth: "transmittance-weighted sample distance",
      velocity: "cloud sample velocity for historyUV reprojection",
      depthReject: "reject history across disocclusion",
      varianceClip: "clip accepted history against current neighborhood",
    },
    debugChannels: LIGHTING_DEBUG_CHANNELS,
  };
}
