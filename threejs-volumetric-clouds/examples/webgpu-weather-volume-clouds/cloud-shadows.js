import { StorageTexture } from "three/webgpu";
import {
  Break,
  Fn,
  If,
  Loop,
  exp,
  float,
  instanceIndex,
  texture,
  textureStore,
  uvec2,
  vec2,
  vec4,
} from "three/tsl";

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

function shadowCellFromIndex(resolution) {
  const x = instanceIndex.mod(resolution);
  const y = instanceIndex.div(resolution);
  return uvec2(x, y);
}

export function createCloudShadowMarchNode({ shadowConfig, targets } = {}) {
  if (!shadowConfig) {
    throw new Error("shadowConfig is required for the cloud shadow kernel");
  }
  if (!targets) {
    throw new Error("targets are required for the cloud shadow kernel");
  }

  const constants = {
    resolution: shadowConfig.resolution,
    maxSamples: shadowConfig.maxSamples,
    minTransmittance: shadowConfig.minTransmittance,
  };

  const kernel = Fn(({ cloudShadowCascade, localWeather, shape }) => {
    const cell = shadowCellFromIndex(constants.resolution);
    const uv = vec2(cell).add(0.5).div(constants.resolution);
    const transmittance = float(1).toVar();
    const opticalDepth = float(0).toVar();
    const meanExtinction = float(0).toVar();
    const frontDepth = float(0).toVar();

    Loop(constants.maxSamples, ({ i }) => {
      If(transmittance.lessThan(constants.minTransmittance), () => {
        Break();
      });

      const depthFraction = float(i).add(0.5).div(constants.maxSamples);
      const weather = texture(localWeather, uv).r;
      const shapeDensity = texture(shape, vec4(uv, depthFraction, 0).xyz).r;
      const extinction = weather.mul(shapeDensity).mul(8);
      opticalDepth.assign(opticalDepth.add(extinction));
      meanExtinction.assign(meanExtinction.add(extinction.div(constants.maxSamples)));
      frontDepth.assign(frontDepth.add(depthFraction.mul(extinction)));
      transmittance.assign(exp(opticalDepth.negate()));
    });

    textureStore(
      cloudShadowCascade,
      cell,
      vec4(
        frontDepth.div(opticalDepth.max(1e-5)),
        meanExtinction,
        opticalDepth,
        transmittance,
      ),
    ).toWriteOnly();
  });

  return kernel(targets)
    .compute(constants.resolution * constants.resolution, [64])
    .setName("cloud:shadow-march");
}
