import { StorageTexture } from "three/webgpu";

export const CLOUD_SHADOW_CHANNELS = Object.freeze({
  r: "frontDepth",
  g: "meanExtinction",
  b: "maxOpticalDepth",
  a: "tailEstimate",
});

export function createCloudShadowCascadeConfig({
  cascadeCount = 2,
  resolution = 384,
  shadowUpdateCadence = 4,
  maxSamples = 40,
  minTransmittance = 0.0001,
} = {}) {
  return {
    name: "cloudShadowCascade",
    storageType: StorageTexture.name,
    cascadeCount,
    resolution,
    shadowUpdateCadence,
    maxSamples,
    minTransmittance,
    format: "RGBA16F",
    channelLayout: [
      CLOUD_SHADOW_CHANNELS.r,
      CLOUD_SHADOW_CHANNELS.g,
      CLOUD_SHADOW_CHANNELS.b,
      CLOUD_SHADOW_CHANNELS.a,
    ],
    structuredSampling: {
      label: "shadow structured sampling planes",
      structureNormals: 3,
      planeSpacingMeters: [100, 1000],
      temporalJitter: "stable cascade/frame index, not beauty jitter",
    },
    lightingLookup: {
      shortSunMarch: true,
      compactOpticalDepthProduct: "opticalDepth from RGBA cascade channels",
      reconstructsTailEstimate: true,
    },
  };
}

export function estimateCloudShadowBytes(config) {
  const rgba16fBytes = 8;
  return config.cascadeCount * config.resolution * config.resolution * rgba16fBytes;
}

export function validateCloudShadowConfig(config) {
  const errors = [];

  if (config.storageType !== "StorageTexture") {
    errors.push("cloudShadowCascade must use StorageTexture targets");
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
  for (const channel of Object.values(CLOUD_SHADOW_CHANNELS)) {
    if (!config.channelLayout.includes(channel)) {
      errors.push(`cloudShadowCascade channelLayout missing ${channel}`);
    }
  }
  if (config.structuredSampling.structureNormals < 3) {
    errors.push("cloudShadowCascade needs structured sampling normals");
  }

  return {
    ok: errors.length === 0,
    errors,
    bytes: estimateCloudShadowBytes(config),
  };
}
