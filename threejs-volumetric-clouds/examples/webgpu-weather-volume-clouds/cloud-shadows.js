import { StorageTexture } from "three/webgpu";
import {
  Break,
  Fn,
  If,
  Loop,
  abs,
  dot,
  exp,
  float,
  instanceIndex,
  select,
  texture,
  texture3D,
  textureStore,
  uvec2,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

export const CLOUD_SHADOW_CHANNELS = Object.freeze({
  r: "opticalDepth",
});

export function createCloudShadowCascadeConfig({
  tier = null,
  cascadeCount = 2,
  resolution = 384,
  shadowUpdateCadence = 4,
  maxSamples = 40,
  minTransmittance = 0.0001,
  depthRangeMeters = 8000,
  betaExtinctionPerMeter = 0.001,
  receiverDomain = "opaque-or-ground-after-full-column",
  format = "R16F",
} = {}) {
  const tierDefaults = {
    ultra: { cascadeCount: 3, resolution: 1024, maxSamples: 64 },
    high: { cascadeCount: 3, resolution: 512, maxSamples: 48 },
    default: { cascadeCount: 2, resolution: 384, maxSamples: 32 },
    mobile: { cascadeCount: 1, resolution: 256, maxSamples: 16 },
    reduced: { cascadeCount: 1, resolution: 256, maxSamples: 16 },
  }[tier];
  if (tierDefaults) {
    cascadeCount = tierDefaults.cascadeCount;
    resolution = tierDefaults.resolution;
    maxSamples = tierDefaults.maxSamples;
  }
  return {
    name: "cloudShadowCascade",
    claimLevel: "scaffold-only",
    sourceImplemented: true,
    runtimeEvidence: "not-run",
    implementationStatus: "sun-aligned optical-depth kernel scaffold; cascade anchoring, scheduling, and browser execution are not implemented",
    storageType: StorageTexture.name,
    cascadeCount,
    resolution,
    shadowUpdateCadence,
    maxSamples,
    minTransmittance,
    depthRangeMeters,
    betaExtinctionPerMeter,
    receiverDomain,
    format,
    channelLayout: [CLOUD_SHADOW_CHANNELS.r],
    sampling: {
      parameterAxis: "sun-aligned light-space depth",
      sunAligned: true,
      stableJitterImplemented: true,
      sunDirection: [0.38, 0.82, -0.42],
      lightRight: [0.7415357791, 0, 0.6709133239],
      lightUp: [-0.5501489256, 0.5723635209, 0.6080593378],
      cascadeExtentsMeters: [32000, 96000, 288000].slice(0, cascadeCount),
    },
    decoder: {
      transmittance: "exp(-opticalDepth)",
      depthResolved: false,
      validReceiver: receiverDomain,
    },
  };
}

export function estimateCloudShadowBytes(config) {
  const r16fBytes = 2;
  return config.cascadeCount * config.resolution * config.resolution * r16fBytes;
}

export function validateCloudShadowConfig(config) {
  const errors = [];

  if (config.storageType !== "StorageTexture") {
    errors.push("cloudShadowCascade must use StorageTexture targets");
  }
  if (config.format !== "R16F") {
    errors.push("full-column cloud optical depth must use the declared R16F format");
  }
  if (config.cascadeCount < 1 || config.cascadeCount > 4) {
    errors.push("cloudShadowCascade cascadeCount must be 1-4");
  }
  if (config.resolution < 128 || config.resolution > 1024) {
    errors.push("cloudShadowCascade resolution must be 128-1024");
  }
  if (config.shadowUpdateCadence < 1 || config.shadowUpdateCadence > 16) {
    errors.push("shadowUpdateCadence must be 1-16 frames");
  }
  if (config.channelLayout.length !== 1 || config.channelLayout[0] !== "opticalDepth") {
    errors.push("cloudShadowCascade channelLayout must contain only opticalDepth");
  }
  if (config.receiverDomain !== "opaque-or-ground-after-full-column") {
    errors.push("2D total optical depth is valid only for opaque/ground receivers after the full column");
  }
  if (!(config.depthRangeMeters > 0) || !(config.betaExtinctionPerMeter > 0)) {
    errors.push("shadow optical depth requires positive meter length and inverse-meter extinction");
  }
  if (config.decoder?.depthResolved !== false) {
    errors.push("the full-column R16F scaffold must not claim depth-resolved in-cloud lookup");
  }

  return {
    ok: errors.length === 0,
    errors,
    bytes: estimateCloudShadowBytes(config),
  };
}

function shadowCellFromIndex(resolution) {
  const x = instanceIndex.mod(resolution);
  const y = instanceIndex.div(resolution);
  return uvec2(x, y);
}

export function createCloudShadowMarchNode({ shadowConfig, targets, cascadeIndex = 0 } = {}) {
  if (!shadowConfig) {
    throw new Error("shadowConfig is required for the cloud shadow kernel");
  }
  if (!targets) {
    throw new Error("targets are required for the cloud shadow kernel");
  }

  const constants = {
    resolution: shadowConfig.resolution,
    maxSamples: shadowConfig.maxSamples,
    betaExtinctionPerMeter: shadowConfig.betaExtinctionPerMeter,
    segmentLengthMeters: shadowConfig.depthRangeMeters / shadowConfig.maxSamples,
    maxOpticalDepth: -Math.log(shadowConfig.minTransmittance),
    cascadeIndex,
    cascadeExtentMeters:
      shadowConfig.sampling.cascadeExtentsMeters[cascadeIndex] ??
      shadowConfig.sampling.cascadeExtentsMeters.at(-1),
    sunDirection: shadowConfig.sampling.sunDirection,
    lightRight: shadowConfig.sampling.lightRight,
    lightUp: shadowConfig.sampling.lightUp,
  };

  const kernel = Fn(({ cloudShadowCascade, localWeather, shape }) => {
    const cell = shadowCellFromIndex(constants.resolution);
    const uv = vec2(cell).add(0.5).div(constants.resolution);
    const opticalDepth = float(0).toVar();
    const plane = uv.sub(0.5).mul(constants.cascadeExtentMeters);
    const sunDirection = vec4(...constants.sunDirection, 0).xyz;
    const lightRight = vec4(...constants.lightRight, 0).xyz;
    const lightUp = vec4(...constants.lightUp, 0).xyz;
    const rayStart = lightRight
      .mul(plane.x)
      .add(lightUp.mul(plane.y))
      .sub(sunDirection.mul(shadowConfig.depthRangeMeters * 0.5));

    Loop(constants.maxSamples, ({ i }) => {
      If(opticalDepth.greaterThanEqual(constants.maxOpticalDepth), () => {
        Break();
      });

      const depthFraction = float(i).add(0.5).div(constants.maxSamples);
      const worldPosition = rayStart.add(
        sunDirection.mul(depthFraction.mul(shadowConfig.depthRangeMeters)),
      );
      const weatherUv = worldPosition.xz.mul(1 / 120000);
      const weather = texture(localWeather, weatherUv).rgb;
      const warped = weatherUv.mul(4);
      const shapeDensity = texture3D(
        shape,
        vec3(warped.x, warped.y, depthFraction),
      ).r;
      const dimensionlessDensity = weather.r
        .max(weather.g)
        .max(weather.b)
        .mul(shapeDensity)
        .max(0);
      const sigmaT = dimensionlessDensity.mul(constants.betaExtinctionPerMeter);
      opticalDepth.assign(
        opticalDepth.add(sigmaT.mul(constants.segmentLengthMeters)),
      );
    });

    textureStore(
      cloudShadowCascade,
      cell,
      vec4(opticalDepth, 0, 0, 1),
    ).toWriteOnly();
  });

  const node = kernel(targets)
    .compute(constants.resolution * constants.resolution, [64])
    .setName(`cloud:sun-optical-depth:cascade-${cascadeIndex}`);
  node.cloudImplementationStatus = shadowConfig.implementationStatus;
  node.cloudStorageTextureBindingCount = 1;
  return node;
}

/**
 * Samples the smallest containing sun-aligned optical-depth cascade for an
 * opaque receiver. This is deliberately separate from ordinary comparison
 * shadows and is valid only for receivers behind the full cloud column.
 */
export function sampleCloudShadowTransmission({
  worldPositionNode,
  shadowTextures,
  shadowConfig,
} = {}) {
  if (!worldPositionNode || !Array.isArray(shadowTextures) || shadowTextures.length === 0) {
    throw new Error("cloud shadow receiver requires world position and cascade textures");
  }
  if (!shadowConfig?.sampling?.sunAligned) {
    throw new Error("cloud shadow receiver requires the sun-aligned cascade contract");
  }
  const right = vec4(...shadowConfig.sampling.lightRight, 0).xyz;
  const up = vec4(...shadowConfig.sampling.lightUp, 0).xyz;
  const plane = vec2(dot(worldPositionNode, right), dot(worldPositionNode, up));
  let transmission = float(1);
  for (let index = shadowTextures.length - 1; index >= 0; index -= 1) {
    const extent = shadowConfig.sampling.cascadeExtentsMeters[index];
    const uv = plane.div(extent).add(0.5);
    const inside = abs(plane.x).lessThanEqual(extent * 0.5)
      .and(abs(plane.y).lessThanEqual(extent * 0.5));
    const cascadeTransmission = exp(texture(shadowTextures[index], uv).r.max(0).negate());
    transmission = select(inside, cascadeTransmission, transmission);
  }
  return transmission;
}
