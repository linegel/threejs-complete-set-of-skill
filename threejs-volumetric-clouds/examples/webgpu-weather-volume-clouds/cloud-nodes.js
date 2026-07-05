import {
  Break,
  Fn,
  If,
  Loop,
  Continue,
  dot,
  exp,
  float,
  instanceIndex,
  mrt,
  pass,
  select,
  storageTexture,
  storageTexture3D,
  texture,
  textureStore,
  uvec2,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

import { computeCloudTargetSize, getCloudQualityTier } from "./cloud-config.js";

const tslSymbols = {
  Break,
  Fn,
  If,
  Loop,
  Continue,
  dot,
  exp,
  float,
  instanceIndex,
  vec3,
  vec4,
  vec2,
  uvec2,
  texture,
  storageTexture,
  storageTexture3D,
  textureStore,
  pass,
  mrt,
  select,
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

function cellFromIndex(width) {
  const x = instanceIndex.mod(width);
  const y = instanceIndex.div(width);
  return uvec2(x, y);
}

function uvFromCell(cell, width, height) {
  return vec2(cell).add(0.5).div(vec2(width, height));
}

function scalarConstantsFromConfig(config, viewport) {
  const tier = getCloudQualityTier(config);
  const low = computeCloudTargetSize(viewport, tier);
  const intervals = config.intervalContract;
  return {
    tierName: tier.name,
    width: low.width,
    height: low.height,
    primarySteps: tier.primarySteps,
    lightSteps: tier.lightSteps,
    temporalFrames: tier.temporalFrames,
    detailEnabled: tier.detail ? 1 : 0,
    turbulenceEnabled: tier.turbulence ? 1 : 0,
    groundBounceEnabled: tier.groundBounce ? 1 : 0,
    multiScatteringOctaves: tier.multiScatteringOctaves,
    minAltitudeMeters: intervals.minAltitudeMeters,
    maxAltitudeMeters: intervals.maxAltitudeMeters,
    packedGapMinMeters: intervals.packedGaps[0]?.[0] ?? 1e9,
    packedGapMaxMeters: intervals.packedGaps[0]?.[1] ?? -1e9,
    maxRayDistanceMeters: 200000,
    minTransmittance: 0.01,
    minDensity: 1e-5,
    extinctionScale: 8,
  };
}

export function createCloudBeautyMarchNode({
  config,
  viewport = config.referenceViewport,
  targets,
  frame = 0,
} = {}) {
  if (!config) {
    throw new Error("config is required for the cloud beauty march kernel");
  }
  if (!targets) {
    throw new Error("targets are required for the cloud beauty march kernel");
  }

  const constants = scalarConstantsFromConfig(config, viewport);

  const kernel = Fn(
    ({
      radianceTransmittance,
      representativeDepthVelocity,
      rejectionMask,
      localWeather,
      shape,
      shapeDetail,
      turbulence,
      stbn,
      cloudShadowCascade,
      sceneDepth,
      hostVelocity,
    }) => {
      const cell = cellFromIndex(constants.width);
      const uv = uvFromCell(cell, constants.width, constants.height);
      const rayFar = float(constants.maxRayDistanceMeters);
      const stepLength = rayFar.div(constants.primarySteps);
      const blueNoise = texture(
        stbn,
        vec3(
          uv,
          float((frame % 64) + 0.5).div(64),
        ),
      ).r;
      const distanceAlongRay = stepLength.mul(blueNoise).toVar();
      const transmittance = float(1).toVar();
      const radiance = vec3(0).toVar();
      const representativeMeters = float(0).toVar();
      const representativeWeight = float(0).toVar();

      Loop(constants.primarySteps, () => {
        If(
          distanceAlongRay.greaterThanEqual(rayFar).or(
            transmittance.lessThan(constants.minTransmittance),
          ),
          () => {
            Break();
          },
        );

        const heightMeters = float(constants.minAltitudeMeters).add(
          distanceAlongRay
            .div(rayFar)
            .mul(constants.maxAltitudeMeters - constants.minAltitudeMeters),
        );
        const inPackedGap = heightMeters
          .greaterThanEqual(constants.packedGapMinMeters)
          .and(heightMeters.lessThanEqual(constants.packedGapMaxMeters));

        If(inPackedGap, () => {
          distanceAlongRay.assign(distanceAlongRay.add(stepLength.mul(4)));
          Continue();
        });

        const weather = texture(localWeather, uv);
        const shapeCoordinate = vec3(
          uv.mul(32),
          heightMeters.div(constants.maxAltitudeMeters),
        );
        const baseShape = texture(shape, shapeCoordinate).r;
        const detailShape = texture(shapeDetail, shapeCoordinate.mul(4)).r;
        const turbulenceVector = texture(turbulence, uv.mul(8)).rgb.mul(2).sub(1);
        const layerCoverage = weather.r.max(weather.g).max(weather.b);
        const detailModifier = float(1)
          .sub(detailShape)
          .mul(constants.detailEnabled)
          .add(float(1).sub(constants.detailEnabled));
        const turbulenceLift = dot(turbulenceVector, vec3(0.25, 0.5, 0.25))
          .mul(0.08)
          .mul(constants.turbulenceEnabled);
        const density = layerCoverage
          .mul(baseShape)
          .mul(detailModifier)
          .add(turbulenceLift)
          .max(0);

        If(density.lessThan(constants.minDensity), () => {
          distanceAlongRay.assign(distanceAlongRay.add(stepLength.mul(2)));
          Continue();
        });

        const opticalDepth = float(0).toVar();
        Loop(constants.lightSteps, () => {
          opticalDepth.assign(
            opticalDepth.add(density.mul(stepLength).mul(0.00004)),
          );
        });

        const shadowDepth = texture(cloudShadowCascade, uv).b;
        const sunTransmittance = exp(
          opticalDepth.add(shadowDepth).mul(-1.25),
        );
        const phase = float(0.55).add(weather.b.mul(0.35));
        const sky = vec3(0.28, 0.35, 0.46).mul(0.48);
        const sun = vec3(1.0, 0.88, 0.72).mul(sunTransmittance).mul(phase);
        const bounce = vec3(0.18).mul(constants.groundBounceEnabled);
        const source = sky.add(sun).add(bounce);
        const extinction = density.mul(constants.extinctionScale);
        const stepT = exp(extinction.mul(stepLength).mul(-0.001));
        const scatter = source.mul(float(1).sub(stepT)).div(extinction.max(1e-5));
        const sampleWeight = transmittance.mul(float(1).sub(stepT));

        radiance.assign(radiance.add(scatter.mul(transmittance)));
        representativeMeters.assign(
          representativeMeters
            .mul(representativeWeight)
            .add(distanceAlongRay.mul(sampleWeight))
            .div(representativeWeight.add(sampleWeight).max(1e-5)),
        );
        representativeWeight.assign(representativeWeight.add(sampleWeight));
        transmittance.assign(transmittance.mul(stepT));
        distanceAlongRay.assign(distanceAlongRay.add(stepLength));
      });

      const sceneDepthValue = texture(sceneDepth, uv).r;
      const velocity = texture(hostVelocity, uv).xy;
      const confidence = select(sceneDepthValue.lessThan(1), 1, 0);

      textureStore(
        radianceTransmittance,
        cell,
        vec4(radiance, transmittance),
      ).toWriteOnly();
      textureStore(
        representativeDepthVelocity,
        cell,
        vec4(representativeMeters, velocity.x, velocity.y, confidence),
      ).toWriteOnly();
      textureStore(
        rejectionMask,
        cell,
        vec4(0, confidence, representativeWeight, 1),
      ).toWriteOnly();
    },
  );

  return kernel(targets)
    .compute(constants.width * constants.height, [64])
    .setName(`cloud:beauty:${constants.tierName}`);
}

export function runPureJsCloudMarchMirror({
  config,
  viewport = config.referenceViewport,
  samplePixels = 8,
} = {}) {
  if (!config) {
    throw new Error("config is required for the pure JS cloud march mirror");
  }

  const tier = getCloudQualityTier(config);
  const low = computeCloudTargetSize(viewport, tier);
  let primaryIterations = 0;
  let lightIterations = 0;
  let transmittance = 1;

  const pixelsToMirror = Math.min(samplePixels, low.width * low.height);
  for (let pixel = 0; pixel < pixelsToMirror; pixel += 1) {
    transmittance = 1;
    for (let primary = 0; primary < tier.primarySteps; primary += 1) {
      primaryIterations += 1;
      if (transmittance < 0.01) {
        break;
      }
      const density = ((pixel + primary) % 7) / 64 + 0.001;
      for (let light = 0; light < tier.lightSteps; light += 1) {
        lightIterations += 1;
      }
      transmittance *= Math.exp(-density);
    }
  }

  return {
    tier: tier.name,
    lowResolution: low,
    mirroredPixels: pixelsToMirror,
    primaryIterations,
    lightIterations,
    configuredProduct:
      low.width * low.height * tier.primarySteps * tier.lightSteps,
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
