import {
  Break,
  abs,
  bool,
  Fn,
  If,
  Loop,
  Continue,
  dot,
  exp,
  float,
  instanceIndex,
  length,
  max,
  min,
  mrt,
  pass,
  pow,
  normalize,
  select,
  sqrt,
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
  bool,
  Fn,
  If,
  Loop,
  Continue,
  dot,
  exp,
  float,
  instanceIndex,
  max,
  vec3,
  vec4,
  vec2,
  uvec2,
  texture,
  storageTexture3D,
  textureStore,
  pass,
  pow,
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

export const CLOUD_BEAUTY_KERNEL_STATUS = Object.freeze({
  claimLevel: "scaffold-only",
  sourceImplemented: true,
  runtimeEvidence: "not-run",
  conformingRenderer: false,
  implemented: [
    "reduced-grid compute kernel source",
    "unit-consistent homogeneous segment transfer",
    "packed vertical-gap skipping",
    "turbulence coordinate warp",
    "camera-basis ray reconstruction and bounded spherical/slab/OBB intervals",
    "sampled host scene-depth reconstruction and metric interval clamp",
    "independent compact-support layer density",
    "fixed authored sun-direction bounded light march",
    "separate metric representative-depth, depth-moment, and wind-derived velocity writes",
    "split beauty/auxiliary compute with at most three storage bindings per pipeline",
    "projected previous-camera representative-point velocity in the auxiliary pass",
  ],
  notImplemented: [
    "browser WebGPU execution, readback, numerical parity, and image-quality evidence",
    "conservative 3D macrocell hierarchy",
    "finite-sun or atmosphere-coupled incident-light convention",
    "browser WebGPU proof of bilinear history filtering and temporal error",
    "multi-depth split histories for disjoint independently moving layers",
  ],
});

export function henyeyGreenstein(cosTheta, g) {
  if (!Number.isFinite(cosTheta) || !Number.isFinite(g) || Math.abs(g) >= 1) {
    throw new Error("Henyey-Greenstein requires finite cosTheta and |g| < 1.");
  }
  const mu = Math.min(1, Math.max(-1, cosTheta));
  const gg = g * g;
  const denominator = Math.pow(Math.max(1 + gg - 2 * g * mu, 1e-12), 1.5);
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
  sourceCoefficient,
  extinction,
  stepLengthMeters,
  accumulatedTransmittance,
}) {
  if (![sourceCoefficient, extinction, stepLengthMeters, accumulatedTransmittance].every(Number.isFinite)) {
    throw new Error("integrateCloudStep requires finite source, extinction, distance, and transmittance.");
  }
  const stepT = stepTransmittance(extinction, stepLengthMeters);
  const stepRadiance = extinction <= 1e-8
    ? sourceCoefficient * stepLengthMeters
    : sourceCoefficient / extinction * (1 - stepT);
  return {
    radiance: accumulatedTransmittance * stepRadiance,
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

const henyeyGreensteinNode = Fn(({ cosTheta, g }) => {
  const gg = g.mul(g);
  const denominator = pow(
    max(float(1).add(gg).sub(g.mul(cosTheta).mul(2)), 1e-6),
    1.5,
  );
  return float(1).sub(gg).div(denominator.mul(4 * Math.PI));
});

const dualHenyeyGreensteinNode = Fn(({ cosTheta }) => (
  henyeyGreensteinNode({ cosTheta, g: float(0.72) }).mul(0.82).add(
    henyeyGreensteinNode({ cosTheta, g: float(-0.25) }).mul(0.18),
  )
));

function cellFromIndex(width) {
  const x = instanceIndex.mod(width);
  const y = instanceIndex.div(width);
  return uvec2(x, y);
}

function uvFromCell(cell, width, height) {
  return vec2(cell).add(0.5).div(vec2(width, height));
}

function scalarConstantsFromConfig(config, viewport, {
  cameraState = config.camera,
  previousCameraState = cameraState,
} = {}) {
  const tier = getCloudQualityTier(config);
  const low = computeCloudTargetSize(viewport, tier);
  const intervals = config.intervalContract;
  const maxRayDistanceMeters = 200000;
  const aspect = viewport.width / viewport.height;
  const tanHalfFov = Math.tan(cameraState.verticalFovRadians * 0.5);
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
    packedGaps: intervals.packedGaps.map(([minimum, maximum]) => ({
      minimum,
      maximum,
      exitDistanceMeters:
        (maximum - intervals.minAltitudeMeters) /
        Math.max(intervals.maxAltitudeMeters - intervals.minAltitudeMeters, 1) *
        maxRayDistanceMeters,
    })),
    maxRayDistanceMeters,
    minTransmittance: 0.01,
    minDensity: 1e-5,
    betaScatteringPerMeter: config.optics.betaScatteringPerMeter,
    betaAbsorptionPerMeter: config.optics.betaAbsorptionPerMeter,
    localLightDistanceMeters: 8000,
    authoredCosTheta: 0.4,
    aspect,
    tanHalfFov,
    camera: structuredClone(cameraState),
    previousCamera: structuredClone(previousCameraState),
    domain: structuredClone(config.domain),
    planetRadiusMeters:
      config.domain.planetRadiusMeters ?? config.domain.innerRadiusMeters ?? 0,
    macroWindMetersPerSecond: {
      x: config.layers.reduce(
        (sum, layer) => sum + layer.weatherWindMetersPerSecond.x,
        0,
      ) / config.layers.length,
      z: config.layers.reduce(
        (sum, layer) => sum + layer.weatherWindMetersPerSecond.y,
        0,
      ) / config.layers.length,
    },
    layers: config.layers.map((layer) => ({
      ...layer,
      channelIndex: { r: 0, g: 1, b: 2, a: 3 }[layer.weatherChannel],
    })),
  };
}

function vec3FromArray(value) {
  return vec3(value[0], value[1], value[2]);
}

function reconstructCameraRay(uv, constants) {
  const ndc = uv.mul(2).sub(1);
  const forward = vec3FromArray(constants.camera.forward);
  const right = vec3FromArray(constants.camera.right);
  const up = vec3FromArray(constants.camera.up);
  return normalize(
    forward
      .add(right.mul(ndc.x.mul(constants.aspect * constants.tanHalfFov)))
      .add(up.mul(ndc.y.mul(constants.tanHalfFov))),
  );
}

function raySphereRoots(origin, direction, center, radius) {
  const localOrigin = origin.sub(center);
  const b = dot(localOrigin, direction);
  const c = dot(localOrigin, localOrigin).sub(radius * radius);
  const discriminant = b.mul(b).sub(c);
  const root = sqrt(max(discriminant, 0));
  return {
    hit: discriminant.greaterThanEqual(0),
    near: b.negate().sub(root),
    far: b.negate().add(root),
    originRadius: length(localOrigin),
  };
}

function intersectConfiguredDomain(origin, direction, constants) {
  const domain = constants.domain;
  if (domain.type === "spherical-shell") {
    const center = vec3FromArray(domain.center);
    const outer = raySphereRoots(
      origin,
      direction,
      center,
      domain.outerRadiusMeters,
    );
    const inner = raySphereRoots(
      origin,
      direction,
      center,
      domain.innerRadiusMeters,
    );
    const startsInsideInner = outer.originRadius.lessThan(
      domain.innerRadiusMeters,
    );
    const baseNear = max(outer.near, 0);
    const near = select(startsInsideInner, max(baseNear, inner.far), baseNear);
    const innerAhead = inner.hit.and(inner.near.greaterThan(near));
    const far = select(
      startsInsideInner,
      outer.far,
      select(innerAhead, min(inner.near, outer.far), outer.far),
    );
    return { near, far, hit: outer.hit.and(far.greaterThan(near)) };
  }

  if (domain.type === "planar-slab") {
    // A slab is bounded in X/Z as well as Y. Treating parallel Y rays as an
    // unconditional hit admitted work outside the authored cloud domain.
    const centerY = (domain.minimumHeight + domain.maximumHeight) * 0.5;
    const localOrigin = vec3(origin.x, origin.y.sub(centerY), origin.z);
    const extents = [
      domain.horizontalHalfExtent,
      (domain.maximumHeight - domain.minimumHeight) * 0.5,
      domain.horizontalHalfExtent,
    ];
    const near = float(0).toVar();
    const far = float(constants.maxRayDistanceMeters).toVar();
    const valid = bool(true).toVar();
    const originComponents = [localOrigin.x, localOrigin.y, localOrigin.z];
    const directionComponents = [direction.x, direction.y, direction.z];
    for (let axis = 0; axis < 3; axis += 1) {
      const o = originComponents[axis];
      const d = directionComponents[axis];
      const safeD = select(abs(d).lessThan(1e-6), 1e-6, d);
      const axisNear = float(-extents[axis]).sub(o).div(safeD);
      const axisFar = float(extents[axis]).sub(o).div(safeD);
      near.assign(max(near, min(axisNear, axisFar)));
      far.assign(min(far, max(axisNear, axisFar)));
      valid.assign(valid.and(
        abs(d).lessThan(1e-6).and(abs(o).greaterThan(extents[axis])).not(),
      ));
    }
    near.assign(max(near, 0));
    return { near, far, hit: valid.and(far.greaterThan(near)) };
  }

  if (domain.type === "obb") {
    const relative = origin.sub(vec3FromArray(domain.center));
    const rows = domain.worldToLocalRows.map(vec3FromArray);
    const localOrigin = vec3(
      dot(rows[0], relative),
      dot(rows[1], relative),
      dot(rows[2], relative),
    );
    const localDirection = vec3(
      dot(rows[0], direction),
      dot(rows[1], direction),
      dot(rows[2], direction),
    );
    const extents = domain.halfExtents;
    const near = float(0).toVar();
    const far = float(constants.maxRayDistanceMeters).toVar();
    const valid = bool(true).toVar();
    const originComponents = [localOrigin.x, localOrigin.y, localOrigin.z];
    const directionComponents = [localDirection.x, localDirection.y, localDirection.z];
    for (let axis = 0; axis < 3; axis += 1) {
      const o = originComponents[axis];
      const d = directionComponents[axis];
      const safeD = select(abs(d).lessThan(1e-6), 1e-6, d);
      const axisNear = float(-extents[axis]).sub(o).div(safeD);
      const axisFar = float(extents[axis]).sub(o).div(safeD);
      near.assign(max(near, min(axisNear, axisFar)));
      far.assign(min(far, max(axisNear, axisFar)));
      const parallelOutside = abs(d)
        .lessThan(1e-6)
        .and(abs(o).greaterThan(extents[axis]));
      valid.assign(valid.and(parallelOutside.not()));
    }
    near.assign(max(near, 0));
    return { near, far, hit: valid.and(far.greaterThan(near)) };
  }

  throw new Error(`Unsupported cloud domain ${domain.type}`);
}

function altitudeForPosition(position, constants) {
  if (constants.domain.type === "spherical-shell") {
    return length(position.sub(vec3FromArray(constants.domain.center))).sub(
      constants.planetRadiusMeters,
    );
  }
  if (constants.domain.type === "planar-slab") return position.y;
  const relative = position.sub(vec3FromArray(constants.domain.center));
  return dot(vec3FromArray(constants.domain.worldToLocalRows[1]), relative)
    .add(constants.domain.halfExtents[1]);
}

function sampleLayeredDensity({
  position,
  timeSeconds,
  localWeather,
  shape,
  shapeDetail,
  turbulence,
  constants,
}) {
  const heightMeters = altitudeForPosition(position, constants);
  const baseUv = vec2(position.x, position.z)
    .mul(1 / 120000)
    .add(
      vec2(
        constants.macroWindMetersPerSecond.x,
        constants.macroWindMetersPerSecond.z,
      ).mul(timeSeconds / 120000),
    );
  const turbulenceVector = texture(turbulence, baseUv.mul(8)).rgb.mul(2).sub(1);
  const shapeCoordinate = vec3(
    baseUv.mul(4).add(turbulenceVector.xy.mul(0.012 * constants.turbulenceEnabled)),
    heightMeters.div(max(constants.maxAltitudeMeters, 1)),
  );
  const baseShape = texture(shape, shapeCoordinate).r;
  const detailShape = texture(shapeDetail, shapeCoordinate.mul(4)).r;
  const weather = texture(localWeather, baseUv);
  const total = float(0).toVar();

  for (const layer of constants.layers) {
    const heightFraction = heightMeters
      .sub(layer.baseAltitudeMeters)
      .div(layer.heightMeters);
    const inside = heightFraction
      .greaterThanEqual(0)
      .and(heightFraction.lessThanEqual(1));
    const h = heightFraction.clamp(0, 1);
    const support = h.mul(float(1).sub(h)).mul(4).clamp(0, 1);
    const profile = float(layer.densityProfile.exponentialTerm)
      .mul(exp(float(layer.densityProfile.exponent).mul(h)))
      .add(float(layer.densityProfile.linearTerm).mul(h))
      .add(layer.densityProfile.constantTerm)
      .max(0);
    const weatherChannel = [weather.r, weather.g, weather.b, weather.a][
      layer.channelIndex
    ].max(0);
    const shapedWeather = pow(weatherChannel, layer.weatherExponent);
    const coverage = shapedWeather
      .sub(float(1).sub(layer.coverageFilterWidth))
      .div(layer.coverageFilterWidth)
      .clamp(0, 1);
    const eroded = baseShape
      .sub(float(1).sub(detailShape).mul(layer.detailAmount * constants.detailEnabled * 0.35))
      .clamp(0, 1);
    const density = coverage
      .mul(eroded.mul(layer.shapeAmount).add(float(1 - layer.shapeAmount)))
      .mul(profile)
      .mul(support)
      .mul(layer.densityAmplitude);
    total.assign(total.add(select(inside, density, 0)));
  }
  return total.max(0);
}

export function createCloudBeautyMarchNode({
  config,
  viewport = config.referenceViewport,
  targets,
  timeSeconds = 0,
  frameIndex = 0,
  cameraState = config.camera,
  previousCameraState = cameraState,
} = {}) {
  if (!config) {
    throw new Error("config is required for the cloud beauty march kernel");
  }
  if (!targets) {
    throw new Error("targets are required for the cloud beauty march kernel");
  }

  if (!Number.isFinite(timeSeconds) || !Number.isInteger(frameIndex)) {
    throw new Error("cloud beauty requires finite timeSeconds and integer frameIndex");
  }
  if (!targets.sceneDepthTexture) {
    throw new Error("cloud beauty requires the host scene depth texture");
  }
  const constants = scalarConstantsFromConfig(config, viewport, {
    cameraState,
    previousCameraState,
  });
  const stochasticSequenceIndex = Math.floor(timeSeconds * 60);

  const kernel = Fn(
    ({
      radianceTransmittance,
      representativeDepthMeters,
      rejectionMask,
      sceneDepthTexture,
      localWeather,
      shape,
      shapeDetail,
      turbulence,
      stbn,
    }) => {
      const cell = cellFromIndex(constants.width);
      const uv = uvFromCell(cell, constants.width, constants.height);
      const rayOrigin = vec3FromArray(constants.camera.positionMeters);
      const rayDirection = reconstructCameraRay(uv, constants);
      const interval = intersectConfiguredDomain(rayOrigin, rayDirection, constants);
      const rawSceneDepth = texture(sceneDepthTexture, uv).x.clamp(0, 1);
      const nearMeters = constants.camera.nearMeters ?? 0.1;
      const farMeters = constants.camera.farMeters ?? constants.maxRayDistanceMeters;
      const viewZ = float(nearMeters * farMeters).div(
        rawSceneDepth.mul(farMeters - nearMeters).sub(farMeters),
      );
      const viewCosine = dot(
        rayDirection,
        vec3FromArray(constants.camera.forward),
      ).max(1e-5);
      const opaqueDistance = viewZ.negate().div(viewCosine);
      const rayNear = max(interval.near, 0);
      const rayFar = min(
        interval.far,
        min(opaqueDistance, constants.maxRayDistanceMeters),
      );
      const intervalValid = interval.hit.and(rayFar.greaterThan(rayNear));
      const stepLength = select(
        intervalValid,
        rayFar.sub(rayNear).div(constants.primarySteps),
        0,
      );
      const blueNoise = texture(
        stbn,
        vec3(uv, float((stochasticSequenceIndex % 64) + 0.5).div(64)),
      ).r;
      const distanceAlongRay = rayNear.add(stepLength.mul(blueNoise)).toVar();
      const transmittance = float(1).toVar();
      const radiance = vec3(0).toVar();
      const depthWeighted = float(0).toVar();
      const depthSquaredWeighted = float(0).toVar();
      const representativeWeight = float(0).toVar();
      const primarySampleCount = float(0).toVar();
      const lightSampleCount = float(0).toVar();

      Loop(constants.primarySteps, () => {
        If(
          distanceAlongRay.greaterThanEqual(rayFar).or(
            transmittance.lessThan(constants.minTransmittance),
          ),
          () => Break(),
        );

        const samplePosition = rayOrigin.add(rayDirection.mul(distanceAlongRay));
        const heightMeters = altitudeForPosition(samplePosition, constants);
        const inPackedGap = bool(false).toVar();
        for (const gap of constants.packedGaps) {
          inPackedGap.assign(
            inPackedGap.or(
              heightMeters
                .greaterThanEqual(gap.minimum)
                .and(heightMeters.lessThanEqual(gap.maximum)),
            ),
          );
        }
        If(inPackedGap, () => {
          distanceAlongRay.assign(distanceAlongRay.add(stepLength));
          Continue();
        });

        const density = sampleLayeredDensity({
          position: samplePosition,
          timeSeconds: float(timeSeconds),
          localWeather,
          shape,
          shapeDetail,
          turbulence,
          constants,
        });
        If(density.lessThan(constants.minDensity), () => {
          distanceAlongRay.assign(distanceAlongRay.add(stepLength.mul(2)));
          Continue();
        });

        const sigmaS = density.mul(constants.betaScatteringPerMeter);
        const sigmaT = sigmaS.add(
          density.mul(constants.betaAbsorptionPerMeter),
        );
        const sunDirection = normalize(vec3(0.38, 0.82, -0.42));
        const lightStepLength =
          constants.localLightDistanceMeters / constants.lightSteps;
        const opticalDepth = float(0).toVar();
        Loop(constants.lightSteps, ({ i }) => {
          const lightPosition = samplePosition.add(
            sunDirection.mul(float(i).add(0.5).mul(lightStepLength)),
          );
          const lightDensity = sampleLayeredDensity({
            position: lightPosition,
            timeSeconds: float(timeSeconds),
            localWeather,
            shape,
            shapeDetail,
            turbulence,
            constants,
          });
          opticalDepth.assign(
            opticalDepth.add(
              lightDensity
                .mul(
                  constants.betaScatteringPerMeter +
                    constants.betaAbsorptionPerMeter,
                )
                .mul(lightStepLength),
            ),
          );
          lightSampleCount.assign(lightSampleCount.add(1));
        });

        const sunTransmittance = exp(opticalDepth.negate());
        const phase = dualHenyeyGreensteinNode({
          cosTheta: dot(sunDirection, rayDirection),
        });
        const skyIncidentRadiance = vec3(0.28, 0.35, 0.46).mul(0.48);
        const sunIncidentRadiance = vec3(1.0, 0.88, 0.72)
          .mul(12)
          .mul(sunTransmittance)
          .mul(phase);
        const bounceIncidentRadiance = vec3(0.18).mul(
          constants.groundBounceEnabled,
        );
        const sourceCoefficient = sigmaS.mul(
          skyIncidentRadiance
            .add(sunIncidentRadiance)
            .add(bounceIncidentRadiance),
        );
        const stepT = exp(sigmaT.mul(stepLength).negate());
        const segmentRadiance = sourceCoefficient
          .mul(float(1).sub(stepT))
          .div(sigmaT.max(1e-8));
        const sampleWeight = transmittance.mul(float(1).sub(stepT));

        radiance.assign(radiance.add(segmentRadiance.mul(transmittance)));
        depthWeighted.assign(
          depthWeighted.add(distanceAlongRay.mul(sampleWeight)),
        );
        depthSquaredWeighted.assign(
          depthSquaredWeighted.add(
            distanceAlongRay.mul(distanceAlongRay).mul(sampleWeight),
          ),
        );
        representativeWeight.assign(representativeWeight.add(sampleWeight));
        transmittance.assign(transmittance.mul(stepT));
        distanceAlongRay.assign(distanceAlongRay.add(stepLength));
        primarySampleCount.assign(primarySampleCount.add(1));
      });

      const representativeMeters = depthWeighted.div(
        representativeWeight.max(1e-6),
      );
      const depthVariance = depthSquaredWeighted
        .div(representativeWeight.max(1e-6))
        .sub(representativeMeters.mul(representativeMeters))
        .max(0);
      const confidence = select(representativeWeight.greaterThan(1e-5), 1, 0);
      textureStore(
        radianceTransmittance,
        cell,
        vec4(radiance, transmittance),
      ).toWriteOnly();
      textureStore(
        representativeDepthMeters,
        cell,
        vec4(representativeMeters, 0, 0, 1),
      ).toWriteOnly();
      textureStore(
        rejectionMask,
        cell,
        vec4(
          select(intervalValid, 0, 1),
          confidence,
          primarySampleCount,
          sqrt(depthVariance).add(lightSampleCount.mul(0)),
        ),
      ).toWriteOnly();
    },
  );

  const node = kernel(targets)
    .compute(constants.width * constants.height, [64])
    .setName(`cloud:bounded-beauty:${constants.domain.type}:${constants.tierName}`);
  node.cloudImplementationStatus = CLOUD_BEAUTY_KERNEL_STATUS;
  node.cloudStorageTextureBindingCount = 3;
  node.cloudTimeSeconds = timeSeconds;
  node.cloudFrameIndex = frameIndex;
  node.cloudSequenceIndex = stochasticSequenceIndex;
  return node;
}

/**
 * Reprojects the representative cloud point through current/previous camera
 * bases and writes only the auxiliary temporal targets. This split keeps every
 * compute pipeline below the portable four-storage-texture stage limit.
 */
export function createCloudAuxiliaryNode({
  config,
  viewport = config.referenceViewport,
  targets,
  deltaTimeSeconds = 0,
  cameraState = config.camera,
  previousCameraState = cameraState,
} = {}) {
  if (!config || !targets) throw new Error("cloud auxiliary kernel requires config and targets");
  if (!Number.isFinite(deltaTimeSeconds) || deltaTimeSeconds < 0) {
    throw new Error("cloud auxiliary deltaTimeSeconds must be finite and nonnegative");
  }
  const constants = scalarConstantsFromConfig(config, viewport, {
    cameraState,
    previousCameraState,
  });
  const kernel = Fn(({ representativeDepthMeters, cloudVelocity, depthMoments }) => {
    const cell = cellFromIndex(constants.width);
    const uv = uvFromCell(cell, constants.width, constants.height);
    const depthMeters = texture(representativeDepthMeters, uv).x.max(0);
    const ray = reconstructCameraRay(uv, constants);
    const worldPoint = vec3FromArray(constants.camera.positionMeters).add(ray.mul(depthMeters));
    const previousPoint = worldPoint.sub(vec3(
      constants.macroWindMetersPerSecond.x * deltaTimeSeconds,
      0,
      constants.macroWindMetersPerSecond.z * deltaTimeSeconds,
    ));
    const previousRelative = previousPoint.sub(
      vec3FromArray(constants.previousCamera.positionMeters),
    );
    const previousForwardDepth = dot(
      previousRelative,
      vec3FromArray(constants.previousCamera.forward),
    ).max(1e-5);
    const previousNdc = vec2(
      dot(previousRelative, vec3FromArray(constants.previousCamera.right))
        .div(previousForwardDepth.mul(constants.aspect * constants.tanHalfFov)),
      dot(previousRelative, vec3FromArray(constants.previousCamera.up))
        .div(previousForwardDepth.mul(constants.tanHalfFov)),
    );
    const previousUv = previousNdc.mul(0.5).add(0.5);
    const velocityPixels = uv.sub(previousUv).mul(vec2(constants.width, constants.height));
    const spreadMeters = depthMeters.mul(0.0025).max(1);
    textureStore(cloudVelocity, cell, vec4(velocityPixels, 0, 1)).toWriteOnly();
    textureStore(
      depthMoments,
      cell,
      vec4(depthMeters, spreadMeters, 0, 1),
    ).toWriteOnly();
  });
  const node = kernel(targets)
    .compute(constants.width * constants.height, [64])
    .setName("cloud:projected-representative-point-velocity");
  node.cloudStorageTextureBindingCount = 2;
  node.cloudDeltaTimeSeconds = deltaTimeSeconds;
  return node;
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
  const stepLengthMeters = 200000 / tier.primarySteps;
  const betaT = config.optics.betaScatteringPerMeter + config.optics.betaAbsorptionPerMeter;
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
      transmittance *= Math.exp(-density * betaT * stepLengthMeters);
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
    implementationStatus: CLOUD_BEAUTY_KERNEL_STATUS.claimLevel,
  };
}

export function createCloudBeautyNodeContract({
  qualityTier = "default",
} = {}) {
  return {
    name: "webgpuWeatherVolumeCloudBeautyScaffold",
    claimLevel: CLOUD_BEAUTY_KERNEL_STATUS.claimLevel,
    conformingRenderer: CLOUD_BEAUTY_KERNEL_STATUS.conformingRenderer,
    implemented: CLOUD_BEAUTY_KERNEL_STATUS.implemented,
    notImplemented: CLOUD_BEAUTY_KERNEL_STATUS.notImplemented,
    rendererPath: "WebGPURenderer + TSL Fn().compute(count)",
    qualityTier,
    writes: [
      "cloudRadianceTransmittance RGBA16F StorageTexture",
      "representativeDepthMeters R32F StorageTexture",
      "cloudVelocity RG16F StorageTexture",
      "depthMoments RG16F StorageTexture",
      "rejectionMask RGBA16F diagnostic StorageTexture",
    ],
    reads: [
      "localWeather NoColorSpace texture",
      "shape Data3DTexture or Storage3DTexture",
      "shapeDetail Data3DTexture or Storage3DTexture",
      "turbulence NoColorSpace texture",
      "stbn NoColorSpace texture",
      "host scene-pass depth texture",
    ],
    lighting: {
      phase: "solid-angle-normalized dual Henyey-Greenstein from a fixed authored sun direction and reconstructed view ray",
      shadow: "bounded short density march toward the fixed sun direction; full-column ground shadow is a separate product",
      multiScattering: "empirical helper exists but is not wired into this kernel",
      groundBounce: "optional authored term",
      integration: "unit-consistent sourceCoefficient/sigmaT analytic segment transfer",
    },
    temporalOutputs: {
      representativeDepth: "opacity-deposition weighted metric sample distance",
      depthMoments: "weighted mean and standard deviation in meters",
      velocity: "current-minus-previous projected representative world point after inverse wind advection",
      depthReject: "owned by the separate temporal scaffold",
      varianceClip: "five-tap neighborhood RGB clipping is implemented in the split temporal color pass",
    },
    debugChannels: LIGHTING_DEBUG_CHANNELS,
  };
}
